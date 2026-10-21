-- Color Coded Lyrics — gỡ hẳn tính năng bình luận (2026-12-16)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn
-- (drop … if exists). ⚠️ ĐÂY LÀ MIGRATION XOÁ DỮ LIỆU: bảng `request_comments`
-- và toàn bộ bình luận cũ mất hẳn. Đã chốt với chủ site: không cần giữ lại;
-- khôi phục thì phải lấy từ bản backup (scripts/backup-db.sh) trước ngày chạy.
--
-- Vì sao gỡ CẢ database chứ không chỉ ẩn giao diện:
--   · Bảng còn đó nghĩa là vẫn còn trigger ghi `notifications` loại
--     comment/reply/mention, vẫn còn một API công khai (RLS cho anon đọc) cho
--     một tính năng không còn ai dùng — bề mặt tấn công không có chủ.
--   · Không có đường đọc/ghi nào trong web sau bản này, nên dữ liệu còn lại chỉ
--     là thứ không ai nhìn thấy và không ai dọn.
--
-- KHÔNG đụng vào những bảng khác. `notifications` giữ nguyên cấu trúc; chỉ xoá
-- những dòng tin SINH RA TỪ bình luận (chúng trỏ tới nội dung vừa bị xoá, để
-- lại chỉ là link chết trong chuông người dùng).
--
-- THỨ TỰ DƯỚI ĐÂY LÀ THỨ TỰ PHỤ THUỘC, và nó đã sai một lần: xoá hàm trước
-- bảng thì Postgres chặn (`cannot drop function notify_on_comment() because
-- other objects depend on it`) vì ba trigger `request_comments_limits`,
-- `tr_notify_on_comment`, `activity_on_comment` vẫn đang trỏ vào chúng. Bảng đi
-- trước thì trigger biến mất cùng bảng, và các hàm còn lại rơi tự do. Bài học:
-- `drop function` không tự kéo theo trigger — chỉ `drop table` mới làm điều đó.

begin;

-- =========================================================
-- 1. RPC CỦA TAB BÌNH LUẬN TRONG BẢNG QUẢN TRỊ
-- ---------------------------------------------------------
-- Đứng trước bảng: hàm này CHỈ đọc `request_comments`, không có trigger nào
-- trỏ vào nó, nên xoá được ngay cả khi bảng còn.
-- =========================================================
drop function if exists public.admin_comments_page(text, int, int);

-- =========================================================
-- 2. BẢNG (và các trigger/index/policy của nó)
-- ---------------------------------------------------------
-- Đi trước các hàm bên dưới: ba trigger trên bảng này đang giữ chúng lại, và
-- `drop table` là cách duy nhất gỡ trigger mà không phải kể tên từng cái.
-- =========================================================
drop table if exists public.request_comments;

-- =========================================================
-- 3. HÀM CHỈ CÒN DÙNG CHO BÌNH LUẬN
-- =========================================================
drop function if exists public.notify_on_comment();
drop function if exists public.enforce_comment_limits();
drop function if exists public.guard_comment_update();
-- Ba chữ ký: bản gốc () trong schema, hai bản (uuid) / (uuid, uuid) do các
-- migration sửa đổi thêm vào. Drop function KHÔNG khớp theo tiền tố — thiếu một
-- chữ ký là hàm đó sống sót và vẫn hiện trong danh sách RPC của PostgREST.
drop function if exists public.hide_comment_subtree();
drop function if exists public.hide_comment_subtree(uuid, uuid);
drop function if exists public.hide_comment_subtree(uuid);
drop function if exists public.comment_mention_handle(text);

-- =========================================================
-- 4. TIN TRONG CHUÔNG SINH RA TỪ BÌNH LUẬN
-- ---------------------------------------------------------
-- Chỉ ba loại này. `approved` / `denied` / `near` / … là tin về request và
-- đơn hàng — không liên quan bình luận, không được đụng tới.
-- =========================================================
delete from public.notifications where kind in ('comment', 'reply', 'mention');

notify pgrst, 'reload schema';

commit;
