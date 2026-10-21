-- Color Coded Lyrics — lịch sử của MỘT request, đọc ngay trong khung sửa (2026-12-14)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn
-- (create or replace / create index if not exists). Không xoá dữ liệu.
--
-- Vì sao có file này:
--   20261213 đã ghi lại mọi thao tác quản trị vào `admin_actions`, nhưng chỉ
--   đọc được ở mục "Nhật ký" — một danh sách toàn cục, mới nhất lên trước.
--   Câu hỏi thật khi đang sửa một bài lại là cục bộ: "bài NÀY đã đi qua những
--   tay nào, ai đổi trạng thái, ai sửa tên". Trả lời bằng danh sách toàn cục
--   nghĩa là cuộn qua hàng trăm dòng của bài khác.
--   Hàm dưới đây lọc đúng `target_id`, cùng hình dạng `{ total, rows }` với
--   admin_actions_page để web chỉ cần một cách đọc.
--
-- Không đổi hàm nào đang chạy: chỉ THÊM một hàm đọc và một index.

begin;

/* Index theo (target_id, created_at desc): truy vấn luôn là "20 dòng mới nhất
   của đúng bài này". Index cũ chỉ có (target_id) nên Postgres vẫn phải đọc hết
   các dòng của bài rồi mới sắp — với bài bị sửa nhiều lần thì đó là toàn bộ
   lịch sử của nó. */
create index if not exists admin_actions_target_time_idx
  on public.admin_actions (target_id, created_at desc, id desc);

create or replace function public.admin_request_history(p_id uuid, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := greatest(1, least(100, coalesce(p_limit, 20)));
  v_total bigint;
  v_rows  jsonb;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  /* Không có id: trả rỗng chứ không ném lỗi — khung sửa vẫn vẽ được, chỉ là
     chưa có gì để kể. */
  if p_id is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  end if;

  select count(*) into v_total from public.admin_actions where target_id = p_id;

  with page as (
    select a.id, a.action, a.target_id, a.label, a.detail, a.created_at,
           coalesce(p.name, 'Admin') as actor_name
      from public.admin_actions a
      left join public.profiles p on p.id = a.actor
     where a.target_id = p_id
     order by a.created_at desc, a.id desc
     limit v_limit
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

revoke all on function public.admin_request_history(uuid, int) from public, anon;
grant execute on function public.admin_request_history(uuid, int) to authenticated;

notify pgrst, 'reload schema';

commit;
