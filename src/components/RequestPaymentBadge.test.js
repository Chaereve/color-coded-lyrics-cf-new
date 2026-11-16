/* Badge nguồn tài trợ của request: PAID và BONUS khác chữ + màu.
   ---------------------------------------------------------
   Chủ dự án chốt chỉ giữ chữ, bỏ cả sao lẫn hộp quà; không phân biệt bằng màu
   một mình. Component này dùng chung cho bảng, hồ sơ, modal và admin, nên chốt
   ở đây, kể cả khi nhãn được truyền thẳng bằng prop state.
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

test('paid thường chỉ hiện chữ PAID trong tem vàng, không icon hay chữ BONUS', async () => {
  const html = await render({ request: { is_paid: true, payment_source: 'money', payment_status: 'paid' } })
  assert.match(html, /class="pill gold"/)
  assert.match(html, /data-payment-state="paid"/)
  assert.match(html, /data-payment-badge="b-text-20261115"/, 'dấu vết bản tem chỉ chữ cho edge smoke')
  assert.match(html, />PAID<\/span>/, 'chữ tem rút còn PAID, nghĩa đầy đủ nằm ở title')
  assert.match(html, /confirmed payment/)
  assert.doesNotMatch(html, /PAID REQUEST|BONUS/)
  assert.doesNotMatch(html, /<(?:svg|img)\b|req-payment-ico/, 'không còn hộp quà hay icon nào trong tem')
})

test('bonus chỉ hiện chữ BONUS trong tem tím, không hộp quà và không dán PAID', async () => {
  const html = await render({ request: { is_paid: true, payment_source: 'bonus', payment_status: 'paid' } })
  assert.match(html, /class="pill bonus"/)
  assert.match(html, /data-payment-state="bonus"/)
  assert.match(html, /data-payment-badge="b-text-20261115"/, 'cùng dấu vết bản tem chỉ chữ với PAID')
  assert.match(html, />BONUS<\/span>/, 'chữ tem rút còn BONUS, nghĩa đầy đủ nằm ở title')
  assert.match(html, /no money charged/)
  assert.doesNotMatch(html, /BONUS REQUEST|PAID|pill gold/)
  assert.doesNotMatch(html, /<(?:svg|img)\b|req-payment-ico/, 'bỏ hộp quà theo đúng phương án đã chốt')
})

test('chờ thanh toán và legacy chưa xác minh không bị gọi là paid/bonus đã chốt', async () => {
  const awaiting = await render({ request: { is_paid: true, payment_source: 'money', payment_status: 'awaiting' } })
  assert.match(awaiting, /data-payment-state="awaiting"/)
  assert.match(awaiting, /AWAITING PAYMENT/)
  assert.doesNotMatch(awaiting, /\bPAID\b|\bBONUS\b/)

  const legacy = await render({ request: { is_paid: true, payment_status: 'paid' } })
  assert.match(legacy, /data-payment-state="unverified"/)
  assert.match(legacy, /PAYMENT UNVERIFIED/)
  assert.doesNotMatch(legacy, /\bPAID\b|\bBONUS\b/)
})

test('state truyền thẳng vẫn đi qua đúng bảng nhãn/class và chỉ giữ chữ', async () => {
  const html = await render({ state: 'bonus' })
  assert.match(html, /class="pill bonus"/)
  assert.match(html, />BONUS<\/span>/)
  assert.doesNotMatch(html, /BONUS REQUEST|<(?:svg|img)\b|req-payment-ico/)
})
