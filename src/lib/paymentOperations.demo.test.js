/* Demo mode phải cùng hợp đồng với SQL: hạn 72h, đối soát trước khi cộng tiền,
   hết hạn giữ lịch sử và giải phóng hàng đợi, tin vào đúng hộp thư người mua. */
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

test('demo orders carry a 72h deadline, require matching evidence, and notify once', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    const user = { id: 'buyer-1', name: 'Fan', isAdmin: true }
    store.set('ccl3_user', JSON.stringify(user))
    store.set('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0, bonus_requests: 0, is_admin: true }))
    store.set('ccl3_orders', '[]')
    store.set('ccl3_rows', '[]')
    const order = await db.buyVotes({ id: 'v3', qty: 3, usd: 0.49, vnd: 13000 })
    const hours = (new Date(order.expires_at) - Date.now()) / 3600e3
    assert.ok(hours > 71 && hours <= 72)
    const ref = orderReference(order)
    await assert.rejects(db.adminOrder(order.id, true), e => e.code === 'err.paymentEvidenceRequired')
    await assert.rejects(db.adminOrder(order.id, true, { method: 'bank', amount: 12000, reference: ref }), e => e.code === 'err.paymentAmountMismatch')
    await assert.rejects(db.adminOrder(order.id, true, { method: 'bank', amount: 13000, reference: 'V-NO' }), e => e.code === 'err.paymentReferenceMismatch')
    const paid = await db.adminOrder(order.id, true, { method: 'bank', amount: 13000, reference: ref })
    assert.equal(paid.status, 'paid')
    assert.ok(paid.paid_at)
    assert.equal(JSON.parse(store.get('ccl3_prof')).vote_credits, 3)
    await assert.rejects(db.adminOrder(order.id, true, { method: 'bank', amount: 13000, reference: ref }), e => e.code === 'err.orderLocked')
    const inbox = await db.fetchNotifications(user.id)
    assert.equal(inbox.filter(n => n.type === 'order_paid').length, 1)
    assert.equal(JSON.parse(store.get('ccl3_prof')).vote_credits, 3)
  } finally { restore() }
})

test('demo expiry keeps the order/request, clears awaiting funding and frees quota', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    const user = { id: 'buyer-2', name: 'Fan', isAdmin: true }
    store.set('ccl3_user', JSON.stringify(user))
    store.set('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0, bonus_requests: 0, is_admin: true }))
    store.set('ccl3_orders', '[]')
    store.set('ccl3_rows', '[]')
    const request = await db.addRequest({ kind: 'Color Coded Lyrics', artist: 'A', title: 'T', link: '', note: '' }, user, true, false)
    const orders = JSON.parse(store.get('ccl3_orders'))
    const order = orders.find(o => o.request_id === request.id)
    order.expires_at = new Date(Date.now() - 1000).toISOString()
    store.set('ccl3_orders', JSON.stringify(orders))
    const fetched = await db.fetchOrders(user)
    assert.equal(fetched.find(o => o.id === order.id).status, 'expired')
    assert.equal(JSON.parse(store.get('ccl3_rows')).find(r => r.id === request.id).payment_status, 'none')
    assert.equal((await db.fetchNotifications(user.id)).filter(n => n.type === 'order_expired').length, 1)
    await assert.rejects(db.cancelOrder(order.id), e => e.code === 'err.orderLocked')
    // Hết hạn không xóa lịch sử và không chặn đặt đơn mới.
    assert.equal(JSON.parse(store.get('ccl3_orders')).length, 1)
    assert.equal((await db.buyVotes({ id: 'v3', qty: 3, usd: 0.49, vnd: 13000 })).status, 'awaiting')
  } finally { restore() }
})


test('demo bonus submission waits for admin review, reserves one reward, and notifies the local admin once', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    const user = { id: 'demo-user', name: 'Fan', isAdmin: true }
    store.set('ccl3_user', JSON.stringify(user))
    store.set('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0, bonus_requests: 2, is_admin: true }))
    store.set('ccl3_orders', '[]')
    store.set('ccl3_rows', '[]')
    const form = { kind: 'Color Coded Lyrics', artist: 'A', title: 'Bonus review', link: '', note: '' }
    const bonus = await db.addRequest(form, user, true, true)
    assert.equal(bonus.status, 'pending')
    assert.equal(bonus.payment_source, 'bonus')
    assert.equal(bonus.payment_status, 'paid')
    assert.equal(JSON.parse(store.get('ccl3_prof')).bonus_requests, 1)
    assert.deepEqual(JSON.parse(store.get('ccl3_orders')), [])
    const inbox = await db.fetchNotifications(user.id)
    assert.equal(inbox.filter(n => n.type === 'bonus_request_review').length, 1)
    assert.equal(inbox.find(n => n.type === 'bonus_request_review').sig, `request-review|${bonus.id}|bonus`)
    await db.adminReview(bonus.id, true)
    assert.equal(JSON.parse(store.get('ccl3_rows'))[0].status, 'queued')
    assert.equal(JSON.parse(store.get('ccl3_prof')).bonus_requests, 1)
    const money = await db.addRequest({ ...form, title: 'Money review' }, user, true, false)
    assert.equal(money.status, 'pending')
    assert.equal(money.payment_source, 'money')
    assert.equal(JSON.parse(store.get('ccl3_orders')).filter(o => o.request_id === money.id).length, 1)
    assert.equal((await db.fetchNotifications(user.id)).filter(n => n.type === 'paid_request_review').length, 1)
  } finally { restore() }
})

test('demo non-admin does not receive an admin review notice', async () => {
  const { store, restore } = mockStorage()
  try {
    const db = await import('./db.js')
    const user = { id: 'fan', name: 'Fan', isAdmin: false }
    store.set('ccl3_user', JSON.stringify(user))
    store.set('ccl3_prof', JSON.stringify({ bonus_requests: 1, is_admin: false }))
    store.set('ccl3_orders', '[]'); store.set('ccl3_rows', '[]')
    await db.addRequest({ kind: 'Color Coded Lyrics', artist: 'A', title: 'B', link: '', note: '' }, user, true, true)
    assert.deepEqual(await db.fetchNotifications(user.id), [])
  } finally { restore() }
})
