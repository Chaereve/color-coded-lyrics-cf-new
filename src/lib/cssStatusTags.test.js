/* =========================================================
   ĐÈN TRẠNG THÁI · THẺ THỂ LOẠI · TEM PAID · HOVER NHUỘM MÉP
   ---------------------------------------------------------
   Bốn thay đổi giao diện chủ dự án chốt cùng một lượt (21/10/2026), mỗi cái
   chữa một lỗi đọc khác nhau. Bài này chốt lại đúng những vế dễ bị "sửa lại
   cho đẹp" sau này:

     1. trạng thái đọc được bằng HÌNH, không chỉ bằng màu (`s-<status>`);
     2. thẻ thể loại bỏ viền và dùng TÊN NGẮN, tên đầy đủ về `title`;
     3. tem PAID là nền vàng mờ + ngôi sao, chữ 10px — nhỏ hơn tên bài;
     4. hover nhuộm MÉP TRÁI bằng màu trạng thái, nền vẫn xám.
   ========================================================= */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const css = readFileSync(`${root}/src/index.css`, 'utf8')
const app = readFileSync(`${root}/src/App.jsx`, 'utf8')
const meta = readFileSync(`${root}/src/lib/meta.js`, 'utf8')
const admin = readFileSync(`${root}/src/components/AdminPanel.jsx`, 'utf8')

