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
  assert.ok(html.includes('Sorted by score'), 'luật mặc định là luật tính điểm')
})

test('luật mặc định là ĐIỂM, và trọng số trong câu chữ đọc thẳng từ hằng số của luật', async () => {
  const { POINT_DONE, POINT_VOTE } = await import('../lib/ranking.js')
  const html = await render({ rows, meId: 'me' })
  /* Câu chữ phải nói đúng con số mà bảng đang tính — đổi POINT_DONE mà câu
     không đổi thì bài này đỏ. */
  assert.ok(html.includes(`${POINT_DONE} points per completed request`), 'câu luật phải in trọng số thật')
  assert.ok(html.includes(`${POINT_VOTE} per vote`), 'câu luật phải in trọng số phiếu')
  /* Người dẫn đầu: 10 bài xong × 10 + 90 phiếu = 190 điểm, in ngay trên bục. */
  assert.ok(html.includes('>190<'), 'số lớn trên bục phải là ĐIỂM của người dẫn đầu')
  /* Điểm cũng phải đọc được ở từng hàng trong bảng, nếu không thứ tự nhảy mà
     người xem không biết vì sao. */
  /* Ba người đầu đã có con số lớn trên bục; phần BẢNG còn lại mỗi hàng một ô
     điểm, cộng một ô tiêu đề — con số quyết định thứ tự phải có CỘT riêng. */
  assert.equal((html.match(/lb-score/g) || []).length, rows.length - 3 + 1,
    'cột điểm: một ô tiêu đề + mỗi hàng trong bảng một ô')
  assert.match(html, /<th class="num lb-score"[^>]*>Score<\/th>/, 'cột điểm phải có tên cột')
  assert.match(html, /Score \d+ = 10 × completed requests \+ votes earned/,
    'ô điểm phải giải thích được nó từ đâu ra')
  /* Hàng của chính người xem cũng in điểm: xếp mặc định theo điểm thì đó là
     con số trả lời "vì sao tôi đứng ở đây". */
  assert.match(html, /lb-me-pts[^>]*>\s*40 points/, 'hàng của bạn phải in điểm của mình')
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
  /* Xếp theo điểm: 190 · 150 · 110 · 60 · me(2×10+20=40) · 20 · 0 → hạng 5/7 */
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
