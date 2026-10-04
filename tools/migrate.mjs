/* Safe migration runner for an EXISTING database.
 *
 *   node tools/migrate.mjs --check                    # static safety only, no DB
 *   node tools/migrate.mjs --plan  --baseline 20261117
 *   node tools/migrate.mjs --apply --baseline 20261117
 *
 * Why this exists: the daily-login correction shipped a destructive migration
 * (20261118) that rewrites historical check-in amounts. "Remember to skip it"
 * is not a control. The file is quarantined in supabase/migrations/archive/ and
 * this runner refuses to execute it, refuses to execute any migration that
 * matches the same destructive pattern, and refuses to guess a baseline for a
 * populated database. Full runbook: docs/DB-MIGRATIONS.md.
 *
 * The connection string comes from SUPABASE_DB_URL (or --db-url). Never commit
 * it, never paste it into chat. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import process from 'node:process'

export const REPO = fileURLToPath(new URL('..', import.meta.url))
export const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations')
export const SCHEMA_FILE = join(REPO, 'supabase', 'schema.sql')
export const SETUP_DIR = join(REPO, 'supabase', 'setup')
export const QUARANTINE_FILE = 'quarantine.json'
export const HISTORY_TABLE = 'supabase_migrations.schema_migrations'
/** Prevents two deploys from running at the same time. Arbitrary but fixed. */
export const LOCK_KEY = 'ccl_schema_migrations'

/** Statements that rewrite or delete recorded check-in history. Deliberately
 *  narrow: only this family is forbidden in the default path. Older migrations
 *  legitimately contain `delete from votes` / `drop table` in unrelated code,
 *  and appending to them is not allowed, so the guard stays on the risk that
 *  actually destroys audit data. */
export const DESTRUCTIVE_PATTERNS = [
  { id: 'daily-login-reward-rewrite', why: 'rewrites recorded check-in amounts',
    re: /update\s+(?:public\.)?daily_login_rewards\s+set\s+reward\s*=/i },
  { id: 'daily-login-reward-check', why: 'table-wide CHECK that only holds while history is rewritten',
    re: /add\s+constraint[\s\S]{0,120}?check\s*\(\s*reward\s*=\s*0\s*\)/i },
  { id: 'daily-login-history-delete', why: 'deletes check-in history',
    re: /delete\s+from\s+(?:public\.)?daily_login_rewards\b/i },
]

/** Removes comments and blanks string literals, so only real code is scanned.
 *  Dollar-quoted bodies are kept (recursively), because dynamic SQL lives there. */
export function stripSqlNoise (sql) {
  let out = ''
  let i = 0
  const at = n => sql[i + n]
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && at(1) === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue }
    if (c === '/' && at(1) === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && at(1) === '/')) i++
      i += 2
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      i++
      out += quote + quote
      while (i < sql.length) {
        if (sql[i] === quote) { if (at(1) === quote) { i += 2; continue } i++; break }
        i++
      }
      continue
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
      if (tag) {
        const open = tag[0]
        const close = sql.indexOf(open, i + open.length)
        const end = close < 0 ? sql.length : close
        out += open + stripSqlNoise(sql.slice(i + open.length, end)) + open
        i = close < 0 ? sql.length : close + open.length
        continue
      }
    }
    out += c
    i++
  }
  return out
}

export function findDestructive (sql) {
  const code = stripSqlNoise(sql)
  return DESTRUCTIVE_PATTERNS.filter(({ re }) => re.test(code))
}

export function readQuarantine (dir = MIGRATIONS_DIR) {
  const manifest = JSON.parse(readFileSync(join(dir, 'archive', QUARANTINE_FILE), 'utf8'))
  return manifest.quarantined.map(entry => ({
    ...entry,
    sql: readFileSync(join(dir, entry.path), 'utf8'),
  }))
}

export function listSqlFiles (dir) {
  const found = []
  const walk = current => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.sql')) found.push(path)
    }
  }
  walk(dir)
  return found
}

/** Active migrations = what the Supabase CLI would run: top-level
 *  `supabase/migrations/<version>_<name>.sql`, in filename order. */
