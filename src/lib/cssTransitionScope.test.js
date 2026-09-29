/* Chốt chặn PHẠM VI CHUYỂN ĐỘNG: không `transition: all`, không `will-change: all`.
   ---------------------------------------------------------
   Lý do có file này: `transition: all` hẹn giờ cho MỌI thuộc tính — kể cả những
   thuộc tính layout (`width`, `height`, `padding`) mà lẽ ra không được động tới.
   Một hover vô hại thêm `box-shadow` là cả trang phải tính lại layout; nặng hơn,
   khi ai đó sau này thêm một thuộc tính mới vào rule, `transition: all` âm thầm
   "nhận" luôn nó mà không ai phải sửa một dòng nào — lỗi chuyển động mới mọc
   ngược về đây từ chính những lần bảo trì vô tội. Luật của dự án (DESIGN.md §3,
   tinh thần `make-interfaces-feel-better`): liệt kê đúng thuộc tính đổi, và
   `will-change` cũng vậy — chỉ khai cho transform/opacity/filter.

   Quét mọi file .css, BỎ QUA COMMENT trước khi quét: chú thích giải thích
   "từng có transition: all" là tài liệu, không phải code. Chạy: npm test */
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

const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/* giá trị của mọi khai báo transition / transition-property / will-change */
const declValues = (prop) => [...css.matchAll(
  new RegExp(`(?<![a-z-])${prop}\\s*:\\s*([^;}]+)`, 'g'))].map((m) => ({
  value: m[1].trim().toLowerCase().replace(/\s+/g, ' '),
  where: m[0].replace(/\s+/g, ' ').slice(0, 80),
}))

test('không transition: all ở bất kỳ đâu — liệt kê đúng thuộc tính đang đổi', () => {
  const bad = declValues('transition').filter((d) => /\ball\b/.test(d.value))
  assert.deepEqual(bad.map((d) => d.where), [],
    'transition: all khiến mọi thuộc tính (kể cả layout) phải tính lại — ' +
    'khai riêng từng thuộc tính theo mẫu: background var(--t-1) var(--e-soft)')
})

test('không transition-property: all', () => {
  const bad = declValues('transition-property').filter((d) => /\ball\b/.test(d.value))
  assert.deepEqual(bad.map((d) => d.where), [],
    'transition-property: all cùng tội với transition: all')
})

test('không will-change: all — và không ghi quá 3 thuộc tính', () => {
  const all = declValues('will-change').filter((d) => /\ball\b/.test(d.value))
  assert.deepEqual(all.map((d) => d.where), [],
    'will-change: all giữ mọi lớp trong bộ nhớ GPU vô hạn hạn')
  const crowded = declValues('will-change').filter((d) => d.value.split(',').length > 3)
  assert.deepEqual(crowded.map((d) => d.where), [],
    'will-change quá 3 thuộc tính là khai sinh lớp cho gần như cả trang')
})
