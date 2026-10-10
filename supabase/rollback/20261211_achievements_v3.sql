-- Corrective rollback for 20261211_achievements_v3. Apply only after
-- approval.
--
-- Restores the live catalog to the exact pre-v3 state of 20261128: the 25
-- re-activated v1 milestones and the 7 new tiers go back to `active = false`,
-- leaving the 20 catalog-v2 rows as the only active definitions. Badges users
-- already earned stay in achievement_rewards (deactivating a definition never
-- deletes history), and ledger rows the v2 claim wrote stay exactly where
-- they are (no claw-back). Refuses to run twice.
begin;

do $preflight$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'err.rewardRollback: guarded-runner migration history is missing';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20261211_achievements_v3') then
    raise exception 'err.rewardRollback: 20261211 is not recorded as applied';
  end if;
end
$preflight$;

-- 1. The 7 tiers minted by v3 go back to inactive.
update public.achievement_definitions
   set active = false
 where id in ('streak500','request500','votesCast2500','completion200',
              'paid100','top25','top50');

-- 2. The 25 v1 milestones re-activated by v3 go back to inactive.
update public.achievement_definitions
   set active = false
 where id in ('streak3','streak14','streak60','streak180','streak365',
              'request3','request100','request250',
              'firstCompletion','completion3','completion5','completion10',
              'completion25','completion50','completion100',
              'paid25','paid50',
              'votesCast25','votesCast500','votesCast1000',
              'top10','top5','podium','runnerUp','champion');

-- 3. Fail-closed guard: the catalog-v2 shape is back (20 active, 5 groups).
do $rollback_guard$
declare v_active int; v_groups int;
begin
  select count(*)::int into v_active
    from public.achievement_definitions where active;
  -- Cùng quy ước gộp nhóm với guard 20261128: ba nguồn đặc biệt = một nhóm.
  select count(distinct case when source in ('pick','vote_back','mystery')
                             then 'special' else source end)::int into v_groups
    from public.achievement_definitions where active;
  if v_active is distinct from 20 or v_groups is distinct from 5 then
    raise exception 'err.achievementCatalog: rollback expects the 20-row catalog-v2 shape, got % active in % groups', v_active, v_groups;
  end if;
end
$rollback_guard$;

notify pgrst, 'reload schema';
commit;
