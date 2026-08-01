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
//
// Mathematics is NOT in this table. It is scored by mathHits() below, and
// generate-exam.js's looksLikeMath() now delegates to detectSubjectProfile(),
// so the generator's MATH MODE and this file's mathematics overlay can no
// longer disagree — they read the same number.
const SUBJECT_KEYWORDS = {
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

// ── Mathematics evidence (moved here from generate-exam.js) ─────────────────
// Two tiers, as established 2026-07-28: terms distinctive enough that no
// ordinary Swedish word contains them are matched anywhere, so compounds like
// "andragradsekvationer" are caught; terms that also occur in everyday Swedish
// are matched at word start only, so "log" cannot pull in biologi/psykologi.
// Strong: a word containing one of these is about mathematics and essentially
// nothing else, so one occurrence is enough on its own. Matched anywhere, which
// is what makes the Swedish compounds work (andragradsEKVATIONer).
const MATH_TERMS_STRONG = [
  "matematik", "algebra", "ekvation", "olikhet", "polynom", "logaritm",
  "derivat", "integral", "geometri", "trigonometri", "cosinus", "tangens",
  "vektor", "sannolikhet", "parabel", "kvadrat",
  "komplexa tal", "diskret matematik", "exponentialfunktion",
];
// Weak: real mathematical vocabulary that is also ordinary Swedish or belongs to
// other subjects just as much. "funktion" has to be matched anywhere so that
// andragradsfunktion counts, but it is the everyday word for a function in
// programming too; "procent" and "statistik" appear in any social-studies text.
// One of these alone is not a subject — it needs corroboration.
const MATH_TERMS_WEAK_ANYWHERE = ["funktion"];
const MATH_TERMS_WEAK_WORD_START = [
  "math", "potens", "exponent", "sinus", "statistik", "bråk", "procent", "linjär",
];
const MATH_RE_STRONG = new RegExp(`(?:${MATH_TERMS_STRONG.join("|")})`, "gi");
const MATH_RE_WEAK_ANYWHERE = new RegExp(`(?:${MATH_TERMS_WEAK_ANYWHERE.join("|")})`, "gi");
const MATH_RE_WEAK_WORD = new RegExp(`\\b(?:${MATH_TERMS_WEAK_WORD_START.join("|")})`, "gi");
const STRONG_TERM_WEIGHT = 2;

// Notation is evidence too, but it must be LOCAL. The rule this replaces tested
// /[=<>]/ and /[xyz]/ against the whole document independently, so an equals
// sign in one paragraph and any word containing x, y or z in another satisfied
// it — "Vinst = intäkt minus kostnad per styck." read as mathematics. Each
// pattern below requires the symbol and the variable to sit together.
const MATH_NOTATION = [
  /\bf\s*\(\s*x\s*\)/i,          // f(x)
  /[√∫∑]/,                        // root, integral, sum
  /[a-z]\s*\^\s*\d/i,            // x^2
  /[a-z][²³]/i,                  // x², y³
  /\bln\b/i,                     // natural log
  /\b\d+\s*\/\s*\d+\b/,          // a fraction written 3/4
  // A coefficient bound to a variable (6x) — but only next to an operator.
  // Without that anchor this matches the level letter in every Swedish course
  // code: "Historia 1b", "Samhällskunskap 1b", "Matematik 2b" all end in
  // digit+letter, so every such course scored a maths notation hit.
  /\d[a-z]\s*[-+*/=^]|[-+*/=(]\s*\d[a-z]\b/i,
  /\b[a-z]\s*=\s*[-+]?\s*[\da-z]/i, // x = 4, y = kx + m (single-letter left side)
];

// Counts distinct pieces of mathematics evidence in a text. Distinct, not total
// occurrences: a text repeating "ekvation" twenty times is one kind of evidence,
// and letting repetition inflate the score would reintroduce the single-signal
// problem in another form.
function mathHits(text) {
  const s = String(text || "").toLowerCase().replace(NON_MATH_FUNKTION, " ");
  const strong = new Set();
  const weak = new Set();
  for (const m of s.matchAll(MATH_RE_STRONG)) strong.add(m[0]);
  for (const m of s.matchAll(MATH_RE_WEAK_ANYWHERE)) weak.add(m[0]);
  for (const m of s.matchAll(MATH_RE_WEAK_WORD)) weak.add(m[0]);
  for (const re of MATH_NOTATION) if (re.test(s)) weak.add(re.source);
  return STRONG_TERM_WEIGHT * strong.size + weak.size;
}

// A keyword in the course title is far stronger evidence than the same keyword
// somewhere in two thousand words of pasted notes: the student chose the title
// to say what the exam is about.
const COURSE_WEIGHT = 3;
// With no course-title signal at all, a specialist profile needs more than one
// stray keyword. "97 procent av befolkningen" in a history text is not maths.
const MIN_MATERIAL_EVIDENCE = 2;

// A keyword written with a trailing space in SUBJECT_KEYWORDS means "this word
// on its own" — the space was standing in for a word boundary. Plain substring
// matching broke that: "lag " matched "aktiebolag ", routing an entrepreneurship
// text to the law profile. Anything without a trailing space keeps substring
// matching, which is what lets "lagen" and "rätts" catch Swedish compounds.
function keywordMatches(text, keyword) {
  if (!keyword.endsWith(" ")) return text.includes(keyword);
  const bare = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${bare}\\b`, "i").test(text);
}

function subjectScores(course, pastedText) {
  const c = String(course || "").toLowerCase().replace(NON_MATH_FUNKTION, " ");
  const m = String(pastedText || "").toLowerCase().replace(NON_MATH_FUNKTION, " ");
  const scores = {};
  for (const [key, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    scores[key] = {
      course: kws.reduce((n, k) => n + (keywordMatches(c, k) ? 1 : 0), 0),
      material: kws.reduce((n, k) => n + (keywordMatches(m, k) ? 1 : 0), 0),
    };
  }
  scores.mathematics = { course: mathHits(c), material: mathHits(m) };
  for (const s of Object.values(scores)) s.total = COURSE_WEIGHT * s.course + s.material;
  return scores;
}

function detectSubjectProfile(course, pastedText) {
  const scores = subjectScores(course, pastedText);
  const ranked = Object.entries(scores)
    .map(([key, s]) => ({ key, courseHits: s.course, total: s.total }))
    .filter(x => x.total > 0)
    .sort((a, b) => b.total - a.total || b.courseHits - a.courseHits);
  if (!ranked.length) return "generic";

  const top = ranked[0];
  // Weak evidence stays generic rather than picking a specialist overlay whose
  // blocking rules would then apply to a subject they were never written for.
  if (top.courseHits === 0 && top.total < MIN_MATERIAL_EVIDENCE) return "generic";
  // A genuine tie used to be decided by key order in SUBJECT_KEYWORDS, which
  // handed every 1-1 tie to mathematics. Stay generic instead.
  const second = ranked[1];
  if (second && second.total === top.total && second.courseHits === top.courseHits) return "generic";
  return top.key;
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

  // ── Item-writing flaws that apply to EVERY subject ────────────────────────
  // Both are non-blocking: they describe a weak question, not an unanswerable
  // one, and dropping them would shrink exams for a stylistic reason. They are
  // surfaced in the gate log and to the verifier instead.
  if (type === "mc") {
    const opts = Array.isArray(q.options) ? q.options : [];
    // "Alla av ovanstående" / "none of the above" — a well-documented flaw:
    // it tests reading of the option list rather than the subject.
    if (opts.some(o => CATCH_ALL_OPTION.test(String(o || "").trim()))) {
      issues.push("catch_all_option");
    }
    // The longest option being the key is the classic test-wise giveaway: a
    // student who knows nothing can score above chance by picking the longest.
    const ci = q.correct_index;
    if (Number.isInteger(ci) && ci >= 0 && ci < opts.length && opts.length >= 3) {
      const lens = opts.map(o => String(o || "").trim().length);
      const keyLen = lens[ci];
      const others = lens.filter((_, i) => i !== ci);
      const longestOther = Math.max(...others);
      if (keyLen >= longestOther * 1.5 && keyLen - longestOther >= 25) {
        issues.push("longest_option_is_answer");
      }
    }
  }
  return issues;
}

// Matches an option whose whole text is a catch-all rather than a real answer.
const CATCH_ALL_OPTION =
  /^(alla|inga|inget|ingen|båda|samtliga)\s+(av\s+)?(ovanstående|ovan|dessa|alternativen)\b|^(all|none|both)\s+of\s+the\s+above\b/i;

// ── Quantity parsing (shared by the science overlay) ────────────────────────
// Splits "9,81 m/s^2" into { value: 9.81, unit: "m/s^2" }. Returns null when the
// option is not a quantity at all (plain prose), so prose options are simply
// skipped rather than coerced into a misleading number. Deliberately stricter
// than the maths overlay's bare-number parse: in science two options can share
// a number while meaning different things ("5 J" vs "5 N"), so the unit must
// match too before anything is called ambiguous.
function parseQuantity(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const m = s.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const unit = m[2]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\*/g, "")
    .replace(/\^/g, "");
  return { value, unit };
}

// Parses an option as a single mathematical value, or returns null when it is
// not one. Replaces `Number(String(o).replace(/[^0-9.,\-]/g, ""))`, which read
// every prose option as the number 0 — because Number("") is 0, not NaN — so a
// question with word options ("Nollproduktmetoden", "Diskriminanten",
// "Kvadratkomplettering") looked like three identical numbers and was dropped.
// That deleted exactly the concept and reasoning questions the maths prompt asks
// for, and could empty a whole exam: measured 8 of 12 questions dropped, 0
// delivered, endpoint returning 502.
//
// Only a bare number, optionally with a single trailing unit and optionally
// written as "x = 4", is comparable. Anything compound ("0 och 4"), any
// expression ("x² - 13x + 40 = 0") and all prose return null and are skipped.
// The case the rule exists for — "4" against "4.0" — still resolves.
function parseMathValue(raw) {
  let s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!/\d/.test(s)) return null;
  s = s.replace(/^[a-zà-ÿ]\s*=\s*/, "");
  const m = s.match(/^([+-]?\d+(?:[.,]\d+)?)\s*([^\s]*)$/);
  if (!m) return null;
  const unit = m[2].replace(/[.,;:]+$/, "");
  return `${Number(m[1].replace(",", "."))}|${unit}`;
}

// Normalisation for the languages overlay. Collapses whitespace and strips
// wrapping quotes plus trailing sentence punctuation — differences that carry
// no meaning in a vocabulary or grammar item. Diacritics and letter case are
// deliberately PRESERVED: in a language test "el niño" vs "el nino" is a real
// spelling distinction and a legitimate distractor pair, so folding them
// together would drop valid questions.
function normalizeLanguageOption(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .replace(/^["'«»„“”‚‘’]+|["'«»„“”‚‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,]+$/g, "")
    .trim()
    .toLowerCase();
}

// Pulls out anything that is plausibly code: fenced blocks and inline backtick
// spans. Only these are bracket-checked — prose routinely contains a lone
// parenthesis and must never be treated as broken code.
function extractCodeSpans(text) {
  const s = String(text == null ? "" : text);
  const spans = [];
  const fenced = s.match(/```[\s\S]*?```/g) || [];
  for (const f of fenced) spans.push(f.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""));
  const stripped = s.replace(/```[\s\S]*?```/g, " ");
  const inline = stripped.match(/`[^`\n]+`/g) || [];
  for (const i of inline) spans.push(i.slice(1, -1));
  return spans;
}

// True when (), [] or {} are unbalanced. String and char literals are removed
// first so that print("(") does not read as unbalanced. Still a heuristic —
// which is why the caller flags rather than drops.
function hasUnbalancedDelimiters(code) {
  const src = String(code || "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const ch of src) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (pairs[ch]) {
      if (stack.pop() !== pairs[ch]) return true;
    }
  }
  return stack.length > 0;
}

// ── Profile registry (general core + optional per-subject overlay) ───────────
const PROFILES = {
  generic: { key: "generic", allowedTypes: ["mc", "short"], extraIssues: () => [] },
  mathematics: {
    key: "mathematics", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // two MC options that are the SAME number (e.g. "4" and "4.0") → ambiguous.
      // Options that are not single values (prose, "0 och 4", expressions) are
      // skipped rather than coerced — see parseMathValue.
      if (q.type === "mc" && Array.isArray(q.options)) {
        const vals = q.options.map(parseMathValue).filter(v => v !== null);
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
  languages: {
    key: "languages", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // Two options that differ only in wrapping quotes, spacing or trailing
      // punctuation are the same answer — the item has two correct choices.
      // Case and diacritics are NOT folded (see normalizeLanguageOption).
      if (q.type === "mc" && Array.isArray(q.options)) {
        const norm = q.options.map(normalizeLanguageOption).filter(Boolean);
        if (norm.length >= 2 && new Set(norm).size !== norm.length) {
          issues.push("language_options_equivalent");
        }
      }
      return issues;
    },
  },
  natural_sciences: {
    key: "natural_sciences", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // Same value AND same unit in two options ("5,0 N" vs "5 N") → ambiguous.
      // Options that aren't quantities are skipped, so a prose item is never
      // affected. Requires the unit to match, unlike the maths overlay.
      if (q.type === "mc" && Array.isArray(q.options)) {
        const quantities = q.options.map(parseQuantity).filter(Boolean);
        const keys = quantities.map(x => `${x.value}|${x.unit}`);
        if (keys.length >= 2 && new Set(keys).size !== keys.length) {
          issues.push("science_options_quantitatively_equal");
        }
      }
      return issues;
    },
  },
  social_sciences: {
    key: "social_sciences", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // Same over-categorical risk as law: social science answers are rarely
      // absolute, so "alltid/aldrig/endast" usually makes a second option
      // defensible. Non-blocking, exactly as in the law profile.
      if (q.type === "mc" && /\balltid\b|\baldrig\b|\bendast\b/i.test(String(q.question || ""))) {
        issues.push("so_categorical_wording");
      }
      // A date past next year stated as historical fact is a fabrication tell.
      // Non-blocking, because economics and politics legitimately discuss
      // forecasts — this surfaces the question for review, never drops it.
      const haystack = [String(q.question || ""), ...(Array.isArray(q.options) ? q.options.map(String) : [])].join(" \n ");
      const maxPlausibleYear = new Date().getFullYear() + 1;
      const years = (haystack.match(/\b(1[0-9]{3}|2[0-9]{3})\b/g) || []).map(Number);
      if (years.some(y => y > maxPlausibleYear)) issues.push("so_implausible_year");
      return issues;
    },
  },
  programming: {
    key: "programming", allowedTypes: ["mc", "short"],
    extraIssues(q) {
      const issues = [];
      // Only backticked/fenced spans are inspected, and the balance check is a
      // heuristic (see hasUnbalancedDelimiters) — hence non-blocking. The
      // verifier's programming hint does the real "does this code run" work.
      const texts = [String(q.question || ""), ...(Array.isArray(q.options) ? q.options.map(String) : [])];
      const spans = texts.flatMap(extractCodeSpans);
      if (spans.some(hasUnbalancedDelimiters)) issues.push("programming_unbalanced_code");
      return issues;
    },
  },
};
function getProfile(key) { return PROFILES[key] || PROFILES.generic; }

