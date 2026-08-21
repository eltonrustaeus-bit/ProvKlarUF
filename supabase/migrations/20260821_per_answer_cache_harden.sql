-- Härdning av 20260821_per_answer_cache.sql efter granskning.
--
-- Fyra ändringar, alla följder av granskningsfynd. Ingen av dem rör de tre RPC:erna eller
-- status-grinden — den granskades och höll på samtliga läsvägar.
--
-- Additiv och säker att köra om: varje constraint läggs bakom en pg_constraint-kontroll,
-- samma mönster som 20260727_per_learner_loop.sql använder.
-- Rollback: 20260821_per_answer_cache_harden_ROLLBACK.sql.

-- ── §1. Bind expires_at i databasen ─────────────────────────────────────────
-- TTL:n fanns bara i applikationskoden och i prosa i CACHE_GODKANNANDE.md. Det mönstret
-- avvisades redan en gång i det här projektet: Codex CR-PER-006 underkände en kommenterad
-- 4000-teckensgräns med motiveringen att en kommenterad applikationsgräns inte är någon
-- gräns. Samma sak gäller här — en bugg i api/_per-cache.js som sätter expires_at till år
-- 3000 hade tyst satt hela TTL:n ur spel utan att schemat sagt ifrån.
--
-- 90 dagar, inte 30: applikationen sätter 30. Constrainten är ett skyddsräcke mot orimliga
-- värden, inte ett andra ställe att koda TTL:n på. Skulle båda vara 30 måste de ändras i
-- takt, och då har man två sanningar i stället för en.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'per_answer_cache_expires_at_rimlig') then
    alter table public.per_answer_cache
      add constraint per_answer_cache_expires_at_rimlig
      check (expires_at > created_at and expires_at <= created_at + interval '90 days');
  end if;
end $$;

-- ── §2. Samma lane-validering på båda tabellerna ────────────────────────────
-- per_answer_cache.lane har check (lane in ('landing','explain')); per_cache_probe.lane hade
-- ingen, för exakt samma begrepp. Asymmetrin hade inget skäl.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'per_cache_probe_lane_check') then
    alter table public.per_cache_probe
      add constraint per_cache_probe_lane_check
      check (lane in ('landing','explain'));
  end if;
end $$;

-- ── §3. service_role måste kunna LÄSA sonden ────────────────────────────────
-- Ursprungsmigrationen gav bara insert. docs/per/CACHE_GODKANNANDE.md steg 3 — spårningen vid
-- misstänkt förgiftning — läser tabellen. Med bara insert fungerar den frågan enbart som
-- tabellägare i SQL-editorn, vilket är en gräns som hade upptäckts först under en incident.
grant select on table public.per_cache_probe to service_role;

-- ── §4. Ta bort idx_per_answer_cache_lookup ─────────────────────────────────
-- Indexet täckte (lane, fingerprint, payload_hash) — exakt de kolumner tabellens egen
-- unique-constraint redan indexerar, över alla rader. Unique-indexet är en enradssökning,
-- så det partiella indexet tillför ingenting: samma kolumner, färre rader, men uppslaget var
-- redan en punktträff. Två index att underhålla för en sökning.
--
-- Återskapas av ROLLBACK-filen om något visar sig behöva det. Lägg inte tillbaka det utan
-- en mätning som visar att unique-indexet inte räcker.
drop index if exists public.idx_per_answer_cache_lookup;
