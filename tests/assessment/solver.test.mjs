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
const verdict = (index, confidence = 1) => ({ id: "1", index, confidence, reason: "r" });

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

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll solver checks passed.");
