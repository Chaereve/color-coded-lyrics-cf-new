-- =============================================================================
-- ACHIEVEMENT CATALOG V3 — 52 active achievements, three reward families only
-- =============================================================================
-- Catalog v2 (20261128) trimmed the list to 20 milestones while the claim RPC
-- was being rewritten; the 25 retired v1 rows stayed in the table as
-- `active = false` history. The community asked for more than fifty goals,
-- so this migration:
--
--   1. RE-ACTIVATES the 25 retired v1 milestones (streak 3/14/60/180/365,
--      requests 3/100/250, completions 1/3/5/10/25/50/100, paid 25/50,
--      votes 25/500/1000, leaderboard 1/2/3/5/10) with amounts tuned to the
--      v2 ledger economy (vote bonuses flow through grant_reward_event and
--      the daily cap; free paid requests stay one-time grants).
--   2. ADDS 7 new aspirational tiers: streak500, request500, votesCast2500,
--      completion200, paid100, top25, top50.
--
-- Rewards stay inside the APPROVED THREE FAMILIES — bonus votes, free paid
-- requests, badge/title only. No new source, no new reward column, and NO
-- change to claim_achievements(): the 20261128 RPC already walks every
-- active row (`for d in select ... where active`), so catalog growth alone
-- lights the new badges up. Re-run is safe: on conflict the upsert just
-- rewrites the same values, and users who already own a badge keep their
-- original achievement_rewards row (on conflict do nothing in the RPC).
begin;

-- 1. Re-activate the 25 retired v1 milestones (tuned amounts) + 7 new tiers.
insert into public.achievement_definitions
  (id, source, threshold, bonus_votes, bonus_requests, badge, active)
values
  -- streak — 9 rungs: 3 / 7 / 14 / 30 / 60 / 100 / 180 / 365 / 500 days
  ('streak3',       'streak',      3,   1, 0, 'streak3',       true),
  ('streak14',      'streak',     14,   8, 0, 'streak14',      true),
  ('streak60',      'streak',     60,  15, 0, 'streak60',      true),
  ('streak180',     'streak',    180,  30, 0, 'streak180',     true),
  ('streak365',     'streak',    365,  50, 0, 'streak365',     true),
  ('streak500',     'streak',    500,  75, 0, 'streak500',     true),
  -- requests — 9 rungs: 1 / 3 / 5 / 10 / 25 / 50 / 100 / 250 / 500 works
  ('request3',      'requests',    3,   2, 0, 'request3',      true),
  ('request100',    'requests',  100,  15, 0, 'request100',    true),
  ('request250',    'requests',  250,  25, 0, 'request250',    true),
  ('request500',    'requests',  500,  40, 0, 'request500',    true),
  -- votes cast — 9 rungs: 1 / 10 / 25 / 50 / 100 / 250 / 500 / 1000 / 2500
  ('votesCast25',   'votes',      25,   3, 0, 'votesCast25',   true),
  ('votesCast500',  'votes',     500,  15, 0, 'votesCast500',  true),
  ('votesCast1000', 'votes',    1000,  25, 0, 'votesCast1000', true),
  ('votesCast2500', 'votes',    2500,  40, 0, 'votesCast2500', true),
  -- completions — 8 rungs: 1 / 3 / 5 / 10 / 25 / 50 / 100 / 200 works
  ('firstCompletion','completed',  1,   0, 1, 'firstCompletion', true),
  ('completion3',   'completed',   3,   3, 0, 'completion3',   true),
  ('completion5',   'completed',   5,   0, 1, 'completion5',   true),
  ('completion10',  'completed',  10,   8, 0, 'completion10',  true),
  ('completion25',  'completed',  25,   0, 2, 'completion25',  true),
  ('completion50',  'completed',  50,  20, 0, 'completion50',  true),
  ('completion100', 'completed', 100,   0, 3, 'completion100', true),
  ('completion200', 'completed', 200,  30, 0, 'completion200', true),
  -- paid requests — 7 rungs: 1 / 3 / 5 / 10 / 25 / 50 / 100
  ('paid25',        'paid',       25,   0, 5, 'paid25',        true),
  ('paid50',        'paid',       50,   0, 6, 'paid50',        true),
  ('paid100',       'paid',      100,   0, 8, 'paid100',       true),
  -- leaderboard — 7 rungs: champion / runner-up / podium / top5 / 10 / 25 / 50
  ('top10',         'leaderboard',10,  10, 0, 'top10',         true),
  ('top5',          'leaderboard', 5,  20, 0, 'top5',          true),
  ('top25',         'leaderboard',25,   5, 0, 'top25',         true),
  ('top50',         'leaderboard',50,   3, 0, 'top50',         true),
  ('podium',        'leaderboard', 3,   0, 1, 'podium',        true),
  ('runnerUp',      'leaderboard', 2,  30, 0, 'runnerUp',      true),
  ('champion',      'leaderboard', 1,   0, 3, 'champion',      true)
on conflict (id) do update set
  source = excluded.source,
  threshold = excluded.threshold,
  bonus_votes = excluded.bonus_votes,
  bonus_requests = excluded.bonus_requests,
  badge = excluded.badge,
  active = true;

-- 2. Fail-closed catalog guard: exactly 52 active milestones across 7 groups.
do $catalog_v3_guard$
declare v_active int; v_groups int; v_owned int;
begin
  select count(*)::int into v_active
    from public.achievement_definitions where active;
  -- Bảy nhóm duyệt: requests, votes, paid, completed, streak, leaderboard,
  -- special — ba nguồn pick/vote_back/mystery là MỘT nhóm, không phải ba
  -- (đúng quy ước guard của 20261128).
  select count(distinct case when source in ('pick','vote_back','mystery')
                             then 'special' else source end)::int into v_groups
    from public.achievement_definitions where active;
  select count(*)::int into v_owned
    from public.achievement_definitions
   where active
     and id in ('streak3','streak7','streak14','streak30','streak60','streak100',
                'streak180','streak365','streak500',
                'firstRequest','request3','request5','request10','request25',
                'request50','request100','request250','request500',
                'votesCast1','votesCast10','votesCast25','votesCast50','votesCast100',
                'votesCast250','votesCast500','votesCast1000','votesCast2500',
                'firstCompletion','completion3','completion5','completion10','completion25',
                'completion50','completion100','completion200',
                'firstPaidRequest','paid3','paid5','paid10','paid25','paid50','paid100',
                'top50','top25','top10','top5','podium','runnerUp','champion',
                'firstPick','firstVoteBack','firstMystery');
  if v_active is distinct from 52 or v_groups is distinct from 7 or v_owned is distinct from 52 then
    raise exception 'err.achievementCatalog: active catalog must be exactly 52 milestones in 7 groups, got % active in % groups', v_active, v_groups;
  end if;
end
$catalog_v3_guard$;

comment on function public.claim_achievements() is
  'Catalog v3: walks every ACTIVE achievement_definitions row (52 milestones: '
  'streak/requests/completed/paid/votes/leaderboard/pick/vote_back/mystery). '
  'One row per user per achievement; vote bonuses go through grant_reward_event '
  '(ledger + daily cap + retry top-up); bonus_requests are one-time grants.';

notify pgrst, 'reload schema';
commit;
