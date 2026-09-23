
-- =========================================================
-- VOTE HARDENING (2026-11-03) — migrations/20261103_vote_hardening.sql,
-- kept verbatim. Chống race khi vote, hạn mức theo vân tay, hoàn đúng ví khi
-- rút vote, cổng Edge cho cast_vote/spin_daily, admin_order idempotent.
-- Chạy sau khối fingerprint quota ở trên.
-- =========================================================

-- Color Coded Lyrics — siết chống gian lận VOTE (2026-11-03)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại an toàn: chỉ ADD COLUMN /
-- CREATE INDEX / CREATE OR REPLACE FUNCTION, không DROP/TRUNCATE bảng nào.
-- Chạy SAU 20261102_spin_fp_quota.sql.
--
-- ĐỌC TRƯỚC KHI CHẠY. File này vá 8 lỗ hổng đã tìm thấy trong đợt rà soát
-- 2026-09-08 (xem docs/RA-SOAT-2026-09-08.md):
--
--   1. [NẶNG] cast_vote không khoá hàng profiles trước khi đọc hạn mức. Gửi
--      N lượt cast_vote SONG SONG thì cả N đều thấy free_used = 0 → 3×N vote
--      miễn phí thay vì 3. Sửa bằng khoá hàng + hạn mức nằm trong UNIQUE
--      INDEX (cùng triết lý với daily_spins: ràng buộc giữ hạn mức, không
--      phải logic).
--
--   2. [NẶNG] Vote không có bất kỳ tín hiệu chống đa tài khoản nào, trong khi
--      Daily Spin có đủ device/fingerprint/IP. Nay votes lưu fp_hash + ip_hash
--      và MỘT VÂN TAY chỉ có 3 vote miễn phí/ngày dù đổi bao nhiêu tài khoản.
--
--   3. [NẶNG] Ai cũng gọi thẳng PostgREST bằng anon key, nên Turnstile/KV ở
--      Cloudflare Worker có thể đi vòng. Nay có "cổng Edge": khi đã đặt token
--      (public.set_edge_gate_token), cast_vote và spin_daily CHỈ chấp nhận lời
--      gọi kèm token đó — tức chỉ Worker gọi được. Chưa đặt token = cổng tắt,
--      mọi thứ chạy y như cũ.
--
--   4. [VỪA] Rút vote luôn hoàn về vote_credits (ví "đã mua") kể cả khi lúc
--      tiêu lấy từ bonus → bonus né được đợt reset 31/10. Nay mỗi dòng vote
--      ghi rõ tiêu ví nào (credit_kind) và hoàn về đúng ví đó.
--
--   5. [VỪA] admin_order cộng credit mỗi lần gọi → bấm hai lần là cộng đôi.
--      Nay chỉ đơn đang 'awaiting' mới xử lý được.
--
--   6. [VỪA] Chủ request xoá được bài đang có vote của NGƯỜI KHÁC (kể cả vote
--      đã mua) và không ai được hoàn. Nay chặn, admin vẫn xoá được.
--
--   7. [VỪA] paid request bỏ qua rate limit → spam vô hạn request pending +
--      đơn hàng. Nay tối đa 5 paid request đang chờ thanh toán/tài khoản.
--
--   8. [TIỆN ÍCH] recount_request_votes(): dựng lại requests.votes từ bảng
--      votes. Bắt buộc chạy sau khi xoá vote/tài khoản gian lận, nếu không số
--      vote gian lận vẫn treo trên bảng xếp hạng.
--
-- GIỚI HẠN THẬT SỰ (không hứa quá): fingerprint định danh một TRÌNH DUYỆT,
-- không phải một con người. Khi CHƯA bật cổng Edge, kẻ gọi thẳng RPC có thể
-- không gửi fp_hash và thoát hạn mức vân tay — chỉ còn hạn mức tài khoản
-- (3 free/ngày, giờ đã chống được race). Muốn chặn thật thì phải deploy
-- Worker và bật cổng (mục 1 bên dưới).

begin;

