/* Optional REAL PostgreSQL integration tests for 20261121. Every scenario uses
   the shared throwaway-database harness; never set
   MIGRATION_DEPLOY_TEST_DATABASE_URL to staging/production. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  withDatabase, installLevel, seedUser, walletOf, dayOf, migrationSql,
} from './_fixtures.mjs'
import { applyMigration, ensureHistory, readHistory } from '../../tools/migrate.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const MIGRATION_ID = '20261121_vote_calendar_decoupling'
const MIGRATION = {
  id: MIGRATION_ID,
  name: `${MIGRATION_ID}.sql`,
  sql: migrationSql(MIGRATION_ID),
}
const REQUIRED_HISTORY = [
  '20261112_daily_rewards',
  '20261113_calendar_kpop_quiz',
  '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema',
  '20261116_daily_quiz_pool',
  '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards',
  '20261120_daily_login_reward_immutable',
]

async function installPost20261120 (pool, client, { omitHistory = [] } = {}) {
  await installLevel(pool, '20261117')
  await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
  await pool.query(migrationSql('20261120_daily_login_reward_immutable'))
  await ensureHistory(client)
  for (const version of REQUIRED_HISTORY.filter(value => !omitHistory.includes(value))) {
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
      [version, [], `verified fixture state: ${version}`],
    )
  }
}

function questionSnapshot () {
  return [
    { id: 'q-old', option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'old' },
    { id: 'q-new', option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'new' },
    { id: 'q-3', option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'three' },
    { id: 'q-4', option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'four' },
    { id: 'q-5', option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'five' },
  ]
}

async function seedQuizAttempt (pool, userId, day, { emptyQuestionKey = false } = {}) {
  const attemptId = randomUUID()
  await pool.query(`
    insert into public.daily_quiz_attempts
      (id, user_id, quiz_day, questions, quiz_date, question_count, max_votes, votes_awarded)
    values ($1, $2, $3, $4::jsonb, $3, 5, 5, 1)`,
  [attemptId, userId, day, JSON.stringify(questionSnapshot())])
  await pool.query(`
    insert into public.daily_quiz_answers
      (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded, answered_at)
    values ($1, $2, $3, $4, 'a', true, 1, clock_timestamp())`,
  [userId, day, emptyQuestionKey ? '' : 'q-old', attemptId])
  return attemptId
}

async function seedLegacyQuizAttempt (pool, userId, day) {
  await pool.query(`
    insert into public.daily_quiz_attempts
      (id, user_id, quiz_day, questions, question_count, max_votes, votes_awarded)
    values ($1, $2, $3, $4::jsonb, 3, 5, 0)`,
  [randomUUID(), userId, day, JSON.stringify([{ id: 'legacy-1' }, { id: 'legacy-2' }, { id: 'legacy-3' }])])
}

async function setLiveQuota (pool) {
  const values = [
    ['free_vote_grant_enabled', true],
    ['free_votes_per_day', 2],
    ['global_daily_vote_cap_enabled', true],
    ['global_daily_vote_cap', 4],
  ]
  for (const [key, value] of values) {
    await pool.query(`update public.daily_quiz_config
                         set value = $2::jsonb, updated_at = clock_timestamp()
                       where key = $1`, [key, JSON.stringify(value)])
  }
}

const migrationFailureLeavesNoCutover = async (pool, client) => {
  const tables = await pool.query(`
    select to_regclass('public.daily_vote_quota_config') as config,
           to_regclass('public.daily_vote_quota_earnings') as earnings,
           to_regprocedure('public.daily_vote_earned_on(uuid,date)') as earned_fn`)
  assert.equal(tables.rows[0].config, null)
  assert.equal(tables.rows[0].earnings, null)
  assert.equal(tables.rows[0].earned_fn, null)
  assert.equal((await readHistory(client)).includes(MIGRATION_ID), false)
  const source = (await client.query(
    "select pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure) as body")).rows[0].body
  assert.match(source, /daily_quiz_votes_on/)
}

async function withPreparedSource (fn, options = {}) {
  return withDatabase(url, async (pool, client) => {
    await installPost20261120(pool, client, options)
    const { d, y } = await dayOf(pool)
    const userId = await seedUser(pool)
    const attemptId = await seedQuizAttempt(pool, userId, d, options)
    await seedLegacyQuizAttempt(pool, userId, y)
    await setLiveQuota(pool)
    await fn(pool, client, { day: d, previousDay: y, userId, attemptId })
  })
}

test('20261121 preserves live quota, bonus spending order, quiz idempotency, and auth.uid Calendar APIs',
  { skip: !url, timeout: 240_000 }, async () => {
    await withPreparedSource(async (pool, client, { day, previousDay, userId, attemptId }) => {
      const beforeWallet = await walletOf(pool, userId)
      const oldGrant = (await pool.query(
        'select public.daily_free_vote_grant($1, $2)::int as n', [userId, day])).rows[0].n
      assert.equal(oldGrant, 2, 'the deliberately non-seed source config gives two free votes')
      await applyMigration(client, MIGRATION)

      assert.deepEqual(await walletOf(pool, userId), beforeWallet,
        'migration backfill changes neither purchased nor bonus wallet balances')
      assert.deepEqual(await readHistory(client), [...REQUIRED_HISTORY, MIGRATION_ID].sort(),
        'migration body and history row commit together')
      assert.deepEqual((await pool.query(`
        select key, value from public.daily_vote_quota_config
         where key in ('free_vote_grant_enabled','free_votes_per_day',
                       'global_daily_vote_cap_enabled','global_daily_vote_cap')
         order by key`)).rows.map(row => [row.key, row.value]), [
        ['free_vote_grant_enabled', true],
        ['free_votes_per_day', 2],
        ['global_daily_vote_cap', 4],
        ['global_daily_vote_cap_enabled', true],
      ])
      assert.equal((await pool.query(`
        select count(*)::int as n from public.daily_vote_quota_earnings
         where source = 'daily_quiz' and user_id = $1 and vote_day = $2`, [userId, day])).rows[0].n, 1)
      assert.equal((await pool.query(
        'select public.daily_free_vote_grant($1, $2)::int as n', [userId, day])).rows[0].n, oldGrant,
      'the neutral ledger/config reproduces the actual source quota result')

      const rls = (await pool.query(`
        select c.relrowsecurity as rls,
               has_table_privilege('anon', c.oid, 'SELECT') as anon_read,
               has_table_privilege('authenticated', c.oid, 'SELECT') as auth_read,
               has_table_privilege('service_role', c.oid, 'SELECT') as service_read
          from pg_class c where c.oid = 'public.daily_vote_quota_config'::regclass`)).rows[0]
      assert.deepEqual(rls, { rls: true, anon_read: false, auth_read: false, service_read: true })
      assert.equal((await pool.query(`
        select has_table_privilege('anon', 'public.daily_vote_quota_earnings', 'SELECT') as anon_read,
               has_table_privilege('authenticated', 'public.daily_vote_quota_earnings', 'SELECT') as auth_read,
               has_table_privilege('service_role', 'public.daily_vote_quota_earnings', 'SELECT') as service_read`)).rows[0].anon_read, false)
      assert.equal((await pool.query(`
        select has_function_privilege('authenticated', 'public.my_vote_status()', 'EXECUTE') as auth_vote,
               has_function_privilege('anon', 'public.my_vote_status()', 'EXECUTE') as anon_vote,
               has_function_privilege('authenticated', 'public.daily_free_vote_grant(uuid,date)', 'EXECUTE') as auth_helper,
               has_function_privilege('authenticated', 'public.claim_daily_login_calendar(date)', 'EXECUTE') as auth_calendar,
               has_function_privilege('anon', 'public.claim_daily_login_calendar(date)', 'EXECUTE') as anon_calendar`)).rows[0], {
        auth_vote: true, anon_vote: false, auth_helper: false, auth_calendar: true, anon_calendar: false,
      })

      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
      const statusBeforeQuiz = (await client.query('select * from public.my_vote_status()')).rows[0]
      assert.equal(statusBeforeQuiz.free_limit, 2)
      assert.equal(statusBeforeQuiz.purchased, 7)
      assert.equal(statusBeforeQuiz.bonus, 4)

      const answer = async option => JSON.parse((await client.query(
        'select public.submit_daily_quiz_answer($1, $2, $3, $4)::text as result',
        [userId, attemptId, 'q-new', option])).rows[0].result)
      const awarded = await answer('a')
      assert.equal(awarded.awarded, 1)
      assert.equal(awarded.replayed, false)
      const afterAward = await walletOf(pool, userId)
      assert.deepEqual(afterAward, { vote_credits: 7, bonus_credits: 5 })
      assert.equal((await pool.query(`
        select count(*)::int as n from public.daily_vote_quota_earnings
         where source = 'daily_quiz' and user_id = $1 and vote_day = $2`, [userId, day])).rows[0].n, 2,
      'a new answer records exactly one neutral event alongside the existing +1 bonus')
      const eventTime = (await pool.query(`
        select a.answered_at, e.recorded_at
          from public.daily_quiz_answers a
          join public.daily_vote_quota_earnings e
            on e.source = 'daily_quiz' and e.user_id = a.user_id
           and e.vote_day = a.quiz_date and e.source_key = a.question_id
         where a.user_id = $1 and a.quiz_date = $2 and a.question_id = 'q-new'`, [userId, day])).rows[0]
      assert.equal(eventTime.recorded_at.getTime(), eventTime.answered_at.getTime(),
        'the answer and its neutral earning event share the same authoritative timestamp')
      const replay = await answer('b')
      assert.equal(replay.replayed, true)
      assert.equal(replay.awarded, 1)
      assert.deepEqual(await walletOf(pool, userId), afterAward, 'replay never double-awards the wallet')
      assert.equal((await pool.query(`
        select count(*)::int as n from public.daily_vote_quota_earnings
         where source = 'daily_quiz' and user_id = $1 and vote_day = $2`, [userId, day])).rows[0].n, 2,
      'replay never duplicates the neutral event')

      const requestId = randomUUID()
      await pool.query(`insert into public.requests (id, user_id, artist, title, status)
                        values ($1, $2, 'A', 'B', 'queued')`, [requestId, userId])
      const cast = async delta => (await client.query(
        'select * from public.cast_vote($1, $2, null, null, null)', [requestId, delta])).rows[0]
      await cast(3) // 2 free, then 1 bonus
      assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 4 })
      await cast(3) // the remaining bonus is used before purchased votes
      assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 1 })
      await cast(1) // the final bonus vote
      assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 0 })
      await cast(1) // only then does spending reach the purchased wallet
      assert.deepEqual(await walletOf(pool, userId), { vote_credits: 6, bonus_credits: 0 })
      await cast(-8) // refunds return to the original wallet kinds
      assert.deepEqual(await walletOf(pool, userId), afterAward)

      const twoDaysAgo = (await pool.query('select ($1::date - 2)::date::text as day', [day])).rows[0].day
      const tomorrow = (await pool.query('select ($1::date + 1)::date::text as day', [day])).rows[0].day
      await pool.query(`insert into public.daily_login_rewards (user_id, reward_day, reward)
                        values ($1, $2::date, 0), ($1, $3::date, 0), ($1, $4::date, 0)`,
      [userId, twoDaysAgo, previousDay, tomorrow])
      const calendarStatus = async () => JSON.parse((await client.query(
        'select public.my_daily_login_status()::text as status')).rows[0].status)
      const status = await calendarStatus()
      assert.deepEqual(Object.keys(status).sort(),
        ['day', 'login', 'reset_at', 'server_now', 'timezone', 'user_id'])
      assert.equal(status.user_id, userId)
      assert.equal(status.day, day)
      assert.deepEqual(Object.keys(status.login).sort(),
        ['best_streak', 'claimed', 'claimed_days', 'first_day', 'streak', 'total_days'])
      assert.equal(status.login.claimed, false)
      assert.deepEqual({ total: status.login.total_days, first: status.login.first_day,
        streak: status.login.streak, best: status.login.best_streak },
      { total: 2, first: twoDaysAgo, streak: 2, best: 2 },
      'the server excludes a future check-in and computes only recorded VN days')
      await assert.rejects(() => client.query(
        'select public.claim_daily_login_calendar($1::date)', [previousDay]), /err\.dailyDayChanged/)
      const claim = JSON.parse((await client.query(
        'select public.claim_daily_login_calendar($1::date)::text as result', [day])).rows[0].result)
      assert.equal(claim.replayed, false)
      assert.equal(claim.status.user_id, userId)
      assert.equal(claim.status.login.claimed, true)
      assert.deepEqual({ total: claim.status.login.total_days, first: claim.status.login.first_day,
        streak: claim.status.login.streak, best: claim.status.login.best_streak },
      { total: 3, first: twoDaysAgo, streak: 3, best: 3 })
      assert.deepEqual(await walletOf(pool, userId), afterAward, 'Calendar claim does not pay or spend votes')
      const month = JSON.parse((await client.query(
        'select public.my_daily_checkin_month($1::date)::text as result', [`${day.slice(0, 7)}-01`])).rows[0].result)
      assert.deepEqual(Object.keys(month).sort(), ['day', 'days', 'month', 'user_id'])
      assert.deepEqual(month.days, [twoDaysAgo, previousDay, day]
        .filter(value => value.slice(0, 7) === day.slice(0, 7)))

      const beforeRollback = await walletOf(pool, userId)
      const rollbackSql = readFileSync(new URL('../rollback/20261121_vote_calendar_decoupling.sql', import.meta.url), 'utf8')
      await pool.query(`update public.daily_vote_quota_config set value = 'false'::jsonb
                         where key = 'free_vote_grant_enabled'`)
      await assert.rejects(() => client.query(rollbackSql), /err\.voteCalendarRollback.*config differ/,
        'a rollback must refuse to restore stale source quota values')
      await client.query('rollback')
      const stillCutOver = (await pool.query(
        "select pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure) as body")).rows[0].body
      assert.match(stillCutOver, /daily_vote_quota_config/,
        'a failed corrective preflight leaves the neutral vote path intact')
      await pool.query(`update public.daily_vote_quota_config set value = 'true'::jsonb
                         where key = 'free_vote_grant_enabled'`)
      await client.query(rollbackSql)
      assert.deepEqual(await walletOf(pool, userId), beforeRollback, 'the vote-only rollback never changes balances')
      assert.equal((await pool.query(
        'select public.daily_free_vote_grant($1, $2)::int as n', [userId, day])).rows[0].n, oldGrant,
      'restoring the source quota function preserves the live free-vote grant')
      const restored = (await pool.query(`
        select pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure) as grant_fn,
               pg_get_functiondef('public.submit_daily_quiz_answer(uuid,uuid,text,text)'::regprocedure) as quiz_fn,
               to_regclass('public.daily_vote_quota_earnings')::text as ledger,
               to_regprocedure('public.my_daily_login_status()')::text as calendar_fn`)).rows[0]
      assert.match(restored.grant_fn, /daily_quiz_votes_on/)
      assert.doesNotMatch(restored.grant_fn, /daily_vote_quota_config/)
      assert.doesNotMatch(restored.quiz_fn, /daily_vote_quota_earnings/)
      assert.ok(restored.ledger && restored.calendar_fn, 'rollback retains the neutral ledger and Calendar API')
      const afterRollbackStatus = JSON.parse((await client.query(
        'select public.my_daily_login_status()::text as status')).rows[0].status)
      assert.equal(afterRollbackStatus.login.claimed, true, 'Calendar remains functional after vote rollback')
      assert.equal((await pool.query(`
        select count(*)::int as n from public.daily_vote_quota_earnings
         where source = 'daily_quiz' and user_id = $1 and vote_day = $2`, [userId, day])).rows[0].n, 2,
      'the corrective rollback leaves both neutral ledger events intact')
    })
  })

test('missing live config or migration history aborts before creating vote objects',
  { skip: !url, timeout: 180_000 }, async t => {
    await t.test('incomplete production config is not replaced with repository defaults', async () => {
      await withPreparedSource(async (pool, client) => {
        await pool.query("delete from public.daily_quiz_config where key = 'free_votes_per_day'")
        await assert.rejects(() => applyMigration(client, MIGRATION), /err\.voteCalendarPreflight.*configuration is incomplete/)
        await migrationFailureLeavesNoCutover(pool, client)
      })
    })
    await t.test('an existing but incomplete migration history is refused', async () => {
      await withPreparedSource(async (pool, client) => {
        // Rebuild history with one required source state intentionally missing.
        await client.query('delete from supabase_migrations.schema_migrations')
        for (const version of REQUIRED_HISTORY.filter(value => value !== '20261116_daily_quiz_pool')) {
          await client.query(
            'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
            [version, [], 'incomplete fixture history'],
          )
        }
        await assert.rejects(() => applyMigration(client, MIGRATION), /required migration state missing/)
        await migrationFailureLeavesNoCutover(pool, client)
      })
    })
    await t.test('an unknown partial target object is not overwritten', async () => {
      await withPreparedSource(async (pool, client) => {
        await pool.query('create table public.daily_vote_quota_config (key text)')
        await assert.rejects(() => applyMigration(client, MIGRATION), /partial\/unknown target objects/)
        assert.equal((await pool.query("select to_regclass('public.daily_vote_quota_earnings') as x")).rows[0].x, null)
        assert.equal((await readHistory(client)).includes(MIGRATION_ID), false)
      })
    })
  })

test('a live source-vs-neutral quota mismatch aborts before cutover',
  { skip: !url, timeout: 180_000 }, async () => {
    await withPreparedSource(async (pool, client) => {
      await pool.query(`update public.daily_quiz_config set value = '2'::jsonb
                         where key = 'global_daily_vote_cap'`)
      // Keep every preflight marker but deliberately change source semantics:
      // the source function now ignores its awarded rows, so its grant differs
      // from the exact neutral snapshot under this live cap.
      await pool.query(`create or replace function public.daily_quiz_votes_on(p_uid uuid, p_day date)
        returns integer language sql stable security definer set search_path = public as $$
          select count(*)::int from public.daily_quiz_answers
           where user_id = p_uid and quiz_date = p_day and awarded = 1 and false
        $$`)
      await assert.rejects(() => applyMigration(client, MIGRATION),
        /err\.voteCalendarQuota: live source grant differs from copied config\/ledger/)
      await migrationFailureLeavesNoCutover(pool, client)
    })
  })

test('a backfill constraint failure rolls back neutral tables/config and leaves source APIs intact',
  { skip: !url, timeout: 180_000 }, async () => {
    await withPreparedSource(async (pool, client, { day, userId }) => {
      await pool.query(`update public.daily_quiz_answers set question_id = ''
                         where user_id = $1 and quiz_date = $2`, [userId, day])
      await assert.rejects(() => applyMigration(client, MIGRATION), /20261121_vote_calendar_decoupling\.sql/)
      await migrationFailureLeavesNoCutover(pool, client)
    }, { emptyQuestionKey: false })
  })
