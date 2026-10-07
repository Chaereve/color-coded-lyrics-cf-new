/* Khối "không tải được" dùng chung — ba điều phải giữ, vì cả ba từng sai:
     1. LUÔN là `role="alert"` và LUÔN có nút: một khối lỗi không có đường
        bấm tiếp là ngõ cụt (người dùng phải tự đoán ra F5).
     2. Chữ mặc định vẫn là câu CỦA BẢNG (`board.loadErr`) — chuyển khối này
        ra file riêng không được đổi câu người dùng đang thấy ở bảng request.
     3. Vùng khác (dải video, trang cá nhân) truyền câu chung `err.block*`, và
        nút thật sự gọi `onRetry`.
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
    cacheDir: 'node_modules/.vite-loaderr-test',
    envPrefix: 'CCL_LOADERR_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/LoadErr.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

test('mặc định giữ nguyên câu của bảng (chỗ gọi cũ không đổi chữ)', async () => {
  const html = await render({ onRetry: () => {} })
  assert.match(html, /role="alert"/)
  assert.match(html, /load-err/)
  assert.ok(plain(html).includes('Could not load the board'), plain(html))
  assert.ok(plain(html).includes('Try again'), plain(html))
})

test('vùng khác truyền câu chung, và nút luôn có mặt', async () => {
  const KEYS = { titleKey: 'err.blockTitle', bodyKey: 'err.blockBody', retryKey: 'err.blockRetry' }
  const html = await render({ onRetry: () => {}, ...KEYS })
  const text = plain(html)
  assert.ok(text.includes('This section could not load'), text)
  assert.ok(!text.includes('Could not load the board'), 'câu của bảng không được rò sang vùng khác')
  assert.ok(text.includes('Try again'), text)
  assert.match(html, /<button[^>]*type="button"/)
})

test('khoá chữ truyền vào phải có thật trong từ điển (không in ra khoá trần)', async () => {
  const html = await render({ onRetry: () => {}, titleKey: 'err.blockTitle', bodyKey: 'err.blockBody', retryKey: 'err.blockRetry' })
  for (const key of ['err.blockTitle', 'err.blockBody', 'err.blockRetry']) {
    assert.ok(!html.includes(key), `khoá trần ${key} lọt ra HTML — thiếu bản dịch`)
  }
})