-- =========================================================
-- 1. CỔNG EDGE — chỉ Worker mới gọi được RPC nhạy cảm
-- =========================================================
-- Bảng một dòng giữ SHA-256 của token bí mật. token_hash = null nghĩa là
-- cổng TẮT (hành vi y như trước file này). Bảng không cấp quyền cho ai:
-- chỉ hàm security definer đọc được, kể cả admin ngồi trên trình duyệt.
create table if not exists public.edge_gate (
  id         boolean primary key default true check (id),
  token_hash text,
  updated_at timestamptz not null default now()
);
insert into public.edge_gate (id, token_hash) values (true, null)
  on conflict (id) do nothing;

alter table public.edge_gate enable row level security;
revoke all on public.edge_gate from public, anon, authenticated;

-- Đặt / gỡ token. Chạy trong SQL Editor (quyền postgres):
--   select public.set_edge_gate_token('chuỗi-bí-mật-dài-ít-nhất-32-ký-tự');
--   select public.set_edge_gate_token(null);   -- tắt cổng
-- Rồi đặt đúng chuỗi đó cho Worker:  wrangler secret put EDGE_GATE_TOKEN
-- ⚠ CHỈ bật sau khi Worker đã deploy và app đã build với VITE_SPIN_GATE_URL,
--   nếu không mọi lượt vote/quay đều bị từ chối.
create or replace function public.set_edge_gate_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_token is not null and length(btrim(p_token)) < 32 then
    raise exception 'Token phải dài ít nhất 32 ký tự.';
  end if;
  update public.edge_gate
     set token_hash = case
           when p_token is null or btrim(p_token) = '' then null
           else encode(extensions.digest(btrim(p_token), 'sha256'), 'hex') end,
         updated_at = now()
   where id;
end $$;

revoke all on function public.set_edge_gate_token(text) from public, anon, authenticated;
grant execute on function public.set_edge_gate_token(text) to service_role;

-- true = được đi tiếp. Cổng tắt thì luôn true.
create or replace function public.edge_gate_ok(p_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_hash text;
begin
  select token_hash into v_hash from public.edge_gate where id;
  if v_hash is null then return true; end if;
  if p_token is null or length(p_token) < 32 then return false; end if;
  return encode(extensions.digest(p_token, 'sha256'), 'hex') = v_hash;
end $$;

revoke all on function public.edge_gate_ok(text) from public, anon, authenticated;

-- =========================================================
-- 2. BẢNG VOTES — hạn mức nằm trong ràng buộc, không nằm trong logic
-- =========================================================
-- vote_day    : ngày theo giờ VN của lượt vote (khớp my_vote_status).
-- free_slot   : thứ tự 1..3 của vote MIỄN PHÍ trong ngày của một tài khoản.
-- fp_slot     : thứ tự 1..3 của vote MIỄN PHÍ trong ngày của một VÂN TAY.
-- credit_kind : lượt vote này tiêu ví nào — để hoàn đúng ví khi rút lại.
-- fp_hash/ip_hash: dấu vết điều tra (sha256, không lưu IP thô).
alter table public.votes add column if not exists vote_day    date;
alter table public.votes add column if not exists free_slot   smallint;
alter table public.votes add column if not exists fp_slot     smallint;
alter table public.votes add column if not exists credit_kind text;
alter table public.votes add column if not exists fp_hash     text;
alter table public.votes add column if not exists ip_hash     text;

-- Backfill TRƯỚC khi đặt default: nếu thêm cột kèm default thì mọi dòng cũ sẽ
-- mang ngày hôm nay và ăn mất hạn mức free của người dùng trong đúng ngày chạy
-- migration.
update public.votes
   set vote_day = (created_at at time zone 'Asia/Ho_Chi_Minh')::date
 where vote_day is null;

update public.votes
   set credit_kind = case when used_credit then 'purchased' else 'free' end
 where credit_kind is null;

-- Đánh số lại slot cho các vote miễn phí đã có (mỗi tài khoản mỗi ngày 1..3;
-- dòng thứ 4 trở đi của những ngày từng bị khai thác race giữ nguyên null nên
-- không làm vỡ unique index).
with ranked as (
  select id, row_number() over (
           partition by user_id, vote_day order by created_at, id) as rn
  from public.votes
  where used_credit = false and free_slot is null
)
update public.votes v
   set free_slot = r.rn
  from ranked r
 where r.id = v.id and r.rn <= 3;

alter table public.votes alter column vote_day
  set default ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date);
