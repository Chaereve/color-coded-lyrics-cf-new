-- Rollback 20261215 — báo người gửi khi bài được duyệt / bị từ chối
--
-- Trả `admin_review` về đúng thân cũ: đổi trạng thái, không ghi tin.
-- KHÔNG xoá những tin đã ghi: người dùng đã đọc chúng, và `notifications` là
-- hộp thư của họ chứ không phải bảng điều khiển của mình. Muốn dọn thì xoá
-- riêng theo `sig like 'review|%'`, không phải việc của file rollback.
--
-- Mất gì khi chạy: duyệt/từ chối không còn sinh tin cho người gửi; bảng quản
-- trị, nhật ký và mọi thứ khác không đổi.

begin;

create or replace function public.admin_review(p_id uuid, p_approve boolean, p_reason text default null, p_video_url text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_video_url is not null and (length(p_video_url) > 500 or p_video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'err.denyVideo';
  end if;
  update public.requests
     set status      = case when p_approve then 'queued' else 'denied' end,
         deny_reason = case when p_approve then null else left(coalesce(p_reason,''),300) end,
         video_url   = case when p_approve then null else nullif(trim(p_video_url), '') end,
         updated_at  = now()
   where id = p_id
  returning * into r;
  return r;
end $$;

revoke all on function public.admin_review(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_review(uuid, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
