-- Rollback 20261216 — dựng lại KHUNG của tính năng bình luận
--
-- ⚠️ Dữ liệu bình luận KHÔNG thể khôi phục bằng file này. Bảng bị xoá ở
-- migration 20261216 và nội dung của nó chỉ còn trong bản backup
-- (scripts/backup-db.sh) chụp TRƯỚC ngày chạy migration đó.
-- File này chỉ trả lại cấu trúc để web cũ (hoặc một bản deploy trước) không
-- chết vì thiếu bảng, và để có chỗ đổ dữ liệu từ backup vào.
--
-- Sau khi chạy file này, muốn có ĐẦY ĐỦ hành vi cũ (trigger giới hạn tốc độ,
-- chặn sửa, thông báo, RPC trang quản trị) thì chạy lại theo thứ tự:
--   20260920_request_comments.sql
--   20260921_replies_request_expiry.sql   (phần bình luận trả lời)
--   20260922_comment_notifications.sql
--   20261106_security_audit.sql
--   20261107_comments_spin_fixes.sql
--   20261212_admin_bulk_and_comments_page.sql  (admin_comments_page)
-- Các file đó đều additive/rerunnable; xem docs/DB-MIGRATIONS.md.

begin;

create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.request_comments(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 180),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists request_comments_request_created_idx
  on public.request_comments (request_id, created_at desc);
create index if not exists request_comments_parent_idx
  on public.request_comments (parent_id, created_at asc);

alter table public.request_comments enable row level security;

drop policy if exists request_comments_public_read on public.request_comments;
create policy request_comments_public_read on public.request_comments
  for select using (deleted_at is null);

drop policy if exists request_comments_authenticated_insert on public.request_comments;
create policy request_comments_authenticated_insert on public.request_comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (parent_id is null or exists (
      select 1 from public.request_comments p
       where p.id = request_comments.parent_id
         and p.request_id = request_comments.request_id
    ))
  );

drop policy if exists request_comments_owner_delete on public.request_comments;
create policy request_comments_owner_delete on public.request_comments
  for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

grant select on public.request_comments to anon, authenticated;
grant insert, delete on public.request_comments to authenticated;

notify pgrst, 'reload schema';

commit;
