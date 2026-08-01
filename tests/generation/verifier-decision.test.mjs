// Pure unit tests for the verifier's deterministic approval logic (api/_verifier.js).
// No network — decideApproval() never calls OpenAI, it only judges structured scores
// the caller already has. Same pattern as tests/generation/legal-generation.test.mjs.
//   node tests/generation/verifier-decision.test.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const V = require(join(here, "..", "..", "api", "_verifier.js"));

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, err) => { failures++; console.error(`  FAIL  ${name}\n        ${err?.message || err}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { fail(name, e); } }

const good = {
  id: "1", approved: true, factual_accuracy: 0.95, ambiguity_score: 0.05,
  difficulty_match: 0.9, source_alignment: 0.9, scoring_quality: 0.9, language_quality: 0.95,
  issues: [], required_changes: [],
};

check("approves a high-confidence, low-ambiguity result", () => {
  assert.equal(V.decideApproval(good), true);
});

check("rejects when the model itself says approved=false, regardless of scores", () => {
  assert.equal(V.decideApproval({ ...good, approved: false }), false);
});

check("rejects when factual_accuracy is below threshold", () => {
  assert.equal(V.decideApproval({ ...good, factual_accuracy: 0.5 }), false);
});

check("rejects when ambiguity_score is above threshold", () => {
  assert.equal(V.decideApproval({ ...good, ambiguity_score: 0.6 }), false);
});

// Pins the tightened ambiguity ceiling. On the long-form eval fixtures, 9 of 12
// defective questions were "more than one option is correct" — the dominant
// defect, and exactly what this dimension measures. The old ceiling of 0.35 let
// them through. Loosening it again should be a deliberate decision with numbers
// behind it, not an accident, so both sides of the boundary are asserted.
check("ambiguity ceiling is 0.20: exactly at the limit still approves", () => {
  assert.equal(V.DEFAULT_THRESHOLDS.maxAmbiguity, 0.20);
  assert.equal(V.decideApproval({ ...good, ambiguity_score: 0.20 }), true);
});

check("ambiguity ceiling is 0.20: just above it rejects", () => {
  assert.equal(V.decideApproval({ ...good, ambiguity_score: 0.25 }), false);
});

check("a caller can still override the ambiguity ceiling explicitly", () => {
  assert.equal(V.decideApproval({ ...good, ambiguity_score: 0.30 }, { maxAmbiguity: 0.35 }), true);
});

check("rejects when source_alignment is below threshold", () => {
  assert.equal(V.decideApproval({ ...good, source_alignment: 0.3 }), false);
});

check("rejects when there are any required_changes, even with good scores", () => {
  assert.equal(V.decideApproval({ ...good, required_changes: ["förtydliga alternativ B"] }), false);
});

check("custom thresholds are respected", () => {
  assert.equal(V.decideApproval({ ...good, factual_accuracy: 0.72 }, { minFactualAccuracy: 0.7 }), true);
  assert.equal(V.decideApproval({ ...good, factual_accuracy: 0.72 }, { minFactualAccuracy: 0.8 }), false);
});

console.log(`\n${failures === 0 ? "Alla" : failures + " av"} kontroller klara.`);
if (failures > 0) process.exit(1);
