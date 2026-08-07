-- Rollback för 20260727_per_learner_loop.sql
--
-- VARNING: drop table student_attempts / student_recommendations RADERAR all insamlad
-- elevevidens (svar, bedömningar, rekommendationer). Kör bara om elevloopen ska avvecklas helt.
-- För att bara STÄNGA AV loopen behövs ingen rollback alls — sätt
-- feature_flags.per_learner_loop_enabled = false, så blir alla elev-ops inerta omedelbart.
--
-- OBS: §A i framåtmigrationen (drop policy exam_questions_select_own) återställs medvetet INTE
-- automatiskt nedan — den policyn var en facitläcka och ingen klient använde den. Återskapa den
-- bara om du uttryckligen vill ha tillbaka direkt klientläsning av frågor inkl. correct_answer:
--   create policy exam_questions_select_own on public.exam_questions
--     for select using (exists (select 1 from public.exam_blueprints eb
--       where eb.id = exam_questions.blueprint_id and eb.user_id = auth.uid()));

drop trigger if exists trg_student_error_events_consistency on public.student_error_events;
drop function if exists public.student_error_events_consistency();

alter table if exists public.student_error_events
  drop constraint if exists student_error_events_source_attempt_id_fkey;

drop table if exists public.student_recommendations;
drop table if exists public.student_attempts;

drop function if exists public.apply_legal_mastery(uuid, uuid, real, real, real, uuid);
drop function if exists public.apply_legal_mastery(uuid, uuid, real, real, real);
drop function if exists public.per_consume_daily_quota(uuid, text, integer);
drop function if exists public.per_refund_daily_quota(uuid, text);
drop table if exists public.per_quota_counters;

-- Återställ ai_usage_events.pipeline_step till ursprunglig enum. Misslyckas om rader med de nya
-- stegen finns kvar — behåll i så fall den bredare constrainten (kostnadshistorik ska inte raderas).
alter table public.ai_usage_events drop constraint if exists ai_usage_events_pipeline_step_check;
alter table public.ai_usage_events add constraint ai_usage_events_pipeline_step_check
  check (pipeline_step in (
    'classify','blueprint','embed','retrieve','generate','validate',
    'verify_blind','verify_compare','repair','assemble','grade',
    'error_classify','mastery_update'
  ));

-- Återställ generation_jobs.job_type till ursprunglig enum. Misslyckas om per_assessment/
-- per_coach-rader finns kvar — radera dem först, eller behåll den bredare constrainten.
alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table public.generation_jobs add constraint generation_jobs_job_type_check
  check (job_type in ('legal_exam_generation'));

-- student_mastery.evidence_quality: kolumnen är additiv och skadar inget om den blir kvar.
-- Avkommentera bara om schemat måste återställas exakt till 20260720-läget.
-- alter table public.student_mastery drop column if exists evidence_quality;

delete from public.feature_flags where key = 'per_learner_loop_enabled';
