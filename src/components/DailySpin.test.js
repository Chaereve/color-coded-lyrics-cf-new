/* Render the actual JSX with Vite's SSR loader, without running browser effects
   or connecting to Supabase. Guard the requested layout against regressions:
   head / stage (wheel + action | status card) / footer, 16 honest sectors. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Daily Spin renders head, dial with its action, status card and footer', async () => {
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
      createElement(DailySpin, {
        userId: 'test-user', credits: 12, purchased: 7, bonus: 5,
        onBalance() {}, onVote() {},
      })))

    assert.doesNotMatch(html, /<img\b|<image\b|logo-\d|spin-wheel-halo|spin-intro|spin-eyebrow/)

    // 1. head: title, demo badge and the reset countdown chip (not buried below)
    const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
    assert.ok(head, 'the section needs a head band')
    assert.match(head, /Daily bonus wheel/)
    assert.match(head, /Next reset/)
    assert.match(head, /--:--:--/)

    // 2. stage: the wheel and the button that spins it stay in one column
    const dial = html.match(/<div class="spin-dial">([\s\S]*?)<aside class="spin-panel">/)?.[1]
    assert.ok(dial, 'stage must keep a dial column and a status card')
    assert.ok(dial.indexOf('spin-wheel-wrap') < dial.indexOf('spin-button'), 'action sits under the wheel')
    assert.match(dial, /class="spin-result"/)
    assert.doesNotMatch(dial, /spin-rules|spin-odds/)

    // 16 equal sectors, one tone per tier, jackpot slice included
    assert.equal((html.match(/class="spin-sector [^"]*"/g) || []).length, 16)
    assert.equal((html.match(/class="spin-wheel-number [^"]*"/g) || []).length, 16)
    assert.equal((html.match(/class="spin-sector t4 v\d"/g) || []).length, 1)
    // Hue = prize, shade = position: the three shades cycle inside each tier so
    // neighbouring equal slices never merge into one block.
    const shades = [...html.matchAll(/class="spin-sector (t\d) (v\d)"/g)].map(m => [m[1], m[2]])
    assert.equal(shades.length, 16)
    assert.deepEqual(shades.filter(([t]) => t === 't1').map(([, v]) => v),
      ['v1', 'v2', 'v3', 'v1', 'v2', 'v3', 'v1', 'v2', 'v3'])
    assert.deepEqual(shades.filter(([t]) => t === 't2').map(([, v]) => v), ['v1', 'v2', 'v3', 'v1'])
    assert.equal((html.match(/class="spin-wheel-spoke"/g) || []).length, 16)
    /* Vành chia độ + mũi chỉ trên trục: hai chi tiết trả lời câu "vòng quay còn
       sơ sài". 48 vạch, cứ 5 vạch có một vạch giờ (16 lát × 3 vạch) — mất một
       trong hai thứ này là bánh xe quay về trạng thái trơn như trước. */
    assert.equal((html.match(/class="spin-wheel-tick"/g) || []).length, 32, '32 vạch phút')
    assert.equal((html.match(/class="spin-wheel-tick major"/g) || []).length, 16, 'mỗi lát một vạch giờ')
    assert.equal((html.match(/class="spin-wheel-hub-mark"/g) || []).length, 1, 'mũi chỉ trên trục')
    assert.equal((html.match(/class="spin-wheel-seam"/g) || []).length, 1, 'đường tóc giữa lát và vành')
    /* Chưa có kết quả thì không được có dấu hiệu ăn mừng nào */
    assert.doesNotMatch(html, /spin-burst|spin-wheel-win-arc|spin-won-num/)
    assert.match(html, /aria-label="Wheel with 16 equal sectors: 9× \+1, 4× \+2, 2× \+3, 1× \+5 votes/)
    // Nothing is highlighted before a result exists.
    assert.doesNotMatch(html, /has-won|is-won|spin-wheel-marker/)

    // 3. status card: three metrics (spins, purchased, bonus), the slot bar,
    //    three short rules, odds table
    const panel = html.match(/<aside class="spin-panel">([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(panel)
    // purchased and bonus balances are shown as their own metrics, not a
    // combined "Purchased + bonus" number
    assert.match(panel, /7<small>votes<\/small>/)
    assert.match(panel, /5<small>votes<\/small>/)
    assert.match(panel, /<span>Purchased<\/span>/)
    assert.match(panel, /<span>Bonus<\/span>/)
    assert.doesNotMatch(panel, /Purchased \+ bonus/)
    const pips = panel.match(/<span class="spin-pips"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    assert.equal((pips?.match(/<i /g) || []).length, 2, 'two daily slots, drawn as a bar')

    const rules = panel.match(/<ul class="spin-rules"[^>]*>([\s\S]*?)<\/ul>/)?.[1]
    assert.ok(rules)
    assert.equal((rules.match(/<li>/g) || []).length, 3)
    const words = rules.replace(/<[^>]*>/g, ' ').trim().split(/\s+/)
    assert.ok(words.length <= 25, 'rules should stay short')
    assert.match(rules, /2 spins per account and device/)
    assert.match(rules, /00:00 \(GMT\+7\)/)
    assert.doesNotMatch(rules, /hardware|fingerprint|cookie|browser ID/i)

    // 4. today's rewards sit in the status card (the odds table is gone from the
    //    UI on purpose); the spend link stands next to its heading
    assert.doesNotMatch(html, /spin-odds|spin-chip|<footer class="spin-account"/)
    assert.match(panel, /<div class="spin-history">/)
    assert.match(panel, /Today’s rewards/)
    assert.match(panel, /No spins yet\./)
    assert.match(panel, /class="spin-vote-link"/)
  } finally {
    await server.close()
  }
})


test('Daily Spin uses flat site colours and opts out of the shared background', async () => {
  const [pageCss, siteCss] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.css', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(pageCss, /(?:linear|radial|conic)-gradient\s*\(/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*background:\s*var\(--surface\)/)
  // The slice ramp starts on a site surface and ends on the brand accent.
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-1:\s*var\(--surface-2\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-4:\s*var\(--a\)/)
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*fill:\s*var\(--w-1\)/)
  assert.match(pageCss, /\.spin-sector\.t4\s*\{[^}]*fill:\s*var\(--w-4\)/)
  // Every tier/shade pair must resolve to its own flat variable — no slice may
  // fall back to a neighbour's colour.
  for (const t of [1, 2, 3, 4]) for (const [v, s] of [[1, 'a'], [2, 'b'], [3, 'c']]) {
    assert.match(pageCss, new RegExp(`\\.spin-sector\\.t${t}\\.v${v}\\s*\\{[^}]*fill:\\s*var\\(--w-${t}${s}\\)`))
    assert.match(pageCss, new RegExp(`--w-${t}${s}:\\s*[^;]+;`))
  }
  // The whole wheel is shades of the SITE ACCENT: every tone traces back to
  // var(--a), so retuning the brand colour restyles the wheel. No stray hex
  // hue may sneak into the slice ramp.
  const tiers = [...pageCss.matchAll(/--w-t(\d):\s*([^;]+);/g)]
  assert.equal(tiers.length, 4)
  for (const [, , value] of tiers) {
    assert.match(value, /var\(--a\)/, 'each tier tone must be mixed from the accent')
    assert.doesNotMatch(value, /#[0-9a-f]{3,8}/i, 'no hard-coded hue in the tier ramp')
  }
  // Shades may only lighten/darken their own tier with white or black.
  for (const [, m] of [...pageCss.matchAll(/--w-\d[bc]:\s*([^;]+);/g)].map(m => [0, m[1]])) {
    assert.match(m, /color-mix\(in oklab, #(fff|000) \d+%, var\(--w-t\d\)\)/)
  }
  // The prize must read louder than the position: the tier step has to stay
  // wider than the shade step, or the shading looks like extra prize tiers.
  const pct = re => [...pageCss.matchAll(re)].map(m => Number(m[1]))
  const tierSteps = pct(/--w-t\d:\s*color-mix\(in oklab, var\(--a\) (\d+)%/g)
  const shadeSteps = pct(/--w-\d[bc]:\s*color-mix\(in oklab, #(?:fff|000) (\d+)%/g)
  const minTierStep = Math.min(...tierSteps.slice(1).map((v, i) => v - tierSteps[i]))
  assert.ok(minTierStep >= 4 * Math.max(...shadeSteps),
    `tier step ${minTierStep}% must dominate shade step ${Math.max(...shadeSteps)}%`)
  assert.match(pageCss, /\.daily-spin \.btn-primary::after\s*\{[^}]*content:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion/)
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
})
