/* Actual React client tests: independent login, quiz and spin screens share
   one wallet, while drafts/replay survive navigation and reload. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createElement, act, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('separate daily login, quiz and spin screens preserve rewards and drafts', { timeout: 30_000 }, async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://daily.example.test/', pretendToBeVisual: true })
  const { window } = dom
  const previous = new Map()
  const globals = { window, document: window.document, localStorage: window.localStorage, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, MouseEvent: window.MouseEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const container = window.document.getElementById('root')
  const server = await createServer({ root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-daily-rewards-ui-test', envPrefix: 'CCL_DAILY_UI_TEST_', plugins: [react()],
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  })
  let app, liveServer, liveClient
  const { default: DailyRewards } = await server.ssrLoadModule('/src/components/DailyRewards.jsx')
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const { default: DailySpin } = await server.ssrLoadModule('/src/components/DailySpin.jsx')
  const db = await server.ssrLoadModule('/src/lib/db.js')
  const balances = []
  const onBalance = s => balances.push(s)
  function DemoPage({ kind, userId }) {
    const [wallet, setWallet] = useState(() => {
      const p = JSON.parse(window.localStorage.getItem('ccl3_prof'))
      return { purchased: p.vote_credits, bonus: p.bonus_credits, credits: p.vote_credits + p.bonus_credits }
    })
    const apply = useCallback(s => {
      onBalance(s)
      setWallet(prev => prev.credits === s.credits && prev.purchased === s.purchased && prev.bonus === s.bonus
        ? prev : { credits: s.credits, purchased: s.purchased, bonus: s.bonus })
    }, [])
    return kind === 'spin'
      ? createElement(DailySpin, { key: `${kind}-${userId}`, userId, ...wallet, onBalance: apply, onVote() {} })
      : createElement(DailyRewards, { key: `${kind}-${userId}`, kind, userId, onBalance: apply })
  }
  const query = selector => container.querySelector(selector)
  const waitFor = async check => {
    const until = Date.now() + 4000
    while (!check() && Date.now() < until) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    assert.ok(check(), `UI did not settle: ${container.textContent}`)
  }
  const click = async node => { assert.ok(node); await act(async () => { node.click() }) }
  const render = async (kind = 'login', userId = 'demo-user', Component = DemoPage, Provider = I18nProvider) => {
    await act(async () => { app.render(createElement(Provider, null, createElement(Component, { key: userId, kind, userId, onBalance }))) })
  }
  const mount = async (...args) => { app = createRoot(container); await render(...args) }
  const unmount = async () => { if (app) await act(async () => { app.unmount(); app = null }) }
  const ledger = () => JSON.parse(window.localStorage.getItem('ccl.daily.rewards.demo.v1.demo-user'))
  try {
    window.localStorage.setItem('ccl3_user', JSON.stringify({ id: 'demo-user', name: 'Demo' }))
    window.localStorage.setItem('ccl3_prof', JSON.stringify({ vote_credits: 7, bonus_credits: 4 }))
    await mount('login')
    await waitFor(() => query('.daily-claim') && !query('.daily-claim').disabled)

    await t.test('daily login shows only the check-in calendar and never credits the vote wallet', async () => {
      assert.ok(query('.daily-login-page'))
      assert.equal(query('.daily-quiz-start'), null)
      assert.equal(query('.daily-quiz'), null)
      assert.equal(query('.daily-spin'), null)
      assert.equal(balances.at(-1).bonus, 4)
      assert.equal(container.querySelectorAll('.check-in-calendar-grid th').length, 7)
      assert.equal(query('.check-in-calendar-grid th').textContent, 'Mon')
      assert.equal(container.querySelectorAll('.check-in-day.is-today').length, 1)
      assert.equal(container.querySelectorAll('.check-in-calendar-grid button').length, 1,
        'only today is actionable in the calendar grid')
      assert.equal(query('.check-in-day.is-today').getAttribute('aria-current'), 'date')
      assert.match(query('.check-in-day.is-today').getAttribute('aria-label'), /check in today/)
      assert.doesNotMatch(query('.check-in-day.is-today').getAttribute('aria-label'), /\+|vote|reward/i)
      assert.match(query('.check-in-calendar-head > span').textContent, /0 check-ins/)
      assert.equal(query('.check-in-calendar-unavailable'), null)
      assert.equal(container.querySelectorAll('.check-in-stat').length, 4)
      assert.deepEqual([...container.querySelectorAll('.check-in-stat b')].map(n => n.textContent), ['0/31', '0', '0', '0'])
      assert.equal(container.querySelectorAll('.check-in-progress b.is-reached').length, 0)
      // Nothing was claimed before today, so there is no earlier month to browse.
      assert.equal(container.querySelectorAll('.check-in-nav')[0].disabled, true)
      assert.equal(container.querySelectorAll('.check-in-nav')[1].disabled, true)
      const button = query('.check-in-day.is-today')
      await act(async () => { button.click(); query('.daily-claim').click() })
      await waitFor(() => /Checked in today/.test(query('.daily-claim').textContent))
      assert.equal(query('.daily-claim').disabled, true)
      assert.equal(balances.at(-1).bonus, 4, 'a check-in awards no votes at all')
      assert.equal(balances.at(-1).purchased, 7)
      assert.equal(ledger().logins.length, 1)
      assert.equal(query('.check-in-day.is-today').disabled, true)
      assert.ok(query('.check-in-day.is-today').classList.contains('is-checked'))
      assert.equal(container.querySelectorAll('.check-in-day.is-checked').length, 1)
      assert.match(query('.check-in-calendar-head > span').textContent, /^1 check-in this month$/)
      assert.doesNotMatch(query('.check-in-calendar').textContent, /\+\s*\d|bonus votes|reward/i,
        'the calendar never promises a vote, a point or a reward')
      assert.deepEqual([...container.querySelectorAll('.check-in-stat b')].map(n => n.textContent), ['1/31', '1', '1', '1'])
      assert.ok(query('.check-in-calendar').classList.contains('is-celebrating'))
      assert.match(query('.daily-notice').textContent, /Checked in for today/)
      assert.doesNotMatch(query('.daily-notice').textContent, /\+\s*\d|bonus votes/i)
      assert.match(query('.daily-rewards-foot').textContent, /Checked in today/)
      assert.match(query('.daily-rewards-foot').textContent, /Check-ins never award votes/)
      assert.doesNotMatch(query('.daily-login-page').textContent, /\+2|bonus votes/i,
        'no screen of the check-in flow may imply a vote reward')
    })

    let quiz
    const currentQuestion = () => {
      const match = /Question (\d+) of/.exec(query('.daily-quiz-progress').textContent)
      return quiz.questions[Number(match[1]) - 1]
    }
    // The option the player clicks is chosen by stable id, never by position.
    // A submitted answer stays on screen with its verdict; the player has to
    // press on to the next question.
    const pick = async (correct = true) => {
      const q = currentQuestion()
      const optionId = correct ? q.correct_option_id : q.option_ids.find(id => id !== q.correct_option_id)
      await click(query(`.daily-quiz-options input[value="${optionId}"]`))
      await click(query('.daily-quiz-actions .btn-primary'))
      await waitFor(() => query('.daily-quiz-verdict') || query('.daily-quiz-review'))
      return q
    }
    const next = async () => {
      if (query('.daily-quiz-review')) return
      const before = query('.daily-quiz-progress').textContent
      await click(query('.daily-quiz-actions .btn-primary'))
      await waitFor(() => query('.daily-quiz-review')
        || query('.daily-quiz-progress').textContent !== before)
    }

    await t.test('music quiz is an independent screen without login or spin controls', async () => {
      await render('quiz')
      await waitFor(() => query('.daily-quiz-start') && !query('.daily-quiz-start').disabled)
      assert.ok(query('.music-quiz-page'))
      assert.equal(query('.check-in-calendar'), null)
      assert.equal(query('.daily-quiz-level').textContent, 'Easy')
      assert.match(container.textContent, /K-pop quiz/)
      assert.equal(query('.daily-claim'), null)
      assert.equal(query('.daily-login-page'), null)
      assert.equal(query('.daily-spin'), null)
      assert.match(query('.daily-rewards-foot').textContent, /Today’s quiz: \+0/)
      await click(query('.daily-quiz-start'))
      await waitFor(() => query('.daily-quiz'))
      quiz = ledger().quizzes[0]
      assert.equal(quiz.questions.length, 5)
      assert.ok(quiz.questions.every(q => q.id.startsWith('demo-kpop-')))
      assert.ok(quiz.questions.every(q => /K-pop|BTS|BLACKPINK|TWICE|NewJeans|Stray Kids|SEVENTEEN|ITZY|aespa|IVE|FIFTY FIFTY|PSY|Red Velvet|EXO|ATEEZ/.test(q.prompt)))
      assert.ok(quiz.questions.every(q => /^(?:Lyrics|Songs|Groups|Members|Fandom)$/.test(q.category)))
      assert.equal(container.querySelectorAll('.daily-quiz-options input').length, 4)
      assert.equal(container.querySelectorAll('.daily-quiz-step').length, 5)
      assert.equal(container.querySelectorAll('.daily-quiz-key').length, 4)
      assert.match(query('.daily-quiz-progress').textContent, /Question 1 of 5/)
      assert.match(query('.daily-quiz-hint').textContent, /Pick one answer/)
      assert.match(query('.daily-quiz-votes').textContent, /Quiz votes today: 0\/5/)
      // Nothing is revealed before an answer is submitted.
      assert.equal(query('.daily-quiz-verdict'), null)
      assert.doesNotMatch(container.textContent, /Correct answer:/)
      assert.doesNotMatch(container.textContent, /opt-/)
      assert.equal(query('.daily-quiz-actions .btn-primary').disabled, true)
      // The four options are shown as a permutation of the stable ids.
      const shown = [...container.querySelectorAll('.daily-quiz-options input')].map(input => input.value)
      assert.deepEqual([...shown].sort(), ['opt-a', 'opt-b', 'opt-c', 'opt-d'])
      assert.ok(shown.includes(quiz.questions[0].correct_option_id))
      await pick(true)
      assert.match(query('.daily-quiz-verdict').textContent, /Correct!/)
      assert.match(query('.daily-quiz-votes').textContent, /Quiz votes today: 1\/5/)
      assert.match(query('.daily-quiz-hint').textContent, /Answer locked/)
    })

    await t.test('leaving quiz for login and returning or reloading keeps the same round', async () => {
      await render('login')
      await waitFor(() => query('.daily-claim')?.disabled)
      assert.equal(query('.daily-quiz'), null)
      assert.equal(query('.daily-quiz-review'), null)
      assert.ok(query('.check-in-day.is-today.is-checked'))
      assert.match(query('.daily-rewards-foot').textContent, /Checked in today/)
      await render('quiz')
      await waitFor(() => query('.daily-quiz'))
      // Question 1 is already locked in, so the round resumes on question 2.
      assert.match(query('.daily-quiz-progress').textContent, /Question 2 of 5/)
      assert.match(query('.daily-quiz-votes').textContent, /Quiz votes today: 1\/5/)
      await unmount()
      await mount('quiz')
      await waitFor(() => query('.daily-quiz'))
      assert.equal(ledger().quizzes[0].attempt_id, quiz.attempt_id)
      assert.equal(ledger().quizzes.length, 1)
      assert.match(query('.daily-quiz-progress').textContent, /Question 2 of 5/)
      // Going back to an answered question shows it locked, never editable.
      await click(container.querySelectorAll('.daily-quiz-step')[0])
      assert.equal(query('.daily-quiz-card fieldset').disabled, true)
      assert.ok(query('.daily-quiz-verdict.is-correct'))
      await click(container.querySelectorAll('.daily-quiz-step')[1])
    })

    await t.test('a wrong answer pays nothing and every answer is final', async () => {
      const before = balances.at(-1).bonus
      await pick(false)
      assert.match(query('.daily-quiz-verdict').textContent, /Not this time/)
      assert.match(query('.daily-quiz-verdict').textContent, /Correct answer:/)
      assert.match(query('.daily-quiz-votes').textContent, /Quiz votes today: 1\/5/)
      assert.equal(balances.at(-1).bonus, before, 'a wrong answer awards nothing')
      // Submitting a different option for the answered question changes nothing.
      const q = currentQuestion()
      const other = q.option_ids.find(id => id !== q.correct_option_id)
      await click(query(`.daily-quiz-options input[value="${other}"]`))
      assert.equal(query('.daily-quiz-card fieldset').disabled, true)
      assert.equal(balances.at(-1).bonus, before)
      await next()
      assert.match(query('.daily-quiz-progress').textContent, /Question 3 of 5/)
    })

    await t.test('quiz reports only its own reward and completion survives reload', async () => {
      await pick(true)  // question 3
      await next()
      await pick(true)  // question 4
      await next()
      await pick(true)  // question 5 — the round locks itself
      await waitFor(() => query('.daily-quiz-review'))
      assert.equal(query('.daily-quiz'), null)
      assert.equal(query('.daily-quiz-start'), null)
      assert.equal(query('.daily-claim'), null)
      assert.equal(query('.daily-quiz-result').dataset.score, '4')
      assert.equal(query('.daily-quiz-result b').textContent, '4/5')
      assert.equal(container.querySelectorAll('.daily-quiz-review li.is-correct').length, 4)
      assert.equal(container.querySelectorAll('.daily-quiz-review li.is-wrong').length, 1)
      assert.match(query('.daily-quiz-next').textContent, /A new K-pop quiz unlocks in/)
      assert.match(container.textContent, /4\/5 correct/)
      assert.match(container.textContent, /Today’s quiz: \+4 bonus votes/)
      assert.match(query('.daily-quiz-review').textContent, /Correct answer:/)
      assert.equal(balances.at(-1).bonus, 8, 'four correct answers on top of an untouched wallet')
      assert.equal(balances.at(-1).purchased, 7)
      await unmount()
      await mount('quiz')
      await waitFor(() => query('.daily-quiz-review'))
      assert.match(container.textContent, /4\/5 correct/)
      assert.equal(balances.at(-1).bonus, 8)
      await act(async () => { window.dispatchEvent(new window.Event('focus')) })
      assert.equal(ledger().quizzes.length, 1)
    })

    await t.test('spin remains standalone and sees bonus earned on the two other pages', async () => {
      await render('spin')
      await waitFor(() => query('.spin-bonus b'))
      assert.equal(query('.daily-rewards'), null)
      assert.equal(query('.daily-claim'), null)
      assert.equal(query('.daily-quiz-start'), null)
      assert.match(query('.spin-bonus b').textContent, /^8votes$/)
      assert.match(query('.spin-purchased b').textContent, /^7votes$/)
      await render('login')
      await waitFor(() => query('.daily-claim')?.disabled)
      assert.equal(query('.daily-quiz-review'), null)
      assert.match(query('.daily-rewards-foot').textContent, /Checked in today/)
      assert.equal(ledger().logins.length, 1)
    })

    await t.test('switching accounts cannot show or redeem the previous account’s round', async () => {
      window.localStorage.setItem('ccl3_user', JSON.stringify({ id: 'other-user' }))
      window.localStorage.setItem('ccl3_prof', JSON.stringify({ vote_credits: 0, bonus_credits: 0 }))
      await render('login', 'other-user')
      await waitFor(() => query('.daily-claim') && !query('.daily-claim').disabled)
      assert.equal(query('.daily-quiz-review'), null)
      assert.equal(query('.daily-quiz'), null)
      assert.equal(container.querySelectorAll('.check-in-day.is-checked').length, 0)
      assert.equal(balances.at(-1).user_id, 'other-user')
      await render('quiz', 'other-user')
      await waitFor(() => query('.daily-quiz-start') && !query('.daily-quiz-start').disabled)
      assert.equal(query('.daily-claim'), null)
      await assert.rejects(db.claimDailyLogin('demo-user', balances.at(-1).day), /err.dailyAccountChanged/)
      assert.equal(ledger().quizzes.length, 1)
    })

    await t.test('a round saved by an older version is shown as retired, never reopened', async () => {
      await unmount()
      const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const old = { attempt_id: 'legacy-round', day,
        questions: [
          { id: 'demo-lyrics', prompt: 'What are the words of a song called?', options: ['Tempo','Lyrics','Chords','Rhythm'], correct_option: 1, explanation: 'Song words are lyrics.' },
          { id: 'demo-piano', prompt: 'Which instrument does a pianist play?', options: ['Piano','Violin','Flute','Drums'], correct_option: 0, explanation: 'A pianist plays piano.' },
          { id: 'demo-mic', prompt: 'What does a singer use to amplify their voice?', options: ['Microphone','Pick','Metronome','Drumstick'], correct_option: 0, explanation: 'A microphone amplifies the voice.' },
        ] }
      const key = 'ccl.daily.rewards.demo.v1.other-user'
      window.localStorage.setItem(key, JSON.stringify({ logins: [], quizzes: [old] }))
      await mount('quiz', 'other-user')
      await waitFor(() => query('.daily-quiz-unavailable'))
      assert.equal(query('.daily-quiz'), null)
      assert.equal(query('.daily-quiz-start'), null)
      assert.equal(query('.daily-quiz-review'), null)
      assert.match(query('.daily-quiz-unavailable').textContent, /can no longer award bonus votes/)
      assert.equal(balances.at(-1).bonus, 0)
      // The stored round is left untouched: nothing is silently rewritten.
      assert.deepEqual(JSON.parse(window.localStorage.getItem(key)).quizzes[0], old)
    })

    await t.test('each standalone reward page recovers from a missing migration via refresh', async () => {
      await unmount()
      liveServer = await createServer({ root, configFile: false, mode: 'test', logLevel: 'error',
        cacheDir: 'node_modules/.vite-daily-rewards-setup-test', envPrefix: 'CCL_DAILY_SETUP_TEST_', plugins: [react()],
        define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://daily-api.example.test'),
          'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key') },
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      })
      const liveDb = await liveServer.ssrLoadModule('/src/lib/db.js')
      liveClient = liveDb.supabase
      assert.equal(liveDb.hasSupabase, true)
      let configured = false
      const calls = []
      const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
      const status = { user_id: 'other-user', day, server_now: new Date().toISOString(),
        reset_at: new Date(Date.now() + 3600_000).toISOString(), purchased: 0, bonus: 0, credits: 0,
        login: { claimed: false, vote_reward: 0 }, earned_today: 0,
        quiz: { state: 'ready', question_count: 5, max_votes: 5 } }
      liveClient.rpc = (name, args) => ({ abortSignal: async () => {
        calls.push({ name, args })
        return configured ? { data: status, error: null } : { data: null, error: { code: 'PGRST202' } }
      } })
      const Component = (await liveServer.ssrLoadModule('/src/components/DailyRewards.jsx')).default
      const Provider = (await liveServer.ssrLoadModule('/src/lib/i18n.jsx')).I18nProvider
      for (const [kind, actionSelector, otherSelector] of [
        ['login', '.daily-claim', '.daily-quiz-start'], ['quiz', '.daily-quiz-start', '.daily-claim'],
      ]) {
        configured = false
        await mount(kind, 'other-user', Component, Provider)
        await waitFor(() => query('[role="alert"]'))
        assert.match(query('[role="alert"]').textContent, /not set up yet/)
        assert.equal(query(actionSelector).disabled, true)
        assert.equal(query(otherSelector), null)
        configured = true
        await click(query('.daily-error button'))
        await waitFor(() => !query(actionSelector).disabled)
        assert.equal(query('[role="alert"]'), null)
        if (kind === 'login') {
          assert.ok(query('.check-in-calendar-unavailable'), 'old server supports today without fabricating calendar history')
          assert.equal(query('.check-in-day.is-today').disabled, false)
          assert.equal(container.querySelectorAll('.check-in-day.is-missed').length, 0)
        }
        await unmount()
      }
      assert.ok(calls.every(c => c.name === 'my_daily_rewards_status' && c.args === undefined), 'read RPC accepts no client recipient/date/reward')
    })
  } finally {
    await unmount()
    await liveClient?.auth.dispose()
    await liveServer?.close()
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
