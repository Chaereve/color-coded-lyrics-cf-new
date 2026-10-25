/* Render the real Daily Spin UI without browser effects or a live Supabase client. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function loadSpinUi() {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-spin-ui-test',
    // A developer's .env must not turn this UI-only test into a live DB client.
    envPrefix: 'CCL_SPIN_UI_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { default: DailySpin } = await server.ssrLoadModule('/src/components/DailySpin.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(DailySpin, { userId: 'test-user', onBalance() {}, onVote() {} })))
    return html
  } finally {
    await server.close()
  }
}

test('Daily Spin renders the arcade board, live state and real spin action', async () => {
  const html = await loadSpinUi()
  assert.doesNotMatch(html, /<img\b|<canvas\b|spin-wheel|spin-sector|reel-track|reel-item/)
  assert.doesNotMatch(html, /<image\b|logo-\d|spin-intro|spin-eyebrow/)

  const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(head, 'remaining spins and reset should stay in the header')
  assert.match(head, /Demo · local data/)
  assert.match(head, /Spins left today/)
  assert.match(head, /Next reset/)
  assert.doesNotMatch(head, /00:00 \(GMT\+7\)/, 'không hiện dòng giờ reset cố định')
  assert.match(head, /--:--:--/)
  assert.doesNotMatch(html, /\d+%/, 'the UI must not reveal odds')

  const { SPIN_RING } = await import('../lib/dailySpin.js')
  assert.match(html, /class="spin-board/)
  const tiles = [...html.matchAll(/class="spin-tile r\d[^"]*"/g)]
  assert.equal(tiles.length, 20, 'the ring has exactly twenty reward tiles')
  const values = [...html.matchAll(/<b>\+(\d+)<\/b>/g)].map(m => Number(m[1])).sort((a, b) => a - b)
  assert.deepEqual(values, [...SPIN_RING].sort((a, b) => a - b))
  assert.ok((html.match(/<svg/g) || []).length >= 20, 'each tile renders its icon')
  assert.match(html, /data-slot="0"/)
  assert.match(html, /grid-area:\s*1 \/ 1/)

  const controls = html.match(/<aside class="spin-controls">([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(controls, 'controls sit beside or below the board responsively')
  assert.match(controls, /aria-live="polite"/)
  assert.match(controls, /role="status"/)
  assert.match(controls, /<button type="button" class="spin-cta"/)
  assert.match(controls, /Loading…|Spin now/, 'the action gives an explicit pending or ready state')
  assert.match(html, /class="spin-core"[\s\S]*?class="spin-now/)

  const footer = html.match(/<aside class="spin-strip">([\s\S]*?)<\/aside>/)?.[1]
  assert.ok(footer)
  assert.match(footer, /Today’s rewards/)
  assert.match(footer, /No spins yet\./)
  assert.match(footer, /class="spin-vote-link"/)
  assert.doesNotMatch(footer, /spin-legend|spin-odds|Purchased|Bonus|spin-rules|%/)
})

test('Arcade styling remains restrained, responsive and reduced-motion aware', async () => {
  const [css, jsx] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8'),
  ])
  for (const hex of ['#8B80FF', '#AD82EE', '#D696E3', '#F3B3E7', '#493DE0']) {
    assert.ok(css.includes(hex), `arcade palette missing ${hex}`)
  }
  assert.match(css, /\.spin-board\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /aspect-ratio:\s*7 \/ 5/)
  assert.match(css, /\.spin-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*148px/)
  assert.match(css, /\.spin-main\s*\{[^}]*max-width:\s*826px;\s*margin-inline:\s*auto/)
  assert.match(css, /\.spin-cta:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  assert.match(css, /\.spin-cta\s*\{[^}]*min-height:\s*46px/)
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.spin-cta\s*\{[^}]*min-height:\s*44px/)
  assert.match(css, /\.spin-vote-link\s*\{[^}]*min-height:\s*36px/)
  assert.doesNotMatch(css, /font-size:\s*(?:8|9|10)(?:\.5)?px/, 'avoid unreadable microcopy')
  assert.match(css, /\.spin-tile\.win\s*\{[^}]*animation:\s*spin-arcade-land/)
  assert.match(css, /@keyframes spin-pop/)
  assert.match(css, /@media \(max-width: 879px\)[\s\S]*?\.spin-main/)
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.spin-cta/)
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.spin-tile\.win[\s\S]*?animation:\s*none/)
  assert.match(jsx, /<aside className="spin-controls">/)
  assert.match(jsx, /<button type="button" className="spin-cta" onClick=\{spin\}/)
})

test('real spin mechanics remain server-decided and retain success, error and SFX flows', async () => {
  const jsx = await readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /performDailySpin\(requestId, userId\)/)
  assert.match(jsx, /const winIndex = spinSectorIndex\(data\.spin\.segment, rewards\)/)
  assert.match(jsx, /spinRingTarget\(rewards\[winIndex\], ringPos\.current\)/)
  assert.doesNotMatch(jsx, /=\s*Math\.random\(/, 'the client must not choose a reward')
  assert.match(jsx, /const RING_RUN_STEPS = 60/)
  assert.match(jsx, /RING_RUN_STEPS \+ targetSteps/)
  assert.match(jsx, /34 \+ 290 \* \(i \/ n\) \*\* 5/)
  assert.match(jsx, /setTimeout\(done, 240\)/)
  assert.match(jsx, /confettiBurst\(/)
  assert.match(jsx, /sfx\.spinGo\(\)/, 'original spin-start sound stays connected')
  assert.match(jsx, /sfx\.spinWin\(/, 'original result sound stays connected')
  assert.match(jsx, /sfx\.error\(\)/, 'original error sound stays connected')
  assert.match(jsx, /setPhase\('idle'\); setError\(errMsg\(t, e\)\)/)
  assert.match(jsx, /if \(data\.replayed\) \{[\s\S]*?settle\(\)/)
  assert.match(jsx, /reducedMotion\(\) \? 18 : 34 \+ 290/)
  assert.match(jsx, /disabled=\{active \|\| loading \|\| !status \|\| \(!remaining && !pending\)\}/)
  assert.match(jsx, /winSlot === slot \? ' win' : ''/)
})
