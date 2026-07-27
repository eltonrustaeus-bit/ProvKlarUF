// src/per/assessment.mjs — P.E.R:s bedömning av ETT elevsvar.
//
// Grundregel (uppdragets §5): en modell tillfrågas aldrig om något som kan avgöras med kod.
//
//   multiple_choice  → 100% deterministisk rättning i JS. LLM anropas BARA när svaret är fel,
//                      och då enbart för att förklara felet (error-classifier) — aldrig för att
//                      avgöra om det ÄR fel. Rätt svar kostar noll AI-anrop.
//   short_answer     → LLM-resonemangsanalys (per-assess) mot facit + källutdrag. Vid låg
//                      säkerhet körs en oberoende andrabedömning med en starkare modell, och de
//                      två utfallen jämkas DETERMINISTISKT i JS (reconcileAssessments).
//
// Verifieringsmodellen får aldrig veta att den kontrollerar en tidigare bedömning — den får
// exakt samma prompt som förstabedömningen. En modell som vet att den granskar någon annan
// tenderar att hålla med. Samma princip som blind-verifieraren i legal-generation.mjs (§25.1).
//
// Denna modul återanvänder INTE deterministicDecision() från legal-generation.mjs. Den avgör om
// en GENERERAD FRÅGA håller för publicering — ett helt annat beslut än vad en ELEV kan.

import perAssess from "../ai/prompts/per-assess/v1.js";
import errorClassifier from "../ai/prompts/error-classifier/v1.js";
import { callAIRaw } from "../../api/_per-core.js";
import { logUsage } from "./usage.mjs";
import { sanitizeStudentAnswer, sanitizeQuestionText, sanitizeSourceChunks, filterCitations } from "./sanitize.mjs";

export const ASSESS_PROMPT_VERSION = "v1";
export const ASSESS_PIPELINE_VERSION = "v1";

// Kursnivå → svårighetsgrad 0–1 för Elo-uppdateringen i apply_legal_mastery().
// E/C/A är Skolverkets betygsnivåer; siffrorna är en medveten grov kalibrering, inte IRT.
export const LEVEL_DIFFICULTY = { E: 0.3, C: 0.55, A: 0.8 };

// Under denna bedömningssäkerhet körs en oberoende andrabedömning med den starkare modellen.
export const LOW_CONFIDENCE_THRESHOLD = 0.7;
// score ≥ detta räknas som "rätt" (samma tröskel som v_correct_threshold i apply_legal_mastery).
export const CORRECT_THRESHOLD = 0.85;
// score ≥ detta räknas som godkänt på uppgiften (används av rekommendationsmotorn).
export const PASS_THRESHOLD = 0.6;

export const VALID_ERROR_CODES = new Set(errorClassifier.ERROR_CODES);

export function assessorModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
export function assessVerifierModel() {
  return process.env.OPENAI_PER_ASSESS_VERIFY_MODEL || process.env.OPENAI_LEGAL_VERIFY_MODEL || "gpt-4o";
}

/** Normaliserar ett flervalssvar till en jämförbar, ordningsoberoende nyckel. */
export function normalizeChoice(value) {
  const arr = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return arr.map(String).map((s) => s.trim().toUpperCase()).filter(Boolean).sort().join("|");
}

/**
 * Deterministisk flervalsrättning. Ingen AI inblandad, ingen delpoäng: ett flervalssvar är
 * antingen det rätta eller inte.
 */
export function gradeMultipleChoice({ studentAnswer, correctAnswer }) {
  const student = normalizeChoice(studentAnswer);
  const correct = normalizeChoice(correctAnswer);
  const isCorrect = student !== "" && student === correct;
  return { score: isCorrect ? 1 : 0, isCorrect };
}

/** Två bedömningar hamnar i samma "hink" om de är överens om godkänt/underkänt. */
export function scoreBucket(score) {
  return Number(score) >= PASS_THRESHOLD ? "pass" : "fail";
}

