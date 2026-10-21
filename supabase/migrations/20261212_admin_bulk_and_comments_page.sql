-- Color Coded Lyrics — thao tác hàng loạt NGUYÊN TỬ + trang bình luận (2026-12-12)
--
-- Chạy 1 lần trong Supabase SQL Editor. Chạy lại vẫn an toàn: file chỉ có
-- create or replace function + grant, không DROP/TRUNCATE bảng nào, dữ liệu
-- giữ nguyên.
--
-- Vì sao có file này:
--   1. Bảng quản trị chạy thao tác hàng loạt bằng cách gọi admin_review /
--      admin_update / admin_pick_group LẦN LƯỢT từng id. 20 dòng là 20 vòng
--      mạng; hỏng giữa chừng thì nửa danh sách đã đổi mà không ai biết đã
--      đổi tới đâu. Bốn hàm *_many dưới đây gộp vòng lặp vào MỘT transaction
--      (một câu lệnh SQL = một transaction), nên hoặc tất cả cùng xong, hoặc
--      không dòng nào đổi.
--   2. Mục Bình luận đọc đúng 100 dòng mới nhất rồi vẽ hết: quá 100 bình luận
--      thì phần còn lại biến mất mà màn hình không nói gì, và không có ô tìm.
--      admin_comments_page() lọc + đếm + cắt trang trong database, trả về
--      { total, rows } trong một lần gọi.
--
-- Không hàm nào tự quyết quyền: cả năm đều kiểm public.is_admin() trước khi
-- làm bất cứ việc gì, và chỉ cấp execute cho role authenticated.

begin;

-- =========================================================
-- 0. Bỏ dấu tiếng Việt — cùng luật với fold() trong src/lib/board.js
-- ---------------------------------------------------------
-- Cần cho ô tìm của mục Bình luận: người soát gõ "chung ha" phải tìm ra
-- "Chung Hạ". Không dùng extension unaccent (project có thể chưa bật, và bật
-- extension không phải việc một migration dữ liệu nên làm); bảng dịch dưới
-- đây chỉ gồm đúng các ký tự tiếng Việt có dấu, xếp theo nguyên âm.
-- =========================================================
create or replace function public.admin_fold(p_text text)
returns text language sql immutable parallel safe as $$
  select translate(
    lower(coalesce(p_text, '')),
    'aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵđ',
    'aaaaaaaaaaaaaaaaaaeeeeeeeeeeeeiiiiiioooooooooooooooooouuuuuuuuuuuuyyyyyyd'
  )
$$;

revoke all on function public.admin_fold(text) from public, anon;
grant execute on function public.admin_fold(text) to authenticated;

-- =========================================================
-- 1. DUYỆT / TỪ CHỐI NHIỀU DÒNG — một transaction
-- ---------------------------------------------------------
-- Gọi lại chính admin_review() cho từng id: mọi luật của một lần duyệt (status,
-- deny_reason, video_url, updated_at) chỉ nằm ở MỘT chỗ, nên bản nhiều-dòng
-- không thể lệch luật với nút bấm trên từng hàng.
-- Trả về số id CÓ THẬT đã xử lý; id đã bị xoá ở tab khác thì bỏ qua, không
-- làm hỏng cả lượt.
-- =========================================================
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
  -- Trần 200: một lượt bấm của con người không vượt quá một trang danh sách
  -- vài chục lần; con số này chỉ để một request lỗi không khoá bảng quá lâu.
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  foreach v_id in array p_ids loop
    if exists (select 1 from public.requests where id = v_id) then
      perform public.admin_review(v_id, p_approve, p_reason, p_video_url);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.admin_review_many(uuid[], boolean, text, text) from public, anon;
grant execute on function public.admin_review_many(uuid[], boolean, text, text) to authenticated;

