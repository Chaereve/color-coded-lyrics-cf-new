/* Optional REAL PostgreSQL verification of 20261124_restore_daily_free_votes.
   Every scenario runs in a disposable database created and dropped by the
   shared harness; never point MIGRATION_DEPLOY_TEST_DATABASE_URL at staging or
   production.

   What is proven here:
     * the reported "Free today 0 / 0" is the live policy, not a broken client:
       with the retired value free_vote_grant_enabled = false the panel's own
       source (public.my_vote_status()) reports free_limit = 0, while the bonus
       wallet is a different column and was never broken;
     * the migration turns that into exactly 3 free votes per Vietnamese day in
       BOTH config copies, leaves the optional global cap keys untouched, and
       records the previous live policy for the corrective rollback;
     * the quota is per VIETNAMESE day and per account: it is spendable (free
       first, then bonus, then purchased), additive to the bonus wallet, never
       merged into it, and independent of the session TimeZone;
     * a policy somebody already half-flipped (switch on, count not 3) converges
       and records what it actually found;
     * the guarded runner applies the file on the fresh-install path and the
       committed 20261120 baseline still verifies READY afterwards — the change
       is config-only, so no baseline or fingerprint moves;
     * nothing else moves: wallets, vote rows, check-in rows, quiz rows and the
       neutral ledger keep their counts and sums, and Daily Login awards nothing;
     * unknown states abort before anything is written (drifted copies, an
       incomplete copy, an enabled global cap that cannot leave 3 free votes, a
       live path that no longer reads the neutral config, missing history, an
       already-recorded version);
     * the rollback restores exactly the recorded policy and refuses to run
       twice. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { withDatabase, installLevel, migrationSql, dayOf, seedUser } from './_fixtures.mjs'
import { applyMigration, ensureHistory, readHistory, deploy } from '../../tools/migrate.mjs'
import { verifyBaseline } from '../../tools/schema-readiness.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const MIGRATION_ID = '20261124_restore_daily_free_votes'
const MIGRATION = {
  id: MIGRATION_ID,
  name: `${MIGRATION_ID}.sql`,
  sql: migrationSql(MIGRATION_ID),
}
const ROLLBACK = readFileSync(new URL('../rollback/20261124_restore_daily_free_votes.sql', import.meta.url), 'utf8')

/* The cutover chain that must already be recorded before 20261124 may run, and
   the baseline history rows 20261121 requires for its own preflight. */
const CHAIN = ['20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
  '20261123_reconcile_security_drift']
const BASELINE_HISTORY = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz',
  '20261114_daily_rewards_upgrade', '20261115_daily_quiz_schema', '20261116_daily_quiz_pool',
  '20261117_daily_quiz_flow', '20261119_preserve_legacy_daily_login_rewards',
  '20261120_daily_login_reward_immutable']

/** The state 20261124 expects: the 20261120 baseline installed the long way,
 *  then the cutover chain in order — each with the history row that proves it. */
async function postCutoverState (pool, client) {
  await installLevel(pool, '20261117')
  await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
  await pool.query(migrationSql('20261120_daily_login_reward_immutable'))
  await ensureHistory(client)
  for (const version of BASELINE_HISTORY) {
    await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name)
                        values ($1, '{}', $2)`, [version, `${version}.sql`])
  }
  for (const name of CHAIN) {
    await pool.query(migrationSql(name))
    await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name)
                        values ($1, '{}', $2)`, [name, `${name}.sql`])
  }
}

/** Row counts and both wallet sums: the "only config moved" view.
 *  `ledger` is null while public.daily_vote_quota_earnings does not exist yet:
 *  the fresh 20261120 bundle predates 20261121, which is the migration that
 *  creates it, so the fresh-install case has no ledger to count. */
