-- Replies + request expiry (2026-09-22)
--
-- Run after 20260920_request_comments.sql and the watch/notifications schema.
-- Replies are additive. Expiry is deliberately two-step:
--   1) the daily job marks old, never-picked requests and tells admins;
--   2) an admin clicks "Expire and delete", which tells the requester and
--      deletes the request. No unattended deletion can erase a request with
--      votes without a human review.

begin;

-- =========================================================
-- 1. COMMENT REPLIES
-- =========================================================
alter table public.request_comments
  add column if not exists parent_id uuid references public.request_comments(id) on delete cascade;
create index if not exists request_comments_parent_idx
  on public.request_comments (parent_id, created_at asc);

-- =========================================================
-- 2. EXPIRY STATE
-- =========================================================
alter table public.requests add column if not exists expired_at timestamptz;
create index if not exists requests_expired_idx
  on public.requests (expired_at) where expired_at is not null;

-- Existing deployments define this table in schema.sql. Re-open the check so
-- the frontend can render an expiry notification beside normal request news.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('near','lead','approved','picked','started','progress','done','denied','votes','expired'));

-- =========================================================
-- 3. DAILY QUEUE — admin gets one notice per request
-- =========================================================
create or replace function public.queue_expired_requests()
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  n int := 0;
begin
  for r in
    select * from public.requests
     where expired_at is null
       and picked_at is null
       and status in ('pending','queued')
       and created_at < now() - interval '1 month'
     for update
  loop
    update public.requests set expired_at = now(), updated_at = now() where id = r.id;

    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    select p.id,
           public.song_key(r.artist, r.title), 'expired', r.id, r.title, r.artist,
           'Not picked within one month.',
           'expiry-admin|' || r.id::text
      from public.profiles p
     where p.is_admin
    on conflict (user_id, sig) where sig is not null do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.queue_expired_requests() from public, anon, authenticated;
grant execute on function public.queue_expired_requests() to service_role;

-- Human-confirmed deletion. The requester is notified before the row is
-- removed, so the event remains readable even though requests cascade-delete.
create or replace function public.admin_expire_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  if r.picked_at is not null or r.status not in ('pending','queued') then
    raise exception 'err.expiryLocked';
  end if;
  insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
  values (
    r.user_id, public.song_key(r.artist, r.title), 'expired', r.id, r.title, r.artist,
    'This request expired after one month and was deleted.',
    'expiry-user|' || r.id::text
  ) on conflict (user_id, sig) where sig is not null do nothing;
  delete from public.requests where id = r.id;
end $$;

revoke all on function public.admin_expire_request(uuid) from public, anon, authenticated;
grant execute on function public.admin_expire_request(uuid) to authenticated;

-- Supabase projects with pg_cron enabled run this shortly after midnight
-- Vietnam time (17:15 UTC). Projects without it can call the function from a
-- scheduled Worker or run it manually; the admin panel still shows `expired_at`.
do $$
declare
  j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'queue-expired-requests' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('queue-expired-requests', '15 17 * * *', 'select public.queue_expired_requests()');
  end if;
exception when undefined_table or undefined_function then
  null;
end $$;

commit;
notify pgrst, 'reload schema';
