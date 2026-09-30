/* funnel.js — cổng ghi số liệu đường đi. Chạy: npm test
   ---------------------------------------------------------
   Hai lớp chốt:
   · lớp thuần: chọn đúng sự kiện, kẹp meta gọn, thăm session cho visit —
     và demo mode (không Supabase) thì KHÔNG được ghi gì;
   · lớp bất biến: đo lường KHÔNG BAO GIỜ ném lỗi làm hỏng thao tác chính —
     kể cả khi rpc nổ tại chỗ. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { FUNNEL_EVENTS, trackFunnel, trackVisitOnce, _useFunnelClient } from './funnel.js'

/* Supabase thật bị thay bằng bản ghi — namespace ESM read-only nên phải
   đi qua seam _useFunnelClient. */
const calls = []
let boom = false
const fake = {
  rpc: (name, args) => {
    if (boom) throw new Error('rpc exploded at call time')
    calls.push({ name, args })
    return { then: (ok, fail) => Promise.resolve().then(ok, fail) }
  },
}
test.beforeEach(() => {
  calls.length = 0; boom = false
  _useFunnelClient(fake)
  /* Node trần không có sessionStorage (trình duyệt có) — polyfill đúng hành
     vi lưu/khoá theo phiên để logic throttle thực sự được kiểm. */
  if (typeof globalThis.sessionStorage === 'undefined') {
    const m = new Map()
    globalThis.sessionStorage = {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      clear: () => m.clear(),
    }
  }
  try { sessionStorage.clear() } catch { /* jsdom thiếu storage: không sao */ }
})
test.after(() => _useFunnelClient(null))

test('đúng cửa: mọi sự kiện đi qua MỘT rpc track_funnel, đúng tên, đúng meta', () => {
  assert.deepEqual(FUNNEL_EVENTS, ['visit', 'request', 'vote', 'buy', 'spin'])
  trackFunnel('vote', { n: 3, junk: { deep: 1 }, long: 'x'.repeat(80) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'track_funnel')
  assert.equal(calls[0].args.p_event, 'vote')
  /* meta kẹp: số giữ nguyên, object bị bỏ, chuỗi cắt 40 */
  assert.deepEqual(calls[0].args.p_meta, { n: 3, long: 'x'.repeat(40) })
  /* sự kiện lạ / rỗng: từ chối thẳng, không tốn một request nào */
  trackFunnel('hack'); trackFunnel(''); trackFunnel(null)
  assert.equal(calls.length, 1)
})

test('demo mode: không có client thì không ghi gì, kể cả visit', () => {
  _useFunnelClient(null)
  assert.equal(trackFunnel('vote'), false)
  assert.equal(trackVisitOnce(), false)
  assert.equal(calls.length, 0)
})

test('visit: tối đa MỘT lần mỗi phiên (sessionStorage)', () => {
  assert.equal(trackVisitOnce(), true)
  assert.equal(trackVisitOnce(), false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.p_event, 'visit')
})

test('bất biến "không làm hỏng việc chính": rpc nổ tại chỗ cũng không ai thấy', () => {
  boom = true
  assert.doesNotThrow(() => trackFunnel('request'))
  assert.equal(calls.length, 0) /* nổ trước khi ghi nhận — nhưng không throw ra ngoài */
  boom = false
  trackFunnel('request', { kind: 'kpop' })
  assert.equal(calls[0].args.p_meta.kind, 'kpop')
})
