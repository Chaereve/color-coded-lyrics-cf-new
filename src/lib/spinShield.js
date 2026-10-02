/* =========================================================
   PHÍA CLIENT CỦA LÁ CHẮN EDGE
   ---------------------------------------------------------
   Với spin qua gate, gửi fp_hash (nếu trình duyệt cho phép), Turnstile token
   mới và JWT Supabase. Fingerprint là tín hiệu phụ: worker có quota fallback
   theo tài khoản khi quyền riêng tư/adblock chặn fingerprint.

   Turnstile mặc định chạy im lặng. Nếu Cloudflare cần tương tác, widget được
   đưa ra giữa mép dưới màn hình để người thật hoàn tất — không giấu challenge
   ngoài viewport rồi báo lỗi cho họ. Mỗi action nhận một token mới; các action
   đồng thời được xếp hàng để không dùng trùng token one-time.
   ========================================================= */
import { loadTurnstile, TURNSTILE_SITE_KEY } from './turnstile.js'

export const SPIN_GATE_URL = (import.meta.env?.VITE_SPIN_GATE_URL || '').replace(/\/$/, '')
export const VOTE_GATE_URL = (import.meta.env?.VITE_VOTE_GATE_URL || '').replace(/\/$/, '')
const FP_CACHE_KEY = 'ccl.spin.fp.v1'
const HASH64 = /^[a-f0-9]{64}$/
export const CAPTCHA_ATTEMPT_TIMEOUT_MS = 20000
export const CAPTCHA_INTERACTIVE_TIMEOUT_MS = 120000
const CAPTCHA_RETRY_DELAY_MS = 150
const FINGERPRINT_WAIT_MS = 1200

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

/* Fingerprint is an optional anti-farm signal, never a reason to hang a real
   action. Let it warm in the background but stop waiting after 1.2s; the Edge
   gate uses an account-scoped hash fallback for Spin and Postgres still enforces
   account/device limits. */
