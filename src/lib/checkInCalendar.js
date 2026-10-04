/* Calendar dates come from the reward server's Vietnam day, not the device's
   timezone/clock. Rendering a day never authorizes a historical reward, and
   browsing another month only reads the ledger that already exists. */
export function isCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

export function isCalendarMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false
  return isCalendarDay(`${value}-01`)
}

const DAY = 86_400_000
const shift = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY).toISOString().slice(0, 10)
const dayAfter = day => shift(day, 1)
const dayBefore = day => shift(day, -1)

const monthFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export function monthOf(day) { return day.slice(0, 7) }
export function shiftMonth(month, delta) {
  const first = new Date(`${month}-01T00:00:00Z`)
  first.setUTCMonth(first.getUTCMonth() + delta)
  return first.toISOString().slice(0, 7)
}
export function monthLength(month) {
  const first = new Date(`${month}-01T00:00:00Z`)
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  return last.getUTCDate()
}

/* Read-only statistics over real check-in dates. A streak is only a counter:
   it never grants a reward, and missing a day simply restarts it. */
export function checkInStats(days, today) {
  const sorted = [...new Set((Array.isArray(days) ? days : []).filter(day => isCalendarDay(day)
    && (!isCalendarDay(today) || day <= today)))].sort()
  let best = 0, run = 0, previous = null
  for (const day of sorted) {
    run = previous && dayAfter(previous) === day ? run + 1 : 1
    previous = day
    if (run > best) best = run
  }
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    streak++
    if (i === 0 || sorted[i - 1] !== dayBefore(sorted[i])) break
  }
  const last = sorted.at(-1) || null
  // The streak survives the rest of today, so checking in late does not break it.
  if (!last || (isCalendarDay(today) && last !== today && last !== dayBefore(today))) streak = 0
  return { total: sorted.length, first: sorted[0] || null, last, streak, best, days: sorted }
}

// Visual milestones only: a check-in records the day, never a reward.
export const CHECK_IN_MILESTONES = [5, 10, 20]

export function buildCheckInCalendar(status, options = {}) {
  if (!isCalendarDay(status?.day)) return null
  const today = status.day
  const month = isCalendarMonth(options.month) ? options.month : today.slice(0, 7)
  const currentMonth = month === today.slice(0, 7)
  const historyAvailable = options.available ?? Array.isArray(status.login?.claimed_days)
  const claimed = new Set(options.days ?? (historyAvailable ? status.login.claimed_days : []))
  // Old deployments still know today's claim. Do not invent "missed" past
  // days or a monthly total when the history migration is not installed yet.
  if (currentMonth && status.login?.claimed) claimed.add(today)
  const daysInMonth = monthLength(month)
  const first = new Date(`${month}-01T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7 // Monday first
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => {
    const number = index - offset + 1
    if (number < 1 || number > daysInMonth) return null
    const day = `${month}-${String(number).padStart(2, '0')}`
    const isToday = day === today
    const state = day > today ? 'upcoming' : claimed.has(day) ? 'checked'
      : isToday ? 'today' : historyAvailable ? 'missed' : 'unknown'
    return { day, number, isToday, state, label: dateFormat.format(new Date(`${day}T00:00:00Z`)) }
  })
  const checkedCount = historyAvailable
    ? [...claimed].filter(day => day.startsWith(`${month}-`) && day <= today).length : null
  return { month, currentMonth, monthLabel: monthFormat.format(first), cells, daysInMonth, historyAvailable,
    checkedCount, firstDay: `${month}-01`, lastDay: `${month}-${String(daysInMonth).padStart(2, '0')}` }
}
