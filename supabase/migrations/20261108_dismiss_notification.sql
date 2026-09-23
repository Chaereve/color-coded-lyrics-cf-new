-- Dismiss a notification without granting DELETE.
-- Follows 20261107_comments_spin_fixes.sql. Rerunnable. Does not delete rows.
begin;

alter table public.notifications add column if not exists dismissed_at timestamptz;

-- Hidden from the owner after dismiss. service_role (email flush) bypasses RLS.
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select
  using (auth.uid() = user_id and dismissed_at is null);

-- Clients still cannot update this column directly. The only write path is
-- the definer function below, and it can only touch the caller's own rows.
revoke update (dismissed_at) on public.notifications from public, anon, authenticated;

create or replace function public.dismiss_notification(p_id bigint default null, p_sig text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sig text := nullif(btrim(coalesce(p_sig, '')), '');
begin
  if v_uid is null then
    raise exception 'err.signin';
  end if;
  if v_sig is not null and length(v_sig) > 500 then
    v_sig := null;
  end if;
  if p_id is null and v_sig is null then
    return;
  end if;
  update public.notifications
     set dismissed_at = coalesce(dismissed_at, now())
   where user_id = v_uid
     and dismissed_at is null
     and (
       (p_id is not null and id = p_id)
       or (v_sig is not null and sig = v_sig)
     );
end $$;

revoke all on function public.dismiss_notification(bigint, text) from public, anon;
grant execute on function public.dismiss_notification(bigint, text) to authenticated;

-- admin_update used to store video_url with no check. admin_review already
-- rejects non-http(s). A javascript: link stored here is an XSS the moment
-- anyone clicks Watch. Only validate when the column actually changes, so
-- an old row can still be edited.
create or replace function public.requests_video_url_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.video_url is not distinct from old.video_url then
    return new;
  end if;
  if new.video_url is null or btrim(new.video_url) = '' then
    return new;
  end if;
  if length(new.video_url) > 500
     or new.video_url !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$' then
    raise exception 'err.denyVideo';
  end if;
  return new;
end $$;

drop trigger if exists requests_video_url_guard on public.requests;
create trigger requests_video_url_guard
  before insert or update on public.requests
  for each row execute function public.requests_video_url_guard();

notify pgrst, 'reload schema';
commit;