/**
 * Deterministisk jämkning av förstabedömning och oberoende andrabedömning.
 *
 * Överens  → medelvärde av score, HÖJD säkerhet (två oberoende bedömare som säger samma sak är
 *            starkare evidens än en).
 * Oense    → den starkare modellens score gäller, men säkerheten HALVERAS. Det är avsiktligt:
 *            en osäker bedömning ska påverka elevmodellen svagt (confidence går in i
 *            apply_legal_mastery som evidenskvalitet), inte tvärsäkert i fel riktning.
 *
 * Pure function — ingen I/O, direkt testbar.
 */
export function reconcileAssessments(primary, verification) {
  if (!verification) return { ...primary, method: "llm_reasoning", disagreement: false };

  const agree = scoreBucket(primary.score) === scoreBucket(verification.score);
  const score = agree ? (Number(primary.score) + Number(verification.score)) / 2 : Number(verification.score);
  const confidence = agree
    ? Math.min(1, (Number(primary.confidence) + Number(verification.confidence)) / 2 + 0.15)
    : Math.min(Number(primary.confidence), Number(verification.confidence)) / 2;

  return {
    // Den starkare modellens innehåll är utgångspunkt — den har sett samma underlag och är
    // bättre på juridiskt resonemang.
    ...verification,
    score,
    confidence,
    grounded: Boolean(primary.grounded) && Boolean(verification.grounded),
    method: "llm_reasoning_verified",
    disagreement: !agree,
  };
}

/**
 * student_error_events.severity tillåter bara low/medium/high (DB-constraint). per-assess-schemat
 * tillåter dessutom 'none' för korrekta svar — den måste mappas bort innan insert, annars fälls
 * raden av constrainten och evidensen tappas tyst.
 */
export function normalizeSeverity(value) {
  const v = String(value ?? "").toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : "medium";
}

/**
 * Deterministisk kontroll: modellen får bara använda felkoder ur den fasta listan.
 *
 * Kalibrering efter evalkörning 2026-07-27: ett svar som är i huvudsak rätt men inte perfekt
 * (score mellan godkänt och full poäng) och där modellen inte hittat någon specifik feltyp fick
 * tidigare OTHER_REVIEW_REQUIRED — alltså "flaggas för mänsklig granskning". Det är fel signal
 * för ett godkänt svar med en liten lucka; det är helt enkelt ett ofullständigt resonemang.
 * OTHER_REVIEW_REQUIRED reserveras för svar som faktiskt inte går att klassificera.
 */
export function normalizeErrorCode(code, { isCorrect, score = 0 }) {
  if (isCorrect) return { error_code: null, error_severity: null };
  const upper = String(code ?? "").toUpperCase();
  if (upper === "NONE" || !VALID_ERROR_CODES.has(upper)) {
    if (upper === "NONE" && Number(score) >= PASS_THRESHOLD) {
      return { error_code: "INCOMPLETE_REASONING", error_severity: "low" };
    }
    return { error_code: "OTHER_REVIEW_REQUIRED", error_severity: "medium" };
  }
  return { error_code: upper, error_severity: null };
}

/**
 * Deterministiskt facitskydd (Codex CR-PER-027).
 *
 * Felklassificeraren MÅSTE se rätt svar för att kunna förklara felet, och prompten förbjuder den
 * att röja det. En promptregel är dock inte en garanti — det här är kontrollen som är det. Om
 * återkopplingen innehåller det rätta alternativets text, eller pekar ut dess bokstav med en
 * facitliknande formulering, kasseras texten till förmån för ett neutralt besked.
 *
 * Pure function — exporterad för test.
 */
