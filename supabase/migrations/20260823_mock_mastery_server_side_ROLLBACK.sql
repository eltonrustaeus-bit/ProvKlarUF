-- Rollback för 20260823_mock_mastery_server_side.sql
--
-- Återställer klientens update-rätt. OBS: det återinför att en elev kan skriva
-- sin egen mastery-siffra. Rulla bara tillbaka om api/grade.js samtidigt
-- återgår till att inte skriva mastery serverside.

begin;

drop function if exists public.apply_mock_mastery(uuid, text, text, real, real);

grant select, insert, update on public.user_profiles to authenticated;

create policy user_profiles_update_own on public.user_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

commit;
