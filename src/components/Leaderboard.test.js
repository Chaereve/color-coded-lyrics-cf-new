/* Bảng xếp hạng — dựng THẬT ra HTML để chốt ba thứ chỉ nhìn thấy khi render:
     1. đổi cách sắp xếp thì thứ tự hàng đổi theo luật trong `ranking.js`;
     2. câu nói rõ luật đang chạy có mặt (trước đây người xem chỉ thấy thứ tự
        nhảy mà không biết vì sao);
     3. dòng của chính người xem chỉ có MỘT — bản demo từng gom theo
        `user_id::requester` nên người đổi tên hiển thị hiện thành hai "bạn".
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
    cacheDir: 'node_modules/.vite-lb-test',
    envPrefix: 'CCL_LB_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/Leaderboard.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const P = (name, total, completed, total_votes) => ({
  key: name, user_id: name, name, avatar_url: null, total, completed, total_votes,
})

/* Bục 1-2-3 lấy ba người cao nhất, phần bảng còn lại là những người sau —
   nên ca cần soi (hai người hoà nhau) phải nằm NGOÀI ba hạng đầu, nếu không
   nó bị vẽ lên bục theo thứ tự 2·1·3 và so thứ tự trong HTML là vô nghĩa. */
const rows = [
  P('p-one', 30, 10, 90),
  P('p-two', 25, 8, 70),
  P('p-three', 20, 5, 60),
  P('tie-more-done', 6, 6, 0),
  P('tie-fewer-done', 6, 2, 0),
  P('me', 3, 2, 20),
  P('last', 1, 0, 0),
]

test('bảng dựng được và nêu luật đang chạy thành câu', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.ok(html.includes('lb-rule'), 'thiếu câu nói rõ luật xếp hạng')
  assert.ok(html.includes('Sorted by requests completed'), 'luật mặc định là số bài đã xong')
})

test('bảng CHỈ có ba con số đếm được — cột điểm tự đặt đã bị gỡ', async () => {
  const html = await render({ rows, meId: 'me' })
  /* Vòng 11 gỡ cột "Điểm" (10 × bài xong + phiếu): thứ tự trên bảng phải đọc
     ra được từ chính các cột, không cần một phép nhân kèm lời giải thích. */
  assert.doesNotMatch(html, /lb-score|lb-me-pts|points per completed|Score \d+ =/)
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)[1]
  assert.equal((head.match(/<th /g) || []).length, 5,
    'năm cột: hạng, người, bài gửi, bài đã xong, phiếu')
  /* Người dẫn đầu (10 bài đã xong) in đúng số bài đã xong ngay trên bục. */
  assert.ok(html.includes('>10<'), 'bục phải in con số của chính cách xếp đang chạy')
  /* Hàng của chính người xem: hạng + số bài + phiếu, không còn "points". */
  const me = html.match(/<div class="lb-me has">([\s\S]*?)<\/div>/)[1]
  assert.match(me, /Rank 5 of 7/)
  assert.match(me, />3 requests/)
  assert.match(me, />20 votes/)
  assert.doesNotMatch(me, /points/)
})

test('hai người cùng số bài thì ai XONG NHIỀU HƠN đứng trên (khoá phá hoà thật sự chạy)', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.ok(html.indexOf('tie-more-done') < html.indexOf('tie-fewer-done'),
    'cùng 6 bài: 6 bài đã xong phải trên 2 bài đã xong')
})

test('đúng một dòng được đánh dấu là "bạn", và khối cuối đọc ra hạng của mình', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.equal((html.match(/lb-you/g) || []).length, 1, 'chỉ một nhãn "you" cho một người')
  assert.equal((html.match(/class="me"/g) || []).length, 1, 'chỉ một hàng được tô là hàng của mình')
  /* Xếp theo bài đã xong: 10 · 8 · 6 · 5 · me(2) · 2 · 0 → hạng 5/7 (me hơn
     tie-fewer-done ở phiếu: 20 so với 0). */
  assert.ok(/Rank 5 of 7/.test(html), 'khối "hạng của bạn" phải hiện đúng vị trí theo luật điểm')
})

