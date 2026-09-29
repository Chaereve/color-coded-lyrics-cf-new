import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateFunnel, FUNNEL_EVENT_KEYS } from './funnelSummary.js'

test('cộng các nhóm ngày thành tổng 7 ngày, giữ đủ năm sự kiện', () => {
  assert.deepEqual(aggregateFunnel([
    { day: '2026-10-01', event: 'visit', n: '12' },
    { day: '2026-10-02', event: 'visit', n: 8 },
    { day: '2026-10-02', event: 'request', n: '3' },
    { day: '2026-10-02', event: 'vote', n: 7 },
    { day: '2026-10-02', event: 'buy', n: 1 },
    { day: '2026-10-02', event: 'spin', n: 4 },
  ]), { visit: 20, request: 3, vote: 7, buy: 1, spin: 4 })
})

test('không cộng event lạ, giá trị âm hoặc không phải số', () => {
  assert.deepEqual(aggregateFunnel([
    { event: 'admin_login', n: 9 }, { event: 'visit', n: -2 },
    { event: 'vote', n: 'not-a-number' }, { event: 'buy', n: null },
  ]), { visit: 0, request: 0, vote: 0, buy: 0, spin: 0 })
})

test('tổng hợp chỉ xuất whitelist event — không mang ngày hay danh tính sang UI', () => {
  const out = aggregateFunnel([{ event: 'visit', n: 2, user_id: 'private', device_id: 'private' }])
  assert.deepEqual(Object.keys(out), FUNNEL_EVENT_KEYS)
  assert.equal(JSON.stringify(out).includes('private'), false)
})
