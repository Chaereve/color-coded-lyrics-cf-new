/* Real PostgreSQL (WASM) verification of 20261124_restore_daily_free_votes —
 * no server, no credentials, no network.
 *
 * `supabase/tests/dailyFreeVotes.test.js` needs a disposable Postgres
 * (`MIGRATION_DEPLOY_TEST_DATABASE_URL`) and is skipped everywhere one is not
 * configured, which is exactly how a strict preflight assertion can rot
 * unnoticed. This suite builds the same post-20261123 state inside PGlite
 * (PostgreSQL compiled to WASM, bundled locally), runs the real migration file
 * and the real rollback file against it, and claims the product contract:
 *
 *   * the reported "Free today 0 / 0" is reproduced from the live policy
 *     (free_vote_grant_enabled = false) and then fixed to 0 used / 3 granted —
 *     i.e. the panel renders 3 / 3 — without touching the bonus wallet;
 *   * the grant is per VIETNAMESE day (Asia/Ho_Chi_Minh), for every account,
 *     and a free vote recorded on another VN day neither counts nor is lost;
 *   * spending order stays free -> bonus -> purchased, so the daily quota is
 *     additive to the bonus wallet, never merged into it;
 *   * Daily Login still awards nothing;
 *   * the file is config-only: no function/ACL/table changes, wallets, vote
 *     history, check-in history and the neutral ledger keep their rows;
 *   * every untrusted state (drifted copies, a cap that cannot leave 3 free
 *     votes, a live path that does not read the neutral config, missing history)
 *     aborts and changes nothing;
 *   * the corrective rollback restores exactly the recorded previous policy and
 *     refuses to run twice.
 *
 * It is opt-in (`npm run test:free-votes:pglite`) so the default `npm test` run
 * stays fast, and it is wired into the DB migration safety workflow so CI runs
 * it on every push. Production runs on the Supabase Postgres image; this is a
 * second, independent engine where the file must still behave.
 */
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
const MIGRATION_ID = '20261124_restore_daily_free_votes'
const MIGRATION = read(`supabase/migrations/${MIGRATION_ID}.sql`)
const ROLLBACK = read('supabase/rollback/20261124_restore_daily_free_votes.sql')
/* What a database is expected to contain when 20261124 may run. */
const LEVELS = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable']
const CHAIN = ['20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
  '20261123_reconcile_security_drift']

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

/* The live policy production carried when the panel showed "Free today 0 / 0":
 * the retired automatic grant is off and the optional global cap is off too, so
 * daily_free_vote_grant() evaluates to 0 while the bonus wallet is untouched. */
const LIVE_POLICY = [['free_vote_grant_enabled', false], ['free_votes_per_day', 3],
  ['global_daily_vote_cap_enabled', false], ['global_daily_vote_cap', 5]]

/** Builds the state 20261124 expects: the install baseline through 20261117,
 *  then 20261119/20261120, then the cutover chain 20261121 → 20261123, with the
 *  guarded-runner history rows for each step. `omitHistory` models a database
 *  whose migration state cannot be trusted. */
async function buildPostChain ({ omitHistory = [] } = {}) {
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
  for (const version of LEVELS.filter(value => !omitHistory.includes(value))) await record(version)
  for (const version of CHAIN) {
    await db.exec(read(`supabase/migrations/${version}.sql`))
    if (!omitHistory.includes(version)) await record(version)
  }
  const { d, y } = (await db.query(
    `select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text as d,
            ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1)::text as y`)).rows[0]
  return { db, day: d, previousDay: y }
}

/** One account with both wallets funded, the bonus wallet deliberately non-zero
 *  so "the quota is separate from bonus" is observable. */
async function seedAccount (db, { freeVotesOnDay = null } = {}) {
  const id = (await db.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), 'free-votes@example.test') returning id")).rows[0].id
  await db.query('update public.profiles set vote_credits = 7, bonus_credits = 4 where id = $1', [id])
  if (freeVotesOnDay) {
    const requestId = (await db.query(`insert into public.requests (id, user_id, artist, title, status)
      values (gen_random_uuid(), $1, 'A', 'B', 'queued') returning id`, [id])).rows[0].id
    await db.query(`insert into public.votes (request_id, user_id, used_credit, credit_kind, vote_day, free_slot)
      values ($1, $2, false, 'free', $3::date, 1)`, [requestId, id, freeVotesOnDay])
  }
  return id
}

