-- VOTE-BACK 10% when a request is PICKED (B4.1, approved 2026-10).
-- Run AFTER 20261126_reward_ledger.sql (grant_reward_event + reward_config)
-- and 20261128_achievements_v2.sql (firstVoteBack reads the ledger).
-- One transaction, rerunnable. Not part of the fresh-install bundle
-- (schema.sql stays at baseline 20261120, like 20261121+).
--
-- Approved rules
-- --------------
--   * Trigger: first NULL → NOT NULL on requests.picked_at (cron, admin_pick,
--     admin_pick_group, or a direct UPDATE). One shot per request lifetime.
--   * Latch: requests.vote_back_paid_at is set in the SAME transaction as the
--     pick, even when the flag is off or the payout is 0. Unpick never clears
--     it. A later re-pick is a no-op.
--   * Flag off (vote_back_enabled = false): still set the latch, pay nothing,
--     write no ledger. Turning the flag back on does NOT pay requests that
--     were already latched.
--   * Rounding: voter n >= 1 → greatest(1, floor(n / 10));
--     owner → floor(total / 10) (0 when total < 10).
--     Owner who also voted gets BOTH sources (two ledger rows).
--   * Cap 50 / request: if owner_raw + sum(voter_raw) > 50, owner is kept
--     first (capped at 50) and voters share the remainder by largest-remainder.
--     The clipped tail is LOST (no next-day top-up).
--   * Cap 30 / person / Vietnam day: grant_reward_event, unchanged. Clip is
--     also lost (vote-back is not an achievement).
--   * Unpick (B1): admin_pick / admin_pick_group raise err.unpickLocked when
--     vote_back_paid_at is set. Manual unpick is out of scope for B4.
--   * Voting stays locked while picked_at is set (existing err.voteLocked).
--
-- Preflight: refuse if the B1 ledger is missing. Rollback: see
-- supabase/rollback/20261210_vote_back.sql (drops trigger/functions/flag/
-- column; never deletes reward_events; refuses while recent vote-back
-- grants exist).
--
-- Not touched: grant_reward_event internals, daily 30-cap math, mystery/spin
-- odds, wallets of purchased/free votes, bonus_requests.

begin;

-- 0. Preflight — fail closed, no writes.
do $preflight$
begin
  if to_regclass('public.reward_events') is null
     or to_regclass('public.reward_config') is null then
    raise exception 'vote-back preflight: reward ledger missing — apply 20261126_reward_ledger first';
  end if;
  if to_regprocedure('public.grant_reward_event(uuid,date,text,text,integer,jsonb)') is null then
    raise exception 'vote-back preflight: grant_reward_event missing — apply 20261126_reward_ledger first';
  end if;
  if to_regprocedure('public.reward_config_bool(text)') is null then
    raise exception 'vote-back preflight: reward_config_bool missing — apply 20261126_reward_ledger first';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.requests'::regclass
       and attname = 'picked_at'
       and not attisdropped
  ) then
    raise exception 'vote-back preflight: requests.picked_at missing';
  end if;
end
$preflight$;

-- 1. Flag. Widen the CHECK in-place (same pattern as 20261129 mystery).
--    Existing tuned rows are untouched; the seed never clobbers.
alter table public.reward_config drop constraint if exists reward_config_key_check;
alter table public.reward_config
  add constraint reward_config_key_check check (key in (
    'login_rewards_enabled',
    'mystery_box_enabled',
    'vote_back_enabled',
    'login_daily_votes',
    'login_day7_extra',
    'login_milestone7_bonus',
    'login_milestone30_bonus',
    'daily_reward_cap'));
