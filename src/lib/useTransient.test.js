/* CỜ "VỪA XONG" PHẢI DỌN ĐỒNG HỒ CỦA NÓ.
   ---------------------------------------------------------
   Lỗi có thật: `setTimeout(() => setShared(false), 1800)` gọi thẳng trong
   `onClick` (PublicProfile) và `setTimeout(() => setExported(false), 2000)`
   (AdminPanel) — không ai dọn. Rời trang trong lúc đồng hồ đang đếm là để lại
   một `setTimeout` sống lâu hơn component.

   Phép kiểm ở đây bám đúng vào chỗ đó: theo dõi `setTimeout`/`clearTimeout`,
   tháo component khi đồng hồ còn đang chạy, và đòi đồng hồ ĐÓ phải được dọn.
   Bản cũ (hẹn giờ trong onClick, không dọn) làm bài này đỏ.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('useTransient: cờ bật rồi tự tắt, bấm lại đếm lại từ đầu, tháo trang thì dọn đồng hồ', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://transient.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  /* Theo dõi đồng hồ: giữ nguyên hành vi thật, chỉ ghi lại id và các lần dọn. */
  const timers = []
  const cleared = []
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms, ...rest) => { const id = realSet(fn, ms, ...rest); timers.push({ id, ms }); return id }
  globalThis.clearTimeout = (id) => { cleared.push(id); return realClear(id) }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-transient-test', envPrefix: 'CCL_TRANSIENT_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { useTransient } = await server.ssrLoadModule('/src/lib/useTransient.js')
    function Probe () {
      const [on, flash] = useTransient(1800)
      return h('button', { id: 'bam', onClick: flash }, on ? 'xong' : 'bấm')
    }
    const label = () => document.getElementById('bam').textContent

    await act(async () => {
      root = createRoot(document.getElementById('app'))
      root.render(h(Probe))
    })
    assert.equal(label(), 'bấm')

    /* bật: cờ đổi ngay, và đồng hồ của nó dài đúng 1800ms */
    await act(async () => { document.getElementById('bam').click() })
    assert.equal(label(), 'xong')
    const first = timers.at(-1)
    assert.equal(first.ms, 1800, `đồng hồ dài ${first.ms}ms`)

    /* bấm lần hai khi cờ đang bật: đồng hồ CŨ phải được dọn và đếm lại từ đầu */
    await act(async () => { document.getElementById('bam').click() })
    assert.equal(label(), 'xong')
    assert.ok(cleared.includes(first.id), 'bấm lần hai mà đồng hồ cũ vẫn chạy — cờ sẽ tắt sớm')
    const second = timers.at(-1)
    assert.notEqual(second.id, first.id)

    /* tự tắt khi hết giờ */
    await act(async () => { await new Promise(r => realSet(r, 1900)) })
    assert.equal(label(), 'bấm', 'hết 1800ms mà cờ chưa tắt')

    /* THÁO TRANG khi đồng hồ còn đang đếm: đồng hồ đó phải được dọn */
    cleared.length = 0
    await act(async () => { document.getElementById('bam').click() })
    const pending = timers.at(-1)
    await act(async () => { root.unmount(); root = null })
    assert.ok(cleared.includes(pending.id),
      'tháo trang giữa lúc đếm mà không dọn — setTimeout sống lâu hơn component')
  } finally {
    if (root) await act(async () => root.unmount())
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
