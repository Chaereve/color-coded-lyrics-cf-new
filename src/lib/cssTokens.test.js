/* Chốt chặn TOKEN CSS: mọi `var(--x)` phải có nơi định nghĩa — trong CSS, hoặc
   do JS gán lên chính phần tử đó.
   ---------------------------------------------------------
   Lý do có file này: `font-family: var(--body)` xuất hiện ở 3 quy tắc
   (.nt-title .artist, .nt-meta em, .standing) trong khi app chỉ định nghĩa
   --font / --mono / --display. `var()` không fallback + token vô danh =
   "guaranteed-invalid": thuộc tính rơi về GIÁ TRỊ KẾ THỪA, nên không báo lỗi gì cả
   — chữ trong hộp thông báo lặng lẽ đổi sang font của cha (artist thành font
   display, .nt-meta em thành mono) và `.standing` chỉ tình cờ đúng. Một con
   chữ typo là mất cả họ quy tắc, nên cái này phải đỏ tự động. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const files = walk(at('..'))

const cssFiles = files.filter((f) => extname(f) === '.css')
/* LOAI FILE TEST ra khoi doan duoc quay: chinh comment cua file nay co chu
   `'--pc'` va `setProperty('--x'` → scanner doc no nhu ma that, doan dung
   thanh doan sai (bay "tu khop minh" ma lan quet tu dien da din hu). */
const codeFiles = files.filter((f) => ['.jsx', '.js'].includes(extname(f)) && !/\.test\.js$/.test(f))
assert.ok(cssFiles.length >= 2, `phải thấy CSS của app, thấy ${cssFiles.length} file`)

const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/* token do JS/JSX gán: `style={{ '--sc': ... }}`, setProperty('--x', ...),
   dataset/`el.style.x` không liên quan ở đây */
const setFromJs = new Set([
  ...code.matchAll(/['"](--[a-zA-Z0-9-]+)['"]\s*:/g),
  ...code.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)/g),
].map((m) => m[1]))
const defined = new Set([...css.matchAll(/(^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[2]))
const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]))

test('mọi var() dùng trong CSS đều có nơi định nghĩa', () => {
  const dangling = [...used].filter((t) => !defined.has(t) && !setFromJs.has(t))
  assert.deepEqual(dangling, [],
    `token không ai định nghĩa (sẽ âm thầm rơi về giá trị kế thừa): ${dangling.join(', ')}`)
})

test('token định nghĩa mà không dùng là nợ, không phải tính năng', () => {
  const unused = [...defined].filter((t) => !used.has(t) && !setFromJs.has(t))
  assert.deepEqual(unused, [], `token chỉ khai báo mà chẳng dùng: ${unused.join(', ')}`)
})

test('bộ font của app là đúng ba token, không có --body', () => {
  for (const f of ['--font', '--mono', '--display']) {
    assert.ok(defined.has(f), `thiếu font token ${f}`)
    assert.ok(used.has(f), `${f} được định nghĩa nhưng không quy tắc nào dùng`)
  }
  assert.ok(!/--body\b/.test(css),
    '--body chưa từng tồn tại ở đây: dùng var(--font) cho chữ UI, var(--mono) cho số')
})

test('token do JS gán phải được CSS đọc lại', () => {
  /* Nguoc lai voi loi o tren: JSX ghi `style={{ '--pc': ... }}` cho mot thu
     CSS khong con doc nua (xay ra that voi .pay-panel cua PaymentMethods) —
     khong loi hinh anh nhung la ma tue: nguoi doc sau tin rang co mot dai mau
     dang chay, trong khi khong. Xoa ben ghi, hoang dinh nghia ben doc. */
  const unread = [...setFromJs].filter((t) => !used.has(t))
  assert.deepEqual(unread, [],
    `JS gán ${unread.join(', ')} nhưng không quy tắc CSS nào đọc var() — hoặc thêm rule, hoặc xoá prop`)
  assert.ok(setFromJs.size >= 4, `scanner phải bắt được các token JS gán (được ${setFromJs.size})`)
})
