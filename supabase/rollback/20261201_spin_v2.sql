-- ROLLBACK of 20261201_spin_v2.sql — back to the 16-sector wheel (20261111).
-- Run AFTER reverting the app deploy: an old bundle renders the rewards array
-- the payload returns, so restoring the old functions is enough for clients.
--
-- Safety rails (refuse instead of guessing, same doctrine as 20261129):
--   * refuses while ANY daily_spins row was written in the last 48 hours —
--     players are actively spinning and SQL rollback never claws bonus votes
--     back. Wait for the window to pass, or do a reviewed manual cleanup.
--   * refuses if the ledger is missing entirely (wrong database / order).
--   * rows written by v2 (segment 0..6, rewards 8/10/20) STAY in the ledger —
--     they are history, not wallets. The 16-sector functions never rewrite
--     them; history screens read the reward value, not the segment.
--
-- Restores, in order: daily_spin_prizes() → the 2026-09-08 16-sector array,
-- drops daily_spin_weights(), then re-declares spin_daily (20261111 body) and
-- daily_spin_payload (20261107 body) so no v2 function survives half-rolled-back.
-- Run in a transaction by an owner via psql/SQL editor.

begin;

do $$
declare
  v_recent bigint;
  v_total  bigint;
begin
  if to_regclass('public.daily_spins') is null then
    raise exception 'rollback-refused: daily_spins missing - wrong database or order';
  end if;

  select count(*) into v_total from public.daily_spins;
  select count(*) into v_recent from public.daily_spins
    where created_at > clock_timestamp() - interval '48 hours';

  if v_recent > 0 then
    raise exception 'rollback-refused: % spins in the last 48h (% lifetime) - wait or clean up manually', v_recent, v_total;
  end if;
end $$;

-- 1. Back to the sixteen equal sectors (exact 20260908 body).
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 1, 3, 1, 1, 2, 1, 5, 1, 2, 1, 3, 1, 2, 1];
$$;

-- 1b. The reward CHECK: restore the original narrow (1, 2, 3, 5) ONLY when no
-- v2 prize (8/10/20) exists in the ledger — otherwise keep it widened; the old
-- wheel never pays those values, so a widened check costs nothing and a narrow
-- one would refuse honest history.
do $$
declare v_con record;
begin
  if exists (select 1 from public.daily_spins where reward in (8, 10, 20)) then
    raise notice 'daily_spins_reward_check stays widened: v2 rewards (8/10/20) exist in the ledger';
  else
    for v_con in
      select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
       where nsp.nspname = 'public' and rel.relname = 'daily_spins' and con.contype = 'c'
         and pg_get_constraintdef(con.oid) like '%reward%'
    loop
      execute format('alter table public.daily_spins drop constraint %I', v_con.conname);
    end loop;
    alter table public.daily_spins
      add constraint daily_spins_reward_check check (reward in (1, 2, 3, 5));
  end if;
end $$;

-- 2. The v2 weight table has no meaning on the old wheel.
drop function if exists public.daily_spin_weights();

-- 3. spin_daily back to the 20261111 body (uniform 16-sector draw + streak law).
create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid,
  p_fp_hash text default null, p_ip_hash text default null,
  p_gate_token text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_fp_used int;
  v_fp_slot smallint;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  v_recent int[];
  v_block int;
  v_allowed int[];
  v_byte int;
  v_tries int;
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.spinGate'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;

    if p_fp_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 1));
    end if;

    if exists (
      select 1 from public.daily_spins
       where spin_day = v_day and user_id is distinct from v_uid
         and (device_hash = v_hash or (p_fp_hash is not null and fp_hash = p_fp_hash))
    ) then raise exception 'err.spinDeviceAccount'; end if;

    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    v_fp_used := 0;
    v_fp_slot := null;
    if p_fp_hash is not null then
      select count(*)::int into v_fp_used from public.daily_spins
        where fp_hash = p_fp_hash and spin_day = v_day;
      if v_fp_used >= 2 then raise exception 'err.spinEdgeFp'; end if;
      v_fp_slot := v_fp_used + 1;
    end if;

    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;

    select array_agg(reward) into v_recent from (
      select reward from public.daily_spins
        where device_hash = v_hash
        order by created_at desc, device_slot desc
        limit 2
    ) recent;
    if v_recent is not null and array_length(v_recent, 1) = 2
       and v_recent[1] = v_recent[2] and v_prizes[v_segment + 1] = v_recent[1] then
      v_block := v_recent[1];
      select array_agg(i) into v_allowed
        from generate_subscripts(v_prizes, 1) as i
        where v_prizes[i] <> v_block;
      if v_allowed is not null and array_length(v_allowed, 1) > 0 then
        v_tries := 0;
        loop
          v_byte := get_byte(extensions.gen_random_bytes(1), 0);
          v_tries := v_tries + 1;
          exit when v_byte < 256 - (256 % array_length(v_allowed, 1)) or v_tries >= 8;
        end loop;
        v_segment := v_allowed[(v_byte % array_length(v_allowed, 1)) + 1] - 1;
      end if;
    end if;
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash, fp_slot
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash, v_fp_slot
    ) returning * into v_spin;

    update public.profiles set bonus_credits = bonus_credits + v_spin.reward where id = v_uid;
  end if;

  return jsonb_build_object(
    'spin', jsonb_build_object(
      'request_id', v_spin.request_id, 'reward', v_spin.reward,
      'segment', v_spin.segment, 'created_at', v_spin.created_at, 'day', v_spin.spin_day
    ),
    'replayed', v_replayed,
    'status', public.daily_spin_payload(v_hash, v_uid, clock_timestamp())
  );
end $$;

revoke all on function public.spin_daily(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text, text) to authenticated;

-- 4. Payload back to the 20261107 shape (no `weights` key).
create or replace function public.daily_spin_payload(p_hash text, p_uid uuid, p_now timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  with d as (
    select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day
  ), usage as (
    select d.day,
      (select count(*)::int from public.daily_spins s
       where s.device_hash = p_hash and s.spin_day = d.day) as device_used,
      (select count(*)::int from public.daily_spins s
       where s.user_id = p_uid and s.spin_day = d.day) as account_used
      ,exists (select 1 from public.daily_spins s
        where s.device_hash = p_hash and s.spin_day = d.day and s.user_id is distinct from p_uid) as device_account_blocked
    from d
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', u.day,
    'server_now', p_now,
    'reset_at', (u.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'limit', 2,
    'device_used', u.device_used,
    'account_used', u.account_used,
    'device_account_blocked', u.device_account_blocked,
    'remaining', case when u.device_account_blocked then 0 else greatest(0, 2 - greatest(u.device_used, u.account_used)) end,
    'credits', (select p.vote_credits + p.bonus_credits from public.profiles p where p.id = p_uid),
    'purchased', (select p.vote_credits from public.profiles p where p.id = p_uid),
    'bonus', (select p.bonus_credits from public.profiles p where p.id = p_uid),
    'rewards', public.daily_spin_prizes(),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request_id', s.request_id, 'reward', s.reward,
        'segment', s.segment, 'created_at', s.created_at, 'day', s.spin_day
      ) order by s.created_at desc, s.id)
      from public.daily_spins s where s.user_id = p_uid and s.spin_day = u.day
    ), '[]'::jsonb)
  ) from usage u;
$$;
revoke all on function public.daily_spin_payload(text, uuid, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
