-- luôn ghi lịch chốt tiếp theo, kể cả khi không có request nào để chốt
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

  select * into r from public.requests
   where status = 'queued' and picked_at is null
   order by is_paid desc, votes desc, created_at asc
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

-- đảm bảo NGAY BÂY GIỜ đã có next_pick_at để trang đếm được
update public.settings
   set value = value || jsonb_build_object(
     'next_pick_at', coalesce((value->>'next_pick_at')::timestamptz,
                              now() + make_interval(days => coalesce((value->>'interval_days')::int, 4))))
 where key = 'pick';

notify pgrst, 'reload schema';

-- kiểm tra: phải thấy next_pick_at
select value from public.settings where key = 'pick';