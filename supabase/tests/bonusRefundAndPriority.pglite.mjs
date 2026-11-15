/* PGlite verification for 20261228_bonus_refund_and_priority.
 * No network/production. Proves one-credit refunds on deny/delete/expiry,
 * idempotency across lifecycle paths, production/pick guards, money isolation,
 * funding-aware auto-pick priority, least privilege, replay and rollback. */
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
const MIGRATION = '20261228_bonus_refund_and_priority'
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261212_admin_bulk_and_comments_page',
  '20261213_admin_actions_and_request_edit', '20261217_protect_paid_request_orders',
  '20261221_notification_inbox_fix', '20261223_pick_pause', '20261224_payment_source',
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
const createBonus = (db, uid, title) => asUser(db, uid, () => db.query(
  "select * from public.create_request('Color Coded Lyrics','A',$1,'','',true,true)", [title])).then(r => r.rows[0])
const createFree = (db, uid, title) => asUser(db, uid, () => db.query(
  "select * from public.create_request('Color Coded Lyrics','A',$1,'','',false,false)", [title])).then(r => r.rows[0])
const wallet = (db, uid) => db.query('select bonus_requests, vote_credits, bonus_credits from public.profiles where id=$1', [uid]).then(r => r.rows[0])
const refundsOf = (db, uid) => db.query('select request_id, amount, reason from public.bonus_request_refunds where user_id=$1 order by created_at, request_id', [uid]).then(r => r.rows)
const noticesOf = (db, uid) => db.query('select kind, sig from public.notifications where user_id=$1 order by id', [uid]).then(r => r.rows)
const refOf = o => `PR-${o.id.replaceAll('-', '').toUpperCase()}`
async function createPaidMoney(db, uid, admin, title) {
  const r = (await asUser(db, uid, () => db.query(
    "select * from public.create_request('Color Coded Lyrics','A',$1,'','',true,false)", [title]))).rows[0]
  const o = (await db.query('select * from public.orders where request_id=$1', [r.id])).rows[0]
  await asUser(db, admin, () => db.query('select public.admin_order($1,true,$2,$3,$4,$5)',
    [o.id, 'bank', o.amount_vnd, refOf(o), null]))
  return (await db.query('select * from public.requests where id=$1', [r.id])).rows[0]
}

test('denial refunds one bonus once, notifies owner, and deny/requeue/deny/delete cannot pay twice', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const r = await createBonus(db, member, 'Refund me')
    assert.equal((await wallet(db, member)).bonus_requests, 4)
    await asUser(db, admin, () => db.query('select public.admin_review($1,false,$2)', [r.id, 'duplicate']))
    assert.equal((await wallet(db, member)).bonus_requests, 5)
    assert.deepEqual(await refundsOf(db, member), [{ request_id: r.id, amount: 1, reason: 'denied' }])
    assert.ok((await noticesOf(db, member)).some(n => n.kind === 'bonus_refunded' && n.sig === `bonus-refund|${r.id}`))
    const audit = (await db.query("select actor, action, label, detail from public.admin_actions where target_id=$1 and action='bonus_refund'", [r.id])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].actor, admin)
    assert.equal(audit[0].detail.reason, 'denied')
    assert.equal(audit[0].detail.amount, 1)

    await asUser(db, admin, () => db.query('select public.admin_review($1,false,$2)', [r.id, 'again']))
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [r.id]))
    await asUser(db, admin, () => db.query('select public.admin_review($1,false,$2)', [r.id, 'third']))
    await asUser(db, admin, () => db.query('select public.delete_my_request($1)', [r.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 5)
    assert.equal((await refundsOf(db, member)).length, 1)
    assert.equal((await noticesOf(db, member)).filter(n => n.kind === 'bonus_refunded').length, 1)
    assert.equal((await db.query("select count(*)::int n from public.admin_actions where target_id=$1 and action='bonus_refund'", [r.id])).rows[0].n, 1)
  } finally { await db.close() }
})

