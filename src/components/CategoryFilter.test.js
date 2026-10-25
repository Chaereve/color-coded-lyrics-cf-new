import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('CategoryFilter opens accessibly, changes category, disables empty options and closes with Escape', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://category-filter.example.test' })
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
    cacheDir: 'node_modules/.vite-category-filter-test', envPrefix: 'CCL_CATEGORY_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  let selected = 'queued'
  try {
    const { default: CategoryFilter } = await server.ssrLoadModule('/src/components/CategoryFilter.jsx')
    root = createRoot(document.getElementById('app'))
    const render = () => h(CategoryFilter, {
      id: 'status-options', label: 'Status', value: selected,
      categories: [
        { key: 'queued', label: 'In queue', count: 2, color: 'var(--queued)' },
        { key: 'completed', label: 'Completed', count: 1, color: 'var(--done)' },
        { key: 'denied', label: 'Denied', count: 0, color: 'var(--denied)' },
      ],
      onChange: value => { selected = value },
    })
    await act(async () => root.render(render()))
    const trigger = document.querySelector('.mine-filter-toggle')
    assert.ok(trigger, 'filter trigger is rendered')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.match(trigger.getAttribute('aria-label'), /Status: In queue, 2/)

    await act(async () => trigger.click())
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    assert.ok(document.querySelector('#status-options[role="group"]'))
    const denied = [...document.querySelectorAll('.mine-filter-option')].find(button => button.textContent.includes('Denied'))
    assert.equal(denied.disabled, true, 'empty categories are not selectable')

    const completed = [...document.querySelectorAll('.mine-filter-option')].find(button => button.textContent.includes('Completed'))
    await act(async () => completed.click())
    assert.equal(selected, 'completed', 'selecting a category calls onChange')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'selection closes the menu')

    await act(async () => trigger.click())
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Escape closes the menu')
    assert.equal(document.activeElement, trigger, 'Escape restores focus to the trigger')
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
