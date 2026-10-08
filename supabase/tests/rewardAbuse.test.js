/* Batch 1 reward/quota regression fixtures.
   The default SQL integration uses PGlite only (no network, credentials, or
   persistent database). PGlite is single-session/serialized, so it verifies
   quota semantics but is NOT presented as proof of a concurrent race. The
   separate PostgreSQL test is explicitly opt-in and creates/drops a throwaway
   database; never point its URL at production. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { withDatabase, installLevel, migrationSql } from './_fixtures.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = path => readFileSync(`${ROOT}/${path}`, 'utf8')
const schema = read('supabase/schema.sql')
const migration = read('supabase/migrations/20261125_reward_eligibility_and_quota_races.sql')
const ID = '20261125_reward_eligibility_and_quota_races'

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

async function fixture (fn, { existingRequestIdIndex = false } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  try {
    await db.exec('create schema extensions;')
    await db.exec(SCAFFOLD)
    await db.exec(schema)
    if (existingRequestIdIndex) {
      await db.exec(`create index orders_existing_request_id_idx
        on public.orders using btree (request_id) where request_id is not null`)
    }
    const before = await db.query(`
      select p.oid::text as oid
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('claim_achievements', 'create_request', 'settle_season_rewards')
       order by p.proname`)
    const viewBefore = await db.query(`
      select attname, atttypid::regtype::text as type
        from pg_attribute
       where attrelid = 'public.requester_ranking'::regclass and attnum > 0 and not attisdropped
       order by attnum`)
    const catalogBefore = await db.query('select id from public.achievement_definitions order by id')

    await db.exec(migration)

    const after = await db.query(`
      select p.oid::text as oid
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('claim_achievements', 'create_request', 'settle_season_rewards')
       order by p.proname`)
    assert.deepEqual(after.rows, before.rows, 'RPC overload count/identity remains unchanged')
    const viewAfter = await db.query(`
      select attname, atttypid::regtype::text as type
        from pg_attribute
       where attrelid = 'public.requester_ranking'::regclass and attnum > 0 and not attisdropped
       order by attnum`)
    assert.deepEqual(viewAfter.rows, viewBefore.rows, 'requester_ranking JSON/column shape stays unchanged')
    assert.deepEqual((await db.query('select id from public.achievement_definitions order by id')).rows,
      catalogBefore.rows, 'achievement catalog is unchanged')
    const index = await db.query(`
      select i.indisvalid as valid, am.amname as method, a.attname as first_column
        from pg_index i
        join pg_class ix on ix.oid = i.indexrelid
        join pg_am am on am.oid = ix.relam
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = 'public.orders'::regclass and a.attname = 'request_id'`)
    assert.ok(index.rows.some(row => row.valid && row.method === 'btree' && row.first_column === 'request_id'),
      'the EXISTS lookup has a usable request_id-leading btree index')
    await fn(db)
  } finally {
    await db.close()
  }
}

const addUser = async (db, name) => (await db.query(
  'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [`${name}@example.test`])).rows[0].id

const setUser = async (db, userId) => db.query(
  "select set_config('request.jwt.claim.sub', $1, false)", [userId])

async function addRequest (db, userId, values) {
  const row = (await db.query(`
    insert into public.requests
      (user_id, artist, title, status, votes, is_paid, payment_status, created_at, updated_at)
    values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()))
    returning id`, [userId, values.artist, values.title, values.status, values.votes ?? 0,
    values.is_paid ?? false, values.payment_status ?? 'none', values.created_at ?? null, values.updated_at ?? null])).rows[0]
  return row.id
}

async function addOrder (db, userId, requestId, status, kind = 'paid_request') {
  return db.query(`
    insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, request_id, status)
    values ($1, $4, 0, 0.75, 20000, $2, $3)`, [userId, requestId, status, kind])
}

const resultOf = async db => (await db.query('select public.claim_achievements() as result')).rows[0].result
const paidRequestCall = `select (public.create_request(
  'Color Coded Lyrics', $1::text, $2::text, '', '', true, false)).id::text as id`
const freeRequestCall = `select (public.create_request(
  'Color Coded Lyrics', $1::text, $2::text, '', '', false, false)).id::text as id`
const bonusRequestCall = `select (public.create_request(
  'Color Coded Lyrics', $1::text, $2::text, '', '', true, true)).id::text as id`

/* This structural check is deliberately separate from PGlite's single-session
   fixture: it verifies the profile row lock precedes both limit reads and that
   the request insert stays later in the same function body. */
