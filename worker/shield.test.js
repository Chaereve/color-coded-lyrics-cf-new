/* Logic lá chắn Edge chạy thuần được nên test trực tiếp bằng node:test,
   với một KV giả ghi lại cả TTL để kiểm chứng chuyện "tự reset mỗi ngày". */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SHIELD_LIMIT, SHIELD_MAX_FP_PER_IP, VOTE_MAX_CALLS_PER_FP, vnDay, ttlUntilVnMidnight,
  shieldCheck, shieldCommit, fpKey, ipKey,
  voteShieldCheck, voteShieldCommit, voteKey,
} from './shield.js'

class FakeKV {
  constructor() { this.store = new Map() }
  async get(key) { return this.store.has(key) ? this.store.get(key).value : null }
  async put(key, value, options = {}) { this.store.set(key, { value, options }) }
}

const NOW = Date.parse('2026-09-08T10:00:00Z')   // 17:00 giờ VN cùng ngày
const IP = '203.0.113.7'
const fp = n => `${n}`.padStart(64, '0')
const run = async (kv, over = {}) => shieldCheck(kv, { ip: IP, fpHash: fp(1), nowMs: NOW, ...over })

test('a fresh fingerprint on a fresh IP passes and commits one used spin', async () => {
  const kv = new FakeKV()
  assert.equal((await run(kv)).ok, true)
  await shieldCommit(kv, { ip: IP, fpHash: fp(1), nowMs: NOW })
  assert.equal(JSON.parse(kv.store.get(fpKey(fp(1))).value).used, 1)
  assert.deepEqual(JSON.parse(kv.store.get(ipKey(IP)).value).fps, [fp(1)])
  const ttl = kv.store.get(fpKey(fp(1))).options.expirationTtl
  assert.ok(ttl > 60 && ttl <= 86_400, 'TTL must expire at VN midnight')
})

test('the same fingerprint may spin exactly SHIELD_LIMIT times, then is blocked', async () => {
  const kv = new FakeKV()
  for (let i = 0; i < SHIELD_LIMIT; i++) {
    assert.equal((await run(kv)).ok, true)
    await shieldCommit(kv, { ip: IP, fpHash: fp(1), nowMs: NOW })
  }
  const blocked = await run(kv)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'err.spinEdgeFp')
  // KV hết hạn giả lập qua ngày mới: hạn mức mở lại.
  assert.equal((await run(kv, { nowMs: NOW + 86_400_000 })).ok, true)
})

test('same IP with different fingerprints is allowed (shared Wi-Fi)...', async () => {
  const kv = new FakeKV()
  for (let i = 1; i <= SHIELD_MAX_FP_PER_IP; i++) {
    const hash = fp(i)
    assert.equal((await shieldCheck(kv, { ip: IP, fpHash: hash, nowMs: NOW })).ok, true)
    await shieldCommit(kv, { ip: IP, fpHash: hash, nowMs: NOW })
  }
  assert.equal(JSON.parse(kv.store.get(ipKey(IP)).value).fps.length, SHIELD_MAX_FP_PER_IP)
})

test('...but a 6th fingerprint on one IP locks the IP for the whole day', async () => {
  const kv = new FakeKV()
  for (let i = 1; i <= SHIELD_MAX_FP_PER_IP; i++) {
    await shieldCheck(kv, { ip: IP, fpHash: fp(i), nowMs: NOW })
    await shieldCommit(kv, { ip: IP, fpHash: fp(i), nowMs: NOW })
  }
  const sixth = await shieldCheck(kv, { ip: IP, fpHash: fp(600), nowMs: NOW })
  assert.equal(sixth.ok, false)
  assert.equal(sixth.reason, 'err.spinEdgeIp')
  assert.equal(JSON.parse(kv.store.get(ipKey(IP)).value).blocked, 1)
  // Khoá IP chặn cả fingerprint cũ lẫn mới từ cùng đường mạng, tới hết ngày.
  const b1 = await shieldCheck(kv, { ip: IP, fpHash: fp(1), nowMs: NOW })
  assert.equal(b1.ok, false); assert.equal(b1.reason, 'err.spinEdgeIp')
  const b2 = await shieldCheck(kv, { ip: IP, fpHash: fp(700), nowMs: NOW })
  assert.equal(b2.ok, false); assert.equal(b2.reason, 'err.spinEdgeIp')
  // Fingerprint cũ quay từ mạng khác vẫn bình thường: khoá theo IP, không vạ lây.
  assert.equal((await shieldCheck(kv, { ip: '198.51.100.9', fpHash: fp(1), nowMs: NOW })).ok, true)
  // Ngày mới (TTL rơi) mở khoá lại.
  assert.equal((await shieldCheck(kv, { ip: IP, fpHash: fp(600), nowMs: NOW + 86_400_000 })).ok, true)
})

