// src/per/orchestrator.mjs — P.E.R. Orchestrator.
//
// Detta är den enda platsen som bestämmer VAD som ska hända för en elevaktivitet: vilket koncept,
// vilken uppgift, vilka källor, vilken bedömningsväg, vad som ska sparas och vilket nästa steg
// som rekommenderas. api/knowledge.js är bara transport (auth, flaggor, kvot, HTTP) — all
// pedagogisk beslutslogik ligger här, så den går att köra i test och eval utan HTTP.
//
// Uppgiftskontrakt (validateTask) är medvetet litet men validerat: en ogiltig uppgift ska dö här,
// innan något AI-anrop eller någon skrivning sker.
//
// Rutning per uppgift — deterministisk kod först, modell bara där språk och resonemang krävs:
//
//   diagnose  → DB-urval (regelstyrt) + RAG, generering med LLM bara om ingen godkänd fråga finns
//   answer    → deterministisk rättning ELLER LLM-resonemangsanalys (se assessment.mjs)
//               + regelstyrd rekommendation (recommendation.mjs, ingen LLM)
//   coach     → LLM, alltid källgrundad, aldrig full lösning
//   profile   → ren DB-läsning, ingen LLM
//
// SÄKERHET: varje läsning av elevdata filtreras på userId, och varje fråga som serveras går genom
// toPublicQuestion() som tar bort correct_answer/explanation. Servern kör som service_role och
// bypassar RLS — projektionen ÄR skyddet (Codex CR-PER-001/002).

import { retrieveChunks } from "../retrieval/legal-retrieval.mjs";
import { generateVerifiedQuestion, persistGeneratedQuestion } from "../generation/legal-generation.mjs";
import { assessAnswer, LEVEL_DIFFICULTY } from "./assessment.mjs";
import { loadLearnerProfile, commitAssessment, assessmentFromRow } from "./learner-model.mjs";
import { decideNextStep, selectDiagnosticConcept, COACHING_ACTIONS } from "./recommendation.mjs";
import { logUsage } from "./usage.mjs";
import { callAIRaw } from "../../api/_per-core.js";
import perCoach from "../ai/prompts/per-coach/v1.js";
import { sanitizeQuestionText, sanitizeSourceChunks, filterCitations, sanitizeStudentAnswer } from "./sanitize.mjs";

export const PER_PIPELINE_VERSION = "v1";
export const PER_PROMPT_VERSION = "v1";
export const PILOT_SUBJECT = "Privatjuridik";
export const TASK_TYPES = ["diagnose", "answer", "coach", "profile"];
export const LEVELS = ["E", "C", "A"];
export const QUESTION_TYPES = ["multiple_choice", "short_answer"];

/** Validerat internt uppgiftskontrakt. Returnerar en lista fel — tom lista = giltig uppgift. */
export function validateTask(task) {
  const errors = [];
  if (!task || typeof task !== "object") return ["task saknas"];
  if (!TASK_TYPES.includes(task.type)) errors.push(`type måste vara en av ${TASK_TYPES.join(", ")}`);
  if (!task.userId) errors.push("userId saknas");
  if (task.level !== undefined && !LEVELS.includes(task.level)) errors.push("level måste vara E, C eller A");
  if (task.questionType !== undefined && !QUESTION_TYPES.includes(task.questionType)) {
    errors.push(`questionType måste vara en av ${QUESTION_TYPES.join(", ")}`);
  }
  if (task.type === "answer") {
    if (!task.questionId) errors.push("questionId krävs för answer");
    if (task.studentAnswer === undefined || task.studentAnswer === null || String(task.studentAnswer).trim() === "") {
      errors.push("studentAnswer krävs för answer");
    }
    if (!task.idempotencyKey) errors.push("idempotencyKey krävs för answer");
  }
  if (task.type === "coach" && !task.conceptId) errors.push("conceptId krävs för coach");
  return errors;
}

/**
 * Publik projektion av en fråga. ALLT som avslöjar facit tas bort här — correct_answer,
 * explanation, verifieringsdetaljer. Detta är den enda vägen en fråga får nå en klient.
 */
export function toPublicQuestion(row) {
  const payload = row?.payload ?? {};
  return {
    id: row.id,
    question_type: row.question_type,
    question: payload.question,
    options: payload.options ?? null,
    level: payload.difficulty ?? null,
    concept_ids: row.concept_ids ?? [],
  };
}

