/* Bảng thông báo phải SỐNG SÓT với dữ liệu xấu.
   ---------------------------------------------------------
   Hộp thư nằm trong `localStorage` và được nhiều phiên trước để lại: một bản
   cũ ghi `at` kiểu khác, một tin bị cắt giữa chừng, một hàng không còn `status`
   — tất cả đều có thể xảy ra mà không cần ai cố tình làm sai. Chỉ một dòng
   `new Date(rác).toISOString()` lọt vào JSX là React gỡ bỏ CẢ cây: người dùng
   bấm chuông rồi thấy màn hình đen (đúng loại lỗi đã xảy ra với hộp "New
   request" ở commit de72589). File này dựng bảng bằng props xấu để chứng minh
   nó không sập và không in chữ rác.
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server
const AT = Date.UTC(2026, 8, 8, 12)

async function render(props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-notify-test',
    envPrefix: 'CCL_NOTIFY_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const { default: Notifications } = await server.ssrLoadModule('/src/components/Notifications.jsx')
  return renderToStaticMarkup(h(I18nProvider, null, h(Notifications, props)))
}
after(async () => { await server?.close() })

const notice = (o) => ({ id: 'n', key: 'k', type: 'approved', at: AT, title: 'X', artist: 'Y', ...o })
const JUNK = /undefined|NaN|\[object Object\]|\b(?:nt|now|adm|row|status|time)\.[a-z][a-z0-9_]*\b/
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const cases = [
  ['mở mà không có props nào', { open: true }],
  ['tin thiếu key, không có rowsByKey', { open: true, notices: [notice({ key: null })] }],
  ['`at` là chuỗi không phải ngày', { open: true, notices: [notice({ at: 'không-phải-ngày' })] }],
  ['`at` là null', { open: true, notices: [notice({ at: null })] }],
  ['title null, votes null', { open: true, notices: [notice({ title: null, artist: undefined, votes: null })] }],
  ['nhóm need, rowsByKey rỗng', {
    open: true, notices: [notice({ type: 'near' })], rowsByKey: new Map(), rank: new Map(),
  }],
  ['row không có status', {
    open: true, notices: [notice({ type: 'lead' })],
    rowsByKey: new Map([['k', { id: 'r', artist: 'Y', title: 'X', votes: 3 }]]),
  }],
  ['mọi callback đều vắng mặt', { open: true, notices: [notice()], rowsByKey: new Map() }],
  ['1000 tin một lúc', {
    open: true,
    notices: Array.from({ length: 1000 }, (_, i) => notice({ id: `i${i}`, key: `k${i}`, at: AT + i })),
  }],
  ['tab cài đặt mà prefs null', { open: true, startTab: 'prefs', prefs: null, notices: [] }],
]

for (const [name, props] of cases) {
  test(`không sập: ${name}`, async () => {
    const html = await render(props)
    assert.ok(html.length > 300, `${name}: cây rỗng nghĩa là component đã chết thầm`)
    assert.ok(!JUNK.test(plain(html)), `${name}: chữ rác lọt ra màn hình — ${plain(html).match(JUNK)?.[0]}`)
  })
}

test('kiểu xấu vẫn còn nguyên những thứ phải có', async () => {
  const html = await render({ open: true, notices: [notice({ at: 'rac' })] })
  const tx = plain(html)
  assert.match(tx, /X/)
  assert.match(tx, /Needs your votes/)          // vẫn gom nhóm đúng
  assert.match(tx, /just now|now/, 'ngày hỏng thì lùi về nhãn "just now", không được in NaN')
})
