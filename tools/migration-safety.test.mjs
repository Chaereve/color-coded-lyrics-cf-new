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
import { join, dirname } from 'node:path'
import {
  MIGRATIONS_DIR, SCHEMA_FILE, SETUP_DIR, DESTRUCTIVE_PATTERNS,
  collectMigrations, assertMigrationSafety, planPending, planLines, clipUntil, clipExcept, clipBatch,
  normalizeExcept, parseArgs, findDestructive, readQuarantine,
  stripExplicitTransaction, applyMigration, stripSqlNoise,
  normalizePath, pathName, pathDir, classifyMigrationFile,
  bundleBaseline, baselineObjects, postBaselineObjects, bundleAheadOfBaseline,
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
    mkdirSync(dirname(path), { recursive: true })
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

/* The fresh-install bundle is the NEWEST COMMITTED BASELINE, not "whatever the
   migrations end at". If schema.sql is ever regenerated from a database where a
   post-baseline migration already ran, it bakes in objects that only that
   migration creates. The runner would then refuse every fresh install with
   `err.voteCalendarPreflight: partial/unknown target objects already exist`,
   and verification could not tell the difference. These tests pin both halves:
   the current bundle is clean, and a regenerated one fails closed loudly. */

test('the fresh-install bundle stays at the newest committed baseline', () => {
  const floor = bundleBaseline()
  assert.equal(floor, '20261120', 'the bundle baseline is the newest committed fingerprint')
  const known = baselineObjects(floor)
  assert.ok(known.has('daily_quiz_config') && known.has('daily_free_vote_grant'),
    'objects the baseline already describes may be replaced by later migrations')
  const post = postBaselineObjects()
  // Exactly the objects migration 20261121 introduces; nothing from the baseline.
  for (const name of ['daily_vote_quota_config', 'daily_vote_quota_earnings', 'daily_vote_earned_on',
    'daily_vote_quota_bool', 'daily_vote_quota_int', 'daily_login_calendar_payload',
    'my_daily_login_status', 'claim_daily_login_calendar']) {
    assert.ok(post.has(name), `${name} must be recognised as a post-baseline object`)
  }
  for (const name of known) assert.equal(post.has(name), false,
    `${name} exists in baseline ${floor} and must never be treated as bundle-forbidden`)
  // The committed bundle is clean, and the guard agrees.
  const bundle = [SCHEMA_FILE,
    ...readdirSync(SETUP_DIR).filter(n => n.endsWith('.sql')).map(n => join(SETUP_DIR, n))]
  assert.deepEqual(bundleAheadOfBaseline(bundle), [], 'supabase/schema.sql + setup chunks are at the baseline')
  assert.doesNotThrow(() => assertMigrationSafety())
})

test('a regenerated schema.sql that contains post-baseline objects fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccl-bundle-'))
  const schema = join(dir, 'schema.sql')
  const setup = join(dir, 'setup')
  mkdirSync(setup)
  writeFileSync(join(setup, '16-daily-login-reward-immutable.sql'), 'select 1;\n')
  try {
    // What `npm run db:baseline:snapshot`-style regeneration from a cutover
    // database looks like: the neutral objects are now part of the bundle.
    writeFileSync(schema, [
      'create table public.daily_vote_quota_config (key text primary key, value jsonb not null);',
      'create or replace function public.my_daily_login_status() returns jsonb as $$ select \'{}\'::jsonb $$;',
    ].join('\n'))
    assert.throws(
      () => assertMigrationSafety(MIGRATIONS_DIR, { schemaFile: schema, setupDir: setup }),
      error => {
        assert.match(error.message, /ahead of baseline 20261120/)
        assert.match(error.message, /public\.daily_vote_quota_config .*20261121_vote_calendar_decoupling/)
        assert.match(error.message, /public\.my_daily_login_status/)
        assert.match(error.message, /regenerate it from a pre-cutover database, or supersede the baseline/)
        assert.match(error.message, /partial\/unknown target objects already exist/)
        return true
      })

    // A setup chunk is part of the same bundle and must be caught identically.
    writeFileSync(schema, 'select 1;\n')
    writeFileSync(join(setup, '17-vote-calendar-decoupling.sql'),
      'create table public.daily_vote_quota_earnings (source text not null, user_id uuid not null);')
    assert.throws(
      () => assertMigrationSafety(MIGRATIONS_DIR, { schemaFile: schema, setupDir: setup }),
      /17-vote-calendar-decoupling\.sql declares public\.daily_vote_quota_earnings/)

    // Documentation is not a declaration: comments and strings never trip it.
    writeFileSync(schema, [
      "-- 20261121 adds public.daily_vote_quota_config; it is NOT part of this bundle.",
      "select 'public.daily_vote_quota_earnings' as note;",
    ].join('\n'))
    writeFileSync(join(setup, '17-vote-calendar-decoupling.sql'), 'select 1;\n')
    assert.doesNotThrow(
      () => assertMigrationSafety(MIGRATIONS_DIR, { schemaFile: schema, setupDir: setup }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
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
      '20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
      '20261123_reconcile_security_drift', '20261124_restore_daily_free_votes',
      '20261125_reward_eligibility_and_quota_races', '20261126_reward_ledger',
      '20261127_login_streak_rewards', '20261128_achievements_v2',
      '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2', '20261203_mystery_month',
      '20261204_mystery_odds', '20261210_vote_back', '20261211_achievements_v3'])
  assert.ok(fresh.pending.every(({ version }) => version > '20261118'))
  assert.equal(fresh.quarantinedNeverRuns.length, 1)

  // B: an environment where 20261118 already ran (it is in the history table,
  // and the runner must still refuse to re-run it).
  const upTo = active.filter(({ version }) => version <= '20261117').map(({ id }) => id)
  const after = planPending({ active, quarantined, applied: [...upTo, '20261118_daily_login_no_votes'] })
  assert.deepEqual(after.pending.map(({ id }) => id),
    ['20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable',
      '20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
      '20261123_reconcile_security_drift', '20261124_restore_daily_free_votes',
      '20261125_reward_eligibility_and_quota_races', '20261126_reward_ledger',
      '20261127_login_streak_rewards', '20261128_achievements_v2',
      '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2', '20261203_mystery_month',
      '20261204_mystery_odds', '20261210_vote_back', '20261211_achievements_v3'])
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
    ['20261120_daily_login_reward_immutable', '20261121_vote_calendar_decoupling',
      '20261122_disable_daily_quiz_runtime', '20261123_reconcile_security_drift',
      '20261124_restore_daily_free_votes', '20261125_reward_eligibility_and_quota_races',
      '20261126_reward_ledger', '20261127_login_streak_rewards', '20261128_achievements_v2',
      '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2', '20261203_mystery_month',
      '20261204_mystery_odds', '20261210_vote_back', '20261211_achievements_v3'])

  // Already up to date.
  const done = planPending({ active, quarantined, applied: active.map(({ id }) => id) })
  assert.deepEqual(done.pending, [])
})

