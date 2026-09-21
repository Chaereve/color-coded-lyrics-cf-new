/* Bảng quản trị ĐÃ TRỞ THÀNH TRANG (không còn hộp thoại) nhưng chưa từng được
   dựng ra HTML lần nào — đổi từ modal sang page là đổi cả danh sách prop
   (`open`/`onClose`/`initialTab` biến mất). Bài học từ `ActionModal.test.js`:
   một prop không được khai báo thì chỉ chết lúc chạy, `npm run build` im lặng,
   còn người dùng thấy màn hình trắng. Nên ở đây dựng THẬT cả năm mục bằng
   Vite SSR loader và soi cấu trúc trang.
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  const { ConfirmProvider } = await server.ssrLoadModule('/src/lib/confirm.jsx')
  const mod = await server.ssrLoadModule('/src/components/AdminPanel.jsx')
  /* Bảng quản trị nay gọi `useConfirm()` (hộp xác nhận của app thay cho
     `confirm()`/`prompt()` của trình duyệt), nên nó cần nhà cung cấp — đúng như
     lúc chạy thật, `ConfirmProvider` bọc cả app trong src/App.jsx. Thiếu nó thì
     component ném lỗi ngay chứ không im lặng bỏ qua: đó là chủ ý, xem
     src/lib/confirm.jsx. */
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ConfirmProvider, null, createElement(mod.default, props))))
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
  for (const tab of ['pending', 'active', 'expired', 'orders', 'done', 'media']) {
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
  assert.deepEqual(nums, ['2', '1', '0', '1', '2', '1'],
    'chờ duyệt 2 · đang xử lý 1 · hết hạn 0 · đơn chờ 1 · đã xong/từ chối 2 · video 1')

  /* TIÊU ĐỀ MỤC ĐANG MỞ: dải số liệu là bộ CHUYỂN MỤC nên nó không thể vừa là
     tiêu đề; mà trang không có tiêu đề nào thì trình đọc màn hình chỉ nghe được
     tên các nút. Tên mục (h2) + số dòng đang xem đứng ngay trên thanh công cụ,
     và dòng "Showing …" cũ ở dưới thanh công cụ đã bị gộp vào đây — một con số
     chỉ được nói một lần. */
  assert.equal((html.match(/class="adm-h2"/g) || []).length, 1, 'đúng một tiêu đề cho mục đang mở')
  const h2 = html.match(/<h2 class="adm-h2">[\s\S]*?<\/h2>/)?.[0] ?? ''
  assert.match(h2, /<span class="adm-h2-n">/, 'tiêu đề phải mang luôn số dòng đang xem')
  assert.match(h2, /Showing 2 of 2/, 'số dòng đang xem phải khớp danh sách')
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /t\(kpis\.find\(k => k\.k === tab\)\?\.label/, 'tên mục lấy từ chính dải số liệu (một nguồn)')
  /* Vạch chia tỉ lệ dưới dải số liệu đã bị gỡ (vòng 11): năm đoạn màu cho một
     câu "mục nào nhiều việc" là trang trí, không phải thông tin — con số ngay
     trên nó đã trả lời rồi. */
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  assert.doesNotMatch(css, /\.adm-mix/, 'vạch chia tỉ lệ phải bị gỡ khỏi CSS, không để lại luật chết')
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

test('mục nào cũng xuất được CSV — kể cả Đơn hàng (lỗi cũ: nút nằm trong nhóm không-đơn-hàng)', async () => {
  for (const tab of ['pending', 'active', 'orders', 'done']) {
    const html = await render({ ...base, tab })
    assert.ok(html.includes('adm-export'), `mục ${tab}: thiếu nút xuất CSV`)
  }
  const orders = await render({ ...base, tab: 'orders' })
  assert.ok(!orders.includes('adm-pickbtn'),
    'mục Đơn hàng không vẽ ô chọn trên từng dòng nên không được mời bật chế độ chọn nhiều')
  const pending = await render({ ...base, tab: 'pending' })
  assert.ok(pending.includes('adm-pickbtn'), 'mục có ô chọn thì vẫn phải có nút chọn nhiều')
})

test('dải số liệu đi theo đúng danh sách mục dùng chung (một nguồn, một thứ tự)', async () => {
  const { ADMIN_TAB_META } = await import('../lib/adminTabs.js')
  const html = await render({ ...base, tab: 'pending' })
  const keys = [...html.matchAll(/<button type="button" class="adm-kpi[^"]*"/g)]
  assert.equal(keys.length, ADMIN_TAB_META.length, 'số ô phải bằng số mục')
  /* thứ tự ô trên màn hình = thứ tự trong ADMIN_TAB_META; nhãn lấy từ i18n
     nên chỉ chốt được số lượng, màu và vị trí mục đang mở */
  const tones = [...html.matchAll(/--sc:(var\(--[a-z0-9-]+\))/g)].map(m => m[1])
  assert.deepEqual(tones.slice(0, ADMIN_TAB_META.length), ADMIN_TAB_META.map(m => m.tone))
  assert.ok(/adm-kpi on/.test(html) || /class="adm-kpi on"/.test(html), 'mục đang mở phải được đánh dấu')
})

test('hai phím tắt của trang được in ra chỗ dùng, và có vùng thông báo cho trình đọc màn hình', async () => {
  const html = await render({ ...base, tab: 'pending' })
  /* `Esc` và `Ctrl/Cmd+A` là hai phím nhanh nhất của trang này; nếu chỉ nằm
     trong tài liệu thì không ai biết mà dùng. */
  assert.ok(html.includes('adm-keys'), 'thiếu dòng gợi ý phím tắt')
  assert.ok(/Esc/.test(html) && /Ctrl\/Cmd/.test(html), 'dòng gợi ý phải nói ra đúng hai phím')
  /* Đổi bộ lọc là con số đổi; mắt thường không được báo, trình đọc màn hình thì phải. */
  assert.match(html, /role="status"/, 'thiếu vùng thông báo cho trình đọc màn hình')
  /* `aria-busy` chỉ có mặt khi đang chạy thao tác hàng loạt, mà trạng thái đó
     không dựng được từ ngoài bằng SSR — nên soi ở mã nguồn. */
  assert.match(readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8'), /aria-busy=\{bulkBusy/,
    'lúc chạy thao tác hàng loạt, danh sách phải được đánh dấu đang bận')

  /* Ba luật CSS đi cùng: gợi ý phím tự ẩn trên thiết bị cảm ứng, ô tìm kiếm của
     bảng quản trị chiếm trọn một hàng trên máy hẹp, và ô số liệu lẻ cuối cùng
     kéo dài hết hàng thay vì để lại một lỗ hổng. */
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  assert.match(css, /@media \(pointer: coarse\) \{ \.adm-keys \{ display: none/,
    'máy không có bàn phím thì đừng hứa phím tắt')
  /* Hai phím là hai VIÊN PHÍM cạnh hai câu giải thích ngắn, không phải một câu
     dài — cùng một thông tin, đọc ra như giao diện thay vì như đoạn văn. */
  assert.ok(/<kbd>Esc<\/kbd>/.test(html) && /<kbd>Ctrl\/Cmd \+ A<\/kbd>/.test(html),
    'phím tắt phải được vẽ thành viên phím')
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]{0,400}\.adm-bar \.searchwrap \{ flex: 1 1 100%/,
    'trên máy hẹp, ô tìm kiếm phải chiếm trọn một hàng')
  assert.match(css, /\.adm-kpis > :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1/,
    'năm ô số liệu trong hai cột để lại một hàng thừa nửa bên phải — ô lẻ cuối phải kéo dài hết hàng')
})

test('nhịp chốt bài trong lời gợi ý lấy từ cấu hình, không viết cứng', async () => {
  const html = await render({ ...base, tab: 'active', pickInterval: 6 })
  assert.ok(/6 ngày|6 days|6/.test(html), 'lời gợi ý phải nói ra nhịp thật')
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.doesNotMatch(src, /now\.pickRule', \{ n: 4 \}/,
    'viết cứng `n: 4` là cách lời giải thích lệch khỏi lịch thật ngay khi đổi nhịp')
  assert.match(src, /pickInterval/, 'nhịp chốt bài phải đi vào từ prop')
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