export async function fingerprintHashFast(timeoutMs = FINGERPRINT_WAIT_MS) {
  let timer
  try {
    return await Promise.race([
      fingerprintHash().catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

/* On vote modal open, resolve the first dynamic FingerprintJS import while the
   user is choosing a quantity. Errors remain soft; the action still has its
   bounded 1.2s wait and server-side account limits. */
export function warmFingerprint() {
  /* No Canvas 2D means FingerprintJS will only emit a noisy unsupported-canvas
     warning (jsdom/test runners and privacy-hardened contexts). Skip prewarm;
     the actual action still gets its bounded best-effort attempt. */
  if (typeof window === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') {
    return Promise.resolve(false)
  }
  return fingerprintHash().then(() => true, () => false)
}

let captcha = null
let captchaQueue = Promise.resolve()

function ensureCaptchaWidget(ts) {
  if (captcha) return captcha
  const host = document.createElement('div')
  host.className = 'ccl-turnstile-host'
  host.dataset.interactive = 'false'
  host.setAttribute('role', 'region')
  host.setAttribute('aria-label', 'Security verification')
  const label = document.createElement('p')
  label.className = 'ccl-turnstile-label'
  label.setAttribute('role', 'status')
  label.textContent = ''
  const box = document.createElement('div')
  box.className = 'ccl-turnstile-widget'
  host.append(label, box)
  document.body.appendChild(host)

  const state = {
    ts, host, box, id: null, token: null, waiters: [], timer: null,
    lastError: null, interactive: false,
  }
  const setInteractive = (active) => {
    state.interactive = active
    host.dataset.interactive = active ? 'true' : 'false'
    label.textContent = active ? 'Complete the security check below to continue.' : ''
    host.setAttribute('aria-label', active
      ? 'Security check required. Complete the challenge to continue.'
      : 'Security verification')
  }
  state.setInteractive = setInteractive
  const flush = (value, { isError = false, retryable = true } = {}) => {
    const waiting = state.waiters
    state.waiters = []
    clearTimeout(state.timer)
    state.timer = null
    setInteractive(false)
    if (isError) state.lastError = value
    waiting.forEach(({ resolve, retryable: canRetry }) =>
      resolve({ token: value, retryable: retryable && canRetry }))
  }
  try {
    state.id = ts.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: 'always',
      execution: 'execute',
      theme: 'dark',
      callback: token => { state.token = token; state.lastError = null; flush(token) },
      'error-callback': () => { state.token = null; flush(null, { isError: true }) },
      'expired-callback': () => { state.token = null },
      'timeout-callback': () => {
        const challengeWasInteractive = state.interactive
        state.token = null
        flush(null, { isError: true, retryable: !challengeWasInteractive })
      },
      'before-interactive-callback': () => {
        /* Challenge cần người thật: lộ widget, bật pointer, chờ tối đa 2 phút.
           Không resolve null và không reset/retry ngay — đó là nguyên nhân cũ
           khiến challenge vô hình tự đánh rớt người dùng. */
        setInteractive(true)
        state.waiters.forEach(waiter => { waiter.retryable = false })
        clearTimeout(state.timer)
        state.timer = setTimeout(() => {
          state.timer = null
          state.token = null
          try { if (state.id != null) state.ts.reset(state.id) } catch {}
          flush(null, { isError: true, retryable: false })
        }, CAPTCHA_INTERACTIVE_TIMEOUT_MS)
      },
    })
  } catch {
    host.remove()
    return null
  }
  return captcha = state
}

function singleAttempt(ts) {
  return new Promise((resolve) => {
    const state = ensureCaptchaWidget(ts)
    if (!state) { resolve({ token: null, retryable: false }); return }
    if (state.token) {
      const token = state.token
      state.token = null
      try { if (state.id != null) state.ts.reset(state.id) } catch {}
      resolve({ token, retryable: false })
      return
    }
    const entry = { resolve, retryable: true }
    state.waiters.push(entry)
    // Keep the widget visible while Cloudflare loads, including on mobile
    // browsers that never fire before-interactive-callback.
    state.setInteractive(true)
    state.timer = setTimeout(() => {
      state.waiters = state.waiters.filter(waiter => waiter !== entry)
      state.timer = null
      state.token = null
      state.setInteractive(false)
      try { if (state.id != null) state.ts.reset(state.id) } catch {}
      /* If Cloudflare never calls back, retry once with a fresh challenge. */
      resolve({ token: null, retryable: true })
    }, CAPTCHA_ATTEMPT_TIMEOUT_MS)
    try { ts.execute(state.id) }
    catch {
      state.waiters = state.waiters.filter(waiter => waiter !== entry)
      clearTimeout(state.timer)
      state.timer = null
      state.setInteractive(false)
      resolve({ token: null, retryable: true })
    }
  })
}

async function acquireCaptchaTokenNow(retries) {
  if (!TURNSTILE_SITE_KEY) return null
  try {
    const ts = await loadTurnstile()
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await singleAttempt(ts)
      if (result.token) {
        try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch {}
        if (captcha) captcha.token = null
        return result.token
      }
      if (!result.retryable || attempt >= retries) return null
      try { if (captcha?.id != null) captcha.ts.reset(captcha.id) } catch {}
      if (captcha) captcha.token = null
      await new Promise(resolve => setTimeout(resolve, CAPTCHA_RETRY_DELAY_MS))
    }
  } catch {
    return null
  }
  return null
}

/* Preload the vendor script when the user opens a spin/vote surface, not on
   every page visit. The later action still executes a fresh one-time token. */
export function warmCaptcha() {
  if (!TURNSTILE_SITE_KEY) return Promise.resolve(false)
  return loadTurnstile().then(() => true, () => false)
}

/* Turnstile tokens are single-use. Serialize simultaneous spin/vote token
   requests rather than resolving every waiter with the same token. */
export function acquireCaptchaToken({ retries = 1 } = {}) {
  const run = () => acquireCaptchaTokenNow(retries)
  const result = captchaQueue.then(run, run)
  captchaQueue = result.then(() => undefined, () => undefined)
  return result
}