export function leaksAnswerKey(feedback, { options, correctAnswer } = {}) {
  const text = String(feedback ?? "");
  if (!text.trim()) return false;
  const correctIds = (Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer])
    .filter(Boolean).map((v) => String(v).trim().toUpperCase());
  if (!correctIds.length) return false;

  // 1. Alternativets text ordagrant (bara meningsfullt långa strängar — korta ord som "Ja"
  //    förekommer naturligt i en förklaring).
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  for (const option of options ?? []) {
    if (!correctIds.includes(String(option.id).trim().toUpperCase())) continue;
    const optionText = String(option.text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (optionText.length >= 20 && normalized.includes(optionText)) return true;
  }

  // 2. Facitliknande formulering som pekar ut bokstaven: "rätt svar är B", "alternativ B är rätt",
  //    "det korrekta alternativet är B".
  for (const id of correctIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Lookaround i stället för \b: ordgränser i JS är ASCII-baserade och bryts av å/ä/ö, så
    // \b före "är" matchar inte alls. Klassen nedan täcker svenska bokstäver explicit.
    const notLetter = "[A-Za-zÅÄÖåäö0-9]";
    const patterns = [
      new RegExp(`(rätt|korrekt)[a-zåäö]*\\s+(svar|alternativ)[a-zåäö]*[^.!?]{0,20}(?<!${notLetter})${escaped}(?!${notLetter})`, "i"),
      new RegExp(`(alternativ|svar)[a-zåäö]*\\s*(?<!${notLetter})${escaped}(?!${notLetter})[^.!?]{0,20}(är|var)\\s+(rätt|korrekt)`, "i"),
    ];
    if (patterns.some((re) => re.test(text))) return true;
  }
  return false;
}

