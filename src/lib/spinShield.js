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
export const VOTE_GATE_URL = (import.meta.env.VITE_VOTE_GATE_URL || '').replace(/\/$/, '')
const FP_CACHE_KEY = 'ccl.spin.fp.v1'
const HASH64 = /^[a-f0-9]{64}$/

async function sha256hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

let fpPromise = null
export function fingerprintHash() {
  if (!fpPromise) {
    fpPromise = (async () => {
      let cached = null
      try { cached = sessionStorage.getItem(FP_CACHE_KEY) } catch {}
      if (HASH64.test(cached || '')) return cached
      const mod = await import('@fingerprintjs/fingerprintjs')
      const FingerprintJS = mod.default ?? mod
      const agent = await FingerprintJS.load()
      const { visitorId } = await agent.get()
      const hash = await sha256hex(visitorId)
      if (!HASH64.test(hash)) throw new Error('err.spinFingerprint')
      try { sessionStorage.setItem(FP_CACHE_KEY, hash) } catch {}
      return hash
    })().catch(e => {
      fpPromise = null
      throw e?.message?.startsWith('err.') ? e : new Error('err.spinFingerprint')
    })
  }
  return fpPromise
}

let captcha = null

function ensureCaptchaWidget(ts) {
  if (captcha) return captcha
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;top:0;left:-10000px;width:300px;height:65px;opacity:0;pointer-events:none;'
  box.setAttribute('aria-hidden', 'true')
  document.body.appendChild(box)
  const state = { ts, box, id: null, token: null, waiters: [], timer: null, lastError: null }
  const flush = (value, isError = false) => {
    const waiting = state.waiters
    state.waiters = []
    clearTimeout(state.timer)
    state.timer = null
    if (isError) state.lastError = value
    waiting.forEach(({ resolve }) => resolve(value))
  }
  const flushAll = (value) => flush(value, false)
  try {
    state.id = ts.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: 'execute',
      theme: 'dark',
      callback: token => { state.token = token; state.lastError = null; flushAll(token) },
      'error-callback': () => { state.token = null; flushAll(null) },
      'expired-callback': () => { state.token = null },
      'timeout-callback': () => { state.token = null; flushAll(null) },
      // If Cloudflare would need interactive challenge, we treat as soft fail
      // and let acquireCaptchaToken retry once after reset. Never show UI.
      'before-interactive-callback': () => {
        state.token = null
        // Don't flush immediately as hard failure — give a chance to retry
        // Mark as needs-interactive so caller can decide to retry
        flush(null, true)
      },
    })
  } catch {
    box.remove()
    return null
  }
  captcha = state
  return captcha
}

function singleAttempt(ts) {
  return new Promise((resolve) => {
    const state = ensureCaptchaWidget(ts)
    if (!state) { resolve(null); return }
    // If we already have a fresh token (edge case), use it
    if (state.token) {
      const tok = state.token
      state.token = null
      try { if (state.id != null) state.ts.reset(state.id) } catch {}
      resolve(tok)
      return
    }
    const entry = { resolve }
    state.waiters.push(entry)
    state.timer = setTimeout(() => {
      state.waiters = state.waiters.filter(r => r !== entry)
      resolve(null)
    }, 8000)
    try { ts.execute(state.box) } catch { resolve(null) }
  })
}

/* Each spin/vote needs a fresh token. Retry once on null to absorb
   transient Turnstile hiccups (network blip, widget cold start, or a
   before-interactive that would otherwise surface as err.spinCaptcha
   without reason). Never shows a visible challenge. */
export async function acquireCaptchaToken({ retries = 1 } = {}) {
  if (!TURNSTILE_SITE_KEY) return null
  try {
    const ts = await loadTurnstile()
    for (let attempt = 0; attempt <= retries; attempt++) {
      const token = await singleAttempt(ts)
      if (token) {
        try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch {}
        if (captcha) captcha.token = null
        return token
      }
      // No token — reset widget and try again if we have retries left
      if (attempt < retries) {
        try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch {}
        if (captcha) captcha.token = null
        // small backoff to let Turnstile re-init
        await new Promise(r => setTimeout(r, 400 + attempt * 300))
        continue
      }
      try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch {}
      if (captcha) captcha.token = null
      return null
    }
    return null
  } catch {
    return null
  }
}