test('owner delete, admin bulk delete and expiry refund only unpicked pre-production bonus requests', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const other = await seedUser(db, 'other@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const own = await createBonus(db, member, 'Own cancel')
    await asUser(db, member, () => db.query('select public.delete_my_request($1)', [own.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 5)
    assert.deepEqual((await refundsOf(db, member)).map(x => x.reason), ['deleted'])

    const bulk1 = await createBonus(db, member, 'Bulk 1')
    const bulk2 = await createBonus(db, member, 'Bulk 2')
    const picked = await createBonus(db, member, 'Picked')
    const started = await createBonus(db, member, 'Started')
    const done = await createBonus(db, member, 'Done')
    await db.query('update public.requests set picked_at=now() where id=$1', [picked.id])
    await db.query("update public.requests set status='in_progress' where id=$1", [started.id])
    await db.query("update public.requests set status='completed' where id=$1", [done.id])
    const before = (await wallet(db, member)).bonus_requests
    await asUser(db, admin, () => db.query('select public.admin_delete_many($1)', [[bulk1.id, bulk2.id, picked.id, started.id, done.id]]))
    assert.equal((await wallet(db, member)).bonus_requests, before + 2)
    assert.equal((await refundsOf(db, member)).length, 3)

    const exp = await createBonus(db, member, 'Expiry')
    await asUser(db, admin, () => db.query('select public.admin_expire_request($1)', [exp.id]))
    const ledger = await refundsOf(db, member)
    assert.equal(ledger.length, 4)
    assert.equal(ledger.find(x => x.request_id === exp.id).reason, 'expired')
    assert.ok((await noticesOf(db, member)).some(n => n.kind === 'expired'))
    assert.ok((await noticesOf(db, member)).some(n => n.kind === 'bonus_refunded' && n.sig === `bonus-refund|${exp.id}`))
    const expAudit = (await db.query("select detail from public.admin_actions where target_id=$1 and action='bonus_refund'", [exp.id])).rows
    assert.equal(expAudit.length, 1)
    assert.equal(expAudit[0].detail.reason, 'expired')

    await assert.rejects(asUser(db, other, () => db.query('select public.delete_my_request($1)', [bulk1.id])), /err\.requestMissing/)
    assert.equal((await wallet(db, other)).bonus_requests, 5)
  } finally { await db.close() }
})

test('money and free requests never refund bonus; picked bonus denial is not refunded', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const money = await createPaidMoney(db, member, admin, 'Money')
    const free = await createFree(db, member, 'Free')
    const picked = await createBonus(db, member, 'Picked bonus')
    await db.query('update public.requests set picked_at=now() where id=$1', [picked.id])
    const before = await wallet(db, member)
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [money.id]))
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [free.id]))
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [picked.id]))
    await asUser(db, admin, () => db.query('select public.admin_delete_many($1)', [[free.id, picked.id]]))
    assert.deepEqual(await wallet(db, member), before)
    assert.deepEqual(await refundsOf(db, member), [])
    assert.equal((await noticesOf(db, member)).filter(n => n.kind === 'bonus_refunded').length, 0)
  } finally { await db.close() }
})

