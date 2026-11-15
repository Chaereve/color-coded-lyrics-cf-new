/* PGlite verification for 20261225_payment_operations. No network/production.
 * Builds the baseline + the payment-source chain, then proves the manual
 * payment lifecycle: evidence-gated approval, 72h expiry, queue release,
 * owner-only notifications, system audit, least privilege, replay and rollback. */
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
const MIGRATION = '20261225_payment_operations'
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261213_admin_actions_and_request_edit',
  '20261217_protect_paid_request_orders', '20261221_notification_inbox_fix', '20261224_payment_source']

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
  if (apply) await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
  return db
}
async function seedUser(db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id,email) values (gen_random_uuid(),$1) returning id', [email])).rows[0].id
  if (admin) await db.query('update public.profiles set is_admin=true where id=$1', [id])
  return id
}
async function asUser(db, id, fn) {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ''])
  await db.exec('set role authenticated;')
  try { return await fn() } finally {
    await db.exec('reset role;')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [previous])
  }
}
async function asService(db, fn) {
  await db.exec('set role service_role;')
  try { return await fn() } finally { await db.exec('reset role;') }
}
const refOf = o => `${o.kind === 'votes' ? 'V' : 'PR'}-${o.id.replaceAll('-', '').toUpperCase()}`
const approve = (db, admin, o, extra = {}) => asUser(db, admin, () => db.query(
  'select * from public.admin_order($1,true,$2,$3,$4,$5)',
  [o.id, extra.method ?? 'bank', extra.amount ?? o.amount_vnd, extra.reference ?? refOf(o), extra.reason ?? null]))
const noticesOf = (db, uid) => db.query('select kind, sig, title, reason from public.notifications where user_id=$1 order by id', [uid]).then(r => r.rows)

test('migration preserves legacy dates and gives existing waiting orders a fresh grace period', { timeout: 120_000 }, async () => {
  const db = await build({ apply: false })
  try {
    const user = await seedUser(db, 'legacy@example.test')
    await db.query(`insert into public.orders (user_id,kind,qty,amount_usd,amount_vnd,status,created_at)
      values ($1,'votes',3,0.49,13000,'paid',now()-interval '90 days'),
             ($1,'votes',3,0.49,13000,'rejected',now()-interval '90 days'),
             ($1,'votes',3,0.49,13000,'awaiting',now()-interval '90 days')`, [user])
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    const rows = (await db.query('select status, paid_at, rejected_at, expires_at from public.orders order by created_at, status')).rows
    assert.equal(rows.find(r => r.status === 'paid').paid_at, null)
    assert.equal(rows.find(r => r.status === 'rejected').rejected_at, null)
    const waiting = rows.find(r => r.status === 'awaiting')
    const hours = (new Date(waiting.expires_at) - Date.now()) / 3600e3
    assert.ok(hours > 71 && hours <= 72, `grace period was ${hours}h`)
  } finally { await db.close() }
})

test('approval requires matching manual evidence, pays once, notifies owner, and rejects late duplicates', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const other = await seedUser(db, 'other@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const order = (await asUser(db, member, () => db.query("select * from public.buy_votes('v3',3,0.49,13000)"))).rows[0]

    await assert.rejects(asUser(db, member, () => db.query('select public.admin_order($1,true)', [order.id])), /err\.adminOnly/)
    await assert.rejects(asUser(db, admin, () => db.query('select public.admin_order($1,true)', [order.id])), /err\.paymentEvidenceRequired/)
    await assert.rejects(approve(db, admin, order, { amount: 12000 }), /err\.paymentAmountMismatch/)
    await assert.rejects(approve(db, admin, order, { reference: 'V-WRONG' }), /err\.paymentReferenceMismatch/)
    assert.equal((await db.query('select vote_credits from public.profiles where id=$1', [member])).rows[0].vote_credits, 0)

    const paid = (await approve(db, admin, order, { reason: 'checked bank receipt' })).rows[0]
    assert.equal(paid.status, 'paid')
    assert.ok(paid.paid_at)
    assert.equal(paid.received_currency, 'VND')
    assert.equal(Number(paid.received_amount), 13000)
    assert.equal(paid.payment_reference, refOf(order).replace('-', ''))
    assert.equal((await db.query('select vote_credits from public.profiles where id=$1', [member])).rows[0].vote_credits, 3)
    await assert.rejects(approve(db, admin, order), /err\.orderLocked/)
    assert.equal((await db.query('select vote_credits from public.profiles where id=$1', [member])).rows[0].vote_credits, 3)

    const inbox = await noticesOf(db, member)
    assert.equal(inbox.filter(n => n.kind === 'order_paid').length, 1)
    assert.equal(inbox[0].sig, `order|${order.id}|paid`)
    assert.equal(inbox[0].title, refOf(order))
    assert.deepEqual(await noticesOf(db, other), [])
    assert.equal((await asUser(db, member, () => db.query('select count(*)::int n from public.notifications'))).rows[0].n, 1)
    assert.equal((await asUser(db, other, () => db.query('select count(*)::int n from public.notifications'))).rows[0].n, 0)
    await assert.rejects(asUser(db, member, () => db.query(
      "insert into public.notifications(user_id,kind,sig) values ($1,'order_paid','fake')", [member])), /permission denied/)

    const audit = (await db.query("select actor, detail from public.admin_actions where action='order' and target_id=$1", [order.id])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].actor, admin)
    assert.equal(audit[0].detail.payment_reference, refOf(order).replace('-', ''))
  } finally { await db.close() }
})

