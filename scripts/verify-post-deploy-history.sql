-- =========================================================
-- LỊCH SỬ MIGRATION SAU DEPLOY — chạy với psql -A -t (đầu ra thuần số)
-- ---------------------------------------------------------
-- Cột `version` của supabase_migrations.schema_migrations lưu ĐỦ id
-- (tên file không đuôi .sql, vd 20261125_reward_eligibility_and_quota_races),
-- không phải riêng 8 chữ số ngày — xem collectMigrations() trong
-- tools/migrate.mjs. Vì vậy đối chiếu bằng tiền tố '20261125%'.
--
-- Dòng 1: số dòng history của 20261125 — phải đúng 1 sau deploy.
-- Dòng 2: tổng số migration đã ghi — để đối chiếu (40 trước deploy + 1).
-- CHỈ ĐỌC.
-- =========================================================
select count(*) as history_20261125 from supabase_migrations.schema_migrations where version like '20261125%';
select count(*) as total_history from supabase_migrations.schema_migrations;
