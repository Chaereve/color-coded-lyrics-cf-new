
-- BEGIN DAILY LOGIN NO VOTES: mirror 20261118_daily_login_no_votes.sql
-- Run AFTER 20261117_daily_quiz_flow.sql. One transaction, rerunnable.
--
-- Append-only corrective migration. It does NOT edit or replace any historical
-- migration file; it corrects the daily-rewards behaviour that 20261112 shipped
-- and that 20261114 / 20261116 carried forward:
--
--   * Daily login (the calendar at /daily-login) grants NOTHING. The calendar,
--     monthly history, the current-day check-in, the streak, the best streak,
--     the lifetime check-in count and the monthly progress bar all stay
--     exactly as they are — only the reward disappears.
--   * The Daily Quiz is now the ONLY path that awards votes: 1 correct answer
--     = 1 vote, hard ceiling 5 votes per user per quiz day.
--   * The retired automatic "3 free votes per day" grant stays off
--     (free_vote_grant_enabled = false) and no new auto-vote path is added.
--   * A check-in plus five correct quiz answers is 5 votes, never 7.
--
-- Nothing here subtracts from a wallet: no vote already granted in production
-- is reversed. Check-in history is preserved; only the reward column, which
-- used to carry the +2 vote amount, is zeroed and locked at 0.
begin;

-- 1. The check-in row IS the calendar history and must survive: the day is the
--    record, the streak is derived from it. Only the amount changes — 0 is now
--    the only legal value, so no function, trigger, import or manual query can
--    turn a check-in into votes again.
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

update public.daily_login_rewards set reward = 0 where reward <> 0;

alter table public.daily_login_rewards
  alter column reward set default 0,
  add constraint daily_login_rewards_reward_check check (reward = 0);

comment on table public.daily_login_rewards is
  'Check-in history behind the daily login calendar: one row per account per Vietnam day. A check-in never awards votes (20261118).';
comment on column public.daily_login_rewards.reward is
  'Always 0 — a check-in tracks presence and streak only. Votes come from the Daily Quiz alone.';

-- 2. Claiming records the day and nothing else. The wallet update that used to
--    credit +2 bonus votes is gone; the lock, the stale-click guard and the
--    replay return are unchanged, so a double tap or a retry at midnight can
--    still never create a second row.
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

-- 3. The sanitized payload: identical to 20261116 except that check-in can no
--    longer imply a vote.
--      · login.reward is replaced by login.vote_reward, permanently 0. An
--        un-migrated server still answers reward = 2 and the client rejects it
--        instead of quietly showing seven votes a day.
--      · earned_today counts quiz votes only, so "today" can never be
--        check-in (0) + quiz (5) + anything else.
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