test('create_request locks the profile before both quota counts and before insert', () => {
  const start = migration.indexOf('create or replace function public.create_request(')
  const end = migration.indexOf('end $$;', start)
  assert.ok(start >= 0 && end > start)
  const body = migration.slice(start, end)
  const lock = body.indexOf('from public.profiles where id = v_uid for update')
  const freeCount = body.indexOf('from public.requests')
  const pendingOrderCount = body.indexOf('from public.orders')
  const insert = body.indexOf('insert into public.requests')
  assert.ok(lock >= 0 && lock < freeCount && lock < pendingOrderCount && lock < insert,
    'the profile lock serializes count-and-insert for both quota branches')
  assert.match(body, /p_paid boolean default false,[\s\S]*p_use_bonus boolean default false/)
})

test('migration reuses an equivalent request_id index instead of adding a duplicate', async () => {
  await fixture(async db => {
    const indexes = await db.query(`
      select ix.relname as name
        from pg_index i
        join pg_class ix on ix.oid = i.indexrelid
        join pg_am am on am.oid = ix.relam
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = 'public.orders'::regclass
         and i.indisvalid and i.indisready and am.amname = 'btree'
         and a.attname = 'request_id'`)
    assert.deepEqual(indexes.rows, [{ name: 'orders_existing_request_id_idx' }])
  }, { existingRequestIdIndex: true })
})

test('reward migration preserves RPC/view/catalog shapes and uses settled paid orders only', async () => {
  await fixture(async db => {
    const owner = await addUser(db, 'owner')
    const other = await addUser(db, 'other')
    const cashQueued = await addRequest(db, owner, {
      artist: 'Example Artist', title: 'Song', status: 'queued', votes: 4,
      is_paid: true, payment_status: 'paid',
    })
    await addRequest(db, owner, {
      artist: ' example artist ', title: ' SONG ', status: 'completed', votes: 2,
    })
    const pending = await addRequest(db, owner, {
      artist: 'Unreviewed', title: 'Request', status: 'pending', votes: 1000,
      is_paid: true, payment_status: 'paid',
    })
    await addOrder(db, owner, cashQueued, 'awaiting')
    await addOrder(db, owner, pending, 'paid')

    const oldReward = await addRequest(db, other, {
      artist: 'Pending only', title: 'Not eligible', status: 'pending', votes: 2000,
    })
    await db.query('update public.profiles set bonus_credits = 7, bonus_requests = 2 where id = $1', [other])
    await db.query(`insert into public.achievement_rewards
      (user_id, achievement_id, bonus_votes, bonus_requests, badge)
      values ($1, 'firstRequest', 1, 0, 'firstRequest')`, [other])

    const view = (await db.query(
      'select total, completed, total_votes from public.requester_ranking where user_id = $1', [owner])).rows[0]
    assert.deepEqual(view, { total: 1, completed: 1, total_votes: 6 },
      'pending is ignored and normalized duplicate requests count as one work')

    await setUser(db, owner)
    const first = await resultOf(db)
    assert.deepEqual(Object.keys(first).sort(), ['bonus_credits', 'bonus_requests', 'credits', 'earned', 'purchased'],
      'claim_achievements response JSON shape is unchanged')
    const earned = new Map(first.earned.map(item => [item.id, item]))
    assert.equal(earned.get('firstRequest')?.progress, 1)
    assert.equal(earned.get('firstCompletion')?.progress, 1)
    assert.equal(earned.has('firstPaidRequest'), false,
      'awaiting paid_request order and a paid order for pending work do not qualify')
    assert.equal(earned.has('champion'), true,
      'pending high-vote rows cannot displace the only eligible user from the leaderboard')

    await db.query("update public.orders set status = 'paid' where request_id = $1", [cashQueued])
    const settled = await resultOf(db)
    const paidAward = settled.earned.find(item => item.id === 'firstPaidRequest')
    assert.equal(paidAward?.progress, 1, 'the matching settled paid_request order unlocks paid progress')
    assert.equal(paidAward?.newly_granted, true)
    const balanceAfterPaid = settled.bonus_credits
    const repeat = await resultOf(db)
    assert.equal(repeat.earned.find(item => item.id === 'firstPaidRequest')?.newly_granted, false,
      'achievement_rewards keeps its existing (user_id, achievement_id) idempotency key')
    assert.equal(repeat.bonus_credits, balanceAfterPaid, 'retry does not grant credits twice')

    await setUser(db, other)
    const oldBalance = (await db.query(
      'select bonus_credits, bonus_requests from public.profiles where id = $1', [other])).rows[0]
    const ineligible = await resultOf(db)
    assert.deepEqual(ineligible.earned, [], 'pending-only user earns no new achievement')
    assert.deepEqual((await db.query(
      'select bonus_credits, bonus_requests from public.profiles where id = $1', [other])).rows[0], oldBalance,
    'previous credits are not clawed back')
    assert.equal((await db.query(`select count(*)::int as n from public.achievement_rewards
      where user_id = $1 and achievement_id = 'firstRequest'`, [other])).rows[0].n, 1,
    'previously granted achievement rows are retained')
    assert.notEqual(oldReward, null)
  })
})