alter table public.votes alter column vote_day set not null;

alter table public.votes drop constraint if exists votes_free_slot_check;
alter table public.votes add constraint votes_free_slot_check
  check (free_slot is null or free_slot between 1 and 3);

alter table public.votes drop constraint if exists votes_fp_slot_check;
alter table public.votes add constraint votes_fp_slot_check
  check (fp_slot is null or fp_slot between 1 and 3);

alter table public.votes drop constraint if exists votes_credit_kind_check;
alter table public.votes add constraint votes_credit_kind_check
  check (credit_kind is null or credit_kind in ('free', 'bonus', 'purchased'));

-- CHỐT CHẶN CUỐI CÙNG cho hạn mức miễn phí. Kể cả khi khoá hàng bên dưới bị
-- lách (hoặc ai đó sửa hàm), database vẫn không thể chứa vote free thứ 4 của
-- một tài khoản trong một ngày.
create unique index if not exists votes_free_quota_idx
  on public.votes (user_id, vote_day, free_slot)
  where free_slot is not null;

-- Cùng một vân tay = cùng 3 vote miễn phí/ngày, dù đăng nhập bao nhiêu tài
-- khoản. Dòng không có vân tay không bị index (giữ hành vi cũ).
create unique index if not exists votes_fp_free_quota_idx
  on public.votes (fp_hash, vote_day, fp_slot)
  where fp_hash is not null and fp_slot is not null;

create index if not exists votes_day_idx on public.votes (vote_day, user_id);
create index if not exists votes_fp_idx  on public.votes (fp_hash, vote_day)
  where fp_hash is not null;
create index if not exists votes_ip_idx  on public.votes (ip_hash, vote_day)
  where ip_hash is not null;