const snapshot = async pool => {
  const row = (await pool.query(`
    select (select count(*)::int from public.profiles)                    as profiles,
           (select count(*)::int from public.votes)                       as votes,
           (select count(*)::int from public.daily_login_rewards)         as checkins,
           (select count(*)::int from public.daily_quiz_answers)          as quiz_answers,
           (select coalesce(sum(vote_credits), 0)::int from public.profiles)  as vote_credits,
           (select coalesce(sum(bonus_credits), 0)::int from public.profiles) as bonus_credits`)).rows[0]
  const exists = (await pool.query(
    "select to_regclass('public.daily_vote_quota_earnings') is not null as ok")).rows[0].ok
  const ledger = exists
    ? (await pool.query('select count(*)::int as n from public.daily_vote_quota_earnings')).rows[0].n
    : null
  return { ...row, ledger }
}

/** Both config copies, the four quota keys only. */
const quotaOf = async pool => (await pool.query(`
  select
    (select value from public.daily_vote_quota_config where key = 'free_vote_grant_enabled')       as neutral_enabled,
    (select value from public.daily_vote_quota_config where key = 'free_votes_per_day')            as neutral_per_day,
    (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled') as neutral_cap_enabled,
    (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap')         as neutral_cap,
    (select value from public.daily_quiz_config where key = 'free_vote_grant_enabled')             as source_enabled,
    (select value from public.daily_quiz_config where key = 'free_votes_per_day')                  as source_per_day,
    (select value from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled')       as source_cap_enabled,
    (select value from public.daily_quiz_config where key = 'global_daily_vote_cap')               as source_cap`)).rows[0]

const walletOf = async (pool, userId) => (await pool.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [userId])).rows[0]

const commentOf = async pool => (await pool.query(
  "select obj_description('public.daily_vote_quota_config'::regclass, 'pg_class') as c")).rows[0].c

/** The previous live policy, read from the record 20261124 wrote. */
const recordedPolicy = text => JSON.parse(
  text.match(/20261124_restore_daily_free_votes previous live policy: (\{[^}]*\})/)[1])

/** The panel's own numbers: src/App.jsx renders free_left / free_limit from
 *  public.my_vote_status(), with free_left = max(0, free_limit - free_used). */
async function statusOf (client, userId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  const row = (await client.query('select * from public.my_vote_status()')).rows[0]
  return { ...row, free_left: Math.max(0, row.free_limit - row.free_used) }
}

const grantOf = async (pool, userId, day) => (await pool.query(
  'select public.daily_free_vote_grant($1, $2)::int as n', [userId, day])).rows[0].n

/** A free vote recorded on a specific Vietnam day, exactly as cast_vote stores
 *  it (credit_kind = 'free', free_slot 1..3, one row per slot). */
async function seedFreeVote (pool, userId, day, slot = 1) {
  const requestId = randomUUID()
  await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1, $2, 'A', 'B', 'queued')",
    [requestId, userId])
  await pool.query(`insert into public.votes (request_id, user_id, used_credit, credit_kind, vote_day, free_slot)
    values ($1, $2, false, 'free', $3::date, $4)`, [requestId, userId, day, slot])
  return requestId
}

async function expectFailure (client, sql, pattern) {
  await assert.rejects(async () => { await client.query(sql) }, pattern)
  await client.query('rollback').catch(() => {})
}

/** Flip the live policy in both copies to one of the states 20261124 must handle. */
async function setLivePolicy (pool, [enabled, perDay, capEnabled, cap]) {
  const keys = [['free_vote_grant_enabled', enabled], ['free_votes_per_day', perDay],
    ['global_daily_vote_cap_enabled', capEnabled], ['global_daily_vote_cap', cap]]
  for (const table of ['daily_quiz_config', 'daily_vote_quota_config']) {
    const exists = await pool.query('select to_regclass($1) is not null as ok', [`public.${table}`])
    if (!exists.rows[0].ok) continue
    for (const [key, value] of keys) {
      await pool.query(`update public.${table} set value = $1::jsonb where key = $2`,
        [JSON.stringify(value), key])
    }
  }
}

