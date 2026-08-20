-- P.E.R Collective — tvärgående lärsignaler över ALLA elever, utan att lagra en enda
-- ny textrad.
--
-- Bakgrunden: api/_per-memory.js har sedan start regeln "Spara aldrig ... exakta
-- frågetexter eller personliga detaljer". Önskemålet "P.E.R ska lära sig av alla elevers
-- frågor och svar" får därför INTE lösas genom att spara frågor och svar. Allt underlag
-- som behövs finns redan: student_attempts (poäng per begrepp och nivå) och
-- student_error_events (error_code — en avidentifierad etikett för missuppfattningen).
-- Den här vyn räknar bara samman det som redan är skrivet.
--
-- TVÅ SPÄRRAR mot att en aggregatsiffra pekar ut en enskild elev:
--   1. k-anonymitet: en begreppsrad syns först vid MIN_STUDENTS distinkta elever, en
--      felkod först vid MIN_STUDENTS_PER_ERROR. Med 13 konton i produktion är en rad
--      byggd på två elever inte statistik, den är två personer.
--   2. Ingen åtkomst för klienter: vyn är REVOKE:ad för anon och authenticated och
--      läses bara av servern med service_role. Vyer i PG17 kör som ägare och kringgår
--      RLS på underliggande tabeller — utan REVOKE hade vyn blivit en väg runt
--      student_attempts egen radpolicy.
--
-- Icke-destruktiv: bara CREATE OR REPLACE VIEW och GRANT/REVOKE. Ingen data rörs.
-- Rollback: 20260820_per_collective_stats_ROLLBACK.sql

create or replace view public.concept_collective_stats as
with attempts as (
  select
    concept_id,
    count(*)                                                  as attempt_count,
    count(distinct user_id)                                   as student_count,
    avg(score)::real                                          as mean_score,
    avg(case when is_correct then 1.0 else 0.0 end)::real     as p_correct,
    avg(case when level = 'E' then score end)::real           as mean_score_e,
    avg(case when level = 'C' then score end)::real           as mean_score_c,
    avg(case when level = 'A' then score end)::real           as mean_score_a
  from public.student_attempts
  where concept_id is not null
  group by concept_id
  having count(distinct user_id) >= 5          -- k-anonymitet, se §1
),
errors as (
  select
    concept_id,
    error_code,
    count(*)                as error_count,
    count(distinct user_id) as error_students,
    row_number() over (partition by concept_id order by count(distinct user_id) desc, count(*) desc) as rn
  from public.student_error_events
  where concept_id is not null
  group by concept_id, error_code
  having count(distinct user_id) >= 3          -- k-anonymitet, se §1
),
top_errors as (
  select concept_id, array_agg(error_code order by rn) as common_error_codes
  from errors
  where rn <= 3
  group by concept_id
)
select
  c.id            as concept_id,
  c.name          as concept_name,
  c.slug          as concept_slug,
  c.subject,
  c.course,
  c.topic,
  a.attempt_count,
  a.student_count,
  round(a.mean_score::numeric, 3)   as mean_score,
  round(a.p_correct::numeric, 3)    as p_correct,
  round(a.mean_score_e::numeric, 3) as mean_score_e,
  round(a.mean_score_c::numeric, 3) as mean_score_c,
  round(a.mean_score_a::numeric, 3) as mean_score_a,
  coalesce(t.common_error_codes, '{}') as common_error_codes
from attempts a
join public.concepts c on c.id = a.concept_id
left join top_errors t on t.concept_id = a.concept_id;

comment on view public.concept_collective_stats is
  'Aggregerade lärsignaler per begrepp över alla elever. k-anonym (>=5 elever per begrepp, '
  '>=3 per felkod). Innehåller ingen elevtext och inga user_id. Endast service_role.';

-- §2: ingen klientåtkomst. Servern läser via service_role.
revoke all on public.concept_collective_stats from anon, authenticated;
grant select on public.concept_collective_stats to service_role;
