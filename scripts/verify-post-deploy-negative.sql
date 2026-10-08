-- =========================================================
-- Q4 — BẢN TEST ÂM TÍNH (mục 6, docs/DB-MIGRATIONS.md):
-- một UPDATE đổi reward phải bị trigger từ chối.
-- ---------------------------------------------------------
-- Chạy KHÔNG có ON_ERROR_STOP và nằm trong begin/rollback:
--   · trigger có mặt → UPDATE raise err.dailyLoginRewardImmutable, transaction
--     abort, rollback dọn dẹp — không ghi gì;
--   · nếu trigger thiếu → UPDATE chạy nhưng rollback hoàn tác ngay — không
--     ghi gì.
-- Dù kết quả thế nào, production không bị đổi dữ liệu. Workflow kiểm tra
-- stderr của psql phải có err.dailyLoginRewardImmutable (hoặc pass vacuous
-- khi không có dòng reward<>0 nào — trigger khi ấy đã được chứng minh bằng
-- Q3 qua pg_trigger).
-- =========================================================
\echo === Q4: UPDATE đổi reward phải bị từ chối (kỳ vọng lỗi err.dailyLoginRewardImmutable) ===
begin;
update public.daily_login_rewards set reward = 0 where reward <> 0;
rollback;
\echo === Q4 xong (đã rollback — không ghi gì kể cả khi trigger thiếu) ===