/** Mirrors `applyMigration` in tools/migrate.mjs: the file's own BEGIN/COMMIT is
 *  stripped by the runner, which writes the history row in the same transaction. */
async function applyMigration (db, { record = true } = {}) {
  await db.exec(MIGRATION)
  if (record) {
    await db.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
      [MIGRATION_ID, [], `${MIGRATION_ID}.sql`])
  }
}

/** Runs SQL that must fail, then clears the aborted transaction so the session
 *  can be inspected, exactly like `assert.rejects` + `rollback` in the DB-gated
 *  suite. */
async function rejected (db, sql, pattern, params = []) {
  let error = null
  try {
    if (params.length) await db.query(sql, params)
    else await db.exec(sql)
  } catch (caught) { error = caught } finally {
    await db.exec('rollback').catch(() => {})
  }
  assert.ok(error, `expected the SQL to fail with ${pattern}`)
  assert.match(error.message, pattern)
}

const statusOf = async (db, id) => {
  /* my_vote_status() identifies the caller through auth.uid(); the caller's
     session claim is restored afterwards so a probe never changes who the next
     statement runs as. */
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  const row = (await db.query('select * from public.my_vote_status()')).rows[0]
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  /* The panel computes exactly this (src/App.jsx: freeLeft = free_limit -
     free_used) and renders `freeLeft / free_limit` under "Free today". */
  return { ...row, free_left: Math.max(0, row.free_limit - row.free_used) }
}
const walletOf = async (db, id) => (await db.query(
  'select vote_credits, bonus_credits from public.profiles where id = $1', [id])).rows[0]
const grantOf = async (db, id, day) => (await db.query(
  'select public.daily_free_vote_grant($1, $2)::int as n', [id, day])).rows[0].n
const quotaOf = async db => (await db.query(`
  select
    (select value from public.daily_vote_quota_config where key = 'free_vote_grant_enabled') as neutral_enabled,
    (select value from public.daily_vote_quota_config where key = 'free_votes_per_day') as neutral_per_day,
    (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap_enabled') as neutral_cap_enabled,
    (select value from public.daily_vote_quota_config where key = 'global_daily_vote_cap') as neutral_cap,
    (select value from public.daily_quiz_config where key = 'free_vote_grant_enabled') as source_enabled,
    (select value from public.daily_quiz_config where key = 'free_votes_per_day') as source_per_day,
    (select value from public.daily_quiz_config where key = 'global_daily_vote_cap_enabled') as source_cap_enabled,
    (select value from public.daily_quiz_config where key = 'global_daily_vote_cap') as source_cap`)).rows[0]
const commentOf = async db => (await db.query(
  "select obj_description('public.daily_vote_quota_config'::regclass, 'pg_class') as c")).rows[0].c
/** The recorded previous policy, parsed exactly the way the rollback parses it. */
const recordedPolicy = text => JSON.parse(
  text.match(/20261124_restore_daily_free_votes previous live policy: (\{[^}]*\})/)[1])
const functionBody = async (db, signature) => (await db.query(
  `select pg_get_functiondef('${signature}'::regprocedure) as body`)).rows[0].body
/** Row counts and both wallet sums: the "nothing but the two policy keys moved"
 *  snapshot. */
const stateOf = async db => (await db.query(`
  select (select count(*)::int from public.profiles) as profiles,
         (select count(*)::int from public.votes) as votes,
         (select count(*)::int from public.daily_login_rewards) as checkins,
         (select count(*)::int from public.daily_vote_quota_earnings) as ledger,
         (select count(*)::int from public.daily_quiz_answers) as answers,
         (select coalesce(sum(vote_credits), 0)::int from public.profiles) as vote_credits,
         (select coalesce(sum(bonus_credits), 0)::int from public.profiles) as bonus_credits`)).rows[0]

