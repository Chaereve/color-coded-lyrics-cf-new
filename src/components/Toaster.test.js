/* THÔNG BÁO PHẢI ĐƯỢC ĐỌC LÊN — vùng live phải CÓ TRƯỚC nội dung.
   ---------------------------------------------------------
   Toast là kênh phản hồi chính của app (lưu xong, vote xong, lỗi mạng…), mà
   trình đọc màn hình chỉ đọc những THAY ĐỔI bên trong một vùng `aria-live` đã
   tồn tại. Bản trước `return null` khi chưa có mẩu tin nào, nên vùng live được
   gắn vào DOM cùng lúc với mẩu tin đầu tiên — với phần lớn người dùng, mẩu duy
   nhất — và bị coi là nội dung nền: im lặng.

   Bài này chốt bằng thứ tự THẬT của DOM, không phải bằng attribute:
     1. chưa có tin nào → vùng `[aria-live]` đã nằm trong DOM;
     2. tin đầu tiên hiện ra → nó nằm BÊN TRONG vùng đã có đó (cùng một nút);
     3. tin biến mất → vùng vẫn còn (lần sau không phải gắn lại).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

/* Nơi gọi giữ hàm `push` ra ngoài để test bấm được nút thật. */
let api = null
function Probe () {
  const { push } = useNotifyRef()
  useEffect(() => { api = push }, [push])
  return null
}
let useNotifyRef = () => ({ push: () => {} })

test('Toaster: vùng live có trước nội dung, tin đầu tiên nằm trong đó', async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: 'https://toast.example.test',
    /* Toaster đếm giờ bằng requestAnimationFrame — jsdom chỉ có hàm này khi bật
       chế độ "giả lập hiển thị". */
    pretendToBeVisual: true,
  })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    /* Toaster đếm giờ bằng rAF (không phải setTimeout) — jsdom có hàm này trên
       window của nó, còn mã app gọi hàm toàn cục. */
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-toaster-test', envPrefix: 'CCL_TOASTER_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: Toaster } = await server.ssrLoadModule('/src/components/Toaster.jsx')
    const { NotifyProvider, useNotify } = await server.ssrLoadModule('/src/lib/notify.jsx')
    const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    useNotifyRef = useNotify

    await act(async () => {
      root = createRoot(document.getElementById('app'))
      root.render(h(I18nProvider, null, h(NotifyProvider, null, h(Toaster), h(Probe))))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    /* (1) chưa có tin: vùng live vẫn phải ở đó */
    const live = document.querySelector('[aria-live="polite"]')
    assert.ok(live, 'chưa có tin nào mà vùng live chưa nằm trong DOM — tin đầu tiên sẽ không được đọc')
    assert.ok(document.querySelectorAll('.toast').length === 0, 'chưa bấm gì mà đã có tin')

    /* (2) tin đầu tiên: phải nằm TRONG vùng đã có (cùng nút DOM) */
    await act(async () => { api({ tone: 'ok', title: 'Đã lưu', body: 'Xong.' }) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const toast = document.querySelector('.toast')
    assert.ok(toast, 'bấm thông báo mà không có mẩu tin nào')
    assert.equal(document.querySelector('[aria-live="polite"]'), live,
      'vùng live bị dựng lại cùng mẩu tin — trình đọc màn hình không đọc')
    assert.ok(live.contains(toast), 'mẩu tin nằm NGOÀI vùng live')
    assert.ok(/Đã lưu/.test(toast.textContent), toast.textContent)

    /* (3) tin đi hết (bấm nút đóng): vùng live ở lại */
    await act(async () => { toast.querySelector('.toast-x').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 260)) })
    assert.equal(document.querySelectorAll('.toast').length, 0, 'bấm đóng mà tin vẫn còn')
    assert.equal(document.querySelector('[aria-live="polite"]'), live,
      'vùng live biến mất khi hết tin — tin sau lại rơi vào trường hợp "gắn cùng lúc"')
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
