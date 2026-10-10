import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOGIN_CYCLE_DAYS, LOGIN_REWARD_CAP, cycleDayOf, checkInGrantsFor,
  nextCheckInGrants, applyCap,
} from './loginRewards.js'

/* Mirror thuần của luật 20261127 — bài test DB (rewardLedger.pglite.mjs) chốt
   phía SQL chạy ĐÚNG các con số này. Hai bên phải không bao giờ trôi lệch. */

test('cycle day follows the 7-day wheel and resets after a miss', () => {
  assert.equal(cycleDayOf(0), 0)
  assert.equal(cycleDayOf(1), 1)
  assert.equal(cycleDayOf(6), 6)
  assert.equal(cycleDayOf(7), 7)
  assert.equal(cycleDayOf(8), 1, 'chu kỳ mới bắt đầu ngay sau ngày 7')
  assert.equal(cycleDayOf(14), 7)
  assert.equal(cycleDayOf(30), 2)
  for (const streak of [-3, NaN, undefined, 'nope']) assert.equal(cycleDayOf(streak), 0)
})

test('day 7 pays check-in + cycle bonus ADDITIVELY: 2 + 5 + 10 = 17 votes', () => {
  const day6 = checkInGrantsFor(6)
  assert.deepEqual(day6, [{ source: 'daily_login', amount: 2 }])
  const day7 = checkInGrantsFor(7)
  assert.deepEqual(day7, [
    { source: 'daily_login', amount: 2 },
    { source: 'login_day7', amount: 5 },
    { source: 'login_milestone7', amount: 10 },
  ])
  assert.equal(day7.reduce((s, g) => s + g.amount, 0), 17)
  // streak 8 lại chỉ là +2: mốc 7 lặp theo chu kỳ, không cộng dồn ngày thường
  assert.deepEqual(checkInGrantsFor(8), [{ source: 'daily_login', amount: 2 }])
  assert.deepEqual(checkInGrantsFor(14).map(g => g.source),
    ['daily_login', 'login_day7', 'login_milestone7'])
  assert.deepEqual(checkInGrantsFor(0), [])
})

test('next check-in projection: day 30 pays 2 + the once-only 20', () => {
  assert.deepEqual(nextCheckInGrants({ streak: 29, milestone30Granted: false }), [
    { source: 'daily_login', amount: 2 },
    { source: 'login_milestone30', amount: 20 },
  ])
  // Đã nhận mốc 30 rồi thì chỉ còn thưởng thường
  assert.deepEqual(nextCheckInGrants({ streak: 29, milestone30Granted: true }),
    [{ source: 'daily_login', amount: 2 }])
  // Đã claim hôm nay thì không chiếu gì nữa
  assert.deepEqual(nextCheckInGrants({ streak: 29, claimedToday: true }), [])
})

test('the daily cap scales grants down in order and never goes negative', () => {
  const grants = checkInGrantsFor(7)
  assert.deepEqual(applyCap(grants, 0, 30).reduce((s, g) => s + g.amount, 0), 17)
  // Cap 4: +2 nguyên vẹn, +5 cắt còn 2, +10 mất hẳn
  assert.deepEqual(applyCap(grants, 0, 4), [
    { source: 'daily_login', amount: 2 },
    { source: 'login_day7', amount: 2 },
  ])
  // Đã dùng 25/30 trong ngày: chỉ còn 5 headroom
  assert.equal(applyCap(grants, 25, LOGIN_REWARD_CAP).reduce((s, g) => s + g.amount, 0), 5)
  // Cap đã cạn: không còn gì
  assert.deepEqual(applyCap(grants, 30, LOGIN_REWARD_CAP), [])
  assert.equal(LOGIN_CYCLE_DAYS, 7)
})
