// Tests for the Stripe webhook idempotency claim (api/stripe-webhook.js).
//
// Usage:  node tests/payments/stripe-webhook-idempotency.test.mjs   (exit 0 = pass)
//
// This guards money. Two failures are possible and they pull in opposite directions:
//
//   claim too eagerly  — a redelivery is processed again, the customer gets a second
//                        confirmation email and the admin a second notice
//   claim too greedily — an invocation that died without throwing leaves a claim nobody
//                        releases, every later redelivery is waved through with 200, and
//                        a paying customer is never upgraded and never retried
//
// The second is worse because it is silent, so the stale-reclaim path below is the point
// of these tests rather than an edge case.

// The module builds its own Supabase client at import time and supabase-js refuses a
// blank URL, so placeholders go in first. Every test below passes its own client in
// explicitly — this one is never called.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";

const { claimEvent, completeEvent, STALE_CLAIM_MS } = await import("../../api/stripe-webhook.js");

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
};

const DUPLICATE = { code: "23505", message: "duplicate key value violates unique constraint" };

// A minimal stand-in for the supabase-js query builder: records every call and resolves
// with whatever the scenario supplies. Only the methods this code path uses are present,
// so a change in how the handler queries shows up as a TypeError rather than a pass.
function fakeSupabase({ insertError = null, row = null, readError = null, retaken = [], retakeError = null, updateError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, filters: {} };
      calls.push(q);
      const builder = {
        insert(values) { q.op = "insert"; q.values = values; return Promise.resolve({ data: null, error: insertError }); },
        update(values) { q.op = "update"; q.values = values; return builder; },
        select(cols) { q.select = cols; return q.op === "update" ? Promise.resolve({ data: retaken, error: retakeError }) : builder; },
        eq(col, val) { q.filters[col] = val; return q.op === "update" ? builder : builder; },
        is(col, val) { q.filters[`${col}.is`] = val; return builder; },
        lt(col, val) { q.filters[`${col}.lt`] = val; return builder; },
        maybeSingle() { return Promise.resolve({ data: row, error: readError }); },
        then(resolve) { return Promise.resolve({ data: null, error: updateError }).then(resolve); },
      };
      return builder;
    },
  };
}

const NOW = Date.parse("2026-08-07T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// ── the ordinary path ──────────────────────────────────────────────────────
{
  const sb = fakeSupabase({});
  const claimed = await claimEvent("evt_1", sb, NOW);
  check("a first delivery is claimed", claimed === true);
  check("the claim is a single insert, no read needed", sb.calls.length === 1 && sb.calls[0].op === "insert");
  check("the claim writes the event id", sb.calls[0].values.event_id === "evt_1");
}

// ── a genuine duplicate ────────────────────────────────────────────────────
{
  const sb = fakeSupabase({
    insertError: DUPLICATE,
    row: { claimed_at: iso(NOW - 60_000), completed_at: iso(NOW - 59_000) },
  });
  check("a redelivery of a completed event is refused", (await claimEvent("evt_1", sb, NOW)) === false);
  check("a completed duplicate never issues an update", !sb.calls.some(c => c.op === "update"));
}

// ── a delivery that is still being handled elsewhere ───────────────────────
// Stripe can redeliver while the first invocation is still running. Processing that
// concurrently would double-send the emails, so a fresh incomplete claim is refused.
{
  const sb = fakeSupabase({
    insertError: DUPLICATE,
    row: { claimed_at: iso(NOW - 5_000), completed_at: null },
  });
  check("a fresh incomplete claim is refused — the other invocation still owns it",
    (await claimEvent("evt_1", sb, NOW)) === false);
}

{
  const sb = fakeSupabase({
    insertError: DUPLICATE,
    row: { claimed_at: iso(NOW - (STALE_CLAIM_MS - 1_000)), completed_at: null },
  });
  check("a claim just inside the window is still refused", (await claimEvent("evt_1", sb, NOW)) === false);
}

// ── the failure this exists for: a claim nobody released ───────────────────
{
  const sb = fakeSupabase({
    insertError: DUPLICATE,
    row: { claimed_at: iso(NOW - (STALE_CLAIM_MS + 1_000)), completed_at: null },
    retaken: [{ event_id: "evt_1" }],
  });
  const claimed = await claimEvent("evt_1", sb, NOW);
  check("a stale incomplete claim is retaken so the customer is still upgraded", claimed === true);

  const update = sb.calls.find(c => c.op === "update");
  check("retaking moves claimed_at forward", update && update.values.claimed_at === iso(NOW));
  check("retaking re-tests completion, so a finished event cannot be reprocessed",
    update && update.filters["completed_at.is"] === null);
  check("retaking re-tests staleness, so two racing retries cannot both win",
    update && typeof update.filters["claimed_at.lt"] === "string");
}

{
  // The same race, from the losing side: the UPDATE matched no rows because another
  // retry got there first. That must read as "not mine", not as "claimed".
  const sb = fakeSupabase({
    insertError: DUPLICATE,
    row: { claimed_at: iso(NOW - (STALE_CLAIM_MS + 1_000)), completed_at: null },
    retaken: [],
  });
  check("losing the race to retake a stale claim yields false", (await claimEvent("evt_1", sb, NOW)) === false);
}

// ── errors must never be mistaken for duplicates ───────────────────────────
// Returning false on an unknown error would silently drop a real payment event.
{
  const sb = fakeSupabase({ insertError: { code: "42P01", message: "relation does not exist" } });
  let threw = false;
  try { await claimEvent("evt_1", sb, NOW); } catch { threw = true; }
  check("an unexpected insert error is raised, not read as a duplicate", threw);
}

{
  const sb = fakeSupabase({ insertError: DUPLICATE, readError: { code: "08006", message: "connection failure" } });
  let threw = false;
  try { await claimEvent("evt_1", sb, NOW); } catch { threw = true; }
  check("a failed read of the existing claim is raised, not read as a duplicate", threw);
}

{
  // Insert conflicted but the row cannot be read back. Refusing is the safe answer:
  // the event may well have been handled, and a duplicate email is worse than a
  // retry that Stripe will send anyway.
  const sb = fakeSupabase({ insertError: DUPLICATE, row: null });
  check("a conflict with no readable row is refused rather than guessed", (await claimEvent("evt_1", sb, NOW)) === false);
}

// ── completion ─────────────────────────────────────────────────────────────
{
  const sb = fakeSupabase({});
  await completeEvent("evt_1", sb, NOW);
  const update = sb.calls.find(c => c.op === "update");
  check("completing stamps completed_at", update && update.values.completed_at === iso(NOW));
  check("completing targets exactly the one event", update && update.filters.event_id === "evt_1");
}

{
  // The work is already done and the customer already upgraded when this runs. Throwing
  // here would turn a bookkeeping failure into a 500 and make Stripe retry a payment it
  // has already been charged for.
  const sb = fakeSupabase({ updateError: { code: "08006", message: "connection failure" } });
  let threw = false;
  try { await completeEvent("evt_1", sb, NOW); } catch { threw = true; }
  check("a failure to mark completion does not throw", threw === false);
}

// ── the window itself ──────────────────────────────────────────────────────
{
  // Shorter than the function's own 10 s ceiling would let a retry overtake an
  // invocation that is merely slow; far longer than Stripe's retry schedule would leave
  // a dead claim unreclaimed for the whole three-day window.
  check("the stale window is minutes, not seconds and not days",
    STALE_CLAIM_MS > 60_000 && STALE_CLAIM_MS <= 60 * 60_000);
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nAll stripe idempotency checks passed.");