/** Hämtar de godkända källutdrag en fråga faktiskt byggdes på. */
async function loadQuestionSources(supabase, chunkIds) {
  if (!chunkIds?.length) return [];
  const { data, error } = await supabase
    .from("knowledge_chunks")
    .select("id, section_ref, content, review_status, document_id")
    .in("id", chunkIds)
    .eq("review_status", "approved"); // aldrig pending/blocked till en elev
  if (error) throw new Error(`Kunde inte läsa källutdrag: ${error.message}`);
  return (data ?? []).map((c) => ({ chunk_id: c.id, section_ref: c.section_ref, content: c.content }));
}

/** Elevvänlig källvisning: paragrafhänvisning + titel, aldrig chunk-id eller intern metadata. */
export async function buildCitations(supabase, chunkIds) {
  if (!chunkIds?.length) return [];
  const { data, error } = await supabase
    .from("knowledge_chunks")
    .select("id, section_ref, document_id, review_status")
    .in("id", chunkIds)
    .eq("review_status", "approved");
  if (error || !data?.length) return [];
  const docIds = [...new Set(data.map((c) => c.document_id).filter(Boolean))];
  let titles = new Map();
  if (docIds.length) {
    const { data: docs } = await supabase.from("knowledge_documents").select("id, title").in("id", docIds);
    titles = new Map((docs ?? []).map((d) => [d.id, d.title]));
  }
  return data.map((c) => ({
    section_ref: c.section_ref ?? null,
    document_title: titles.get(c.document_id) ?? null,
  }));
}

/**
 * Elevens egen frågebank för piloten. En blueprint per (användare, nivå) — frågor som genereras
 * återanvänds över sessioner i stället för att kosta en ny generering varje gång.
 * Ägarskapet är samtidigt behörighetsmodellen: en elev kan bara nå frågor i sina egna blueprints.
 */
