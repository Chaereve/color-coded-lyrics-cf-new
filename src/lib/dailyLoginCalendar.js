import { hasSupabase, supabase } from './supabaseClient.js'
import { isCalendarDay, isCalendarMonth, monthOf, monthLength, checkInStats } from './checkInCalendar.js'
import { nextSpinReset, spinDay } from './dailySpin.js'

export const DAILY_LOGIN_CALENDAR_SYNC_KEY = 'ccl.daily.login.calendar.changed.v1'
const DEMO_KEY = userId => `ccl.daily.login.calendar.demo.v1.${userId}`
const SETUP_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])
const DAY_MS = 86_400_000
const VN_OFFSET_MS = 7 * 3_600_000
const STATUS_KEYS = ['user_id', 'day', 'server_now', 'reset_at', 'timezone', 'login']
const LOGIN_KEYS = ['claimed', 'claimed_days', 'total_days', 'first_day', 'streak', 'best_streak']
const MONTH_KEYS = ['user_id', 'month', 'day', 'days']

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const natural = value => Number.isInteger(value) && value >= 0
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const readDemo = userId => {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_KEY(userId)) || '{"days":[]}')
    return Array.isArray(parsed?.days) ? parsed.days.filter(isCalendarDay).sort() : []
  } catch { return [] }
}
const writeDemo = (userId, days) => {
  try { localStorage.setItem(DEMO_KEY(userId), JSON.stringify({ days })) } catch { /* demo only */ }
}

function makeStatus(userId, allDays, now = Date.now()) {
  const day = spinDay(now)
  const month = monthOf(day)
  const days = [...new Set(allDays.filter(value => isCalendarDay(value) && value <= day))].sort()
  const stats = checkInStats(days, day)
  const claimedDays = days.filter(value => monthOf(value) === month)
  return {
    user_id: userId,
    day,
    server_now: new Date(now).toISOString(),
    reset_at: nextSpinReset(now),
    timezone: 'Asia/Ho_Chi_Minh',
    login: {
      claimed: days.includes(day),
      claimed_days: claimedDays,
      total_days: stats.total,
      first_day: stats.first,
      streak: stats.streak,
      best_streak: stats.best,
    },
  }
}

export function validateDailyLoginCalendarStatus(status, expectedUserId) {
  if (!exactKeys(status, STATUS_KEYS)) throw new Error('err.dailyResponse')
  if (status.user_id !== expectedUserId) throw new Error('err.dailyAccountChanged')
  if (!isCalendarDay(status.day) || !timestamp(status.server_now) || !timestamp(status.reset_at)
      || spinDay(Date.parse(status.server_now)) !== status.day
      || status.timezone !== 'Asia/Ho_Chi_Minh' || !exactKeys(status.login, LOGIN_KEYS)) {
    throw new Error('err.dailyResponse')
  }
  const login = status.login
  const claimedDays = login.claimed_days
  const reset = new Date(status.reset_at).getTime()
  const expectedReset = Date.parse(`${status.day}T00:00:00Z`) + DAY_MS - VN_OFFSET_MS
  if (reset !== expectedReset || typeof login.claimed !== 'boolean'
      || !Array.isArray(claimedDays) || !natural(login.total_days)
      || !natural(login.streak) || !natural(login.best_streak)
      || login.streak > login.total_days || login.best_streak > login.total_days
      || login.best_streak < login.streak
      || (login.total_days === 0 ? login.first_day !== null
        : !isCalendarDay(login.first_day) || login.first_day > status.day)
      || claimedDays.some((day, index) => !isCalendarDay(day)
        || monthOf(day) !== monthOf(status.day) || day > status.day
        || (index > 0 && claimedDays[index - 1] >= day))
      || login.total_days < claimedDays.length
      || (login.claimed !== claimedDays.includes(status.day))) {
    throw new Error('err.dailyResponse')
  }
  return status
}

