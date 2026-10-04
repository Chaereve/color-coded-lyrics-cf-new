-- BEGIN PRESERVE LEGACY DAILY LOGIN REWARDS: mirror 20261119_preserve_legacy_daily_login_rewards.sql
-- Run AFTER 20261117_daily_quiz_flow.sql. Append-only, rerunnable, one
-- transaction. It is also safe to run AFTER 20261118 (which it supersedes).
--
-- Why this migration exists
-- -------------------------
-- 20261118 removed the +2 check-in reward the correct way at runtime, but it
-- also did two things that are wrong for an audit trail:
--   * UPDATE public.daily_login_rewards SET reward = 0 WHERE reward <> 0 — a
--     table-wide rewrite of historical records; and
--   * CHECK (reward = 0) — a table-wide rule that can only hold while history
--     has been rewritten, and that would reject a legitimate restore of
--     historical non-zero rows.
-- Historical check-in rows were valid under the policy of their own day. They
-- must stay truthful even though the wallet is never touched again.
--
-- What this migration does
-- ------------------------
--   1. Drops the table-wide CHECK. No UPDATE, no DELETE, no wallet subtraction:
--      a row that recorded reward = 2 keeps reward = 2 forever.
--   2. Enforces the zero-vote rule for FUTURE writes only, with a row trigger:
--      an INSERT must carry reward = 0, and an UPDATE may never move a reward
--      to a non-zero value (correcting 2 -> 0 stays allowed).
--   3. Keeps client write access closed (RLS with no write policy, privileges
--      revoked) so the security-definer RPC is the only way in, and refuses to
--      install if a write policy has been added.
--   4. Re-states the corrected claim_daily_login and daily_rewards_payload so
--      this file is complete on its own: a deployment can run 20261117 ->
--      20261119 and skip 20261118 entirely. Nothing here re-awards, backfills
--      or subtracts a vote.
--
-- Audit semantics after this migration
--   legacy rows   reward may be 2 (historical), never re-awarded, never summed
--   new rows      reward = 0, votes_awarded = 0, streak/calendar only
begin;

-- 1. No table-wide rule may invalidate or rewrite historical data.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'daily_login_rewards'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%reward%'
  loop
    execute format('alter table public.daily_login_rewards drop constraint %I', c.conname);
  end loop;
end $$;

-- 2. A NEW check-in carries no amount: the column default moves to 0 (a default
--    only affects future rows, so no historical value changes).
alter table public.daily_login_rewards alter column reward set default 0;

-- 3. The table stays writable only through the security-definer RPC: RLS is on
--    and no client role holds a write policy.
alter table public.daily_login_rewards enable row level security;
revoke all on public.daily_login_rewards from public, anon, authenticated;
grant all on public.daily_login_rewards to service_role;
do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'daily_login_rewards'
                and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) then
    raise exception 'daily_login_rewards must stay writable through claim_daily_login only';
  end if;
end $$;

-- 4. Future-write enforcement. A CHECK constraint cannot be scoped to new rows;
--    a trigger can. History is never touched: nothing runs unless a row is
--    inserted or its reward column is written.
create or replace function public.daily_login_rewards_no_vote()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.reward is distinct from 0 then
      raise exception 'err.dailyLoginRewardRetired';
    end if;
  elsif new.reward is distinct from old.reward and new.reward is distinct from 0 then
    -- Correcting a legacy amount down to 0 is allowed; writing any non-zero
    -- amount is not, so no future check-in can ever carry a vote again.
    raise exception 'err.dailyLoginRewardRetired';
  end if;
  return new;
end $$;

drop trigger if exists daily_login_rewards_no_vote on public.daily_login_rewards;
create trigger daily_login_rewards_no_vote
before insert or update of reward on public.daily_login_rewards
for each row execute function public.daily_login_rewards_no_vote();

comment on table public.daily_login_rewards is
  'Check-in history behind the daily login calendar: one row per account per Vietnam day. Rows created before 20261118 may carry the retired +2 amount (audit only, never re-awarded); every new row is reward = 0.';
comment on column public.daily_login_rewards.reward is
  'Historical amount granted under the retired policy (2), or 0 for every check-in from that policy onward. Never re-awarded, never summed, never paid out again.';

