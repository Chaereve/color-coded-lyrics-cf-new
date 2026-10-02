/* =========================================================
   LÁ CHẮN EDGE — logic thuần, chạy được cả trong Worker lẫn node:test.
   ---------------------------------------------------------
   D1 (ưu tiên) hoặc KV fallback là "tấm khiên" ở Edge: chặn spam trước DB.
   Supabase/Postgres vẫn là nguồn sự thật duy nhất cho quota và tiền thưởng;
   lá chắn chỉ làm lớp chống farm bổ sung, không tự cấp thưởng bao giờ.

   D1 lưu counter theo ngày VN và hash; KV cũ dùng hai khoá có TTL VN-midnight.
   ========================================================= */

export const SHIELD_LIMIT = 2          // khớp DAILY_SPIN_LIMIT bên frontend/SQL
export const SHIELD_MAX_FP_PER_IP = 5  // legacy threshold; shared IPs are not blocked
/* Trần số LƯỢT GỌI vote của một vân tay trong ngày. Không phải hạn mức vote
   (Postgres giữ hạn mức đó: 3 free/ngày/tài khoản và /vân tay, phần còn lại
   phải trả tiền). Đây chỉ là cái phanh để một farm tool không nện hàng nghìn
   request vào database. Người thật vote nhiều nhất cũng chỉ vài chục lượt. */
export const VOTE_MAX_CALLS_PER_FP = 120
import { vnDay, ttlUntilVnMidnight } from './vnDay.js'
import { d1SpinCheck, d1SpinCommit, d1VoteCheck, d1VoteCommit } from './d1-shield.js'
export { vnDay, ttlUntilVnMidnight } from './vnDay.js'

const readJson = raw => {
  try { return JSON.parse(raw) } catch { return null }
}
/* Giá trị cũ khác ngày (TTL chưa kịp rơi) được coi như chưa có gì. */
const fpState = (raw, day) => {
  const v = readJson(raw)
  return v && v.d === day && Number.isInteger(v.used) ? v : { d: day, used: 0 }
}
const ipState = (raw, day) => {
  const v = readJson(raw)
  return v && v.d === day && Array.isArray(v.fps)
    ? { d: day, fps: v.fps.slice(0, 64), blocked: v.blocked ? 1 : 0 }
    : { d: day, fps: [], blocked: 0 }
}

export const fpKey = fpHash => `fp:${fpHash}`
export const ipKey = ip => `ip:${ip}`

/* XÁC THỰC KÉP trước khi cho phép lượt quay đi tiếp:
   · IP đã bị khoá trong ngày            → chặn (farm bị bẻ khoá trước đó).
   · Fingerprint này đã hết lượt trong ngày → chặn ngay (trùng thiết bị gian lận).
   · Trùng IP nhưng fingerprint KHÁC      → cho phép (người thật chung Wi-Fi),
     trừ khi IP đó hôm nay đã thấy đủ 5 fingerprint khác nhau: đó là dấu hiệu
     anti-detect browser, nên khoá luôn IP tới hết ngày. */
export async function shieldCheck(kv, { ip, ipHash, fpHash, nowMs = Date.now(), limit = SHIELD_LIMIT, maxFpPerIp = SHIELD_MAX_FP_PER_IP } = {}) {
  if (typeof kv?.prepare === 'function') {
    if (!ipHash) throw new TypeError('D1 shield requires a hashed IP')
    return d1SpinCheck(kv, { ipHash, fpHash, nowMs, limit, maxFpPerIp })
  }
  const day = vnDay(nowMs)
  const [fpRaw, ipRaw] = await Promise.all([kv.get(fpKey(fpHash)), kv.get(ipKey(ip))])
  const fp = fpState(fpRaw, day)
  const net = ipState(ipRaw, day)
  const ttl = ttlUntilVnMidnight(nowMs)
  if (fp.used >= limit) return { ok: false, reason: 'err.spinEdgeFp' }
  return { ok: true, _state: { fp, net, day, ttl } }
}

