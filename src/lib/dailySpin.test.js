import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DAILY_SPIN_LIMIT, SPIN_REWARDS, spinDay, nextSpinReset, rewardOdds, spinTier,
  spinTiers, spinSectors, spinSectorIndex, spinTicks, spinAverage, formatChance,
  spinRotation, spinCountdown,
  demoSpinStatus, drawDemoSpin, validateSpinResult, drawSegment, streakBlocked,
} from './dailySpin.js'

const now = Date.parse('2026-09-07T12:00:00Z')
const input = { entries: [], deviceToken: 'device-a', userId: 'account-a', now }
const draw = (entries, overrides = {}) => drawDemoSpin({
  ...input, entries, requestId: crypto.randomUUID(), random: () => 0, ...overrides,
})

test('16 equal sectors: 56.25 / 25 / 12.5 / 6.25%, average 3.5 votes per day', () => {
  assert.equal(SPIN_REWARDS.length, 16)
  // Equal slices + a uniform server draw: what the player sees IS the real odds.
  assert.deepEqual(rewardOdds().map(p => [p.reward, p.count, p.chance]),
    [[1, 9, 56.25], [2, 4, 25], [3, 2, 12.5], [5, 1, 6.25]])
  assert.deepEqual(rewardOdds().map(p => formatChance(p.chance)), ['56.25', '25', '12.5', '6.25'])
  assert.equal(spinAverage(), 1.75)
  assert.equal(spinAverage() * DAILY_SPIN_LIMIT, 3.5)
  // 256 % 16 === 0: one cryptographic byte still needs no rejection sampling.
  assert.equal(256 % SPIN_REWARDS.length, 0)
  // No blank sector, and the single jackpot sits opposite the pointer.
  assert.ok(SPIN_REWARDS.every(r => r >= 1))
  assert.equal(SPIN_REWARDS.filter(r => r === 5).length, 1)
  assert.equal(SPIN_REWARDS[8], 5)
  // Two equal neighbours are the minimum with 9 low prizes in 16 slices.
  const pairs = SPIN_REWARDS.filter((r, i) => r === SPIN_REWARDS[(i + 1) % 16]).length
  assert.equal(pairs, 2)
})

test('prize tiers rank with the reward, so the wheel can tone each slice', () => {
  assert.deepEqual(spinTiers(), { 1: 't1', 2: 't2', 3: 't3', 5: 't4' })
  assert.equal(spinTier(5), 't4')
  // A retuned prize list must still map lowest -> highest onto t1 -> t4.
  assert.deepEqual([...new Set([2, 7, 7, 20].map(r => spinTier(r, [2, 7, 20])))], ['t1', 't2', 't3'])
  assert.equal(spinTier(99, [1, 2]), 't1') // unknown value never crashes the render
})