export function validateDailyLoginCalendarMonth(payload, expectedUserId, expectedMonth) {
  if (!exactKeys(payload, MONTH_KEYS)) throw new Error('err.dailyResponse')
  if (payload.user_id !== expectedUserId) throw new Error('err.dailyAccountChanged')
  if (payload.month !== expectedMonth || !isCalendarMonth(payload.month)
      || !isCalendarDay(payload.day) || !Array.isArray(payload.days)) throw new Error('err.dailyResponse')
  const currentMonth = monthOf(payload.day)
  const maxDay = payload.month < currentMonth
    ? `${payload.month}-${String(monthLength(payload.month)).padStart(2, '0')}`
    : payload.month === currentMonth ? payload.day : null
  if (maxDay === null && payload.days.length) throw new Error('err.dailyResponse')
  let previous = null
  for (const day of payload.days) {
    if (!isCalendarDay(day) || monthOf(day) !== payload.month || (maxDay && day > maxDay)
        || (previous && previous >= day)) throw new Error('err.dailyResponse')
    previous = day
  }
  return payload
}

async function assertCurrentAccount(expectedUserId) {
  if (!hasSupabase) return
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data?.user || data.user.id !== expectedUserId) throw new Error('err.dailyAccountChanged')
}

async function calendarRpc(name, args) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = args === undefined
      ? await supabase.rpc(name).abortSignal(controller.signal)
      : await supabase.rpc(name, args).abortSignal(controller.signal)
    if (controller.signal.aborted) throw new Error('err.dailyTimeout')
    if (response.error) {
      if (SETUP_CODES.has(response.error.code)) throw new Error('err.dailySetup')
      throw response.error
    }
    return response.data
  } finally { clearTimeout(timeout) }
}

export async function fetchDailyLoginCalendarStatus(userId) {
  if (!userId) throw new Error('err.signin')
  const payload = hasSupabase
    ? await (async () => { await assertCurrentAccount(userId); return calendarRpc('my_daily_login_status') })()
    : makeStatus(userId, readDemo(userId))
  return validateDailyLoginCalendarStatus(payload, userId)
}

export async function claimDailyLoginCalendar(userId, expectedDay) {
  if (!userId) throw new Error('err.signin')
  if (!isCalendarDay(expectedDay)) throw new Error('err.dailyDayChanged')
  let result
  if (hasSupabase) {
    await assertCurrentAccount(userId)
    // The only client argument is the stale-day guard. The server uses auth.uid().
    result = await calendarRpc('claim_daily_login_calendar', { p_expected_day: expectedDay })
  } else {
    const before = makeStatus(userId, readDemo(userId))
    if (before.day !== expectedDay) throw new Error('err.dailyDayChanged')
    const days = readDemo(userId)
    const replayed = days.includes(before.day)
    if (!replayed) writeDemo(userId, [...days, before.day].sort())
    result = { replayed, status: makeStatus(userId, readDemo(userId)) }
  }
  if (!result || typeof result.replayed !== 'boolean') throw new Error('err.dailyResponse')
  result.status = validateDailyLoginCalendarStatus(result.status, userId)
  return result
}

export async function fetchDailyLoginCalendarMonth(userId, month) {
  if (!userId) throw new Error('err.signin')
  if (!isCalendarMonth(month)) throw new Error('err.dailyDayChanged')
  const payload = hasSupabase
    ? await (async () => {
      await assertCurrentAccount(userId)
      return calendarRpc('my_daily_checkin_month', { p_month: `${month}-01` })
    })()
    : (() => {
      const status = makeStatus(userId, readDemo(userId))
      const days = readDemo(userId).filter(day => monthOf(day) === month && day <= status.day)
      return { user_id: userId, month, day: status.day, days }
    })()
  return validateDailyLoginCalendarMonth(payload, userId, month)
}

export function announceDailyLoginCalendarChanged() {
  try { localStorage.setItem(DAILY_LOGIN_CALENDAR_SYNC_KEY, String(Date.now())) } catch { /* no storage */ }
}
