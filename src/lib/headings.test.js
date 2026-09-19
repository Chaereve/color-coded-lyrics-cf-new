/* CẤP BẬC TIÊU ĐỀ — bài kiểm đọc mã nguồn, không dựng component.
   ---------------------------------------------------------
   Chủ dự án báo: "một số chỗ heading và nội dung chưa được phân cấp đúng".
   Đó là loại lỗi KHÔNG có triệu chứng trên màn hình: chữ vẫn hiện, chỉ có
   cấu trúc là sai — trình đọc màn hình đọc một mạch, và công cụ tìm kiếm
   không dựng được mục lục. Vì vậy nó chỉ bắt được bằng cách soi mã.

   Luật của trang, viết ra để không phải đoán lại:
     1. Mỗi màn hình có ĐÚNG MỘT h1 — tên trang (App.jsx), thanh đăng nhập
        (LoginGate.jsx) là hai màn hình khác nhau nên mỗi bên một h1.
     2. Không nhảy cóc cấp: một tệp có h3 thì phải có h2 (và nếu có h4 thì
        phải có h3…). h4 trở lên không dùng ở trang này.
     3. Tiêu đề khối phải là THẺ TIÊU ĐỀ, không phải <div class="section-title">
        — div thì không có cấp bậc nào cả.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const files = []
for (const dir of ['src', 'src/components', 'src/lib']) {
  for (const name of readdirSync(root + dir)) {
    const p = `${dir}/${name}`
    if (!/\.jsx?$/.test(name) || /\.test\.jsx?$/.test(name)) continue
    if (statSync(root + p).isFile()) files.push(p)
  }
}
const src = new Map(files.map(f => [f, readFileSync(root + f, 'utf8')]))
const count = (body, tag) => (body.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length

test('mỗi màn hình một h1, và tiêu đề trang là h1 thật', () => {
  const app = src.get('src/App.jsx')
  assert.equal(count(app, 'h1'), 1, 'App phải có đúng MỘT h1 (tên trang đang mở)')
  assert.match(app, /<h1 className="mainhead-t">\{t\(`nav\.\$\{section\}`\)\}<\/h1>/,
    'h1 phải là tên trang, và đổi theo mục đang mở')
  const gate = src.get('src/components/LoginGate.jsx')
  assert.equal(count(gate, 'h1'), 1, 'màn đăng nhập là màn hình riêng nên cũng có đúng một h1')
  const others = [...src].filter(([f, body]) => count(body, 'h1') > 0 && !['src/App.jsx', 'src/components/LoginGate.jsx'].includes(f))
  assert.deepEqual(others.map(([f]) => f), [], 'không màn hình nào khác được có h1')
})

test('không nhảy cóc cấp tiêu đề', () => {
  const bad = []
  for (const [f, body] of src) {
    const h2 = count(body, 'h2'), h3 = count(body, 'h3')
    const h4 = count(body, 'h4'), h5 = count(body, 'h5')
    if (h3 && !h2) bad.push(`${f}: có h3 mà không có h2`)
    if (h4 && !h3) bad.push(`${f}: có h4 mà không có h3`)
    /* Trang này chỉ đi tới h3: bảng quản trị h2 = mục đang mở, h3 = từng hàng.
       Xuống h4 nữa là trang có bốn cấp trong khi nội dung chỉ có ba. */
    if (h4 || h5) bad.push(`${f}: dùng tới ${h4 ? 'h4' : 'h5'} — trang chỉ có ba cấp`)
  }
  assert.deepEqual(bad, [], bad.join(' | '))
})

test('tiêu đề khối là thẻ tiêu đề, không phải div', () => {
  const bad = []
  for (const [f, body] of src) {
    for (const m of body.matchAll(/<div className="section-title"/g)) bad.push(`${f}: <div class="section-title">`)
  }
  assert.deepEqual(bad, [], `tiêu đề khối phải là h2/h3 (đang là div): ${bad.join(' | ')}`)
  /* Ít nhất một chỗ dùng thật, kẻo luật trên đúng một cách vô nghĩa. */
  const used = [...src.values()].some(body => /<h[23] className="section-title"/.test(body))
  assert.ok(used, 'không còn chỗ nào dùng .section-title trên thẻ tiêu đề — luật đang rỗng')
})

test('khối Up next có h2 cho chính nó, và từng bài bên trong là h3', () => {
  const app = src.get('src/App.jsx')
  assert.match(app, /<h2 className="lbl">/, 'tiêu đề khối Up next phải là h2')
  assert.match(app, /<h3 className="now-empty">/, 'câu "chưa chốt bài nào" cũng là tiêu đề của khối')
  assert.match(app, /<h3>\n\s*<span className="tx">/, 'tên từng bài trong khối phải là h3')
})

test('bảng quản trị có h2 cho mục đang mở và h3 cho từng hàng', () => {
  const panel = src.get('src/components/AdminPanel.jsx')
  assert.match(panel, /<h2 className="adm-h2">/, 'mục đang mở phải có h2')
  assert.match(panel, /<h3 className="adm-req-t">/, 'tên bài trong hàng phải là h3')
})
