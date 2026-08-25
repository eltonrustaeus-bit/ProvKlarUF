-- Rollback för 20260825_per_module_activity.sql.
--
-- Destruktiv för mätdatan, men ofarlig för elever: tabellen bär ingen elevdata
-- och inget som produkten läser vid en förfrågan. Hjärnan på per.html slutar
-- pulsera och ritar varje nod som "ingen mätpunkt", vilket är det ärliga
-- utfallet när mätningen är borta.
drop function if exists public.per_bump_modules(text[]);
drop table if exists public.per_module_activity;