test('stale values from another day are ignored even if TTL has not dropped', async () => {
  const kv = new FakeKV()
  await kv.put(fpKey(fp(1)), JSON.stringify({ d: '2026-09-07', used: 9 }))
  await kv.put(ipKey(IP), JSON.stringify({ d: '2026-09-07', fps: [fp(9)], blocked: 1 }))
  assert.equal((await run(kv)).ok, true)
})

test('VN day + TTL boundaries: midnight reset, never a sub-minute TTL', () => {
  assert.equal(vnDay(Date.parse('2026-09-08T16:59:59.999Z')), '2026-09-08')
  assert.equal(vnDay(Date.parse('2026-09-08T17:00:00Z')), '2026-09-09')
  assert.equal(ttlUntilVnMidnight(Date.parse('2026-09-08T17:00:00Z')), 86_400)
  assert.equal(ttlUntilVnMidnight(Date.parse('2026-09-08T16:59:59.999Z')), 60, 'floored, KV rejects tiny TTLs')
  assert.equal(ttlUntilVnMidnight(Date.parse('2026-09-08T00:00:00Z')), 86_400 - 7 * 3600)
})


/* ---- lá chắn cho VOTE (2026-11-03) ------------------------------------- */

test('vote: đếm riêng khoá vc:, không ăn vào hạn mức của vòng quay', async () => {
  const kv = new FakeKV()
  await voteShieldCommit(kv, { fpHash: fp(1), nowMs: NOW })
  assert.equal(JSON.parse(kv.store.get(voteKey(fp(1))).value).used, 1)
  assert.equal(kv.store.get(fpKey(fp(1))), undefined, 'không được đụng vào bộ đếm spin')
  // hai lượt quay vẫn còn nguyên sau khi đã vote
  assert.equal((await shieldCheck(kv, { ip: IP, fpHash: fp(1), nowMs: NOW })).ok, true)
})

test('vote: chặn khi một vân tay gọi quá trần trong ngày, mở lại hôm sau', async () => {
  const kv = new FakeKV()
  const call = (over = {}) => voteShieldCheck(kv, { fpHash: fp(2), nowMs: NOW, limit: 3, ...over })
  for (let i = 0; i < 3; i++) {
    assert.equal((await call()).ok, true)
    await voteShieldCommit(kv, { fpHash: fp(2), nowMs: NOW })
  }
  const blocked = await call()
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'err.voteEdgeFp')
  assert.equal((await call({ nowMs: NOW + 86_400_000 })).ok, true)
})

test('vote: không có vân tay thì vẫn cho đi tiếp — Postgres mới là chốt chặn', async () => {
  const kv = new FakeKV()
  assert.equal((await voteShieldCheck(kv, { fpHash: null, nowMs: NOW })).ok, true)
  await voteShieldCommit(kv, { fpHash: null, nowMs: NOW })
  assert.equal(kv.store.size, 0, 'không ghi rác vào KV')
})

test('vote: trần mặc định đủ rộng cho người thật, đủ chặt với farm tool', () => {
  assert.ok(VOTE_MAX_CALLS_PER_FP >= 60 && VOTE_MAX_CALLS_PER_FP <= 500)
})

test('vote: TTL của khoá vote cũng rơi vào nửa đêm giờ VN', async () => {
  const kv = new FakeKV()
  await voteShieldCommit(kv, { fpHash: fp(3), nowMs: NOW })
  assert.equal(kv.store.get(voteKey(fp(3))).options.expirationTtl, ttlUntilVnMidnight(NOW))
})