export function collectMigrations (dir = MIGRATIONS_DIR) {
  const quarantined = readQuarantine(dir)
  const quarantinedPaths = new Set(quarantined.map(({ path }) => join(dir, path)))
  const active = []
  const seen = new Set()
  for (const path of listSqlFiles(dir)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const topLevel = path.slice(0, path.lastIndexOf('/')) === dir
    if (quarantinedPaths.has(path)) continue
    if (!topLevel) throw new Error(`supabase/migrations/${name} is not a migration: ` +
      'the Supabase CLI only scans the top level. List it in archive/quarantine.json or move it out.')
    const match = /^(\d{8,})_(.+)\.sql$/.exec(name)
    if (!match) throw new Error(`supabase/migrations/${name} is not named <timestamp>_<name>.sql`)
    // Two migrations can share a day (20260905 has two), so the recorded id is
    // the whole file name; `version` stays the timestamp prefix for ordering.
    const id = name.slice(0, -4)
    if (seen.has(id)) throw new Error(`duplicate migration ${id}`)
    seen.add(id)
    active.push({ id, version: match[1], name, path, sql: readFileSync(path, 'utf8') })
  }
  active.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { active, quarantined }
}

/** Static guard: the default path must never contain a historical rewrite. */
export function assertMigrationSafety (dir = MIGRATIONS_DIR) {
  const { active, quarantined } = collectMigrations(dir)
  for (const { version, name, sql } of active) {
    const hits = findDestructive(sql)
    if (hits.length) {
      throw new Error(`${name} (${version}) contains a forbidden statement [${hits.map(h => h.id).join(', ')}]: ` +
        `${hits[0].why}. A migration may never rewrite check-in history; quarantine it or write a new migration.`)
    }
  }
  for (const entry of quarantined) {
    if (entry.path.endsWith('.sql')) {
      throw new Error(`quarantined migration ${entry.version} must not keep a .sql extension`)
    }
    if (findDestructive(entry.sql).length === 0 && entry.destructive) {
      throw new Error(`quarantine entry ${entry.version} is marked destructive but no longer matches — update ${QUARANTINE_FILE}`)
    }
  }
  for (const path of [SCHEMA_FILE, ...readdirSync(SETUP_DIR).filter(n => n.endsWith('.sql')).map(n => join(SETUP_DIR, n))]) {
    const hits = findDestructive(readFileSync(path, 'utf8'))
    if (hits.length) throw new Error(`${path.slice(REPO.length)} contains a forbidden statement [${hits.map(h => h.id).join(', ')}]`)
  }
  return { active, quarantined }
}

export function planPending ({ active, quarantined = [], applied = [], baseline = null }) {
  const appliedSet = new Set(applied)
  if (baseline !== null && !/^\d{8}$/.test(baseline)) {
    throw new Error(`invalid baseline ${baseline}: use the 8-digit migration timestamp, e.g. 20261117`)
  }
  if (!appliedSet.size && baseline === null) {
    throw new Error('no migration history and no --baseline: refusing to guess which migrations this database already has')
  }
  const floor = baseline ?? ''
  const pending = active.filter(({ id, version }) => !appliedSet.has(id) && version > floor)
  const recordedQuarantined = quarantined.filter(({ id }) => appliedSet.has(id))
  return {
    pending,
    skippedApplied: active.filter(({ id }) => appliedSet.has(id)),
    skippedBaseline: active.filter(({ id, version }) => !appliedSet.has(id) && version <= floor),
    quarantinedNeverRuns: quarantined.filter(({ id }) => !appliedSet.has(id)),
    recordedQuarantined,
  }
}

/* ------------------------------- database ------------------------------- */

export async function ensureHistory (client) {
  await client.query('create schema if not exists supabase_migrations')
  await client.query(`create table if not exists ${HISTORY_TABLE} (
    version text not null primary key,
    statements text[],
    name text)`)
}

export async function readHistory (client) {
  const { rows } = await client.query(`select version from ${HISTORY_TABLE} order by version`)
  return rows.map(row => row.version)
}

/** Refuses to run against a database that has app tables but no history. */
export async function assertBaselineKnown (client, baseline) {
  const { rows: [state] } = await client.query(`
    select to_regclass('public.profiles') is not null as has_app_tables,
           to_regclass('public.daily_login_rewards') is not null as has_login_table,
           (select count(*) from ${HISTORY_TABLE})::int as recorded`)
  if (state.recorded > 0) return state
  if (!state.has_app_tables) {
    throw new Error('this database has no app tables: use the fresh-install setup files ' +
      '(supabase/setup/01…16, see supabase/setup/README.md), not the migration runner')
  }
  if (baseline === null) {
    throw new Error('refusing to guess: this database already has app tables but no migration history. ' +
      'Check which migrations it already contains, then re-run with --baseline <version> ' +
      '(everything up to and including that version is treated as already applied).')
  }
  return state
}

