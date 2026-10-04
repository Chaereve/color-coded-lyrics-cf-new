/* Schema-readiness verification for migration baselines.
 *
 * Recording a baseline says "this database already contains everything up to
 * migration X" — a claim about the past that the runner then trusts forever. If
 * it is wrong, migrations are skipped and the database is left half-migrated, so
 * it is never taken on trust: the target database is compared, object by object,
 * against a committed fingerprint of what migration X actually produces.
 *
 *   node tools/schema-readiness.mjs --db-url <url> --baseline 20261117 --write
 *       # regenerate supabase/baselines/<baseline>.json from a known-good
 *       # reference database (a reviewed action — commit the result)
 *
 * See docs/DB-MIGRATIONS.md. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import process from 'node:process'

export const REPO = fileURLToPath(new URL('..', import.meta.url))
export const SNAPSHOT_DIR = join(REPO, 'supabase', 'baselines')
export const snapshotPath = baseline => join(SNAPSHOT_DIR, `${baseline}.json`)

/** Baselines a database can be verified against, in migration order. */
export const BASELINE_NOTES = {
  20261111: 'core app only — before the Daily Rewards / Daily Quiz migrations',
  20261117: 'core + 20261112…20261117 (Daily Quiz flow) — the normal production state',
  20261118: 'core + 20261112…20261118 — the state left by the destructive migration',
  20261120: 'core + 20261112…20261117 + 20261119 + 20261120 — the final state, and what a fresh install produces',
}

export const availableBaselines = () => readdirSync(SNAPSHOT_DIR)
  .filter(name => /^\d{8}\.json$/.test(name)).map(name => name.slice(0, -5)).sort()

const norm = sql => (sql ?? '').replace(/\s+/g, ' ').trim()

/* ------------------------------ capture ------------------------------- */

