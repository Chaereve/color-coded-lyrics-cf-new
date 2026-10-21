/* Chốt chặn TĨNH cho bố cục hàng / cụm bài: những lỗi mắt người dùng thấy còn
   tool thì không ("lệch tí, thấy mà không đo được"), và những lần ai đó "đơn
   giản hoá" làm quay lại đúng cái thiết kế đã bị phản đối.
   ---------------------------------------------------------
   Bốn điều ở đây đều do người dùng chỉ ra bằng ảnh chụp:
   1) CỘT PHIẾU BÊN PHẢI của hàng request (phương án F) — bốn vế: hàng giãn
      hết chiều cao, đệm dọc dời về phần chữ, vách ngăn là `border-left` của
      cột, số phiếu là chữ lớn. Thiếu vế nào là quay lại nút vote lơ lửng.
   2) NÚT NGHE là hành động duy nhất của hàng, nên nó phải đọc ra là một nút
      (viền + nền + mũi play màu nhấn) và phải KHÔNG đội dòng tiêu đề lên —
      hộp 24px đứng trong dòng chữ 17px mà không bù lề là chữ trôi lên trên,
      đúng hiện tượng "chữ chưa ở giữa ô".
   3) Chuông theo dõi và nút chia sẻ đã bị GỠ khỏi sản phẩm (cùng với cột lưới
      thứ hai của `.grow` chỉ tồn tại để đặt chuông). Bài này canh cho chúng
      không quay lại bằng đường sau: không component, không lớp CSS, không
      prop `onWatch`/`onShare`, không icon `share`.
   Xem thêm cssNotifyPitch.test.js, cssSelectArrow.test.js. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const fileAt = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const css = at('../index.css')
const app = at('../App.jsx')
/* bỏ comment để không đếm cả những gì nằm trong ghi chú */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

/* Bộ phân tích CSS duy nhất cho cả file test: mẫu dưới đây ăn khớp TỪNG quy tắc
   một. Đừng thêm `^|}` vào đầu như bản cũ — dấu `}` đóng quy tắc trước đó bị
   match liền trước nuốt mất, thành ra chỉ đọc được cách một quy tắc, và "không
   thấy selector X" trở thành kết luận SAI (xanh giả). Stylesheet này không có
   quy tắc lồng nên thân quy tắc luôn là `[^{}]*`; `@media (...) {` thành một
   mục rỗng nằm ngay trên các quy tắc con của nó. */
const RULES = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({
    sels: sel.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean),
    body,
  }))

const rulesWith = (sel) => RULES.filter((r) => r.sels.includes(sel)).map((r) => r.body)
const ruleOf = (sel) => {
  const hits = rulesWith(sel)
  assert.ok(hits.length, `không tìm thấy quy tắc CSS cho ${sel}`)
  return hits.join('; ')                 // gộp bản gốc + bản trong @media
}

/* PHƯƠNG ÁN F — CỘT PHIẾU BÊN PHẢI.
   ---------------------------------------------------------
   Lỗi mà ảnh chụp thật cho thấy: nội dung dòng phụ hết ở giữa hàng, nút vote
   là một hộp nhỏ canh giữa mép phải, nên mỗi hàng có một khoảng trống ~40% bề
   ngang và cái nút lơ lửng trong đó. Cách sửa là ĐÓNG KHUNG cột phải. Bốn vế
   phải còn đủ, thiếu vế nào là quay lại đúng trạng thái cũ:

     1. hàng giãn hết chiều cao  → `align-items: stretch` trên `.row.req`;
     2. cột chạm hai mép         → đệm dọc dời về `.body`, hàng `padding: 0`;
     3. vách ngăn dọc            → `border-left` trên cột, không phải viền hộp;
     4. số phiếu là chữ lớn      → `--fs-lead`, nhãn về cỡ caption in hoa. */