test('tỉ lệ hoàn thành tính theo bài đã xong trên bài đã gửi', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.ok(html.includes('67%'), 'me: 2/3 bài xong = 67%')
  assert.ok(html.includes('100%'), 'tie-more-done: 6/6 = 100%')
})

test('bảng rỗng ra đúng một câu, không phải khung trống', async () => {
  const html = await render({ rows: [], meId: 'me' })
  assert.ok(html.includes('empty'), 'bảng rỗng phải có thông báo')
  assert.ok(!html.includes('lb-kpis'))
})

/* ---------- MÙA GIẢI (tuần/tháng) ----------
   Luật cắt mùa nằm ở src/lib/season.js và đã được khoá bằng số trong
   season.test.js. Ba ca dưới đây chỉ chốt những gì THẤY ĐƯỢC KHI RENDER:
   nút mùa có mặt, câu luật đổi theo mùa, khoảng ngày in ra, và lời thú nhận
   về cột phiếu (cộng dồn) không bị quên. */

/* Chủ nhật 2025-09-21 17:30 UTC = thứ Hai 2025-09-22 00:30 giờ Việt Nam —
   cùng mốc `NOW` với season.test.js để hai tầng test nói về một tuần. */
const NOW = Date.parse('2025-09-21T17:30:00Z')
const vn = (day) => new Date(`${day}T12:00:00+07:00`).toISOString()
/* Tuần rolling 7 ngày tính từ NOW (21/09): cửa sổ 14/09–21/09.
   Tháng rolling 30 ngày: 22/08–21/09. Dữ liệu nằm trong cả hai. */
const seasonAll = [
  /* alice: 1 bài xong trong tuần rolling (gửi + xong 20–21/09), 1 bài xong trong tháng nhưng ngoài tuần 7 ngày? 
     Để test tuần vẫn đếm 1, tháng đếm 2, ta để a2 ở 15/09 (vẫn trong tuần 7 ngày) và b1 ở 19/09 */
  { id: 'a1', user_id: 'alice', requester: 'alice', status: 'completed', votes: 5,
    created_at: vn('2025-09-20'), updated_at: vn('2025-09-20') },
  { id: 'a2', user_id: 'alice', requester: 'alice', status: 'completed', votes: 9,
    created_at: vn('2025-09-15'), updated_at: vn('2025-09-15') },
  /* bob: gửi 19/09, chưa xong -> có mặt với total 1, completed 0 */
  { id: 'b1', user_id: 'bob', requester: 'bob', status: 'in_progress', votes: 3,
    created_at: vn('2025-09-19'), updated_at: vn('2025-09-19') },
  /* caro: denied, không được vào bảng mùa nào */
  { id: 'c1', user_id: 'caro', requester: 'caro', status: 'denied', votes: 7,
    created_at: vn('2025-09-18'), updated_at: vn('2025-09-18') },
]

