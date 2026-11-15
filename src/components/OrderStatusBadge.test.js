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
    envPrefix: 'CCL_ORDER_TEST_', plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null } })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/OrderStatusBadge.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, { order })))
}
after(async () => { await server?.close() })

test('order badge says expired instead of pending once the deadline passes', async () => {
  const html = await render({ id: 'o', kind: 'votes', status: 'awaiting', expires_at: '2020-01-01T00:00:00Z' })
  assert.match(html, /Expired/)
  assert.match(html, /Payment window ended/)
  assert.doesNotMatch(html, /Awaiting confirmation/)
})
test('fresh waiting order shows the remaining payment window', async () => {
  const html = await render({ id: 'o', kind: 'votes', status: 'awaiting', expires_at: new Date(Date.now() + 3600e3).toISOString() })
  assert.match(html, /Awaiting confirmation/)
  assert.match(html, /Pay within 1h/)
})
