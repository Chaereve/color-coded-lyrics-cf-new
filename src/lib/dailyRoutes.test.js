import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../App.jsx')
const sidebar = read('../components/Sidebar.jsx')
const login = read('../components/DailyLogin.jsx')
const quiz = read('../components/DailyRewards.jsx')
const calendarApi = read('./dailyLoginCalendar.js')
const routes = app.match(/const ROUTES = \{([^}]*)\}/)?.[1] || ''
const sections = app.match(/const SECTIONS = \[([^\]]*)\]/)?.[1] || ''
const sectionBody = name => app.split(`{section === '${name}' && !onProfile && (`)[1]?.split('\n        )}')[0] || ''

test('login, quiz and spin each have a distinct sidebar entry, icon and direct route', () => {
  for (const [section, path, icon] of [['login', '/daily-login', 'calendar'], ['quiz', '/quiz', 'quiz'], ['spin', '/daily-spin', 'spin']]) {
    assert.ok(sections.includes(`'${section}'`))
    assert.ok(routes.includes(`${section}: '${path}'`))
    assert.ok(sidebar.includes(`${section}: '${icon}'`))
  }
  assert.match(app, /setSection\(sectionOf\(window\.location\.pathname\)\)/, 'Back/Forward uses the same route table')
})

test('each reward section is account-gated and uses a dedicated component', () => {
  for (const [section, gate] of [['login', 'needDailyLogin'], ['quiz', 'needQuiz'], ['spin', 'needSpin']]) {
    const body = sectionBody(section)
    assert.ok(body, `missing ${section} section / !onProfile guard`)
    assert.match(body, /user \? \(/)
    assert.ok(body.includes(`body={t('gate.${gate}')}`))
    if (section === 'login') {
      assert.match(body, /<DailyLogin /)
      assert.doesNotMatch(body, /<DailyRewards |<DailySpin /)
    } else if (section === 'quiz') {
      assert.match(body, /<DailyRewards /)
      assert.doesNotMatch(body, /<DailyLogin |<DailySpin /)
    } else {
      assert.match(body, /<DailySpin /)
      assert.doesNotMatch(body, /<DailyRewards |<DailyLogin /)
    }
  }
})

test('Calendar API is auth.uid-scoped, stale-day-only, and independent from quiz APIs', () => {
  assert.match(app, /const DailyLogin = lazy\(\(\) => import\('\.\/components\/DailyLogin'\)\)/)
  assert.match(login, /fetchDailyLoginCalendarStatus\(userId\)/)
  assert.match(login, /claimDailyLoginCalendar\(userId, status\.day\)/)
  assert.match(calendarApi, /calendarRpc\('my_daily_login_status'\)/)
  assert.match(calendarApi, /calendarRpc\('claim_daily_login_calendar', \{ p_expected_day: expectedDay \}\)/)
  assert.match(calendarApi, /calendarRpc\('my_daily_checkin_month', \{ p_month:/)
  assert.doesNotMatch(calendarApi, /p_expected_user_id|my_daily_rewards_status|daily_rewards_payload|start_daily_quiz|submit_daily_quiz_answer/)
  assert.doesNotMatch(login, /fetchDailyRewardsStatus|claimDailyLogin\(|startDailyQuiz|submitDailyQuizAnswer/)
  assert.match(calendarApi, /validateDailyLoginCalendarStatus/)
  assert.match(calendarApi, /validateDailyLoginCalendarMonth/)
  assert.doesNotMatch(calendarApi, /'quiz'|quiz\?|votes_awarded|earned_today|credits|purchased|bonus/)
})

test('quiz screen retains its controls and is not coupled to the new Calendar controller', () => {
  assert.match(quiz, /startDailyQuiz/)
  assert.match(quiz, /submitDailyQuizAnswer/)
  assert.match(quiz, /question && !quiz\.locked && <form/)
  assert.match(quiz, /quiz\?\.locked && <div className="daily-quiz-review"/)
  assert.match(quiz, /const unavailable = quiz\?\.state === 'unavailable'/)
  assert.match(quiz, /const retired = quiz\?\.state === 'retired'/)
  assert.match(quiz, /\{unavailable && <div className="daily-quiz-unavailable"/)
  assert.doesNotMatch(quiz, /DailyLoginCalendar|fetchCheckInMonth|claimDailyLogin\(|my_daily_login_status/)
  assert.doesNotMatch(login, /daily-quiz|quiz\?/)
})
