/* Soát HAI CHIỀU của sợi dây nối giữa chỗ dựng component và chỗ nó khai báo prop.
   ---------------------------------------------------------
   Vì sao file này tồn tại: bug "mở New request ra màn hình đen" (commit de72589)
   là `RequestTab` được truyền `live={live}` trong khi `ActionModal` quên khai báo
   `live` — biến tự do, nên build ✓ lint ✓ test từng component riêng ✓ đều im
   lặng, chỉ chết lúc chạy. Chiều ngược lại cũng chết lặng không kém: truyền một
   prop không ai đọc thì nút bấm vẫn hiện nhưng vô dụng (kiểu `onBrowse` viết lệch
   tên), và khai prop mà chẳng call site nào truyền thì thành dây đứt nằm im
   (`ActionModal` từng nhận `paidDefault` như vậy — đã xoá khi phát hiện).

   Cách làm: đọc văn bản nguồn, không cần trình duyệt. Với mỗi component có default
   export trong src/components: (1) prop BẮT BUỘC (khai báo không có giá trị mặc
   định) phải có mặt ở mọi `<Tên ...>`; (2) mọi attribute truyền vào phải nằm
   trong danh sách khai báo. Nơi nào dùng `{...spread}` thì bỏ qua — đoán spread
   bằng regex là tự dối mình.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (p) => fileURLToPath(new URL(p, import.meta.url))
const SRC = at('../../')   /* thu muc goc repo, tinh tu src/lib/ */
const files = []
for (const d of ['src', 'src/components', 'src/lib']) {
  for (const f of readdirSync(SRC + d)) if (/\.(jsx|js)$/.test(f) && !f.endsWith('.test.js')) files.push(`${d}/${f}`)
}
const read = (f) => readFileSync(SRC + f, 'utf8')

/* Những thứ React tự xử lý, không phải prop của component */
const REACT_OWN = new Set(['key', 'ref', 'children', 'dangerouslySetInnerHTML'])

/* Đóng mở thẻ JSX: trả về index của dấu '>' kết thúc, bỏ qua '>' nằm trong
   { } và trong chuỗi — `onClick={() => x()}` đầy '>' mà. */
function tagEnd(src, i) {
  let depth = 0, q = null
  for (let k = i; k < src.length; k++) {
    const c = src[k]
    if (q) { if (c === '\\') k++; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === '>' && depth === 0) return k
  }
  return -1
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

/* Tách danh sách theo dấu phẩy ở độ sâu 0 (nested `{ a, b }` không tính) */
function splitTop(raw) {
  const out = []
  let depth = 0, cur = ''
  for (const c of raw) {
    if ('{(['.includes(c)) depth++
    if ('})]'.includes(c)) depth--
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(x => x.trim()).filter(Boolean)
}

/* Tách attribute của một thẻ JSX: trả về { names:Set, spread:bool } */
function attrsOf(attrs) {
  const names = new Set()
  let depth = 0, q = null, chunk = ''
  const chunks = []
  for (let k = 0; k < attrs.length; k++) {
    const c = attrs[k]
    if (q) { chunk += c; if (c === '\\') chunk += attrs[++k] ?? ''; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; chunk += c; continue }
    if ('{(['.includes(c)) depth++
    if ('})]'.includes(c)) depth--
    if (depth === 0 && /\s/.test(c)) { chunks.push(chunk); chunk = ''; continue }
    chunk += c
  }
  chunks.push(chunk)
  for (const ch of chunks) {
    const mm = ch.match(/^([A-Za-z_$][\w$]*)/)
    if (mm) names.add(mm[1])       /* `open` trần (boolean shorthand) cũng là đã truyền */
  }
  return { names, spread: attrs.includes('{...') }
}

/* --- khai báo prop của từng component --- */
const decl = new Map()
for (const f of files) {
  if (!f.startsWith('src/components/')) continue
  const src = read(f)
  const m = src.match(/export default function\s+([A-Z]\w*)\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\{/)
  if (!m) continue                    // không destructuring props -> không có gì để đòi
  /* Phai bo ghi chu TRUOC khi tach danh sach prop: ActionModal ghi ly do cua
     prop `live` ngay trong danh sach do, va dau phay trong ghi chu se cat ngat
     ten prop — khong tach thi mat `live`, dung lai cai lo file nay sinh ra. */
  const parts = splitTop(m[2].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\/\/.*$/gm, ' '))
  const all = new Set()
  const req = new Set()
  for (const p of parts) {
    const clean = p.trim()
    const name = clean.replace(/^\.\.\./, '').split(/[:=]/)[0].trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue
    all.add(name)
    if (!clean.startsWith('...') && !clean.includes('=') && name !== 'children') req.add(name)
  }
  decl.set(m[1], { all, req, rest: parts.some(p => p.startsWith('...')), where: `${f}:${lineOf(src, m.index)}` })
}

test('soát được mặt trận: đủ component và mỗi cái có prop để đòi', () => {
  assert.ok(decl.size >= 12, `chỉ đọc được ${decl.size} component — regex hỏng rồi`)
  let withProps = 0
  for (const v of decl.values()) if (v.all.size) withProps++
  assert.ok(withProps >= 8, `chỉ ${withProps} component có props — regex parse hỏng`)
})

const missing = []
const extra = []
const unused = []
for (const [name, info] of decl) {
  let uses = 0
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g'))) {
      const end = tagEnd(src, m.index)
      if (end < 0) continue
      uses++
      const { names, spread } = attrsOf(src.slice(m.index + name.length + 1, end))
      if (spread) continue            // có rest-spread: không đoán được
      const site = `${f}:${lineOf(src, m.index)}`
      if (!info.rest) for (const k of info.req) if (!names.has(k)) missing.push(`${name} (${info.where}) — <${name}> tại ${site} không truyền prop bắt buộc \`${k}\``)
      for (const k of names) {
        if (REACT_OWN.has(k) || info.all.has(k)) continue
        extra.push(`<${name}> tại ${site} truyền \`${k}\` nhưng ${name} không khai báo prop đó`)
      }
    }
  }
  if (uses === 0) unused.push(name)
}

test('không chỗ nào dựng component mà thiếu prop bắt buộc', () => {
  assert.deepEqual(missing, [], 'nối prop thiếu:\n' + missing.join('\n'))
})

test('không chỗ nào truyền prop mà component không đọc (dây đứt, nút chết)', () => {
  assert.deepEqual(extra, [], 'prop không ai nhận:\n' + extra.join('\n'))
})

/* Component không ai dựng = code chết nằm lại trong bundle. KHÔNG làm đỏ test:
   một số file được lazy-import rồi render bằng biến nên regex không thấy. */
test('ghi chú: component không tìm thấy <Name/> trong nguồn', () => {
  if (unused.length) console.log('# (info) không thấy JSX dựng: ' + unused.join(', '))
  assert.ok(true)
})
