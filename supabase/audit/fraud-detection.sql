-- =====================================================================
--  COLOR CODED LYRICS — BỘ QUERY RÀ SOÁT GIAN LẬN VOTE
--  Ngày soạn: 2026-09-08 · đi kèm docs/RA-SOAT-2026-09-08.md
--  Chạy ở: Supabase Dashboard → SQL Editor (chạy bằng quyền postgres nên
--  KHÔNG bị RLS chặn — đây là lý do phải chạy ở đây, không phải từ app).
--
--  Nhóm A/B/C/D: CHỈ ĐỌC, chạy bao nhiêu lần cũng được.
--  Nhóm E: CÓ GHI DỮ LIỆU. Đọc kỹ, chạy từng câu, backup trước.
--
--  Múi giờ nghiệp vụ là Asia/Ho_Chi_Minh (giống my_vote_status / spin_day),
--  mọi phép "theo ngày" bên dưới đều quy về múi giờ đó.
-- =====================================================================


-- =====================================================================
-- A. KIỂM TRA TRƯỚC — database đang chạy bản nào?
-- =====================================================================

-- A0. Bốn lớp bảo vệ bắt buộc phải là true. Cái nào false thì chạy
--     supabase/migrations tương ứng TRƯỚC khi điều tra tiếp.
select 'profiles_credits_nonneg (vote_credits >= 0)' as lop_bao_ve,
       exists (select 1 from pg_constraint where conname = 'profiles_credits_nonneg') as ok
union all
select 'RLS votes = chỉ đọc vote của mình',
       exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'votes'
                  and policyname = 'read own votes')
union all
select 'buy_votes kiểm giá phía server',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'buy_votes'
                  and p.prosrc like '%err.priceChanged%')
union all
select 'daily_spins.fp_hash (audit vân tay)',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'daily_spins'
                  and column_name = 'fp_hash')
union all
select 'daily_spins.fp_slot (hạn mức vân tay trong DB)',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'daily_spins'
                  and column_name = 'fp_slot')
union all
select 'cast_vote có khoá hàng profiles (chống race)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'cast_vote'
                  and p.prosrc ilike '%from public.profiles where id = v_uid for update%')
order by ok, lop_bao_ve;


-- A1. Ảnh chụp nhanh quy mô dữ liệu (để biết các query sau nặng cỡ nào).
select
  (select count(*) from public.profiles)                                as so_tai_khoan,
  (select count(*) from public.requests)                                as so_request,
  (select count(*) from public.votes)                                   as so_dong_vote,
  (select count(*) from public.orders where status = 'paid')            as don_da_thanh_toan,
  (select coalesce(sum(vote_credits), 0) from public.profiles)          as tong_credit_da_mua,
  (select coalesce(sum(bonus_credits), 0) from public.profiles)         as tong_bonus,
  (select count(*) from public.daily_spins)                             as so_luot_quay;


-- =====================================================================
-- B. BẰNG CHỨNG CỨNG — không giải thích được bằng hành vi bình thường
-- =====================================================================

-- B1. ★ QUAN TRỌNG NHẤT ★  Quá 3 vote MIỄN PHÍ trong một ngày.
--     Hạn mức cứng là 3/ngày. Bất kỳ dòng nào ở đây = đã khai thác race
--     condition của cast_vote (mục 2.1 trong báo cáo). Không có cách nào
--     đạt được con số này bằng thao tác bình thường trên web.
select
  v.user_id,
  p.name,
  (v.created_at at time zone 'Asia/Ho_Chi_Minh')::date as ngay,
  count(*)                                             as vote_free_da_dung,
  count(*) - 3                                         as vuot_han_muc,
  min(v.created_at)                                    as lan_dau,
  max(v.created_at)                                    as lan_cuoi,
  count(distinct v.request_id)                         as so_bai_khac_nhau
from public.votes v
left join public.profiles p on p.id = v.user_id
where v.used_credit = false
group by 1, 2, 3
having count(*) > 3
order by count(*) desc, ngay desc;


