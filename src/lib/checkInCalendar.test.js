import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCheckInCalendar, isCalendarDay, checkInStats, shiftMonth, monthLength, isCalendarMonth } from './checkInCalendar.js'

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
