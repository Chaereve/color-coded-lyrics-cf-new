import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('lý do từ chối chỉ xuất hiện sau khi bấm Denied; đóng bằng Escape hoặc bấm ngoài', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://deny.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-deny-reason-test', envPrefix: 'CCL_DENY_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: DenyReason } = await server.ssrLoadModule('/src/components/DenyReason.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    root = createRoot(document.getElementById('app'))
    await act(async () => root.render(h(I18nProvider, null,
      h(DenyReason, { reason: 'This request already exists.', label: 'Denied', className: 'status s-denied' }))))

    const button = document.querySelector('.deny-reason-trigger')
    assert.ok(button, 'Denied phải là nút mở lý do')
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    assert.ok(!document.body.textContent.includes('This request already exists.'), 'không lộ lý do trước khi bấm')

    await act(async () => button.click())
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    assert.ok(document.querySelector('.deny-reason-popover')?.textContent.includes('This request already exists.'))

    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(button.getAttribute('aria-expanded'), 'false', 'Escape đóng popup')
    assert.ok(!document.querySelector('.deny-reason-popover'))

    await act(async () => button.click())
    await act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })))
    assert.equal(button.getAttribute('aria-expanded'), 'false', 'bấm ngoài đóng popup')
  } finally {
    if (root) await act(async () => root.unmount())
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