test('the reported 0 / 0 becomes 0 used of 3 granted, with the bonus wallet untouched',
  { timeout: 240_000 }, async () => {
    const { db, day, previousDay } = await buildPostChain()
    const userId = await seedAccount(db, { freeVotesOnDay: previousDay })
    const before = await stateOf(db)
    const beforeWallet = await walletOf(db, userId)

    /* Reproduce the symptom from the live policy, not from a broken client. */
    const broken = await statusOf(db, userId)
    assert.deepEqual({ free_used: broken.free_used, free_limit: broken.free_limit, free_left: broken.free_left },
      { free_used: 0, free_limit: 0, free_left: 0 }, 'the live policy grants nothing: the panel renders "0 / 0"')
    assert.equal(broken.bonus, 4, 'the bonus wallet is a separate column and was never affected')
    assert.equal(broken.purchased, 7)
    assert.equal(await grantOf(db, userId, day), 0)

    await applyMigration(db)

    /* The exact values the panel reads: 0 used of 3 granted (rendered 3 / 3),
       bonus untouched and still reported separately. */
    const after = await statusOf(db, userId)
    assert.deepEqual({ free_used: after.free_used, free_limit: after.free_limit, free_left: after.free_left },
      { free_used: 0, free_limit: 3, free_left: 3 }, 'an unused Vietnamese day shows the full daily quota')
    assert.equal(after.bonus, 4, 'the daily quota is not merged into the bonus wallet')
    assert.equal(after.purchased, 7)
    assert.equal(after.credits, 11, 'credits stay purchased + bonus (7 + 4)')

    /* Per-day entitlement for every account, on any Vietnam day. */
    assert.equal(await grantOf(db, userId, day), 3)
    assert.equal(await grantOf(db, userId, previousDay), 3)
    assert.equal(await grantOf(db, '00000000-0000-0000-0000-0000000000ff', day), 3,
      'a brand-new account gets the same 3 free votes')

    /* Both copies carry the target policy; the optional cap keys are untouched
       (they are the values the deployed worker/frontend never had to change). */
    assert.deepEqual(await quotaOf(db), {
      neutral_enabled: true, neutral_per_day: 3, neutral_cap_enabled: false, neutral_cap: 5,
      source_enabled: true, source_per_day: 3, source_cap_enabled: false, source_cap: 5,
    }, 'both config copies are flipped together and the cap keys keep their values')

    /* Config-only: no function is redefined, no wallet/vote/check-in/ledger row
       changed, and the previous policy is recorded for the rollback. */
    assert.match(await functionBody(db, 'public.daily_free_vote_grant(uuid,date)'), /daily_vote_quota_bool/,
      'the migration fixes the policy, it does not rewrite the vote functions')
    assert.deepEqual(await stateOf(db), before, 'no row count and no wallet sum moved')
    assert.deepEqual(await walletOf(db, userId), beforeWallet)
    assert.deepEqual(recordedPolicy(await commentOf(db)),
      { free_vote_grant_enabled: false, free_votes_per_day: 3,
        global_daily_vote_cap_enabled: false, global_daily_vote_cap: 5 },
      'the previous live policy is recorded verbatim for the corrective rollback')

    await db.close()
  })

