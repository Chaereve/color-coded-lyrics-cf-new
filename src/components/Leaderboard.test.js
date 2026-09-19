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
