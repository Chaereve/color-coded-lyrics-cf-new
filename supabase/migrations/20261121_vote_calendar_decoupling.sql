-- Vote quota + Calendar API decoupling. Append-only; run after 20261120.
--
-- Fail-closed contract:
--   * Validate the live source schema/config/function ACLs and migration state.
--   * Lock source config/award/calendar tables and snapshot the source rows.
--   * Copy actual config and awarded-answer events into neutral vote objects.
--   * Prove row, uniqueness, per-user/day count, and quota equivalence.
--   * Only then replace vote functions, the quiz award writer, and add the new
--     auth.uid()-scoped Calendar API. Any error aborts this transaction.
--
-- No repository seed/default is treated as a production quota. No wallet,
-- vote-history, check-in-history, quiz content or free-vote policy is rewritten.
-- 20261118 remains quarantined and is never run by this migration.
begin;

-- 1. Source/migration-state preflight. This block performs no writes.
do $preflight$
declare
  v_name text;
  v_def text;
begin
  foreach v_name in array array[
    'public.profiles', 'public.votes', 'public.requests', 'public.activity_days',
    'public.edge_gate', 'public.daily_quiz_questions', 'public.daily_quiz_config',
    'public.daily_quiz_attempts', 'public.daily_quiz_answers', 'public.daily_login_rewards'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'err.voteCalendarPreflight: missing source table %', v_name;
    end if;
    if not exists (select 1 from pg_class where oid = to_regclass(v_name) and relkind = 'r') then
      raise exception 'err.voteCalendarPreflight: source object is not a regular table (%)', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'anon', 'authenticated', 'service_role'
  ] loop
    if to_regrole(v_name) is null then
      raise exception 'err.voteCalendarPreflight: missing role %', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'public.daily_quiz_int(text,integer)',
    'public.daily_quiz_bool(text,boolean)',
    'public.daily_quiz_votes_on(uuid,date)',
    'public.daily_free_vote_grant(uuid,date)',
    'public.my_vote_status()',
    'public.cast_vote(uuid,integer,text,text,text)',
    'public.edge_gate_ok(text)',
    'public.daily_rewards_payload(uuid,timestamp with time zone)',
    'public.start_daily_quiz(uuid,date)',
    'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.my_daily_checkin_month(date)',
    'public.claim_daily_login(uuid,date)',
    'public.daily_login_rewards_no_vote()'
  ] loop
    if to_regprocedure(v_name) is null then
      raise exception 'err.voteCalendarPreflight: missing source function %', v_name;
    end if;
  end loop;

  if to_regclass('public.daily_vote_quota_config') is not null
     or to_regclass('public.daily_vote_quota_earnings') is not null
     or exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('daily_vote_earned_on','daily_login_calendar_payload',
                            'my_daily_login_status','claim_daily_login_calendar')
     ) then
    raise exception 'err.voteCalendarPreflight: partial/unknown target objects already exist';
  end if;

  -- If migration history exists, it must prove the required source migrations.
  -- A fresh SQL-Editor install has no history table; catalog checks below still
  -- apply. Never infer state from an empty or partial history table.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'supabase_migrations'
         and table_name = 'schema_migrations' and column_name = 'version'
         and data_type = 'text' and is_nullable = 'NO'
    ) then
      raise exception 'err.voteCalendarPreflight: migration history version column is not the expected NOT NULL text';
    end if;

    if exists (select 1 from supabase_migrations.schema_migrations
                where version in ('20261121_vote_calendar_decoupling', '20261121')) then
      raise exception 'err.voteCalendarPreflight: target migration is already recorded';
    end if;

    foreach v_name in array array[
      '20261112_daily_rewards|20261112',
      '20261113_calendar_kpop_quiz|20261113',
      '20261114_daily_rewards_upgrade|20261114',
      '20261115_daily_quiz_schema|20261115',
      '20261116_daily_quiz_pool|20261116',
      '20261117_daily_quiz_flow|20261117',
      '20261119_preserve_legacy_daily_login_rewards|20261119',
      '20261120_daily_login_reward_immutable|20261120'
    ] loop
      if not exists (
        select 1 from supabase_migrations.schema_migrations
         where version = split_part(v_name, '|', 1)
            or version = split_part(v_name, '|', 2)
      ) then
        raise exception 'err.voteCalendarPreflight: required migration state missing (%)', v_name;
      end if;
    end loop;
  end if;

  -- Freeze every live table used by the source functions/backfill before
  -- validating its columns/config or taking the data snapshot. SHARE blocks
  -- concurrent writes and DDL while leaving owner-scoped reads available.
  lock table public.profiles, public.votes, public.requests, public.activity_days,
             public.edge_gate, public.daily_quiz_questions, public.daily_quiz_config,
             public.daily_quiz_attempts, public.daily_quiz_answers, public.daily_login_rewards
    in share mode;

  -- Required columns, exact types and nullability for every object read or
  -- written by the cut-over functions. A similarly named or hand-edited table
  -- is not accepted as a source.
  foreach v_name in array array[
    'public.profiles|id|uuid|true',
    'public.profiles|vote_credits|integer|true',
    'public.profiles|bonus_credits|integer|true',
    'public.votes|id|bigint|true',
    'public.votes|request_id|uuid|true',
    'public.votes|user_id|uuid|true',
    'public.votes|used_credit|boolean|true',
    'public.votes|credit_kind|text|false',
    'public.votes|vote_day|date|true',
    'public.votes|free_slot|smallint|false',
    'public.votes|fp_slot|smallint|false',
    'public.votes|fp_hash|text|false',
    'public.votes|ip_hash|text|false',
    'public.votes|created_at|timestamp with time zone|true',
    'public.requests|id|uuid|true',
    'public.requests|status|text|true',
    'public.requests|votes|integer|true',
    'public.requests|updated_at|timestamp with time zone|true',
    'public.requests|picked_at|timestamp with time zone|false',
    'public.activity_days|user_id|uuid|true',
    'public.activity_days|day|date|true',
    'public.edge_gate|id|boolean|true',
    'public.edge_gate|token_hash|text|false',
    'public.edge_gate|updated_at|timestamp with time zone|true',
    'public.daily_quiz_config|key|text|true',
    'public.daily_quiz_config|value|jsonb|true',
    'public.daily_quiz_config|updated_at|timestamp with time zone|true',
    'public.daily_quiz_attempts|id|uuid|true',
    'public.daily_quiz_attempts|user_id|uuid|true',
    'public.daily_quiz_attempts|quiz_date|date|true',
    'public.daily_quiz_attempts|questions|jsonb|true',
    'public.daily_quiz_attempts|question_count|integer|true',
    'public.daily_quiz_attempts|max_votes|integer|true',
    'public.daily_quiz_attempts|votes_awarded|integer|true',
    'public.daily_quiz_attempts|locked|boolean|true',
    'public.daily_quiz_attempts|submitted_at|timestamp with time zone|false',
    'public.daily_quiz_answers|user_id|uuid|true',
    'public.daily_quiz_answers|quiz_date|date|true',
    'public.daily_quiz_answers|question_id|text|true',
    'public.daily_quiz_answers|attempt_id|uuid|true',
    'public.daily_quiz_answers|option_id|text|true',
    'public.daily_quiz_answers|correct|boolean|true',
    'public.daily_quiz_answers|awarded|integer|true',
    'public.daily_quiz_answers|answered_at|timestamp with time zone|true',
    'public.daily_login_rewards|user_id|uuid|true',
    'public.daily_login_rewards|reward_day|date|true',
    'public.daily_login_rewards|reward|integer|true',
    'public.daily_login_rewards|created_at|timestamp with time zone|true'
  ] loop
    if not exists (
      select 1 from pg_attribute a
       where a.attrelid = split_part(v_name, '|', 1)::regclass
         and a.attname = split_part(v_name, '|', 2)
         and a.atttypid = split_part(v_name, '|', 3)::regtype
         and a.attnotnull = (split_part(v_name, '|', 4) = 'true')
         and not a.attisdropped
    ) then
      raise exception 'err.voteCalendarPreflight: missing/incompatible source column (%)', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_config'::regclass
       and a.attname = 'key' and a.atttypid = 'text'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_config'::regclass
       and a.attname = 'value' and a.atttypid = 'jsonb'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_config'::regclass
       and a.attname = 'updated_at' and a.atttypid = 'timestamptz'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_answers'::regclass
       and a.attname = 'user_id' and a.atttypid = 'uuid'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_answers'::regclass
       and a.attname = 'quiz_date' and a.atttypid = 'date'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_answers'::regclass
       and a.attname = 'question_id' and a.atttypid = 'text'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_answers'::regclass
       and a.attname = 'awarded' and a.atttypid = 'integer'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_quiz_answers'::regclass
       and a.attname = 'answered_at' and a.atttypid = 'timestamptz'::regtype and a.attnotnull and not a.attisdropped
  ) then
    raise exception 'err.voteCalendarPreflight: incompatible source column';
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.daily_quiz_config'::regclass and c.contype = 'p'
       and pg_get_constraintdef(c.oid) ilike 'PRIMARY KEY (key)'
  ) then
    raise exception 'err.voteCalendarPreflight: daily_quiz_config key is not unique';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.daily_quiz_answers'::regclass and c.contype = 'p'
       and pg_get_constraintdef(c.oid) ilike 'PRIMARY KEY (user_id, quiz_date, question_id)'
  ) then
    raise exception 'err.voteCalendarPreflight: daily_quiz_answers source uniqueness is missing';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.daily_quiz_answers'::regclass and c.contype = 'c'
       and (position('any (array[0, 1])' in lower(pg_get_constraintdef(c.oid))) > 0
         or position('in (0, 1)' in lower(pg_get_constraintdef(c.oid))) > 0)
  ) or exists (
    select 1 from public.daily_quiz_answers where awarded not in (0, 1)
  ) then
    raise exception 'err.voteCalendarPreflight: exact awarded IN (0,1) check/data is missing or invalid';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'daily_quiz_answers'
       and indexname = 'daily_quiz_answers_day_idx' and indexdef ilike '%(user_id, quiz_date)%'
  ) then
    raise exception 'err.voteCalendarPreflight: daily_quiz_answers day index is missing/invalid';
  end if;

  -- Constraint identities and the quota indexes are part of the vote
  -- contract, not an optimization guess. A renamed or weakened structure is
  -- refused before the application functions are cut over.
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                  and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.votes'::regclass
                     and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.requests'::regclass
                     and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.edge_gate'::regclass
                     and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.daily_quiz_attempts'::regclass
                     and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)')
     or not exists (select 1 from pg_constraint where conrelid = 'public.daily_quiz_questions'::regclass
                     and contype = 'p' and pg_get_constraintdef(oid) ilike 'PRIMARY KEY (id)') then
    raise exception 'err.voteCalendarPreflight: a source primary key is missing or incompatible';
  end if;
  if not exists (
    select 1 from pg_constraint c where c.conrelid = 'public.edge_gate'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike 'CHECK (id)'
  ) or not exists (
    select 1 from pg_constraint c where c.conrelid = 'public.votes'::regclass and c.contype = 'c'
      and position('free_slot' in lower(pg_get_constraintdef(c.oid))) > 0
      and position('1' in pg_get_constraintdef(c.oid)) > 0
      and position('3' in pg_get_constraintdef(c.oid)) > 0
  ) or not exists (
    select 1 from pg_constraint c where c.conrelid = 'public.votes'::regclass and c.contype = 'c'
      and position('fp_slot' in lower(pg_get_constraintdef(c.oid))) > 0
      and position('1' in pg_get_constraintdef(c.oid)) > 0
      and position('3' in pg_get_constraintdef(c.oid)) > 0
  ) or not exists (
    select 1 from pg_constraint c where c.conrelid = 'public.votes'::regclass and c.contype = 'c'
      and position('credit_kind' in lower(pg_get_constraintdef(c.oid))) > 0
      and position('free' in lower(pg_get_constraintdef(c.oid))) > 0
      and position('bonus' in lower(pg_get_constraintdef(c.oid))) > 0
      and position('purchased' in lower(pg_get_constraintdef(c.oid))) > 0
  ) then
    raise exception 'err.voteCalendarPreflight: a source CHECK constraint is missing or incompatible';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'votes'
      and indexname = 'votes_free_quota_idx' and indexdef ilike '%unique index%user_id, vote_day, free_slot%'
      and indexdef ilike '%where%free_slot%is not null%'
  ) or not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'votes'
      and indexname = 'votes_fp_free_quota_idx' and indexdef ilike '%unique index%fp_hash, vote_day, fp_slot%'
      and indexdef ilike '%where%fp_hash%is not null%fp_slot%is not null%'
  ) or not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'votes'
      and indexname = 'votes_day_idx' and indexdef ilike '%(vote_day, user_id)%'
  ) or not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'votes'
      and indexname = 'votes_user_request_idx' and indexdef ilike '%(user_id, request_id)%'
  ) or not exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'daily_quiz_attempts'
      and indexname = 'daily_quiz_attempts_user_quiz_date_idx'
      and indexdef ilike '%unique index%user_id, quiz_date%where%quiz_date%is not null%'
  ) then
    raise exception 'err.voteCalendarPreflight: a source unique/supporting index is missing or incompatible';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'daily_quiz_config' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'daily_quiz_answers' and c.relrowsecurity
  ) or has_table_privilege('anon', 'public.daily_quiz_config', 'SELECT')
    or has_table_privilege('authenticated', 'public.daily_quiz_config', 'SELECT')
    or has_table_privilege('anon', 'public.daily_quiz_config', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_quiz_config', 'INSERT')
    or has_table_privilege('anon', 'public.daily_quiz_config', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_quiz_config', 'UPDATE')
    or has_table_privilege('anon', 'public.daily_quiz_config', 'DELETE')
    or has_table_privilege('authenticated', 'public.daily_quiz_config', 'DELETE')
    or has_table_privilege('anon', 'public.daily_quiz_answers', 'SELECT')
    or has_table_privilege('authenticated', 'public.daily_quiz_answers', 'SELECT')
    or has_table_privilege('anon', 'public.daily_quiz_answers', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_quiz_answers', 'INSERT')
    or has_table_privilege('anon', 'public.daily_quiz_answers', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_quiz_answers', 'UPDATE')
    or has_table_privilege('anon', 'public.daily_quiz_answers', 'DELETE')
    or has_table_privilege('authenticated', 'public.daily_quiz_answers', 'DELETE')
    or not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'daily_login_rewards' and c.relrowsecurity
    ) or has_table_privilege('anon', 'public.daily_login_rewards', 'SELECT')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'SELECT')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'INSERT')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'UPDATE')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'DELETE')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'DELETE')
    or exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename in ('daily_quiz_config','daily_quiz_answers','daily_login_rewards')
         and cmd in ('INSERT','UPDATE','DELETE','ALL')
    ) then
    raise exception 'err.voteCalendarPreflight: source RLS/ACL permits an unexpected client write';
  end if;
  if not exists (
    select 1 from pg_class c where c.oid = 'public.edge_gate'::regclass and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c where c.oid = 'public.daily_quiz_questions'::regclass and c.relrowsecurity
  ) or has_table_privilege('anon', 'public.edge_gate', 'SELECT')
    or has_table_privilege('authenticated', 'public.edge_gate', 'SELECT')
    or has_table_privilege('anon', 'public.edge_gate', 'INSERT')
    or has_table_privilege('authenticated', 'public.edge_gate', 'INSERT')
    or has_table_privilege('anon', 'public.edge_gate', 'UPDATE')
    or has_table_privilege('authenticated', 'public.edge_gate', 'UPDATE')
    or has_table_privilege('anon', 'public.edge_gate', 'DELETE')
    or has_table_privilege('authenticated', 'public.edge_gate', 'DELETE')
    or has_table_privilege('anon', 'public.daily_quiz_questions', 'SELECT')
    or has_table_privilege('authenticated', 'public.daily_quiz_questions', 'SELECT')
    or has_table_privilege('anon', 'public.daily_quiz_questions', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_quiz_questions', 'INSERT')
    or has_table_privilege('anon', 'public.daily_quiz_questions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_quiz_questions', 'UPDATE')
    or has_table_privilege('anon', 'public.daily_quiz_questions', 'DELETE')
    or has_table_privilege('authenticated', 'public.daily_quiz_questions', 'DELETE') then
    raise exception 'err.voteCalendarPreflight: edge gate/question-bank RLS or ACL is unsafe';
  end if;

  -- Calendar source invariants and a current immutable-reward guard.
  if not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_login_rewards'::regclass
       and a.attname = 'user_id' and a.atttypid = 'uuid'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.daily_login_rewards'::regclass
       and a.attname = 'reward_day' and a.atttypid = 'date'::regtype and a.attnotnull and not a.attisdropped
  ) or not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.daily_login_rewards'::regclass and c.contype = 'p'
       and pg_get_constraintdef(c.oid) ilike 'PRIMARY KEY (user_id, reward_day)'
  ) or not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.daily_login_rewards'::regclass
       and t.tgname = 'daily_login_rewards_no_vote' and t.tgenabled = 'O'
       and not t.tgisinternal and p.proname = 'daily_login_rewards_no_vote'
  ) or not exists (
    select 1 from pg_attrdef d join pg_attribute a
      on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.daily_login_rewards'::regclass and a.attname = 'reward'
       and pg_get_expr(d.adbin, d.adrelid) like '0%'
  ) then
    raise exception 'err.voteCalendarPreflight: daily_login_rewards schema/immutability state is not ready';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'daily_login_rewards' and c.relrowsecurity
  ) or has_table_privilege('anon', 'public.daily_login_rewards', 'SELECT')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'SELECT')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'INSERT')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'INSERT')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'UPDATE')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'UPDATE')
    or has_table_privilege('anon', 'public.daily_login_rewards', 'DELETE')
    or has_table_privilege('authenticated', 'public.daily_login_rewards', 'DELETE')
    or exists (
      select 1 from pg_policies where schemaname = 'public'
       and tablename = 'daily_login_rewards' and cmd in ('INSERT','UPDATE','DELETE','ALL')
    ) then
    raise exception 'err.voteCalendarPreflight: daily_login_rewards RLS/ACL is unsafe';
  end if;
  v_def := lower(pg_get_functiondef('public.daily_login_rewards_no_vote()'::regprocedure));
  if position(lower('err.dailyLoginRewardImmutable') in v_def) = 0
     or position('new.reward is distinct from old.reward' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: immutable check-in guard is unknown';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_daily_login(uuid,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_daily_login(uuid,date)', 'EXECUTE') then
    raise exception 'err.voteCalendarPreflight: legacy login RPC grants are not authenticated-only';
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.activity_days'::regclass and c.contype in ('p','u')
       and pg_get_constraintdef(c.oid) ilike '%(user_id, day)%'
  ) then
    raise exception 'err.voteCalendarPreflight: activity_days idempotency constraint is missing';
  end if;

  -- Typed source config must be present, scalar and safely representable.
  if (select count(*) from public.daily_quiz_config
       where key in ('free_vote_grant_enabled','free_votes_per_day',
                     'global_daily_vote_cap_enabled','global_daily_vote_cap')) <> 4 then
    raise exception 'err.voteCalendarPreflight: live vote configuration is incomplete';
  end if;
  if exists (
    select 1 from public.daily_quiz_config
     where key in ('free_vote_grant_enabled','global_daily_vote_cap_enabled')
       and jsonb_typeof(value) <> 'boolean'
  ) or exists (
    select 1 from public.daily_quiz_config
     where key in ('free_votes_per_day','global_daily_vote_cap')
       and case
         when jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^[0-9]+$'
           then (value #>> '{}')::numeric > 2147483647
         else true
       end
  ) then
    raise exception 'err.voteCalendarPreflight: live vote configuration has an invalid type/value';
  end if;

  v_def := lower(pg_get_functiondef('public.daily_quiz_int(text,integer)'::regprocedure));
  if position('daily_quiz_config' in v_def) = 0 or position('p_key' in v_def) = 0
     or position('p_default' in v_def) = 0 or position('coalesce' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: daily_quiz_int is not the expected live-config reader';
  end if;
  v_def := lower(pg_get_functiondef('public.daily_quiz_bool(text,boolean)'::regprocedure));
  if position('daily_quiz_config' in v_def) = 0 or position('p_key' in v_def) = 0
     or position('p_default' in v_def) = 0 or position('coalesce' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: daily_quiz_bool is not the expected live-config reader';
  end if;
  v_def := lower(pg_get_functiondef('public.daily_quiz_votes_on(uuid,date)'::regprocedure));
  if position('count(*)' in v_def) = 0 or position('public.daily_quiz_answers' in v_def) = 0
     or position('user_id = p_uid' in v_def) = 0 or position('quiz_date = p_day' in v_def) = 0
     or position('awarded = 1' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: daily_quiz_votes_on source body is unknown';
  end if;
  v_def := lower(pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure));
  if position('free_vote_grant_enabled' in v_def) = 0
     or position('free_votes_per_day' in v_def) = 0
     or position('global_daily_vote_cap_enabled' in v_def) = 0
     or position('global_daily_vote_cap' in v_def) = 0
     or position('daily_quiz_votes_on' in v_def) = 0
     or position('greatest' in v_def) = 0 or position('least' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: live daily_free_vote_grant source body is unknown';
  end if;
  v_def := lower(pg_get_functiondef('public.my_vote_status()'::regprocedure));
  if position('daily_free_vote_grant' in v_def) = 0 or position('auth.uid()' in v_def) = 0
     or position('public.votes' in v_def) = 0 or position('public.profiles' in v_def) = 0
     or position('free_limit' in v_def) = 0 or position('purchased' in v_def) = 0
     or position('bonus' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: live my_vote_status source body/return shape is unknown';
  end if;
  v_def := lower(pg_get_functiondef('public.cast_vote(uuid,integer,text,text,text)'::regprocedure));
  if position('daily_free_vote_grant' in v_def) = 0
     or position('edge_gate_ok' in v_def) = 0
     or position('auth.uid()' in v_def) = 0
     or position('public.requests' in v_def) = 0 or position('public.profiles' in v_def) = 0
     or position('public.votes' in v_def) = 0 or position('credit_kind' in v_def) = 0
     or position('for update' in v_def) = 0
     or position('v_usefree := least(v_n, v_freeleft, v_fpleft)' in v_def) = 0
     or position('v_usebonus := least(v_usecred, v_bonus)' in v_def) = 0
     or position('v_usepurch := v_usecred - v_usebonus' in v_def) = 0
     or position('bonus_credits = bonus_credits - v_usebonus' in v_def) = 0
     or position('vote_credits  = vote_credits  - v_usepurch' in v_def) = 0
     or position('credit_kind = ''bonus''' in v_def) = 0
     or position('credit_kind = ''purchased''' in v_def) = 0
     or position('bonus_credits = bonus_credits + coalesce(v_refbonus, 0)' in v_def) = 0
     or position('vote_credits  = vote_credits  + coalesce(v_refpurch, 0)' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: live cast_vote source/spending/refund order is unknown';
  end if;
  if not has_function_privilege('authenticated', 'public.my_vote_status()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.cast_vote(uuid,integer,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_vote_status()', 'EXECUTE')
     or has_function_privilege('anon', 'public.cast_vote(uuid,integer,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.daily_free_vote_grant(uuid,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.daily_free_vote_grant(uuid,date)', 'EXECUTE') then
    raise exception 'err.voteCalendarPreflight: vote RPC/helper grants are not the expected state';
  end if;

  v_def := lower(pg_get_functiondef('public.submit_daily_quiz_answer(uuid,uuid,text,text)'::regprocedure));
  if position('insert into public.daily_quiz_answers' in v_def) = 0
     or position('v_awarded = 1' in v_def) = 0
     or position('v_cap := least(v_cap, v_attempt.max_votes)' in v_def) = 0
     or position('bonus_credits = bonus_credits + 1' in v_def) = 0
     or position('public.daily_rewards_payload' in v_def) = 0 then
    raise exception 'err.voteCalendarPreflight: live quiz award writer is unknown';
  end if;
  if not has_function_privilege('authenticated', 'public.start_daily_quiz(uuid,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.start_daily_quiz(uuid,date)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.submit_daily_quiz_answer(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.submit_daily_quiz_answer(uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.daily_quiz_int(text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.daily_quiz_int(text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.daily_quiz_bool(text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.daily_quiz_bool(text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.daily_quiz_votes_on(uuid,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.daily_quiz_votes_on(uuid,date)', 'EXECUTE') then
    raise exception 'err.voteCalendarPreflight: quiz RPC/helper grants are not the expected state';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?daily_quiz_answers'
       and p.oid <> 'public.submit_daily_quiz_answer(uuid,uuid,text,text)'::regprocedure
  ) then
    raise exception 'err.voteCalendarPreflight: another database function writes quiz answers';
  end if;

  v_def := lower(pg_get_functiondef('public.my_daily_checkin_month(date)'::regprocedure));
  if position('auth.uid()' in v_def) = 0
     or position('daily_login_rewards' in v_def) = 0
     or position('daily_quiz' in v_def) > 0 then
    raise exception 'err.voteCalendarPreflight: existing Calendar month RPC is not quiz-free/owner-scoped';
  end if;
  if not has_function_privilege('authenticated', 'public.my_daily_checkin_month(date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_daily_checkin_month(date)', 'EXECUTE') then
    raise exception 'err.voteCalendarPreflight: Calendar month RPC grants are not owner-only';
  end if;
end
$preflight$;

create temporary table _ccl_vote_quiz_source_snapshot as
select user_id, quiz_date, question_id, awarded, answered_at
  from public.daily_quiz_answers;

-- 2. Neutral config and immutable earning events. Values are copied verbatim;
-- no seed/default values participate in this migration.
create table public.daily_vote_quota_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null,
  constraint daily_vote_quota_config_key_check check (
    key in ('free_vote_grant_enabled','free_votes_per_day',
            'global_daily_vote_cap_enabled','global_daily_vote_cap')
  ),
  constraint daily_vote_quota_config_value_check check (
    case
      when key in ('free_vote_grant_enabled','global_daily_vote_cap_enabled')
        then jsonb_typeof(value) = 'boolean'
      when key in ('free_votes_per_day','global_daily_vote_cap')
        then jsonb_typeof(value) = 'number'
          and (value #>> '{}') ~ '^[0-9]+$'
          and (value #>> '{}')::numeric <= 2147483647
      else false
    end
  )
);

create table public.daily_vote_quota_earnings (
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- No FK: preserve the neutral event and keep account-deletion behavior
  -- unchanged; this immutable quota audit row may outlive its auth profile.
  user_id uuid not null,
  vote_day date not null,
  source_key text not null check (length(source_key) > 0),
  amount integer not null check (amount > 0),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint daily_vote_quota_earnings_pkey primary key (source, user_id, vote_day, source_key)
);
create index daily_vote_quota_earnings_user_day_idx
  on public.daily_vote_quota_earnings (user_id, vote_day);

alter table public.daily_vote_quota_config enable row level security;
alter table public.daily_vote_quota_earnings enable row level security;
revoke all on public.daily_vote_quota_config, public.daily_vote_quota_earnings from public, anon, authenticated;
grant all on public.daily_vote_quota_config, public.daily_vote_quota_earnings to service_role;

insert into public.daily_vote_quota_config (key, value, updated_at)
select key, value, updated_at
  from public.daily_quiz_config
 where key in ('free_vote_grant_enabled','free_votes_per_day',
               'global_daily_vote_cap_enabled','global_daily_vote_cap');

-- Keep the snapshot complete, including non-awarded rows; only awarded source
-- rows become neutral vote-earnings events.
insert into public.daily_vote_quota_earnings
  (source, user_id, vote_day, source_key, amount, recorded_at)
select 'daily_quiz', user_id, quiz_date, question_id, 1, answered_at
  from _ccl_vote_quiz_source_snapshot
 where awarded = 1;

-- 3. Validate copied config, row counts/content, uniqueness, daily totals and
-- the live quota formula before any function is replaced.
do $equivalence$
declare
  v_source_rows bigint;
  v_live_source_rows bigint;
  v_source_awards bigint;
  v_backfilled bigint;
  v_config_rows integer;
  v_mismatch boolean;
begin
  select count(*) into v_source_rows from _ccl_vote_quiz_source_snapshot;
  select count(*) into v_live_source_rows from public.daily_quiz_answers;
  select count(*) into v_source_awards from _ccl_vote_quiz_source_snapshot where awarded = 1;
  select count(*) into v_backfilled from public.daily_vote_quota_earnings;
  select count(*) into v_config_rows from public.daily_vote_quota_config;

  if v_live_source_rows <> v_source_rows then
    raise exception 'err.voteCalendarBackfill: locked source row count changed after snapshot';
  end if;
  if exists (select 1 from _ccl_vote_quiz_source_snapshot where awarded not in (0,1)) then
    raise exception 'err.voteCalendarBackfill: source contains invalid awarded value';
  end if;
  if v_source_rows <> (
    select count(distinct (user_id, quiz_date, question_id)) from _ccl_vote_quiz_source_snapshot
  ) then
    raise exception 'err.voteCalendarBackfill: source snapshot is not unique';
  end if;
  if v_backfilled <> v_source_awards then
    raise exception 'err.voteCalendarBackfill: source awards (%) differ from ledger rows (%)', v_source_awards, v_backfilled;
  end if;
  if v_config_rows <> 4 then
    raise exception 'err.voteCalendarConfig: copied live config row count is not four (%)', v_config_rows;
  end if;

  if exists (
    (select user_id, quiz_date, question_id, 1::integer as amount, answered_at as recorded_at
       from _ccl_vote_quiz_source_snapshot where awarded = 1
     except all
     select user_id, vote_day, source_key, amount, recorded_at
       from public.daily_vote_quota_earnings where source = 'daily_quiz')
    union all
    (select user_id, vote_day, source_key, amount, recorded_at
       from public.daily_vote_quota_earnings where source = 'daily_quiz'
     except all
     select user_id, quiz_date, question_id, 1::integer as amount, answered_at as recorded_at
       from _ccl_vote_quiz_source_snapshot where awarded = 1)
  ) then
    raise exception 'err.voteCalendarBackfill: exact source/backfill row content differs';
  end if;
  if exists (
    select source, user_id, vote_day, source_key
      from public.daily_vote_quota_earnings
     group by source, user_id, vote_day, source_key having count(*) <> 1
  ) then
    raise exception 'err.voteCalendarBackfill: duplicate neutral earning key';
  end if;
  if exists (
    (select key, value, updated_at from public.daily_quiz_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap')
     except all
     select key, value, updated_at from public.daily_vote_quota_config)
    union all
    (select key, value, updated_at from public.daily_vote_quota_config
     except all
     select key, value, updated_at from public.daily_quiz_config
      where key in ('free_vote_grant_enabled','free_votes_per_day',
                    'global_daily_vote_cap_enabled','global_daily_vote_cap'))
  ) then
    raise exception 'err.voteCalendarConfig: copied live config content differs';
  end if;

  -- Compare per-account/day source awards and neutral ledger totals.
  if exists (
    with source_totals as (
      select user_id, quiz_date as vote_day, count(*)::integer as earned
        from _ccl_vote_quiz_source_snapshot where awarded = 1
       group by user_id, quiz_date
    ),
    ledger_totals as (
      select user_id, vote_day, sum(amount)::integer as earned
        from public.daily_vote_quota_earnings
       group by user_id, vote_day
    ),
    differences as (
      (select user_id, vote_day, earned from source_totals
       except all
       select user_id, vote_day, earned from ledger_totals)
      union all
      (select user_id, vote_day, earned from ledger_totals
       except all
       select user_id, vote_day, earned from source_totals)
    )
    select 1 from differences
  ) then
    raise exception 'err.voteCalendarBackfill: per-user/day earned totals differ';
  end if;

  -- Explicitly evaluate the old and new daily grant formula for every
  -- source-bearing day. Since config and earned counts above are byte-for-byte
  -- equivalent, these results must match; any divergence aborts cutover.
  with src as (
    select user_id, quiz_date as vote_day, count(*)::integer as earned
      from _ccl_vote_quiz_source_snapshot where awarded = 1
     group by user_id, quiz_date
  ),
  dst as (
    select user_id, vote_day, sum(amount)::integer as earned
      from public.daily_vote_quota_earnings
     group by user_id, vote_day
  ),
  cfg as (
    select
      (select (value #>> '{}')::boolean from public.daily_quiz_config where key = 'free_vote_grant_enabled') as old_enabled,
      (select (value #>> '{}')::integer from public.daily_quiz_config where key = 'free_votes_per_day') as old_free,
      (select (value #>> '{}')::boolean from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled') as old_global,
      (select (value #>> '{}')::integer from public.daily_quiz_config where key = 'global_daily_vote_cap') as old_cap,
      (select (value #>> '{}')::boolean from public.daily_vote_quota_config where key = 'free_vote_grant_enabled') as new_enabled,
      (select (value #>> '{}')::integer from public.daily_vote_quota_config where key = 'free_votes_per_day') as new_free,
      (select (value #>> '{}')::boolean from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled') as new_global,
      (select (value #>> '{}')::integer from public.daily_vote_quota_config where key = 'global_daily_vote_cap') as new_cap
  ),
  pairs as (
    select coalesce(s.user_id, d.user_id) as user_id,
           coalesce(s.vote_day, d.vote_day) as vote_day,
           coalesce(s.earned, 0) as old_earned,
           coalesce(d.earned, 0) as new_earned
      from src s full join dst d using (user_id, vote_day)
  )
  select exists (
    select 1 from pairs cross join cfg
     where (case when not old_enabled then 0
                 when old_global then greatest(0, least(old_free, old_cap - old_earned))
                 else greatest(0, old_free) end)
           is distinct from
           (case when not new_enabled then 0
                 when new_global then greatest(0, least(new_free, new_cap - new_earned))
                 else greatest(0, new_free) end)
  ) into v_mismatch;
  if v_mismatch then
    raise exception 'err.voteCalendarQuota: source and neutral quota results differ';
  end if;

  -- Also call the live source function itself for every profile's current VN
  -- day and every historical answer-bearing day. Compare it with the exact
  -- neutral formula using the copied values/ledger, not a repo default.
  with calendar_day as (
    select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date as vote_day
  ), candidates as (
    select p.id as user_id, d.vote_day
      from public.profiles p cross join calendar_day d
    union
    select user_id, quiz_date from _ccl_vote_quiz_source_snapshot
  ), cfg as (
    select
      (select (value #>> '{}')::boolean from public.daily_vote_quota_config where key = 'free_vote_grant_enabled') as enabled,
      (select (value #>> '{}')::integer from public.daily_vote_quota_config where key = 'free_votes_per_day') as free_per_day,
      (select (value #>> '{}')::boolean from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled') as global_enabled,
      (select (value #>> '{}')::integer from public.daily_vote_quota_config where key = 'global_daily_vote_cap') as global_cap
  ), grants as (
    select c.user_id, c.vote_day,
           public.daily_free_vote_grant(c.user_id, c.vote_day) as source_grant,
           case when not cfg.enabled then 0
                when cfg.global_enabled then greatest(0, least(cfg.free_per_day, cfg.global_cap - earned.n))
                else greatest(0, cfg.free_per_day) end as neutral_grant
      from candidates c cross join cfg
      cross join lateral (
        select coalesce(sum(e.amount), 0)::integer as n
          from public.daily_vote_quota_earnings e
         where e.user_id = c.user_id and e.vote_day = c.vote_day
      ) earned
  )
  select exists (select 1 from grants where source_grant is distinct from neutral_grant)
    into v_mismatch;
  if v_mismatch then
    raise exception 'err.voteCalendarQuota: live source grant differs from copied config/ledger';
  end if;

  -- Keep the complete source snapshot counters visible to the validation block;
  -- unused non-awarded rows are still accounted for above and remain untouched.
  if v_source_rows < v_source_awards then
    raise exception 'err.voteCalendarBackfill: impossible source row count';
  end if;
end
$equivalence$;

-- 4. Vote functions are cut over only after every source/backfill/quota check.
create or replace function public.daily_vote_earned_on(p_uid uuid, p_day date)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::integer
    from public.daily_vote_quota_earnings
   where user_id = p_uid and vote_day = p_day
$$;
revoke all on function public.daily_vote_earned_on(uuid,date) from public, anon, authenticated;

create or replace function public.daily_free_vote_grant(p_uid uuid, p_day date)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled boolean;
  v_free_per_day integer;
  v_global_enabled boolean;
  v_global_cap integer;
  v_earned integer;
begin
  select (value #>> '{}')::boolean into v_enabled
    from public.daily_vote_quota_config where key = 'free_vote_grant_enabled';
  if not found or v_enabled is null then raise exception 'err.voteQuotaConfig'; end if;
  select (value #>> '{}')::integer into v_free_per_day
    from public.daily_vote_quota_config where key = 'free_votes_per_day';
  if not found or v_free_per_day is null then raise exception 'err.voteQuotaConfig'; end if;
  select (value #>> '{}')::boolean into v_global_enabled
    from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled';
  if not found or v_global_enabled is null then raise exception 'err.voteQuotaConfig'; end if;
  select (value #>> '{}')::integer into v_global_cap
    from public.daily_vote_quota_config where key = 'global_daily_vote_cap';
  if not found or v_global_cap is null then raise exception 'err.voteQuotaConfig'; end if;

  if not v_enabled then return 0; end if;
  if v_global_enabled then
    v_earned := public.daily_vote_earned_on(p_uid, p_day);
    return greatest(0, least(v_free_per_day, v_global_cap - v_earned));
  end if;
  return greatest(0, v_free_per_day);
end $$;
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

revoke all on function public.my_vote_status() from public, anon, authenticated;
grant execute on function public.my_vote_status() to authenticated;
revoke all on function public.cast_vote(uuid,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid,integer,text,text,text) to authenticated;

-- The existing quiz remains available. A genuinely new awarded answer records
-- one neutral earning event in the same transaction as its existing +1 bonus;
-- replayed answers never create another event or wallet write.
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
        insert into public.daily_vote_quota_earnings
          (source, user_id, vote_day, source_key, amount, recorded_at)
        values ('daily_quiz', v_uid, v_day, p_question_id, 1, v_now);
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

-- 5. New Calendar-only payload and RPC. Identity is always auth.uid(); the
-- expected day is a stale-client guard only and never selects the write date.
create or replace function public.daily_login_calendar_payload(p_uid uuid, p_now timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (
    select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day
  ), stats as (
    select count(c.reward_day)::integer as total_days,
           min(c.reward_day) as first_day,
           max(c.reward_day) as last_day,
           coalesce((
             select max(run_group.n) from (
               select count(*)::integer as n
                 from (
                   select r.reward_day - (row_number() over (order by r.reward_day))::integer as grp
                 from public.daily_login_rewards r
                 cross join d d3
                where r.user_id = p_uid and r.reward_day <= d3.day
               ) groups_all
                group by groups_all.grp
             ) run_group
           ), 0)::integer as best_streak,
           coalesce((
             select count(*)::integer from (
               select r.reward_day - (row_number() over (order by r.reward_day))::integer as grp
                 from public.daily_login_rewards r
                 cross join d d2
                where r.user_id = p_uid and r.reward_day <= d2.day
             ) groups_until_today
             group by groups_until_today.grp
             order by groups_until_today.grp desc limit 1
           ), 0)::integer as current_run
      from d
      left join public.daily_login_rewards c
        on c.user_id = p_uid and c.reward_day <= d.day
  )
  select jsonb_build_object(
    'user_id', p_uid,
    'day', d.day,
    'server_now', p_now,
    'reset_at', (d.day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh',
    'timezone', 'Asia/Ho_Chi_Minh',
    'login', jsonb_build_object(
      'claimed', l.user_id is not null,
      'claimed_days', coalesce((
        select jsonb_agg(c.reward_day order by c.reward_day)
          from public.daily_login_rewards c
         where c.user_id = p_uid
           and c.reward_day >= date_trunc('month', d.day)::date
           and c.reward_day <= d.day
      ), '[]'::jsonb),
      'total_days', stats.total_days,
      'first_day', stats.first_day,
      'streak', case when stats.last_day is null or stats.last_day < d.day - 1 then 0 else stats.current_run end,
      'best_streak', stats.best_streak
    )
  )
    from d cross join stats
    left join public.daily_login_rewards l on l.user_id = p_uid and l.reward_day = d.day
$$;
revoke all on function public.daily_login_calendar_payload(uuid,timestamptz) from public, anon, authenticated;

create or replace function public.my_daily_login_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'err.signin';
  end if;
  return public.daily_login_calendar_payload(v_uid, v_now);
end $$;
revoke all on function public.my_daily_login_status() from public, anon, authenticated;
grant execute on function public.my_daily_login_status() to authenticated;

create or replace function public.claim_daily_login_calendar(p_expected_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_day date;
  v_replayed boolean;
begin
  if v_uid is null then raise exception 'err.signin'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'err.signin'; end if;

  v_now := clock_timestamp();
  v_day := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_expected_day is distinct from v_day then raise exception 'err.dailyDayChanged'; end if;

  perform 1 from public.daily_login_rewards
   where user_id = v_uid and reward_day = v_day;
  v_replayed := found;
  if not v_replayed then
    insert into public.daily_login_rewards (user_id, reward_day, reward, created_at)
    values (v_uid, v_day, 0, v_now);
    insert into public.activity_days (user_id, day) values (v_uid, v_day)
      on conflict (user_id, day) do nothing;
  end if;

  return jsonb_build_object(
    'replayed', v_replayed,
    'status', public.daily_login_calendar_payload(v_uid, v_now)
  );
end $$;
revoke all on function public.claim_daily_login_calendar(date) from public, anon, authenticated;
grant execute on function public.claim_daily_login_calendar(date) to authenticated;

comment on table public.daily_vote_quota_config is
  'Trusted mirror of the live free-vote quota inputs captured during migration 20261121; update through reviewed owner-only config changes, never from the browser.';
comment on table public.daily_vote_quota_earnings is
  'Neutral append-only source events used by daily_free_vote_grant; quiz awards are materialized transactionally, without changing quiz history or wallet balances.';
comment on function public.my_daily_login_status() is
  'Calendar-only status. Identity is auth.uid(); response contains no quiz, wallet, payout or vote-award fields.';
comment on function public.claim_daily_login_calendar(date) is
  'Calendar-only claim. Identity is auth.uid(); p_expected_day is only a stale-client guard; the recorded day is computed by the server in Asia/Ho_Chi_Minh.';

notify pgrst, 'reload schema';
commit;
