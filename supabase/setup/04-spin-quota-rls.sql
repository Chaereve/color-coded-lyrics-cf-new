
-- Vote status split (2026-11-01, migrations/20261101_vote_status_split.sql):
-- my_vote_status() above already returns (free_used, free_limit, credits,
-- purchased, bonus). Re-declare the spin payload in FULL (a plpgsql/sql body
-- cannot be patched) with the matching 'purchased' and 'bonus' keys beside the
-- total 'credits', so a fresh install ends with the same functions a migrated
-- project has.
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

-- =========================================================
-- DAILY SPIN — FINGERPRINT/IP QUOTA IN POSTGRES (2026-11-02)
-- migrations/20261102_spin_fp_quota.sql, kept verbatim so a fresh
-- install ends with the same functions a migrated project has.
-- =========================================================

-- Daily Spin — chốt hạn mức fingerprint/IP NGAY TRONG Postgres (2026-11-02).
-- Chạy SAU 20261031_bonus_reset.sql (spin_daily 5 tham số hiện hành). Additive,
-- chạy lại an toàn: chỉ ALTER/ADD column, CREATE UNIQUE INDEX và CREATE OR
-- REPLACE function. Dữ liệu cũ giữ nguyên.
--
-- Vì sao: trước đây hạn mức chỉ trông vào device_hash (một token ngẫu nhiên cấp
-- cho từng trình duyệt) còn fp_hash/ip_hash chỉ là hai cột "audit" do Edge
-- Worker gửi sang. Đổi trình duyệt / xoá site data / ẩn danh là được cấp token
-- mới → có 2 lượt mới; gọi thẳng RPC thì chẳng gửi fp/ip gì. Migration này biến
-- Postgres thành nguồn sự thật:
--   · Cột fp_slot + unique index (fp_hash, spin_day, fp_slot): cùng một vân tay
--     dù đổi tài khoản/token/thiết bị cũng chỉ 2 lượt/ngày, chống cả đua tài
--     khoản bằng chính ràng buộc của DB.
--   · spin_daily đếm CHUNG mọi tài khoản theo fp_hash (>=2 → err.spinEdgeFp) và
--     theo ip_hash (quá 5 vân tay khác nhau/ngày → err.spinEdgeIp). Gọi thẳng
--     RPC cũng bị chặn như đi qua Worker.
--
-- Giới hạn thật sự: web KHÔNG thể khoá "một máy vật lý". FingerprintJS định danh
-- một TRÌNH DUYỆT: đổi acc/ẩn danh/xoá data trong cùng dòng trình duyệt thì bị
-- chặn; Chrome↔Firefox trên cùng máy có thể ra ID khác và chỉ còn lớp IP (5 vân
-- tay/IP/ngày) chặn sau. Muốn chặt hơn nữa thì cần OTP điện thoại hoặc
-- Fingerprint Pro / attestation.

begin;

-- 1) fp_slot = thứ tự lượt quay (1..2) của MỘT vân tay trong ngày; NULL khi
--    không gửi vân tay. Kèm unique index phía dưới để khoá chặt ngay trong DB.
alter table public.daily_spins add column if not exists fp_slot smallint;
alter table public.daily_spins drop constraint if exists daily_spins_fp_slot_check;
alter table public.daily_spins
  add constraint daily_spins_fp_slot_check check (fp_slot is null or fp_slot between 1 and 2);

-- Ràng buộc cứng: không thể có hai dòng cùng (fp_hash, spin_day, fp_slot) — đây
-- là chốt chặn sau cùng nếu khoá advisory bên dưới bị lách. Dòng fp_hash NULL
-- không được index (người không gửi vân tay giữ hành vi cũ: không có hạn mức fp).
create unique index if not exists daily_spins_fp_quota_idx
  on public.daily_spins (fp_hash, spin_day, fp_slot)
  where fp_hash is not null;

