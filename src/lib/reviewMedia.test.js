import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
const server = await createServer({ configFile: false, envPrefix: 'CCL_TEST_', plugins: [react()],
  server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' })
after(() => { delete globalThis.localStorage; return server.close() })
const db = await server.ssrLoadModule('/src/lib/db.js')

test('denial saves an existing video link; approval clears denial fields', async () => {
  store.set('ccl3_rows', JSON.stringify([{ id: 'request-1', status: 'pending' }]))
  await db.adminReview('request-1', false, 'Already made', 'https://youtu.be/abcdef12345')
  let row = JSON.parse(store.get('ccl3_rows'))[0]
  assert.equal(row.status, 'denied')
  assert.equal(row.video_url, 'https://youtu.be/abcdef12345')
  assert.equal(row.deny_reason, 'Already made')
  await assert.rejects(db.adminReview('request-1', false, null, 'javascript:void(0)'), /err.denyVideo/)
  await db.adminReview('request-1', true)
  row = JSON.parse(store.get('ccl3_rows'))[0]
  assert.equal(row.status, 'queued')
  assert.equal(row.video_url, null)
  assert.equal(row.deny_reason, null)
})

test('20 videos includes featured and hidden; editing remains possible at capacity', async () => {
  store.set('ccl3_media', JSON.stringify(Array.from({ length: 19 }, (_, i) => ({ id: String(i), kind: i ? 'video' : 'featured', is_hidden: i === 1 }))))
  const data = { kind: 'video', title: 'A video', url: 'https://youtu.be/abcdef12345' }
  const added = await db.saveMedia(data)
  assert.equal(JSON.parse(store.get('ccl3_media')).length, 20)
  await assert.rejects(db.saveMedia({ ...data, kind: 'featured' }), /err.mediaLimit/)
  await db.saveMedia({ ...data, id: added.id, title: 'Updated title' })
  await db.deleteMedia(added.id)
  await db.saveMedia(data)
  assert.equal(JSON.parse(store.get('ccl3_media')).length, 20)
})

test('showcase renders at most 20 items including the featured item', async () => {
  const { default: Showcase } = await server.ssrLoadModule('/src/components/MediaShowcase.jsx')
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const videos = Array.from({ length: 25 }, (_, i) => ({ key: `v${i}`, id: 'abcdef12345', title: `Video ${i}` }))
  const render = featured => renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(Showcase, { featured, videos })))
  for (const featured of [null, { key: 'featured', id: 'abcdef12345', title: 'Featured' }]) {
    const html = render(featured)
    assert.equal((html.match(/class="pvrow/g) || []).length, 20)
  }
})
