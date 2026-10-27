-- Rollback for 20261220_review_notify_privacy_fix.sql
-- Warning: restoring the pre-20261220 trigger re-exposes deny_reason to song watchers
-- and re-introduces duplicate review notifications alongside 20261215_notify_requester_review.sql.
-- Only apply if coordinated with rolling back 20261215 and 20261217.

begin;

create or replace function public.requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := public.song_key(old.artist, old.title); v_kind text;
begin
  v_kind := case
    when new.status = 'completed'   and old.status <> 'completed'   then 'done'
    when new.status = 'denied'      and old.status <> 'denied'      then 'denied'
    when new.picked_at is not null and old.picked_at is null
         and new.status <> 'completed'                              then 'picked'
    when new.status = 'in_progress' and old.status <> 'in_progress' then 'started'
    when old.status = 'pending'     and new.status = 'queued'       then 'approved'
    when new.status = 'in_progress' and new.progress > old.progress then 'progress'
    else null end;
  if v_kind is not null then
    insert into notifications(user_id, song_key, kind, request_id, title, artist, url, pct, votes, reason, sig)
    select u.user_id, k, v_kind, new.id, new.title, new.artist, new.video_url, new.progress, new.votes,
           case when new.status = 'denied' then new.deny_reason end,
           k || '|' || v_kind || ':' || case v_kind
             when 'done' then coalesce(new.video_url,'')
             when 'progress' then new.progress::text
             else new.status end
      from (
        select user_id from watches where song_key = k
        union
        select v.user_id from votes v join requests r on r.id = v.request_id
         where public.song_key(r.artist, r.title) = k
      ) u
    on conflict (user_id, sig) where sig is not null do nothing;
  end if;
  return new;
end $$;

create or replace function public.get_visible_denial_reasons()
returns table (id uuid, deny_reason text)
language sql stable security definer set search_path = public as $$
  select r.id, r.deny_reason
  from public.requests r
  where r.status = 'denied'
    and auth.uid() is not null
    and (r.user_id = auth.uid() or public.is_admin());
$$;

revoke all on function public.get_visible_denial_reasons() from public, anon, authenticated;
grant execute on function public.get_visible_denial_reasons() to authenticated;

notify pgrst, 'reload schema';

commit;
