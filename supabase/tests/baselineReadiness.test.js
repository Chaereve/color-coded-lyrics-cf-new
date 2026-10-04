/* Optional REAL PostgreSQL tests for baseline safety.
   Only a LOCAL/TEST superuser with CREATEDB; every case builds a throwaway
   database from template0 and drops it.
   They prove the rule the runner enforces: a baseline is a claim about the
   past, so it is recorded only after the live schema is verified object by
   object against a committed fingerprint of that migration's result.
   MIGRATION_DEPLOY_TEST_DATABASE_URL=postgres://… node --test supabase/tests/baselineReadiness.test.js */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  withDatabase, installLevel, seedUser, rewardOf, rewardChecks, historyRows, claim,
  insertHistorical, dayOf, migrationSql, archivedSql,
} from './_fixtures.mjs'
import { deploy, plan } from '../../tools/migrate.mjs'
import { verifyBaseline, availableBaselines, SNAPSHOT_DIR, BASELINE_NOTES } from '../../tools/schema-readiness.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL

test('the committed readiness snapshots cover the deployable baselines', () => {
  assert.deepEqual(availableBaselines(), ['20261111', '20261117', '20261118', '20261120'])
  for (const baseline of availableBaselines()) {
    const snapshot = JSON.parse(readFileSync(`${SNAPSHOT_DIR}/${baseline}.json`, 'utf8'))
    assert.equal(snapshot.baseline, baseline)
    assert.ok(Object.keys(snapshot.state.tables).length > 10, `${baseline} snapshot looks empty`)
    assert.ok(Object.keys(snapshot.state.functions).length > 20)
    assert.ok(BASELINE_NOTES[baseline], `${baseline} needs a documented meaning`)
  }
  // The 20261117 snapshot is the one the recommended production path depends on.
  const post = JSON.parse(readFileSync(`${SNAPSHOT_DIR}/20261117.json`, 'utf8')).state
  for (const table of ['daily_login_rewards', 'activity_days', 'daily_quiz_attempts', 'daily_quiz_answers',
    'daily_quiz_seen', 'daily_quiz_config', 'daily_quiz_questions', 'votes', 'profiles']) {
    assert.ok(post.tables[table], `the 20261117 snapshot must cover public.${table}`)
  }
  for (const fn of ['claim_daily_login(p_expected_user_id uuid, p_expected_day date)',
    'daily_rewards_payload(p_uid uuid, p_now timestamp with time zone)', 'my_daily_rewards_status()',
    'start_daily_quiz(p_expected_user_id uuid, p_expected_day date)',
    'submit_daily_quiz_answer(p_expected_user_id uuid, p_attempt_id uuid, p_question_id text, p_option_id text)']) {
    assert.ok(post.functions[fn], `the 20261117 snapshot must cover public.${fn}`)
  }
  assert.equal(post.config.questions_per_day, '5', 'the quiz cap is part of the fingerprint')
  assert.deepEqual(readdirSync(SNAPSHOT_DIR).filter(n => n.endsWith('.json')).sort(),
    availableBaselines().map(b => `${b}.json`))
})

test('mode A — a database equivalent to post-20261117 is verified, and only then baselined',
  { skip: !url, timeout: 180_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261117')
      const legacy = await seedUser(pool, { legacy: true })
      const { d, y } = await dayOf(pool)

      const readiness = await verifyBaseline(client, '20261117')
      assert.equal(readiness.ok, true, JSON.stringify(readiness.problems))
      assert.deepEqual(readiness.problems, [])
      assert.equal(await historyCount(client), 0, 'verification writes nothing')

      const result = await deploy(client, { baseline: '20261117' })
      assert.deepEqual(result.pending.map(({ id }) => id),
        ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'])
      const history = await historyRows(client)
      assert.ok(history.includes('20261119_preserve_legacy_daily_login_rewards'))
      assert.ok(history.includes('20261120_daily_login_reward_immutable'))
      assert.equal(history.filter(v => v.startsWith('20261118')).length, 0)
      assert.equal(history.length, result.recordedBaseline.length + 2, 'history is written only after verification passed')

      assert.equal(await rewardOf(pool, legacy, y), 2, 'a recorded amount survives the deployment')
      assert.equal(await rewardOf(pool, legacy, d), 2)
      const checks = await rewardChecks(pool)
      assert.equal(checks.table_checks, 0)
      assert.equal(checks.triggers, 1)
      const claimed = await claim(client, legacy, d)
      assert.equal(claimed.reward, 0)
      assert.equal(claimed.votes_awarded, 0)
    })
  })