-- B2. Nhiều vote trong cùng một khoảnh khắc (≥4 vote / 2 giây / tài khoản).
--     Người thật phải mở modal, gõ số, bấm nút. Đây là gọi RPC song song.
with buckets as (
  select
    v.user_id,
    floor(extract(epoch from v.created_at) / 2)::bigint as khung_2s,
    count(*)                     as so_vote,
    count(distinct v.request_id) as so_request,
    min(v.created_at)            as bat_dau
  from public.votes v
  group by 1, 2
)
select b.user_id, p.name, b.bat_dau, b.so_vote, b.so_request
from buckets b
left join public.profiles p on p.id = b.user_id
where b.so_vote >= 4
order by b.so_vote desc, b.bat_dau desc;


-- B3. Credit "đã mua" nhiều hơn số credit thực sự đã bán cho tài khoản đó.
--     vote_credits chỉ được tăng bởi admin_order(paid) — hoặc bởi lỗ hổng
--     rửa bonus (mục 2.3: quay → vote → rút → bonus biến thành "đã mua").
--     ⚠ Hai trường hợp DƯƠNG TÍNH GIẢ, loại trừ trước khi kết luận:
--       · lượt quay TRƯỚC 31/10/2026 cộng thẳng vào vote_credits (đúng theo
--         code cũ) — so cột tong_thuong_vong_quay và thời điểm quay;
--       · admin từng cộng credit tay bằng SQL.
select
  p.id as user_id,
  p.name,
  p.vote_credits                as credit_dang_co,
  coalesce(o.da_mua, 0)         as credit_da_mua_that,
  p.vote_credits - coalesce(o.da_mua, 0) as chenh_lech,
  coalesce(s.tong_thuong, 0)    as tong_thuong_vong_quay,
  p.bonus_credits               as bonus_dang_co
from public.profiles p
left join (
  select user_id, sum(qty) as da_mua
  from public.orders
  where kind = 'votes' and status = 'paid'
  group by user_id
) o on o.user_id = p.id
left join (
  select user_id, sum(reward) as tong_thuong
  from public.daily_spins
  group by user_id
) s on s.user_id = p.id
where p.vote_credits > coalesce(o.da_mua, 0)
order by chenh_lech desc;


-- B4. Bộ đếm requests.votes lệch với số dòng thật trong bảng votes.
--     Nguyên nhân thường gặp: đã xoá tài khoản (cascade xoá votes) mà chưa
--     recount, hoặc ai đó sửa tay. Chạy E1 để dựng lại.
select
  r.id, r.artist, r.title, r.status,
  r.votes            as bo_dem,
  count(v.id)::int   as thuc_te,
  r.votes - count(v.id)::int as lech
from public.requests r
left join public.votes v on v.request_id = r.id
group by r.id, r.artist, r.title, r.status, r.votes
having r.votes <> count(v.id)::int
order by abs(r.votes - count(v.id)::int) desc;


-- =====================================================================
-- C. PHÁT HIỆN ĐA TÀI KHOẢN — theo dấu vân tay trình duyệt
--    C1–C4 dùng dữ liệu của Daily Spin (có từ 20260909_daily_spin_edge.sql).
--    C5–C7 dùng chính bảng votes: chỉ chạy được sau khi đã chạy
--    20261103_vote_hardening.sql VÀ deploy Worker (mục 2.2 của báo cáo) —
--    vote trước ngày đó không có fp/ip, đừng kết luận "sạch" cho dữ liệu cũ.
-- =====================================================================

-- C1. ★ Một vân tay trình duyệt gắn với nhiều tài khoản.
--     2 tài khoản: có thể là hai anh em dùng chung máy.
--     4+ tài khoản: gần như chắc chắn là farm.
select
  s.fp_hash,
  count(distinct s.user_id)                                   as so_tai_khoan,
  array_agg(distinct p.name order by p.name)                  as ten_tai_khoan,
  array_agg(distinct s.user_id)                               as user_ids,
  min(s.created_at)                                           as lan_dau,
  max(s.created_at)                                           as lan_cuoi,
  sum(s.reward)                                               as tong_vote_thuong
from public.daily_spins s
left join public.profiles p on p.id = s.user_id
where s.fp_hash is not null
group by s.fp_hash
having count(distinct s.user_id) > 1
order by so_tai_khoan desc, tong_vote_thuong desc;


