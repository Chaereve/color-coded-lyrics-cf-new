/* Badge nguồn tài trợ của request: paid thường và bonus phải khác chữ + hình.
   ---------------------------------------------------------
   Chỉ đổi màu là không đủ: hai tem nằm cạnh tên bài ở cỡ 10px, nên người đọc
   phải phân biệt được bằng chữ (PAID vs BONUS) và bằng biểu tượng (sao vs quà).
   Component này dùng chung cho bảng, hồ sơ, modal và admin, nên chốt ở đây.
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
    cacheDir: 'node_modules/.vite-request-payment-badge-test',
    /* .env của người lập trình không được biến test UI này thành client thật */
    envPrefix: 'CCL_REQ_PAYMENT_BADGE_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/RequestPaymentBadge.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}
after(async () => { await server?.close() })

test('request miễn phí không dựng badge', async () => {
  assert.equal(await render({ request: { is_paid: false } }), '')
  assert.equal(await render({ request: null }), '')
})

test('paid thường là tem vàng PAID REQUEST, không mang chữ BONUS', async () => {
  const html = await render({ request: { is_paid: true, payment_source: 'money', payment_status: 'paid' } })
  assert.match(html, /class="pill gold"/)
  assert.match(html, /data-payment-state="paid"/)
  assert.match(html, /PAID REQUEST/)
  assert.match(html, /confirmed money payment/)
  assert.doesNotMatch(html, /BONUS/)
  assert.doesNotMatch(html, /req-payment-ico/, 'sao của tem vàng là CSS ::before, không phải icon quà')
})

test('bonus là tem tím BONUS REQUEST có hộp quà, không dán PAID', async () => {
  const html = await render({ request: { is_paid: true, payment_source: 'bonus', payment_status: 'paid' } })
  assert.match(html, /class="pill bonus"/)
  assert.match(html, /data-payment-state="bonus"/)
  assert.match(html, /BONUS REQUEST/)
  assert.match(html, /req-payment-ico/, 'bonus phải có hình hộp quà để không chỉ khác màu')
  assert.match(html, /No money was charged/)
  assert.doesNotMatch(html, /PAID/)
  assert.doesNotMatch(html, /pill gold/)
})

test('chờ thanh toán và legacy chưa xác minh không bị gọi là paid/bonus đã chốt', async () => {
  const awaiting = await render({ request: { is_paid: true, payment_source: 'money', payment_status: 'awaiting' } })
  assert.match(awaiting, /data-payment-state="awaiting"/)
  assert.match(awaiting, /AWAITING PAYMENT/)
  assert.doesNotMatch(awaiting, /PAID REQUEST|BONUS REQUEST/)

  const legacy = await render({ request: { is_paid: true, payment_status: 'paid' } })
  assert.match(legacy, /data-payment-state="unverified"/)
  assert.match(legacy, /PAYMENT UNVERIFIED/)
  assert.doesNotMatch(legacy, /PAID REQUEST|BONUS REQUEST/)
})

test('state truyền thẳng vẫn đi qua đúng bảng nhãn/class', async () => {
  const html = await render({ state: 'bonus' })
  assert.match(html, /class="pill bonus"/)
  assert.match(html, /BONUS REQUEST/)
})
