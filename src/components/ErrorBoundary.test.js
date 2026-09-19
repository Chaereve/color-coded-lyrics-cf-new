/* Chốt hai điều mắt thường không kiểm được khi app vẫn chạy đúng:
   ---------------------------------------------------------
   1) `CrashCard` — màn thay cho "trang đen" — SSR ra đủ câu giải thích, nút
      tải lại, và CHÍNH thông điệp lỗi (không có nó thì người báo lỗi chỉ nói
      được "nó đen");
   2) `main.jsx` thật sự bọc app trong lưới. Thiếu dòng bọc đó thì lưới vô
      dụng mà mọi test khác vẫn xanh — đúng kiểu lỗi im lặng mà file này sinh
      ra để chặn.

   ErrorBoundary là class nên chỉ chạy được ở môi trường DOM thật; phần render
   của màn lỗi thì SSR được, nên tách `CrashCard` ra và test nó ở đây. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const S = {
  'crash.title': 'This page hit an error while drawing.',
  'crash.body': 'Nothing was lost.',
  'crash.details': 'What the error says',
  'crash.reload': 'Reload',
}
const t = (k) => S[k]

let server
test.after(() => server?.close())
async function crashHtml(err) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-crash-test', envPrefix: 'CCL_CRASH_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { CrashCard } = await server.ssrLoadModule('/src/components/ErrorBoundary.jsx')
  return renderToStaticMarkup(createElement(CrashCard, { err, t }))
}

test('màn lỗi: có chữ giải thích, nút tải lại, và lỗi thật', async () => {
  const html = await crashHtml(new Error('Boom 42'))
  assert.match(html, /role="alert"/, 'phải là vùng báo động cho trình đọc màn hình')
  assert.match(html, /This page hit an error while drawing\./)
  assert.match(html, /Nothing was lost\./)
  assert.match(html, /Boom 42/, 'thông điệp lỗi thật phải hiện — không thì không ai báo được lỗi')
  assert.match(html, /<button type="button"[^>]*>Reload<\/button>/,
    'nút tải lại phải là button type="button" (không nằm trong form nào, nhưng đừng để mặc định submit)')
  assert.ok(!/undefined|\[object Object\]/.test(html), `chữ rác lọt ra màn hình: ${html.slice(0, 200)}`)
})

test('màn lỗi chịu được thứ không phải Error', async () => {
  for (const bad of ['chuỗi trần', 0, null]) {
    const html = await crashHtml(bad)
    assert.match(html, /This page hit an error while drawing\./, `err=${String(bad)} làm vỡ màn lỗi`)
    assert.ok(!/undefined|\[object Object\]/.test(html), `err=${String(bad)} in ra chữ rác`)
  }
})

test('main.jsx bọc cả app trong lưới — thiếu là lưới vô dụng', () => {
  const src = readFileSync(at('../../src/main.jsx'), 'utf8')
  assert.match(src, /import ErrorBoundary from '\.\/components\/ErrorBoundary\.jsx'/)
  assert.match(src, /<ErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/,
    'App phải nằm TRONG <ErrorBoundary>, không phải anh em của nó')
})