-- C2. Một device token (trình duyệt do server cấp) gắn với nhiều tài khoản.
--     Bổ sung cho C1: bắt được cả người đổi tài khoản mà không xoá site data.
select
  s.device_hash,
  count(distinct s.user_id)                  as so_tai_khoan,
  array_agg(distinct p.name order by p.name) as ten_tai_khoan,
  array_agg(distinct s.user_id)              as user_ids,
  min(s.created_at)                          as lan_dau,
  max(s.created_at)                          as lan_cuoi
from public.daily_spins s
left join public.profiles p on p.id = s.user_id
group by s.device_hash
having count(distinct s.user_id) > 1
order by so_tai_khoan desc;


-- C3. Một IP sinh ra nhiều vân tay khác nhau trong cùng một ngày.
--     >5 = dấu hiệu anti-detect browser / máy ảo / farm tool
--     (đúng ngưỡng SHIELD_MAX_FP_PER_IP mà Worker đang dùng).
select
  s.ip_hash,
  s.spin_day,
  count(distinct s.fp_hash)  as so_van_tay,
  count(distinct s.user_id)  as so_tai_khoan,
  count(*)                   as so_luot_quay,
  sum(s.reward)              as tong_vote_thuong
from public.daily_spins s
where s.ip_hash is not null
group by s.ip_hash, s.spin_day
having count(distinct s.fp_hash) > 3
order by so_van_tay desc, s.spin_day desc;


-- C4. ★ GHÉP NGƯỢC ★ Lấy một cụm tài khoản nghi vấn (từ C1/C2/C3) và xem
--     cả cụm đã bơm cho bài nào. Đây là query ra quyết định xử lý.
--     >>> DÁN user_ids từ C1/C2 vào mảng dưới đây <<<
with cum as (
  select unnest(array[
    '00000000-0000-0000-0000-000000000000'::uuid   -- thay bằng user_id thật
  ]) as user_id
)
select
  r.id as request_id,
  r.artist, r.title, r.status,
  r.votes                                        as tong_vote_hien_tai,
  count(v.id)                                    as vote_tu_cum_nay,
  round(100.0 * count(v.id) / nullif(r.votes, 0), 1) as phan_tram_tu_cum,
  count(distinct v.user_id)                      as so_acc_trong_cum_da_vote,
  min(v.created_at)                              as vote_dau,
  max(v.created_at)                              as vote_cuoi
from public.votes v
join cum c        on c.user_id = v.user_id
join public.requests r on r.id = v.request_id
group by r.id, r.artist, r.title, r.status, r.votes
order by vote_tu_cum_nay desc;


-- C5. ★ QUERY SỐ MỘT SAU KHI BẬT CỔNG ★ Một vân tay vote bằng nhiều tài khoản.
--     Khác C1 ở chỗ bắt được cả người không bao giờ quay vòng quay.
select
  v.fp_hash,
  count(distinct v.user_id)                                  as so_tai_khoan,
  array_agg(distinct p.name order by p.name)                 as ten_tai_khoan,
  array_agg(distinct v.user_id)                              as user_ids,
  count(*)                                                   as tong_vote,
  count(*) filter (where v.credit_kind = 'free')             as vote_mien_phi,
  count(distinct v.request_id)                               as so_bai_da_bau,
  min(v.created_at)                                          as lan_dau,
  max(v.created_at)                                          as lan_cuoi
from public.votes v
left join public.profiles p on p.id = v.user_id
where v.fp_hash is not null
group by v.fp_hash
having count(distinct v.user_id) > 1
order by so_tai_khoan desc, tong_vote desc;


-- C6. Một IP hash bơm cho cùng một bài từ nhiều vân tay trong một ngày.
--     Lưu ý: 4G/CGNAT ở VN khiến rất nhiều người thật dùng chung một IP, nên
--     đây KHÔNG phải bằng chứng — chỉ là danh sách để soi tiếp bằng C5/C7.
select
  v.ip_hash,
  v.vote_day,
  v.request_id,
  r.artist, r.title,
  count(distinct v.fp_hash) as so_van_tay,
  count(distinct v.user_id) as so_tai_khoan,
  count(*)                  as so_vote
