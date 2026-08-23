-- Rollback för 20260823_learner_profile.sql
--
-- Raderar profiluppgifter permanent. Det är avsiktligt: uppgifterna är
-- personuppgifter om minderåriga och ska inte ligga kvar föräldralösa efter
-- att funktionen rullats tillbaka.

begin;

drop table if exists public.learner_profile_facts;

alter table public.profiles drop constraint if exists profiles_persona_check;
alter table public.profiles drop column if exists persona;
alter table public.profiles drop column if exists onboarded_at;

delete from public.feature_flags where key = 'per_learner_profile_enabled';

commit;
