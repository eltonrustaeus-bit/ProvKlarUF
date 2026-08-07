-- Rekonstruktion, inte en ny ändring. Kolumnen finns redan i produktion sedan
-- 2026-08-01 (ledgerpost `20260801193446 add_welcome_sent_at_to_profiles`), men den
-- applicerades utan att någon migrationsfil lades i repot. Filen skrivs här så att
-- repot beskriver den databas som faktiskt körs — se supabase/migrations/README.md.
--
-- Innehållet är avläst ur produktionsschemat, inte gissat:
--   information_schema.columns → timestamp with time zone, is_nullable = YES,
--                                column_default = null
--
-- `if not exists` gör den till en no-op mot den databas som redan har kolumnen, och
-- till en riktig migration mot en ny.
--
-- Vad kolumnen används till: api/signup.js:164 använder den som idempotensvakt för
-- välkomstmejlet. Raden finns redan när mejlet ska skickas, så ett null-värde betyder
-- "inte skickat än". Uppdateringen filtrerar på `.is("welcome_sent_at", null)`
-- (api/signup.js:198, :280), vilket gör att två samtidiga anrop inte kan skicka två mejl
-- — den andra uppdateringen matchar noll rader.

alter table public.profiles
  add column if not exists welcome_sent_at timestamptz;
