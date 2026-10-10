/* Safe migration runner for an EXISTING database.
 *
 *   node tools/migrate.mjs --check                    # static safety only, no DB
 *   node tools/migrate.mjs --plan  --baseline 20261117
 *   node tools/migrate.mjs --plan  --until 20261128
 *   node tools/migrate.mjs --plan  --until 20261204 --except 20261201
 *   node tools/migrate.mjs --apply --baseline 20261117
 *   node tools/migrate.mjs --apply --until 20261128   # one batch; never the rest
 *   node tools/migrate.mjs --apply --until 20261204 --except 20261201  # B2; hold B3
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
import { verifyBaseline, formatReport, availableBaselines, snapshotPath } from './schema-readiness.mjs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import process from 'node:process'

export const REPO = fileURLToPath(new URL('..', import.meta.url))
export const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations')

/* ---------------------------------------------------------------- đường dẫn
   Đường dẫn trong repo viết bằng '/', nhưng readdirSync/join trên Windows trả
   '\'. Vì vậy mọi phép so sánh đường dẫn ở đây phải chuẩn hoá CẢ HAI dấu phân
   cách — dùng path.sep một mình là không đủ. Đây chính là bug đã làm `db:plan`
   chết trên Git Bash/Windows: `path.lastIndexOf('/')` trả -1 cho đường dẫn có
   '\', nên một tệp TOP-LEVEL bị coi là "nằm trong thư mục con" và tên tệp bị
   in ra thành cả đường dẫn tuyệt đối. */
export const normalizePath = value => value.replaceAll('\\', '/').replace(/\/+$/, '')
const lastSeparator = value => Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
export const pathName = value => value.slice(lastSeparator(value) + 1)
export const pathDir = value => { const at = lastSeparator(value); return at < 0 ? '' : value.slice(0, at) }

/** Phân loại một tệp .sql so với thư mục migrations. Hàm thuần (không I/O) để
 *  unit test được cả đường dẫn kiểu Windows trên CI Linux — xem
 *  tools/migration-safety.test.mjs. */
