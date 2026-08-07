-- Fix: api/stripe-webhook.js had no event.id deduplication. Stripe's
-- at-least-once redelivery caused duplicate confirmation/admin emails,
-- and a DB failure during processing still returned 200 (no retry),
-- so a paying customer could end up with no role upgrade and no
-- automatic recovery.
--
-- This table is the idempotency claim: the handler inserts a row before
-- processing and marks it completed afterwards.
--
-- TWO TIMESTAMPS, NOT ONE. A single processed_at cannot tell "this event is
-- being handled right now" apart from "this event is fully handled", and the
-- difference matters: api/stripe-webhook.js runs with maxDuration 10 (see
-- vercel.json) and makes up to two Resend calls per event. If the function is
-- killed by that ceiling — or by any crash that does not raise a catchable
-- error — a claim written before processing survives with nothing to release
-- it, and every later Stripe redelivery of that event short-circuits to 200.
-- The customer would have paid, never been upgraded, and no retry would ever
-- reach the code that upgrades them. That failure is silent, which makes it
-- worse than the duplicate emails this table exists to prevent.
--
-- With completed_at, a claim that was never completed can be retaken once it
-- is demonstrably stale, so a killed invocation costs one retry window instead
-- of the whole event.

create table if not exists public.stripe_webhook_events (
  event_id     text primary key,
  claimed_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- The only query that is not a primary-key lookup: finding claims that were
-- taken but never finished. Partial, because completed rows are the vast
-- majority and are never scanned this way.
create index if not exists idx_stripe_webhook_events_incomplete
  on public.stripe_webhook_events (claimed_at)
  where completed_at is null;

alter table public.stripe_webhook_events enable row level security;
-- No policy: only the webhook handler (service_role) ever touches this table.
