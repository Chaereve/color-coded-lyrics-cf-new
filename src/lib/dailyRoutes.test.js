import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../App.jsx')
const sidebar = read('../components/Sidebar.jsx')
const login = read('../components/DailyLogin.jsx')
const calendarApi = read('./dailyLoginCalendar.js')
const redirects = read('../../public/_redirects')
const sitemap = read('../../public/sitemap.xml')
const routes = app.match(/const ROUTES = \{([^}]*)\}/)?.[1] || ''
const sections = app.match(/const SECTIONS = \[([^\]]*)\]/)?.[1] || ''
const sectionBody = name => app.split(`{section === '${name}' && !onProfile && (`)[1]?.split('\n        )}')[0] || ''

test('login and spin each have a distinct sidebar entry, icon and direct route', () => {
  for (const [section, path, icon] of [['login', '/daily-login', 'calendar'], ['spin', '/daily-spin', 'spin']]) {
    assert.ok(sections.includes(`'${section}'`))
    assert.ok(routes.includes(`${section}: '${path}'`))
    assert.ok(sidebar.includes(`${section}: '${icon}'`))
  }
  assert.match(app, /setSection\(sectionOf\(window\.location\.pathname\)\)/, 'Back/Forward uses the same route table')
})

test('each remaining daily section is account-gated and uses its own component', () => {
  for (const [section, gate, own, foreign] of [
    ['login', 'needDailyLogin', '<DailyLogin ', '<DailySpin '],
    ['spin', 'needSpin', '<DailySpin ', '<DailyLogin '],
  ]) {
    const body = sectionBody(section)
    assert.ok(body, `missing ${section} section / !onProfile guard`)
    assert.match(body, /user \? \(/)
    assert.ok(body.includes(`body={t('gate.${gate}')}`))
    assert.ok(body.includes(own), `${section} phải dựng ${own.trim()}`)
    assert.ok(!body.includes(foreign), `${section} không được dựng ${foreign.trim()}`)
  }
})

test('Calendar API is auth.uid-scoped, stale-day-only, and free of the retired reward APIs', () => {
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

test('slug routes phản ánh map đã duyệt; quiz không có route hoặc alias', () => {
  assert.match(routes, /mystery: '\/daily-box'/)
  assert.match(routes, /ranking: '\/leaderboard'/)
  assert.match(routes, /login: '\/daily-login'/)
  assert.match(routes, /spin: '\/daily-spin'/)
  assert.match(routes, /mine: '\/profile'/)
  assert.doesNotMatch(routes, /quiz|mystery-box|\/ranking'/)
  assert.ok(!sections.includes("'quiz'"), 'SECTIONS không còn mục quiz')
  assert.ok(!sidebar.includes('quiz:'), 'sidebar không còn icon quiz')
  assert.doesNotMatch(app, /RETIRED_PATHS|DailyRewards|needQuiz|nav\.quiz/)

  const lines = redirects.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.deepEqual(lines, [
    '/mystery-box  /daily-box   301',
    '/ranking      /leaderboard 301',
    '/*            /index.html  200',
  ])
  assert.doesNotMatch(redirects, /^\/quiz(?:\s|$)/mi, 'không tạo redirect cho /quiz')
  assert.match(sitemap, /<loc>https:\/\/chaereve\.pages\.dev\/daily-box<\/loc>/)
  assert.match(sitemap, /<loc>https:\/\/chaereve\.pages\.dev\/leaderboard<\/loc>/)
  assert.doesNotMatch(sitemap, /\/(mystery-box|ranking|quiz)(<|\s)/)
})