test('the reported 0 / 0 is the live policy, and 20261124 turns it into 3 free votes per Vietnamese day',
  { skip: !url, timeout: 240_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await postCutoverState(pool, client)
      const { d, y } = await dayOf(pool)
      const userId = await seedUser(pool)
      const before = await snapshot(pool)
      const walletBefore = await walletOf(pool, userId)

      /* The symptom, reproduced from the data path the browser reads. */
      const retired = await statusOf(client, userId)
      assert.deepEqual({
        free_used: retired.free_used, free_limit: retired.free_limit, free_left: retired.free_left,
      }, { free_used: 0, free_limit: 0, free_left: 0 }, 'with the switch off the panel renders "Free today 0 / 0"')
      assert.equal(retired.bonus, 4, 'the bonus wallet is a different column — it was never broken')
      assert.equal(retired.purchased, 7)
      assert.equal(await grantOf(pool, userId, d), 0)

      await applyMigration(client, MIGRATION)

      /* 0 used of 3 granted — the panel renders 3 / 3 — bonus still separate. */
      const fixed = await statusOf(client, userId)
      assert.deepEqual({
        free_used: fixed.free_used, free_limit: fixed.free_limit, free_left: fixed.free_left,
      }, { free_used: 0, free_limit: 3, free_left: 3 }, 'an unused Vietnamese day shows the full daily quota')
      assert.equal(fixed.bonus, 4, 'the daily quota is not merged into the bonus wallet')
      assert.equal(fixed.purchased, 7)
      assert.equal(fixed.credits, 11, 'credits stay purchased + bonus (7 + 4)')
      assert.equal(await grantOf(pool, userId, d), 3, 'today grants 3 free votes')
      assert.equal(await grantOf(pool, randomUUID(), d), 3, 'every account gets the same 3 free votes')
      assert.equal(await grantOf(pool, userId, y), 3, 'it is a per-day entitlement, not a single pool')

      /* Both copies carry the target policy; the optional cap pair is untouched. */
      assert.deepEqual(await quotaOf(pool), {
        neutral_enabled: true, neutral_per_day: 3, neutral_cap_enabled: false, neutral_cap: 5,
        source_enabled: true, source_per_day: 3, source_cap_enabled: false, source_cap: 5,
      }, 'both config copies are flipped together and the cap keys keep their live values')
      assert.deepEqual(recordedPolicy(await commentOf(pool)), {
        free_vote_grant_enabled: false, free_votes_per_day: 3,
        global_daily_vote_cap_enabled: false, global_daily_vote_cap: 5,
      }, 'the previous live policy is recorded for the corrective rollback')

      /* Config-only: no function replaced, no row count and no wallet sum moved. */
      const body = (await pool.query(
        "select pg_get_functiondef('public.daily_free_vote_grant(uuid,date)'::regprocedure) as b")).rows[0].b
      assert.match(body, /daily_vote_quota_bool/, 'the migration fixes the policy, not the vote functions')
      assert.deepEqual(await snapshot(pool), before, 'no row count and no wallet sum moved')
      assert.deepEqual(await walletOf(pool, userId), walletBefore)
      assert.deepEqual(await readHistory(client), [...BASELINE_HISTORY, ...CHAIN, MIGRATION_ID],
        'the guarded runner records exactly one new history row')
    })
  })

