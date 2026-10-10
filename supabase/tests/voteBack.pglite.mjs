/* Real PostgreSQL (WASM) verification of B4 vote-back — no server, no
 * credentials, no network. Mirrors the mysteryBox.pglite harness.
 *
 * Applies the full chain through 20261204, then 20261210, and holds the
 * approved 2026-10 product contract:
 *
 *   * first NULL→NOT NULL on picked_at pays once (latch vote_back_paid_at);
 *   * rounding: voter n>=1 → greatest(1, floor(n/10)); owner → floor(total/10);
 *     owner who voted gets both ledger sources;
 *   * cap 50 / request (owner first, largest-remainder voters) is lost, not
 *     topped up; cap 30 / person / day is grant_reward_event, also lost;
 *   * unpick via admin_pick / admin_pick_group raises err.unpickLocked after
 *     the latch; a SQL unpick + re-pick still pays 0;
 *   * flag off still latches and writes no ledger;
 *   * cast_vote after pick raises err.voteLocked;
 *   * firstVoteBack achievement fires once even when owner+voter rows exist;
 *   * clients cannot execute pay_vote_back.
 *
 * PGlite is single-session/serialized, so "race 2 pick" is sequential
 * idempotency (two UPDATEs / two admin_pick / two pay_vote_back calls),
 * not a parallel race. */
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
const B2 = ['20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2',
  '20261203_mystery_month', '20261204_mystery_odds']
const B4 = '20261210_vote_back'

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

const LIVE_POLICY = [['free_vote_grant_enabled', false], ['free_votes_per_day', 3],
  ['global_daily_vote_cap_enabled', false], ['global_daily_vote_cap', 5]]

async function buildB4Database () {
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
  for (const version of [...CHAIN, ...B1, ...B2]) {
    await db.exec(read(`supabase/migrations/${version}.sql`))
    await record(version)
  }
  await db.exec(read(`supabase/migrations/${B4}.sql`))
  await record(B4)
  const { rows } = await db.query(`
    select to_char((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as today`)
  return { db, today: rows[0].today }
}

async function seedUser (db, email = `u${Math.random().toString(16).slice(2)}@t.test`) {
  const { rows } = await db.query(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])
  return rows[0].id
}

async function seedRequest (db, ownerId, { artist = 'A', title = 'T' } = {}) {
  const { rows } = await db.query(
    `insert into public.requests (user_id, artist, title, status, requester)
     values ($1, $2, $3, 'queued', 't') returning id`, [ownerId, artist, title])
  return rows[0].id
}

async function addVotes (db, requestId, userId, n) {
  await db.query(
    `insert into public.votes (request_id, user_id, used_credit, credit_kind)
     select $1, $2, true, 'purchased' from generate_series(1, $3)`,
    [requestId, userId, n])
  await db.query(
    'update public.requests set votes = votes + $2 where id = $1', [requestId, n])
}

const pick = (db, id) => db.query(
  'update public.requests set picked_at = clock_timestamp(), updated_at = clock_timestamp() where id = $1', [id])

const withSession = async (db, userId, run) => {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try { return await run() } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

const denyAs = async (db, userId, probe) => {
  await db.query('begin')
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  try {
    await probe()
    assert.fail('expected the probe to raise')
  } catch (error) {
    return String(error.message)
  } finally {
    await db.query('rollback')
  }
}

const walletOf = async (db, id) => (await db.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [id])).rows[0]

const eventsOf = async (db, id, requestId) => (await db.query(
  `select source, amount, ref, meta from public.reward_events
    where user_id = $1 and ref = $2 order by source`, [id, requestId])).rows

const latchOf = async (db, id) => (await db.query(
  'select vote_back_paid_at is not null as latched, picked_at is not null as picked from public.requests where id = $1',
  [id])).rows[0]

const grantAs = (db, uid, day, source, ref, amount) => db.query(
  'select public.grant_reward_event($1,$2::date,$3,$4,$5) as paid', [uid, day, source, ref, amount])