-- =========================================================
-- 3. MY_VOTE_STATUS — đếm theo vote_day cho khớp hạn mức mới
-- =========================================================
create or replace function public.my_vote_status()
returns table (free_used int, free_limit int, credits int, purchased int, bonus int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  return query
    select
      (select count(*)::int from public.votes
        where user_id = v_uid and used_credit = false
          and vote_day = (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date),
      3,
      (select vote_credits + bonus_credits from public.profiles where id = v_uid),
      (select vote_credits from public.profiles where id = v_uid),
      (select bonus_credits from public.profiles where id = v_uid);
end $$;

-- =========================================================
-- 4. CAST_VOTE — khoá hàng, hạn mức vân tay, hoàn đúng ví
-- =========================================================
-- Chữ ký đổi (thêm 3 tham số tuỳ chọn) nên phải bỏ bản 2 tham số, nếu không
-- PostgREST thấy hai overload cùng tên và trả lỗi 300 ambiguous.
drop function if exists public.cast_vote(uuid, int);

create or replace function public.cast_vote(
  p_request_id uuid,
  p_delta int default 1,
  p_fp_hash text default null,
  p_ip_hash text default null,
  p_gate_token text default null
)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_day       date;
  v_new       int;
  v_status    text;
  v_picked    timestamptz;
  v_mine      int;
  v_n         int;
  v_purch     int;
  v_bonus     int;
  v_credit    int;
  v_freeUsed  int;
  v_fpUsed    int := 0;
  v_freeLeft  int;
  v_fpLeft    int;
  v_useFree   int;
  v_useCred   int;
  v_useBonus  int;
  v_usePurch  int;
  v_capped    boolean := false;
  v_refBonus  int;
  v_refPurch  int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  -- Cổng Edge: khi đã bật, chỉ Worker (giữ token) mới vote được. Kẻ gọi thẳng
  -- PostgREST bằng anon key bị chặn ngay tại đây.
  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.voteGate'; end if;

  -- Chỉ nhận hash 64-hex thật; rác từ caller trở thành NULL (không hạn mức
  -- vân tay, giống cách spin_daily đang làm).
  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  select r.status, r.picked_at into v_status, v_picked
    from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then raise exception 'err.voteClosed'; end if;
  -- Up next khoá vote cả hai chiều: số vote lúc chốt là con số làm việc.
  if v_picked is not null then raise exception 'err.voteLocked'; end if;

  -- ★ SỬA LỖI CHÍNH ★ Khoá hàng profiles TRƯỚC khi đọc hạn mức. Mọi lượt vote
  -- của cùng một tài khoản từ nay xếp hàng tuần tự, nên "đọc hạn mức → ghi"
  -- không còn đua nhau được. Thứ tự khoá giống spin_daily (profiles trước,
  -- advisory sau) để hai hàm không bao giờ deadlock lẫn nhau.
  select p.vote_credits, p.bonus_credits into v_purch, v_bonus
    from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  -- Cùng một vân tay từ NHIỀU tài khoản khác nhau thì row lock ở trên không
  -- xếp hàng được; advisory lock lo phần đó. Salt 3 để không đụng spin (1, 2).
  if p_fp_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 3));
  end if;

  v_n     := abs(p_delta);
  v_day   := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_credit := v_purch + v_bonus;

  if p_delta < 0 then
    ------------------------------------------------------------------
    -- Rút lại v_n vote gần nhất của chính mình
    ------------------------------------------------------------------
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, credit_kind, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.credit_kind, v.used_credit
    )
    select
      count(*) filter (where credit_kind = 'bonus'),
      -- Dòng cũ (trước migration này) không có credit_kind: hoàn về ví đã mua
      -- như hành vi cũ, không đoán bừa.
      count(*) filter (where credit_kind = 'purchased'
                          or (credit_kind is null and used_credit))
      into v_refBonus, v_refPurch
    from gone;

    -- ★ SỬA LỖI RỬA BONUS ★ hoàn đúng ví: bonus về bonus (vẫn reset 31/10),
    -- vote đã mua về vote đã mua.
    if coalesce(v_refBonus, 0) > 0 or coalesce(v_refPurch, 0) > 0 then
      update public.profiles
         set bonus_credits = bonus_credits + coalesce(v_refBonus, 0),
             vote_credits  = vote_credits  + coalesce(v_refPurch, 0)
       where id = v_uid;
    end if;

    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    ------------------------------------------------------------------
    -- Thêm v_n vote: miễn phí trước, hết thì bonus, hết nữa mới tới vote đã mua
    ------------------------------------------------------------------
    select count(*)::int into v_freeUsed from public.votes
     where user_id = v_uid and used_credit = false and vote_day = v_day;
    v_freeLeft := greatest(3 - v_freeUsed, 0);

    -- Hạn mức vân tay: đếm CHUNG mọi tài khoản. Đổi tài khoản trên cùng một
    -- trình duyệt vẫn chỉ 3 vote miễn phí/ngày.
    v_fpLeft := v_freeLeft;
    if p_fp_hash is not null then
      select count(*)::int into v_fpUsed from public.votes
       where fp_hash = p_fp_hash and used_credit = false and vote_day = v_day;
      v_fpLeft := greatest(3 - v_fpUsed, 0);
      if v_fpLeft < v_freeLeft then v_capped := true; end if;
    end if;

    v_useFree := least(v_n, v_freeLeft, v_fpLeft);
    v_useCred := v_n - v_useFree;

    if v_useCred > v_credit then
      -- Nói đúng lý do: hết lượt vì trình duyệt này đã dùng hết (nhiều tài
      -- khoản chung một máy), hay đơn giản là hết vote.
      if v_capped and v_useCred > 0 then
        raise exception 'err.voteFpLimit' using detail = v_fpLeft::text;
      end if;
      raise exception 'err.notEnoughVotes' using detail = (v_freeLeft + v_credit)::text;
    end if;

    v_useBonus := least(v_useCred, v_bonus);
    v_usePurch := v_useCred - v_useBonus;

    if v_useCred > 0 then
      update public.profiles
         set bonus_credits = bonus_credits - v_useBonus,
             vote_credits  = vote_credits  - v_usePurch
       where id = v_uid;
    end if;

    insert into public.votes (
      request_id, user_id, used_credit, credit_kind,
      vote_day, free_slot, fp_slot, fp_hash, ip_hash
    )
    select
      p_request_id, v_uid, g.i > v_useFree,
      case when g.i <= v_useFree                then 'free'
           when g.i <= v_useFree + v_useBonus   then 'bonus'
           else 'purchased' end,
      v_day,
      case when g.i <= v_useFree then (v_freeUsed + g.i)::smallint end,
      case when g.i <= v_useFree and p_fp_hash is not null
           then (v_fpUsed + g.i)::smallint end,
      p_fp_hash, p_ip_hash
    from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_freeUsed, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_freeUsed, v_credit;
