import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_VOTE_AWAITING, ORDER_PAYMENT_HOURS, orderActivityCategory, orderDeadline, orderDisplayStatus, orderFocusLocation, orderReference, orderTransferContent, pendingOrdersOfKind, matchesRequestFunding, reconcileOrder, requestFundingKind, requestPaymentState, requestPriorityRank } from './requestPayment.js'

test('request funding distinguishes money, reward, awaiting and unverified legacy', () => {
  assert.equal(requestPaymentState({ is_paid: false }), 'free')
  assert.equal(requestPaymentState({ is_paid: true, payment_source: 'money', payment_status: 'awaiting' }), 'awaiting')
  assert.equal(requestPaymentState({ is_paid: true, payment_source: 'money', payment_status: 'paid' }), 'paid')
  assert.equal(requestPaymentState({ is_paid: true, payment_source: 'bonus', payment_status: 'paid' }), 'bonus')
  assert.equal(requestPaymentState({ is_paid: true, payment_status: 'paid' }), 'unverified')
})
test('queue priority ranks settled money above bonus above free, and fails closed for awaiting/legacy', () => {
  assert.equal(requestPriorityRank({ is_paid: true, payment_source: 'money', payment_status: 'paid' }), 2)
  assert.equal(requestPriorityRank({ is_paid: true, payment_source: 'bonus', payment_status: 'paid' }), 1)
  assert.equal(requestPriorityRank({ is_paid: false }), 0)
  assert.equal(requestPriorityRank({ is_paid: true, payment_source: 'money', payment_status: 'awaiting' }), 0)
  assert.equal(requestPriorityRank({ is_paid: true, payment_source: 'bonus', payment_status: 'awaiting' }), 0)
  assert.equal(requestPriorityRank({ is_paid: true, payment_source: 'legacy', payment_status: 'paid' }), 0)
  assert.equal(requestPriorityRank(null), 0)
})
test('pending orders are scoped by kind, so a paid request never becomes a vote invoice', () => {
  const orders = [
    { id: 'r', kind: 'paid_request', status: 'awaiting' },
    { id: 'v', kind: 'votes', status: 'awaiting' },
    { id: 'p', kind: 'votes', status: 'paid' },
  ]
  assert.deepEqual(pendingOrdersOfKind(orders, 'votes').map(o => o.id), ['v'])
  assert.equal(MAX_VOTE_AWAITING, 20)
})
test('transfer reference keeps the full UUID so two orders cannot share a short prefix', () => {
  const order = { id: 'abcdef12-3456-7890-abcd-ef1234567890', kind: 'votes' }
  assert.equal(orderReference(order), 'V-ABCDEF1234567890ABCDEF1234567890')
  assert.equal(orderReference({ ...order, kind: 'paid_request' }), 'PR-ABCDEF1234567890ABCDEF1234567890')
  const content = orderTransferContent(order)
  assert.equal(content, orderReference(order))
  assert.ok(content.length <= 40)
  assert.ok(!/[^\x20-\x7E]/.test(content))
})

const NOW = +new Date('2026-11-15T12:00:00Z')
test('72-hour window frees quota only after expiry and never rewinds paid orders', () => {
  const fresh = { id: 'a', kind: 'votes', status: 'awaiting', expires_at: new Date(NOW + 3600e3).toISOString() }
  const due = { id: 'b', kind: 'votes', status: 'awaiting', expires_at: new Date(NOW - 1).toISOString() }
  assert.equal(ORDER_PAYMENT_HOURS, 72)
  assert.deepEqual(pendingOrdersOfKind([fresh, due, { id: 'c', kind: 'votes', status: 'paid' }], 'votes', NOW).map(o => o.id), ['a'])
  assert.equal(orderDisplayStatus(due, NOW), 'expired')
  assert.deepEqual(orderDeadline(fresh, NOW), { at: NOW + 3600e3, expired: false, hoursLeft: 1 })
  assert.equal(orderDeadline(due, NOW).expired, true)
  assert.equal(orderActivityCategory(due, NOW), 'expired')
  assert.equal(orderActivityCategory({ kind: 'paid_request', status: 'expired' }, NOW), 'paid_request')
})

test('manual reconciliation checks currency, exact reference and amount before approval', () => {
  const order = { id: 'abcdef12-3456-7890-abcd-ef1234567890', kind: 'votes', amount_vnd: 34000, amount_usd: 1.29 }
  const ref = orderReference(order)
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 34000, reference: ref.toLowerCase() }).ok, true)
  assert.equal(reconcileOrder(order, { method: 'paypal', amount: 1.29, reference: ref.replace('-', '') }).ok, true)
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 33000, reference: ref }).code, 'err.paymentAmountMismatch')
  assert.equal(reconcileOrder(order, { method: 'paypal', amount: 1.31, reference: ref }).code, 'err.paymentAmountMismatch')
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 34000, reference: 'V-OTHER' }).code, 'err.paymentReferenceMismatch')
  assert.equal(reconcileOrder(order, { method: 'bank', amount: '', reference: ref }).code, 'err.paymentAmountInvalid')
  assert.equal(reconcileOrder(order, { method: 'cash', amount: 34000, reference: ref }).ok, false)
})

test('order notification focus finds the page inside the right activity category', () => {
  const votes = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, kind: 'votes', status: 'paid' }))
  const requests = [{ id: 'pr-old', kind: 'paid_request', status: 'rejected' }, { id: 'pr-target', kind: 'paid_request', status: 'expired' }]
  const orders = [...votes, ...requests]
  assert.deepEqual(orderFocusLocation(orders, 'v11', 10, NOW), { order: votes[11], category: 'successful', index: 11, page: 2 })
  assert.deepEqual(orderFocusLocation(orders, 'pr-target', 10, NOW), { order: requests[1], category: 'paid_request', index: 1, page: 1 })
  assert.equal(orderFocusLocation(orders, 'missing', 10, NOW), null)
  assert.equal(orderFocusLocation(null, 'v0', 10, NOW), null)
})


test('admin funding filter separates money, bonus, free and unverified without guessing legacy', () => {
  const money = { is_paid: true, payment_source: 'money', payment_status: 'awaiting' }
  const bonus = { is_paid: true, payment_source: 'bonus', payment_status: 'paid' }
  const free = { is_paid: false, payment_source: null, payment_status: 'none' }
  const legacy = { is_paid: true, payment_source: 'legacy', payment_status: 'paid' }
  assert.equal(requestFundingKind(money), 'money')
  assert.equal(requestFundingKind({ ...money, payment_status: 'paid' }), 'money')
  assert.equal(requestFundingKind(bonus), 'bonus')
  assert.equal(requestFundingKind(free), 'free')
  assert.equal(requestFundingKind(legacy), 'unverified')
  assert.equal(requestFundingKind({ is_paid: true, payment_status: 'paid' }), 'unverified')
  assert.equal(matchesRequestFunding(money, 'money'), true)
  assert.equal(matchesRequestFunding(money, 'bonus'), false)
  assert.equal(matchesRequestFunding(bonus, 'bonus'), true)
  assert.equal(matchesRequestFunding(bonus, 'money'), false)
  assert.equal(matchesRequestFunding(free, 'free'), true)
  assert.equal(matchesRequestFunding(legacy, 'unverified'), true)
  assert.equal(matchesRequestFunding(legacy, 'all'), true)
  assert.equal(matchesRequestFunding(null, 'all'), true)
})
