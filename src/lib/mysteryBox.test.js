/* Pin the mystery box client contract: the prize table matches the approved
   weights exactly, the status validator holds the exact-key shape (a stray
   key or a bogus result is a protocol error, not a rendering quirk), and the
   demo roll is deterministic per (user, day) and distributed by weight. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MYSTERY_PRIZES, MYSTERY_KINDS, validateMysteryStatus, demoRoll, demoResultFor,
  buildMysteryMonth,
} from './mysteryBox.js'

const status = (over = {}) => ({
  user_id: 'u1', day: '2026-10-08', enabled: true, checked_in: true,
  opened: true, result: 1, reward_votes: 1, reward_kind: 'votes', ...over,
})

test('the prize table is the approved v3 70/16/8/4/1.5/0.4/0.1 — ONE +5, paid amounts split', () => {
  assert.deepEqual(MYSTERY_PRIZES.map(p => [p.result, p.kind, p.votes, p.requests, p.weight]), [
    [0, 'nothing', 0, 0, 700], [1, 'votes', 1, 0, 160], [2, 'votes', 3, 0, 80],
    [3, 'votes', 5, 0, 40], [4, 'votes', 10, 0, 15],
    [5, 'free_paid_request', 0, 1, 4], [6, 'free_paid_request', 0, 2, 1],
  ])
  assert.equal(MYSTERY_PRIZES.reduce((sum, p) => sum + p.weight, 0), 1000)
  assert.deepEqual(MYSTERY_KINDS, ['nothing', 'votes', 'paid_request', 'free_paid_request'])
  /* DUY NHẤT một outcome +5 votes (7%); 1% là +2 free paid requests — sửa lỗi
     "hai outcome cùng +5" của bảng cũ. */
  assert.equal(MYSTERY_PRIZES.filter(p => p.kind === 'votes' && p.votes === 5).length, 1)
  assert.equal(MYSTERY_PRIZES.find(p => p.result === 6).requests, 2)
})

test('validateMysteryStatus holds the exact key contract', () => {
  const validate = over => validateMysteryStatus(status(over), 'u1')
  assert.deepEqual(validate({}), status())
  // Unopened day: result/votes/kind must be the null triple.
  assert.equal(validate({ opened: false, result: null, reward_votes: 0, reward_kind: null }).opened, false)
  // A stray key is a protocol error.
  assert.throws(() => validateMysteryStatus({ ...status(), extra: 1 }, 'u1'), /err\.mysteryResponse/)
  // Opened with a null result is nonsense; so is kind/votes mismatch.
  assert.throws(() => validate({ result: null }), /err\.mysteryResponse/)
  // reward_votes may be clipped (0..prize.votes); above the ceiling is bogus.
  assert.throws(() => validate({ result: 1, reward_votes: 2 }), /err\.mysteryResponse/)
  assert.equal(validate({ result: 2, reward_votes: 2 }).reward_votes, 2)
  assert.throws(() => validate({ result: 5, reward_kind: 'votes' }), /err\.mysteryResponse/)
  assert.throws(() => validate({ result: 7 }), /err\.mysteryResponse/)
  /* BẢNG v2: result 5/6 là free paid request; mọi kind khác là giao thức lỗi. */
  assert.equal(validate({ result: 5, reward_votes: 0, reward_kind: 'free_paid_request' }).result, 5)
  assert.equal(validate({ result: 6, reward_votes: 0, reward_kind: 'free_paid_request' }).result, 6)
  assert.throws(() => validate({ result: 6, reward_kind: 'free_paid_request', reward_votes: 3 }),
    /err\.mysteryResponse/, 'paid KHÔNG được mang vote')
  /* Row v1 (trước 20261202) vẫn đọc được: 5 = 'paid_request' (+1), 6 = '+5 votes'. */
  assert.equal(validate({ result: 5, reward_votes: 0, reward_kind: 'paid_request' }).result, 5)
  assert.equal(validate({ result: 6, reward_votes: 5, reward_kind: 'votes' }).result, 6)
  // Wrong owner or a non-day value never validates.
  assert.throws(() => validateMysteryStatus(status(), 'u2'), /err\.mysteryAccount/)
  assert.throws(() => validate({ day: 'tomorrow' }), /err\.mysteryResponse/)
})

