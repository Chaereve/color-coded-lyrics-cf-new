/* Chốt chặn TỪ ĐIỂN: không một dòng chữ nào của app được in thô ra màn hình.
   ---------------------------------------------------------
   `t` ở đây là `S[key] ?? key` — thiếu key là NGUYÊN VĂN `err.banned` hiện lên
   toast, thiếu biến là `in {m} minutes` hiện nguyên dấu ngoặc. Cả hai đều vô
   hình với test render (chúng vẫn là chuỗi hợp lệ) và chỉ người dùng nhìn thấy,
   nên phải chốt bằng văn bản:
   1) không có key khai báo hai lần (khai sau đè khai trước, im lặng);
   2) mọi `t('literal')` phải có thật trong từ điển;
   3) mọi chỗ trống `{x}` trong bản dịch phải được chính nơi gọi truyền lên;
   4) mọi mã `err.*` mà SQL/RPC raise phải có bản dịch — kể cả khi ai đó bỏ
      comment khối `supabase/audit/fraud-detection.sql` (đang nhắc thêm
      `err.banned`: bật lên là test này bảo việc phải làm).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const repo = at('../..')
const walk = (dir) => {
  let out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue
      out = out.concat(walk(join(dir, e.name)))
    } else out.push(join(dir, e.name))
  }
  return out
}

/* ---------- đọc từ điển: cắt khối `const S = { ... }` bằng cân bằng ngoặc ---------- */
const dictSrc = readFileSync(at('./i18n.jsx'), 'utf8')
const start = dictSrc.indexOf('const S = {')
assert.ok(start >= 0, 'không tìm thấy `const S = {` trong i18n.jsx')
let end = start, depth = 0
for (let i = dictSrc.indexOf('{', start); i < dictSrc.length; i++) {
  if (dictSrc[i] === '{') depth++
  else if (dictSrc[i] === '}') { depth--; if (!depth) { end = i; break } }
}
const body = dictSrc.slice(start, end + 1)

const decls = [...body.matchAll(/^\s*'([A-Za-z0-9_.]+)'\s*:/gm)]
const DICT = new Map()
decls.forEach((m, idx) => {
  const stop = idx + 1 < decls.length ? decls[idx + 1].index : body.length
  DICT.set(m[1], body.slice(m.index + m[0].length, stop))
})

const codeFiles = walk(at('..')).filter((f) => ['.jsx', '.js'].includes(extname(f)) && !/\.test\.js$/.test(f))
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')      // comment khoi: chua vi du `t('x')`
  .replace(/{\/\*[^]*?\*\/}/g, ' ')         // comment trong JSX {*/ ... /*}
  .replace(/\/\/[^\n]*/g, ' ')              // comment den het dong
const sqlFiles = existsSync(join(repo, 'supabase'))
  ? walk(join(repo, 'supabase')).filter((f) => extname(f) === '.sql') : []
assert.ok(sqlFiles.length >= 1, 'phải quét được supabase/*.sql (thư mục đã đổi tên?)')
const stripSql = (s) => s.replace(/--.*$/gm, ' ')

test('từ điển không có key khai báo hai lần', () => {
  const seen = new Map()
  for (const m of decls) seen.set(m[1], (seen.get(m[1]) || 0) + 1)
  const dup = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`)
  assert.deepEqual(dup, [], 'khai trùng là bản sau đè bản trước mà không báo gì')
  assert.ok(DICT.size > 400, `phải đọc được toàn bộ từ điển (được ${DICT.size})`)
})

test('mọi t(\'literal\') đều có bản dịch', () => {
  const miss = []
  for (const f of codeFiles) {
    if (f.endsWith('i18n.jsx')) continue
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+)'/g)) {
      if (!DICT.has(m[1])) miss.push(`${m[1]} (${f.replace(repo, 'src').replace(/\\/g, '/')})`)
    }
  }
  assert.deepEqual(miss, [], `key không tồn tại -> in thô ra UI: ${miss.join(', ')}`)
})

test('mọi chỗ trống {x} được nơi gọi truyền đủ', () => {
  const bad = []
  for (const f of codeFiles) {
    if (f.endsWith('i18n.jsx')) continue
    const s = strip(readFileSync(f, 'utf8'))
    /* dem ngoac thay vi regex: `t('k', { n: f(a, { b }) })` co dau `{` long */
    for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+)'\s*,\s*\{/g)) {
      const key = m[1]
      let i = s.indexOf('{', m.index + m[0].length - 1)
      let d = 0, j = i
      for (; j < s.length; j++) {
        if (s[j] === '{') d++
        else if (s[j] === '}') { d--; if (!d) break }
      }
      const vars = s.slice(i + 1, j)
      if (vars.includes('[')) continue                 // khoa dong: khong kiem duoc tinh
      /* tach theo dau phay roi lay phan truC `:` — dung regex
         `(?:^|,)x(?:,|$)` la MAT bi chen ke: match dau tieu luon dau `,` cua
         phan tu truoc nen bi le nhu `h` trong `{ d, h, m }` bo sot. */
      const given = new Set(vars.split(',')
        .map((x) => x.split(':')[0].trim())
        .filter((x) => /^[A-Za-z0-9_$]+$/.test(x)))
      for (const ph of (DICT.get(key) || '').matchAll(/\{(\w+)\}/g)) {
        if (!given.has(ph[1])) bad.push(`${key}: cần {${ph[1]}} (${f.replace(repo, 'src').replace(/\\/g, '/')})`)
      }
    }
  }
  assert.deepEqual(bad, [], `bản dịch sẽ hiện nguyên "{x}": ${bad.join('; ')}`)
})

test('mỗi mã lỗi SQL/RPC raise đều có bản dịch', () => {
  const codes = new Set()
  for (const f of sqlFiles) {
    for (const m of stripSql(readFileSync(f, 'utf8')).matchAll(/'(err\.[a-zA-Z0-9]+)'/g)) codes.add(m[1])
  }
  for (const f of codeFiles) {
    const s = strip(readFileSync(f, 'utf8'))
    for (const m of s.matchAll(/['"](err\.[a-zA-Z0-9]+)['"]/g)) codes.add(m[1])
  }
  assert.ok(codes.size >= 20, `phải gom được các mã err.* (được ${codes.size})`)
  const miss = [...codes].filter((k) => !DICT.has(k)).sort()
  assert.deepEqual(miss, [], `raise mà từ điển không có -> người dùng thấy nguyên "err.x": ${miss.join(', ')}`)
})

test('họ key ghép động còn nguyên (nt.tag.*, status.*, filter.*, nav.*)', () => {
  /* JSX goi `t(\`nt.tag.${type}\`)` — xoa ca mot ho thi khong loi cu the nao
     ca, chi la moi loai thong bao mat nhan. Do bang so luong toi thieu. */
  for (const fam of ['nt.tag.', 'nt.n.', 'nt.grp.', 'status.', 'filter.', 'nav.', 'rank.sort.']) {
    const n = [...DICT.keys()].filter((k) => k.startsWith(fam)).length
    assert.ok(n >= 3, `họ "${fam}*" chỉ còn ${n} key — JSX vẫn ghép động vào họ này`)
  }
})
