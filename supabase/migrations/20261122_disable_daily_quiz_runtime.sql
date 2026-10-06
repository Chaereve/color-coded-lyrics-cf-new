-- BEGIN DISABLE DAILY QUIZ RUNTIME: mirror 20261122_disable_daily_quiz_runtime.sql
-- Run AFTER 20261121_vote_calendar_decoupling.sql. Append-only, one transaction.
-- Running it a second time is a no-op: revoking an already-revoked privilege
-- changes nothing.
--
-- Why this migration exists
-- -------------------------
-- The Daily Quiz has been removed from the product. The app no longer has a
-- quiz screen, sidebar entry, route or API wrapper: /quiz is a 301 redirect to
-- the check-in calendar (see public/_redirects). That closes every door in the
-- shipped bundle — but a browser still running a cached bundle can call the
-- quiz RPCs directly with its session. This migration closes that last door by
-- removing EXECUTE from the client roles on exactly the five client-callable
-- quiz/rewards functions.
--
-- What it deliberately does NOT do
-- --------------------------------
--   * No DROP, DELETE, TRUNCATE or UPDATE anywhere. The quiz tables and every
--     historical row (questions, config, attempts, answers, seen) stay exactly
--     as they are. Dropping them is a later, separately approved phase with a
--     verified backup and an export; this file only prepares the ACL change.
--   * No change to public.daily_login_rewards, to the vote functions, to the
--     Calendar API, or to any quota/config value. Vote keeps its existing
--     spending order (free -> bonus -> purchased) and its existing history.
--   * No award path may ever pay again: with EXECUTE gone, no client role can
--     reach submit_daily_quiz_answer, so no new quiz quota event can be
--     written. The neutral ledger and its history are untouched.
--   * No object is created, so the fresh-install bundle (schema.sql + setup
--     chunks) stays at baseline 20261120 and no new fingerprint is needed. The
--     readiness fingerprint covers tables/functions/config rows, not ACLs, so a
--     database with this migration applied still verifies READY against the
--     committed 20261120 baseline — the migration history row is what proves
--     the runtime was disabled.
--
-- Reward policy (PREPARED, NOT ENABLED)
-- -------------------------------------
-- Turning the quiz off also turns off the only remaining vote-awarding path in
-- production today (`free_vote_grant_enabled` is false, so the daily free grant
-- pays 0). Restoring the old free daily grant is a product decision and is NOT
-- part of this migration: the switch is documented and ready in
-- docs/QUIZ-REMOVAL.md, and it must always update BOTH config tables
-- (daily_vote_quota_config and daily_quiz_config) or the corrective rollback of
-- 20261121 refuses to run because the two copies no longer match.
--
-- Rollback: supabase/rollback/20261122_disable_daily_quiz_runtime.sql grants
-- EXECUTE back to authenticated for exactly the same five functions.
begin;

