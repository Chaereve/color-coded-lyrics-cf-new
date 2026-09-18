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
