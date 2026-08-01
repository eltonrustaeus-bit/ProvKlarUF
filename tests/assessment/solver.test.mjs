// Tests for the independent solve pass (api/_solver.js).
//
// Usage:  node tests/assessment/solver.test.mjs   (exit 0 = pass)
//
// The solver can DELETE questions from a student's exam, so both directions are
// pinned: it must drop what is genuinely broken, and it must not drop a sound
// question just because it was unsure. Delivery is already the scarce resource
// (79 % of requested questions reach the student), so a trigger-happy solver
// would cost more than it buys.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = require(join(root, "api", "_solver.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const q = { id: "1", type: "mc", options: ["a", "b", "c"], correct_index: 1 };
// Without option_verdicts the decision falls back to the index comparison, which
// is the path used when a verdict list is malformed or missing.
const verdict = (index, confidence = 1) => ({ id: "1", index, confidence, reason: "r" });
// With verdicts: the solver's own per-option judgements decide.
const withVerdicts = (verdicts, index, confidence = 1) =>
  ({ id: "1", option_verdicts: verdicts, index, confidence, reason: "r" });

// ── agreement keeps the question ───────────────────────────────────────────
check("keeps when the solver lands on the same option", (() => {
  const d = S.decideKeep(verdict(1), q);
  return d.keep === true && d.reason === "solver_agrees";
})());

check("keeps on agreement even when the solver is unsure", (() => {
  return S.decideKeep(verdict(1, 0.2), q).keep === true;
})());

// ── the dominant defect: several options correct ───────────────────────────
// Measured on the long-form fixtures: 9 of 12 defects were this shape. A solver
// reporting it is necessarily UNSURE which option to pick, so gating this on
// confidence would miss exactly what it exists to catch.
check("drops when no single option is correct, at high confidence", (() => {
  const d = S.decideKeep(verdict(S.NO_SINGLE_ANSWER, 0.95), q);
  return d.keep === false && d.reason === "solver_no_single_answer";
})());

check("drops when no single option is correct, at LOW confidence too", (() => {
  const d = S.decideKeep(verdict(S.NO_SINGLE_ANSWER, 0.1), q);
  return d.keep === false && d.reason === "solver_no_single_answer";
})());

// ── plain disagreement needs confidence behind it ──────────────────────────
check("drops a confident disagreement about the key", (() => {
  const d = S.decideKeep(verdict(2, 0.9), q);
  return d.keep === false && d.reason === "solver_disagrees_on_key";
})());

check("drops exactly at the confidence floor", (() => {
  return S.decideKeep(verdict(2, S.DEFAULT_MISMATCH_CONFIDENCE), q).keep === false;
})());

check("KEEPS a hesitant disagreement — an unsure solver must not delete a sound question", (() => {
  const d = S.decideKeep(verdict(2, 0.4), q);
  return d.keep === true && d.reason === "solver_disagrees_low_confidence";
})());

check("the confidence floor is overridable by the caller", (() => {
  return S.decideKeep(verdict(2, 0.5), q, { minMismatchConfidence: 0.4 }).keep === false;
})());

// ── the escape hatch: questions the solver cannot judge ────────────────────
// Material is capped before being sent, so a question drawn from a later part
// of a long paste may be unanswerable to the solver. That must never delete it.
check("keeps when the solver says it cannot judge", (() => {
  const d = S.decideKeep(verdict(S.CANNOT_JUDGE, 1), q);
  return d.keep === true && d.reason === "solver_cannot_judge";
})());

check("keeps when there is no verdict for the question at all", (() => {
  return S.decideKeep(undefined, q).keep === true;
})());

check("keeps on a nonsense index rather than guessing", (() => {
  return S.decideKeep(verdict(-7, 1), q).keep === true
    && S.decideKeep({ id: "1", index: "två", confidence: 1 }, q).keep === true;
})());