-- 1. Preflight. Fail closed on anything unexpected; this block performs no
--    writes of its own.
do $preflight$
declare
  v_name text;
  v_def text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.featureRetiredPreflight: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version in ('20261121_vote_calendar_decoupling', '20261121')
  ) then
    raise exception 'err.featureRetiredPreflight: 20261121 is not recorded — apply the cutover first';
  end if;

  foreach v_name in array array[
    'public.daily_quiz_questions', 'public.daily_quiz_config',
    'public.daily_quiz_attempts', 'public.daily_quiz_answers',
    'public.daily_quiz_seen'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'err.featureRetiredPreflight: quiz source table is missing (%)', v_name;
    end if;
    if not exists (select 1 from pg_class where oid = to_regclass(v_name) and relkind = 'r') then
      raise exception 'err.featureRetiredPreflight: quiz source object is not a regular table (%)', v_name;
    end if;
  end loop;

  -- The five client-callable quiz/rewards entry points must exist with the exact
  -- signatures this migration revokes. A different shape is a different product.
  foreach v_name in array array[
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.submit_daily_quiz(uuid,uuid,int[])',
    'public.my_daily_rewards_status()',
    'public.claim_daily_login(uuid,date)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'err.featureRetiredPreflight: quiz entry point is missing (%)', v_name;
    end if;
  end loop;

  -- The Calendar must be live: this migration is only the quiz door closing, it
  -- is never allowed to be the thing that breaks check-ins.
  foreach v_name in array array[
    'public.my_daily_login_status()',
    'public.claim_daily_login_calendar(date)',
    'public.my_daily_checkin_month(date)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'err.featureRetiredPreflight: Calendar API is missing (%, apply 20261121 first)', v_name;
    end if;
    if not has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredPreflight: Calendar API is not callable by authenticated (%)', v_name;
    end if;
  end loop;

  -- No write path into the recorded check-in amount, and no client write on the
  -- vote ledger: the pre-retirement invariants stay enforced. The check looks at
  -- the installed trigger, not at the text of its function: a trigger that was
  -- dropped or disabled is exactly the drift this preflight must catch.
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.oid = 'public.daily_login_rewards'::regclass
       and t.tgname = 'daily_login_rewards_no_vote'
       and not t.tgisinternal
       and t.tgenabled = 'O'
  ) then
    raise exception 'err.featureRetiredPreflight: the check-in amount immutability trigger is not active';
  end if;
end
$preflight$;

-- 2. The ACL change itself. Only EXECUTE is touched; no table row, no function
--    body, no grant on any other object. `public` is included so the revoke no
--    longer depends on how the privilege was granted.
do $disable$
declare
  v_quiz_counts_before jsonb;
  v_quiz_counts_after jsonb;
  v_rewards_before jsonb;
  v_rewards_after jsonb;
  v_name text;
begin
  -- Snapshot the data we promise not to touch. Row counts (plus how many
  -- historical rows ever recorded a non-zero amount) are compared after the
  -- revoke: a revoke cannot change them, and if anything else did, the whole
  -- transaction aborts.
  select jsonb_build_object(
    'questions', (select count(*) from public.daily_quiz_questions),
    'config', (select count(*) from public.daily_quiz_config),
    'attempts', (select count(*) from public.daily_quiz_attempts),
    'answers', (select count(*) from public.daily_quiz_answers),
    'seen', (select count(*) from public.daily_quiz_seen)
  ) into v_quiz_counts_before;
  select jsonb_build_object(
    'rows', (select count(*) from public.daily_login_rewards),
    'paid', (select count(*) from public.daily_login_rewards where reward <> 0)
  ) into v_rewards_before;

  foreach v_name in array array[
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.submit_daily_quiz(uuid,uuid,int[])',
    'public.my_daily_rewards_status()',
    'public.claim_daily_login(uuid,date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_name);
  end loop;

  -- Post-conditions, checked in the same transaction: the client roles lost the
  -- quiz entry points, the Calendar and vote APIs kept theirs, and the data is
  -- byte-for-byte what it was.
  foreach v_name in array array[
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.submit_daily_quiz(uuid,uuid,int[])',
    'public.my_daily_rewards_status()',
    'public.claim_daily_login(uuid,date)'
  ] loop
    if has_function_privilege('authenticated', v_name, 'EXECUTE')
       or has_function_privilege('anon', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredState: quiz entry point is still callable by a client role (%)', v_name;
    end if;
  end loop;
  foreach v_name in array array[
    'public.my_daily_login_status()',
    'public.claim_daily_login_calendar(date)',
    'public.my_daily_checkin_month(date)',
    'public.my_vote_status()',
    'public.cast_vote(uuid,integer,text,text,text)'
  ] loop
    if not has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredState: live API lost its client grant (%)', v_name;
    end if;
  end loop;

  select jsonb_build_object(
    'questions', (select count(*) from public.daily_quiz_questions),
    'config', (select count(*) from public.daily_quiz_config),
    'attempts', (select count(*) from public.daily_quiz_attempts),
    'answers', (select count(*) from public.daily_quiz_answers),
    'seen', (select count(*) from public.daily_quiz_seen)
  ) into v_quiz_counts_after;
  select jsonb_build_object(
    'rows', (select count(*) from public.daily_login_rewards),
    'paid', (select count(*) from public.daily_login_rewards where reward <> 0)
  ) into v_rewards_after;

  if v_quiz_counts_after is distinct from v_quiz_counts_before then
    raise exception 'err.featureRetiredState: quiz rows changed during a revoke-only migration';
  end if;
  if v_rewards_after is distinct from v_rewards_before then
    raise exception 'err.featureRetiredState: recorded check-ins changed during a revoke-only migration';
  end if;
end
$disable$;

comment on function public.start_daily_quiz(uuid,date) is
  'Retired quiz entry point. EXECUTE is revoked from every client role by 20261122; the function and all quiz history stay in place until the separately approved cleanup phase.';
comment on function public.submit_daily_quiz_answer(uuid,uuid,text,text) is
  'Retired quiz entry point. EXECUTE is revoked from every client role by 20261122, so no client can start or pay a round; quiz history and the neutral vote ledger are untouched.';
comment on function public.submit_daily_quiz(uuid,uuid,int[]) is
  'Retired legacy quiz entry point (single-shot round). EXECUTE is revoked from every client role by 20261122; kept only for the cleanup phase.';
comment on function public.my_daily_rewards_status() is
  'Retired combined rewards payload (it carries quiz fields). EXECUTE is revoked from every client role by 20261122; the Calendar API replaces it.';
comment on function public.claim_daily_login(uuid,date) is
  'Retired combined check-in entry point (it answers with the quiz-bearing rewards payload). EXECUTE is revoked from every client role by 20261122; claim_daily_login_calendar(date) replaces it.';

-- Keep PostgREST's schema cache in step with the new ACLs.
notify pgrst, 'reload schema';
commit;