async function ensureLearnerBlueprint(supabase, userId, { subject, course, level }) {
  const ref = `per_learner_loop:${level}`;
  const { data: existing, error: selectError } = await supabase
    .from("exam_blueprints")
    .select("id")
    .eq("user_id", userId)
    .eq("subject", subject)
    .eq("level", level)
    .eq("source_material_ref", ref)
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(`Kunde inte läsa blueprint: ${selectError.message}`);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("exam_blueprints")
    .insert({
      user_id: userId,
      subject,
      course: course ?? null,
      level,
      // exam_blueprints.question_count har `check (question_count > 0)` i schemat. Elevloopens
      // blueprint är ingen provuppsättning med förutbestämd längd utan en växande frågebank, så
      // siffran har ingen betydelse här — 1 är det minsta värde constrainten tillåter.
      question_count: 1,
      source_material_ref: ref,
      status: "draft",
      pipeline_version: PER_PIPELINE_VERSION,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`Kunde inte skapa blueprint: ${insertError.message}`);
  return created.id;
}

/**
 * Väljer en färdig, verifierad fråga som eleven ÄGER och ännu inte besvarat.
 * Endast verification_status passed/repaired — manual_review/rejected når aldrig en elev.
 */
async function findUnusedQuestion(supabase, userId, { conceptId, level, questionType }) {
  const { data: blueprints, error: blueprintError } = await supabase
    .from("exam_blueprints")
    .select("id")
    .eq("user_id", userId)
    .eq("level", level);
  if (blueprintError) throw new Error(`Kunde inte läsa blueprints: ${blueprintError.message}`);
  const blueprintIds = (blueprints ?? []).map((b) => b.id);
  if (!blueprintIds.length) return null;

  let query = supabase
    .from("exam_questions")
    .select("id, question_type, payload, concept_ids, source_chunk_ids, verification_status")
    .in("blueprint_id", blueprintIds)
    .in("verification_status", ["passed", "repaired"])
    .contains("concept_ids", [conceptId])
    .order("created_at", { ascending: true })
    .limit(25);
  if (questionType) query = query.eq("question_type", questionType);
  const { data: questions, error: questionError } = await query;
  if (questionError) throw new Error(`Kunde inte läsa frågor: ${questionError.message}`);
  if (!questions?.length) return null;

  const { data: used, error: usedError } = await supabase
    .from("student_attempts")
    .select("question_id")
    .eq("user_id", userId)
    .in("question_id", questions.map((q) => q.id));
  if (usedError) throw new Error(`Kunde inte läsa tidigare försök: ${usedError.message}`);
  const usedIds = new Set((used ?? []).map((u) => u.question_id));

  return questions.find((q) => !usedIds.has(q.id)) ?? null;
}

/**
 * DIAGNOSE — välj koncept (regelstyrt), välj eller generera en verifierad fråga, returnera den
 * utan facit tillsammans med motiveringen till varför just detta område valdes.
 */
export async function runDiagnostic({
  supabase, userId, subject = PILOT_SUBJECT, level = "E", conceptId = null, questionType = "short_answer",
  allowGeneration = true, jobId = null, now = new Date().toISOString(),
}) {
  const profile = await loadLearnerProfile(supabase, userId, { subject });
  if (!profile.concepts.length) {
    return { ok: false, reason: "no_concepts_for_subject", subject };
  }

  let selection;
  if (conceptId) {
    const concept = profile.concepts.find((c) => c.id === conceptId);
    if (!concept) return { ok: false, reason: "unknown_concept" };
    selection = { concept, reason: "Du valde det här området själv.", evidence: { rule: "explicit_choice" } };
  } else {
    selection = selectDiagnosticConcept(profile, { now });
    if (!selection) return { ok: false, reason: "no_concepts_for_subject", subject };
  }
  const concept = selection.concept;
  const masteryRow = profile.masteryByConcept.get(concept.id) ?? null;

  let questionRow = await findUnusedQuestion(supabase, userId, { conceptId: concept.id, level, questionType });
  let generated = false;

  if (!questionRow) {
    if (!allowGeneration) return { ok: false, reason: "no_question_available", concept: concept.slug };
    const blueprintId = await ensureLearnerBlueprint(supabase, userId, {
      subject: concept.subject, course: concept.course, level,
    });
    // includePending hårdkodat false via default — samma spärr som api/knowledge.js:s opGenerate.
    const result = await generateVerifiedQuestion({
      supabase, jobId, userId, concept, questionType, level,
    });
    if (!result.ok) return { ok: false, reason: result.reason, concept: concept.slug };
    if (!["passed", "repaired"].includes(result.verificationStatus)) {
      // En fråga som inte klarade verifieringen visas ALDRIG för en elev. Den sparas ändå, för
      // spårbarhet och för att verifieringsstatistiken ska vara sann.
      const { data: positionRow } = await supabase
        .from("exam_questions").select("position").eq("blueprint_id", blueprintId)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      await persistGeneratedQuestion({
        supabase, blueprintId, position: (positionRow?.position ?? 0) + 1,
        concept, questionType, level, result,
      });
      return { ok: false, reason: "question_failed_verification", concept: concept.slug };
    }

    const { data: positionRow } = await supabase
      .from("exam_questions").select("position").eq("blueprint_id", blueprintId)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const persisted = await persistGeneratedQuestion({
      supabase, blueprintId, position: (positionRow?.position ?? 0) + 1,
      concept, questionType, level, result,
    });
    if (!persisted.ok) return { ok: false, reason: "persist_failed" };

    const { data: fresh, error: freshError } = await supabase
      .from("exam_questions")
      .select("id, question_type, payload, concept_ids, source_chunk_ids, verification_status")
      .eq("id", persisted.examQuestionId)
      .single();
    if (freshError) return { ok: false, reason: "persist_failed" };
    questionRow = fresh;
    generated = true;
  }

  return {
    ok: true,
    question: toPublicQuestion(questionRow),
    concept: { id: concept.id, slug: concept.slug, name: concept.name },
    level,
    why_this: selection.reason,
    why_evidence: selection.evidence,
    mastery: masteryRow
      ? { mastery_score: masteryRow.mastery_score, confidence: masteryRow.confidence, attempts: masteryRow.attempts }
      : null,
    sources: await buildCitations(supabase, questionRow.source_chunk_ids),
    generated,
  };
}

/**
 * ANSWER — hela loopens kärna: bedöm, spara evidens, uppdatera elevmodellen, bestäm nästa steg.
 */
export async function runAnswer({
  supabase, userId, questionId, studentAnswer, idempotencyKey, jobId = null, now = new Date().toISOString(),
}) {
  // Ägarskapskontroll INNAN någonting annat: frågan måste ligga i en blueprint som eleven äger.
  // Utan detta kan ett gissat/uppräknat questionId ge tillgång till andras frågor (IDOR).
  const { data: questionRow, error: questionError } = await supabase
    .from("exam_questions")
    .select("id, blueprint_id, question_type, payload, concept_ids, source_chunk_ids, verification_status, exam_blueprints!inner(user_id, level, subject, course)")
    .eq("id", questionId)
    .eq("exam_blueprints.user_id", userId)
    .maybeSingle();
  if (questionError) throw new Error(`Kunde inte läsa fråga: ${questionError.message}`);
  if (!questionRow) return { ok: false, reason: "question_not_found_or_not_owned" };
  if (!["passed", "repaired"].includes(questionRow.verification_status)) {
    return { ok: false, reason: "question_not_verified" };
  }

  const level = questionRow.payload?.difficulty ?? questionRow.exam_blueprints?.level ?? "E";
  const conceptId = questionRow.concept_ids?.[0] ?? null;

  // EN bedömning per fråga (Codex CR-PER-016). Kontrollen ligger FÖRE bedömningen, inte efter,
  // av två skäl: en retry ska inte kosta nya AI-anrop (CR-PER-020), och en elev ska inte kunna
  // skicka nya idempotensnycklar för att prova varje svarsalternativ tills is_correct blir true.
  // Databasen har samma regel som ett unikt index — det här är den snälla vägen dit.
  const { data: prior } = await supabase
    .from("student_attempts")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (prior) {
    // Halvskriven evidenskedja från ett tidigare försök: återuppta den i stället för att lämna
    // elevmodellen ofullständig.
    if (!prior.mastery_applied) {
      await commitAssessment(supabase, {
        userId, questionId, conceptId,
        questionType: prior.question_type,
        level: prior.level,
        studentAnswer: prior.student_answer,
        assessment: assessmentFromRow(prior),
        idempotencyKey: prior.idempotency_key,
      });
    }
    return buildAnswerResponse({
      supabase, userId, conceptId, level: prior.level, now,
      assessment: assessmentFromRow(prior),
      attemptId: prior.id, duplicate: true, alreadyAnswered: true,
      masterySkipped: "already_answered",
    });
  }
  const { data: concept } = conceptId
    ? await supabase.from("concepts").select("id, slug, name, definition, subject, course, curriculum_ref").eq("id", conceptId).single()
    : { data: null };

  const sourceChunks = await loadQuestionSources(supabase, questionRow.source_chunk_ids);

  const assessment = await assessAnswer({
    supabase, userId, jobId,
    question: {
      question_type: questionRow.question_type,
      question: questionRow.payload?.question,
      options: questionRow.payload?.options,
      correct_answer: questionRow.payload?.correct_answer,
      explanation: questionRow.payload?.explanation,
    },
    studentAnswer,
    sourceChunks,
    concept: concept ?? {},
    level,
  });

  const committed = await commitAssessment(supabase, {
    userId, questionId, conceptId,
    questionType: questionRow.question_type,
    level,
    studentAnswer: sanitizeStudentAnswer(studentAnswer).text,
    assessment,
    idempotencyKey,
  });

  return buildAnswerResponse({
    supabase, userId, conceptId, level, now,
    // Vid en kapplöpning kan committed ha bokfört en ANNAN bedömning än den vi just räknade fram;
    // eleven ska alltid se den som faktiskt sparades (Codex CR-PER-026).
    assessment: committed.assessment ?? assessment,
    attemptId: committed.attempt?.id ?? null,
    duplicate: !committed.created,
    masterySkipped: committed.skippedReason,
    persistRecommendation: true,
  });
}

/**
 * Bygger svaret till klienten: återkoppling, källor, elevmodell och nästa steg.
 *
 * Delas mellan den vanliga vägen och "redan besvarad"-vägen så att en elev som laddar om sidan
 * ser exakt samma bedömning som sparades — inte en ny, möjligen annorlunda, modellbedömning.
 */
async function buildAnswerResponse({
  supabase, userId, conceptId, level = "E", now = new Date().toISOString(), assessment,
  attemptId, duplicate = false, alreadyAnswered = false, masterySkipped = null,
  persistRecommendation = false,
}) {
  const noConcept = "00000000-0000-0000-0000-000000000000";

  // Rekommendationen bygger på elevmodellen EFTER uppdateringen — annars föreslås nästa steg
  // utifrån ett läge som inte längre gäller.
  const [{ data: conceptErrors }, { data: conceptAttempts }] = await Promise.all([
    supabase.from("student_error_events").select("error_code, severity, created_at")
      .eq("user_id", userId).eq("concept_id", conceptId ?? noConcept)
      .order("created_at", { ascending: false }).limit(10),
    supabase.from("student_attempts").select("question_type, is_correct, created_at")
      .eq("user_id", userId).eq("concept_id", conceptId ?? noConcept)
      .order("created_at", { ascending: false }).limit(10),
  ]);

  const { data: masteryRow } = conceptId
    ? await supabase.from("student_mastery")
        .select("mastery_score, confidence, attempts, correct_attempts, last_result, last_practiced_at, evidence_quality")
        .eq("user_id", userId).eq("concept_id", conceptId).maybeSingle()
    : { data: null };

  const next = decideNextStep({
    assessment,
    mastery: masteryRow,
    conceptErrors: conceptErrors ?? [],
    conceptAttempts: conceptAttempts ?? [],
    level,
    now,
  });

  let recommendationRow = null;
  if (persistRecommendation && conceptId) {
    // Ett öppet nästa steg per koncept (unikt index i migrationen). Supersede först, insert sedan;
    // om två svar råkar gå parallellt vinner det ena och det andra läser upp den öppna raden i
    // stället för att krascha eller skapa en andra (Codex CR-PER-021).
    await supabase.from("student_recommendations")
      .update({ status: "superseded" })
      .eq("user_id", userId).eq("status", "open").eq("concept_id", conceptId);

    const { data, error } = await supabase.from("student_recommendations").insert({
      user_id: userId,
      concept_id: conceptId,
      source_attempt_id: attemptId,
      action: next.action,
      target_level: next.target_level,
      rationale: next.rationale,
      evidence: next.evidence,
      status: "open",
    }).select().single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabase.from("student_recommendations")
          .select("*").eq("user_id", userId).eq("concept_id", conceptId).eq("status", "open").maybeSingle();
        recommendationRow = existing ?? null;
      } else {
        // Tyst ignorerat fel här betydde tidigare att API:t kunde svara ok:true utan sparad
        // rekommendation (Codex CR-PER-021). Logga server-side; eleven får ändå sitt nästa steg
        // i svaret, bara utan sparat id.
        console.error("kunde inte spara rekommendation:", error.message);
      }
    } else {
      recommendationRow = data;
    }
  } else if (conceptId) {
    const { data: existing } = await supabase.from("student_recommendations")
      .select("*").eq("user_id", userId).eq("concept_id", conceptId).eq("status", "open").maybeSingle();
    recommendationRow = existing ?? null;
  }

  return {
    ok: true,
    duplicate,
    already_answered: alreadyAnswered,
    feedback: {
      score: assessment.score,
      is_correct: assessment.is_correct,
      grounded: assessment.grounded,
      text: assessment.feedback_student,
      strengths: assessment.strengths,
      missing_points: assessment.missing_points,
      dimensions: assessment.dimensions,
      knowledge_gap: assessment.error_code
        ? { code: assessment.error_code, severity: assessment.error_severity, description: assessment.misconception }
        : null,
    },
    sources: await buildCitations(supabase, assessment.cited_chunk_ids),
    mastery: masteryRow
      ? {
          concept_id: conceptId,
          mastery_score: masteryRow.mastery_score,
          confidence: masteryRow.confidence,
          attempts: masteryRow.attempts,
          correct_attempts: masteryRow.correct_attempts,
        }
      : null,
    mastery_skipped: masterySkipped,
    next_step: {
      action: recommendationRow?.action ?? next.action,
      target_level: recommendationRow?.target_level ?? next.target_level,
      rationale: recommendationRow?.rationale ?? next.rationale,
      needs_coaching: COACHING_ACTIONS.has(recommendationRow?.action ?? next.action),
      recommendation_id: recommendationRow?.id ?? null,
    },
    telemetry: {
      assessment_method: assessment.method,
      confidence: assessment.confidence,
      disagreement: assessment.disagreement,
      latency_ms: assessment.latency_ms,
      models_used: assessment.models_used,
      input_redacted: assessment.redacted_input,
    },
  };
}