check("keeps when confidence is missing entirely", (() => {
  return S.decideKeep({ id: "1", index: 2, reason: "r" }, q).keep === true;
})());

// ── the prompt must not leak the answer key ────────────────────────────────
for (const lang of ["sv", "en"]) {
  check(`${lang} prompt states the solver gets no answer key`, (() => {
    const p = S.buildSolverPrompt(lang, "generic");
    return /facit|answer key/i.test(p);
  })());
  check(`${lang} prompt defines both sentinel values`, (() => {
    const p = S.buildSolverPrompt(lang, "generic");
    return p.includes("-1") && p.includes("-2");
  })());
}

check("subject hints are added on top of the base prompt", (() => {
  const base = S.buildSolverPrompt("sv", "generic");
  return ["mathematics", "programming", "natural_sciences"].every(k => {
    const p = S.buildSolverPrompt("sv", k);
    return p.startsWith(base) && p.length > base.length;
  });
})());

// ── schema ─────────────────────────────────────────────────────────────────
check("schema allows the sentinels and pins the result count", (() => {
  const sc = S.buildSolverSchema(7).schema.properties.results;
  return sc.minItems === 7 && sc.maxItems === 7 && sc.items.properties.index.minimum === -2;
})());

check("schema requires a reason so a drop is explainable in the log", (() => {
  return S.buildSolverSchema(3).schema.properties.results.items.required.includes("reason");
})());

// ── model selection ────────────────────────────────────────────────────────
check("solver falls back to the generator model", (() => {
  delete process.env.OPENAI_SOLVER_MODEL;
  return S.solverModel("gpt-4o-mini") === "gpt-4o-mini";
})());

check("OPENAI_SOLVER_MODEL overrides it", (() => {
  process.env.OPENAI_SOLVER_MODEL = "gpt-5-mini";
  const got = S.solverModel("gpt-4o-mini");
  delete process.env.OPENAI_SOLVER_MODEL;
  return got === "gpt-5-mini";
})());

// ── short-answer questions are out of scope, not silently dropped ──────────
check("an exam of only short-answer questions is a no-op success", async () => true);
{
  const shortOnly = [{ id: "1", type: "short", options: [], correct_index: -1 }];
  const res = await S.solveQuestions(shortOnly, { apiKey: "unused", model: "gpt-4o-mini", lang: "sv" });
  check("short-answer-only exam returns callOk without calling the API", res.callOk === true && res.solved === 0);
}

// ── the real defects this was built for ────────────────────────────────────
// Both are taken verbatim from eval disagreements the verifier had approved.
check("catches the rectangle defect: perimeter 20 means x(10 - x), not x(20 - x)", (() => {
  const rect = { id: "r", type: "mc", correct_index: 0,
    options: ["x(20 - x) = 24", "x(10 - x) = 24", "x(24 - x) = 20"] };
  // Solver answers option 1; the key says 0.
  return S.decideKeep(verdict(1, 1), rect).keep === false;
})());

check("catches the parabola defect: f(5) = 0 for x² - 8x + 15, not 5", (() => {
  const par = { id: "p", type: "mc", correct_index: 2, options: ["-1", "0", "5"] };
  return S.decideKeep({ id: "p", index: 1, confidence: 1, reason: "25-40+15=0" }, par).keep === false;
})());

// ── per-option audit: the change that targets ambiguity ────────────────────
// The previous prompt asked for an index first and the solver never once
// reported an ambiguous question across 143 items, while the gpt-5 judge found
// four. It was picking an option and moving on. The schema now forces a
// true/false verdict on every option BEFORE the index, and the ambiguity
// verdict is computed here from those judgements rather than trusted to the
// model's own conclusion.
check("drops when the solver marks two options correct", (() => {
  const d = S.decideKeep(withVerdicts([true, true, false], 0), q);
  return d.keep === false && d.reason === "solver_multiple_correct_options";
})());