create or replace function public.claim_daily_login(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_claim public.daily_login_rewards;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  -- The same lock as votes/spin/achievements, and the same lock order as the
  -- quiz: no lost update even when several devices or tabs claim at once.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into v_claim from public.daily_login_rewards
    where user_id = v_uid and reward_day = p_expected_day;
  v_replayed := found;
  if not v_replayed then
    -- The expected day only guards stale clicks/retries at midnight. It NEVER
    -- selects the recorded date. A browser cannot check in for a past or a
    -- future day.
    if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;
    -- No wallet update: a check-in credits no bonus votes, no purchased votes
    -- and no free-vote grant. It only adds a day to the calendar ledger.
    insert into public.daily_login_rewards (user_id, reward_day, created_at)
    values (v_uid, v_day, v_now) returning * into v_claim;
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;
  return jsonb_build_object('reward', 0, 'votes_awarded', 0, 'replayed', v_replayed,
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.claim_daily_login(uuid,date) from public, anon, authenticated;
grant execute on function public.claim_daily_login(uuid,date) to authenticated;
create or replace function public.daily_rewards_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day),
  pool as (select public.daily_quiz_pool(p_uid, d.day) as p from d),
  mix as (select m.* from pool, public.daily_quiz_mix(pool.p) m),
  quiz_state as (
    select case
             when a.question_count <> 5 then 'retired'
             when a.locked then 'completed'
             else 'in_progress' end as state,
           a.*
      from public.daily_quiz_attempts a cross join d
     where a.user_id = p_uid and a.quiz_day = d.day
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'credits', p.vote_credits + p.bonus_credits,
    'purchased', p.vote_credits,
    'bonus', p.bonus_credits,
    -- A check-in is presence only: vote_reward is a constant 0 and the
    -- calendar/streak counters below are read-only statistics.
    'login', jsonb_build_object('claimed', l.user_id is not null, 'vote_reward', 0,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
        from public.daily_login_rewards c
        where c.user_id = p_uid
          and c.reward_day >= date_trunc('month', d.day)::date
          and c.reward_day <= d.day
      ), '[]'::jsonb),
      'total_days', coalesce(st.total_days, 0),
      'first_day', st.first_day,
      'streak', case when st.last_day is null or st.last_day < d.day - 1 then 0 else st.run end,
      'best_streak', coalesce(st.best_streak, 0)),
    -- Votes earned today come from the quiz alone.
    'earned_today', coalesce((select a.votes_awarded from quiz_state a), 0),
    'quiz', case
      when (select count(*) from quiz_state) = 0 then jsonb_build_object(
        'state', case when (select (p.p ->> 'total')::int from pool p) >= 5
                       and (select (p.p ->> 'easy')::int from pool p) >= (select mix.need_easy from mix)
                       and (select (p.p ->> 'medium')::int from pool p) >= (select mix.need_medium from mix)
                       and (select (p.p ->> 'hard')::int from pool p) >= (select mix.need_hard from mix)
                      then 'ready' else 'unavailable' end,
        'question_count', public.daily_quiz_int('questions_per_day', 5),
        'max_votes', public.daily_quiz_int('daily_vote_cap', 5),
        'pool', (select p.p from pool p))
      when (select state from quiz_state) = 'retired' then jsonb_build_object('state', 'retired')
      else jsonb_build_object(
        'state', (select state from quiz_state),
        'attempt_id', (select a.id from quiz_state a),
        'quiz_date', (select a.quiz_date from quiz_state a),
        'question_count', (select a.question_count from quiz_state a),
        'max_votes', (select a.max_votes from quiz_state a),
        'votes_awarded', (select a.votes_awarded from quiz_state a),
        'answered_count', (select count(*)::int from public.daily_quiz_answers w
                            where w.user_id = p_uid and w.quiz_date = d.day),
        'submitted_at', (select a.submitted_at from quiz_state a),
        'locked', (select a.locked from quiz_state a),
        'questions', (
          select jsonb_agg(
            jsonb_build_object('id', q.item ->> 'id', 'prompt', q.item ->> 'prompt',
              'options', q.item -> 'options', 'option_ids', q.item -> 'option_ids',
              'category', coalesce(q.item ->> 'category', 'Songs'),
              'difficulty', q.item ->> 'difficulty',
              'sub_category', q.item ->> 'sub_category',
              'question_type', q.item ->> 'question_type',
              'answered', w.question_id is not null)
            || case when w.question_id is null then '{}'::jsonb
               else jsonb_build_object('option_id', w.option_id, 'correct', w.correct,
                                       'awarded', w.awarded,
                                       'correct_option_id', q.item ->> 'correct_option_id',
                                       'explanation', q.item ->> 'explanation') end
            order by q.ord)
          from jsonb_array_elements((select a.questions from quiz_state a)) with ordinality as q(item, ord)
          left join public.daily_quiz_answers w
            on w.user_id = p_uid and w.quiz_date = d.day and w.question_id = q.item ->> 'id'
        )) end
  ) from d
  join public.profiles p on p.id = p_uid
  cross join pool
  left join lateral (
    select count(*)::int as total_days,
           min(c.reward_day) as first_day,
           (select max(x.reward_day) from public.daily_login_rewards x
             where x.user_id = p_uid and x.reward_day <= d.day) as last_day,
           coalesce((select max(runs.n) from (
             select count(*)::int as n from (
               select c2.reward_day - (row_number() over (order by c2.reward_day))::int as grp
               from public.daily_login_rewards c2 where c2.user_id = p_uid
             ) g group by g.grp
           ) runs), 0)::int as best_streak,
           coalesce((select count(*)::int from (
             select c3.reward_day - (row_number() over (order by c3.reward_day))::int as grp
             from public.daily_login_rewards c3
             where c3.user_id = p_uid and c3.reward_day <= d.day
           ) h group by h.grp order by h.grp desc limit 1), 0)::int as run
    from public.daily_login_rewards c
    where c.user_id = p_uid
  ) st on true
  left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day;
$$;
revoke all on function public.daily_rewards_payload(uuid,timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
