-- Asynkron provgenerering för skolsidan — steg-claim med lease på generation_jobs.
--
-- BAKGRUND. api/generate-exam.js kör hela pipelinen (generera → deterministisk gate → verifiera +
-- lösa parallellt → svara) inuti ETT HTTP-anrop, och Vercel Hobby ger den 60 sekunder. Det taket
-- är nått: mätningarna visar att varje ytterligare kontrollpass måste samsas om samma budget, och
-- att långsammare modeller helt enkelt hinner timeouta (7 av 12 lösaranrop dog på 25 s).
--
-- Lösningen är inte en frågebank — skolsidans material är lärarens egna anteckningar och kan per
-- definition inte förgenereras. Lösningen är att flytta samma grundade generering ut ur
-- request/response-cykeln: ett steg per funktionsanrop, tillstånd i generation_jobs mellan stegen.
-- Varje enskilt anrop ryms i 60 s medan pipelinens TOTALA budget blir obegränsad.
--
-- Detta lägger till det som saknas för att köra flera steg på samma jobb:
--   1. job_type-värdet 'school_exam_generation'
--   2. lease-kolumner så ett kraschat steg kan tas över igen istället för att låsa jobbet för alltid
--   3. source_material — lärarens inklistrade text, egen kolumn istället för i input_json så att
--      statuspollning kan läsa jobbet utan att dra med sig ~200 000 tecken per anrop
--   4. claim_generation_job() / complete_generation_step() / fail_generation_step() — atomisk
--      claim med FOR UPDATE SKIP LOCKED, så två samtidiga workers aldrig kör samma steg
--
-- Statusenumet rörs INTE: 'generating', 'validating', 'verifying', 'repairing' och 'assembling'
-- finns redan sedan Fas 2 och räcker precis för skolsidans pipeline.
--
-- RLS-princip oförändrad (se 20260720_knowledge_engine_schema.sql): generation_jobs har bara en
-- SELECT-policy för ägaren och ingen skrivpolicy. Funktionerna nedan är security definer och
-- REVOKE:as från anon/authenticated — bara service_role (workern) kan flytta ett jobb framåt.
-- En elev kan alltså läsa sitt eget jobbs status men aldrig påverka den.

-- ── 1. job_type ────────────────────────────────────────────────────────────────
-- OBS: den befintliga checken i produktion tillåter tre värden, inte bara det enda som står i
-- 20260720_knowledge_engine_schema.sql — 'per_assessment' och 'per_coach' tillkom i feat/per
-- (b49fbb5) som ännu inte är mergad till main. Båda bevaras här; att skriva om checken utifrån
-- migrationsfilen istället för utifrån databasen hade tyst tagit bort dem.
alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table public.generation_jobs add constraint generation_jobs_job_type_check
  check (job_type in (
    'legal_exam_generation',
    'per_assessment',
    'per_coach',
    'school_exam_generation'
  ));

-- ── 2. lease + material ────────────────────────────────────────────────────────
alter table public.generation_jobs
  -- Vem som håller jobbet just nu. Ett steg får bara committas av den worker som äger leaset —
  -- annars kan en worker som hängde sig, vaknade efter att leaset gått ut och en annan worker
  -- redan kört klart steget, skriva över det färska resultatet med sitt gamla.
  add column if not exists lease_owner      text,
  add column if not exists lease_expires_at timestamptz,
  -- Räknas upp vid varje claim, nollställs när steget lyckas. Ett steg som kraschar om och om
  -- igen ska ge upp, inte snurra gratis på OpenAI-krediter.
  add column if not exists step_attempts    integer not null default 0 check (step_attempts >= 0),
  -- Lärarens inklistrade material. Egen kolumn (TOAST:as av Postgres) istället för i input_json,
  -- eftersom statuspollning läser jobbraden var par sekund och inte ska betala för materialet.
  add column if not exists source_material  text;

-- Workerns enda fråga: "finns det något jobb att ta?". Partiellt index så det bara täcker rader
-- som fortfarande är i rörelse — completed/failed växer obegränsat och hör inte hemma här.
create index if not exists idx_generation_jobs_claimable
  on public.generation_jobs (job_type, created_at)
  where status in ('queued', 'generating', 'validating', 'verifying', 'repairing', 'assembling');

