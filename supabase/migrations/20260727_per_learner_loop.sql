-- P.E.R. Learner Loop (Fas 9 — den fas som 20260720_knowledge_engine_schema.sql pekade fram mot
-- men aldrig byggdes). Denna migration stänger evidenskedjan mellan ett elevsvar och en
-- rekommendation:
--
--   student_attempts          — ETT elevsvar med sin bedömning (den saknade tabell som
--                               student_error_events.source_attempt_id redan pekade på)
--   student_recommendations   — nästa pedagogiska steg + evidensen som motiverar det
--   apply_legal_mastery()     — atomisk mastery-uppdatering
--   per_consume_daily_quota() — atomisk dygnskvot för elevriktade AI-anrop
--   + stängning av en facitläcka i exam_questions (se §A nedan)
--
-- RLS-princip (oförändrad från 20260720): elevriktade tabeller får EN select-policy för egen rad
-- och INGA insert/update/delete-policyer — all skrivning sker med service_role via api/knowledge.js.
--
-- Icke-destruktiv för data: bara CREATE / ADD COLUMN IF NOT EXISTS / INSERT ... ON CONFLICT.
-- Den enda borttagningen är en RLS-policy som ingen klient använder (§A).
-- Rollback: 20260727_per_learner_loop_ROLLBACK.sql.