test('auto-pick priority is settled money > bonus > free, then group votes; awaiting/legacy fail closed', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const free = await createFree(db, member, 'Free high votes')
    const bonus = await createBonus(db, member, 'Bonus mid votes')
    const money = await createPaidMoney(db, member, admin, 'Money low votes')
    const awaiting = (await asUser(db, member, () => db.query(
      "select * from public.create_request('Color Coded Lyrics','A','Awaiting money','','',true,false)"))).rows[0]
    await db.query("update public.requests set status='queued', votes=100 where id=$1", [free.id])
    await db.query('update public.requests set votes=50 where id=$1', [bonus.id])
    await db.query('update public.requests set votes=1 where id=$1', [money.id])
    await db.query("update public.requests set status='queued', votes=200 where id=$1", [awaiting.id])
    await db.query(`insert into public.requests(user_id,kind,artist,title,requester,status,is_paid,payment_status,payment_source,votes)
      values ($1,'Color Coded Lyrics','A','Legacy high votes','fan','queued',true,'paid','legacy',300)`, [member])

    const first = (await db.query('select * from public.pick_top_request(true)')).rows
    assert.equal(first[0].id, money.id)
    const second = (await db.query('select * from public.pick_top_request(true)')).rows
    assert.equal(second[0].id, bonus.id)
    const third = (await db.query('select * from public.pick_top_request(true)')).rows
    assert.equal(third[0].title, 'Legacy high votes')
    const fourth = (await db.query('select * from public.pick_top_request(true)')).rows
    assert.equal(fourth[0].id, awaiting.id)
    const fifth = (await db.query('select * from public.pick_top_request(true)')).rows
    assert.equal(fifth[0].id, free.id)
  } finally { await db.close() }
})

test('clients cannot write the refund ledger or wallets; migration replay is a no-op', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const r = await createBonus(db, member, 'Replay')
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [r.id]))
    const before = await wallet(db, member)
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    assert.deepEqual(await wallet(db, member), before)
    assert.equal((await refundsOf(db, member)).length, 1)
    await assert.rejects(asUser(db, member, () => db.query(
      "insert into public.bonus_request_refunds(request_id,user_id,reason) values (gen_random_uuid(),$1,'deleted')", [member])), /permission denied/)
    await assert.rejects(asUser(db, member, () => db.query(
      'update public.profiles set bonus_requests=bonus_requests+1 where id=$1', [member])), /permission denied/)
    assert.equal((await db.query("select has_table_privilege('authenticated','public.bonus_request_refunds','SELECT') as ok")).rows[0].ok, false)
  } finally { await db.close() }
})

test('a bonus request already denied before the migration is not refunded by re-deny; later delete refunds once', { timeout: 120_000 }, async () => {
  const db = await build({ apply: false })
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const r = await createBonus(db, member, 'Legacy denied')
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [r.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 4)
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [r.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 4)
    assert.deepEqual(await refundsOf(db, member), [])
    await asUser(db, admin, () => db.query('select public.delete_my_request($1)', [r.id]))
    assert.equal((await wallet(db, member)).bonus_requests, 5)
    assert.deepEqual((await refundsOf(db, member)).map(x => x.reason), ['deleted'])
  } finally { await db.close() }
})

test('rollback is blocked after a refund, and fresh rollback restores the old priority/no refund trigger', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const r = await createBonus(db, member, 'Blocked rollback')
    await asUser(db, admin, () => db.query('select public.admin_review($1,false)', [r.id]))
    await assert.rejects(db.exec(read(`supabase/rollback/${MIGRATION}.sql`)), /err\.bonusRefundRollbackBlocked/)
    await db.exec('rollback;')
    assert.equal((await refundsOf(db, member)).length, 1)
  } finally { await db.close() }

  const fresh = await build()
  try {
    const member = await seedUser(fresh, 'fresh@example.test')
    const free = await createFree(fresh, member, 'Free')
    const bonus = await createBonus(fresh, member, 'Bonus')
    await fresh.query('update public.requests set votes=100 where id=$1', [free.id])
    await fresh.exec(read(`supabase/rollback/${MIGRATION}.sql`))
    assert.equal((await fresh.query("select to_regclass('public.bonus_request_refunds') as t")).rows[0].t, null)
    const picked = (await fresh.query('select * from public.pick_top_request(true)')).rows
    assert.equal(picked[0].id, bonus.id, 'old is_paid priority treats bonus and money alike')
    await fresh.query("update public.requests set status='denied' where id=$1", [bonus.id])
    assert.equal((await wallet(fresh, member)).bonus_requests, 4)
  } finally { await fresh.close() }
})
