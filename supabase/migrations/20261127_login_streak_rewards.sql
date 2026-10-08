-- DAILY LOGIN REWARDS — check-ins pay votes again (approved 2026-10 plan).
-- Run AFTER 20261126_reward_ledger.sql. One transaction, rerunnable.
--
-- Approved rules (all amounts in VOTES, all under the shared daily cap):
--   * every check-in:            +2
--   * cycle day 7 (streak 7,14,21,...): +2 check-in AND +5 cycle bonus
--                                = 7 votes that day (ADDITIVE, owner-confirmed)
--   * every completed 7-day streak:     +10 (the cycle resets, so this
--                                repeats on streaks 7, 14, 21, 28, ...)
--   * first 30-day streak ever:         +20, exactly once per account
--   * missing one day resets the streak to 0 and the cycle restarts
--
-- What is deliberately NOT touched:
--   * daily_login_rewards rows/columns — 20261120 made the recorded reward
--     immutable and new rows are reward = 0. That stays true: this migration
--     never writes that column (the trigger would reject it anyway) and pays
--     exclusively through reward_events.
--   * daily_login_calendar_payload / my_daily_login_status — the calendar
--     response keeps its exact key set, so an old bundle keeps working while
--     the database is ahead (rollout-safe in both directions). The reward
--     view of the world is a NEW, separately-callable RPC.
--
-- Behavior is gated by reward_config.login_rewards_enabled: with the flag off
-- (or before this file runs) check-ins behave exactly as today — calendar and
-- streak only, no wallet movement.

begin;

-- 1. The reward view used by BOTH the standalone status RPC and the claim
--    response. Exact key contract, validated by the client.
create or replace function public.login_reward_status(p_uid uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  with runs as (
    select count(*)::int as n from (
      select r.reward_day - (row_number() over (order by r.reward_day))::int as grp
        from public.daily_login_rewards r
       where r.user_id = p_uid and r.reward_day <= p_day
    ) streak_rows group by streak_rows.grp order by streak_rows.grp desc limit 1
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', p_day,
    'enabled', public.reward_config_bool('login_rewards_enabled'),
    'cap', public.reward_config_int('daily_reward_cap'),
    'cap_used', public.reward_votes_used_on(p_uid, p_day),
    'cap_left', greatest(0,
      public.reward_config_int('daily_reward_cap') - public.reward_votes_used_on(p_uid, p_day)),
    'streak', coalesce((select n from runs), 0),
    'cycle_day', case when coalesce((select n from runs), 0) = 0 then 0
                      else ((coalesce((select n from runs), 0) - 1) % 7) + 1 end,
    'milestone30_granted', exists (
      select 1 from public.reward_milestone_once
       where user_id = p_uid and milestone = 'login_30'),
    'today_total', public.reward_votes_used_on(p_uid, p_day),
    'breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('source', e.source, 'amount', e.amount) order by e.id)
        from public.reward_events e
       where e.user_id = p_uid and e.day = p_day), '[]'::jsonb)
  )
$$;
revoke all on function public.login_reward_status(uuid,date) from public, anon, authenticated;

