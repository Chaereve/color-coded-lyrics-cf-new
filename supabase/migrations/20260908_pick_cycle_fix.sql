-- Color Coded Lyrics — sua chu ky "Next pick": dong ho khong ket, cron chay sat moc (2026-09-08)
--
-- Van de:
--   1) Khi ADMIN chot tay mot request/cum request len Up next sau khi da qua moc
--      chot tu dong (next_pick_at trong qua khu), duong chot tay chi set
--      requests.picked_at ma KHONG ghi moc ke tiep vao settings.pick. Ket qua:
--      dong ho "Next pick" chay ve 0 roi dung im "any moment..." ma khong bao gio
--      nhay sang ky moi — dung la trieu chung "dem gio khong hoat dong nua".
--   2) Lich cron khuyen nghi la 6 tieng mot lan ('0 */6 * * *') nen sau khi dong
--      ho cham 0, luot chot tu dong co the tre toi 6 tieng — nguoi xem tuong
--      "no khong autopick top vote".
--
-- File nay (chay lai van an toan):
--   a. Them trigger pick_cycle_touch: bat ky duong nao set picked_at (cron,
--      admin chot tay, SQL truc tiep) khi LUOT DA QUA HAN thi tu dong ghi
--      last_pick_at / next_pick_at moi (= now + interval_days) vao settings.pick.
--      Chot tay GIUA KY (chua den gio chot tu dong) khong doi lich cua cong chung.
--      Trigger khong sua bang requests nen khong de quy.
--   b. Neu settings.pick dang qua han ma da co request duoc chot, doi moc tu
--      lan chot thuc te gan nhat — dong ho nha so ngay khong can cho cron.
--   c. Dua job cron 'auto-pick-top' ve chu ky 30 phut (ham tu bo qua neu chua
--      toi ky) de luot chot tu dong roi trong vong <= 30 phut sau khi cham moc.
--      Chi chay khi extension pg_cron da bat; neu chua bat, lam theo HUONG-DAN.

-- a) Trigger cap nhat lich chot khi co luot chot moi qua han -------------------
create or replace function public.pick_cycle_touch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg     jsonb;
  last_at timestamptz;
  days    int;
  due     boolean;
begin
  -- Chi quan tam nhung dong vua duoc CHOT (picked_at vua co gia tri, con mo vote).
  if new.picked_at is null or new.status not in ('queued', 'in_progress') then
    return new;
  end if;

  select value into cfg from public.settings where key = 'pick';
  if cfg is null then return new; end if;   -- chua co cau hinh chu ky: de nguyen

  days    := coalesce((cfg->>'interval_days')::int, 4);
  last_at := (cfg->>'last_pick_at')::timestamptz;

  -- Lượt đã tới kỳ / quá hạn thì lượt chốt này (dù tự động hay tay) là lượt
  -- chốt của kỳ → ghi mốc kế tiếp. Ngược lại là chốt tay giữa kỳ: không dời lịch.
  due := last_at is null
      or (cfg->>'next_pick_at')::timestamptz is null
      or (cfg->>'next_pick_at')::timestamptz <= now()
      or now() >= last_at + make_interval(days => days);
  if not due then
    return new;
  end if;

  update public.settings
     set value = cfg || jsonb_build_object(
           'last_pick_at', now(),
           'next_pick_at', now() + make_interval(days => days)),
         updated_at = now()
   where key = 'pick';
  return new;
end $$;

drop trigger if exists trg_pick_cycle_after_pick on public.requests;
create trigger trg_pick_cycle_after_pick
  after update of picked_at on public.requests
  for each row execute function public.pick_cycle_touch();

-- b) Doi moc dang ket (next_pick_at qua han) tu lan chot gan nhat --------------
update public.settings s
   set value = s.value || jsonb_build_object(
         'last_pick_at', x.last_pick,
         'next_pick_at', x.last_pick + make_interval(days => coalesce((s.value->>'interval_days')::int, 4))),
       updated_at = now()
  from (select max(picked_at) as last_pick
          from public.requests
         where picked_at is not null
           and status in ('queued', 'in_progress')) x
 where s.key = 'pick'
   and x.last_pick is not null
   and coalesce((s.value->>'next_pick_at')::timestamptz, '-infinity') <= now();

-- c) Lich tu chot: moi 30 phut (ham tu bo qua neu chua toi ky) -----------------
do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Bo job cu (neu co) truoc khi tao lai de khong bi trung lich.
    for j in select jobid from cron.job where jobname = 'auto-pick-top' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('auto-pick-top', '*/30 * * * *', 'select public.pick_top_request()');
  end if;
end $$;

-- PostgREST co the giu schema cache cu mot luc sau khi sua ham / them trigger.
notify pgrst, 'reload schema';