test('mode A — every missing or incompatible object fails closed, writing no history',
  { skip: !url, timeout: 300_000 }, async t => {
    const cases = [
      ['missing table', 'drop table public.daily_quiz_answers cascade', 'missing-table', 'public.daily_quiz_answers'],
      ['missing unique/primary constraint', 'alter table public.daily_quiz_seen drop constraint daily_quiz_seen_pkey', 'missing-constraint', 'daily_quiz_seen'],
      ['incompatible RPC signature', `drop function public.claim_daily_login(uuid, date);
         create function public.claim_daily_login(p_expected_user_id uuid, p_expected_day date)
           returns text language sql as $f$ select 'x' $f$`, 'incompatible-function', 'claim_daily_login'],
      ['missing RPC', 'drop function public.submit_daily_quiz_answer(uuid, uuid, text, text)', 'missing-function', 'submit_daily_quiz_answer'],
      ['missing RLS', 'alter table public.daily_quiz_answers disable row level security', 'missing-rls', 'public.daily_quiz_answers'],
      ['missing policy', 'drop policy "read own votes" on public.votes', 'missing-policy', 'public.votes'],
      ['missing trigger', 'drop trigger activity_on_vote on public.votes', 'missing-trigger', 'public.votes'],
      ['missing configuration row', "delete from public.daily_quiz_config where key = 'questions_per_day'", 'missing-config', 'daily_quiz_config.questions_per_day'],
      ['wrong column type', 'alter table public.daily_quiz_answers alter column correct type text', 'incompatible-column-type', 'public.daily_quiz_answers.correct'],
    ]
    for (const [label, damage, kind, object] of cases) {
      await t.test(label, async () => {
        await withDatabase(url, async (pool, client) => {
          await installLevel(pool, '20261117')
          await seedUser(pool, { legacy: true })
          await pool.query(damage)

          const readiness = await verifyBaseline(client, '20261117')
          assert.equal(readiness.ok, false, `${label} must fail readiness verification`)
          assert.ok(readiness.problems.some(p => p.kind === kind && p.object.includes(object)),
            `expected a ${kind} problem for ${object}, got ${JSON.stringify(readiness.problems)}`)

          await assert.rejects(() => deploy(client, { baseline: '20261117' }), /not verified against this database/)
          await assert.rejects(() => plan(client, { baseline: '20261117' }), /not verified against this database/)
          assert.equal(await historyCount(client), 0, 'a failed readiness check writes no migration history')
          assert.equal((await rewardChecks(pool)).triggers, 0, 'no migration was partially applied')
        })
      })
    }

    await t.test('a partial database (several objects missing) cannot be baselined', async () => {
      await withDatabase(url, async (pool, client) => {
        await installLevel(pool, '20261117')
        await seedUser(pool, { legacy: true })
        await pool.query('drop table public.daily_quiz_answers cascade')
        await pool.query('drop function public.start_daily_quiz(uuid, date)')
        await pool.query("delete from public.daily_quiz_config where key = 'easy_count'")
        const readiness = await verifyBaseline(client, '20261117')
        assert.equal(readiness.ok, false)
        assert.ok(readiness.problems.length >= 3, JSON.stringify(readiness.problems.map(p => p.kind)))
        await assert.rejects(() => deploy(client, { baseline: '20261117' }), /not verified/)
        assert.equal(await historyCount(client), 0)
      })
    })
  })

test('mode B — a database that never applied 20261112-20261117 bootstraps instead of baselining',
  { skip: !url, timeout: 180_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261111')
      assert.equal((await verifyBaseline(client, '20261111')).ok, true, 'the core state is a verifiable baseline')
      const wrong = await verifyBaseline(client, '20261117')
      assert.equal(wrong.ok, false, 'the daily-quiz state is not there yet, so 20261117 must be refused')
      await assert.rejects(() => deploy(client, { baseline: '20261117' }), /not verified/)

      // The safe upgrade path declares the state that IS there and applies the
      // rest for real — 20261118 stays quarantined throughout.
      const result = await deploy(client, { baseline: '20261111' })
      const applied = result.pending.map(({ id }) => id)
      assert.ok(applied.includes('20261112_daily_rewards'))
      assert.ok(applied.includes('20261117_daily_quiz_flow'))
      assert.ok(applied.includes('20261119_preserve_legacy_daily_login_rewards'))
      assert.ok(applied.includes('20261120_daily_login_reward_immutable'))
      assert.equal(applied.filter(id => id.startsWith('20261118')).length, 0)

      assert.equal((await verifyBaseline(client, '20261120')).ok, true, 'the bootstrap lands in the final state')
      const user = await seedUser(pool)
      const { y } = await dayOf(pool)
      await insertHistorical(pool, user, y, 2)
      assert.equal(await rewardOf(pool, user, y), 2, 'history written on this path is preserved too')
      await assert.rejects(() => pool.query(
        'update public.daily_login_rewards set reward = 0 where user_id = $1', [user]), /err\.dailyLoginRewardImmutable/)
      assert.equal((await rewardChecks(pool)).table_checks, 0)
    })
  })

