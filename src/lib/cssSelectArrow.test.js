/* Mui ten cua <select> phai la thu TỰ VẼ, không phải do browser vẽ.
   ---------------------------------------------------------
   Người dùng báo: mũi tên ở ô "All types" trông lệch ra ngoài một xíu. Nguyên
   nhân là mui do trình duyệt sơn sát mép phải của hop, đúng vùng bo gop
   (`border-radius`) — mỗi browser mỗi đặt, không canh được. Chốt lại bằng văn
   bản để ai "dọn CSS" không vô tình trả về mui mặc định rồi làm lỗi quay lại.
   Xem thêm cssNotifyPitch.test.js / cssGridRows.test.js. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

const ruleFor = (sel) => {
  const all = [...bare.matchAll(new RegExp(`(^|\\})\\s*${sel}\\s*\\{([^}]*)\\}`, 'g'))]
  assert.ok(all.length, `không tìm thấy quy tắc CSS cho ${sel}`)
  return all[all.length - 1][2]   // quy tắc CUỐI thắng về độ ưu tiên bằng nhau
}

test('select tự vẽ mui, có chỗ chừa ra cho nó', () => {
  const r = ruleFor('select')
  assert.match(r, /appearance:\s*none/, 'phải tắt mui mặc định của browser')
  assert.match(r, /background-image:\s*url\(/, 'mui phải là SVG nền, không trông chờ browser')
  assert.match(r, /background-position:\s*right\s+\d+px\s+center/, 'mui neo theo mép phải, không theo mép hop')
  assert.match(r, /padding-right:\s*(\d+)px/, 'chữ phải chừa chỗ cho mui')
  assert.ok(Number(r.match(/padding-right:\s*(\d+)px/)[1]) >= 24,
    'padding-right phải >= 24px để mui 13px + khoảng lùi còn thừa chỗ')
})

test('không có quy tắc nào SAU đó ghi đè background của select bằng shorthand', () => {
  /* `background: <màu>` là shorthand — kẻ nào viết lại nó sau quy tắc mui là
     xoá luôn background-image, và lỗi sẽ quay về đúng lúc không ai ngờ. */
  const iArrow = bare.search(/(^|\})\s*select\s*\{[^}]*background-image/)
  const later = [...bare.matchAll(/(^|\})\s*([^{}]*\\bselect\\b[^{}]*)\{([^}]*)\}/g)]
    .filter(m => m.index > iArrow && /\bbackground:\s*[^;]*;/.test(m[3]) && !/background-image/.test(m[3]))
  assert.deepEqual(later.map(m => m[2].trim()), [],
    'những quy tắc này đã dùng shorthand `background` sau quy tắc mui — mui sẽ biến mất')
})
