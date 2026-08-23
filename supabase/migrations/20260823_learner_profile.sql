-- 20260823_learner_profile.sql — P.E.R:s bestående elevmodell.
--
-- Tre saker, med olika livslängd och olika ägare:
--
--   profiles.persona          vem användaren är i produkten (elev/lärare/förälder)
--   profiles.onboarded_at     om introduktionen är gjord
--   learner_profile_facts     vad P.E.R. vet om användaren, och varifrån det kom
--
-- ANVÄNDARNA ÄR TILL STOR DEL MINDERÅRIGA. Det styr tre beslut nedan:
-- inga skrivpolicyer (all skrivning går via api/check-role.js efter auth),
-- cascade-delete mot auth.users så att ett raderat konto inte lämnar kvar en
-- profil, och ingen fritextkolumn utan nyckel — varje uppgift måste ha ett
-- namngivet fält som går att visa och radera i "Vad P.E.R. vet om mig".

begin;

-- ── 1. Persona ────────────────────────────────────────────────────────────
--
-- profiles.role är INTE persona. role är plan och behörighet
-- (gratis/basic/premium/teacher/admin) och avgör vad någon får se. persona är
-- vem användaren säger sig vara och avgör hur P.E.R. pratar med dem.
--
-- De måste vara skilda åt. Slogs de ihop skulle vem som helst kunna välja
-- "Lärare" i onboardingen och därmed få lärardashboardens elevdata. Att välja
-- persona='larare' ger ingen behörighet alls — role='teacher' sätts fortsatt
-- separat och verifierat, precis som idag.

alter table public.profiles add column if not exists persona text;
alter table public.profiles add column if not exists onboarded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_persona_check'
  ) then
    alter table public.profiles
      add constraint profiles_persona_check
      check (persona is null or persona in ('elev', 'larare', 'foralder'));
  end if;
end $$;

comment on column public.profiles.persona is
  'Vem användaren är i produkten. Ger ingen behörighet — se profiles.role för det.';
comment on column public.profiles.onboarded_at is
  'När introduktionen slutfördes ELLER hoppades över. Null = ännu inte visad.';

-- ── 2. Vad P.E.R. vet ─────────────────────────────────────────────────────
--
-- Nyckel/värde i stället för en kolumn per uppgift, av två skäl som båda står
-- i uppdraget: användaren ska kunna se och radera varje enskild uppgift
-- ("Vad P.E.R. vet om mig"), och P.E.R. ska lära sig nya saker över tid utan
-- att varje ny insikt kräver en migration.
--
-- source är hela poängen med tabellen. "Eleven går NA25" och "eleven verkar
-- föredra korta svar" är inte samma sorts påstående, och får aldrig
-- presenteras som om de vore det:
--
--   user      användaren har sagt det själv (onboarding eller redigering)
--   observed  systemet har mätt det (provresultat, faktiskt beteende)
--   inferred  P.E.R. har dragit slutsatsen (kan vara fel — därav confidence)

create table if not exists public.learner_profile_facts (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
  source     text        not null,
  confidence real        not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  constraint learner_profile_facts_source_check
    check (source in ('user', 'observed', 'inferred')),
  constraint learner_profile_facts_confidence_check
    check (confidence >= 0 and confidence <= 1),
  -- Nyckeln går ut i P.E.R:s prompt och tillbaka som en etikett i gränssnittet.
  -- Formatet hålls hårt så att varken en modell eller en klient kan smyga in
  -- något som renderas som annat än ett fältnamn.
  constraint learner_profile_facts_key_check
    check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- En uppgift som inte får plats i 2 kB är inte en profiluppgift utan ett
  -- dokument. Taket hindrar att tabellen används som allmän lagring.
  constraint learner_profile_facts_size_check
    check (length(value::text) <= 2048)
);

comment on table public.learner_profile_facts is
  'Vad P.E.R. vet om en användare. En rad per uppgift så att varje uppgift går att visa, ändra och radera för sig.';
comment on column public.learner_profile_facts.source is
  'user = användaren har sagt det. observed = systemet har mätt det. inferred = P.E.R. har gissat, se confidence.';

create index if not exists learner_profile_facts_user_idx
  on public.learner_profile_facts (user_id);

alter table public.learner_profile_facts enable row level security;

-- Läsning: bara sin egen profil. Skrivning: ingen policy alls, dvs bara
-- service_role via api/check-role.js. Samma mönster som elevtabellerna i
-- 20260727_per_learner_loop.sql — klienten får aldrig skriva sin egen
-- elevmodell direkt, eftersom source-fältet då hade blivit meningslöst.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'learner_profile_facts'
      and policyname = 'learner_profile_facts_select_own'
  ) then
    create policy learner_profile_facts_select_own on public.learner_profile_facts
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- authenticated MÅSTE stå med i revoke-listan. Supabase default-grantar ALL på
-- nya tabeller i public till både anon och authenticated, så en revoke som
-- bara nämner public och anon lämnar kvar INSERT/UPDATE/DELETE för varje
-- inloggad användare. RLS utan skrivpolicy stoppar dem ändå, men då vilar hela
-- skyddet på en enda mekanism — och det är precis den kombinationen som gjorde
-- att concept_collective_stats behövde härdas i efterhand (CR-FINAL).
revoke all on public.learner_profile_facts from public, anon, authenticated;
grant select on public.learner_profile_facts to authenticated;

-- ── 3. Pilotstyrning ──────────────────────────────────────────────────────
--
-- Av som default, precis som alla andra flaggor. Onboardingen visas inte och
-- P.E.R. läser ingen profil förrän flaggan slås på.

insert into public.feature_flags (key, enabled)
values ('per_learner_profile_enabled', false)
on conflict (key) do nothing;

commit;
