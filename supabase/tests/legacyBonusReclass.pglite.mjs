/* PGlite verification for 20261227_legacy_bonus_reclass. No network/production.
 * Proves the owner-confirmed nine-row relabel is atomic, scoped, idempotent,
 * audited, and never touches queue position, votes, wallets or orders. */
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
const MIGRATION = '20261227_legacy_bonus_reclass'
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261213_admin_actions_and_request_edit',
  '20261217_protect_paid_request_orders', '20261221_notification_inbox_fix', '20261224_payment_source',
  '20261225_payment_operations', '20261226_payment_source_read_grant']

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

const SPECS = [
  { id: '596f9161-9de0-46c8-97ce-8bd86a9f47de', artist: 'idntt', title: 'Linda Mía', group: 'park', status: 'in_progress', votes: 12, picked: true },
  { id: '602aacfc-6c08-4f05-bc8d-1665e09f8195', artist: 'ChRocktikal', title: 'Guilty', group: 'ddd', status: 'queued', votes: 8 },
  { id: 'c83afaf1-80dc-4b34-a5e8-356867f493d9', artist: 'ChRocktikal', title: 'Green', group: 'ddd', status: 'queued', votes: 5 },
  { id: 'ba31835f-a0c9-45aa-b85a-099fc406a229', artist: 'ChRocktikal', title: '¡Corre!', group: 'ddd', status: 'queued', votes: 3 },
  { id: '8f07c0c1-137b-49ca-b7f7-4ce524dc7d9e', artist: 'PLAVE', title: 'BBUU!', group: 'jj', status: 'queued', votes: 20 },
  { id: 'd1f642d5-fc7e-4ccd-8a06-ad22d9b330dd', artist: 'PLAVE', title: 'Bongsoong-a', group: 'jj', status: 'queued', votes: 17 },
  { id: '3cbecd66-2541-40a5-be8a-35045f7ac43f', artist: 'PLAVE', title: 'Hide and Seek (Korean Ver.)', group: 'jj', status: 'queued', votes: 11 },
  { id: '3a5cb17d-17ea-42d6-986b-6d7b74ede002', artist: 'PLAVE', title: 'Star Trace', group: 'jj', status: 'queued', votes: 9 },
  { id: '584cbc31-1d40-4179-b04b-9f0f4c2cf07f', artist: 'XLOV', title: 'TOOTH GEM CHIWAWA', group: 'jerome', status: 'queued', votes: 2 },
]
const IDS = SPECS.map(s => s.id)

async function build({ apply = false } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of CHAIN) await db.exec(read(`supabase/migrations/${name}.sql`))
  if (apply) await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
  return db
}
async function seedUser(db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id,email) values (gen_random_uuid(),$1) returning id', [email])).rows[0].id
  if (admin) await db.query('update public.profiles set is_admin=true where id=$1', [id])
  return id
}
async function asUser(db, id, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated;')
  try { return await fn() } finally {
    await db.exec('reset role;')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
  }
}
async function seedLegacySet(db, { bonusIds = [] } = {}) {
  const users = {}
  for (const [group, balance] of [['park', 0], ['ddd', 2], ['jj', 0], ['jerome', 0]]) {
    users[group] = await seedUser(db, `${group}@example.test`)
    await db.query('update public.profiles set bonus_requests=$2, vote_credits=7, bonus_credits=5 where id=$1', [users[group], balance])
  }
  const admin = await seedUser(db, 'admin@example.test', true)
  for (const s of SPECS) {
    await db.query(`insert into public.requests
      (id,user_id,artist,title,requester,status,is_paid,payment_status,payment_source,votes,progress,picked_at,created_at,updated_at)
      values ($1,$2,$3,$4,$5,$6,true,'paid',$7,$8,$9,$10,'2026-11-01T00:00:00Z','2026-11-02T00:00:00Z')`,
    [s.id, users[s.group], s.artist, s.title, s.group, s.status, bonusIds.includes(s.id) ? 'bonus' : 'legacy',
      s.votes, s.picked ? 40 : 0, s.picked ? '2026-11-03T00:00:00Z' : null])
  }
  // An unrelated live vote order: the relabel must not create or resolve orders.
  await db.query(`insert into public.orders (user_id,kind,qty,amount_usd,amount_vnd,status)
    values ($1,'votes',3,0.49,13000,'awaiting')`, [users.ddd])
  return { users, admin }
}
const apply = db => db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
const rollback = db => db.exec(read(`supabase/rollback/${MIGRATION}.sql`))
const sources = db => db.query('select id::text, payment_source from public.requests where id=any($1::uuid[]) order by id', [IDS]).then(r => r.rows)
const auditCount = db => db.query("select count(*)::int n from public.admin_actions where detail->>'migration'=$1", [MIGRATION]).then(r => r.rows[0].n)