test('the chain through 20261210 applies cleanly and is rerunnable', async () => {
  const { db } = await buildB4Database()
  const { rows } = await db.query(`
    select to_regclass('public.requests')::text as req,
           (select count(*) from public.reward_config where key = 'vote_back_enabled') as flag,
           (select count(*) from pg_trigger where tgname = 'requests_vote_back_tri') as trig,
           (select count(*) from pg_indexes where indexname = 'votes_request_user_idx') as idx`)
  assert.equal(Number(rows[0].flag), 1)
  assert.equal(Number(rows[0].trig), 1)
  assert.equal(Number(rows[0].idx), 1)
  const col = (await db.query(`
    select count(*) as n from pg_attribute
     where attrelid = 'public.requests'::regclass and attname = 'vote_back_paid_at' and not attisdropped`)).rows[0]
  assert.equal(Number(col.n), 1)
  await db.exec(read(`supabase/migrations/${B4}.sql`))
  const exec = (await db.query(`
    select has_function_privilege('authenticated', 'public.pay_vote_back(uuid)', 'execute') as ok`)).rows[0]
  assert.equal(exec.ok, false)
})

test('rounding: voter 1/9/10/20, owner floor, owner-who-voted gets both, 0 votes latches', async () => {
  const { db } = await buildB4Database()
  const owner = await seedUser(db, 'owner@t.test')
  const voter = await seedUser(db, 'voter@t.test')

  const cases = [
    { title: 'n1', n: 1, voterPaid: 1, ownerPaid: 0 },
    { title: 'n9', n: 9, voterPaid: 1, ownerPaid: 0 },
    { title: 'n10', n: 10, voterPaid: 1, ownerPaid: 1 },
    { title: 'n20', n: 20, voterPaid: 2, ownerPaid: 2 },
  ]
  for (const c of cases) {
    const id = await seedRequest(db, owner, { title: c.title })
    await addVotes(db, id, voter, c.n)
    const beforeV = Number((await walletOf(db, voter)).bonus_credits)
    const beforeO = Number((await walletOf(db, owner)).bonus_credits)
    await pick(db, id)
    const latch = await latchOf(db, id)
    assert.equal(latch.latched, true, c.title)
    assert.equal(Number((await walletOf(db, voter)).bonus_credits), beforeV + c.voterPaid, c.title)
    assert.equal(Number((await walletOf(db, owner)).bonus_credits), beforeO + c.ownerPaid, c.title)
    const ve = await eventsOf(db, voter, id)
    assert.equal(ve.length, 1)
    assert.equal(ve[0].source, 'vote_back_voter')
    assert.equal(Number(ve[0].amount), c.voterPaid)
    const oe = await eventsOf(db, owner, id)
    if (c.ownerPaid > 0) {
      assert.equal(oe.length, 1)
      assert.equal(oe[0].source, 'vote_back_owner')
      assert.equal(Number(oe[0].amount), c.ownerPaid)
    } else {
      assert.equal(oe.length, 0)
    }
  }

  const selfId = await seedRequest(db, owner, { title: 'self' })
  await addVotes(db, selfId, owner, 20)
  const before = Number((await walletOf(db, owner)).bonus_credits)
  await pick(db, selfId)
  // owner_raw = 2, voter_raw = 2, both sources.
  assert.equal(Number((await walletOf(db, owner)).bonus_credits), before + 4)
  const both = await eventsOf(db, owner, selfId)
  assert.deepEqual(both.map(e => e.source).sort(), ['vote_back_owner', 'vote_back_voter'])
  assert.equal(Number(both.find(e => e.source === 'vote_back_owner').amount), 2)
  assert.equal(Number(both.find(e => e.source === 'vote_back_voter').amount), 2)

  const empty = await seedRequest(db, owner, { title: 'empty' })
  await pick(db, empty)
  assert.equal((await latchOf(db, empty)).latched, true)
  assert.equal((await eventsOf(db, owner, empty)).length, 0)
})

