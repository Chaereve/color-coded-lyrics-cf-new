-- Color Coded Lyrics — fix duplicate review notifications, private denial reason leak,
-- and denial-reason RPC ordering (2026-12-20)
--
-- Why this migration exists:
--   1. Privacy leak: 20261217_private_denial_reasons.sql revoked table-level SELECT on
--      public.requests.deny_reason so denial notes stay private to the requester and
--      administrators. However, the legacy trigger public.requests_notify() (SECURITY
--      DEFINER) still copied new.deny_reason into public.notifications.reason for EVERY
--      user watching song_key(old.artist, old.title) or having voted on any request with
--      that normalized song key — leaking private denial notes to third parties and
--      falsely telling watchers of an active song that the song was denied whenever a
--      duplicate submission was rejected.
--   2. Duplicate requester notifications: requests_selfwatch_tri auto-watches a user's
--      own request on INSERT. When admin_review() (20261215) updated status to queued or
--      denied, requests_notify() inserted '<song_key>|approved:queued' (or '...|denied:denied')
--      and admin_review() inserted a second row with sig 'review|<id>|<status>'. Because
--      the two sigs differed, ON CONFLICT (user_id, sig) did not deduplicate them.
--   3. Recent denial reasons first: get_visible_denial_reasons() had no ORDER BY, so once
--      denied history passes PostgREST's 1000-row page cap, admins would lose denial notes
--      on newly denied requests in /admin -> Closed.
--
-- Fix:
--   * Route 'approved' and 'denied' inside requests_notify() exclusively to new.user_id
--     using the canonical 'review|<id>|<status>' signature (matching admin_review()).
--   * Public song milestones ('picked', 'started', 'progress', 'done') continue notifying
--     all watchers and voters of song_key with reason = NULL.
--   * Order get_visible_denial_reasons() newest-first (updated_at, created_at, id).

begin;

create or replace function public.requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text := public.song_key(old.artist, old.title);
  v_kind text;
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

  if v_kind is null then
    return new;
  end if;

  -- Review outcomes (approved / denied) belong strictly to the requester of THIS
  -- request row and share admin_review()'s 'review|<id>|<status>' idempotency key.
  -- Third-party watchers/voters never receive another user's private deny_reason.
  if v_kind in ('approved', 'denied') then
    if new.user_id is not null then
      insert into public.notifications (
        user_id, song_key, kind, request_id, title, artist, reason, sig
      )
      values (
        new.user_id,
        public.song_key(new.artist, new.title),
        v_kind,
        new.id,
        new.title,
        new.artist,
        case when v_kind = 'denied' then left(coalesce(new.deny_reason, ''), 300) else null end,
        'review|' || new.id::text || '|' || new.status
      )
      on conflict (user_id, sig) where sig is not null do nothing;
    end if;
    return new;
  end if;

  -- Public production milestones notify everyone watching or having voted on the song,
  -- never carrying a private denial reason.
  insert into public.notifications (
    user_id, song_key, kind, request_id, title, artist, url, pct, votes, reason, sig
  )
  select
    u.user_id,
    k,
    v_kind,
    new.id,
    new.title,
    new.artist,
    new.video_url,
    new.progress,
    new.votes,
    null,
    k || '|' || v_kind || ':' || case v_kind
      when 'done' then coalesce(new.video_url, '')
      when 'progress' then new.progress::text
      else new.status end
  from (
    select w.user_id from public.watches w where w.song_key = k
    union
    select v.user_id
      from public.votes v
      join public.requests r on r.id = v.request_id
     where public.song_key(r.artist, r.title) = k
  ) u
  on conflict (user_id, sig) where sig is not null do nothing;

  return new;
end $$;

revoke all on function public.requests_notify() from public, anon, authenticated;

drop trigger if exists requests_notify_tri on public.requests;
create trigger requests_notify_tri
  after update of status, picked_at, video_url, progress, votes
  on public.requests
  for each row execute function public.requests_notify();

create or replace function public.get_visible_denial_reasons()
returns table (id uuid, deny_reason text)
language sql stable security definer set search_path = public as $$
  select r.id, r.deny_reason
  from public.requests r
  where r.status = 'denied'
    and auth.uid() is not null
    and (r.user_id = auth.uid() or public.is_admin())
  order by coalesce(r.updated_at, r.created_at) desc, r.id desc;
$$;

revoke all on function public.get_visible_denial_reasons() from public, anon, authenticated;
grant execute on function public.get_visible_denial_reasons() to authenticated;

notify pgrst, 'reload schema';

commit;
