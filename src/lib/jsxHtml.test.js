/* Chốt chặn HTML HỢP LỆ trong JSX — thứ React không phàn nàn, trình duyệt thì
   "sửa" theo cách riêng, và cây accessibility nhận damage.
   ---------------------------------------------------------
   Ba họ lỗi đã thật sự xảy ra ở app này:
   · `<div>` trong `<button>` (`.side-user` của Sidebar — avatar dự phòng) và
     `<div>` trong `<label>`: content model của button/label chỉ nhận phrasing
     content → `<span>` + `display:grid` cho kết quả giống hệt mà không phạm luật.
   · lồng control vào control: chuông/nút nhét vào trong `.grow-head` (vốn là một
     `<button>`) làm cả cụm thành DOM sai — vì vậy chuông của CỤM là ANH EM của
     đầu cụm và chiếm cột lưới thứ hai (xem cssGridRows.test.js).
   · `<button>` không `type` bên trong `<form>` → mặc định là `submit`: thêm một
     nút phụ vào form là âm thầm gửi form lúc nào không hay (nút "Gửi yêu cầu"
     giờ phải ghi `type="submit"` rành mạch thay dựa vào mặc định).
   Bộ parse ở đây tự viết theo KÝ TỰ, không phải regex trên attribute: regex
   `[^>]*` cắt nhầm ngay dấu `>` trong `onClick={() => …}`, và đó là cái bẫy đã
   làm vài lần test báo sai ở repo này. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const files = walk(at('..')).filter((f) => extname(f) === '.jsx')
assert.ok(files.length >= 20, `phải thấy các file JSX của app (thấy ${files.length})`)

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr',
  'area', 'col', 'embed', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'])
const FLOW = new Set(['div', 'p', 'ul', 'ol', 'li', 'form', 'section', 'article', 'aside', 'nav',
  'header', 'footer', 'main', 'table', 'fieldset', 'blockquote', 'pre', 'address', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label'])

/* ---------- doc markup: <tag ...>, bỏ qua moi thu trong {…} va trong chuoi ---------- */
function parse(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    let j = lt + 1
    const close = src[j] === '/'
    if (close) j++
    const nm = /^[A-Za-z][\w.-]*/.exec(src.slice(j))
    if (!nm) { i = lt + 1; continue }
    const name = nm[0]
    let k = j + name.length
    const attrStart = k
    let depth = 0
    for (; k < src.length; k++) {
      const c = src[k]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '"' || c === "'") { const q = c; k++; while (k < src.length && src[k] !== q) k++ }
      else if (depth === 0 && c === '>') break
    }
    out.push({
      name, close, self: src[k - 1] === '/' || src[k] === '/',
      attrs: src.slice(attrStart, k),
      line: src.slice(0, lt).split('\n').length,
    })
    i = k + 1
  }
  return out
}

const scan = (src) => {
  const pairs = []
  const stack = []
  const broken = []
  for (const t of parse(src)) {
    if (/^[A-Z]/.test(t.name)) continue            // component: khong mo the nao trong doan nay
    if (t.close) {
      const idx = stack.findLastIndex((x) => x.name === t.name)
      if (idx < 0) { broken.push(t) } else { stack.length = idx }
      continue
    }
    for (const open of stack) pairs.push({ open, inside: t.name, attrs: t.attrs, line: t.line })
    if (VOID.has(t.name) || t.self) continue
    stack.push(t)
  }
  return { pairs, broken, unclosed: stack }
}

const rel = (f) => f.split(/[\\/]/).slice(-2).join('/')
const scanned = files.map((f) => ({ f: rel(f), ...scan(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')) }))
const pairs = scanned.flatMap((x) => x.pairs.map((p) => ({ ...p, file: x.f })))
const where = (p) => `${p.file}:${p.line}`

test('không có khối flow bên trong <button> hoặc <label>', () => {
  const bad = pairs.filter((p) => (p.open.name === 'button' || p.open.name === 'label') && FLOW.has(p.inside))
  assert.deepEqual(bad.map(where), [],
    `<button>/<label> chỉ nhận phrasing content — đổi <div> thành <span display:block/grid>: ${bad.map(where).join(', ')}`)
})

test('không lồng control vào control', () => {
  const bad = pairs.filter((p) => (p.open.name === 'button' || p.open.name === 'a')
    && (INTERACTIVE.has(p.inside) || p.inside === 'form'))
  assert.deepEqual(bad.map(where), [],
    `nút/link lồng trong nút/link là DOM sai (chuông cụm phải là ANH EM của .grow-head): ${bad.map(where).join(', ')}`)
})

test('mọi <button> trong <form> khai type rõ ràng', () => {
  const bad = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
    let formDepth = 0
    for (const t of parse(src)) {
      if (t.name === 'form') {
        if (t.close) formDepth = Math.max(0, formDepth - 1)
        else if (!t.self) formDepth++
        continue
      }
      if (formDepth && t.name === 'button' && !t.close && !/\btype=/.test(t.attrs)) {
        bad.push(`${rel(f)}:${t.line}`)
      }
    }
  }
  assert.deepEqual(bad, [],
    `button không type trong form = type="submit" mặc định: ${bad.join(', ')}`)
})

test('<img> luôn có alt', () => {
  const bad = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const t of parse(src)) {
      if (t.name === 'img' && !/\balt=/.test(t.attrs)) bad.push(`${rel(f)}:${t.line}`)
    }
  }
  assert.deepEqual(bad, [], `img thiếu alt (kể cả ảnh trang trí thì alt=""): ${bad.join(', ')}`)
})

test('scanner đọc đúng — thẻ cân bằng, không cặp giả', () => {
  assert.ok(pairs.length > 2000, `chỉ quét được ${pairs.length} cặp thẻ — bộ parse đã hỏng`)
  const s = (x) => parse(x)
  assert.equal(s('<button onClick={() => setOpen(v => !v)}><div>x</div></button>').length, 4,
    'phải đếm đủ 4 thẻ, kể cả khi attribute chứa `=>`')
  const one = scan('<button><div>x</div></button>')
  assert.equal(one.pairs.filter((p) => p.open.name === 'button' && p.inside === 'div').length, 1)
  assert.equal(scan('<button><span>x</span></button>').pairs.filter((p) => FLOW.has(p.inside)).length, 0)
  assert.equal(scan('<button><button>y</button></button>').pairs.filter((p) => p.inside === 'button').length, 1)
  assert.equal(scan('<p>a <div>b</div></p>').pairs.filter((p) => p.open.name === 'p' && p.inside === 'div').length, 1)
  assert.equal(scan('<Foo><button><div>x</div></button></Foo>').pairs.filter((p) => p.inside === 'div').length, 1,
    'component bọc ngoài không được làm lệch stack')
  for (const x of scanned) {
    assert.equal(x.broken.length, 0, `thẻ đóng không có thẻ mở: ${x.f} </${x.broken[0]?.name}> dòng ${x.broken[0]?.line}`)
  }
})
