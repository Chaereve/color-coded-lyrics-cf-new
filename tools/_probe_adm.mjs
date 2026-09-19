/* Đầu dò: trang quản trị được gắn vào đâu trong cây DOM?
   Chạy: node tools/_probe_adm.mjs */
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
const root = '/home/user/color-coded-lyrics-cf-new/'
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://localhost/', pretendToBeVisual: true })
const { window } = dom
window.IntersectionObserver = class { constructor(cb) { this.cb = cb } observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.scrollTo = () => {}
for (const k of ['window','document','navigator','location','history','localStorage','sessionStorage','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IntersectionObserver','ResizeObserver','HTMLElement','Element','Node','Event','CustomEvent','MouseEvent','KeyboardEvent','Blob','URL','URLSearchParams','DOMParser','Image','MutationObserver']) {
  if (window[k] === undefined) continue
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }) } catch {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const server = await createServer({ root, configFile: false, mode: 'test', logLevel: 'error', cacheDir: 'node_modules/.vite-smoke', envPrefix: 'CCL_SMOKE_', plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null } })
const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const App = (await server.ssrLoadModule('/src/App.jsx')).default
const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
const { NotifyProvider } = await server.ssrLoadModule('/src/lib/notify.jsx')
await act(async () => { createRoot(window.document.getElementById('root')).render(createElement(I18nProvider, null, createElement(NotifyProvider, null, createElement(App)))) })
const q = (s) => window.document.querySelector(s)
const qa = (s) => [...window.document.querySelectorAll(s)]
const tick = async (ms = 60) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(120) } return false }
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await tick() }
await waitFor(() => q('.splash')?.classList.contains('hide') || !q('.splash'), 8000)
const gate = qa('button').find(b => /Continue with Google/i.test(b.textContent || ''))
if (gate) await click(gate)
await waitFor(() => qa('.row').length > 0 || !!q('.empty'), 6000)
window.history.pushState({}, '', '/admin'); window.dispatchEvent(new window.Event('popstate'))
await waitFor(() => !!q('.adm-page'))
await tick(400)
const page = q('.adm-page')
const chain = []
for (let el = page; el && el.tagName !== 'BODY'; el = el.parentElement) chain.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''))
console.log('CHUỖI CHA CỦA .adm-page:', chain.join('  <  '))
console.log('trong .main?', !!q('.main .adm-page'), '| trong .sect?', !!q('.sect .adm-page'), '| trong .shell?', !!q('.shell .adm-page'))
console.log('h1 trang:', q('.mainhead-t')?.textContent, '| có header trang?', !!q('.mainhead'))
console.log('số .adm-kpi:', qa('.adm-kpi').length, '| phần tử ngay sau .adm-kpi:', qa('.adm-kpi')[0]?.parentElement?.className)
await server.close(); process.exit(0)
