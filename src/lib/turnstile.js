/* =========================================================
   CLOUDFLARE TURNSTILE — chống bot clone acc đăng nhập Google
   ---------------------------------------------------------
   Site key là public (VITE_TURNSTILE_SITE_KEY). Chưa cấu hình key
   thì bỏ qua hẳn, đăng nhập như cũ — chỉ bật CAPTCHA trong
   Supabase Dashboard SAU KHI đã deploy bản có key này, nếu không
   sẽ khóa luôn cả người dùng thật (Supabase từ chối OAuth không
   kèm captcha token khi enforcement đang bật).
   ========================================================= */

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export const TURNSTILE_SITE_KEY = import.meta.env?.VITE_TURNSTILE_SITE_KEY || ''

let loading = null

function preconnectTurnstile() {
  if (typeof document === 'undefined' || !document.head) return
  if (!document.querySelector('link[data-ccl-turnstile-preconnect]')) {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = 'https://challenges.cloudflare.com'
    link.crossOrigin = 'anonymous'
    link.dataset.cclTurnstilePreconnect = ''
    document.head.appendChild(link)
  }
  if (!document.querySelector('link[data-ccl-turnstile-dns]')) {
    const link = document.createElement('link')
    link.rel = 'dns-prefetch'
    link.href = '//challenges.cloudflare.com'
    link.dataset.cclTurnstileDns = ''
    document.head.appendChild(link)
  }
}

/** Nạp script Turnstile 1 lần duy nhất, trả về window.turnstile. */
export function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('turnstile-load'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  preconnectTurnstile()
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src=\"${SRC}\"]`)
      if (existing && window.turnstile) { resolve(window.turnstile); return }
      const s = document.createElement('script')
      s.src = SRC
      s.async = true
      s.defer = true
      let done = false
      const to = setTimeout(() => {
        if (done) return
        done = true
        loading = null
        reject(new Error('turnstile-load'))
      }, 6000)
      s.onload = () => {
        if (done) return
        done = true
        clearTimeout(to)
        // Turnstile may need a tick to attach to window
        if (window.turnstile) resolve(window.turnstile)
        else {
          let tries = 0
          const iv = setInterval(() => {
            if (window.turnstile) { clearInterval(iv); resolve(window.turnstile) }
            else if (++tries > 20) { clearInterval(iv); loading = null; reject(new Error('turnstile-load')) }
          }, 100)
        }
      }
      s.onerror = () => {
        if (done) return
        done = true
        clearTimeout(to)
        loading = null
        reject(new Error('turnstile-load'))
      }
      document.head.appendChild(s)
    })
  }
  return loading
}