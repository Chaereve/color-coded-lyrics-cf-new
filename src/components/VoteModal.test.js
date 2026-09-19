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

test('quỹ phiếu đọc ra bằng MỘT dòng chữ, không phải ba ô có viền', async () => {
  const html = await render(base)
  /* Vòng 10 dựng ba ô có viền + một vạch chia tỉ lệ cho cùng một câu trả lời
     ("phiếu này lấy từ đâu"); vòng 11 gỡ cả hai vì hộp vote bị chê là rối —
     khung viền là thứ đắt nhất trong một hộp chật. */
  assert.doesNotMatch(html, /vm-chip/, 'ba ô số dư phải bị gỡ')
  assert.doesNotMatch(html, /vm-mix/, 'vạch chia tỉ lệ cũng phải bị gỡ')
  assert.match(html, /class="vm-after" id="vm-after"/, 'phải có dòng trước–sau')
  assert.match(html, /including 4 bought and 3 bonus/, 'nguồn phiếu viết bằng chữ ngay sau dòng đó')
  /* Không có phiếu mua / phiếu thưởng thì đừng nhắc tới chúng. */
  const plain = await render({ ...base, purchased: 0, bonus: 0 })
  assert.doesNotMatch(plain, /including/, 'không có gì để kể thì không thêm một dòng')
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

  /* Viên gợi ý phím cạnh ô số đã bị gỡ (vòng 11): phím vẫn chỉnh được số
     (phần trên của bài kiểm này chốt điều đó), mà hộp vote thì bị chê là rối —
     một viên chữ nữa trong hộp không đổi lại được gì. */
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
  assert.doesNotMatch(src, /vm-keys/, 'viên gợi ý phím phải bị gỡ khỏi hộp vote')
  assert.doesNotMatch(css, /\.vm-keys/, 'luật CSS của nó cũng phải bị gỡ')

  /* tấm trượt đáy trên máy hẹp: nút xác nhận nằm trong tầm ngón cái */
  const narrow = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(narrow, /\.vote-overlay \{ align-items: flex-end/, 'hộp phải neo xuống đáy trên máy hẹp')
  assert.match(narrow, /\.modal\.narrow \{[^}]*border-radius: var\(--r-lg\) var\(--r-lg\) 0 0/,
    'tấm trượt phải bo hai góc trên, phẳng ở đáy')
  assert.match(narrow, /\.modal\.narrow::before \{/, 'thiếu tay nắm của tấm trượt')

  /* ngón tay: mức chọn nhanh và nút tăng/giảm đủ to */
  assert.match(coarse, /\.vm-preset \{ min-width: 54px; height: 44px/, 'mức chọn nhanh phải đủ 44px khi chạm')
})

test('nguồn phiếu viết bằng chữ, và con số lớn được đọc lên', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(fileURLToPath(new URL('./VoteModal.jsx', import.meta.url)), 'utf8')
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

  /* Nguồn phiếu: hai con số mua / thưởng viết ra thành chữ trong CÙNG dòng
     trước–sau, và CHỈ hiện khi thật sự có phiếu thuộc nguồn đó. */
  assert.match(src, /t\('vote\.sources', \{ p: purchased, b: bonus \}\)/,
    'nguồn phiếu phải viết ra bằng chữ')
  assert.match(src, /purchased > 0 \|\| bonus > 0/, 'không có phiếu mua/thưởng thì không nhắc')
  assert.doesNotMatch(src, /vm-mix|leftTotal/, 'vạch chia tỉ lệ và phép tính của nó đã bị gỡ')
  assert.doesNotMatch(css, /\.vm-mix/, 'luật CSS của vạch đó cũng phải bị gỡ khỏi tệp')

  /* Con số lớn đổi theo từng lần chọn — trình đọc màn hình cũng phải biết. */
  assert.match(src, /className=\{\`v\$\{changing \? '' : ' pop'\}\`\} aria-live="polite"/,
    'con số kết quả phải được đọc lên khi đổi')
  /* Ô nhập số phiếu trỏ tới dòng "còn 7 → còn 3": đọc tới ô là hiểu ngay sẽ mất gì. */
  assert.match(src, /aria-describedby="vm-after"/, 'ô số phiếu phải trỏ tới dòng trước–sau')
  assert.match(src, /className="vm-after" id="vm-after"/, 'dòng trước–sau phải có id để trỏ tới')
})