test('paid eligibility matrix: six server-side scenarios plus request/order subcases', async () => {
  await fixture(async db => {
    const scenarios = [
      {
        name: 'matching settled paid_request order qualifies',
        request: { status: 'completed', is_paid: true, payment_status: 'paid' },
        order: { status: 'paid' }, expected: true,
      },
      {
        name: 'awaiting order does not qualify',
        request: { status: 'queued', is_paid: true, payment_status: 'paid' },
        order: { status: 'awaiting' }, expected: false,
      },
      {
        name: 'rejected order does not qualify',
        request: { status: 'in_progress', is_paid: true, payment_status: 'paid' },
        order: { status: 'rejected' }, expected: false,
      },
      {
        name: 'settled votes order is not a paid_request order',
        request: { status: 'queued', is_paid: true, payment_status: 'paid' },
        order: { status: 'paid', kind: 'votes' }, expected: false,
      },
      {
        name: 'a matching settled order owned by another user does not qualify',
        request: { status: 'queued', is_paid: true, payment_status: 'paid' },
        order: { status: 'paid', owner: 'other' }, expected: false,
      },
      {
        name: 'paid-shaped request without a settled matching order does not qualify',
        request: { status: 'queued', is_paid: true, payment_status: 'paid' },
        order: null, expected: false,
        subcases: [
          { name: 'bonus-funded request has paid-shaped flags but no paid_request order', bonus: true },
          { name: 'is_paid false despite settled order', request: { is_paid: false, payment_status: 'none' }, order: { status: 'paid' } },
          { name: 'payment_status awaiting despite settled order', request: { is_paid: true, payment_status: 'awaiting' }, order: { status: 'paid' } },
          { name: 'settled order is attached to pending work', requestStatus: 'pending', request: { is_paid: true, payment_status: 'paid' }, order: { status: 'paid' } },
        ],
      },
    ]

    for (const [index, scenario] of scenarios.entries()) {
      const variants = scenario.subcases || [scenario]
      for (const [variantIndex, variant] of variants.entries()) {
        const name = `paid-case-${index}-${variantIndex}`
        const owner = await addUser(db, name)
        let request
        if (variant.bonus) {
          await db.query('update public.profiles set bonus_requests = 1 where id = $1', [owner])
          await setUser(db, owner)
          request = (await db.query(bonusRequestCall, [`Artist ${name}`, 'Song'])).rows[0].id
        } else {
          request = await addRequest(db, owner, {
            artist: `Artist ${name}`, title: 'Song',
            ...scenario.request, ...variant.request,
            status: variant.requestStatus || variant.request?.status || scenario.request.status,
          })
        }
        const order = variant.order === undefined ? scenario.order : variant.order
        if (order) {
          const orderOwner = order.owner === 'other' ? await addUser(db, `${name}-other`) : owner
          await addOrder(db, orderOwner, request, order.status, order.kind || 'paid_request')
        }

        await setUser(db, owner)
        const result = await resultOf(db)
        const paidAward = result.earned.find(item => item.id === 'firstPaidRequest')
        assert.equal(Boolean(paidAward), variant.expected ?? scenario.expected,
          `${scenario.name}${variant.name ? ` — ${variant.name}` : ''}`)
        if (variant.expected ?? scenario.expected) assert.equal(paidAward.progress, 1)
      }
    }
  })
})

