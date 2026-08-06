// Tests for the async step-claim state machine (src/generation/job-steps.mjs).
//
// Usage:  node tests/generation/job-steps.test.mjs   (exit 0 = pass)
//
// The pure state machine is tested here; the atomicity itself lives in SQL (FOR UPDATE SKIP
// LOCKED, WHERE lease_owner = ...) and is not reproducible without a database. What IS testable
// offline is the property that makes the crash-recovery story work: a status must map to the step
// to RUN, never to the step already done — otherwise a worker that dies mid-step would resume one
// step too late and silently ship an unverified exam.

import { createRequire } from "node:module";
import {
  stepFor, nextStatus, isTerminal, exhaustedAttempts, newWorkerId,
  claimJob, completeStep, failStep,
  SCHOOL_JOB_TYPE, LEASE_SECONDS, MAX_STEP_ATTEMPTS, TERMINAL_STATUSES,
} from "../../src/generation/job-steps.mjs";

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

// ── the step map ───────────────────────────────────────────────────────────
check("queued runs the generator", stepFor("queued") === "generate");
check("generating is a synonym for queued, not a later step", stepFor("generating") === "generate");
check("each pipeline status maps to its own step", (() => {
  return stepFor("validating") === "validate"
    && stepFor("verifying") === "verify"
    && stepFor("repairing") === "repair"
    && stepFor("assembling") === "assemble";
})());

check("terminal statuses have no step to run", TERMINAL_STATUSES.every(s => stepFor(s) === null));
check("an unknown status yields no step rather than guessing", stepFor("wat") === null && stepFor(undefined) === null);

// ── the happy path, walked end to end ──────────────────────────────────────
check("the full sequence reaches completed in five steps", (() => {
  const seen = [];
  let s = "queued";
  for (let i = 0; i < 10 && !isTerminal(s); i++) {
    seen.push(s);
    s = nextStatus(s, { rejectedCount: 1, deliveredCount: 8, requestedCount: 8 });
  }
  return s === "completed"
    && seen.join(",") === "queued,validating,verifying,repairing,assembling";
})());

check("the sequence terminates — no status cycles back on itself", (() => {
  let s = "queued";
  const seen = new Set();
  while (!isTerminal(s) && s !== null) {
    if (seen.has(s)) return false;
    seen.add(s);
    s = nextStatus(s, { deliveredCount: 5, requestedCount: 5 });
  }
  return isTerminal(s);
})());

// ── repair is skipped when nothing was rejected ────────────────────────────
// A clean exam must not pay for a sixth function invocation just to find nothing to do.
check("verifying goes straight to assembling when nothing was rejected", (() => {
  return nextStatus("verifying", { rejectedCount: 0 }) === "assembling";
})());

check("verifying goes to repairing when something was rejected", (() => {
  return nextStatus("verifying", { rejectedCount: 1 }) === "repairing";
})());

check("a missing rejectedCount counts as zero, not as a reason to repair", (() => {
  return nextStatus("verifying") === "assembling" && nextStatus("verifying", {}) === "assembling";
})());

// ── the outcome is decided on delivered questions ──────────────────────────
// Zero delivered questions is the failure that previously reached the student as a 502 when the
// maths overlay deleted every word-option question. It must be a failed job, not an empty exam.
check("zero delivered questions fails the job", (() => {
  return nextStatus("assembling", { deliveredCount: 0, requestedCount: 10 }) === "failed";
})());

check("fewer than requested is partially_completed", (() => {
  return nextStatus("assembling", { deliveredCount: 7, requestedCount: 10 }) === "partially_completed";
})());

check("all requested delivered is completed", (() => {
  return nextStatus("assembling", { deliveredCount: 10, requestedCount: 10 }) === "completed";
})());

check("more delivered than requested still completes", (() => {
  return nextStatus("assembling", { deliveredCount: 11, requestedCount: 10 }) === "completed";
})());

check("an unknown requested count does not downgrade a delivered exam", (() => {
  return nextStatus("assembling", { deliveredCount: 4 }) === "completed";
})());

check("a terminal status has no successor", (() => {
  return TERMINAL_STATUSES.every(s => nextStatus(s, { deliveredCount: 1 }) === null);
})());

// ── attempt budget ─────────────────────────────────────────────────────────
check("a fresh job has attempts left", exhaustedAttempts({ step_attempts: 0 }) === false);
check(`attempts are exhausted at ${MAX_STEP_ATTEMPTS}`, (() => {
  return exhaustedAttempts({ step_attempts: MAX_STEP_ATTEMPTS - 1 }) === false
    && exhaustedAttempts({ step_attempts: MAX_STEP_ATTEMPTS }) === true;
})());
check("a missing or malformed counter is treated as zero, never as exhausted", (() => {
  return exhaustedAttempts({}) === false
    && exhaustedAttempts(null) === false
    && exhaustedAttempts({ step_attempts: null }) === false;
})());

