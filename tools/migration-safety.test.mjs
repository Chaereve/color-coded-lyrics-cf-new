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
    ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'])
  assert.ok(fresh.pending.every(({ version }) => version > '20261118'))
  assert.equal(fresh.quarantinedNeverRuns.length, 1)

  // B: an environment where 20261118 already ran (it is in the history table,
  // and the runner must still refuse to re-run it).
  const upTo = active.filter(({ version }) => version <= '20261117').map(({ id }) => id)
  const after = planPending({ active, quarantined, applied: [...upTo, '20261118_daily_login_no_votes'] })
  assert.deepEqual(after.pending.map(({ id }) => id),
    ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable'])
  assert.equal(after.recordedQuarantined.length, 1)
  assert.equal(after.quarantinedNeverRuns.length, 0)

  // D: partial history — only what is missing is scheduled.
  const partial = planPending({
    active,
    quarantined,
    applied: active.filter(({ version }) => version <= '20261117').map(({ id }) => id)
      .concat(['20261119_preserve_legacy_daily_login_rewards']),
  })
  assert.deepEqual(partial.pending.map(({ id }) => id), ['20261120_daily_login_reward_immutable'])

  // Already up to date.
  const done = planPending({ active, quarantined, applied: active.map(({ id }) => id) })
  assert.deepEqual(done.pending, [])
})

test('the runner refuses to guess a baseline for a populated database', () => {
  const { active, quarantined } = collectMigrations()
  assert.throws(() => planPending({ active, quarantined, applied: [] }), /refusing to guess/)
  assert.throws(() => planPending({ active, quarantined, applied: [], baseline: 'not-a-version' }),
    /invalid baseline/)
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
