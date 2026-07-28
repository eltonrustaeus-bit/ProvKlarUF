// api/_assessment.js  (CommonJS — shared by generate-exam.js and grade.js)
//
// Subject-agnostic assessment core.
//   - detectSubjectProfile(): pick a profile from course/material
//   - PROFILES: general core + subject overlays (generic/mathematics/law/languages/...)
//   - gateExam(): drop/flag structurally or pedagogically broken questions BEFORE
//     they reach the student — the same rules apply to every subject
//   - signAnswerKey()/verifyAnswerKey(): HMAC the answer key so a tampered
//     correct_index sent from the browser cannot buy free points (stateless, no DB)
//
// Adding a subject = add one entry to PROFILES. The core never needs a rewrite.

const crypto = require("crypto");

// ── Answer-key signing (integrity, not confidentiality) ─────────────────────
// Server-only secret; falls back to the service-role key so it works with no new env.
function signingSecret() {
  return process.env.EXAM_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function answerKeyString(q) {
  const id = String(q && q.id != null ? q.id : "");
  const type = String(q && q.type != null ? q.type : "");
  const ci = Number.isInteger(q && q.correct_index) ? q.correct_index : -1;
  const pts = Number(q && q.points) || 0;
  return `v1|${id}|${type}|${ci}|${pts}`;
}
function signAnswerKey(q, secret) {
  const key = secret || signingSecret();
  if (!key) return ""; // signing disabled (e.g. local dev without secrets)
  return crypto.createHmac("sha256", key).update(answerKeyString(q)).digest("hex").slice(0, 32);
}
// Returns true if sig is missing (legacy/unsigned — caller decides) OR matches.
function verifyAnswerKey(q, sig, secret) {
  if (!sig) return true; // unsigned question → backward-compatible, no assertion
  const expected = signAnswerKey(q, secret);
  if (!expected) return true; // server has no secret → cannot verify, don't punish user
  // constant-time compare
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Subject detection ───────────────────────────────────────────────────────
const SUBJECT_KEYWORDS = {
  // Kept in step with MATH_TERMS in generate-exam.js: a course the generator
  // treats as mathematics must also reach the mathematics profile here, or the
  // math-specific gate check never runs on it.
  mathematics: ["matematik", "math", "algebra", "ekvation", "olikhet", "funktion", "derivat",
    "integral", "geometri", "trigonometri", "sinus", "cosinus", "tangens", "vektor",
    "komplexa tal", "diskret matematik", "logaritm", "exponentialfunktion",
    "sannolikhet", "statistik", "bråk", "procent", "polynom"],
  law: ["juridik", "juridisk", "rätts", "lag ", "lagen", "brottsbalk", "åtal",
    "straffrätt", "avtalsrätt", "domstol", "paragraf", "§", "rättskälla"],
  languages: ["engelska", "english", "spanska", "franska", "tyska", "grammatik",
    "grammar", "översätt", "translate", "glosor", "vocabulary", "verb ", "böjning"],
  natural_sciences: ["fysik", "kemi", "biologi", "naturkunskap", "physics", "chemistry",
    "biology", "reaktion", "molekyl", "cell", "energi", "kraft ", "enhet"],
  social_sciences: ["samhällskunskap", "historia", "ekonomi", "geografi", "religion",
    "history", "economics", "politik", "demokrati"],
  programming: ["programmering", "kod", "python", "javascript", "java ", "c++",
    "algoritm", "funktion(", "kompilera", "syntax", "programming", "code"],
};

// Terms that are legally obsolete but still show up in AI-generated distractors
// because they're common in older training text. Extend this list as new cases
// are found in practice — it is a safety net, not a full legal dictionary.
const LAW_DEPRECATED_TERMS = [
  { term: /\bsnatteri\w*/i, note: "ersatt av 'ringa stöld' sedan lagändringen 2017" },
];

// ── Cognitive level → what the student must actually do (not just harder words) ──
const COGNITIVE_VERBS = {
  E: ["identifiera", "definiera", "beskriva", "ange", "nämna", "känna igen",
      "identify", "define", "describe", "state", "recognize"],
  C: ["förklara", "tillämpa", "jämföra", "resonera", "motivera", "analysera översiktligt",
      "explain", "apply", "compare", "reason", "justify"],
  A: ["analysera", "värdera", "väga", "nyansera", "kritiskt granska", "syntetisera",
      "analyze", "evaluate", "weigh", "critically assess", "synthesize"],
};

// "funktion" is a maths keyword, but Vård och omsorg has real courses built on
// the same stem ("Funktionsförmåga och funktionsnedsättning"). Strip those
// compounds before scoring so they cannot pull a care course into the maths
// profile — mirrors NON_MATH_FUNKTION in generate-exam.js.
const NON_MATH_FUNKTION = /funktions(nedsättning|förmåga|hinder|variation)/gi;

function detectSubjectProfile(course, pastedText) {
  const s = `${String(course || "")}\n${String(pastedText || "")}`
    .toLowerCase()
    .replace(NON_MATH_FUNKTION, " ");
  let best = "generic", bestHits = 0;
  for (const [key, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    const hits = kws.reduce((n, k) => n + (s.includes(k) ? 1 : 0), 0);
    if (hits > bestHits) { best = key; bestHits = hits; }
  }
  return best;
}

// ── General (subject-agnostic) quality checks ───────────────────────────────
// Returns an array of issue codes; empty array = passes the general gate.
function generalQualityIssues(q) {
  const issues = [];
  if (!q || typeof q !== "object") return ["not_an_object"];
  if (!String(q.question || "").trim()) issues.push("empty_prompt");
  if (!(Number(q.points) > 0)) issues.push("nonpositive_points");

  const cogLevel = String(q.cognitive_level || "").trim().toLowerCase();
  if (!cogLevel) issues.push("cognitive_level_missing");

  const type = String(q.type || "");
  if (type === "mc") {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2) issues.push("too_few_options");
    if (opts.some(o => !String(o == null ? "" : o).trim())) issues.push("empty_option");
    const norm = opts.map(o => String(o).trim().toLowerCase());
    if (new Set(norm).size !== norm.length) issues.push("duplicate_options");
    const ci = q.correct_index;
    if (!Number.isInteger(ci) || ci < 0 || ci >= opts.length) issues.push("answer_key_out_of_range");
  } else {
    // open-ended: must be gradeable → needs a model answer or rubric
    if (!String(q.model_answer || "").trim() && !String(q.rubric || "").trim()) {
      issues.push("open_question_ungradeable");
    }
    // If a structured rubric is present at all, it must be shaped correctly —
    // a half-written scoring_rubric is worse than none (grade.js would silently
    // ignore it and fall back, hiding the authoring bug). Absent is fine (legacy).
    if (q.scoring_rubric !== undefined) {
      const parts = q.scoring_rubric && Array.isArray(q.scoring_rubric.parts) ? q.scoring_rubric.parts : null;
      const validParts = parts && parts.length > 0 && parts.every(p => p && String(p.description || "").trim() && Number(p.points) > 0);
      if (!validParts) issues.push("scoring_rubric_missing_for_open");
    }
  }
  // leaked internal instructions
  if (/(system prompt|json schema|correct_index|as an ai|internal use)/i.test(String(q.question || ""))) {
    issues.push("leaked_instructions");
  }
  return issues;
}

// ── Profile registry (general core + optional per-subject overlay) ───────────
const PROFILES = {
  generic: { key: "generic", allowedTypes: ["mc", "short"], extraIssues: () => [] },
  mathematics: {
    key: "mathematics", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // two MC options that are the SAME number (e.g. "4" and "4.0") → ambiguous
      if (q.type === "mc" && Array.isArray(q.options)) {
        const vals = q.options
          .map(o => Number(String(o).replace(/[^0-9.,\-]/g, "").replace(",", ".")))
          .filter(v => Number.isFinite(v));
        if (vals.length >= 2 && new Set(vals).size !== vals.length) {
          issues.push("math_options_numerically_equal");
        }
      }
      return issues;
    },
  },
  law: {
    key: "law", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // over-categorical single-answer wording is a known legal risk
      if (q.type === "mc" && /\balltid\b|\baldrig\b|\bendast\b/i.test(String(q.question || ""))) {
        issues.push("law_categorical_wording");
      }
      const haystack = [String(q.question || ""), ...(Array.isArray(q.options) ? q.options.map(String) : [])].join(" \n ");
      if (LAW_DEPRECATED_TERMS.some(({ term }) => term.test(haystack))) {
        issues.push("law_deprecated_terminology");
      }
      return issues;
    },
  },
  languages: { key: "languages", allowedTypes: ["mc", "short"], extraIssues: () => [] },
  natural_sciences: { key: "natural_sciences", allowedTypes: ["mc", "short"], extraIssues: () => [] },
  social_sciences: { key: "social_sciences", allowedTypes: ["mc", "short"], extraIssues: () => [] },
  programming: { key: "programming", allowedTypes: ["mc", "short"], extraIssues: () => [] },
};
function getProfile(key) { return PROFILES[key] || PROFILES.generic; }

