// src/per/learner-model.mjs — P.E.R:s strukturerade elevmodell.
//
// Elevmodellen är INTE chatthistorik (uppdragets §5). Den är tre saker som hänger ihop:
//
//   student_attempts      — vad eleven faktiskt svarade och hur det bedömdes (evidensen)
//   student_error_events  — vilken TYP av fel det var (mönstret över tid)
//   student_mastery       — vad eleven kan per koncept, med en säkerhet knuten till evidensen
//
// Varje siffra i mastery går att spåra tillbaka till konkreta försök. Det är hela poängen: P.E.R.
// ska kunna svara på "varför rekommenderar du det här?" med data, inte med en modellformulering.
//
// SKRIVNING SKER ALLTID MED service_role (tabellerna har inga insert-policyer). Därför måste
// varje läsning filtreras explicit på user_id — service_role bypassar RLS och skyddar ingenting
// av sig självt (Codex CR-PER-002).

import { LEVEL_DIFFICULTY } from "./assessment.mjs";

export const ATTEMPT_HISTORY_LIMIT = 20;
export const ERROR_HISTORY_LIMIT = 20;

/**
 * Hämtar elevens fulla kunskapsprofil för ett ämne.
 * Alla frågor filtreras på user_id — se filhuvudet.
 */
export async function loadLearnerProfile(supabase, userId, { subject = null, conceptIds = null } = {}) {
  if (!userId) throw new Error("userId krävs");

  let conceptQuery = supabase.from("concepts").select("id, slug, name, definition, subject, course, curriculum_ref");
  if (subject) conceptQuery = conceptQuery.eq("subject", subject);
  if (conceptIds?.length) conceptQuery = conceptQuery.in("id", conceptIds);
  const { data: concepts, error: conceptError } = await conceptQuery;
  if (conceptError) throw new Error(`Kunde inte läsa concepts: ${conceptError.message}`);

  const ids = (concepts ?? []).map((c) => c.id);

  const [masteryRes, errorRes, attemptRes] = await Promise.all([
    supabase.from("student_mastery")
      .select("concept_id, mastery_score, confidence, attempts, correct_attempts, last_result, last_practiced_at, evidence_quality")
      .eq("user_id", userId),
    supabase.from("student_error_events")
      .select("concept_id, error_code, severity, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(ERROR_HISTORY_LIMIT),
    supabase.from("student_attempts")
      .select("id, concept_id, question_id, score, is_correct, confidence, assessment_method, level, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(ATTEMPT_HISTORY_LIMIT),
  ]);

  for (const [name, res] of [["student_mastery", masteryRes], ["student_error_events", errorRes], ["student_attempts", attemptRes]]) {
    if (res.error) throw new Error(`Kunde inte läsa ${name}: ${res.error.message}`);
  }

  const masteryByConcept = new Map((masteryRes.data ?? []).map((m) => [m.concept_id, m]));

  return {
    concepts: (concepts ?? []).filter((c) => !ids.length || ids.includes(c.id)),
    mastery: masteryRes.data ?? [],
    masteryByConcept,
    recentErrors: errorRes.data ?? [],
    recentAttempts: attemptRes.data ?? [],
  };
}

/**
 * Skriver ett försök. Idempotent på (user_id, idempotency_key) — en dubbelskickad submit ger
 * EN rad och returnerar created:false, så att anroparen kan hoppa över mastery-uppdateringen
 * i stället för att räkna samma svar två gånger (Codex CR-PER-004).
 *
 * @returns {Promise<{ attempt: object, created: boolean }>}
 */
export async function recordAttempt(supabase, {
  userId, questionId, conceptId, questionType, level, studentAnswer, assessment, idempotencyKey,
}) {
  const row = {
    user_id: userId,
    question_id: questionId ?? null,
    concept_id: conceptId ?? null,
    question_type: questionType,
    level,
    // Hård trunkering speglar DB-constrainten (4000) — sanitize.mjs har redan kapat, detta är
    // andra linjen så att en insert aldrig fälls på längd.
    student_answer: studentAnswer === null || studentAnswer === undefined ? null : String(studentAnswer).slice(0, 4000),
    is_correct: assessment.is_correct,
    score: assessment.score,
    confidence: assessment.confidence,
    assessment_method: assessment.method,
    assessment: {
      dimensions: assessment.dimensions,
      error_code: assessment.error_code,
      error_severity: assessment.error_severity,
      misconception: assessment.misconception,
      strengths: assessment.strengths,
      missing_points: assessment.missing_points,
      feedback_student: assessment.feedback_student,
      next_step_hint: assessment.next_step_hint,
      grounded: assessment.grounded,
      disagreement: assessment.disagreement,
      redacted_input: assessment.redacted_input,
      models_used: assessment.models_used,
    },
    source_chunk_ids: assessment.cited_chunk_ids ?? [],
    latency_ms: assessment.latency_ms ?? null,
    idempotency_key: idempotencyKey,
  };

  const { data, error } = await supabase.from("student_attempts").insert(row).select().single();
  if (!error) return { attempt: data, created: true };

  // 23505 = unique_violation. TVÅ olika constraints kan ge den koden (Codex CR-PER-026):
  //   (user_id, idempotency_key) — samma submit skickad igen
  //   (user_id, question_id)     — frågan är redan besvarad, t.ex. av en parallell request som
  //                                hann före efter att båda passerat den tidiga kontrollen
  // Att bara slå upp på idempotensnyckeln (som förut) gav i det andra fallet ingen träff och ett
  // kastat fel → 502 för eleven. Sök därför på båda, i den ordning som är mest specifik först.
  if (error.code === "23505") {
    const byKey = await supabase
      .from("student_attempts").select("*")
      .eq("user_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (byKey.data) return { attempt: byKey.data, created: false };

    if (questionId) {
      const byQuestion = await supabase
        .from("student_attempts").select("*")
        .eq("user_id", userId).eq("question_id", questionId).maybeSingle();
      if (byQuestion.data) return { attempt: byQuestion.data, created: false };
    }
    throw new Error("Kunde inte läsa befintligt försök efter unikhetskonflikt");
  }
  throw new Error(`Kunde inte spara försök: ${error.message}`);
}

/**
 * Rekonstruerar ett assessment-objekt ur en sparad student_attempts-rad.
 *
 * Används när ett svar redan är bokfört: eleven ska se den bedömning som FAKTISKT sparades, och
 * en återupptagen evidenskedja ska appliceras med de siffror som ligger i databasen — inte med en
 * ny, möjligen annorlunda, modellbedömning från den anropande requesten (Codex CR-PER-026).
 */
export function assessmentFromRow(row) {
  const a = row?.assessment ?? {};
  return {
    method: row?.assessment_method ?? "deterministic",
    score: row?.score ?? 0,
    is_correct: row?.is_correct ?? null,
    confidence: row?.confidence ?? 0,
    grounded: a.grounded ?? true,
    dimensions: a.dimensions ?? { factual_accuracy: 0, reasoning: 0, concept_usage: 0, method: 1, language: 1 },
    error_code: a.error_code ?? null,
    error_severity: a.error_severity ?? null,
    misconception: a.misconception ?? "",
    strengths: a.strengths ?? [],
    missing_points: a.missing_points ?? [],
    feedback_student: a.feedback_student ?? "",
    next_step_hint: a.next_step_hint ?? "",
    cited_chunk_ids: row?.source_chunk_ids ?? [],
    redacted_input: a.redacted_input ?? false,
    disagreement: a.disagreement ?? false,
    latency_ms: row?.latency_ms ?? 0,
    models_used: a.models_used ?? [],
  };
}

/**
 * Skriver en felhändelse. Triggern i migrationen kontrollerar att den hör ihop med attempt-raden,
 * och ett unikt index på source_attempt_id gör skrivningen idempotent — en återupptagen
 * evidenskedja kan alltså försöka igen utan att skapa dubbletter.
 */
export async function recordErrorEvent(supabase, { userId, questionId, conceptId, errorCode, severity, attemptId }) {
  if (!errorCode) return null;
  const { data, error } = await supabase
    .from("student_error_events")
    .insert({
      user_id: userId,
      question_id: questionId ?? null,
      concept_id: conceptId ?? null,
      error_code: errorCode,
      severity,
      source_attempt_id: attemptId ?? null,
    })
    .select()
    .single();
  if (!error) return data;
  if (error.code === "23505") {
    const { data: existing } = await supabase
      .from("student_error_events").select("*").eq("source_attempt_id", attemptId).maybeSingle();
    return existing ?? null;
  }
  throw new Error(`Kunde inte spara felhändelse: ${error.message}`);
}

/**
 * Atomisk mastery-uppdatering via RPC. Med attemptId sätter RPC:n även `mastery_applied` i SAMMA
 * transaktion och vägrar bokföra samma försök två gånger — exakt-en-gång-garantin ligger i
 * databasen, inte här (se migrationen).
 */
export async function applyMastery(supabase, { userId, conceptId, level, score, confidence, attemptId = null }) {
  const { data, error } = await supabase.rpc("apply_legal_mastery", {
    p_user_id: userId,
    p_concept_id: conceptId,
    p_difficulty: LEVEL_DIFFICULTY[level] ?? 0.5,
    p_score: score,
    p_confidence: confidence,
    p_attempt_id: attemptId,
  });
  if (error) throw new Error(`apply_legal_mastery misslyckades: ${error.message}`);
  return data;
}

/**
 * Skriver hela evidenskedjan för ETT bedömt svar: försök → felhändelse → mastery.
 *
 * Ordningen är avsiktlig och sekvensen är inte en DB-transaktion (PostgREST kan inte det).
 * Två skydd hanterar det:
 *
 *  1. Idempotensnyckeln sitter på FÖRSTA steget, så en retry upptäcks innan mastery hinner
 *     uppdateras en andra gång.
 *  2. `mastery_applied` markerar när kedjan är HELT klar. Codex CR-PER-019: utan den blev en
 *     halvskriven kedja permanent trasig — nyckeln förbrukad, försöket sparat, mastery aldrig
 *     uppdaterad, och varje retry hoppade över resten. Nu ÅTERUPPTAS kedjan i stället. Skrivningen
 *     av felhändelsen är idempotent (unikt index på source_attempt_id), så ett återupptaget
 *     försök kan inte ge dubbletter.
 *
 * Vid otillräckligt underlag (`insufficient_evidence`) skrivs försöket, men elevmodellen lämnas
 * ORÖRD. En bedömning som inte kunde göras är inte evidens om vad eleven kan.
 */
export async function commitAssessment(supabase, {
  userId, questionId, conceptId, questionType, level, studentAnswer, assessment, idempotencyKey,
}) {
  const { attempt, created } = await recordAttempt(supabase, {
    userId, questionId, conceptId, questionType, level, studentAnswer, assessment, idempotencyKey,
  });

  // Ett redan bokfört svar äger sin egen bedömning. Anroparens (nya) assessment får inte användas
  // vidare — den skrevs aldrig till databasen och skulle ge eleven en annan återkoppling än den
  // som faktiskt är sparad (Codex CR-PER-026).
  const effective = created ? assessment : assessmentFromRow(attempt);
  const effectiveLevel = created ? level : attempt.level ?? level;
  const effectiveConceptId = created ? conceptId : attempt.concept_id ?? conceptId;

  // Redan färdigbokfört svar — gör ingenting mer.
  if (!created && attempt?.mastery_applied) {
    return { attempt, assessment: effective, created: false, mastery: null, errorEvent: null, skippedReason: "duplicate_submission" };
  }

  if (effective.method === "insufficient_evidence" || effective.grounded === false) {
    // Inget att applicera, men kedjan är avslutad — markera den så att en retry inte försöker igen.
    const { error: flagError } = await supabase
      .from("student_attempts").update({ mastery_applied: true }).eq("id", attempt.id);
    if (flagError) console.error("kunde inte markera mastery_applied (insufficient_evidence):", flagError.message, "attempt:", attempt.id);
    return {
      attempt, assessment: effective, created, mastery: null, errorEvent: null,
      skippedReason: created ? "insufficient_evidence" : "duplicate_submission",
    };
  }

  let errorEvent = null;
  if (effective.error_code && effectiveConceptId) {
    errorEvent = await recordErrorEvent(supabase, {
      userId, questionId, conceptId: effectiveConceptId,
      errorCode: effective.error_code,
      severity: effective.error_severity ?? "medium",
      attemptId: attempt.id,
    });
  }

  // mastery_applied sätts av RPC:n i samma transaktion som Elo-uppdateringen — ingen separat
  // markering här, och därmed inget fönster där mastery hunnit uppdateras men flaggan inte.
  let mastery = null;
  if (effectiveConceptId) {
    mastery = await applyMastery(supabase, {
      userId, conceptId: effectiveConceptId, level: effectiveLevel,
      score: effective.score,
      confidence: effective.confidence,
      attemptId: attempt.id,
    });
  } else {
    const { error: flagError } = await supabase
      .from("student_attempts").update({ mastery_applied: true }).eq("id", attempt.id);
    if (flagError) console.error("kunde inte markera mastery_applied (utan koncept):", flagError.message, "attempt:", attempt.id);
  }

  return {
    attempt, assessment: effective, created, mastery, errorEvent,
    skippedReason: created ? null : "resumed_incomplete_commit",
  };
}
