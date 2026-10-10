-- Read-only checks after B4 (20261210_vote_back). Fail closed. No writes.
\set ON_ERROR_STOP on

\echo === B4 history: vote_back in, nothing else pending ===
select version from supabase_migrations.schema_migrations
 where version = '20261210_vote_back';

do $b4$
declare n int;
begin
  select count(*) into n from supabase_migrations.schema_migrations
   where version = '20261210_vote_back';
  if n <> 1 then
    raise exception 'B4 verify: expected 20261210_vote_back in history, got %', n;
  end if;
end
$b4$;

\echo === latch column, trigger, flag, pay_vote_back internal ===
select to_regprocedure('public.pay_vote_back(uuid)') as pay,
       to_regprocedure('public.admin_pick(uuid,boolean)') as admin_pick;

do $obj$
declare n int;
begin
  if to_regprocedure('public.pay_vote_back(uuid)') is null
     or to_regprocedure('public.requests_pay_vote_back()') is null then
    raise exception 'B4 verify: pay_vote_back missing';
  end if;
  select count(*) into n from pg_attribute
   where attrelid = 'public.requests'::regclass
     and attname = 'vote_back_paid_at' and not attisdropped;
  if n <> 1 then
    raise exception 'B4 verify: requests.vote_back_paid_at missing';
  end if;
  select count(*) into n from pg_trigger where tgname = 'requests_vote_back_tri';
  if n <> 1 then
    raise exception 'B4 verify: requests_vote_back_tri missing';
  end if;
  select count(*) into n from public.reward_config where key = 'vote_back_enabled' and value = 'true'::jsonb;
  if n <> 1 then
    raise exception 'B4 verify: vote_back_enabled is not true';
  end if;
  if has_function_privilege('authenticated', 'public.pay_vote_back(uuid)', 'execute') then
    raise exception 'B4 verify: pay_vote_back must not be executable by authenticated';
  end if;
end
$obj$;
