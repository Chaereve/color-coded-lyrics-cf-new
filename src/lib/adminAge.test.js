/* Tuổi của một yêu cầu trên bảng quản trị.
   Điều phải chốt: hàng đã chốt / đang làm thì KHÔNG hiện chip "chờ", và mốc
   quá hạn đi theo nhịp chốt bài trong cấu hình chứ không phải một số viết cứng.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WAITING_STATES, ageChip, ageInDays } from './adminAge.js'

const NOW = +new Date('2026-10-21T12:00:00.000Z')
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const row = (o) => ({
  id: 'r1', status: 'pending', created_at: daysAgo(2), picked_at: null, ...o,
})

test('đếm ngày từ lúc gửi, và không bao giờ ra số âm', () => {
  assert.equal(ageInDays(daysAgo(0), NOW), 0)
  assert.equal(ageInDays(daysAgo(6), NOW), 6)
  assert.equal(ageInDays(new Date(NOW + 86400000).toISOString(), NOW), 0, 'ngày ở tương lai không phải -1')
  assert.equal(ageInDays('không-phải-ngày', NOW), 0)
  assert.equal(ageInDays(null, NOW), 0)
})

test('chỉ hàng còn chờ mới có chip tuổi', () => {
  assert.deepEqual(WAITING_STATES, ['pending', 'queued'])
  assert.equal(ageChip(row({ status: 'in_progress' }), 4, NOW), null, 'đang làm thì đồng hồ chờ đã dừng')
  assert.equal(ageChip(row({ status: 'completed' }), 4, NOW), null)
  assert.equal(ageChip(row({ status: 'denied' }), 4, NOW), null)
  assert.equal(ageChip(null, 4, NOW), null)
})

test('đã chốt vào Up next thì không còn "quá hạn chờ"', () => {
  const picked = row({ status: 'queued', created_at: daysAgo(20), picked_at: daysAgo(1) })
  assert.equal(ageChip(picked, 4, NOW), null)
})

test('quá hạn = chờ lâu hơn nhịp chốt bài, và nhịp đọc từ cấu hình', () => {
  assert.deepEqual(ageChip(row({ created_at: daysAgo(3) }), 4, NOW), { days: 3, overdue: false, interval: 4 })
  assert.deepEqual(ageChip(row({ created_at: daysAgo(5) }), 4, NOW), { days: 5, overdue: true, interval: 4 })
  /* cùng một hàng, đổi nhịp trong DB là đổi cảnh báo — không sửa code */
  assert.equal(ageChip(row({ created_at: daysAgo(5) }), 7, NOW).overdue, false)
  /* nhịp rác (0, chữ, âm) rơi về 4 ngày thay vì chia cho 0 */
  for (const bad of [0, -3, 'abc', undefined, null]) {
    assert.equal(ageChip(row({ created_at: daysAgo(5) }), bad, NOW).interval, 4)
  }
})