test('the quiz-runtime migration is revoke-only: no drop, no update, no new object', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '20261122_disable_daily_quiz_runtime.sql'), 'utf8')
  const statements = stripSqlNoise(sql)
  assert.match(sql, /^begin;[\s\S]*^commit;\s*$/m, 'một transaction, append-only')
  assert.doesNotMatch(statements, /\bdrop\b|\bcascade\b|\bdelete\b|\btruncate\b/i,
    'không câu lệnh nào xoá dữ liệu hay object')
  assert.doesNotMatch(statements, /\bupdate\s+public\./i, 'không UPDATE bảng nào')
  assert.doesNotMatch(statements, /create\s+(or\s+replace\s+)?(table|function|index|view|policy)/i,
    'không tạo object mới: bundle fresh-install và baseline 20261120 giữ nguyên')
  assert.match(sql, /to_regclass\('supabase_migrations\.schema_migrations'\) is null[\s\S]*migration history is missing/,
    'thiếu bảng history là abort')
  assert.match(sql, /20261121_vote_calendar_decoupling[\s\S]*is not recorded/, 'phải chạy sau cutover 20261121')
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const signature of ['public.start_daily_quiz(uuid,date)', 'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
    'public.submit_daily_quiz(uuid,uuid,int[])', 'public.my_daily_rewards_status()', 'public.claim_daily_login(uuid,date)']) {
    assert.match(sql, new RegExp(`'${escapeRegex(signature)}'`), `danh sách revoke phải có ${signature}`)
  }
  assert.match(sql, /revoke all on function %s from public, anon, authenticated/,
    'revoke cả pseudo-role public, không chỉ hai role có tên')
  assert.match(sql, /has_function_privilege\('authenticated', v_name, 'EXECUTE'\)[\s\S]*quiz entry point is still callable/,
    'post-condition: cửa quiz phải thật sự đóng sau khi revoke')
  assert.match(sql, /public\.my_daily_login_status\(\)[\s\S]*public\.cast_vote\(uuid,integer,text,text,text\)/,
    'post-condition: API còn sống (Calendar + vote) phải giữ grant')
  assert.match(sql, /v_quiz_counts_after is distinct from v_quiz_counts_before/,
    'đếm lại số dòng bảng quiz: revoke không được đổi dữ liệu')
  assert.match(sql, /notify pgrst, 'reload schema';/, 'ACL đổi thì PostgREST phải nạp lại cache')

  const rollback = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)),
    'supabase', 'rollback', '20261122_disable_daily_quiz_runtime.sql'), 'utf8')
  assert.doesNotMatch(stripSqlNoise(rollback), /\bdrop\b|\bcascade\b|\bdelete\b|\btruncate\b/i)
  assert.match(rollback, /grant execute on function %s to authenticated/)
  assert.match(rollback, /public\.submit_daily_quiz\(uuid,uuid,int\[\]\)[\s\S]*must stay closed/,
    'cửa đã đóng từ 20261117 (bản nộp một lần) không được mở lại')
  assert.match(rollback, /has_function_privilege\('authenticated', v_name, 'EXECUTE'\)[\s\S]*the disable is not the live state/,
    'rollback fail-closed khi disable không còn là trạng thái sống')
})

