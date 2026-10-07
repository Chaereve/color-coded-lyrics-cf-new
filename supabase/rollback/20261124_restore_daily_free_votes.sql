-- Corrective rollback for 20261124_restore_daily_free_votes. Apply only after
-- approval.
--
-- What it restores, and from where: exactly the live quota values that
-- 20261124 replaced. It never guesses a policy — it reads the record that
-- 20261124 wrote into the comment of public.daily_vote_quota_config, and it
-- refuses to run when that record is missing. In production the recorded values
-- are `free_vote_grant_enabled = false` with `free_votes_per_day = 3`, i.e. the
-- retired automatic grant: after this rollback the panel shows "Free today 0 / 0"
-- again and the bonus wallet is exactly as it was.
--
-- Scope: the same two keys in BOTH copies (public.daily_vote_quota_config and
-- public.daily_quiz_config) so the two copies stay byte-equal, which 20261121's
-- own corrective rollback still verifies. Nothing else moves: the optional global
-- cap keys keep their values, no wallet balance, vote row, vote history, check-in
-- row or ledger row is touched, no function/ACL/table is changed, and the
-- fresh-install bundle stays at baseline 20261120.
--
-- Fail-closed: the history row for 20261124 must be recorded and the live state
-- must be exactly the target (enabled + 3/day in both copies). Running it twice
-- aborts instead of half-restoring, and a database whose policy was never flipped
-- by 20261124 is left alone.
--
-- After a rollback, do NOT re-run 20261124: its own preflight refuses a recorded
-- version, by design. Re-enabling the daily quota is a new forward migration.
begin;

