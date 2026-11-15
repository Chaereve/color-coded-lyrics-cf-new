import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { orderTransferContent } from '../lib/requestPayment.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server
async function load(path) {
  server ||= await createServer({ root, configFile: false, mode: 'test', logLevel: 'error',
    envPrefix: 'CCL_ORDER_PAYMENT_TEST_', plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null } })
  return server.ssrLoadModule(path)
}
async function render(path, props) {
  const { I18nProvider } = await load('/src/lib/i18n.jsx')
  const mod = await load(path)
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}
after(async () => { await server?.close() })

const order = { id: 'dceafd94-8ce3-40e1-b6b2-e37dede3a064', kind: 'paid_request', amount_vnd: 20000, amount_usd: 0.75, status: 'awaiting' }
const reference = orderTransferContent(order)

test('đơn đóng chỉ hiện một nút Pay now; không tải QR hoặc in chi tiết khi chưa cần', async () => {
  const html = await render('/src/components/OrderPayment.jsx', { order })
  assert.match(html, /<details class="order-payment-details"/)
  assert.match(html, /<summary[^>]*class="order-pay-toggle"/)
  assert.match(html, /Pay now/)
  assert.doesNotMatch(html, /Reference:|Transfer reference|<canvas|paytile|order-payment-panel/)
  assert.doesNotMatch(html, new RegExp(reference))
})

test('khung thanh toán không lặp số tiền/trạng thái của hàng và giữ mã đầy đủ một chỗ', async () => {
  const html = await render('/src/components/PaymentMethods.jsx', {
    amountVnd: 20000, amountUsd: 0.75, content: reference, awaiting: true, showAmount: false, showReference: false, defaultMethod: 'bank',
  })
  assert.doesNotMatch(html, /iv-sum|iv-amt|20,000|0\.75/)
  assert.doesNotMatch(html, /class="iv-status"/, 'hàng bên trên đã nói đang chờ, không lặp trong hóa đơn')
  assert.match(html, /Amount and reference are filled in/)
  assert.match(html, /Check the amount and reference/)
  assert.match(html, /The order updates after admin confirmation/)
  assert.match(html, /paytile bank/)
  assert.match(html, /paytile paypal/)
})

test('PayPal nói rõ phải thêm mã vào note; không hứa link đã điền mã', async () => {
  const html = await render('/src/components/PaymentMethods.jsx', {
    amountVnd: 20000, amountUsd: 0.75, content: reference, awaiting: true, defaultMethod: 'paypal',
  })
  assert.match(html, /Add the transfer reference above to your PayPal note/)
  assert.match(html, /Open PayPal/)
  assert.doesNotMatch(html, /paypal\.me\/[^"<]+PR-/)
  assert.doesNotMatch(html, /Amount and reference are filled in/)
})

test('vote shop giữ luồng cũ: chưa chọn phương thức, không tự điền mã vào QR ngân hàng', async () => {
  const html = await render('/src/components/PaymentMethods.jsx', { amountVnd: 20000, amountUsd: 0.75, content: 'Buyer name' })
  assert.match(html, /Select a payment method/)
  assert.doesNotMatch(html, /Amount and reference are filled in/)
})
