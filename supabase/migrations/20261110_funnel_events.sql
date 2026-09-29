-- Funnel events — số liệu đường đi của người dùng ("metric, not vibes").
-- Follows 20261109_activity_visit.sql. Rerunnable. Kỷ luật free-tier:
--   · ghi thẳng Postgres qua RPC — KHÔNG đi qua Workers KV (trần 1.000 ghi/ngày
--     của KV đang nằm ngay trên đường vote, không được đụng thêm);
--   · KHÔNG thêm cron: RPC tự quét dòng > 30 ngày, tối đa MỘT lần mỗi ngày
--     (cờ 'funnel_purge' trong settings) — index created_at giữ cú quét rẻ;
--   · meta ≤ 512 byte, TUYỆT ĐỐI không IP/fingerprint/định danh thiết bị —
--     đây là bảng sản phẩm, không phải bảng truy vết (xem privacy.html).
begin;

create table if not exists public.funnel_events (
  id         bigint generated always as identity primary key,
  event      text not null check (char_length(event) between 1 and 32),
  user_id    uuid references public.profiles (id) on delete set null,
  meta       jsonb not null default '{}'::jsonb check (pg_column_size(meta) <= 512),
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_created_idx on public.funnel_events (created_at);
create index if not exists funnel_events_event_created_idx on public.funnel_events (event, created_at);

alter table public.funnel_events enable row level security;

-- Chỉ hai đường đi: GHI qua track_funnel() (người đã đăng nhập), ĐỌC qua
-- funnel_summary() (admin). Không ai đọc/sửa/xoá trực tiếp — kể cả người ghi.
revoke all on public.funnel_events from public, anon, authenticated;

create or replace function public.track_funnel(p_event text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_last  date;
  v_event text := nullif(btrim(coalesce(p_event, '')), '');
  v_meta  jsonb := case when p_meta is null or pg_column_size(p_meta) > 512
                        then '{}'::jsonb else p_meta end;
begin
  if auth.uid() is null then
    raise exception 'err.signin';
  end if;
  if v_event is null or length(v_event) > 32 then
    raise exception 'err.funnelEvent';
  end if;

  insert into public.funnel_events (event, user_id, meta)
  values (v_event, auth.uid(), v_meta);

  -- Tu dọn: ai ghi sự kiện đầu tiên của ngày sẽ quét dòng cũ hơn 30 ngày.
  -- Một dòng settings đánh dấu ngày quét gần nhất — không cần cron, không cần
  -- thêm khoá ghi nào ngoài một lần insert settings/ngày.
  select (value #>> '{}')::date into v_last
    from public.settings where key = 'funnel_purge';
  if v_last is null or v_last < v_today then
    delete from public.funnel_events where created_at < now() - interval '30 days';
    insert into public.settings (key, value)
    values ('funnel_purge', to_jsonb(v_today))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

revoke all on function public.track_funnel(text, jsonb) from public, anon;
grant execute on function public.track_funnel(text, jsonb) to authenticated;

-- Tổng hợp cho admin: đếm theo sự kiện theo ngày, mặc định 7 ngày gần nhất.
create or replace function public.funnel_summary(p_days int default 7)
returns table (day date, event text, n bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'err.adminOnly';
  end if;
  return query
    select (f.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day,
           f.event,
           count(*) as n
      from public.funnel_events f
     where f.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
     group by 1, 2
     order by 1 desc, 2;
end $$;

revoke all on function public.funnel_summary(int) from public, anon;
grant execute on function public.funnel_summary(int) to authenticated;

notify pgrst, 'reload schema';
commit;
