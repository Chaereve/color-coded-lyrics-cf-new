import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateDailyLoginCalendarMonth, validateDailyLoginCalendarStatus,
  fetchDailyLoginCalendarStatus, claimDailyLoginCalendar, fetchDailyLoginCalendarMonth,
} from './dailyLoginCalendar.js'

/* Demo mode đọc localStorage thật của trình duyệt; ở Node thì dựng một bản
   giả tối thiểu để kiểm chính đường demo (chế độ preview không có Supabase). */
const store = new Map()
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
}

const status = (overrides = {}) => ({
  user_id: 'user-a',
  day: '2026-10-05',
  server_now: '2026-10-05T01:00:00.000Z',
  reset_at: '2026-10-05T17:00:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  login: { claimed: false, claimed_days: [], total_days: 0, first_day: null, streak: 0, best_streak: 0 },
  ...overrides,
})

test('Calendar status accepts only the owner-scoped calendar contract', () => {
  const payload = status()
  assert.equal(validateDailyLoginCalendarStatus(payload, 'user-a'), payload)
  assert.throws(() => validateDailyLoginCalendarStatus(payload, 'user-b'), /err.dailyAccountChanged/)
  for (const extra of [
    { quiz: null }, { credits: 4 }, { bonus: 4 }, { earned_today: 2 }, { votes_awarded: 2 },
  ]) assert.throws(() => validateDailyLoginCalendarStatus({ ...payload, ...extra }, 'user-a'), /err.dailyResponse/)
})

test('Calendar status rejects malformed, stale, future or inconsistent server dates', () => {
  for (const invalid of [
    { day: '2026-02-30' },
    { server_now: '2026-10-04T16:59:59.000Z' },
    { server_now: '2026-10-05T17:00:01.000Z' },
    { timezone: 'UTC' },
    { reset_at: '2026-10-05T16:59:59.000Z' },
    { login: { ...status().login, claimed: true } },
    { login: { ...status().login, claimed_days: ['2026-10-05'] } },
    { login: { ...status().login, claimed_days: ['2026-10-04'] } },
    { login: { ...status().login, claimed_days: ['2026-10-05', '2026-10-05'] } },
    { login: { ...status().login, total_days: 1, first_day: '2026-10-06' } },
    { login: { ...status().login, total_days: 2, streak: 2, best_streak: 1 } },
  ]) assert.throws(() => validateDailyLoginCalendarStatus({ ...status(), ...invalid }, 'user-a'), /err.dailyResponse/)
})

test('monthly history is owner-scoped, sorted, bounded to the requested month and quiz-free', () => {
  const payload = { user_id: 'user-a', month: '2026-10', day: '2026-10-05', days: ['2026-10-01', '2026-10-05'] }
  assert.equal(validateDailyLoginCalendarMonth(payload, 'user-a', '2026-10'), payload)
  for (const invalid of [
    { ...payload, quiz: null },
    { ...payload, days: ['2026-10-05', '2026-10-01'] },
    { ...payload, days: ['2026-10-06'] },
    { ...payload, days: ['2026-09-30'] },
    { ...payload, days: ['2026-10-01', '2026-10-01'] },
  ]) assert.throws(() => validateDailyLoginCalendarMonth(invalid, 'user-a', '2026-10'), /err.dailyResponse/)
  assert.throws(() => validateDailyLoginCalendarMonth(payload, 'user-b', '2026-10'), /err.dailyAccountChanged/)
  const future = { user_id: 'user-a', month: '2026-11', day: '2026-10-05', days: [] }
  assert.equal(validateDailyLoginCalendarMonth(future, 'user-a', '2026-11'), future)
  assert.throws(() => validateDailyLoginCalendarMonth({ ...future, days: ['2026-11-01'] }, 'user-a', '2026-11'), /err.dailyResponse/)
})

test('demo check-in records the day once, replays safely and never touches a wallet', async () => {
  const userId = 'demo-user-a'
  const before = await fetchDailyLoginCalendarStatus(userId)
  assert.equal(before.login.claimed, false)
  assert.equal(before.login.total_days, 0)

  const first = await claimDailyLoginCalendar(userId, before.day)
  assert.equal(first.replayed, false)
  assert.equal(first.status.login.claimed, true)
  assert.deepEqual(first.status.login.claimed_days, [before.day])
  assert.equal(first.status.login.total_days, 1)
  assert.equal(first.status.login.streak, 1)

  // Second call in the same day: replayed, no duplicate day, no extra total.
  const again = await claimDailyLoginCalendar(userId, before.day)
  assert.equal(again.replayed, true)
  assert.deepEqual(again.status.login.claimed_days, [before.day])
  assert.equal(again.status.login.total_days, 1)

  // A stale client day is refused: the day comes from the clock, not the client.
  const stale = await fetchDailyLoginCalendarStatus(userId)
  assert.notEqual(stale.day, '1999-12-31')
  await assert.rejects(() => claimDailyLoginCalendar(userId, '1999-12-31'), /err.dailyDayChanged/)
  await assert.rejects(() => claimDailyLoginCalendar(userId, 'not-a-day'), /err.dailyDayChanged/)
  await assert.rejects(() => claimDailyLoginCalendar('', stale.day), /err.signin/)
})

test('demo month browsing is read-only, owner-scoped and carries no reward fields', async () => {
  const userId = 'demo-user-b'
  const status = await fetchDailyLoginCalendarStatus(userId)
  await claimDailyLoginCalendar(userId, status.day)
  const month = status.day.slice(0, 7)

  const payload = await fetchDailyLoginCalendarMonth(userId, month)
  assert.deepEqual(Object.keys(payload).sort(), ['day', 'days', 'month', 'user_id'])
  assert.equal(payload.user_id, userId)
  assert.equal(payload.month, month)
  assert.deepEqual(payload.days, [status.day])

  // Browsing never claims: a second read is identical and a foreign owner sees nothing.
  const same = await fetchDailyLoginCalendarMonth(userId, month)
  assert.deepEqual(same.days, payload.days)
  const other = await fetchDailyLoginCalendarMonth('demo-user-c', month)
  assert.deepEqual(other.days, [])
  await assert.rejects(() => fetchDailyLoginCalendarMonth(userId, 'nonsense'), /err\./)
})
