-- Color Coded Lyrics — tach rieng bonus tu vong quay va reset hang nam (2026-10-31)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai van an toan: chi co ALTER/ADD
-- column, create or replace function va (neu co) len lich pg_cron. Du lieu giu
-- nguyen, chi cong them cot bonus_credits mac dinh 0.
--
-- Van de: vote da mua va bonus tu vong quay dang chung 1 cot vote_credits. Muon
-- chi bonus tu vong quay bi reset vao cuoi thang 10 hang nam ma vote da mua van
-- giu nguyen, ta tach bonus ra cot rieng bonus_credits.
--   · vote_credits  = vote da mua (KHONG bao gio reset)
--   · bonus_credits = bonus tu vong quay (reset ve 0 vao 31/10 hang nam)
-- Nguoi dung tieu tu tong (vote_credits + bonus_credits); bonus duoc tieu truoc.

begin;

-- 1) Cot bonus rieng, mac dinh 0, khong am.
alter table public.profiles
  add column if not exists bonus_credits int not null default 0;

alter table public.profiles
  drop constraint if exists profiles_bonus_credits_nonneg;

alter table public.profiles
  add constraint profiles_bonus_credits_nonneg check (bonus_credits >= 0);

-- 2) So du hien thi = vote da mua + bonus (giu nguyen khoa tra ve `credits`).
-- PostgreSQL không cho CREATE OR REPLACE đổi RETURNS TABLE,
-- nên xóa function cũ trước khi tạo lại.
-- Chỉ xóa function, không xóa bảng hoặc dữ liệu.
drop function if exists public.my_vote_status();

create or replace function public.my_vote_status()
returns table (free_used int, free_limit int, credits int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  return query
    select
      (select count(*)::int from public.votes
        where user_id = v_uid and used_credit = false
          and created_at >= date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh')
                             at time zone 'Asia/Ho_Chi_Minh'),
      3,
      (select vote_credits + bonus_credits from public.profiles where id = v_uid);
end $$;

-- 3) Payload vong quay cung tra tong (vote da mua + bonus).
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
    'credits', (select p.vote_credits + p.bonus_credits from public.profiles p where p.id = p_uid),
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

-- 4) Vong quay cong vao bonus_credits (khong con cong vao vote_credits).
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

    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash
    ) returning * into v_spin;

    -- Same transaction as the ledger. A failure rolls BOTH back. Bonus from the
    -- wheel goes to its own balance (spent after free votes; reset every Oct 31).
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

-- New signature, same access rule: authenticated callers only.
revoke all on function public.spin_daily(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text) to authenticated;

-- 5) Bo phieu tieu bonus truoc, thieu moi lay tu vote da mua.
create or replace function public.cast_vote(p_request_id uuid, p_delta int default 1)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_new      int;
  v_free     int;
  v_credit   int;
  v_status   text;
  v_picked   timestamptz;
  v_mine     int;
  v_n        int;
  v_freeLeft int;
  v_useFree  int;
  v_useCred  int;
  v_refund   int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  select r.status, r.picked_at into v_status, v_picked from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then
    raise exception 'err.voteClosed';
  end if;
  -- Up next khoa vote ca hai chieu (vote them lan rut lai): so vote luc chot
  -- la con so lam viec, khong cho doi nua.
  if v_picked is not null then
    raise exception 'err.voteLocked';
  end if;

  v_n := abs(p_delta);
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;

  if p_delta < 0 then
    ------------------------------------------------------------------
    -- Rut lai v_n vote gan nhat cua chinh minh
    ------------------------------------------------------------------
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.used_credit
    )
    select count(*) filter (where used_credit) into v_refund from gone;

    if v_refund > 0 then
      -- Hoan tra vao vote da mua (khong keo vao bonus de tranh bi reset nham).
      update public.profiles set vote_credits = vote_credits + v_refund where id = v_uid;
    end if;
    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    ------------------------------------------------------------------
    -- Them v_n vote: tieu vote mien phi truoc, thieu bao nhieu lay tu
    -- tong (bonus tu vong quay duoc tieu truoc, con lai lay vote da mua)
    ------------------------------------------------------------------
    v_freeLeft := greatest(3 - v_free, 0);
    v_useFree  := least(v_n, v_freeLeft);
    v_useCred  := v_n - v_useFree;

    if v_useCred > v_credit then
      RAISE EXCEPTION 'Not enough votes. % left.', (v_freeLeft + v_credit);
    end if;

    if v_useCred > 0 then
      update public.profiles
         set bonus_credits = greatest(0, bonus_credits - v_useCred),
             vote_credits  = vote_credits - greatest(0, v_useCred - bonus_credits)
       where id = v_uid;
    end if;

    insert into public.votes (request_id, user_id, used_credit)
    select p_request_id, v_uid, g.i > v_useFree
      from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_free, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_free, v_credit;
end $$;

-- 6) Reset bonus tu vong quay ve 0. Chay bang pg_cron (xem duoi) hoac thu cong.
create or replace function public.reset_bonus_votes()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.profiles set bonus_credits = 0 where bonus_credits <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.reset_bonus_votes() from public, anon, authenticated;
grant execute on function public.reset_bonus_votes() to service_role;

-- 7) Len lich reset 00:00 ngay 31/10 hang nam. Mui gio server = UTC; tai VN la
--    07:00 ngay 31/10, van trong thang 10. Can bat extension pg_cron tren
--    Supabase (Dashboard > Database > Extensions). Neu chua bat, khoi nay bo qua.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'reset_bonus_votes_oct31',
      '0 0 31 10 *',
      'select public.reset_bonus_votes();'
    );
  end if;
end $$;

commit;

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham / them cot.
notify pgrst, 'reload schema';
