-- Color Coded Lyrics — báo cho NGƯỜI GỬI khi bài được duyệt / bị từ chối (2026-12-15)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn
-- (create or replace). Không xoá dữ liệu.
--
-- Vì sao có file này:
--   Bảng `notifications` đã có sẵn hai loại tin `approved` và `denied`, và
--   chuông của người dùng đã có nhóm "Denied" / "Approved" để hiển thị chúng —
--   nhưng KHÔNG có đường nào ghi ra hai loại tin đó. Người gửi bài chỉ biết kết
--   quả bằng cách tự mở bảng ra xem lại. Một quyết định của admin mà người gửi
--   không được báo thì thực tế là chưa xảy ra.
--
--   Chỗ ghi là `admin_review` — hàm DUY NHẤT đổi status sang queued/denied
--   (nút trên web, `admin_review_many` hàng loạt, và RPC gọi tay đều đi qua
--   đây; admin_review_many gọi lại chính nó trong một transaction). Đặt thông
--   báo ở đây nên mọi đường đi đều báo, không phải nhớ gọi thêm ở mỗi nút.
--
-- KHÔNG đổi chữ ký hàm: `admin_review(uuid, boolean, text, text)` -> requests.
-- Chỉ thêm phần ghi tin sau khi UPDATE thành công.

begin;

create or replace function public.admin_review(p_id uuid, p_approve boolean, p_reason text default null, p_video_url text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  v_before text;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_video_url is not null and (length(p_video_url) > 500 or p_video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'err.denyVideo';
  end if;

  /* Trạng thái TRƯỚC khi duyệt: bấm Duyệt hai lần (hoặc duyệt lại một bài đã
     duyệt) không được sinh ra hai tin — người gửi chỉ cần biết một lần. */
  select status into v_before from public.requests where id = p_id for update;

  update public.requests
     set status      = case when p_approve then 'queued' else 'denied' end,
         deny_reason = case when p_approve then null else left(coalesce(p_reason,''),300) end,
         video_url   = case when p_approve then null else nullif(trim(p_video_url), '') end,
         updated_at  = now()
   where id = p_id
  returning * into r;

  if r.id is null then return r; end if;

  /* Chỉ báo khi trạng thái THẬT SỰ đổi, và chỉ khi bài có người gửi (bài nhập
     từ seed/nhập tay có thể không có user_id). `sig` gồm cả trạng thái mới:
     từ chối rồi duyệt lại là hai sự việc khác nhau, cả hai đều đáng biết;
     còn duyệt hai lần cùng trạng thái thì bị index chặn, không sinh tin trùng.
     `reason` giữ nguyên văn lý do (lib/watch.js in nó ra dưới dòng tin) —
     KHÔNG cắt ở đây, cắt là việc của chỗ hiển thị. */
  if v_before is distinct from r.status and r.user_id is not null then
    insert into public.notifications (user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      r.user_id,
      public.song_key(r.artist, r.title),
      case when p_approve then 'approved' else 'denied' end,
      r.id, r.title, r.artist,
      case when p_approve then null else left(coalesce(p_reason, ''), 300) end,
      'review|' || r.id::text || '|' || r.status
    )
    on conflict (user_id, sig) where sig is not null do nothing;
  end if;

  return r;
end $$;

revoke all on function public.admin_review(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_review(uuid, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