function clamp01(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

/**
 * Bedömer ett elevsvar. Gör ingen databasskrivning — den som anropar (src/per/orchestrator.mjs)
 * äger persisteringen, så att bedömningen går att köra i test och eval utan att röra elevdata.
 *
 * @param {object} opts
 * @param {import("@supabase/supabase-js").SupabaseClient} [opts.supabase] — bara för usage-loggning
 * @param {string} [opts.userId]
 * @param {string} [opts.jobId]
 * @param {{ question_type: string, question: string, options?: Array, correct_answer: any, explanation?: string }} opts.question
 * @param {string|string[]} opts.studentAnswer
 * @param {Array<{chunk_id: string, section_ref?: string, content: string}>} opts.sourceChunks
 * @param {{ id?: string, name?: string, subject?: string, course?: string, curriculum_ref?: string }} opts.concept
 * @param {"E"|"C"|"A"} opts.level
 */
export async function assessAnswer({
  supabase, userId, jobId, question, studentAnswer, sourceChunks, concept, level = "E",
}) {
  const t0 = Date.now();
  const subjectLabel = concept?.course ? `${concept.subject} (${concept.course})` : concept?.subject ?? "kursen";
  const chunks = sanitizeSourceChunks(sourceChunks);
  const questionText = sanitizeQuestionText(question?.question);
  const modelsUsed = [];

  if (question?.question_type === "multiple_choice") {
    const { score, isCorrect } = gradeMultipleChoice({
      studentAnswer,
      correctAnswer: question.correct_answer,
    });

    if (isCorrect) {
      // Rätt svar kostar noll AI-anrop. Förklaringen finns redan i frågans facit.
      return {
        method: "deterministic",
        score,
        is_correct: true,
        confidence: 1,
        grounded: true,
        dimensions: { factual_accuracy: 1, reasoning: 1, concept_usage: 1, method: 1, language: 1 },
        error_code: null,
        error_severity: null,
        misconception: "",
        strengths: [],
        missing_points: [],
        feedback_student: sanitizeQuestionText(question.explanation) || "Rätt svar.",
        next_step_hint: "",
        cited_chunk_ids: chunks.map((c) => c.chunk_id),
        redacted_input: false,
        disagreement: false,
        latency_ms: Date.now() - t0,
        models_used: [],
      };
    }

    // Fel svar: rättningen är redan avgjord — modellen förklarar bara VARFÖR.
    let classification = null;
    try {
      const out = await callAIRaw(
        [
          { role: "system", content: errorClassifier.systemPrompt({ level, concept: concept?.name, subjectLabel }) },
          {
            role: "user",
            content: errorClassifier.buildUserPrompt({
              question: questionText,
              options: question.options,
              studentAnswer,
              correctAnswer: question.correct_answer,
              concept: concept?.name,
              sourceChunks: chunks,
            }),
          },
        ],
        { model: assessorModel(), schema: errorClassifier.outputSchema(), timeout: 30000 }
      );
      modelsUsed.push(assessorModel());
      await logUsage(supabase, {
        jobId, userId, feature: "per_learner_loop", pipelineStep: "error_classify",
        subject: concept?.subject, course: concept?.course, model: assessorModel(), usage: out.usage,
        latencyMs: Date.now() - t0, retrievedChunks: chunks.length,
        promptVersion: ASSESS_PROMPT_VERSION, pipelineVersion: ASSESS_PIPELINE_VERSION,
      });
      classification = JSON.parse(out.text);
    } catch {
      // Fail-safe: eleven ska aldrig fastna för att felklassificeringen strulade. Rättningen
      // (som är det som räknas) är redan klar och deterministisk.
      classification = null;
    }

    const codes = normalizeErrorCode(classification?.error_code, { isCorrect: false });
    const NEUTRAL_MISS =
      "Det blev inte rätt den här gången. Ta hjälp av ledtråden så går vi igenom hur man tänker.";
    // Deterministisk kontroll före allt annat som når eleven.
    const answerKeyContext = { options: question.options, correctAnswer: question.correct_answer };
    const safeFeedback = leaksAnswerKey(classification?.feedback_student, answerKeyContext)
      ? NEUTRAL_MISS
      : classification?.feedback_student;
    const safeHint = leaksAnswerKey(classification?.next_step_hint, answerKeyContext)
      ? ""
      : classification?.next_step_hint;

    return {
      method: "deterministic",
      score,
      is_correct: false,
      confidence: 1, // rättningen är säker; det är förklaringen som kan vara osäker
      grounded: true,
      dimensions: { factual_accuracy: 0, reasoning: 0, concept_usage: 0, method: 1, language: 1 },
      error_code: codes.error_code,
      error_severity: normalizeSeverity(classification?.severity),
      misconception: classification?.misconception ?? "",
      strengths: [],
      missing_points: [],
      // Codex CR-PER-016: fallbacken använde tidigare frågans lagrade `explanation`, som
      // innehåller facit. Efter ett FELsvar ska eleven få hjälp att tänka om — inte serverat
      // rätt svar. Faller nu tillbaka på ett neutralt besked och hänvisar vidare till coachningen.
      feedback_student: safeFeedback || NEUTRAL_MISS,
      next_step_hint: safeHint ?? "",
      cited_chunk_ids: filterCitations(classification?.cited_chunk_ids, chunks),
      redacted_input: false,
      disagreement: false,
      latency_ms: Date.now() - t0,
      models_used: modelsUsed,
    };
  }

  // ── Fritextsvar ───────────────────────────────────────────────────────────
  const sanitized = sanitizeStudentAnswer(studentAnswer);

  if (!chunks.length) {
    // Ingen källgrund = ingen bedömning. Att gissa här är precis det beteende P.E.R. finns för
    // att undvika (§4). Eleven får ett ärligt besked och elevmodellen lämnas orörd.
    return {
      method: "insufficient_evidence",
      score: 0, is_correct: null, confidence: 0, grounded: false,
      dimensions: { factual_accuracy: 0, reasoning: 0, concept_usage: 0, method: 0, language: 0 },
      error_code: null, error_severity: null, misconception: "",
      strengths: [], missing_points: [],
      feedback_student:
        "Jag har inte tillräckligt med underlag för att bedöma det här svaret rättvist, så jag låter bli att gissa. Prova en annan uppgift så länge.",
      next_step_hint: "", cited_chunk_ids: [], redacted_input: sanitized.redacted,
      disagreement: false, latency_ms: Date.now() - t0, models_used: [],
    };
  }

  const promptArgs = {
    question: questionText,
    studentAnswer: sanitized.text,
    referenceAnswer: Array.isArray(question?.correct_answer)
      ? question.correct_answer.join("; ")
      : sanitizeQuestionText(question?.correct_answer),
    explanation: sanitizeQuestionText(question?.explanation),
    criteria: concept?.curriculum_ref ?? null,
    sourceChunks: chunks,
  };
  const messages = [
    { role: "system", content: perAssess.systemPrompt({ level, concept: concept?.name, subjectLabel }) },
    { role: "user", content: perAssess.buildUserPrompt(promptArgs) },
  ];

  let tStep = Date.now();
  const primaryOut = await callAIRaw(messages, {
    model: assessorModel(), schema: perAssess.outputSchema(), timeout: 40000,
  });
  modelsUsed.push(assessorModel());
  await logUsage(supabase, {
    jobId, userId, feature: "per_learner_loop", pipelineStep: "assess",
    subject: concept?.subject, course: concept?.course, model: assessorModel(), usage: primaryOut.usage,
    latencyMs: Date.now() - tStep, retrievedChunks: chunks.length,
    promptVersion: ASSESS_PROMPT_VERSION, pipelineVersion: ASSESS_PIPELINE_VERSION,
  });
  const primary = JSON.parse(primaryOut.text);
  primary.score = clamp01(primary.score);
  primary.confidence = clamp01(primary.confidence);
  // Modellen rapporterar `sources_sufficient` (räcker källorna för att avgöra frågan?). Internt
  // heter samma egenskap `grounded`. Fältnamnen skildes åt efter evalkörningen 2026-07-27: så
  // länge fältet hette "grounded" i prompten tolkade modellen det som "elevens svar har stöd i
  // källorna" och satte false på varje FELAKTIGT svar — varpå hela bedömningen kastades bort som
  // "kunde inte bedömas". Se docs/per/EVALUATION.md.
  primary.grounded = primary.sources_sufficient !== false;

  let verification = null;
  if (primary.confidence < LOW_CONFIDENCE_THRESHOLD || primary.grounded !== true) {
    tStep = Date.now();
    try {
      const verifyOut = await callAIRaw(messages, {
        model: assessVerifierModel(), schema: perAssess.outputSchema(), timeout: 40000,
      });
      modelsUsed.push(assessVerifierModel());
      await logUsage(supabase, {
        jobId, userId, feature: "per_learner_loop", pipelineStep: "verify_assess",
        subject: concept?.subject, course: concept?.course, model: assessVerifierModel(), usage: verifyOut.usage,
        latencyMs: Date.now() - tStep, retrievedChunks: chunks.length,
        promptVersion: ASSESS_PROMPT_VERSION, pipelineVersion: ASSESS_PIPELINE_VERSION,
      });
      verification = JSON.parse(verifyOut.text);
      verification.score = clamp01(verification.score);
      verification.confidence = clamp01(verification.confidence);
      verification.grounded = verification.sources_sufficient !== false;
    } catch {
      // Verifieringen är en förstärkning, inte ett krav. Faller tillbaka på förstabedömningen
      // med oförändrat (lågt) confidence — vilket i sin tur ger svag påverkan på elevmodellen.
      verification = null;
    }
  }

  const merged = reconcileAssessments(primary, verification);
  const isCorrect = merged.grounded ? merged.score >= CORRECT_THRESHOLD : null;
  const codes = normalizeErrorCode(merged.error_code, { isCorrect: isCorrect === true, score: merged.score });

  return {
    method: merged.grounded === false ? "insufficient_evidence" : merged.method,
    score: clamp01(merged.score),
    is_correct: isCorrect,
    confidence: clamp01(merged.confidence),
    grounded: Boolean(merged.grounded),
    dimensions: {
      factual_accuracy: clamp01(merged.dimensions?.factual_accuracy),
      reasoning: clamp01(merged.dimensions?.reasoning),
      concept_usage: clamp01(merged.dimensions?.concept_usage),
      method: clamp01(merged.dimensions?.method, 1),
      language: clamp01(merged.dimensions?.language, 1),
    },
    error_code: codes.error_code,
    error_severity: codes.error_code ? normalizeSeverity(merged.error_severity) : null,
    misconception: merged.misconception ?? "",
    strengths: (merged.strengths ?? []).slice(0, 3),
    missing_points: (merged.missing_points ?? []).slice(0, 3),
    feedback_student: merged.feedback_student ?? "",
    next_step_hint: merged.next_step_hint ?? "",
    cited_chunk_ids: filterCitations(merged.cited_chunk_ids, chunks),
    redacted_input: sanitized.redacted,
    disagreement: Boolean(merged.disagreement),
    latency_ms: Date.now() - t0,
    models_used: modelsUsed,
  };
}