from public.votes v
join public.requests r on r.id = v.request_id
where v.ip_hash is not null
group by v.ip_hash, v.vote_day, v.request_id, r.artist, r.title
having count(distinct v.user_id) > 2
order by so_vote desc, v.vote_day desc;


-- C7. Vote KHÔNG có vân tay sau khi cổng đã bật = đi cửa sau (gọi thẳng
--     PostgREST bằng anon key). Nếu đã đặt EDGE_GATE_TOKEN mà vẫn thấy dòng
--     mới ở đây thì cổng chưa thật sự bật — kiểm tra lại set_edge_gate_token.
select
  v.vote_day,
  count(*)                                        as vote_khong_van_tay,
  count(distinct v.user_id)                       as so_tai_khoan,
  array_agg(distinct v.user_id)                   as user_ids
from public.votes v
where v.fp_hash is null
  and v.created_at > (select coalesce(max(updated_at), '-infinity') from public.edge_gate)
group by v.vote_day
order by v.vote_day desc;


-- =====================================================================
-- D. HÀNH VI BẤT THƯỜNG — không cần fingerprint
-- =====================================================================

-- D1. "Tài khoản chỉ để vote": không gửi request nào, vote dồn vào rất ít bài.
select
  p.id as user_id,
  p.name,
  p.created_at                                                as tao_luc,
  count(v.id)                                                 as tong_vote,
  count(distinct v.request_id)                                as so_bai_da_vote,
  min(v.created_at) - p.created_at                            as vote_sau_khi_tao,
  count(*) filter (where v.used_credit) as vote_bang_credit,
  p.vote_credits, p.bonus_credits
from public.profiles p
join public.votes v on v.user_id = p.id
where not exists (select 1 from public.requests r where r.user_id = p.id)
group by p.id, p.name, p.created_at, p.vote_credits, p.bonus_credits
having count(distinct v.request_id) <= 2 and count(v.id) >= 3
order by tong_vote desc, vote_sau_khi_tao asc;


-- D2. ★ Bài hát bị bơm: tỉ lệ vote đến từ tài khoản mới tạo (≤7 ngày).
--     Bài thật thường <20%. 70–100% + nhiều acc = bơm.
--     Chạy query này TRƯỚC MỖI LẦN chốt Up next.
select
  r.id, r.artist, r.title, r.status, r.picked_at,
  r.votes                                                                  as tong_vote,
  count(v.id)                                                              as vote_co_dong,
  count(*) filter (where p.created_at > v.created_at - interval '7 days')  as vote_tu_acc_moi,
  round(100.0 * count(*) filter (where p.created_at > v.created_at - interval '7 days')
        / nullif(count(v.id), 0), 1)                                       as phan_tram_acc_moi,
  count(distinct v.user_id)                                                as so_nguoi_vote,
  round(count(v.id)::numeric / nullif(count(distinct v.user_id), 0), 1)    as vote_moi_nguoi
from public.requests r
join public.votes v    on v.request_id = r.id
join public.profiles p on p.id = v.user_id
where r.status in ('queued', 'in_progress')
group by r.id, r.artist, r.title, r.status, r.picked_at, r.votes
having count(v.id) >= 5
order by phan_tram_acc_moi desc nulls last, tong_vote desc;


-- D3. Vote đồng loạt: nhiều tài khoản KHÁC NHAU vote cùng một request
--     trong cùng một phút. Người thật rải rác, farm thì dính chùm.
select
  date_trunc('minute', v.created_at)         as phut,
  r.artist, r.title,
  count(distinct v.user_id)                  as so_tai_khoan,
  count(*)                                   as so_vote,
  array_agg(distinct p.name order by p.name) as ai_vote
from public.votes v
join public.requests r on r.id = v.request_id
left join public.profiles p on p.id = v.user_id
group by 1, r.artist, r.title
having count(distinct v.user_id) >= 3
order by so_tai_khoan desc, phut desc;


