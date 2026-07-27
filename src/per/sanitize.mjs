// src/per/sanitize.mjs — saneringslager för allt otillförlitligt textinnehåll som når P.E.R:s
// bedömningsprompter (uppdragets §7, Codex CR-PER-009/010).
//
// Tre olika typer av otillförlitlig text, tre olika svar:
//
//   1. ELEVENS FRITEXTSVAR — får INTE kastas när en injektionsfras hittas. Att byta ut hela
//      svaret mot "[filtrerad elevfråga]" (mönstret i per-legal/v1.js, rätt för en CHATTFRÅGA)
//      skulle här betyda att en elev som råkar skriva "ignore all" i ett resonemang får noll
//      poäng utan bedömning. I stället REDIGERAS bara den matchande frasen bort, resten bedöms.
//   2. KÄLLUTDRAG (RAG) — mänskligt granskade (review_status='approved'), men Codex-poängen står:
//      ett approved chunk kan ändå innehålla instruktionslik text från ingestionen. Samma
//      redigering tillämpas, plus hård längdgräns per chunk.
//   3. MODELLGENERERAD FRÅGETEXT/FACIT — kommer från vår egen generator, men är fortfarande
//      modelltext och behandlas som otillförlitlig när den återanvänds i en ny prompt.
//
// Regexen är defence-in-depth, inte skyddet i sig. Det egentliga skyddet är att prompterna
// märker dessa fält som data med stabila delimiters och förbjuder instruktioner inuti dem
// (se src/ai/prompts/per-assess/v1.js). Regexen fångar det grövsta; delimiter-disciplinen och
// den strukturerade outputen fångar resten.

// Samma lista som api/_per-context.js:1 och src/ai/prompts/per-legal/v1.js:14 — duplicerad
// avsiktligt (konstanten exporteras inte därifrån), utökad med svenska motsvarigheter eftersom
// eleverna skriver svenska och den engelska listan därför missar den mest sannolika attacken.
const BLOCKED_CONTEXT_REGEX =
  /\b(ignore previous|ignore all|disregard (?:all|previous)|system prompt|developer message|api key|secret|token|supabase_service_role|stripe_secret|openai_api_key|env(?:ironment)? variables?|ignorera (?:alla |tidigare )?(?:instruktioner|regler)|bortse från (?:alla |tidigare )?(?:instruktioner|regler)|systemprompt(?:en)?|ge (?:mig )?full poäng|sätt full poäng|du (?:ska|måste) ge mig)\b/gi;

export const REDACTION_MARKER = "[filtrerat]";

export const MAX_STUDENT_ANSWER_LEN = 4000; // matchar DB-constrainten i 20260727_per_learner_loop.sql
export const MAX_CHUNK_LEN = 4000;
export const MAX_QUESTION_LEN = 2000;

/**
 * Redigerar bort injektionslika fraser men behåller resten av texten.
 * @returns {{ text: string, redacted: boolean }}
 */
export function redactInstructions(raw, maxLen) {
  if (raw === null || raw === undefined) return { text: "", redacted: false };
  const normalized = String(raw).replace(/\s+/g, " ").trim().slice(0, maxLen);
  // Global regex är stateful mellan anrop — nollställ innan varje användning.
  BLOCKED_CONTEXT_REGEX.lastIndex = 0;
  const redacted = BLOCKED_CONTEXT_REGEX.test(normalized);
  BLOCKED_CONTEXT_REGEX.lastIndex = 0;
  return {
    text: redacted ? normalized.replace(BLOCKED_CONTEXT_REGEX, REDACTION_MARKER) : normalized,
    redacted,
  };
}

export function sanitizeStudentAnswer(raw) {
  return redactInstructions(raw, MAX_STUDENT_ANSWER_LEN);
}

export function sanitizeQuestionText(raw) {
  return redactInstructions(raw, MAX_QUESTION_LEN).text;
}

/**
 * Sanerar hämtade chunks och behåller bara de fält som prompterna faktiskt behöver.
 * chunk_id passerar orört — det är ett uuid från vår egen databas och används dessutom för den
 * deterministiska citatkontrollen (se filterCitations).
 */
export function sanitizeSourceChunks(chunks) {
  return (chunks ?? []).map((c) => ({
    chunk_id: c.chunk_id,
    section_ref: redactInstructions(c.section_ref ?? "", 200).text,
    content: redactInstructions(c.content ?? "", MAX_CHUNK_LEN).text,
  }));
}

/**
 * Codex CR-PER-011: strukturerad output garanterar formen, inte sanningen. En modell kan
 * returnera ett chunk_id som aldrig hämtades — och då skulle UI:t visa en källhänvisning som
 * inte finns. Behåll bara id:n som faktiskt ingick i retrievalen.
 * @returns {string[]}
 */
export function filterCitations(citedIds, availableChunks) {
  const allowed = new Set((availableChunks ?? []).map((c) => String(c.chunk_id)));
  return [...new Set((citedIds ?? []).map(String))].filter((id) => allowed.has(id));
}
