-- ROLLBACK of 20261210_vote_back.sql — remove the vote-back payout.
-- Run AFTER reverting any client that surfaces err.unpickLocked.
--
-- Safety rails (refuse instead of guessing, same doctrine as 20261126/20261129):
--   * refuses while ANY reward_events row with source vote_back_owner /
--     vote_back_voter exists in the last 48 hours — players already received
--     bonus votes. SQL rollback never claws votes back; wait for the window
--     or do a reviewed manual cleanup.
--   * refuses if the ledger is missing (wrong database / order).
--   * drops the latch column, the trigger, the payout functions, the flag,
--     and the votes(request_id, user_id) index. Restores admin_pick /
--     admin_pick_group to the pre-B4 bodies (unpick allowed again).
--   * reward_events rows already written stay append-only.
--
-- Run in a transaction by an owner via psql/SQL editor.

begin;

do $preflight$
declare
  v_recent bigint;
  v_total  bigint;
begin
  if to_regclass('public.reward_events') is null then
    raise exception 'rollback-refused: reward_events missing - wrong database or 20261126 not applied';
  end if;

  select count(*) into v_total from public.reward_events
   where source in ('vote_back_owner', 'vote_back_voter');
  select count(*) into v_recent from public.reward_events
   where source in ('vote_back_owner', 'vote_back_voter')
     and created_at > clock_timestamp() - interval '48 hours';

  if v_recent > 0 then
    raise exception 'rollback-refused: % vote-back grants in the last 48h (% lifetime) - wait or clean up manually', v_recent, v_total;
  end if;
end
$preflight$;

drop trigger if exists requests_vote_back_tri on public.requests;
drop function if exists public.requests_pay_vote_back();
drop function if exists public.pay_vote_back(uuid);

drop index if exists public.votes_request_user_idx;

alter table public.requests drop column if exists vote_back_paid_at;

delete from public.reward_config where key = 'vote_back_enabled';
alter table public.reward_config drop constraint if exists reward_config_value_check;
alter table public.reward_config drop constraint if exists reward_config_key_check;
alter table public.reward_config
  add constraint reward_config_key_check check (key in (
    'login_rewards_enabled',
    'mystery_box_enabled',
    'login_daily_votes',
    'login_day7_extra',
    'login_milestone7_bonus',
    'login_milestone30_bonus',
    'daily_reward_cap'));
alter table public.reward_config
  add constraint reward_config_value_check check (
    case
      when key in ('login_rewards_enabled', 'mystery_box_enabled')
        then jsonb_typeof(value) = 'boolean'
      when key in ('login_daily_votes','login_day7_extra','login_milestone7_bonus',
                   'login_milestone30_bonus','daily_reward_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric between 0 and 1000
      else false
    end);

-- Restore pre-B4 admin pick (unpick allowed). Bodies match schema.sql /
-- 20261031_admin_pick_group.sql as of 20261204.
create or replace function public.admin_pick(p_id uuid, p_picked boolean default true)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  update public.requests
     set picked_at  = case when p_picked then coalesce(picked_at, now()) else null end,
         updated_at = now()
   where id = p_id
     and status in ('queued','in_progress')
  returning * into r;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  return r;
end $$;

create or replace function public.admin_pick_group(p_id uuid, p_picked boolean default true)
returns setof public.requests language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_artist text;
  v_title  text;
  v_status text;
  r        public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  select artist, title, status into v_artist, v_title, v_status
    from public.requests where id = p_id;
  if v_artist is null then raise exception 'err.requestMissing'; end if;

  if p_picked then
    update public.requests
       set picked_at  = coalesce(picked_at, now()),
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  else
    update public.requests
       set picked_at  = null,
           updated_at = now()
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress');
  end if;

  for r in
    select * from public.requests
     where lower(btrim(artist)) = lower(btrim(v_artist))
       and lower(btrim(title))  = lower(btrim(v_title))
       and status in ('queued','in_progress')
     order by picked_at asc nulls last, created_at asc
  loop
    return next r;
  end loop;
end $$;

revoke all on function public.admin_pick_group(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_pick_group(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