-- D4. Cặp tài khoản luôn đi chung: cùng vote ≥3 request giống nhau.
--     Ring bỏ phiếu thường lộ ở đây ngay cả khi họ không quay vòng quay.
with cap as (
  select
    least(a.user_id, b.user_id)    as acc_1,
    greatest(a.user_id, b.user_id) as acc_2,
    count(distinct a.request_id)   as so_bai_trung
  from public.votes a
  join public.votes b
    on b.request_id = a.request_id
   and b.user_id > a.user_id
  group by 1, 2
  having count(distinct a.request_id) >= 3
)
select
  c.acc_1, p1.name as ten_1,
  c.acc_2, p2.name as ten_2,
  c.so_bai_trung,
  (select count(distinct request_id) from public.votes where user_id = c.acc_1) as tong_bai_acc_1,
  (select count(distinct request_id) from public.votes where user_id = c.acc_2) as tong_bai_acc_2
from cap c
left join public.profiles p1 on p1.id = c.acc_1
left join public.profiles p2 on p2.id = c.acc_2
order by c.so_bai_trung desc;


-- D5. Tự vote cho request của chính mình (hợp lệ về luật, nhưng là cách
--     bơm bảng xếp hạng rẻ nhất — xem mục 2.5).
select
  p.id as user_id, p.name,
  count(*)                     as vote_cho_bai_cua_minh,
  count(distinct r.id)         as so_bai,
  sum(case when v.used_credit then 1 else 0 end) as bang_credit
from public.votes v
join public.requests r on r.id = v.request_id and r.user_id = v.user_id
left join public.profiles p on p.id = v.user_id
group by p.id, p.name
having count(*) >= 5
order by vote_cho_bai_cua_minh desc;


-- D6. ★ BẢNG ĐIỂM TỔNG HỢP ★ Gộp mọi tín hiệu thành một điểm 0–100.
--     Dùng làm danh sách ưu tiên xem tay, KHÔNG dùng để ban tự động.
with v as (
  select user_id,
         count(*)                                       as tong_vote,
         count(distinct request_id)                     as so_bai,
         count(*) filter (where not used_credit)        as vote_free,
         min(created_at)                                as vote_dau,
         max(created_at)                                as vote_cuoi
  from public.votes group by user_id
),
free_qua_han as (
  select user_id, max(n) as max_free_1_ngay from (
    select user_id, (created_at at time zone 'Asia/Ho_Chi_Minh')::date as d, count(*) as n
    from public.votes where used_credit = false group by 1, 2
  ) x group by user_id
),
burst as (
  select user_id, max(n) as max_vote_2s from (
    select user_id, floor(extract(epoch from created_at) / 2)::bigint as b, count(*) as n
    from public.votes group by 1, 2
  ) y group by user_id
),
fp as (
  select s.user_id, count(distinct s.fp_hash) as van_tay,
         max(anh_em.n) as acc_chung_van_tay
  from public.daily_spins s
  left join lateral (
    select count(distinct s2.user_id) as n
    from public.daily_spins s2 where s2.fp_hash = s.fp_hash
  ) anh_em on true
  group by s.user_id
),
req as (select user_id, count(*) as so_request from public.requests group by user_id)
select
  p.id as user_id, p.name, p.created_at as tao_luc,
  v.tong_vote, v.so_bai, coalesce(r.so_request, 0) as so_request,
  coalesce(f.max_free_1_ngay, 0) as free_nhieu_nhat_1_ngay,
  coalesce(b.max_vote_2s, 0)     as vote_nhieu_nhat_2s,
  coalesce(fp.acc_chung_van_tay, 1) as acc_chung_van_tay,
  p.vote_credits, p.bonus_credits,
  least(100,
      case when coalesce(f.max_free_1_ngay, 0) > 3 then 50 else 0 end            -- bằng chứng cứng
    + case when coalesce(b.max_vote_2s, 0) >= 4 then 25 else 0 end               -- gọi RPC song song
    + case when coalesce(fp.acc_chung_van_tay, 1) >= 3 then 20
           when coalesce(fp.acc_chung_van_tay, 1) = 2 then 8 else 0 end          -- đa tài khoản
    + case when coalesce(r.so_request, 0) = 0 and v.tong_vote >= 5 then 10 else 0 end
    + case when v.so_bai = 1 and v.tong_vote >= 5 then 10 else 0 end             -- dồn một bài
    + case when v.vote_dau < p.created_at + interval '10 minutes' then 5 else 0 end
  ) as diem_nghi_ngo
