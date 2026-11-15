/* PGlite verification for 20261229_request_funding_review.
 * No network/production. Proves new bonus submissions wait for review,
 * money/bonus admin notices stay separate and private, approval/denial keep
 * the refund ledger honest, existing rows are not rewound, replay is a no-op,
 * and rollback fails closed once inbox history exists. */
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
const MIGRATION = '20261229_request_funding_review'
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261212_admin_bulk_and_comments_page',
  '20261213_admin_actions_and_request_edit', '20261217_protect_paid_request_orders',
  '20261221_notification_inbox_fix', '20261223_pick_pause', '20261224_payment_source',
  '20261225_payment_operations', '20261226_payment_source_read_grant', '20261228_bonus_refund_and_priority']
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

async function build({ apply = true } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of CHAIN) await db.exec(read(`supabase/migrations/${name}.sql`))
  await db.exec(`insert into public.settings(key,value) values ('pick','{"interval_days":4,"paused":false}'::jsonb) on conflict (key) do nothing;`)
  if (apply) await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
  return db
}
async function seedUser(db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id,email) values (gen_random_uuid(),$1) returning id', [email])).rows[0].id
  await db.query('update public.profiles set bonus_requests=5 where id=$1', [id])
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
const submit = (db, uid, title, paid, bonus) => asUser(db, uid, () => db.query(
  'select * from public.create_request($1,$2,$3,$4,$5,$6,$7)',
  ['Color Coded Lyrics', 'A', title, '', 'private note', paid, bonus])).then(r => r.rows[0])
const wallet = (db, uid) => db.query('select bonus_requests, vote_credits, bonus_credits from public.profiles where id=$1', [uid]).then(r => r.rows[0])
const notices = (db, uid) => db.query('select kind, sig, request_id, title, reason from public.notifications where user_id=$1 order by id', [uid]).then(r => r.rows)
const reviewNotices = async (db, uid) => (await notices(db, uid)).filter(n => n.kind.endsWith('_request_review'))

test('new money and bonus submissions both wait, but only money gets an order; admins get separate notices', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin1 = await seedUser(db, 'admin1@example.test', true)
    const admin2 = await seedUser(db, 'admin2@example.test', true)
    const money = await submit(db, member, 'Money song', true, false)
    const bonus = await submit(db, member, 'Bonus song', true, true)
    const free = await submit(db, member, 'Free song', false, false)
    assert.equal(money.status, 'pending'); assert.equal(money.payment_source, 'money'); assert.equal(money.payment_status, 'awaiting')
    assert.equal(bonus.status, 'pending'); assert.equal(bonus.payment_source, 'bonus'); assert.equal(bonus.payment_status, 'paid')
    assert.equal(free.status, 'pending'); assert.equal(free.payment_source, null)
    assert.equal((await wallet(db, member)).bonus_requests, 4)
    assert.equal((await db.query('select count(*)::int n from public.orders where request_id=$1', [money.id])).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int n from public.orders where request_id=$1', [bonus.id])).rows[0].n, 0)
    for (const admin of [admin1, admin2]) {
      const box = await reviewNotices(db, admin)
      assert.deepEqual(box.map(n => n.kind), ['paid_request_review', 'bonus_request_review'])
      assert.deepEqual(box.map(n => n.sig), [`request-review|${money.id}|money`, `request-review|${bonus.id}|bonus`])
      assert.ok(box.every(n => n.reason === null), 'private submit note must not be copied into inbox')
    }
    assert.deepEqual(await reviewNotices(db, member), [])
    await assert.rejects(asUser(db, member, () => db.query('select public.notify_admin_request_review()')), /permission denied|does not exist/)
  } finally { await db.close() }
})

test('bonus approval queues without a money order; denial refunds once and bulk review uses the same gate', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const ok = await submit(db, member, 'Approve bonus', true, true)
    const no = await submit(db, member, 'Deny bonus', true, true)
    const bulk = await submit(db, member, 'Bulk bonus', true, true)
    assert.equal((await wallet(db, member)).bonus_requests, 2)
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [ok.id]))
    await asUser(db, admin, () => db.query('select public.admin_review($1,false,$2)', [no.id, 'duplicate']))
    await asUser(db, admin, () => db.query('select public.admin_review_many($1,false,$2)', [[bulk.id], 'bulk duplicate']))
    const rows = (await db.query('select id,status,payment_source,payment_status from public.requests where id=any($1)', [[ok.id, no.id, bulk.id]])).rows
    assert.equal(rows.find(r => r.id === ok.id).status, 'queued')
    assert.equal(rows.find(r => r.id === no.id).status, 'denied')
    assert.equal(rows.find(r => r.id === bulk.id).status, 'denied')
    assert.ok(rows.every(r => r.payment_source === 'bonus' && r.payment_status === 'paid'))
    assert.equal((await wallet(db, member)).bonus_requests, 4)
    assert.equal((await db.query('select count(*)::int n from public.bonus_request_refunds where user_id=$1', [member])).rows[0].n, 2)
    assert.equal((await db.query('select count(*)::int n from public.orders where request_id=any($1)', [[ok.id, no.id, bulk.id]])).rows[0].n, 0)
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [no.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 4)
  } finally { await db.close() }
})

test('deploy does not rewind existing bonus rows or backfill inbox; replay creates no duplicate notices', { timeout: 120_000 }, async () => {
  const db = await build({ apply: false })
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const old = await submit(db, member, 'Already accepted', true, true)
    assert.equal(old.status, 'queued')
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    assert.equal((await db.query('select status from public.requests where id=$1', [old.id])).rows[0].status, 'queued')
    assert.deepEqual(await reviewNotices(db, admin), [])
    const fresh = await submit(db, member, 'New submission', true, true)
    assert.equal(fresh.status, 'pending')
    const before = await reviewNotices(db, admin)
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    assert.deepEqual(await reviewNotices(db, admin), before)
    assert.equal((await wallet(db, member)).bonus_requests, 3)
  } finally { await db.close() }
})

test('rollback is blocked by review inbox history; fresh rollback restores bonus auto-queue without rewinding pending rows', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    await seedUser(db, 'admin@example.test', true)
    const pending = await submit(db, member, 'Pending stays pending', true, true)
    await assert.rejects(db.exec(read(`supabase/rollback/${MIGRATION}.sql`)), /err\.requestReviewRollbackBlocked/)
    await db.exec('rollback;')
    assert.equal((await db.query('select status from public.requests where id=$1', [pending.id])).rows[0].status, 'pending')
  } finally { await db.close() }
  const fresh = await build()
  try {
    const member = await seedUser(fresh, 'fresh@example.test')
    await fresh.exec(read(`supabase/rollback/${MIGRATION}.sql`))
    const r = await submit(fresh, member, 'Old rule', true, true)
    assert.equal(r.status, 'queued')
    assert.equal((await fresh.query("select to_regprocedure('public.notify_admin_request_review()') as p")).rows[0].p, null)
  } finally { await fresh.close() }
})
