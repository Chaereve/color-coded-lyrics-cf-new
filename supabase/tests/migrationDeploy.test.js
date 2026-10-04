/* Optional REAL PostgreSQL tests for the migration deployment path.
   Only a LOCAL/TEST superuser with CREATEDB; every scenario builds a throwaway
   database from template0 and drops it. Never point
   MIGRATION_DEPLOY_TEST_DATABASE_URL at production.
   They prove the deployment-safety rule end to end: the recommended command
   never runs 20261118, so a historical reward = 2 stays 2.
   See docs/DB-MIGRATIONS.md. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { deploy, plan, readHistory, ensureHistory, collectMigrations } from '../../tools/migrate.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const core = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
const migrationSql = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8')
const archivedSql = name => readFileSync(new URL(`../migrations/archive/${name}.sql.superseded`, import.meta.url), 'utf8')
const BASE = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow']

async function withDatabase (fn) {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const name = `ccl_deploy_${randomUUID().replaceAll('-', '')}`
  let created = false
  try {
    await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
    created = true
    const target = new URL(url)
    target.pathname = `/${name}`
    const pool = new pg.Pool({ connectionString: target.toString(), max: 4 })
    // Track every connection this pool opens until its socket really closes.
    // `pool.end()` only drains what the pool still knows is checked out, and
    // the `drop database ... with (force)` below terminates whatever is left
    // attached — which is what made an in-flight query die with "terminating
    // connection due to administrator command". Registered before anything can
    // use the pool, so no connection can escape tracking.
    const ended = []
    pool.on('connect', client => ended.push(new Promise(resolve => client.once('end', resolve))))
    let failure = null
    let client = null
    let shutdown = null
    try {
      await pool.query(`
        do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
        do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
        do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
        create schema auth;
        create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
        grant usage on schema public, auth to anon, authenticated;
        alter default privileges in schema public grant all on tables to anon, authenticated;
        alter default privileges in schema public grant all on sequences to anon, authenticated;
        create publication supabase_realtime;`)
      client = new pg.Client({ connectionString: target.toString() })
      await client.connect()
      await fn(pool, client)
    } catch (error) {
      failure = error
    } finally {
      // Close the client and the pool cleanly, then wait for every tracked
      // connection to report that it actually ended — only then may the
      // database be force-dropped by the block below.
      const settled = await Promise.allSettled([client?.end(), pool.end(), ...ended])
      const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) shutdown = errors.map(error => error?.message ?? String(error)).join('; ')
    }
    // A shutdown failure is never swallowed: it fails the run outright, and a
    // test body that already failed still propagates its own error.
    if (failure) {
      if (shutdown) console.error(`test database ${name} did not shut down cleanly: ${shutdown}`)
      throw failure
    }
    if (shutdown) throw new Error(`test database ${name} did not shut down cleanly: ${shutdown}`)
  } finally {
    try { if (created) await admin.query(`drop database if exists ${name} with (force)`) } finally { await admin.end() }
  }
}

async function installBase (pool) {
  await pool.query(core)
  for (const name of BASE) await pool.query(migrationSql(name))
}

const rewardChecks = async pool => (await pool.query(`
  select (select count(*)::int from pg_constraint
            where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%reward%') as table_checks,
         (select count(*)::int from pg_trigger
            where tgrelid = 'public.daily_login_rewards'::regclass
              and tgname = 'daily_login_rewards_no_vote') as triggers`)).rows[0]

const rewardOf = async (pool, userId, day) => (await pool.query(
  'select reward from public.daily_login_rewards where user_id = $1 and reward_day = $2', [userId, day])).rows[0].reward

const walletOf = async (pool, userId) => (await pool.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [userId])).rows[0]

const dayOf = async pool => (await pool.query(
  `select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text as d,
          ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1)::text as y`)).rows[0]

/** A user with real check-in history written under the retired +2 policy. */
async function seedHistory (pool, { legacy }) {
  const id = randomUUID()
  await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.test`])
  await pool.query('update public.profiles set vote_credits = 7, bonus_credits = 4 where id = $1', [id])
  const { d, y } = await dayOf(pool)
  if (legacy) {
    await pool.query('insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [id, y])
    await pool.query('insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [id, d])
    const request = randomUUID()
    await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1, $2, 'A', 'B', 'queued')", [request, id])
    await pool.query('insert into public.votes (request_id, user_id, used_credit) values ($1, $2, true)', [request, id])
  }
  return id
}

const claimToday = async (client, uid, day) => {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [uid])
  return JSON.parse((await client.query('select public.claim_daily_login($1, $2)::text as v', [uid, day])).rows[0].v)
}

const recordHistory = async (client, ids) => {
  await ensureHistory(client)
  for (const version of ids) {
    await client.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict do nothing',
      [version, `${version}.sql`])
  }
}

test('the recommended deployment path never runs the destructive migration',
  { skip: !url, timeout: 180_000 }, async t => {
    const { active } = collectMigrations()

    await t.test('A — production that has never run 20261112-20261120 keeps its history', async () => {
      await withDatabase(async (pool, client) => {
        await installBase(pool)
        const legacy = await seedHistory(pool, { legacy: true })
        const { d, y } = await dayOf(pool)
        const before = await walletOf(pool, legacy)
        const votesBefore = (await pool.query('select count(*)::int as n from public.votes')).rows[0].n

        const result = await deploy(client, { baseline: '20261117' })

        assert.deepEqual(result.pending.map(({ id }) => id),
          ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'],
          '20261118 is quarantined: it is not a file the runner can execute')
        assert.equal(result.quarantinedNeverRuns.length, 1)
        // The declared baseline is written down, not executed: a second run of
        // the same command must be a no-op instead of replaying old migrations.
        const history = await readHistory(client)
        assert.ok(history.includes('20261119_preserve_legacy_daily_login_rewards'))
        assert.ok(history.includes('20261120_daily_login_reward_immutable'))
        assert.equal(history.filter(v => v.startsWith('20261118')).length, 0,
          'the quarantined migration is never recorded as executed by the runner')
        assert.equal(history.length, result.recordedBaseline.length + 2)
        const again = await deploy(client)
        assert.deepEqual(again.pending, [], 're-running the documented command changes nothing')
        assert.deepEqual(await readHistory(client), history)
        // The historical amounts survived the deployment.
        assert.equal(await rewardOf(pool, legacy, y), 2)
        assert.equal(await rewardOf(pool, legacy, d), 2)
        assert.equal((await pool.query('select count(*)::int as n from public.votes')).rows[0].n, votesBefore)
        assert.deepEqual(await walletOf(pool, legacy), before)
        const checks = await rewardChecks(pool)
        assert.equal(checks.table_checks, 0, 'no table-wide CHECK was installed')
        assert.equal(checks.triggers, 1, 'the immutability trigger is installed')
        // Future writes are locked at zero, and the recorded value cannot move.
        await assert.rejects(() => pool.query(
          'update public.daily_login_rewards set reward = 0 where user_id = $1 and reward_day = $2', [legacy, y]),
        /err\.dailyLoginRewardImmutable/)
        await assert.rejects(() => pool.query(
          'insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [legacy, '2020-01-01']),
        /err\.dailyLoginRewardImmutable/)
        const claim = await claimToday(client, legacy, d)
        assert.deepEqual({ reward: claim.reward, votes_awarded: claim.votes_awarded },
          { reward: 0, votes_awarded: 0 }, 'a check-in awards no vote')
        assert.deepEqual(await walletOf(pool, legacy), before, 'no balance moved')
      })
    })

    await t.test('B — an environment where 20261118 already ran moves forward safely', async () => {
      await withDatabase(async (pool, client) => {
        await installBase(pool)
        const legacy = await seedHistory(pool, { legacy: true })
        const { y } = await dayOf(pool)
        // The damage 20261118 does, exactly as it happened there.
        await pool.query(archivedSql('20261118_daily_login_no_votes'))
        assert.equal(await rewardOf(pool, legacy, y), 0, '20261118 zeroed the history — that is the incident')
        await recordHistory(client, [
          ...active.filter(({ version }) => version <= '20261117').map(({ id }) => id),
          '20261118_daily_login_no_votes',
        ])

        const result = await deploy(client)

        assert.deepEqual(result.pending.map(({ id }) => id),
          ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'])
        assert.equal(result.recordedQuarantined.length, 1, 'the runner reports the quarantined row and never re-runs it')
        const checks = await rewardChecks(pool)
        assert.equal(checks.table_checks, 0, '20261119 removed the table-wide CHECK')
        assert.equal(checks.triggers, 1)
        // Not restored, and not rewritten again either.
        assert.equal(await rewardOf(pool, legacy, y), 0)
        await assert.rejects(() => pool.query(
          'insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [legacy, '2020-01-02']),
        /err\.dailyLoginRewardImmutable/)
      })
    })

    await t.test('D — a database with partial history applies only what is missing', async () => {
      await withDatabase(async (pool, client) => {
        await installBase(pool)
        // The legacy row predates the corrective migrations, as it does in production.
        const legacy = await seedHistory(pool, { legacy: true })
        const { y } = await dayOf(pool)
        await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
        await recordHistory(client, [
          ...active.filter(({ version }) => version <= '20261117').map(({ id }) => id),
          '20261119_preserve_legacy_daily_login_rewards',
        ])

        const result = await deploy(client)

        assert.deepEqual(result.pending.map(({ id }) => id), ['20261120_daily_login_reward_immutable'])
        assert.equal(await rewardOf(pool, legacy, y), 2)
        await assert.rejects(() => pool.query(
          'update public.daily_login_rewards set reward = 0 where user_id = $1 and reward_day = $2', [legacy, y]),
        /err\.dailyLoginRewardImmutable/)
      })
    })

    await t.test('the runner refuses to guess, and refuses to migrate an empty database', async () => {
      await withDatabase(async (pool, client) => {
        await installBase(pool)
        await seedHistory(pool, { legacy: true })
        await assert.rejects(() => plan(client), /refusing to guess/,
          'a populated database with no migration history needs a declared baseline')
      })
      await withDatabase(async (pool, client) => {
        // Readiness verification comes first: there is nothing here to baseline.
        await assert.rejects(() => plan(client, { baseline: '20261117' }), /no app tables/,
          'an empty database is installed with supabase/setup, not with migrations')
        assert.equal((await client.query(`
          select count(*)::int as n from information_schema.tables
           where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`)).rows[0].n &&
          (await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 0)
      })
    })
  })
