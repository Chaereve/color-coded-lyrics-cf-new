/* Đầu dò vòng 12: dựng app thật trong jsdom rồi in ra đúng những chỗ đang bị báo lỗi
   (trang quản trị: dải số liệu vs danh sách; thanh lọc; vòng quay).
   Chạy: node tools/_probe12.mjs */
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = '/home/user/color-coded-lyrics-cf-new/'
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'https://localhost/', pretendToBeVisual: true,
})
const { window } = dom
window.IntersectionObserver = class { constructor(cb) { this.cb = cb } observe(el) { this.cb([{ isIntersecting: true, target: el, boundingClientRect: { top: 0 } }], this) } unobserve() {} disconnect() {} takeRecords() { return [] } }
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }))
window.scrollTo = () => {}
window.Element.prototype.scrollIntoView = () => {}
if (!window.HTMLElement.prototype.animate) window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve(), onfinish: null })
for (const k of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver',
  'matchMedia', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'Blob', 'URL', 'URLSearchParams', 'DOMParser', 'Image', 'MutationObserver']) {
  if (window[k] === undefined) continue
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }) } catch {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const server = await createServer({
  root, configFile: false, mode: 'test', logLevel: 'error',
  cacheDir: 'node_modules/.vite-smoke', envPrefix: 'CCL_SMOKE_',
  plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
})
const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const App = (await server.ssrLoadModule('/src/App.jsx')).default
const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
const { NotifyProvider } = await server.ssrLoadModule('/src/lib/notify.jsx')

await act(async () => {
  createRoot(window.document.getElementById('root')).render(createElement(I18nProvider, null,
    createElement(NotifyProvider, null, createElement(App))))
})
const q = (s) => window.document.querySelector(s)
const qa = (s) => [...window.document.querySelectorAll(s)]
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '(không có)')
const tick = async (ms = 60) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(120) } return false }
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await tick() }
const goPath = async (p) => { window.history.pushState({}, '', p); window.dispatchEvent(new window.Event('popstate')); await waitFor(() => !q('.splash') || q('.splash').classList.contains('hide')) }

await waitFor(() => q('.splash')?.classList.contains('hide') || !q('.splash'), 8000)
const gate = qa('button').find(b => /Continue with Google/i.test(b.textContent || ''))
if (gate) await click(gate)
await waitFor(() => qa('.row, .grow').length > 0 || !!q('.empty'), 6000)

/* ---------- 1. THANH LỌC ---------- */
console.log('\n===== .fbar =====')
console.log(q('.fbar')?.outerHTML.replace(/\n\s*/g, '\n'))

/* ---------- 2. TRANG QUẢN TRỊ: số liệu vs danh sách ---------- */
console.log('\n===== TRANG QUẢN TRỊ =====')
await goPath('/admin')
await waitFor(() => !!q('.adm-page'))
await tick(300)
const kpi = qa('.adm-kpi').map(b => `${txt(b.querySelector('.k'))}=${txt(b.querySelector('.v'))}${b.classList.contains('on') ? '*' : ''}`)
console.log('KPI:', kpi.join(' | '))
console.log('h2:', txt(q('.adm-h2')), '|', txt(q('.adm-h2-n')))
console.log('số dòng trong bảng:', qa('.adm-rows > *').length || qa('.adm-row').length, '| empty:', !!q('.adm-empty'))
console.log('keys:', txt(q('.adm-keys')))
for (const label of ['Pending', 'Active', 'Orders', 'Closed', 'Videos']) {
  const btn = qa('.adm-kpi').find(b => new RegExp('^' + label).test(txt(b.querySelector('.k'))))
  if (!btn) { console.log(`  ${label}: không thấy nút`); continue }
  await click(btn)
  await tick(120)
  console.log(`  ${label} -> h2: ${txt(q('.adm-h2-n'))} · dòng: ${qa('.adm-rows > *').length || qa('.adm-row').length} · empty: ${!!q('.adm-empty')} · toolbar: ${txt(q('.adm-bar'))}`)
}
console.log('\n--- HTML khối toolbar + note ---')
console.log(q('.adm-panel')?.outerHTML.replace(/\n\s*/g, '\n').slice(0, 2600))

/* ---------- 3. VÒNG QUAY ---------- */
console.log('\n===== VÒNG QUAY =====')
await goPath('/daily-spin')
await waitFor(() => !!q('.daily-spin'))
await tick(300)
console.log('nhãn trên đĩa:', JSON.stringify(qa('.spin-wheel-number').map(e => e.textContent.trim())))
console.log('số lát:', qa('.spin-sector').length)
console.log('đầu khối:', txt(q('.spin-head')))
console.log('thân:', txt(q('.spin-dial')))
console.log('bảng bên:', txt(q('.spin-panel')))

await server.close()
process.exit(0)