test('mode C — a fresh install reaches the final state and never runs 20261118',
  { skip: !url, timeout: 180_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, 'fresh')
      assert.equal((await verifyBaseline(client, '20261120')).ok, true, 'the fresh install is the final state')
      assert.equal((await verifyBaseline(client, '20261118')).ok, false, 'it is not the state 20261118 leaves behind')
      assert.equal((await rewardChecks(pool)).table_checks, 0, 'no table-wide reward CHECK')
      assert.equal((await rewardChecks(pool)).triggers, 1)
      const user = await seedUser(pool)
      const { y, d } = await dayOf(pool)
      await insertHistorical(pool, user, y, 2)
      assert.equal(await rewardOf(pool, user, y), 2)
      const claimed = await claim(client, user, d)
      assert.equal(claimed.reward, 0)
      assert.equal(claimed.votes_awarded, 0)
    })
  })

test('mode D — a database where 20261118 ran is detected and still moves forward',
  { skip: !url, timeout: 180_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261117')
      const legacy = await seedUser(pool, { legacy: true })
      const { y } = await dayOf(pool)
      assert.equal(await rewardOf(pool, legacy, y), 2)
      // …and then the incident: 20261118 runs and zeroes it.
      await pool.query(archivedSql('20261118_daily_login_no_votes'))
      assert.equal(await rewardOf(pool, legacy, y), 0, '20261118 already zeroed this history')

      const asIf = await verifyBaseline(client, '20261117')
      assert.equal(asIf.ok, false, 'it is not the clean post-20261117 state')
      assert.ok(asIf.notes.some(note => /20261118/.test(note)), 'the report names the incident')

      const incident = await verifyBaseline(client, '20261118')
      assert.equal(incident.ok, true, 'the incident state itself is verifiable')
      const result = await deploy(client, { baseline: '20261118' })
      assert.deepEqual(result.pending.map(({ id }) => id),
        ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'])
      const checks = await rewardChecks(pool)
      assert.equal(checks.table_checks, 0, '20261119 removed the table-wide CHECK')
      assert.equal(checks.triggers, 1)
      assert.equal(await rewardOf(pool, legacy, y), 0, 'not restored — that is the administrator-only repair')
      const history = await historyRows(client)
      assert.equal(history.filter(v => v.startsWith('20261118')).length, 0, 'the runner never records it as executed')
    })
  })

test('mode E — an unknown or partial database is refused with a diagnostic',
  { skip: !url, timeout: 180_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261111')
      await pool.query(migrationSql('20261112_daily_rewards')) // half-applied on purpose
      const results = {}
      for (const baseline of availableBaselines()) results[baseline] = (await verifyBaseline(client, baseline)).ok
      assert.deepEqual(results, { 20261111: false, 20261117: false, 20261118: false, 20261120: false },
        'no baseline may match an unknown state')
      await assert.rejects(() => deploy(client, { baseline: '20261117' }), /not verified/)
      await assert.rejects(() => deploy(client, { baseline: '20261111' }), /not verified/)
      await assert.rejects(() => plan(client), /refusing to guess/)
      assert.equal(await historyCount(client), 0)
    })
  })

test('a baseline with no committed snapshot is refused',
  { skip: !url, timeout: 120_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261117')
      await assert.rejects(() => verifyBaseline(client, '20261113'), /no readiness snapshot/)
      await assert.rejects(() => deploy(client, { baseline: '20261113' }), /no readiness snapshot/)
      assert.equal(await historyCount(client), 0)
      await assert.rejects(() => verifyBaseline(client, 'nonsense'), /invalid baseline/)
    })
  })

async function historyCount (client) {
  const { rows } = await client.query(`
    select count(*)::int as n from information_schema.tables
     where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`)
  if (!rows[0].n) return 0
  return (await client.query('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n
}
