/* Bảng xếp hạng — dựng HTML thật để kiểm tra điểm trung bình cộng của ba
   chỉ số, hiển thị Average cả hai nơi, giữ Period-only và vị trí thật của
   chính người xem. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
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

/* Hai dòng kiểm tra phá hoà được đặt sau Top 3 để thứ tự của chúng cũng
   xuất hiện rõ ràng trong phần Rankings sau podium. */
const rows = [
  P('p-one', 30, 10, 90),
  P('p-two', 25, 8, 70),
  P('p-three', 20, 5, 60),
  P('tie-more-done', 6, 6, 0),
  P('tie-fewer-done', 6, 2, 0),
  P('me', 3, 2, 20),
  P('last', 1, 0, 0),
]

test('period đổi có animation/đếm Average, nhưng không kéo cuộn trang', async () => {
  const jsx = readFileSync(new URL('./Leaderboard.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(jsx, /useCountUp\(p\.score, 620\)/, 'Average trên podium đếm mượt khi dữ liệu đổi')
  assert.match(jsx, /<div key=\{period\} className=\{`lb-top/, 'podium chạy lại animation khi đổi kỳ')
  assert.match(jsx, /<tbody key=\{period\}>/, 'hàng Rankings chạy lại transition khi đổi kỳ')
  assert.match(css, /\.lb \.lb-pod-person \{[^}]*animation: lb-person-in/)
  assert.match(css, /\.lb-table tbody tr \{[^}]*animation: rowIn/)
  assert.match(css, /overflow-anchor:\s*none/, 'đổi kỳ không làm trang nhảy scroll')
  assert.match(css, /\.lb-twrap \{[^}]*overflow-y:\s*hidden/, 'animation của hàng không bật scrollbar dọc tạm thời')
})

test('bảng dựng được và giải thích điểm trung bình đang dùng', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.ok(html.includes('lb-rule'), 'thiếu câu nói rõ luật xếp hạng')
  assert.ok(html.includes('arithmetic mean of requests, completed requests, and votes received'))
  assert.ok(html.includes('>Rankings</h3>'), 'phần danh sách cần heading Rankings rõ ràng')
  assert.match(html, /class="lucide lucide-trophy"/,
    'icon trước Rankings là cúp giống mục Leaderboard trong sidebar')
  assert.ok(html.includes('<th scope="col">User</th>'), 'cột tên người dùng dùng nhãn User')
})

test('Average hiện trên podium và Rankings; số liệu gốc chỉ hiện dưới Rankings', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.doesNotMatch(html, /Rank by|lb-control-sort|lb-segb|lb-help/,
    'Rank by và nút hỏi trợ giúp phải được gỡ hoàn toàn')
  assert.ok(!html.includes('>?</button>'), 'không còn nút dấu hỏi')
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)[1]
  assert.equal((head.match(/<th /g) || []).length, 6,
    'Rankings có hạng, user, Average và ba số liệu gốc')
  assert.match(head, /Average/, 'cột Average có trong Rankings')
  assert.ok(html.includes('<b>43.33</b>'), 'Top 1: (30 requests + 10 completed + 90 votes) / 3')
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''
  assert.ok(tbody.indexOf('p-one') < tbody.indexOf('p-two') && tbody.indexOf('p-two') < tbody.indexOf('p-three'),
    'danh sách dùng cùng thứ tự trung bình với podium')
  assert.match(tbody, /score-col[^>]*><b>43\.33<\/b>/, 'Average hiện trong hàng Rankings')
  assert.match(tbody, /score-col[^>]*><b>8\.33<\/b>/, 'Average của người xem hiện trong bảng')
  const podiumStart = html.indexOf('<div class="lb-top')
  const rankingsStart = html.indexOf('<div class="lb-list-head"')
  const podium = html.slice(podiumStart, rankingsStart)
  assert.doesNotMatch(podium, /requests|completed|votes/, 'podium không chứa số liệu phụ')
  const meRow = html.match(/<tr class="me"[^>]*>([\s\S]*?)<\/tr>/)?.[0]
  assert.ok(meRow, 'phải đánh dấu hàng người xem ngay trong thứ hạng thật')
  assert.match(meRow, /lb-you/)
  assert.match(meRow, /score-col[^>]*><b>8\.33<\/b>/, 'Average của người xem nằm đúng hàng thật')
  assert.match(meRow, /<td class="num">3<\/td>/, 'requests gốc vẫn còn')
  assert.match(meRow, /<b>2<\/b><span class="lb-rate">67%<\/span>/, 'completed gốc vẫn còn')
  assert.match(meRow, /<b>20<\/b>/, 'votes gốc vẫn còn')
  assert.doesNotMatch(html, /class="lb-me/)
})

test('cùng tổng số requests thì completed nhiều hơn là khoá phá hoà kế tiếp', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.ok(html.indexOf('tie-more-done') < html.indexOf('tie-fewer-done'),
    'cùng 6 requests và votes: 6 completed đứng trên 2 completed')
})

test('đúng một nhãn "bạn" nằm tại vị trí thật trong bảng xếp hạng', async () => {
  const html = await render({ rows, meId: 'me' })
  assert.equal((html.match(/lb-you/g) || []).length, 1, 'chỉ một nhãn "you" cho một người')
  assert.equal((html.match(/class="me"/g) || []).length, 1, 'chỉ một hàng được tô là hàng của mình')
  const meRow = html.match(/<tr class="me"[^>]*>[\s\S]*?<\/tr>/)?.[0]
  assert.ok(meRow?.includes('lb-you'), 'nhãn "you" nằm ngay trên hàng thật, không bị ghim cuối bảng')
  assert.doesNotMatch(html, /class="lb-me/)
})

test('người chưa có trong bảng vẫn nhận được thông báo cạnh Rankings, không ghim một hàng riêng', async () => {
  const html = await render({ rows: rows.filter(p => p.user_id !== 'me'), meId: 'me' })
  assert.match(html, /<span class="lb-not-ranked">You are not on the board yet\.<\/span>/)
  assert.doesNotMatch(html, /class="lb-me/)
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

/* ---------- MÙA THÁNG ----------
   Luật cắt mùa nằm ở src/lib/season.js; ca dưới đây kiểm tra dữ liệu và cách
   hiển thị tháng, không thay đổi quy tắc điểm trung bình dùng chung. */
const NOW = Date.parse('2025-09-21T17:30:00Z')
const vn = (day) => new Date(`${day}T12:00:00+07:00`).toISOString()
const seasonAll = [
  { id: 'a1', user_id: 'alice', requester: 'alice', artist: 'Artist A', title: 'Song A', status: 'completed', votes: 5,
    created_at: vn('2025-09-22'), updated_at: vn('2025-09-23') },
  { id: 'a2', user_id: 'alice', requester: 'alice', artist: 'Artist B', title: 'Song B', status: 'completed', votes: 9,
    created_at: vn('2025-09-15'), updated_at: vn('2025-09-16') },
  { id: 'b1', user_id: 'bob', requester: 'bob', status: 'in_progress', votes: 3,
    created_at: vn('2025-09-26'), updated_at: vn('2025-09-26') },
  { id: 'c1', user_id: 'caro', requester: 'caro', status: 'denied', votes: 7,
    created_at: vn('2025-09-24'), updated_at: vn('2025-09-24') },
  { id: 'd1', user_id: 'dora', requester: 'dora', status: 'queued', votes: 40,
    created_at: vn('2025-09-01'), updated_at: vn('2025-09-27') },
]
const seasonVotes = [
  { request_id: 'a1', created_at: vn('2025-09-23') },
  { request_id: 'a1', created_at: vn('2025-09-24') },
  { request_id: 'a1', created_at: vn('2025-09-25') },
  { request_id: 'a1', created_at: vn('2025-09-18') },
  { request_id: 'a1', created_at: vn('2025-09-19') },
  { request_id: 'a2', created_at: vn('2025-09-16') },
  { request_id: 'a2', created_at: vn('2025-09-17') },
  { request_id: 'a2', created_at: vn('2025-09-18') },
  { request_id: 'a2', created_at: vn('2025-09-19') },
  { request_id: 'b1', created_at: vn('2025-09-27') },
  { request_id: 'd1', created_at: vn('2025-09-27') },
  { request_id: 'd1', created_at: vn('2025-09-28') },
]

test('Leaderboard chỉ còn hai kỳ: All time và This month', async () => {
  const html = await render({ rows, meId: 'me', initialPeriod: 'week', now: NOW })
  const segs = html.match(/lb-periodseg[\s\S]*?<\/div>/)?.[0] || ''
  assert.ok(segs.includes('All time'), 'thiếu lựa chọn All time')
  assert.ok(segs.includes('This month'), 'thiếu lựa chọn This month')
  assert.doesNotMatch(segs, /This week/, 'This week không còn trong bộ chọn')
  assert.equal((segs.match(/class="lb-tab(?: on)?"/g) || []).length, 2, 'chỉ có hai nút kỳ')
  assert.match(segs, /class="lb-tab on"[^>]*>All time</, 'period cũ không còn hỗ trợ phải về All time')
})

test('tháng đúng cửa sổ; cả tháng lẫn All time xếp theo cùng điểm trung bình', async () => {
  const month = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'month', now: NOW, votesLog: seasonVotes })
  assert.match(month, /lb-periodseg/, 'bộ chọn kỳ không cần tooltip giải thích dài')
  const aliceRow = month.match(/<tr class="me"[^>]*>[\s\S]*?<\/tr>/)?.[0]
  assert.ok(aliceRow, 'alice phải có trong bảng tháng')
  assert.match(aliceRow, /<td class="num">2<\/td>/,
    'bảng tháng phải đếm cả bài gửi 15/09 (trong tháng, ngoài tuần)')
  assert.match(aliceRow, /<b>2<\/b><span class="lb-rate">100%<\/span>/, 'tháng này alice hoàn tất 2 bài')
  assert.match(aliceRow, /<b>9<\/b>/, 'phiếu NHẬN TRONG THÁNG: a1 5 + a2 4 = 9 (không phải cộng dồn 14)')
  assert.ok(month.includes('<b>4.33</b>'), 'điểm tháng dùng cùng công thức: (2 + 2 + 9) / 3')
  assert.ok(month.includes('alice') && month.includes('bob'), 'tháng 9 có cả alice lẫn bob')

  const all = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'me' })
  assert.ok(all.includes('>Overall score is the arithmetic mean of requests, completed requests, and votes received</p>'),
    'All time uses the shared arithmetic-mean rule')
  assert.doesNotMatch(all, /lifetime totals|received this period/, 'bảng toàn thời gian không cần chú thích phiếu mùa')
  assert.doesNotMatch(all, /lb-periodseg[^>]*title=/, 'bộ chọn kỳ không có tooltip dài')
  const segs = all.match(/lb-periodseg[\s\S]*?<\/div>/)[0]
  for (const label of ['All time', 'This month']) {
    assert.ok(segs.includes(label), `thiếu nút mùa "${label}"`)
  }
  assert.doesNotMatch(segs, /This week/, 'không còn nút This week')
  assert.equal((segs.match(/class="lb-tab(?: on)?"/g) || []).length, 2, 'chỉ còn hai nút kỳ')
  assert.match(segs, /aria-pressed="true"/, 'phải có đúng một nút mùa đang sáng')
})

test('tháng chưa có gì vẫn có đường về All time', async () => {
  const html = await render({ rows, allRows: [], ranking: rows, meId: 'me',
    initialPeriod: 'month', now: NOW })
  assert.match(html, /No requests yet this month/, 'tháng trống phải nói đúng kỳ')
  assert.ok(html.includes('lb-periodseg'), 'bảng trống vẫn phải còn núm đổi kỳ')
  assert.ok(!html.includes('lb-pod'), 'không vẽ bục cho một kỳ không có ai')
})

/* ---------- Period-only controls + fixed combined ranking ---------- */
test('chỉ còn Period selector gọn với All time và This month', async () => {
  const html = await render({ rows, allRows: seasonAll, ranking: rows, meId: 'alice',
    initialPeriod: 'month', now: NOW })
  const headerStart = html.indexOf('<div class="lb-list-head">')
  const tabsStart = html.indexOf('class="lb-tabs lb-periodseg"', headerStart)
  assert.ok(headerStart >= 0 && tabsStart > headerStart, 'Period selector nằm cùng hàng Rankings')
  assert.ok(headerStart > html.indexOf('class="lb-top'), 'podium đứng trước hàng Rankings/Period')
  assert.equal((html.match(/class="lb-list-head"/g) || []).length, 1, 'không remount/nhân đôi header khi đổi period')
  const periodRow = html.slice(headerStart, html.indexOf('</div>', tabsStart) + 6)
  assert.ok(periodRow.includes('Rankings'), 'tiêu đề Rankings vẫn còn')
  assert.ok(periodRow.includes('All time') && periodRow.includes('This month'), 'chỉ có hai kỳ được yêu cầu')
  assert.doesNotMatch(html, /Rank by|lb-control-sort|lb-segb|lb-help/,
    'Rank by và nút hỏi trợ giúp phải được gỡ hoàn toàn')
  assert.ok(!html.includes('>?</button>'), 'không còn nút dấu hỏi')
  const tabs = [...periodRow.matchAll(/class="lb-tab(?: on)?"/g)]
  assert.equal(tabs.length, 2, 'selector có đúng hai lựa chọn')
  assert.equal((periodRow.match(/aria-pressed="true"/g) || []).length, 1, 'đúng một kỳ đang được chọn')
  assert.match(html, /This month score is the average of requests, completed requests, and votes received this month/)
})

test('bảng rỗng vẫn giữ Period selector nhưng không còn Rank by', async () => {
  const html = await render({ rows: [], allRows: [], ranking: [], meId: 'me',
    initialPeriod: 'month', now: NOW })
  assert.ok(html.includes('lb-periodseg'), 'selector mùa phải còn khi bảng trống')
  assert.doesNotMatch(html, /Rank by|lb-control-sort|lb-segb|lb-help/,
    'Rank by và nút hỏi trợ giúp phải được gỡ hoàn toàn')
  assert.ok(!html.includes('>?</button>'), 'không còn nút dấu hỏi')
  assert.match(html, /No requests yet this month/)
})

/* ĐANG TẢI ≠ RỖNG. Bảng xếp hạng là một cách NHÌN cùng dữ liệu của bảng
   request, nên khi bảng còn đang nạp nó từng in thẳng "No data yet." — một
   câu nói sai về dữ liệu đang tới. Bài này chốt: có `loading` thì hiện khối
   xương, không có câu rỗng; và khi ĐÃ có số thì lần làm mới không được dựng
   xương đè lên số đang xem. */
test('đang tải: khối xương, không nói "No data yet."', async () => {
  const html = await render({ rows: [], meId: 'me', loading: true })
  assert.match(html, /role="status"/, 'thiếu vùng trạng thái cho trình đọc màn hình')
  assert.match(html, /sklist/, 'thiếu khối xương')
  assert.ok(!html.includes('No data yet.'), 'đang tải mà đã nói "chưa có dữ liệu"')
})

test('đang tải nhưng đã có số: giữ nguyên bảng, không dựng xương', async () => {
  const html = await render({ rows, meId: 'me', loading: true })
  assert.ok(!html.includes('sklist'), 'có dữ liệu rồi thì không được thay bằng xương')
  assert.match(html, /lb-rule/)
  assert.ok(html.includes('<table class="lb-table"'), 'bảng xếp hạng vẫn còn khi đang làm mới')
  assert.ok(html.includes('class="me"'), 'vị trí thật của người xem vẫn được giữ')
})

test('tải xong mà rỗng: câu rỗng theo kỳ vẫn hiện như cũ', async () => {
  const html = await render({ rows: [], meId: 'me', loading: false })
  assert.ok(!html.includes('sklist'), 'không tải nữa thì không được để lại xương')
  assert.ok(html.includes('lb-periodseg'), 'selector kỳ vẫn còn khi dữ liệu rỗng')
  assert.match(html, /No data yet\./, 'trạng thái rỗng thật có thông báo phù hợp')
})
