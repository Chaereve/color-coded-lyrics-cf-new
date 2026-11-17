-- 20261231 · Ẩn các request chưa duyệt / chờ thanh toán khỏi bề mặt công khai
--
-- Bối cảnh:
--   Trước đây policy "read requests" trên public.requests là `using (true)`,
--   nên khách và người dùng khác có thể đọc được các hàng `pending`, `denied`
--   hoặc `payment_status = 'awaiting'` ngay qua PostgREST / Realtime, đồng thời
--   `admin_review(id, true)` có thể vô tình đẩy một paid request đang chờ tiền
--   (`payment_status = 'awaiting'`) ra bảng công khai trước khi xác nhận đơn.
--
-- Phạm vi:
--   1. Siết policy "read requests" trên public.requests:
--        - Ai cũng đọc được hàng đã công bố (`status not in ('pending','denied')`
--          và `payment_status <> 'awaiting'`).
--        - Chủ request (`user_id = auth.uid()`) và quản trị viên (`public.is_admin()`)
--          vẫn đọc được đầy đủ hàng riêng / hàng chờ duyệt / hàng bị từ chối.
--   2. Chặn `admin_review(p_id, true, ...)` khi `is_paid` và `payment_status = 'awaiting'`
--      (bắt buộc đi qua `admin_order` xác nhận thanh toán trước; nhánh từ chối
--      `p_approve = false` vẫn hoạt động bình thường).
--   3. `admin_review_many(..., true, ...)` bỏ qua các hàng `payment_status = 'awaiting'`
--      khi duyệt hàng loạt để không làm hỏng cả trang chờ duyệt hỗn hợp.

begin;

alter policy "read requests" on public.requests
  using (
    (status not in ('pending', 'denied') and payment_status <> 'awaiting')
    or (
      case
        when auth.uid() is null then false
        else (user_id = auth.uid() or public.is_admin())
      end
    )
  );

create or replace function public.admin_review(
  p_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_video_url text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  v_before text;
  v_is_paid boolean;
  v_payment_status text;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_video_url is not null and (length(p_video_url) > 500 or p_video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'err.denyVideo';
  end if;

  select status, is_paid, payment_status
    into v_before, v_is_paid, v_payment_status
    from public.requests
   where id = p_id
     for update;

  if p_approve and coalesce(v_is_paid, false) and v_payment_status = 'awaiting' then
    raise exception 'err.paymentAwaitingOrder';
  end if;

  update public.requests
     set status      = case when p_approve then 'queued' else 'denied' end,
         deny_reason = case when p_approve then null else left(coalesce(p_reason,''),300) end,
         video_url   = case when p_approve then null else nullif(trim(p_video_url), '') end,
         updated_at  = now()
   where id = p_id
  returning * into r;

  if r.id is null then return r; end if;

  if v_before is distinct from r.status
     and r.user_id is not null
     and exists (select 1 from public.profiles p where p.id = r.user_id) then
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

revoke all on function public.admin_review(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_review(uuid, boolean, text, text) to authenticated;

create or replace function public.admin_review_many(
  p_ids uuid[],
  p_approve boolean,
  p_reason text default null,
  p_video_url text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  foreach v_id in array p_ids loop
    if exists (
      select 1 from public.requests
       where id = v_id
         and not (p_approve and coalesce(is_paid, false) and payment_status = 'awaiting')
    ) then
      perform public.admin_review(v_id, p_approve, p_reason, p_video_url);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.admin_review_many(uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_many(uuid[], boolean, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
