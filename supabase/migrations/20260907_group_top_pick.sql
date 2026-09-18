-- Color Coded Lyrics — chot tu dong theo TONG vote cua ca bai (2026-09-07)
--
-- Chay 1 lan trong Supabase SQL Editor. Chay lai van an toan: file chi co
-- create or replace function, khong DROP/TRUNCATE bang nao, du lieu giu nguyen.
--
-- Van de: hai request trung ten bai + nghe si (khong phan biet hoa thuong /
-- khoang trang thua) la MOT bai hat. Tren web cac request do da duoc gom
-- thanh mot cum va cong don vote khi xep hang "Top voted", nhung ham
-- pick_top_request() — cron tu chot request vao Up next — van sap xep theo
-- so vote cua TUNG DONG:
--     order by is_paid desc, votes desc, created_at asc
-- nen bai 9 vote bi xe lam 3 request (3 + 3 + 3) xep DUOI bai 5 vote chi co
-- mot request. Cron chot nham bai it duoc doi hon, lech voi bang xep hang
-- nguoi dung dang nhin.
--
-- File nay sua ham pick_top_request() xep hang theo tong vote cua cac request
-- trung bai, dung mot khoa gom cum voi web (src/lib/board.js: groupKey):
-- lower(btrim(artist)) + lower(btrim(title)). Tong chi tinh cac dong con mo
-- vote ('queued' / 'in_progress') de request da xong / bi tu choi khong keo
-- hang len. Trong mot cum, dong duoc chot la dong nhieu vote nhat (hoa thi
-- chon dong gui truoc hon).

create or replace function public.pick_top_request(force boolean default false)
returns setof public.requests
language plpgsql security definer set search_path = public as $$
declare
  cfg     jsonb;
  last_at timestamptz;
  days    int;
  r       public.requests;
begin
  select value into cfg from public.settings where key = 'pick';
  days    := coalesce((cfg->>'interval_days')::int, 4);
  last_at := (cfg->>'last_pick_at')::timestamptz;

  if not force and last_at is not null
     and now() < last_at + make_interval(days => days) then
    return;
  end if;

  select c.* into r
    from public.requests c
   where c.status = 'queued' and c.picked_at is null
   order by
     c.is_paid desc,
     -- tong vote cua ca bai (cac request trung ten bai + nghe si)
     (select coalesce(sum(g.votes), 0)
        from public.requests g
       where lower(btrim(g.artist)) = lower(btrim(c.artist))
         and lower(btrim(g.title))  = lower(btrim(c.title))
         and g.status in ('queued','in_progress')) desc,
     c.votes desc,
     c.created_at asc
   limit 1;

  if found then
    update public.requests set picked_at = now(), updated_at = now() where id = r.id;
    r.picked_at := now();
  end if;

  update public.settings
     set value = cfg || jsonb_build_object(
           'last_pick_at',    now(),
           'next_pick_at',    now() + make_interval(days => days),
           'last_request_id', r.id),
         updated_at = now()
   where key = 'pick';

  if found then return next r; end if;
end $$;

-- Ham nay van chi danh cho cron (postgres/service_role), khong mo cho app.
revoke all on function public.pick_top_request(boolean) from public, anon, authenticated;

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham.
notify pgrst, 'reload schema';
