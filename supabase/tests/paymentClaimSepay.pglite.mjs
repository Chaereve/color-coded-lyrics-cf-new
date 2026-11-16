/* PGlite verification for 20261230_payment_claim_sepay_log.
 * Builds the same fixture chain as the payment operations suite, applies the
 * claim/SePay log-only migration, then proves:
 *   1. report_transfer: owner-only, awaiting-only, first-write-wins, single
 *      admin_actions row, expiry blocks, idempotent re-click.
 *   2. sepay_record_event (LOG-ONLY): content decode matches the JS compact
 *      reference format, amount compare gives matched/underpaid/overpaid,
 *      unknown on garbage, provider_ref replay is idempotent, the orders row
 *      is NEVER touched, and the edge gate is honored.
 * The reference fixtures in this file are produced by the app's own
 * orderTransferContent() — the test would fail loudly if SQL decode and JS
 * encode ever diverge. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { orderTransferContent, orderReference } from '../../src/lib/requestPayment.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = path => readFileSync(`${ROOT}${path}`, 'utf8')
const schema = read('supabase/schema.sql')
const coreSql = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
const MIGRATION = '20261230_payment_claim_sepay_log'
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261213_admin_actions_and_request_edit',
  '20261217_protect_paid_request_orders', '20261221_notification_inbox_fix', '20261224_payment_source',
  '20261225_payment_operations']

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
const events = (db) => db.query('select match_status, matched_order_id, provider_ref, transfer_amount from public.payment_events order by id').then(r => r.rows)

test('report_transfer: first write wins, owner-only, awaiting-only, single audit row', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const other = await seedUser(db, 'other@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    // tạo paid request thật qua create_request (kèm đơn hàng awaiting)
    await asUser(db, member, () => db.query(
      "select public.create_request('Color Coded Lyrics','IVE','I AM','','',true,false)"))
    const created = (await db.query("select * from public.orders where user_id=$1 order by created_at desc limit 1", [member])).rows[0]
    assert.equal(created.status, 'awaiting')
    assert.equal(created.transfer_reported_at, null)

    // người khác không bấm được
    await assert.rejects(asUser(db, other, () => db.query('select public.report_transfer($1)', [created.id])), /err\.orderMissing/)

    // lần 1: ghi dấu + 1 admin_actions
    const first = (await asUser(db, member, () => db.query('select * from public.report_transfer($1)', [created.id]))).rows[0]
    assert.ok(first.transfer_reported_at)
    const audit1 = (await db.query("select count(*)::int n from public.admin_actions where action='order_claim' and target_id=$1", [created.id])).rows[0].n
    assert.equal(audit1, 1)

    // lần 2: giữ nguyên dấu thời gian, không thêm audit
    const second = (await asUser(db, member, () => db.query('select * from public.report_transfer($1)', [created.id]))).rows[0]
    assert.equal(new Date(second.transfer_reported_at).getTime(), new Date(first.transfer_reported_at).getTime())
    const audit2 = (await db.query("select count(*)::int n from public.admin_actions where action='order_claim' and target_id=$1", [created.id])).rows[0].n
    assert.equal(audit2, 1)

    // đơn đã paid ⇒ khoá
    await asUser(db, admin, () => db.query('select public.admin_order($1,true,$2,$3,$4,$5)',
      [created.id, 'bank', created.amount_vnd, `PR-${String(created.id).replaceAll('-', '').toUpperCase()}`, null]))
    await assert.rejects(asUser(db, member, () => db.query('select public.report_transfer($1)', [created.id])), /err\.orderLocked/)
  } finally { await db.close() }
})

test('report_transfer: expired window blocks the claim', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'exp@example.test')
    await asUser(db, member, () => db.query(
      "select public.create_request('Color Coded Lyrics','LE SSERAFIM','Eve Psy Vs Eve','','',true,false)"))
    const created = (await db.query("select * from public.orders where user_id=$1", [member])).rows[0]
    await db.query("update public.orders set expires_at=now()-interval '1 minute' where id=$1", [created.id])
    await assert.rejects(asUser(db, member, () => db.query('select public.report_transfer($1)', [created.id])), /err\.orderLocked/)
  } finally { await db.close() }
})

test('report_transfer: anonymous caller rejected', { timeout: 120_000 }, async () => {
  const db = await build()
  let err = null
  try {
    await db.exec('set role anon;')
    try { await db.query("select public.report_transfer('00000000-0000-0000-0000-000000000000')") }
    catch (e) { err = e } finally { await db.exec('reset role;') }
  } finally { await db.close() }
  assert.match(err?.message || '', /(err\.signin|err\.orderMissing|permission denied)/)
})

test('sepay_record_event: JS-compact reference decodes to the right order and amount status wins', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'sepay@example.test')
    await asUser(db, member, () => db.query(
      "select public.create_request('Color Coded Lyrics','IVE','Love Dive','','',true,false)"))
    const o = (await db.query("select * from public.orders where user_id=$1", [member])).rows[0]
    const compact = orderTransferContent(o)              // PR-<22 base64url>
    const legacy = orderReference(o).replace('-', '')     // PR<32hex>

    // 1) khớp tuyệt đối, nội dung có thêm chữ xung quanh → matched
    let r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0001', transferAmount: o.amount_vnd, content: `CK ${compact} THANH TOAN`, transactionDate: '2026-11-15 14:03:00' })])).rows[0].r
    assert.equal(r.match_status, 'matched')
    assert.equal(r.matched_order_id, o.id)
    assert.equal(r.replayed, false)

    // replay cùng referenceCode → không nhân bản
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0001', transferAmount: o.amount_vnd, content: `CK ${compact} THANH TOAN` })])).rows[0].r
    assert.equal(r.replayed, true)
    assert.equal((await events(db)).length, 1)

    // 2) mã legacy (PR + 32 hex) cũng nhận
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0002', transferAmount: o.amount_vnd, content: `NOI DUNG ${legacy}` })])).rows[0].r
    assert.equal(r.match_status, 'matched')

    // 3) thiếu tiền → underpaid; thừa → overpaid; đơn KHÔNG bị đụng
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0003', transferAmount: o.amount_vnd - 5000, content: compact })])).rows[0].r
    assert.equal(r.match_status, 'underpaid')
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0004', transferAmount: o.amount_vnd + 5000, content: compact })])).rows[0].r
    assert.equal(r.match_status, 'overpaid')
    const untouched = (await db.query("select status, transfer_reported_at from public.orders where id=$1", [o.id])).rows[0]
    assert.equal(untouched.status, 'awaiting')
    assert.equal(untouched.transfer_reported_at, null)

    // 4) mã hợp lệ nhưng không có đơn → unknown, matched_order_id null
    const ghost = { id: '11111111-2222-4333-8444-555555555555', kind: 'paid_request' }
    const ghostRef = orderTransferContent(ghost)
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0005', transferAmount: o.amount_vnd, content: ghostRef })])).rows[0].r
    assert.equal(r.match_status, 'unknown')
    assert.equal(r.matched_order_id, null)

    // 5) rác hoàn toàn → unknown
    r = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT0006', transferAmount: 20000, content: 'xin chao khong co ma gi ca' })])).rows[0].r
    assert.equal(r.match_status, 'unknown')

    // 6) thiếu amount/content → lỗi
    await assert.rejects(
      db.query("select public.sepay_record_event($1::jsonb, null)", [JSON.stringify({ referenceCode: 'FT0007', content: compact })]),
      /err\.sepayBody/)
  } finally { await db.close() }
})

test('sepay_record_event: edge gate token is enforced when configured', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    await db.query("select public.set_edge_gate_token('token-bia-ghi-32-ky-tu-toi-thieu-abc123')")
    await assert.rejects(
      db.query("select public.sepay_record_event($1::jsonb, 'sai-token')",
        [JSON.stringify({ transferAmount: 20000, content: 'PR-ABC' })]),
      /err\.edgeGate/)
    const ok = (await db.query(
      "select public.sepay_record_event($1::jsonb, 'token-bia-ghi-32-ky-tu-toi-thieu-abc123') as r",
      [JSON.stringify({ referenceCode: 'FT9001', transferAmount: 20000, content: 'khong co ma' })])).rows[0].r
    assert.equal(ok.match_status, 'unknown')
  } finally { await db.close() }
})

test('sepay_record_event: service_role gate path + replay keeps original verdict', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const payload = JSON.stringify({ referenceCode: 'FT8001', transferAmount: 20000, content: 'khong ma' })
    await db.query("select public.sepay_record_event($1::jsonb, null) as r", [payload])
    // đổi nội dung của cùng referenceCode — kết quả trả về phải là bản ghi CŨ
    const replay = (await db.query(
      "select public.sepay_record_event($1::jsonb, null) as r",
      [JSON.stringify({ referenceCode: 'FT8001', transferAmount: 99999, content: 'PR-AAAAAAAAAAAAAAAAAAAAAA' })])).rows[0].r
    assert.equal(replay.replayed, true)
    const n = (await db.query("select count(*)::int n, sum(transfer_amount) s from public.payment_events where provider_ref='FT8001'")).rows[0]
    assert.equal(n.n, 1)
    assert.equal(Number(n.s), 20000)
  } finally { await db.close() }
})