test('the 3 free votes are spendable per Vietnamese day, additive to bonus and independent of the TimeZone',
  { skip: !url, timeout: 240_000 }, async t => {
    await t.test('spending order stays free -> bonus -> purchased, and refunds never become wallet credit', async () => {
      await withDatabase(url, async (pool, client) => {
        await postCutoverState(pool, client)
        const userId = await seedUser(pool)
        await applyMigration(client, MIGRATION)

        const request = randomUUID()
        await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1, $2, 'A', 'B', 'queued')",
          [request, userId])
        await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
        const cast = delta => client.query('select * from public.cast_vote($1, $2)', [request, delta])

        await cast(3)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 4 },
          'the daily quota is spent before any wallet')
        assert.equal((await statusOf(client, userId)).free_used, 3)
        const spent = await statusOf(client, userId)
        assert.deepEqual({ free_left: spent.free_left, bonus: spent.bonus, purchased: spent.purchased },
          { free_left: 0, bonus: 4, purchased: 7 }, 'the quota is used up and the bonus wallet is untouched')
        await cast(1)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 3 }, 'then bonus')
        await cast(3)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 0 })
        await cast(1)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 6, bonus_credits: 0 }, 'purchased last')

        /* Refunds return to the wallet kinds they came from; a free vote was never
           a wallet balance, so deleting the free rows simply gives that Vietnam day
           its quota back. */
        await cast(-8)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 4 },
          'the wallet is whole again after the refund')
        const refunded = await statusOf(client, userId)
        assert.deepEqual({ free_used: refunded.free_used, free_left: refunded.free_left },
          { free_used: 0, free_left: 3 }, 'the same Vietnam day gets its 3 free votes back')
        /* Only free rows exist now, so the second refund can only be a wallet no-op. */
        await cast(3)
        await cast(-3)
        assert.deepEqual(await walletOf(pool, userId), { vote_credits: 7, bonus_credits: 4 },
          'deleting free rows moves no wallet balance')
        const secondRefund = await statusOf(client, userId)
        assert.deepEqual({ free_used: secondRefund.free_used, free_left: secondRefund.free_left },
          { free_used: 0, free_left: 3 }, 'free votes are not refunded into a wallet')
      })
    })

    await t.test('a free vote from another Vietnam day neither counts nor is lost', async () => {
      await withDatabase(url, async (pool, client) => {
        await postCutoverState(pool, client)
        const { d, y } = await dayOf(pool)
        const userId = await seedUser(pool)
        await applyMigration(client, MIGRATION)
        await seedFreeVote(pool, userId, y, 1)

        assert.equal(await grantOf(pool, userId, d), 3, 'yesterday\'s free vote does not shrink today\'s grant')
        const status = await statusOf(client, userId)
        assert.equal(status.free_used, 0, 'rows dated before today are not charged to today')
        assert.equal(status.free_limit, 3)
        assert.equal((await pool.query(
          'select count(*)::int as n from public.votes where user_id = $1 and vote_day = $2',
          [userId, y])).rows[0].n, 1, 'the free vote recorded on the previous Vietnam day is still there')

        /* The Vietnam day comes from the server clock, not the session TimeZone. */
        for (const zone of ['America/New_York', 'UTC', 'Pacific/Kiritimati']) {
          await client.query(`set timezone = '${zone}'`)
          const shifted = await statusOf(client, userId)
          assert.equal(shifted.free_used, 0, `the Vietnam day is not the session day (${zone})`)
          assert.equal(shifted.free_limit, 3)
        }
      })
    })

    await t.test('a policy somebody already half-flipped converges and records what it found', async () => {
      await withDatabase(url, async (pool, client) => {
        await postCutoverState(pool, client)
        const { d } = await dayOf(pool)
        const userId = await seedUser(pool)
        await setLivePolicy(pool, [true, 5, false, 5])
        assert.equal(await grantOf(pool, userId, d), 5, 'the half-flipped policy is live before the migration')

        await applyMigration(client, MIGRATION)

        assert.deepEqual(await quotaOf(pool), {
          neutral_enabled: true, neutral_per_day: 3, neutral_cap_enabled: false, neutral_cap: 5,
          source_enabled: true, source_per_day: 3, source_cap_enabled: false, source_cap: 5,
        }, 'only the count moved: the switch was already on')
        assert.equal(await grantOf(pool, userId, d), 3)
        assert.deepEqual(recordedPolicy(await commentOf(pool)), {
          free_vote_grant_enabled: true, free_votes_per_day: 5,
          global_daily_vote_cap_enabled: false, global_daily_vote_cap: 5,
        }, 'the record is what the rollback will restore, not the repo seed')
      })
    })
  })

