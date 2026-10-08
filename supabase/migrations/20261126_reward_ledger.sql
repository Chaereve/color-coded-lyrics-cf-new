-- REWARD LEDGER — the shared bookkeeping every vote reward goes through.
-- Run AFTER 20261125_reward_eligibility_and_quota_races.sql. Append-only,
-- rerunnable, one transaction. Not part of the fresh-install bundle (that
-- stays at baseline 20261120, like 20261121+).
--
-- Why this exists
-- ---------------
-- The approved 2026-10 plan brings vote rewards BACK to the daily check-in
-- (+2/day, +5 on cycle day 7, +10 per 7-day streak, +20 once at 30 days),
-- adds a mystery box, a vote-back when a request is picked, and re-points
-- achievement bonuses — all under ONE daily cap of 30 reward votes per
-- account. `daily_login_rewards.reward` cannot carry any of this: migration
-- 20261120 made that column immutable BY DESIGN (a recorded check-in amount
-- is history, never a payout path). So rewards are recorded in a dedicated
-- append-only ledger instead, and no historical check-in row is touched.
--
-- What this migration creates (data only, no behavior change yet):
--   * reward_config        — owner-tuned constants + feature flags. Seeded
--                            with the approved numbers; a re-run never
--                            overwrites a tuned value.
--   * reward_events        — one immutable row per granted reward slice,
--                            with a per-source idempotency key
--                            UNIQUE (source, user_id, day, ref).
--   * reward_milestone_once— lifetime-once markers (the 30-day streak bonus).
--   * typed config readers — fail closed on a missing/typed-wrong row
--                            (err.rewardConfig), mirroring the
--                            daily_vote_quota_* readers of 20261121.
--   * grant_reward_event   — the ONLY way app code grants reward votes:
--                            it measures the day's headroom under the cap,
--                            scales the grant down to fit, records the
--                            ledger row (idempotent), and credits the bonus
--                            wallet in the same statement stream. Callers
--                            already hold the profile row lock.
--
-- Cap scope (approved): login, spin, mystery, vote-back and achievement
-- VOTE rewards all share the 30/day cap. Purchased votes, the 3 free daily
-- votes (a quota, not a reward), admin season rewards and free paid requests
-- (bonus_requests, not votes) stay OUTSIDE the cap.
--
-- No wallet is written by this file itself; no reward is backfilled.

begin;

-- 1. Owner-tuned constants and flags. Boolean keys vs numeric keys are
--    validated separately; numerics are bounded so a typo can neither zero
--    out nor explode the economy.
create table if not exists public.reward_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint reward_config_key_check check (key in (
    'login_rewards_enabled',
    'login_daily_votes',
    'login_day7_extra',
    'login_milestone7_bonus',
    'login_milestone30_bonus',
    'daily_reward_cap')),
  constraint reward_config_value_check check (
    case
      when key = 'login_rewards_enabled'
        then jsonb_typeof(value) = 'boolean'
      when key in ('login_daily_votes','login_day7_extra','login_milestone7_bonus',
                   'login_milestone30_bonus','daily_reward_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric between 0 and 1000
      else false
    end)
);

alter table public.reward_config enable row level security;
revoke all on public.reward_config from public, anon, authenticated;
grant all on public.reward_config to service_role;
-- Owner-only tuning is a reviewed SQL change, never a browser write: the
-- table has NO client policy, exactly like daily_vote_quota_config.

-- do-nothing on conflict: a re-run must never clobber a tuned value.
insert into public.reward_config (key, value) values
  ('login_rewards_enabled',  'true'::jsonb),
  ('login_daily_votes',      '2'::jsonb),
  ('login_day7_extra',       '5'::jsonb),
  ('login_milestone7_bonus', '10'::jsonb),
  ('login_milestone30_bonus','20'::jsonb),
  ('daily_reward_cap',       '30'::jsonb)
on conflict (key) do nothing;

-- 2. The ledger. No FK on purpose (mirrors daily_vote_quota_earnings): an
--    immutable audit row may outlive its auth profile, and account deletion
--    behavior stays unchanged.
create table if not exists public.reward_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  day        date not null,
  source     text not null check (source in (
               'daily_login','login_day7','login_milestone7','login_milestone30',
               'daily_spin','mystery_box','vote_back_owner','vote_back_voter',
               'achievement')),
  amount     int not null check (amount > 0),
  ref        text not null check (length(ref) between 1 and 120),
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  -- Idempotency lives in the database, not in caller discipline: the same
  -- (source, account, day, ref) can never pay twice, even under a race.
  constraint reward_events_idem_key unique (source, user_id, day, ref)
);
create index if not exists reward_events_user_day_idx on public.reward_events (user_id, day);
create index if not exists reward_events_day_idx on public.reward_events (day);

-- Lifetime-once markers. The 30-day bonus must not depend on which day the
-- streak finally crossed 30, so uniqueness is per milestone, not per day.
create table if not exists public.reward_milestone_once (
  user_id     uuid not null,
  milestone   text not null check (milestone in ('login_30')),
  granted_day date not null,
  created_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, milestone)
);

