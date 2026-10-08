/* Real PostgreSQL (WASM) verification of the B1 reward chain — no server, no
 * credentials, no network. Mirrors the dailyFreeVotes.pglite harness.
 *
 * Applies the full migration chain through 20261125, then the three B1 files
 * (20261126 reward ledger, 20261127 login rewards, 20261128 achievements v2)
 * and holds the approved 2026-10 product contract:
 *
 *   * a check-in pays +2; cycle day 7 pays +5 ON TOP plus the +10 completed-
 *     streak bonus (2+5+10 = 17); a missed day resets everything;
 *   * the 30-day bonus pays +20 exactly once per account, and a grant clipped
 *     by the daily cap RETRIES on a later check-in instead of being lost;
 *   * every grant is a reward_events row — idempotent at the key level, replay
 *     never pays twice, the wallet only ever moves with the ledger;
 *   * the 30-vote daily cap scales grants down (meta keeps the request), and
 *     the achievement claim pays through the same cap and tops up later;
 *   * the catalog is exactly 20 active achievements in the five approved
 *     groups, with the three new special sources wired to real signals;
 *   * login_rewards_enabled = false restores the old behavior (calendar only);
 *   * clients can neither read the ledger nor call the internal helpers.
 *
 * PGlite is single-session/serialized, so this proves semantics, not
 * concurrency races (same caveat as rewardAbuse.test.js). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = path => readFileSync(`${ROOT}${path}`, 'utf8')
const schema = read('supabase/schema.sql')
const coreSql = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
const LEVELS = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable']
const CHAIN = ['20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
  '20261123_reconcile_security_drift', '20261124_restore_daily_free_votes',
  '20261125_reward_eligibility_and_quota_races']
const B1 = ['20261126_reward_ledger', '20261127_login_streak_rewards', '20261128_achievements_v2']

const SCAFFOLD = `
  do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create publication supabase_realtime;`

/* The pre-20261124 live policy rows 20261124 copies forward (then flips on). */
const LIVE_POLICY = [['free_vote_grant_enabled', false], ['free_votes_per_day', 3],
  ['global_daily_vote_cap_enabled', false], ['global_daily_vote_cap', 5]]

