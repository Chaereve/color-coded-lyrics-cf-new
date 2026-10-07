/* CHỐT CHẶN CHUỖI THÔ — không câu tiếng Anh nào được viết thẳng trong mã.
   ---------------------------------------------------------
   Vì sao cần: `t('...')` thiếu bản dịch thì `i18nKeys.test.js` bắt được, nhưng
   một câu viết thẳng trong JSX (`<b>First request</b>`) thì KHÔNG bài kiểm tra
   nào bắt được — nó vẫn là chuỗi hợp lệ, vẫn render đúng, và chỉ lộ ra khi có
   người đi tìm chữ để sửa. Đó đúng là chuyện đã xảy ra với cả trang cá nhân
   công khai: 18 câu tiếng Anh nằm rải trong JSX, sửa từ điển không đụng tới
   chúng, và ba chỗ cùng nói "Community member" theo ba cách khác nhau.

   Cách chốt: quét mọi literal trong `src/**` (bỏ tệp test và chính từ điển —
   `i18n.jsx` + `strings.js`),
   giữ lại những chuỗi TRÔNG NHƯ CÂU người đọc (bắt đầu bằng chữ hoa, có
   khoảng trắng, có chữ thường, không phải tên class / URL / mã màu / đường dẫn
   SVG), rồi đòi: hoặc câu đó nằm trong từ điển (tức đã qua `t(...)`), hoặc có
   tên trong DANH SÁCH MIỄN TRỪ dưới đây kèm lý do.

   Danh sách miễn trừ là chỗ để nói "biết rồi, cố ý": mỗi mục phải kèm lý do,
   phải CÒN THẬT trong tệp (mục rác bị bắt), và tổng số mục bị chặn trần — một
   danh sách miễn trừ dài dần là cách chốt chặn tự tắt tiếng.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('..', import.meta.url))

/* ---------- miễn trừ theo TỆP (cả tệp là dữ liệu, không phải chữ của giao diện) ---------- */
const ALLOW_FILE = new Map([
  ['lib/db.js', 'chế độ demo: seed bài hát / nghệ sĩ / tên loại bài là DỮ LIỆU hiển thị '
    + '(như tiêu đề bài hát), không phải chữ của giao diện; mã lỗi ở đây đã là khoá err.*'],
])

/* ---------- miễn trừ theo TỪNG CÂU ---------- */
const ALLOW_LITERAL = new Map([
])
const ALLOW_LITERAL_LIMIT = 20

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

/* Bỏ comment trước khi quét: ví dụ trong comment (`<b>First request</b>`) không
   phải chữ hiển thị, và ví dụ trong tài liệu thì phải được phép viết. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/([^:'"`\\])\/\/[^\n]*/g, '$1 ')

/* "Trông như câu người đọc" — cố ý hẹp để không bắt oan:
     · bắt đầu bằng chữ HOA và có khoảng trắng  (Class name thì thường viết thường);
     · có ít nhất một từ ≥2 chữ thường         ("So vote" qua, "M14 31 3" không);
     · không có chữ-số dính nhau               (đường dẫn SVG: M14, 7.2Q1.2);
     · không có ký tự của mã                   (<>{} \ = $ { =>, .js, px, rgba()).
   Mỗi từ phải là chữ thường/hoa/số có thể kèm dấu câu — URL và đường dẫn bị loại. */
const looksLikeSentence = (v) => {
  if (v.length < 4) return false
  if (!/^[A-Z]/.test(v)) return false
  if (!/\s/.test(v)) return false
  if (/[A-Za-z]\d/.test(v)) return false
  if (/[<>{}]|\\/.test(v)) return false
  if (/(https?:|@|\$\{|=>|\.js\b|px\b|rem\b|base64|rgba?\()/.test(v)) return false
  if (!/(^|\s)[a-z]{2}/.test(v)) return false
  return v.split(' ').every((w) => /^[A-Za-z0-9][A-Za-z0-9'’,.;:!?…%\-—]*$/.test(w))
}

const FILES = walk(srcDir).filter((f) =>
  ['.js', '.jsx'].includes(extname(f))
  && !/\.test\.js$/.test(f)
  && !f.endsWith('i18n.jsx') && !f.endsWith('strings.js')   // chính từ điển
  && !ALLOW_FILE.has(relative(srcDir, f)))         // tệp đã miễn trừ cả tệp

const scan = () => {
  const hits = []
  for (const f of FILES) {
    const key = relative(srcDir, f)
    const allowed = new Set(ALLOW_LITERAL.get(key)?.values || [])
    const src = strip(readFileSync(f, 'utf8'))
    for (const m of [...src.matchAll(/'(?:[^'\\\n]|\\.)*'/g), ...src.matchAll(/"(?:[^"\\\n]|\\.)*"/g)]) {
      const v = m[0].slice(1, -1)
      if (looksLikeSentence(v) && !allowed.has(v)) hits.push(`${key}: ${JSON.stringify(v)}`)
    }
  }
  return hits
}

test('không còn câu nào viết thẳng trong mã (trừ danh sách miễn trừ)', () => {
  assert.ok(FILES.length >= 60, `phải quét được mã nguồn (được ${FILES.length} tệp)`)
  const hits = scan()
  assert.deepEqual(hits, [], `câu này phải nằm trong từ điển (src/lib/strings.js) và đi qua t(...):\n  ${hits.join('\n  ')}`)
})

test('danh sách miễn trừ: mục phải còn thật, và không được dài thêm vô tội vạ', () => {
  for (const [key, { values }] of ALLOW_LITERAL) {
    const src = strip(readFileSync(join(srcDir, key), 'utf8'))
    const stale = values.filter((v) => !src.includes(`'${v}'`) && !src.includes(`"${v}"`))
    assert.deepEqual(stale, [], `${key}: miễn trừ đã hết giá trị, gỡ khỏi danh sách: ${stale.join(', ')}`)
  }
  for (const key of ALLOW_FILE.keys()) {
    assert.ok(FILES.length >= 1)
    assert.ok(walk(srcDir).some((f) => relative(srcDir, f) === key), `miễn trừ cả tệp ${key} nhưng tệp không còn`)
  }
  const total = [...ALLOW_LITERAL.values()].reduce((n, e) => n + e.values.length, 0)
  assert.ok(total <= ALLOW_LITERAL_LIMIT,
    `danh sách miễn trừ đang có ${total} mục (trần ${ALLOW_LITERAL_LIMIT}) — câu mới thì dịch, đừng thêm vào đây`)
  /* Mỗi mục phải có lý do thật, không phải chỗ trống. */
  for (const [key, { why }] of ALLOW_LITERAL) {
    assert.ok(why && why.length > 30, `${key}: miễn trừ phải kèm lý do viết ra được`)
  }
})
