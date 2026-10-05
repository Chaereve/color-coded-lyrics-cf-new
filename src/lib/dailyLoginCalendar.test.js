import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDailyLoginCalendarMonth, validateDailyLoginCalendarStatus } from './dailyLoginCalendar.js'

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