test('payload v2 (sau 20261202): reward_amount strict — sai số lượng là lỗi', () => {
  const v2 = over => validateMysteryStatus({
    user_id: 'u1', day: '2026-10-08', enabled: true, checked_in: true, opened: true,
    result: 1, reward_votes: 1, reward_amount: 1, reward_kind: 'votes', ...over,
  }, 'u1')
  /* Đúng bảng: votes → amount = số vote đã trả; FPR → đúng 1|2; nothing → 0. */
  assert.equal(v2({ result: 3, reward_votes: 5, reward_amount: 5, reward_kind: 'votes' }).reward_amount, 5)
  assert.equal(v2({ result: 4, reward_votes: 4, reward_amount: 4, reward_kind: 'votes' }).reward_amount, 4)
  assert.equal(v2({ result: 5, reward_votes: 0, reward_amount: 1, reward_kind: 'free_paid_request' }).reward_amount, 1)
  assert.equal(v2({ result: 6, reward_votes: 0, reward_amount: 2, reward_kind: 'free_paid_request' }).reward_amount, 2)
  assert.equal(v2({ result: 0, reward_votes: 0, reward_amount: 0, reward_kind: 'nothing' }).result, 0)
  /* Khoe sai số lượng (label sẽ in sai +1/+2) → chặn render, không đoán lại. */
  assert.throws(() => v2({ result: 6, reward_votes: 0, reward_amount: 1, reward_kind: 'free_paid_request' }), /err\.mysteryResponse/)
  assert.throws(() => v2({ result: 5, reward_votes: 0, reward_amount: 2, reward_kind: 'free_paid_request' }), /err\.mysteryResponse/)
  assert.throws(() => v2({ result: 2, reward_votes: 2, reward_amount: 3, reward_kind: 'votes' }), /err\.mysteryResponse/)
  /* Chưa mở mà mang amount khác 0 là giao thức lỗi. */
  assert.throws(() => v2({ opened: false, result: null, reward_votes: 0, reward_amount: 1, reward_kind: null }), /err\.mysteryResponse/)
})

test('the demo roll is deterministic per (user, day) and lands on real prizes', () => {
  assert.equal(demoRoll('demo-user', '2026-10-08'), demoRoll('demo-user', '2026-10-08'))
  assert.notEqual(demoRoll('demo-user', '2026-10-08'), demoRoll('demo-user', '2026-10-09'))
  const prize = demoResultFor('demo-user', '2026-10-08')
  assert.ok(MYSTERY_PRIZES.includes(prize))
  // Distribution sanity over the 28 unique January days: nothing stays near 70%.
  let nothing = 0
  const N = 2000
  for (let index = 0; index < N; index++) {
    if (demoResultFor('demo-user', `2026-01-${String(1 + (index % 28)).padStart(2, '0')}`).result === 0) nothing++
  }
  assert.ok(Math.abs(nothing / N - 0.70) < 0.15, `nothing bucket ${(nothing / N).toFixed(2)}`)
})

test('buildMysteryMonth marks known opens and does not invent missed days', () => {
  const cal = buildMysteryMonth('2026-10-10', '2026-10', [
    { day: '2026-10-02', result: 0, reward_kind: 'nothing', reward_votes: 0 },
    { day: '2026-10-08', result: 1, reward_kind: 'votes', reward_votes: 1 },
  ])
  assert.equal(cal.month, '2026-10')
  assert.equal(cal.openedCount, 2)
  const byDay = Object.fromEntries(cal.cells.filter(Boolean).map(c => [c.day, c]))
  assert.equal(byDay['2026-10-02'].state, 'empty')
  assert.equal(byDay['2026-10-08'].state, 'hit')
  assert.equal(byDay['2026-10-10'].state, 'today')
  assert.equal(byDay['2026-10-03'].state, 'idle', 'ngày quá khứ không có bản ghi không bịa missed')
  assert.equal(byDay['2026-10-11'].state, 'upcoming')
})