test('the vote/Calendar migration is fail-closed, transactional, and keeps Calendar identity server-side', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '20261121_vote_calendar_decoupling.sql'), 'utf8')
  assert.match(sql, /^begin;[\s\S]*^commit;\s*$/m)
  assert.doesNotMatch(stripSqlNoise(sql), /\bdrop\b|\bcascade\b/i)
  assert.match(sql, /to_regclass\('supabase_migrations\.schema_migrations'\) is null[\s\S]*migration history is missing/)
  assert.match(sql, /lock table public\.profiles,[\s\S]*in share mode;/i)
  assert.match(sql, /create temporary table _ccl_vote_quiz_source_snapshot as/i)
  assert.match(sql, /an awarded quiz answer has an empty source key/)
  assert.ok(sql.indexOf('do $snapshot_guard$') < sql.indexOf('insert into public.daily_vote_quota_earnings'),
    'invalid source keys are rejected before inserting any earning event')
  assert.match(sql, /raise exception 'err\.voteCalendarBackfill/)
  assert.match(sql, /raise exception 'err\.voteCalendarQuota/)
  assert.match(sql, /except all/)
  assert.match(sql, /count\(distinct \(user_id, quiz_date, question_id\)\)/)
  assert.match(sql, /daily_quiz_answers_awarded_check/)
  assert.match(sql, /indnkeyatts = 3 and i\.indnatts = 3/)
  assert.match(sql, /daily_quiz_attempts_user_quiz_date_idx/)
  assert.match(sql, /public\.daily_quiz_attempts\|quiz_day\|date\|true/)
  assert.match(sql, /where question_count = 5[\s\S]*quiz_date is null or quiz_day is distinct from quiz_date/)
  assert.match(sql, /t\.tgtype = 23/)
  assert.match(sql, /activity_days idempotency constraint is missing/)
  assert.match(sql, /source_key, amount, recorded_at\)[\s\S]*p_question_id, 1, v_now/)
  assert.match(sql, /left join public\.daily_login_rewards c[\s\S]*c\.reward_day <= d\.day/)
  assert.match(sql, /daily_vote_quota_config.*from public\.daily_quiz_config/s)
  assert.match(sql, /enable row level security;[\s\S]*revoke all on public\.daily_vote_quota_config, public\.daily_vote_quota_earnings from public, anon, authenticated;[\s\S]*grant all on public\.daily_vote_quota_config, public\.daily_vote_quota_earnings to service_role;/)
  assert.match(sql, /create or replace function public\.daily_free_vote_grant[\s\S]*daily_vote_quota_bool/)
  assert.match(sql, /daily_vote_quota_earnings[\s\S]*primary key \(source, user_id, vote_day, source_key\)/)
  const cutover = sql.indexOf('create or replace function public.daily_free_vote_grant', sql.indexOf('$equivalence$;'))
  assert.ok(cutover > sql.indexOf('$equivalence$;'), 'vote cutover follows every backfill/quota assertion')
  // Fail-closed neutral typed readers: no silent default quota may exist.
  for (const reader of ['daily_vote_quota_bool', 'daily_vote_quota_int']) {
    assert.match(sql,
      new RegExp(`create or replace function public\\.${reader}\\(p_key text\\)[\\s\\S]*?raise exception 'err\\.voteQuotaConfig'`),
      `${reader} raises on a missing/NULL/mistyped neutral config row instead of defaulting`)
    assert.match(sql, new RegExp(`revoke all on function public\\.${reader}\\(text\\) from public, anon, authenticated;`))
  }
  assert.match(sql, /p\.proname in \('daily_vote_earned_on','daily_login_calendar_payload',\s*'my_daily_login_status','claim_daily_login_calendar',\s*'daily_vote_quota_bool','daily_vote_quota_int'\)/,
    'the preflight refuses partial target objects, including the typed readers')
  const calendarClaim = sql.slice(sql.indexOf('create or replace function public.claim_daily_login_calendar'),
    sql.indexOf('revoke all on function public.claim_daily_login_calendar'))
  assert.match(calendarClaim, /p_expected_day date/)
  assert.match(calendarClaim, /auth\.uid\(\)/)
  assert.match(calendarClaim, /v_now := clock_timestamp\(\);[\s\S]*v_day := \(v_now at time zone 'Asia\/Ho_Chi_Minh'\)::date/)
  assert.match(calendarClaim, /p_expected_day is distinct from v_day/)
  assert.doesNotMatch(calendarClaim, /p_expected_user_id|p_uid|p_user_id/)
  const calendarStatus = sql.slice(sql.indexOf('create or replace function public.my_daily_login_status'),
    sql.indexOf('revoke all on function public.my_daily_login_status'))
  assert.match(calendarStatus, /auth\.uid\(\)/)
  assert.match(calendarStatus, /clock_timestamp\(\)/)
  assert.doesNotMatch(calendarStatus, /p_expected_user_id|p_uid|p_user_id/)
  const calendarPayload = sql.slice(sql.indexOf('create or replace function public.daily_login_calendar_payload'),
    sql.indexOf('revoke all on function public.daily_login_calendar_payload'))
  assert.doesNotMatch(calendarPayload, /quiz|votes_awarded|credits|purchased|bonus/i)
  assert.match(calendarPayload, /reward_day <= d\.day/,
    'future/corrupt rows do not inflate Calendar totals or streaks')
  const grant = sql.slice(sql.indexOf('create or replace function public.daily_free_vote_grant'),
    sql.indexOf('revoke all on function public.daily_free_vote_grant'))
  assert.match(grant, /daily_vote_quota_bool/)
  assert.match(grant, /daily_vote_quota_int/)
  assert.doesNotMatch(grant, /daily_quiz_(?:int|bool)|\b(?:3|5)\b/)
  // REGRESSION PIN (the CI failure that sank Draft PR #29): the committed
  // 20261120 fingerprint records daily_free_vote_grant as language sql. A
  // plpgsql replacement changes a fingerprint-visible attribute, so mode B of
  // baselineReadiness ("the bootstrap lands in the final state") fails against
  // verifyBaseline('20261120'). Fail-closed strictness belongs in the typed
  // readers above, never in the grant function's visible shape.
  assert.match(grant, /returns integer language sql stable security definer set search_path = public/i,
    'the cutover keeps daily_free_vote_grant attribute-compatible with baseline 20261120 (language sql)')
  const rollback = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)),
    'supabase', 'rollback', '20261121_vote_calendar_decoupling.sql'), 'utf8')
  assert.doesNotMatch(stripSqlNoise(rollback), /\bdrop\b|\bcascade\b/i)
  for (const functionName of ['daily_free_vote_grant', 'my_vote_status', 'cast_vote', 'submit_daily_quiz_answer']) {
    const declarations = rollback.match(new RegExp(`create or replace function public\\.${functionName}\\b`, 'g')) || []
    assert.equal(declarations.length, 1, `rollback restores ${functionName} exactly once`)
  }
  assert.match(rollback, /grant execute on function public\.my_vote_status\(\) to authenticated/)
  assert.match(rollback, /grant execute on function public\.cast_vote\(uuid,integer,text,text,text\) to authenticated/)
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