test('create_request enforces free/paid limits and still creates the same paid order shape', async () => {
  await fixture(async db => {
    const freeUser = await addUser(db, 'free-quota')
    for (let i = 0; i < 3; i++) {
      await addRequest(db, freeUser, {
        artist: `Free ${i}`, title: 'Seed', status: 'pending', is_paid: false,
      })
    }
    await setUser(db, freeUser)
    await assert.rejects(() => db.query(freeRequestCall, ['Free', 'Fourth']), /err\.rateLimit/)

    const paidUser = await addUser(db, 'paid-quota')
    await db.query(`insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, status)
      select $1, 'paid_request', 0, 0.75, 20000, 'awaiting' from generate_series(1, 5)`, [paidUser])
    await setUser(db, paidUser)
    await assert.rejects(() => db.query(paidRequestCall, ['Paid', 'Sixth']), /err\.paidPending/)

    const fresh = await addUser(db, 'paid-success')
    await setUser(db, fresh)
    const requestId = (await db.query(paidRequestCall, ['Paid', 'Settled shape'])).rows[0].id
    const created = (await db.query(`
      select r.status as request_status, r.payment_status,
             o.kind, o.qty, o.amount_usd, o.amount_vnd, o.status as order_status,
             o.request_id::text as request_id
        from public.requests r join public.orders o on o.request_id = r.id
       where r.id = $1`, [requestId])).rows[0]
    assert.deepEqual(created, {
      request_status: 'pending', payment_status: 'awaiting', kind: 'paid_request',
      qty: 0, amount_usd: '0.75', amount_vnd: 20000, order_status: 'awaiting', request_id: requestId,
    })
  })
})

test('season payout excludes pending rows and gives duplicate songs one scoring slot', async () => {
  await fixture(async db => {
    const laterDuplicate = await addUser(db, 'later-duplicate')
    const earlySingle = await addUser(db, 'early-single')
    const spamPending = await addUser(db, 'pending-spam')
    await addRequest(db, laterDuplicate, {
      artist: 'Singer', title: 'Same Song', status: 'queued', votes: 0,
      created_at: '2025-09-24T12:00:00+07:00',
    })
    await addRequest(db, laterDuplicate, {
      artist: ' singer ', title: ' SAME SONG ', status: 'completed', votes: 0,
      created_at: '2025-09-25T12:00:00+07:00', updated_at: '2025-09-26T12:00:00+07:00',
    })
    await addRequest(db, earlySingle, {
      artist: 'Other Singer', title: 'Only Song', status: 'completed', votes: 0,
      created_at: '2025-09-23T12:00:00+07:00', updated_at: '2025-09-24T12:00:00+07:00',
    })
    await addRequest(db, spamPending, {
      artist: 'Pending', title: 'Spam', status: 'pending', votes: 50000,
      created_at: '2025-09-22T12:00:00+07:00',
    })

    await db.query(`select public.settle_season_rewards(
      'week', '2025-W39', '2025-09-22T00:00:00+07:00'::timestamptz,
      '2025-09-29T00:00:00+07:00'::timestamptz)`)
    const winners = await db.query(`
      select rank, user_id::text as user_id from public.season_rewards_log
       where season_type = 'week' and period_key = '2025-W39' order by rank`)
    assert.deepEqual(winners.rows, [
      { rank: 1, user_id: earlySingle },
      { rank: 2, user_id: laterDuplicate },
    ], 'without duplicate inflation, the earlier single work wins the tie-break')
    assert.ok(!winners.rows.some(row => row.user_id === spamPending),
      'pending-only high-vote requests are not paid out')
  })
})

/* True cross-session proof is opt-in: REWARD_ABUSE_RUN_CONCURRENCY_TEST=1 and
   REWARD_ABUSE_TEST_DATABASE_URL must name a disposable PostgreSQL cluster user
   with CREATEDB. _fixtures.mjs creates/drops an isolated database for each
   case; never point this URL at production. */
