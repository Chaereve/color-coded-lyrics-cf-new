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
  onPick: () => {}, onBulk: () => {}, onEdit: () => {}, onMediaSave: () => {}, onMediaCommit: () => {},
  onMediaDelete: () => {}, onMediaReorder: () => {}, onMediaViewHome: () => {},
}

test('cả năm mục của trang quản trị đều dựng được (không sót prop → trang trắng)', async () => {
  for (const tab of ['overview', 'pending', 'active', 'expired', 'orders', 'done', 'media', 'comments', 'log']) {
    const html = await render({ ...base, tab })
    assert.ok(html.includes('class="adm-page"'), `mục ${tab}: thiếu khung .adm-page`)
    assert.ok(html.includes('adm-kpis'), `mục ${tab}: thiếu dải số liệu`)
    assert.ok(html.includes('aria-pressed'), `mục ${tab}: mục đang mở phải đọc được bằng aria-pressed`)
  }
})

test('funnel 7/30 ngày chỉ đọc ở mục Tổng quan, tải tường minh qua đúng một RPC (không polling)', async () => {
  const html = await render({ ...base, tab: 'overview' })
  assert.match(html, /class="adm-funnel"/, 'thiếu thẻ funnel ở mục Tổng quan')
  assert.match(html, /Community funnel · last 7 days/, 'thiếu nhãn khoảng thời gian')
  assert.match(html, /Loading funnel/, 'SSR phải có trạng thái chờ thay vì giả vờ số 0')
  assert.match(html, /adm-range/, 'thiếu bộ chọn 7/30 ngày')

  /* Thẻ funnel TỪNG nằm trên mọi mục: mở trang để duyệt bài là mất thêm một
     vòng RPC và một khối chiếm chỗ mà không ai đọc. */
  for (const other of ['pending', 'orders', 'done', 'comments', 'log']) {
    const page = await render({ ...base, tab: other })
    assert.ok(!page.includes('adm-funnel'), `mục ${other} không được mang thẻ funnel`)
  }

  const panel = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  /* Số tổng một mình không nói được xu hướng: mỗi sự kiện phải có dãy theo
     ngày. Dãy đó dựng từ CÙNG dữ liệu RPC đã tải, không gọi thêm lần nữa. */
  assert.match(panel, /<Sparkline values=\{funnelSeries\.series\[event\]\}/,
    'mỗi sự kiện phải có sparkline lấy từ dãy theo ngày')
  assert.match(panel, /const funnelSeries = useMemo\(\(\) => seriesByDay\(funnelRows, funnelDays\)/,
    'dãy theo ngày dựng từ dòng RPC đã có, không đọc thêm')
  assert.match(panel, /className="adm-conv"/, 'thiếu hàng tỉ lệ chuyển đổi')
  assert.match(panel, /FUNNEL_CONVERSIONS\.map/, 'ba tỉ lệ phải lấy từ một danh sách dùng chung')
  assert.match(panel, /fetchFunnelSummary\(funnelDays\)/, 'phải đọc đúng cửa sổ đang chọn')
  assert.match(panel, /if \(tab !== 'overview'\) return undefined/,
    'chỉ đọc khi Tổng quan đang mở')
  assert.match(panel, /\[tab, funnelDays, applyFunnelRows, failFunnel\]/, 'đổi cửa sổ thì đọc lại')
  assert.match(db, /supabase\.rpc\('funnel_summary',\s*\{\s*p_days:\s*pDays\s*\}\)/,
    'đọc qua RPC được bảo vệ is_admin, không select bảng trực tiếp')
  assert.doesNotMatch(db, /\.from\(['"]funnel_events['"]\)/, 'không mở đường đọc bảng trực tiếp')
  assert.doesNotMatch(panel, /setInterval|window\.setInterval/, 'không polling')
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
  assert.deepEqual(nums, ['0', '2', '1', '0', '1', '2', '1', '0', '0'],
    'tổng quan (không đếm) · chờ duyệt 2 · đang xử lý 1 · hết hạn 0 · đơn chờ 1 · đã xong/từ chối 2 · video 1 · bình luận 0 · nhật ký 0')

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

/* HAI LỖ HỔNG CỦA MỤC ĐƠN HÀNG VÀ BÌNH LUẬN (vòng 2026-12-12)
   ---------------------------------------------------------
   · Đơn hàng trộn đơn đang chờ với đơn đã nhận / đã từ chối, và không có con
     số doanh thu nào.
   · Bình luận đọc 100 dòng mới nhất rồi vẽ hết: quá 100 thì phần còn lại biến
     mất mà màn hình không nói gì, và không có ô tìm.
   Hai test dưới đây chốt phần nhìn thấy được bằng SSR, cộng hai điều chỉ đọc
   được trong mã nguồn (đường đọc dữ liệu phải là RPC mới, không quay lại bản
   cũ). */
test('mục Đơn hàng có bộ lọc trạng thái và con số tiền đã nhận', async () => {
  const html = await render({ ...base, tab: 'orders' })
  assert.match(html, /adm-orderstate/, 'thiếu ô chọn trạng thái đơn')
  assert.match(html, /All orders/, 'thiếu lựa chọn "tất cả"')
  assert.match(html, /Awaiting payment/, 'thiếu nhãn trạng thái đang chờ')
  assert.match(html, /adm-order-sum/, 'thiếu dải số liệu đơn hàng')
  assert.match(html, /received/, 'phải nói ra tiền đã nhận, không chỉ số đơn')
  assert.match(html, /20,000/, 'số tiền của đơn phải còn hiện trên hàng')

  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /matchOrderState\(o, ostF\)/, 'danh sách phải lọc theo trạng thái đang chọn')
  assert.match(src, /readAdminView\(window\.location\.search, KIND_KEYS, ADMIN_ORDER_STATES\)/,
    'trạng thái đơn phải đọc từ địa chỉ, cùng luật với các bộ lọc khác')
  assert.match(src, /ost: tab === 'orders' \? ostF : 'all'/, 'trạng thái đơn phải được ghi vào địa chỉ')
  const tabs = readFileSync(`${root}src/lib/adminTabs.js`, 'utf8')
  assert.match(tabs, /ADMIN_ORDER_STATES = \['awaiting', 'paid', 'rejected'\]/,
    'ba trạng thái có thật của bảng orders là nguồn duy nhất')
})

test('mục Bình luận tìm ở database và phân trang thật, không còn cắt im lặng ở 100 dòng', async () => {
  const html = await render({ ...base, tab: 'comments' })
  assert.ok(html.includes('class="adm-bar"'), 'mục Bình luận cần thanh công cụ như mọi mục')
  assert.match(html, /Search comment, song or member/, 'thiếu ô tìm của mục Bình luận')
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.doesNotMatch(src, /fetchAllCommentsForAdmin/, 'đường đọc cũ (100 dòng, không tổng) phải bị gỡ')
  assert.match(src, /fetchAdminComments\(\{ q: keyword, page, perPage: ADMIN_COMMENTS_PER_PAGE \}\)/,
    'phải đọc theo trang, kèm tổng số')
  assert.match(src, /commentTotal/, 'tổng số bình luận phải được đọc ra, không lấy độ dài mảng')
  const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
  assert.match(db, /supabase\.rpc\('admin_comments_page'/, 'lọc + đếm + cắt trang phải ở database')
  assert.match(db, /p_q: keyword \|\| null, p_limit: limit, p_offset: offset/,
    'ba tham số của RPC phải được truyền đủ')
  assert.doesNotMatch(db, /export async function fetchAllCommentsForAdmin/,
    'hàm cũ phải bị gỡ khỏi db.js, không để hai đường đọc song song')
})

/* ================= TỔNG QUAN + PHÍM TẮT (P2) ================= */
test('mục Tổng quan trả lời ba câu: còn gì phải làm · chờ bao lâu · đã thu bao nhiêu', async () => {
  const html = await render({ ...base, tab: 'overview', pickInterval: 4 })
  assert.match(html, /class="adm-ov"/, 'thiếu ba tấm thẻ tóm tắt')
  assert.match(html, /Waiting for you/, 'thiếu thẻ "còn gì phải làm"')
  assert.match(html, /Oldest request/, 'thiếu thẻ "bài chờ lâu nhất"')
  assert.match(html, /Money received/, 'thiếu thẻ doanh thu')
  /* Mỗi con số phải bấm được và dẫn sang đúng danh sách — con số đứng một mình
     thì admin vẫn phải tự tìm chỗ sửa. */
  assert.match(html, /class="adm-ov-num"/, 'số liệu phải là nút dẫn sang mục tương ứng')
  assert.match(html, /adm-ov-money/, 'doanh thu phải có chỗ riêng, không lẫn vào số đơn')

  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /onClick=\{\(\) => goTab\('pending'\)\}/, 'thẻ "chờ duyệt" phải dẫn sang mục Chờ duyệt')
  assert.match(src, /const oldestPending = useMemo/, 'tuổi bài chờ lâu nhất phải tính từ dữ liệu thật')
})

test('bốn phím j/k/a/d và Enter có trong bảng quản trị, in ra chỗ dùng, và không cướp phím khi đang gõ', async () => {
  const html = await render({ ...base, tab: 'pending' })
  assert.match(html, /<kbd>j<\/kbd><kbd>k<\/kbd>/, 'hai phím đi lại phải được vẽ thành viên phím')
  assert.match(html, /moves between rows/, 'thiếu câu giải thích phím đi lại')
  assert.match(html, /approves/, 'thiếu câu giải thích phím duyệt')
  assert.match(html, /denies/, 'thiếu câu giải thích phím từ chối')
  assert.match(html, /opens the editor/, 'thiếu câu giải thích phím Enter')

  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  /* Đang gõ trong ô nhập thì phím tắt phải im — nếu không, gõ chữ "d" trong ô
     tìm kiếm là mở hộp từ chối. */
  assert.match(src, /const typing = el\?\..*isContentEditable[\s\S]{0,400}if \(typing\) \{/,
    'phím tắt phải nhường bàn phím cho ô nhập')
  /* Hộp xác nhận đang mở thì cả nhóm phím của trang im (bảng phía sau vẫn còn). */
  assert.match(src, /if \(modalRef\.current\) return/, 'phím tắt phải im khi hộp xác nhận đang mở')
  assert.match(src, /e\.key === 'j' \|\| e\.key === 'ArrowDown'/, 'j hoặc ↓ phải đi xuống')
  assert.match(src, /e\.key === 'Enter'/, 'Enter phải mở khung sửa')
  /* a/d chỉ có nghĩa với hàng đang chờ: duyệt một bài đã xong là vô nghĩa, từ
     chối một bài đã duyệt là phá việc. */
  assert.match(src, /const canApprove = !!cursorRow && cursorRow\.status === 'pending'/,
    'a/d phải giới hạn ở hàng đang chờ')
  /* Mục không có danh sách request thì không có con trỏ. */
  assert.match(src, /const isRequestList = !\['overview', 'media', 'comments', 'log', 'orders'\]\.includes\(tab\)/,
    'mục Đơn hàng / Bình luận / Videos không có con trỏ bàn phím')
})

test('con trỏ bàn phím tự về -1 khi danh sách đổi (không cần effect đồng bộ)', async () => {
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /const listKey = `\$\{tab\}\|\$\{q\}\|\$\{sortKey\}\|\$\{kindF\}\|\$\{ostF\}\|\$\{pg\.page\}`/,
    'khoá danh sách phải gồm mục + từ khoá + cách xếp + loại + trạng thái đơn + trang')
  assert.match(src, /const cursor = cur\.key === listKey \? cur\.i : -1/,
    'đổi danh sách là con trỏ phải rời đi, không trỏ vào hàng khác nghĩa')
})

test('sparkline dựng được một mình: svg ẩn với trình đọc màn hình, câu tóm tắt thì đọc được', async () => {
  await render({ ...base, tab: 'overview' })
  const mod = await server.ssrLoadModule('/src/components/Sparkline.jsx')
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const one = (props) => renderToStaticMarkup(
    createElement(I18nProvider, null, createElement(mod.default, props)))
  const html = one({ values: [0, 3, 1, 0, 5, 2, 1], label: 'Visits' })
  assert.match(html, /class="adm-spark"/, 'thiếu khối sparkline')
  assert.match(html, /aria-hidden="true"/, 'hình vẽ phải ẩn với trình đọc màn hình')
  assert.match(html, /class="sr-only"/, 'phải có câu tóm tắt thay cho hình')
  assert.match(html, /Visits/, 'câu tóm tắt phải nói đây là số liệu gì')
  assert.match(html, /total/, 'câu tóm tắt phải có tổng')

  /* Dãy rỗng: vẫn phải là một hình tử tế (đường phẳng đáy), không phải svg
     rỗng — ô số liệu trống trông như lỗi tải dữ liệu. */
  const empty = one({ values: [], label: 'Visits' })
  assert.match(empty, /adm-spark-line/, 'dãy rỗng vẫn phải vẽ đường phẳng')
})

test('?focus=<id> mở thẳng một bài, kể cả khi bài nằm ở trang khác', async () => {
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /const \[focusId, setFocusId\] = useState\(init\.focus\)/,
    'focus phải đọc từ địa chỉ lúc dựng')
  assert.match(src, /const idx = shown\.findIndex\(r => r\.id === focusId\)/,
    'phải tìm bài trong danh sách đã lọc, không chỉ trang đang nhìn')
  assert.match(src, /if \(want !== pg\.page\) \{ pg\.setPage\(want\); return undefined \}/,
    'bài ở trang khác thì phải lật sang trang đó trước')
  assert.match(src, /setReveal\(\{ id: focusId, n: 1 \}\)/, 'đến nơi thì mở khung sửa của đúng bài đó')
  assert.match(src, /if \(idx < 0\) \{ setFocusId\(''\); return undefined \}/,
    'bài đã bị xoá thì bỏ qua, không dựng khung sửa rỗng')
  assert.match(src, /setFocusId\(''\)\n\s*\}, 0\)/, 'mở MỘT lần: đọc xong là quên, F5 không mở lại')
})

test('có bài mới thì nói ra, không để danh sách tự nhảy dưới tay người đang soát', async () => {
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /const seenRef = useRef\(null\)/, 'phải nhớ danh sách đã thấy để biết cái gì mới')
  assert.match(src, /if \(r\.status === 'pending' && !seenRef\.current\.has\(r\.id\)\) n \+= 1/,
    'chỉ đếm bài đang chờ — bài đã duyệt không phải việc mới')
  assert.match(src, /className="adm-fresh" role="status"/, 'dải "có bài mới" phải có vùng thông báo')
  assert.match(src, /setFresh\(0\); setSortKey\('newest'\); goTab\('pending'\)/,
    'nút "Xem" phải dẫn thẳng tới hàng đợi xếp mới nhất trước')
  assert.match(src, /fresh > 0 && isRequestList/, 'dải này chỉ có nghĩa ở mục có danh sách request')
})

test('lúc chờ số liệu, ô funnel giữ chỗ bằng khung xám thay vì một câu chữ', async () => {
  const src = readFileSync(`${root}src/components/AdminPanel.jsx`, 'utf8')
  assert.match(src, /adm-funnel-stat is-loading/, 'thiếu khung chờ giữ chỗ')
  assert.match(src, /className="sk adm-sk-num"/, 'khung chờ phải dùng chung vệt shimmer của app (class .sk)')
  const css = readFileSync(`${root}src/index.css`, 'utf8')
  assert.match(css, /\.adm-sk-num \{ height: 20px/, 'khung chờ phải có chiều cao xấp xỉ con số thật')
})
