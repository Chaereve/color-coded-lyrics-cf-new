-- BEGIN DAILY QUIZ FLOW: mirror 20261117_daily_quiz_flow.sql
-- Five-question Daily Quiz — start, per-answer submission and vote accounting.
-- Run AFTER 20261116_daily_quiz_pool.sql. Rerunnable.
--
-- Server-side rules (never decided by the browser):
--   · exactly 5 questions per user per quiz date (Asia/Ho_Chi_Minh),
--   · launch mix = exactly 2 easy + 3 medium, from the validated pool only,
--   · 1 correct answer = 1 bonus vote, hard cap 5 votes per user per quiz date,
--     enforced by unique (user_id, quiz_date, question_id) in the answer ledger,
--   · the automatic 3-free-votes/day grant is retired by configuration, so
--     Daily Quiz votes cannot stack with it.
begin;

-- 8. START
-- =========================================================
create or replace function public.start_daily_quiz(p_expected_user_id uuid, p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_pool jsonb;
  v_easy int;
  v_medium int;
  v_hard int;
  v_ids text[];
  v_questions jsonb;
  v_level int;
  v_relaxed jsonb := '[]'::jsonb;
  v_replayed boolean;
  v_total int := public.daily_quiz_int('questions_per_day', 5);
  v_min_artists int := public.daily_quiz_int('min_distinct_artists', 3);
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily_quiz:' || v_uid::text, 11));
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  select * into v_attempt from public.daily_quiz_attempts
    where user_id = v_uid and quiz_day = v_day;
  v_replayed := found;
  if v_replayed then
    return jsonb_build_object('attempt_id', v_attempt.id, 'quiz_date', v_attempt.quiz_date,
      'replayed', true, 'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
  end if;

  v_pool := public.daily_quiz_pool(v_uid, v_day);
  select m.need_easy, m.need_medium, m.need_hard into v_easy, v_medium, v_hard
    from public.daily_quiz_mix(v_pool) m;

  -- Not enough validated material: say so instead of falling back to the
  -- unverified legacy bank. This is a product state, not an error to hide.
  if coalesce((v_pool ->> 'easy')::int, 0) < v_easy
     or coalesce((v_pool ->> 'medium')::int, 0) < v_medium
     or coalesce((v_pool ->> 'hard')::int, 0) < v_hard
     or (v_easy + v_medium + v_hard) <> v_total then
    raise exception 'err.dailyQuizUnavailable';
  end if;

  -- Documented, deterministic relaxation ladder. Production eligibility,
  -- source validation, safety, the vote cap and the set size are NEVER relaxed.
  for v_level in 0 .. 3 loop
    select array(select p.question_id from public.daily_quiz_pick(
        v_uid, v_day, v_easy, v_medium, v_hard,
        v_level < 1,                                       -- 90-day cooldown
        case when v_level < 2 then v_min_artists else 0 end, -- distinct artists
        v_level < 3, v_level < 3) p)                        -- profile + lyrics minimums
      into v_ids;
    -- Every step taken is recorded, including the one that finally worked, so
    -- an auditor can see exactly which preferences had to give way.
    v_relaxed := v_relaxed || to_jsonb(v_level);
    if coalesce(array_length(v_ids, 1), 0) = v_total then exit; end if;
    v_relaxed := v_relaxed || to_jsonb(v_level);
  end loop;

  if coalesce(array_length(v_ids, 1), 0) <> v_total then
    raise exception 'err.dailyQuizUnavailable';
  end if;

  -- Freeze everything the round needs, private fields included. Later edits or
  -- retirements cannot change a round that has already been handed out.
  select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'options', q.options,
      'option_ids', q.option_ids, 'correct_option', q.correct_option,
      'correct_option_id', q.correct_option_id, 'explanation', q.explanation,
      'category', q.category, 'difficulty', q.difficulty, 'sub_category', q.sub_category,
      'question_type', q.question_type, 'artist', q.artist)
    order by array_position(v_ids, q.id))
    into v_questions
    from public.daily_quiz_questions q
   where q.id = any (v_ids);

  if v_questions is null or jsonb_array_length(v_questions) <> v_total then
    raise exception 'err.dailySetup';
  end if;

  insert into public.daily_quiz_attempts
    (user_id, quiz_day, quiz_date, questions, question_count, max_votes, created_at,
     selection)
  values (v_uid, v_day, v_day, v_questions, v_total,
          public.daily_quiz_int('daily_vote_cap', 5), v_now,
          jsonb_build_object('pool', v_pool, 'mix', jsonb_build_object(
            'easy', v_easy, 'medium', v_medium, 'hard', v_hard),
            'relaxed_steps', v_relaxed,
            'hard_enabled', public.daily_quiz_bool('hard_question_enabled', false)))
  returning * into v_attempt;

  insert into public.daily_quiz_seen (user_id, question_id, last_seen)
    select v_uid, u, v_day from unnest(v_ids) u
  on conflict (user_id, question_id)
    do update set last_seen = greatest(public.daily_quiz_seen.last_seen, excluded.last_seen);

  insert into public.activity_days (user_id, day) values (v_uid, v_day)
    on conflict (user_id, day) do nothing;

  return jsonb_build_object('attempt_id', v_attempt.id, 'quiz_date', v_attempt.quiz_date,
    'replayed', false, 'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.start_daily_quiz(uuid,date) from public, anon, authenticated;
grant execute on function public.start_daily_quiz(uuid,date) to authenticated;

-- =========================================================
-- 9. SUBMIT ONE ANSWER
-- =========================================================
create or replace function public.submit_daily_quiz_answer(
  p_expected_user_id uuid,
  p_attempt_id uuid,
  p_question_id text,
  p_option_id text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_attempt public.daily_quiz_attempts;
  v_item jsonb;
  v_correct boolean;
  v_awarded int := 0;
  v_cap int := public.daily_quiz_int('daily_vote_cap', 5);
  v_votes int;
  v_answered int;
  v_replayed boolean := false;
  v_stored public.daily_quiz_answers;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  if p_expected_user_id is distinct from v_uid then raise exception 'err.dailyAccountChanged'; end if;
  if p_question_id is null or p_option_id is null then raise exception 'err.dailyQuizAnswers'; end if;

  -- Same lock order everywhere: profile, then advisory, then attempt.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily_quiz:' || v_uid::text, 11));

  select * into v_attempt from public.daily_quiz_attempts
    where id = p_attempt_id and user_id = v_uid for update;
  if not found then raise exception 'err.dailyQuizSession'; end if;
  if v_attempt.question_count <> 5 then raise exception 'err.dailyQuizRetired'; end if;
  -- The award ceiling is the smaller of the configured cap and the ceiling
  -- frozen into the attempt at start time.
  v_cap := least(v_cap, v_attempt.max_votes);

  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if v_attempt.quiz_date is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  -- The question must be one this user was actually assigned, and the option
  -- must belong to that question. Both come from the frozen snapshot.
  select item into v_item
    from jsonb_array_elements(v_attempt.questions) item
   where item ->> 'id' = p_question_id;
  if v_item is null then raise exception 'err.dailyQuizQuestion'; end if;
  if not (p_option_id = any (array(select jsonb_array_elements_text(v_item -> 'option_ids')))) then
    raise exception 'err.dailyQuizOption';
  end if;

  -- Idempotency: one row per (user, quiz date, question) ever.
  select * into v_stored from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day and question_id = p_question_id;
  v_replayed := found;

  if not v_replayed then
    v_correct := (p_option_id = (v_item ->> 'correct_option_id'));
    select count(*)::int into v_votes from public.daily_quiz_answers
      where user_id = v_uid and quiz_date = v_day and awarded = 1;
    -- Cap is re-read after the locks, inside the same transaction.
    v_awarded := case when v_correct and v_votes < v_cap then 1 else 0 end;

    insert into public.daily_quiz_answers
      (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded, answered_at)
    values (v_uid, v_day, p_question_id, v_attempt.id, p_option_id, v_correct, v_awarded, v_now)
    on conflict (user_id, quiz_date, question_id) do nothing;

    if not found then
      -- A concurrent request (second tab, retry, replay) won the race: return
      -- its stored result instead of awarding anything.
      select * into v_stored from public.daily_quiz_answers
        where user_id = v_uid and quiz_date = v_day and question_id = p_question_id;
      v_replayed := true;
    else
      v_stored := null;
    end if;

    if not v_replayed then
      if v_awarded = 1 then
        update public.profiles set bonus_credits = bonus_credits + 1 where id = v_uid;
      end if;
      insert into public.activity_days (user_id, day) values (v_uid, v_day)
        on conflict (user_id, day) do nothing;
    end if;
  end if;

  select count(*)::int into v_votes from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day and awarded = 1;
  select count(*)::int into v_answered from public.daily_quiz_answers
    where user_id = v_uid and quiz_date = v_day;

  if not v_replayed then
    update public.daily_quiz_attempts
       set votes_awarded = v_votes,
           locked        = (v_answered >= v_attempt.question_count),
           submitted_at  = case when v_answered >= v_attempt.question_count then v_now else null end
     where id = v_attempt.id;
  end if;

  return jsonb_build_object(
    'question_id', p_question_id,
    'replayed', v_replayed,
    'correct', coalesce(v_stored.correct,
      (p_option_id = (v_item ->> 'correct_option_id'))),
    'option_id', coalesce(v_stored.option_id, p_option_id),
    'correct_option_id', v_item ->> 'correct_option_id',
    'explanation', v_item ->> 'explanation',
    'awarded', coalesce(v_stored.awarded, v_awarded),
    'votes_awarded', v_votes,
    'answered_count', v_answered,
    'question_count', v_attempt.question_count,
    'locked', (v_answered >= v_attempt.question_count),
    'status', public.daily_rewards_payload(v_uid, clock_timestamp()));
end $$;
revoke all on function public.submit_daily_quiz_answer(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.submit_daily_quiz_answer(uuid,uuid,text,text) to authenticated;

-- The old all-at-once path graded the unverified legacy bank. Retired: no
-- round created before this migration may award votes from unvalidated
-- questions, and no new round can use this signature.
create or replace function public.submit_daily_quiz(p_expected_user_id uuid, p_attempt_id uuid, p_answers int[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'err.dailyQuizRetired';
end $$;
revoke all on function public.submit_daily_quiz(uuid,uuid,int[]) from public, anon, authenticated;

-- =========================================================
-- 10. VOTES: Daily Quiz accounting, and the retired free grant
-- =========================================================
-- Votes a user has actually earned from the quiz today. Read by the grant and
-- cap logic; never by the client.
create or replace function public.daily_quiz_votes_on(p_uid uuid, p_day date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.daily_quiz_answers
   where user_id = p_uid and quiz_date = p_day and awarded = 1;
$$;
revoke all on function public.daily_quiz_votes_on(uuid,date) from public, anon, authenticated;

-- How many automatic free votes the account gets today. With
-- free_vote_grant_enabled = false (the launch policy) the answer is 0: a user
-- earns votes through Daily Quiz answers, or buys them. Turning the switch
-- back on restores the old per-day grant, optionally shared with quiz votes
-- under one global cap.
create or replace function public.daily_free_vote_grant(p_uid uuid, p_day date)
returns int language sql stable security definer set search_path = public as $$
  select case
    when not public.daily_quiz_bool('free_vote_grant_enabled', false) then 0
    when public.daily_quiz_bool('global_daily_vote_cap_enabled', false) then
      greatest(0, least(public.daily_quiz_int('free_votes_per_day', 3),
                        public.daily_quiz_int('global_daily_vote_cap', 5)
                        - public.daily_quiz_votes_on(p_uid, p_day)))
    else greatest(0, public.daily_quiz_int('free_votes_per_day', 3))
  end;
$$;
revoke all on function public.daily_free_vote_grant(uuid,date) from public, anon, authenticated;

create or replace function public.my_vote_status()
returns table (free_used int, free_limit int, credits int, purchased int, bonus int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  return query
    select
      (select count(*)::int from public.votes
        where user_id = v_uid and used_credit = false and vote_day = v_day),
      public.daily_free_vote_grant(v_uid, v_day),
      (select vote_credits + bonus_credits from public.profiles where id = v_uid),
      (select vote_credits from public.profiles where id = v_uid),
      (select bonus_credits from public.profiles where id = v_uid);
end $$;

create or replace function public.cast_vote(
  p_request_id uuid,
  p_delta int default 1,
  p_fp_hash text default null,
  p_ip_hash text default null,
  p_gate_token text default null
)
returns table (votes int, my_votes int, free_used int, credits int)
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_day       date;
  v_new       int;
  v_status    text;
  v_picked    timestamptz;
  v_mine      int;
  v_n         int;
  v_purch     int;
  v_bonus     int;
  v_credit    int;
  v_freeUsed  int;
  v_fpUsed    int := 0;
  v_grant     int;
  v_freeLeft  int;
  v_fpLeft    int;
  v_useFree   int;
  v_useCred   int;
  v_useBonus  int;
  v_usePurch  int;
  v_capped    boolean := false;
  v_refBonus  int;
  v_refPurch  int;
begin
  if v_uid is null then raise exception 'err.voteAuth'; end if;
  if p_delta = 0 or abs(p_delta) > 100 then raise exception 'err.voteQty'; end if;

  if not public.edge_gate_ok(p_gate_token) then raise exception 'err.voteGate'; end if;

  if p_fp_hash is not null and p_fp_hash !~ '^[a-f0-9]{64}$' then p_fp_hash := null; end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then p_ip_hash := null; end if;

  select r.status, r.picked_at into v_status, v_picked
    from public.requests r where r.id = p_request_id;
  if v_status is null then raise exception 'err.requestMissing'; end if;
  if v_status not in ('queued','in_progress') then raise exception 'err.voteClosed'; end if;
  if v_picked is not null then raise exception 'err.voteLocked'; end if;

  select p.vote_credits, p.bonus_credits into v_purch, v_bonus
    from public.profiles p where p.id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  if p_fp_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_fp_hash, 3));
  end if;

  v_n     := abs(p_delta);
  v_day   := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_grant := public.daily_free_vote_grant(v_uid, v_day);
  v_credit := v_purch + v_bonus;

  if p_delta < 0 then
    select count(*) into v_mine from public.votes
     where request_id = p_request_id and user_id = v_uid;
    if v_mine < v_n then raise exception 'err.notVoted'; end if;

    with doomed as (
      select id, credit_kind, used_credit from public.votes
       where request_id = p_request_id and user_id = v_uid
       order by created_at desc, id desc
       limit v_n
    ), gone as (
      delete from public.votes v using doomed d where v.id = d.id
      returning v.credit_kind, v.used_credit
    )
    select
      count(*) filter (where credit_kind = 'bonus'),
      count(*) filter (where credit_kind = 'purchased'
                          or (credit_kind is null and used_credit))
      into v_refBonus, v_refPurch
    from gone;

    if coalesce(v_refBonus, 0) > 0 or coalesce(v_refPurch, 0) > 0 then
      update public.profiles
         set bonus_credits = bonus_credits + coalesce(v_refBonus, 0),
             vote_credits  = vote_credits  + coalesce(v_refPurch, 0)
       where id = v_uid;
    end if;

    update public.requests r set votes = greatest(r.votes - v_n, 0), updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  else
    select count(*)::int into v_freeUsed from public.votes
     where user_id = v_uid and used_credit = false and vote_day = v_day;
    v_freeLeft := greatest(v_grant - v_freeUsed, 0);

    -- Hạn mức vân tay: đếm CHUNG mọi tài khoản trên cùng một trình duyệt.
    v_fpLeft := v_freeLeft;
    if p_fp_hash is not null then
      select count(*)::int into v_fpUsed from public.votes
       where fp_hash = p_fp_hash and used_credit = false and vote_day = v_day;
      v_fpLeft := greatest(v_grant - v_fpUsed, 0);
      if v_fpLeft < v_freeLeft then v_capped := true; end if;
    end if;

    v_useFree := least(v_n, v_freeLeft, v_fpLeft);
    v_useCred := v_n - v_useFree;

    if v_useCred > v_credit then
      if v_capped and v_useCred > 0 then
        raise exception 'err.voteFpLimit' using detail = v_fpLeft::text;
      end if;
      raise exception 'err.notEnoughVotes' using detail = (v_freeLeft + v_credit)::text;
    end if;

    v_useBonus := least(v_useCred, v_bonus);
    v_usePurch := v_useCred - v_useBonus;

    if v_useCred > 0 then
      update public.profiles
         set bonus_credits = bonus_credits - v_useBonus,
             vote_credits  = vote_credits  - v_usePurch
       where id = v_uid;
    end if;

    insert into public.votes (
      request_id, user_id, used_credit, credit_kind,
      vote_day, free_slot, fp_slot, fp_hash, ip_hash
    )
    select
      p_request_id, v_uid, g.i > v_useFree,
      case when g.i <= v_useFree                then 'free'
           when g.i <= v_useFree + v_useBonus   then 'bonus'
           else 'purchased' end,
      v_day,
      case when g.i <= v_useFree then (v_freeUsed + g.i)::smallint end,
      case when g.i <= v_useFree and p_fp_hash is not null
           then (v_fpUsed + g.i)::smallint end,
      p_fp_hash, p_ip_hash
    from generate_series(1, v_n) as g(i);

    update public.requests r set votes = r.votes + v_n, updated_at = now()
      where r.id = p_request_id returning r.votes into v_new;
  end if;

  select count(*)::int into v_mine from public.votes
   where request_id = p_request_id and user_id = v_uid;
  select s.free_used, s.credits into v_freeUsed, v_credit from public.my_vote_status() s;
  return query select v_new, v_mine, v_freeUsed, v_credit;
end $$;

notify pgrst, 'reload schema';
commit;
