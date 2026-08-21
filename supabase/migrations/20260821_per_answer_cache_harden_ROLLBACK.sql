-- Rollback för 20260821_per_answer_cache_harden.sql.
-- Återställer exakt de fyra ändringarna. Rör inte tabellerna, RPC:erna eller flaggan —
-- de ägs av 20260821_per_answer_cache.sql och har sin egen rollback.

alter table public.per_answer_cache drop constraint if exists per_answer_cache_expires_at_rimlig;
alter table public.per_cache_probe  drop constraint if exists per_cache_probe_lane_check;

revoke select on table public.per_cache_probe from service_role;

-- Återskapat med ursprungsmigrationens exakta definition, partiella predikat inkluderat.
create index if not exists idx_per_answer_cache_lookup
  on public.per_answer_cache (lane, fingerprint, payload_hash)
  where status = 'approved';
