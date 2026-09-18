/* Chốt chặn KÍCH THƯỚC CHẠM của các nút NHỎ mà app cố tình để nhỏ trên desktop.
   ---------------------------------------------------------
   Scanning "mọi nút dưới 24px đều phải được nới" nghe hay nhưng KHÔNG dựng
   được thành luật tĩnh: có những control chỉ tồn tại ở bản desktop (nút thu
   sidebar `.applogo.lg-nav` — 22px, bấm bằng chuột, đã `display:none` trên
   điện thoại), và tự động nới hết là biến bảng biểu tượng thành đám ô vuông.
   Cái dựng được là **hợp đồng theo cặp**: một class đã chọn "nhỏ trên desktop,
   đủ to trên cảm ứng" thì CẢ HAI vế phải còn — vì vế mobile là thứ người ta
  删 đầu tiên khi "dọn CSS".

   Bối cảnh ra đời (quét 08/09/2026): `.toast-x` 22px là dấu × duy nhất để đóng
   toast trên điện thoại; `.followbtn` 18px là chuông ở cuối dòng meta — cả hai
   đều là control thật, không phải biểu tượng trang trí, nên đều được nới lên
   24–30px trong @media bản hẹp. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const cssFiles = walk(at('..')).filter((f) => extname(f) === '.css')
assert.ok(cssFiles.length >= 2, 'không đọc được CSS của app')

const cssRaw = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')

/* do vi tri cua moi @media de phan biet rule "ban hep" — parser regex doc rule
   ben trong media block ma mat ten @media, nen phai danh dau theo toa do. */
const spans = []
for (const m of css.matchAll(/@media[^{]*\{/g)) {
  let d = 1, i = m.index + m[0].length
  while (i < css.length && d) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++ }
  spans.push({ at: m[0].trim().replace(/\s+/g, ' ').replace(/\{$/, ''), from: m.index, to: i })
}
const rules = []
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ')
  if (sel.startsWith('@')) continue
  rules.push({ sel, body: m[2], media: (spans.find((s) => m.index >= s.from && m.index < s.to) || {}).at || null })
}
const size = (body, p) => {
  const m = body.match(new RegExp(`(?<![a-z-])${p}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`))
  return m ? parseFloat(m[1]) : null
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const forCls = (cls) => rules.filter((r) => new RegExp(`\\.${esc(cls)}(?![\\w-])`).test(r.sel))
const sizedIn = (cls, where, w, h) => forCls(cls).some((r) => (where === 'media' ? r.media : !r.media)
  && size(r.body, 'width') === w && size(r.body, 'height') === h)

/* [class, ban desktop, ban cam ung/hea hep, ly do] */
const CONTRACT = [
  ['followbtn', 18, 24, 'chuông cuối dòng meta: 18px là dấu mờ, 24px là mục tiêu chạm'],
  ['toast-x', 22, 30, 'dấu × của toast là cách DUY NHẤT để đóng nó trên điện thoại'],
]

test('cặp desktop/bản hẹp của các nút nhỏ còn nguyên', () => {
  for (const [cls, desktop, mobile, why] of CONTRACT) {
    assert.ok(sizedIn(cls, 'root', desktop, desktop),
      `.${cls} phải còn ${desktop}px ở bản desktop — ${why}`)
    assert.ok(sizedIn(cls, 'media', mobile, mobile),
      `.${cls} phải được nới lên ${mobile}px trong @media bản hẹp — thiếu vế này là ${why} bị bỏ quên`)
  }
})

test('phần nới cỡ nằm đúng trong @media bản hẹp, không phải rule thường', () => {
  /* hai vế "cam ung" phai la media query — neu viet o rule thuong thi no danh
     ngay vao ban desktop (18px -> 24px), va thu ban mobile mat kieu. */
  const mediaRules = rules.filter((r) => r.media)
  assert.ok(mediaRules.length >= 3, `không đọc được rule nào trong @media (${mediaRules.length})`)
  assert.ok(mediaRules.every((r) => /^@media\s*\(/.test(r.media)),
    `media gán cho rule không phải một khối @media: ${[...new Set(mediaRules.map((r) => r.media))].slice(0, 3).join(' | ')}`)
  assert.ok(spans.length >= 4, `chỉ thấy ${spans.length} khối @media — app có nhiều hơn`)
  for (const [, , mobile] of CONTRACT) {
    const grown = forCls(CONTRACT.find((c) => c[2] === mobile)[0]).filter((r) => r.media && size(r.body, 'width') === mobile)
    assert.ok(grown.length, `không tìm thấy rule nới ${mobile}px trong @media`)
    assert.ok(grown.every((r) => /max-width/.test(r.media)),
      `vế ${mobile}px phải nằm trong @media (max-width: …), đang ở: ${grown.map((r) => r.media).join(' | ')}`)
  }
})

test('.toast-x vẫn là control duy nhất để đóng toast (đừng xoá mà không thay đường đóng)', () => {
  const jsx = walk(at('../components')).filter((f) => extname(f) === '.jsx')
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(jsx, /className="toast-x"/, 'mất nút × rồi thì bỏ luôn hợp đồng 30px ở trên')
})
