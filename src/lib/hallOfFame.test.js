import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHallOfFame } from './hallOfFame.js'

const rows = Array.from({ length: 7 }, (_, i) => ({
  id: `r${i}`, artist: `Artist ${i}`, title: `Video ${i}`, requester: `u${i}`,
  status: 'completed', video_url: `https://youtu.be/${String.fromCharCode(97 + i)}1234567890`,
  votes: i, completed_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}))

test('Hall of Fame chỉ trả tối đa năm video completed mới nhất', () => {
  const hall = buildHallOfFame([
    ...rows,
    { id: 'pending', status: 'queued', video_url: 'https://youtu.be/p1234567890' },
    { id: 'no-video', status: 'completed', video_url: null },
  ])
  assert.equal(hall.length, 5)
  assert.deepEqual(hall.map(r => r.id), ['r6', 'r5', 'r4', 'r3', 'r2'])
})

test('video YouTube trùng chỉ chiếm một card, gộp requester như trước', () => {
  const duplicate = {
    id: 'duplicate', artist: 'Other title', title: 'Duplicate request', requester: 'second',
    status: 'completed', video_url: rows[6].video_url, votes: 9,
    completed_at: new Date(Date.UTC(2026, 0, 8)).toISOString(),
  }
  const hall = buildHallOfFame([...rows, duplicate])
  assert.equal(hall.length, 5)
  assert.equal(hall[0].id, 'duplicate', 'mốc hoàn tất mới nhất đứng đầu')
  assert.equal(hall[0].count, 2)
  assert.deepEqual(hall[0].requesters, ['second', 'u6'])
})

test('limit có thể thu nhỏ hoặc tắt hoàn toàn, không âm thầm phình danh sách', () => {
  assert.equal(buildHallOfFame(rows, 2).length, 2)
  assert.equal(buildHallOfFame(rows, 99).length, 5, 'không caller nào được phình Hall quá 5')
  assert.equal(buildHallOfFame(rows, Infinity).length, 5)
  assert.deepEqual(buildHallOfFame(rows, 0), [])
})
