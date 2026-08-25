-- Rollback för 20260825_admin_recovery_codes.sql.
--
-- DESTRUKTIV. Återställningskoden försvinner. Kör den ALDRIG utan att först
-- ha öppnat registreringen igen — annars finns ingen väg tillbaka den dag
-- båda enheterna är borta.
drop table if exists public.admin_recovery_codes;
