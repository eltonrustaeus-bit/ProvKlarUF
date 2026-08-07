-- Fix: apply_hp_mastery's `SELECT ... FOR UPDATE` locks nothing when the
-- (user_id, node_id) row doesn't exist yet — a row lock can't be taken on
-- a row that isn't there. Two concurrent first-attempts on the same node
-- both read mastery=0/attempts=0, compute independently, and the final
-- `INSERT ... ON CONFLICT DO UPDATE` lets the second writer clobber the
-- first — a lost update.
--
-- Fix: seed a placeholder row first (INSERT ... ON CONFLICT DO NOTHING),
-- then SELECT ... FOR UPDATE against that guaranteed-existing row. This
-- makes the lock effective on the very first attempt too, serializing
-- concurrent calls exactly like every subsequent attempt already was.

create or replace function public.apply_hp_mastery(
  p_user_id    uuid,
  p_node_id    text,
  p_difficulty real,
  p_correct    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mastery  real;
  v_attempts integer;
  v_expected double precision;
  v_k        integer;
  v_new      real;
begin
  insert into public.hp_mastery (user_id, node_id, mastery, attempts, last_seen, updated_at)
  values (p_user_id, p_node_id, 0, 0, now(), now())
  on conflict (user_id, node_id) do nothing;

  select mastery, attempts
    into v_mastery, v_attempts
  from public.hp_mastery
  where user_id = p_user_id and node_id = p_node_id
  for update;

  v_expected := 1.0 / (1.0 + power(10.0, ((coalesce(p_difficulty, 0.5) * 100.0) - v_mastery) / 40.0));
  v_k := case when v_attempts < 10 then 24 else 12 end;
  v_new := v_mastery + v_k * ((case when p_correct then 1 else 0 end) - v_expected);
  v_new := greatest(0, least(100, v_new));

  update public.hp_mastery
    set mastery = v_new,
        attempts = v_attempts + 1,
        last_seen = now(),
        updated_at = now()
  where user_id = p_user_id and node_id = p_node_id;

  return jsonb_build_object('mastery', v_new, 'attempts', v_attempts + 1);
end;
$$;
-- Grants on this function are unchanged by CREATE OR REPLACE (already
-- restricted to service_role by the original 20260701_hp_fixes.sql).
