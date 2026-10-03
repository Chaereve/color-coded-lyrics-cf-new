import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCheckInCalendar, isCalendarDay, checkInStats, shiftMonth, monthLength, isCalendarMonth } from './checkInCalendar.js'
import { demoDailyRewards } from './dailyRewardsDemo.js'
import { validateDailyRewardsStatus, validateCheckInMonth, isLegacyDailyQuiz } from './dailyRewards.js'

const status = (day, claimed_days = [], claimed = claimed_days.includes(day)) => ({ day, login: { claimed_days, claimed } })

test('monthly calendar is Monday-first with correct dates and leading/trailing blanks', () => {
  const cal = buildCheckInCalendar(status('2026-10-03', ['2026-10-01']))
  assert.equal(cal.monthLabel, 'October 2026')
  assert.equal(cal.daysInMonth, 31)
  assert.equal(cal.cells.length, 35)
  assert.deepEqual(cal.cells.slice(0, 3), [null, null, null])
  assert.equal(cal.cells[3].day, '2026-10-01')
  assert.equal(cal.cells[5].day, '2026-10-03')
  assert.equal(cal.cells[33].day, '2026-10-31')
  assert.equal(cal.cells[34], null)
  assert.equal(cal.checkedCount, 1)
  assert.equal(cal.cells[3].state, 'checked')
  assert.equal(cal.cells[4].state, 'missed')
  assert.equal(cal.cells[5].state, 'today')
  assert.equal(cal.cells[6].state, 'upcoming')
  assert.match(cal.cells[5].label, /Saturday, October 3, 2026/)
})

test('leap years, year boundaries, Sunday starts and six-row months render correctly', () => {
  for (const [day, count, rows, firstColumn] of [
    ['2024-02-29', 29, 5, 3], ['2025-02-28', 28, 5, 5], ['2026-11-01', 30, 6, 6],
    ['2026-06-01', 30, 5, 0], ['2027-01-01', 31, 5, 4],
  ]) {
    const cal = buildCheckInCalendar(status(day))
    assert.equal(cal.daysInMonth, count, day)
    assert.equal(cal.cells.length / 7, rows, day)
    assert.equal(cal.cells.findIndex(Boolean), firstColumn, day)
    assert.equal(cal.cells.filter(Boolean).length, count, day)
    assert.equal(cal.cells.filter(c => c?.isToday).length, 1)
  }
  assert.equal(isCalendarDay('2024-02-29'), true)
  for (const day of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-10-00', '2026-1-03', null, 20261003]) {
    assert.equal(isCalendarDay(day), false)
    assert.equal(buildCheckInCalendar(status(day)), null)
  }
})

test('old status does not invent past history or a monthly total; today still works', () => {
  const cal = buildCheckInCalendar({ day: '2026-10-03', login: { claimed: true } })
  assert.equal(cal.historyAvailable, false)
  assert.equal(cal.checkedCount, null)
  assert.equal(cal.cells[3].state, 'unknown')
  assert.equal(cal.cells[4].state, 'unknown')
  assert.equal(cal.cells[5].state, 'checked')
  assert.equal(cal.cells[5].isToday, true)
  assert.equal(cal.cells[6].state, 'upcoming')
})

