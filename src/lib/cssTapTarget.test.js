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

/* DANH SÁCH THỨ HAI — control VUÔNG cần nới lên cỡ chạm (khác CONTRACT ở chỗ
   vế desktop KHÔNG bị chốt số). Lý do phải tách bảng: CONTRACT đòi khớp CẢ
   width LẪN height ở cả hai vế, mà helper sizedIn() thì chỉ hợp với nút vuông;
   nhóm dưới đây chỉ cần chốt vế cảm ứng, còn bản desktop giữ đúng số cũ của
   nó để khỏi phá mật độ hàng .row (đã có test khác chốt gap/padding).
   Ngưỡng: Apple HIG 44px — repo chọn 40px cho control phụ và 44px cho điều
   hướng chính, vì nới cả loạt lên 44 sẽ đẩy hàng .row và nhãn .pv-label giãn
   ra thấy rõ trên màn 390px. */
const CONTRACT_SQUARE = [
  ['pv-add', 40, 'nút thêm video nổi bật: 20px cao là mức bấm trượt được bằng ngón cái'],
  ['sfxbtn', 40, 'nút bật/tắt âm thanh nằm cạnh nhãn trong .side-row'],
  ['side-x', 40, 'nút đóng ngăn kéo — cách duy nhất để đóng sidebar trên điện thoại'],
  ['nt-btn', 40, 'chuông thông báo, ngồi chung hàng với nút "New request" 40px'],
  ['to-top', 40, 'nút lên đầu trang nổi trên nội dung, dễ bấm lệch'],
  ['fab', 40, 'nút ☰ mở ngăn kéo: không mở được sidebar thì mất hết điều hướng'],
]
/* Control RỘNG (nút chữ): chốt theo CHIỀU CAO và bắt buộc dùng min-height,
   vì width của chúng do padding/chữ quyết định, khai cứng là vỡ bố cục. */
const CONTRACT_WIDE = [
  ['votebtn', 40, 'nút vote ở cuối mỗi dòng — hành động chính của cả trang'],
  ['tab', 40, 'nhóm tab lọc bảng: 26px là mức phải ngắm mới bấm trúng'],
  ['btn', 40, 'nút chữ dùng khắp nơi (New request · Buy votes · xác nhận modal)'],
  ['side-out', 40, 'đăng xuất: bấm nhầm thì mất phiên, nên phải có chỗ đặt tay'],
  ['side-item', 44, 'điều hướng CHÍNH trong ngăn kéo — lấy đúng ngưỡng Apple 44px'],
  ['side-cta', 44, 'nút Gửi request: hành động quan trọng nhất của app'],
]
/* vế "to lên" phải nằm trong @media bản hẹp, và phải là min-height chứ không
   phải height — height cứng trong cùng rule sẽ đè padding/nội dung co giãn. */
const minIn = (cls, where, h) => forCls(cls).some((r) => (where === 'media' ? r.media : !r.media)
  && size(r.body, 'min-height') === h)
const grownIn = (cls, h) => forCls(cls).filter((r) => r.media && size(r.body, 'min-height') === h)
const grownSq = (cls, px) => forCls(cls).filter((r) => r.media
  && size(r.body, 'width') === px && size(r.body, 'height') === px)

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

test('control vuông đã nới đủ cỡ chạm trong @media bản hẹp', () => {
  for (const [cls, px, why] of CONTRACT_SQUARE) {
    assert.ok(sizedIn(cls, 'media', px, px),
      `.${cls} phải là ${px}×${px}px trong @media bản hẹp — ${why}`)
    /* cùng lý do với vế cảm ứng của CONTRACT: viết ở rule thường là đánh thẳng
       vào bản desktop, mật độ desktop vỡ mà thử trên máy tính không thấy */
    assert.ok(grownSq(cls, px).every((r) => /max-width/.test(r.media)),
      `vế ${px}px của .${cls} phải nằm trong @media (max-width: …)`)
  }
})

test('nút chữ đạt chiều cao chạm bằng min-height trong @media bản hẹp', () => {
  for (const [cls, h, why] of CONTRACT_WIDE) {
    assert.ok(minIn(cls, 'media', h),
      `.${cls} phải có min-height: ${h}px trong @media bản hẹp — ${why}`)
    assert.ok(grownIn(cls, h).every((r) => /max-width/.test(r.media)),
      `vế ${h}px của .${cls} phải nằm trong @media (max-width: …)`)
    /* min-height + height cứng TRONG CÙNG một rule: cái sau thắng, padding
       và nội dung co giãn mất tác dụng, nút không phình ra được nữa */
    assert.ok(grownIn(cls, h).every((r) => !/(^|[;\s{])height\s*:/.test(r.body)),
      `.${cls}: rule khai min-height thì không được khai luôn height cứng`)
  }
})

test('.toast-x vẫn là control duy nhất để đóng toast (đừng xoá mà không thay đường đóng)', () => {
  const jsx = walk(at('../components')).filter((f) => extname(f) === '.jsx')
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(jsx, /className="toast-x"/, 'mất nút × rồi thì bỏ luôn hợp đồng 30px ở trên')
})