// ── worker identity ────────────────────────────────────────────────────────
// Two workers must never share an id: lease_owner is the only thing standing between a resumed
// worker and it overwriting a newer worker's finished step.
check("worker ids are unique across a tight loop", (() => {
  const ids = new Set(Array.from({ length: 500 }, newWorkerId));
  return ids.size === 500;
})());

// ── the lease must outlive the longest step ────────────────────────────────
// Generation measures ~40 s on long material inside a 60 s function cap. A lease shorter than the
// function budget would let a second worker claim a job that is still actively running.
check("the lease is longer than the 60 s function budget", LEASE_SECONDS > 60);

// ── RPC wrappers pass the parameters the SQL functions declare ─────────────
const fakeSupabase = (result) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, params) => { calls.push({ name, params }); return result; },
  };
};

{
  const sb = fakeSupabase({ data: { id: "j1" }, error: null });
  const job = await claimJob(sb, { workerId: "w1" });
  const { name, params } = sb.calls[0];
  check("claimJob calls claim_generation_job with the school job type by default", (() => {
    return name === "claim_generation_job"
      && params.p_job_type === SCHOOL_JOB_TYPE
      && params.p_worker === "w1"
      && params.p_lease_seconds === LEASE_SECONDS
      && job.id === "j1";
  })());
}

{
  const sb = fakeSupabase({ data: null, error: null });
  check("an empty queue returns null rather than throwing", (await claimJob(sb, { workerId: "w1" })) === null);
}

{
  const sb = fakeSupabase({ data: null, error: { message: "boom" } });
  let threw = false;
  try { await claimJob(sb, { workerId: "w1" }); } catch { threw = true; }
  check("a transport error surfaces instead of looking like an empty queue", threw);
}

{
  const sb = fakeSupabase({ data: true, error: null });
  const ok = await completeStep(sb, { jobId: "j1", workerId: "w1", status: "verifying", result: { a: 1 } });
  const p = sb.calls[0].params;
  check("completeStep passes the job, worker and next status", (() => {
    return sb.calls[0].name === "complete_generation_step"
      && p.p_job_id === "j1" && p.p_worker === "w1" && p.p_next_status === "verifying"
      && p.p_result.a === 1 && ok === true;
  })());
}

{
  // The SQL returns false when lease_owner no longer matches. The caller must be able to see that
  // and discard its result — a silently-true wrapper would defeat the whole lease.
  const sb = fakeSupabase({ data: false, error: null });
  const ok = await completeStep(sb, { jobId: "j1", workerId: "stale", status: "verifying" });
  check("completeStep reports false when the lease was lost", ok === false);
}

{
  const sb = fakeSupabase({ data: true, error: null });
  await failStep(sb, { jobId: "j1", workerId: "w1", errorCode: "openai_timeout", message: "Tidsgräns nådd" });
  const p = sb.calls[0].params;
  check("failStep defaults to a retry rather than killing the job", (() => {
    return sb.calls[0].name === "fail_generation_step" && p.p_terminal === false
      && p.p_error_code === "openai_timeout";
  })());
}

{
  const sb = fakeSupabase({ data: true, error: null });
  await failStep(sb, { jobId: "j1", workerId: "w1", errorCode: "x", message: "y", terminal: true });
  check("failStep can be told to give up", sb.calls[0].params.p_terminal === true);
}

// ── the migration must actually declare what the wrappers call ─────────────
// Cheap guard against the wrapper and the SQL drifting apart: every RPC name and parameter used
// above has to appear in the migration.
{
  const require = createRequire(import.meta.url);
  const { readFileSync } = require("node:fs");
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260807_async_school_generation.sql", import.meta.url),
    "utf8"
  );
  const names = ["claim_generation_job", "complete_generation_step", "fail_generation_step"];
  check("the migration declares every function the wrappers call",
    names.every(n => sql.includes(`function public.${n}(`)));

  const params = ["p_job_type", "p_worker", "p_lease_seconds", "p_job_id", "p_next_status",
                  "p_next_step", "p_progress_current", "p_result", "p_error_code", "p_message", "p_terminal"];
  check("the migration declares every parameter the wrappers send",
    params.every(p => sql.includes(p)));

  check("the migration allows the school job type",
    sql.includes("'school_exam_generation'"));

  // The three job types already live in production (two of them from an unmerged branch). A
  // migration that rewrites the constraint from the old migration file instead of from the
  // database would silently drop them.
  check("the job_type constraint keeps the values already in production", (() => {
    return sql.includes("'legal_exam_generation'") && sql.includes("'per_assessment'") && sql.includes("'per_coach'");
  })());

  check("the security definer functions are revoked from authenticated clients",
    names.every(n => new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon, authenticated`).test(sql)));

  check("every status the step map knows is claimable in SQL", (() => {
    const claimable = sql.match(/status in \('queued'[^)]*\)/);
    if (!claimable) return false;
    return ["queued", "generating", "validating", "verifying", "repairing", "assembling"]
      .every(s => claimable[0].includes(`'${s}'`));
  })());
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll job-step checks passed.");
