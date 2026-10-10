-- Read-only checks after B3 (20261201_spin_v2). Fail closed. No writes.
\set ON_ERROR_STOP on

\echo === B3 history: spin_v2 in, vote_back still absent ===
select version from supabase_migrations.schema_migrations
 where version in ('20261201_spin_v2', '20261210_vote_back')
 order by version;

do $b3$
declare v_b3 int; v_b4 int;
begin
  select count(*) into v_b3 from supabase_migrations.schema_migrations
   where version = '20261201_spin_v2';
  if v_b3 <> 1 then
    raise exception 'B3 verify: expected 20261201_spin_v2 in history, got %', v_b3;
  end if;
  select count(*) into v_b4 from supabase_migrations.schema_migrations
   where version = '20261210_vote_back';
  if v_b4 <> 0 then
    raise exception 'B3 verify: B4 already in history — must stay held';
  end if;
end
$b3$;

\echo === prizes + weights 30/25/20/12/8/4/1 ===
select public.daily_spin_prizes() as prizes, public.daily_spin_weights() as weights;

do $tbl$
declare p int[]; w int[];
begin
  p := public.daily_spin_prizes();
  w := public.daily_spin_weights();
  if p is distinct from array[1,2,3,5,8,10,20] then
    raise exception 'B3 verify: prizes % not v2 [1,2,3,5,8,10,20]', p;
  end if;
  if w is distinct from array[30,25,20,12,8,4,1] then
    raise exception 'B3 verify: weights % not [30,25,20,12,8,4,1]', w;
  end if;
end
$tbl$;

\echo === spin_daily v2 draw + reward check 8/10/20 ===
do $fn$
declare src text;
begin
  src := pg_get_functiondef('public.spin_daily(text,uuid,uuid,text,text,text)'::regprocedure);
  if position('daily_spin_weights' in src) = 0
     or position('gen_random_bytes(2)' in src) = 0
     or src !~ 'v_block' then
    raise exception 'B3 verify: spin_daily is not the v2 weighted/no-repeat body';
  end if;
  if to_regprocedure('public.daily_spin_weights()') is null then
    raise exception 'B3 verify: daily_spin_weights() missing';
  end if;
  if not exists (
    select 1 from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'daily_spins'
       and con.conname = 'daily_spins_reward_check'
       and pg_get_constraintdef(con.oid) like '%8%'
       and pg_get_constraintdef(con.oid) like '%20%'
  ) then
    raise exception 'B3 verify: daily_spins_reward_check does not admit 8/10/20';
  end if;
end
$fn$;