-- =========================================================
-- 2. GHI CÙNG MỘT PATCH CHO NHIỀU DÒNG — một transaction
-- ---------------------------------------------------------
-- Chữ ký giống hệt admin_update() (9 tham số) để lớp web dùng chung một phép
-- ánh xạ patch; null = giữ nguyên, đúng như bản một-dòng.
-- =========================================================
create or replace function public.admin_update_many(
  p_ids uuid[],
  p_status text default null,
  p_progress int default null,
  p_video_url text default null,
  p_layout boolean default null,
  p_lyrics boolean default null,
  p_edit boolean default null,
  p_artist text default null,
  p_title text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  foreach v_id in array p_ids loop
    if exists (select 1 from public.requests where id = v_id) then
      perform public.admin_update(
        v_id, p_status, p_progress, p_video_url,
        p_layout, p_lyrics, p_edit, p_artist, p_title
      );
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.admin_update_many(uuid[], text, int, text, boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.admin_update_many(uuid[], text, int, text, boolean, boolean, boolean, text, text) to authenticated;

-- =========================================================
-- 3. XOÁ NHIỀU REQUEST — một transaction
-- ---------------------------------------------------------
-- Đây là thao tác DUY NHẤT trong bảng quản trị không hoàn tác được. Bản cũ
-- gọi delete_my_request từng id; id nào lỗi thì các id trước đã mất. Nay một
-- câu DELETE: tất cả hoặc không gì cả. Khoá ngoại đã có sẵn cascade/set null
-- trên votes / orders / request_comments / notifications.
-- =========================================================
create or replace function public.admin_delete_many(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  delete from public.requests where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.admin_delete_many(uuid[]) from public, anon;
grant execute on function public.admin_delete_many(uuid[]) to authenticated;

-- =========================================================
-- 4. CHỐT / GỠ CHỐT NHIỀU DÒNG — một transaction
-- ---------------------------------------------------------
-- Mỗi id vẫn đi qua admin_pick_group(): chốt một request là chốt CẢ CỤM trùng
-- tên bài (một bài = một video). Gộp vòng lặp, không đổi luật.
-- =========================================================
create or replace function public.admin_pick_many(p_ids uuid[], p_picked boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'err.bulkTooMany'; end if;

  foreach v_id in array p_ids loop
    if exists (select 1 from public.requests where id = v_id) then
      perform public.admin_pick_group(v_id, p_picked);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function public.admin_pick_many(uuid[], boolean) from public, anon;
grant execute on function public.admin_pick_many(uuid[], boolean) to authenticated;

-- =========================================================
-- 5. MỘT TRANG BÌNH LUẬN — tìm + đếm + cắt trang
-- ---------------------------------------------------------
-- Trả về { total, rows }:
--   · total  = số bình luận khớp bộ lọc (KHÔNG phải số dòng trả về) — nhờ đó
--              màn hình nói được "đang xem 20/1.240" thay vì im lặng cắt.
--   · rows   = đúng một cửa sổ, sắp mới nhất trước, mỗi dòng đã kèm tên/ảnh
--              người viết và tên bài để thẻ bình luận không phải tự ghép.
-- Tìm kiếm theo TỪNG TỪ (giống allTermsIn bên web) và bỏ dấu (admin_fold), nên
-- "chung ha" khớp "Chung Hạ" và "Whiplash aespa" khớp "aespa Whiplash".
-- =========================================================
create or replace function public.admin_comments_page(
  p_q text default null,
  p_limit int default 20,
  p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_limit  int := greatest(1, least(100, coalesce(p_limit, 20)));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_terms  text[];
  v_total  bigint;
  v_rows   jsonb;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  v_terms := case
    when nullif(btrim(coalesce(p_q, '')), '') is null then null
    else array(
      select t from unnest(string_to_array(public.admin_fold(p_q), ' ')) as t
       where t <> ''
    )
  end;

  /* `hay` phải được tính trong một lớp con: Postgres không cho WHERE đọc alias
     của chính SELECT list đang khai báo nó.
     Tổng và một trang phải nằm trong CÙNG một câu lệnh: CTE của PL/pgSQL chỉ
     sống trong câu lệnh khai báo nó, nên đọc `hit` ở câu thứ hai là lỗi
     "relation hit does not exist". */
  with base as (
    select c.id, c.request_id, c.user_id, c.parent_id, c.body, c.created_at,
           coalesce(p.name, 'Member') as author,
           p.avatar_url             as avatar,
           coalesce(r.title, '')    as song_title,
           coalesce(r.artist, '')   as song_artist,
           public.admin_fold(concat_ws(' ', c.body, p.name, r.title, r.artist)) as hay
      from public.request_comments c
      left join public.profiles p on p.id = c.user_id
      left join public.requests r on r.id = c.request_id
     where c.deleted_at is null
  ),
  hit as (
    select * from base b
     where v_terms is null
        or (select bool_and(position(term in b.hay) > 0) from unnest(v_terms) as term)
  ),
  page as (
    select * from hit order by created_at desc, id desc limit v_limit offset v_offset
  )
  select
    (select count(*) from hit),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'request_id', h.request_id, 'user_id', h.user_id,
      'parent_id', h.parent_id, 'body', h.body, 'created_at', h.created_at,
      'author', h.author, 'avatar', h.avatar,
      'song_title', h.song_title, 'song_artist', h.song_artist
    ) order by h.created_at desc, h.id desc), '[]'::jsonb)
  into v_total, v_rows
  from page h;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke all on function public.admin_comments_page(text, int, int) from public, anon;
grant execute on function public.admin_comments_page(text, int, int) to authenticated;

-- PostgREST giữ schema cache; reload để request kế tiếp thấy hàm mới ngay.
notify pgrst, 'reload schema';

commit;
