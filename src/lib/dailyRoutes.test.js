import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const app = read('../App.jsx')
const sidebar = read('../components/Sidebar.jsx')
const component = read('../components/DailyRewards.jsx')
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

test('each reward section is account-gated and never stacks with a public profile or another reward page', () => {
  for (const [section, gate] of [['login', 'needDailyLogin'], ['quiz', 'needQuiz'], ['spin', 'needSpin']]) {
    const body = sectionBody(section)
    assert.ok(body, `missing ${section} section / !onProfile guard`)
    assert.match(body, /user \? \(/)
    assert.ok(body.includes(`body={t('gate.${gate}')}`))
    if (section === 'spin') {
      assert.match(body, /<DailySpin /)
      assert.doesNotMatch(body, /<DailyRewards /)
    } else {
      assert.ok(body.includes(`kind="${section}"`))
      assert.match(body, /<DailyRewards /)
      assert.doesNotMatch(body, /<DailySpin /)
    }
  }
})

test('login and quiz render only their own controls, results and earned totals', () => {
  assert.match(component, /!isQuiz && <article/)
  assert.match(component, /isQuiz && <article/)
  assert.match(component, /isQuiz && question && !quiz\.locked && <form/)
  assert.match(component, /isQuiz && quiz\?\.locked && <div className="daily-quiz-review"/)
  // A round that cannot award votes says so instead of rendering a form.
  assert.match(component, /const unavailable = isQuiz && quiz\?\.state === 'unavailable'/)
  assert.match(component, /const retired = isQuiz && quiz\?\.state === 'retired'/)
  assert.match(component, /\{unavailable && <div className="daily-quiz-unavailable"/)
  assert.doesNotMatch(component, /legacyQuiz/)
  assert.match(component, /fetchCheckInMonth/)
  assert.match(component, /<DailyLoginCalendar status=\{status\} disabled=\{disabled\} onClaim=/)
  assert.doesNotMatch(component, /status\.earned_today|daily\.subtitle|daily\.title|daily\.earned'/)
  assert.match(component, /daily\.quizEarned/)
  // The check-in page reports its own state and never a vote amount:
  // the quiz is the only screen that may show a reward.
  assert.match(component, /daily\.checkedInToday/)
  assert.match(component, /daily\.loginNoVotes/)
  assert.doesNotMatch(component, /daily\.loginEarned|DAILY_LOGIN_REWARD/)
})