async function invariantSnapshot(db) {
  const requests = (await db.query(`select id::text, md5((to_jsonb(r) - 'payment_source')::text) as fingerprint
    from public.requests r where id=any($1::uuid[]) order by id`, [IDS])).rows
  const profiles = (await db.query('select id::text, md5(to_jsonb(p)::text) as fingerprint from public.profiles p order by id')).rows
  const counts = (await db.query(`select
    (select count(*)::int from public.requests) as requests,
    (select count(*)::int from public.votes) as votes,
    (select count(*)::int from public.orders) as orders,
    (select count(*)::int from public.notifications) as notifications,
    (select count(*)::int from public.watches) as watches,
    (select count(*)::int from public.profiles) as profiles,
    (select md5(string_agg(value::text, ',' order by key)) from public.settings) as settings`)).rows[0]
  return { requests, profiles, counts }
}

test('nine legacy rows become bonus; queue, votes, wallets, orders and notifications are byte-stable; rerun is a no-op', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const { admin } = await seedLegacySet(db)
    const before = await invariantSnapshot(db)
    await apply(db)
    assert.deepEqual(await invariantSnapshot(db), before)
    assert.ok((await sources(db)).every(r => r.payment_source === 'bonus'))
    assert.equal(await auditCount(db), 9)

    const audit = (await db.query("select actor, action, label, detail from public.admin_actions where detail->>'migration'=$1 order by target_id", [MIGRATION])).rows
    assert.ok(audit.every(a => a.actor === null && a.action === 'edit'))
    assert.ok(audit.every(a => JSON.stringify(a.detail.payment_source) === '["legacy","bonus"]'))
    assert.ok(audit.every(a => a.detail.reason === 'Owner confirmed bonus-funded legacy request'))
    const linda = audit.find(a => a.label === 'idntt — Linda Mía')
    assert.ok(linda, 'audit label must snapshot artist — title')

    const page = (await asUser(db, admin, () => db.query('select public.admin_actions_page(20,0) as payload'))).rows[0].payload
    assert.equal(page.total, 9)
    const systemRow = page.rows.find(r => r.target_id === IDS[0])
    assert.equal(systemRow.actor_name, 'System')
    assert.deepEqual(systemRow.detail.payment_source, ['legacy', 'bonus'])

    await apply(db)
    assert.equal(await auditCount(db), 9, 'rerun must not duplicate audit rows')
    assert.deepEqual(await invariantSnapshot(db), before)
    assert.ok((await sources(db)).every(r => r.payment_source === 'bonus'))
  } finally { await db.close() }
})

test('a live money order on any expected row aborts the whole migration', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const { users } = await seedLegacySet(db)
    const before = await invariantSnapshot(db)
    await db.query(`insert into public.orders (user_id,kind,qty,amount_usd,amount_vnd,status,request_id)
      values ($1,'paid_request',0,0.75,20000,'awaiting',$2)`, [users.park, IDS[0]])
    const withOrder = await invariantSnapshot(db)
    await assert.rejects(apply(db), /err\.paymentMigrationConflict/)
    await db.exec('rollback;')
    assert.deepEqual(await invariantSnapshot(db), withOrder)
    assert.ok((await sources(db)).every(r => r.payment_source === 'legacy'))
    assert.equal(await auditCount(db), 0)
    assert.notDeepEqual(withOrder.counts.orders, before.counts.orders)
  } finally { await db.close() }
})

