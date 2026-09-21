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
/* Tuần đang xét: 22/09 (thứ Hai) – 28/09 (Chủ nhật), giờ VN. */
const seasonAll = [
  /* alice: 1 bài xong trong tuần (gửi + xong 22–23/09), 1 bài xong tuần trước */
  { id: 'a1', user_id: 'alice', requester: 'alice', status: 'completed', votes: 5,
    created_at: vn('2025-09-22'), updated_at: vn('2025-09-23') },
  { id: 'a2', user_id: 'alice', requester: 'alice', status: 'completed', votes: 9,
    created_at: vn('2025-09-15'), updated_at: vn('2025-09-16') },
  /* bob: gửi thứ Sáu 26/09, chưa xong -> có mặt với total 1, completed 0 */
  { id: 'b1', user_id: 'bob', requester: 'bob', status: 'in_progress', votes: 3,
    created_at: vn('2025-09-26'), updated_at: vn('2025-09-26') },
  /* caro: denied, không được vào bảng mùa nào */
  { id: 'c1', user_id: 'caro', requester: 'caro', status: 'denied', votes: 7,
    created_at: vn('2025-09-24'), updated_at: vn('2025-09-24') },
]

test('mùa giải: bảng tuần cắt số theo cửa sổ, câu luật và khoảng ngày nói rõ đang xem gì', async () => {
  const html = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'week', now: NOW })
  /* khoảng ngày của tuần phải in ra — "This week" một mình là từ mơ hồ */
  assert.ok(html.includes('22/09'), 'khoảng ngày phải hiện ngày đầu tuần')
  assert.ok(html.includes('28/09'), 'khoảng ngày phải hiện ngày cuối tuần')
  assert.match(html, /Sorted by requests completed this period/, 'câu luật phải nói rõ là theo mùa')
  /* alice trong tuần: 1 gửi / 1 xong — KHÔNG phải 2/2 của cả thời gian.
     Tuần chỉ có 2 người nên cả hai đều đứng trên BỤC, không có hàng bảng —
     vì vậy soi con số ngay trong khối bục của alice. */
  /* cắt theo thẻ MỞ của khối bục ('<div class="lb-pod p' — có khoảng trắng,
     không ăn vào lb-pod-num/lb-pod-name), rồi mới tìm khối có tên alice */
  const alicePod = html.split('<div class="lb-pod p').find((b) => b.includes('title="alice"'))
  assert.ok(alicePod, 'alice phải có mặt trên bảng tuần')
  /* con số to trong khối bục (lb-pod-num) — không phải số trong huy chương */
  const podNum = alicePod.match(/lb-pod-num"><b[^>]*>(\d+)<\/b>/)
  assert.equal(podNum?.[1], '1', 'tuần này alice xong 1 bài — không phải 2 của cả thời gian')
  assert.ok(!alicePod.includes('9 votes'), 'bài xong tuần trước (9 phiếu) không được lọt vào bảng tuần')
  /* bob có mặt dù chưa xong bài nào — bảng nói thật là có gửi */
  assert.ok(html.includes('bob'), 'người gửi trong tuần nhưng chưa xong vẫn có mặt')
  /* caro (denied) không bao giờ lên bảng */
  assert.ok(!html.includes('>caro<'), 'bài bị từ chối không được tính vào mùa')
  /* cột phiếu của bảng mùa là phiếu cộng dồn — phải tự thú nhận */
  assert.ok(html.includes('lifetime totals'), 'phải nói rõ phiếu là cộng dồn, không phải phiếu trong tuần')
})

test('mùa giải: tháng gối đúng cửa sổ, và All time giữ nguyên câu luật cũ', async () => {
  const month = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'month', now: NOW })
  assert.ok(month.includes('01/09') && month.includes('30/09'), 'tháng 9: 01/09 – 30/09')
  /* cả hai bài của alice đều gửi + xong trong tháng 9: 2 bài, 14 phiếu —
     khác bảng tuần (1 bài, 5 phiếu) ở đúng chỗ đó */
  const alicePod = month.split('<div class="lb-pod p').find((b) => b.includes('title="alice"'))
  assert.equal(alicePod.match(/lb-pod-num"><b[^>]*>(\d+)<\/b>/)?.[1], '2',
    'bảng tháng phải đếm cả bài gửi 15/09 (trong tháng, ngoài tuần)')
  assert.ok(alicePod.includes('14 votes'), 'phiếu của bài gửi trong mùa: 5 + 9 = 14')
  assert.ok(month.includes('alice') && month.includes('bob'), 'tháng 9 có cả alice lẫn bob')

  const all = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'me' })
  assert.ok(all.includes('>Sorted by requests completed</p>'), 'All time (mặc định) giữ đúng câu luật cũ')
  assert.doesNotMatch(all, /lifetime totals/, 'bảng toàn thời gian không cần chú thích phiếu')
  /* ba nút mùa phải có mặt trên cả hai trạng thái */
  const segs = all.match(/lb-periodseg[\s\S]*?<\/div>/)[0]
  for (const label of ['All time', 'This week', 'This month']) {
    assert.ok(segs.includes(label), `thiếu nút mùa "${label}"`)
  }
  assert.match(segs, /aria-pressed="true"/, 'phải có đúng một nút mùa đang sáng')
})

test('mùa chưa có gì: câu trả lời thật, không phải "bảng hỏng", và vẫn có đường về All time', async () => {
  const html = await render({ rows, allRows: [], ranking: rows, meId: 'me',
    initialPeriod: 'week', now: NOW })
  assert.match(html, /No requests yet this week/, 'tuần trống phải nói đúng câu "chưa có gì tuần này"')
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
  /* câu luật là MỘT dòng chở đủ ba mẩu: luật + tem khoảng ngày + lời thú nhận
     về cột phiếu. Bản cũ tách chú thích thành đoạn văn riêng dài dằng dặc,
     thanh tiêu đề phình ra và đẩy cụm nút lệch xuống (người dùng đã chê). */
  const rule = html.match(/<p class="lb-rule">[\s\S]*?<\/p>/)[0]
  assert.ok(rule.includes('lb-range'), 'khoảng ngày phải nằm trong câu luật')
  assert.ok(rule.includes('22/09') && rule.includes('28/09'))
  assert.ok(rule.includes('lb-votes-note'), 'chú thích phiếu phải là vế inline của câu luật')
  assert.ok(!html.includes('Mon–Sun week'), 'chi tiết cửa sổ dài không được in thường trực — nó thuộc tooltip')
  assert.ok(html.includes('rank.rangeTip') === false && html.includes('Vietnam time'),
    'tooltip của tem ngày phải mang chi tiết giờ VN')
})

test('bảng trống: giấu viên thuốc sắp xếp nhưng GIỮ tab mùa để còn đường về All time', async () => {
  const html = await render({ rows: [], allRows: [], ranking: [], meId: 'me',
    initialPeriod: 'week', now: NOW })
  assert.ok(html.includes('lb-periodseg'), 'tab mùa phải còn khi bảng trống')
  assert.ok(!html.includes('rank.sortLabel') && !/lb-seg" role/.test(html),
    'bảng trống thì không còn gì để sắp xếp — nhóm viên thuốc phải giấu')
  assert.match(html, /No requests yet this week/)
})
