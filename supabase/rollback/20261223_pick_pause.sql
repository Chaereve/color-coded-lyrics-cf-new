-- Rollback có chủ đích cho 20261223_pick_pause.sql.
-- Chỉ chạy sau khi được duyệt riêng. Không xóa dòng nhật ký admin_actions.
-- Sau rollback, cron tự động chạy lại theo lịch cũ; công tắc trên frontend sẽ
-- không còn RPC để gọi và phải được gỡ/ẩn trong cùng lần phát hành.

begin;

drop function if exists public.admin_set_pick_paused(boolean);

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

revoke all on function public.pick_top_request(boolean) from public, anon, authenticated;

update public.settings
   set value = value - 'paused' - 'paused_at',
       updated_at = now()
 where key = 'pick';

-- Giữ settings trong publication nếu đã thêm: vô hại với bản cũ và tránh thay
-- đổi hạ tầng realtime không cần thiết khi rollback.

notify pgrst, 'reload schema';

commit;
