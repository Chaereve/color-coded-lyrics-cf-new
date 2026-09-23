-- A signed-in visit is an activity day.
-- Follows 20260921_activity_days.sql and 20261106_security_audit.sql.
-- Rerunnable. Does not delete rows and does not accept a client-supplied date.
begin;

-- Direct comment inserts run as the caller. The stamp function must be the
-- definer, or the revoked INSERT privilege rolls the comment back and the day
-- is never stored. Action RPCs already run as definer; this keeps both paths.
create or replace function public.touch_activity_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_days (user_id, day)
  values (new.user_id, (coalesce(new.created_at, now()) at time zone 'Asia/Ho_Chi_Minh')::date)
  on conflict (user_id, day) do nothing;
  return new;
end $$;
revoke all on function public.touch_activity_day() from public;

drop trigger if exists activity_on_request on public.requests;
create trigger activity_on_request after insert on public.requests
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_vote on public.votes;
create trigger activity_on_vote after insert on public.votes
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_comment on public.request_comments;
create trigger activity_on_comment after insert on public.request_comments
for each row when (new.user_id is not null) execute function public.touch_activity_day();

drop trigger if exists activity_on_spin on public.daily_spins;
create trigger activity_on_spin after insert on public.daily_spins
for each row when (new.user_id is not null) execute function public.touch_activity_day();

-- No arguments: the caller cannot stamp another account or a past/future day.
-- One row per account per Vietnam calendar day. Opening the site again today
-- is a no-op, not a second day.
create or replace function public.touch_my_activity()
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if v_uid is null then
    raise exception 'err.signin';
  end if;
  insert into public.activity_days (user_id, day)
  values (v_uid, v_day)
  on conflict (user_id, day) do nothing;
  return v_day;
end $$;

revoke all on function public.touch_my_activity() from public, anon;
grant execute on function public.touch_my_activity() to authenticated;

-- Repair days that already happened as a request, vote, comment or spin but
-- were never stamped (trigger added later, or a write path that missed it).
-- Pure visits from before this function existed were not stored anywhere, so
-- they cannot be reconstructed. Skip ids that are no longer auth users so one
-- orphan row cannot abort the repair.
insert into public.activity_days (user_id, day)
select src.user_id, src.day
from (
  select r.user_id, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day
    from public.requests r
   where r.user_id is not null
  union
  select v.user_id, (v.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.votes v
   where v.user_id is not null
  union
  select c.user_id, (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.request_comments c
   where c.user_id is not null
  union
  select s.user_id, (s.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.daily_spins s
   where s.user_id is not null
) src
where exists (select 1 from auth.users u where u.id = src.user_id)
on conflict (user_id, day) do nothing;

notify pgrst, 'reload schema';
commit;
