-- Daily Spin prize table v2 (2026-09-08). Additive, safe to run again.
-- Run AFTER 20260907_daily_spin.sql (a project that already has Daily Spin only
-- needs THIS file). Nothing is deleted and no reward is re-drawn: rows already in
-- the ledger keep their segment/reward, only the sector range widens and the
-- odds of a NEW spin change.
--
-- WHY. Eight equal sectors gave every slice a 1/8 draw, so the +5 jackpot paid
-- exactly as often as the +3 (12.5% each): 2 votes per spin, 4 votes per day,
-- ~20k VND of paid value handed out daily per browser. Sixteen equal sectors keep
-- the draw uniform while the slice the player sees IS the real chance:
--   +1 vote  x9 = 56.25%  |  +2 votes x4 = 25%
--   +3 votes x2 = 12.5%   |  +5 votes x1 = 6.25%
-- Average 1.75 votes/spin (3.5/day, still at most 10/day). No blank sector:
-- every spin wins something, and the jackpot stays worth waiting for.
--
-- 16 divides 256, so ONE cryptographic byte still needs no rejection sampling.
-- The browser renders public.daily_spin_prizes() and animates to the returned
-- sector; it never picks the reward.

begin;

-- The ledger was created with an unnamed `check (segment between 0 and 7)`.
-- Drop whatever that constraint is called on THIS project (a hand-edited install
-- may have renamed it), then widen to the new sector count. Existing rows are
-- 0..7, so validating the new constraint cannot fail on real data.
do $$
declare v_con record;
begin
  for v_con in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'daily_spins' and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%segment%'
  loop
    execute format('alter table public.daily_spins drop constraint %I', v_con.conname);
  end loop;
end $$;

alter table public.daily_spins
  add constraint daily_spins_segment_check check (segment between 0 and 15);

-- Sixteen equal sectors, clockwise from twelve o'clock. Ordered so the four
-- prize tiers keep alternating (no long run of the same value) and the single
-- jackpot sits opposite the pointer, at six o'clock.
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 1, 3, 1, 1, 2, 1, 5, 1, 2, 1, 3, 1, 2, 1];
$$;

-- Re-declared in full: a plpgsql body cannot be patched. Identical to the
-- 2026-09-07 version except for the marked sector draw. Grants/revokes survive
-- `create or replace`, so the browser still reaches only the three entry points.
create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_now timestamptz;
  v_day date;
  v_device_used int;
  v_account_used int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- A sign-out/account switch while registering a browser must not give a spin
  -- intended for A to B. The recipient is ALWAYS auth.uid(), never a client ID.
  if p_expected_user_id is distinct from v_uid then raise exception 'err.spinAccountChanged'; end if;
  if p_request_id is null then raise exception 'err.spinRequest'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);

  -- Always lock device, then profile, in that order. Device lock serializes
  -- different accounts; profile lock serializes the same account across devices
  -- and keeps balance updates atomic with other credit operations.
  perform 1 from public.daily_spin_devices where device_hash = v_hash for update;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Retry BEFORE checking today's quota: a lost response, refresh, or midnight
  -- retry must return the original win, not spend another spin or add credits.
  select * into v_spin from public.daily_spins
    where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_spin.device_hash <> v_hash then raise exception 'err.spinRequest'; end if;
    v_replayed := true;
  else
    -- Capture the day AFTER waiting for locks, using server time, not the client.
    v_now := clock_timestamp();
    v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    -- vvv CHANGED (2026-09-08): sector count comes from the prize array, not a
    -- hard-coded 8. Refuse to draw when it no longer divides 256 — a silent
    -- modulo bias would quietly overpay whoever owns the leftover sectors.
    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;
    -- ^^^ CHANGED
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus shares
    -- the existing credit balance (spent after free votes; never expires daily).
    update public.profiles set vote_credits = vote_credits + v_spin.reward where id = v_uid;
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

-- Restated for safety: helpers stay private even if a superuser granted them
-- away while experimenting, and the three entry points stay callable.
revoke all on function public.daily_spin_prizes() from public, anon, authenticated;
revoke all on function public.spin_daily(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
