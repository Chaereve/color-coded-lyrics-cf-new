-- Rollback for 20261221_notification_inbox_fix.sql

begin;

do $$
begin
  alter publication supabase_realtime drop table public.notifications;
exception
  when undefined_object then null;
end $$;

create or replace function public.requests_selfwatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    insert into watches(user_id, song_key, artist, title, own)
      values (new.user_id, public.song_key(new.artist, new.title), new.artist, new.title, true)
    on conflict (user_id, song_key) do nothing;
  end if;
  return new;
end $$;

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

notify pgrst, 'reload schema';

commit;
