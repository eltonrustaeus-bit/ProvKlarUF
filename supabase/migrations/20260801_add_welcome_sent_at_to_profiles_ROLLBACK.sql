-- Rollback för 20260801_add_welcome_sent_at_to_profiles.sql.
--
-- VARNING: kolumnen är i aktiv användning. api/signup.js läser och skriver den som
-- idempotensvakt för välkomstmejlet, så att droppa den gör att `select welcome_sent_at`
-- i api/signup.js:178 börjar fela — och om koden ändras till att tåla det skickas ett
-- nytt välkomstmejl till varje befintlig användare vid nästa inloggning.
--
-- Kör bara den här filen om kolumnen ska bort på riktigt, tillsammans med koden som
-- använder den. Den finns för fullständighetens skull enligt repots parkonvention, inte
-- för att den förväntas köras.

alter table public.profiles
  drop column if exists welcome_sent_at;