end $$;

-- =========================================================
-- 5. XOÁ REQUEST — không đốt vote của người khác
-- =========================================================
create or replace function public.delete_my_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_status text; v_owner uuid; v_picked timestamptz; v_others int;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  select user_id, status, picked_at into v_owner, v_status, v_picked
    from public.requests where id = p_id;
  if v_owner is null then raise exception 'err.requestMissing'; end if;

  if public.is_admin() then
    delete from public.requests where id = p_id;
    return;
  end if;

  if v_owner <> v_uid then raise exception 'err.notOwner'; end if;
  if v_status in ('in_progress','completed') then raise exception 'err.deleteLocked'; end if;
  -- hàng đã chốt Up next thì khoá cả xoá (user tự xoá làm vỡ kế hoạch làm việc)
  if v_picked is not null then raise exception 'err.deleteLocked'; end if;

  -- Người khác đã bỏ vote (có thể là vote MUA BẰNG TIỀN) thì chủ request không
  -- được xoá: xoá là cascade mất sạch vote đó và không ai được hoàn.
  select count(*)::int into v_others from public.votes
   where request_id = p_id and user_id <> v_uid;
  if v_others > 0 then
    raise exception 'err.deleteVoted' using detail = v_others::text;
  end if;

  delete from public.requests where id = p_id;
end $$;

-- =========================================================
-- 6. RECOUNT — dựng lại requests.votes từ bảng votes
-- =========================================================
-- Chạy sau khi xoá vote gian lận hoặc xoá tài khoản (cascade xoá votes nhưng
-- KHÔNG trừ bộ đếm requests.votes).
--   select public.recount_request_votes();
create or replace function public.recount_request_votes()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with dung as (
    select r.id, coalesce(count(v.id), 0)::int as thuc_te
      from public.requests r
      left join public.votes v on v.request_id = r.id
     group by r.id
  )
  update public.requests r
     set votes = d.thuc_te, updated_at = now()
    from dung d
   where d.id = r.id and r.votes <> d.thuc_te;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.recount_request_votes() from public, anon, authenticated;
grant execute on function public.recount_request_votes() to service_role;

