/* Biên gọi RPC phải dịch mã QR ngắn về mã UUID mà SQL đã kiểm, không nới
   constraint database. Client thật được dựng với URL .invalid; mọi rpc đều bị
   thay bằng lời gọi ghi tham số, nên bài này không gửi một request nào. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { orderReference, orderTransferContent } from './requestPayment.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const server = await createServer({
  root, configFile: false, mode: 'test', logLevel: 'error',
  cacheDir: 'node_modules/.vite-order-rpc-test', envPrefix: 'CCL_ORDER_RPC_TEST_',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://orders.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-only-not-a-real-key'),
  },
  plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
})
const db = await server.ssrLoadModule('/src/lib/db.js')
after(async () => { await server.close() })
const order = { id: 'dceafd94-8ce3-40e1-b6b2-e37dede3a064', kind: 'paid_request' }

test('adminOrder gửi mã canonical cho SQL dù biên lai dùng QR ngắn hay mã dài cũ', async t => {
  assert.equal(db.hasSupabase, true, 'phải đi qua nhánh RPC, không phải localStorage demo')
  const calls = []
  t.mock.method(db.supabase, 'rpc', async (name, args) => { calls.push({ name, args }); return { error: null } })
  for (const reference of [orderTransferContent(order), orderTransferContent(order).toUpperCase(), orderReference(order), orderReference(order).replace('-', '').toLowerCase()]) {
    await db.adminOrder(order.id, true, { method: 'bank', amount: 20000, reference, reason: 'Manual receipt checked' })
    assert.equal(calls.at(-1).name, 'admin_order')
    assert.equal(calls.at(-1).args.p_reference, 'PRDCEAFD948CE340E1B6B2E37DEDE3A064')
    assert.equal(calls.at(-1).args.p_amount, 20000)
    assert.equal(calls.at(-1).args.p_method, 'bank')
  }
  await db.adminOrder(order.id, false, { reason: 'No matching receipt' })
  assert.equal(calls.at(-1).args.p_approve, false)
  assert.equal(calls.at(-1).args.p_reference, null)
  assert.equal(calls.length, 5)
})
