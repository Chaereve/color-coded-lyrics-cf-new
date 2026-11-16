/* reportTransfer (demo): người mua báo "I’ve made the transfer".
   Hợp đồng: chỉ đánh dấu thời điểm, KHÔNG đổi trạng thái đơn, idempotent,
   chỉ đơn còn chờ & chưa hết hạn mới nhận dấu. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { orderReference } from './requestPayment.js'

function mockStorage() {
  const store = new Map()
  const prev = globalThis.localStorage
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: k => { store.delete(k) },
  }
  return { store, restore: () => { globalThis.localStorage = prev } }
}
const seedUser = (store, id) => {
  const user = { id, name: 'Fan', isAdmin: false }
  store.set('ccl3_user', JSON.stringify(user))
  store.set('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0, bonus_requests: 0, is_admin: false }))
  store.set('ccl3_orders', '[]')
  store.set('ccl3_rows', '[]')
  return user
}

test('demo reportTransfer: dấu lần đầu, lần hai trả nguyên dấu cũ, status giữ nguyên', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    const user = seedUser(store, 'claim-demo-1')
    const order = await db.buyVotes({ id: 'v-claim', qty: 3, usd: 0.49, vnd: 13000 })
    assert.equal(order.status, 'awaiting')
    const first = await db.reportTransfer(order.id)
    assert.ok(first.transfer_reported_at, 'lần đầu phải được ghi dấu')
    assert.equal(first.status, 'awaiting', 'trạng thái đơn KHÔNG đổi')
    const second = await db.reportTransfer(order.id)
    assert.equal(second.transfer_reported_at, first.transfer_reported_at, 'lần hai không ghi đè')
    const persisted = JSON.parse(store.get('ccl3_orders')).find(o => o.id === order.id)
    assert.equal(persisted.transfer_reported_at, first.transfer_reported_at)
    assert.equal(user.id, 'claim-demo-1')
  } finally { restore() }
})

test('demo reportTransfer: đơn lạ / đơn đã paid / đơn hết hạn đều bị từ chối', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    seedUser(store, 'claim-demo-2')
    await assert.rejects(db.reportTransfer('00000000-0000-0000-0000-000000000000'),
      e => e.code === 'err.orderMissing')

    const paid = await db.buyVotes({ id: 'v-claim-2', qty: 3, usd: 0.49, vnd: 13000 })
    await db.adminOrder(paid.id, true, { method: 'bank', amount: 13000, reference: orderReference(paid) })
    await assert.rejects(db.reportTransfer(paid.id), e => e.code === 'err.orderLocked')

    const exp = await db.buyVotes({ id: 'v-claim-3', qty: 3, usd: 0.49, vnd: 13000 })
    const orders = JSON.parse(store.get('ccl3_orders'))
    orders.find(o => o.id === exp.id).expires_at = new Date(Date.now() - 1000).toISOString()
    store.set('ccl3_orders', JSON.stringify(orders))
    await assert.rejects(db.reportTransfer(exp.id), e => e.code === 'err.orderLocked')
  } finally { restore() }
})
