-- per_cache_store(): skrivvägen för svarscachen.
--
-- Ersätter den `upsert` med `ignoreDuplicates` som api/_per-cache.js använde. Den hade en tyst
-- och permanent bugg (Codex CR-FINAL-003):
--
--   unique (lane, fingerprint, payload_hash) + "on conflict do nothing" betyder att när en rad
--   väl passerat expires_at kan den ALDRIG ersättas. Läs-RPC:erna filtrerar bort den, och
--   skrivningen vägrar skriva över den. Nyckeln är död för alltid, och cachen slutar tyst
--   fungera för just den frågan — utan felmeddelande, utan spår i sonden.
--
-- Villkoret i DO UPDATE är hela poängen: en LEVANDE rad skrivs fortfarande aldrig över, vilket
-- var skälet till "on conflict do nothing" från början (Codex CR-CACHE-010 — två parallella
-- missar kan ge olika svar, och den första ska vinna). En UTGÅNGEN rad är däremot inte längre
-- ett svar, bara en gravsten, och får ersättas.
--
-- Rollback: 20260822_per_cache_store_ROLLBACK.sql.

create or replace function public.per_cache_store(
  p_lane          text,
  p_payload_hash  text,
  p_fingerprint   text,
  p_question_text text,
  p_answer        text,
  p_embedding     extensions.vector(1536),
  p_status        text,
  p_expires_at    timestamptz
)
returns uuid
language sql
security definer
-- extensions i search_path av samma skäl som per_cache_match: vector-typen bor där.
set search_path = public, extensions
as $$
  insert into public.per_answer_cache
    (lane, payload_hash, fingerprint, question_text, answer, embedding, status, expires_at)
  values
    (p_lane, p_payload_hash, p_fingerprint, p_question_text, p_answer, p_embedding, p_status, p_expires_at)
  on conflict (lane, fingerprint, payload_hash) do update
     set answer        = excluded.answer,
         question_text = excluded.question_text,
         embedding     = excluded.embedding,
         status        = excluded.status,
         created_at    = now(),
         expires_at    = excluded.expires_at,
         -- Ny rad, nya räknare. Att ärva den döda radens hits hade gjort statistiken lögnaktig.
         hits          = 0,
         last_hit_at   = null
   where public.per_answer_cache.expires_at <= now()
  returning id;
$$;

revoke execute on function public.per_cache_store(text, text, text, text, text, extensions.vector, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.per_cache_store(text, text, text, text, text, extensions.vector, text, timestamptz) to service_role;

-- Skrivningen går hädanefter genom funktionen, inte genom PostgREST. Insert-rättigheten på
-- tabellen behövs därför inte längre av service_role — funktionen är security definer.
-- Den lämnas ändå kvar: att ta bort den vore en beteendeändring utan säkerhetsvinst
-- (service_role bypassar RLS oavsett, och kan redan läsa och uppdatera tabellen).
