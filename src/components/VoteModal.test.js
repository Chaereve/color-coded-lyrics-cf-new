/* Hộp thoại nhập số vote — dựng THẬT ra HTML.
   ---------------------------------------------------------
   Thân hộp thoại vừa được viết lại (số dư còn lại · ô nhập tay · Vote all · Take back)
   nên phải có chỗ chốt: một
   biến không tồn tại trong nhánh mới là màn hình trắng ngay lúc mở, mà
   `npm run build` thì không thấy gì.
   Ba thứ được kiểm ở đây đều là LỜI HỨA với người dùng:
     · số dư cập nhật theo lượng vote đã chọn;
     · Vote all và Take back all luôn dùng đúng hạn mức riêng của từng chế độ;
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

test('hộp thoại dựng được và số dư đổi theo vote đã chọn', async () => {
  const html = await render(base)
  assert.ok(html.includes('class="vm-balance"'), 'thiếu thẻ số dư')
  assert.ok(html.includes('>11<'), 'mặc định chọn 1: còn 11 trong 12 vote')
  assert.ok(html.includes('Whiplash'), 'phải hiện tên bài đang vote')
  assert.ok(html.includes('Vote all 12'), 'có nút Vote all')
})

test('số dư và nguồn vote nằm gọn trong một thẻ', async () => {
  const html = await render(base)
  assert.match(html, /class="vm-balance"/, 'có một thẻ số dư')
  assert.match(html, /4 bought · 3 bonus/, 'nguồn phiếu được ghi gọn trong thẻ')
  /* Không có phiếu mua / phiếu thưởng thì đừng nhắc tới chúng. */
  const plain = await render({ ...base, purchased: 0, bonus: 0 })
  assert.doesNotMatch(plain, /including/, 'không có gì để kể thì không thêm một dòng')
})

test('ô nhập tay và Vote all cùng theo hạn mức hiện có', async () => {
  const html = await render({ ...base, votesLeft: 3 })
  assert.match(html, /type="number" min="1" max="3"/, 'có thể nhập số vote thủ công')
  assert.match(html, /class="vm-all"[^>]*>Vote all 3/, 'nút Vote all dùng đúng hạn mức')
  assert.doesNotMatch(html, /vm-presets|vm-preset/, 'không lặp bộ chọn số lượng')
})

test('Vote all và Take back all là hai việc độc lập, không dùng chung một con số', async () => {
  const html = await render({ ...base, votesLeft: 12, myCount: 4 })
  assert.match(html, /Vote all 12/, 'Vote all = hết phiếu đang có')
  assert.match(html, /Take back all 4/, 'Take back all = hết phiếu đã bỏ vào bài này')
  assert.match(html, /vote-modeGive|Vote/, 'có chế độ Vote')
  assert.match(html, /Take back/, 'có chế độ Take back')
  /* Qty mặc định là 1 (vote) — Take back all vẫn bấm được, không bị khoá vì 1 ≠ 4. */
  assert.match(html, /go\(-backCap\)|Take back all 4/)
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
    assert.ok(!html.includes('vm-balance'), `${status}: không được hiện bộ chọn vote`)
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

  /* ngón tay: nút tăng/giảm đủ lớn để chạm */
  assert.match(coarse, /\.qty button \{ min-width: 44px; height: 44px/, 'nút tăng/giảm phải đủ 44px khi chạm')
})

test('nguồn phiếu gọn và số dư được đọc lên', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(fileURLToPath(new URL('./VoteModal.jsx', import.meta.url)), 'utf8')
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

  /* Nguồn mua/thưởng chỉ hiện trong thẻ số dư khi có số lượng tương ứng. */
  assert.match(src, /t\('vote\.sources', \{ p: purchased, b: bonus \}\)/,
    'nguồn phiếu phải viết ra bằng chữ')
  assert.match(src, /purchased > 0 \|\| bonus > 0/, 'không có phiếu mua/thưởng thì không nhắc')
  assert.doesNotMatch(src, /vm-mix|leftTotal/, 'vạch chia tỉ lệ và phép tính của nó đã bị gỡ')
  assert.doesNotMatch(css, /\.vm-mix/, 'luật CSS của vạch đó cũng phải bị gỡ khỏi tệp')

  /* Số dư đổi theo lựa chọn — trình đọc màn hình cũng phải biết. */
  assert.match(src, /<strong aria-live="polite">\{giving \? leftAfter : mineAfter\}<\/strong>/,
    'số dư phải được đọc lên khi đổi')
  assert.match(src, /aria-describedby="vm-balance"/, 'ô số phiếu phải trỏ tới thẻ số dư')
  assert.match(src, /className=\{`vm-balance\$\{giving \? '' : ' is-back'\}`\} id="vm-balance"/, 'thẻ số dư có id')
})
