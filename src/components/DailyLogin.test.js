/* Render the actual JSX with Vite's SSR loader — no browser effects, no
   Supabase. Guards the approved B1 mockup: two-column frame, the reward card
   speaking only in VOTES (the word "credits" never appears), cycle progress,
   the two milestones, the cap meter, and a11y labels. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

const rewards = {
  user_id: 'u1',
  day: '2026-10-08',
  enabled: true,
  cap: 30,
  cap_used: 17,
  cap_left: 13,
  streak: 7,
  cycle_day: 7,
  milestone30_granted: false,
  today_total: 17,
  breakdown: [
    { source: 'daily_login', amount: 2 },
    { source: 'login_day7', amount: 5 },
    { source: 'login_milestone7', amount: 10 },
  ],
}

async function withVite(run) {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-login-ui-test',
    // A developer's .env must not turn this UI-only test into a live DB client.
    envPrefix: 'CCL_LOGIN_UI_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try { return await run(server) } finally { await server.close() }
}

test('the check-in page keeps its frame and hides the reward card until data exists', async () => {
  await withVite(async server => {
    const { default: DailyLogin } = await server.ssrLoadModule('/src/components/DailyLogin.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(DailyLogin, { userId: 'test-user' })))

    assert.match(html, /Your check-in calendar/)
    assert.match(html, /class="daily-cols"/)
    assert.match(html, /Check in today/)
    // Before the RPC answers the card is hidden — no flash, no fake zeros.
    assert.doesNotMatch(html, /login-rewards/)
    // The approved rule line, and never the word "credits".
    assert.match(html, /Rewards: \+2 a day/)
    assert.doesNotMatch(html, /[Cc]redits/)
    // Legacy copy must be gone: check-ins DO pay votes now.
    assert.doesNotMatch(html, /never award/)
  })
})

test('the reward card renders votes only: total, cycle, milestones, cap meter', async () => {
  await withVite(async server => {
    const { RewardCard } = await server.ssrLoadModule('/src/components/DailyLogin.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(RewardCard, { rewards, claimed: true, fete: false })))

    // Every money line is VOTES.
    assert.match(html, /\+17 votes/)
    assert.match(html, /Check-in rewards/)
    assert.match(html, /Earned today/)
    assert.match(html, /Cycle day 7 of 7/)
    assert.match(html, /Every 7 days · \+10 votes/)
    assert.match(html, /Once at 30 days · \+20 votes/)
    // Breakdown lists each granted slice with its label and votes.
    assert.match(html, /Check-in<\/span><b>\+2 votes/)
    assert.match(html, /Cycle day 7<\/span><b>\+5 votes/)
    assert.match(html, /7-day streak<\/span><b>\+10 votes/)
    // Cap meter carries its accessible summary.
    assert.match(html, /17 of 30 reward votes today/)
    assert.match(html, /aria-valuenow="17"/)
    // Milestone 30 is not done; milestone 7 paid today reads Done.
    assert.match(html, /Done/)
    assert.doesNotMatch(html, /[Cc]redits/)
  })
})

test('an unclaimed day projects the next check-in instead of a breakdown', async () => {
  await withVite(async server => {
    const { RewardCard } = await server.ssrLoadModule('/src/components/DailyLogin.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(RewardCard, { rewards: { ...rewards, streak: 1, cycle_day: 1, cap_used: 0, cap_left: 30, today_total: 0, breakdown: [] }, claimed: false, fete: false })))
    assert.match(html, /Next check-in pays \+2 votes/)
    assert.doesNotMatch(html, /Today’s reward breakdown/)
  })
})
