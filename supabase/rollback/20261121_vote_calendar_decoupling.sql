-- Vote-only corrective rollback for 20261121. Apply only after approval and
-- after deploying a compatible client. This restores the source-based vote
-- functions from 20261117 while leaving the neutral config/earnings tables,
-- their RLS/grants, the Calendar-only API, and all ledger rows intact. The
-- neutral earning ledger becomes an audit snapshot; future quiz awards return
-- to the source answer table and are not appended to that inactive ledger.
-- No DROP/CASCADE, balance adjustment, quota change, or history rewrite.
-- This is not a full Calendar rollback and 20261121 must not be re-run.
begin;

select pg_advisory_xact_lock(('x' || md5('ccl_schema_migrations'))::bit(64)::bigint);

-- Fail closed if the cutover is not the live state or if the source and
-- neutral quota inputs/events have diverged. Restoring the old functions in
-- either case could silently change the user's effective quota.
do $rollback_preflight$
declare
  v_def text;
begin
  if to_regclass('public.daily_vote_quota_config') is null
     or to_regclass('public.daily_vote_quota_earnings') is null
     or to_regprocedure('public.daily_vote_earned_on(uuid,date)') is null
     or to_regprocedure('public.my_daily_login_status()') is null
     or to_regprocedure('public.claim_daily_login_calendar(date)') is null then
    raise exception 'err.voteCalendarRollback: 20261121 target objects are missing';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.voteCalendarRollback: guarded migration history is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'supabase_migrations'
       and table_name = 'schema_migrations' and column_name = 'version'
       and data_type = 'text' and is_nullable = 'NO'
  ) then
    raise exception 'err.voteCalendarRollback: guarded migration history is unknown';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                  where version = '20261121_vote_calendar_decoupling') then
    raise exception 'err.voteCalendarRollback: 20261121 is not recorded as applied';
  end if;

  lock table public.profiles, public.votes, public.requests, public.daily_quiz_config,
             public.daily_quiz_attempts, public.daily_quiz_answers, public.activity_days,
             public.daily_vote_quota_config, public.daily_vote_quota_earnings
    in share mode;

  if (select count(*) from public.daily_vote_quota_config
       where key in ('free_vote_grant_enabled','free_votes_per_day',
                     'global_daily_vote_cap_enabled','global_daily_vote_cap')) <> 4
     or (select count(*) from public.daily_quiz_config
       where key in ('free_vote_grant_enabled','free_votes_per_day',
                     'global_daily_vote_cap_enabled','global_daily_vote_cap')) <> 4 then
    raise exception 'err.voteCalendarRollback: live quota config rows are incomplete';
  end if;
  if exists (
    select 1 from public.daily_vote_quota_config
     where case
       when key in ('free_vote_grant_enabled','global_daily_vote_cap_enabled')
         then jsonb_typeof(value) <> 'boolean'
       when key in ('free_votes_per_day','global_daily_vote_cap')
         then case when jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^[0-9]+$'
                   then (value #>> '{}')::numeric > 2147483647 else true end
       else true
     end
  ) or exists (
    (select key, value from public.daily_vote_quota_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap')
     except all
     select key, value from public.daily_quiz_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap'))
    union all
    (select key, value from public.daily_quiz_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap')
     except all
     select key, value from public.daily_vote_quota_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap'))
  ) then
    raise exception 'err.voteCalendarRollback: source and neutral quota config differ/are invalid';
  end if;
  if exists (select 1 from public.daily_quiz_answers where awarded is null or awarded not in (0,1))
     or exists (select 1 from public.daily_vote_quota_earnings where source <> 'daily_quiz')
     or exists (
       (select user_id, quiz_date, question_id, 1::integer as amount, answered_at as recorded_at
          from public.daily_quiz_answers where awarded = 1
        except all
        select user_id, vote_day, source_key, amount, recorded_at
          from public.daily_vote_quota_earnings where source = 'daily_quiz')
       union all
       (select user_id, vote_day, source_key, amount, recorded_at
          from public.daily_vote_quota_earnings where source = 'daily_quiz'
        except all
        select user_id, quiz_date, question_id, 1::integer as amount, answered_at as recorded_at
          from public.daily_quiz_answers where awarded = 1)
     ) then
    raise exception 'err.voteCalendarRollback: source answers and neutral earning ledger differ';
  end if;

  v_def := lower(pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure));
  if position('daily_vote_quota_bool' in v_def) = 0
     or position('daily_vote_earned_on' in v_def) = 0
     or position('daily_quiz_config' in v_def) > 0 then
    raise exception 'err.voteCalendarRollback: current quota function is not the expected cutover';
  end if;

  -- Re-evaluate the old source formula against the current neutral result for
  -- every profile's current VN day and every historical answer-bearing day.
  -- This catches a changed daily_quiz_votes_on() body before restoring it.
  if exists (
    with calendar_day as (
      select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date as vote_day
    ), candidates as (
      select p.id as user_id, d.vote_day from public.profiles p cross join calendar_day d
      union
      select user_id, quiz_date from public.daily_quiz_answers
    ), cfg as (
      select
        (select (value #>> '{}')::boolean from public.daily_quiz_config where key = 'free_vote_grant_enabled') as enabled,
        (select (value #>> '{}')::integer from public.daily_quiz_config where key = 'free_votes_per_day') as free_per_day,
        (select (value #>> '{}')::boolean from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled') as global_enabled,
        (select (value #>> '{}')::integer from public.daily_quiz_config where key = 'global_daily_vote_cap') as global_cap
    ), grants as (
      select c.user_id, c.vote_day,
             public.daily_free_vote_grant(c.user_id, c.vote_day) as neutral_grant,
             case when not cfg.enabled then 0
                  when cfg.global_enabled then greatest(0, least(cfg.free_per_day, cfg.global_cap
                    - public.daily_quiz_votes_on(c.user_id, c.vote_day)))
                  else greatest(0, cfg.free_per_day) end as source_grant
        from candidates c cross join cfg
    )
    select 1 from grants where neutral_grant is distinct from source_grant
  ) then
    raise exception 'err.voteCalendarRollback: live source and neutral quota results differ';
  end if;

  v_def := lower(pg_get_functiondef('public.submit_daily_quiz_answer(uuid,uuid,text,text)'::regprocedure));
  if position('daily_vote_quota_earnings' in v_def) = 0 then
    raise exception 'err.voteCalendarRollback: current quiz writer is not the expected cutover';
  end if;
end
$rollback_preflight$;

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
revoke all on function public.my_vote_status() from public, anon, authenticated;
grant execute on function public.my_vote_status() to authenticated;

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
revoke all on function public.cast_vote(uuid,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid,integer,text,text,text) to authenticated;

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

comment on table public.daily_vote_quota_config is
  'Retained 20261121 quota snapshot. After the vote-only corrective rollback, the restored source-based vote functions read daily_quiz_config instead.';
comment on table public.daily_vote_quota_earnings is
  'Retained 20261121 award snapshot. After the vote-only corrective rollback, new quiz awards are recorded only in daily_quiz_answers; this table is not an active quota source.';

notify pgrst, 'reload schema';
commit;
