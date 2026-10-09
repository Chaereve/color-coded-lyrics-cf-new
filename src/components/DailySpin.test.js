/* Render the actual JSX with Vite's SSR loader, without running browser effects
   or connecting to Supabase. Guard the SQUARE GRID SPINNER (spec 2026-10-09)
   against regressions: a 3×3 grid of eight border cells + a REAL Spin button
   in the center cell, ZERO odds/percentages anywhere, and NO wheel or
   horizontal reel leftovers (the reel belongs to the Mystery Box only). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('Daily Spin renders head, 3×3 grid hero with center Spin button — no odds UI', async () => {
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

    /* KHÔNG wheel tròn, KHÔNG reel ngang — hai UI đó bị cấm cho Spin
       (grid-only). Không dùng img/svg sector/canvas. */
    assert.doesNotMatch(html, /<img\b|<canvas\b|<svg\b|spin-wheel|spin-sector|reel-track|reel-item/)
    assert.doesNotMatch(html, /<image\b|logo-\d|spin-intro|spin-eyebrow/)

    // 1. head: title, demo badge and the reset countdown chip (not buried below)
    const head = html.match(/<header class="spin-head">([\s\S]*?)<\/header>/)?.[1]
    assert.ok(head, 'the section needs a head band')
    assert.match(head, /Daily bonus spin/)
    assert.match(head, /Next reset/)
    assert.match(head, /--:--:--/)

    // 2. ZERO odds in the UI: no percentage anywhere, no legend, no odds table,
    //    and the grid's own accessible name stays percent-free too.
    assert.doesNotMatch(html, /\d+%/, 'không phần trăm nào được in trên UI spin')
    assert.doesNotMatch(html, /spin-legend|spin-odds|odds table/i)

    // 3. THE GRID: exactly 8 border cells + 1 center cell, 3×3 (9 children),
    //    seven "+N" rewards each EXACTLY once, ONE accent gem (no number).
    assert.ok(html.includes('class="spin-grid"'), 'grid hero must exist')
    const cells = [...html.matchAll(/class="spin-cell (t\d|accent)(?: is-[a-z]+)?"/g)]
    assert.equal(cells.length, 8, 'đúng 8 ô viền')
    assert.equal((html.match(/class="spin-cell accent(?: |")/g) || []).length, 1,
      'đúng MỘT ô accent — không phải giải thứ 8')
    assert.equal((html.match(/class="spin-cell-gem"/g) || []).length, 1,
      'accent phân biệt bằng hình thoi, không bằng màu')
    const numbers = [...html.matchAll(/class="spin-cell-num"[^>]*>(\+\d+)</g)].map(m => m[1])
    assert.deepEqual(numbers.sort(), ['+1', '+10', '+2', '+20', '+3', '+5', '+8'].sort(),
      'bảy giải, mỗi mức đúng một ô — không nhân đôi')
    // Ô giữa là NÚT QUAY thật (button, không phải span trang trí).
    const center = html.match(/<div class="spin-grid-center">([\s\S]*?)<\/div>/)?.[1]
    assert.ok(center?.includes('<button'), 'ô giữa phải là button thật')
    assert.match(center || '', /class="btn btn-primary spin-button"/)
    /* Lúc SSR trang đang loading → nhãn "Loading…"; quan trọng là NÚT THẬT
       (type=button, nhãn qua aria-label) chứ không phải chữ cụ thể. */
    assert.match(center || '', /<button type="button"[^>]*aria-label=/)
    // Nút nằm TRONG lưới (giữa 8 ô), không phải cột phụ.
    const gridOpen = html.indexOf('class="spin-grid"')
    const centerOpen = html.indexOf('class="spin-grid-center"')
    const gridClose = html.indexOf('</section>')
    assert.ok(gridOpen !== -1 && centerOpen !== -1 && gridOpen < centerOpen && centerOpen < gridClose,
      'nút QUAY nằm giữa lưới')

    // 4. side column EXACTLY four things: remaining · latest result (live) ·
    //    short history · vote link. No odds table, no wallet metrics, no rules.
    const panel = html.match(/<aside class="spin-panel">([\s\S]*?)<\/aside>/)?.[1]
    assert.ok(panel)
    assert.match(panel, /Spins left today/)
    const pips = panel.match(/<span class="spin-pips"[^>]*>([\s\S]*?)<\/span>/)?.[1]
    assert.equal((pips?.match(/<i /g) || []).length, 2, 'two daily slots, drawn as a bar')
    assert.match(panel, /class="spin-result[^"]*" role="status" aria-live="polite"/,
      'một vùng live duy nhất đọc trạng thái + kết quả')
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

