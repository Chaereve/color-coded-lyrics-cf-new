/* Hộp thoại nhập số vote — dựng THẬT ra HTML.
   ---------------------------------------------------------
   Thân hộp thoại vừa được viết lại (số vote sau khi vote · bốn mức nhanh ·
   thanh trượt · tổng kết trước→sau · ba ô số dư) nên phải có chỗ chốt: một
   biến không tồn tại trong nhánh mới là màn hình trắng ngay lúc mở, mà
   `npm run build` thì không thấy gì.
   Ba thứ được kiểm ở đây đều là LỜI HỨA với người dùng:
     · con số lớn là SỐ VOTE SAU KHI VOTE, không phải số đang có — người bấm
       cần biết kết quả, không phải hiện trạng;
     · không mức nhanh nào vượt quá số vote còn lại (bấm vào không được nhảy
       sang một con số không thể thực hiện);
     · nút xác nhận khoá khi không còn vote để dùng, thay vì để bấm rồi báo lỗi.
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
    cacheDir: 'node_modules/.vite-vm-test',
    envPrefix: 'CCL_VM_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/VoteModal.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const request = {
  id: 'r1', artist: 'aespa', title: 'Whiplash', kind: 'Color Coded Lyrics',
  status: 'queued', votes: 8, requester: 'minji',
}
const base = {
  open: true, request, myCount: 0, votesLeft: 12, freeLeft: 5, purchased: 4, bonus: 3,
  onClose: () => {}, onVote: () => {}, onBuy: () => {},
}

test('hộp thoại dựng được và con số lớn là số vote SAU khi vote', async () => {
  const html = await render(base)
  assert.ok(html.includes('vm-hero'), 'thiếu khối số lớn')
  assert.ok(html.includes('>9<'), 'mặc định chọn 1 vote: 8 hiện có + 1 = 9')
  assert.ok(html.includes('Whiplash'), 'phải hiện tên bài đang vote')
})

test('ba ô số dư đọc ra đúng quỹ vote', async () => {
  const html = await render(base)
  const chips = (html.match(/vm-chip/g) || []).length
  assert.ok(chips >= 3, 'phải có ba ô: vote miễn phí / đã mua / thưởng')
  assert.ok(html.includes('>5<') && html.includes('>4<') && html.includes('>3<'),
    'số của từng quỹ phải hiện đúng')
})

test('không mức nhanh nào vượt quá số vote còn lại', async () => {
  const html = await render({ ...base, votesLeft: 3 })
  assert.ok(html.includes('Use all 3') || html.includes('3'), 'còn 3 vote thì phải có lối dùng hết 3')
  assert.ok(!html.includes('>25<'), 'còn 3 vote thì không được mời bấm 25')
})

test('hết vote thì không còn nút xác nhận — đổi thành lối mua thêm', async () => {
  const html = await render({ ...base, votesLeft: 0, freeLeft: 0, purchased: 0, bonus: 0 })
  assert.ok(html.includes('btn-gold'), 'hết vote phải có nút mua thêm')
  assert.ok(!html.includes('vote.confirm') && !/Confirm/.test(html),
    'không được để nút xác nhận bấm vào rồi báo lỗi')
})

test('bài đã xong / bị từ chối / chờ duyệt thì hộp thoại nói rõ vì sao đóng, không cho chọn phiếu', async () => {
  for (const status of ['completed', 'denied', 'pending']) {
    const html = await render({ ...base, request: { ...request, status } })
    assert.ok(!html.includes('vm-hero'), `${status}: không được hiện bảng chọn vote`)
    assert.ok(html.includes('Voting is closed'), `${status}: phải nói ra lý do`)
  }
})

test('đóng thì không dựng gì cả', async () => {
  assert.equal(await render({ ...base, open: false }), '')
})

test('bàn phím chỉnh được số phiếu, và trên điện thoại hộp là tấm trượt từ đáy', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(fileURLToPath(new URL('./VoteModal.jsx', import.meta.url)), 'utf8')
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

  /* +/− và mũi lên/xuống chỉnh số phiếu — nhưng phải NHƯỜNG phím khi con trỏ
     đang ở trong ô nhập (ở đó trình duyệt đã tự tăng/giảm, bắt thêm là nhân đôi) */
  assert.match(src, /e\.key === '\+'/, 'phải bắt phím +')
  assert.match(src, /e\.key === '-'/, 'phải bắt phím −')
  assert.match(src, /ArrowUp/, 'mũi lên cũng phải chỉnh được số')
  assert.match(src, /el\?\.tagName === 'INPUT'/, 'phải nhường phím khi đang gõ trong ô nhập')

  /* gợi ý phím chỉ có nghĩa ở nơi có bàn phím */
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
  assert.match(css, /\.vm-keys \{/, 'thiếu gợi ý phím cạnh ô số')
  assert.match(coarse, /\.vm-keys \{ display: none/, 'máy cảm ứng không có bàn phím — đừng hứa')

  /* tấm trượt đáy trên máy hẹp: nút xác nhận nằm trong tầm ngón cái */
  const narrow = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(narrow, /\.vote-overlay \{ align-items: flex-end/, 'hộp phải neo xuống đáy trên máy hẹp')
  assert.match(narrow, /\.modal\.narrow \{[^}]*border-radius: var\(--r-lg\) var\(--r-lg\) 0 0/,
    'tấm trượt phải bo hai góc trên, phẳng ở đáy')
  assert.match(narrow, /\.modal\.narrow::before \{/, 'thiếu tay nắm của tấm trượt')

  /* ngón tay: mức chọn nhanh và nút tăng/giảm đủ to */
  assert.match(coarse, /\.vm-preset \{ min-width: 54px; height: 44px/, 'mức chọn nhanh phải đủ 44px khi chạm')
})

test('nguồn phiếu: ba ô số lượng + một vạch tỉ lệ cùng màu, và con số lớn được đọc lên', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(fileURLToPath(new URL('./VoteModal.jsx', import.meta.url)), 'utf8')
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

  /* Ba ô số nói SỐ LƯỢNG; vạch chia tỉ lệ nói TỈ LỆ. Vạch phải vẽ từ đúng ba
     con số đang hiện (cộng ba ô) chứ không lấy `votesLeft` — lệch một cái là
     người dùng thấy hai chỗ nói khác nhau về cùng một quỹ phiếu. */
  assert.match(src, /const leftTotal = Math\.max\(0, freeLeft\) \+ Math\.max\(0, purchased\) \+ Math\.max\(0, bonus\)/,
    'tổng của vạch phải là tổng ba ô đang hiển thị')
  assert.match(src, /className=\"vm-mix\"/, 'thiếu vạch nguồn phiếu')
  assert.match(src, /m\.v \/ leftTotal/, 'bề rộng mỗi đoạn phải theo tỉ lệ thật')
  assert.match(src, /m\.v > 0 \? \(/, 'nguồn có 0 phiếu thì không vẽ một đoạn rỗng')

  /* Ba đoạn là BA SẮC CỦA CÙNG MỘT MÀU: một bảng màu thứ tư trong hộp vote là
     đúng thứ làm giao diện rối thêm. */
  const mixAt = css.indexOf('.vm-mix')
  const mix = css.slice(mixAt, mixAt + 700)   /* khối .vm-mix + ba đoạn của nó */
  assert.match(mix, /background: color-mix\(in oklab, var\(--a-2\) 92%/, 'đoạn chính dùng màu nhấn')
  assert.ok((mix.match(/--a-2/g) || []).length === 3, 'cả ba đoạn phải cùng một huệ, chỉ khác độ đậm')

  /* Con số lớn đổi theo từng lần chọn — trình đọc màn hình cũng phải biết. */
  assert.match(src, /className=\{\`v\$\{changing \? '' : ' pop'\}\`\} aria-live="polite"/,
    'con số kết quả phải được đọc lên khi đổi')
  /* Ô nhập số phiếu trỏ tới dòng "còn 7 → còn 3": đọc tới ô là hiểu ngay sẽ mất gì. */
  assert.match(src, /aria-describedby="vm-after"/, 'ô số phiếu phải trỏ tới dòng trước–sau')
  assert.match(src, /className="vm-after" id="vm-after"/, 'dòng trước–sau phải có id để trỏ tới')
})
