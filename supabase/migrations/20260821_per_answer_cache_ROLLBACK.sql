-- Rollback för 20260821_per_answer_cache.sql.
-- Tar bort cachen helt. Extensionen 'vector' lämnas kvar — den ägs av
-- 20260722_knowledge_engine_embeddings.sql och används av knowledge_chunks.

drop function if exists public.per_cache_hit(uuid);
drop function if exists public.per_cache_match(text, text, extensions.vector, real, integer);
drop function if exists public.per_cache_get_exact(text, text, text);
drop table if exists public.per_cache_probe;
drop table if exists public.per_answer_cache;
delete from public.feature_flags where key = 'per_answer_cache_enabled';