from public.profiles p
join v on v.user_id = p.id
left join free_qua_han f on f.user_id = p.id
left join burst b        on b.user_id = p.id
left join fp             on fp.user_id = p.id
left join req r          on r.user_id = p.id
order by diem_nghi_ngo desc, v.tong_vote desc
limit 100;


-- =====================================================================
-- E. XỬ LÝ — ⚠️ CÓ GHI DỮ LIỆU ⚠️
--    Backup trước (Supabase → Database → Backups). Chạy từng câu một.
-- =====================================================================

-- E1. Dựng lại bộ đếm requests.votes từ bảng votes.
--     CHẠY SAU MỖI LẦN xoá vote hoặc xoá tài khoản gian lận, nếu không
--     số vote gian lận vẫn nằm trên bảng xếp hạng (mục 1.7).
--     ✅ Từ 2026-11-03 hàm này đã nằm sẵn trong
--        migrations/20261103_vote_hardening.sql — chạy migration đó rồi thì
--        bỏ qua phần create dưới đây, gọi thẳng câu cuối là đủ.
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
  return v_n;   -- số request đã được sửa
end $$;

revoke all on function public.recount_request_votes() from public, anon, authenticated;
grant execute on function public.recount_request_votes() to service_role;

-- chạy:
-- select public.recount_request_votes();


-- E2. Xoá toàn bộ vote của một danh sách tài khoản gian lận + recount,
--     trong CÙNG một transaction (bảng không bao giờ hiện số dở dang).
--     >>> Xem kỹ kết quả C4/D6 rồi mới dán user_id vào đây <<<
/*
begin;
  create temp table ke_gian (user_id uuid primary key) on commit drop;
  insert into ke_gian values
    ('00000000-0000-0000-0000-000000000000');   -- thay bằng user_id thật

  -- xem trước sẽ mất bao nhiêu vote ở bài nào
  select r.artist, r.title, r.votes as truoc, count(v.id) as se_xoa
  from public.votes v
  join ke_gian k on k.user_id = v.user_id
  join public.requests r on r.id = v.request_id
  group by r.id, r.artist, r.title, r.votes
  order by se_xoa desc;

  delete from public.votes v using ke_gian k where k.user_id = v.user_id;
  select public.recount_request_votes();
commit;   -- đổi thành rollback; nếu chỉ muốn xem trước
*/


-- E3. Thu hồi credit của tài khoản gian lận (giữ tài khoản để còn điều tra).
/*
update public.profiles
   set vote_credits = 0, bonus_credits = 0
 where id in ('00000000-0000-0000-0000-000000000000');
*/


-- E4. ĐỀ XUẤT: ban mềm thay vì xoá tài khoản.
--     Xoá tài khoản sẽ cascade xoá luôn votes + requests + lịch sử quay,
--     tức là mất sạch bằng chứng và làm lệch bộ đếm. Ban mềm giữ lại tất cả.
/*
alter table public.profiles add column if not exists is_banned boolean not null default false;

-- rồi thêm vào ĐẦU cast_vote() và create_request():
--   if (select is_banned from public.profiles where id = v_uid) then
--     raise exception 'err.banned';
--   end if;
-- và thêm 'err.banned' vào từ điển src/lib/i18n.jsx.
*/


-- E5. Nhật ký nhanh: ai vote gì trong 24 giờ qua (để đối chiếu khi có báo cáo).
select
  v.created_at,
  p.name as nguoi_vote,
  r.artist || ' — ' || r.title as bai_hat,
  case when v.used_credit then 'credit' else 'free' end as loai,
  r.status
from public.votes v
join public.requests r on r.id = v.request_id
left join public.profiles p on p.id = v.user_id
where v.created_at > now() - interval '24 hours'
order by v.created_at desc
limit 500;