-- ── 3. claim ───────────────────────────────────────────────────────────────────
-- Plockar ETT jobb och tar lease på det. FOR UPDATE SKIP LOCKED är poängen: två workers som kör
-- samtidigt får olika rader istället för att den ena blockera eller — värre — båda köra samma
-- steg och dubbeldebitera OpenAI-anropet.
--
-- Statusen ändras INTE här. Status betyder "det steg som ska köras", inte "det steg som är klart",
-- så en worker som kraschar mitt i ett steg lämnar jobbet i samma status och nästa worker kör om
-- exakt samma steg när leaset gått ut. Det gör varje steg naturligt återstartbart.
create or replace function public.claim_generation_job(
  p_job_type       text,
  p_worker         text,
  p_lease_seconds  integer default 90
) returns public.generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs;
begin
  if p_worker is null or length(trim(p_worker)) = 0 then
    raise exception 'p_worker krävs';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'p_lease_seconds måste vara > 0';
  end if;

  select * into v_job
  from public.generation_jobs
  where job_type = p_job_type
    and status in ('queued', 'generating', 'validating', 'verifying', 'repairing', 'assembling')
    and (lease_expires_at is null or lease_expires_at < now())
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.generation_jobs
  set lease_owner      = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at       = coalesce(started_at, now()),
      step_attempts    = step_attempts + 1,
      updated_at       = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

-- ── 4. commit ──────────────────────────────────────────────────────────────────
-- Flyttar jobbet till nästa status och släpper leaset. Returnerar false om anroparen inte längre
-- äger jobbet (leaset gick ut och någon annan tog över) — då ska resultatet kastas, inte skrivas.
--
-- p_result merge:as in i result_json istället för att ersätta det, så varje steg kan lägga till
-- sin egen del (frågorna, gate-utfallet, verifierarens dom, lösarens dom) utan att radera de
-- tidigare stegens.
create or replace function public.complete_generation_step(
  p_job_id            uuid,
  p_worker            text,
  p_next_status       text,
  p_next_step         text    default null,
  p_progress_current  integer default null,
  p_result            jsonb   default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.generation_jobs
  set status           = p_next_status,
      step             = coalesce(p_next_step, step),
      progress_current = coalesce(p_progress_current, progress_current),
      result_json      = case
                           when p_result is null then result_json
                           else coalesce(result_json, '{}'::jsonb) || p_result
                         end,
      -- Ett lyckat steg nollställer försöksräknaren: budgeten på 3 försök gäller per steg, inte
      -- per jobb, annars skulle ett långt jobb med ett enda hicka-steg per etapp ge upp i onödan.
      step_attempts    = 0,
      lease_owner      = null,
      lease_expires_at = null,
      error_code       = null,
      error_message_sanitized = null,
      completed_at     = case
                           when p_next_status in ('completed', 'partially_completed')
                           then now() else completed_at
                         end,
      updated_at       = now()
  where id = p_job_id
    and lease_owner = p_worker;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ── 5. fail ────────────────────────────────────────────────────────────────────
-- p_terminal styr skillnaden mellan "försök igen" och "ge upp". Vid retry släpps leaset utan att
-- statusen ändras, så nästa claim kör om samma steg; step_attempts står kvar och är det som till
-- slut tvingar fram ett terminalt fel.
--
-- Bara sanerad text går in i error_message_sanitized — samma regel som api/knowledge.js:203,
-- eftersom eleven kan läsa sin egen jobbrad via SELECT-policyn och råa DB- eller API-fel inte
-- ska hamna där.
create or replace function public.fail_generation_step(
  p_job_id    uuid,
  p_worker    text,
  p_error_code text,
  p_message   text,
  p_terminal  boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.generation_jobs
  set status                  = case when p_terminal then 'failed' else status end,
      error_code              = p_error_code,
      error_message_sanitized = p_message,
      retry_count             = case when p_terminal then retry_count else retry_count + 1 end,
      lease_owner             = null,
      lease_expires_at        = null,
      completed_at            = case when p_terminal then now() else completed_at end,
      updated_at              = now()
  where id = p_job_id
    and lease_owner = p_worker;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ── 6. behörigheter ────────────────────────────────────────────────────────────
-- security definer-funktioner är exekverbara av public som default. Utan dessa revokes skulle
-- vilken inloggad elev som helst kunna claima och flytta ANDRA elevers jobb — funktionerna
-- kollar ägarskap mot lease_owner, inte mot auth.uid(), just för att de är avsedda för workern.
revoke all on function public.claim_generation_job(text, text, integer) from public, anon, authenticated;
revoke all on function public.complete_generation_step(uuid, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fail_generation_step(uuid, text, text, text, boolean) from public, anon, authenticated;
