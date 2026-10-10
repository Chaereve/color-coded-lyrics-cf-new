-- Read-only checks after B2 (20261129/20261202/03/04). Fail closed. No writes.
\set ON_ERROR_STOP on

\echo === B2 history: four mystery files, B3/B4 still absent ===
select version from supabase_migrations.schema_migrations
 where version in (
   '20261129_mystery_box',
   '20261202_mystery_paid_v2',
   '20261203_mystery_month',
   '20261204_mystery_odds',
   '20261201_spin_v2',
   '20261210_vote_back')
 order by version;

do $b2$
declare
  v_b2 int;
  v_hold int;
begin
  select count(*) into v_b2 from supabase_migrations.schema_migrations
   where version in (
     '20261129_mystery_box',
     '20261202_mystery_paid_v2',
     '20261203_mystery_month',
     '20261204_mystery_odds');
  if v_b2 <> 4 then
    raise exception 'B2 verify: expected 4 history rows, got %', v_b2;
  end if;
  select count(*) into v_hold from supabase_migrations.schema_migrations
   where version in ('20261201_spin_v2', '20261210_vote_back');
  if v_hold <> 0 then
    raise exception 'B2 verify: B3/B4 already in history (%) — must stay held', v_hold;
  end if;
end
$b2$;

\echo === mystery objects + month RPC ===
select to_regclass('public.mystery_opens') as mystery_opens,
       to_regprocedure('public.open_mystery_box(date,text)') as open_box,
       to_regprocedure('public.mystery_status(uuid,date)') as mystery_status,
       to_regprocedure('public.my_mystery_month(date)') as mystery_month;

do $obj$
begin
  if to_regclass('public.mystery_opens') is null
     or to_regprocedure('public.open_mystery_box(date,text)') is null
     or to_regprocedure('public.mystery_status(uuid,date)') is null
     or to_regprocedure('public.my_mystery_month(date)') is null then
    raise exception 'B2 verify: required mystery object missing';
  end if;
end
$obj$;

\echo === mystery_box_enabled + daily_reward_cap 30 ===
select key, value from public.reward_config
 where key in ('mystery_box_enabled','daily_reward_cap')
 order by key;

do $cfg$
declare v jsonb; cap jsonb;
begin
  select value into v from public.reward_config where key = 'mystery_box_enabled';
  if v is null or v <> 'true'::jsonb then
    raise exception 'B2 verify: mystery_box_enabled is %, expected true', v;
  end if;
  select value into cap from public.reward_config where key = 'daily_reward_cap';
  if cap is null or cap <> '30'::jsonb then
    raise exception 'B2 verify: daily_reward_cap is %, expected 30', cap;
  end if;
end
$cfg$;

\echo === odds v3 bands + free-paid labels in open_mystery_box ===
do $odds$
declare src text;
begin
  src := pg_get_functiondef('public.open_mystery_box(date,text)'::regprocedure);
  if src !~ 'v_roll\s*<\s*700'
     or src !~ 'v_roll\s*<\s*860'
     or src !~ 'v_roll\s*<\s*940'
     or src !~ 'v_roll\s*<\s*980'
     or src !~ 'v_roll\s*<\s*995'
     or src !~ 'v_roll\s*<\s*999' then
    raise exception 'B2 verify: open_mystery_box is not odds v3 (70/16/8/4/1.5/0.4/0.1 bands missing)';
  end if;
  if src ~ 'v_roll\s*<\s*550' then
    raise exception 'B2 verify: open_mystery_box still has v1 band v_roll < 550';
  end if;
  if position('free_paid_request' in src) = 0
     or src !~ 'v_free\s*:=\s*1'
     or src !~ 'v_free\s*:=\s*2'
     or src !~ 'bonus_requests\s*=\s*bonus_requests\s*\+\s*v_free' then
    raise exception 'B2 verify: +1/+2 free paid request mapping missing from open_mystery_box';
  end if;
  if position('grant_reward_event' in src) = 0 then
    raise exception 'B2 verify: vote prizes must go through grant_reward_event (cap 30)';
  end if;
end
$odds$;