export async function captureSchema (client) {
  const rows = async (sql, values) => (await client.query(sql, values)).rows

  // Sequential: a pg Client must not run two queries at once.
  const [tables, columns, constraints, indexes, policies, functions, triggers] = [
    await rows(`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
           order by 1`),
    await rows(`select c.relname as table, a.attname as name,
                 format_type(a.atttypid, a.atttypmod) as type,
                 a.attnotnull as not_null,
                 pg_get_expr(d.adbin, d.adrelid) as default,
                 a.attgenerated as generated
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
             and c.relkind in ('r', 'p')
           order by 1, 2`),
    await rows(`select c.relname as table, con.conname as name, con.contype as type,
                 (select array_agg(a.attname::text order by k.ord)
                    from unnest(con.conkey) with ordinality k(attnum, ord)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
                 (select cf.relname || '(' || (
                        select array_agg(af.attname::text order by kf.ord)::text
                          from unnest(con.confkey) with ordinality kf(attnum, ord)
                          join pg_attribute af on af.attrelid = con.confrelid and af.attnum = kf.attnum)
                      || ')' from pg_class cf where cf.oid = con.confrelid) as references,
                 pg_get_constraintdef(con.oid) as definition
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
           order by 1, 2`),
    await rows(`select tablename as table, indexname as name, indexdef as definition
            from pg_indexes where schemaname = 'public' order by 1, 2`),
    await rows(`select tablename as table, policyname as name, cmd, roles::text as roles,
                 qual, with_check
            from pg_policies where schemaname = 'public' order by 1, 2`),
    await rows(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
                 pg_get_function_result(p.oid) as returns,
                 p.provolatile as volatility, p.prosecdef as security_definer,
                 l.lanname as language, p.prokind as kind
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            join pg_language l on l.oid = p.prolang
           where n.nspname = 'public'
           order by 1`),
    await rows(`select c.relname as table, t.tgname as name, pg_get_triggerdef(t.oid) as definition
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and not t.tgisinternal
           order by 1, 2`),
  ]

  const state = { tables: {}, functions: {}, config: {} }
  for (const { name, rls, force_rls: forceRls } of tables) {
    state.tables[name] = { rls, forceRls, columns: {}, constraints: [], indexes: [], policies: [], triggers: [] }
  }
  for (const row of columns) {
    state.tables[row.table].columns[row.name] = {
      type: row.type,
      notNull: row.not_null,
      default: norm(row.default),
      generated: row.generated || '',
    }
  }
  for (const row of constraints) {
    state.tables[row.table].constraints.push({
      name: row.name, type: row.type, columns: row.columns ?? [],
      references: row.references ?? null, definition: norm(row.definition),
    })
  }
  for (const row of indexes) state.tables[row.table].indexes.push({ name: row.name, definition: norm(row.definition) })
  for (const row of policies) {
    state.tables[row.table].policies.push({
      name: row.name, cmd: row.cmd, roles: norm(row.roles),
      qual: norm(row.qual), withCheck: norm(row.with_check),
    })
  }
  for (const row of triggers) state.tables[row.table].triggers.push({ name: row.name, definition: norm(row.definition) })
  for (const row of functions) {
    state.functions[row.signature] = {
      returns: row.returns, volatility: row.volatility,
      securityDefiner: row.security_definer, language: row.language, kind: row.kind,
    }
  }
  const hasConfig = await client.query(`select to_regclass('public.daily_quiz_config') is not null as ok`)
  if (hasConfig.rows[0].ok) {
    for (const row of (await client.query('select key, value::text as value from public.daily_quiz_config order by key')).rows) {
      state.config[row.key] = row.value
    }
  }
  return state
}

/* -------------------------------- diff -------------------------------- */

const CONSTRAINT_KIND = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check' }

export function diffSchema (expected, actual) {
  const problems = []
  const notes = []
  const add = (kind, object, detail) => problems.push({ kind, object, detail })

  for (const [name, want] of Object.entries(expected.tables)) {
    const got = actual.tables[name]
    if (!got) { add('missing-table', `public.${name}`, 'table does not exist'); continue }
    if (want.rls && !got.rls) add('missing-rls', `public.${name}`, 'row level security is not enabled')
    for (const [column, spec] of Object.entries(want.columns)) {
      const found = got.columns[column]
      if (!found) { add('missing-column', `public.${name}.${column}`, 'column does not exist'); continue }
      if (found.type !== spec.type) add('incompatible-column-type', `public.${name}.${column}`, `expected ${spec.type}, found ${found.type}`)
      if (found.notNull !== spec.notNull) add('incompatible-nullability', `public.${name}.${column}`, `expected not null = ${spec.notNull}, found ${found.notNull}`)
      if (found.generated !== spec.generated) add('incompatible-generated-column', `public.${name}.${column}`, `expected generated = "${spec.generated}", found "${found.generated}"`)
      if (found.default !== spec.default) add('incompatible-default', `public.${name}.${column}`, `expected default ${spec.default || 'none'}, found ${found.default || 'none'}`)
    }
    for (const want_ of want.constraints) {
      // Names are deterministic (the migrations create them); the structural
      // key is the fallback for databases where a constraint was recreated.
      const match = got.constraints.find(c => c.name === want_.name)
        ?? got.constraints.find(c => c.type === want_.type && String(c.columns) === String(want_.columns)
          && (c.references ?? null) === (want_.references ?? null))
      const label = `${CONSTRAINT_KIND[want_.type] ?? want_.type} on public.${name}(${want_.columns.join(', ')})`
      if (!match) add('missing-constraint', label, want_.references ? `expected foreign key to ${want_.references}` : `expected ${want_.definition}`)
      else if (match.definition !== want_.definition) add('incompatible-constraint', label, `expected ${want_.definition}, found ${match.definition}`)
    }
    for (const want_ of want.indexes) {
      const match = got.indexes.find(i => i.name === want_.name)
        ?? got.indexes.find(i => i.definition === want_.definition)
      if (!match) add('missing-index', `public.${name} index ${want_.name}`, `expected ${want_.definition}`)
      else if (match.definition !== want_.definition) add('incompatible-index', want_.name, `expected ${want_.definition}, found ${match.definition}`)
    }
    for (const want_ of want.policies) {
      const match = got.policies.find(p => p.name === want_.name)
      const label = `public.${name} policy ${want_.name}`
      if (!match) add('missing-policy', label, `expected ${want_.cmd} policy for ${want_.roles}`)
      else if (match.cmd !== want_.cmd || match.roles !== want_.roles || match.qual !== want_.qual || match.withCheck !== want_.withCheck) {
        add('incompatible-policy', label, `expected ${want_.cmd} ${want_.roles} using (${want_.qual || '—'}) with check (${want_.withCheck || '—'})`)
      }
    }
    for (const want_ of want.triggers) {
      const match = got.triggers.find(t => t.name === want_.name)
      if (!match) add('missing-trigger', `public.${name} trigger ${want_.name}`, `expected ${want_.definition}`)
      else if (match.definition !== want_.definition) add('incompatible-trigger', `public.${name} trigger ${want_.name}`, `expected ${want_.definition}, found ${match.definition}`)
    }
  }

  for (const [signature, want] of Object.entries(expected.functions)) {
    const got = actual.functions[signature]
    if (!got) { add('missing-function', `public.${signature}`, `expected returns ${want.returns}`); continue }
    if (got.returns !== want.returns) add('incompatible-function', `public.${signature}`, `expected returns ${want.returns}, found ${got.returns}`)
    else if (got.volatility !== want.volatility) add('incompatible-function', `public.${signature}`, `expected volatility ${want.volatility}, found ${got.volatility}`)
    else if (got.securityDefiner !== want.securityDefiner) add('incompatible-function', `public.${signature}`, `expected security definer = ${want.securityDefiner}, found ${got.securityDefiner}`)
    else if (got.language !== want.language) add('incompatible-function', `public.${signature}`, `expected language ${want.language}, found ${got.language}`)
  }

  for (const [key, value] of Object.entries(expected.config)) {
    if (!(key in actual.config)) add('missing-config', `daily_quiz_config.${key}`, `expected ${value}`)
    else if (actual.config[key] !== value) add('incompatible-config', `daily_quiz_config.${key}`, `expected ${value}, found ${actual.config[key]}`)
  }

  // Extras are not failures on their own (a database may be further ahead), but
  // one of them is the fingerprint of the destructive migration.
  const rewardChecks = (table, state) => (state.tables[table]?.constraints ?? [])
    .filter(c => c.type === 'c' && /reward/.test(c.definition)).map(c => c.definition)
  const expectedReward = new Set(rewardChecks('daily_login_rewards', expected))
  // Only `reward = 0` on the check-in table is the fingerprint of the
  // destructive migration; `reward = 2` is the ordinary pre-20261118 state.
  const rewardCheck = (actual.tables.daily_login_rewards?.constraints ?? [])
    .find(c => c.type === 'c' && /reward\s*=\s*0/.test(c.definition) && !expectedReward.has(c.definition))
  if (rewardCheck) {
    notes.push(`a CHECK on the reward column exists (${rewardCheck.name}: ${rewardCheck.definition}) — ` +
      '20261118 appears to have run here. Use --baseline 20261118 (mode D) to move forward; ' +
      'reward values it already zeroed are NOT restored automatically.')
  }
  for (const name of Object.keys(actual.tables)) {
    if (!expected.tables[name]) notes.push(`extra table public.${name} (not part of this baseline)`)
  }
  for (const signature of Object.keys(actual.functions)) {
    if (!expected.functions[signature]) notes.push(`extra function public.${signature} (not part of this baseline)`)
  }
  return { problems, notes }
}

/* ------------------------------ verify ------------------------------- */

const readSnapshot = baseline => {
  try { return JSON.parse(readFileSync(snapshotPath(baseline), 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    throw new Error(`no readiness snapshot for baseline ${baseline} ` +
      `(expected ${snapshotPath(baseline).slice(REPO.length)}). Available: ${availableBaselines().join(', ')}. ` +
      'A baseline may only be recorded for a state this repository can verify — ' +
      'see docs/DB-MIGRATIONS.md, mode E.')
  }
}

/** Objects that a LATER migration adds. Finding one of them in the target means
 *  the declared baseline is too low: accepting it would skip migrations this
 *  database still needs, which is exactly how a database ends up half-migrated. */
export function aheadOfBaseline (declared, actual, baseline) {
  const extras = []
  const seen = new Set()
  const push = (object, detail) => {
    const key = `${object}|${detail}`
    if (seen.has(key)) return
    seen.add(key)
    extras.push({ kind: 'ahead-of-baseline', object, detail })
  }
  for (const higher of availableBaselines().filter(v => v > baseline)) {
    const future = readSnapshot(higher).state
    for (const table of Object.keys(future.tables)) {
      if (!declared.tables[table] && actual.tables[table]) {
        push(`public.${table}`, `created by a migration after ${baseline} (it is in the ${higher} fingerprint) — the baseline is too low`)
      }
    }
    for (const signature of Object.keys(future.functions)) {
      if (!declared.functions[signature] && actual.functions[signature]) {
        push(`public.${signature}`, `created by a migration after ${baseline} (it is in the ${higher} fingerprint) — the baseline is too low`)
      }
    }
    for (const [table, spec] of Object.entries(future.tables)) {
      if (!declared.tables[table] || !actual.tables[table]) continue
      for (const column of Object.keys(spec.columns)) {
        if (column in declared.tables[table].columns) continue
        if (column in actual.tables[table].columns) {
          push(`public.${table}.${column}`, `added by a migration after ${baseline} (it is in the ${higher} fingerprint) — the baseline is too low`)
        }
      }
    }
  }
  return extras
}

export async function verifyBaseline (client, baseline) {
  if (!/^\d{8}$/.test(String(baseline ?? ''))) throw new Error(`invalid baseline ${baseline}`)
  const snapshot = readSnapshot(baseline)
  const { rows: [probe] } = await client.query(`
    select to_regclass('public.profiles') is not null as has_tables,
           to_regclass('public.daily_login_rewards') is not null as has_login_rewards,
           version()`)
  const actual = await captureSchema(client)
  if (!probe.has_tables) {
    return {
      ok: false, baseline, problems: [{ kind: 'empty-database', object: 'public.profiles',
        detail: 'no app tables found — use the fresh-install setup path, not a baseline' }],
      notes: [], snapshot, postgres: probe.version,
    }
  }
  const { problems, notes } = diffSchema(snapshot.state, actual)
  problems.push(...aheadOfBaseline(snapshot.state, actual, baseline))
  return { ok: problems.length === 0, baseline, problems, notes, snapshot, postgres: probe.version, hasLoginRewards: probe.has_login_rewards }
}

export function formatReport (result) {
  const lines = []
  const head = result.ok ? `READY  baseline ${result.baseline}` : `NOT READY  baseline ${result.baseline}`
  lines.push(head)
  if (result.postgres) lines.push(`  server: ${result.postgres}`)
  if (result.snapshot?.generatedBy) lines.push(`  reference: ${result.snapshot.generatedBy}`)
  if (result.problems?.length) {
    lines.push(`  ${result.problems.length} problem(s):`)
    for (const p of result.problems) lines.push(`    ✗ [${p.kind}] ${p.object} — ${p.detail}`)
  }
  for (const note of result.notes ?? []) lines.push(`  note: ${note}`)
  return lines.join('\n')
}

/* --------------------------------- CLI -------------------------------- */

async function main (argv) {
  const args = { write: false, baseline: null, dbUrl: process.env.SUPABASE_DB_URL ?? null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') args.write = true
    else if (argv[i] === '--baseline') args.baseline = argv[++i]
    else if (argv[i] === '--db-url') args.dbUrl = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!args.baseline) throw new Error('--baseline <version> is required')
  if (!args.dbUrl) throw new Error('missing database URL: set SUPABASE_DB_URL or pass --db-url')
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: args.dbUrl })
  await client.connect()
  try {
    const state = await captureSchema(client)
    const { rows: [row] } = await client.query('select version()')
    const snapshot = {
      baseline: args.baseline,
      note: BASELINE_NOTES[args.baseline] ?? '',
      generatedBy: `tools/schema-readiness.mjs on ${row.version}`,
      postgresMajor: (row.version.match(/PostgreSQL (\d+)/) ?? [])[1] ?? null,
      state,
    }
    if (!args.write) {
      const result = await verifyBaseline(client, args.baseline)
      console.log(formatReport(result))
      return result.ok ? 0 : 1
    }
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    writeFileSync(snapshotPath(args.baseline), JSON.stringify(snapshot, null, 2) + '\n')
    console.log(`wrote ${snapshotPath(args.baseline).slice(REPO.length)} ` +
      `(${Object.keys(state.tables).length} tables, ${Object.keys(state.functions).length} functions, ` +
      `${Object.keys(state.config).length} config rows) — review it, then commit.`)
    return 0
  } finally { await client.end().catch(() => {}) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error(`refusing to continue: ${error.message}`)
    process.exitCode = 1
  })
}
