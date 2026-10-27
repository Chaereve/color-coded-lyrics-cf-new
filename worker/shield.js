/* =========================================================
   LÁ CHẮN EDGE — logic thuần, chạy được cả trong Worker lẫn node:test.
   ---------------------------------------------------------
   D1 (ưu tiên) hoặc KV fallback là "tấm khiên" ở Edge: chặn spam trước DB.
   Supabase/Postgres vẫn là nguồn sự thật duy nhất cho quota và tiền thưởng;
   lá chắn chỉ làm lớp chống farm bổ sung, không tự cấp thưởng bao giờ.

   D1 lưu counter theo ngày VN và hash; KV fallback lưu khoá vân tay có TTL
   VN-midnight. Không bao giờ lưu địa chỉ IP thô vào D1 hay KV (khớp cam kết
   tại /privacy.html), và không khoá IP dùng chung (Wi-Fi/CGNAT).
   ========================================================= */

export const SHIELD_LIMIT = 2          // khớp DAILY_SPIN_LIMIT bên frontend/SQL
export const SHIELD_MAX_FP_PER_IP = 5  // legacy constant kept for compatibility; shared IPs are never blocked
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

export const fpKey = fpHash => `fp:${fpHash}`
export const ipKey = ipHash => `ip:${ipHash}`

/* Hạn mức lượt quay theo vân tay ở Edge:
   · Fingerprint này đã hết lượt trong ngày → chặn ngay (trùng thiết bị gian lận).
   · Trùng IP nhưng fingerprint KHÁC      → cho phép (người thật chung Wi-Fi/CGNAT). */
export async function shieldCheck(kv, { fpHash, nowMs = Date.now(), limit = SHIELD_LIMIT } = {}) {
  if (typeof kv?.prepare === 'function') {
    return d1SpinCheck(kv, { fpHash, nowMs, limit })
  }
  const day = vnDay(nowMs)
  const fpRaw = await kv.get(fpKey(fpHash))
  const fp = fpState(fpRaw, day)
  const ttl = ttlUntilVnMidnight(nowMs)
  if (fp.used >= limit) return { ok: false, reason: 'err.spinEdgeFp' }
  return { ok: true, _state: { fp, day, ttl } }
}

/* Chỉ gọi SAU khi Supabase đã ghi ledger thành công (và không phải replay):
   đếm thêm một lượt cho fingerprint. Không ghi IP thô vào KV. */
export async function shieldCommit(kv, { fpHash, nowMs = Date.now(), _state } = {}) {
  if (typeof kv?.prepare === 'function') {
    return d1SpinCommit(kv, { fpHash, nowMs })
  }
  let fp, day, ttl
  if (_state && _state.day === vnDay(nowMs)) {
    ;({ fp, day, ttl } = _state)
  } else {
    day = vnDay(nowMs)
    ttl = ttlUntilVnMidnight(nowMs)
    fp = fpState(await kv.get(fpKey(fpHash)), day)
  }
  await kv.put(fpKey(fpHash), JSON.stringify({ d: day, used: fp.used + 1 }), { expirationTtl: ttl })
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