test('SQL reward order and fresh schema stay in sync with BOTH migrations', () => {
  const read = f => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')
  const base = read('20260907_daily_spin.sql')
  const prizes = read('20260908_daily_spin_prizes.sql')
  const edge = read('20260909_daily_spin_edge.sql')
  const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
  // The newest array wins: `create or replace` runs in file order.
  const arrays = [...prizes.matchAll(/select array\[([\d,\s]+)\]/g)].map(m => m[1].split(',').map(Number))
  assert.equal(arrays.length, 1)
  assert.deepEqual(arrays[0], SPIN_REWARDS)
  assert.match(prizes, /segment between 0 and 15/)
  assert.match(prizes, /256 % v_sectors <> 0/)
  // A fresh install must end up with the migrated project's behaviour, not with
  // the exact bytes of every file: the 2026-10-31 bonus split later changed ONE
  // line inside these three blocks (wheel rewards go to bonus_credits now), and
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

test('wheel always stops at the centre of the awarded sector on repeated spins', () => {
  const step = 360 / SPIN_REWARDS.length
  let rotation = 0
  for (let pass = 0; pass < 4; pass++) {
    for (let index = 0; index < SPIN_REWARDS.length; index++) {
      const next = spinRotation(rotation, index)
      assert.ok(next - rotation >= 1800)
      assert.equal((next + index * step) % 360, 0)
      rotation = next
    }
  }
  for (const index of [-1, SPIN_REWARDS.length, 1.5, null, undefined]) assert.throws(() => spinRotation(0, index))
})

test('bản vẽ gom ô cùng thưởng thành dải và in số MỘT lần cho mỗi dải', () => {
  const sectors = spinSectors()
  const step = 360 / SPIN_REWARDS.length
  assert.equal(sectors.length, 16, 'vẫn đủ 16 ô, mỗi ô 22,5° — xác suất không đổi')
  /* MỖI GIÁ TRỊ LÀ MỘT DẢI LIỀN: đi hết vòng, giá trị cũ không quay lại sau khi
     đã đổi sang giá trị khác. Đây là thứ khiến "+1 ×9" đọc được thành một
     vùng, thay vì chín số 1 rải rác (lỗi "trùng lặp số vote"). */
  const bands = sectors.filter((s, i, all) => i === 0 || all[i - 1].reward !== s.reward)
  assert.deepEqual(bands.map(s => s.reward), [1, 2, 3, 5], 'bốn dải, tăng dần, không cắt khúc')
  const seen = new Map()
  for (const s of sectors) seen.set(s.reward, (seen.get(s.reward) || 0) + 1)
  assert.deepEqual([...seen], [[1, 9], [2, 4], [3, 2], [5, 1]], 'đúng bảng thưởng')
  for (const s of sectors) assert.equal(s.count, seen.get(s.reward), 'số ô của dải')
  // Tâm ô nằm trên lưới 22,5° (kim dừng ở tâm ô — xem spinRotation)
  assert.equal(new Set(sectors.map(s => s.angle)).size, 16, 'không hai ô nào trùng tâm')
  for (const s of sectors) {
    assert.equal(s.angle % step, 0, `tâm ô lệch lưới: ${s.angle}`)
    assert.ok(s.angle >= 0 && s.angle < 360)
  }
  // Giải cao nhất vẫn ở 6 giờ, như bản 16 ô trước
  assert.equal(sectors.find(s => s.reward === 5).angle, 180)
  // ĐÚNG BỐN nhãn: một nhãn cho một dải, đặt ở ô giữa dải
  const labels = sectors.filter(s => s.label)
  assert.deepEqual(labels.map(s => [s.reward, s.count]), [[1, 9], [2, 4], [3, 2], [5, 1]])
  for (const label of labels) {
    const band = sectors.filter(s => s.reward === label.reward)
    assert.equal(label, band[Math.floor((band.length - 1) / 2)], 'nhãn ở ô giữa dải')
  }
  assert.equal(sectors.filter(s => s.label).length, new Set(SPIN_REWARDS).size,
    'số nhãn = số mức thưởng, không phải số ô')
})

test('ô server rút được quy đổi đúng sang ô trên bản vẽ', () => {
  const sectors = spinSectors()
  const picked = []
  for (let segment = 0; segment < SPIN_REWARDS.length; segment++) {
    const i = spinSectorIndex(segment)
    assert.equal(sectors[i].reward, SPIN_REWARDS[segment], `ô ${segment} trỏ sai dải`)
    picked.push(i)
  }
  /* Mười sáu ô rút trỏ về mười sáu ô vẽ, và ô thứ mấy trong nhóm thì rơi đúng
     ô thứ mấy của dải — nếu không, hai lượt khác nhau sẽ cùng tô sáng một ô. */
  assert.equal(new Set(picked).size, 16)
  const plus1 = sectors.map((s, i) => [s, i]).filter(([s]) => s.reward === 1).map(([, i]) => i)
  assert.deepEqual(plus1, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  for (const bad of [-1, SPIN_REWARDS.length, 1.5, null, undefined]) {
    assert.throws(() => spinSectorIndex(bad), 'chỉ số ngoài bảng phải bị chặn')
  }
  /* Bảng thưởng do máy chủ trả về cũng quy đổi được: một mức thưởng duy nhất
     thì cả vòng là MỘT dải, nên chỉ còn đúng MỘT nhãn. */
  const custom = [2, 2, 2, 2]
  assert.equal(spinSectors(custom).filter(s => s.label).length, 1)
  assert.equal(spinSectorIndex(3, custom), 3)
})

test('tick track follows the CSS easing: dense at the start, sparse at the stop', () => {
  const duration = 4500
  const ticks = spinTicks(5 * 360 + 90, SPIN_REWARDS.length, duration)
  assert.ok(ticks.length > 20, 'a five-turn spin needs a real tick track')
  // Ordered, inside the animation, and never faster than the anti-buzz gap.
  let prev = -1
  for (const { at, gain } of ticks) {
    assert.ok(at > prev, 'ticks must be strictly ordered')
    assert.ok(at >= 0 && at <= duration / 1000)
    assert.ok(gain > 0 && gain <= 1)
    if (prev >= 0) assert.ok(at - prev >= 0.049)
    prev = at
  }
  // The deceleration is audible: the last gaps are far wider than the first.
  const gap = i => ticks[i + 1].at - ticks[i].at
  assert.ok(gap(ticks.length - 2) > gap(0) * 3)
  // Quieter while it races, louder as it settles.
  assert.ok(ticks[ticks.length - 1].gain > ticks[0].gain)
  // Degenerate inputs stay silent instead of throwing during a spin.
  for (const args of [[0], [720, 16, 0], [-360], [720, 0]]) assert.deepEqual(spinTicks(...args), [])
})

test('countdown never displays negative time', () => {
  assert.equal(spinCountdown(86_400_000), '24:00:00')
  assert.equal(spinCountdown(3_661_000), '01:01:01')
  assert.equal(spinCountdown(1), '00:00:01')
  assert.equal(spinCountdown(-1000), '00:00:00')
})

test('switching accounts shares the two device spins and reveals only own rewards', () => {
  const entries = []
  entries.push(draw(entries).entry)
  entries.push(draw(entries, { userId: 'account-b' }).entry)
  for (const userId of ['account-a', 'account-b', 'account-c']) {
    const status = demoSpinStatus({ ...input, entries, userId, credits: 1 })
    assert.equal(status.device_used, 2)
    assert.equal(status.remaining, 0)
    assert.equal(status.history.length, userId === 'account-c' ? 0 : 1)
    assert.throws(() => draw(entries, { userId }), /err.spinDeviceLimit/)
  }
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
    spin: { request_id: 'request', segment: 8, reward: 5 },
    status: { user_id: 'account', rewards: [...SPIN_REWARDS], remaining: 1, credits: 10 },
  }
  assert.equal(validateSpinResult(response, 'account', 'request'), response)
  assert.throws(() => validateSpinResult(response, 'another-account', 'request'), /err.spinResponse/)
  assert.throws(() => validateSpinResult(response, 'account', 'another-request'), /err.spinResponse/)
  for (const bad of [null, {}, { ...response, spin: { ...response.spin, reward: 1000 } },
    { ...response, spin: { ...response.spin, segment: SPIN_REWARDS.length } },
    { ...response, status: { ...response.status, remaining: 3 } },
    // moc gio gui len ma doc khong ra ngay thi dung lay: NaN se in len o dem nguoc
    { ...response, status: { ...response.status, server_now: 'không phải ngày' } },
    { ...response, status: { ...response.status, reset_at: '' } }]) {
    assert.throws(() => validateSpinResult(bad, 'account', 'request'), /err.spinResponse/)
  }
  // ...nhung backend cu KHONG gui moc gio van phai duoc chap nhan
  assert.equal(validateSpinResult(response, 'account', 'request'), response)
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

  // đang chặn +1 thì không lần rút nào được rơi vào một trong 9 ô mang số 1
  for (let i = 0; i < 500; i++) assert.notEqual(SPIN_REWARDS[drawSegment({ recent: [1, 1] })], 1)
  // chặn ở ô hiếm nhất (+5, đúng một ô) cũng phải tránh
  for (let i = 0; i < 200; i++) assert.notEqual(SPIN_REWARDS[drawSegment({ recent: [5, 5] })], 5)
  // chưa đủ hai lượt trùng thì rút đều như cũ: mọi ô đều có thể ra
  const seen = new Set()
  for (let i = 0; i < 400; i++) seen.add(drawSegment({ recent: [2, 1] }))
  assert.equal(seen.size, SPIN_REWARDS.length, 'không được hẹp tập ô khi luật không bật')
  // bảng thưởng một ô (mọi ô đều là số bị chặn) vẫn phải trả về một ô hợp lệ
  assert.equal(drawSegment({ rewards: [7], recent: [7, 7] }), 0)
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
})