-- =========================================================
-- 7. ADMIN_ORDER — duyệt một lần là một lần
-- =========================================================
create or replace function public.admin_order(p_order_id uuid, p_approve boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  -- ★ Chỉ đơn đang chờ mới xử lý được: bấm "Đã nhận" hai lần không còn cộng
  -- credit hai lần (trước đây update không lọc theo trạng thái hiện tại).
  update public.orders set status = case when p_approve then 'paid' else 'rejected' end
   where id = p_order_id and status = 'awaiting'
  returning * into o;

  if o.id is null then
    if exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'err.orderLocked';
    end if;
    raise exception 'err.orderMissing';
  end if;

  if p_approve then
    if o.kind = 'votes' then
      update public.profiles set vote_credits = vote_credits + o.qty where id = o.user_id;
    elsif o.kind = 'paid_request' and o.request_id is not null then
      update public.requests
         set status = 'queued', payment_status = 'paid', updated_at = now()
       where id = o.request_id;
    end if;
  else
    if o.kind = 'paid_request' and o.request_id is not null then
      update public.requests set payment_status = 'none' where id = o.request_id;
    end if;
  end if;

  return o;
end $$;

-- =========================================================
-- 8. CREATE_REQUEST — paid request không còn là cửa spam
-- =========================================================
create or replace function public.create_request(
  p_kind text, p_artist text, p_title text,
  p_link text, p_note text, p_paid boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_cnt  int;
  r      public.requests;
begin
  if v_uid is null then raise exception 'err.requestAuth'; end if;

  if length(trim(coalesce(p_artist,''))) = 0 or length(trim(coalesce(p_title,''))) = 0 then
    raise exception 'err.needFields';
  end if;

  if not coalesce(p_paid, false) then
    select count(*) into v_cnt from public.requests
     where user_id = v_uid and is_paid = false
       and created_at > now() - interval '1 hour';
    if v_cnt >= 3 then
      -- key i18n + số qua DETAIL, thay cho câu tiếng Anh cứng trước đây
      raise exception 'err.rateLimit' using detail = '3';
    end if;
  else
    -- ★ Paid request trước đây KHÔNG bị giới hạn gì: một script tạo được hàng
    -- nghìn request pending + đơn hàng awaiting, làm ngập bảng Admin. Nay tối
    -- đa 5 đơn paid đang chờ thanh toán; trả tiền hoặc huỷ bớt là gửi tiếp.
    select count(*) into v_cnt from public.orders
     where user_id = v_uid and kind = 'paid_request' and status = 'awaiting';
    if v_cnt >= 5 then
      raise exception 'err.paidPending' using detail = '5';
    end if;
  end if;

  select name into v_name from public.profiles where id = v_uid;

  insert into public.requests (user_id, kind, artist, title, link, note, requester,
                               is_paid, payment_status, status)
  values (
    v_uid,
    coalesce(nullif(p_kind,''), 'Color Coded Lyrics'),
    left(trim(p_artist),120), left(trim(p_title),160),
    left(coalesce(p_link,''),500), left(coalesce(p_note,''),500),
    coalesce(v_name,'Anonymous'),
    coalesce(p_paid,false),
    case when p_paid then 'awaiting' else 'none' end,
    'pending'
  )
  returning * into r;

  if p_paid then
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id)
    values (v_uid, 'paid_request', 0, 0.75, 20000, r.id);
  end if;

  return r;
end $$;

-- =========================================================
-- 9. SPIN_DAILY — thêm cổng Edge (nội dung còn lại giữ nguyên 20261102)
-- =========================================================
-- Thêm tham số thứ 6 nên phải bỏ bản 5 tham số (tránh 300 ambiguous).
drop function if exists public.spin_daily(text, uuid, uuid, text, text);

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
  v_ip_distinct int;
  v_segment int;
  v_prizes int[] := public.daily_spin_prizes();
  v_sectors int := array_length(public.daily_spin_prizes(), 1);
  v_spin public.daily_spins;
  v_replayed boolean := false;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- ★ Cổng Edge: bật rồi thì gọi thẳng RPC (không qua Worker) bị từ chối, nên
  -- Turnstile + KV + hạn mức vân tay không còn đi vòng được nữa.
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
    if p_ip_hash is not null then
      perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 2));
    end if;

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

-- =========================================================
-- 10. QUYỀN — chữ ký mới, quy tắc cũ: chỉ người đã đăng nhập
-- =========================================================
revoke all on function public.cast_vote(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, int, text, text, text) to authenticated;

revoke all on function public.spin_daily(text, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.spin_daily(text, uuid, uuid, text, text, text) to authenticated;

revoke all on function public.my_vote_status() from public, anon, authenticated;
grant execute on function public.my_vote_status() to authenticated;

grant execute on function public.delete_my_request(uuid) to authenticated;
grant execute on function public.create_request(text,text,text,text,text,boolean) to authenticated;
grant execute on function public.admin_order(uuid,boolean) to authenticated;

commit;

-- PostgREST giữ schema cache cũ một lúc sau khi đổi chữ ký hàm.
notify pgrst, 'reload schema';