// Issues that must DROP a question (unreliable to grade / misleading).
const BLOCKING = new Set([
  "not_an_object", "empty_prompt", "nonpositive_points", "too_few_options",
  "empty_option", "duplicate_options", "answer_key_out_of_range",
  "open_question_ungradeable", "leaked_instructions", "math_options_numerically_equal",
  "cognitive_level_missing", "scoring_rubric_missing_for_open", "law_deprecated_terminology",
]);
// Non-blocking issues are flagged (soft warnings) but the question is kept:
//   law_categorical_wording — surfaced to reviewers/logs, not auto-dropped.

// Gate an exam. Keeps only questions safe to show; signs their answer keys.
function gateExam(exam, opts) {
  const options = opts || {};
  const profileKey = options.profile || "generic";
  const profile = getProfile(profileKey);
  const secret = options.secret;
  const questions = (exam && Array.isArray(exam.questions)) ? exam.questions : [];

  const kept = [];
  const dropped = [];
  const flagged = [];

  for (const q of questions) {
    const issues = [
      ...generalQualityIssues(q),
      ...(profile.allowedTypes.includes(String(q && q.type)) ? [] : ["type_not_allowed_for_subject"]),
      ...(typeof profile.extraIssues === "function" ? profile.extraIssues(q) : []),
    ];
    const blocking = issues.filter(i => BLOCKING.has(i) || i === "type_not_allowed_for_subject");
    if (blocking.length) {
      dropped.push({ id: String(q && q.id != null ? q.id : ""), issues: blocking });
      continue;
    }
    if (issues.length) flagged.push({ id: String(q && q.id != null ? q.id : ""), issues });
    // sign the (now trusted) answer key before it leaves the server
    q.akey_sig = signAnswerKey(q, secret);
    kept.push(q);
  }
  return { profile: profileKey, questions: kept, dropped, flagged };
}

module.exports = {
  detectSubjectProfile,
  getProfile,
  PROFILES,
  generalQualityIssues,
  gateExam,
  signAnswerKey,
  verifyAnswerKey,
  answerKeyString,
  COGNITIVE_VERBS,
};
