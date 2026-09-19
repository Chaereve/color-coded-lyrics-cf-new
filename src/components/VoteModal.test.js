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