test('second pick / unpick+re-pick / replay grant pay 0; admin unpick raises', async () => {
  const { db } = await buildB4Database()
  const owner = await seedUser(db, 'o@t.test')
  const voter = await seedUser(db, 'v@t.test')
  const admin = await seedUser(db, 'admin@t.test')
  await db.query('update public.profiles set is_admin = true where id = $1', [admin])
  const id = await seedRequest(db, owner, { title: 'once' })
  await addVotes(db, id, voter, 10)
  await pick(db, id)
  const paid = Number((await walletOf(db, voter)).bonus_credits)
  assert.equal(paid, 1)

  await pick(db, id)
  await db.query('select public.pay_vote_back($1)', [id])
  assert.equal(Number((await walletOf(db, voter)).bonus_credits), paid)
  assert.equal((await eventsOf(db, voter, id)).length, 1)

  const unpick = await denyAs(db, admin, () =>
    db.query('select public.admin_pick($1, false)', [id]))
  assert.match(unpick, /err\.unpickLocked/)
  assert.equal((await latchOf(db, id)).picked, true)

  await db.query('update public.requests set picked_at = null where id = $1', [id])
  await pick(db, id)
  assert.equal(Number((await walletOf(db, voter)).bonus_credits), paid)
  assert.equal((await eventsOf(db, voter, id)).length, 1)

  const { today } = (await db.query(`
    select to_char((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as today`)).rows[0]
  const replay = (await grantAs(db, voter, today, 'vote_back_voter', id, 5)).rows[0]
  assert.equal(Number(replay.paid), 0)
  assert.equal(Number((await walletOf(db, voter)).bonus_credits), paid)
})

test('cap 50 / request clips and is lost; cap 30 / day clips owner', async () => {
  const { db, today } = await buildB4Database()
  const owner = await seedUser(db, 'capo@t.test')

  // 50 voters × 1 vote: owner_raw=5, voter_raw=50, sum=55 > 50
  // owner keeps 5, voters share 45 → 45 of 50 voters get 1.
  const id50 = await seedRequest(db, owner, { title: 'cap50' })
  const voters = []
  for (let i = 0; i < 50; i++) {
    const uid = await seedUser(db, `c50-${i}@t.test`)
    voters.push(uid)
    await addVotes(db, id50, uid, 1)
  }
  await pick(db, id50)
  const ownerEv = await eventsOf(db, owner, id50)
  assert.equal(ownerEv.length, 1)
  assert.equal(Number(ownerEv[0].amount), 5)
  const voterPaid = (await db.query(
    `select coalesce(sum(amount),0)::int as s, count(*)::int as n
       from public.reward_events
      where source = 'vote_back_voter' and ref = $1`, [id50])).rows[0]
  assert.equal(Number(voterPaid.s), 45)
  assert.equal(Number(voterPaid.n), 45)
  const totalPaid = (await db.query(
    `select coalesce(sum(amount),0)::int as s from public.reward_events
      where ref = $1 and source in ('vote_back_owner','vote_back_voter')`, [id50])).rows[0]
  assert.equal(Number(totalPaid.s), 50)

  // Cap 30: fill the owner's day, then pick a 20-vote request (owner_raw=2).
  const id30 = await seedRequest(db, owner, { title: 'cap30' })
  const v30 = await seedUser(db, 'v30@t.test')
  await addVotes(db, id30, v30, 20)
  const fill = (await grantAs(db, owner, today, 'daily_login', 'fill', 30)).rows[0]
  assert.equal(Number(fill.paid), 25) // already took 5 from cap50
  const before = Number((await walletOf(db, owner)).bonus_credits)
  const beforeV = Number((await walletOf(db, v30)).bonus_credits)
  await pick(db, id30)
  assert.equal(Number((await walletOf(db, owner)).bonus_credits), before, 'owner clipped to 0')
  assert.equal((await eventsOf(db, owner, id30)).length, 0)
  assert.equal(Number((await walletOf(db, v30)).bonus_credits), beforeV + 2)
  assert.equal((await latchOf(db, id30)).latched, true)
})