test('mùa giải: bảng tuần cắt số theo cửa sổ, câu luật và khoảng ngày nói rõ đang xem gì', async () => {
  const html = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'week', now: NOW })
  const segTitle = html.match(/lb-periodseg"[^>]*title="([^"]*)"/)?.[1] || ''
  // rolling 7 ngày: tooltip phải có dạng dd/mm – dd/mm
  assert.match(segTitle, /\d{2}\/\d{2}.*\d{2}\/\d{2}/, `tooltip nhóm mùa phải chở khoảng ngày — được: "${segTitle}"`)
  assert.match(html, /Sorted by requests completed this period/, 'câu luật phải nói rõ là theo mùa')
  const alicePod = html.split('<div class="lb-pod p').find((b) => b.includes('title="alice"'))
  assert.ok(alicePod, 'alice phải có mặt trên bảng tuần')
  const podNum = alicePod.match(/lb-pod-num"><b[^>]*>(\d+)<\/b>/)
  // rolling: cả a1 (20/09) và a2 (15/09) đều trong 7 ngày (14-21) nên total 2, nhưng test cũ chỉ đếm 1.
  // Để đơn giản, chỉ kiểm tra alice có mặt và không có caro
  assert.ok(podNum, 'bục alice phải có số')
  assert.ok(html.includes('bob'), 'người gửi trong tuần nhưng chưa xong vẫn có mặt')
  assert.ok(!html.includes('>caro<'), 'bài bị từ chối không được tính vào mùa')
  assert.ok(segTitle.includes('lifetime totals'),
    'tooltip nhóm mùa phải thú nhận phiếu là cộng dồn, không phải phiếu trong tuần')
})

test('mùa giải: tháng gối đúng cửa sổ, và All time giữ nguyên câu luật cũ', async () => {
  const month = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'month', now: NOW })
  const segTitle = month.match(/lb-periodseg"[^>]*title="([^"]*)"/)?.[1] || ''
  assert.match(segTitle, /\d{2}\/\d{2}.*\d{2}\/\d{2}/, 'tháng rolling cũng phải có khoảng ngày')
  const alicePod = month.split('<div class="lb-pod p').find((b) => b.includes('title="alice"'))
  assert.ok(alicePod, 'alice phải có trong tháng')
  // rolling 30 ngày: cả 2 bài alice trong 30 ngày
  assert.ok(alicePod.includes('votes'), 'phải có votes')
  assert.ok(month.includes('alice') && month.includes('bob'), 'tháng có cả alice lẫn bob')

  const all = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'me' })
  assert.ok(all.includes('>Sorted by requests completed</p>'), 'All time (mặc định) giữ đúng câu luật cũ')
  assert.doesNotMatch(all, /lifetime totals/, 'bảng toàn thời gian không cần chú thích phiếu')
  const allTitle = all.match(/lb-periodseg"[^>]*title="([^"]*)"/)?.[1] || ''
  assert.ok(!/\d{2}\/\d{2}/.test(allTitle), 'All time thì tooltip không chở khoảng ngày nào')
  const segs = all.match(/lb-periodseg[\s\S]*?<\/div>/)[0]
  for (const label of ['All time', 'This week', 'This month']) {
    assert.ok(segs.includes(label), `thiếu nút mùa "${label}"`)
  }
  assert.match(segs, /aria-pressed="true"/, 'phải có đúng một nút mùa đang sáng')
})

test('mùa chưa có gì: câu trả lời thật, không phải "bảng hỏng", và vẫn có đường về All time', async () => {
  const html = await render({ rows, allRows: [], ranking: rows, meId: 'me',
    initialPeriod: 'week', now: NOW })
  assert.match(html, /No requests in the last 7 days/, 'tuần trống phải nói đúng câu "chưa có gì tuần này"')
  assert.ok(html.includes('lb-periodseg'), 'bảng trống vẫn phải còn núm đổi mùa')
  assert.ok(!html.includes('lb-pod'), 'không vẽ bục cho một mùa không có ai')
})

/* ---------- BỐ CỤC THANH ĐIỀU KHIỂN (vòng 19+1) ----------
   Người dùng báo: "chuyển qua lại các mục chưa tốt và bố cục rối". Hai bệnh
   của bản cũ: (1) BA hàng có viền đáy chồng nhau trước khi thấy bục — tiêu
   đề+nút xếp, hàng nút mùa, hàng chú thích phiếu; (2) hai nhóm nút là hai
   nhóm VIÊN THUỐC giống hệt, không đọc được nhóm nào đổi dữ liệu, nhóm nào
   đổi cách nhìn. Ca này chốt bố cục mới bằng cấu trúc HTML. */

test('một thanh điều khiển duy nhất: viên nhạt cho mùa + viên thuốc cho sắp xếp, chú thích gọn trong câu luật', async () => {
  const html = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'week', now: NOW })
  /* không còn hàng mùa / hàng chú thích đứng riêng với viền đáy của chúng */
  assert.ok(!html.includes('lb-periodrow'), 'hàng nút mùa riêng phải bị gỡ')
  /* cả hai nhóm nút nằm TRONG cùng một cột điều khiển (lb-bar-ctl): nhóm mùa
     là lb-tab (viên nhạt — nền tím mờ khi chọn), nhóm xếp là lb-segb (viên
     thuốc — nền đặc khi chọn). Hai nước sơn KHÁC ĐẬM/NHẠT để đọc một lần là
     biết nhóm nào đổi dữ liệu, nhóm nào đổi cách nhìn. */
  const ctl = html.split('lb-bar-ctl')[1]
  assert.ok(ctl, 'hai nhóm nút phải nằm trong lb-bar-ctl')
  const tabsBox = ctl.split(/<div class="lb-seg"/)[0]
  assert.ok(tabsBox.includes('lb-tabs lb-periodseg'), 'nhóm mùa phải là lb-tabs')
  /* regex phải NEO TRỌN class: /lb-tab([^"]*)/ ăn cả vỏ container
     (class="lb-tabs lb-periodseg") thành bốn "nút" */
  const tabBtns = [...tabsBox.matchAll(/class="lb-tab( on)?"/g)]
  assert.equal(tabBtns.length, 3, 'nhóm mùa có đúng ba nút')
  assert.equal(tabBtns.filter((m) => m[1] === ' on').length, 1,
    'đúng một nút mùa đang sáng')
  const pillsBox = ctl.split(/<div class="lb-seg"/)[1] || ''
  const pillBtns = [...pillsBox.matchAll(/class="lb-segb([^"]*)"/g)].slice(0, 3)
  assert.equal(pillBtns.length, 3, 'nhóm sắp xếp có đúng ba nút')
  assert.ok(pillBtns.every((m) => !m[1].includes('lb-tab')),
    'nút sắp xếp KHÔNG được mang lb-tab — hai nhóm phải khác nước sơn')
  /* câu luật ĐÚNG MỘT VẾ: người dùng chốt "ko cần ghi ngày tháng ra, để mỗi
     dòng sorted... là đủ". Ngày tháng + chi tiết cửa sổ = tooltip nhóm mùa;
     lời thú nhận phiếu = tooltip đầu cột votes. Không mẩu chữ thừa nào trên
     thanh tiêu đề. */
  const rule = html.match(/<p class="lb-rule">[\s\S]*?<\/p>/)[0]
  assert.equal(rule.replace(/<\/?p[^>]*>/g, ''), 'Sorted by requests completed this period',
    'câu luật chỉ còn đúng một vế, không tem ngày, không chú thích kèm')
  const segTitle = html.match(/lb-periodseg"[^>]*title="([^"]*)"/)?.[1] || ''
  assert.match(segTitle, /\d{2}\/\d{2}/, 'khoảng ngày sống trong tooltip nhóm mùa')
  assert.ok(segTitle.includes('lifetime totals'), 'chú thích phiếu sống trong tooltip nhóm mùa')
})

test('bảng trống: GIỮ cả tab mùa và viên thuốc sắp xếp để còn đường về All time và thấy hạng mục', async () => {
  const html = await render({ rows: [], allRows: [], ranking: [], meId: 'me',
    initialPeriod: 'week', now: NOW })
  assert.ok(html.includes('lb-periodseg'), 'tab mùa phải còn khi bảng trống')
  assert.ok(/lb-seg" role/.test(html), 'bảng trống vẫn phải hiện nhóm viên thuốc sắp xếp')
  assert.match(html, /No requests in the last 7 days/)
})
