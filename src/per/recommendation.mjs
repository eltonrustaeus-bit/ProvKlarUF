// src/per/recommendation.mjs — vad eleven ska göra härnäst, och varför.
//
// HELT DETERMINISTISK. Ingen LLM är inblandad i beslutet. Det är ett medvetet val: ett
// pedagogiskt nästa steg måste kunna motiveras för en elev, en lärare och en vårdnadshavare med
// samma svar varje gång, och gå att testa. En modell som "känner" vad eleven borde göra kan
// varken det ena eller det andra.
//
// Reglerna är ordnade — första träffen vinner. Varje regel returnerar sin egen `rationale`
// (elevläsbar mening) och `evidence` (de siffror regeln faktiskt tittade på), så att
// student_recommendations.evidence alltid innehåller underlaget för just det beslutet.
//
// Alla funktioner här är pure: inga anrop, ingen tid som läses internt (now skickas in), inget
// slumpmoment. Direkt testbara.

export const LEVELS = ["E", "C", "A"];

// Trösklar. Grova med flit — falsk precision i en elevmodell är värre än inget värde alls.
export const LOW_MASTERY = 30;
export const SOLID_MASTERY = 60;
export const STRONG_MASTERY = 75;
export const MIN_CONFIDENCE_FOR_LEVEL_UP = 0.4;
export const SPACED_REVIEW_DAYS = 10;
export const REPEATED_ERROR_THRESHOLD = 2;
export const SAME_TYPE_STREAK_LIMIT = 3;

export function stepLevel(level, direction) {
  const i = LEVELS.indexOf(level);
  if (i === -1) return level;
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, i + direction))] ?? level;
}

