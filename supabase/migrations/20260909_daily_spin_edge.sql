-- Daily Spin edge audit (2026-09-09). Additive, safe to run again.
-- Run AFTER 20260908_daily_spin_prizes.sql. Adds two AUDIT columns fed by the
-- Cloudflare Worker shield (sha256 of the browser fingerprint, sha256 of the
-- CF-Connecting-IP) and widens spin_daily() with two optional parameters.
--
-- These columns change NOTHING about quota or rewards: the ledger's unique
-- device/account slots stay the source of truth. They exist so a farm incident
-- can be investigated after the fact ("which hashes hit this account today?")
-- without storing raw IPs or reversible fingerprints. Hashes arrive pre-hashed
-- from the Worker; a caller hitting the RPC directly can send nulls or garbage
-- and the function normalises both to NULL.

begin;

alter table public.daily_spins add column if not exists fp_hash text;
alter table public.daily_spins add column if not exists ip_hash text;
alter table public.daily_spins drop constraint if exists daily_spins_fp_hash_check;
alter table public.daily_spins
  add constraint daily_spins_fp_hash_check check (fp_hash is null or fp_hash ~ '^[a-f0-9]{64}$');
alter table public.daily_spins drop constraint if exists daily_spins_ip_hash_check;
alter table public.daily_spins
  add constraint daily_spins_ip_hash_check check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$');

-- Replace the 3-arg overload with the 5-arg one (defaults keep every existing
-- caller — browser, tests, cron — working unchanged).
drop function if exists public.spin_daily(text, uuid, uuid);

create or replace function public.spin_daily(
  p_device_token text, p_request_id uuid, p_expected_user_id uuid,
  p_fp_hash text default null, p_ip_hash text default null
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

  -- vvv ADDED (2026-09-09): audit-only columns fed by the Edge Worker. They never
  -- influence quota or rewards; garbage from a direct caller becomes NULL.
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;
  -- ^^^ ADDED

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
      segment, reward, created_at, fp_hash, ip_hash
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash
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

-- New signature, same access rule: authenticated callers only.
revoke all on function public.spin_daily(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