/** Records everything at or below the declared baseline as applied, without
 *  executing it: a baseline is a statement about the past, and writing it down
 *  is what stops the next deploy from replaying it. */
export async function recordBaseline (client, { active, baseline }) {
  if (baseline === null) return []
  const rows = active.filter(({ version }) => version <= baseline)
  await client.query('begin')
  try {
    for (const { id } of rows) {
      await client.query(`insert into ${HISTORY_TABLE} (version, statements, name)
                          values ($1, $2, $3) on conflict (version) do nothing`,
        [id, [], `baseline ${baseline}: recorded, not executed`])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
  return rows
}

export async function applyMigration (client, migration) {
  const { id, name, sql } = migration
  await client.query('begin')
  try {
    await client.query(`select pg_advisory_xact_lock(('x' || md5($1))::bit(64)::bigint)`, [LOCK_KEY])
    await client.query(sql)
    // version = file name without extension: unique even when two migrations
    // share a day, and it is what `plan` compares against the file list.
    await client.query(`insert into ${HISTORY_TABLE} (version, statements, name) values ($1, $2, $3)`,
      [id, [sql], name])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    error.message = `${name}: ${error.message}`
    throw error
  }
}

export async function plan (client, { dir = MIGRATIONS_DIR, baseline = null } = {}) {
  const { active, quarantined } = assertMigrationSafety(dir)
  await ensureHistory(client)
  const applied = await readHistory(client)
  const state = await assertBaselineKnown(client, applied.length ? null : baseline)
  const plan = planPending({ active, quarantined, applied, baseline: applied.length ? null : baseline })
  return { ...plan, applied, state, active }
}

export async function deploy (client, { dir = MIGRATIONS_DIR, baseline = null, onApplied = () => {} } = {}) {
  const result = await plan(client, { dir, baseline })
  result.recordedBaseline = await recordBaseline(client, { active: result.active, baseline })
  for (const migration of result.pending) {
    await applyMigration(client, migration)
    onApplied(migration)
  }
  return result
}

/* --------------------------------- CLI ---------------------------------- */

function parseArgs (argv) {
  const args = { mode: null, baseline: null, dbUrl: process.env.SUPABASE_DB_URL ?? null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' || argv[i] === '--apply' || argv[i] === '--check') args.mode = argv[i].slice(2)
    else if (argv[i] === '--baseline') args.baseline = argv[++i]
    else if (argv[i] === '--db-url') args.dbUrl = argv[++i]
    else throw new Error(`unknown argument ${argv[i]} (use --check, --plan or --apply)`)
  }
  if (!args.mode) throw new Error('use --check (static), --plan (what would run) or --apply')
  return args
}

async function main (argv) {
  const { mode, baseline, dbUrl } = parseArgs(argv)
  if (mode === 'check') {
    const { active, quarantined } = assertMigrationSafety()
    console.log(`OK  ${active.length} active migrations, ${quarantined.length} quarantined, ` +
      'no destructive statement in the default path (migrations, schema.sql, setup chunks)')
    return 0
  }
  if (!dbUrl) {
    throw new Error('missing database URL: set SUPABASE_DB_URL or pass --db-url (never commit it)')
  }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const result = await plan(client, { baseline })
    for (const q of result.quarantinedNeverRuns) {
      console.log(`skip ${q.version}  quarantined — ${q.reason}`)
    }
    for (const q of result.recordedQuarantined) {
      console.log(`note ${q.version}  already recorded in this database; it is never re-run — ${q.ifAlreadyApplied}`)
    }
    if (result.skippedBaseline.length) {
      console.log(`skip ${result.skippedBaseline.length} migration(s) at or below --baseline ${baseline}` +
        (mode === 'plan' ? ' (they will be recorded as applied, not executed)' : ''))
    }
    if (result.skippedApplied.length) {
      console.log(`skip ${result.skippedApplied.length} migration(s) already recorded as applied`)
    }
    if (!result.pending.length) {
      console.log('up to date — nothing to apply')
      return 0
    }
    if (mode === 'plan') return 0
    if (result.skippedBaseline.length) {
      await recordBaseline(client, { active: result.active, baseline })
      console.log(`recorded ${result.skippedBaseline.length} migration(s) at or below --baseline ${baseline} as applied`)
    }
    for (const m of result.pending) {
      console.log(`apply ${m.version}  ${m.name}`)
      await applyMigration(client, m)
      console.log(`applied ${m.version}`)
    }
    return 0
  } finally {
    await client.end().catch(() => {})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(`refusing to continue: ${error.message}`)
    process.exitCode = 1
  })
}