test('Daily Spin uses the approved palette on the grid and opts out of the shared background', async () => {
  const [pageCss, siteCss, jsx] = await Promise.all([
    readFile(new URL('./DailySpin.css', import.meta.url), 'utf8'),
    readFile(new URL('../index.css', import.meta.url), 'utf8'),
    readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8'),
  ])
  /* Bảy tông = đúng bảng màu đã duyệt; các ô dùng gradient tím/hồng theo spec
     grid spinner (cell thường gradient, active glow hồng, +20 đậm nhất). */
  for (const hex of ['#FCB0F3', '#DC94EF', '#BC77EC', '#9D5BE8', '#7D3EE4', '#5D22E1', '#3D05DD']) {
    assert.ok(pageCss.includes(hex), `palette thiếu ${hex}`)
  }
  /* Ô giải: gradient; +20 (t7) gradient đậm + viền nổi. */
  assert.match(pageCss, /\.spin-cell\s*\{[^}]*background:\s*linear-gradient/)
  assert.match(pageCss, /\.spin-cell\.t7\s*\{[^}]*linear-gradient/)
  assert.match(pageCss, /\.spin-cell\.t7\s*\{[^}]*border-color:\s*#FCB0F3/)
  /* Active/won: viền + glow (không chỉ đổi màu), không áp lên nút giữa. */
  assert.match(pageCss, /\.spin-cell\.is-active,\s*\.spin-cell\.is-won\s*\{[^}]*box-shadow/)
  assert.match(pageCss, /\.spin-cell\.is-active,\s*\.spin-cell\.is-won\s*\{[^}]*border-color:\s*#FCB0F3/)
  /* Ô accent: HOẠ TIẾT khác hẳn (gem hình thoi trong JSX + nền dashed ở CSS). */
  assert.match(jsx, /spin-cell-gem/)
  assert.match(pageCss, /\.spin-cell\.accent\s*\{[^}]*border:\s*1px dashed/)
  /* Nút QUAY #3D05DD, focus ring thấy được, disabled mờ đi. */
  assert.match(pageCss, /\.daily-spin \.spin-button\s*\{[^}]*background:\s*#3D05DD/)
  assert.match(pageCss, /\.daily-spin \.spin-button:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  assert.match(pageCss, /\.daily-spin \.spin-button:disabled\s*\{[^}]*cursor:\s*not-allowed/)
  /* Kích thước ô qua CSS var + clamp() — không tràn mobile. */
  assert.match(pageCss, /--cell:\s*clamp\(/)
  assert.match(pageCss, /grid-template-columns:\s*repeat\(3,\s*var\(--cell\)\)/)
  /* Reduced motion: tắt nhô/zoom, giữ viền + glow tĩnh (trạng thái vẫn đọc được). */
  assert.match(pageCss, /prefers-reduced-motion[\s\S]*\.spin-cell[\s\S]*transition:\s*none/)
  /* Vẫn tắt nền động dùng chung của trang spin. */
  assert.match(siteCss, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/)
})

/* ---------- GRID SPINNER — luật chạy (source-level contract) ---------- */

test('grid: 8 ô = 7 giải + 1 accent, vệt chạy theo chiều kim đồng hồ, accent không bao giờ là ô dừng', async () => {
  const { SPIN_GRID_CELLS, SPIN_GRID_RENDER_ORDER, spinCellForReward, SPIN_REWARDS } =
    await import('../lib/dailySpin.js')
  assert.equal(SPIN_GRID_CELLS.length, 8)
  const accent = SPIN_GRID_CELLS.filter(c => c.reward === null)
  assert.equal(accent.length, 1, 'đúng MỘT ô accent')
  assert.equal(accent[0].type, 'accent')
  /* 7 giải thật = đúng bảng server, mỗi mức ĐÚNG MỘT ô. */
  const rewards = SPIN_GRID_CELLS.map(c => c.reward).filter(r => r !== null).sort((a, b) => a - b)
  assert.deepEqual(rewards, [...SPIN_REWARDS], '7 ô giải = đúng 7 mức server, không nhân đôi')
  /* Mọi mức giải đều map ra ĐÚNG MỘT ô; accent không thể là kết quả. */
  for (const reward of SPIN_REWARDS) {
    const hits = SPIN_GRID_CELLS.filter(c => c.reward === reward)
    assert.equal(hits.length, 1, `mức ${reward} phải có đúng một ô`)
    assert.equal(spinCellForReward(reward), hits[0].index)
  }
  /* VỊ TRÍ HÌNH HỌC theo index spec (row-major, nút giữa ở slot 4):
     0 TL · 1 TM · 2 TR · 3 MR · 4 BR(accent) · 5 BM · 6 BL · 7 ML. */
  const slots = SPIN_GRID_RENDER_ORDER.map((cellIndex, slot) => ({ cellIndex, row: Math.floor(slot / 3), col: slot % 3 }))
  const pos = Object.fromEntries(slots.map(s => [s.cellIndex, [s.row, s.col]]))
  assert.deepEqual(pos[0], [0, 0]); assert.deepEqual(pos[1], [0, 1]); assert.deepEqual(pos[2], [0, 2])
  assert.deepEqual(pos[3], [1, 2]); assert.deepEqual(pos[4], [2, 2]); assert.deepEqual(pos[5], [2, 1])
  assert.deepEqual(pos[6], [2, 0]); assert.deepEqual(pos[7], [1, 0])
  /* Ô giữa (slot 4) là nút — sentinel null, không có ô giải nào rơi slot giữa. */
  assert.equal(SPIN_GRID_RENDER_ORDER.length, 9)
  assert.equal(SPIN_GRID_RENDER_ORDER[4], null)
  assert.ok(!SPIN_GRID_RENDER_ORDER.includes(-1))
})

test('spin(): server-decides-first, tối thiểu 3 vòng, dừng đúng ô trúng, cleanup sạch', async () => {
  const jsx = await readFile(new URL('./DailySpin.jsx', import.meta.url), 'utf8')
  /* Server trả xong mới có kế hoạch decel — client KHÔNG chọn giải.
     (Neo vào CODE, không phải comment: comment nói về quy ước, code mới là
     điều kiện cần.) */
  assert.match(jsx, /performDailySpin\(requestId, userId\)/, 'giải đến từ RPC server')
  assert.match(jsx, /const winIndex = spinSectorIndex\(data\.spin\.segment, rewards\)/,
    'ô trúng quy đổi từ segment SERVER trả về')
  assert.doesNotMatch(jsx, /=\s*Math\.random\(/, 'cấm random client quyết giải')
  assert.match(jsx, /planRef\.current = null/, 'mỗi lượt quay bắt đầu không có kế hoạch')
  assert.match(jsx, /planRef\.current = \{ winCell \}[\s\S]*?fastLoop/,
    'server trả winCell TRƯỚC, vòng nhanh đọc sau')
  assert.match(jsx, /const MIN_LOOPS = 3/, 'tối thiểu 3 vòng trước khi giảm tốc')
  assert.match(jsx, /stepsRef\.current >= MIN_STEPS/)
  /* Ô dừng = ô giải duy nhất của mức server trả (spinCellForReward ném lỗi
     nếu mức lạ — accent không thể trúng vì không phải mức nào). */
  assert.match(jsx, /spinCellForReward\(rewards\[winIndex\], rewards\)/)
  /* Lỗi: dừng an toàn + trả nút + không giữ ô sáng. */
  assert.match(jsx, /stopRun\(\)[\s\S]*?setPhase\('idle'\)/)
  /* Cleanup: mọi timeout nhịp chạy bị xoá khi unmount. */
  assert.match(jsx, /useEffect\(\(\) => \(\) => \{ mounted\.current = false; clearSpinTimers\(\) \}, \[\]\)/)
  /* Khóa chống double-submit ngay đầu spin(). */
  assert.match(jsx, /if \(busy\.current \|\| !status \|\| \(!status\.remaining && !pending\)\) return/)
  /* Reduced-motion/replay: bỏ vòng chạy, hiện đúng kết quả ngay. */
  assert.match(jsx, /reducedMotion\(\) \|\| data\.replayed/)
  /* Nút giữa bị khoá khi requesting/spinning và khi hết lượt. */
  assert.match(jsx, /disabled=\{active \|\| loading \|\| !status \|\| \(!remaining && !pending\)\}/)
})

test('grid mobile: 3 ô + 2 gap khít bề rộng khung — không tràn ngang 320px', async () => {
  const pageCss = await readFile(new URL('./DailySpin.css', import.meta.url), 'utf8')
  /* (100vw − padding trang 16px − 2 gap 16px) / 3 → 3 ô + 2 gap khít khung.
     KHÔNG quay lại 100%: % trong track sizing của grid item là cyclic —
     Chrome resolve sai, panel đè hàng cuối ở 320px (bug đã chụp). */
  assert.match(pageCss, /--cell:\s*clamp\(62px,\s*calc\(\(100vw - 32px\) \/ 3\),\s*104px\)/,
    '3 × cell + 2 × 8px gap = đúng bề rộng khung — không bao giờ tràn')
  assert.doesNotMatch(pageCss, /grid-template-columns:[^\n]*100%/,
    'không % cyclic trong track sizing')
  assert.match(pageCss, /@media \(max-width: 880px\)[\s\S]*grid-template-columns:\s*1fr/,
    'panel rơi xuống dưới lưới trên mobile')
})
