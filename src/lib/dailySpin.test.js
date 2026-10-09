import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DAILY_SPIN_LIMIT, SPIN_REWARDS, SPIN_WEIGHTS, spinDay, nextSpinReset, rewardOdds, spinTier,
  spinSectorIndex, spinAverage, formatChance, spinCountdown,
  SPIN_GRID_CELLS, SPIN_GRID_RENDER_ORDER, spinCellForReward,
  demoSpinStatus, drawDemoSpin, validateSpinResult, drawSegment, streakBlocked,
} from './dailySpin.js'

const now = Date.parse('2026-09-07T12:00:00Z')
const input = { entries: [], deviceToken: 'device-a', userId: 'account-a', now }
const draw = (entries, overrides = {}) => drawDemoSpin({
  ...input, entries, requestId: crypto.randomUUID(), random: () => 0, ...overrides,
})

/* RNG deterministic cho test phân phối: mulberry32 — cùng seed luôn ra cùng
   chuỗi, nên biên của mỗi assertion là một con số kiểm được, không phải "hi vo". */
const mulberry32 = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}

test('7 weighted sectors: 30/25/20/12/8/4/1%, average 3.24 votes per spin', () => {
  assert.equal(SPIN_REWARDS.length, 7)
  assert.equal(SPIN_WEIGHTS.length, SPIN_REWARDS.length)
  // Weights are the approved odds in percent and must form a complete wheel.
  assert.deepEqual([...SPIN_WEIGHTS], [30, 25, 20, 12, 8, 4, 1])
  assert.equal(SPIN_WEIGHTS.reduce((a, b) => a + b, 0), 100)
  assert.ok(SPIN_WEIGHTS.every(w => w > 0))
  // The draw walks cumulative bands, so the displayed arc (weight × 3.6°) IS
  // the real chance — the client never needs rejection sampling, the server
  // does that with two bytes (see 20261201_spin_v2.sql).
  assert.deepEqual(rewardOdds().map(p => [p.reward, p.weight, p.chance]),
    [[1, 30, 30], [2, 25, 25], [3, 20, 20], [5, 12, 12], [8, 8, 8], [10, 4, 4], [20, 1, 1]])
  assert.deepEqual(rewardOdds().map(p => formatChance(p.chance)), ['30', '25', '20', '12', '8', '4', '1'])
  assert.equal(spinAverage(), 3.24)
  assert.equal(spinAverage() * DAILY_SPIN_LIMIT, 6.48)
  // No blank sector; ascending, unique values; the single jackpot on top.
  assert.ok(SPIN_REWARDS.every(r => r >= 1))
  for (let i = 1; i < SPIN_REWARDS.length; i++) assert.ok(SPIN_REWARDS[i] > SPIN_REWARDS[i - 1])
  assert.equal(SPIN_REWARDS[SPIN_REWARDS.length - 1], 20)
  // A legacy 16-sector payload still renders honestly: equal arcs, equal odds.
  const legacy = [1, 2, 1, 3, 1, 1, 2, 1, 5, 1, 2, 1, 3, 1, 2, 1]
  assert.deepEqual(rewardOdds(legacy).map(p => p.chance), Array(16).fill(6.25))
})

test('prize tiers rank with the reward, so the grid can tone each cell', () => {
  assert.equal(spinTier(20), 't7')
  // A retuned prize list must still map lowest -> highest onto t1 -> t7.
  assert.deepEqual([...new Set([2, 7, 7, 20].map(r => spinTier(r, [2, 7, 20])))], ['t1', 't2', 't3'])
  assert.equal(spinTier(99, [1, 2]), 't1') // unknown value never crashes the render
})

