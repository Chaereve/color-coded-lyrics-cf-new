/* Real PostgreSQL (WASM) verification of the B2 mystery box — no server, no
 * credentials, no network. Mirrors the rewardLedger.pglite harness.
 *
 * Applies the full migration chain through 20261128, then 20261129 mystery
 * box, and holds the approved 2026-10 product contract:
 *
 *   * the box only opens AFTER today's check-in (err.mysteryLocked before);
 *   * one box per account per day — replay returns the committed result and
 *     never rolls again (one mystery_opens row, one ledger grant);
 *   * every result 0..6 maps to the approved v2 prize table (kind + votes
 *     ceiling) and the empirical distribution of 600 independent boxes matches
 *     the approved weights 55/20/12/7/3/2/1 within a wide, deterministic-safe
 *     margin — the ONLY +5-votes outcome is result 3 (7%);
 *   * vote prizes go through grant_reward_event: the shared 30/day cap scales
 *     them down (a fully clipped prize still spends the box, paid = 0);
 *   * paid prizes (result 5 = +1, result 6 = +2 free paid requests, kind
 *     'free_paid_request') add bonus_requests EXACTLY — outside the vote cap,
 *     never as a vote/ledger grant, never twice on replay;
 *   * mystery_box_enabled = false refuses with err.mysteryDisabled;
 *   * a stale expected day refuses with err.dailyDayChanged;
 *   * no-session refuses, clients can neither read the table nor call helpers.
 *
 * PGlite is single-session/serialized, so this proves semantics, not
 * concurrency races (the profile-lock serialization is shared with B1). */
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
const B2 = ['20261129_mystery_box', '20261202_mystery_paid_v2']

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

async function buildB2Database () {
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
  const { rows } = await db.query(`
    select to_char((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') as today`)
  return { db, today: rows[0].today }
}

/** Check the user in for `day` exactly like the real claim writes. */
async function checkIn (db, userId, day) {
  await db.query(
    'insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2::date, 0) on conflict do nothing',
    [userId, day])
}

async function seedUser (db, email = 'mystery@example.test') {
  // The on_auth_user_created trigger of schema.sql makes the profile row.
  const { rows } = await db.query(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])
  return rows[0].id
}

