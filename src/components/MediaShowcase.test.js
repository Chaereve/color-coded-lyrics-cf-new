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
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
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

test('đã có video + ready: vẫn vẽ sân khấu và dải mục lục như cũ', async () => {
  const videos = [V('aaa', 'Song A — Artist'), V('bbb', 'Song B — Artist')]
  const html = await render({ videos, state: 'ready' })
  assert.match(html, /pick-stage/)
  assert.match(html, /pvlist/)
  assert.match(html, /pick-nav next/)
})