test('expiry is service-only, releases quota, keeps history, audits as system and can be reconciled late', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const request = (await asUser(db, member, () => db.query(
      "select * from public.create_request('Color Coded Lyrics','A','Late','','',true,false)"))).rows[0]
    const order = (await db.query('select * from public.orders where request_id=$1', [request.id])).rows[0]
    await db.query("update public.orders set expires_at=now()-interval '1 minute' where id=$1", [order.id])

    assert.equal((await db.query("select has_function_privilege('authenticated','public.expire_payment_orders()','execute') as ok")).rows[0].ok, false)
    assert.equal((await db.query("select has_function_privilege('anon','public.expire_payment_orders()','execute') as ok")).rows[0].ok, false)
    assert.equal((await db.query("select has_function_privilege('service_role','public.expire_payment_orders()','execute') as ok")).rows[0].ok, true)
    await assert.rejects(asUser(db, admin, () => db.query('select public.expire_payment_orders()')), /permission denied/)

    assert.equal((await asService(db, () => db.query('select public.expire_payment_orders() as n'))).rows[0].n, 1)
    assert.equal((await asService(db, () => db.query('select public.expire_payment_orders() as n'))).rows[0].n, 0)
    const expired = (await db.query('select * from public.orders where id=$1', [order.id])).rows[0]
    assert.equal(expired.status, 'expired')
    assert.ok(expired.expired_at)
    const r = (await db.query('select * from public.requests where id=$1', [request.id])).rows[0]
    assert.equal(r.status, 'pending', 'expiry must not delete the request')
    assert.equal(r.is_paid, false)
    assert.equal(r.payment_status, 'none')
    assert.equal(r.payment_source, null)
    const systemAudit = (await db.query("select actor, detail from public.admin_actions where action='order' and target_id=$1", [order.id])).rows
    assert.equal(systemAudit.length, 1)
    assert.equal(systemAudit[0].actor, null)
    assert.equal(systemAudit[0].detail.actor_source, 'scheduler')
    const logPage = (await asUser(db, admin, () => db.query('select public.admin_actions_page(20,0) as payload'))).rows[0].payload
    const systemRow = logPage.rows.find(r => r.target_id === order.id && r.detail?.actor_source === 'scheduler')
    assert.equal(systemRow.actor_name, 'System', 'cron actor NULL must not be displayed as a human Admin')
    assert.equal((await noticesOf(db, member)).filter(n => n.kind === 'order_expired').length, 1)

    // A late transfer is still manually reconcilable; expiry never proves absence of payment.
    const paid = (await approve(db, admin, expired, { method: 'paypal', amount: 0.75, reason: 'late receipt' })).rows[0]
    assert.equal(paid.status, 'paid')
    assert.equal(paid.expired_at, null)
    assert.equal(paid.received_currency, 'USD')
    assert.equal((await db.query('select status from public.requests where id=$1', [request.id])).rows[0].status, 'queued')

    // Queue predicate ignores expired orders even before the next cron run.
    const vote = (await asUser(db, member, () => db.query("select * from public.buy_votes('v3',3,0.49,13000)"))).rows[0]
    await db.query("update public.orders set expires_at=now()-interval '1 minute' where id=$1", [vote.id])
    await asService(db, () => db.query('select public.expire_payment_orders()'))
    assert.equal((await asUser(db, member, () => db.query("select * from public.buy_votes('v3',3,0.49,13000)"))).rows[0].status, 'awaiting')
  } finally { await db.close() }
})

test('rejection records a reason/timestamp and clears awaiting paid-request funding', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const request = (await asUser(db, member, () => db.query(
      "select * from public.create_request('Color Coded Lyrics','A','Reject','','',true,false)"))).rows[0]
    const order = (await db.query('select * from public.orders where request_id=$1', [request.id])).rows[0]
    const rejected = (await asUser(db, admin, () => db.query('select * from public.admin_order($1,false,null,null,null,$2)', [order.id, 'no matching transfer']))).rows[0]
    assert.equal(rejected.status, 'rejected')
    assert.ok(rejected.rejected_at)
    assert.equal(rejected.resolution_reason, 'no matching transfer')
    const r = (await db.query('select * from public.requests where id=$1', [request.id])).rows[0]
    assert.equal(r.is_paid, false)
    assert.equal(r.payment_source, null)
    assert.equal((await noticesOf(db, member))[0].kind, 'order_rejected')
  } finally { await db.close() }
})

test('migration is rerunnable and rollback is blocked once lifecycle history exists', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    await db.exec(read(`supabase/rollback/${MIGRATION}.sql`))
    assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='orders' and column_name='paid_at'")).rows[0].n, 0)
    await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const order = (await asUser(db, member, () => db.query("select * from public.buy_votes('v3',3,0.49,13000)"))).rows[0]
    await approve(db, admin, order)
    await assert.rejects(db.exec(read(`supabase/rollback/${MIGRATION}.sql`)), /err\.paymentRollbackBlocked/)
    await db.exec('rollback;')
    assert.equal((await db.query('select status from public.orders where id=$1', [order.id])).rows[0].status, 'paid')
  } finally { await db.close() }
})

test('schedule is installed only when pg_cron exists and the migration keeps least privilege', () => {
  const sql = read(`supabase/migrations/${MIGRATION}.sql`)
  assert.match(sql, /cron\.schedule\('ccl-expire-payment-orders','\*\/15 \* \* \* \*'/)
  assert.match(sql, /pg_extension where extname = 'pg_cron'/)
  assert.match(sql, /revoke all on function public\.expire_payment_orders\(\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.expire_payment_orders\(\) to service_role/)
  assert.match(sql, /revoke all on function public\.admin_order\(uuid,boolean,text,numeric,text,text\) from public, anon, authenticated/)
})
