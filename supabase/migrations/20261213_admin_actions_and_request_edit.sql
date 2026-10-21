-- Color Coded Lyrics — nhật ký thao tác quản trị + sửa request đầy đủ (2026-12-13)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn (create … if not
-- exists / create or replace / drop trigger if exists). Không xoá dữ liệu.
--
-- Vì sao có file này:
--   1. Không có chỗ nào ghi lại AI đã duyệt / từ chối / xoá một bài, lúc nào,
--      và đổi từ gì sang gì. Khi chỉ có một admin thì đó là chuyện nhỏ; khi có
--      người thứ hai phụ duyệt thì không còn cách nào tái dựng sự việc.
--      Ghi bằng TRIGGER trên chính bảng: mọi đường đi (nút trên web, RPC,
--      SQL tay trong Dashboard) đều để lại dấu, không phải nhớ gọi hàm log.
--   2. Khung sửa trong bảng quản trị chỉ sửa được tên bài / nghệ sĩ / link
--      video / ba mốc tiến độ. Sửa sai LOẠI BÀI, GHI CHÚ hay cờ "đã trả phí"
--      thì phải xoá rồi tạo lại — mất vote và mất lịch sử. admin_request_edit()
--      mở đúng bốn trường đó, có kiểm giá trị.
--
-- Cả hai phần đều KHÔNG đổi hàm đang chạy: không có create or replace trên
-- admin_review / admin_update / admin_pick_group / delete_my_request.

begin;

-- =========================================================
-- 1. BẢNG NHẬT KÝ
-- ---------------------------------------------------------
-- `label` là ẢNH CHỤP "artist — title" tại lúc thao tác: request bị xoá thì
-- dòng nhật ký vẫn đọc được, thay vì một uuid trơ trọi.
-- `detail` giữ từng cặp cũ → mới, nên câu kể trên web nói được "status:
-- pending → queued" mà không phải đoán lại từ trạng thái hiện tại.
-- =========================================================
create table if not exists public.admin_actions (
  id         bigint generated always as identity primary key,
  actor      uuid references auth.users(id) on delete set null,
  action     text not null,
  target_id  uuid,
  label      text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc, id desc);
create index if not exists admin_actions_target_idx  on public.admin_actions (target_id);

alter table public.admin_actions enable row level security;

/* Đọc: chỉ admin. Ghi: KHÔNG có policy ghi nào — mọi dòng đi vào qua trigger
   security definer bên dưới, nên client không tự chèn được một dòng nhật ký
   giả (ví dụ để đổ tội cho người khác). */
drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read on public.admin_actions
  for select to authenticated using (public.is_admin());

revoke all on public.admin_actions from anon, authenticated;
grant select on public.admin_actions to authenticated;
revoke all on sequence public.admin_actions_id_seq from anon, authenticated;

-- =========================================================
-- 2. TRIGGER GHI NHẬT KÝ
-- ---------------------------------------------------------
-- Chỉ ghi khi NGƯỜI ĐANG GỌI là admin. Hệ quả quan trọng: người dùng tự sửa
-- request của mình (đổi tên bài, xoá khi chưa ai vote) không làm đầy nhật ký
-- quản trị — nhật ký này trả lời câu "admin đã làm gì", không phải "bảng đã
-- đổi gì".
-- Một lần UPDATE đổi nhiều trường thì ghi MỘT dòng, `detail` mang đủ các cặp;
-- thứ tự ưu tiên cách đọc nằm ở src/lib/adminLog.js (một chỗ, không phải ở SQL).
-- =========================================================
create or replace function public.log_admin_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_detail jsonb := '{}'::jsonb;
  v_action text := null;
  v_label  text;
begin
  /* Không có người gọi (job, migration, seed) hoặc người gọi không phải admin:
     không phải việc của nhật ký này. */
  if auth.uid() is null or not public.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    insert into public.admin_actions (actor, action, target_id, label, detail)
    values (auth.uid(), 'delete', old.id,
            left(coalesce(old.artist, '') || ' — ' || coalesce(old.title, ''), 200),
            jsonb_build_object('status', jsonb_build_array(old.status, null)));
    return old;
  end if;

  v_label := left(coalesce(new.artist, '') || ' — ' || coalesce(new.title, ''), 200);

  if new.status is distinct from old.status then
    v_detail := v_detail || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
    v_action := case
      when new.status = 'denied'    then 'deny'
      when new.status = 'queued'    then 'approve'
      when new.status = 'completed' then 'complete'
      else 'requeue'
    end;
  end if;
  if new.picked_at is distinct from old.picked_at then
    v_detail := v_detail || jsonb_build_object('picked_at', jsonb_build_array(old.picked_at, new.picked_at));
    if v_action is null then v_action := case when new.picked_at is null then 'unpick' else 'pick' end; end if;
  end if;
  if new.artist is distinct from old.artist or new.title is distinct from old.title then
    if new.artist is distinct from old.artist then
      v_detail := v_detail || jsonb_build_object('artist', jsonb_build_array(old.artist, new.artist));
    end if;
    if new.title is distinct from old.title then
      v_detail := v_detail || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
    end if;
    if v_action is null then v_action := 'rename'; end if;
  end if;
  if new.requester is distinct from old.requester then
    v_detail := v_detail || jsonb_build_object('requester', jsonb_build_array(old.requester, new.requester));
    if v_action is null then v_action := 'edit'; end if;
  end if;
  if new.kind is distinct from old.kind then
    v_detail := v_detail || jsonb_build_object('kind', jsonb_build_array(old.kind, new.kind));
    if v_action is null then v_action := 'edit'; end if;
  end if;
  if new.note is distinct from old.note then
    v_detail := v_detail || jsonb_build_object('note', jsonb_build_array(old.note, new.note));
    if v_action is null then v_action := 'edit'; end if;
  end if;
  if new.is_paid is distinct from old.is_paid then
    v_detail := v_detail || jsonb_build_object('is_paid', jsonb_build_array(old.is_paid, new.is_paid));
    if v_action is null then v_action := 'edit'; end if;
  end if;
  if new.video_url is distinct from old.video_url then
    v_detail := v_detail || jsonb_build_object('video_url', jsonb_build_array(old.video_url, new.video_url));
    if v_action is null then v_action := 'video'; end if;
  end if;
  if new.done_layout is distinct from old.done_layout
     or new.done_lyrics is distinct from old.done_lyrics
     or new.done_edit   is distinct from old.done_edit then
    v_detail := v_detail || jsonb_build_object(
      'done_layout', jsonb_build_array(old.done_layout, new.done_layout),
      'done_lyrics', jsonb_build_array(old.done_lyrics, new.done_lyrics),
      'done_edit',   jsonb_build_array(old.done_edit,   new.done_edit));
    if v_action is null then v_action := 'progress'; end if;
  end if;

  /* Không có gì đáng ghi (ví dụ chỉ `updated_at` đổi): im lặng. Một nhật ký
     đầy dòng "không đổi gì" thì không ai đọc. */
  if v_detail = '{}'::jsonb then
    return new;
  end if;

  insert into public.admin_actions (actor, action, target_id, label, detail)
  values (auth.uid(), coalesce(v_action, 'edit'), new.id, v_label, v_detail);
  return new;
