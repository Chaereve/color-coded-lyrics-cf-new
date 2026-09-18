-- Color Coded Lyrics — admin sua ten bai + nghe si (2026-09-05)
--
-- Chay 1 lan trong Supabase SQL Editor cho project da chay schema cu.
-- Chay file nay SAU 20260905_pick_lock.sql (file kia dinh nghia lai ban
-- admin_update() 7 tham so; chay sau no se dung do lai overload cu).
-- Additive only: khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Nhung gi file nay them:
--   1. admin_update() nhan them p_artist / p_title (null = giu nguyen,
--      chuoi trang = loi 'err.needFields')
--   2. Xoa overload 7 tham so cu de PostgREST khong bao loi 300 ambiguous

-- 1. xoa overload cu -------------------------------------------------------
drop function if exists public.admin_update(uuid,text,int,text,boolean,boolean,boolean);

-- 2. ban moi (dinh nghia day du giong schema.sql de project cu duoc cap nhat)
create or replace function public.admin_update(
  p_id uuid, p_status text default null, p_progress int default null, p_video_url text default null,
  p_layout boolean default null, p_lyrics boolean default null, p_edit boolean default null,
  p_artist text default null, p_title text default null
) returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests; v_pct int;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  -- ten bai / nghe si: truyen null = giu nguyen; truyen chuoi trang = loi
  if p_artist is not null and length(trim(p_artist)) = 0 then
    raise exception 'err.needFields';
  end if;
  if p_title is not null and length(trim(p_title)) = 0 then
    raise exception 'err.needFields';
  end if;

  update public.requests
     set status      = coalesce(p_status, status),
         video_url   = coalesce(p_video_url, video_url),
         done_layout = coalesce(p_layout, done_layout),
         done_lyrics = coalesce(p_lyrics, done_lyrics),
         done_edit   = coalesce(p_edit,   done_edit),
         artist      = coalesce(nullif(trim(p_artist), ''), artist),
         title       = coalesce(nullif(trim(p_title), ''), title),
         updated_at  = now()
   where id = p_id
  returning * into r;

  -- % luon suy ra tu cac moc, tru khi goi ham truyen thang p_progress
  v_pct := (case when r.done_layout then 40 else 0 end)
         + (case when r.done_lyrics then 40 else 0 end)
         + (case when r.done_edit   then 20 else 0 end);
  if p_progress is not null then v_pct := p_progress; end if;
  if r.status = 'completed' then v_pct := 100; end if;

  update public.requests set progress = v_pct where id = p_id returning * into r;

  -- xong / bi tu choi thi tu roi khoi Up next (picked_at xoa, lich su vote giu nguyen)
  if r.status in ('completed','denied') and r.picked_at is not null then
    update public.requests set picked_at = null where id = p_id returning * into r;
  end if;
  return r;
end $$;

grant execute on function public.admin_update(uuid,text,int,text,boolean,boolean,boolean,text,text) to authenticated;

-- PostgREST co the giu schema cache cu mot luc sau khi them overload moi.
-- Reload de request ke tiep thay ham moi ngay.
notify pgrst, 'reload schema';