-- 1. Preflight. Reads only.
do $preflight$
declare
  v_comment      text;
  v_record       jsonb;
  v_neutral      jsonb;
  v_source       jsonb;
  v_record_start text := '20261124_restore_daily_free_votes previous live policy: ';
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.dailyFreeVotesRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version in ('20261124_restore_daily_free_votes', '20261124')
  ) then
    raise exception 'err.dailyFreeVotesRollback: 20261124 is not recorded as applied — nothing to roll back';
  end if;
  if to_regclass('public.daily_vote_quota_config') is null
     or to_regclass('public.daily_quiz_config') is null then
    raise exception 'err.dailyFreeVotesRollback: a live quota config table is missing';
  end if;

  -- Both copies must be exactly the state 20261124 left behind, so a rollback can
  -- never rewrite a policy somebody changed by hand afterwards.
  select jsonb_build_object(
           'free_vote_grant_enabled',     (select value from public.daily_vote_quota_config where key = 'free_vote_grant_enabled'),
           'free_votes_per_day',          (select value from public.daily_vote_quota_config where key = 'free_votes_per_day'),
           'global_daily_vote_cap_enabled', (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled'),
           'global_daily_vote_cap',       (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap'))
    into v_neutral;
  select jsonb_build_object(
           'free_vote_grant_enabled',     (select value from public.daily_quiz_config where key = 'free_vote_grant_enabled'),
           'free_votes_per_day',          (select value from public.daily_quiz_config where key = 'free_votes_per_day'),
           'global_daily_vote_cap_enabled', (select value from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled'),
           'global_daily_vote_cap',       (select value from public.daily_quiz_config where key = 'global_daily_vote_cap'))
    into v_source;
  if v_neutral is distinct from v_source then
    raise exception 'err.dailyFreeVotesRollback: the two quota config copies already differ — review the live policy instead of rolling back. neutral: % source: %', v_neutral, v_source;
  end if;
  if (v_neutral ->> 'free_vote_grant_enabled')::boolean is not true
     or (v_neutral ->> 'free_votes_per_day')::integer <> 3 then
    raise exception 'err.dailyFreeVotesRollback: the live policy is not the state 20261124 installed (%) — the migration is not the live state, so nothing is restored', v_neutral;
  end if;

  -- The record is the only accepted source of the previous policy.
  select obj_description('public.daily_vote_quota_config'::regclass, 'pg_class') into v_comment;
  if v_comment is null or position(v_record_start in v_comment) = 0 then
    raise exception 'err.dailyFreeVotesRollback: the comment of public.daily_vote_quota_config does not record the previous live policy — refusing to guess what to restore';
  end if;
  begin
    v_record := (regexp_match(v_comment, '20261124_restore_daily_free_votes previous live policy: (\{[^}]*\})'))[1]::jsonb;
  exception when others then
    v_record := null;
  end;
  if v_record is null
     or jsonb_typeof(v_record) <> 'object'
     or not (v_record ? 'free_vote_grant_enabled')
     or not (v_record ? 'free_votes_per_day')
     or jsonb_typeof(v_record -> 'free_vote_grant_enabled') <> 'boolean'
     or (v_record ->> 'free_votes_per_day') !~ '^[0-9]+$' then
    raise exception 'err.dailyFreeVotesRollback: the recorded previous policy is not a readable quota record: %', v_record;
  end if;

  perform set_config('ccl.dailyfree.previous', v_record::text, true);
  perform set_config('ccl.dailyfree.counts', jsonb_build_object(
    'profiles',                  (select count(*) from public.profiles),
    'votes',                     (select count(*) from public.votes),
    'daily_login_rewards',       (select count(*) from public.daily_login_rewards),
    'daily_vote_quota_earnings', (select count(*) from public.daily_vote_quota_earnings),
    'vote_credits',              (select coalesce(sum(vote_credits), 0) from public.profiles),
    'bonus_credits',             (select coalesce(sum(bonus_credits), 0) from public.profiles)
  )::text, true);

  raise notice '20261124 rollback: restoring the recorded live policy % (the 3 free votes/day granted by 20261124 stop being granted)', v_record;
end
$preflight$;

-- 2. Restore the two policy keys in both copies. Only rows that differ are
--    written; the cap keys are never mentioned.
do $restore$
declare
  v_record jsonb := current_setting('ccl.dailyfree.previous')::jsonb;
  v_enabled jsonb := (v_record -> 'free_vote_grant_enabled');
  v_per_day jsonb := (v_record -> 'free_votes_per_day');
  v_rows integer;
  v_total integer := 0;
begin
  update public.daily_vote_quota_config
     set value = v_enabled, updated_at = clock_timestamp()
   where key = 'free_vote_grant_enabled' and value is distinct from v_enabled;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesRollback: the neutral enable switch matched % rows', v_rows;
  end if;

  update public.daily_vote_quota_config
     set value = v_per_day, updated_at = clock_timestamp()
   where key = 'free_votes_per_day' and value is distinct from v_per_day;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesRollback: the neutral daily count matched % rows', v_rows;
  end if;

  update public.daily_quiz_config
     set value = v_enabled, updated_at = clock_timestamp()
   where key = 'free_vote_grant_enabled' and value is distinct from v_enabled;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesRollback: the source enable switch matched % rows', v_rows;
  end if;

  update public.daily_quiz_config
     set value = v_per_day, updated_at = clock_timestamp()
   where key = 'free_votes_per_day' and value is distinct from v_per_day;
  get diagnostics v_rows = row_count; v_total := v_total + v_rows;
  if v_rows > 1 then
    raise exception 'err.dailyFreeVotesRollback: the source daily count matched % rows', v_rows;
  end if;

  if v_total < 1 or v_total > 4 then
    raise exception 'err.dailyFreeVotesRollback: expected between 1 and 4 policy rows to change, % did', v_total;
  end if;

  -- The record moves back to the pre-20261124 comment text, so the recorded
  -- previous policy cannot be replayed by a second rollback.
  comment on table public.daily_vote_quota_config is
    'Trusted mirror of the live free-vote quota inputs captured during migration 20261121; update through reviewed owner-only config changes, never from the browser.';
end
$restore$;

-- 3. Post-check, in the same transaction.
do $postcheck$
declare
  v_record  jsonb := current_setting('ccl.dailyfree.previous')::jsonb;
  v_neutral jsonb;
  v_source  jsonb;
  v_counts  jsonb;
  v_comment text;
begin
  select jsonb_build_object(
           'free_vote_grant_enabled',     (select value from public.daily_vote_quota_config where key = 'free_vote_grant_enabled'),
           'free_votes_per_day',          (select value from public.daily_vote_quota_config where key = 'free_votes_per_day'),
           'global_daily_vote_cap_enabled', (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled'),
           'global_daily_vote_cap',       (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap'))
    into v_neutral;
  select jsonb_build_object(
           'free_vote_grant_enabled',     (select value from public.daily_quiz_config where key = 'free_vote_grant_enabled'),
           'free_votes_per_day',          (select value from public.daily_quiz_config where key = 'free_votes_per_day'),
           'global_daily_vote_cap_enabled', (select value from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled'),
           'global_daily_vote_cap',       (select value from public.daily_quiz_config where key = 'global_daily_vote_cap'))
    into v_source;
  if v_neutral is distinct from v_source then
    raise exception 'err.dailyFreeVotesRollback: the two quota config copies diverged during the rollback: % / %', v_neutral, v_source;
  end if;
  if (v_neutral -> 'free_vote_grant_enabled') is distinct from (v_record -> 'free_vote_grant_enabled')
     or (v_neutral -> 'free_votes_per_day') is distinct from (v_record -> 'free_votes_per_day') then
    raise exception 'err.dailyFreeVotesRollback: the restored policy is not the recorded one. recorded: % live: %', v_record, v_neutral;
  end if;
  select obj_description('public.daily_vote_quota_config'::regclass, 'pg_class') into v_comment;
  if v_comment is null or position('20261124_restore_daily_free_votes previous live policy: ' in v_comment) > 0 then
    raise exception 'err.dailyFreeVotesRollback: the previous-policy record was not cleared from the table comment';
  end if;

  select jsonb_build_object(
    'profiles',                  (select count(*) from public.profiles),
    'votes',                     (select count(*) from public.votes),
    'daily_login_rewards',       (select count(*) from public.daily_login_rewards),
    'daily_vote_quota_earnings', (select count(*) from public.daily_vote_quota_earnings),
    'vote_credits',              (select coalesce(sum(vote_credits), 0) from public.profiles),
    'bonus_credits',             (select coalesce(sum(bonus_credits), 0) from public.profiles)
  ) into v_counts;
  if v_counts <> current_setting('ccl.dailyfree.counts')::jsonb then
    raise exception 'err.dailyFreeVotesRollback: rows or wallet sums changed during a config-only rollback. before: % after: %',
      current_setting('ccl.dailyfree.counts'), v_counts;
  end if;

  raise notice '20261124 rolled back: both copies restored to the recorded policy; wallets, vote history, check-in history and the ledger are unchanged';
end
$postcheck$;

notify pgrst, 'reload schema';
commit;
