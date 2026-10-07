-- BEGIN RESTORE DAILY FREE VOTES: mirror 20261124_restore_daily_free_votes.sql
-- Run AFTER 20261123_reconcile_security_drift.sql. Append-only, one transaction.
--
-- Why this migration exists
-- -------------------------
-- The confirmed product policy is: every account gets THREE free votes per
-- VIETNAMESE calendar day (Asia/Ho_Chi_Minh), automatic, and kept strictly
-- separate from the bonus wallet (profiles.bonus_credits) and from purchased
-- votes (profiles.vote_credits).
--
-- The engine for that policy already exists and is correct:
-- public.my_vote_status() (what the panel reads) and public.cast_vote() (what
-- spends a vote) both call public.daily_free_vote_grant(), which evaluates the
-- neutral live config in public.daily_vote_quota_config. But that config still
-- carried the retired launch value free_vote_grant_enabled = false, so the grant
-- evaluated to 0 and the panel rendered "Free today 0 / 0" — while the bonus
-- wallet was untouched, which is exactly the reported symptom. Nothing was
-- broken in the UI or in the vote functions: the live policy was switched off.
--
-- What this file changes (config values only)
-- ------------------------------------------
-- Exactly two keys, in BOTH copies of the live quota config, which 20261121
-- requires to stay byte-equal (its corrective rollback refuses when the two
-- copies differ):
--
--     free_vote_grant_enabled : false -> true
--     free_votes_per_day      : *     -> 3
--
--   * public.daily_vote_quota_config — the neutral copy the vote functions read.
--   * public.daily_quiz_config      — the mirror 20261121 copied from. It is kept
--     in step on purpose: the pre-cutover readers (daily_quiz_bool/int) and the
--     20261121 rollback compare both copies, so a one-sided flip would be drift.
--
-- global_daily_vote_cap_enabled / global_daily_vote_cap are NOT changed. That
-- pair is an optional cap over "votes earned from other sources today"; the quiz
-- that used to write such earnings is retired (20261122 revoked every client quiz
-- entry point), so today's earning count is 0 for everyone in production and the
-- cap only ever subtracts from the 3 free votes. The product guarantee "3 free
-- votes/day" is satisfied with the cap left exactly as the live database has it,
-- so this file leaves it alone and instead REFUSES to run when an enabled cap
-- could not leave 3 free votes for today's largest earner. If a future decision
-- wants the cap enforced over bonuses too, that is a separate reviewed change.
--
-- What it deliberately does NOT do
-- --------------------------------
--   * No function, table, index, policy, trigger or ACL is created, replaced or
--     revoked: the file contains no DDL. The fresh-install bundle
--     (supabase/schema.sql + setup 01-16) therefore stays exactly at baseline
--     20261120 and no new fingerprint is needed; the committed 20261120 baseline
--     keeps verifying READY afterwards, because the four live quota keys are
--     required to EXIST but their values are deliberately not compared with the
--     repository seed (see LIVE_VOTE_QUOTA_CONFIG_KEYS in tools/schema-readiness.mjs).
--   * No wallet balance, no vote row, no vote history, no neutral ledger row, no
--     check-in row and no quiz row is written or deleted. Row counts and both
--     wallet sums are compared before/after inside the same transaction.
--   * Daily Login / check-in still awards nothing: the calendar claim path is
--     verified below to contain no vote/credit write, and the check-in amount
--     immutability trigger must still be active. Check-ins stay history-only.
--   * No historical value is rewritten, and no repository seed is "restored":
--     the only values written are the two policy keys above, in the live tables.
--
-- Fail-closed contract (any exception aborts the whole transaction)
-- -----------------------------------------------------------------
--   * guarded-runner history exists, records 20261121 + 20261122 + 20261123, and
--     does NOT already record 20261124;
--   * the neutral readers/writers exist AND the live path really reads the copy
--     this file flips: daily_free_vote_grant() must call daily_vote_quota_bool(),
--     my_vote_status() must call daily_free_vote_grant() on the Vietnam day, and
--     cast_vote() must spend the same grant;
--   * both config copies must hold all four keys with the expected JSON types and
--     agree key for key — drift introduced after 20261121 aborts the file instead
--     of being silently overwritten;
--   * the free-vote guarantee is verified, not assumed: an enabled global cap
--     must still leave 3 free votes for today's largest earner, and the
--     post-check calls the live formula and public.my_vote_status() itself, for a
--     real profile, and requires exactly 3 before committing;
--   * the previous live values are recorded in the comment of
--     public.daily_vote_quota_config, so the corrective rollback can restore them
--     verbatim instead of guessing a policy (comments are metadata: they are not
--     part of any fingerprint and not part of the API).
--
-- Idempotency:  rows already holding the target value are not touched. A manual
-- second paste (or a database that already carries the target policy) takes the
-- no-op path, keeps an existing record, and changes nothing. The guarded runner
-- never re-runs a recorded migration; if 20261124 is already in the history this
-- file aborts, because re-applying a rolled-back policy needs a new forward
-- migration, not a second run of this one.
--
-- Rollback: supabase/rollback/20261124_restore_daily_free_votes.sql restores
-- exactly the values recorded in that comment and refuses to run when the target
-- state is not live.
--
-- Apply with the guarded runner (it verifies the baseline, records the history
-- row in the same transaction, and strips this file's outer BEGIN/COMMIT):
--     npm run backup:db
--     SUPABASE_DB_URL='postgresql://…' npm run db:plan   -- --baseline 20261120
--     SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261120
begin;

-- 1. Preflight. Reads only; abort leaves the database exactly as it was.
do $preflight$
declare
  v_name        text;
  v_def         text;
  v_key         text;
  v_keys        constant text[] := array['free_vote_grant_enabled', 'free_votes_per_day',
                                         'global_daily_vote_cap_enabled', 'global_daily_vote_cap'];
  v_neutral     jsonb;
  v_source      jsonb;
  v_enabled     boolean;
  v_per_day     integer;
  v_cap_enabled boolean;
  v_cap         integer;
  v_today       date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_max_earned  integer;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.dailyFreeVotesPreflight: guarded-runner migration history is missing';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
     where version in ('20261124_restore_daily_free_votes', '20261124')
  ) then
    raise exception 'err.dailyFreeVotesPreflight: 20261124 is already recorded as applied — re-applying a rolled-back policy needs a new forward migration, not a second run of this file';
  end if;
  foreach v_name in array array[
    '20261121_vote_calendar_decoupling|20261121',
    '20261122_disable_daily_quiz_runtime|20261122',
    '20261123_reconcile_security_drift|20261123'
  ] loop
    if not exists (
      select 1 from supabase_migrations.schema_migrations
       where version = split_part(v_name, '|', 1) or version = split_part(v_name, '|', 2)
    ) then
      raise exception 'err.dailyFreeVotesPreflight: required migration state missing (%) — apply the cutover chain first', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'public.profiles', 'public.votes', 'public.daily_login_rewards',
    'public.daily_vote_quota_config', 'public.daily_vote_quota_earnings',
    'public.daily_quiz_config', 'public.daily_quiz_answers'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'err.dailyFreeVotesPreflight: required table is missing (%)', v_name;
    end if;
    if not exists (select 1 from pg_class where oid = to_regclass(v_name) and relkind = 'r') then
      raise exception 'err.dailyFreeVotesPreflight: required object is not a regular table (%)', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'public.daily_free_vote_grant(uuid,date)',
    'public.daily_vote_quota_bool(text)',
    'public.daily_vote_quota_int(text)',
    'public.daily_vote_earned_on(uuid,date)',
    'public.my_vote_status()',
    'public.cast_vote(uuid,integer,text,text,text)',
    'public.claim_daily_login_calendar(date)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'err.dailyFreeVotesPreflight: required function is missing (%)', v_name;
    end if;
  end loop;

  -- A policy flip is only real if the live path reads the copy being flipped.
  v_def := lower(pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure));
  if position('daily_vote_quota_bool' in v_def) = 0
     or position('free_vote_grant_enabled' in v_def) = 0
     or position('free_votes_per_day' in v_def) = 0 then
    raise exception 'err.dailyFreeVotesPreflight: daily_free_vote_grant() does not evaluate the neutral quota config — flipping it would not change what users get';
  end if;
  v_def := lower(pg_get_functiondef('public.my_vote_status()'::regprocedure));
  if position('daily_free_vote_grant' in v_def) = 0
     or position('free_limit' in v_def) = 0
     or position('asia/ho_chi_minh' in v_def) = 0 then
    raise exception 'err.dailyFreeVotesPreflight: my_vote_status() does not report the neutral daily grant on the Vietnam day — apply 20261121 first';
  end if;
  v_def := lower(pg_get_functiondef('public.cast_vote(uuid,integer,text,text,text)'::regprocedure));
  if position('daily_free_vote_grant' in v_def) = 0 then
    raise exception 'err.dailyFreeVotesPreflight: cast_vote() does not spend the neutral daily grant — the 3 free votes would be unusable';
  end if;

  -- Both copies, complete, correctly typed, and equal key for key.
  if (select count(*) from public.daily_vote_quota_config where key = any (v_keys)) <> 4 then
    raise exception 'err.dailyFreeVotesPreflight: the neutral quota config is incomplete (daily_vote_quota_config)';
  end if;
  if (select count(*) from public.daily_quiz_config where key = any (v_keys)) <> 4 then
    raise exception 'err.dailyFreeVotesPreflight: the source quota config is incomplete (daily_quiz_config)';
  end if;
  select jsonb_object_agg(key, value) into v_neutral
    from public.daily_vote_quota_config where key = any (v_keys);
  select jsonb_object_agg(key, value) into v_source
    from public.daily_quiz_config where key = any (v_keys);
  if v_neutral is distinct from v_source then
    raise exception 'err.dailyFreeVotesPreflight: the two live quota config copies differ — reconcile them (and the 20261121 rollback) before flipping the switch. neutral: % source: %', v_neutral, v_source;
  end if;
  if v_neutral is null
     or jsonb_typeof(v_neutral -> 'free_vote_grant_enabled') <> 'boolean'
     or jsonb_typeof(v_neutral -> 'global_daily_vote_cap_enabled') <> 'boolean'
     or (v_neutral ->> 'free_votes_per_day') !~ '^[0-9]+$'
     or (v_neutral ->> 'global_daily_vote_cap') !~ '^[0-9]+$' then
    raise exception 'err.dailyFreeVotesPreflight: the live quota config has an invalid JSON type or value: %', v_neutral;
  end if;
  foreach v_key in array v_keys loop
    if (v_neutral -> v_key) is null then
      raise exception 'err.dailyFreeVotesPreflight: quota key % is NULL', v_key;
    end if;
  end loop;

  v_enabled     := (v_neutral ->> 'free_vote_grant_enabled')::boolean;
  v_per_day     := (v_neutral ->> 'free_votes_per_day')::integer;
  v_cap_enabled := (v_neutral ->> 'global_daily_vote_cap_enabled')::boolean;
  v_cap         := (v_neutral ->> 'global_daily_vote_cap')::integer;

  -- The guarantee is three free votes for EVERY account on the Vietnam day. With
  -- the optional global cap on, the grant is least(3, cap - earned_today), so a
  -- cap that cannot leave 3 after today's largest earning would silently deliver
  -- less. This file never changes the cap: it refuses instead, and the decision
  -- is left to a reviewed change.
  if v_cap_enabled then
    select coalesce(max(earned), 0)::integer into v_max_earned
      from (
        select sum(amount)::integer as earned
          from public.daily_vote_quota_earnings
         where vote_day = v_today
         group by user_id
      ) per_user;
    if v_cap - v_max_earned < 3 then
      raise exception 'err.dailyFreeVotesPreflight: global_daily_vote_cap_enabled is on and global_daily_vote_cap (%) minus the largest earning recorded for today (%) leaves fewer than 3 free votes — this file never changes the cap, so review the policy first', v_cap, v_max_earned;
    end if;
  end if;

  -- Snapshot for the post-check, and the record the corrective rollback reads.
  perform set_config('ccl.dailyfree.previous', v_neutral::text, true);
  perform set_config('ccl.dailyfree.changed',
    case when v_enabled and v_per_day = 3 then 'false' else 'true' end, true);
  perform set_config('ccl.dailyfree.counts', jsonb_build_object(
    'profiles',                  (select count(*) from public.profiles),
    'votes',                     (select count(*) from public.votes),
    'daily_login_rewards',       (select count(*) from public.daily_login_rewards),
    'daily_vote_quota_earnings', (select count(*) from public.daily_vote_quota_earnings),
    'daily_quiz_config',         (select count(*) from public.daily_quiz_config),
    'daily_quiz_answers',        (select count(*) from public.daily_quiz_answers),
    'vote_credits',              (select coalesce(sum(vote_credits), 0) from public.profiles),
    'bonus_credits',             (select coalesce(sum(bonus_credits), 0) from public.profiles)
  )::text, true);

  if current_setting('ccl.dailyfree.changed') = 'true' then
    raise notice '20261124: free-vote policy before % → after {"free_vote_grant_enabled": true, "free_votes_per_day": 3} (cap keys untouched)', v_neutral;
  else
    raise notice '20261124: live free-vote policy is already the target (3/day) — no config value will change';
  end if;
