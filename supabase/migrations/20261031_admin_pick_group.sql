-- Color Coded Lyrics — chot ca cum trung bai len Up next (2026-10-31)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai van an toan: file chi co
-- create or replace function, khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Khi admin chot mot request, tat ca request trung ten bai + nghe si (khoa gom
-- cum giong src/lib/board.js: groupKey = lower(btrim(artist)) || lower(btrim(title)))
-- cung duoc chot ca cum. Ghi chu Up next hien thanh mot the gop thay vi bi xe le.
-- Chi chot cac dong con mo (status 'queued' / 'in_progress'); request da xong /
-- bi tu choi khong keo len. Gỡ chốt (p_picked = false) cung thao ca cum.

create or replace function public.admin_pick_group(p_id uuid, p_picked boolean default true)
returns setof public.requests language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_artist text;
  v_title  text;
  v_status text;
  r        public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  select artist, title, status into v_artist, v_title, v_status
    from public.requests where id = p_id;
  if v_artist is null then raise exception 'err.requestMissing'; end if;

  if p_picked then
    update public.requests
       set picked_at  = coalesce(picked_at, now()),
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  else
    update public.requests
       set picked_at  = null,
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  end if;

  for r in
    select * from public.requests
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress')
     order by picked_at asc nulls last, created_at asc
  loop
    return next r;
  end loop;
end $$;

-- Chi admin moi goi (is_admin duoc kiem ben trong ham). Giao tiep trinh duyet.
revoke all on function public.admin_pick_group(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_pick_group(uuid, boolean) to authenticated;

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham.
notify pgrst, 'reload schema';