/* Chỉ gọi SAU khi Supabase đã ghi ledger thành công (và không phải replay):
   đếm thêm một lượt cho fingerprint và ghi nhận fingerprint vào IP.
   Ghi sau thay vì trước để một lượt quay lỗi mạng không ăn mất hạn mức.
   Nhận _state từ shieldCheck để tránh 2 KV reads thừa (4 reads -> 2 reads / spin). */
export async function shieldCommit(kv, { ip, ipHash, fpHash, nowMs = Date.now(), _state } = {}) {
  if (typeof kv?.prepare === 'function') {
    if (!ipHash) throw new TypeError('D1 shield requires a hashed IP')
    return d1SpinCommit(kv, { ipHash, fpHash, nowMs })
  }
  let fp, net, day, ttl
  if (_state && _state.day === vnDay(nowMs)) {
    ;({ fp, net, day, ttl } = _state)
  } else {
    day = vnDay(nowMs)
    ttl = ttlUntilVnMidnight(nowMs)
    const [fpRaw, ipRaw] = await Promise.all([kv.get(fpKey(fpHash)), kv.get(ipKey(ip))])
    fp = fpState(fpRaw, day)
    net = ipState(ipRaw, day)
  }
  const exp = { expirationTtl: ttl }
  await Promise.all([
    kv.put(fpKey(fpHash), JSON.stringify({ d: day, used: fp.used + 1 }), exp),
    kv.put(ipKey(ip), JSON.stringify({
      d: day,
      fps: net.fps.includes(fpHash) ? net.fps : [...net.fps, fpHash].slice(-64),
      blocked: net.blocked,
    }), exp),
  ])
}

/* ---------------------------------------------------------
   LÁ CHẮN CHO VOTE (2026-11-03)
   Vote không có hạn mức "2 lượt/ngày" như vòng quay: người mua vote có quyền
   dùng bao nhiêu tuỳ họ. Nên ở Edge ta chỉ đếm SỐ LƯỢT GỌI theo vân tay để
   chặn hammer/farm tool; hạn mức thật (3 free/ngày/tài khoản + /vân tay, ví
   bonus, ví đã mua) do Postgres quyết định trong cùng transaction ghi phiếu.
   Khoá riêng `vc:` để không đụng vào bộ đếm của vòng quay.
   --------------------------------------------------------- */
export const voteKey = fpHash => `vc:${fpHash}`

export async function voteShieldCheck(kv, { fpHash, nowMs = Date.now(), limit = VOTE_MAX_CALLS_PER_FP } = {}) {
  if (typeof kv?.prepare === 'function') return d1VoteCheck(kv, { fpHash, nowMs, limit })
  if (!fpHash) return { ok: true }
  const day = vnDay(nowMs)
  const raw = await kv.get(voteKey(fpHash))
  const state = fpState(raw, day)
  if (state.used >= limit) return { ok: false, reason: 'err.voteEdgeFp' }
  return { ok: true, _state: { state, day, ttl: ttlUntilVnMidnight(nowMs) } }
}

/* Chỉ đếm SAU khi Postgres đã ghi phiếu thành công: một lượt lỗi mạng không
   được ăn mất hạn mức của người dùng. Nhận _state để tránh 1 KV read thừa. */
export async function voteShieldCommit(kv, { fpHash, nowMs = Date.now(), _state } = {}) {
  if (typeof kv?.prepare === 'function') return d1VoteCommit(kv, { fpHash, nowMs })
  if (!fpHash) return
  let state, day, ttl
  if (_state && _state.day === vnDay(nowMs)) {
    ;({ state, day, ttl } = _state)
  } else {
    day = vnDay(nowMs)
    ttl = ttlUntilVnMidnight(nowMs)
    state = fpState(await kv.get(voteKey(fpHash)), day)
  }
  await kv.put(voteKey(fpHash), JSON.stringify({ d: day, used: state.used + 1 }),
    { expirationTtl: ttl ?? ttlUntilVnMidnight(nowMs) })
}
