-- per_module_activity — vilka delar av P.E.R. som faktiskt användes, per timme.
--
-- Underlaget till hjärnan på per.html. Utan den kan kartan bara visa struktur,
-- och en nod som lyser för att det ser bra ut när noder lyser är dekoration.
--
-- VAD SOM INTE STÅR HÄR
-- Inget user_id, ingen frågetext, inget svar. Bara ett modulnamn, en timme och
-- ett antal. Samma regel som api/_per-memory.js bär sedan start: "Spara aldrig
-- namn, e-post, telefon, kontouppgifter, hemligheter, exakta frågetexter eller
-- personliga detaljer." En aktivitetsräknare är inget undantag från den.
--
-- Räknaren kan inte peka ut en elev ens indirekt: den säger att modulen
-- användes 14 gånger mellan klockan tre och fyra, inte av vem.
--
-- VOLYM
-- Högst ~20 moduler x 24 timmar = ~480 rader per dygn. Rader äldre än
-- RETENTION gallras i samma sats som skriver, så tabellen kan inte växa
-- obevakat och ingen behöver komma ihåg ett städjobb.
--
-- Icke-destruktiv: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Rollback: 20260825_per_module_activity_ROLLBACK.sql

create table if not exists public.per_module_activity (
  module text        not null,
  hour   timestamptz not null,
  count  integer     not null default 0 check (count >= 0),
  primary key (module, hour)
);

create index if not exists idx_per_module_activity_hour
  on public.per_module_activity (hour desc);

alter table public.per_module_activity enable row level security;

revoke all on table public.per_module_activity from public, anon, authenticated;
grant select, insert, update, delete on table public.per_module_activity to service_role;

-- En rundtur för alla moduler i ett svar, inte en per modul.
--
-- ATOMISK: insert ... on conflict do update ... är EN sats, så två parallella
-- anrop kan inte skriva över varandras ökning. Samma skäl som
-- per_consume_daily_quota() i 20260727_per_learner_loop.sql.
create or replace function public.per_bump_modules(p_modules text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour timestamptz := date_trunc('hour', now() at time zone 'utc');
begin
  if p_modules is null or array_length(p_modules, 1) is null then
    return;
  end if;

  insert into public.per_module_activity (module, hour, count)
  select m, v_hour, 1
  from unnest(p_modules) as m
  where m is not null and length(m) between 1 and 64
  on conflict (module, hour)
  do update set count = public.per_module_activity.count + 1;

  -- Gallringen ligger här och inte i ett schemalagt jobb: ett städjobb som
  -- ingen kommer ihåg att sätta upp är ett städjobb som aldrig körs.
  delete from public.per_module_activity
  where hour < v_hour - interval '30 days';
end;
$$;

revoke all on function public.per_bump_modules(text[]) from public, anon, authenticated;
grant execute on function public.per_bump_modules(text[]) to service_role;

comment on table public.per_module_activity is
  'Vilka P.E.R-moduler som användes, per timme. Inget user_id, ingen text — '
  'bara namn, timme och antal. Gallras efter 30 dygn av per_bump_modules().';
