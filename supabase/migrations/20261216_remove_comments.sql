-- Color Coded Lyrics — gỡ hẳn tính năng bình luận (2026-12-16)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn
-- (drop … if exists / create or replace). ⚠️ ĐÂY LÀ MIGRATION XOÁ DỮ LIỆU:
-- bảng `request_comments` và toàn bộ bình luận cũ mất hẳn. Đã chốt với chủ
-- site: không cần giữ lại, khôi phục thì phải lấy từ bản backup (scripts/
-- backup-db.sh) trước ngày chạy file này.
--
-- Vì sao gỡ CẢ database chứ không chỉ ẩn giao diện:
--   · Bảng còn đó nghĩa là vẫn còn trigger ghi `notifications` loại
--     comment/reply/mention, vẫn còn một API công khai (RLS cho anon đọc) cho
--     một tính năng không còn ai dùng — bề mặt tấn công không có chủ.
--   · Không có đường đọc/ghi nào trong web sau bản này, nên dữ liệu còn lại chỉ
--     là thứ không ai nhìn thấy và không ai dọn.
--
-- KHÔNG đụng vào những bảng khác. `notifications` giữ nguyên cấu trúc; chỉ
-- xoá những dòng tin SINH RA TỪ bình luận (chúng trỏ tới nội dung vừa bị xoá,
-- để lại chỉ là link chết trong chuông người dùng).
--
-- Thứ tự trong file là thứ tự phụ thuộc: hàm nào đọc bảng thì phải đi trước
-- bảng, nếu không `drop table` sẽ bị chặn (hoặc tệ hơn, CASCADE xoá lây những
-- thứ mình không định xoá).

begin;

-- =========================================================
-- 1. HÀM SINH RA TỪ TÍNH NĂNG BÌNH LUẬN
-- ---------------------------------------------------------
-- Gồm cả `admin_comments_page` (migration 20261212): RPC của tab Bình luận
-- trong bảng quản trị, tab đó cũng bị gỡ ở bản này.
-- =========================================================
drop function if exists public.admin_comments_page(text, int, int);
drop function if exists public.notify_on_comment();
drop function if exists public.hide_comment_subtree(uuid, uuid);
drop function if exists public.hide_comment_subtree(uuid);
drop function if exists public.comment_mention_handle(text);
drop function if exists public.enforce_comment_limits();
drop function if exists public.guard_comment_update();

-- =========================================================
-- 2. TIN TRONG CHUÔNG SINH RA TỪ BÌNH LUẬN
-- ---------------------------------------------------------
-- Chỉ ba loại này. `approved` / `denied` / `near` / … là tin về request và
-- đơn hàng, không liên quan bình luận — không được đụng tới.
delete from public.notifications where kind in ('comment', 'reply', 'mention');

-- =========================================================
-- 3. BẢNG
-- ---------------------------------------------------------
-- Trigger trên bảng (giới hạn tốc độ, chặn sửa, đếm activity_days, thông báo)
-- tự biến mất cùng bảng. Index và policy cũng vậy.
drop table if exists public.request_comments;

notify pgrst, 'reload schema';

commit;
