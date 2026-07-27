// Tester för evidenskedjan i src/per/learner-model.mjs: försök → felhändelse → mastery.
// Ingen databas — en liten stubbad Supabase-klient räcker, eftersom det som testas är
// SEKVENSEN och dess skyddsregler (idempotens, otillräckligt underlag), inte SQL:en.
//   node tests/per/learner-model.test.mjs

import assert from "node:assert/strict";
import { commitAssessment } from "../../src/per/learner-model.mjs";

let failures = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const fail = (name, err) => { failures++; console.error(`  FAIL  ${name}\n        ${err?.message || err}`); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e); } }

/**
 * Minimal stub som härmar PostgREST-kedjan så långt learner-model.mjs använder den.
 * `inserts` och `rpcCalls` samlar allt som skrevs, så testerna kan påstå något om det.
 */
function stubSupabase({ insertResults = {}, selectResults = {}, rpcResult = { mastery_score: 42, confidence: 0.3, attempts: 1 } } = {}) {
  const calls = { inserts: [], updates: [], rpc: [], selects: [] };
  const builder = (table) => {
    const state = { table, row: null };
    const api = {
      insert(row) { state.row = row; calls.inserts.push({ table, row }); return api; },
      update(patch) { calls.updates.push({ table, patch }); return api; },
      select() { return api; },
      // .eq() avslutar update-kedjan (ingen .single() följer där), så den måste vara thenable.
      eq() { return api; },
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      maybeSingle() { return api.single(); },
      single() {
        const configured = insertResults[table];
        // Bara insert-vägen får det konfigurerade svaret. En ren SELECT (state.row === null),
        // t.ex. återläsningen efter en unique-konflikt, styrs av selectResults.
        if (state.row !== null && typeof configured === "function") return Promise.resolve(configured(state.row));
        if (state.row === null && typeof selectResults[table] === "function") {
          return Promise.resolve(selectResults[table]());
        }
        return Promise.resolve({ data: { id: `${table}-id`, ...(state.row ?? {}) }, error: null });
      },
    };
    return api;
  };
  return {
    calls,
    from: (table) => { calls.selects.push(table); return builder(table); },
    rpc: (name, args) => { calls.rpc.push({ name, args }); return Promise.resolve({ data: rpcResult, error: null }); },
  };
}

const baseArgs = {
  userId: "user-1",
  questionId: "question-1",
  conceptId: "concept-1",
  questionType: "short_answer",
  level: "C",
  studentAnswer: "Ett anbud blir bindande när accepten kommer fram i rätt tid.",
  idempotencyKey: "attempt-key-1",
};

const wrongAssessment = {
  method: "llm_reasoning", score: 0.3, is_correct: false, confidence: 0.8, grounded: true,
  dimensions: { factual_accuracy: 0.3, reasoning: 0.4, concept_usage: 0.5, method: 1, language: 1 },
  error_code: "INCOMPLETE_REASONING", error_severity: "medium", misconception: "Missar acceptfristen",
  strengths: [], missing_points: [], feedback_student: "…", next_step_hint: "…",
  cited_chunk_ids: ["chunk-1"], redacted_input: false, disagreement: false, latency_ms: 1200, models_used: ["gpt-4o-mini"],
};

await check("normalfall: försök, felhändelse och mastery skrivs i rätt ordning", async () => {
  const supabase = stubSupabase();
  const result = await commitAssessment(supabase, { ...baseArgs, assessment: wrongAssessment });

  assert.equal(result.created, true);
  const tables = supabase.calls.inserts.map((i) => i.table);
  assert.deepEqual(tables, ["student_attempts", "student_error_events"]);
  assert.equal(supabase.calls.rpc.length, 1);
  assert.equal(supabase.calls.rpc[0].name, "apply_legal_mastery");
  assert.equal(supabase.calls.rpc[0].args.p_score, 0.3);
  assert.equal(supabase.calls.rpc[0].args.p_confidence, 0.8);
  // C-nivå ska mappas till sin svårighetsgrad, inte skickas som bokstav
  assert.equal(typeof supabase.calls.rpc[0].args.p_difficulty, "number");
  // Försöks-id måste följa med: det är RPC:n som äger exakt-en-gång-garantin, inte JS-koden.
  assert.ok(supabase.calls.rpc[0].args.p_attempt_id, "p_attempt_id ska skickas till apply_legal_mastery");
});

