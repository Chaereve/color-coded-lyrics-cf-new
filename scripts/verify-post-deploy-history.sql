-- =========================================================
-- LỊCH SỬ MIGRATION SAU DEPLOY — chạy với psql -A -t (đầu ra thuần số)
-- ---------------------------------------------------------
-- Dòng 1: số dòng history của 20261125 — phải đúng 1 sau deploy.
-- Dòng 2: tổng số migration đã ghi — để đối chiếu (40 trước deploy + 1).
-- CHỈ ĐỌC.
-- =========================================================
select count(*) as history_20261125 from supabase_migrations.schema_migrations where version = '20261125';
select count(*) as total_history from supabase_migrations.schema_migrations;