check("drops when the solver marks two correct even if it then names the key", (() => {
  // The model picked index 1, which matches the key — but it also said option 0
  // is correct. Trusting the index alone would have kept this question.
  const d = S.decideKeep(withVerdicts([true, true, false], 1), q);
  return d.keep === false && d.reason === "solver_multiple_correct_options";
})());

// Index 0 rather than -1 here on purpose: an explicit -1 is handled by the
// sentinel branch above and reports solver_no_single_answer. This case is the
// other route to the same conclusion — the model named an option but its own
// audit says none of them is right.
check("drops when the solver marks no option correct", (() => {
  const d = S.decideKeep(withVerdicts([false, false, false], 0), q);
  return d.keep === false && d.reason === "solver_no_correct_option";
})());

check("an explicit -1 still reports the sentinel reason, not the audit reason", (() => {
  const d = S.decideKeep(withVerdicts([false, false, false], S.NO_SINGLE_ANSWER), q);
  return d.keep === false && d.reason === "solver_no_single_answer";
})());

check("keeps when exactly one option is correct and it is the key", (() => {
  const d = S.decideKeep(withVerdicts([false, true, false], 1), q);
  return d.keep === true && d.reason === "solver_agrees";
})());

check("the single true verdict overrides a contradictory index", (() => {
  // Verdicts say option 1 (the key) is the only correct one, but the model
  // wrote index 2. The audit is the better signal, so the question survives.
  const d = S.decideKeep(withVerdicts([false, true, false], 2), q);
  return d.keep === true && d.reason === "solver_agrees";
})());

check("drops when the only true verdict is not the key, regardless of confidence", (() => {
  const d = S.decideKeep(withVerdicts([true, false, false], 0, 0.2), q);
  return d.keep === false && d.reason === "solver_disagrees_on_key";
})());

// A malformed verdict list must never delete questions — it falls back to the
// index comparison, which has its own confidence guard.
check("ignores a verdict list of the wrong length", (() => {
  const d = S.decideKeep(withVerdicts([true, true], 1), q);
  return d.keep === true && d.reason === "solver_agrees";
})());

check("ignores a verdict list that is not an array", (() => {
  const d = S.decideKeep({ id: "1", option_verdicts: "true,false", index: 1, confidence: 1 }, q);
  return d.keep === true;
})());

check("ignores verdicts when the question has no options", (() => {
  const noOpts = { id: "1", type: "mc", options: [], correct_index: -1 };
  return S.decideKeep(withVerdicts([true, true], -1), noOpts).keep === false;
})());

check("schema puts option_verdicts before index so the audit happens first", (() => {
  const req = S.buildSolverSchema(3).schema.properties.results.items.required;
  return req.indexOf("option_verdicts") < req.indexOf("index");
})());

check("schema requires option_verdicts", (() => {
  const it = S.buildSolverSchema(3).schema.properties.results.items;
  return it.required.includes("option_verdicts") && it.properties.option_verdicts.type === "array";
})());

for (const lang of ["sv", "en"]) {
  check(`${lang} prompt forbids distorting a verdict to reach exactly one true`, (() => {
    const p = S.buildSolverPrompt(lang, "generic");
    return /Ljug inte|Do not distort/.test(p);
  })());
}

// ── the real ambiguity defects this targets ────────────────────────────────
check("catches 'p gives both the root sum and the axis of symmetry'", (() => {
  const amb = { id: "a", type: "mc", correct_index: 0,
    options: ["Summan av rötterna", "Symmetrilinjen", "Produkten av rötterna"] };
  return S.decideKeep(withVerdicts([true, true, false], 0), amb).keep === false;
})());

check("catches 'which is a commercial risk' with two valid risks", (() => {
  const amb = { id: "b", type: "mc", correct_index: 1,
    options: ["Maskinhaveri", "Instabil efterfrågan", "Stark konkurrens"] };
  return S.decideKeep(withVerdicts([false, true, true], 1), amb).keep === false;
})());

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll solver checks passed.");
