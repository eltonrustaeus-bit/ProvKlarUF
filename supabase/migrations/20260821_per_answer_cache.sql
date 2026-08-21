-- P.E.R:s svarscache (delsystem A). Se docs/superpowers/specs/2026-08-21-per-svarscache-design.md
-- och docs/per/CODEX_REVIEW_CACHE.md för resonemanget bakom varje spärr nedan.
--
-- Cachen ligger framför exakt två vägar vars prompt bevisligen saknar elevdata: landingMode
-- och EXPLAIN MODE. Identitetsbanan ströks efter granskning — api/explain.js:412 laddar
-- longMemory nycklat på user.id, inte på sessionen, så "tom historik" bevisar ingenting.
--
-- Additiv migration: bara CREATE ... IF NOT EXISTS. Säker att köra om.
-- Rollback: 20260821_per_answer_cache_ROLLBACK.sql.

create extension if not exists vector with schema extensions;

-- ── per_answer_cache ────────────────────────────────────────────────────────
-- INGEN user_id, ingen FK till auth.users. Cachen är en ren innehållstabell: det finns
-- ingenting här att koppla till en person, alltså ingenting att läcka och ingenting att
-- lämna ut. Användarna är till stor del minderåriga.
--
-- status: landingMode är OAUTENTISERAD (api/explain.js:250) och dess rate limit fail-open:ar
-- (api/explain.js:270). Utan grind kan en angripare via promptinjektion få ett svar cachat som
-- sedan serveras till riktiga besökare — falska pris- och produktfakta på marknadsytan
-- (Codex CR-CACHE-003). Nya landningsrader skrivs därför som 'pending', och ENDAST 'approved'
-- rader läses någonsin. Samma mönster som knowledge_chunks.review_status.
create table if not exists public.per_answer_cache (
  id             uuid primary key default gen_random_uuid(),
  lane           text not null check (lane in ('landing','explain')),
  payload_hash   text not null,
  fingerprint    text not null,
  question_text  text not null check (char_length(question_text) <= 500),
  answer         text not null,
  embedding      extensions.vector(1536),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  hits           integer not null default 0 check (hits >= 0),
  created_at     timestamptz not null default now(),
  last_hit_at    timestamptz,
  expires_at     timestamptz not null,
  unique (lane, fingerprint, payload_hash)
);

create index if not exists idx_per_answer_cache_lookup
  on public.per_answer_cache (lane, fingerprint, payload_hash)
  where status = 'approved';

-- Partiellt HNSW-index: bara rader som kan träffas av en vektorsökning. Explain-banan har
-- embedding null och godkända rader är en delmängd — indexet hålls litet av båda skälen.
create index if not exists idx_per_answer_cache_embedding_hnsw
  on public.per_answer_cache
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null and status = 'approved';

