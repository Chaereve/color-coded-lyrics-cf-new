import test from 'node:test'
import assert from 'node:assert/strict'
import { handleSpin } from './index.js'

const DEVICE = 'a'.repeat(64)
const REQUEST = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

function kvMock() {
  const reads = []
  const writes = []
  return {
    reads, writes,
    async get(key) { reads.push(key); return null },
    async put(key, value, options) { writes.push({ key, value, options }) },
  }
}

function request(fpHash) {
  return new Request('https://example.test/api/daily-spin/spin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
    body: JSON.stringify({
      device_token: DEVICE, request_id: REQUEST, expected_user_id: USER,
      fp_hash: fpHash, turnstile_token: 'test-turnstile-token', user_token: 'user-jwt',
    }),
  })
}

test('Spin vẫn đi qua shield khi fingerprint bị chặn; SQL nhận NULL và quota actor theo account', async () => {
  const kv = kvMock()
  const originalFetch = globalThis.fetch
  let rpcBody
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/rest\/v1\/rpc\/spin_daily$/)
    rpcBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ replayed: false, spin: { request_id: REQUEST } }), { status: 200 })
  }
  try {
    const res = await handleSpin(request(null), {
      SPIN_SHIELD: kv, SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon',
    })
    assert.equal(res.status, 200)
    assert.equal(rpcBody.p_fp_hash, null, 'không giả vờ hash tài khoản là fingerprint')
    assert.match(rpcBody.p_ip_hash, /^[a-f0-9]{64}$/)
    assert.equal(kv.reads.length, 2, 'vẫn kiểm tra quota fingerprint/actor + IP')
    assert.match(kv.reads[0], /^fp:[a-f0-9]{64}$/)
    assert.ok(!kv.reads[0].includes(USER), 'khóa KV không lưu user id dạng thô')
    assert.equal(kv.writes.length, 2, 'vẫn ghi đúng hai counter hiện có — không tăng số lần KV write')
  } finally { globalThis.fetch = originalFetch }
})

test('D1 shield hỏng thì chặn trước RPC, không rơi sang KV hoặc bỏ kiểm tra', async () => {
  const originalFetch = globalThis.fetch
  let rpcCalls = 0
  globalThis.fetch = async () => {
    rpcCalls++
    return new Response(JSON.stringify({ replayed: false }), { status: 200 })
  }
  try {
    const brokenD1 = { prepare() { throw new Error('D1 unavailable') } }
    const res = await handleSpin(request('b'.repeat(64)), {
      RATE_SHIELD: brokenD1, SPIN_SHIELD: kvMock(),
      SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon',
    })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'err.shieldUnavailable' })
    assert.equal(rpcCalls, 0, 'D1 failure must not call RPC directly or downgrade to KV')
  } finally { globalThis.fetch = originalFetch }
})

test('Turnstile upstream từ chối/không khả dụng thì fail-closed trước KV và RPC', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async url => {
    calls += 1
    assert.match(String(url), /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/)
    return new Response('{}', { status: 503 })
  }
  try {
    const kv = kvMock()
    const res = await handleSpin(request('b'.repeat(64)), {
      TURNSTILE_SECRET_KEY: 'secret', SPIN_SHIELD: kv,
      SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon',
    })
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'err.spinCaptcha' })
    assert.equal(calls, 1)
    assert.equal(kv.reads.length, 0, 'không tốn KV khi xác minh bảo mật thất bại')
  } finally { globalThis.fetch = originalFetch }
})

test('khi fingerprint có sẵn, Worker giữ nguyên hash thật cho RPC và shield', async () => {
  const kv = kvMock()
  const originalFetch = globalThis.fetch
  const fingerprint = 'b'.repeat(64)
  let rpcBody
  globalThis.fetch = async (_url, init) => {
    rpcBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ replayed: true }), { status: 200 })
  }
  try {
    const res = await handleSpin(request(fingerprint), {
      SPIN_SHIELD: kv, SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon',
    })
    assert.equal(res.status, 200)
    assert.equal(rpcBody.p_fp_hash, fingerprint)
    assert.equal(kv.reads[0], `fp:${fingerprint}`)
    assert.equal(kv.writes.length, 0, 'replay không tiêu thêm quota')
  } finally { globalThis.fetch = originalFetch }
})

test('Turnstile siteverify có timeout ngắn và fail-closed', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('./index.js', import.meta.url), 'utf8'))
  assert.match(source, /TURNSTILE_VERIFY_TIMEOUT_MS\s*=\s*4000/)
  assert.match(source, /signal:\s*controller\.signal/)
  assert.match(source, /if \(!res\.ok\) return false/)
})
