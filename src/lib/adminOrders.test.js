/* Doanh thu phải theo ngày thu tiền, không theo ngày khách đặt đơn. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ORDER_WINDOW_DAYS, matchOrderState, orderStats } from './adminOrders.js'

const NOW = +new Date('2026-10-21T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const order = (o) => ({
  id: 'o1', kind: 'votes', qty: 10, amount_vnd: 34000, amount_usd: 1.29,
  status: 'awaiting', created_at: daysAgo(1), ...o,
})
const paid = (o) => order({
  status: 'paid', paid_at: daysAgo(1), payment_method: 'bank',
  received_currency: 'VND', received_amount: 34000, payment_reference: 'VTEST', ...o,
})

test('đếm đủ bốn trạng thái, kể cả đơn awaiting đã quá hạn trước lượt cron', () => {
  const stats = orderStats([
    order({ id: 'a' }),
    order({ id: 'a2', transfer_reported_at: daysAgo(0) }),
    paid({ id: 'b', transfer_reported_at: daysAgo(1) }), paid({ id: 'c' }),
    order({ id: 'd', status: 'rejected' }),
    order({ id: 'e', status: 'expired', expires_at: daysAgo(1), transfer_reported_at: daysAgo(2) }),
    order({ id: 'f', expires_at: daysAgo(1) }),
  ], NOW)
  assert.equal(stats.total, 7)
  assert.equal(stats.awaiting, 2)
  assert.equal(stats.reported, 1)
  assert.equal(stats.paid, 2)
  assert.equal(stats.rejected, 1)
  assert.equal(stats.expired, 2)
  assert.equal(stats.recentPaid, 2)
})

test('tiền đã nhận chỉ cộng đơn paid có bằng chứng, đúng một loại tiền mỗi đơn', () => {
  const stats = orderStats([
    order({ id: 'a', status: 'awaiting', amount_vnd: 999000, amount_usd: 99 }),
    paid({ id: 'b' }),
    order({ id: 'c', status: 'rejected', amount_vnd: 500000, amount_usd: 20 }),
    paid({ id: 'd', payment_method: 'paypal', received_currency: 'USD', received_amount: 0.49, amount_vnd: 13000, amount_usd: 0.49 }),
  ], NOW)
  assert.equal(stats.receivedVnd, 34000)
  assert.equal(stats.receivedUsd, 0.49)
})

test('cửa sổ 30 ngày tính theo paid_at: đơn tạo cũ nhưng vừa thu tiền vẫn vào doanh thu', () => {
  const stats = orderStats([
    paid({ id: 'late', created_at: daysAgo(90), paid_at: daysAgo(2) }),
    paid({ id: 'old', created_at: daysAgo(2), paid_at: daysAgo(ORDER_WINDOW_DAYS + 1) }),
    paid({ id: 'edge', paid_at: daysAgo(ORDER_WINDOW_DAYS - 1), received_amount: 13000 }),
    paid({ id: 'future', paid_at: daysAgo(-1), received_amount: 999999 }),
  ], NOW)
  assert.equal(stats.paid, 4)
  assert.equal(stats.recentPaid, 2)
  assert.equal(stats.receivedVnd, 47000)
})

test('đơn paid lịch sử chưa có paid_at không bị đoán là tiền mới thu', () => {
  const stats = orderStats([
    paid({ id: 'ok' }),
    order({ id: 'legacy', status: 'paid', created_at: daysAgo(1), amount_vnd: 777777 }),
    paid({ id: 'bad-date', paid_at: 'không-phải-ngày' }),
    null,
  ], NOW)
  assert.equal(stats.total, 3)
  assert.equal(stats.paid, 3)
  assert.equal(stats.legacyPaid, 2)
  assert.equal(stats.recentPaid, 1)
  assert.equal(stats.receivedVnd, 34000)
})

test('mảng rỗng trả về toàn số 0, không NaN', () => {
  for (const input of [[], undefined, null]) {
    const stats = orderStats(input, NOW)
    for (const [k, v] of Object.entries(stats)) {
      if (k === 'windowDays') continue
      assert.equal(v, 0, `${k} phải là 0`)
    }
  }
})

test('bộ lọc trạng thái hiểu expired và đơn awaiting đã hết hạn', () => {
  assert.equal(matchOrderState({ status: 'paid' }, 'all'), true)
  assert.equal(matchOrderState({ status: 'paid' }, 'paid'), true)
  assert.equal(matchOrderState({ status: 'paid' }, 'awaiting'), false)
  assert.equal(matchOrderState({ status: 'expired' }, 'expired'), true)
  assert.equal(matchOrderState({ status: 'awaiting', expires_at: daysAgo(1) }, 'expired', NOW), true)
  assert.equal(matchOrderState({ status: 'awaiting', expires_at: daysAgo(1) }, 'awaiting', NOW), false)
  assert.equal(matchOrderState(null, 'paid'), false)
})
