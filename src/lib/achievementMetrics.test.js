import test from 'node:test'
import assert from 'node:assert/strict'
import { achievementRequestMetrics } from './achievementMetrics.js'

test('achievement preview matches eligible distinct works and settled paid orders', () => {
  const requests = [
    { id: 'cash-1', user_id: 'u', artist: 'Artist', title: 'Song', status: 'queued', is_paid: true, payment_status: 'paid' },
    { id: 'cash-duplicate', user_id: 'u', artist: ' artist ', title: 'SONG', status: 'completed', is_paid: false },
    { id: 'awaiting', user_id: 'u', artist: 'Artist', title: 'Another', status: 'queued', is_paid: true, payment_status: 'awaiting' },
    { id: 'bonus', user_id: 'u', artist: 'Artist', title: 'Bonus Song', status: 'queued', is_paid: true, payment_status: 'paid' },
    { id: 'pending', user_id: 'u', artist: 'Artist', title: 'Not reviewed', status: 'pending', is_paid: true, payment_status: 'paid' },
    { id: 'denied', user_id: 'u', artist: 'Artist', title: 'Rejected', status: 'denied', is_paid: false },
  ]
  const orders = [
    { user_id: 'u', kind: 'paid_request', status: 'paid', request_id: 'cash-1' },
    { user_id: 'u', kind: 'paid_request', status: 'awaiting', request_id: 'awaiting' },
    { user_id: 'u', kind: 'paid_request', status: 'paid', request_id: 'pending' },
    { user_id: 'other', kind: 'paid_request', status: 'paid', request_id: 'bonus' },
    { user_id: 'u', kind: 'votes', status: 'paid', request_id: 'bonus' },
  ]
  const ranking = [
    { user_id: 'other', total: 4, total_votes: 80 },
    { user_id: 'u', total: 3, total_votes: 20 },
  ]

  assert.deepEqual(achievementRequestMetrics(requests, orders, ranking, 'u'), {
    requests: 3,
    completed: 1,
    paidRequests: 1,
    picked: false,
    rank: 2,
  })
})

test('picked reports whether any request entered Up next', () => {
  const base = { user_id: 'u', artist: 'A', title: 'B', status: 'queued', is_paid: false }
  assert.equal(achievementRequestMetrics([{ id: 'r', ...base }], [], [], 'u').picked, false)
  assert.equal(achievementRequestMetrics([{ id: 'r', ...base, picked_at: '2026-10-08T03:00:00Z' }], [], [], 'u').picked, true)
})

test('paid progress is zero until a matching settled paid_request order exists', () => {
  const requests = [
    { id: 'r', user_id: 'u', artist: 'A', title: 'B', status: 'queued', is_paid: true, payment_status: 'paid' },
  ]
  assert.equal(achievementRequestMetrics(requests, [], [], 'u').paidRequests, 0)
  assert.equal(achievementRequestMetrics(requests, [
    { user_id: 'u', kind: 'paid_request', status: 'awaiting', request_id: 'r' },
  ], [], 'u').paidRequests, 0)
  assert.equal(achievementRequestMetrics(requests, [
    { user_id: 'u', kind: 'paid_request', status: 'paid', request_id: 'r' },
  ], [], 'u').paidRequests, 1)
})