test('the guarded runner applies it on the fresh-install path and the 20261120 baseline still verifies READY',
  { skip: !url, timeout: 240_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, 'fresh')
      const { d } = await dayOf(pool)
      const userId = await seedUser(pool)
      const before = await snapshot(pool)
      assert.equal(await grantOf(pool, userId, d), 0, 'the bundle seed still ships the retired policy')

      const result = await deploy(client, { baseline: '20261120' })
      assert.deepEqual(result.pending.map(({ id }) => id), [
        '20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
        '20261123_reconcile_security_drift', MIGRATION_ID,
        '20261125_reward_eligibility_and_quota_races',
      ])
      assert.ok((await readHistory(client)).includes(MIGRATION_ID))

      assert.equal(await grantOf(pool, userId, d), 3, 'after the documented deploy path the daily quota is live')
      const fixed = await statusOf(client, userId)
      assert.deepEqual({ free_used: fixed.free_used, free_limit: fixed.free_limit }, { free_used: 0, free_limit: 3 })
      const after = await snapshot(pool)
      assert.equal(after.ledger, 0, 'the deploy created the earnings ledger, empty')
      assert.deepEqual({ ...after, ledger: before.ledger }, before,
        'the deploy moved no wallet and wrote no vote')

      /* Config values are deliberately outside the fingerprint comparison
         (LIVE_VOTE_QUOTA_CONFIG_KEYS), so a post-20261124 database is still the
         committed 20261120 state — no new baseline or fingerprint is needed. */
      const readiness = await verifyBaseline(client, '20261120')
      assert.equal(readiness.ok, true, JSON.stringify(readiness.problems))
      /* Re-running the documented command changes nothing. */
      const again = await deploy(client)
      assert.deepEqual(again.pending, [])
    })
  })

test('Daily Login still awards nothing while the 3 free votes per day are on',
  { skip: !url, timeout: 240_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await postCutoverState(pool, client)
      const { d } = await dayOf(pool)
      const userId = await seedUser(pool)
      await applyMigration(client, MIGRATION)
      const walletBefore = await walletOf(pool, userId)

      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
      const claim = JSON.parse((await client.query(
        'select public.claim_daily_login_calendar($1::date)::text as r', [d])).rows[0].r)
      assert.equal(claim.replayed, false)
      assert.equal(claim.status.login.claimed, true)
      assert.equal(Object.keys(claim.status.login).some(key => /reward|vote|credit/i.test(key)), false,
        'the calendar payload has no vote/credit reward field at all')
      assert.deepEqual(await walletOf(pool, userId), walletBefore, 'a check-in pays no bonus either')
      assert.equal((await statusOf(client, userId)).free_limit, 3, 'a check-in does not change the daily quota')
      assert.equal((await pool.query('select count(*)::int as n from public.daily_vote_quota_earnings')).rows[0].n, 0,
        'a check-in writes no vote earning')
      assert.equal((await pool.query(
        'select count(*)::int as n from public.daily_login_rewards where user_id = $1 and reward <> 0',
        [userId])).rows[0].n, 0, 'the recorded check-in amount stays 0')
      assert.equal((await pool.query(`select count(*)::int as n from pg_trigger
        where tgrelid = 'public.daily_login_rewards'::regclass
          and tgname = 'daily_login_rewards_no_vote' and not tgisinternal and tgenabled = 'O'`)).rows[0].n, 1,
      'the check-in amount immutability trigger is still active')
    })
  })

