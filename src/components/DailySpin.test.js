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

    /* 16 lát, HAI tông xen kẽ + đúng MỘT lát mang màu nhấn (giải cao nhất).
       Bản trước dùng 12 sắc độ (4 bậc × 3 sắc): mắt phải học một bảng màu chỉ
       để đọc một con số. Điểm nhấn duy nhất mới là thứ đọc ra chuyên nghiệp. */
    assert.equal((html.match(/class="spin-sector [^"]*"/g) || []).length, 16)
    assert.equal((html.match(/class="spin-wheel-number[^"]*"/g) || []).length, 16)
    assert.equal((html.match(/class="spin-sector base(?: |")/g) || []).length, 8, '8 lát tông nền')
    assert.equal((html.match(/class="spin-sector alt(?: |")/g) || []).length, 8, '8 lát tông xen kẽ')
    assert.equal((html.match(/class="spin-sector [^"]*jackpot"/g) || []).length, 1, 'đúng một ô giải cao nhất')
    assert.equal((html.match(/class="spin-wheel-number jackpot"/g) || []).length, 1)
    const slices = [...html.matchAll(/class="spin-sector (base|alt)(?: |")/g)].map(m => m[1])
    assert.deepEqual(slices, Array.from({ length: 16 }, (_, i) => (i % 2 ? 'alt' : 'base')),
      'hai tông phải xen kẽ nhau, không được hai lát bằng nhau nằm cạnh nhau')
    /* Không nan hoa: hai tông xen kẽ đã tự kẻ ranh giới lát, nên 16 đường kẻ
       từ trục ra vành chỉ làm bánh xe trông như nan hoa xe đạp. */
    assert.equal((html.match(/class="spin-wheel-spoke"/g) || []).length, 0, 'không còn nan hoa')
    /* Bánh xe chỉ còn NĂM lớp: vành + đường tóc ngoài, lát, số, trục, con trỏ.
       Vành chia độ 48 vạch, mũi chỉ trên trục, chấm trục, đường tóc trong lòng
       đĩa và cung ăn mừng ngoài vành đều đã bị gỡ — chúng nói lại điều hai
       tông lát và con trỏ đã nói. */
    assert.equal((html.match(/class="spin-wheel-tick/g) || []).length, 0, 'không còn vành chia độ')
    assert.equal((html.match(/class="spin-wheel-hub-mark"/g) || []).length, 0, 'không còn mũi chỉ trên trục')
    assert.equal((html.match(/class="spin-wheel-seam"/g) || []).length, 0, 'không còn đường tóc trong đĩa')
    assert.equal((html.match(/class="spin-wheel-rim"/g) || []).length, 1)
    assert.equal((html.match(/class="spin-wheel-hub"/g) || []).length, 1, 'trục là MỘT đĩa phẳng')
    /* Chưa có kết quả thì không được có dấu hiệu ăn mừng nào */
    assert.doesNotMatch(html, /spin-burst|spin-wheel-win-arc|spin-won-num/)
    assert.match(html, /aria-label="Wheel with 16 equal sectors: 9× \+1, 4× \+2, 2× \+3, 1× \+5 votes/)
    // Nothing is highlighted before a result exists.
    assert.doesNotMatch(html, /has-won|is-won|spin-wheel-marker/)

    // 3. status card: three metrics (spins, purchased, bonus), the slot bar,
    //    two short rules (the reset line lives in the head chip, not twice)
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
    assert.equal((rules.match(/<li>/g) || []).length, 2)
    const words = rules.replace(/<[^>]*>/g, ' ').trim().split(/\s+/)
    assert.ok(words.length <= 25, 'rules should stay short')
    assert.match(rules, /2 spins per account and device/)
    /* Mốc reset KHÔNG được nhắc lại ở đây: nó đã là một chip ở đầu khối. */
    assert.doesNotMatch(rules, /GMT/, 'reset chỉ được nói một lần, ở chip đếm ngược')
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
  /* Ba tông, tất cả là token: hai tông nền xen kẽ + ĐÚNG MỘT tông nhấn cho ô
     giải cao nhất. Bảng 12 sắc độ cũ (4 bậc × 3 sắc) đã bị gỡ — nếu nó quay
     lại, bài này phải đỏ. */
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-1:\s*var\(--surface-2\)/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-2:\s*color-mix\(in oklab, var\(--surface-2\)[^;]+;/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*--w-4:\s*var\(--a\)/)
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*fill:\s*var\(--w-1\)/)
  assert.match(pageCss, /\.spin-sector\.alt\s*\{[^}]*fill:\s*var\(--w-2\)/)
  assert.match(pageCss, /\.spin-sector\.jackpot\s*\{[^}]*fill:\s*var\(--w-4\)/)
  assert.doesNotMatch(pageCss, /--w-t\d/, 'bảng 4 bậc thưởng đã bị gỡ')
  assert.doesNotMatch(pageCss, /--w-\d[abc]/, 'bảng 12 sắc độ đã bị gỡ')
  // Số thưởng đọc bằng màu chữ của trang; chỉ ô giải cao nhất mới đi chữ trắng.
  assert.match(pageCss, /\.spin-wheel-number\s*\{[^}]*fill:\s*var\(--txt\)/)
  assert.match(pageCss, /\.spin-wheel-number\.jackpot\s*\{[^}]*fill:\s*#fff/)
  // Không quầng sáng màu nhấn: đĩa nổi bằng bóng đổ trung tính.
  assert.doesNotMatch(pageCss, /box-shadow[^;]*var\(--a-glow\)/, 'bỏ quầng sáng màu')
  // Con trỏ gõ theo nhịp THẬT do JS đặt (drivePointer), không rung đều vô hạn.
  assert.doesNotMatch(pageCss, /spinPointerTick|animation:\s*spinPointerTick/)
  assert.match(pageCss, /\.spin-wheel-pointer svg\s*\{[^}]*transition:\s*transform/)
  assert.match(pageCss, /\.daily-spin \.btn-primary::after\s*\{[^}]*content:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion/)
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
})
