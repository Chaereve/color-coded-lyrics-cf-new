/* =========================================================
   PHÍA CLIENT CỦA LÁ CHẮN EDGE
   ---------------------------------------------------------
   Ba thứ được gửi kèm mỗi lượt quay khi bật gate:
     · fp_hash         — SHA-256 visitorId của FingerprintJS (bản mã nguồn mở).
                         Băm trước khi gửi để KV/log không giữ chuỗi gốc; đây là
                         tín hiệu chống farm, KHÔNG phải định danh thiết bị thật.
     · turnstile_token — token Turnstile xin theo từng lượt. Widget chạy HOÀN
                         TOÀN ẩn: nếu Cloudflare đòi một thách thức tương tác,
                         lượt đó bị bỏ ngay, không bao giờ có khung CAPTCHA nào
                         hiện ra — UI chỉ nhắc nhẹ "thử lại" (err.spinCaptcha).
                         Người thật được xác minh ngầm trong chưa đầy một giây.
     · user_token      — JWT phiên Supabase hiện tại, để cổng Edge uỷ quyền RPC
                         đúng người (cổng không cầm service role).
   Chưa đặt VITE_SPIN_GATE_URL thì lượt quay gọi thẳng RPC — vẫn kèm theo
   fp_hash để Postgres tự chốt hạn mức theo vân tay ngay cả khi chưa deploy
   cổng Edge (xem migrations/20261102_spin_fp_quota.sql).
   ========================================================= */
import { loadTurnstile, TURNSTILE_SITE_KEY } from './turnstile'

export const SPIN_GATE_URL = (import.meta.env.VITE_SPIN_GATE_URL || '').replace(/\/$/, '')
/* Cổng Edge cho VOTE (2026-11-03). Đặt VITE_VOTE_GATE_URL=/api/vote khi đã
   cổng Edge đã chạy (Pages Functions, xem HUONG-DAN.md mục “Lá chắn Edge”):
   mỗi lượt vote đi kèm Turnstile + fp_hash + IP (cổng tự lấy từ kết nối),
   và Postgres ghi hai hash đó vào bảng votes để còn truy vết farm. Bỏ trống thì
   vote gọi thẳng RPC như trước — vẫn gửi fp_hash để hạn mức vân tay hoạt động. */
export const VOTE_GATE_URL = (import.meta.env.VITE_VOTE_GATE_URL || '').replace(/\/$/, '')
const FP_CACHE_KEY = 'ccl.spin.fp.v1'
const HASH64 = /^[a-f0-9]{64}$/

async function sha256hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

let fpPromise = null
/* visitorId chỉ lấy một lần mỗi tab; sessionStorage sống sót qua F5 nhưng không
   chia sẻ giữa các tab ẩn danh — đúng behaviour ta muốn ở một tín hiệu chống farm. */
export function fingerprintHash() {
  if (!fpPromise) {
    fpPromise = (async () => {
      let cached = null
      try { cached = sessionStorage.getItem(FP_CACHE_KEY) } catch { /* storage bị chặn */ }
      if (HASH64.test(cached || '')) return cached
      const mod = await import('@fingerprintjs/fingerprintjs')
      const FingerprintJS = mod.default ?? mod
      const agent = await FingerprintJS.load()
      const { visitorId } = await agent.get()
      const hash = await sha256hex(visitorId)
      if (!HASH64.test(hash)) throw new Error('err.spinFingerprint')
      try { sessionStorage.setItem(FP_CACHE_KEY, hash) } catch { /* không bắt buộc */ }
      return hash
    })().catch(e => {
      fpPromise = null // lần sau thử lại, không cache một kết quả hỏng
      throw e?.message?.startsWith('err.') ? e : new Error('err.spinFingerprint')
    })
  }
  return fpPromise
}

let captcha = null
/* Widget Turnstile của Spin/Vote được giữ HOÀN TOÀN vô hình: phần tử chứa nằm
   lệch hẳn ra ngoài viewport (left: -10000px, opacity: 0, pointer-events: none)
   nên kể cả khi Cloudflare dựng khung thách thức thì người dùng cũng không thấy
   gì — không overlay, không modal, không thứ gì nhảy ra giữa màn hình.

   Nếu Cloudflare vẫn đòi một thách thức tương tác (before-interactive-callback)
   nghĩa là phiên này không xác minh ngầm được: ta từ bỏ NGAY lượt đó, không đợi,
   không hiện gì cả. Cổng Edge sẽ trả err.spinCaptcha và UI chỉ nhắc nhẹ “thử
   lại” — người thật hầu như luôn qua vòng ngầm nên nhánh này hiếm khi chạm tới. */
function ensureCaptchaWidget(ts) {
  if (captcha) return captcha
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;top:0;left:-10000px;width:300px;height:65px;opacity:0;pointer-events:none;'
  box.setAttribute('aria-hidden', 'true')
  document.body.appendChild(box)
  const state = { ts, box, id: null, token: null, waiters: [], timer: null }
  const flush = value => {
    const waiting = state.waiters
    state.waiters = []
    clearTimeout(state.timer)
    waiting.forEach(resolve => resolve(value))
  }
  try {
    state.id = ts.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: 'execute',   // xác minh ngầm — không bao giờ cho widget hiện thách thức
      theme: 'dark',
      callback: token => { state.token = token; flush(token) },
      'error-callback': () => { state.token = null; flush(null) },
      'expired-callback': () => { state.token = null },
      'timeout-callback': () => { state.token = null; flush(null) },
      'before-interactive-callback': () => flush(null),
    })
  } catch {
    box.remove()   // widget không dựng được: lượt sau dựng lại từ đầu
    return null
  }
  captcha = state
  return captcha
}

/* Mỗi lượt quay cần một token mới (token dùng một lần). Hai lối thoát, và cả
   hai đều KHÔNG BAO GIỜ hiện khung CAPTCHA:
     · token về từ vòng xác minh ngầm (người thật, đa số) → trả token;
     · Cloudflare đòi thách thức tương tác, lỗi, hoặc quá chậm → trả null để
       cổng từ chối có kiểm soát (err.spinCaptcha) và UI nhắc người dùng thử lại.
   Mốc 10 giây chỉ là lưới an toàn cho trường hợp Cloudflare không phản hồi gì —
   bình thường vòng xác minh ngầm xong trong chưa đầy một giây. */
export function acquireCaptchaToken() {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve(null)
  return loadTurnstile()
    .then(ts => new Promise(resolve => {
      const state = ensureCaptchaWidget(ts)
      if (!state) { resolve(null); return }
      state.waiters.push(resolve)
      state.timer = setTimeout(() => {
        state.waiters = state.waiters.filter(r => r !== resolve)
        resolve(null)
      }, 10_000)
      try { ts.execute(state.box) } catch { resolve(null) }
    }))
    .then(token => {
      // Token đã dùng rồi thì reset widget cho lượt sau lấy token mới.
      try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch { /* widget có thể đã chết */ }
      if (captcha) captcha.token = null
      return token
    })
    .catch(() => null)
}