test('demo calendar history is current-month, sorted, distinct and derived from real claims', () => {
  const now = Date.parse('2026-10-03T16:59:59Z')
  const initial = { userId: 'calendar-user', profile: { vote_credits: 7, bonus_credits: 4 }, now,
    entries: { logins: [{ day: '2026-09-30' }, { day: '2026-10-02' }, { day: '2026-10-01' }, { day: '2026-10-02' }, { day: '2026-10-04' }], quizzes: [] } }
  const before = demoDailyRewards(initial)
  assert.deepEqual(before.data.status.login.claimed_days, ['2026-10-01', '2026-10-02'])
  const claim = demoDailyRewards({ ...initial, action: 'claim', expectedDay: '2026-10-03' })
  assert.deepEqual(claim.data.status.login.claimed_days, ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.equal(claim.profile.bonus_credits, 4, 'a check-in records the day, never a vote')
  validateDailyRewardsStatus(claim.data.status, initial.userId)
  const midnight = demoDailyRewards({ ...initial, entries: claim.entries, profile: claim.profile, now: now + 2000 })
  assert.equal(midnight.data.status.day, '2026-10-04')
  const newMonth = demoDailyRewards({ ...initial, entries: claim.entries, profile: claim.profile, now: Date.parse('2026-10-31T17:00:00Z') })
  assert.equal(newMonth.data.status.day, '2026-11-01')
  assert.deepEqual(newMonth.data.status.login.claimed_days, [])
  assert.equal(buildCheckInCalendar(newMonth.data.status).monthLabel, 'November 2026')
  assert.equal(newMonth.profile.bonus_credits, 4, 'a month boundary does not reset or award wallet credits')
  const other = demoDailyRewards({ userId: 'other-user', profile: { vote_credits: 0, bonus_credits: 0 }, now })
  assert.deepEqual(other.data.status.login.claimed_days, [])
})

test('malformed, future, duplicate or foreign-month history is rejected, while old servers remain compatible', () => {
  const original = demoDailyRewards({ userId: 'u', profile: { vote_credits: 7, bonus_credits: 4 }, now: Date.parse('2026-10-03T10:00:00Z') }).data.status
  for (const days of [null, {}, [null], ['2026-09-30'], ['2026-10-04'], ['2026-10-02', '2026-10-01'], ['2026-10-01', '2026-10-01'], ['2026-10-03'], ['2026-02-30']]) {
    assert.throws(() => validateDailyRewardsStatus({ ...original, login: { ...original.login, claimed_days: days } }, 'u'), /err.dailyResponse/)
  }
  assert.throws(() => validateDailyRewardsStatus({ ...original, login: { claimed: true, reward: 2, claimed_days: [] } }, 'u'), /err.dailyResponse/)
  for (const day of ['2026-02-30', '2025-02-29']) assert.throws(() => validateDailyRewardsStatus({ ...original, day }, 'u'), /err.dailyResponse/)
  // A server that still promises a +2 check-in reward is refused outright —
  // free votes on top of the quiz cap must never render.
  assert.throws(() => validateDailyRewardsStatus({ ...original, login: { claimed: false, reward: 2 } }, 'u'),
    /err.dailyResponse/)
  // A payload that carries no check-in amount at all stays compatible.
  const old = { ...original, login: { claimed: false } }
  assert.equal(validateDailyRewardsStatus(old, 'u'), old)
})

test('demo rounds are easy K-pop questions with categories, without exposing answer keys', () => {
  const seen = new Map()
  for (let i = 1; i <= 96; i++) {
    let seed = i
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const result = demoDailyRewards({ userId: 'u', profile: { vote_credits: 7, bonus_credits: 4 },
      now: Date.parse('2026-10-03T10:00:00Z'), action: 'start', expectedDay: '2026-10-03', random })
    for (const q of result.entries.quizzes[0].questions) {
      assert.match(q.id, /^demo-kpop-/)
      assert.match(q.prompt, /K-pop|BTS|BLACKPINK|TWICE|NewJeans|Stray Kids|SEVENTEEN|ITZY|aespa|IVE|FIFTY FIFTY|PSY|Red Velvet|EXO|ATEEZ/)
      assert.match(q.category, /^(?:Lyrics|Songs|Groups|Members|Fandom)$/)
      assert.equal(q.options.length, 4)
      assert.equal(new Set(q.options).size, 4)
      assert.ok(q.options[q.correct_option])
      seen.set(q.id, q)
    }
    for (const q of result.data.status.quiz.questions) {
      assert.equal('correct_option' in q, false)
      assert.equal('explanation' in q, false)
    }
  }
  assert.equal(seen.size, 36)
  assert.equal(seen.get('demo-kpop-butter').options[seen.get('demo-kpop-butter').correct_option], 'BTS')
  assert.equal(seen.get('demo-kpop-leader-bts').options[seen.get('demo-kpop-leader-bts').correct_option], 'RM')
  assert.equal(seen.get('demo-kpop-carat').options[seen.get('demo-kpop-carat').correct_option], 'CARAT')
  assert.equal(seen.get('demo-kpop-seven').options[seen.get('demo-kpop-seven').correct_option], 'Jungkook')
  assert.equal(seen.get('demo-kpop-on-the-ground').options[seen.get('demo-kpop-on-the-ground').correct_option], 'Rosé')
})

test('changing the demo question bank does not replace an existing frozen round or award again', () => {
  const legacy = { attempt_id: 'old-round', day: '2026-10-03', completed: false, answers: null, score: null, reward: null,
    questions: Array.from({ length: 3 }, (_, i) => ({ id: `old-${i}`, prompt: `Frozen question ${i}`, options: ['A', 'B', 'C', 'D'], correct_option: i, explanation: 'Frozen explanation' })) }
  const result = demoDailyRewards({ userId: 'u', profile: { vote_credits: 7, bonus_credits: 4 },
    entries: { logins: [], quizzes: [legacy] }, now: Date.parse('2026-10-03T10:00:00Z'), action: 'start', expectedDay: '2026-10-03' })
  assert.equal(result.data.replayed, true)
  assert.deepEqual(result.entries.quizzes[0], legacy)
  assert.equal(result.profile.bonus_credits, 4)
})

test('old bank snapshots are identified without treating new or custom K-pop questions as legacy', () => {
  assert.equal(isLegacyDailyQuiz(null), false)
  for (const id of ['demo-lyrics','music-bpm','kpop-dynamite']) assert.equal(isLegacyDailyQuiz({ questions: [{ id }] }), true)
  for (const id of ['demo-kpop-butter','kpop-easy-dynamite','custom-kpop-question']) assert.equal(isLegacyDailyQuiz({ questions: [{ id }] }), false)
})

test('check-in statistics count real consecutive days and never invent a streak', () => {
  assert.deepEqual(checkInStats([], '2026-10-03'), { total: 0, first: null, last: null, streak: 0, best: 0, days: [] })
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-03']
  assert.deepEqual(checkInStats(days, '2026-10-03').streak, 2)
  assert.equal(checkInStats(days, '2026-10-03').best, 3)
  assert.equal(checkInStats(days, '2026-10-03').total, 5)
  assert.equal(checkInStats(days, '2026-10-03').first, '2026-09-28')
  // A streak survives the rest of today, then starts again from zero.
  assert.equal(checkInStats(['2026-10-02'], '2026-10-03').streak, 1)
  assert.equal(checkInStats(['2026-10-01'], '2026-10-03').streak, 0)
  assert.equal(checkInStats(['2026-10-03', '2026-10-03'], '2026-10-03').total, 1)
  assert.deepEqual(checkInStats(['2026-10-09', 'garbage', '2026-02-30'], '2026-10-03').days, [])
  assert.equal(checkInStats(['2026-10-09'], '2026-10-03').total, 0, 'future days cannot build a streak')
})

test('month navigation walks real months and cannot scroll past the ledger or into the future', () => {
  assert.equal(shiftMonth('2026-10', -1), '2026-09')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(monthLength('2024-02'), 29)
  assert.equal(monthLength('2026-02'), 28)
  assert.equal(monthLength('2026-10'), 31)
  assert.equal(isCalendarMonth('2026-10'), true)
  for (const month of ['2026-13', '2026-00', '2026-1', null, '2026-10-01']) assert.equal(isCalendarMonth(month), false)

  const today = { day: '2026-10-03', login: { claimed: true, claimed_days: ['2026-10-01', '2026-10-03'] } }
  const past = buildCheckInCalendar(today, { month: '2026-09', days: ['2026-09-01', '2026-09-30'], available: true })
  assert.equal(past.monthLabel, 'September 2026')
  assert.equal(past.currentMonth, false)
  assert.equal(past.checkedCount, 2)
  assert.equal(past.cells.filter(c => c?.state === 'checked').length, 2)
  assert.equal(past.cells.filter(c => c?.isToday).length, 0, 'a past month has no actionable today cell')
  assert.equal(past.cells.find(c => c?.day === '2026-09-01').state, 'checked')
  assert.equal(past.cells.find(c => c?.day === '2026-09-02').state, 'missed')
  assert.equal(buildCheckInCalendar(today, { month: '2026-09', available: false }).historyAvailable, false)
  const future = buildCheckInCalendar(today, { month: '2026-11', days: [], available: true })
  assert.equal(future.checkedCount, 0)
  assert.ok(future.cells.filter(Boolean).every(c => c.state === 'upcoming'))
  assert.equal(buildCheckInCalendar(today, { month: 'nonsense' }).month, '2026-10')
})

test('month history payloads are owner-scoped, sorted and never contain future days', () => {
  const ok = validateCheckInMonth({ user_id: 'u', month: '2026-09', day: '2026-10-03', days: ['2026-09-01', '2026-09-30'] }, 'u')
  assert.deepEqual(ok.days, ['2026-09-01', '2026-09-30'])
  assert.deepEqual(validateCheckInMonth({ user_id: 'u', month: '2026-11', day: '2026-10-03', days: [] }, 'u').days, [])
  for (const payload of [null, { user_id: 'other', month: '2026-09', day: '2026-10-03', days: [] },
    { user_id: 'u', month: '2026-9', day: '2026-10-03', days: [] },
    { user_id: 'u', month: '2026-09', day: '2026-10-03', days: ['2026-10-01'] },
    { user_id: 'u', month: '2026-10', day: '2026-10-03', days: ['2026-10-05'] },
    { user_id: 'u', month: '2026-09', day: '2026-10-03', days: ['2026-09-30', '2026-09-01'] },
    { user_id: 'u', month: '2026-09', day: '2026-10-03', days: ['2026-09-01', '2026-09-01'] },
    { user_id: 'u', month: '2026-09', day: '2026-10-03', days: ['2026-09-32'] },
    { user_id: 'u', month: '2026-09', day: 'oops', days: [] }]) {
    assert.throws(() => validateCheckInMonth(payload, 'u'), /err\./)
  }
})

test('demo month browsing is read-only, owner-scoped and returns only real past check-ins', () => {
  const base = { userId: 'u', profile: { vote_credits: 7, bonus_credits: 4 }, now: Date.parse('2026-10-03T10:00:00Z'),
    entries: { logins: [{ day: '2026-08-30' }, { day: '2026-09-02' }, { day: '2026-09-20' }, { day: '2026-10-01' }], quizzes: [] } }
  const august = demoDailyRewards({ ...base, action: 'month', month: '2026-08' })
  assert.deepEqual(august.data, { user_id: 'u', month: '2026-08', day: '2026-10-03', days: ['2026-08-30'] })
  assert.deepEqual(demoDailyRewards({ ...base, action: 'month', month: '2026-09' }).data.days, ['2026-09-02', '2026-09-20'])
  assert.deepEqual(demoDailyRewards({ ...base, action: 'month', month: '2026-10' }).data.days, ['2026-10-01'])
  assert.deepEqual(demoDailyRewards({ ...base, action: 'month', month: '2026-11' }).data.days, [])
  assert.equal(august.profile.bonus_credits, 4, 'browsing a month never awards or resets a wallet')
  assert.deepEqual(august.entries, base.entries)
  assert.throws(() => demoDailyRewards({ ...base, action: 'month', month: '2026-13' }), /err.dailyResponse/)
  const stats = demoDailyRewards(base).data.status.login
  assert.deepEqual([stats.total_days, stats.streak, stats.best_streak, stats.first_day], [4, 0, 1, '2026-08-30'])
})

test('new rounds avoid questions the player has already answered recently', () => {
  const start = (entries, now) => demoDailyRewards({ userId: 'u', profile: { vote_credits: 7, bonus_credits: 4 },
    entries, now, action: 'start', expectedDay: spinDayOf(now) }).entries.quizzes.at(-1)
  const day = '2026-10-03', later = '2026-10-04'
  const first = start({ logins: [], quizzes: [] }, Date.parse(`${day}T10:00:00Z`))
  const ids = first.questions.map(q => q.id)
  const second = start({ logins: [], quizzes: [first] }, Date.parse(`${later}T10:00:00Z`))
  assert.equal(second.questions.some(q => ids.includes(q.id)), false, 'a fresh day reuses nothing while unseen questions remain')
  const many = []
  let entries = { logins: [], quizzes: [] }
  for (let i = 0; i < 12; i++) {
    const when = Date.parse(`2026-10-${String(3 + i).padStart(2, '0')}T10:00:00Z`)
    const round = start(entries, when)
    assert.equal(round.questions.length, 5)
    many.push(...round.questions.map(q => q.id))
    entries = { logins: [], quizzes: [...entries.quizzes, round] }
    if (i === 6) assert.equal(new Set(many).size, 35, 'seven days give 35 different questions, with no repeat')
  }
  assert.equal(new Set(many).size, 36, 'repeats only happen after every question has been seen')
})

function spinDayOf(now) {
  return new Date(now + 7 * 3600_000).toISOString().slice(0, 10)
}