export const classifyMigrationFile = (file, dir) => ({
  name: pathName(file),
  topLevel: normalizePath(pathDir(file)) === normalizePath(dir),
})
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
 *  Dollar-quoted bodies are kept (recursively), because dynamic SQL lives there. */export function stripSqlNoise (sql) {
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

/* ------------------- fresh-install bundle vs baseline ------------------- */

/** The newest committed fresh-install baseline: what `supabase/schema.sql` and
 *  the `supabase/setup/*.sql` chunks are allowed to describe. */
export const bundleBaseline = () =>
  availableBaselines().filter(name => /^\d{8}$/.test(name)).sort().at(-1)

/** Every table/function name the baseline fingerprint already contains. A later
 *  migration may legitimately `create or replace` these; it may not introduce
 *  them. */
export function baselineObjects (baseline = bundleBaseline()) {
  const snapshot = JSON.parse(readFileSync(snapshotPath(baseline), 'utf8'))
  const tables = Object.keys(snapshot.state.tables ?? {})
  const functions = Object.keys(snapshot.state.functions ?? {})
    .map(signature => signature.slice(0, signature.indexOf('(')))
  return new Set([...tables, ...functions])
}

/** Objects that ONLY migrations after the newest baseline create (name → the
 *  migration id that introduces it). These must never appear in the
 *  fresh-install bundle: a fresh install of the bundle is the baseline, and the
 *  guarded runner refuses to adopt pre-existing target objects, so a bundled
 *  copy would make every upgrade from that bundle impossible. */
export function postBaselineObjects (dir = MIGRATIONS_DIR) {
  const { active } = collectMigrations(dir)
  const floor = bundleBaseline()
  const known = baselineObjects(floor)
  const objects = new Map()
  const remember = (name, id) => { if (!known.has(name)) objects.set(name, id) }
  for (const { id, version, sql } of active) {
    if (version <= floor) continue
    const code = stripSqlNoise(sql)
    for (const match of code.matchAll(
      /create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      remember(match[1], id)
    }
    for (const match of code.matchAll(
      /create\s+or\s+replace\s+function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      remember(match[1], id)
    }
  }
  return objects
}

/** A declaration of `name` inside a bundle file. Comments and string literals
 *  are ignored, so a documented name is not a hit — only real DDL is. */
const declaresObject = (sql, name) => new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?(?:table|function|unique\\s+index|index|policy|trigger|type|view)\\s+` +
  `(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${name}\\b`, 'i').test(stripSqlNoise(sql))

/** Fails closed when the fresh-install bundle already contains objects that a
 *  later migration creates — the state a regenerated `schema.sql` produces. */
export function bundleAheadOfBaseline (files, dir = MIGRATIONS_DIR) {
  const objects = postBaselineObjects(dir)
  if (!objects.size) return []
  const hits = []
  for (const path of files) {
    const sql = readFileSync(path, 'utf8')
    for (const [name, migration] of objects) {
      if (declaresObject(sql, name)) hits.push({ path, object: `public.${name}`, migration })
    }
  }
  return hits
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
  const quarantinedPaths = new Set(quarantined.map(({ path }) => normalizePath(join(dir, path))))
  const active = []
  const seen = new Set()
  for (const file of listSqlFiles(dir)) {
    const { name, topLevel } = classifyMigrationFile(file, dir)
    if (quarantinedPaths.has(normalizePath(file))) continue
    if (!topLevel) throw new Error(`supabase/migrations/${name} is not a migration: ` +
      'the Supabase CLI only scans the top level. List it in archive/quarantine.json or move it out.')
    const match = /^(\d{8,})_(.+)\.sql$/.exec(name)
    if (!match) throw new Error(`supabase/migrations/${name} is not named <timestamp>_<name>.sql`)
    // Two migrations can share a day (20260905 has two), so the recorded id is
    // the whole file name; `version` stays the timestamp prefix for ordering.
    const id = name.slice(0, -4)
    if (seen.has(id)) throw new Error(`duplicate migration ${id}`)
    seen.add(id)
    active.push({ id, version: match[1], name, path: file, sql: readFileSync(file, 'utf8') })
  }
  active.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { active, quarantined }
}

/** Readable file label: repo-relative when possible, absolute otherwise. */
const displayPath = path => path.startsWith(REPO) ? path.slice(REPO.length) : path

/** Static guard: the default path must never contain a historical rewrite, and
 *  the fresh-install bundle must stay at the newest committed baseline. */
export function assertMigrationSafety (dir = MIGRATIONS_DIR, { schemaFile = SCHEMA_FILE, setupDir = SETUP_DIR } = {}) {
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
  const bundleFiles = [schemaFile,
    ...readdirSync(setupDir).filter(n => n.endsWith('.sql')).map(n => join(setupDir, n))]
  for (const path of bundleFiles) {
    const hits = findDestructive(readFileSync(path, 'utf8'))
    if (hits.length) throw new Error(`${displayPath(path)} contains a forbidden statement [${hits.map(h => h.id).join(', ')}]`)
  }
  const ahead = bundleAheadOfBaseline(bundleFiles, dir)
  if (ahead.length) {
    const floor = bundleBaseline()
    const detail = ahead.map(hit =>
      `${displayPath(hit.path)} declares ${hit.object} (created by ${hit.migration})`).join('; ')
    throw new Error(`the fresh-install bundle is ahead of baseline ${floor}: ${detail}. ` +
      `The bundle (supabase/schema.sql + supabase/setup chunks) must stay at baseline ${floor}: ` +
      'regenerate it from a pre-cutover database, or supersede the baseline in a reviewed PR. ' +
      'A bundled copy makes every upgrade fail closed, because the guarded runner refuses to ' +
      'adopt pre-existing target objects (err.voteCalendarPreflight: partial/unknown target objects already exist).')
  }
  return { active, quarantined }
}

/* Danh sách migration sẽ chạy, ở dạng in được. Tồn tại như một hàm riêng vì nhánh
   `--plan` của CLI trước đây trả về TRƯỚC vòng lặp in, nên `db:plan` báo
   "skip 36 migration(s) …" rồi im lặng về ba migration thật sự sẽ chạy — người
   vận hành không có cách nào chỉ-đọc để xem kế hoạch. Định dạng dòng giữ nguyên
   như `db:deploy` in (và như docs/DB-MIGRATIONS.md mô tả). */
export function holdCaption (result) {
  if (!result.held?.length) return null
  const bits = []
  if (result.until) bits.push(`--until ${result.until}`)
  if (result.except?.length) bits.push(`--except ${result.except.join(',')}`)
  const after = bits.length ? ` after ${bits.join(' / ')}` : ''
  return `hold ${result.held.length} migration(s)${after} (not this batch)`
}

export const planLines = result => [
  `${result.pending.length} migration(s) would be applied:`,
  ...result.pending.map(({ version, name }) => `apply ${version}  ${name}`),
  ...(result.held?.length
    ? [holdCaption(result),
      ...result.held.map(({ version, name }) => `hold ${version}  ${name}`)]
    : []),
]

/** Keep pending at or below an 8-digit timestamp; the rest is another batch. */
export function clipUntil (pending, until) {
  if (until == null || until === '') return { pending, held: [] }
  if (!/^\d{8}$/.test(until)) {
    throw new Error(`invalid --until ${until}: use the 8-digit migration timestamp, e.g. 20261128`)
  }
  return {
    pending: pending.filter(({ version }) => version <= until),
    held: pending.filter(({ version }) => version > until),
  }
}

/** 8-digit timestamps to pull out of this batch (repeatable / comma-separated). */
export function normalizeExcept (except) {
  if (except == null || except === '') return []
  const list = Array.isArray(except) ? except : String(except).split(',')
  const versions = [...new Set(list.flatMap(s => String(s).split(',').map(x => x.trim())).filter(Boolean))]
  for (const v of versions) {
    if (!/^\d{8}$/.test(v)) {
      throw new Error(`invalid --except ${v}: use the 8-digit migration timestamp, e.g. 20261201`)
    }
  }
  return versions.sort()
}

/** Move matching versions from pending into held. Does not look past `--until`. */
export function clipExcept (pending, except) {
  const set = new Set(normalizeExcept(except))
  if (!set.size) return { pending, held: [] }
  return {
    pending: pending.filter(({ version }) => !set.has(version)),
    held: pending.filter(({ version }) => set.has(version)),
  }
}

/** One batch: `--until` then `--except`. Held list is version-sorted, no dupes. */
export function clipBatch (pending, { until = null, except = [] } = {}) {
  const untilClip = clipUntil(pending, until)
  const exceptClip = clipExcept(untilClip.pending, except)
  const heldByKey = new Map()
  for (const row of [...exceptClip.held, ...untilClip.held]) {
    heldByKey.set(row.id ?? `${row.version}:${row.name}`, row)
  }
  const held = [...heldByKey.values()].sort((a, b) =>
    a.version.localeCompare(b.version) || String(a.name).localeCompare(String(b.name)))
  return { pending: exceptClip.pending, held }
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
  const { rows: [row] } = await client.query(`select to_regclass('${HISTORY_TABLE}') is not null as ok`)
  if (!row.ok) return []
  const { rows } = await client.query(`select version from ${HISTORY_TABLE} order by version`)
  return rows.map(row => row.version)
}

/** Refuses to run against a database that has app tables but no history. */
export async function assertBaselineKnown (client, baseline, recorded = 0) {
  const { rows: [state] } = await client.query(`
    select to_regclass('public.profiles') is not null as has_app_tables,
           to_regclass('public.daily_login_rewards') is not null as has_login_table`)
  state.recorded = recorded
  if (recorded > 0) return state
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

/** Migration files keep BEGIN/COMMIT so they are atomic when executed as a
 *  standalone SQL script (for example by the disposable DB harness). The runner
 *  already owns the transaction that also records migration history, so remove
 *  exactly one outer pair before sending the body; a nested COMMIT would
 *  otherwise make history failure leave an unrecorded partial deployment. */
export function stripExplicitTransaction (sql) {
  const lines = sql.split('\n')
  const begins = []
  const commits = []
  lines.forEach((line, index) => {
    const statement = line.trim().toLowerCase()
    if (statement === 'begin;') begins.push(index)
    if (statement === 'commit;') commits.push(index)
  })
  if (!begins.length && !commits.length) return sql
  if (begins.length !== 1 || commits.length !== 1 || begins[0] >= commits[0]) {
    throw new Error('migration must have at most one balanced outer BEGIN/COMMIT pair')
  }
  return lines.filter((_, index) => index !== begins[0] && index !== commits[0]).join('\n')
}

export async function applyMigration (client, migration) {
  const { id, name, sql } = migration
  await client.query('begin')
  try {
    await client.query(`select pg_advisory_xact_lock(('x' || md5($1))::bit(64)::bigint)`, [LOCK_KEY])
    await client.query(stripExplicitTransaction(sql))
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

export async function plan (client, { dir = MIGRATIONS_DIR, baseline = null, until = null, except = [] } = {}) {
  const { active, quarantined } = assertMigrationSafety(dir)
  // Read-only until the plan is accepted: a refused deployment must not leave
  // even an empty history table behind.
  const applied = await readHistory(client)
  const appliedSet = new Set(applied)
  // A baseline claims "everything up to here is already in this database".
  // That claim is only accepted when the live schema matches a committed
  // fingerprint of that migration's result, and only when it is about to be
  // recorded — re-running a finished deployment needs no re-verification.
  const toRecord = baseline === null ? [] : active.filter(({ id, version }) => version <= baseline && !appliedSet.has(id))
  let readiness = null
  if (toRecord.length) {
    readiness = await verifyBaseline(client, baseline)
    if (!readiness.ok) {
      throw new Error(`baseline ${baseline} is not verified against this database:\n${formatReport(readiness)}\n` +
        '  Nothing was recorded and nothing was applied. Do not use --baseline unless the automated ' +
        'schema-readiness verification passes — see docs/DB-MIGRATIONS.md (modes A, B, E).')
    }
  }
  const state = await assertBaselineKnown(client, applied.length ? null : baseline, applied.length)
  /* `--baseline V` là lời tuyên bố "mọi thứ ≤ V đã có trong database này", và nó chỉ
     được chấp nhận SAU khi fingerprint của V khớp (khối if ở trên). Vì vậy V luôn là
     SÀN của kế hoạch: các bản ≤ V chưa có trong history thuộc nhóm toRecord (được
     GHI, không chạy), không bao giờ nằm trong pending — kể cả khi history đã có sẵn
     một phần. Trước bản vá này, chỉ cần history có một dòng là mọi bản ≤ V bị đẩy
     vào pending: runner sẽ chạy lại migration cũ rồi vỡ bằng lỗi khoá chính khi ghi
     history (recordBaseline đã ghi trước đó), tức một abort khó hiểu thay vì kế
     hoạch đúng. */
  const plan = planPending({ active, quarantined, applied, baseline })
  if (until != null && until !== '') {
    if (!active.some(({ version }) => version === until)) {
      throw new Error(`--until ${until} does not match any migration version`)
    }
  }
  const exceptVersions = normalizeExcept(except)
  for (const v of exceptVersions) {
    if (!active.some(({ version }) => version === v)) {
      throw new Error(`--except ${v} does not match any migration version`)
    }
  }
  const { pending, held } = clipBatch(plan.pending, { until, except: exceptVersions })
  return { ...plan, pending, held, until, except: exceptVersions, applied, state, active, readiness, toRecord }
}

export async function deploy (client, { dir = MIGRATIONS_DIR, baseline = null, until = null, except = [], onApplied = () => {} } = {}) {
  const result = await plan(client, { dir, baseline, until, except })
  // Only now, with the baseline verified, may the history table be created.
  if (result.toRecord.length || result.pending.length) await ensureHistory(client)
  result.recordedBaseline = await recordBaseline(client, { active: result.active, baseline })
  for (const migration of result.pending) {
    await applyMigration(client, migration)
    onApplied(migration)
  }
  return result
}

/* --------------------------------- CLI ---------------------------------- */

export function parseArgs (argv) {
  const args = { mode: null, baseline: null, until: null, except: [], dbUrl: process.env.SUPABASE_DB_URL ?? null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' || argv[i] === '--apply' || argv[i] === '--check' || argv[i] === '--verify') args.mode = argv[i].slice(2)
    else if (argv[i] === '--baseline') args.baseline = argv[++i]
    else if (argv[i] === '--until') args.until = argv[++i]
    else if (argv[i] === '--except') {
      const raw = argv[++i]
      if (raw == null || String(raw).startsWith('--')) {
        throw new Error('missing --except version: use the 8-digit migration timestamp, e.g. 20261201')
      }
      args.except = normalizeExcept([...args.except, raw])
    }
    else if (argv[i] === '--db-url') args.dbUrl = argv[++i]
    else throw new Error(`unknown argument ${argv[i]} (use --check, --plan or --apply)`)
  }
  if (!args.mode) throw new Error('use --check (static), --plan (what would run) or --apply')
  args.except = normalizeExcept(args.except)
  return args
}

/* --verify with a baseline: readiness report for that baseline (exit 1 if it
   fails). --verify without one: diagnose an unknown / partial database against
   every known baseline and print a report for a human to review. */
async function verifyCommand (baseline, dbUrl) {
  if (!dbUrl) throw new Error('missing database URL: set SUPABASE_DB_URL or pass --db-url (never commit it)')
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  try {
    if (baseline !== null) {
      const result = await verifyBaseline(client, baseline)
      console.log(formatReport(result))
      return result.ok ? 0 : 1
    }
    console.log('No baseline given — diagnosing this database against every known baseline.\n')
    let matched = false
    for (const candidate of availableBaselines()) {
      const result = await verifyBaseline(client, candidate)
      matched = matched || result.ok
      console.log(`${formatReport(result)}\n`)
    }
    console.log(matched
      ? 'A baseline matched: deploy with --baseline <the version that matched>.'
      : 'No baseline matched. This database is unknown or partial (mode E): do not migrate it ' +
        'automatically. Pick a strategy from docs/DB-MIGRATIONS.md — restore it to a known-good ' +
        'state, or have a reviewed snapshot generated for its exact state.')
    return matched ? 0 : 1
  } finally { await client.end().catch(() => {}) }
}

async function main (argv) {
  const { mode, baseline, until, except, dbUrl } = parseArgs(argv)
  if (mode === 'verify') return verifyCommand(baseline, dbUrl)
  if (mode === 'check') {
    const { active, quarantined } = assertMigrationSafety()
    console.log(`OK  ${active.length} active migrations, ${quarantined.length} quarantined, ` +
      'no destructive statement in the default path and no post-baseline object in the fresh-install ' +
      `bundle (schema.sql + setup chunks stay at baseline ${bundleBaseline()})`)
    return 0
  }
  if (!dbUrl) {
    throw new Error('missing database URL: set SUPABASE_DB_URL or pass --db-url (never commit it)')
  }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const result = await plan(client, { baseline, until, except })
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
    if (mode === 'plan') {
      /* Chỉ in, không ghi: lệnh này phải cho người vận hành thấy ĐỦ những gì sẽ
         chạy trước khi họ gõ db:deploy. --until / --except giữ batch khác ở nhóm hold. */
      if (!result.pending.length && !result.held?.length) {
        console.log('up to date — nothing to apply')
        return 0
      }
      for (const line of planLines(result)) console.log(line)
      return 0
    }
    if (!result.pending.length) {
      console.log('up to date — nothing to apply')
      return 0
    }
    if (result.toRecord.length || result.pending.length) await ensureHistory(client)
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