test('SQL reward table, weight table and the shared lib stay in sync', () => {
  const read = f => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
  const base = read('20260907_daily_spin.sql')
  const prizes = read('20260908_daily_spin_prizes.sql')
  const edge = read('20260909_daily_spin_edge.sql')
  const v2 = read('20261201_spin_v2.sql')
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  // The newest tables win: `create or replace` runs in migration order, and v2
  // is the last word on both the prizes and the weights.
  const arrays = [...v2.matchAll(/select array\[([\d,\s]+)\]/g)].map(m => m[1].split(',').map(Number))
  assert.deepEqual(arrays, [[...SPIN_REWARDS], [...SPIN_WEIGHTS]])
  // The wheel refuses mismatched tables instead of paying by the wrong odds.
  assert.match(v2, /coalesce\(array_length\(v_weights, 1\), 0\) <> v_sectors/)
  assert.match(v2, /65536 % v_total/, 'rút qua lấy mẫu loại bỏ hai byte — 256 % 7 <> 0')
  assert.match(v2, /reward in \(1, 2, 3, 5, 8, 10, 20\)/, 'CHECK reward của ledger phải nới theo bảng thưởng')
  assert.match(v2, /Run AFTER 20261111_shared_ip_spin\.sql/)
  // A fresh install ends up with the migrated project's behaviour, not with the
  // exact bytes of every file: the 2026-10-31 bonus split later changed ONE line
  // inside these three blocks (wheel rewards go to bonus_credits now), and
  // schema.sql carries the corrected line. Compare the executable text with
  // comments stripped and that one known edit applied to both sides.
  const body = sql => sql
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .replaceAll('vote_credits = vote_credits + v_spin.reward',
      'bonus_credits = bonus_credits + v_spin.reward')
  const inSchema = body(schema)
  assert.ok(inSchema.includes(body(base)), 'fresh schema must include the base migration')
  assert.ok(inSchema.includes(body(prizes)), 'fresh schema must include the prize migration')
  assert.ok(inSchema.includes(body(edge)), 'fresh schema must include the edge migration')
  assert.ok(inSchema.indexOf(body(base)) < inSchema.indexOf(body(prizes)), 'prize migration must run after the base one')
  assert.ok(inSchema.indexOf(body(prizes)) < inSchema.indexOf(body(edge)), 'edge migration must run after the prize one')
  assert.match(edge, /p_fp_hash text default null, p_ip_hash text default null/)
  // The 16-sector array stays the schema.sql DEFAULT on purpose (it predates
  // the committed baseline); v2 runs after the baseline, so its objects — and
  // only they — must stay OUT of the fresh bundle (tools/migrate.mjs --check).
  assert.match(prizes, /segment between 0 and 15/)
  assert.ok(!schema.includes('daily_spin_weights'), 'baseline bundle must not contain post-baseline objects')
  assert.ok(!schema.includes('65536 % v_total'))
})

test('fp quota migration is appended verbatim to the fresh schema', () => {
  const fpQuota = readFileSync(new URL('../../supabase/migrations/20261102_spin_fp_quota.sql', import.meta.url), 'utf8')
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  assert.ok(schema.includes(fpQuota), 'fresh schema must include the exact fp quota migration')
  assert.match(fpQuota, /fp_slot smallint/)
  assert.match(fpQuota, /daily_spins_fp_quota_idx/)
  assert.match(fpQuota, /err\.spinEdgeFp/)
  assert.match(fpQuota, /err\.spinEdgeIp/)
  assert.match(fpQuota, /pg_advisory_xact_lock/)
})

test('reset is exactly midnight Vietnam, including month/year boundaries', () => {
  for (const [before, day, afterDay] of [
    ['2026-09-07T16:59:59.999Z', '2026-09-07', '2026-09-08'],
    ['2026-09-30T16:59:59.999Z', '2026-09-30', '2026-10-01'],
    ['2026-12-31T16:59:59.999Z', '2026-12-31', '2027-01-01'],
  ]) {
    const at = Date.parse(before)
    assert.equal(spinDay(at), day)
    assert.equal(nextSpinReset(at), new Date(at + 1).toISOString())
    assert.equal(spinDay(at + 1), afterDay)
    assert.equal(Date.parse(nextSpinReset(at + 1)) - at - 1, 86_400_000)
  }
})

/* LƯỚI 3×3 (spec 2026-10-09): kết quả server (segment → mức giải) phải dừng
   đúng MỘT ô trên lưới; ô accent KHÔNG bao giờ là ô dừng. Kiểm bằng CHÍNH
   bảng ô của lib, không bằng công thức hình học tự chế. */
test('ô server rút được chính là ô trên lưới — accent không thể trúng', () => {
  for (let segment = 0; segment < SPIN_REWARDS.length; segment++) {
    const reward = SPIN_REWARDS[spinSectorIndex(segment)]
    const cell = SPIN_GRID_CELLS[spinCellForReward(reward)]
    assert.equal(cell.reward, reward, `segment ${segment} → ô +${reward}`)
    assert.notEqual(cell.type, 'accent', 'ô dừng không bao giờ là accent')
  }
  for (const bad of [-1, SPIN_REWARDS.length, 1.5, null, undefined]) {
    assert.throws(() => spinSectorIndex(bad), 'chỉ số ngoài bảng phải bị chặn')
  }
  /* Bảng thưởng do máy chủ trả về cũng kiểm được: độ dài khác bảng mặc định
     thì vẫn quy đổi được — ánh xạ không phụ thuộc độ dài bảng. */
  const custom = [2, 2, 2, 2]
  assert.equal(spinSectorIndex(3, custom), 3)
  /* Mức lạ (không thuộc bảng) phải ném lỗi — không được lặng lẽ dừng accent. */
  assert.throws(() => spinCellForReward(99))
})

