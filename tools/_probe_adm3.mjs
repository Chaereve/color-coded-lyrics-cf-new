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
const errs = []
window.addEventListener('error', e => errs.push('ERR ' + e.message))
const origErr = window.console.error
window.console.error = (...a) => { errs.push('CONSOLE ' + a.map(String).join(' ').slice(0, 200)) }

await click(qa('.adm-kpi')[1])
await tick(400)
const row = q('.adm')
console.log('--- .adm row ---')
console.log(row?.outerHTML?.replace(/\s+/g, ' ').slice(0, 1800))
console.log('\n--- .adm-bar ---')
console.log(q('.adm-bar')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 900))
console.log('\n--- .adm-note ---')
console.log(q('.adm-note')?.outerHTML?.replace(/\s+/g, ' ').slice(0, 500))
console.log('\n--- counts ---')
console.log('rows:', qa('.adm').length, '| pills:', qa('.pill').length, '| tags:', qa('.tags').length, '| bars:', qa('.prog, .bar, [role=progressbar]').length)
console.log('text đầu panel:', (q('.adm-panel')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300))
await server.close(); process.exit(0)