test('the daily free-vote policy flip is config-only, fail-closed, and reversible from the recorded policy', () => {
  /* stripSqlNoise blanks string literals, which would hide the key/value pairs
     this file is made of. Use a comment-only strip: neither file contains `--`
     inside a string literal, so the key names and predicates stay readable
     while comments (documentation) cannot satisfy an assertion. */
  const code = sql => sql.replace(/--[^\n]*/g, '')

  const sql = readFileSync(join(MIGRATIONS_DIR, '20261124_restore_daily_free_votes.sql'), 'utf8')
  const raw = code(sql)
  assert.match(sql, /^begin;[\s\S]*^commit;\s*$/m)
  // No DDL and no DML at all: the fresh-install bundle and the committed 20261120
  // fingerprint must stay exactly where they are, and no row but config moves.
  assert.doesNotMatch(raw, /\bdrop\b|\bcascade\b|\btruncate\b|\bdelete\b/i)
  assert.doesNotMatch(raw, /\binsert\s+into\b/i)
  assert.doesNotMatch(raw, /create\s+(or\s+replace\s+)?(table|function|index|policy|trigger|view|type)\b/i)
  assert.doesNotMatch(raw, /alter\s+table/i)
  // Exactly four UPDATE statements: two keys in each of the two config copies,
  // and the optional global cap pair is never assigned by this file.
  assert.equal((raw.match(/update\s+public\.(?:daily_vote_quota_config|daily_quiz_config)\b/gi) || []).length, 4)
  assert.equal((raw.match(/where key = 'free_vote_grant_enabled' and value is distinct from 'true'::jsonb/g) || []).length, 2,
    'the enable switch is flipped in both copies without touching an already-target row')
  assert.equal((raw.match(/where key = 'free_votes_per_day' and value is distinct from '3'::jsonb/g) || []).length, 2)
  assert.equal((raw.match(/update[^;]*?set value[^;]*?where key = 'global_daily_vote_cap/gs) || []).length, 0,
    'the cap pair is only read (snapshot/compare), never written')
  assert.equal((raw.match(/update\s+public\.(?:profiles|votes|requests|daily_login_rewards|daily_quiz_answers|daily_vote_quota_earnings)\b/gi) || []).length, 0)
  // Fail-closed on both ends, and the previous policy is recorded for the rollback.
  assert.match(raw, /raise exception 'err\.dailyFreeVotesPreflight/)
  assert.match(raw, /raise exception 'err\.dailyFreeVotesState/)
  assert.match(raw, /current_setting\('ccl\.dailyfree\.counts'\)/, 'row counts and wallet sums are re-compared in the same transaction')
  assert.match(raw, /previous live policy: /)
  assert.match(raw, /public\.my_vote_status\(\)/, 'the post-check calls the function the panel reads')
  assert.match(raw, /notify pgrst, 'reload schema';/)

  const rollback = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)),
    'supabase', 'rollback', '20261124_restore_daily_free_votes.sql'), 'utf8')
  const rollbackRaw = code(rollback)
  assert.doesNotMatch(rollbackRaw, /\bdrop\b|\bcascade\b|\btruncate\b|\bdelete\b/i)
  assert.doesNotMatch(rollbackRaw, /\binsert\s+into\b/i)
  assert.doesNotMatch(rollbackRaw, /create\s+(or\s+replace\s+)?(table|function|index|policy|trigger|view|type)\b/i)
  assert.equal((rollbackRaw.match(/update\s+public\.(?:profiles|votes|requests|daily_login_rewards)\b/gi) || []).length, 0)
  assert.match(rollbackRaw, /previous live policy/,
    'the rollback restores the values the migration recorded, never a guessed policy')
  assert.match(rollbackRaw, /does not record the previous live policy/,
    'a missing record is an abort, not a default')
  assert.match(rollbackRaw, /err\.dailyFreeVotesRollback: the live policy is not the state 20261124 installed/)
  // Both files belong to the post-baseline path only: nothing is mirrored into the
  // fresh-install bundle, which must stay at baseline 20261120.
  assert.equal(bundleAheadOfBaseline([SCHEMA_FILE,
    ...readdirSync(SETUP_DIR).filter(n => n.endsWith('.sql')).map(n => join(SETUP_DIR, n))]).length, 0)
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

/* Windows + Git Bash: `readdirSync`/`join` trả '\\' nên code cũ (`lastIndexOf('/')`)
   coi tệp TOP-LEVEL là tệp trong thư mục con và `db:plan` chết với thông báo
   "supabase/migrations/C:\\Users\\…\\20250601_auto_pick.sql is not a migration".
   Bài này khoá lại cách phân loại không phụ thuộc dấu phân cách. */
test('phân loại đường dẫn không phụ thuộc dấu phân cách (Windows \\ và POSIX /)', () => {
  const win = { file: 'C:\\Users\\kimto\\repo\\supabase\\migrations\\20250601_auto_pick.sql', dir: 'C:\\Users\\kimto\\repo\\supabase\\migrations' }
  const posix = { file: '/home/kimto/repo/supabase/migrations/20250601_auto_pick.sql', dir: '/home/kimto/repo/supabase/migrations' }
  const mixed = { file: 'supabase/migrations\\20250601_auto_pick.sql', dir: 'supabase/migrations/' }

  for (const { file, dir } of [win, posix, mixed]) {
    const classified = classifyMigrationFile(file, dir)
    assert.equal(classified.name, '20250601_auto_pick.sql', `tên tệp phải là basename: ${file}`)
    assert.equal(classified.topLevel, true, `tệp top-level phải được nhận là top-level: ${file}`)
  }

  /* Tệp trong thư mục con thì vẫn phải bị coi là KHÔNG top-level — nếu không,
     guard "Supabase CLI chỉ quét top level" sẽ mất tác dụng. */
  for (const nested of ['supabase\\migrations\\archive\\20261118_x.sql', 'supabase/migrations/archive/20261118_x.sql']) {
    const classified = classifyMigrationFile(nested, 'supabase/migrations')
    assert.equal(classified.topLevel, false, `tệp trong thư mục con: ${nested}`)
    assert.equal(classified.name, '20261118_x.sql')
  }

  assert.equal(normalizePath('supabase\\migrations\\'), 'supabase/migrations')
  assert.equal(normalizePath('C:\\repo\\supabase\\migrations'), 'C:/repo/supabase/migrations')
  assert.equal(pathName('a\\b\\c.sql'), 'c.sql')
  assert.equal(pathDir('a\\b\\c.sql'), 'a\\b')

  /* Và trên chính máy này: quét thật vẫn phải ra đúng 51 migration đang hoạt động
     (41 cũ + ba bản B1: 20261126/27/28 + B2: 20261129 + B3: 20261201
     + bản sửa bảng giải mystery v2: 20261202 + lịch sử tháng: 20261203
     + siết tỉ lệ hộp: 20261204 + vote-back: 20261210
     + catalog thành tựu v3: 20261211). */
  const { active, quarantined } = collectMigrations()
  assert.equal(active.length, 51)
  assert.equal(quarantined.length, 1)
  assert.ok(active.every(({ id }) => !id.includes('\\') && !id.includes('/')), 'id không được chứa dấu phân cách')
})

test('db:plan phải LIỆT KÊ các migration sẽ chạy, không được chỉ in dòng skip', () => {
  /* Lỗi đã gặp trên database production (mode E): `db:plan -- --baseline 20261120`
     in "skip 36 migration(s) …" rồi hết, vì nhánh plan trả về trước vòng lặp in.
     Người vận hành tưởng không có gì để chạy. Bài này khoá lại hợp đồng: danh
     sách pending phải được in ra, và phải liệt kê đủ các bản > 20261120. */
  const { active, quarantined } = collectMigrations()
  const planned = planPending({ active, quarantined, applied: [], baseline: '20261120' })
  assert.deepEqual(planned.pending.map(({ id }) => id),
    ['20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
      '20261123_reconcile_security_drift', '20261124_restore_daily_free_votes',
      '20261125_reward_eligibility_and_quota_races', '20261126_reward_ledger',
      '20261127_login_streak_rewards', '20261128_achievements_v2',
      '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2',
      '20261203_mystery_month', '20261204_mystery_odds', '20261210_vote_back',
      '20261211_achievements_v3'])
  const lines = planLines(planned)
  assert.equal(lines[0], '15 migration(s) would be applied:')
  assert.deepEqual(lines.slice(1), [
    'apply 20261121  20261121_vote_calendar_decoupling.sql',
    'apply 20261122  20261122_disable_daily_quiz_runtime.sql',
    'apply 20261123  20261123_reconcile_security_drift.sql',
    'apply 20261124  20261124_restore_daily_free_votes.sql',
    'apply 20261125  20261125_reward_eligibility_and_quota_races.sql',
    'apply 20261126  20261126_reward_ledger.sql',
    'apply 20261127  20261127_login_streak_rewards.sql',
    'apply 20261128  20261128_achievements_v2.sql',
    'apply 20261129  20261129_mystery_box.sql',
    'apply 20261201  20261201_spin_v2.sql',
    'apply 20261202  20261202_mystery_paid_v2.sql',
    'apply 20261203  20261203_mystery_month.sql',
    'apply 20261204  20261204_mystery_odds.sql',
    'apply 20261210  20261210_vote_back.sql',
    'apply 20261211  20261211_achievements_v3.sql',
  ])
  /* Và khi không còn gì để chạy thì hàm không được bịa ra dòng nào. */
  const done = planPending({ active, quarantined, applied: active.map(({ id }) => id), baseline: '20261120' })
  assert.deepEqual(done.pending, [])
  assert.deepEqual(planLines(done).slice(1), [])
})

test('--until 20261128 keeps B1 and holds every later batch', () => {
  const pending = [
    '20261126_reward_ledger', '20261127_login_streak_rewards', '20261128_achievements_v2',
    '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2',
    '20261203_mystery_month', '20261204_mystery_odds', '20261210_vote_back',
  ].map(id => ({ id, version: id.slice(0, 8), name: `${id}.sql` }))
  const { pending: batch, held } = clipUntil(pending, '20261128')
  assert.deepEqual(batch.map(({ id }) => id), [
    '20261126_reward_ledger', '20261127_login_streak_rewards', '20261128_achievements_v2',
  ])
  assert.deepEqual(held.map(({ id }) => id), [
    '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2',
    '20261203_mystery_month', '20261204_mystery_odds', '20261210_vote_back',
  ])
  const lines = planLines({ pending: batch, held, until: '20261128' })
  assert.equal(lines[0], '3 migration(s) would be applied:')
  assert.match(lines.join('\n'), /hold 6 migration\(s\) after --until 20261128/)
  assert.doesNotMatch(lines.join('\n'), /^apply 20261129/m)
})

const B2_PENDING = [
  '20261129_mystery_box', '20261201_spin_v2', '20261202_mystery_paid_v2',
  '20261203_mystery_month', '20261204_mystery_odds', '20261210_vote_back',
].map(id => ({ id, version: id.slice(0, 8), name: `${id}.sql` }))

test('--until 20261204 --except 20261201 keeps B2 and holds B3+B4', () => {
  const { pending: batch, held } = clipBatch(B2_PENDING, { until: '20261204', except: ['20261201'] })
  assert.deepEqual(batch.map(({ id }) => id), [
    '20261129_mystery_box',
    '20261202_mystery_paid_v2',
    '20261203_mystery_month',
    '20261204_mystery_odds',
  ])
  assert.deepEqual(held.map(({ id }) => id), [
    '20261201_spin_v2',
    '20261210_vote_back',
  ])
  const lines = planLines({ pending: batch, held, until: '20261204', except: ['20261201'] })
  assert.equal(lines[0], '4 migration(s) would be applied:')
  assert.match(lines.join('\n'), /hold 2 migration\(s\) after --until 20261204 \/ --except 20261201/)
  assert.match(lines.join('\n'), /^hold 20261201 {2}20261201_spin_v2\.sql$/m)
  assert.match(lines.join('\n'), /^hold 20261210 {2}20261210_vote_back\.sql$/m)
  assert.doesNotMatch(lines.join('\n'), /^apply 20261201/m)
  assert.doesNotMatch(lines.join('\n'), /^apply 20261210/m)
})

test('--except alone holds that version; --until 20261204 without except still pulls B3', () => {
  const onlyExcept = clipExcept(B2_PENDING, '20261201')
  assert.deepEqual(onlyExcept.held.map(({ id }) => id), ['20261201_spin_v2'])
  assert.equal(onlyExcept.pending.length, 5)
  const untilOnly = clipUntil(B2_PENDING, '20261204')
  assert.deepEqual(untilOnly.pending.map(({ version }) => version), [
    '20261129', '20261201', '20261202', '20261203', '20261204',
  ])
})

test('--except of a version already past --until does not duplicate hold', () => {
  const { pending: batch, held } = clipBatch(B2_PENDING, { until: '20261204', except: ['20261210'] })
  assert.equal(held.filter(({ version }) => version === '20261210').length, 1)
  assert.ok(batch.every(({ version }) => version !== '20261210'))
})

test('normalizeExcept / parseArgs accept one version, repeats, and commas', () => {
  assert.deepEqual(normalizeExcept('20261201'), ['20261201'])
  assert.deepEqual(normalizeExcept(['20261201', '20261201', '20261210']), ['20261201', '20261210'])
  assert.deepEqual(normalizeExcept('20261201,20261210'), ['20261201', '20261210'])
  assert.throws(() => normalizeExcept('spin_v2'), /invalid --except/)
  assert.throws(() => clipUntil(B2_PENDING, '2026-12-04'), /invalid --until/)
  const args = parseArgs(['--plan', '--until', '20261204', '--except', '20261201'])
  assert.equal(args.mode, 'plan')
  assert.equal(args.until, '20261204')
  assert.deepEqual(args.except, ['20261201'])
  const repeated = parseArgs(['--plan', '--except', '20261201', '--except', '20261210'])
  assert.deepEqual(repeated.except, ['20261201', '20261210'])
  assert.throws(() => parseArgs(['--plan', '--except']), /missing --except/)
})