test('3 free votes per Vietnamese day are spendable, additive to bonus, and reset at the VN day boundary',
  { timeout: 240_000 }, async () => {
    const { db, day, previousDay } = await buildPostChain()
    /* Yesterday's free vote: it must not consume today's quota. */
    const userId = await seedAccount(db, { freeVotesOnDay: previousDay })
    await applyMigration(db)

    const requestId = (await db.query(`insert into public.requests (id, user_id, artist, title, status)
      values (gen_random_uuid(), $1, 'A', 'B', 'queued') returning id`, [userId])).rows[0].id
    /* cast_vote() identifies the voter through auth.uid(), exactly as PostgREST
       does with the caller's session. */
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    const cast = async delta => (await db.query(
      'select * from public.cast_vote($1, $2, null, null, null)', [requestId, delta])).rows[0]

    /* The VN day is computed from the server clock, never from the session
       timezone: the same rows answer the same way under a different TimeZone. */
    await db.exec("set timezone = 'UTC'")
    assert.equal((await statusOf(db, userId)).free_used, 0,
      'a free vote recorded on the previous Vietnam day does not count against today')
    assert.equal((await statusOf(db, userId)).free_limit, 3)
    await db.exec("set timezone = 'America/New_York'")
    assert.equal((await statusOf(db, userId)).free_used, 0, 'the Vietnam day is explicit, not session-local')
    await db.exec("set timezone = 'UTC'")

    /* Three free votes come out of the daily quota and touch no wallet. */
    const first = await cast(3)
    assert.equal(first.free_used, 3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 4 },
      'the daily quota is spent before any wallet')
    const spent = await statusOf(db, userId)
    assert.deepEqual({ free_left: spent.free_left, bonus: spent.bonus, purchased: spent.purchased },
      { free_left: 0, bonus: 4, purchased: 7 }, 'the quota is used up and the bonus wallet is untouched')

    /* The fourth vote is additive: it comes from bonus, not from a merged quota. */
    await cast(1)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 3 })
    await cast(3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 0 })
    await cast(1)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 6, bonus_credits: 0 }, 'purchased last')

    /* Refunds return to the wallet kinds they came from; free votes were never a
       wallet balance, so deleting them gives the same Vietnam day its quota back
       instead of adding a credit somewhere else. */
    await cast(-8)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 4 },
      'a refund restores bought and bonus votes to their own columns')
    let refunded = await statusOf(db, userId)
    assert.deepEqual({ free_used: refunded.free_used, free_left: refunded.free_left },
      { free_used: 0, free_left: 3 }, 'the same Vietnam day gets its 3 free votes back')
    /* Only free rows exist now, so the second refund can only be a wallet no-op. */
    await cast(3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 4 })
    await cast(-3)
    assert.deepEqual(await walletOf(db, userId), { vote_credits: 7, bonus_credits: 4 },
      'deleting free rows moves no wallet balance')
    refunded = await statusOf(db, userId)
    assert.deepEqual({ free_used: refunded.free_used, free_left: refunded.free_left },
      { free_used: 0, free_left: 3 }, 'free votes are not refunded into a wallet')

    /* Tomorrow's rows are the next day's business: a row dated after today must
       not be counted either (clock skew must not eat the quota). */
    const tomorrow = (await db.query('select ($1::date + 1)::date::text as x', [day])).rows[0].x
    await db.query(`insert into public.votes (request_id, user_id, used_credit, credit_kind, vote_day, free_slot)
      values ($1, $2, false, 'free', $3::date, 1)`, [requestId, userId, tomorrow])
    assert.equal((await statusOf(db, userId)).free_used, 0)
    assert.equal((await statusOf(db, userId)).free_left, 3,
      'the quota is per Vietnam day: yesterday and tomorrow are never charged to today')

    await db.close()
  })

test('Daily Login still awards nothing while the daily quota is on', { timeout: 240_000 }, async () => {
  const { db, day } = await buildPostChain()
  const userId = await seedAccount(db)
  await applyMigration(db)
  const before = await walletOf(db, userId)

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  const claim = JSON.parse((await db.query(
    'select public.claim_daily_login_calendar($1::date)::text as r', [day])).rows[0].r)
  assert.equal(claim.replayed, false)
  assert.equal(claim.status.login.claimed, true)
  assert.deepEqual(await walletOf(db, userId), before, 'a check-in pays no votes and no bonus')
  assert.equal((await statusOf(db, userId)).free_limit, 3, 'the daily quota is unaffected by a check-in')
  assert.equal((await db.query(
    'select count(*)::int as n from public.daily_vote_quota_earnings')).rows[0].n, 0,
  'a check-in writes no vote earning')
  assert.equal((await db.query(`select count(*)::int as n from pg_trigger
    where tgrelid = 'public.daily_login_rewards'::regclass
      and tgname = 'daily_login_rewards_no_vote' and not tgisinternal and tgenabled = 'O'`)).rows[0].n, 1,
  'the check-in amount immutability trigger is still active')

  await db.close()
})

