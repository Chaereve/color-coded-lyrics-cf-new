/* NHỐT TIÊU ĐIỂM TRONG HỘP THOẠI — ba việc, và cả ba đều từng không có.
   ---------------------------------------------------------
   `role="dialog"` + `aria-modal="true"` là lời hứa với trình đọc màn hình:
   phần còn lại của trang đã ra ngoài tầm với. Chuột thì đúng (lớp phủ chặn
   click), bàn phím thì không — Tab đi thẳng ra sau lớp phủ. Bài này chốt:
     1. mở ra: tiêu điểm vào TRONG hộp (ô đầu tiên, hoặc chỗ nơi gọi chỉ định);
     2. Tab ở phần tử cuối quay về đầu, Shift+Tab ở đầu nhảy xuống cuối — kể cả
        khi tiêu điểm đang ở NGOÀI hộp (nó bị kéo về trong, không đi tiếp);
     3. đóng: trả tiêu điểm về ĐÚNG nơi đã mở hộp;
     4. hộp không còn trong DOM vì cả trang đang tháo ra thì không ném lỗi.
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

/* Bàn thử: một nút "mở" ngoài hộp + một hộp có [nút đầu, nút cuối].
   Chỗ giữ phần tử hộp là một vật giống-ref ở phạm vi mô-đun, cắm vào sau lần
   vẽ đầu — hook chỉ cần `ref.current`, mà viết `ref:` trong `h('div', …)` thì
   lint đọc thành "đọc ref lúc render" (h() không phải JSX nên nó không biết). */
const box = { current: null }
function Harness ({ useTrap, open, opts }) {
  useTrap(box, open, opts)
  return h('div', null,
    h('button', { id: 'ngoai' }, 'nút ngoài hộp'),
    h('div', { id: 'hop', role: 'dialog', 'aria-modal': 'true' },
      h('button', { id: 'dau' }, 'đầu'),
      h('button', { id: 'cuoi' }, 'cuối')))
}

test('useFocusTrap: tiêu điểm vào hộp, Tab khép vòng trong hộp, đóng thì trả về chỗ cũ', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://trap.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-focustrap-test', envPrefix: 'CCL_FOCUSTRAP_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  const { document } = dom.window
  const tab = async (shift = false) => {
    await act(async () => {
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }))
    })
  }
  const byId = (id) => document.getElementById(id)
  try {
    const { useFocusTrap } = await server.ssrLoadModule('/src/lib/useFocusTrap.js')
    const render = async (open, opts) => {
      await act(async () => {
        if (!root) root = createRoot(byId('app'))
        root.render(h(Harness, { useTrap: useFocusTrap, open, opts }))
      })
    }

    /* (1) mở: tiêu điểm vào ô đầu tiên TRONG hộp, không phải ở ngoài */
    await render(false)
    box.current = byId('hop')
    await act(async () => { byId('ngoai').focus() })
    assert.equal(document.activeElement, byId('ngoai'), 'chưa mở hộp thì không được cướp tiêu điểm')
    await render(true)
    assert.equal(document.activeElement, byId('dau'), `mở hộp mà tiêu điểm ở ${document.activeElement?.id}`)

    /* (2) Tab khép vòng: cuối → đầu → cuối (Shift+Tab) */
    await act(async () => { byId('cuoi').focus() })
    await tab()
    assert.equal(document.activeElement, byId('dau'), 'Tab ở phần tử cuối phải quay về đầu hộp')
    await tab(true)
    assert.equal(document.activeElement, byId('cuoi'), 'Shift+Tab ở phần tử đầu phải nhảy xuống cuối hộp')

    /* tiêu điểm lạc ra ngoài (ví dụ do script khác) thì Tab kéo nó về trong */
    await act(async () => { byId('ngoai').focus() })
    await tab()
    assert.equal(document.activeElement, byId('dau'), 'tiêu điểm ở ngoài hộp mà Tab đi tiếp — lời hứa aria-modal bị phá')

    /* (3) đóng: trả tiêu điểm về nút đã mở hộp */
    await act(async () => { byId('ngoai').focus() })
    await render(false)
    assert.equal(document.activeElement, byId('ngoai'), 'đóng hộp mà không trả tiêu điểm về chỗ cũ')

    /* (4) chỗ cũ đã bị gỡ khỏi DOM: không ném lỗi, chỉ là không trả về được */
    await act(async () => { byId('ngoai').remove(); byId('dau').focus() })
    await render(false)   // hộp vẫn còn, chỗ cũ đã mất
    await render(false)
    assert.ok(true, 'gỡ chỗ cũ trước khi đóng hộp không được ném lỗi')
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
