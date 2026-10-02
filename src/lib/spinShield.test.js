import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CAPTCHA_ATTEMPT_TIMEOUT_MS, CAPTCHA_INTERACTIVE_TIMEOUT_MS, fingerprintHashFast, warmFingerprint } from './spinShield.js'

const at = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

test('fingerprint là tín hiệu phụ: giới hạn thời gian chờ, không treo action', async () => {
  assert.equal(await fingerprintHashFast(0), null)
  assert.equal(await warmFingerprint(), false, 'không prewarm FingerprintJS khi runtime không có Canvas 2D')
  assert.equal(CAPTCHA_ATTEMPT_TIMEOUT_MS, 20000)
  assert.equal(CAPTCHA_INTERACTIVE_TIMEOUT_MS, 120000)
})

test('Turnstile challenge tương tác phải hiện trong viewport và đợi user, không tự fail/retry', () => {
  const src = at('./spinShield.js')
  assert.match(src, /appearance:\s*'always'/)
  assert.match(src, /className\s*=\s*'ccl-turnstile-host'/)
  assert.doesNotMatch(src, /left:-10000px|aria-hidden/,
    'không được giấu challenge ngoài màn hình hoặc khỏi accessibility tree')
  const before = src.match(/'before-interactive-callback':\s*\(\) => \{([\s\S]*?)\n      \},/)?.[1] || ''
  assert.match(before, /setInteractive\(true\)/)
  assert.match(src, /state\.setInteractive\(true\)\s*state.timer = setTimeout/, 'widget is visible even without interactive callback')
  assert.match(before, /CAPTCHA_INTERACTIVE_TIMEOUT_MS/)
  const immediate = before.split('state.timer = setTimeout')[0]
  assert.doesNotMatch(immediate, /flush\(null/,
    'challenge cần người không được resolve thất bại trước khi họ kịp tương tác')
  assert.match(before, /setTimeout\(\(\) => \{[\s\S]*?flush\(null/,
    'chỉ resolve thất bại sau deadline tương tác 2 phút')
  const css = at('../index.css')
  assert.match(css, /\.ccl-turnstile-host\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/)
  assert.match(css, /\.ccl-turnstile-host\[data-interactive="true"\][^{]*\{[^}]*visibility:\s*visible[^}]*pointer-events:\s*auto/)
})

test('captcha requests được serialize để không dùng trùng token one-time', () => {
  const src = at('./spinShield.js')
  assert.match(src, /let captchaQueue = Promise\.resolve\(\)/)
  assert.match(src, /const result = captchaQueue\.then\(run, run\)/)
  assert.match(src, /CAPTCHA_RETRY_DELAY_MS = 150/)
  const loader = at('./turnstile.js')
  assert.match(loader, /}, 15000\)/, 'mobile cold-start gets time to load while remaining bounded')
  assert.match(src, /export function warmCaptcha\(/, 'có prewarm Turnstile khi mở trang spin/vote')
  assert.match(src, /export function warmFingerprint\(/, 'có thể làm ấm fingerprint khi người dùng đang chọn vote')
  assert.match(loader, /rel = 'preconnect'[\s\S]*challenges\.cloudflare\.com/,
    'mở kết nối TLS tới Cloudflare song song lúc tải API')
  const db = at('./db.js')
  assert.equal((db.match(/if \(TURNSTILE_SITE_KEY && !captchaToken\) throw appError\('err\.spinCaptcha'\)/g) || []).length, 2,
    'nếu sitekey đã bật mà không lấy được token, fail nhanh và fail-closed trước khi gọi gate')
})
