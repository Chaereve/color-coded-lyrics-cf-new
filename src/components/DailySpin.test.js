/* Render the actual JSX with Vite's SSR loader, without running browser effects
   or connecting to Supabase. Guard the RING SPINNER (vòng 5, bản mẫu chủ sở
   hữu): 20 ô vuông xếp vành kim đồng hồ quanh lõi chữ nhật (conic sweep +
   nút Spin), đèn chạy vòng với đuôi comet, dừng đúng ô chứa mức SERVER trả —
   ZERO odds/percentages anywhere, and NO wheel or horizontal reel leftovers
   (the reel belongs to the Daily Box only). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Daily Spin renders head, 7×5 ring board with core Spin button — no odds UI', async () => {
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

    /* KHÔNG wheel tròn, KHÔNG reel ngang — reel chỉ thuộc Daily Box.
       Icon ô là <svg> nội tuyến nên svg ĐƯỢC PHÉP; img/canvas thì không. */
    assert.doesNotMatch(html, /<img\b|<canvas\b|spin-wheel|spin-sector|reel-track|reel-item/)
    assert.doesNotMatch(html, /<image\b|logo-\d|spin-intro|spin-eyebrow/)

    // 1. head: title and the reset countdown chip (not buried below)
    const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
    assert.ok(head, 'the section needs a head band')
    assert.match(head, /Daily spin/)
    assert.match(head, /Demo · local data/, 'nhãn demo nằm cạnh tiêu đề')
    assert.match(head, /Next reset/)
    assert.match(head, /--:--:--/)

    // 2. ZERO odds in the UI: no percentage anywhere, no legend, no odds table.
    assert.doesNotMatch(html, /\d+%/, 'không phần trăm nào được in trên UI spin')
    assert.doesNotMatch(html, /spin-legend|spin-odds|odds table/i)

    // 3. THE RING: exactly 20 tiles around the core — đúng bảng SPIN_RING của
    //    lib (đết từng mức), mỗi ô có ICON riêng (không phân biệt chỉ bằng màu).
    const { SPIN_RING } = await server.ssrLoadModule('/src/lib/dailySpin.js')
    assert.ok(html.includes('class="spin-board'), 'ring board must exist')
    const tiles = [...html.matchAll(/class="spin-tile r\d[^"]*"/g)]
    assert.equal(tiles.length, 20, 'đúng 20 ô quanh lõi')
    const numbers = [...html.matchAll(/<b>\+(\d+)<\/b>/g)].map(m => Number(m[1])).sort((a, b) => a - b)
    assert.deepEqual(numbers, [...SPIN_RING].sort((a, b) => a - b),
      'các mức trên board = đúng bảng vành của lib')
    assert.ok((html.match(/<svg/g) || []).length >= 20,
      'mỗi ô có icon SVG riêng — icon phân biệt ô, không chỉ màu')
    assert.match(html, /data-slot="0"/, 'ô mang slot index để đèn chạy tìm đúng ô')
    assert.match(html, /grid-area:\s*1 \/ 1/, 'ô 0 đặt góc trên-trái qua gridArea')

    // 4. THE CORE: trạng thái + NÚT SPIN thật nằm giữa vành + MỘT vùng live.
    const core = html.match(/<div class="spin-core">([\s\S]*?)<\/div><\/div>/)?.[1]
    assert.ok(core, 'lõi chữ nhật phải tồn tại')
    assert.match(core, /aria-live="polite"/, 'một vùng live duy nhất đọc trạng thái + kết quả')
    assert.match(core, /<button type="button" class="spin-cta"/, 'nút QUAY thật')
    assert.match(core, /Win bonus votes/)
    const boardOpen = html.indexOf('class="spin-board')
    const coreOpen = html.indexOf('class="spin-core"')
    const boardClose = html.indexOf('</section>')
    assert.ok(boardOpen !== -1 && coreOpen !== -1 && boardOpen < coreOpen && coreOpen < boardClose,
      'nút QUAY nằm giữa vành')

    // 5. side strip EXACTLY three things: remaining+pips · short history ·
    //    vote link. No odds table, no wallet metrics, no rules.
    const strip = html.match(/<aside class="spin-strip">([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(strip)
    assert.match(strip, /Spins left today/)
    const pips = strip.match(/<span class="spin-pips"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    assert.equal((pips?.match(/<i /g) || []).length, 2, 'two daily slots, drawn as a bar')
    assert.match(strip, /<div class="spin-history">/)
    assert.match(strip, /Today’s rewards/)
    assert.match(strip, /No spins yet\./)
    assert.match(strip, /class="spin-vote-link"/)
    assert.doesNotMatch(strip, /spin-legend|spin-odds|Purchased|Bonus|spin-rules|%/,
      'dải phụ chỉ có 3 thứ — không odds, không ví, không phần trăm')
    /* Chưa quay thì KHÔNG in dòng tổng: "+0 vote" là một con số vô nghĩa. */
    assert.doesNotMatch(strip, /spin-total/)
  } finally {
    await server.close()
  }
})

test('Daily Spin uses the approved palette on the ring and opts out of the shared background', async () => {
  const [pageCss, siteCss, jsx] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.css', import.meta.url), 'utf8'),
    readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8'),
  ])
  /* Bốn tông rarity = bảng màu vòng 5 theo bản mẫu (r0→r3); CTA là #3D05DD. */
  for (const hex of ['#5D22E1', '#9D5BE8', '#DC94EF', '#FCB0F3', '#3D05DD']) {
    assert.ok(pageCss.includes(hex), `palette thiếu ${hex}`)
  }
  /* Ô giải: gradient nền theo --c; +20 (r3) viền #FCB0F3 + sheen riêng. */
  assert.match(pageCss, /\.spin-tile\s*\{[^}]*background:\s*linear-gradient/)
  assert.match(pageCss, /\.spin-tile\.r3\s*\{[^}]*--c:\s*#FCB0F3/)
  assert.match(pageCss, /\.spin-tile\.r3::after\s*\{/, '+20 có sheen riêng')
  /* Đèn chạy: ô .on nổi rõ (scale + viền trắng), đuôi comet t1/t2 mờ dần. */
  assert.match(pageCss, /\.spin-tile\.on\s*\{[^}]*transform:\s*scale/)
  assert.match(pageCss, /\.spin-tile\.on\s*\{[^}]*box-shadow/)
  assert.match(pageCss, /\.spin-tile\.t1\s*\{[^}]*scale\(1\.05\)/)
  assert.match(pageCss, /\.spin-tile\.t2\s*\{[^}]*scale\(1\.02\)/)
  /* Ô trúng: pulse riêng + board mờ các ô còn lại (không chỉ đổi màu). */
  assert.match(pageCss, /\.spin-tile\.win\s*\{[^}]*animation:\s*spin-win/)
  assert.match(pageCss, /\.spin-board\.dim \.spin-tile:not\(\.win\)\s*\{[^}]*opacity/)
  /* LÕI: quét conic (vành quét chạy quanh lõi) + nền lõi inner. */
  assert.match(pageCss, /\.spin-core::before\s*\{[^}]*conic-gradient/)
  assert.match(pageCss, /\.spin-core::after\s*\{[^}]*radial-gradient/)
  /* Nút QUAY #3D05DD, focus ring thấy được, disabled mờ đi. */
  assert.match(pageCss, /\.spin-cta\s*\{[^}]*background:\s*#3D05DD/)
  assert.match(pageCss, /\.spin-cta:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  assert.match(pageCss, /\.spin-cta:disabled\s*\{[^}]*filter:\s*grayscale/)
  /* Board 7 cột cố định — vành kim đồng hồ cần hình chữ nhật đều nhau. */
  assert.match(pageCss, /\.spin-board\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*1fr\)/)
  /* Reduced motion: tắt nhô/zoom, giữ viền + glow tĩnh (trạng thái vẫn đọc được). */
  assert.match(pageCss, /prefers-reduced-motion[\s\S]*\.spin-tile\.win[\s\S]*animation:\s*none/)
  /* Vẫn tắt nền động dùng chung của trang spin. */
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
  /* Media query chỉ sống trong CSS — JSX không nhét @media vào inline style. */
  assert.doesNotMatch(jsx, /@media/)
})

/* ---------- RING SPINNER — luật chạy (source-level contract) ---------- */

test('ring: 20 ô = bảng lib, hình học kim đồng hồ, icon đủ mọi mức, comet theo slot', async () => {
  const { spinRingSlot, SPIN_REWARDS } = await import('../lib/dailySpin.js')
  const jsx = await readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8')
  /* Board dựng TỪ bảng lib (SPIN_RING.map + spinRingSlot) — không mảng ô cứng
     trong JSX có thể trượt khỏi hợp đồng. */
  assert.match(jsx, /SPIN_RING\.map\(\(reward, slot\)/)
  assert.match(jsx, /spinRingSlot\(slot\)/)
  /* Icon ô = BỘ CỦA TRANG (Icon.jsx): map đủ 7 mức, thăng hạng theo giá trị. */
  const mapBlock = jsx.match(/const REWARD_ICON = \{([^}]*)\}/)?.[1] || ''
  const map = Object.fromEntries([...mapBlock.matchAll(/(\d+):\s*'(\w+)'/g)].map(m => [m[1], m[2]]))
  for (const reward of SPIN_REWARDS) {
    assert.ok(map[reward], `REWARD_ICON thiếu icon cho mức +${reward}`)
  }
  assert.equal(map[20], 'crown', 'jackpot +20 mang vương miện')
  assert.match(jsx, /<Icon name=\{REWARD_ICON\[reward\]/, 'ô render icon QUA bộ dùng chung của trang')
  /* Đuôi comet = 2 ô PHÍA SAU đèn chính theo chiều chạy: (on+19)%20, (on+18)%20. */
  assert.match(jsx, /\(onSlot \+ 19\) % 20 === slot \? ' t1' : ''/)
  assert.match(jsx, /\(onSlot \+ 18\) % 20 === slot \? ' t2' : ''/)
  /* Ô trúng gắn class .win — highlight không dựa vào vị trí đoán. */
  assert.match(jsx, /winSlot === slot \? ' win' : ''/)
  /* Hình học &nh đã được lib-test khoá chặt; ở đây chỉ neo 4 điểm mốc. */
  assert.deepEqual(spinRingSlot(0), [1, 1])
  assert.deepEqual(spinRingSlot(6), [1, 7])
  assert.deepEqual(spinRingSlot(10), [5, 7])
  assert.deepEqual(spinRingSlot(16), [5, 1])
})

test('spin(): server-decides-first, ≥3 vòng ease-out quint, dừng đúng ô trúng, cleanup sạch', async () => {
  const jsx = await readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8')
  /* Server trả xong mới có kế hoạch decel — client KHÔNG chọn giải. */
  assert.match(jsx, /performDailySpin\(requestId, userId\)/, 'giải đến từ RPC server')
  assert.match(jsx, /const winIndex = spinSectorIndex\(data\.spin\.segment, rewards\)/,
    'ô trúng quy đổi từ segment SERVER trả về')
  assert.match(jsx, /spinRingTarget\(rewards\[winIndex\], ringPos\.current\)/,
    'ô đáp tất định phía trước vị trí hiện tại')
  assert.doesNotMatch(jsx, /=\s*Math\.random\(/, 'cấm random client quyết giải')
  /* Nhịp chạy: ≥ 3 vòng (60 bước) + đủ bước tới đích; delay ease-out quint. */
  assert.match(jsx, /const RING_RUN_STEPS = 60/, 'tối thiểu 3 vòng trước khi giảm tốc')
  assert.match(jsx, /RING_RUN_STEPS \+ targetSteps/)
  assert.match(jsx, /34 \+ 290 \* \(i \/ n\) \*\* 5/, 'đường cong ease-out quint của bản mẫu')
  assert.match(jsx, /setTimeout\(done, 240\)/, 'một nhịp thấy ô đọng trước khi settle')
  /* Ô dừng = ô chứa mức server trả; settle: confetti + sfx + đồng bộ lại. */
  assert.match(jsx, /confettiBurst\(/)
  assert.match(jsx, /sfx\.spinWin\(/)
  /* Lỗi: dừng an toàn + trả nút. */
  assert.match(jsx, /setPhase\('idle'\); setError\(errMsg\(t, e\)\)/)
  /* Cleanup: mọi timeout nhịp chạy bị xoá khi unmount. */
  assert.match(jsx, /useEffect\(\(\) => \(\) => \{ mounted\.current = false; clearSpinTimers\(\) \}, \[\]\)/)
  /* Khóa chống double-submit ngay đầu spin(). */
  assert.match(jsx, /if \(busy\.current \|\| !status \|\| \(!status\.remaining && !pending\)\) return/)
  /* Replay: KHÔNG diễn lại màn quay — đặt đèn thẳng vào ô kết quả (tất định). */
  assert.match(jsx, /if \(data\.replayed\) \{[\s\S]*?settle\(\)/)
  /* Reduced-motion: nhịp 18ms đều thay vì đường cong dài. */
  assert.match(jsx, /reducedMotion\(\) \? 18 : 34 \+ 290/)
  /* Nút giữa bị khoá khi requesting/spinning và khi hết lượt. */
  assert.match(jsx, /disabled=\{active \|\| loading \|\| !status \|\| \(!remaining && !pending\)\}/)
})

test('ring mobile: 7 ô + 6 gap khít bề rộng khung — không tràn ngang 320px', async () => {
  const pageCss = await readFile(new URL('./DailySpin.css', import.meta.url), 'utf8')
  /* Board dùng 7×1fr (không % cyclic trong track sizing) và ô aspect-ratio 1 —
     các ô co theo bề cột, không bao giờ tràn khung 320px. */
  assert.doesNotMatch(pageCss, /grid-template-columns:[^\n]*100%/,
    'không % cyclic trong track sizing')
  assert.match(pageCss, /\.spin-tile\s*\{[^}]*aspect-ratio:\s*1/)
  /* ≤480px: ẩn phụ đề ô + dòng độ hiếm (theo bản mẫu), chặt gap. */
  assert.match(pageCss, /@media \(max-width: 480px\)[\s\S]*?\.spin-tile small\s*\{[^}]*display:\s*none/)
  assert.match(pageCss, /@media \(max-width: 480px\)[\s\S]*?\.spin-cta\s*\{[^}]*padding/)
})
