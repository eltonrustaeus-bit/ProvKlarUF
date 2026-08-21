-- Rollback för 20260822_per_cache_store.sql.
-- OBS: api/_per-cache.js skriver via denna funktion. Rullar du tillbaka den måste
-- storeAnswer() samtidigt återgå till en upsert mot tabellen, annars slutar cachen skriva.
drop function if exists public.per_cache_store(text, text, text, text, text, extensions.vector, text, timestamptz);
