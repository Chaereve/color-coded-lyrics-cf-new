-- =========================================================
-- Q5 — một lần điểm danh không được thưởng gì (mục 6, docs/DB-MIGRATIONS.md)
-- ---------------------------------------------------------
-- Từ phiên psql thô KHÔNG có phiên đăng nhập nên auth.uid() = NULL; hàm
-- claim_daily_login phải từ chối NGAY bằng err.signin (đúng thiết kế
-- fail-closed, đứng trước mọi câu lệnh ghi) và KHÔNG ghi gì. Không thể (và
-- không được) giả làm user thật để ép hàm chạy nhánh ghi trên production.
--
-- Chạy KHÔNG có ON_ERROR_STOP: lỗi ở giữa file không dừng các câu sau.
-- Workflow so số dòng TRƯỚC/SAU: bằng nhau là pass; tăng là có người dùng
-- thật điểm danh đồng thời (production đang live); GIẢM là fail.
-- =========================================================
\echo === Số dòng TRƯỚC khi gọi claim ===
select (select count(*) from public.daily_login_rewards) as checkin_rows,
       (select count(*) from public.activity_days) as activity_rows;

\echo === Q5: claim_daily_login từ phiên không đăng nhập (kỳ vọng lỗi err.signin) ===
select public.claim_daily_login(auth.uid(), (now() at time zone 'Asia/Ho_Chi_Minh')::date);

\echo === Số dòng SAU khi gọi claim (phải bằng TRƯỚC) ===
select (select count(*) from public.daily_login_rewards) as checkin_rows,
       (select count(*) from public.activity_days) as activity_rows;
