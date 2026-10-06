-- Corrective rollback for 20261122_disable_daily_quiz_runtime. Apply only after
-- approval. It restores EXECUTE on the retired quiz/rewards entry points for
-- `authenticated` — exactly the client grants 20261122 removed — and touches
-- nothing else.
--
-- What "exactly" means here: four of the five entry points were callable by
-- `authenticated` before 20261122 (start_daily_quiz, submit_daily_quiz_answer,
-- my_daily_rewards_status, claim_daily_login). The fifth, the legacy single-shot
-- submit_daily_quiz(uuid,uuid,int[]), was already closed to every client role by
-- 20261117 when the answer-by-answer flow replaced it, so this rollback leaves
-- it closed: inventing that grant would hand clients a privilege the product had
-- already taken away. `anon` never had any of them; `service_role` never had
-- EXECUTE on them either, and that is unchanged in both directions.
--
-- When to use it: a client that still has to run the old quiz/rewards screens
-- (for example if a frontend rollback lands before this backend change), or a
-- migration rehearsal that must leave the database exactly as it found it.
--
-- What it does NOT do: it does not re-enable quiz awards, does not restore the
-- route, does not touch the check-in reward policy, and does not modify the
-- Calendar or vote APIs. It is a one-shot corrective: the preflight refuses to
-- run once the grants are back, so a second run fails closed instead of silently
-- touching a state it does not understand.
begin;

-- 1. Preflight: fail closed unless the disable is the live state. Restoring a
--    grant that was never removed would hide a mixed state instead of reporting
--    it, so the recorded history row and the revoked ACLs are both required.
do $preflight$
declare
  v_name text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.featureRetiredRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version in ('20261122_disable_daily_quiz_runtime', '20261122')
  ) then
    raise exception 'err.featureRetiredRollback: 20261122 is not recorded as applied';
  end if;

  foreach v_name in array array[
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.submit_daily_quiz(uuid,uuid,int[])',
    'public.my_daily_rewards_status()',
    'public.claim_daily_login(uuid,date)'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'err.featureRetiredRollback: retired entry point is missing (%)', v_name;
    end if;
    if has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredRollback: % is already executable by authenticated — the disable is not the live state', v_name;
    end if;
  end loop;

  -- The Calendar must be live: a rollback of the quiz door must never be needed
  -- because check-ins are broken.
  if to_regprocedure('public.my_daily_login_status()') is null
     or to_regprocedure('public.claim_daily_login_calendar(date)') is null then
    raise exception 'err.featureRetiredRollback: Calendar API is missing';
  end if;
end
$preflight$;

-- 2. Restore exactly the four client grants 20261122 removed. The legacy
--    single-shot submit stays closed on purpose (see the header), and `anon`
--    stays without any of them.
do $restore$
declare
  v_restore text[] := array[
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.my_daily_rewards_status()',
    'public.claim_daily_login(uuid,date)'
  ];
  v_name text;
  v_quiz_counts_before jsonb;
  v_quiz_counts_after jsonb;
begin
  select jsonb_build_object(
    'questions', (select count(*) from public.daily_quiz_questions),
    'config', (select count(*) from public.daily_quiz_config),
    'attempts', (select count(*) from public.daily_quiz_attempts),
    'answers', (select count(*) from public.daily_quiz_answers),
    'seen', (select count(*) from public.daily_quiz_seen)
  ) into v_quiz_counts_before;

  foreach v_name in array v_restore loop
    execute format('grant execute on function %s to authenticated', v_name);
  end loop;

  foreach v_name in array v_restore loop
    if not has_function_privilege('authenticated', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredRollback: failed to restore % for authenticated', v_name;
    end if;
    if has_function_privilege('anon', v_name, 'EXECUTE') then
      raise exception 'err.featureRetiredRollback: anon gained % — that role never had it', v_name;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.submit_daily_quiz(uuid,uuid,int[])', 'EXECUTE') then
    raise exception 'err.featureRetiredRollback: the legacy single-shot submit must stay closed';
  end if;

  select jsonb_build_object(
    'questions', (select count(*) from public.daily_quiz_questions),
    'config', (select count(*) from public.daily_quiz_config),
    'attempts', (select count(*) from public.daily_quiz_attempts),
    'answers', (select count(*) from public.daily_quiz_answers),
    'seen', (select count(*) from public.daily_quiz_seen)
  ) into v_quiz_counts_after;
  if v_quiz_counts_after is distinct from v_quiz_counts_before then
    raise exception 'err.featureRetiredRollback: quiz rows changed during a grant-only rollback';
  end if;
end
$restore$;

comment on function public.start_daily_quiz(uuid,date) is
  'Music quiz round opener. Client EXECUTE restored by the 20261122 corrective rollback; the product route stays retired, so this exists only for a coordinated frontend rollback.';
comment on function public.submit_daily_quiz_answer(uuid,uuid,text,text) is
  'Music quiz answer writer (records one neutral vote event per correct answer). Client EXECUTE restored by the 20261122 corrective rollback.';
comment on function public.my_daily_rewards_status() is
  'Legacy combined daily rewards payload (carries music quiz fields). Client EXECUTE restored by the 20261122 corrective rollback; the Calendar API remains the live path.';
comment on function public.claim_daily_login(uuid,date) is
  'Legacy combined check-in entry point that answers with the rewards payload. Client EXECUTE restored by the 20261122 corrective rollback; the Calendar API remains the live path.';

notify pgrst, 'reload schema';
commit;
