// Strukturvalidering av tests/evals/per-v1/gold-set.v1.json. Inget nätverk, inga modellanrop —
// kontrollerar att datasetet håller ihop innan någon lägger pengar på att köra det.
// Kontrollerar också att datasetet faktiskt innehåller de NEGATIVA fall uppdraget kräver; ett
// eval-set med bara lyckade fall mäter ingenting.
//   node tests/evals/per-v1/validate-gold-set.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(readFileSync(join(here, "gold-set.v1.json"), "utf8"));

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, err) => { failures++; console.error(`  FAIL  ${name}\n        ${err?.message || err}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { fail(name, e); } }

const VERDICTS = new Set(["correct", "partial", "wrong", "unassessable"]);
const ERROR_CODES = new Set([
  "MISSING_CORE_CONCEPT", "CONFUSES_TWO_CONCEPTS", "CORRECT_RULE_WRONG_APPLICATION",
  "UNSUPPORTED_CONCLUSION", "INCOMPLETE_REASONING", "MISREADS_FACT_PATTERN",
  "USES_OUTDATED_RULE", "LANGUAGE_CLARITY", "OTHER_REVIEW_REQUIRED",
]);

check("datasetet har minst 15 fall (uppdragets golv)", () => {
  assert.ok(gold.cases.length >= 15, `hittade ${gold.cases.length}`);
});

check("alla case_id är unika", () => {
  const ids = gold.cases.map((c) => c.case_id);
  assert.equal(new Set(ids).size, ids.length);
});

check("varje fall har fråga, elevsvar och förväntan", () => {
  for (const c of gold.cases) {
    assert.ok(c.question, `${c.case_id}: question saknas`);
    assert.ok(c.student_answer !== undefined, `${c.case_id}: student_answer saknas`);
    assert.ok(c.expected, `${c.case_id}: expected saknas`);
    assert.ok(VERDICTS.has(c.expected.verdict), `${c.case_id}: ogiltig verdict ${c.expected.verdict}`);
  }
});

check("alla refererade chunk-nycklar finns i chunks-tabellen", () => {
  for (const c of gold.cases) {
    for (const key of c.source_chunks ?? []) {
      assert.ok(gold.chunks[key], `${c.case_id}: okänd chunk-nyckel ${key}`);
    }
  }
});

check("alla chunks har chunk_id, section_ref och innehåll", () => {
  for (const [key, chunk] of Object.entries(gold.chunks)) {
    assert.ok(/^[0-9a-f-]{36}$/.test(chunk.chunk_id), `${key}: chunk_id ser inte ut som ett uuid`);
    assert.ok(chunk.section_ref, `${key}: section_ref saknas`);
    assert.ok(chunk.content && chunk.content.length > 40, `${key}: innehållet är för kort för att vara ett källutdrag`);
  }
});

check("alla förväntade felkoder finns i den fasta enumen", () => {
  for (const c of gold.cases) {
    for (const code of c.expected.error_code_any_of ?? []) {
      if (code === null) continue;
      assert.ok(ERROR_CODES.has(code), `${c.case_id}: okänd felkod ${code}`);
    }
  }
});

check("flervalsfall har alternativ och ett facit bland dem", () => {
  for (const c of gold.cases.filter((x) => x.question_type === "multiple_choice")) {
    assert.ok(Array.isArray(c.options) && c.options.length >= 2, `${c.case_id}: options saknas`);
    const ids = new Set(c.options.map((o) => o.id));
    for (const ref of c.reference_answer) assert.ok(ids.has(ref), `${c.case_id}: facit ${ref} finns inte bland alternativen`);
  }
});

check("fritextfall har ett referenssvar i text", () => {
  for (const c of gold.cases.filter((x) => x.question_type === "short_answer")) {
    assert.equal(typeof c.reference_answer, "string", `${c.case_id}: reference_answer ska vara text`);
  }
});

// Uppdragets §9: negativa fall är inte valfria.
const requiredCategories = [
  "prompt_injection_in_answer",
  "prompt_injection_swedish",
  "empty_retrieval",
  "contradictory_sources",
  "unusual_phrasing_correct",
  "confident_wrong",
  "language_errors_correct_content",
  "outdated_rule",
  "concept_confusion",
];
check("alla obligatoriska negativa/svåra kategorier finns representerade", () => {
  const present = new Set(gold.cases.map((c) => c.category));
  for (const cat of requiredCategories) {
    assert.ok(present.has(cat), `saknar kategori: ${cat}`);
  }
});

check("minst ett fall ska vara omöjligt att bedöma (abstain-vägen mäts)", () => {
  assert.ok(gold.cases.some((c) => c.expected.verdict === "unassessable"));
});

check("minst ett fall där källor saknas helt", () => {
  assert.ok(gold.cases.some((c) => (c.source_chunks ?? []).length === 0));
});

check("utfallen är spridda — inte bara 'correct'", () => {
  const counts = {};
  for (const c of gold.cases) counts[c.expected.verdict] = (counts[c.expected.verdict] ?? 0) + 1;
  for (const v of ["correct", "partial", "wrong"]) {
    assert.ok((counts[v] ?? 0) >= 2, `för få fall med verdict=${v}: ${counts[v] ?? 0}`);
  }
});

console.log(`\n${gold.cases.length} fall. ${failures === 0 ? "Alla" : failures + " av"} kontroller klara.`);
if (failures > 0) process.exit(1);