end
$preflight$;

-- 2. The policy change itself: two keys, both copies, no other statement. Rows
--    that already hold the target value are left alone (no updated_at churn and
--    no second record on the no-op path).
do $flip$
declare
  v_total integer := 0;
  v_rows  integer;
  v_keys  constant text[] := array['free_vote_grant_enabled', 'free_votes_per_day'];
begin
  if current_setting('ccl.dailyfree.changed') <> 'true' then
    return;
  end if;

  update public.daily_vote_quota_config
     set value = 'true'::jsonb, updated_at = clock_timestamp()
   where key = 'free_vote_grant_enabled' and value is distinct from 'true'::jsonb;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesState: the neutral enable switch matched % rows', v_rows;
  end if;

  update public.daily_vote_quota_config
     set value = '3'::jsonb, updated_at = clock_timestamp()
   where key = 'free_votes_per_day' and value is distinct from '3'::jsonb;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesState: the neutral daily count matched % rows', v_rows;
  end if;

  update public.daily_quiz_config
     set value = 'true'::jsonb, updated_at = clock_timestamp()
   where key = 'free_vote_grant_enabled' and value is distinct from 'true'::jsonb;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesState: the source enable switch matched % rows', v_rows;
  end if;

  update public.daily_quiz_config
     set value = '3'::jsonb, updated_at = clock_timestamp()
   where key = 'free_votes_per_day' and value is distinct from '3'::jsonb;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesState: the source daily count matched % rows', v_rows;
  end if;

  if v_total < 1 or v_total > 4 then
    raise exception 'err.dailyFreeVotesState: expected between 1 and 4 policy rows to change, % did', v_total;
  end if;
  if (
    select count(*) from public.daily_vote_quota_config
     where (key = 'free_vote_grant_enabled' and value = 'true'::jsonb)
        or (key = 'free_votes_per_day' and value = '3'::jsonb)
  ) <> 2 then
    raise exception 'err.dailyFreeVotesState: the neutral policy rows are not the target after the write';
  end if;
