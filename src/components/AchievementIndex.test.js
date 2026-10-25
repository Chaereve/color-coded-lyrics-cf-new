import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('Achievement Index keeps a three-row preview and an accessible full 52-item dialog', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://achievement-index.example.test' })
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
    cacheDir: 'node_modules/.vite-achievement-index-test', envPrefix: 'CCL_ACHIEVEMENT_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: AchievementIndex } = await server.ssrLoadModule('/src/components/AchievementIndex.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    root = createRoot(document.getElementById('app'))
    await act(async () => root.render(h(I18nProvider, null, h(AchievementIndex, { metrics: {} }))))

    assert.equal(document.querySelectorAll('.achievement-next-row').length, 3, 'preview contains only three nearest milestones')
    const opener = document.querySelector('.achievement-all-btn')
    assert.ok(opener, 'View all control is present')
    opener.focus()
    await act(async () => opener.click())

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    assert.ok(dialog, 'full catalog opens as a modal dialog')
    assert.equal(document.querySelectorAll('.achievement-grid-full .achievement-card').length, 52)
    assert.ok(document.querySelector('.achievement-card small')?.textContent, 'full entries retain their explanatory copy')

    const close = dialog.querySelector('.x')
    const scrollRegion = dialog.querySelector('[role="region"][tabindex="0"]')
    assert.equal(document.activeElement, close, 'opening moves focus into the dialog')
    await act(async () => close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    assert.equal(document.activeElement, scrollRegion, 'Shift+Tab wraps to the last focusable control')
    await act(async () => scrollRegion.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    assert.equal(document.activeElement, close, 'Tab wraps to the first focusable control')

    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="dialog"]'), null, 'Escape closes the dialog')
    assert.equal(document.activeElement, opener, 'closing restores focus to View all')
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
