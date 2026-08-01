// Tests for the per-subject gate overlays and the cross-subject item-writing
// flags added alongside them (api/_assessment.js), plus the verifier's model
// selection and per-subject review hints (api/_verifier.js).
//
// Usage:  node tests/assessment/subject-overlays.test.mjs   (exit 0 = pass)
//
// The point of most of these is the NEGATIVE case: a check that drops valid
// questions is worse than no check at all, because the student silently gets a
// shorter exam than they asked for. Every blocking rule below therefore has a
// paired "must still pass" assertion.

process.env.EXAM_SIGNING_SECRET = "test-secret-do-not-use-in-prod";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const A = require(join(here, "..", "..", "api", "_assessment.js"));
const V = require(join(here, "..", "..", "api", "_verifier.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const mc = (over) => ({
  id: "q", type: "mc", question: "Fråga?", options: ["a", "b", "c"],
  correct_index: 0, points: 1, cognitive_level: "minnas", ...over,
});
const gate = (q, profile) => A.gateExam({ questions: [q] }, { profile });
const issuesOf = (q, profile) => {
  const g = gate(q, profile);
  const rec = g.dropped[0] || g.flagged[0];
  return rec ? rec.issues : [];
};
const kept = (q, profile) => gate(q, profile).questions.length === 1;

// ── natural_sciences: quantity comparison must be unit-aware ────────────────
check("science drops two options with same value AND same unit", (() => {
  const q = mc({ options: ["5,0 N", "5 N", "8 N"], correct_index: 2 });
  return !kept(q, "natural_sciences")
    && issuesOf(q, "natural_sciences").includes("science_options_quantitatively_equal");
})());

check("science KEEPS same value with different units (5 J vs 5 N)", (() => {
  const q = mc({ options: ["5 J", "5 N", "5 W"], correct_index: 0 });
  return kept(q, "natural_sciences");
})());

check("science KEEPS prose options (not quantities, never coerced)", (() => {
  const q = mc({ options: ["Cellandning", "Fotosyntes", "Diffusion"], correct_index: 1 });
  return kept(q, "natural_sciences");
})());

check("science treats m/s^2 and m/s2 as the same unit", (() => {
  const q = mc({ options: ["9,81 m/s^2", "9.81 m/s2", "1,5 m/s^2"], correct_index: 0 });
  return !kept(q, "natural_sciences");
})());

// ── languages: normalise formatting, never diacritics ───────────────────────
check("languages drops options differing only in quotes/trailing punctuation", (() => {
  const q = mc({ options: ['"the cat"', "the cat.", "the dog"], correct_index: 2 });
  return !kept(q, "languages")
    && issuesOf(q, "languages").includes("language_options_equivalent");
})());

check("languages KEEPS a diacritic spelling distractor (el niño vs el nino)", (() => {
  const q = mc({ options: ["el niño", "el nino", "la niña"], correct_index: 0 });
  return kept(q, "languages");
})());

// ── social_sciences: both flags are non-blocking ────────────────────────────
check("social studies FLAGS but keeps categorical wording", (() => {
  const q = mc({ question: "Vilket påstående är alltid sant om demokrati?" });
  return kept(q, "social_sciences")
    && issuesOf(q, "social_sciences").includes("so_categorical_wording");
})());

check("social studies FLAGS but keeps an implausible future year", (() => {
  const future = new Date().getFullYear() + 40;
  const q = mc({ question: `Vad hände vid reformen ${future}?` });
  return kept(q, "social_sciences")
    && issuesOf(q, "social_sciences").includes("so_implausible_year");
})());

check("social studies does NOT flag ordinary historical years", (() => {
  const q = mc({ question: "Vad inträffade 1789 och 1917?" });
  return kept(q, "social_sciences")
    && !issuesOf(q, "social_sciences").includes("so_implausible_year");
})());

// ── programming: bracket heuristic, non-blocking ────────────────────────────
check("programming FLAGS but keeps unbalanced code in a backtick span", (() => {
  const q = mc({ question: "Vad skriver `print(foo(1, 2)` ut?" });
  return kept(q, "programming")
    && issuesOf(q, "programming").includes("programming_unbalanced_code");
})());

check("programming does NOT flag a bracket inside a string literal", (() => {
  const q = mc({ question: 'Vad skriver `print("(")` ut?' });
  return kept(q, "programming")
    && !issuesOf(q, "programming").includes("programming_unbalanced_code");
})());

check("programming does NOT flag a lone parenthesis in prose", (() => {
  const q = mc({ question: "Vad gör en loop (i Python) med listor?" });
  return kept(q, "programming")
    && !issuesOf(q, "programming").includes("programming_unbalanced_code");
})());

