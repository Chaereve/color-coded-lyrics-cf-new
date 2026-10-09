/* CASE OPENING REEL — dải case-opening NGANG của Mystery Box (và CHỈ của
   Mystery Box; Daily Spin dùng square grid riêng). Khoá hợp đồng: viewport
   overflow-hidden + marker giữa, dừng CHÍNH XÁC targetIndex dưới kim,
   transition transform duy nhất, identity-anchored onSettled, cleanup sạch. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function withVite(run) {
  const server = await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-reel-test',
    envPrefix: 'CCL_REEL_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try { return await run(server) } finally { await server.close() }
}

const ITEMS = [
  { kind: 's1', label: '+1' }, { kind: 'none', label: '—' }, { kind: 's2', label: '+3' },
  { kind: 's3', label: '+5', win: true }, { kind: 'none', label: '—' }, { kind: 's4', label: '+10' },
]

test('reel renders viewport + pointer + tiles; the winning tile is marked, not guessed', async () => {
  await withVite(async server => {
    const mod = await server.ssrLoadModule('/src/components/CaseOpeningReel.jsx')
    const CaseOpeningReel = mod.default
    const html = renderToStaticMarkup(createElement(CaseOpeningReel, {
      items: ITEMS, spinning: false, targetIndex: 3, duration: 3600,
      label: 'Daily mystery box', settled: true,
    }))
    assert.match(html, /class="reel-viewport"/)
    assert.match(html, /class="reel-pointer"/, 'kim giữa là một marker riêng')
    assert.equal((html.match(/class="reel-item /g) || []).length, ITEMS.length,
      'mỗi item MỘT tile, không nhân bản')
    assert.equal((html.match(/class="reel-item s3 is-win"/g) || []).length, 1,
      'đúng MỘT tile thắng — được truyền vào bằng props (win), không tự đoán')
    assert.match(html, /<b>\+5<\/b>/)
    /* Chỉ Mystery dùng component này — không tham chiếu spin/wheel. */
    assert.doesNotMatch(html, /spin-|wheel/)
  })
})

test('reel contract: duration default 3.6s, transform-only transition, exact target landing', async () => {
  const jsx = await readFile(new URL('./CaseOpeningReel.jsx', import.meta.url), 'utf8')
  const { REEL_TARGET_INDEX } = await import('../lib/mysteryBox.js')
  void REEL_TARGET_INDEX
  const css = await readFile(new URL('./CaseOpeningReel.css', import.meta.url), 'utf8')

  /* Hợp đồng thời gian: duration do MYSTERY truyền (3600); settle gọi sau khi
     transition kết thúc (+ đệm), qua ref — callback cha đổi identity mỗi
     render, không neo là cleanup vô hạn và reveal không bao giờ tới. */
  assert.equal(REEL_TARGET_INDEX, 21)
  assert.match(jsx, /duration = 3600/)
  assert.match(jsx, /setTimeout\(\(\) => onSettledRef\.current\?\.\(\), [^)]+\)/)
  assert.match(jsx, /const onSettledRef = useRef\(onSettled\)/)

  /* Dừng CHÍNH XÁC targetIndex dưới marker: offset tính từ viewport width THẬT
     (getBoundingClientRect) + gap thật (getComputedStyle) — không hằng số cứng
     lệch giữa các theme. Nhảy transform: transition none → reflow → rAF kép →
     transition transform. */
  assert.match(jsx, /getBoundingClientRect\(\)/)
  assert.match(jsx, /columnGap/)
  assert.match(jsx, /style\.transition = 'none'/)
  assert.match(jsx, /requestAnimationFrame\(\(\) => requestAnimationFrame/)
  assert.match(jsx, /cubic-bezier\(/, 'một đường cong giảm tốc duy nhất')
  assert.match(jsx, /translate3d/, 'chuyển động bằng transform (GPU, không reflow)')

  /* Cleanup: timeout settle bị xoá khi unmount — không gọi callback vào component
     chết, không leak. */
  /* Cleanup: cả rAF lẫn timeout settle bị huỷ khi unmount — không gọi
     callback vào component chết, không leak. */
  assert.match(jsx, /return \(\) => \{ cancelAnimationFrame\(raf\); clearTimeout\(timer\) \}/)

  /* CSS: viewport khóa khung (overflow hidden + chiều cao cố định), item bề
     rộng cố định qua CSS var, marker giữa KHÔNG che text chính. */
  assert.match(css, /\.reel-viewport \{[^}]*overflow:\s*hidden/)
  assert.match(css, /\.reel-item \{[^}]*flex:\s*0 0 var\(--reel-item-width/)
  assert.match(css, /\.reel-pointer \{[^}]*left:\s*50%/)
  /* Tile thắng nổi bật bằng glow hồng — vạch hiệu ứng không chỉ dựa màu cũng
     có: nền tile đổi (is-win có background riêng). */
  assert.match(css, /\.reel-item\.is-win \{[^}]*background:/)
  assert.match(css, /prefers-reduced-motion/)
})