test('cột phiếu bên phải (phương án F) còn đủ bốn vế', () => {
  const row = ruleOf('.row.req')
  assert.match(row, /align-items:\s*stretch/, 'hàng phải giãn để cột chạm hai mép')
  assert.match(row, /padding:\s*0/, 'đệm dọc của hàng phải về 0, nếu không cột bị hụt vào trong')
  const body = rulesWith('.row.req .body').join(' ')
  assert.match(body, /padding:\s*var\(--sp-3\) 0/, 'đệm dọc dời về phần chữ — đó là chỗ duy nhất còn đệm')

  const btn = ruleOf('.row.req > .votebtn')
  assert.match(btn, /flex-direction:\s*column/, 'số và nhãn phải xếp dọc trong cột')
  assert.match(btn, /border-left:\s*1px solid var\(--line\)/, 'vách ngăn là đường kẻ trái của cột')
  assert.match(btn, /border:\s*0/, 'không giữ viền hộp của nút cũ — viền + vách là hai khung chồng nhau')
  assert.match(btn, /border-radius:\s*0/, 'cột chạm hai mép thì không được bo góc')
  assert.match(btn, /align-self:\s*stretch/, 'cột cao đúng bằng hàng')

  const num = rulesWith('.row.req > .votebtn b').join(' ')
  assert.match(num, /font-size:\s*var\(--fs-lead\)/, 'số phiếu phải lấy từ thang chữ, không viết cỡ rời')
  const lbl = rulesWith('.row.req > .votebtn span').join(' ')
  assert.match(lbl, /text-transform:\s*uppercase/, 'nhãn là đơn vị của con số: chữ nhỏ in hoa')
  assert.match(lbl, /letter-spacing/, 'chữ in hoa cỡ nhỏ phải giãn chữ mới đọc được')

  /* Trạng thái KHOÁ không được dùng viền đứt của bản cũ: trên một vách ngăn
     dọc, nét đứt đọc ra thành "ô nhập liệu" chứ không phải "không bấm được". */
  assert.match(css, /\.row\.req > \.votebtn\.locked \{[^}]*border-style:\s*none/,
    'cột bị khoá tắt viền đứt, chìm bằng màu chữ thay vì bằng nét')
  assert.match(css, /\.row\.req > \.votebtn\.locked b \{[^}]*var\(--txt-3\)/,
    'số phiếu của bài đã khoá phải chìm về màu xám')
})

/* NÚT NGHE — hành động DUY NHẤT của một hàng request.
   ---------------------------------------------------------
   Bản trước nó là một chuỗi chữ xám không viền, đứng cạnh hai ô icon, và cả
   cụm nằm lẫn trong dòng phụ. Chủ dự án chốt: bỏ theo dõi + chia sẻ, và nút
   nghe phải NỔI BẬT (viền + nền + mũi play). Ba vế dưới phải cùng còn, thiếu
   vế nào là lỗi cũ quay lại:
     1. nằm trên DÒNG TIÊU ĐỀ, sau tên bài, trước `.meta`;
     2. đọc ra là nút — viền, nền, chữ đậm hơn dòng phụ;
     3. không kéo dòng tiêu đề cao lên (lề âm bù phần chênh). */
test('nút nghe: một nút thật trên dòng tiêu đề, không đội dòng chữ', () => {
  const titleOpen = app.indexOf('<div className="title">')
  const watchAt = app.indexOf('<a className="watchbtn"')
  const titleClose = app.indexOf('</div>', watchAt)
  const metaOpen = app.indexOf('<div className="meta">')
  assert.ok(titleOpen >= 0 && watchAt > titleOpen, 'nút nghe phải nằm trong dòng tiêu đề')
  assert.ok(watchAt < titleClose, 'nút phải đóng TRƯỚC khi dòng tiêu đề đóng')
  assert.ok(metaOpen > watchAt, 'nút phải đứng TRƯỚC dòng phụ — rơi xuống dưới là bảy thứ chen nhau')

  const b = ruleOf('.row .title .watchbtn')
  assert.match(b, /display:\s*inline-flex/, 'nút là flex một hàng: icon + chữ')
  assert.match(b, /height:\s*24px/, 'cao 24px — cỡ một nút phụ khác trong app')
  assert.match(b, /margin-block:\s*-4px/,
    'lề âm bù phần chênh so với dòng chữ: hộp 24px mà không bù là chữ trôi lên trên')
  assert.match(b, /border:\s*1px solid var\(--line-2\)/, 'có viền mới đọc ra là nút')
  assert.match(b, /background:\s*var\(--surface-2\)/, 'nền nhấc khỏi mặt hàng một nấc, không phải nền trong suốt')
  assert.match(b, /font-weight:\s*600/, 'nét 600: đây là nút, không phải một mẩu thông tin')
  assert.match(b, /font-size:\s*11\.5px/, 'vẫn là cỡ chữ phụ — nổi bật bằng hình, không bằng cỡ')
  assert.match(b, /text-decoration:\s*none/, 'nút không gạch chân kiểu link chữ')
  assert.match(ruleOf('.row .title .watchbtn svg'), /color:\s*var\(--a-2\)/,
    'mũi play mang màu nhấn — thứ nhận ra ngay là biểu tượng')
  assert.match(rulesWith('.row .title .watchbtn:hover').join(' '), /background:\s*var\(--hover-2\)/,
    'rê vào phải đổi nền, không chỉ đổi màu chữ')
  assert.match(rulesWith('.row .title .watchbtn:focus-visible').join(' '), /outline:\s*2px solid/,
    'bàn phím Tab tới phải thấy vòng focus')

  /* Máy cảm ứng: hộp 24px là quá nhỏ cho ngón tay, nhưng nới hộp lên 40px là
     đội cả dòng tiêu đề. Nới VÙNG CHẠM bằng pseudo — hình không đổi một pixel. */
  assert.match(css, /\.row \.title \.watchbtn::before \{[^}]*inset:\s*-8px/,
    'máy cảm ứng phải nới vùng chạm quanh nút bằng pseudo-element')
})