// ── cross-subject item-writing flags (non-blocking, every profile) ──────────
check("flags a catch-all option but keeps the question", (() => {
  const q = mc({ options: ["Alfa", "Beta", "Alla av ovanstående"], correct_index: 0 });
  return kept(q, "generic") && issuesOf(q, "generic").includes("catch_all_option");
})());

check("flags 'none of the above' in English too", (() => {
  const q = mc({ options: ["Alpha", "Beta", "None of the above"], correct_index: 0 });
  return issuesOf(q, "generic").includes("catch_all_option");
})());

check("flags the conspicuously longest option being the key", (() => {
  const q = mc({
    options: ["Ja", "Nej", "Det beror på situationen och kräver en samlad bedömning av flera faktorer"],
    correct_index: 2,
  });
  return kept(q, "generic") && issuesOf(q, "generic").includes("longest_option_is_answer");
})());

check("does NOT flag length when options are comparable", (() => {
  const q = mc({ options: ["Alternativ ett här", "Alternativ två här", "Alternativ tre här"], correct_index: 2 });
  return !issuesOf(q, "generic").includes("longest_option_is_answer");
})());

check("length flag ignores short-answer questions", (() => {
  const q = { id: "s", type: "short", question: "Förklara.", options: [], correct_index: -1, points: 2, model_answer: "x", cognitive_level: "förstå" };
  return !issuesOf(q, "generic").includes("longest_option_is_answer");
})());

// ── regression: existing profiles unchanged ────────────────────────────────
check("maths still drops numerically equal options", (() => {
  const q = mc({ options: ["4", "4.0", "5"], correct_index: 2 });
  return !kept(q, "mathematics");
})());

check("law still drops deprecated terminology", (() => {
  const q = mc({ question: "Vad är snatteri?", options: ["a", "b", "c"] });
  return !kept(q, "law");
})());

// ── helpers, directly ──────────────────────────────────────────────────────
check("parseQuantity returns null for prose", A.parseQuantity("Fotosyntes") === null);
check("parseQuantity reads value and unit", (() => {
  const p = A.parseQuantity("9,81 m/s^2");
  return p && p.value === 9.81 && p.unit === "m/s2";
})());
check("extractCodeSpans finds fenced and inline code", (() => {
  const spans = A.extractCodeSpans("text ```\nfoo(\n``` and `bar(`");
  return spans.length === 2;
})());
check("hasUnbalancedDelimiters is false for balanced code", A.hasUnbalancedDelimiters("f(x[0]){}") === false);

// ── verifier: model selection (A) ──────────────────────────────────────────
check("verifier falls back to the generator model when env is unset", (() => {
  delete process.env.OPENAI_VERIFIER_MODEL;
  return V.verifierModel("gpt-4o-mini") === "gpt-4o-mini";
})());

check("verifier uses OPENAI_VERIFIER_MODEL when set", (() => {
  process.env.OPENAI_VERIFIER_MODEL = "gpt-5";
  const got = V.verifierModel("gpt-4o-mini");
  delete process.env.OPENAI_VERIFIER_MODEL;
  return got === "gpt-5";
})());

// ── verifier: per-subject hints (B) ────────────────────────────────────────
const base = V.buildVerifierPrompt("sv", "generic");
check("generic profile gets the base prompt only", base === V.buildVerifierPrompt("sv", "nonexistent_profile"));

for (const profile of ["law", "mathematics", "natural_sciences", "social_sciences", "languages", "programming"]) {
  check(`${profile} adds a Swedish hint on top of the base`, (() => {
    const p = V.buildVerifierPrompt("sv", profile);
    return p.startsWith(base) && p.length > base.length;
  })());
  check(`${profile} adds an English hint on top of the base`, (() => {
    const en = V.buildVerifierPrompt("en", "generic");
    const p = V.buildVerifierPrompt("en", profile);
    return p.startsWith(en) && p.length > en.length;
  })());
}

check("maths hint names the correct_index/explanation mismatch explicitly", (() => {
  const p = V.buildVerifierPrompt("sv", "mathematics");
  return p.includes("correct_index") && p.includes("model_answer");
})());

check("law hint text is unchanged from before this change", (() => {
  const p = V.buildVerifierPrompt("sv", "law");
  return p.includes("brottsrubriceringar, lagrum och straffskalor är verkliga");
})());

check("every gate profile has a matching verifier hint (or is deliberately generic)", (() => {
  const profiles = Object.keys(A.PROFILES).filter(k => k !== "generic");
  return profiles.every(p => Object.prototype.hasOwnProperty.call(V.SUBJECT_HINTS, p));
})());

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll subject-overlay checks passed.");
