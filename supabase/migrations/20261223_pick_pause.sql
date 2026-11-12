-- Color Coded Lyrics — công tắc tạm dừng chốt request tự động.
--
-- Phạm vi CÓ CHỦ ĐÍCH:
--   * Cron pick_top_request() không chọn bài khi settings.pick.paused = true.
--   * Admin vẫn chốt tay bằng admin_pick/admin_pick_group để xử lý ngoại lệ.
--   * Không đổi chu kỳ, không dời last_pick_at/next_pick_at khi bật/tắt.
--     Lúc tạm dừng, đồng hồ công khai hiện "Paused"; lúc bật lại, lịch cũ tiếp tục.
--   * Mọi lần đổi trạng thái thật sự được ghi vào admin_actions hiện có.
--
-- File chạy lại an toàn. Không thêm bảng/cột; không sửa dữ liệu lịch sử.
-- Không nhân bản vào schema.sql/setup: bundle cài mới vẫn là baseline 20261120.

begin;

-- Khóa dòng cấu hình trước khi đọc/sửa để hai admin bấm ngược chiều không thể
-- ghi đè nhau hoặc tạo hai dòng nhật ký cho cùng một lần đổi.
create or replace function public.admin_set_pick_paused(p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_current jsonb;
  v_old boolean;
  v_next jsonb;
begin
  if v_actor is null then raise exception 'err.signin'; end if;
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if p_paused is null then raise exception 'err.pickPauseInvalid'; end if;

  select value into v_current
    from public.settings
   where key = 'pick'
   for update;

  if v_current is null then
    insert into public.settings (key, value)
    values ('pick', '{"interval_days":4,"last_pick_at":null,"next_pick_at":null,"paused":false}'::jsonb)
    on conflict (key) do nothing;

    select value into v_current
      from public.settings
     where key = 'pick'
     for update;
  end if;

  v_old := coalesce((v_current->>'paused')::boolean, false);
  if v_old = p_paused then
    return v_current || jsonb_build_object('paused', v_old);
  end if;

  v_next := v_current || jsonb_build_object(
    'paused', p_paused,
    'paused_at', case when p_paused then now() else null end
  );

  update public.settings
     set value = v_next, updated_at = now()
   where key = 'pick';

  insert into public.admin_actions (actor, action, target_id, label, detail)
  values (v_actor, 'pick_pause', null, 'Automatic request pick',
          jsonb_build_object('paused', jsonb_build_array(v_old, p_paused)));

  return v_next;
end $$;

revoke all on function public.admin_set_pick_paused(boolean) from public, anon, authenticated;
grant execute on function public.admin_set_pick_paused(boolean) to authenticated;

-- Giữ nguyên chữ ký và các thuộc tính fingerprint của baseline; chỉ thêm cổng
-- tạm dừng ở đầu hàm. force là đường vận hành SQL chủ đích nên vẫn vượt cổng.
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
  if not force and coalesce((cfg->>'paused')::boolean, false) then
    return;
  end if;

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
     set value = coalesce(cfg, '{}'::jsonb) || jsonb_build_object(
           'last_pick_at',    now(),
           'next_pick_at',    now() + make_interval(days => days),
           'last_request_id', r.id),
         updated_at = now()
   where key = 'pick';

  if found then return next r; end if;
end $$;

revoke all on function public.pick_top_request(boolean) from public, anon, authenticated;

-- Giá trị mặc định tường minh cho bản ghi đang có; không đụng các khóa khác.
update public.settings
   set value = value || '{"paused":false}'::jsonb,
       updated_at = now()
 where key = 'pick' and not (value ? 'paused');

-- Đồng bộ công tắc tới tab đang mở. settings đã có RLS đọc công khai; đưa vào
-- publication hiện có để App không phải chờ vòng poll kế tiếp mới thấy Paused.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings'
     ) then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
