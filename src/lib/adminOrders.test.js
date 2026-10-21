/* Số liệu của mục Đơn hàng — hàm thuần, nên test bằng mảng thường.
   Hai điều phải chốt:
     1. TIỀN CHỈ TÍNH ĐƠN `paid`. Đơn đang chờ chưa chắc thành tiền, đơn bị từ
        chối thì không bao giờ — cộng cả ba loại là báo cáo doanh thu sai.
     2. Cửa sổ 30 ngày, nhưng KHÔNG đổi khi admin bấm sang trang khác hoặc gõ
        một từ khoá: con số này là của cả bảng, không phải của trang đang nhìn.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ORDER_WINDOW_DAYS, matchOrderState, orderStats } from './adminOrders.js'

const NOW = +new Date('2026-10-21T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

const order = (o) => ({
  id: 'o1', kind: 'votes', qty: 10, amount_vnd: 34000, amount_usd: 1.29,
  status: 'awaiting', created_at: daysAgo(1), ...o,
})

test('đếm đúng ba trạng thái có thật của bảng orders', () => {
  const stats = orderStats([
    order({ id: 'a' }),
    order({ id: 'b', status: 'paid' }),
    order({ id: 'c', status: 'paid' }),
    order({ id: 'd', status: 'rejected' }),
    order({ id: 'e', status: 'something-else' }),
  ], NOW)
  assert.equal(stats.total, 5)
  assert.equal(stats.awaiting, 1)
  assert.equal(stats.paid, 2)
  assert.equal(stats.rejected, 1)
  assert.equal(stats.recentPaid, 2)
})

test('tiền đã nhận chỉ cộng đơn paid — đơn chờ và đơn bị từ chối không phải doanh thu', () => {
  const stats = orderStats([
    order({ id: 'a', status: 'awaiting', amount_vnd: 999000, amount_usd: 99 }),
    order({ id: 'b', status: 'paid', amount_vnd: 34000, amount_usd: 1.29 }),
    order({ id: 'c', status: 'rejected', amount_vnd: 500000, amount_usd: 20 }),
    order({ id: 'd', status: 'paid', amount_vnd: 13000, amount_usd: 0.49 }),
  ], NOW)
  assert.equal(stats.receivedVnd, 47000)
  assert.equal(stats.receivedUsd, 1.78)
})

test('cửa sổ 30 ngày: đơn cũ hơn không vào con số, nhưng vẫn được đếm theo trạng thái', () => {
  const stats = orderStats([
    order({ id: 'new', status: 'paid', created_at: daysAgo(3) }),
    order({ id: 'edge', status: 'paid', created_at: daysAgo(ORDER_WINDOW_DAYS - 1) }),
    order({ id: 'old', status: 'paid', created_at: daysAgo(ORDER_WINDOW_DAYS + 1) }),
  ], NOW)
  assert.equal(stats.paid, 3, 'trạng thái là chuyện của cả bảng, không phải của cửa sổ')
  assert.equal(stats.recentPaid, 2, 'chỉ hai đơn nằm trong 30 ngày')
  assert.equal(stats.receivedVnd, 68000)
})

test('đơn có ngày hỏng không làm sập phép tính và không được cộng vào doanh thu', () => {
  const stats = orderStats([
    order({ id: 'ok', status: 'paid' }),
    order({ id: 'bad', status: 'paid', created_at: 'không-phải-ngày', amount_vnd: 777777 }),
    null,
  ], NOW)
  assert.equal(stats.total, 2, 'null trong mảng không phải một đơn')
  assert.equal(stats.paid, 2)
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

test('bộ lọc trạng thái: all = không lọc, giá trị lạ cũng không được làm rỗng danh sách', () => {
  assert.equal(matchOrderState({ status: 'paid' }, 'all'), true)
  assert.equal(matchOrderState({ status: 'paid' }, ''), true)
  assert.equal(matchOrderState({ status: 'paid' }, undefined), true)
  assert.equal(matchOrderState({ status: 'paid' }, 'paid'), true)
  assert.equal(matchOrderState({ status: 'paid' }, 'awaiting'), false)
  assert.equal(matchOrderState(null, 'paid'), false)
})