async function buildB1Database () {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of LEVELS) await db.exec(read(`supabase/migrations/${name}.sql`))
  for (const [key, value] of LIVE_POLICY) {
    await db.query('update public.daily_quiz_config set value = $2::jsonb, updated_at = clock_timestamp() where key = $1',
      [key, JSON.stringify(value)])
  }
  await db.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text not null primary key, statements text[], name text);`)
  const record = async version => db.query(
    'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
    [version, [], `${version}.sql`])
  for (const version of LEVELS) await record(version)
  for (const version of [...CHAIN, ...B1]) {
    await db.exec(read(`supabase/migrations/${version}.sql`))
    await record(version)
  }
  const { rows } = await db.query(`
    select to_char((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as today,
           to_char(((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1), 'YYYY-MM-DD') as yesterday,
           to_char(((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 3), 'YYYY-MM-DD') as three_ago`)
  return { db, today: rows[0].today, yesterday: rows[0].yesterday, threeAgo: rows[0].three_ago }
}

/** VN-day consecutive backfill of check-in history, ending `untilDay`
 *  inclusive. Rows are reward = 0 exactly like the real claim writes. */
async function backfillCheckIns (db, userId, days) {
  for (const day of days) {
    await db.query(
      'insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2::date, 0)',
      [userId, day])
    await db.query(
      'insert into public.activity_days (user_id, day) values ($1, $2::date) on conflict do nothing',
      [userId, day])
  }
}

const daysBackFrom = (today, count) => {
  const list = []
  const cursor = new Date(`${today}T00:00:00Z`)
  for (let index = 0; index < count; index++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    list.push(cursor.toISOString().slice(0, 10))
  }
  return list.reverse()
}

async function seedUser (db, email = 'rewards@example.test') {
  const id = (await db.query(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id
  return id
}

/** Runs the claim RPC as the user (auth.uid() comes from the session claim). */
async function claimAs (db, userId, day) {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try {
    const row = (await db.query('select public.claim_daily_login_calendar($1::date)::text as r', [day])).rows[0]
    return JSON.parse(row.r)
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

async function rewardStatusAs (db, userId) {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try {
    return JSON.parse((await db.query('select public.my_login_reward_status()::text as r')).rows[0].r)
  } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

const walletOf = async (db, id) => (await db.query(
  'select vote_credits, bonus_credits, bonus_requests from public.profiles where id = $1', [id])).rows[0]
const eventsOf = async (db, id) => (await db.query(
  `select source, ref, amount, meta from public.reward_events
    where user_id = $1 order by id`, [id])).rows
const notificationsOf = async (db, id) => (await db.query(
  `select kind, sig, reason from public.notifications
    where user_id = $1 order by id desc limit 3`, [id])).rows
const setConfigValue = async (db, key, value) => db.query(
  'update public.reward_config set value = $2::jsonb, updated_at = clock_timestamp() where key = $1',
  [key, JSON.stringify(value)])

test('B1 chain installs: the ledger, the claim rewards and the v2 catalog are all live', async () => {
  const { db } = await buildB1Database()
  const catalog = (await db.query(
    `select count(*)::int as active,
            count(distinct case when source in ('pick','vote_back','mystery') then 'special' else source end)::int as groups
       from public.achievement_definitions where active`)).rows[0]
  assert.deepEqual(catalog, { active: 20, groups: 5 })
  const special = (await db.query(
    `select id, source, threshold, bonus_votes from public.achievement_definitions
      where source in ('pick','vote_back','mystery') order by id`)).rows
  assert.deepEqual(special, [
    { id: 'firstMystery', source: 'mystery', threshold: 1, bonus_votes: 5 },
    { id: 'firstPick', source: 'pick', threshold: 1, bonus_votes: 2 },
    { id: 'firstVoteBack', source: 'vote_back', threshold: 1, bonus_votes: 3 },
  ])
  const retiredStillThere = (await db.query(
    `select count(*)::int as n from public.achievement_definitions where id = 'champion'`)).rows[0].n
  assert.equal(retiredStillThere, 1, 'retired catalog rows are deactivated, never deleted')
  await db.close()
})

test('check-in ladder: day 7 pays 2 + 5 + 10 = 17 votes, replays pay nothing', async () => {
  const { db, today, yesterday } = await buildB1Database()
  const user = await seedUser(db)
  await backfillCheckIns(db, user, daysBackFrom(today, 6).concat()) // six days ending yesterday
  const before = await walletOf(db, user)
  const claim = await claimAs(db, user, today)
  assert.equal(claim.replayed, false)
  const slices = Object.fromEntries(claim.rewards.breakdown.map(s => [s.source, s.amount]))
  assert.deepEqual(slices, { daily_login: 2, login_day7: 5, login_milestone7: 10 })
  assert.equal(claim.rewards.today_total, 17)
  assert.equal(claim.rewards.streak, 7)
  assert.equal(claim.rewards.cycle_day, 7)
  assert.equal(claim.rewards.cap, 30)
  assert.equal(claim.rewards.cap_used, 17)
  assert.equal(claim.rewards.cap_left, 13)
  const wallet = await walletOf(db, user)
  assert.equal(wallet.bonus_credits - before.bonus_credits, 17)
  const events = await eventsOf(db, user)
  assert.deepEqual(events.map(e => [e.source, e.ref, e.amount]), [
    ['daily_login', today, 2],
    ['login_day7', today, 5],
    ['login_milestone7', today, 10],
  ])
  const notifications = await notificationsOf(db, user)
  assert.equal(notifications[0].kind, 'votes')
  assert.equal(notifications[0].sig, `login-reward|${today}`)
  assert.match(notifications[0].reason, /\+17 bonus votes/)

  // Replay the same day: no new ledger rows, no wallet movement.
  const again = await claimAs(db, user, today)
  assert.equal(again.replayed, true)
  assert.equal(again.rewards.today_total, 17)
  assert.equal((await eventsOf(db, user)).length, 3)
  assert.deepEqual(await walletOf(db, user), wallet)
  void yesterday
  await db.close()
})

test('a missed day resets the streak: the next check-in pays only +2', async () => {
  const { db, today, threeAgo } = await buildB1Database()
  const user = await seedUser(db)
  // Three consecutive days ending three days ago — yesterday is missing.
  await backfillCheckIns(db, user, daysBackFrom(threeAgo, 3))
  const claim = await claimAs(db, user, today)
  assert.equal(claim.rewards.streak, 1)
  assert.deepEqual(claim.rewards.breakdown, [{ source: 'daily_login', amount: 2 }])
  assert.equal(claim.rewards.cycle_day, 1)
  await db.close()
})

test('the 30-day milestone pays +20 once, additive to the +2 of that day', async () => {
  const { db, today } = await buildB1Database()
  const user = await seedUser(db)
  await backfillCheckIns(db, user, daysBackFrom(today, 29))
  const claim = await claimAs(db, user, today)
  assert.equal(claim.rewards.streak, 30)
  assert.equal(claim.rewards.cycle_day, 2)
  assert.deepEqual(claim.rewards.breakdown.map(s => [s.source, s.amount]),
    [['daily_login', 2], ['login_milestone30', 20]])
  assert.equal(claim.rewards.today_total, 22)
  const once = (await db.query(
    "select granted_day::text as day from public.reward_milestone_once where user_id = $1 and milestone = 'login_30'",
    [user])).rows
  assert.equal(once.length, 1)
  // Status agrees with the claim: same view, same totals.
  const view = await rewardStatusAs(db, user)
  assert.equal(view.milestone30_granted, true)
  assert.equal(view.today_total, 22)
  await db.close()
})

test('the daily cap scales grants down and records the request in meta', async () => {
  const { db, today } = await buildB1Database()
  const user = await seedUser(db)
  await backfillCheckIns(db, user, daysBackFrom(today, 6))
  await setConfigValue(db, 'daily_reward_cap', 4)
  const claim = await claimAs(db, user, today)
  assert.equal(claim.rewards.today_total, 4)
  assert.deepEqual(claim.rewards.breakdown.map(s => [s.source, s.amount]),
    [['daily_login', 2], ['login_day7', 2]])
  const events = await eventsOf(db, user)
  const clipped = events.find(e => e.source === 'login_day7')
  assert.equal(clipped.meta.requested, 5)
  assert.equal(clipped.meta.clipped, true)
  const milestone = events.find(e => e.source === 'login_milestone7')
  assert.equal(milestone, undefined, 'headroom 0 pays nothing for the streak bonus')
  assert.equal((await walletOf(db, user)).bonus_credits, 4)
  await db.close()
})

test('a capped 30-day bonus retries on later check-ins until it is fully paid', async () => {
  const { db, today } = await buildB1Database()
  const user = await seedUser(db)
  await backfillCheckIns(db, user, daysBackFrom(today, 29))
  await setConfigValue(db, 'daily_reward_cap', 10)
  const first = await claimAs(db, user, today)
  assert.deepEqual(first.rewards.breakdown.map(s => [s.source, s.amount]),
    [['daily_login', 2], ['login_milestone30', 8]])
  // Partial payment does NOT lock the milestone in.
  assert.equal((await db.query(
    "select count(*)::int as n from public.reward_milestone_once where user_id = $1", [user])).rows[0].n, 0)

  // Owner restores the cap. Same day is already claimed, so the retry happens
  // through a test-only repair (remove today's check-in row and its
  // daily_login slice — the ledger keeps the 8-vote milestone slice, which is
  // exactly the memory the retry logic reads) and a fresh claim.
  await setConfigValue(db, 'daily_reward_cap', 30)
  await db.query("delete from public.reward_events where user_id = $1 and source = 'daily_login'", [user])
  await db.query('delete from public.daily_login_rewards where user_id = $1 and reward_day = $2::date', [user, today])
  const second = await claimAs(db, user, today)
  // The breakdown lists every slice of the day ordered by the ledger: the
  // first claim's clipped milestone slice (8), the fresh check-in (2) and the
  // retry's remaining 12. 8 + 12 = the full 20-vote bonus.
  assert.deepEqual(second.rewards.breakdown.map(s => [s.source, s.amount]),
    [['login_milestone30', 8], ['daily_login', 2], ['login_milestone30', 12]])
  assert.equal(second.rewards.today_total, 22)
  const paidTotal = (await db.query(
    `select coalesce(sum(amount), 0)::int as n from public.reward_events
      where user_id = $1 and source = 'login_milestone30'`, [user])).rows[0].n
  assert.equal(paidTotal, 20)
  assert.equal((await db.query(
    "select count(*)::int as n from public.reward_milestone_once where user_id = $1", [user])).rows[0].n, 1)
  await db.close()
})

test('login_rewards_enabled = false restores the calendar-only behavior', async () => {
  const { db, today } = await buildB1Database()
  const user = await seedUser(db)
  await setConfigValue(db, 'login_rewards_enabled', false)
  const before = await walletOf(db, user)
  const claim = await claimAs(db, user, today)
  assert.equal(claim.replayed, false)
  assert.equal(claim.status.login.claimed, true, 'the check-in itself still records')
  assert.deepEqual(claim.rewards.breakdown, [])
  assert.equal(claim.rewards.enabled, false)
  assert.equal((await eventsOf(db, user)).length, 0)
  assert.deepEqual(await walletOf(db, user), before)
  await db.close()
})

test('the achievement claim pays through the ledger: capped now, topped up later', async () => {
  const { db, today } = await buildB1Database()
  const user = await seedUser(db)
  await db.query(
    `insert into public.requests (id, user_id, artist, title, status, picked_at)
     values (gen_random_uuid(), $1, 'A', 'B', 'queued', now())`, [user])
  const claimAsUser = async () => {
    const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    try {
      return JSON.parse((await db.query('select public.claim_achievements()::text as r')).rows[0].r)
    } finally {
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
    }
  }
  await setConfigValue(db, 'daily_reward_cap', 1)
  const first = await claimAsUser()
  const pick = first.earned.find(item => item.id === 'firstPick')
  assert.ok(pick, 'firstPick is earned by the picked request')
  assert.equal(pick.newly_granted, true)
  assert.equal(pick.votes_granted, 1, 'the 2-vote bonus is clipped to the 1-vote headroom')
  const clipped = (await eventsOf(db, user)).find(e => e.ref === 'ach:firstPick#1')
  assert.equal(clipped.meta.requested, 2)
  assert.equal(clipped.meta.clipped, true)

  // Cap restored: the next claim tops the same achievement up to its full 2.
  await setConfigValue(db, 'daily_reward_cap', 30)
  const second = await claimAsUser()
  const topUp = second.earned.find(item => item.id === 'firstPick')
  assert.equal(topUp.newly_granted, false, 'the badge is not re-granted')
  assert.equal(topUp.votes_granted, 1, 'only the missing vote is paid')
  const paid = (await db.query(
    `select coalesce(sum(amount), 0)::int as n from public.reward_events
      where user_id = $1 and source = 'achievement' and ref like 'ach:firstPick#%'`, [user])).rows[0].n
  assert.equal(paid, 2)
  const slices = (await db.query(
    `select ref from public.reward_events
      where user_id = $1 and source = 'achievement' order by id`, [user])).rows.map(r => r.ref)
  // The one request also earns firstRequest, with its own slice family.
  assert.deepEqual(slices, ['ach:firstPick#1', 'ach:firstPick#2', 'ach:firstRequest#1'])
  assert.equal((await walletOf(db, user)).bonus_credits, 3)
  void today
  await db.close()
})

test('clients can neither read the ledger nor call the internal helpers', async () => {
  const { db } = await buildB1Database()
  // Each attempt runs in its own short transaction: a denied statement aborts
  // it, and the next attempt needs a clean session.
  const expectDenied = async sql => {
    await db.exec('begin')
    await db.exec('set local role authenticated')
    await assert.rejects(() => db.exec(sql), /permission denied/)
    await db.exec('rollback')
  }
  await expectDenied('select * from public.reward_events')
  await expectDenied('select * from public.reward_config')
  await expectDenied("select public.grant_reward_event(gen_random_uuid(), current_date, 'daily_login', 'x', 2)")
  await expectDenied('select * from public.reward_milestone_once')
  // The owner-scoped status RPC IS reachable for authenticated.
  await db.exec('begin')
  await db.exec('set local role authenticated')
  await assert.rejects(() => db.exec('select public.my_login_reward_status()'), /err\.signin/,
    'no session claim -> owner check refuses, which proves the RPC itself is granted')
  await db.exec('rollback')
  await db.close()
})