/**
 * COACH — stegvis hjälp när rekommendationen säger att eleven behöver förstå något först.
 * Alltid källgrundad; ger aldrig hela lösningen (helpLevel 0–2, se per-coach/v1.js).
 */
export async function runCoach({
  supabase, userId, conceptId, helpLevel = 0, questionId = null, jobId = null,
}) {
  const { data: concept, error: conceptError } = await supabase
    .from("concepts").select("id, slug, name, definition, subject, course").eq("id", conceptId).single();
  if (conceptError || !concept) return { ok: false, reason: "unknown_concept" };

  // Senaste försöket på konceptet ger missuppfattningen att adressera. Filtrerat på userId.
  const { data: lastAttempt } = await supabase
    .from("student_attempts")
    .select("student_answer, assessment, question_id")
    .eq("user_id", userId).eq("concept_id", conceptId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  let questionText = null;
  const targetQuestionId = questionId ?? lastAttempt?.question_id ?? null;
  if (targetQuestionId) {
    const { data: q } = await supabase
      .from("exam_questions")
      .select("payload, exam_blueprints!inner(user_id)")
      .eq("id", targetQuestionId).eq("exam_blueprints.user_id", userId).maybeSingle();
    questionText = sanitizeQuestionText(q?.payload?.question);
  }

  const retrieved = await retrieveChunks(supabase, concept.definition || concept.name, { matchCount: 4 });
  const chunks = sanitizeSourceChunks(
    (retrieved ?? []).map((r) => ({ chunk_id: r.chunk_id, section_ref: r.section_ref, content: r.content }))
  );
  if (!chunks.length) {
    return {
      ok: true,
      grounded: false,
      message: "Jag har inte tillräckligt med underlag för att förklara det här säkert just nu, så jag gissar hellre inte.",
      guiding_question: "",
      sources: [],
    };
  }

  const subjectLabel = concept.course ? `${concept.subject} (${concept.course})` : concept.subject;
  const t0 = Date.now();
  const out = await callAIRaw(
    [
      { role: "system", content: perCoach.systemPrompt({ helpLevel, level: "E", concept: concept.name, subjectLabel }) },
      {
        role: "user",
        content: perCoach.buildUserPrompt({
          concept: concept.name,
          misconception: lastAttempt?.assessment?.misconception ?? null,
          previousAnswer: lastAttempt?.student_answer ?? null,
          question: questionText,
          sourceChunks: chunks,
        }),
      },
    ],
    { model: process.env.OPENAI_MODEL || "gpt-4o-mini", schema: perCoach.outputSchema(), timeout: 30000 }
  );
  await logUsage(supabase, {
    jobId, userId, feature: "per_learner_loop", pipelineStep: "coach",
    subject: concept.subject, course: concept.course,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini", usage: out.usage,
    latencyMs: Date.now() - t0, retrievedChunks: chunks.length,
    promptVersion: PER_PROMPT_VERSION, pipelineVersion: PER_PIPELINE_VERSION,
  });

  const parsed = JSON.parse(out.text);
  const citedIds = filterCitations(parsed.cited_chunk_ids, chunks);
  return {
    ok: true,
    grounded: parsed.grounded === true,
    message: parsed.message,
    guiding_question: parsed.guiding_question ?? "",
    sources: await buildCitations(supabase, citedIds),
  };
}

/** PROFILE — elevens progression. Ren DB-läsning, inga AI-anrop, inga kostnader. */
export async function getProfile(supabase, userId, { subject = PILOT_SUBJECT } = {}) {
  const profile = await loadLearnerProfile(supabase, userId, { subject });
  const concepts = profile.concepts.map((c) => {
    const m = profile.masteryByConcept.get(c.id);
    const errors = profile.recentErrors.filter((e) => e.concept_id === c.id);
    return {
      concept_id: c.id,
      slug: c.slug,
      name: c.name,
      mastery_score: m?.mastery_score ?? 0,
      confidence: m?.confidence ?? 0,
      attempts: m?.attempts ?? 0,
      correct_attempts: m?.correct_attempts ?? 0,
      last_practiced_at: m?.last_practiced_at ?? null,
      common_errors: [...new Set(errors.map((e) => e.error_code))].slice(0, 3),
    };
  });

  const practiced = concepts.filter((c) => c.attempts > 0);
  return {
    ok: true,
    subject,
    concepts,
    summary: {
      concepts_total: concepts.length,
      concepts_practiced: practiced.length,
      average_mastery: practiced.length
        ? Math.round(practiced.reduce((sum, c) => sum + c.mastery_score, 0) / practiced.length)
        : 0,
      total_attempts: concepts.reduce((sum, c) => sum + c.attempts, 0),
    },
    recent_attempts: profile.recentAttempts.slice(0, 10).map((a) => ({
      concept_id: a.concept_id,
      score: a.score,
      is_correct: a.is_correct,
      level: a.level,
      created_at: a.created_at,
    })),
  };
}

export { LEVEL_DIFFICULTY };