test('bản đồ lưới: 7 giải + 1 accent, mỗi mức một ô, thứ tự render đúng vị trí', () => {
  assert.equal(SPIN_GRID_CELLS.length, 8)
  const accents = SPIN_GRID_CELLS.filter(c => c.reward === null)
  assert.equal(accents.length, 1, 'đúng MỘT ô accent')
  assert.equal(accents[0].type, 'accent')
  const rewards = SPIN_GRID_CELLS.map(c => c.reward).filter(r => r !== null).sort((a, b) => a - b)
  assert.deepEqual(rewards, [...SPIN_REWARDS], '7 ô giải = đúng 7 mức server, không nhân đôi')
  for (const reward of SPIN_REWARDS) {
    assert.equal(SPIN_GRID_CELLS.filter(c => c.reward === reward).length, 1,
      `mức ${reward} phải có đúng một ô`)
  }
  /* VỊ TRÍ HÌNH HỌC theo index spec (row-major, nút giữa ở slot 4):
     0 TL · 1 TM · 2 TR · 3 MR · 4 BR(accent) · 5 BM · 6 BL · 7 ML. */
  const pos = {}
  SPIN_GRID_RENDER_ORDER.forEach((cellIndex, slot) => { pos[cellIndex] = [Math.floor(slot / 3), slot % 3] })
  assert.deepEqual(pos[0], [0, 0]); assert.deepEqual(pos[1], [0, 1]); assert.deepEqual(pos[2], [0, 2])
  assert.deepEqual(pos[3], [1, 2]); assert.deepEqual(pos[4], [2, 2]); assert.deepEqual(pos[5], [2, 1])
  assert.deepEqual(pos[6], [2, 0]); assert.deepEqual(pos[7], [1, 0])
  assert.equal(SPIN_GRID_RENDER_ORDER.length, 9, '9 slot — sentinel null là nút QUAY ở giữa')
  assert.equal(SPIN_GRID_RENDER_ORDER[4], null, 'slot giữa (1,1) là nút, không phải ô giải')
})

/* PHÂN PHỐI THẬT theo trọng số: rút mô phỏng phải gần bảng đã duyệt. */
test('rút theo trọng số 30/25/20/12/8/4/1: 7000 lượt mô phỏng khớp bảng ±2%', () => {
  const random = mulberry32(20261009)
  const counts = new Map(SPIN_REWARDS.map(r => [r, 0]))
  for (let i = 0; i < 7000; i++) {
    const reward = SPIN_REWARDS[drawSegment({ random })]
    counts.set(reward, counts.get(reward) + 1)
  }
  for (let i = 0; i < SPIN_REWARDS.length; i++) {
    const share = counts.get(SPIN_REWARDS[i]) / 7000
    assert.ok(Math.abs(share - SPIN_WEIGHTS[i] / 100) < 0.02,
      `+${SPIN_REWARDS[i]} phải ra ~${SPIN_WEIGHTS[i]}%: ${(share * 100).toFixed(2)}%`)
  }
})

test('countdown never displays negative time', () => {
  assert.equal(spinCountdown(86_400_000), '24:00:00')
  assert.equal(spinCountdown(3_661_000), '01:01:01')
  assert.equal(spinCountdown(1), '00:00:01')
  assert.equal(spinCountdown(-1000), '00:00:00')
})

test('first spin binds this browser to one account until the VN day resets', () => {
  const entries = [draw([]).entry]
  assert.throws(() => draw(entries, { userId: 'account-b' }), /err.spinDeviceAccount/)
  const other = demoSpinStatus({ ...input, entries, userId: 'account-b', credits: 0 })
  assert.equal(other.device_account_blocked, true)
  assert.equal(other.remaining, 0)
  assert.equal(other.history.length, 0)
  entries.push(draw(entries).entry)
  assert.throws(() => draw(entries), /err.spinDeviceLimit/)
  assert.equal(demoSpinStatus({ ...input, entries, userId: 'account-b', now: now + 86_400_000 }).remaining, 2)
})