/* KHÔNG CÒN THEO DÕI / CHIA SẺ.
   ---------------------------------------------------------
   Hai tính năng này bị gỡ theo yêu cầu trực tiếp của chủ dự án. Gỡ nửa vời là
   thứ dễ tái phát nhất: bỏ nút mà để lại component, để lại lớp CSS, hay để lại
   prop `onWatch` xuyên qua ba lớp thì lần sau ai đó "khôi phục" một nửa là ra
   một giao diện nửa cũ nửa mới. */
test('theo dõi và chia sẻ đã bị gỡ hẳn, không còn dấu vết', () => {
  for (const f of ['../components/FollowBtn.jsx', '../components/ShareBtn.jsx']) {
    assert.ok(!existsSync(fileAt(f)), `${f} phải bị xoá — không để component chết`)
  }
  for (const word of ['FollowBtn', 'ShareBtn', 'onWatch', 'onShare', 'doToggleWatch',
    'shareSong', 'act-link', 'className="acts"']) {
    assert.ok(!app.includes(word), `App.jsx còn sót "${word}"`)
  }
  for (const cls of ['.rowact', '.followbtn', '.sharebtn', '.act-link', '.row .acts']) {
    const hits = RULES.filter((r) => r.sels.some((s) => s.startsWith(cls)))
    assert.equal(hits.length, 0, `CSS còn quy tắc chết cho ${cls}`)
  }
  assert.doesNotMatch(at('../components/Icon.jsx'), /^\s*share:/m,
    'icon chia sẻ không còn chỗ dùng — bộ icon có luật "không tên chết"')

  /* Cụm bài mất chuông thì mất luôn cột lưới thứ hai: `.grow` từng là
     `grid-template-columns: 1fr auto` chỉ để đặt chuông vào cột 2, kéo theo ba
     luật `grid-area` và một `padding-right: 0` để nhường chỗ. */
  assert.match(ruleOf('.grow'), /display:\s*block/, 'cụm bài trở lại một cột')
  assert.equal(RULES.filter((r) => r.sels.some((s) => s.startsWith('.grow > .rowact'))).length, 0,
    'không còn luật đặt chuông vào cột 2')
  assert.doesNotMatch(bare, /\.grow \{[^}]*grid-template-columns/, 'lưới hai cột của cụm đã bỏ')
})

test('nhịp hàng giữ nguyên thang mật độ', () => {
  const row = ruleOf('.row')
  /* Gap và đệm hàng lấy từ thang mật độ (`--sp-*`) thay vì số viết tay, nên
     luật ở đây đọc đúng TÊN NẤC chứ không đọc con số: `--sp-3` = 12px (khe)
     và `--sp-4` = 16px (đệm ngang). Đổi giá trị của nấc thì phải đổi cả chỗ
     này — đó chính là mục đích: một chỗ khai, một chỗ chốt. */
  assert.match(row, /gap:\s*var\(--sp-3\)/, '.row gap phải là nấc --sp-3 (= 12px) như cam kết trong HUONG-DAN')
  assert.match(row, /padding:\s*8px var\(--sp-4\)/, '.row đệm 8px/--sp-4 (= 8px 16px)')
})

test('vòng focus nằm ở THẺ button, không ở danh sách tên lớp', () => {
  assert.match(bare, /button:focus-visible[^{]*\{[^}]*outline:\s*2px solid/,
    'phải còn quy tắc THẺ button:focus-visible — không có là mọi nút trần mất vòng focus')
  assert.doesNotMatch(bare, /\.followbtn:focus-visible\s*\{[^}]*outline:/,
    'không viết riêng vòng focus cho lớp đã bị gỡ')
})
