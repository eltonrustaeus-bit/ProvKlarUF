-- Rollback för 20260825_admin_passkeys.sql.
--
-- DESTRUKTIV. Varje registrerad enhet försvinner och måste registreras om.
-- Det låser inte ute någon: per.html erbjuder registrering mot en vanlig
-- lösenordssession med adminroll, och först därefter går sidan att låsa upp.

drop table if exists public.admin_passkey_challenges;
drop table if exists public.admin_passkeys;
