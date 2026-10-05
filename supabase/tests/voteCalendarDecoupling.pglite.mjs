/* Real PostgreSQL (WASM) verification of 20261121 — no server, no credentials.
 *
 * `supabase/tests/voteCalendarDecoupling.test.js` needs a disposable Postgres
 * (`MIGRATION_DEPLOY_TEST_DATABASE_URL`) and is skipped everywhere one is not
 * configured, which is exactly how a strict preflight assertion can rot
 * unnoticed: a catalog check that never matches on a real server aborts the
 * whole cutover. This suite builds the same `20261117` + `20261119` + `20261120`
 * source state inside PGlite (PostgreSQL compiled to WASM, bundled locally),
 * runs the real migration file and the real rollback file against it, and
 * checks the same contract the DB-gated suite checks.
 *
 * It is opt-in (`npm run test:migration:pglite`) so the default `npm test` run
 * stays fast and does not build a database per case. It never touches a network
 * or an external database. Production runs on the Supabase Postgres image; this
 * is a second, independent engine where the file must still behave.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = path => readFileSync(`${ROOT}${path}`, 'utf8')
const schema = read('supabase/schema.sql')
const coreSql = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
const MIGRATION_ID = '20261121_vote_calendar_decoupling'
const MIGRATION = read(`supabase/migrations/${MIGRATION_ID}.sql`)
const ROLLBACK = read('supabase/rollback/20261121_vote_calendar_decoupling.sql')
const LEVELS = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable']

/* Everything the real project provides outside SQL: the three PostgREST roles,
 * the auth schema and auth.uid(), and the publication the core schema alters. */
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

/** Builds the source state the migration expects, exactly as the runner leaves
 *  it: setup baseline (through 20261117) + 20261119 + 20261120, then the
 *  guarded-runner history rows. `omitHistory` / `history: false` model a
 *  database whose migration state cannot be trusted. */
