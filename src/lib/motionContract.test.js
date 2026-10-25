/* Chốt motion có chủ đích, bắt nguồn từ checklist ECC make-interfaces-feel-better:
   icon swap chỉ cross-fade opacity; press state có phạm vi; reduced-motion không bị quên.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const css = read('../index.css').replace(/\/\*[\s\S]*?\*\//g, '')

/* Nút âm thanh là chỗ DUY NHẤT còn cross-fade icon sau khi chuông theo dõi bị
   gỡ. Giữ hợp đồng ở đúng một chỗ: hai icon chồng trong một ô lưới, đổi trạng
   thái chỉ là một phép mờ opacity — không phải thay phần tử nên hình không
   nhảy, và không animate layout. */
test('nút âm thanh giữ hai icon chồng nhau để cross-fade', () => {
  const sound = read('../components/SoundToggle.jsx')
  assert.match(sound, /name="mute"[\s\S]*crossfade-off[\s\S]*name="sound"[\s\S]*crossfade-on/)
  assert.match(css, /\.icon-crossfade\s*\{[^}]*display:\s*inline-grid/)
  assert.match(css, /\.icon-crossfade\s*>\s*svg\s*\{[^}]*transition:\s*opacity\s+150ms/)
  assert.match(css, /\.sfxbtn\[aria-pressed="true"\]\s+\.icon-crossfade\s+\.crossfade-on[^}]*opacity:\s*1/)
})

test('nút chính VoteModal + form có press state nhẹ, phạm vi không lan ra CTA khác', () => {
  assert.match(css, /\.vote-overlay\s+\.prof-acts\s+\.btn-primary:active:not\(:disabled\)/)
  assert.match(css, /\.modal\s+form\s+\.btn-primary:active:not\(:disabled\)/)
  assert.match(css, /\.modal\s+form\s+\.btn-gold:active:not\(:disabled\)/,
    'nút gửi paid request cũng dùng press state')
  assert.match(css, /\.modal\s+form\s+\.btn-primary:active:not\(:disabled\)[\s\S]*?transform:\s*scale\(\.98\)/)
})

test('sidebar giữ animation kích thước desktop và trượt mobile, không bị transition filter ghi đè', () => {
  assert.match(css, /--t-side:\s*\.5s/, 'sidebar dùng nhịp dài hơn, dịu hơn')
  assert.match(css, /@media\s*\(min-width:\s*900px\)\s*\{\s*\.side\s*\{\s*transition:\s*width var\(--t-side\) var\(--e-out\), filter/,
    'desktop vẫn animate bề rộng sidebar cùng easing')
  assert.match(css, /@media\s*\(max-width:\s*899px\)\s*\{\s*\.side\s*\{\s*transition:\s*transform var\(--t-side\) var\(--e-out\),\s*visibility 0s linear var\(--t-side\), filter/,
    'mobile drawer trượt vào và chỉ hiện sau khi đóng xong')
  assert.match(css, /\.side\.open\s*\{\s*transition:\s*transform var\(--t-side\) var\(--e-out\), visibility 0s, filter/,
    'khi mở, drawer hiện ngay trong lúc trượt')
})

test('reduced motion tắt transition toàn cục', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?transition-duration:\s*\.001ms\s*!important/)
})
