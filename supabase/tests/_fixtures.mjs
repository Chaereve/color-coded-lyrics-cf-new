/* Shared scaffolding for the optional REAL PostgreSQL test suites.
   Every helper builds a disposable database from template0 and drops it again.
   Never point the *_TEST_DATABASE_URL variables at production. */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
export const coreSql = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
export const migrationSql = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8')
export const archivedSql = name => readFileSync(new URL(`../migrations/archive/${name}.sql.superseded`, import.meta.url), 'utf8')

export const DAILY_REWARD_MIGRATIONS = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz',
  '20261114_daily_rewards_upgrade', '20261115_daily_quiz_schema', '20261116_daily_quiz_pool',
  '20261117_daily_quiz_flow']

/** B1–B4 files after 20261125. Guarded-runner Postgres tests that pin the
    20261119–20261125 path must append this tail so CI matches production. */
export const POST_20261125 = [
  '20261126_reward_ledger',
  '20261127_login_streak_rewards',
  '20261128_achievements_v2',
  '20261129_mystery_box',
  '20261201_spin_v2',
  '20261202_mystery_paid_v2',
  '20261203_mystery_month',
  '20261204_mystery_odds',
  '20261210_vote_back',
]

const SCAFFOLD = `
  -- Roles live in pg_authid, which is cluster-wide: CREATE DATABASE isolates
  -- tables, schemas and functions but NOT roles, so every parallel test file
  -- races to create the same three names on the same server. CREATE ROLE probes
  -- for the name and then inserts, so two concurrent sessions can both pass the
  -- probe and collide on the unique index pg_authid_rolname_index, which raises
  -- 23505 unique_violation rather than 42710 duplicate_object. Both mean "it
  -- already exists", so both are ignored. The handler wraps this one statement
  -- only, so no other SQL error can be masked, and the roles are never dropped
  -- again because another parallel database may still be using them.
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

/** Creates a throwaway database and hands the callback a pool and a client. */
export async function withDatabase (url, fn) {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const name = `ccl_fix_${randomUUID().replaceAll('-', '')}`
  let created = false
  try {
    await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
    created = true
    const target = new URL(url)
    target.pathname = `/${name}`
    const connection = target.toString()
    const pool = new pg.Pool({ connectionString: connection, max: 4 })
    // Track every connection this pool ever opens until its socket really
    // closes. `pool.end()` only drains what the pool still knows is checked
    // out, and the `drop database ... with (force)` below terminates whatever
    // is left attached — which is what made an in-flight query die with
    // "terminating connection due to administrator command". Registered before
    // anything can use the pool, so no connection can escape tracking.
    const ended = []
    pool.on('connect', client => ended.push(new Promise(resolve => client.once('end', resolve))))
    const client = new pg.Client({ connectionString: connection })
    await client.connect()
    let failure = null
    let shutdown = null
    let result
    try {
      await pool.query(SCAFFOLD)
      result = await fn(pool, client)
    } catch (error) {
      failure = error
    } finally {
      // Close cleanly first, then wait for every tracked connection to report
      // that it actually ended — only then may the database be force-dropped
      // by the block below.
      const settled = await Promise.allSettled([client.end(), pool.end(), ...ended])
      const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason)
      if (errors.length) shutdown = errors.map(error => error?.message ?? String(error)).join('; ')
    }
    // A shutdown failure is never swallowed: it fails the run outright, and a
    // test body that already failed still propagates its own error.
    if (failure) {
      if (shutdown) console.error(`test database ${name} did not shut down cleanly: ${shutdown}`)
      throw failure
    }
    if (shutdown) throw new Error(`test database ${name} did not shut down cleanly: ${shutdown}`)
    return result
  } finally {
    try { if (created) await admin.query(`drop database if exists ${name} with (force)`) } finally { await admin.end() }
  }
}

/** Installs a known schema level:
 *   20261111 — core only (before the daily rewards / quiz migrations)
 *   20261117 — core + 20261112…20261117
 *   20261118 — the same, then the destructive migration (the incident state)
 *   fresh    — the whole supabase/schema.sql (the fresh-install path) */
export async function installLevel (pool, level) {
  if (level === 'fresh') {
    const { splitSchema } = await import('../../scripts/split-schema.mjs')
    for (const { sql } of splitSchema(schema)) await pool.query(sql)
    return
  }
  await pool.query(coreSql)
  if (level === '20261111') return
  for (const name of DAILY_REWARD_MIGRATIONS) await pool.query(migrationSql(name))
  if (level === '20261118') await pool.query(archivedSql('20261118_daily_login_no_votes'))
}

export const dayOf = async pool => (await pool.query(
  `select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text as d,
          ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1)::text as y`)).rows[0]

export const rewardOf = async (pool, userId, day) => (await pool.query(
  'select reward from public.daily_login_rewards where user_id = $1 and reward_day = $2', [userId, day])).rows[0].reward

export const walletOf = async (pool, userId) => (await pool.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [userId])).rows[0]

export const rewardChecks = async pool => (await pool.query(`
  select (select count(*)::int from pg_constraint
            where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%reward%') as table_checks,
         (select count(*)::int from pg_trigger
            where tgrelid = 'public.daily_login_rewards'::regclass
              and tgname = 'daily_login_rewards_no_vote') as triggers`)).rows[0]

export const historyRows = async client => (await client.query(
  'select version from supabase_migrations.schema_migrations order by version')).rows.map(row => row.version)

/** A user, and — on request — check-in history written under the retired +2
 *  policy (before the corrective migrations), plus one vote in the ledger. */
export async function seedUser (pool, { legacy = false } = {}) {
  const id = randomUUID()
  await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.test`])
  await pool.query('update public.profiles set vote_credits = 7, bonus_credits = 4 where id = $1', [id])
  if (legacy) {
    const { d, y } = await dayOf(pool)
    const request = randomUUID()
    await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1, $2, 'A', 'B', 'queued')", [request, id])
    await pool.query('insert into public.votes (request_id, user_id, used_credit) values ($1, $2, true)', [request, id])
    await pool.query('insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [id, y])
    await pool.query('insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, 2)', [id, d])
  }
  return id
}

/** The documented administrator path: a historical amount is inserted with the
 *  trigger disabled for that statement only, then preserved. */
export async function insertHistorical (pool, userId, day, reward) {
  await pool.query('alter table public.daily_login_rewards disable trigger daily_login_rewards_no_vote')
  await pool.query('insert into public.daily_login_rewards (user_id, reward_day, reward) values ($1, $2, $3)', [userId, day, reward])
  await pool.query('alter table public.daily_login_rewards enable trigger daily_login_rewards_no_vote')
}

export async function claim (client, userId, day) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  return JSON.parse((await client.query('select public.claim_daily_login($1, $2)::text as v', [userId, day])).rows[0].v)
}
