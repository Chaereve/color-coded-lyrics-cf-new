/* PGlite verification for the automatic-pick pause switch. No network, no
 * production credentials. Builds the baseline plus the admin audit migration,
 * then applies 20261223_pick_pause and proves the server-side contract:
 * only admins can flip it, cron is blocked while paused, manual/force paths stay
 * available, the schedule is not rewritten, and every real flip is audited. */
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
const MIGRATION = '20261223_pick_pause'

const SCAFFOLD = `
  do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated;
  create publication supabase_realtime;`

async function build () {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  // Mirror production's read-only settings ACL (the generic PGlite scaffold does
  // not install Supabase's default privileges).
  await db.exec('revoke insert, update, delete on public.settings from anon, authenticated;')
  await db.exec(read('supabase/migrations/20261213_admin_actions_and_request_edit.sql'))
  await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
  return db
}

async function seedUser (db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id
  if (admin) await db.query('update public.profiles set is_admin = true where id = $1', [id])
  return id
}

async function seedRequest (db, userId, title = 'Song') {
  return (await db.query(
    `insert into public.requests (user_id, artist, title, status, votes)
     values ($1, 'Artist', $2, 'queued', 10) returning id`, [userId, title])).rows[0].id
}

async function asUser (db, id, fn) {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec('set role authenticated;')
  try { return await fn() }
  finally {
    await db.exec('reset role;')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

const pickValue = async db => (await db.query("select value from public.settings where key = 'pick'")).rows[0]?.value
const pickedCount = async db => Number((await db.query('select count(*)::int as n from public.requests where picked_at is not null')).rows[0].n)
const auditRows = async db => (await db.query("select action, detail from public.admin_actions where action = 'pick_pause' order by id")).rows

test('pause switch is admin-only, audited, idempotent, and blocks the automatic picker', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const admin = await seedUser(db, 'admin@example.test', true)
    const member = await seedUser(db, 'member@example.test')
    const requestId = await seedRequest(db, member)

    assert.equal((await pickValue(db)).paused, false, 'migration seeds an explicit running state')

    await assert.rejects(
      asUser(db, member, () => db.query('select public.admin_set_pick_paused(true)')),
      /err\.adminOnly/,
    )
    await db.exec('set role anon;')
    try {
      await assert.rejects(
        db.query('select public.admin_set_pick_paused(true)'),
        /permission denied for function/,
      )
    } finally { await db.exec('reset role;') }
    await assert.rejects(
      asUser(db, admin, () => db.query('select public.admin_set_pick_paused(null)')),
      /err\.pickPauseInvalid/,
    )

    const before = await pickValue(db)
    const paused = await asUser(db, admin, async () =>
      JSON.parse((await db.query('select public.admin_set_pick_paused(true)::text as v')).rows[0].v))
    assert.equal(paused.paused, true)
    assert.equal(paused.interval_days, before.interval_days)
    assert.equal(paused.last_pick_at ?? null, before.last_pick_at ?? null)
    assert.equal(paused.next_pick_at ?? null, before.next_pick_at ?? null)
    assert.ok(paused.paused_at)

    const cron = await db.query('select * from public.pick_top_request(false)')
    assert.equal(cron.rows.length, 0, 'paused cron returns no request')
    assert.equal(await pickedCount(db), 0)
    assert.deepEqual(await pickValue(db), paused, 'blocked cron does not advance the schedule')

    // A second identical click is a no-op, not a second audit entry.
    await asUser(db, admin, () => db.query('select public.admin_set_pick_paused(true)'))
    assert.equal((await auditRows(db)).length, 1)

    const resumed = await asUser(db, admin, async () =>
      JSON.parse((await db.query('select public.admin_set_pick_paused(false)::text as v')).rows[0].v))
    assert.equal(resumed.paused, false)
    assert.equal(resumed.paused_at, null)
    const afterResume = await db.query('select * from public.pick_top_request(false)')
    assert.equal(afterResume.rows.length, 1)
    assert.equal(afterResume.rows[0].id, requestId)

    const audit = await auditRows(db)
    assert.deepEqual(audit.map(r => r.detail.paused), [[false, true], [true, false]])

    // Manual admin pick remains an intentional exception while paused.
    const manualId = await seedRequest(db, member, 'Manual')
    await asUser(db, admin, () => db.query('select public.admin_set_pick_paused(true)'))
    await asUser(db, admin, () => db.query('select * from public.admin_pick_group($1, true)', [manualId]))
    assert.equal((await db.query('select picked_at is not null as ok from public.requests where id = $1', [manualId])).rows[0].ok, true)

    // The documented SQL force path is also deliberate and still works.
    const forceId = await seedRequest(db, member, 'Force')
    const forced = await db.query('select * from public.pick_top_request(true)')
    assert.ok(forced.rows.some(r => r.id === forceId))
  } finally { await db.close() }
})

test('pause migration is safe to replay and creates the config row when missing', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const admin = await seedUser(db, 'replay@example.test', true)
    await asUser(db, admin, () => db.query('select public.admin_set_pick_paused(true)'))
    const before = await pickValue(db)
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    assert.deepEqual(await pickValue(db), before, 'replay preserves an existing pause state')

    await db.query("delete from public.settings where key = 'pick'")
    const created = await asUser(db, admin, async () =>
      JSON.parse((await db.query('select public.admin_set_pick_paused(false)::text as v')).rows[0].v))
    assert.equal(created.paused, false)
    assert.equal(created.interval_days, 4)
  } finally { await db.close() }
})