end $$;

revoke all on function public.log_admin_action() from public, anon, authenticated;

drop trigger if exists requests_admin_audit on public.requests;
create trigger requests_admin_audit
  after update or delete on public.requests
  for each row execute function public.log_admin_action();

/* Đơn hàng cũng là việc admin làm và cũng không có dấu vết nào: "ai xác nhận
   đơn này". Cùng một bảng, cùng một cách đọc. */
create or replace function public.log_admin_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  insert into public.admin_actions (actor, action, target_id, label, detail)
  values (auth.uid(), 'order', new.id,
          left(coalesce(new.kind, 'order') || ' · ' || coalesce(new.qty::text, '') || ' · '
               || coalesce(new.amount_vnd::text, '') || '₫', 200),
          jsonb_build_object('status', jsonb_build_array(old.status, new.status)));
  return new;
end $$;

revoke all on function public.log_admin_order() from public, anon, authenticated;

drop trigger if exists orders_admin_audit on public.orders;
create trigger orders_admin_audit
  after update on public.orders
  for each row execute function public.log_admin_order();

-- =========================================================
-- 3. ĐỌC NHẬT KÝ THEO TRANG
-- ---------------------------------------------------------
-- Trả { total, rows } như admin_comments_page: màn hình nói được "20/340"
-- thay vì lặng lẽ cắt. `rows` không mang theo dữ liệu người dùng nào ngoài
-- tên hiển thị của admin đã thao tác.
-- =========================================================
create or replace function public.admin_actions_page(p_limit int default 20, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit  int := greatest(1, least(100, coalesce(p_limit, 20)));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total  bigint;
  v_rows   jsonb;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  select count(*) into v_total from public.admin_actions;

  with page as (
    select a.id, a.action, a.target_id, a.label, a.detail, a.created_at,
           coalesce(p.name, 'Admin') as actor_name
      from public.admin_actions a
      left join public.profiles p on p.id = a.actor
     order by a.created_at desc, a.id desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', page.id, 'action', page.action, 'target_id', page.target_id,
           'label', page.label, 'detail', page.detail,
           'created_at', page.created_at, 'actor_name', page.actor_name
         ) order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_rows
    from page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke all on function public.admin_actions_page(int, int) from public, anon;
grant execute on function public.admin_actions_page(int, int) to authenticated;

-- =========================================================
-- 4. SỬA ĐẦY ĐỦ MỘT REQUEST
-- ---------------------------------------------------------
-- Bốn trường mà trước đây chỉ sửa được bằng cách xoá rồi tạo lại:
--   p_kind      — phải là một trong bốn loại có thật (khớp KIND_META bên web)
--   p_note      — ghi chú của admin, tối đa 300 ký tự
--   p_is_paid   — cờ "đã trả phí" (đơn đã thanh toán)
--   p_requester — tên người gửi hiển thị
-- null = giữ nguyên, đúng quy ước của admin_update. Hàm KHÔNG đụng status,
-- tiến độ hay picked_at: ba thứ đó có đường riêng, mỗi đường một bộ luật.
-- =========================================================
create or replace function public.admin_request_edit(
  p_id uuid,
  p_kind text default null,
  p_note text default null,
  p_is_paid boolean default null,
  p_requester text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  if p_kind is not null and p_kind not in ('Color Coded Lyrics', 'Full Album', '1 Hour Loop', 'Short') then
    raise exception 'err.requestKind';
  end if;
  if p_requester is not null and length(btrim(p_requester)) = 0 then
    raise exception 'err.needFields';
  end if;

  update public.requests
     set kind       = coalesce(p_kind, kind),
         note       = case when p_note is null then note else left(btrim(p_note), 300) end,
         is_paid    = coalesce(p_is_paid, is_paid),
         requester  = coalesce(nullif(btrim(p_requester), ''), requester),
         updated_at = now()
   where id = p_id
  returning * into r;

  if r.id is null then raise exception 'err.requestMissing'; end if;
  return r;
end $$;

revoke all on function public.admin_request_edit(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.admin_request_edit(uuid, text, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';

commit;