test('the same account gets no extra spins on another device', () => {
  const entries = [draw([]).entry]
  entries.push(draw(entries, { deviceToken: 'device-b' }).entry)
  assert.throws(() => draw(entries, { deviceToken: 'device-c' }), /err.spinAccountLimit/)
})

test('retries replay one award even when exhausted or after midnight', () => {
  const first = draw([])
  const entries = [first.entry, draw([first.entry]).entry]
  for (const at of [now, now + 86_400_000]) {
    const retried = draw(entries, { requestId: first.entry.request_id, now: at })
    assert.equal(retried.replayed, true)
    assert.deepEqual(retried.entry, first.entry)
  }
  assert.throws(() => draw(entries, { deviceToken: 'device-b', requestId: first.entry.request_id }), /err.spinRequest/)
})

test('new day resets availability, not credits; unused spins do not roll over', () => {
  const entries = [draw([]).entry]
  entries.push(draw(entries).entry)
  const status = demoSpinStatus({ ...input, entries, credits: 17, now: now + 86_400_000 })
  assert.equal(status.remaining, 2)
  assert.equal(status.credits, 17)
  assert.equal(status.history.length, 0)
  assert.equal(demoSpinStatus({ ...input, entries: [], credits: 0, now: now + 86_400_000 * 7 }).remaining, 2)
})

test('unauthenticated demo spins are rejected too', () => {
  assert.throws(() => draw([], { userId: null }), /err.signin/)
})

test('unconfirmed / mismatched server results cannot be presented as a win', () => {
  const response = {
    spin: { request_id: 'request', segment: 3, reward: 5 },
    status: { user_id: 'account', rewards: [...SPIN_REWARDS], weights: [...SPIN_WEIGHTS], remaining: 1, credits: 10 },
  }
  assert.equal(validateSpinResult(response, 'account', 'request'), response)
  assert.throws(() => validateSpinResult(response, 'another-account', 'request'), /err.spinResponse/)
  assert.throws(() => validateSpinResult(response, 'account', 'another-request'), /err.spinResponse/)
  for (const bad of [null, {}, { ...response, spin: { ...response.spin, reward: 1000 } },
    { ...response, spin: { ...response.spin, segment: SPIN_REWARDS.length } },
    { ...response, status: { ...response.status, remaining: 3 } },
    // bảng trọng số gửi kèm phải khớp độ dài và là số nguyên không âm
    { ...response, status: { ...response.status, weights: [30, 25, 20] } },
    { ...response, status: { ...response.status, weights: [...SPIN_WEIGHTS.slice(0, -1), -1] } },
    // moc gio gui len ma doc khong ra ngay thi dung lay: NaN se in len o dem nguoc
    { ...response, status: { ...response.status, server_now: 'không phải ngày' } },
    { ...response, status: { ...response.status, reset_at: '' } }]) {
    assert.throws(() => validateSpinResult(bad, 'account', 'request'), /err.spinResponse/)
  }
  // ...nhung backend cu KHONG gui weights / moc gio van phai duoc chap nhan
  const legacy = { ...response, status: { ...response.status, weights: undefined } }
  delete legacy.status.weights
  assert.equal(validateSpinResult(legacy, 'account', 'request'), legacy)
})

test('đồng hồ đếm ngược không bao giờ in NaN', () => {
  assert.equal(spinCountdown(NaN), '00:00:00')
  assert.equal(spinCountdown(undefined), '00:00:00')
  assert.equal(spinCountdown(-5000), '00:00:00')
  assert.equal(spinCountdown(3_600_000 + 61_000), '01:01:01')
})