-- ── §A. Stäng facitläckan i exam_questions ──────────────────────────────────
-- Codex-granskning 2026-07-27 (CR-PER-001, ACCEPTERAD): exam_questions.payload innehåller
-- correct_answer + explanation (src/generation/legal-generation.mjs:309), och policyn
-- exam_questions_select_own gav eleven direkt PostgREST-läsning av alla frågor i sin egen
-- blueprint — alltså facit till frågor eleven ännu inte besvarat. Det är exakt samma klass av
-- läcka som redan stängdes för hp_questions (20260701_hp_fixes.sql §1).
--
-- Verifierat före borttagning: ingen HTML/JS-yta i repot läser exam_questions direkt (grep över
-- samtliga *.html/*.js). Servern (service_role) bypassar RLS och påverkas inte. Elevens frågor
-- levereras hädanefter av api/knowledge.js som en explicit projektion UTAN facit.
drop policy if exists exam_questions_select_own on public.exam_questions;

-- ── student_attempts ────────────────────────────────────────────────────────
-- Dataminimering (§7): student_answer har en hård DB-gräns på 4000 tecken (Codex CR-PER-006 —
-- en kommenterad applikationsgräns är ingen gräns). Fulltexten lagras (eleven ska kunna se sitt
-- eget svar bredvid återkopplingen) men får aldrig kopieras till ai_usage_events.
--
-- idempotency_key (Codex CR-PER-004): en submit som skickas två gånger — dubbelklick, retry
-- efter timeout, nätverksomkörning — får INTE ge två attempts och två mastery-uppdateringar.
-- Nyckeln sätts av api/knowledge.js och är unik per användare.
create table if not exists public.student_attempts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  question_id        uuid references public.exam_questions(id) on delete set null,
  concept_id         uuid references public.concepts(id) on delete set null,
  question_type      text not null check (question_type in ('multiple_choice','short_answer')),
  level              text not null check (level in ('E','C','A')),
  student_answer     text check (student_answer is null or char_length(student_answer) <= 4000),
  is_correct         boolean,
  -- score: 0–1 delpoäng. multiple_choice är alltid 0 eller 1; short_answer kan vara däremellan.
  score              real not null default 0 check (score between 0 and 1),
  -- confidence: hur säker BEDÖMNINGEN är (inte hur säker eleven är). Deterministisk rättning = 1.
  confidence         real not null default 0 check (confidence between 0 and 1),
  assessment_method  text not null check (assessment_method in (
                       'deterministic','llm_reasoning','llm_reasoning_verified','insufficient_evidence'
                     )),
  -- assessment: strukturerad, schemavaliderad bedömning (dimensioner, feedback, citat).
  assessment         jsonb not null default '{}'::jsonb,
  source_chunk_ids   uuid[] not null default '{}',
  latency_ms         integer,
  idempotency_key    text not null,
  -- mastery_applied (Codex CR-PER-019): evidenskedjan skrivs i tre steg som inte kan vara EN
  -- transaktion via PostgREST. Utan den här flaggan blir en halvskriven kedja permanent trasig:
  -- idempotensnyckeln är förbrukad, försöket finns, men mastery uppdaterades aldrig — och en
  -- retry hoppar över allt eftersom raden redan finns. Flaggan gör att en retry kan ÅTERUPPTA
  -- kedjan i stället för att hoppa över den.
  mastery_applied    boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
-- Om en tidigare version av denna migration redan skapat tabellen gör CREATE TABLE IF NOT EXISTS
-- ingenting — då saknas de kolumner som lagts till senare (Codex CR-PER-028). Explicit ALTER
-- gör migrationen säker att köra om.
alter table public.student_attempts add column if not exists mastery_applied boolean not null default false;
alter table public.student_attempts add column if not exists idempotency_key text;

create index if not exists idx_student_attempts_user on public.student_attempts(user_id, created_at desc);
create index if not exists idx_student_attempts_concept on public.student_attempts(user_id, concept_id, created_at desc);

-- EN besvarad fråga per elev (Codex CR-PER-016): utan detta kan eleven skicka nya
-- idempotensnycklar för samma fråga och prova varje svarsalternativ tills is_correct=true —
-- vilket både utvinner facit och pumpar upp mastery. Idempotensnyckeln skyddar mot OAVSIKTLIGA
-- dubbletter; den här constrainten skyddar mot AVSIKTLIGA.
create unique index if not exists uq_student_attempts_user_question
  on public.student_attempts(user_id, question_id) where question_id is not null;

alter table public.student_attempts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='student_attempts' and policyname='student_attempts_select_own') then
    create policy student_attempts_select_own on public.student_attempts
      for select using (user_id = auth.uid());
  end if;
end $$;
-- Ingen insert/update/delete-policy — skrivs av service_role via api/knowledge.js.

-- Stäng den brutna referensen: student_error_events.source_attempt_id skapades i 20260720 utan
-- FK eftersom måltabellen inte fanns än. Nu finns den.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'student_error_events_source_attempt_id_fkey'
  ) then
    alter table public.student_error_events
      add constraint student_error_events_source_attempt_id_fkey
      foreign key (source_attempt_id) references public.student_attempts(id) on delete set null;
  end if;
end $$;

-- EN felhändelse per försök (Codex CR-PER-019): gör återupptagningen av en halvskriven
-- evidenskedja säker — ett andra försök att skriva samma felhändelse kan inte ge en dubblett.
create unique index if not exists uq_student_error_events_attempt
  on public.student_error_events(source_attempt_id) where source_attempt_id is not null;

-- Codex CR-PER-005 (DELVIS ACCEPTERAD): FK:n garanterar inte att felhändelsens user_id/concept_id
-- matchar attempt-radens. En cross-table CHECK finns inte i Postgres, så detta löses med en
-- trigger i stället för att bara skrivas som en applikationsregel — felhändelser är evidensen
-- rekommendationerna vilar på, och en felkopplad rad förgiftar elevmodellen tyst.
create or replace function public.student_error_events_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_concept_id uuid;
begin
  if new.source_attempt_id is null then
    return new;
  end if;
  select user_id, concept_id into v_user_id, v_concept_id
  from public.student_attempts where id = new.source_attempt_id;
  if v_user_id is null then
    raise exception 'source_attempt_id % finns inte', new.source_attempt_id;
  end if;
  if v_user_id <> new.user_id then
    raise exception 'user_id matchar inte attempt-radens user_id';
  end if;
  -- Codex CR-PER-030: tidigare tilläts att felhändelsen hade concept_id = null när försöket hade
  -- ett koncept. En felhändelse utan koncept är osynlig för rekommendationsmotorn — den ska inte
  -- gå att skriva när kopplingen faktiskt är känd.
  if v_concept_id is not null and new.concept_id is distinct from v_concept_id then
    raise exception 'concept_id matchar inte attempt-radens concept_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_student_error_events_consistency on public.student_error_events;
create trigger trg_student_error_events_consistency
  before insert or update on public.student_error_events
  for each row execute function public.student_error_events_consistency();

-- ── student_mastery: evidenskvalitet ────────────────────────────────────────
-- confidence (som redan fanns) svarar på "hur säkra är vi på den här mastery-siffran?". Den kan
-- inte beräknas från antal försök ensamt — tio LLM-bedömningar med låg säkerhet är svagare
-- evidens än tre deterministiska rättningar. evidence_quality är det löpande medelvärdet av
-- bedömningarnas egen confidence, och confidence = mängdfaktor × evidence_quality.
alter table public.student_mastery add column if not exists evidence_quality real not null default 0
  check (evidence_quality between 0 and 1);

-- ── student_recommendations ─────────────────────────────────────────────────
-- Varje rad är ett konkret nästa steg MED sin motivering. rationale/evidence finns för att
-- P.E.R. ska kunna svara eleven på "varför föreslår du det här?" (§5) — inte för intern debug.
create table if not exists public.student_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  concept_id         uuid references public.concepts(id) on delete set null,
  source_attempt_id  uuid references public.student_attempts(id) on delete set null,
  action             text not null check (action in (
                       'new_question_same_concept','easier_question','harder_question',
                       'review_explanation','stepwise_hint','application_task',
                       'compare_concepts','spaced_review','switch_concept'
                     )),
  target_level       text check (target_level in ('E','C','A')),
  rationale          text not null,
  evidence           jsonb not null default '{}'::jsonb,
  status             text not null default 'open' check (status in ('open','served','completed','superseded')),
  created_at         timestamptz not null default now(),
  served_at          timestamptz
);
create index if not exists idx_student_recommendations_user on public.student_recommendations(user_id, created_at desc);
-- Unikt, inte bara ett vanligt index (Codex CR-PER-021): två samtidiga svar på samma koncept kan
-- annars båda hinna supersede:a innan någon insert sker, och lämna två öppna rekommendationer.
-- Eleven ska ha exakt ETT öppet nästa steg per koncept.
create unique index if not exists uq_student_recommendations_open
  on public.student_recommendations(user_id, concept_id) where status = 'open';

alter table public.student_recommendations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='student_recommendations' and policyname='student_recommendations_select_own') then
    create policy student_recommendations_select_own on public.student_recommendations
      for select using (user_id = auth.uid());
  end if;
end $$;
-- Ingen insert/update/delete-policy — service_role-only.

-- ── generation_jobs: tillåt elevbedömning som jobbtyp ───────────────────────
-- job_type tillät bara 'legal_exam_generation' (20260720:267). Elevbedömningens AI-anrop ska
-- kunna korreleras mot samma jobb-/kostnadsspår som genereringen, annars blir ai_usage_events
-- för assess-steget föräldralösa. Additiv ändring — befintliga rader påverkas inte.
alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table public.generation_jobs add constraint generation_jobs_job_type_check
  check (job_type in ('legal_exam_generation','per_assessment','per_coach'));

-- ── ai_usage_events: nya pipeline-steg för elevloopen ──────────────────────
-- pipeline_step-enumen (20260720:36) saknade steg för bedömning, verifiering av bedömning,
-- coachning och rekommendation. Utan dem kan elevloopens AI-anrop inte kostnadsloggas alls
-- (insert skulle brytas av CHECK-constrainten). Additivt — inga befintliga värden tas bort.
alter table public.ai_usage_events drop constraint if exists ai_usage_events_pipeline_step_check;
alter table public.ai_usage_events add constraint ai_usage_events_pipeline_step_check
  check (pipeline_step in (
    'classify','blueprint','embed','retrieve','generate','validate',
    'verify_blind','verify_compare','repair','assemble','grade',
    'error_classify','mastery_update',
    'assess','verify_assess','coach','recommend'
  ));

-- ── apply_legal_mastery() ───────────────────────────────────────────────────
-- Atomisk uppdatering av en elevs mastery för ETT koncept.
--
-- Codex CR-PER-003 (ACCEPTERAD): apply_hp_mastery:s `for update` låser INGENTING när raden inte
-- finns än — två samtidiga förstasvar läser båda "not found" och den ena uppdateringen tappas.
-- Löses här med ett transaktionsbundet advisory lock på (user_id, concept_id), som fungerar även
-- för rader som inte finns. (Samma brist finns kvar i apply_hp_mastery; HP rörs inte i detta
-- arbete — noterad i docs/per/CODEX_REVIEW.md som separat uppföljning.)
--
-- Övriga skillnader mot apply_hp_mastery, alla avsiktliga:
--   • p_score är 0–1 i stället för boolean: short_answer kan ge delpoäng, och Elo-uppdateringen
--     ska då röra sig delvis, inte som om svaret vore helt rätt eller helt fel.
--   • p_confidence spårar bedömningens kvalitet (löpande medel i evidence_quality).
--   • correct_attempts/last_result/last_practiced_at underhålls för rekommendationsmotorn.
--
-- Elo: expected = 1/(1+10^((difficulty*100 − mastery)/40)), K=24 medan attempts<10 annars 12.
-- Identiska konstanter som HP — samma 0–100-skala, samma inlärningstakt, en konvention i produkten.
-- p_attempt_id ger EXAKT-EN-GÅNG-semantik (Codex CR-PER-025). Att uppdatera mastery och sedan
-- markera försöket i två separata anrop räcker inte: kraschar processen däremellan står flaggan
-- kvar på false och nästa retry räknar samma svar en gång till. Här sker båda i SAMMA transaktion
-- (en plpgsql-funktion är en transaktion), och funktionen avbryter direkt om försöket redan är
-- bokfört. Det är databasen, inte applikationen, som äger den garantin.
create or replace function public.apply_legal_mastery(
  p_user_id    uuid,
  p_concept_id uuid,
  p_difficulty real,
  p_score      real,
  p_confidence real,
  p_attempt_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied     boolean;
  v_mastery     real;
  v_attempts    integer;
  v_correct     integer;
  v_quality     real;
  v_expected    double precision;
  v_k           integer;
  v_new         real;
  v_new_quality real;
  v_new_conf    real;
  v_score       real := greatest(0.0, least(1.0, coalesce(p_score, 0.0)));
  v_conf_in     real := greatest(0.0, least(1.0, coalesce(p_confidence, 0.0)));
  -- Tröskel för "räknas som rätt" i correct_attempts/last_result. 0.85 och inte 1.0: ett
  -- fritextsvar som täcker det väsentliga men missar en nyans är ett korrekt svar pedagogiskt
  -- sett, och ska inte bokföras som fel.
  v_correct_threshold constant real := 0.85;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_concept_id::text, 0));

  -- Bokför bara ett försök en gång. Radlåset hålls till transaktionens slut, så två parallella
  -- anrop för samma försök kan inte båda se false.
  if p_attempt_id is not null then
    select mastery_applied into v_applied
    from public.student_attempts
    where id = p_attempt_id and user_id = p_user_id
    for update;

    if not found then
      raise exception 'attempt % finns inte för denna användare', p_attempt_id;
    end if;
    if v_applied then
      select mastery_score, confidence, attempts, evidence_quality
        into v_new, v_new_conf, v_attempts, v_new_quality
      from public.student_mastery
      where user_id = p_user_id and concept_id = p_concept_id;
      return jsonb_build_object(
        'mastery_score', coalesce(v_new, 0), 'confidence', coalesce(v_new_conf, 0),
        'attempts', coalesce(v_attempts, 0), 'evidence_quality', coalesce(v_new_quality, 0),
        'already_applied', true
      );
    end if;
  end if;

  select mastery_score, attempts, correct_attempts, evidence_quality
    into v_mastery, v_attempts, v_correct, v_quality
  from public.student_mastery
  where user_id = p_user_id and concept_id = p_concept_id;

  if not found then
    v_mastery := 0; v_attempts := 0; v_correct := 0; v_quality := 0;
  end if;

  v_expected := 1.0 / (1.0 + power(10.0, ((coalesce(p_difficulty, 0.5) * 100.0) - v_mastery) / 40.0));
  v_k := case when v_attempts < 10 then 24 else 12 end;
  v_new := v_mastery + v_k * (v_score - v_expected);
  v_new := greatest(0, least(100, v_new));

  -- Löpande medelvärde av bedömningskvalitet.
  v_new_quality := ((v_quality * v_attempts) + v_conf_in) / (v_attempts + 1);
  -- Mängdfaktor: 8 observationer krävs för full säkerhet. Medvetet grov — ingen falsk precision.
  v_new_conf := least(1.0, (v_attempts + 1)::real / 8.0) * v_new_quality;

  insert into public.student_mastery (
    user_id, concept_id, mastery_score, confidence, attempts, correct_attempts,
    last_result, last_practiced_at, evidence_quality, updated_at
  )
  values (
    p_user_id, p_concept_id, v_new, v_new_conf, v_attempts + 1,
    v_correct + case when v_score >= v_correct_threshold then 1 else 0 end,
    v_score >= v_correct_threshold, now(), v_new_quality, now()
  )
  on conflict (user_id, concept_id) do update
    set mastery_score     = excluded.mastery_score,
        confidence        = excluded.confidence,
        attempts          = excluded.attempts,
        correct_attempts  = excluded.correct_attempts,
        last_result       = excluded.last_result,
        last_practiced_at = excluded.last_practiced_at,
        evidence_quality  = excluded.evidence_quality,
        updated_at        = excluded.updated_at;

  -- Samma transaktion som Elo-uppdateringen ovan: antingen sker båda, eller ingen av dem.
  if p_attempt_id is not null then
    update public.student_attempts set mastery_applied = true where id = p_attempt_id;
  end if;

  return jsonb_build_object(
    'mastery_score', v_new,
    'confidence', v_new_conf,
    'attempts', v_attempts + 1,
    'evidence_quality', v_new_quality,
    'already_applied', false
  );
end;
$$;

-- Den gamla 5-argumentsvarianten tas bort explicit: CREATE OR REPLACE skapar en NY överlagring
-- när signaturen ändras, och en kvarlämnad variant utan p_attempt_id skulle sakna exakt-en-gång-
-- garantin helt tyst.
drop function if exists public.apply_legal_mastery(uuid, uuid, real, real, real);

revoke execute on function public.apply_legal_mastery(uuid, uuid, real, real, real, uuid) from public;
revoke execute on function public.apply_legal_mastery(uuid, uuid, real, real, real, uuid) from anon;
revoke execute on function public.apply_legal_mastery(uuid, uuid, real, real, real, uuid) from authenticated;
grant  execute on function public.apply_legal_mastery(uuid, uuid, real, real, real, uuid) to service_role;

-- ── per_refund_daily_quota() ────────────────────────────────────────────────
-- Codex CR-PER-029: kvoten konsumeras innan ägarskaps- och dubblettkontrollen hunnit köra, så en
-- 404 eller ett redan besvarat svar — som inte kostar ett enda AI-anrop — åt ändå upp en plats av
-- dagens 40. Återbetalning stänger det.
create or replace function public.per_refund_daily_quota(
  p_user_id uuid,
  p_feature text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.per_quota_counters
     set used = greatest(0, used - 1)
   where user_id = p_user_id
     and feature = p_feature
     and day = (now() at time zone 'utc')::date;
end;
$$;

revoke execute on function public.per_refund_daily_quota(uuid, text) from public;
revoke execute on function public.per_refund_daily_quota(uuid, text) from anon;
revoke execute on function public.per_refund_daily_quota(uuid, text) from authenticated;
grant  execute on function public.per_refund_daily_quota(uuid, text) to service_role;

-- ── Dygnskvot: räknare + atomisk konsumtion ────────────────────────────────
-- Codex CR-PER-007 (ACCEPTERAD): den befintliga kvoten i api/knowledge.js är en icke-atomisk
-- count-then-insert. Detta är kostnadskontroll, inte kosmetika: varje släppt request är flera
-- betalda LLM-anrop.
--
-- Att bara låsa och RÄKNA befintliga rader räcker inte heller, vilket en egen genomgång visade:
-- raden som ska räknas (student_attempts) skrivs FÖRST EFTER att AI-anropen är klara, så två
-- parallella requests hinner båda passera kontrollen innan någon av dem skrivit sin rad. Låset
-- gör ingen nytta när det som räknas inte finns än.
--
-- Lösningen är en egen räknare som stegas upp i samma atomiska sats som läser den. Räknaren
-- mäter dessutom rätt sak: ANTAL BETALDA REQUESTS, inte antal sparade svar — en diagnostisk
-- fråga som genererar nytt material kostar pengar även om eleven aldrig svarar.
create table if not exists public.per_quota_counters (
  user_id  uuid not null references auth.users(id) on delete cascade,
  feature  text not null,
  day      date not null,
  used     integer not null default 0 check (used >= 0),
  primary key (user_id, feature, day)
);
alter table public.per_quota_counters enable row level security;
-- Ingen policy: intern mätdata, service_role-only.

create or replace function public.per_consume_daily_quota(
  p_user_id uuid,
  p_feature text,
  p_limit   integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_day  date := (now() at time zone 'utc')::date;
begin
  -- Atomisk läs-och-öka: INSERT ... ON CONFLICT DO UPDATE ... RETURNING är EN sats, så två
  -- parallella anrop kan inte få samma värde tillbaka.
  insert into public.per_quota_counters (user_id, feature, day, used)
  values (p_user_id, p_feature, v_day, 1)
  on conflict (user_id, feature, day)
    do update set used = public.per_quota_counters.used + 1
  returning used into v_used;

  if v_used > p_limit then
    -- Kvoten var redan slut: lämna tillbaka den förbrukning vi just tog, så att räknaren inte
    -- driver iväg för en användare som fortsätter trycka på knappen.
    update public.per_quota_counters
       set used = greatest(0, used - 1)
     where user_id = p_user_id and feature = p_feature and day = v_day;
    return jsonb_build_object('allowed', false, 'used', p_limit, 'limit', p_limit, 'remaining', 0);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - v_used)
  );
end;
$$;

revoke execute on function public.per_consume_daily_quota(uuid, text, integer) from public;
revoke execute on function public.per_consume_daily_quota(uuid, text, integer) from anon;
revoke execute on function public.per_consume_daily_quota(uuid, text, integer) from authenticated;
grant  execute on function public.per_consume_daily_quota(uuid, text, integer) to service_role;

-- ── Feature flag ────────────────────────────────────────────────────────────
-- Av som default. Elevloopen är inert i produktion tills flaggan medvetet slås på, exakt som
-- resten av knowledge engine-ytorna. allowed_user_ids (redan i schemat) styr pilotgruppen och
-- respekteras nu faktiskt av api/knowledge.js (Codex CR-PER-008).
insert into public.feature_flags (key, enabled, configuration)
values ('per_learner_loop_enabled', false,
        '{"description": "P.E.R. elevloop: diagnostisk fraga, bedomning, elevmodell och rekommendation (Fas 9)."}'::jsonb)
on conflict (key) do nothing;