alter table public.reward_config drop constraint if exists reward_config_value_check;
alter table public.reward_config
  add constraint reward_config_value_check check (
    case
      when key in ('login_rewards_enabled', 'mystery_box_enabled', 'vote_back_enabled')
        then jsonb_typeof(value) = 'boolean'
      when key in ('login_daily_votes','login_day7_extra','login_milestone7_bonus',
                   'login_milestone30_bonus','daily_reward_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric between 0 and 1000
      else false
    end);

insert into public.reward_config (key, value) values
  ('vote_back_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- 2. Lifetime latch + the index the payout GROUP BY needs.
alter table public.requests
  add column if not exists vote_back_paid_at timestamptz;

comment on column public.requests.vote_back_paid_at is
  'Vote-back settled (or skipped while disabled) for this request. Set on first pick; never cleared on unpick.';

create index if not exists votes_request_user_idx
  on public.votes (request_id, user_id);

-- 3. Payout. Internal only — the trigger is the public entry.
--    Caller contract: the requests row is already locked by the pick UPDATE.
create or replace function public.pay_vote_back(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req        public.requests;
  v_day        date;
  v_total      int;
  v_owner_raw  int;
  v_owner_paid int;
  v_voter_sum  int;
  v_remain     int;
  v_use_raw    boolean;
  rec          record;
begin
  if p_request_id is null then return; end if;

  select * into v_req from public.requests where id = p_request_id for update;
  if not found then return; end if;
  if v_req.vote_back_paid_at is not null then return; end if;

  -- Latch FIRST, even when the flag is off or every grant is 0.
  update public.requests
     set vote_back_paid_at = clock_timestamp()
   where id = p_request_id;

  if not public.reward_config_bool('vote_back_enabled') then
    return;
  end if;

  v_day := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;

  select count(*)::int into v_total
    from public.votes where request_id = p_request_id;
  v_owner_raw := v_total / 10;   -- floor(total * 10 / 100)

  select coalesce(sum(greatest(1, n / 10)), 0)::int into v_voter_sum
    from (
      select count(*)::int as n
        from public.votes
       where request_id = p_request_id
       group by user_id
    ) t;

  -- Cap 50 / request: owner first, voters share what is left.
  v_use_raw := (v_owner_raw + v_voter_sum) <= 50;
  if v_use_raw then
    v_owner_paid := v_owner_raw;
    v_remain := 0;
  else
    v_owner_paid := least(v_owner_raw, 50);
    v_remain := 50 - v_owner_paid;
  end if;

  -- Lock every wallet we might credit, in id order, before any grant.
  perform 1
    from public.profiles p
   where p.id = v_req.user_id
      or p.id in (select v.user_id from public.votes v where v.request_id = p_request_id)
   order by p.id
     for update;

  if v_owner_paid > 0 then
    perform public.grant_reward_event(
      v_req.user_id, v_day, 'vote_back_owner', p_request_id::text, v_owner_paid,
      jsonb_build_object(
        'request_id', p_request_id,
        'total_votes', v_total,
        'raw', v_owner_raw,
        'capped50', not v_use_raw));
  end if;

  for rec in
    with tallies as (
      select user_id, count(*)::int as n
        from public.votes
       where request_id = p_request_id
       group by user_id
    ),
    raw as (
      select user_id, n, greatest(1, n / 10) as raw from tallies
    ),
    tot as (
      select coalesce(sum(raw), 0)::int as s from raw
    ),
    floors as (
      select r.user_id, r.n, r.raw,
             case
               when v_use_raw then r.raw
               when v_remain = 0 or t.s = 0 then 0
               else (r.raw * v_remain) / t.s
             end as base,
             case
               when v_use_raw or v_remain = 0 or t.s = 0 then 0
               else (r.raw * v_remain) % t.s
             end as leftover
        from raw r cross join tot t
    ),
    need as (
      select greatest(0, v_remain - coalesce((select sum(base) from floors), 0))::int as extra
    ),
    ranked as (
      select f.*, row_number() over (order by f.leftover desc, f.user_id) as rk
        from floors f
    )
    select user_id, n, raw,
           case
             when v_use_raw then raw
             else base + case when rk <= (select extra from need) then 1 else 0 end
           end as paid
      from ranked
  loop
    if rec.paid > 0 then
      perform public.grant_reward_event(
        rec.user_id, v_day, 'vote_back_voter', p_request_id::text, rec.paid,
        jsonb_build_object(
          'request_id', p_request_id,
          'votes', rec.n,
          'raw', rec.raw,
          'capped50', not v_use_raw));
    end if;
  end loop;
end;
$$;

revoke all on function public.pay_vote_back(uuid) from public, anon, authenticated;
comment on function public.pay_vote_back(uuid) is
  'Settles the 10% vote-back for one request. Idempotent via vote_back_paid_at. Internal; never granted to clients.';

create or replace function public.requests_pay_vote_back()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.pay_vote_back(new.id);
  return new;
end;
$$;

revoke all on function public.requests_pay_vote_back() from public, anon, authenticated;

drop trigger if exists requests_vote_back_tri on public.requests;
create trigger requests_vote_back_tri
  after update of picked_at on public.requests
  for each row
  when (old.picked_at is null and new.picked_at is not null)
  execute function public.requests_pay_vote_back();

-- 4. B1: refuse unpick once the latch is set.
create or replace function public.admin_pick(p_id uuid, p_picked boolean default true)
returns public.requests language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;
  if not p_picked then
    if exists (
      select 1 from public.requests
       where id = p_id and vote_back_paid_at is not null
    ) then
      raise exception 'err.unpickLocked';
    end if;
  end if;
  update public.requests
     set picked_at  = case when p_picked then coalesce(picked_at, now()) else null end,
         updated_at = now()
   where id = p_id
     and status in ('queued','in_progress')
  returning * into r;
  if r.id is null then raise exception 'err.requestMissing'; end if;
  select * into r from public.requests where id = p_id;
  return r;
end $$;

create or replace function public.admin_pick_group(p_id uuid, p_picked boolean default true)
returns setof public.requests language plpgsql security definer set search_path = public as $$
declare
  v_artist text;
  v_title  text;
  r        public.requests;
begin
  if not public.is_admin() then raise exception 'err.adminOnly'; end if;

  select artist, title into v_artist, v_title
    from public.requests where id = p_id;
  if v_artist is null then raise exception 'err.requestMissing'; end if;

  if not p_picked then
    if exists (
      select 1 from public.requests
       where lower(btrim(artist)) = lower(btrim(v_artist))
         and lower(btrim(title))  = lower(btrim(v_title))
         and status in ('queued','in_progress')
         and vote_back_paid_at is not null
    ) then
      raise exception 'err.unpickLocked';
    end if;
  end if;

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