-- ── per_cache_probe ─────────────────────────────────────────────────────────
-- Textlös och utan user_id, men med cache_id och fingeravtrycksprefix så att en skadlig rad
-- går att hitta och rensa vid incident (Codex CR-CACHE-014).
--
-- uuid-nyckel, inte bigserial: då finns ingen sekvens att komma ihåg att revoke:a
-- (Codex CR-CACHE-007). Problemet elimineras i stället för att hanteras.
create table if not exists public.per_cache_probe (
  id             uuid primary key default gen_random_uuid(),
  lane           text not null,
  decision       text not null check (decision in ('hit_exact','hit_vector','near_miss','miss','blocked')),
  similarity     real,
  cache_id       uuid,
  fingerprint_px text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_per_cache_probe_created on public.per_cache_probe (created_at desc);

-- ── Rättigheter ─────────────────────────────────────────────────────────────
-- "Enable RLS + noll policyer" ensamt räcker inte — explicit revoke/grant enligt husmönstret
-- i 20260727_per_learner_loop.sql och 20260820_per_collective_stats.sql (Codex CR-CACHE-007).
alter table public.per_answer_cache enable row level security;
alter table public.per_cache_probe  enable row level security;

revoke all on table public.per_answer_cache from public, anon, authenticated;
revoke all on table public.per_cache_probe  from public, anon, authenticated;
grant select, insert, update on table public.per_answer_cache to service_role;
grant insert                 on table public.per_cache_probe  to service_role;

-- ── per_cache_get_exact() ───────────────────────────────────────────────────
-- Uppslag och träffbokföring i EN sats. Läs-ändra-skriv i applikationen tappar increments vid
-- samtidiga träffar (Codex CR-CACHE-009), och sparar dessutom en tur-och-retur.
create or replace function public.per_cache_get_exact(
  p_lane         text,
  p_fingerprint  text,
  p_payload_hash text
)
returns table (cache_id uuid, answer text)
language sql
security definer
set search_path = public
as $$
  update public.per_answer_cache c
     set hits = c.hits + 1, last_hit_at = now()
   where c.id = (
     select id from public.per_answer_cache
      where lane = p_lane
        and fingerprint = p_fingerprint
        and payload_hash = p_payload_hash
        and status = 'approved'
        and expires_at > now()
      limit 1
   )
  returning c.id, c.answer;
$$;

-- ── per_cache_match() ───────────────────────────────────────────────────────
-- Kandidater för vektorträff. Bokför INGEN träff: slot-guarden i JS kan fortfarande neka
-- allihop, och en nekad kandidat är ingen träff.
create or replace function public.per_cache_match(
  p_lane           text,
  p_fingerprint    text,
  p_embedding      extensions.vector(1536),
  p_min_similarity real    default 0.88,
  p_limit          integer default 5
)
returns table (cache_id uuid, question_text text, answer text, similarity real)
language sql
stable
security definer
-- extensions MÅSTE ingå i search_path här, till skillnad från de andra två funktionerna:
-- <=> (cosine distance) bor i extensions-schemat, och `set search_path = public` ensamt gör
-- operatorn oupptäckbar. Produktionskörningen föll på exakt det:
--   ERROR: 42883: operator does not exist: extensions.vector <=> extensions.vector
-- Sökvägen är fortfarande pinnad — det är hela poängen med CR-CACHE-008 — bara inte till en
-- enda schema. Den befintliga match_knowledge_chunks fungerar för att den saknar set
-- search_path helt och ärver Supabases default; det är svagare, inte starkare.
set search_path = public, extensions
as $$
  select c.id, c.question_text, c.answer, (1 - (c.embedding <=> p_embedding))::real
    from public.per_answer_cache c
   where c.lane = p_lane
     and c.fingerprint = p_fingerprint
     and c.status = 'approved'
     and c.expires_at > now()
     and c.embedding is not null
     and (1 - (c.embedding <=> p_embedding)) >= p_min_similarity
   order by c.embedding <=> p_embedding
   limit greatest(p_limit, 1);
$$;

-- ── per_cache_hit() ─────────────────────────────────────────────────────────
create or replace function public.per_cache_hit(p_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  update public.per_answer_cache
     set hits = hits + 1, last_hit_at = now()
   where id = p_id and status = 'approved' and expires_at > now()
  returning answer;
$$;

revoke execute on function public.per_cache_get_exact(text, text, text) from public, anon, authenticated;
revoke execute on function public.per_cache_match(text, text, extensions.vector, real, integer) from public, anon, authenticated;
revoke execute on function public.per_cache_hit(uuid) from public, anon, authenticated;
grant  execute on function public.per_cache_get_exact(text, text, text) to service_role;
grant  execute on function public.per_cache_match(text, text, extensions.vector, real, integer) to service_role;
grant  execute on function public.per_cache_hit(uuid) to service_role;

-- ── Feature flag ────────────────────────────────────────────────────────────
insert into public.feature_flags (key, enabled, configuration)
values ('per_answer_cache_enabled', false,
        '{"description": "P.E.R svarscache: aterianvand svar pa landingMode och EXPLAIN MODE (delsystem A)."}'::jsonb)
on conflict (key) do nothing;
