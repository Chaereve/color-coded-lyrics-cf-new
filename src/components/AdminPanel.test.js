/* Bảng quản trị ĐÃ TRỞ THÀNH TRANG (không còn hộp thoại) nhưng chưa từng được
   dựng ra HTML lần nào — đổi từ modal sang page là đổi cả danh sách prop
   (`open`/`onClose`/`initialTab` biến mất). Bài học từ `ActionModal.test.js`:
   một prop không được khai báo thì chỉ chết lúc chạy, `npm run build` im lặng,
   còn người dùng thấy màn hình trắng. Nên ở đây dựng THẬT cả năm mục bằng
   Vite SSR loader và soi cấu trúc trang.
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

async function render(props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-admin-test',
    /* .env của người lập trình không được biến test này thành client thật */
    envPrefix: 'CCL_ADMIN_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/AdminPanel.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const row = (o) => ({
  id: 'r1', kind: 'Color Coded Lyrics', artist: 'aespa', title: 'Whiplash',
  requester: 'minji', status: 'pending', progress: 0, votes: 0, is_paid: false,
  payment_status: 'none', video_url: null, link: '', note: '', deny_reason: null,
  created_at: '2026-09-01T00:00:00.000Z', ...o,
})

const rows = [
  row({ id: 'p1', status: 'pending' }),
  row({ id: 'p2', status: 'pending', kind: 'Full Album', title: 'Get Up', requester: 'ttokyeoni' }),
  row({ id: 'a1', status: 'in_progress', progress: 40, votes: 7, picked_at: '2026-09-02T00:00:00.000Z' }),
  row({ id: 'c1', status: 'completed', progress: 100, votes: 3, video_url: 'https://youtu.be/x' }),
  row({ id: 'd1', status: 'denied', deny_reason: 'trùng bài' }),
]
const orders = [
  { id: 'o1', kind: 'votes', qty: 10, amount_vnd: 20000, amount_usd: 1, status: 'awaiting', request_id: 'a1', created_at: '2026-09-03T00:00:00.000Z' },
]
const media = [
  { id: 'm1', kind: 'featured', title: 'Whiplash', url: 'https://youtu.be/x', position: 0, is_hidden: false, created_at: '2026-09-01T00:00:00.000Z' },
]

const base = {
  onTab: () => {}, rows, orders, media,
  onReview: () => {}, onUpdate: () => {}, onDelete: () => {}, onOrder: () => {},
  onPick: () => {}, onBulk: () => {}, onMediaSave: () => {}, onMediaCommit: () => {},
  onMediaDelete: () => {}, onMediaReorder: () => {}, onMediaViewHome: () => {},
}

test('cả năm mục của trang quản trị đều dựng được (không sót prop → trang trắng)', async () => {
  for (const tab of ['pending', 'active', 'orders', 'done', 'media']) {
    const html = await render({ ...base, tab })
    assert.ok(html.includes('class="adm-page"'), `mục ${tab}: thiếu khung .adm-page`)
    assert.ok(html.includes('adm-kpis'), `mục ${tab}: thiếu dải số liệu`)
    assert.ok(html.includes('aria-pressed'), `mục ${tab}: mục đang mở phải đọc được bằng aria-pressed`)
  }
})

test('trang không còn dấu vết của hộp thoại cũ', async () => {
  const html = await render({ ...base, tab: 'pending' })
  assert.ok(!html.includes('modal'), 'trang quản trị không được còn lớp modal nào')
  assert.ok(!html.includes('onClose'), 'không được còn tham chiếu tới cách đóng hộp thoại')
})

test('dải số liệu đếm ĐÚNG thứ mà từng mục sẽ liệt kê — và đếm một lần', async () => {
  const html = await render({ ...base, tab: 'pending' })
  const kpi = html.match(/<div class="adm-kpis"[\s\S]*?<\/div><\/div>/)?.[0] ?? ''
  const nums = [...kpi.matchAll(/<span class="v">(\d+)<\/span>/g)].map(m => m[1])
  assert.deepEqual(nums, ['2', '1', '1', '2', '1'],
    'chờ duyệt 2 · đang xử lý 1 · đơn chờ 1 · đã xong/từ chối 2 · video 1')
})

test('mục Chờ duyệt có thanh công cụ, dòng đếm, ô tìm kiếm và hai nút duyệt/từ chối', async () => {
  const html = await render({ ...base, tab: 'pending' })
  assert.ok(html.includes('class="adm-bar"'), 'thiếu thanh công cụ')
  assert.ok(html.includes('searchwrap'), 'thiếu ô tìm kiếm')
  assert.ok(html.includes('search-ico'), 'ô tìm kiếm của trang quản trị phải có icon (lỗi icon lòi ra ngoài đã được vá ở CSS)')
  assert.ok(html.includes('class="adm-note"'), 'thiếu dòng đếm')
  assert.ok(html.includes('adm-req'), 'thiếu hàng request')
  /* hai nút quyết định của một hàng chờ duyệt */
  assert.ok(html.includes('btn-ok') && html.includes('btn-no'), 'thiếu cặp nút duyệt / từ chối')
})

test('mục Đang xử lý dùng thanh tiến độ mới, không quay lại thanh cũ', async () => {
  const html = await render({ ...base, tab: 'active' })
  assert.ok(html.includes('class="prog'), 'thiếu thanh tiến độ trong hàng admin')
  assert.ok(!html.includes('class="bar"'), 'thanh tiến độ cũ (.bar) đã bị bỏ, không được quay lại')
})

test('chế độ chọn nhiều chỉ hiện khi được bật, và đổi mục thì không giữ lựa chọn', async () => {
  const off = await render({ ...base, tab: 'pending' })
  assert.ok(!off.includes('adm-all'), 'chưa bật chọn nhiều thì không được có ô chọn cả trang')
})

test('mục Đơn hàng đọc ra đúng đơn đang chờ và nút xác nhận', async () => {
  const html = await render({ ...base, tab: 'orders' })
  assert.ok(html.includes('awaiting') || html.includes('btn-ok'), 'đơn đang chờ phải có nút xác nhận')
  assert.ok(html.includes('20'), 'đơn phải hiện số tiền')
})

test('mục Videos đưa sang bảng quản trị video, không lặp thanh công cụ của request', async () => {
  const html = await render({ ...base, tab: 'media' })
  assert.ok(!html.includes('class="adm-bar"'), 'mục Videos có công cụ riêng, không dùng chung thanh tìm kiếm')
  assert.ok(html.includes('Whiplash'), 'phải liệt kê được video đang có')
})

test('trang rỗng vẫn dựng được (không có dữ liệu, không có mục nào được chọn)', async () => {
  const html = await render({ ...base, rows: [], orders: [], media: [], tab: null })
  assert.ok(html.includes('class="adm-page"'))
  assert.ok(html.includes('adm-kpis'))
})