create or replace function public.my_login_reward_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  return public.login_reward_status(v_uid,
    (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date);
end $$;
revoke all on function public.my_login_reward_status() from public, anon, authenticated;
grant execute on function public.my_login_reward_status() to authenticated;

comment on function public.my_login_reward_status() is
  'Owner-scoped reward view for the check-in screen: today''s granted slices, the cycle day, the 30-day marker and the daily-cap meter. Identity is auth.uid(); amounts are votes actually credited after the daily cap.';

-- 2. The claim RPC: same calendar semantics as 20261121 (identity from
--    auth.uid(), expected day is a stale-client guard only, replay returns
--    the existing day without paying again), plus the approved rewards.
create or replace function public.claim_daily_login_calendar(p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_now      timestamptz;
  v_day      date;
  v_replayed boolean;
  v_enabled  boolean;
  v_streak   int := 0;
  v_cycle    int := 0;
  v_amount   int;
  v_paid     int;
  v_slice    int;
  v_bonus    int;
  v_total    int := 0;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  -- The same profile lock every reward path takes: concurrent claims (two
  -- tabs, retry after a lost response) serialize here, and the second caller
  -- observes the committed check-in row and replays instead of paying twice.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  perform 1 from public.daily_login_rewards
   where user_id = v_uid and reward_day = v_day;
  v_replayed := found;
  if not v_replayed then
    -- The check-in itself: unchanged shape and rules (reward column stays 0;
    -- the immutable trigger of 20261120 keeps guarding it).
    insert into public.daily_login_rewards (user_id, reward_day, reward, created_at)
      values (v_uid, v_day, 0, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;

    v_enabled := public.reward_config_bool('login_rewards_enabled');
    if v_enabled then
      -- Streak including today — the same run-length rule the calendar
      -- payload reports, computed after the check-in row exists.
      select count(*)::int into v_streak from (
        select r.reward_day - (row_number() over (order by r.reward_day))::int as grp
          from public.daily_login_rewards r
         where r.user_id = v_uid and r.reward_day <= v_day
      ) streak_rows
       group by streak_rows.grp
       order by streak_rows.grp desc
       limit 1;
      v_streak := coalesce(v_streak, 0);
      v_cycle  := case when v_streak = 0 then 0 else ((v_streak - 1) % 7) + 1 end;

      -- (a) the check-in itself: +2 every day
      v_paid := public.grant_reward_event(v_uid, v_day, 'daily_login', v_day::text,
        public.reward_config_int('login_daily_votes'));
      v_total := v_total + v_paid;

      -- (b) cycle day 7: +5 ON TOP of the +2 (owner decision 2026-10)
      if v_cycle = 7 then
        v_paid := public.grant_reward_event(v_uid, v_day, 'login_day7', v_day::text,
          public.reward_config_int('login_day7_extra'));
        v_total := v_total + v_paid;
      end if;

      -- (c) every completed 7-day streak: +10 (same day as (a)+(b) at 7/14/21/...)
      if v_streak > 0 and v_streak % 7 = 0 then
        v_paid := public.grant_reward_event(v_uid, v_day, 'login_milestone7', v_day::text,
          public.reward_config_int('login_milestone7_bonus'));
        v_total := v_total + v_paid;
      end if;

      -- (d) first 30-day streak ever: +20, lifetime once. A grant clipped by
      --     the daily cap is NOT marked done: the remaining amount tops up on
      --     a later check-in (streak still >= 30) instead of being lost, and
      --     the marker row is written only when fully paid. Payments are
      --     slice refs ('once#1', 'once#2', ...) — a fresh idempotency slot
      --     per slice, so a same-day retry after the cap widens cannot collide
      --     with the clipped slice it follows.
      if v_streak >= 30 and not exists (
           select 1 from public.reward_milestone_once
            where user_id = v_uid and milestone = 'login_30') then
        v_bonus := public.reward_config_int('login_milestone30_bonus');
        select coalesce(sum(amount), 0)::int into v_paid
          from public.reward_events
         where user_id = v_uid and source = 'login_milestone30'
           and ref like 'once#%';
        if v_paid < v_bonus then
          select count(*)::int + 1 into v_slice
            from public.reward_events
           where user_id = v_uid and source = 'login_milestone30'
             and ref like 'once#%';
          v_amount := public.grant_reward_event(v_uid, v_day, 'login_milestone30',
            'once#' || v_slice, v_bonus - v_paid,
            jsonb_build_object('streak', v_streak));
          v_paid := v_paid + v_amount;
          v_total := v_total + v_amount;
        end if;
        if v_paid >= v_bonus then
          insert into public.reward_milestone_once (user_id, milestone, granted_day)
            values (v_uid, 'login_30', v_day)
            on conflict (user_id, milestone) do nothing;
        end if;
      end if;

      -- One bell notification per rewarded day (idempotent via sig).
      if v_total > 0 then
        insert into public.notifications (user_id, song_key, kind, title, reason, sig)
        values (
          v_uid,
          'login-reward',
          'votes',
          'Daily check-in reward',
          'Check-in streak day ' || v_streak || ': +' || v_total || ' bonus votes today.',
          'login-reward|' || v_day::text
        )
        on conflict (user_id, sig) where sig is not null do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'replayed', v_replayed,
    'status', public.daily_login_calendar_payload(v_uid, v_now),
    'rewards', public.login_reward_status(v_uid, v_day)
  );
end $$;
revoke all on function public.claim_daily_login_calendar(date) from public, anon, authenticated;
grant execute on function public.claim_daily_login_calendar(date) to authenticated;

comment on function public.claim_daily_login_calendar(date) is
  'Calendar claim plus approved check-in rewards (2026-10 plan): +2/day, +5 additive on cycle day 7, +10 per completed 7-day streak, +20 once at a 30-day streak — all recorded in reward_events under the shared daily cap. The check-in row itself is unchanged (reward column stays 0); p_expected_day is only a stale-client guard.';

notify pgrst, 'reload schema';
commit;
