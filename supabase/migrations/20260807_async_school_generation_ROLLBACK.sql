-- Rollback för 20260807_async_school_generation.sql.
--
-- Ordningen spelar roll: rader med job_type='school_exam_generation' måste bort INNAN checken
-- snävas in igen, annars misslyckas ALTER TABLE ... ADD CONSTRAINT på befintliga rader.
-- Att radera dem är rätt här — utan kolumnerna och funktionerna nedan finns ingen kod som kan
-- köra dem vidare, så de skulle bara ligga kvar som permanent halvfärdiga jobb.

drop function if exists public.fail_generation_step(uuid, text, text, text, boolean);
drop function if exists public.complete_generation_step(uuid, text, text, text, integer, jsonb);
drop function if exists public.claim_generation_job(text, text, integer);

drop index if exists public.idx_generation_jobs_claimable;

delete from public.generation_jobs where job_type = 'school_exam_generation';

alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table public.generation_jobs add constraint generation_jobs_job_type_check
  check (job_type in ('legal_exam_generation', 'per_assessment', 'per_coach'));

alter table public.generation_jobs
  drop column if exists lease_owner,
  drop column if exists lease_expires_at,
  drop column if exists step_attempts,
  drop column if exists source_material;