/* Bỏ chú thích trước khi soát: chính các chú thích giải thích việc đổi có nhắc
   lại tên lớp cũ, soát cả chú thích là tự bắt lỗi mình. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

const ruleOf = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = bare.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `thiếu luật ${sel}`)
  return m[1]
}

/* ---------- 1. ĐÈN TRẠNG THÁI ---------- */
test('trạng thái có hình riêng cho từng giai đoạn, không chỉ khác màu', () => {
  /* Chờ: vòng rỗng MỜ. Đã xếp hàng: vòng rỗng ĐẬM. Hai trạng thái chờ khác nhau
     ở độ đậm của cùng một hình — cố ý, vì chúng là hai bước của cùng một việc
     "chưa bắt đầu". */
  assert.match(ruleOf('.status.s-pending::before'), /background:\s*none/,
    'chờ duyệt phải là vòng rỗng, không phải chấm đặc')
  assert.match(ruleOf('.status.s-pending::before'), /border:\s*1\.5px solid color-mix/,
    'vòng chờ duyệt mờ đi để không tranh với hàng đã vào hàng')
  assert.match(ruleOf('.status.s-queued::before'), /background:\s*none/,
    'đã xếp hàng là vòng rỗng')
  assert.match(ruleOf('.status.s-queued::before'), /border:\s*1\.5px solid var\(--c/,
    'vòng của hàng đã xếp phải đậm hơn vòng chờ duyệt')
  /* Đang làm: đèn cháy. */
  assert.match(ruleOf('.status.s-in_progress::before'), /box-shadow:\s*0 0 0 3px/,
    'đang làm phải có quầng — đó là tín hiệu "đèn đang cháy"')
  /* Xong: chấm đặc + viền mảnh. */
  assert.match(ruleOf('.status.s-completed::before'), /box-shadow:\s*0 0 0 2px/,
    'xong là chấm đặc có viền mảnh, khác quầng dày của "đang làm"')
  /* Từ chối: vòng đứt. */
  assert.match(ruleOf('.status.s-denied::before'), /border:\s*1\.5px dashed/,
    'từ chối là vòng đứt nét')
  /* Đèn mặc định (chỗ dùng .status không kèm trạng thái) vẫn là chấm đặc. */
  assert.match(ruleOf('.status::before'), /border-radius:\s*50%/,
    'đèn mặc định vẫn phải là chấm tròn')
})

test('mỗi hàng gắn trạng thái vào đèn, để hình đổi theo giai đoạn', () => {
  assert.match(app, /className=\{`status s-\$\{r\.status\}`\}/,
    'dòng request phải gắn lớp s-<status>; thiếu nó thì mọi trạng thái chung một hình')
  assert.match(app, /className=\{`status s-\$\{rep\.status\}`\}/,
    'khối Up next cũng vậy — cùng một bài phải cùng một hình')
  assert.match(app, /className=\{`status s-\$\{rr\.status\}`\}/,
    'danh sách thành viên trong Up next cũng vậy')
  assert.match(admin, /status s-\$\{r\.status\}/,
    'bảng quản trị dùng cùng hợp đồng, không dựng bản riêng')
  assert.match(admin, /className="status s-denied"/,
    'nhãn "hết hạn" ở admin cũng là vòng đứt, cùng nghĩa với trạng thái bị từ chối')
})

/* ---------- 2. THẺ THỂ LOẠI ---------- */
test('thẻ thể loại: không viền, nền mờ, chữ là TÊN NGẮN', () => {
  const kind = ruleOf('.kind')
  assert.match(kind, /border:\s*0/,
    'bỏ hẳn viền: viền xám 1px + nền là hai lớp nói cùng một chuyện')
  assert.match(kind, /background:\s*color-mix\(in oklab, currentColor 13%/,
    'nền 13% một mình đủ để thẻ đọc ra là thẻ')
  /* Nhãn ngắn lấy từ KIND_META, không dựng bảng thứ hai. */
  assert.match(meta, /export const kindShort = \(k\) => KIND_META\[k\]\?\.short \|\| k/,
    'tên ngắn phải đọc từ KIND_META — bảng thứ hai là bảng sẽ lệch')
  assert.match(app, /\{kindShort\(r\.kind\)\}/, 'dòng request in tên ngắn')
  assert.match(app, /\{kindShort\(rep\.kind\)\}/, 'khối Up next in tên ngắn')
  assert.match(app, /title=\{r\.kind\}/,
    'tên đầy đủ phải còn đường đọc lại ở title — cắt mà không có title là mất thông tin')
})

/* ---------- 3. TEM PAID ---------- */
test('PAID là tem nền vàng mờ + ngôi sao, nhỏ hơn tên bài', () => {
  const gold = ruleOf('.pill.gold')
  assert.match(gold, /border:\s*0/, 'bỏ viền vàng 40% — nó na ná viền xám của thẻ thể loại')
  assert.match(gold, /background:\s*color-mix\(in oklab, var\(--paid\) 14%/,
    'nền vàng 14% ăn khớp với nền vàng 4,5% của cả hàng PAID')
  assert.match(gold, /font-size:\s*10px/,
    'tem nhỏ hơn thang nhãn chung (11px) — nó là tem, không phải tiêu đề')
  assert.match(gold, /text-transform:\s*uppercase/, 'tem in hoa')
  assert.match(bare, /\.pill\.gold::before \{[^}]*content:\s*'★'/,
    'ngôi sao đứng trước chữ PAID — một ký hiệu nói "bài đặc biệt" mà không cần đọc chữ')
  assert.match(bare, /\.now-members \.pill\.gold::before \{[^}]*font-size:\s*7px/,
    'tem PAID trong danh sách thành viên bé hơn, nên sao cũng phải bé theo')
})

/* ---------- 4. HOVER NHUỘM MÉP ---------- */
test('hover nhuộm MÉP TRÁI bằng màu trạng thái, nền vẫn xám', () => {
  const hov = ruleOf('.row:hover')
  assert.match(hov, /linear-gradient\(90deg/,
    'ánh màu mép trái là gradient ngang duy nhất của hàng, chỉ tồn tại khi rê chuột')
  assert.match(hov, /var\(--sc, var\(--a\)\)/,
    'màu lấy từ --sc: mỗi hàng nhuộm theo trạng thái của chính nó')
  assert.match(hov, /transparent 190px/,
    'ánh màu phải tan hết trong 190px — phủ cả hàng là đổi nền, không phải nhuộm mép')
  assert.match(hov, /var\(--hover\)/,
    'nền xám hover giữ nguyên; nếu thay hẳn bằng màu trạng thái thì hàng đổi "chất liệu"')
  /* Hàng PAID giữ danh tính vàng của nó, màu trạng thái chỉ pha vào ánh mép. */
  const paid = ruleOf('.row.paid:hover')
  assert.match(paid, /rgba\(215,166,63,\.075\)/,
    'hàng PAID khi rê vẫn là nền vàng — màu trạng thái không được thay nó')
  assert.match(paid, /linear-gradient\(90deg/,
    'nhưng vẫn có ánh mép trái')
  /* Bản hẹp: ánh màu ngắn lại, không phủ quá nửa hàng trên màn 360px. */
  /* Bản hẹp: ánh màu ngắn lại, không phủ quá nửa hàng trên màn 360px.
     Có HAI khối 560px trong tệp, nên soát theo nội dung chứ không theo khối:
     chỉ cần một `.row:hover` khai lại với 120px là đủ. */
  assert.match(bare, /transparent 120px\)\s*,\s*var\(--hover\)/,
    'màn hẹp phải thu ánh màu về 120px (và vẫn giữ nền xám hover)')
})
