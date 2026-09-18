-- Daily Spin (2026-09-07). Additive, safe to run again in Supabase SQL Editor.
-- Requires the base schema (profiles + auth). No Edge Function or secret in Vite.
-- IMPORTANT: a device here is a saved browser token, NOT a hardware identity.
-- Signing out does not replace it. Clearing ALL site data / another browser plus
-- another account cannot be reliably detected by a website. Do not use IP as ID.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Opaque 256-bit tokens are issued by the server; only their SHA-256 hashes are
-- stored. Neither a chosen UUID nor a made-up token can claim a fresh quota.
create table if not exists public.daily_spin_devices (
  device_hash   text primary key check (device_hash ~ '^[a-f0-9]{64}$'),
  registered_by uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default clock_timestamp()
);
create index if not exists daily_spin_registration_idx
  on public.daily_spin_devices (registered_by, created_at);

-- This ledger IS the quota. Slots + unique constraints enforce at most two
-- entries per device/day AND account/day, even if callers race in several tabs.
-- Account deletion must not erase the device's already-used daily slots.
create table if not exists public.daily_spins (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null,
  user_id       uuid references auth.users(id) on delete set null,
  device_hash   text not null references public.daily_spin_devices(device_hash),
  spin_day      date not null,
  device_slot   smallint not null check (device_slot between 1 and 2),
  account_slot  smallint not null check (account_slot between 1 and 2),
  segment       smallint not null check (segment between 0 and 7),
  reward        int not null check (reward in (1, 2, 3, 5)),
  created_at    timestamptz not null default clock_timestamp(),
  unique (user_id, request_id),
  unique (device_hash, spin_day, device_slot),
  unique (user_id, spin_day, account_slot)
);

alter table public.daily_spin_devices enable row level security;
alter table public.daily_spins enable row level security;
-- No direct table access, including by an admin in the browser. RPCs expose only
-- the caller's rewards, never the other accounts using a shared device.
revoke all on public.daily_spin_devices, public.daily_spins from public, anon, authenticated;

-- Older schema versions allowed PATCH profiles.vote_credits / is_admin. Bonus
-- credits must not be editable by a client. Profile edits still use their RPC.
drop policy if exists "update own profile" on public.profiles;
revoke insert, update, delete on public.profiles from public, anon, authenticated;

-- Eight equal-sized sectors, in clockwise order. The browser renders this array;
-- it NEVER picks the production reward. Average: 2 votes/spin, 4 votes/day.
create or replace function public.daily_spin_prizes()
returns int[] language sql immutable set search_path = public as $$
  select array[1, 2, 1, 3, 1, 2, 1, 5];
$$;

-- Internal helpers: no client EXECUTE grants.
create or replace function public.daily_spin_device_hash(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'err.spinDevice';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not exists (select 1 from public.daily_spin_devices where device_hash = v_hash) then
    raise exception 'err.spinDevice';
  end if;
  return v_hash;
end $$;

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
    'remaining', greatest(0, 2 - greatest(u.device_used, u.account_used)),
    'credits', (select p.vote_credits from public.profiles p where p.id = p_uid),
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

create or replace function public.register_daily_spin_device()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_now timestamptz;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- Serialize registrations by the same account and cap storage-abuse attempts.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  if (select count(*) from public.daily_spin_devices
      where registered_by = v_uid
        and created_at >= date_trunc('day', v_now at time zone 'Asia/Ho_Chi_Minh')
                          at time zone 'Asia/Ho_Chi_Minh') >= 5 then
    raise exception 'err.spinRegistration';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.daily_spin_devices (device_hash, registered_by, created_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid, v_now);
  return v_token;
end $$;

create or replace function public.my_daily_spin_status(p_device_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hash text;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  v_hash := public.daily_spin_device_hash(p_device_token);
  return public.daily_spin_payload(v_hash, v_uid, clock_timestamp());
end $$;

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

    -- 256 is divisible by 8: cryptographic random byte, uniform, no modulo bias.
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % 8;
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

-- Postgres grants EXECUTE to PUBLIC by default: explicitly revoke on ALL helpers
-- and RPCs, then allow only the three authenticated entry points.
revoke all on function public.daily_spin_prizes() from public, anon, authenticated;
revoke all on function public.daily_spin_device_hash(text) from public, anon, authenticated;
revoke all on function public.daily_spin_payload(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.register_daily_spin_device() from public, anon, authenticated;
revoke all on function public.my_daily_spin_status(text) from public, anon, authenticated;
revoke all on function public.spin_daily(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_daily_spin_device() to authenticated;
grant execute on function public.my_daily_spin_status(text) to authenticated;
grant execute on function public.spin_daily(text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