async function buildSource ({ history = true, omitHistory = [] } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of LEVELS) await db.exec(read(`supabase/migrations/${name}.sql`))
  const { d, y } = (await db.query(
    `select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text as d,
            ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1)::text as y`)).rows[0]
  if (history) {
    await db.exec(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text not null primary key, statements text[], name text);`)
    for (const version of LEVELS.filter(value => !omitHistory.includes(value))) {
      await db.query(
        'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
        [version, [], `verified fixture state: ${version}`])
    }
  }
  return { db, day: d, previousDay: y }
}

/** Live production policy is deliberately different from the repository seeds:
 *  two free votes per day under a global cap of four, both switches enabled. */
const LIVE_QUOTA = [['free_vote_grant_enabled', true], ['free_votes_per_day', 2],
  ['global_daily_vote_cap_enabled', true], ['global_daily_vote_cap', 4]]

/** One five-question attempt with an already awarded answer, one legacy
 *  three-question attempt (quiz_date stays NULL by design) on the day before,
 *  and the live quota rows. */
async function seedSource (db, day, legacyDay) {
  const userId = (await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'fixture@example.test') returning id")).rows[0].id
  await db.query('update public.profiles set vote_credits = 7, bonus_credits = 4 where id = $1', [userId])
  const questions = ['q-old', 'q-new', 'q-3', 'q-4', 'q-5'].map(id => ({
    id, option_ids: ['a', 'b'], correct_option_id: 'a', explanation: id,
  }))
  const attemptId = randomUUID()
  await db.query(`insert into public.daily_quiz_attempts
      (id, user_id, quiz_day, questions, quiz_date, question_count, max_votes, votes_awarded)
    values ($1, $2, $3, $4::jsonb, $3, 5, 5, 1)`, [attemptId, userId, day, JSON.stringify(questions)])
  await db.query(`insert into public.daily_quiz_answers
      (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded, answered_at)
    values ($1, $2, 'q-old', $3, 'a', true, 1, clock_timestamp())`, [userId, day, attemptId])
  await db.query(`insert into public.daily_quiz_attempts
      (id, user_id, quiz_day, questions, question_count, max_votes, votes_awarded)
    values ($1, $2, $3, $4::jsonb, 3, 5, 0)`,
  [randomUUID(), userId, legacyDay, JSON.stringify([{ id: 'legacy-1' }, { id: 'legacy-2' }, { id: 'legacy-3' }])])
  for (const [key, value] of LIVE_QUOTA) {
    await db.query('update public.daily_quiz_config set value = $2::jsonb, updated_at = clock_timestamp() where key = $1',
      [key, JSON.stringify(value)])
  }
  return { userId, attemptId }
}

/** The guarded runner strips the file's own wrapper and writes the history row
 *  in the same transaction; this mirrors `applyMigration` in tools/migrate.mjs. */
async function applyMigration (db) {
  await db.exec(MIGRATION)
  await db.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
    [MIGRATION_ID, [], `${MIGRATION_ID}.sql`])
}

/** Runs SQL that must fail, then clears the aborted transaction so the session
 *  can be inspected, exactly like `assert.rejects` + `rollback` in the
 *  DB-gated suite. */
async function rejected (db, sql, pattern) {
  let error = null
  try { await db.exec(sql) } catch (caught) { error = caught } finally {
    await db.exec('rollback').catch(() => {})
  }
  assert.ok(error, `expected the SQL to fail with ${pattern}`)
  assert.match(error.message, pattern)
}

const walletOf = async (db, id) => (await db.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [id])).rows[0]
const grantOf = async (db, id, day) => (await db.query(
  'select public.daily_free_vote_grant($1, $2)::int as n', [id, day])).rows[0].n
const ledgerCount = async (db, id, day) => (await db.query(
  `select count(*)::int as n from public.daily_vote_quota_earnings
    where source = 'daily_quiz' and user_id = $1 and vote_day = $2`, [id, day])).rows[0].n
const functionBody = async (db, signature) => (await db.query(
  `select pg_get_functiondef('${signature}'::regprocedure) as body`)).rows[0].body

/** The cutover's own definition of "nothing happened": no neutral tables, no
 *  Calendar RPCs, no history row. `preexisting` names target tables the fixture
 *  created on purpose — they must survive exactly as they were, not be adopted
 *  or completed by the migration. */
async function assertNoCutover (db, { preexisting = [] } = {}) {
  const state = (await db.query(`
    select (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in ('daily_vote_quota_config', 'daily_vote_quota_earnings')
                and c.relkind = 'r') as tables,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('daily_vote_earned_on', 'daily_login_calendar_payload',
                                  'my_daily_login_status', 'claim_daily_login_calendar')) as functions`)).rows[0]
  assert.deepEqual(state, { tables: preexisting.length, functions: 0 })
  const hasHistory = (await db.query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null as ok")).rows[0].ok
  if (hasHistory) {
    assert.equal((await db.query(
      'select count(*)::int as n from supabase_migrations.schema_migrations where version = $1',
      [MIGRATION_ID])).rows[0].n, 0)
  }
}

test('the cutover preserves live quota, spending order, quiz idempotency, Calendar RPCs and rollback',
  { timeout: 120_000 }, async () => {
    const { db, day, previousDay } = await buildSource()
    const { userId, attemptId } = await seedSource(db, day, previousDay)
    const beforeWallet = await walletOf(db, userId)
    const sourceGrant = await grantOf(db, userId, day)
    assert.equal(sourceGrant, 2, 'the deliberately non-seed source config grants two free votes')

    await applyMigration(db)

    // Neutral objects copy the live policy; nothing else is rewritten.
    assert.deepEqual(await walletOf(db, userId), beforeWallet, 'backfill changes no balance')
    assert.deepEqual((await db.query(`
      select key, value from public.daily_vote_quota_config
       where key in ('free_vote_grant_enabled','free_votes_per_day',
                     'global_daily_vote_cap_enabled','global_daily_vote_cap') order by key`)).rows, [
      { key: 'free_vote_grant_enabled', value: true },
      { key: 'free_votes_per_day', value: 2 },
      { key: 'global_daily_vote_cap', value: 4 },
      { key: 'global_daily_vote_cap_enabled', value: true },
    ], 'the four live values are copied, never repo seeds')
    assert.equal(await ledgerCount(db, userId, day), 1, 'one awarded answer becomes one neutral event')
    assert.equal(await grantOf(db, userId, day), sourceGrant, 'the neutral ledger reproduces the source quota')

    // RLS and grants: readable only by the trusted service role.
    assert.deepEqual((await db.query(`
      select c.relname, c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'SELECT') as anon_read,
             has_table_privilege('authenticated', c.oid, 'SELECT') as auth_read,
             has_table_privilege('service_role', c.oid, 'SELECT') as service_read
        from pg_class c
       where c.oid in ('public.daily_vote_quota_config'::regclass,
                       'public.daily_vote_quota_earnings'::regclass)
       order by c.relname`)).rows, [
      { relname: 'daily_vote_quota_config', rls: true, anon_read: false, auth_read: false, service_read: true },
      { relname: 'daily_vote_quota_earnings', rls: true, anon_read: false, auth_read: false, service_read: true },
    ])
    assert.deepEqual((await db.query(`
      select has_function_privilege('authenticated', 'public.my_vote_status()', 'EXECUTE') as auth_vote,
             has_function_privilege('anon', 'public.my_vote_status()', 'EXECUTE') as anon_vote,
             has_function_privilege('authenticated', 'public.daily_free_vote_grant(uuid,date)', 'EXECUTE') as auth_helper,
             has_function_privilege('authenticated', 'public.daily_login_calendar_payload(uuid,timestamptz)', 'EXECUTE') as auth_payload,
             has_function_privilege('authenticated', 'public.my_daily_login_status()', 'EXECUTE') as auth_status,
             has_function_privilege('anon', 'public.my_daily_login_status()', 'EXECUTE') as anon_status,
             has_function_privilege('authenticated', 'public.claim_daily_login_calendar(date)', 'EXECUTE') as auth_calendar,
             has_function_privilege('anon', 'public.claim_daily_login_calendar(date)', 'EXECUTE') as anon_calendar`)).rows[0], {
      auth_vote: true, anon_vote: false, auth_helper: false, auth_payload: false,
      auth_status: true, anon_status: false, auth_calendar: true, anon_calendar: false,
    }, 'the Calendar RPC is authenticated-only and its payload helper is internal')

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    const statusBefore = (await db.query('select * from public.my_vote_status()')).rows[0]
    assert.equal(statusBefore.free_limit, 2, 'the live free quota survives the cutover')
    assert.equal(statusBefore.purchased, 7)
    assert.equal(statusBefore.bonus, 4)

    // The quiz writer records the neutral event and its timestamp in the same
    // statement the +1 bonus is applied, and replays stay no-ops.
    const answer = async option => JSON.parse((await db.query(
      'select public.submit_daily_quiz_answer($1, $2, $3, $4)::text as result',
      [userId, attemptId, 'q-new', option])).rows[0].result)
    const awarded = await answer('a')
    assert.equal(awarded.awarded, 1)
    assert.equal(awarded.replayed, false)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 5 })
    assert.equal(await ledgerCount(db, userId, day), 2)
    const times = (await db.query(`select a.answered_at, e.recorded_at
        from public.daily_quiz_answers a
        join public.daily_vote_quota_earnings e
          on e.source = 'daily_quiz' and e.user_id = a.user_id
         and e.vote_day = a.quiz_date and e.source_key = a.question_id
       where a.user_id = $1 and a.quiz_date = $2 and a.question_id = 'q-new'`, [userId, day])).rows[0]
    assert.equal(times.recorded_at.getTime(), times.answered_at.getTime(),
      'the ledger row shares the answer timestamp the rollback compares against')
    const replay = await answer('b')
    assert.equal(replay.replayed, true)
    assert.equal(replay.awarded, 1)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 5 }, 'replay awards nothing')
    assert.equal(await ledgerCount(db, userId, day), 2, 'replay writes no second neutral event')

    // Spending order stays free -> bonus -> purchased, and refunds return to the
    // wallet kinds they came from.
    const requestId = (await db.query(`insert into public.requests (id, user_id, artist, title, status)
      values (gen_random_uuid(), $1, 'A', 'B', 'queued') returning id`, [userId])).rows[0].id
    const cast = async delta => (await db.query(
      'select * from public.cast_vote($1, $2, null, null, null)', [requestId, delta])).rows[0]
    await cast(3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 4 })
    await cast(3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 1 })
    await cast(1)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 0 })
    await cast(1)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 6, bonus_credits: 0 }, 'purchased last')
    await cast(-8)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 5 })

    // Calendar-only API: identity from auth.uid(), server day from the VN clock,
    // no quiz/wallet fields, and a future row that must not inflate anything.
    const twoDaysAgo = (await db.query('select ($1::date - 2)::date::text as x', [day])).rows[0].x
    const tomorrow = (await db.query('select ($1::date + 1)::date::text as x', [day])).rows[0].x
    await db.query(`insert into public.daily_login_rewards (user_id, reward_day, reward) values
      ($1, $2::date, 0), ($1, $3::date, 0), ($1, $4::date, 0)`,
    [userId, twoDaysAgo, previousDay, tomorrow])
    const status = JSON.parse((await db.query('select public.my_daily_login_status()::text as s')).rows[0].s)
    assert.deepEqual(Object.keys(status).sort(), ['day', 'login', 'reset_at', 'server_now', 'timezone', 'user_id'])
    assert.equal(status.user_id, userId)
    assert.equal(status.day, day)
    assert.deepEqual(Object.keys(status.login).sort(),
      ['best_streak', 'claimed', 'claimed_days', 'first_day', 'streak', 'total_days'])
    assert.equal(status.login.claimed, false)
    assert.deepEqual({
      total: status.login.total_days, first: status.login.first_day,
      streak: status.login.streak, best: status.login.best_streak,
    }, { total: 2, first: twoDaysAgo, streak: 2, best: 2 }, 'a future check-in is not counted')
    await rejected(db, `select public.claim_daily_login_calendar('${previousDay}'::date)`, /err\.dailyDayChanged/)
    await rejected(db, 'select public.claim_daily_login_calendar(null::date)', /err\.dailyDayChanged/)
    assert.deepEqual((await db.query(`select
        to_regprocedure('public.claim_daily_login_calendar(date)') is not null as new_signature,
        to_regprocedure('public.claim_daily_login_calendar(uuid,date)') is null as no_client_user_signature`)).rows[0],
    { new_signature: true, no_client_user_signature: true })
    const claim = JSON.parse((await db.query(
      'select public.claim_daily_login_calendar($1::date)::text as r', [day])).rows[0].r)
    assert.equal(claim.replayed, false)
    assert.equal(claim.status.login.claimed, true)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 5 }, 'a check-in pays no votes')
    const month = JSON.parse((await db.query(
      'select public.my_daily_checkin_month($1::date)::text as r', [`${day.slice(0, 7)}-01`])).rows[0].r)
    assert.deepEqual(Object.keys(month).sort(), ['day', 'days', 'month', 'user_id'])
    assert.deepEqual(month.days, [twoDaysAgo, previousDay, day]
      .filter(value => value.slice(0, 7) === day.slice(0, 7)))

    // Corrective rollback: refuses drifted quota inputs, then restores the
    // source vote path while keeping the neutral ledger and Calendar API.
    const beforeRollback = await walletOf(db, userId)
    await db.query("update public.daily_vote_quota_config set value = 'false'::jsonb where key = 'free_vote_grant_enabled'")
    await rejected(db, ROLLBACK, /err\.voteCalendarRollback: source and neutral quota config differ/)
    assert.match(await functionBody(db, 'public.daily_free_vote_grant(uuid,date)'), /daily_vote_quota_config/,
      'a refused rollback leaves the cutover in place')
    await db.query("update public.daily_vote_quota_config set value = 'true'::jsonb where key = 'free_vote_grant_enabled'")
    await db.exec(ROLLBACK)
    assert.match(await functionBody(db, 'public.daily_free_vote_grant(uuid,date)'), /daily_quiz_votes_on/)
    assert.doesNotMatch(await functionBody(db, 'public.submit_daily_quiz_answer(uuid,uuid,text,text)'),
      /daily_vote_quota_earnings/)
    assert.deepEqual(await walletOf(db, userId), beforeRollback, 'the rollback never moves balances')
    assert.equal(await grantOf(db, userId, day), sourceGrant)
    assert.equal(await ledgerCount(db, userId, day), 2, 'the retained ledger stays an audit snapshot')
    const afterRollback = JSON.parse((await db.query(
      'select public.my_daily_login_status()::text as s')).rows[0].s)
    assert.equal(afterRollback.login.claimed, true, 'Calendar stays functional after the vote rollback')
    await db.close()
  })

test('every untrusted source, config, history or target state aborts before any cutover',
  { timeout: 180_000 }, async t => {
    const cases = [
      ['an incomplete live quota config is never replaced with repository defaults', {}, async db => {
        await db.query("delete from public.daily_quiz_config where key = 'free_votes_per_day'")
      }, /err\.voteCalendarPreflight.*configuration is incomplete/],
      ['a live quota value with the wrong JSON type is refused', {}, async db => {
        await db.query(`update public.daily_quiz_config set value = '"2"'::jsonb where key = 'free_votes_per_day'`)
      }, /err\.voteCalendarPreflight: live vote configuration has an invalid type\/value/],
      ['an absent guarded-runner history is refused', { history: false }, null,
        /err\.voteCalendarPreflight: guarded-runner migration history is missing/],
      ['an incomplete migration history is refused', { omitHistory: ['20261116_daily_quiz_pool'] }, null,
        /err\.voteCalendarPreflight: required migration state missing/],
      ['an unknown partial target object is not overwritten', {}, async db => {
        await db.exec('create table public.daily_vote_quota_config (key text)')
      }, /err\.voteCalendarPreflight: partial\/unknown target objects already exist/],
      ['a five-question attempt without its authoritative quiz date is refused', {}, async db => {
        await db.query('update public.daily_quiz_attempts set quiz_date = null where question_count = 5')
      }, /err\.voteCalendarPreflight: 5-question attempt dates are incomplete or inconsistent/],
    ]
    for (const [name, options, mutate, pattern] of cases) {
      await t.test(name, async () => {
        const { db, day, previousDay } = await buildSource(options)
        await seedSource(db, day, previousDay)
        if (mutate) await mutate(db, day)
        await rejected(db, MIGRATION, pattern)
        const preexisting = ['an unknown partial target object is not overwritten'].includes(name)
          ? ['public.daily_vote_quota_config'] : []
        await assertNoCutover(db, { preexisting })
        if (preexisting.length) {
          assert.deepEqual((await db.query(
            "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'daily_vote_quota_config'")).rows,
          [{ column_name: 'key' }], 'the pre-existing table is left exactly as it was')
        }
        await db.close()
      })
    }
  })

test('source/neutral divergence and an unrepresentable award key abort before cutover',
  { timeout: 120_000 }, async t => {
    await t.test('a live source-vs-neutral quota mismatch aborts', async () => {
      const { db, day, previousDay } = await buildSource()
      await seedSource(db, day, previousDay)
      await db.query("update public.daily_quiz_config set value = '2'::jsonb where key = 'global_daily_vote_cap'")
      // Every preflight marker survives; only the live formula changes, so the
      // live source grant no longer matches the copied config/neutral ledger.
      await db.exec(`create or replace function public.daily_quiz_votes_on(p_uid uuid, p_day date)
        returns integer language sql stable security definer set search_path = public as $$
          select count(*)::int from public.daily_quiz_answers
           where user_id = p_uid and quiz_date = p_day and awarded = 1 and false
        $$`)
      await rejected(db, MIGRATION, /err\.voteCalendarQuota: live source grant differs from copied config\/ledger/)
      await assertNoCutover(db)
      await db.close()
    })

    await t.test('an awarded answer with an empty source key is refused before any ledger write', async () => {
      const { db, day, previousDay } = await buildSource()
      await seedSource(db, day, previousDay)
      await db.query(`update public.daily_quiz_answers set question_id = '' where quiz_date = $1`, [day])
      await rejected(db, MIGRATION, /err\.voteCalendarBackfill: an awarded quiz answer has an empty source key/)
      await assertNoCutover(db)
      await db.close()
    })

    await t.test('an empty quiz ledger still cuts over', async () => {
      const { db, day, previousDay } = await buildSource()
      const { userId } = await seedSource(db, day, previousDay)
      await db.query('delete from public.daily_quiz_answers')
      await db.query('update public.daily_quiz_attempts set votes_awarded = 0')
      const before = await walletOf(db, userId)
      await applyMigration(db)
      assert.equal((await db.query(
        'select count(*)::int as n from public.daily_vote_quota_earnings')).rows[0].n, 0)
      assert.equal(await grantOf(db, userId, day), 2, 'the live free quota is unchanged')
      assert.deepEqual(await walletOf(db, userId), before)
      await db.close()
    })
  })
