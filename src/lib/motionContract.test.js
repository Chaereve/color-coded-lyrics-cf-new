/* Chốt motion có chủ đích, bắt nguồn từ checklist ECC make-interfaces-feel-better:
   icon swap chỉ cross-fade opacity; press state có phạm vi; reduced-motion không bị quên.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const css = read('../index.css').replace(/\/\*[\s\S]*?\*\//g, '')

test('chuông và âm thanh giữ hai icon chồng nhau để cross-fade', () => {
  const follow = read('../components/FollowBtn.jsx')
  const sound = read('../components/SoundToggle.jsx')
  assert.match(follow, /name="bell"[\s\S]*crossfade-off[\s\S]*name="bellOn"[\s\S]*crossfade-on/)
  assert.match(sound, /name="mute"[\s\S]*crossfade-off[\s\S]*name="sound"[\s\S]*crossfade-on/)
  assert.match(css, /\.icon-crossfade\s*\{[^}]*display:\s*inline-grid/)
  assert.match(css, /\.icon-crossfade\s*>\s*svg\s*\{[^}]*transition:\s*opacity\s+150ms/)
  assert.match(css, /\.followbtn\.on\s+\.icon-crossfade\s+\.crossfade-on[^}]*opacity:\s*1/)
  assert.match(css, /\.sfxbtn\[aria-pressed="true"\]\s+\.icon-crossfade\s+\.crossfade-on[^}]*opacity:\s*1/)
})

test('nút chính VoteModal + form có press state nhẹ, phạm vi không lan ra CTA khác', () => {
  assert.match(css, /\.vote-overlay\s+\.prof-acts\s+\.btn-primary:active:not\(:disabled\)/)
  assert.match(css, /\.modal\s+form\s+\.btn-primary:active:not\(:disabled\)/)
  assert.match(css, /\.modal\s+form\s+\.btn-gold:active:not\(:disabled\)/,
    'nút gửi paid request cũng dùng press state')
  assert.match(css, /\.modal\s+form\s+\.btn-primary:active:not\(:disabled\)[\s\S]*?transform:\s*scale\(\.98\)/)
})

test('reduced motion tắt transition toàn cục', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?transition-duration:\s*\.001ms\s*!important/)
})