test('untracked states abort before the switch is flipped', { timeout: 300_000 }, async t => {
  const cases = [
    ['the two config copies drifted apart', {}, async db => {
      await db.query("update public.daily_quiz_config set value = '5'::jsonb where key = 'free_votes_per_day'")
    }, /err\.dailyFreeVotesPreflight: the two live quota config copies differ/],
    ["the global cap cannot leave 3 free votes for today's largest earner", {}, async db => {
      await db.query("update public.daily_vote_quota_config set value = 'true'::jsonb where key = 'global_daily_vote_cap_enabled'")
      await db.query("update public.daily_vote_quota_config set value = '2'::jsonb where key = 'global_daily_vote_cap'")
      await db.query("update public.daily_quiz_config set value = 'true'::jsonb where key = 'global_daily_vote_cap_enabled'")
      await db.query("update public.daily_quiz_config set value = '2'::jsonb where key = 'global_daily_vote_cap'")
    }, /err\.dailyFreeVotesPreflight: global_daily_vote_cap_enabled is on and global_daily_vote_cap \(2\) minus the largest earning recorded for today \(0\) leaves fewer than 3 free votes/],
    ['the live grant no longer reads the neutral config', {}, async db => {
      await db.exec(`create or replace function public.daily_free_vote_grant(p_uid uuid, p_day date)
        returns integer language sql stable security definer set search_path = public as $$
          select 0 $$`)
    }, /err\.dailyFreeVotesPreflight: daily_free_vote_grant\(\) does not evaluate the neutral quota config/],
    ['the cutover chain is not recorded', { omitHistory: ['20261123_reconcile_security_drift'] }, null,
      /err\.dailyFreeVotesPreflight: required migration state missing \(20261123_reconcile_security_drift\|20261123\)/],
  ]
  for (const [name, options, mutate, pattern] of cases) {
    await t.test(name, async () => {
      const { db } = await buildPostChain(options)
      const userId = await seedAccount(db)
      const before = await stateOf(db)
      const quotaBefore = await quotaOf(db)
      if (mutate) await mutate(db)
      await rejected(db, MIGRATION, pattern)
      /* A refused migration changes nothing: no history row, no policy value. */
      assert.equal((await db.query(
        'select count(*)::int as n from supabase_migrations.schema_migrations where version = $1',
        [MIGRATION_ID])).rows[0].n, 0)
      if (!mutate) {
        assert.deepEqual(await quotaOf(db), quotaBefore, 'a refused migration leaves the policy untouched')
        assert.deepEqual(await stateOf(db), before)
      }
      assert.equal(await statusOf(db, userId).then(s => s.free_limit), 0,
        'the live grant is still the retired 0 — the file never half-applies')
      await db.close()
    })
  }
})

test('re-running is a no-op, the runner refuses a recorded version, and the rollback restores the recorded policy',
  { timeout: 240_000 }, async () => {
    const { db, day } = await buildPostChain()
    const userId = await seedAccount(db)
    const before = await stateOf(db)

    /* First apply: flips the policy and records the previous values. */
    await applyMigration(db, { record: false })
    const record = await commentOf(db)
    assert.deepEqual(recordedPolicy(record),
      { free_vote_grant_enabled: false, free_votes_per_day: 3,
        global_daily_vote_cap_enabled: false, global_daily_vote_cap: 5 },
      'the run that changes the values records the previous policy')

    /* A second manual paste (no history row yet) finds the target state and
       changes nothing — including the record, which must keep the real previous
       policy instead of being overwritten with the target values. */
    await applyMigration(db, { record: false })
    assert.equal(await commentOf(db), record, 'the no-op path keeps the recorded previous policy')
    assert.deepEqual(await quotaOf(db), await quotaOf(db))
    assert.equal((await statusOf(db, userId)).free_limit, 3)
    assert.deepEqual(await stateOf(db), before)

    /* The guarded runner writes the history row with the change; a third paste
       then fails closed instead of re-applying a possible rollback. */
    await db.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
      [MIGRATION_ID, [], `${MIGRATION_ID}.sql`])
    await rejected(db, MIGRATION, /err\.dailyFreeVotesPreflight: 20261124 is already recorded as applied/)
    assert.equal((await statusOf(db, userId)).free_limit, 3, 'a refused re-run leaves the live quota in place')

    /* Corrective rollback: restores the recorded values, verbatim. */
    await db.exec(ROLLBACK)
    assert.deepEqual(await quotaOf(db), {
      neutral_enabled: false, neutral_per_day: 3, neutral_cap_enabled: false, neutral_cap: 5,
      source_enabled: false, source_per_day: 3, source_cap_enabled: false, source_cap: 5,
    }, 'both copies are back to the recorded previous policy')
    assert.equal((await statusOf(db, userId)).free_limit, 0, 'the panel is back to "0 / 0" after a rollback')
    assert.equal(await grantOf(db, userId, day), 0)
    assert.deepEqual(await stateOf(db), before, 'a config rollback moves no wallet and no history row')
    assert.doesNotMatch(await commentOf(db), /previous live policy/, 'the record is cleared')

    /* Running it twice aborts instead of half-restoring. */
    await rejected(db, ROLLBACK, /err\.dailyFreeVotesRollback: the live policy is not the state 20261124 installed/)
    assert.equal((await statusOf(db, userId)).free_limit, 0)

    /* And the guarded-runner path can be replayed afterwards: the recorded
       version is still there, so a new forward migration — not this file — is
       the documented way back on. */
    await rejected(db, MIGRATION, /err\.dailyFreeVotesPreflight: 20261124 is already recorded as applied/)

    await db.close()
  })
