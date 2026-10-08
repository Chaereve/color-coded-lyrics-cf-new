/* Render the actual JSX with Vite's SSR loader, without running browser effects
   or connecting to Supabase. Guard the polished layout against regressions:
   wheel hero + a four-item side column, ZERO odds/percentages anywhere. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Daily Spin renders head, wheel hero, four-item side column — no odds UI', async () => {
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

    assert.doesNotMatch(html, /<img\b|<image\b|logo-\d|spin-wheel-halo|spin-intro|spin-eyebrow/)

    // 1. head: title, demo badge and the reset countdown chip (not buried below)
    const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
    assert.ok(head, 'the section needs a head band')
    assert.match(head, /Daily bonus wheel/)
    assert.match(head, /Next reset/)
    assert.match(head, /--:--:--/)

    // 2. ZERO odds in the UI: no percentage anywhere, no legend, no odds table,
    //    and the wheel's own accessible name stays percent-free too.
    assert.doesNotMatch(html, /\d+%/, 'không phần trăm nào được in trên UI spin')
    assert.doesNotMatch(html, /spin-legend|spin-odds|odds table/i)
    assert.match(html, /aria-label="Wheel with 7 sectors\. Brighter sectors are rarer\."/)

    // 3. wheel hero on the left, action column on the right
    const stage = html.match(/<div class="spin-stage">([\s\S]*?)<\/section>/)?.[1]
    assert.ok(stage, 'stage must exist')
    assert.ok(stage.indexOf('spin-wheel-wrap') < stage.indexOf('spin-button'),
      'wheel first, action column after it')
    assert.equal((html.match(/class="spin-sector [^"]*"/g) || []).length, 7)
    for (const tier of ['t1', 't2', 't3', 't4', 't5', 't6', 't7']) {
      assert.equal((html.match(new RegExp(`class="spin-sector ${tier}(?: |")`, 'g')) || []).length, 1,
        `đúng MỘT lát ${tier}`)
    }
    /* Nhãn: 7 chữ, mỗi chữ xoay RADIAL theo tâm ô (transform rotate); badge
       +20 là DUY NHẤT một pill hồng — không plate lớn đè nhãn kề. */
    const labels = [...html.matchAll(/class="spin-wheel-number[^"]*"[^>]*>([\s\S]*?)<\/text>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '').trim())
    assert.deepEqual(labels, ['+1', '+2', '+3', '+5', '+8', '+10', '+20'], 'bảy nhãn, một nhãn cho một ô')
    const rotated = [...html.matchAll(/class="spin-wheel-number (?:t\d)"/g)].length
    assert.equal(rotated, 6, 'sáu nhãn thường xoay radial (badge +20 là ngoại lệ)')
    assert.equal((html.match(/class="spin-jack-pill"/g) || []).length, 1, 'badge jackpot đúng một cái')
    assert.equal((html.match(/class="spin-wheel-number jackpot"/g) || []).length, 1)
    assert.equal((html.match(/class="spin-wheel-spoke"/g) || []).length, 0, 'không nan hoa')
    assert.equal((html.match(/class="spin-wheel-rim"/g) || []).length, 1)
    assert.equal((html.match(/class="spin-wheel-hub"/g) || []).length, 1, 'trục là MỘT đĩa phẳng')
    assert.doesNotMatch(html, /spin-burst|spin-won-num/)
    assert.doesNotMatch(html, /has-won|is-won|spin-wheel-marker/)

    // 4. side column EXACTLY four things: remaining · Spin button · latest
    //    result · short history. No odds table, no wallet metrics, no rules.
    const panel = html.match(/<aside class="spin-panel">([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(panel)
    assert.match(panel, /Spins left today/)
    const pips = panel.match(/<span class="spin-pips"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    assert.equal((pips?.match(/<i /g) || []).length, 2, 'two daily slots, drawn as a bar')
    assert.match(panel, /class="btn btn-primary spin-button"/)
    assert.match(panel, /class="spin-result[^"]*" role="status" aria-live="polite"/)
    assert.match(panel, /<div class="spin-history">/)
    assert.match(panel, /Today’s rewards/)
    assert.match(panel, /No spins yet\./)
    assert.match(panel, /class="spin-vote-link"/)
    assert.doesNotMatch(panel, /spin-legend|spin-odds|Purchased|Bonus|spin-rules|%/,
      'cột phụ chỉ có 4 thứ — không odds, không ví, không phần trăm')
    /* Chưa quay thì KHÔNG in dòng tổng: "+0 vote" là một con số vô nghĩa. */
    assert.doesNotMatch(panel, /spin-total/)
  } finally {
    await server.close()
  }
})


test('Daily Spin uses the approved flat palette and opts out of the shared background', async () => {
  const [pageCss, siteCss] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.css', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(pageCss, /(?:linear|radial|conic)-gradient\s*\(/)
  assert.match(pageCss, /\.daily-spin\s*\{[^}]*background:\s*var\(--surface\)/)
  /* Bảy tông = đúng bảng màu đã duyệt cho khu spin, sáng→đậm theo độ hiếm;
     #3D05DD là accent duy nhất: lát jackpot, badge, nút Spin, focus. */
  for (const hex of ['#FCB0F3', '#DC94EF', '#BC77EC', '#9D5BE8', '#7D3EE4', '#5D22E1', '#3D05DD']) {
    assert.ok(pageCss.includes(hex), `palette thiếu ${hex}`)
  }
  assert.match(pageCss, /\.spin-sector\.t7\s*\{[^}]*--wc:\s*var\(--w-7\)/)
  /* Mực chữ theo nền: sáng→mực tối, đậm→trắng (contrast ghi trong comment). */
  assert.match(pageCss, /\.spin-wheel-number\.t1[^{]*\{[^}]*fill:\s*var\(--s-ink-dark\)/)
  assert.match(pageCss, /\.spin-wheel-number\.t5[^{]*\{[^}]*fill:\s*#fff/)
  assert.match(pageCss, /\.spin-jack-pill\s*\{[^}]*fill:\s*#FCB0F3/)
  assert.match(pageCss, /\.spin-wheel-number\.jackpot\s*\{[^}]*fill:\s*#3D05DD/,
    'badge jackpot: mực #3D05DD trên nền hồng (≈8:1)')
  /* Ranh giới giữa các lát: nét nền dày hơn một chút — hai lát kề không dính
     vào nhau chỉ nhờ hue. */
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*stroke:\s*var\(--surface\)/)
  assert.match(pageCss, /\.spin-sector\s*\{[^}]*stroke-width:\s*2/)
  /* Nút Spin + focus dùng accent #3D05DD của khu spin. */
  assert.match(pageCss, /\.daily-spin \.spin-button\s*\{[^}]*background:\s*var\(--w-7\)/)
  assert.match(pageCss, /\.daily-spin \.spin-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--w-7\)/)
  /* Anticipation: nhịp giật lùi có cong riêng. */
  assert.match(pageCss, /\.is-wind \.spin-wheel-disc\s*\{[^}]*transition-timing-function/)
  // Con trỏ gõ theo nhịp THẬT do JS đặt (drivePointer), không rung đều vô hạn.
  assert.doesNotMatch(pageCss, /spinPointerTick|animation:\s*spinPointerTick/)
  assert.match(pageCss, /\.spin-wheel-pointer svg\s*\{[^}]*transition:\s*transform/)
  assert.match(pageCss, /\.daily-spin \.btn-primary::after\s*\{[^}]*content:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion/)
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
})

/* ---------- KÉO ĐĨA (giữ nguyên hành vi đã duyệt) ---------- */

test('kéo đĩa: chuột/bút kéo được, ngón tay thì không, và nhả ra mới quay', async () => {
  const [jsx, pageCss] = await Promise.all([
    readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
  ])

  /* NGUYÊN TẮC: trên máy cảm ứng, kéo một ngón ở giữa màn hình là cuộn trang.
     Cướp thao tác đó để quay thì trang khó dùng hơn hẳn, mà nút quay đã nằm
     ngay trong cột hành động. */
  assert.match(jsx, /e\.pointerType === 'touch'[^\n]*return/,
    'phải chặn kéo bằng ngón tay ngay đầu dragDown')
  assert.match(jsx, /onPointerDown=\{canDrag \? drag\.down : undefined\}/,
    'chỉ gắn tay kéo khi đĩa thật sự kéo được (còn lượt và đang đứng yên)')

  /* PHẦN KÉO NẰM Ở LỚP BỌC, KHÔNG Ở ĐĨA: đĩa đã có transform của nhịp quay
     CSS. Kéo ở lớp bọc rồi cộng dồn lúc nhả ra là cách duy nhất để đĩa không
     nhảy về vị trí cũ trước khi quay. */
  assert.match(jsx, /el\.style\.transform = `rotate\(\$\{d\.turned\}deg\)`/)
  assert.match(jsx, /angle\.current \+= d\.turned/,
    'lúc nhả phải cộng phần đã kéo vào góc thật TRƯỚC khi gọi lượt quay')
  assert.match(jsx, /discRef\.current\.style\.transform = `rotate\(\$\{angle\.current\}deg\)`/,
    'đặt lại transform của đĩa theo góc mới trong cùng khung hình')

  /* Tiếng tách khi kéo: cùng hàm đếm vạch, có sàn thời gian, và đi theo hướng
     nào cũng kêu (giá trị tuyệt đối). */
  assert.match(jsx, /dragTicks\(d\.tickAt, d\.turned, \{ ms: now - d\.last \}\)/)
  assert.match(jsx, /now - d\.lastTick < DRAG_TICK_GAP_MS/)
  assert.match(jsx, /Math\.min\(3, Math\.abs\(count\)\)/, 'một cú nhích dài không thành tràng tạch tạch')

  /* CSS: hình bàn tay chỉ hiện khi kéo được; lúc kéo thì tắt nhịp đàn hồi. */
  assert.match(pageCss, /\.spin-wheel-wrap\.can-drag \{[^}]*cursor:\s*grab/)
  assert.match(pageCss, /\.spin-wheel-wrap\.dragging \{[^}]*transition:\s*none/)
  assert.match(pageCss, /prefers-reduced-motion[\s\S]*\.spin-wheel-wrap \{[^}]*transition:\s*none !important/)
})

/* ---------- ANTICIPATION (vòng polish 2026-10) ---------- */

test('spin(): anticipation giật lùi 260ms rồi mới vào nhịp 4,5s; reduced-motion bỏ', async () => {
  const jsx = await readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /const ms = reducedMotion\(\) \|\| data\.replayed \? 0 : 4500/)
  assert.match(jsx, /setWind\(true\)\s*\n\s*setDuration\(260\)\s*\n\s*setRotation\(angle\.current - 14\)/,
    'anticipation: giật lùi −14° trong 260ms')
  assert.match(jsx, /await new Promise\(resolve => setTimeout\(resolve, 260\)\)/)
  assert.match(jsx, /if \(ms\) \{[\s\S]*?setWind\(true\)/, 'reduced-motion/replay KHÔNG chạy nhịp lùi')
})