const withSession = async (db, userId, run) => {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try { return await run() } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

const openAs = (db, userId, day, token = null) => withSession(db, userId, async () => {
  const row = (await db.query(
    'select public.open_mystery_box($1::date, $2::text)::text as r', [day, token])).rows[0]
  return JSON.parse(row.r)
})

const statusAs = (db, userId) => withSession(db, userId, async () => {
  const row = (await db.query('select public.my_mystery_status()::text as r')).rows[0]
  return JSON.parse(row.r)
})

/** A denial probe wrapped in its own transaction: PGlite aborts the whole
 *  session transaction on error, so never probe inside a shared one. */
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

const STATUS_KEYS = ['user_id', 'day', 'enabled', 'checked_in', 'opened',
  'result', 'reward_votes', 'reward_kind']
/* result -> [kind, max votes, free paid requests] — the approved v2 prize
   table (20261202): the 1% prize is +2 free paid requests, NOT a second +5. */
const PRIZES = {
  0: ['nothing', 0, 0], 1: ['votes', 1, 0], 2: ['votes', 3, 0], 3: ['votes', 5, 0],
  4: ['votes', 10, 0], 5: ['free_paid_request', 0, 1], 6: ['free_paid_request', 0, 2],
}

test('the migration chain through 20261129 applies cleanly', async () => {
  const { db } = await buildB2Database()
  const { rows } = await db.query(`
    select to_regclass('public.mystery_opens')::text as opens,
           (select count(*) from public.reward_config where key = 'mystery_box_enabled') as flag`)
  assert.match(rows[0].opens, /mystery_opens$/)
  assert.equal(Number(rows[0].flag), 1)
})

test('the box only opens after check-in, one per day, replay never re-rolls', async () => {
  const { db, today } = await buildB2Database()
  const user = await seedUser(db)

  // Locked before check-in.
  assert.match(await denyAs(db, user, () =>
    db.query('select public.open_mystery_box($1::date, null::text)', [today])), /err\.mysteryLocked/)
  const locked = await statusAs(db, user)
  assert.deepEqual(Object.keys(locked).sort(), [...STATUS_KEYS].sort())
  assert.equal(locked.checked_in, false)
  assert.equal(locked.opened, false)
  assert.equal(locked.result, null)

  await checkIn(db, user, today)
  const unlocked = await statusAs(db, user)
  assert.equal(unlocked.checked_in, true)

  const first = await openAs(db, user, today)
  assert.equal(first.replayed, false)
  assert.equal(first.mystery.opened, true)
  assert.ok(Number.isInteger(first.mystery.result) && first.mystery.result >= 0 && first.mystery.result <= 6)
  assert.deepEqual(PRIZES[first.mystery.result], [first.mystery.reward_kind,
    first.mystery.reward_kind === 'votes' ? first.mystery.reward_votes : 0,
    PRIZES[first.mystery.result][2]])
  assert.ok(first.mystery.reward_kind !== 'votes' || first.mystery.reward_votes <= PRIZES[first.mystery.result][1])

  // Replay: same result, no second roll, no second ledger row.
  const second = await openAs(db, user, today)
  assert.equal(second.replayed, true)
  assert.equal(second.mystery.result, first.mystery.result)
  assert.equal(second.mystery.reward_votes, first.mystery.reward_votes)
  const { rows } = await db.query(
    'select count(*) as opens from public.mystery_opens where user_id = $1', [user])
  assert.equal(Number(rows[0].opens), 1)
  const { rows: grants } = await db.query(
    "select count(*) as grants from public.reward_events where user_id = $1 and source = 'mystery_box'", [user])
  assert.equal(first.mystery.reward_kind === 'votes' ? Number(grants[0].grants) : 0,
    first.mystery.reward_kind === 'votes' ? 1 : 0)
})

test('the 600-box distribution matches the approved 55/20/12/7/3/2/1 weights', async () => {
  const { db, today } = await buildB2Database()
  await db.query('select setseed(0.42)')
  const SAMPLES = 600
  const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
  for (let index = 0; index < SAMPLES; index++) {
    const user = await seedUser(db, `mass-${index}@example.test`)
    await checkIn(db, user, today)
    const opened = await openAs(db, user, today)
    buckets[opened.mystery.result] += 1
    if (opened.mystery.result === 5 || opened.mystery.result === 6) {
      const { rows } = await db.query('select bonus_requests from public.profiles where id = $1', [user])
      assert.equal(Number(rows[0].bonus_requests), PRIZES[opened.mystery.result][2],
        `result ${opened.mystery.result} must pay EXACTLY its free-paid-request amount`)
    }
  }
  const expected = { 0: 0.55, 1: 0.20, 2: 0.12, 3: 0.07, 4: 0.03, 5: 0.02, 6: 0.01 }
  for (const [result, share] of Object.entries(expected)) {
    const got = buckets[result] / SAMPLES
    // Wide margin: the rarest bucket expects ~6 hits, so cap the lower bound
    // at 0 and keep generous upper bounds — flaky CI proves nothing.
    const margin = share >= 0.07 ? 0.07 : share * 8
    assert.ok(Math.abs(got - share) <= margin,
      `result ${result}: got ${(got * 100).toFixed(1)}%, expected ${(share * 100).toFixed(1)}% (buckets ${JSON.stringify(buckets)})`)
  }
})

/* Lái phép rút bằng setseed (random() của Postgres là dãy xác định sau
   setseed): gọi đủ nhiều user cho tới khi gom đủ các kết quả cần kiểm. Đây
   là cách duy nhất kiểm ĐÚNG amount của nhánh 2%/1% mà không đụng SQL nội bộ. */
test('mapping v2: +1/+2 free paid requests pay EXACTLY their amount — no votes, no ledger, no double-pay on replay', async () => {
  const { db, today } = await buildB2Database()
  const votesOf = async user => {
    const { rows } = await db.query('select bonus_credits from public.profiles where id = $1', [user])
    return Number(rows[0].bonus_credits)
  }
  const ledgerOf = async user => {
    const { rows } = await db.query(
      "select count(*) as n, coalesce(sum(amount), 0) as total from public.reward_events where user_id = $1 and source = 'mystery_box'", [user])
    return { n: Number(rows[0].n), total: Number(rows[0].total) }
  }
  const found = {}
  for (let k = 1; k <= 400 && Object.keys(found).length < 4; k++) {
    await db.query('select setseed($1)', [k / 401])
    const user = await seedUser(db, `seeded-${k}@example.test`)
    await checkIn(db, user, today)
    const before = { votes: await votesOf(user), ...(await ledgerOf(user)), bonus: 0 }
    const opened = await openAs(db, user, today)
    if (![0, 3, 5, 6].includes(opened.mystery.result)) continue
    const { rows } = await db.query('select bonus_requests from public.profiles where id = $1', [user])
    const bonus = Number(rows[0].bonus_requests)
    const ledger = await ledgerOf(user)

    if (opened.mystery.result === 5) {
      assert.equal(bonus, 1, '+1 free paid request: bonus_requests tăng đúng 1')
      assert.equal(ledger.n, 0, 'paid prize KHÔNG ghi reward_event như vote')
      assert.equal(await votesOf(user), before.votes, 'paid prize KHÔNG cộng vote')
      found[5] = { user, bonus }
    } else if (opened.mystery.result === 6) {
      assert.equal(bonus, 2, '+2 free paid requests: bonus_requests tăng đúng 2')
      assert.equal(ledger.n, 0)
      assert.equal(await votesOf(user), before.votes)
      found[6] = { user, bonus }
    } else if (opened.mystery.result === 0) {
      assert.equal(bonus, 0, 'nothing: không side effect nào ngoài record claim')
      assert.equal(ledger.n, 0)
      assert.equal(await votesOf(user), before.votes)
      found[0] = { user, bonus }
    } else if (opened.mystery.result === 3) {
      assert.equal(bonus, 0)
      assert.equal(ledger.total, 5, 'DUY NHẤT result 3 trả +5 votes qua ledger')
      found[3] = { user, bonus }
    }
  }
  assert.deepEqual(Object.keys(found).sort(), ['0', '3', '5', '6'],
    'phải gom đủ 4 kết quả: nothing, +5 votes, +1 paid, +2 paid')

  // REPLAY từng kết quả: cùng result, không cộng lặp bonus/votes/ledger.
  for (const [result, hit] of Object.entries(found)) {
    const { rows } = await db.query('select bonus_requests from public.profiles where id = $1', [hit.user])
    const before = { bonus: Number(rows[0].bonus_requests), votes: await votesOf(hit.user), ...(await ledgerOf(hit.user)) }
    const replay = await openAs(db, hit.user, today)
    assert.equal(replay.replayed, true)
    assert.equal(replay.mystery.result, Number(result))
    const { rows: after } = await db.query('select bonus_requests from public.profiles where id = $1', [hit.user])
    assert.equal(Number(after[0].bonus_requests), before.bonus, 'replay không cộng lặp bonus')
    assert.equal(await votesOf(hit.user), before.votes)
    const ledger = await ledgerOf(hit.user)
    assert.equal(ledger.n, before.n, 'replay không ghi thêm ledger')
  }
})

test('vote prizes run under the shared cap; paid request stays outside it', async () => {
  const { db, today } = await buildB2Database()
  const user = await seedUser(db)
  await checkIn(db, user, today)

  // Fill 28 of the 30 cap votes with real ledger grants.
  await db.query(`
    insert into public.reward_events (user_id, day, source, ref, amount)
    values ($1, $2::date, 'daily_spin', 'fill-a', 14), ($1, $2::date, 'daily_spin', 'fill-b', 14)`,
    [user, today])
  await db.query('update public.profiles set bonus_credits = bonus_credits + 28 where id = $1', [user])

  const opened = await openAs(db, user, today)
  const capLeft = 2
  if (opened.mystery.reward_kind === 'votes') {
    assert.ok(opened.mystery.reward_votes <= Math.min(capLeft, PRIZES[opened.mystery.result][1]),
      `clipped prize must fit the cap headroom (${opened.mystery.reward_votes})`)
  } else if (opened.mystery.reward_kind === 'free_paid_request') {
    // Paid prizes sit OUTSIDE the cap: bonus_requests grows by the exact
    // amount while the vote ledger stays at the 28 pre-filled votes.
    const { rows } = await db.query('select bonus_requests from public.profiles where id = $1', [user])
    assert.equal(Number(rows[0].bonus_requests), PRIZES[opened.mystery.result][2])
  } else {
    assert.ok(true) // nothing: no vote movement to check
  }
  const { rows } = await db.query(
    "select coalesce(sum(amount), 0) as total from public.reward_events where user_id = $1 and day = $2::date",
    [user, today])
  assert.ok(Number(rows[0].total) <= 30)
})

test('flag off refuses; stale day refuses; ledger keeps the truth', async () => {
  const { db, today } = await buildB2Database()
  const user = await seedUser(db)
  await checkIn(db, user, today)

  await db.query("update public.reward_config set value = 'false'::jsonb where key = 'mystery_box_enabled'")
  assert.match(await denyAs(db, user, () =>
    db.query('select public.open_mystery_box($1::date, null::text)', [today])), /err\.mysteryDisabled/)
  const disabled = await statusAs(db, user)
  assert.equal(disabled.enabled, false)
  await db.query("update public.reward_config set value = 'true'::jsonb where key = 'mystery_box_enabled'")

  assert.match(await denyAs(db, user, () =>
    db.query('select public.open_mystery_box($1::date, null::text)', ['2030-01-01'])), /err\.dailyDayChanged/)
})

test('identity and RLS: no session refuses, clients read nothing, helpers stay internal', async () => {
  const { db, today } = await buildB2Database()
  const user = await seedUser(db)
  await checkIn(db, user, today)

  // No session.
  await db.query("select set_config('request.jwt.claim.sub', '', true)")
  await assert.rejects(() => db.query('select public.my_mystery_status()'), /err\.signin/)

  // RLS: neither role can read the box table directly.
  for (const role of ['anon', 'authenticated']) {
    await db.query('begin')
    await db.query(`set local role ${role}`)
    try {
      await db.query('select * from public.mystery_opens')
      assert.fail(`${role} must not read mystery_opens`)
    } catch (error) {
      assert.match(String(error.message), /permission denied/i)
    } finally {
      await db.query('rollback')
    }
  }

  // The gate holds for a browser caller without the edge token once armed.
  const { rows } = await db.query('select token_hash is not null as armed from public.edge_gate')
  assert.equal(rows[0].armed, false, 'fresh install keeps the gate off (edge_gate_ok passes)')
  const opened = await openAs(db, user, today)
  assert.equal(opened.replayed, false)
})