test('unknown states abort before the switch is flipped', { skip: !url, timeout: 300_000 }, async t => {
  const cases = [
    ['the two config copies drifted apart', async pool => {
      await pool.query("update public.daily_quiz_config set value = '5'::jsonb where key = 'free_votes_per_day'")
    }, /err\.dailyFreeVotesPreflight: the two live quota config copies differ/],
    ['a quota key is missing from one copy', async pool => {
      await pool.query("delete from public.daily_quiz_config where key = 'global_daily_vote_cap'")
    }, /err\.dailyFreeVotesPreflight: the source quota config is incomplete \(daily_quiz_config\)/],
    ['the global cap cannot leave 3 free votes for today\'s largest earner', async pool => {
      await setLivePolicy(pool, [false, 3, true, 2])
    }, /err\.dailyFreeVotesPreflight: global_daily_vote_cap_enabled is on and global_daily_vote_cap \(2\) minus the largest earning recorded for today \(0\) leaves fewer than 3 free votes/],
    ['today\'s largest earner already ate the cap', async pool => {
      await setLivePolicy(pool, [false, 3, true, 5])
      await pool.query(`insert into public.daily_vote_quota_earnings (source, user_id, vote_day, source_key, amount)
                        values ('daily_quiz', $1, $2, 'probe', 3)`, [randomUUID(), (await dayOf(pool)).d])
    }, /err\.dailyFreeVotesPreflight: global_daily_vote_cap_enabled is on and global_daily_vote_cap \(5\) minus the largest earning recorded for today \(3\) leaves fewer than 3 free votes/],
    ['the live grant no longer reads the neutral config', async pool => {
      await pool.query(`create or replace function public.daily_free_vote_grant(p_uid uuid, p_day date)
        returns integer language sql stable security definer set search_path = public as $$ select 0 $$`)
    }, /err\.dailyFreeVotesPreflight: daily_free_vote_grant\(\) does not evaluate the neutral quota config/],
    ['a cutover row is missing from the history', async pool => {
      await pool.query("delete from supabase_migrations.schema_migrations where version = '20261122_disable_daily_quiz_runtime'")
    }, /err\.dailyFreeVotesPreflight: required migration state missing \(20261122_disable_daily_quiz_runtime\|20261122\)/],
    ['20261124 is already recorded as applied', async pool => {
      await pool.query(`insert into supabase_migrations.schema_migrations (version, statements, name)
                        values ($1, '{}', $2)`, [MIGRATION_ID, `${MIGRATION_ID}.sql`])
    }, /err\.dailyFreeVotesPreflight: 20261124 is already recorded as applied/],
  ]

  for (const [name, mutate, pattern] of cases) {
    await t.test(name, async () => {
      await withDatabase(url, async (pool, client) => {
        await postCutoverState(pool, client)
        const userId = await seedUser(pool)
        await mutate(pool)
        /* The damaged state itself is the baseline: a refused run must not add
           to it either. */
        const damagedQuota = await quotaOf(pool)
        const damaged = await snapshot(pool)
        const damagedHistory = await readHistory(client)
        await expectFailure(client, MIGRATION.sql, pattern)
        assert.deepEqual(await readHistory(client), damagedHistory,
          'a refused migration writes no history row')
        assert.deepEqual(await quotaOf(pool), damagedQuota,
          'a refused migration writes no config value — the file never half-applies')
        assert.deepEqual(await snapshot(pool), damaged, 'a refused migration moves no row and no wallet sum')
        const status = await statusOf(client, userId)
        assert.equal(status.free_used, 0)
        assert.equal(status.free_limit, 0, 'the live policy is still the untrusted one')
      })
    })
  }
})

test('the corrective rollback restores the recorded policy and refuses to run twice',
  { skip: !url, timeout: 240_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await postCutoverState(pool, client)
      const { d } = await dayOf(pool)
      const userId = await seedUser(pool)
      const before = await snapshot(pool)
      const walletBefore = await walletOf(pool, userId)
      await applyMigration(client, MIGRATION)
      assert.equal((await statusOf(client, userId)).free_limit, 3)

      await client.query(ROLLBACK)
      assert.deepEqual(await quotaOf(pool), {
        neutral_enabled: false, neutral_per_day: 3, neutral_cap_enabled: false, neutral_cap: 5,
        source_enabled: false, source_per_day: 3, source_cap_enabled: false, source_cap: 5,
      }, 'both copies are back to the recorded previous policy')
      assert.equal((await statusOf(client, userId)).free_limit, 0, 'the panel is back to "0 / 0" after a rollback')
      assert.equal(await grantOf(pool, userId, d), 0)
      assert.deepEqual(await snapshot(pool), before, 'a config rollback moves no wallet and no history row')
      assert.deepEqual(await walletOf(pool, userId), walletBefore)
      assert.doesNotMatch(await commentOf(pool), /previous live policy/, 'the record is cleared')

      await expectFailure(client, ROLLBACK,
        /err\.dailyFreeVotesRollback: the live policy is not the state 20261124 installed/)
      assert.equal((await statusOf(client, userId)).free_limit, 0, 'a refused rollback changes nothing')

      /* The version stays recorded, so re-enabling the quota is a new forward
         migration — never a second run of this file. */
      await expectFailure(client, MIGRATION.sql,
        /err\.dailyFreeVotesPreflight: 20261124 is already recorded as applied/)
    })
  })
