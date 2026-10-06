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

test('/quiz đã nghỉ hưu: chuyển hướng về lịch điểm danh và không còn màn quiz nào', () => {
  /* Đường dẫn cũ chỉ được nhắc ở ĐÚNG một chỗ trong mã — bảng chuyển hướng —
     nên không thể có màn, mục menu, icon hay chunk quiz nào lọt lại. */
  assert.match(app, /const RETIRED_PATHS = \{ '\/quiz': '\/daily-login' \}/)
  assert.ok(!sections.includes("'quiz'"), 'SECTIONS không còn mục quiz')
  assert.ok(!routes.includes('quiz:'), 'ROUTES không còn đường dẫn quiz')
  assert.ok(!sidebar.includes('quiz:'), 'sidebar không còn icon quiz')
  assert.doesNotMatch(app, /DailyRewards|needQuiz|nav\.quiz/, 'không còn component/cổng/mục menu quiz')

  /* 301 ở tầng Pages phải đứng TRƯỚC dòng SPA fallback, và fallback vẫn là
     dòng CUỐI (Cloudflare so từ trên xuống, dòng đầu tiên khớp được dùng). */
  const lines = redirects.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.ok(lines.length >= 2, 'thiếu rule chuyển hướng hoặc thiếu SPA fallback')
  assert.match(lines[lines.length - 1], /^\/\*\s+\/index\.html\s+200$/, 'SPA fallback phải là dòng cuối')
  assert.match(lines[0], /^\/quiz\s+\/daily-login\s+301$/, 'đường dẫn cũ phải được 301 trước fallback')

  /* Sitemap không còn quảng cáo đường dẫn đã nghỉ hưu. */
  assert.doesNotMatch(sitemap, /\/quiz/, 'sitemap không còn /quiz')
})
