import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('preview shows service errors, retries to a video, and recovers from stream errors', async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://preview.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    requestAnimationFrame: callback => { callback(); return 0 }, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-drive-preview-test', plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  let calls = 0
  const streamUrl = '/api/drive-video/stream?artist=KickFlip&title=Band-Aid'
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return calls === 1
      ? Response.json({ error: 'drive_not_configured' }, { status: 503 })
      : Response.json({ url: streamUrl })
  })
  try {
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const { default: Modal } = await server.ssrLoadModule('/src/components/VideoPreviewModal.jsx')
    await act(async () => {
      root = createRoot(document.getElementById('app'))
      root.render(h(I18nProvider, null, h(Modal, {
        video: { id: 'test', artist: 'KickFlip', title: 'Band-Aid', video_url: 'https://youtu.be/fkBUvKuXEKs' },
        onClose: () => {},
      })))
    })
    assert.match(document.querySelector('.video-preview-notice').textContent, /not configured/)
    assert.ok(document.querySelector('iframe'), 'YouTube fallback remains usable')
    await act(async () => document.querySelector('.video-preview-notice button').click())
    assert.equal(calls, 2)
    assert.equal(document.querySelector('video').getAttribute('src'), streamUrl)
    assert.equal(document.querySelector('.video-preview-notice'), null)
    assert.equal(document.querySelector('iframe'), null)
    await act(async () => document.querySelector('video').dispatchEvent(new dom.window.Event('error')))
    assert.match(document.querySelector('.video-preview-notice').textContent, /found but could not be played/)
    assert.equal(document.querySelector('video'), null)
    assert.ok(document.querySelector('iframe'))
    await act(async () => document.querySelector('.video-preview-notice button').click())
    assert.ok(document.querySelector('video'))
    assert.equal(calls, 3)
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
