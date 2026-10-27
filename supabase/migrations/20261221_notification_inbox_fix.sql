-- Color Coded Lyrics — notification inbox fixes (2026-12-21)
--
-- Fixes two server-side notification gaps:
--   1. public.admin_expire_request(uuid) previously inserted r.user_id directly
--      into public.notifications (where user_id is NOT NULL) without checking
--      whether r.user_id is present. Seeded or manually imported requests can
--      have user_id IS NULL, causing "Expire and delete" to fail with a NOT NULL
--      constraint violation instead of deleting the expired request.
--   2. Enrolls public.notifications in supabase_realtime (idempotent) so bell
--      notifications generated outside public.requests updates (daily check-in
--      rewards, season settlements, cron expiry queue, cross-device read state)
--      push immediately to the signed-in owner under RLS policy notif_read.

begin;

create or replace function public.requests_selfwatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and exists (select 1 from public.profiles p where p.id = new.user_id) then
    insert into public.watches(user_id, song_key, artist, title, own)
      values (new.user_id, public.song_key(new.artist, new.title), new.artist, new.title, true)
    on conflict (user_id, song_key) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.requests_selfwatch() from public, anon, authenticated;

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
  if r.user_id is not null and exists (select 1 from public.profiles p where p.id = r.user_id) then
    insert into public.notifications(user_id, song_key, kind, request_id, title, artist, reason, sig)
    values (
      r.user_id, public.song_key(r.artist, r.title), 'expired', r.id, r.title, r.artist,
      'This request expired after one month and was deleted.',
      'expiry-user|' || r.id::text
    ) on conflict (user_id, sig) where sig is not null do nothing;
  end if;
  delete from public.requests where id = r.id;
end $$;

revoke all on function public.admin_expire_request(uuid) from public, anon, authenticated;
grant execute on function public.admin_expire_request(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
