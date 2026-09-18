/* Chốt chặn cho lối tắt chết người: quy tắc TOÀN CỤC cho "ô nhập" phải chỉ
   đúng ô nhập.
   ---------------------------------------------------------
   `input, select, textarea { width:100%; padding:7px 10px; border; background }`
   là rule hợp lệ khi app chỉ có ô text. Nhưng `input` cũng là checkbox và
   range: những thứ đó kế padding/viền/nền rồi vẽ widget 13px inside a grey box —
   `.switch input` và `.step input` chỉ kịp sửa `width: auto` nên ba cái tick
   trong ActionModal ("đây là yêu cầu trả phí"), MediaAdmin ("ẩn khỏi trang chủ")
   và 3 mốc tiến độ của AdminPanel hiện thành hộp xám to hơn chữ bên cạnh
   (người dùng gọi đúng là "lỗi tùm lum", 2026-09-08).
   Cách sửa KHÔNG phải viết thêm reset ở từng nơi (thiếu chỗ mới là hỏng lại),
   mà loại widget ra khỏi rule bằng `:where(:not(...))`. Ba điều dưới đây giữ
   cho cả hai phía: rule vẫn đúng tập, và đặc tính vẫn thấp để popover tự reset. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const css = readFileSync(at('../index.css'), 'utf8')
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const srcDir = at('..')
const jsxFiles = walk(srcDir).filter((f) => extname(f) === '.jsx' || extname(f) === '.js')
const jsx = jsxFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/* widget KHONG phai o nhap chu — danh nay phai duoc loai khoi rule hop */
const WIDGET_TYPES = ['checkbox', 'radio', 'range', 'color', 'file']

const boxRule = (() => {
  const m = [...bare.matchAll(/(input[^{]*)\{([^}]*padding:\s*7px 10px[^}]*)\}/g)]
  assert.equal(m.length, 1, `phải có ĐÚNG một rule "ô nhập" global (thấy ${m.length})`)
  return { sel: m[0][1].replace(/\s+/g, ' ').trim(), body: m[0][2] }
})()

test('rule ô nhập loại widget khỏi `input`', () => {
  assert.ok(boxRule.sel.includes(':where(:not('),
    'phải bọc `:where(:not(...))` — không thì rule global lại đánh bại mọi reset cục bộ')
  for (const t of WIDGET_TYPES) {
    assert.ok(boxRule.sel.includes(`[type="${t}"]`),
      `thiếu type="${t}" trong danh sách loại — checkbox/range sẽ ăn padding+viền của ô text`)
  }
  assert.ok(boxRule.sel.includes('[hidden]'), 'input type="file" được giấu bằng `hidden`: phải loại luôn')
})

test('mọi widget type dùng trong app đều nằm trong danh sách loại', () => {
  const used = new Set([...jsx.matchAll(/<input\b[^>]*?type="(\w+)"/g)].map((m) => m[1]))
  for (const t of used) {
    if (!WIDGET_TYPES.includes(t)) continue        // text/number/search… là ô nhập, PHẢI giữ box
    assert.ok(boxRule.sel.includes(`[type="${t}"]`),
      `JSX có <input type="${t}"> nhưng rule ô nhập chưa loại nó — thêm vào danh sách :not()`)
  }
  assert.ok(used.size >= 3, `không đọc được type nào từ JSX (được ${used.size}) — scanner hỏng rồi`)
})

test('rule focus của ô nhập dùng đúng cùng tập hợp', () => {
  const m = bare.match(/(input[^{]*:focus)[^{]*\{([^}]*)\}/)
  assert.ok(m, 'không tìm thấy rule :focus của thẻ nhập')
  assert.ok(m[1].includes(':where(:not('), '`input:focus` phải loại widget giống rule ô nhập')
  for (const t of WIDGET_TYPES) assert.ok(m[1].includes(`[type="${t}"]`), `:focus thiếu type="${t}"`)
  assert.match(m[2], /border-color:\s*var\(--a-2\)/, 'dấu focus của ô nhập là viền đổi màu')
})

/* bo TOAN BO :where( … ) ke ca long chen, dem bang can hoac — regex `[^()]*`
   khong xuyen duoc `:where(:not([type=…]))` va doan thu bang nay that bai. */
const cutWhere = (sel) => {
  let out = ''
  for (let i = 0; i < sel.length;) {
    if (sel.startsWith(':where(', i)) {
      i += ':where'.length          // chi con `(`: dem tu day moi can duoc
      let d = 0
      do { if (sel[i] === '(') d++; else if (sel[i] === ')') d--; i++ } while (i < sel.length && d)
    } else { out += sel[i]; i++ }
  }
  return out
}

test('không được nâng đặc tính rule global bằng :not trần', () => {
  /* `input:not([type=checkbox])…` = 0,6,1: cac reset cuc bo (`.nt-pref input`,
     `.qty input`) thua ngay tren san nha ma mat khong thay gi — thu bang do
     chang bao gio sang. */
  const outside = cutWhere(boxRule.sel)
  assert.ok(!outside.includes(':not('), 'chỉ được :not BÊN TRONG :where() của rule global')
  assert.equal((outside.match(/\[/g) || []).length, 0,
    'không thuộc tính nào được ngồi ngoài :where() trong selector của rule global')
})