function daysSince(iso, now) {
  if (!iso) return Infinity;
  return (new Date(now).getTime() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Väljer vilket koncept som ska diagnostiseras härnäst.
 *
 * Prioritetsordning:
 *   1. Koncept utan någon evidens alls — vi vet ingenting, och att veta något är mest värt.
 *   2. Koncept med låg mastery OCH låg säkerhet — svag kunskap som dessutom är dåligt belagd.
 *   3. Koncept som inte tränats på länge trots hög mastery — repetitionsbehov.
 *   4. Lägst mastery.
 *
 * @returns {{ concept: object, reason: string, evidence: object } | null}
 */
export function selectDiagnosticConcept(profile, { now = new Date().toISOString() } = {}) {
  const concepts = profile?.concepts ?? [];
  if (!concepts.length) return null;
  const mastery = profile.masteryByConcept ?? new Map();

  const untouched = concepts.filter((c) => !mastery.get(c.id) || (mastery.get(c.id)?.attempts ?? 0) === 0);
  if (untouched.length) {
    const concept = untouched[0];
    return {
      concept,
      reason: "Vi har inte tränat på det här området än, så jag börjar med en fråga för att se var du står.",
      evidence: { rule: "no_evidence_yet", attempts: 0 },
    };
  }

  const scored = concepts.map((c) => {
    const m = mastery.get(c.id) ?? {};
    return {
      concept: c,
      mastery_score: m.mastery_score ?? 0,
      confidence: m.confidence ?? 0,
      attempts: m.attempts ?? 0,
      days_since: daysSince(m.last_practiced_at, now),
    };
  });

  const weakAndUncertain = scored
    .filter((s) => s.mastery_score < SOLID_MASTERY && s.confidence < 0.6)
    .sort((a, b) => a.mastery_score - b.mastery_score || a.confidence - b.confidence);
  if (weakAndUncertain.length) {
    const s = weakAndUncertain[0];
    return {
      concept: s.concept,
      reason: "Det här är området där du hittills haft det svårast, och där jag har minst underlag.",
      evidence: { rule: "weak_and_uncertain", mastery_score: s.mastery_score, confidence: s.confidence, attempts: s.attempts },
    };
  }

  const stale = scored.filter((s) => s.days_since >= SPACED_REVIEW_DAYS).sort((a, b) => b.days_since - a.days_since);
  if (stale.length) {
    const s = stale[0];
    return {
      concept: s.concept,
      reason: "Du kunde det här bra, men det var ett tag sedan — dags att repetera så det sitter kvar.",
      evidence: { rule: "spaced_review_due", days_since: Math.round(s.days_since), mastery_score: s.mastery_score },
    };
  }

  const weakest = [...scored].sort((a, b) => a.mastery_score - b.mastery_score)[0];
  return {
    concept: weakest.concept,
    reason: "Det här är området med störst utrymme att förbättra just nu.",
    evidence: { rule: "lowest_mastery", mastery_score: weakest.mastery_score },
  };
}

/**
 * Bestämmer nästa pedagogiska steg efter ETT bedömt svar.
 *
 * @param {object} input
 * @param {object} input.assessment       — resultatet från assessAnswer()
 * @param {object|null} input.mastery     — student_mastery-raden EFTER uppdateringen
 * @param {Array} input.conceptErrors     — elevens senaste felhändelser för DETTA koncept
 * @param {Array} input.conceptAttempts   — elevens senaste försök för DETTA koncept (nyast först)
 * @param {"E"|"C"|"A"} input.level
 * @param {string} [input.now]
 * @returns {{ action: string, target_level: string|null, rationale: string, evidence: object }}
 */
export function decideNextStep({ assessment, mastery, conceptErrors = [], conceptAttempts = [], level = "E", now = new Date().toISOString() }) {
  const masteryScore = mastery?.mastery_score ?? 0;
  const confidence = mastery?.confidence ?? 0;
  const attempts = mastery?.attempts ?? 0;
  const base = { mastery_score: masteryScore, confidence, attempts, level, score: assessment?.score ?? null };

  // R1 — Kunde inte bedömas. Att föreslå träning på ett koncept vi inte fick evidens om vore att
  // låtsas att vi vet något.
  if (assessment?.method === "insufficient_evidence" || assessment?.grounded === false) {
    return {
      action: "switch_concept",
      target_level: level,
      rationale: "Jag kunde inte bedöma det svaret säkert utifrån materialet jag har, så vi tar ett annat område i stället.",
      evidence: { ...base, rule: "R1_insufficient_evidence" },
    };
  }

  const wrong = assessment?.is_correct !== true;

  // R2 — Samma feltyp upprepas. Fler frågor av samma sort löser inte en missuppfattning; eleven
  // behöver förklaringen först.
  const sameCodeCount = assessment?.error_code
    ? conceptErrors.filter((e) => e.error_code === assessment.error_code).length
    : 0;
  if (wrong && sameCodeCount >= REPEATED_ERROR_THRESHOLD) {
    return {
      action: "review_explanation",
      target_level: level,
      rationale: "Samma sorts miss har dykt upp flera gånger här, så vi går igenom hur det hänger ihop innan du provar igen.",
      evidence: { ...base, rule: "R2_repeated_error", error_code: assessment.error_code, occurrences: sameCodeCount },
    };
  }

  // R3 — Allvarlig missuppfattning. En ledtråd som får eleven att tänka om är bättre än ett
  // facit som eleven bara läser.
  if (wrong && assessment?.error_severity === "high") {
    return {
      action: "stepwise_hint",
      target_level: level,
      rationale: "Det här sitter i ett viktigt steg i resonemanget — du får en ledtråd så att du kan komma vidare själv.",
      evidence: { ...base, rule: "R3_high_severity", error_code: assessment.error_code },
    };
  }

  // R4 — Fel + låg mastery på högre nivå: sänk svårighetsgraden i stället för att upprepa.
  if (wrong && masteryScore < LOW_MASTERY && level !== "E") {
    return {
      action: "easier_question",
      target_level: stepLevel(level, -1),
      rationale: "Vi backar ett steg i svårighetsgrad och bygger grunden först — det går snabbare så.",
      evidence: { ...base, rule: "R4_low_mastery_step_down" },
    };
  }

  // R5 — Fel första gången: ledtråd, inte facit.
  if (wrong) {
    return {
      action: "stepwise_hint",
      target_level: level,
      rationale: "Du är på väg — en ledtråd räcker nog för att du ska hitta rätt själv.",
      evidence: { ...base, rule: "R5_first_miss" },
    };
  }

  // R6 — Starkt och väl belagt: höj nivån.
  if (masteryScore >= STRONG_MASTERY && confidence >= MIN_CONFIDENCE_FOR_LEVEL_UP && level !== "A") {
    return {
      action: "harder_question",
      target_level: stepLevel(level, +1),
      rationale: "Du har det här på den här nivån — dags att prova en svårare variant.",
      evidence: { ...base, rule: "R6_level_up" },
    };
  }

  // R7 — Starkt på högsta nivån: tillämpa i stället för att fortsätta med samma frågetyp.
  if (masteryScore >= STRONG_MASTERY && level === "A") {
    return {
      action: "application_task",
      target_level: "A",
      rationale: "Du kan regeln — nu testar vi om du kan använda den i ett verkligt fall.",
      evidence: { ...base, rule: "R7_apply" },
    };
  }

  // R8 — Undvik meningslös upprepning: flera rätta svar i rad på samma frågetyp ger ingen ny
  // information om eleven.
  const recentType = conceptAttempts[0]?.question_type;
  const sameTypeStreak = conceptAttempts
    .slice(0, SAME_TYPE_STREAK_LIMIT)
    .filter((a) => a.question_type === recentType && a.is_correct === true).length;
  if (masteryScore >= SOLID_MASTERY && sameTypeStreak >= SAME_TYPE_STREAK_LIMIT) {
    return {
      action: "compare_concepts",
      target_level: level,
      rationale: "Du har svarat rätt flera gånger på samma sorts fråga — nu jämför vi det här med ett närliggande begrepp i stället.",
      evidence: { ...base, rule: "R8_avoid_repetition", same_type_streak: sameTypeStreak },
    };
  }

  // R9 — Kan det, men har inte tränat på länge.
  if (masteryScore >= SOLID_MASTERY && daysSince(mastery?.last_practiced_at, now) >= SPACED_REVIEW_DAYS) {
    return {
      action: "spaced_review",
      target_level: level,
      rationale: "Det var ett tag sedan du tränade på det här — en repetition nu gör att det sitter kvar.",
      evidence: { ...base, rule: "R9_spaced_review" },
    };
  }

  // R10 — Standard: en till på samma nivå.
  return {
    action: "new_question_same_concept",
    target_level: level,
    rationale: "Bra jobbat — en fråga till på samma område så vi ser att det sitter.",
    evidence: { ...base, rule: "R10_default" },
  };
}

/** Åtgärder som betyder "eleven behöver förstå något", inte "eleven ska svara på något". */
export const COACHING_ACTIONS = new Set(["review_explanation", "stepwise_hint"]);
