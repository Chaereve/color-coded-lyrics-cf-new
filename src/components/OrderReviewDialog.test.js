import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server
async function render(order) {
  server = server || await createServer({ root, configFile: false, mode: 'test', logLevel: 'error',
    envPrefix: 'CCL_REVIEW_TEST_', plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null } })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/OrderReviewDialog.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(mod.default, { order, onClose: () => {}, onConfirm: () => {} })))
}
after(async () => { await server?.close() })
const order = { id: 'abcdef12-3456-7890-abcd-ef1234567890', kind: 'votes', status: 'awaiting', amount_vnd: 13000, amount_usd: 0.49 }

test('manual review starts empty and cannot confirm until evidence matches', async () => {
  const html = await render(order)
  assert.match(html, /Confirm payment/)
  assert.match(html, /Expected: 13,000₫/)
  assert.match(html, /V-ABCDEF1234567890ABCDEF1234567890/)
  assert.match(html, /<button type="button" class="btn btn-ok" disabled=""/)
})
test('late payment is called out before an admin records it', async () => {
  const html = await render({ ...order, status: 'expired', expired_at: '2026-11-15T00:00:00Z' })
  assert.match(html, /payment window ended/)
})
