-- Read-only checks after B1 (20261126/27/28). Fail closed. No writes.
\set ON_ERROR_STOP on

\echo === B1 history: exactly those three ids, none of the later batch ===
select version from supabase_migrations.schema_migrations
 where version in (
   '20261126_reward_ledger',
   '20261127_login_streak_rewards',
   '20261128_achievements_v2')
 order by version;

do $b1$
declare
  v_b1 int;
  v_later int;
begin
  select count(*) into v_b1 from supabase_migrations.schema_migrations
   where version in (
     '20261126_reward_ledger',
     '20261127_login_streak_rewards',
     '20261128_achievements_v2');
  if v_b1 <> 3 then
    raise exception 'B1 verify: expected 3 history rows, got %', v_b1;
  end if;
  select count(*) into v_later from supabase_migrations.schema_migrations
   where version in (
     '20261129_mystery_box',
     '20261201_spin_v2',
     '20261202_mystery_paid_v2',
     '20261203_mystery_month',
     '20261204_mystery_odds',
     '20261210_vote_back');
  if v_later <> 0 then
    raise exception 'B1 verify: later batch already in history (%) — B2/B3/B4 must not be applied', v_later;
  end if;
end
$b1$;

\echo === ledger + claim + catalog objects ===
select to_regclass('public.reward_events') as reward_events,
       to_regclass('public.reward_config') as reward_config,
       to_regprocedure('public.grant_reward_event(uuid,date,text,text,integer,jsonb)') as grant_reward_event,
       to_regprocedure('public.claim_daily_login_calendar(date)') as claim_login,
       to_regprocedure('public.claim_achievements()') as claim_ach;

do $obj$
begin
  if to_regclass('public.reward_events') is null
     or to_regprocedure('public.grant_reward_event(uuid,date,text,text,integer,jsonb)') is null
     or to_regprocedure('public.claim_daily_login_calendar(date)') is null
     or to_regprocedure('public.claim_achievements()') is null then
    raise exception 'B1 verify: required function/table missing';
  end if;
end
$obj$;

\echo === login_rewards_enabled + daily_reward_cap ===
select key, value from public.reward_config
 where key in ('login_rewards_enabled','daily_reward_cap')
 order by key;

do $cfg$
declare v jsonb;
begin
  select value into v from public.reward_config where key = 'login_rewards_enabled';
  if v is null or v <> 'true'::jsonb then
    raise exception 'B1 verify: login_rewards_enabled is %, expected true', v;
  end if;
end
$cfg$;

\echo === achievements catalog: 20 active, firstVoteBack present ===
select count(*) filter (where active) as active,
       count(*) as total
  from public.achievement_definitions;

select id, source, threshold, bonus_votes
  from public.achievement_definitions
 where id in ('firstVoteBack','firstPick','firstMystery')
 order by id;

do $ach$
declare n int;
begin
  select count(*) into n from public.achievement_definitions where active;
  if n <> 20 then
    raise exception 'B1 verify: expected 20 active achievements, got %', n;
  end if;
  if not exists (
    select 1 from public.achievement_definitions
     where id = 'firstVoteBack' and active and source = 'vote_back' and bonus_votes = 3
  ) then
    raise exception 'B1 verify: firstVoteBack missing or mis-pointed';
  end if;
end
$ach$;
