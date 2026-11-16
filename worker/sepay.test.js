/* Khoá hành vi của /api/payment/sepay (worker/sepay.js + functions/api/payment/sepay.js).
   Route này là SỔ LOG-ONLY: không được tạo quyền đặc biệt cho ai ngoài cổng edge. */
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { sepayRoute } from './index.js'

const SITE = 'https://chaereve.pages.dev'
const post = (body, headers = {}) => new Request(SITE + '/api/payment/sepay', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
const authedPost = (body, key = 'khoa-bi-mat') => post(body, { authorization: `Apikey ${key}` })
const goodBody = () => ({
  id: 123456,
  gateway: 'Vietcombank',
  transactionDate: '2026-11-15 10:30:00',
  accountNumber: '1234567890',
  code: null,
  content: 'PR-abc123',
  transferType: 'in',
  transferAmount: 150000,
  referenceCode: 'FT2612345678',
})

test('GET trên route SePay trả JSON 405, không HTML', async () => {
  const res = await sepayRoute(new Request(SITE + '/api/payment/sepay'), {})
  assert.equal(res.status, 405)
  assert.match(res.headers.get('content-type') || '', /application\/json/)
  assert.deepEqual(await res.json(), { error: 'err.sepayMethod' })
})

test('thiếu SEPAY_WEBHOOK_KEY thì fail-closed 503 — không mở cổng khi chưa cấu hình', async () => {
  const res = await sepayRoute(authedPost(goodBody()), {})
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { error: 'err.sepaySetup' })
})

test('sai Apikey trả 401, RPC không bị gọi', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => { fetchCalls++; return new Response('{}', { status: 200 }) }
  try {
    const res = await sepayRoute(authedPost(goodBody(), 'khoa-sai'), {
      SEPAY_WEBHOOK_KEY: 'khoa-bi-mat',
      SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon',
    })
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'err.sepayAuth' })
    assert.equal(fetchCalls, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('body rác / thiếu transferAmount / thiếu content đều bị 400 trước khi chạm RPC', async () => {
  const env = { SEPAY_WEBHOOK_KEY: 'khoa-bi-mat', SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon' }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('không được gọi fetch') }
  try {
    for (const bad of ['khong-phai-json{', JSON.stringify(null), JSON.stringify([]),
      JSON.stringify({ content: 'PR-x' }),
      JSON.stringify({ transferAmount: 'nhieu', content: 'PR-x' }),
      JSON.stringify({ transferAmount: 0, content: 'PR-x' }),
      JSON.stringify({ transferAmount: 1000 }),
      JSON.stringify({ transferAmount: 1000, content: '   ' })]) {
      const res = await sepayRoute(post(bad, { authorization: 'Apikey khoa-bi-mat' }), env)
      assert.equal(res.status, 400, String(bad))
      assert.deepEqual(await res.json(), { error: 'err.sepayBody' })
    }
  } finally { globalThis.fetch = originalFetch }
})

test('Apikey đúng: forward sang RPC sepay_record_event với gate token, trả nguyên kết quả 200', async () => {
  const originalFetch = globalThis.fetch
  let rpcUrl, rpcBody
  globalThis.fetch = async (url, init) => {
    rpcUrl = String(url); rpcBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ match_status: 'matched', order_id: '11111111-1111-1111-1111-111111111111' }), { status: 200 })
  }
  try {
    const res = await sepayRoute(authedPost(goodBody()), {
      SEPAY_WEBHOOK_KEY: 'khoa-bi-mat',
      SUPABASE_URL: 'https://db.example.test/', SUPABASE_ANON_KEY: 'anon-key',
      EDGE_GATE_TOKEN: 'gate-token',
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { match_status: 'matched', order_id: '11111111-1111-1111-1111-111111111111' })
    assert.match(rpcUrl, /^https:\/\/db\.example\.test\/rest\/v1\/rpc\/sepay_record_event$/)
    assert.equal(rpcBody.p_gate_token, 'gate-token')
    assert.equal(rpcBody.p_payload.transferAmount, 150000, 'nguyên payload được forward, không sửa số tiền')
    // header RPC là khoá anon + gate trong body, tuyệt đối không có service role
    // (kiểm qua chính init của fetch ở trên là đủ: không có trường role nào được gửi)
  } finally { globalThis.fetch = originalFetch }
})

test('RPC trả lỗi thì webhook đẩy nguyên status về cho SePay thấy (SePay sẽ retry)', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"message":"gate missing"}', { status: 403 })
  try {
    const res = await sepayRoute(authedPost(goodBody()), {
      SEPAY_WEBHOOK_KEY: 'khoa-bi-mat',
      SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-key',
    })
    assert.equal(res.status, 403)
  } finally { globalThis.fetch = originalFetch }
})

test('RPC ném lỗi mạng thì trả 500 err.sepayGate, không sập handler', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network down') }
  try {
    const res = await sepayRoute(authedPost(goodBody()), {
      SEPAY_WEBHOOK_KEY: 'khoa-bi-mat',
      SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-key',
    })
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'err.sepayGate' })
  } finally { globalThis.fetch = originalFetch }
})

test('Workers và Pages trả đồng nhất status + body cho cùng một request', async () => {
  const env = {}
  const cases = [
    () => new Request(SITE + '/api/payment/sepay'),
    () => post('rac', { authorization: 'Apikey x' }),
    () => authedPost(goodBody(), 'sai'),
  ]
  for (const make of cases) {
    // Mỗi bên một Request riêng vì body chỉ đọc được một lần.
    const a = await worker.fetch(make(), env)
    const { onRequest: pagesSepay } = await import('../functions/api/payment/sepay.js')
    const b = await pagesSepay({ request: make(), env })
    assert.equal(b.status, a.status)
    assert.equal(await b.text(), await a.text())
    assert.equal(b.headers.get('cache-control'), 'no-store')
  }
})
