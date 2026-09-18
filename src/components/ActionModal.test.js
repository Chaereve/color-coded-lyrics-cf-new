/* Kiểm tra KHUNG CỦA Modal — render thật bằng Vite SSR loader, không mở trình
   duyệt. Lý do file này tồn tại: `RequestTab` nhận `live={live}` trong khi
   `ActionModal` quên khai báo `live` trong danh sách prop, nên vừa mở
   "New request" là ReferenceError — React gỡ bỏ cả cây, người dùng chỉ còn
   màn hình đen. `npm run build` không phát hiện (biến tự do chỉ chết lúc chạy),
   nên phải dựng component ra HTML mới thấy.
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server

async function render(props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-modal-test',
    /* .env của người lập trình không được biến test này thành client thật:
       đổi envPrefix nên import.meta.env.VITE_SUPABASE_URL không được nạp. */
    envPrefix: 'CCL_MODAL_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/ActionModal.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/* RequestTab che form bang RulesGate lan dau, ma gate do doc localStorage —
   trong node thi khong co, nen form (va dong chu bao tin can kiem) khong bao
   gio den duoc. Gia lap "da Agree" de render xuong tan dong chu ay. */
function alreadyAgreed(agreed = true) {
  const store = agreed ? new Map([['ccl.reqRules', 'v1']]) : new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  })
}

const base = {
  open: true, tab: 'request', setTab: () => {}, onClose: () => {},
  rows: [], myVotes: new Map(), myOrders: [], voteStatus: { total: 3, purchased: 0, bonus: 0 },
  onVote: () => {}, onSubmit: () => {}, onBuy: () => {}, onCancelOrder: () => {},
  userName: 'Demo User',
}

test('mọi tab của modal đều dựng được (không sót prop → ReferenceError)', async () => {
  for (const tab of ['request', 'vote', 'buy']) {
    const html = await render({ ...base, tab, live: false })
    assert.ok(html.includes('modal-body'), `tab ${tab} không render ra khung modal`)
  }
})

test('chạy demo (live=false): dòng chữ nói rõ tin chỉ nằm trong trình duyệt', async () => {
  alreadyAgreed()
  const tx = plain(await render({ ...base, live: false }))
  assert.match(tx, /This demo stores notifications in your browser/)
  assert.ok(!/You will be told when this is approved/.test(tx), 'lẫn cả chữ của bản thật')
})

test('nối DB thật (live=true): hứa với người gửi là có tin thật', async () => {
  alreadyAgreed()
  const tx = plain(await render({ ...base, live: true }))
  assert.match(tx, /You will be told when this is approved, how production goes/)
  assert.ok(!/This demo stores/.test(tx), 'vẫn báo "demo" dù đã nối DB')
})

test('lần đầu mở modal: form bị chặn bằng bảng luật, không phải màn đen', async () => {
  alreadyAgreed(false)   /* test o tren de lai localStorage, phai tat lai */
  const tx = plain(await render({ ...base, live: false }))
  assert.match(tx, /Before requesting/)
  assert.ok(!/Send request/.test(tx), 'le ra form phai an sau bang luat')
})
