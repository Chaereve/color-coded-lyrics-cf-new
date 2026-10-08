-- =========================================================
-- ĐỐI CHIẾU SAU KHI DEPLOY — mục 6 của docs/DB-MIGRATIONS.md
-- ---------------------------------------------------------
-- Chạy trên PRODUCTION bằng psql thô (không phải phiên đăng nhập),
-- với ON_ERROR_STOP=1: câu nào lỗi là dừng cả file.
-- File này CHỈ ĐỌC — không câu nào ghi dữ liệu.
--
--   Q0   lịch sử migration: 20261125 phải có đúng 1 dòng
--   Q1   lịch sử reward không đổi: dòng reward = 2 là dữ liệu thật,
--        phải còn nguyên
--   Q2   không còn CHECK toàn bảng trên cột reward (kỳ vọng 0)
--   Q3   trigger bất biến đã cài (kỳ vọng 1 dòng: daily_login_rewards_no_vote)
--   Q0b  số dòng TRƯỚC các bài test ghi (để so với sau)
-- =========================================================
\echo === Q0: lịch sử migration từ 20261121 (20261125 phải có đúng 1 dòng) ===
select version, name from supabase_migrations.schema_migrations
 where version >= '20261121' order by version;

\echo === Q1: lịch sử reward — dòng reward = 2 là dữ liệu thật, phải còn nguyên ===
select reward, count(*) from public.daily_login_rewards group by reward order by reward;

\echo === Q2: số CHECK toàn bảng trên cột reward (kỳ vọng 0) ===
select count(*) as reward_checks from pg_constraint
 where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%reward%';

\echo === Q3: trigger bất biến (kỳ vọng 1 dòng: daily_login_rewards_no_vote) ===
select tgname from pg_trigger
 where tgrelid = 'public.daily_login_rewards'::regclass and not tgisinternal;

\echo === Q0b: số dòng TRƯỚC bài test ghi (daily_login_rewards / activity_days / legacy reward<>0) ===
select (select count(*) from public.daily_login_rewards) as checkin_rows,
       (select count(*) from public.activity_days) as activity_rows,
       (select count(*) from public.daily_login_rewards where reward <> 0) as legacy_rows;