alter table public.reward_events enable row level security;
alter table public.reward_milestone_once enable row level security;
revoke all on public.reward_events, public.reward_milestone_once
  from public, anon, authenticated;
grant all on public.reward_events, public.reward_milestone_once to service_role;
-- No client policy on either table: reading happens through the owner-scoped
-- RPCs, writing through security-definer functions only.

comment on table public.reward_config is
  'Owner-tuned reward constants and feature flags (approved 2026-10 plan). Change through reviewed SQL only; never from the browser.';
comment on table public.reward_events is
  'Append-only ledger of granted vote rewards. One row per (source, user, Vietnam day, ref); amount is what was actually paid after the daily 30-vote cap scaled the request down (meta.requested keeps the ask).';
comment on table public.reward_milestone_once is
  'Lifetime-once reward markers. A row here means the milestone bonus was paid IN FULL; a partially capped grant retries on later check-ins instead of marking the row.';

-- 3. Typed config readers — the 20261121 pattern: a missing row, a NULL or a
--    wrong JSON type RAISES instead of silently widening the economy.
create or replace function public.reward_config_bool(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_value jsonb;
begin
  select value into v_value from public.reward_config where key = p_key;
  if not found or v_value is null or jsonb_typeof(v_value) <> 'boolean' then
    raise exception 'err.rewardConfig';
  end if;
  return (v_value #>> '{}')::boolean;
end $$;
revoke all on function public.reward_config_bool(text) from public, anon, authenticated;

create or replace function public.reward_config_int(p_key text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_value jsonb;
begin
  select value into v_value from public.reward_config where key = p_key;
  if not found or v_value is null or jsonb_typeof(v_value) <> 'number'
     or (v_value #>> '{}') !~ '^[0-9]+$'
     or (v_value #>> '{}')::numeric > 1000 then
    raise exception 'err.rewardConfig';
  end if;
  return (v_value #>> '{}')::integer;
end $$;
revoke all on function public.reward_config_int(text) from public, anon, authenticated;

-- 4. Read-only accounting helpers (internal; never granted to clients).
create or replace function public.reward_votes_used_on(p_uid uuid, p_day date)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
    from public.reward_events
   where user_id = p_uid and day = p_day
$$;
revoke all on function public.reward_votes_used_on(uuid,date) from public, anon, authenticated;

-- Lifetime total already paid for one idempotency slot, across every day.
-- Achievement bonuses top up through this: a grant clipped by the cap on
-- Monday resumes on a later claim instead of being lost forever.
create or replace function public.reward_granted_total(p_uid uuid, p_source text, p_ref text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
    from public.reward_events
   where user_id = p_uid and source = p_source and ref = p_ref
$$;
revoke all on function public.reward_granted_total(uuid,text,text) from public, anon, authenticated;

-- 5. The single grant path. Caller contract: same transaction as the action,
--    profile row already locked (FOR UPDATE) so concurrent claims serialize.
--    Returns the amount actually credited (0 when the cap left nothing).
create or replace function public.grant_reward_event(
  p_uid uuid, p_day date, p_source text, p_ref text,
  p_amount int, p_meta jsonb default '{}'::jsonb
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cap    integer;
  v_used   integer;
  v_grant  integer;
  v_paid   integer;
begin
  if p_uid is null or p_day is null or p_source is null or p_ref is null
     or p_amount is null or p_amount <= 0 then
    return 0;
  end if;

  -- Belt and suspenders: every caller holds this lock already; taking it here
  -- keeps the helper correct even if a future caller forgets.
  perform 1 from public.profiles where id = p_uid for update;
  if not found then return 0; end if;

  v_cap  := public.reward_config_int('daily_reward_cap');
  v_used := public.reward_votes_used_on(p_uid, p_day);
  v_grant := least(p_amount, greatest(0, v_cap - v_used));
  if v_grant <= 0 then return 0; end if;

  insert into public.reward_events (user_id, day, source, ref, amount, meta)
  values (p_uid, p_day, p_source, p_ref, v_grant,
          case when v_grant < p_amount
               then jsonb_build_object('requested', p_amount, 'clipped', true) || coalesce(p_meta, '{}'::jsonb)
               else coalesce(p_meta, '{}'::jsonb) end)
  on conflict (source, user_id, day, ref) do nothing
  returning amount into v_paid;

  if v_paid is null then return 0; end if;  -- lost a same-slot race: already paid

  update public.profiles
     set bonus_credits = bonus_credits + v_paid
   where id = p_uid;
  return v_paid;
end $$;
revoke all on function public.grant_reward_event(uuid,date,text,text,integer,jsonb)
  from public, anon, authenticated;
-- Internal helper: callable only by other security-definer functions (the
-- claim/achievement paths), never by anon/authenticated/service_role clients.

notify pgrst, 'reload schema';
commit;
