/* Dải video trang chủ: BA trạng thái, ba câu KHÁC NHAU.
   ---------------------------------------------------------
   Lỗi từng có (audit 07/10/2026): `loadMedia` nuốt lỗi, state `media` ở lại
   `[]`, nên mất mạng là dải video in "No videos here yet." — người xem kết
   luận sai về kênh ("chưa đăng video nào") và không có gì để bấm. Bài này
   chốt bốn điều:
     1. `state="loading"` → khối xương, KHÔNG phải câu rỗng;
     2. `state="error"` → `role="alert"` + nút thử lại, KHÔNG phải câu rỗng;
     3. `state="ready"` + rỗng thật → câu rỗng cũ (không đổi chữ);
     4. đã có video thì lỗi KHÔNG được xoá nội dung đang xem (không nhảy về rỗng).
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const componentSource = readFileSync(new URL('./MediaShowcase.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
let server

async function render (props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-media-test',
    envPrefix: 'CCL_MEDIA_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/MediaShowcase.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const V = (key, title) => ({ key, id: key, title, url: `https://youtu.be/${key}` })
const EMPTY_TEXT = 'No videos here yet.'

test('đang tải: hiện khối xương, không nói "chưa có video nào"', async () => {
  const html = await render({ videos: [], state: 'loading', onRetry: () => {} })
  assert.match(html, /role="status"/)
  assert.match(html, /sklist/)
  assert.ok(!plain(html).includes(EMPTY_TEXT), 'đang tải mà đã nói rỗng — câu sai')
})

test('lỗi: alert + nút thử lại, không nói "chưa có video nào"', async () => {
  const html = await render({ videos: [], state: 'error', onRetry: () => {} })
  assert.match(html, /role="alert"/)
  const text = plain(html)
  assert.ok(text.includes('This section could not load'), text)
  assert.ok(text.includes('Try again'), 'khối lỗi phải có nút bấm tiếp')
  assert.ok(!text.includes(EMPTY_TEXT), 'lỗi mà nói rỗng — câu sai và không có đường sửa')
})

test('rỗng thật (ready): giữ nguyên câu cũ, và không có alert', async () => {
  const html = await render({ videos: [], state: 'ready', onRetry: () => {} })
  assert.ok(plain(html).includes(EMPTY_TEXT), plain(html))
  assert.ok(!html.includes('role="alert"'), 'rỗng thật không phải lỗi')
})

test('đã có video: lỗi làm mới KHÔNG xoá nội dung đang xem', async () => {
  const videos = [V('aaa', 'Song A — Artist'), V('bbb', 'Song B — Artist')]
  const html = await render({ videos, state: 'error', onRetry: () => {} })
  const text = plain(html)
  assert.ok(text.includes('Song A — Artist'), 'video đang xem bị xoá vì một lần làm mới hỏng')
  assert.ok(!text.includes('This section could not load'), 'còn nội dung thì không dựng bảng lỗi đè lên')
})

test('đã có video: dựng showcase 16:9, nút YouTube, dải chọn và điều hướng', async () => {
  const videos = [V('aaa', 'Song A — Artist'), V('bbb', 'Song B — Artist')]
  const html = await render({ videos, state: 'ready' })
  assert.match(html, /pick-showcase-head/)
  assert.match(html, /pick-stage/)
  assert.match(html, /pick-info/)
  assert.match(html, /pick-watch/)
  assert.match(html, /pvlist/)
  assert.match(html, /pvrow on/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /pick-nav next/)
  assert.doesNotMatch(html, /class="playbtn/)
})

test('dải video rộng bằng khung trên và fade tối theo vị trí cuộn', async () => {
  const html = await render({ videos: [V('aaa', 'Song A — Artist'), V('bbb', 'Song B — Artist')], state: 'ready' })
  assert.match(html, /class="pick-side"/)
  assert.match(css, /\.pick-showcase \.pick-side\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none/,
    'không được chặn chiều ngang dải bằng max-width nhỏ hơn khung showcase')
  assert.match(css, /flex:\s*0 0 clamp\(232px, 20vw, 300px\)/,
    'thẻ phải gọn, không phình thành ba thẻ khổng lồ trên màn rộng')
  assert.match(css, /\.pick-showcase \.pvlist\s*\{[^}]*scrollbar-width:\s*none/,
    'ẩn thanh cuộn thô; fade là tín hiệu cuộn')
  assert.match(css, /-webkit-line-clamp:\s*2/,
    'mọi tiêu đề dừng ở hai dòng để thẻ giữ cùng chiều cao')
  assert.match(componentSource, /scrollWidth - strip\.clientWidth/,
    'dải phải đo phần còn cuộn được thay vì luôn hiện fade')
  assert.match(componentSource, /strip\.addEventListener\('scroll', measure/,
    'fade phải được cập nhật khi người dùng kéo dải')
  assert.match(componentSource, /behavior:\s*'auto'/,
    'chọn video phải căn dải ngay, không để thẻ/fade chạy theo trễ sau video')
  assert.match(componentSource, /useIsoLayoutEffect\(\(\) => \{[\s\S]*?strip\.scrollTo/,
    'căn dải đồng bộ trước khi vẽ frame mới để không lóe vị trí video cũ')
  assert.match(componentSource, /\}, \[at, n, cur\?\.key \?\? cur\?\.id\]\)/,
    'phải căn lại nếu danh sách đổi thứ tự nhưng vị trí số vẫn như cũ')
  assert.doesNotMatch(componentSource, /behavior:\s*reduce\s*\?\s*'auto'\s*:\s*'smooth'/)
  assert.match(css, /\.pick-showcase \.pick-side\.fade-left::before/)
  assert.match(css, /\.pick-showcase \.pick-side\.fade-right::after/)
  assert.match(css, /\.pick-showcase \.pick-side::before,[\s\S]*?transition:\s*none/,
    'fade phải xuất hiện ngay khi cuộn, không chờ animation opacity')
  assert.match(css, /background:\s*linear-gradient\(90deg, rgba\(8, 10, 15, \.96\)/,
    'fade hai cạnh phải tối dần ra trong suốt')
})

test('chỉ sân khấu video latest update có transition vào; dải video không chạy animation đó', () => {
  assert.match(css, /\.pick-showcase \.pick-stage\s*\{[^}]*animation:\s*latestHeroEnter[^;]*;[^}]*transition:\s*none;/,
    'sân khấu video chính có chuyển cảnh ngắn khi đổi video')
  assert.match(css, /@keyframes latestHeroEnter\s*\{[^}]*opacity:\s*\.55;[^}]*transform:\s*scale\(\.99\)/,
    'chuyển cảnh chỉ fade/scale nhẹ trên sân khấu video')
  const rail = css.match(/\.pick-showcase \.pvrow\s*\{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(rail, /animation:\s*latestHeroEnter/,
    'dãy Latest update không được dùng transition vào của video chính')
  assert.match(css, /\.pick-showcase \.mthumb > img\s*\{[^}]*opacity:\s*1 !important;[^}]*transition:\s*none !important;/,
    'ảnh video hiện ngay khi tải xong, không chạy transition opacity riêng')
  assert.match(css, /\.pick-copy\s*\{[^}]*animation:\s*none;/,
    'tiêu đề không có transition vào riêng')
  assert.match(css, /\.pick-showcase \.pick-watch\s*\{[^}]*animation:\s*none;/,
    'nút mở video không có transition vào riêng')
})