test('admin_pick, group pick, pick_top_request all pay; group unpick blocked', async () => {
  const { db } = await buildB4Database()
  const owner = await seedUser(db, 'go@t.test')
  const voter = await seedUser(db, 'gv@t.test')
  const admin = await seedUser(db, 'ga@t.test')
  await db.query('update public.profiles set is_admin = true where id = $1', [admin])

  const a = await seedRequest(db, owner, { artist: 'G', title: 'Song' })
  const b = await seedRequest(db, owner, { artist: 'G', title: 'Song' })
  await addVotes(db, a, voter, 10)
  await addVotes(db, b, voter, 10)
  await withSession(db, admin, () => db.query('select * from public.admin_pick_group($1, true)', [a]))
  assert.equal((await latchOf(db, a)).latched, true)
  assert.equal((await latchOf(db, b)).latched, true)
  assert.equal(Number((await eventsOf(db, voter, a))[0].amount), 1)
  assert.equal(Number((await eventsOf(db, voter, b))[0].amount), 1)
  const groupUnpick = await denyAs(db, admin, () =>
    db.query('select * from public.admin_pick_group($1, false)', [a]))
  assert.match(groupUnpick, /err\.unpickLocked/)

  const solo = await seedRequest(db, owner, { artist: 'S', title: 'Solo' })
  await addVotes(db, solo, voter, 10)
  const row = await withSession(db, admin, async () =>
    (await db.query('select * from public.admin_pick($1, true)', [solo])).rows[0])
  assert.ok(row.vote_back_paid_at)
  assert.equal(Number((await eventsOf(db, voter, solo))[0].amount), 1)

  const cron = await seedRequest(db, owner, { artist: 'C', title: 'Cron' })
  await addVotes(db, cron, voter, 10)
  await db.query('select * from public.pick_top_request(true)')
  assert.equal((await latchOf(db, cron)).latched, true)
  assert.equal(Number((await eventsOf(db, voter, cron))[0].amount), 1)
})

test('cast_vote after pick is locked; firstVoteBack grants once for owner+voter rows', async () => {
  const { db } = await buildB4Database()
  const owner = await seedUser(db, 'ach-o@t.test')
  const voter = await seedUser(db, 'ach-v@t.test')
  const id = await seedRequest(db, owner, { title: 'ach' })
  await addVotes(db, id, owner, 10)
  await addVotes(db, id, voter, 10)
  await pick(db, id)

  const locked = await denyAs(db, voter, () =>
    db.query('select * from public.cast_vote($1, -1)', [id]))
  assert.match(locked, /err\.voteLocked/)

  const claim = async uid => withSession(db, uid, async () =>
    JSON.parse((await db.query('select public.claim_achievements()::text as r')).rows[0].r))
  const first = await claim(owner)
  const vb = first.earned.find(e => e.id === 'firstVoteBack')
  assert.ok(vb, 'owner earns firstVoteBack')
  assert.equal(vb.newly_granted, true)
  assert.equal(Number(vb.votes_granted), 3)
  const slices = (await db.query(
    `select count(*)::int as n from public.reward_events
      where user_id = $1 and source = 'achievement' and ref like 'ach:firstVoteBack#%'`, [owner])).rows[0]
  assert.equal(Number(slices.n), 1)
  const second = await claim(owner)
  const vb2 = second.earned.find(e => e.id === 'firstVoteBack')
  assert.equal(Number(vb2?.votes_granted ?? 0), 0)
  assert.equal(Number((await db.query(
    `select count(*)::int as n from public.reward_events
      where user_id = $1 and source = 'achievement' and ref like 'ach:firstVoteBack#%'`, [owner])).rows[0].n), 1)

  const voterClaim = await claim(voter)
  const vvb = voterClaim.earned.find(e => e.id === 'firstVoteBack')
  assert.equal(vvb.newly_granted, true)
  assert.equal(Number(vvb.votes_granted), 3)
})

test('flag off still latches and never pays, including after the flag is turned back on', async () => {
  const { db } = await buildB4Database()
  await db.query(
    "update public.reward_config set value = 'false'::jsonb where key = 'vote_back_enabled'")
  const owner = await seedUser(db, 'off-o@t.test')
  const voter = await seedUser(db, 'off-v@t.test')
  const id = await seedRequest(db, owner, { title: 'off' })
  await addVotes(db, id, voter, 20)
  const before = Number((await walletOf(db, voter)).bonus_credits)
  await pick(db, id)
  assert.equal((await latchOf(db, id)).latched, true)
  assert.equal(Number((await walletOf(db, voter)).bonus_credits), before)
  assert.equal((await eventsOf(db, voter, id)).length, 0)

  await db.query(
    "update public.reward_config set value = 'true'::jsonb where key = 'vote_back_enabled'")
  await db.query('update public.requests set picked_at = null where id = $1', [id])
  await pick(db, id)
  assert.equal(Number((await walletOf(db, voter)).bonus_credits), before)
  assert.equal((await eventsOf(db, voter, id)).length, 0)
})
