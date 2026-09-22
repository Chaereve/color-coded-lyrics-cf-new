import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))
test('Comments UI: all depths reply to the selected ID, self handle, reload, permissions and subtree deletion', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://comments.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-comments-ui-test', envPrefix: 'CCL_COMMENTS_UI_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: Comments } = await server.ssrLoadModule('/src/components/Comments.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const { NotifyProvider } = await server.ssrLoadModule('/src/lib/notify.jsx')
    const requestId = 'A', user = { id: 'self', name: 'park ssaem' }
    const stored = [
      { id: 'root', request_id: 'A', user_id: 'other', parent_id: null, author: 'Root User', body: 'Root' },
      { id: 'r1', request_id: 'A', user_id: 'self', parent_id: 'root', author: 'park ssaem', body: 'Reply one' },
      { id: 'r2', request_id: 'A', user_id: 'third', parent_id: 'r1', author: 'Third User', body: 'Reply two' },
    ]
    localStorage.setItem('ccl.comments.A', JSON.stringify(stored))
    // The actual DB demo helper also needs the authenticated display name.
    localStorage.setItem('ccl3_user', JSON.stringify(user))
    const counts = [], logins = []
    root = createRoot(document.getElementById('app'))
    const render = async (u = user) => act(async () => root.render(h(I18nProvider, null,
      h(NotifyProvider, null, h(Comments, { requestId, user: u, initialCount: 3, onCountChange: n => counts.push(n), onLogin: () => logins.push(true) })))))
    const click = async node => { assert.ok(node); await act(async () => node.click()) }
    const row = id => document.querySelector(`[data-comment-id="${id}"]`)
    await render()
    await click(document.querySelector('.comments-toggle'))
    assert.equal(document.querySelectorAll('.comment-reply-btn').length, 3)
    assert.equal(document.querySelectorAll('.comment-thread').length, 1)
    assert.ok(row('root')); assert.ok(row('r1')); assert.ok(row('r2'))
    assert.equal(document.querySelectorAll('.comment-delete').length, 1)
    assert.ok(row('r1').querySelector('.comment-delete'))

    await click(row('root').querySelector('.comment-reply-btn'))
    assert.equal(document.querySelector('form').dataset.parentId, 'root')
    await click(row('r1').querySelector('.comment-reply-btn'))
    assert.equal(document.querySelector('form').dataset.parentId, 'r1')
    assert.equal(document.querySelector('input').value, '@park_ssaem ')
    await act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    const created = JSON.parse(localStorage.getItem('ccl.comments.A'))[0]
    assert.equal(created.parent_id, 'r1'); assert.equal(created.request_id, requestId)
    assert.equal(created.body, '@park_ssaem')
    assert.equal(row(created.id).querySelector('.comment-author').textContent, 'park ssaem')
    assert.equal(row(created.id).querySelector('mark').textContent, '@park_ssaem')
    await click(row(created.id).querySelector('.comment-reply-btn'))
    assert.equal(document.querySelector('input').value, '@park_ssaem ')
    assert.equal(document.querySelector('form').dataset.parentId, created.id)

    await click(row('r2').querySelector('.comment-reply-btn'))
    assert.equal(document.querySelector('form').dataset.parentId, 'r2')
    await click(document.querySelector('.comments-toggle'))
    await click(document.querySelector('.comments-toggle'))
    assert.equal(document.querySelectorAll('.comment-card').length, 4, 'reload keeps all levels')
    await click(row(created.id).querySelector('.comment-reply-btn'))
    await click(row('r1').querySelector('.comment-delete'))
    assert.equal(document.querySelectorAll('.comment-card').length, 1, 'delete removes entire subtree locally and in storage')
    assert.deepEqual(JSON.parse(localStorage.getItem('ccl.comments.A')).map(c => c.id), ['root'])
    assert.equal(document.querySelector('.replying'), null)
    assert.equal(counts.at(-1), 1)

    await render(null)
    assert.equal(document.querySelectorAll('.comment-delete').length, 0)
    await click(row('root').querySelector('.comment-reply-btn'))
    assert.equal(logins.length, 1)
    await render({ id: 'admin', name: 'Admin', isAdmin: true })
    assert.ok(row('root').querySelector('.comment-delete'))
    await click(row('root').querySelector('.comment-delete'))
    assert.equal(document.querySelectorAll('.comment-card').length, 0)
    assert.equal(counts.at(-1), 0)
    assert.equal(document.querySelector('.comments-toggle b'), null, 'do not resurrect initialCount after final delete')
  } finally {
    if (root) await act(async () => root.unmount())
    await server.close(); dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