test('không lặp cùng một giải quá hai lần liên tiếp', () => {
  assert.equal(streakBlocked([]), null)
  assert.equal(streakBlocked([1]), null)
  assert.equal(streakBlocked([1, 2]), null, 'hai lượt KHÁC nhau thì lượt sau tự do')
  assert.equal(streakBlocked([3, 3]), 3)

  // đang chặn +1 (dải to nhất, 30%) thì không lần rút nào được rơi vào ô đó
  const random = mulberry32(19)
  for (let i = 0; i < 500; i++) assert.notEqual(SPIN_REWARDS[drawSegment({ recent: [1, 1], random })], 1)
  // chặn ở ô hiếm nhất (+20, 1%) cũng phải tránh — kể cả khi fallback hiếm gặp
  for (let i = 0; i < 500; i++) assert.notEqual(SPIN_REWARDS[drawSegment({ recent: [20, 20], random })], 20)
  // chưa đủ hai lượt trùng thì rút như cũ: CẢ BẢY ô đều có thể ra
  const seen = new Set()
  for (let i = 0; i < 400; i++) seen.add(drawSegment({ recent: [2, 1], random }))
  assert.equal(seen.size, SPIN_REWARDS.length, 'không được hẹp tập ô khi luật không bật')
  // bảng thưởng một ô (mọi ô đều là số bị chặn) vẫn phải trả về một ô hợp lệ
  assert.equal(drawSegment({ rewards: [7], recent: [7, 7] }), 0)
  // trọng số khi bị chặn: phân phối còn lại đúng theo trọng số có điều kiện
  const blockedOnes = new Map(SPIN_REWARDS.slice(1).map(r => [r, 0]))
  for (let i = 0; i < 7000; i++) {
    const reward = SPIN_REWARDS[drawSegment({ recent: [1, 1], random })]
    blockedOnes.set(reward, blockedOnes.get(reward) + 1)
  }
  // +2 chiếm 25/70 của phần còn lại (≈ 35,7%) — biên ±5 điểm phần trăm
  assert.ok(Math.abs(blockedOnes.get(2) / 7000 - 25 / 70) < 0.05,
    `+2 phải chiếm ~35,7%: ${blockedOnes.get(2) / 7000}`)
})

test('bản demo theo đúng luật đó', () => {
  const base = { user_id: 'account-a', device_token: 'device-a', created_at: '2026-09-07T09:00:00Z' }
  const twoOnes = [{ ...base, reward: 1 }, { ...base, reward: 1, created_at: '2026-09-07T10:00:00Z' }]
  // random() => 0 luôn trỏ vào ô đầu tiên (mang số 1) — luật phải đẩy sang ô khác
  assert.notEqual(draw(twoOnes, { random: () => 0 }).entry.reward, 1)
  // hai lượt trước khác nhau thì ô đầu tiên vẫn hợp lệ
  const mixed = [{ ...base, reward: 2 }, { ...base, reward: 1, created_at: '2026-09-07T10:00:00Z' }]
  assert.equal(draw(mixed, { random: () => 0 }).entry.reward, 1)
  // lượt của THIẾT BỊ KHÁC không được tính vào chuỗi của mình
  const otherDevice = [{ ...base, device_token: 'device-b', reward: 1 },
    { ...base, device_token: 'device-b', reward: 1, created_at: '2026-09-07T10:00:00Z' }]
  assert.equal(draw(otherDevice, { random: () => 0 }).entry.reward, 1)
  // demo status trả bảng thưởng + trọng số cho bản vẽ (payload v2)
  assert.deepEqual(demoSpinStatus({ ...input, entries: [], credits: 0 }).weights, [...SPIN_WEIGHTS])
})

test('SQL thật giữ đúng luật, và schema.sql khớp với migration', () => {
  for (const rel of ['../../supabase/schema.sql', '../../supabase/migrations/20261104_spin_streak.sql']) {
    const sql = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.match(sql, /v_recent\[1\] = v_recent\[2\]/, `${rel}: thiếu so sánh hai lượt gần nhất`)
    assert.match(sql, /where device_hash = v_hash/, `${rel}: chuỗi tính theo thiết bị`)
    assert.match(sql, /256 % array_length\(v_allowed, 1\)/,
      `${rel}: tập ô hẹp lại không chia hết 256 nên phải lấy mẫu loại bỏ`)
    assert.match(sql, /v_prizes\[i\] <> v_block/, `${rel}: phải loại đúng số thưởng đang bị chặn`)
  }
  // Bản v2 giữ nguyên luật bằng HÌNH THỨC MỚI: chặn = bỏ một dải khỏi phép rút
  // trọng số; fallback vẫn lấy mẫu loại bỏ với 256 % n.
  const v2 = readFileSync(new URL('../../supabase/migrations/20261201_spin_v2.sql', import.meta.url), 'utf8')
  assert.match(v2, /v_recent\[1\] = v_recent\[2\]/, 'v2: thiếu so sánh hai lượt gần nhất')
  assert.match(v2, /where device_hash = v_hash/, 'v2: chuỗi tính theo thiết bị')
  assert.match(v2, /v_prizes\[i\] is distinct from v_block/, 'v2: phải loại đúng số thưởng đang bị chặn')
  assert.match(v2, /256 % array_length\(v_allowed, 1\)/, 'v2: fallback vẫn lấy mẫu loại bỏ')
})
