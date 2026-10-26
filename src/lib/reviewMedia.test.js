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

const videoCount = rows => rows.filter(row => row.kind === 'video' || row.kind === 'playlist').length

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

test('20 Latest videos are allowed in addition to one Featured slot', async () => {
  const initial = Array.from({ length: 20 }, (_, i) => ({
    id: String(i), kind: i === 0 ? 'featured' : 'video', is_hidden: i === 1,
  }))
  store.set('ccl3_media', JSON.stringify(initial))
  const data = { kind: 'video', title: 'A video', url: 'https://youtu.be/abcdef12345' }
  const added = await db.saveMedia(data)
  let rows = JSON.parse(store.get('ccl3_media'))
  assert.equal(rows.length, 21)
  assert.equal(videoCount(rows), 20)
  await assert.rejects(db.saveMedia(data), /err.mediaLimit/)
  await assert.rejects(db.saveMedia({ ...data, kind: 'featured' }), /err.mediaFeaturedLimit/)
  await db.saveMedia({ ...data, id: added.id, title: 'Updated title' })
  await db.deleteMedia(added.id)
  await db.saveMedia(data)
  rows = JSON.parse(store.get('ccl3_media'))
  assert.equal(rows.length, 21)
  assert.equal(videoCount(rows), 20)
})

test('media admin shows Latest-video capacity without counting Featured', async () => {
  const { default: MediaAdmin } = await server.ssrLoadModule('/src/components/MediaAdmin.jsx')
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const media = [
    { id: 'featured', kind: 'featured', title: 'Feature', url: 'https://youtu.be/abcdef12345' },
    ...Array.from({ length: 19 }, (_, i) => ({
      id: `video-${i}`, kind: 'video', title: `Video ${i}`,
      url: `https://youtu.be/abcde${String(i).padStart(2, '0')}123`, created_at: new Date().toISOString(),
    })),
  ]
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(MediaAdmin, { media })))
  assert.match(html, /19\/20 videos \(Featured is separate\)/)
})

test('showcase renders 20 Latest videos plus the separate Featured item', async () => {
  const { default: Showcase } = await server.ssrLoadModule('/src/components/MediaShowcase.jsx')
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const videos = Array.from({ length: 25 }, (_, i) => ({ key: `v${i}`, id: 'abcdef12345', title: `Video ${i}` }))
  const render = featured => renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(Showcase, { featured, videos })))
  assert.equal((render(null).match(/class="pvrow/g) || []).length, 20)
  assert.equal((render({ key: 'featured', id: 'abcdef12345', title: 'Featured' }).match(/class="pvrow/g) || []).length, 21)
})
