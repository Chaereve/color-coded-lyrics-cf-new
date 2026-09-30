/* weekRecap.js — "Tuần qua nhìn lại" (T7). Chạy: npm test
   ---------------------------------------------------------
   Ba bất biến giữ cho thẻ recap không bao giờ nói dối:
   · cửa sổ 7 ngày lăn PHẢI trùng cửa sổ "This week" (không có hai định
     nghĩa "tuần" trong app — so thẳng với weeklyHighlights);
   · completed: tối đa 3, mỗi bài một dòng, chỉ bài XONG TRONG cửa sổ;
   · windowVotes chỉ đếm phiếu NHẬN trong cửa sổ — phiếu cũ không được
     lách vào chỉ vì có mặt trong votesLog. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { weekRecap, recapStats } from './weekRecap.js'
import { weeklyHighlights } from './board.js'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const DAY = 86400000
const at = (d) => new Date(NOW - d * DAY).toISOString()

const rows = [
  /* xong trong tuần (mới nhất trước) */
  { id: 1, title: 'Song A', artist: 'X', status: 'completed', created_at: at(20), completed_at: at(1) },
  /* cũng là Song A — chỉ được đếm MỘT dòng */
  { id: 2, title: 'Song A', artist: 'X', status: 'completed', created_at: at(21), completed_at: at(1.2) },
  { id: 3, title: 'Song B', artist: 'Y', status: 'completed', created_at: at(10), completed_at: at(2) },
  { id: 4, title: 'Song C', artist: 'Z', status: 'completed', created_at: at(10), completed_at: at(3) },
  { id: 5, title: 'Song D', artist: 'W', status: 'completed', created_at: at(10), completed_at: at(4) },
  /* xong NGOÀI cửa sổ — không được lọt danh sách */
  { id: 6, title: 'Old done', artist: 'Q', status: 'completed', created_at: at(40), completed_at: at(20) },
  /* đang chạy — không phải hoàn thành */
  { id: 7, title: 'WIP', artist: 'Q', status: 'in_progress', created_at: at(2) },
]
const votesLog = [
  { request_id: 1, at: NOW - 1000 },        /* trong cửa sổ */
  { request_id: 1, at: NOW - 2000 },        /* trong cửa sổ */
  { request_id: 7, at: NOW - 3 * DAY },     /* trong cửa sổ */
  { request_id: 6, at: NOW - 30 * DAY },    /* NGOÀI cửa sổ — không được đếm */
]

test('cửa sổ 7 ngày: completed ≤ 3, mỗi bài một dòng, mới xong trước', () => {
  const r = weekRecap(rows, NOW, votesLog)
  assert.equal(r.completed.length, 3, 'tối đa 3 bài')
  assert.deepEqual(r.completed.map(c => c.title), ['Song A', 'Song B', 'Song C'],
    'xếp theo thời điểm xong GIẢM DẦN (mới xong trước): Song A gộp hai dòng một, Old done bị loại, Song D rơi khỏi top 3')
  /* bài cũ xong trong tuần vẫn tính — completed_at lọt cửa sổ là đủ */
  assert.ok(r.completed.every(c => c.doneAt >= r.since && c.doneAt <= r.until))
})

test('windowVotes chỉ đếm phiếu trong cửa sổ', () => {
  const r = weekRecap(rows, NOW, votesLog)
  assert.equal(r.windowVotes, 3, '2 phiếu Song A + 1 phiếu WIP; phiếu 30 ngày trước bị loại')
})

test('top TRÙNG với weeklyHighlights — không có hai định nghĩa "dẫn đầu"', () => {
  const r = weekRecap(rows, NOW, votesLog)
  const h = weeklyHighlights(rows, NOW, votesLog)
  assert.deepEqual(r.top, h.top)
  assert.equal(r.top.title, 'Song A', 'nhiều phiếu nhận trong cửa sổ nhất')
  assert.equal(r.top.votes, 2)
})

test('tuần lặng: không completed, không phiếu — số liệu về 0 thật thà', () => {
  const r = weekRecap([], NOW, [])
  assert.equal(r.windowVotes, 0)
  assert.deepEqual(r.completed, [])
  assert.equal(r.top, null)
  assert.deepEqual(recapStats(r).map(s => s.value), [0, 0, 0])
  assert.deepEqual(recapStats(r).map(s => s.key), ['statVotes', 'statDone', 'statTop'])
})