end
$flip$;

-- 3. Record the previous live policy. This is what makes the corrective rollback
--    exact: it restores these values instead of guessing, and refuses to run when
--    the record is missing. Comments are metadata — no fingerprint, no ACL, no
--    API surface is touched.
do $record$
declare
  v_previous jsonb;
begin
  if current_setting('ccl.dailyfree.changed') <> 'true' then
    raise notice '20261124: policy was already at target — any existing record is left untouched';
    return;
  end if;
  v_previous := current_setting('ccl.dailyfree.previous')::jsonb;
  execute format('comment on table public.daily_vote_quota_config is %L',
    'Trusted mirror of the live free-vote quota inputs captured during migration 20261121; update through reviewed owner-only config changes, never from the browser. '
    || '20261124_restore_daily_free_votes previous live policy: ' || v_previous::text);
end
$record$;

-- 4. Post-check, in the same transaction. Wrong is an abort, not a warning.
do $postcheck$
declare
  v_previous    jsonb := current_setting('ccl.dailyfree.previous')::jsonb;
  v_neutral     jsonb;
  v_source      jsonb;
  v_today       date := (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_probe       uuid;
  v_probe_used  integer;
  v_free_limit  integer;
  v_grant       integer;
  v_counts      jsonb;
  v_def         text;
  v_comment     text;
begin
  -- 4.1 Both copies are at the target and still agree key for key.
  select jsonb_build_object(
           'enabled',     (select value from public.daily_vote_quota_config where key = 'free_vote_grant_enabled'),
           'per_day',     (select value from public.daily_vote_quota_config where key = 'free_votes_per_day'),
           'cap_enabled', (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled'),
           'cap',         (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap'))
    into v_neutral;
  select jsonb_build_object(
           'enabled',     (select value from public.daily_quiz_config where key = 'free_vote_grant_enabled'),
           'per_day',     (select value from public.daily_quiz_config where key = 'free_votes_per_day'),
           'cap_enabled', (select value from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled'),
           'cap',         (select value from public.daily_quiz_config where key = 'global_daily_vote_cap'))
    into v_source;
  if (v_neutral ->> 'enabled')::boolean is not true or (v_neutral ->> 'per_day')::integer <> 3 then
    raise exception 'err.dailyFreeVotesState: the neutral policy rows are not the target after the write: %', v_neutral;
  end if;
  if v_neutral is distinct from v_source then
    raise exception 'err.dailyFreeVotesState: the two quota config copies diverged — neutral: % source: %', v_neutral, v_source;
  end if;
  if (v_neutral -> 'cap_enabled') is distinct from (v_previous -> 'global_daily_vote_cap_enabled')
     or (v_neutral -> 'cap') is distinct from (v_previous -> 'global_daily_vote_cap') then
    raise exception 'err.dailyFreeVotesState: the optional global cap keys changed — this file must never touch them. before: % after: %', v_previous, v_neutral;
  end if;

  -- 4.2 The live formula answers 3 for a fresh account on the Vietnam day.
  v_grant := public.daily_free_vote_grant(gen_random_uuid(), v_today);
  if v_grant <> 3 then
    raise exception 'err.dailyFreeVotesState: daily_free_vote_grant() returns % for a fresh account today, expected 3', v_grant;
  end if;

  -- 4.3 The exact function the panel reads reports the daily quota, and accounts
  --     only the free votes recorded for TODAY: a free vote from another Vietnam
  --     day neither counts nor shrinks the quota.
  select p.id into v_probe from public.profiles p order by p.id limit 1;
  if v_probe is null then
    raise notice '20261124: no profile exists to probe my_vote_status() — the neutral formula check above stands in for it';
  else
    perform set_config('ccl.dailyfree.claim', coalesce(current_setting('request.jwt.claim.sub', true), ''), true);
    perform set_config('request.jwt.claim.sub', v_probe::text, true);
    select s.free_used, s.free_limit into v_probe_used, v_free_limit from public.my_vote_status() s;
    perform set_config('request.jwt.claim.sub', current_setting('ccl.dailyfree.claim', true), true);
    if v_free_limit <> 3 then
      raise exception 'err.dailyFreeVotesState: my_vote_status() free_limit is % (expected 3) — the panel would still not show the daily quota', v_free_limit;
    end if;
    if v_probe_used <> (
      select count(*)::integer from public.votes
       where user_id = v_probe and used_credit = false and vote_day = v_today
    ) then
      raise exception 'err.dailyFreeVotesState: my_vote_status() free_used does not match the free votes recorded for the probed account today';
    end if;
  end if;

  -- 4.4 Daily Login still awards nothing, and the check-in history is immutable.
  v_def := lower(pg_get_functiondef('public.claim_daily_login_calendar(date)'::regprocedure));
  if position('vote_credits' in v_def) > 0
     or position('bonus_credits' in v_def) > 0
     or position('daily_vote_quota_earnings' in v_def) > 0 then
    raise exception 'err.dailyFreeVotesState: the check-in claim path can write votes — Daily Login must never award them';
  end if;
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.oid = 'public.daily_login_rewards'::regclass
       and t.tgname = 'daily_login_rewards_no_vote'
       and not t.tgisinternal
       and t.tgenabled = 'O'
  ) then
    raise exception 'err.dailyFreeVotesState: the check-in amount immutability trigger is not active';
  end if;

  -- 4.5 The record for the corrective rollback is in place.
  select obj_description('public.daily_vote_quota_config'::regclass, 'pg_class') into v_comment;
  if current_setting('ccl.dailyfree.changed') = 'true'
     and (v_comment is null or position('20261124_restore_daily_free_votes previous live policy: ' in v_comment) = 0) then
    raise exception 'err.dailyFreeVotesState: the previous live policy was not recorded — the corrective rollback could only guess, so the change is refused';
  end if;

  -- 4.6 Nothing moved: row counts and both wallet sums are identical.
  select jsonb_build_object(
    'profiles',                  (select count(*) from public.profiles),
    'votes',                     (select count(*) from public.votes),
    'daily_login_rewards',       (select count(*) from public.daily_login_rewards),
    'daily_vote_quota_earnings', (select count(*) from public.daily_vote_quota_earnings),
    'daily_quiz_config',         (select count(*) from public.daily_quiz_config),
    'daily_quiz_answers',        (select count(*) from public.daily_quiz_answers),
    'vote_credits',              (select coalesce(sum(vote_credits), 0) from public.profiles),
    'bonus_credits',             (select coalesce(sum(bonus_credits), 0) from public.profiles)
  ) into v_counts;
  if v_counts <> current_setting('ccl.dailyfree.counts')::jsonb then
    raise exception 'err.dailyFreeVotesState: rows or wallet sums changed during a config-only migration. before: % after: %',
      current_setting('ccl.dailyfree.counts'), v_counts;
  end if;

  raise notice '20261124: 3 free votes/day live in both copies; cap keys, wallets, vote history, check-in history and the neutral ledger are unchanged';
end
$postcheck$;

-- PostgREST caches schema metadata; the RPC output changed with the policy.
notify pgrst, 'reload schema';
commit;