-- 2) spin_daily: kiểm tra hạn mức fp/ip trong CHÍNH transaction ghi ledger + cộng
--    thưởng. Một lỗi hạn mức rollback toàn bộ, không mất lượt, không mất thưởng.
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
  v_fp_used int;
  v_fp_slot smallint;
  v_ip_distinct int;
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

  -- fingerprint/IP giờ là đầu vào của hạn mức: chỉ nhận hash 64-hex thật; rác từ
  -- caller gọi thẳng RPC trở thành NULL (không có hạn mức fp/ip). Worker đã băm
  -- trước khi chuyển sang.
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

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

    -- Khoá advisory theo fp_hash/ip_hash để các lượt quay trùng vân tay / trùng
    -- IP (từ thiết bị/tài khoản KHÁC nhau — row lock ở trên không xếp hàng được)
    -- chạy tuần tự. Nhờ vậy "đếm → chọn slot" bên dưới không đua nhau; unique
    -- index chỉ còn là chốt chặn sau cùng. Khoá luôn lấy theo cùng một thứ tự
    -- (fp trước, ip sau) nên không deadlock.
    if p_fp_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 1));
    end if;
    if p_ip_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 2));
    end if;

    select count(*)::int into v_device_used from public.daily_spins
      where device_hash = v_hash and spin_day = v_day;
    select count(*)::int into v_account_used from public.daily_spins
      where user_id = v_uid and spin_day = v_day;
    if v_device_used >= 2 then raise exception 'err.spinDeviceLimit'; end if;
    if v_account_used >= 2 then raise exception 'err.spinAccountLimit'; end if;

    -- Hạn mức fingerprint: đếm CHUNG mọi tài khoản, mọi device token. Đổi
    -- acc/token/thiết bị mà cùng vân tay vẫn chỉ 2 lượt/ngày.
    v_fp_used := 0;
    v_fp_slot := null;
    if p_fp_hash is not null then
      select count(*)::int into v_fp_used from public.daily_spins
        where fp_hash = p_fp_hash and spin_day = v_day;
      if v_fp_used >= 2 then raise exception 'err.spinEdgeFp'; end if;
      v_fp_slot := v_fp_used + 1;
    end if;

    -- Hạn mức IP: một IP đã thấy 5 vân tay KHÁC nhau trong ngày thì từ chối vân
    -- tay mới (dấu hiệu anti-detect browser). Khớp worker/shield.js: vân tay đã
    -- biết giữ nguyên 2 lượt riêng của nó.
    if p_ip_hash is not null then
      select count(distinct fp_hash)::int into v_ip_distinct from public.daily_spins
        where ip_hash = p_ip_hash and spin_day = v_day
          and fp_hash is not null
          and fp_hash is distinct from p_fp_hash;
      if v_ip_distinct >= 5 then raise exception 'err.spinEdgeIp'; end if;
    end if;

    if v_sectors is null or v_sectors < 1 or 256 % v_sectors <> 0 then
      raise exception 'err.spinSetup';
    end if;
    v_segment := get_byte(extensions.gen_random_bytes(1), 0) % v_sectors;
    insert into public.daily_spins (
      request_id, user_id, device_hash, spin_day, device_slot, account_slot,
      segment, reward, created_at, fp_hash, ip_hash, fp_slot
    ) values (
      p_request_id, v_uid, v_hash, v_day, v_device_used + 1, v_account_used + 1,
      v_segment, v_prizes[v_segment + 1], v_now, p_fp_hash, p_ip_hash, v_fp_slot
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

notify pgrst, 'reload schema';
commit;

-- =========================================================
-- RLS HARDENING (2026-09-06) — migrations/20260906_rls_hardening.sql,
-- kept verbatim so a fresh install ends with the same policies, constraints
-- and price checks a migrated project has. Trước đây khối này CHỈ nằm trong
-- migration: ai cài mới bằng schema.sql (hoặc chạy lại schema.sql "cho chắc")
-- sẽ mất cả 4 lớp bảo vệ bên dưới. Đừng gỡ nó ra khỏi đây.
-- =========================================================

-- Color Coded Lyrics — RLS hardening (2026-09-06)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai cung an toan.
-- Khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Tai sao can file nay: Supabase mac dinh cap quyen ghi (insert/update/delete)
-- tren cac bang cho anon/authenticated, RLS + policy moi la thu that su chan.
-- Ra soat thay 1 lo ho nang + 3 cho can cung lai:
--
--   1. [NANG] policy "update own profile" cho phep moi user dang nhap PATCH
--      TRUC TIEP bang profiles — tu set is_admin = true (thanh admin) hoac
--      vote_credits = 999999 (vote mien phi vo han), khong can qua ham nao.
--      Va bang cach: xoa policy do + thu hoi quyen ghi truc tiep tren ca 6 bang.
--      Doi ten/avatar van di qua ham update_my_profile() nhu cu (security
--      definer chay quyen owner, khong bi anh huong). Da kiem tra src/:
--      khong cho nao insert/update/delete truc tiep vao bang.
--
--   2. [RIENG TU] bang votes truoc day ai cung doc duoc: lo user_id cua tung
--      luot vote (ai vote cho bai nao). Thu lai chi cho doc hang cua minh
--      (+ admin). Dem tong vote van lay tu cot requests.votes nhu cu; app
--      chi doc votes cua chinh user (db.js: .eq('user_id', uid)) nen khong
--      vo giao dien.
--
--   3. [CHONG GIAN LAN] vote_credits co the bi tru am neu goi cast_vote dong
--      thoi nhieu lan (check truoc, tru sau). Them rang buoc >= 0.
--
--   4. [CHONG GIAN LAN] buy_votes truoc day tin gia client gui len: user co
--      the tao don qty = 1000 kem amount = 0.01 de lua admin duyet. Gio gia
--      phai khop bang gia server (3 goi v3/v10/v30 + mua le 0.19$/5000d),
--      sai la ham nem loi, khong tao don.

-- 1. khoa ghi truc tiep ----------------------------------------------------
drop policy if exists "update own profile" on public.profiles;

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.requests from anon, authenticated;
revoke insert, update, delete on public.votes    from anon, authenticated;
revoke insert, update, delete on public.orders   from anon, authenticated;
revoke insert, update, delete on public.settings from anon, authenticated;
revoke insert, update, delete on public.media    from anon, authenticated;

-- 2. votes: chi doc hang cua minh -------------------------------------------
-- Drop both the old policy name and the final policy name so this whole
-- schema remains safe to run again after a previous run reached this block.
drop policy if exists "read votes" on public.votes;
drop policy if exists "read own votes" on public.votes;
create policy "read own votes" on public.votes
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 3. vote_credits khong bao gio am -------------------------------------------
update public.profiles set vote_credits = 0 where vote_credits < 0;
do $$ begin
  alter table public.profiles
    add constraint profiles_credits_nonneg check (vote_credits >= 0);
exception when duplicate_object then null; end $$;

-- 4. buy_votes: server tu quyet gia ------------------------------------------
create or replace function public.buy_votes(p_pack text, p_qty int, p_usd numeric, p_vnd int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); o public.orders;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_qty <= 0 or p_qty > 100 then raise exception 'err.qty'; end if;

  -- khop 1 trong 3 goi co dinh hoac cong thuc mua le (0.19 USD / 5000 VND 1 vote)
  if not (
    (p_pack = 'v3'  and p_qty = 3  and p_usd = 0.49 and p_vnd = 13000) or
    (p_pack = 'v10' and p_qty = 10 and p_usd = 1.29 and p_vnd = 34000) or
    (p_pack = 'v30' and p_qty = 30 and p_usd = 2.99 and p_vnd = 78000) or
    (p_pack = 'custom' and p_usd = round(0.19 * p_qty, 2) and p_vnd = 5000 * p_qty)
  ) then
    raise exception 'err.priceChanged';
  end if;

  insert into public.orders (user_id, kind, pack, qty, amount_usd, amount_vnd)
  values (v_uid, 'votes', left(p_pack,40), p_qty, p_usd, p_vnd)
  returning * into o;
  return o;
end $$;

-- Kiem tra nhanh sau khi chay:
--   select policyname, cmd from pg_policies where tablename in ('profiles','votes');