const concurrencyUrl = process.env.REWARD_ABUSE_RUN_CONCURRENCY_TEST === '1'
  ? process.env.REWARD_ABUSE_TEST_DATABASE_URL
  : null

async function withRewardRaceDatabase (fn) {
  await withDatabase(concurrencyUrl, async (pool, anchor) => {
    await installLevel(pool, 'fresh')
    await pool.query(migrationSql(ID))
    await fn(pool, anchor)
  })
}

async function beginRequestCall (client, userId, query, args) {
  await client.query('begin')
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  return client.query(query, args)
}

async function waitForCreateRequestLocks (anchor, expected) {
  const deadline = Date.now() + 10_000
  let waiting = 0
  while (Date.now() < deadline) {
    waiting = (await anchor.query(`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid()
         and wait_event_type = 'Lock' and position('create_request' in query) > 0`)).rows[0].n
    if (waiting >= expected) return waiting
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(waiting >= expected,
    `expected ${expected} independent sessions to wait at create_request; observed ${waiting}`)
  return waiting
}

async function settleRaceConnections (clients, pendingCalls, anchor, leaderOpen) {
  if (leaderOpen) await anchor.query('rollback').catch(() => {})
  await Promise.allSettled(pendingCalls)
  await Promise.all(clients.map(async client => {
    await client.query('rollback').catch(() => {})
    client.release()
  }))
}

test('real PostgreSQL race 1/4: free quota at the third-request boundary',
  { skip: !concurrencyUrl, timeout: 60_000 }, async () => {
    await withRewardRaceDatabase(async (pool, anchor) => {
      const userId = await addUser(pool, 'free-boundary-race')
      for (let i = 0; i < 2; i++) {
        await addRequest(pool, userId, { artist: `Existing ${i}`, title: 'Seed', status: 'pending' })
      }

      const clients = [await pool.connect(), await pool.connect()]
      const pendingCalls = []
      let leaderOpen = false
      try {
        await beginRequestCall(anchor, userId, freeRequestCall, ['Racing', 'Third'])
        leaderOpen = true
        pendingCalls.push(...clients.map(client =>
          beginRequestCall(client, userId, freeRequestCall, ['Racing', 'Third'])))
        await waitForCreateRequestLocks(anchor, clients.length)
        await anchor.query('commit')
        leaderOpen = false

        const outcomes = await Promise.allSettled(pendingCalls)
        assert.ok(outcomes.every(outcome => outcome.status === 'rejected'
          && /err\.rateLimit/.test(outcome.reason?.message ?? '')),
        'both waiting sessions recheck the committed third request and fail closed')
        const count = (await pool.query(`select count(*)::int as n from public.requests
          where user_id = $1 and is_paid = false`, [userId])).rows[0].n
        assert.equal(count, 3, 'the free hourly quota cannot be exceeded at the boundary')
      } finally {
        await settleRaceConnections(clients, pendingCalls, anchor, leaderOpen)
      }
    })
  })

test('real PostgreSQL race 2/4: four simultaneous free requests from an empty quota',
  { skip: !concurrencyUrl, timeout: 60_000 }, async () => {
    await withRewardRaceDatabase(async (pool, anchor) => {
      const userId = await addUser(pool, 'free-burst-race')
      const clients = await Promise.all(Array.from({ length: 3 }, () => pool.connect()))
      const pendingCalls = []
      let leaderOpen = false
      try {
        await beginRequestCall(anchor, userId, freeRequestCall, ['Burst', 'Simultaneous'])
        leaderOpen = true
        pendingCalls.push(...clients.map(client =>
          beginRequestCall(client, userId, freeRequestCall, ['Burst', 'Simultaneous'])))
        await waitForCreateRequestLocks(anchor, clients.length)
        await anchor.query('commit')
        leaderOpen = false

        const outcomes = await Promise.allSettled(pendingCalls)
        const successes = outcomes.filter(outcome => outcome.status === 'fulfilled')
        const rejected = outcomes.filter(outcome => outcome.status === 'rejected')
        assert.equal(successes.length, 2, 'only the second and third free requests are admitted')
        assert.equal(rejected.length, 1)
        assert.match(rejected[0].reason?.message ?? '', /err\.rateLimit/)
        for (let index = 0; index < outcomes.length; index++) {
          if (outcomes[index].status === 'fulfilled') await clients[index].query('commit')
          else await clients[index].query('rollback')
        }
        const count = (await pool.query(`select count(*)::int as n from public.requests
          where user_id = $1 and is_paid = false`, [userId])).rows[0].n
        assert.equal(count, 3, 'four simultaneous calls from zero produce exactly three free requests')
      } finally {
        await settleRaceConnections(clients, pendingCalls, anchor, leaderOpen)
      }
    })
  })

test('real PostgreSQL race 3/4: paid-request pending-order cap',
  { skip: !concurrencyUrl, timeout: 60_000 }, async () => {
    await withRewardRaceDatabase(async (pool, anchor) => {
      const userId = await addUser(pool, 'paid-cap-race')
      await pool.query(`insert into public.orders (user_id, kind, qty, amount_usd, amount_vnd, status)
        select $1, 'paid_request', 0, 0.75, 20000, 'awaiting' from generate_series(1, 4)`, [userId])

      const clients = [await pool.connect(), await pool.connect()]
      const pendingCalls = []
      let leaderOpen = false
      try {
        await beginRequestCall(anchor, userId, paidRequestCall, ['Paid race', 'Allowed fifth'])
        leaderOpen = true
        pendingCalls.push(...clients.map(client =>
          beginRequestCall(client, userId, paidRequestCall, ['Paid race', 'Over cap'])))
        await waitForCreateRequestLocks(anchor, clients.length)
        await anchor.query('commit')
        leaderOpen = false

        const outcomes = await Promise.allSettled(pendingCalls)
        assert.ok(outcomes.every(outcome => outcome.status === 'rejected'
          && /err\.paidPending/.test(outcome.reason?.message ?? '')),
        'both waiters observe the fifth awaiting order and reject')
        const count = (await pool.query(`select count(*)::int as n from public.orders
          where user_id = $1 and kind = 'paid_request' and status = 'awaiting'`, [userId])).rows[0].n
        assert.equal(count, 5, 'concurrent paid requests cannot exceed five awaiting orders')
      } finally {
        await settleRaceConnections(clients, pendingCalls, anchor, leaderOpen)
      }
    })
  })

test('real PostgreSQL race 4/4: one bonus request credit cannot be spent twice',
  { skip: !concurrencyUrl, timeout: 60_000 }, async () => {
    await withRewardRaceDatabase(async (pool, anchor) => {
      const userId = await addUser(pool, 'bonus-double-spend-race')
      await pool.query('update public.profiles set bonus_requests = 1 where id = $1', [userId])

      const clients = [await pool.connect()]
      const pendingCalls = []
      let leaderOpen = false
      try {
        await beginRequestCall(anchor, userId, bonusRequestCall, ['Bonus race', 'First spend'])
        leaderOpen = true
        pendingCalls.push(beginRequestCall(clients[0], userId, bonusRequestCall,
          ['Bonus race', 'Second spend']))
        await waitForCreateRequestLocks(anchor, clients.length)
        await anchor.query('commit')
        leaderOpen = false

        const [outcome] = await Promise.allSettled(pendingCalls)
        assert.equal(outcome.status, 'rejected')
        assert.match(outcome.reason?.message ?? '', /err\.noBonusRequest/)
        const balance = (await pool.query(
          'select bonus_requests from public.profiles where id = $1', [userId])).rows[0].bonus_requests
        const requests = (await pool.query(
          'select count(*)::int as n from public.requests where user_id = $1', [userId])).rows[0].n
        assert.equal(balance, 0, 'the single bonus credit is spent exactly once')
        assert.equal(requests, 1, 'the losing concurrent call creates no request')
        assert.equal((await pool.query('select count(*)::int as n from public.orders where user_id = $1', [userId])).rows[0].n,
          0, 'bonus-funded requests do not create a paid-order row')
      } finally {
        await settleRaceConnections(clients, pendingCalls, anchor, leaderOpen)
      }
    })
  })
