/* Deployment-safety tests for the migration runner. Pure filesystem work — the
   database scenarios live in supabase/tests/migrationDeploy.test.js.
   These assertions are the reason "remember to skip 20261118" is no longer a
   control: the destructive migration is not in the default path, and the guard
   fails if it ever comes back. See docs/DB-MIGRATIONS.md. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  MIGRATIONS_DIR, SCHEMA_FILE, SETUP_DIR, DESTRUCTIVE_PATTERNS,
  collectMigrations, assertMigrationSafety, planPending, findDestructive, readQuarantine,
  stripExplicitTransaction, applyMigration, stripSqlNoise,
} from './migrate.mjs'

const REWRITE = 'update public.daily_login_rewards set reward = 0 where reward <> 0;'
const CHECK = 'alter table public.daily_login_rewards add constraint daily_login_rewards_reward_check check (reward = 0);'

function fixture (files) {
  const dir = mkdtempSync(join(tmpdir(), 'ccl-migrate-'))
  mkdirSync(join(dir, 'archive'))
  const quarantined = readQuarantine(MIGRATIONS_DIR)
  writeFileSync(join(dir, 'archive', 'quarantine.json'), JSON.stringify({
    quarantined: quarantined.map(({ id, version, path, destructive, reason }) =>
      ({ id, version, path, destructive, reason })),
  }))
  for (const entry of quarantined) writeFileSync(join(dir, entry.path), entry.sql)
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    writeFileSync(path, body)
  }
  return dir
}

test('the destructive daily-login rewrite is quarantined, not active', () => {
  const { active, quarantined } = collectMigrations()
  assert.equal(active.filter(({ version }) => version === '20261118').length, 0,
    '20261118 must not be a file the runner or the Supabase CLI can execute')
  assert.equal(quarantined.length, 1)
  const [entry] = quarantined
  assert.equal(entry.id, '20261118_daily_login_no_votes')
  assert.ok(readFileSync(join(MIGRATIONS_DIR, entry.path), 'utf8').includes(REWRITE))
  assert.ok(!entry.path.endsWith('.sql'), 'a quarantined file must not look like a migration')
  const hits = findDestructive(entry.sql).map(({ id }) => id)
  assert.deepEqual(hits, ['daily-login-reward-rewrite', 'daily-login-reward-check'])
})

test('no active migration, schema.sql or setup chunk can rewrite check-in history', () => {
  const { active } = assertMigrationSafety()
  for (const { id, sql } of active) {
    assert.deepEqual(findDestructive(sql), [], `${id} rewrites check-in history`)
  }
  assert.deepEqual(findDestructive(readFileSync(SCHEMA_FILE, 'utf8')), [], 'supabase/schema.sql')
  for (const name of readdirSync(SETUP_DIR).filter(n => n.endsWith('.sql'))) {
    assert.deepEqual(findDestructive(readFileSync(join(SETUP_DIR, name), 'utf8')), [], `supabase/setup/${name}`)
  }
  assert.ok(active.length > 30 && DESTRUCTIVE_PATTERNS.length >= 3)
})

test('a fresh-install setup path has no chunk for the superseded migration', () => {
  const chunks = readdirSync(SETUP_DIR).filter(name => /^\d\d-.*\.sql$/.test(name)).sort()
  assert.equal(chunks.filter(name => /no-votes/.test(name)).length, 0)
  assert.ok(chunks.includes('15-preserve-legacy-daily-login-rewards.sql'))
  assert.ok(chunks.includes('16-daily-login-reward-immutable.sql'))
})

test('a commented-out rewrite is documentation; a real one is a hard failure', () => {
  const commented = `-- 20261118 did this:\n-- ${REWRITE}\nselect 1;\n`
  assert.deepEqual(findDestructive(commented), [])
  const real = `begin;\n${REWRITE}\n${CHECK}\ncommit;\n`
  assert.equal(findDestructive(real).length, 2)
})

test('bringing the destructive file back into the migrations directory fails closed', () => {
  const dir = fixture({
    '20260101_ok.sql': 'select 1;\n',
    '20261118_daily_login_no_votes.sql': `begin;\n${REWRITE}\ncommit;\n`,
  })
  try {
    assert.throws(() => assertMigrationSafety(dir), /20261118_daily_login_no_votes\.sql.*forbidden statement/s)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a quarantined file still named .sql, or a stray nested .sql, fails closed', () => {
  {
    const bad = fixture({ '20260101_ok.sql': 'select 1;\n' })
    const manifest = JSON.parse(readFileSync(join(bad, 'archive', 'quarantine.json'), 'utf8'))
    manifest.quarantined = [{ ...manifest.quarantined[0], path: 'archive/20261118.sql' }]
    writeFileSync(join(bad, 'archive', 'quarantine.json'), JSON.stringify(manifest))
    writeFileSync(join(bad, 'archive', '20261118.sql'), REWRITE)
    assert.throws(() => assertMigrationSafety(bad), /must not keep a \.sql extension/)
    rmSync(bad, { recursive: true, force: true })
  }
  {
    const stray = fixture({ '20260101_ok.sql': 'select 1;\n', 'nested/20260102_stray.sql': 'select 1;\n' })
    try {
      assert.throws(() => collectMigrations(stray), /not a migration/)
    } finally { rmSync(stray, { recursive: true, force: true }) }
  }
})

test('the default plan never schedules a quarantined migration', () => {
  const { active, quarantined } = collectMigrations()

  // A: production that has never run 20261112–20261120 — baseline declared.
  const fresh = planPending({ active, quarantined, applied: [], baseline: '20261117' })
  assert.deepEqual(fresh.pending.map(({ id }) => id),
    ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable',
      '20261121_vote_calendar_decoupling'])
  assert.ok(fresh.pending.every(({ version }) => version > '20261118'))
  assert.equal(fresh.quarantinedNeverRuns.length, 1)

  // B: an environment where 20261118 already ran (it is in the history table,
  // and the runner must still refuse to re-run it).
  const upTo = active.filter(({ version }) => version <= '20261117').map(({ id }) => id)
  const after = planPending({ active, quarantined, applied: [...upTo, '20261118_daily_login_no_votes'] })
  assert.deepEqual(after.pending.map(({ id }) => id),
    ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable',
      '20261121_vote_calendar_decoupling'])
  assert.equal(after.recordedQuarantined.length, 1)
  assert.equal(after.quarantinedNeverRuns.length, 0)

  // D: partial history — only what is missing is scheduled.
  const partial = planPending({
    active,
    quarantined,
    applied: active.filter(({ version }) => version <= '20261117').map(({ id }) => id)
      .concat(['20261119_preserve_legacy_daily_login_rewards']),
  })
  assert.deepEqual(partial.pending.map(({ id }) => id),
    ['20261120_daily_login_reward_immutable', '20261121_vote_calendar_decoupling'])

  // Already up to date.
  const done = planPending({ active, quarantined, applied: active.map(({ id }) => id) })
  assert.deepEqual(done.pending, [])
})

test('the vote/Calendar migration is fail-closed, transactional, and keeps Calendar identity server-side', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '20261121_vote_calendar_decoupling.sql'), 'utf8')
  assert.match(sql, /^begin;[\s\S]*^commit;\s*$/m)
  assert.doesNotMatch(sql, /\bdrop\b|\bcascade\b/i)
  assert.match(sql, /lock table public\.profiles,[\s\S]*in share mode;/i)
  assert.match(sql, /create temporary table _ccl_vote_quiz_source_snapshot as/i)
  assert.match(sql, /raise exception 'err\.voteCalendarBackfill/)
  assert.match(sql, /raise exception 'err\.voteCalendarQuota/)
  assert.match(sql, /except all/)
  assert.match(sql, /count\(distinct \(user_id, quiz_date, question_id\)\)/)
  assert.match(sql, /daily_vote_quota_config.*from public\.daily_quiz_config/s)
  assert.match(sql, /create or replace function public\.daily_free_vote_grant[\s\S]*daily_vote_quota_config/)
  assert.match(sql, /daily_vote_quota_earnings[\s\S]*primary key \(source, user_id, vote_day, source_key\)/)
  const cutover = sql.indexOf('create or replace function public.daily_free_vote_grant', sql.indexOf('$equivalence$;'))
  assert.ok(cutover > sql.indexOf('$equivalence$;'), 'vote cutover follows every backfill/quota assertion')
  const calendarClaim = sql.slice(sql.indexOf('create or replace function public.claim_daily_login_calendar'),
    sql.indexOf('revoke all on function public.claim_daily_login_calendar'))
  assert.match(calendarClaim, /p_expected_day date/)
  assert.match(calendarClaim, /auth\.uid\(\)/)
  assert.match(calendarClaim, /v_now := clock_timestamp\(\);[\s\S]*v_day := \(v_now at time zone 'Asia\/Ho_Chi_Minh'\)::date/)
  assert.doesNotMatch(calendarClaim, /p_expected_user_id|p_uid|p_user_id/)
  const calendarStatus = sql.slice(sql.indexOf('create or replace function public.my_daily_login_status'),
    sql.indexOf('revoke all on function public.my_daily_login_status'))
  assert.match(calendarStatus, /auth\.uid\(\)/)
  assert.doesNotMatch(calendarStatus, /p_expected_user_id|p_uid|p_user_id/)
  const grant = sql.slice(sql.indexOf('create or replace function public.daily_free_vote_grant'),
    sql.indexOf('revoke all on function public.daily_free_vote_grant'))
  assert.match(grant, /daily_vote_quota_config/)
  assert.doesNotMatch(grant, /daily_quiz_(?:int|bool)|\b(?:3|5)\b/)
  const rollback = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)),
    'supabase', 'rollback', '20261121_vote_calendar_decoupling.sql'), 'utf8')
  assert.doesNotMatch(stripSqlNoise(rollback), /\bdrop\b|\bcascade\b/i)
  assert.match(rollback, /create or replace function public\.daily_free_vote_grant/)
  assert.match(rollback, /create or replace function public\.cast_vote/)
  assert.equal([...rollback.matchAll(/create or replace function public\.my_vote_status\(/g)].length, 1,
    'the corrective rollback must define my_vote_status exactly once')
  assert.match(rollback, /create or replace function public\.submit_daily_quiz_answer/)
  assert.match(rollback, /daily_vote_quota_earnings|Calendar-only API/i)
  assert.match(rollback, /rollback_preflight/)
  assert.match(rollback, /20261121_vote_calendar_decoupling/)
  assert.match(rollback, /source and neutral quota config differ/)
  assert.match(rollback, /source answers and neutral earning ledger differ/)

  const preCutover = readFileSync(join(MIGRATIONS_DIR, '20261117_daily_quiz_flow.sql'), 'utf8')
  const getFunction = (source, name) => source.match(
    new RegExp(`create or replace function public\\.${name}\\b[\\s\\S]*?\\$\\$;`, 'i'))?.[0]
  for (const name of ['daily_free_vote_grant', 'my_vote_status', 'cast_vote', 'submit_daily_quiz_answer']) {
    assert.equal(getFunction(rollback, name), getFunction(preCutover, name),
      `rollback restores the reviewed 20261117 ${name} implementation exactly`)
  }
})

test('the runner refuses to guess a baseline for a populated database', () => {
  const { active, quarantined } = collectMigrations()
  assert.throws(() => planPending({ active, quarantined, applied: [] }), /refusing to guess/)
  assert.throws(() => planPending({ active, quarantined, applied: [], baseline: 'not-a-version' }),
    /invalid baseline/)
})

test('explicit SQL transaction wrappers are stripped only when the runner owns the enclosing transaction', () => {
  const wrapped = '-- header\nBEGIN;\nselect 1;\nCOMMIT;\n'
  assert.equal(stripExplicitTransaction(wrapped), '-- header\nselect 1;\n')
  assert.equal(stripExplicitTransaction('select 1;\n'), 'select 1;\n')
  assert.throws(() => stripExplicitTransaction('BEGIN;\nselect 1;\n'), /balanced outer BEGIN\/COMMIT/)
  assert.throws(() => stripExplicitTransaction('BEGIN;\nselect 1;\nCOMMIT;\nCOMMIT;'), /balanced outer BEGIN\/COMMIT/)
})

test('migration body and history commit together; body failure records no history', async () => {
  const calls = []
  const client = { async query(sql, values) { calls.push({ sql, values }); return { rows: [] } } }
  await applyMigration(client, { id: '20261121_fixture', name: 'fixture.sql', sql: 'BEGIN;\nselect 1;\nCOMMIT;' })
  assert.deepEqual(calls.map(({ sql }) => sql), [
    'begin',
    "select pg_advisory_xact_lock(('x' || md5($1))::bit(64)::bigint)",
    'select 1;',
    'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
    'commit',
  ])

  const failedCalls = []
  const failing = { async query(sql) {
    failedCalls.push(sql)
    if (sql.includes('select fail;')) throw new Error('simulated query failure')
    return { rows: [] }
  } }
  await assert.rejects(() => applyMigration(failing,
    { id: '20261121_fixture', name: 'fixture.sql', sql: 'BEGIN;\nselect fail;\nCOMMIT;' }),
  /fixture\.sql: simulated query failure/)
  assert.equal(failedCalls.at(-1), 'rollback')
  assert.equal(failedCalls.some(sql => sql.startsWith('insert into supabase_migrations.schema_migrations')), false)
})

test('no documentation tells anyone to run the superseded migration', () => {
  const scan = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : scan(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
  // An instruction to execute it, e.g. "chạy `20261118`" / "run 20261118 then".
  const instructs = /(run|chạy|apply|paste|dán|execute|psql|db push)[^\n]{0,80}20261118|20261118[^\n]{0,80}(run|chạy|apply|paste|dán|execute|psql|db push)/i
  // `--baseline <version>` means "already applied, do not run" — the recovery
  // path for an environment where it ran is exactly `--baseline 20261118`.
  const negates = /quarantin|cách ly|supersed|thay thế|replac|never|don'?t|do not|không|skip|bỏ qua|archive|lỡ|already ran|baseline/i
  for (const path of scan(fileURLToPath(new URL('..', import.meta.url)))) {
    if (path.includes('/migrations/archive/')) continue
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      if (!/20261118/.test(line) || !instructs.test(line) || negates.test(line)) return
      assert.fail(`${path}:${i + 1} looks like an instruction to run the superseded migration: ${line.trim()}`)
    })
  }
  // The runbook states the rule explicitly, so the check above is not the only
  // thing standing between a reader and the destructive statement.
  const runbook = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'DB-MIGRATIONS.md'), 'utf8')
  assert.match(runbook, /never executes|cách ly|quarantined/)
  assert.doesNotMatch(runbook, /npm run db:deploy[^\n]*20261118[^\n]*baseline 2026111[0-7]/)
})
