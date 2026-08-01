// Tests for salvageExamJson() and the request time budget in
// api/generate-exam.js.
//
// Usage:  node tests/assessment/exam-salvage.test.mjs   (exit 0 = pass)
//
// Context: vercel.json pins generate-exam to maxDuration 60, which is also the
// Hobby plan ceiling. Measured generation times for a 12-question exam were
// 25-82 s, so a slow generation used to be killed by the platform and the
// student got nothing. Generation is now streamed and cut at a deadline, and
// this is the parser that turns the partial stream into the largest valid exam
// it contains. If it is wrong, students get corrupt exams — so both the happy
// path and every ragged-tail shape are pinned here.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const G = require(join(root, "api", "generate-exam.js"));

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const q = (id, extra = {}) => ({
  id, type: "mc", points: 1, question: `Fråga ${id}?`,
  options: ["a", "b", "c"], correct_index: 0,
  rubric: "r", model_answer: "m", topic: "t", subtopic: "s",
  learning_objective: "lo", source_references: ["ref"],
  cognitive_level: "minnas", accepted_answers: [], estimated_answer_length: "one_word",
  scoring_rubric: { parts: [], full_score_requirements: "", partial_credit_notes: "" },
  ...extra,
});
const examOf = (n) => ({ title: "Prov", level: "C", questions: Array.from({ length: n }, (_, i) => q(String(i + 1))) });

// ── complete responses are passed through untouched ────────────────────────
check("a complete exam parses and is not marked truncated", (() => {
  const r = G.salvageExamJson(JSON.stringify(examOf(12)));
  return r.truncated === false && r.exam.questions.length === 12;
})());

check("a complete exam is byte-equal to the input after round-trip", (() => {
  const src = examOf(3);
  const r = G.salvageExamJson(JSON.stringify(src));
  return JSON.stringify(r.exam) === JSON.stringify(src);
})());

// ── truncation at every plausible point ────────────────────────────────────
const full = JSON.stringify(examOf(6));

check("cut mid-way through a question keeps the questions before it", (() => {
  const at = full.indexOf('"id":"4"');
  const r = G.salvageExamJson(full.slice(0, at));
  return r.truncated === true && r.exam.questions.length === 3;
})());

check("cut immediately after a closing brace keeps that question", (() => {
  const at = full.indexOf('"id":"3"');
  const close = full.indexOf("},", at);
  const r = G.salvageExamJson(full.slice(0, close + 1));
  return r.truncated === true && r.exam.questions.length === 3;
})());

check("cut before any question completes yields nothing usable", (() => {
  const at = full.indexOf('"questions":[') + 14;
  const r = G.salvageExamJson(full.slice(0, at));
  return r.exam === null && r.truncated === true;
})());

check("cut in the middle of the very first question yields nothing usable", (() => {
  const at = full.indexOf('"rubric"');
  const r = G.salvageExamJson(full.slice(0, at));
  return r.exam === null;
})());

check("every truncation point either parses or returns null — never throws", (() => {
  for (let i = 0; i < full.length; i++) {
    let r;
    try { r = G.salvageExamJson(full.slice(0, i)); }
    catch { return false; }
    if (r.exam !== null && !Array.isArray(r.exam.questions)) return false;
  }
  return true;
})());

check("salvaged question count never exceeds the complete count", (() => {
  for (let i = 0; i < full.length; i++) {
    const r = G.salvageExamJson(full.slice(0, i));
    if (r.exam && r.exam.questions.length > 6) return false;
  }
  return true;
})());

check("salvaged questions are always a prefix of the originals", (() => {
  const src = examOf(6);
  for (let i = 0; i < full.length; i++) {
    const r = G.salvageExamJson(full.slice(0, i));
    if (!r.exam) continue;
    for (let k = 0; k < r.exam.questions.length; k++) {
      if (JSON.stringify(r.exam.questions[k]) !== JSON.stringify(src.questions[k])) return false;
    }
  }
  return true;
})());

// ── braces inside strings must not be read as structure ────────────────────
check("a brace inside question text does not fool the scanner", (() => {
  const exam = { title: "P", level: "C", questions: [
    q("1", { question: "Vad gör `if (x) { return }` i koden?" }),
    q("2", { question: "Nästa fråga } med obalans {" }),
  ] };
  const s = JSON.stringify(exam);
  const at = s.indexOf('"id":"2"');
  const r = G.salvageExamJson(s.slice(0, at));
  return r.truncated === true && r.exam.questions.length === 1
    && r.exam.questions[0].question === "Vad gör `if (x) { return }` i koden?";
})());

check("an escaped quote inside text does not break string tracking", (() => {
  const exam = { title: "P", level: "C", questions: [
    q("1", { question: 'Vad betyder \\"deadline\\" här? {' }),
    q("2"),
  ] };
  const s = JSON.stringify(exam);
  const r = G.salvageExamJson(s.slice(0, s.indexOf('"id":"2"')));
  return r.exam && r.exam.questions.length === 1;
})());

check("a bracket inside an option string is not read as structure", (() => {
  const exam = { title: "P", level: "C", questions: [
    q("1", { options: ["tal[0]", "tal[1]", "tal[-1]"] }),
    q("2"),
  ] };
  const s = JSON.stringify(exam);
  const r = G.salvageExamJson(s.slice(0, s.indexOf('"id":"2"')));
  return r.exam && r.exam.questions.length === 1 && r.exam.questions[0].options.length === 3;
})());

// ── junk in, no crash out ──────────────────────────────────────────────────
for (const [name, input] of [
  ["empty string", ""],
  ["null", null],
  ["undefined", undefined],
  ["not JSON at all", "hello world"],
  ["an unterminated string", '{"title":"P","questions":[{"id":"1'],
  ["an object with no questions key", '{"title":"P","level":"C"}'],
  ["an empty questions array", '{"title":"P","level":"C","questions":[]}'],
]) {
  check(`survives ${name}`, (() => {
    try {
      const r = G.salvageExamJson(input);
      return r && (r.exam === null || typeof r.exam === "object");
    } catch { return false; }
  })());
}

// A well-formed but empty exam parses cleanly, so it is returned as-is and not
// flagged truncated — emptiness is the handler's call, and it answers 500
// "Schema mismatch" for a complete response or 504 for a salvaged one. Only a
// SALVAGED empty result is null, because there nothing usable actually arrived.
check("a complete but empty exam parses and is left to the handler to reject", (() => {
  const r = G.salvageExamJson('{"title":"P","level":"C","questions":[]}');
  return r.truncated === false && r.exam !== null && r.exam.questions.length === 0;
})());

check("a salvaged exam with no complete question is null, not an empty exam", (() => {
  const r = G.salvageExamJson('{"title":"P","level":"C","questions":[{"id":"1","ty');
  return r.exam === null && r.truncated === true;
})());

// ── the time budget ────────────────────────────────────────────────────────
check("budget leaves headroom below the 60 s function limit", (() => {
  const b = G.makeBudget(Date.now());
  const remaining = b.remaining();
  return remaining > 50_000 && remaining < 60_000;
})());

check("remaining shrinks as time passes and can go negative", (() => {
  const b = G.makeBudget(Date.now() - 70_000);
  return b.remaining() < 0 && b.elapsed() >= 70_000;
})());

check("elapsed is measured from the start, not from now", (() => {
  const b = G.makeBudget(Date.now() - 5_000);
  return b.elapsed() >= 5_000 && b.elapsed() < 6_000;
})());

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll salvage and budget checks passed.");
