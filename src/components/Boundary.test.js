/* LƯỚI AN TOÀN CỦA MỘT KHỐI — chữ phải đến từ từ điển, và nút thử lại phải có.
   ---------------------------------------------------------
   `Boundary.jsx` là thứ người dùng đọc khi một vùng hỏng: nó KHÔNG được là chỗ
   duy nhất trong app còn chữ tiếng Anh viết cứng, và cũng không được là một
   tấm bảng không có đường bấm tiếp. Ba điều bài này chốt:
     1. mặc định (không truyền title/body/retry) = câu trong `strings.js`, không
        phải câu chép tay lệch chữ ("This part…" của bản cũ);
     2. nút thử lại LUÔN có mặt, kể cả khi nơi gọi quên truyền chữ;
     3. nơi gọi truyền chữ riêng thì chữ riêng thắng (App.jsx vẫn truyền).
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

/* Con hỏng ĐÚNG MỘT LẦN: lần vẽ đầu ném lỗi, sau khi bấm thử lại thì vẽ được.
   Có vậy mới phân biệt được "nút gọi lại thật" với "nút chỉ tắt bảng". */
let boom = true
function Flaky () {
  if (boom) throw new Error('boom trong lúc vẽ')
  return h('p', { className: 'da-song' }, 'vùng này đã dựng lại được')
}

test('Boundary: chữ mặc định đến từ từ điển, nút thử lại luôn có', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://boundary.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const logged = []
  const realError = console.error
  console.error = (...args) => logged.push(args.join(' '))
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-boundary-test', envPrefix: 'CCL_BOUNDARY_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: Boundary } = await server.ssrLoadModule('/src/components/Boundary.jsx')
    const { I18nProvider, translate } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const mount = async (props) => {
      if (root) { const old = root; root = null; await act(async () => old.unmount()) }
      root = createRoot(document.getElementById('app'))
      await act(async () => { root.render(h(I18nProvider, null, h(Boundary, props, h(Flaky)))) })
      await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    }
    const text = () => document.body.textContent.replace(/\s+/g, ' ').trim()

    /* (1)+(2) không truyền gì: câu của từ điển + nút thử lại */
    boom = true
    await mount({ label: 'Bảng yêu cầu' })
    assert.ok(document.querySelector('.boundary[role="alert"]'), 'một vùng hỏng mà không có bảng báo')
    assert.ok(text().includes(translate('err.blockTitle')), text())
    assert.ok(text().includes(translate('err.blockBody')), text())
    assert.ok(text().includes(translate('boundary.why')), 'mục chi tiết kỹ thuật cũng là chữ của app')
    const btn = [...document.querySelectorAll('.boundary button')]
      .find(b => (b.textContent || '').trim() === translate('err.blockRetry'))
    assert.ok(btn, 'bảng báo hỏng mà không có nút thử lại — chỉ còn cách bấm F5')
    assert.ok(logged.some(l => l.includes('[boundary]')), 'phải còn vết trong console để lần ra gốc')

    /* (2) nút thử lại dựng lại ĐÚNG vùng đó */
    boom = false
    await act(async () => { btn.click() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    assert.ok(document.querySelector('.da-song'), 'bấm thử lại mà vùng vẫn chưa dựng lại')
    assert.ok(!document.querySelector('.boundary'), 'dựng lại được rồi mà bảng báo còn nằm lại')

    /* (3) chữ do nơi gọi truyền thì thắng (App.jsx vẫn truyền) */
    boom = true
    await mount({ title: 'Tiêu đề riêng', body: 'Mô tả riêng', retry: 'Thử lại nhé' })
    assert.ok(text().includes('Tiêu đề riêng') && text().includes('Mô tả riêng'), text())
    assert.ok([...document.querySelectorAll('.boundary button')]
      .some(b => (b.textContent || '').trim() === 'Thử lại nhé'), text())
  } finally {
    if (root) await act(async () => root.unmount())
    console.error = realError
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