// Issues that must DROP a question (unreliable to grade / misleading).
const BLOCKING = new Set([
  "not_an_object", "empty_prompt", "nonpositive_points", "too_few_options",
  "empty_option", "duplicate_options", "answer_key_out_of_range",
  "open_question_ungradeable", "leaked_instructions", "math_options_numerically_equal",
  "cognitive_level_missing", "scoring_rubric_missing_for_open", "law_deprecated_terminology",
  "science_options_quantitatively_equal", "language_options_equivalent",
]);
// Non-blocking issues are flagged (soft warnings) but the question is kept —
// they describe a weak or suspicious question, not an unanswerable one, and
// dropping them would shrink the exam the student asked for:
//   law_categorical_wording        — over-categorical single-answer wording
//   so_categorical_wording         — same, in social studies
//   so_implausible_year            — date past next year (forecast, or fabricated)
//   programming_unbalanced_code    — bracket heuristic, verifier decides
//   catch_all_option               — "alla av ovanstående"-style option
//   longest_option_is_answer       — the key is conspicuously the longest choice

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
  parseQuantity,
  parseMathValue,
  normalizeLanguageOption,
  extractCodeSpans,
  hasUnbalancedDelimiters,
  gateExam,
  signAnswerKey,
  verifyAnswerKey,
  answerKeyString,
  COGNITIVE_VERBS,
};
