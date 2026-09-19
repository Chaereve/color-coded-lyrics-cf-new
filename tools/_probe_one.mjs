import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
const root = '/home/user/color-coded-lyrics-cf-new/'
const server = await createServer({ root, configFile: false, mode: 'test', logLevel: 'error', cacheDir: 'node_modules/.vite-modal-test', envPrefix: 'CCL_MODAL_TEST_', plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null } })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'v1', setItem: () => {}, removeItem: () => {} } })
const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
const mod = await server.ssrLoadModule('/src/components/ActionModal.jsx')
const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, {
  open: true, tab: 'request', setTab: () => {}, onClose: () => {}, rows: [], myVotes: new Map(), myOrders: [],
  voteStatus: { total: 3, purchased: 0, bonus: 0 }, onVote: () => {}, onSubmit: () => {}, onBuy: () => {},
  onCancelOrder: () => {}, userName: 'Demo User', live: false, prefill: { artist: 'aespa' },
})))
console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
await server.close(); process.exit(0)