test('a target that is no longer a paid priority request aborts without partial writes', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    await seedLegacySet(db)
    await db.query("update public.requests set is_paid=false, payment_status='none', payment_source=null where id=$1", [IDS[4]])
    const before = await invariantSnapshot(db)
    await assert.rejects(apply(db), /err\.paymentMigrationConflict/)
    await db.exec('rollback;')
    assert.deepEqual(await invariantSnapshot(db), before)
    assert.equal((await sources(db)).filter(r => r.payment_source === 'bonus').length, 0)
    assert.equal(await auditCount(db), 0)
  } finally { await db.close() }
})

test('a partially missing production set aborts; a fresh database with none of the UUIDs is a no-op', { timeout: 120_000 }, async () => {
  const partial = await build()
  try {
    await seedLegacySet(partial)
    await partial.query('delete from public.requests where id=$1', [IDS[8]])
    await assert.rejects(apply(partial), /err\.paymentMigrationConflict/)
    await partial.exec('rollback;')
    assert.equal((await sources(partial)).length, 8)
    assert.equal(await auditCount(partial), 0)
  } finally { await partial.close() }

  const fresh = await build()
  try {
    await apply(fresh)
    assert.equal((await sources(fresh)).length, 0)
    assert.equal(await auditCount(fresh), 0)
    await apply(fresh)
    assert.equal(await auditCount(fresh), 0)
  } finally { await fresh.close() }
})

test('rollback restores only rows whose latest funding audit is this migration, keeps both audit directions, and is rerunnable', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    // One UUID was already a genuine bonus request before the migration. It has
    // no legacy -> bonus audit, so rollback must not turn it into legacy.
    await seedLegacySet(db, { bonusIds: [IDS[2]] })
    const before = await invariantSnapshot(db)
    await apply(db)
    assert.equal(await auditCount(db), 8)
    await rollback(db)
    const rows = await sources(db)
    assert.equal(rows.find(r => r.id === IDS[2]).payment_source, 'bonus')
    assert.equal(rows.filter(r => r.payment_source === 'legacy').length, 8)
    assert.equal(await auditCount(db), 16)
    assert.deepEqual(await invariantSnapshot(db), before)

    await rollback(db)
    assert.equal(await auditCount(db), 16, 'rollback rerun must not add reverse audit rows')
    await apply(db)
    assert.equal(await auditCount(db), 24, 'a later forward apply after rollback is a real new change')
    assert.ok((await sources(db)).every(r => r.payment_source === 'bonus'))
    assert.deepEqual(await invariantSnapshot(db), before)
  } finally { await db.close() }
})

test('rollback is blocked once a reclassified row grows a live money order', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const { users } = await seedLegacySet(db)
    await apply(db)
    await db.query(`insert into public.orders (user_id,kind,qty,amount_usd,amount_vnd,status,request_id)
      values ($1,'paid_request',0,0.75,20000,'paid',$2)`, [users.jj, IDS[4]])
    const before = await invariantSnapshot(db)
    await assert.rejects(rollback(db), /err\.paymentRollbackBlocked/)
    await db.exec('rollback;')
    assert.deepEqual(await invariantSnapshot(db), before)
    assert.ok((await sources(db)).every(r => r.payment_source === 'bonus'))
    assert.equal(await auditCount(db), 9)
  } finally { await db.close() }
})

test('migration text stays label-only: no wallet, order, vote or notification writes', () => {
  const sql = read(`supabase/migrations/${MIGRATION}.sql`)
  assert.match(sql, /set payment_source = 'bonus'/)
  assert.match(sql, /create temp table legacy_bonus_expected/)
  assert.doesNotMatch(sql, /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:profiles|orders|votes|notifications|watches|settings)\b/i)
  assert.doesNotMatch(sql, /\b(?:drop|truncate|alter)\s+table\s+public\./i)
})
