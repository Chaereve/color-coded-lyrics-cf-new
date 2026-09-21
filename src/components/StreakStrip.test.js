/* DẢI STREAK — dựng THẬT ra HTML để chốt những thứ chỉ thấy khi render:
   badge sáng/tối đúng theo chuỗi dài nhất, tooltip mang luật và mốc, và
   `days === null` (chưa chạy migration / lỗi mạng) thì khối TỰ ẨN chứ không
   nói dối rằng người ta chưa hoạt động ngày nào.
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server

/* không đóng server là node:test treo mãi (bài học từ Leaderboard.test.js) */
after(async () => { await server?.close() })

async function render(props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-streak-test',
    envPrefix: 'CCL_STREAK_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/StreakStrip.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

/* thứ Hai 22/09 giờ VN; bảy dấu 15→21/09 = chuỗi 7 ngày còn sống */
const NOW = Date.parse('2025-09-21T17:30:00Z')
const seq = (from, n) => Array.from({ length: n }, (_, i) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10))

test('chuỗi 7 ngày: số hiện tại, chuỗi dài nhất, và badge 7 SÁNG còn 30/100 mờ', async () => {
  const html = await render({ days: seq('2025-09-15', 7), now: NOW })
  assert.ok(html.includes('7-day streak'), 'số chuỗi hiện tại phải in ra')
  assert.ok(html.includes('longest 7'), 'chuỗi dài nhất phải in ra')
  const badges = [...html.matchAll(/class="streak-mile( got)?"/g)].map((m) => m[1] === ' got')
  assert.deepEqual(badges, [true, false, false], 'đúng badge 7 sáng, 30 và 100 mờ')
  /* tooltip badge: cái sáng nói "đã mở", cái mờ nói còn thiếu bao xa */
  assert.ok(html.includes('Unlocked: 7-day streak'))
  assert.ok(html.includes('Reach a 30-day streak to unlock'))
  /* luật đếm nằm trong tooltip ngọn lửa, không chiếm chỗ trên dải */
  assert.ok(html.includes('Vietnam time'))
})

test('chuỗi dài nhất 30 ngày dù hiện tại đã đứt: badge 7+30 vẫn sáng', async () => {
  const html = await render({ days: [...seq('2025-07-01', 30), '2025-09-10'], now: NOW })
  const badges = [...html.matchAll(/class="streak-mile( got)?"/g)].map((m) => m[1] === ' got')
  assert.deepEqual(badges, [true, true, false], 'mốc đã mở không tắt lại khi chuỗi đứt')
  assert.ok(!html.includes('-day streak<'), 'chuỗi hiện tại đứt thì không in số chuỗi')
  assert.ok(html.includes('No active day yet'), 'và phải nói thật là chưa có ngày nào trong chuỗi mới')
})

test('mảng rỗng là sự thật "chưa bắt đầu", còn null là "không đọc được nguồn" — một bên hiện, một bên ẩn', async () => {
  const empty = await render({ days: [], now: NOW })
  assert.ok(empty.includes('streak'), 'mảng rỗng vẫn dựng dải: chưa hoạt động là một câu trả lời thật')
  assert.ok(empty.includes('No active day yet'))
  const badges = [...empty.matchAll(/class="streak-mile( got)?"/g)]
  assert.equal(badges.length, 3, 'ba mốc vẫn hiện mờ để người xem thấy đích')

  const hidden = await render({ days: null, now: NOW })
  assert.ok(!hidden.includes('streak'), 'null = chưa chạy migration/lỗi mạng: dải tự ẩn, không nói dối')
})