await check("rätt svar ger ingen felhändelse men uppdaterar ändå mastery", async () => {
  const supabase = stubSupabase();
  await commitAssessment(supabase, {
    ...baseArgs,
    assessment: { ...wrongAssessment, is_correct: true, score: 1, error_code: null, error_severity: null },
  });
  assert.deepEqual(supabase.calls.inserts.map((i) => i.table), ["student_attempts"]);
  assert.equal(supabase.calls.rpc.length, 1);
});

// 23505 = unique_violation på (user_id, idempotency_key) — samma submit igen.
const duplicateInsert = { student_attempts: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) };

await check("IDEMPOTENS: färdigbokfört svar uppdaterar inte mastery en andra gång", async () => {
  const supabase = stubSupabase({
    insertResults: duplicateInsert,
    // Den befintliga raden har en KOMPLETT evidenskedja.
    selectResults: { student_attempts: () => ({ data: { id: "attempt-1", mastery_applied: true }, error: null }) },
  });
  const result = await commitAssessment(supabase, { ...baseArgs, assessment: wrongAssessment });

  assert.equal(result.created, false);
  assert.equal(result.skippedReason, "duplicate_submission");
  assert.equal(supabase.calls.rpc.length, 0, "mastery får inte uppdateras för ett redan bokfört svar");
});

await check("ÅTERUPPTAGNING: halvskriven evidenskedja slutförs vid retry i stället för att hoppas över", async () => {
  const supabase = stubSupabase({
    insertResults: duplicateInsert,
    // Försöket finns, men mastery hann aldrig appliceras (t.ex. krasch mellan stegen).
    selectResults: { student_attempts: () => ({ data: { id: "attempt-1", mastery_applied: false }, error: null }) },
  });
  const result = await commitAssessment(supabase, { ...baseArgs, assessment: wrongAssessment });

  assert.equal(result.created, false);
  assert.equal(result.skippedReason, "resumed_incomplete_commit");
  assert.equal(supabase.calls.rpc.length, 1, "mastery ska appliceras när kedjan var ofullständig");
  assert.equal(supabase.calls.rpc[0].args.p_attempt_id, "attempt-1", "RPC:n markerar kedjan som klar i samma transaktion");
  assert.equal(supabase.calls.updates.length, 0, "ingen separat flagguppdatering — den sker inuti RPC:n");
});

await check("OTILLRÄCKLIGT UNDERLAG: försöket sparas men elevmodellen lämnas orörd", async () => {
  const supabase = stubSupabase();
  const result = await commitAssessment(supabase, {
    ...baseArgs,
    assessment: { ...wrongAssessment, method: "insufficient_evidence", grounded: false },
  });
  assert.equal(result.created, true);
  assert.equal(result.skippedReason, "insufficient_evidence");
  assert.equal(supabase.calls.rpc.length, 0, "en bedömning som inte kunde göras är inte evidens");
  assert.ok(supabase.calls.updates.some((u) => u.patch.mastery_applied === true), "kedjan ska ändå avslutas");
  assert.deepEqual(supabase.calls.inserts.map((i) => i.table), ["student_attempts"]);
});

await check("elevsvar trunkeras hårt före insert (andra linjen mot DB-constrainten)", async () => {
  const supabase = stubSupabase();
  await commitAssessment(supabase, { ...baseArgs, studentAnswer: "x".repeat(9000), assessment: wrongAssessment });
  assert.equal(supabase.calls.inserts[0].row.student_answer.length, 4000);
});

await check("bedömningens detaljer sparas som strukturerad evidens, inte fritext", async () => {
  const supabase = stubSupabase();
  await commitAssessment(supabase, { ...baseArgs, assessment: wrongAssessment });
  const stored = supabase.calls.inserts[0].row.assessment;
  assert.equal(stored.error_code, "INCOMPLETE_REASONING");
  assert.ok(stored.dimensions.reasoning !== undefined);
  assert.equal(stored.grounded, true);
});

console.log(`\n${failures === 0 ? "Alla" : failures + " av"} kontroller klara.`);
if (failures > 0) process.exit(1);
