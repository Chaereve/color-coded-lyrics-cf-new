-- Rollback 20261214 — lịch sử theo từng request
--
-- Gỡ ĐÚNG những gì migration thêm: một hàm đọc và một index.
-- KHÔNG xoá dòng nào trong `admin_actions`: lịch sử là sự thật đã xảy ra, gỡ
-- đường đọc không phải lý do để xoá bằng chứng. Mục "Nhật ký" trong bảng quản
-- trị vẫn đọc được toàn bộ (qua admin_actions_page) sau khi chạy file này.
--
-- Mất gì khi chạy: khung sửa của một bài không còn khối "Lịch sử" riêng; web
-- nhận `missingSchema` và tự ẩn khối đó (xem src/lib/db.js).

begin;

drop function if exists public.admin_request_history(uuid, int);
drop index if exists public.admin_actions_target_time_idx;

notify pgrst, 'reload schema';

commit;
