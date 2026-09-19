/* Chốt chặn TĨNH cho bố cục hàng / cụm bài: những lỗi mắt người dùng thấy còn
   tool thì không ("lệch tí, thấy mà không đo được"), và những lần ai đó "đơn
   giản hoá" làm quay lại đúng cái thiết kế đã bị phản đối.
   ---------------------------------------------------------
   Ba điều ở đây đều do người dùng chỉ ra bằng ảnh chụp:
   1) Lưới của THẺ CỤM BÀI (.grow): chốt cột là phải chốt hàng. FollowBtn đứng
      TRƯỚC .grow-head trong DOM; chỉ khai cột mà để hàng tự xếp thì chuông chiếm
      hàng 1, đầu cụm bị đẩy xuống hàng 2 — chuông nằm riêng một góc, thẻ cao
      thêm ~40px.
   2) Chuông của cụm không được neo `position:absolute` + `top`: đó là số đo, còn
      đầu cụm cao theo nội dung nên nó nhảy so với nút mũi tên.
   3) Chuông là AFFORDANCE MỜ cuối dòng meta, KHÔNG phải ô nút có hộp — người
      dùng đánh giá hộp 26px viền 1px (bật lên thành chip màu) ở cuối mọi dòng là
      "thô, mất thẩm mỹ". CSS phải chứng minh: không viền, không nền, ẩn khi hàng
      tĩnh, hiện khi rê/focus, trạng thái bật = chấm 4px chồng đúng chỗ glyph, và
      màn cảm ứng vẫn thấy. Kèm theo: không còn "ô ghost" giữ chỗ cho hàng trong
      cụm, vì hàng trong cụm chẳng có chuông nào để canh cột.
   Xem thêm cssNotifyPitch.test.js, cssSelectArrow.test.js. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = at('../index.css')
const app = at('../App.jsx')
const btn = at('../components/FollowBtn.jsx')
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

test('.grow: mỗi quy tắc chọn con trực tiếp đều chốt cả hàng lẫn cột', () => {
  const rules = RULES.filter((r) => r.sels.some((x) => x.startsWith('.grow >')))
  assert.ok(rules.length >= 2, `không tìm thấy quy tắc .grow > con (${rules.length})`)
  for (const { sels, body } of rules) {
    const hasCol = /grid-column(-start|-end)?\s*:/.test(body)
    const hasRow = /grid-row(-start|-end)?\s*:/.test(body)
    const hasArea = /grid-area\s*:/.test(body)
    assert.ok(!hasCol || hasRow || hasArea, `${sels.join(', ')}: chốt cột mà quên chốt hàng`)
  }
})

test('.grow định nghĩa lưới và nút mảnh của cụm không neo absolute', () => {
  assert.match(ruleOf('.grow'), /display:\s*grid/)
  assert.ok(!rulesWith('.grow > .rowact').some((b) => /position:\s*absolute/.test(b)),
    'nút mảnh của cụm (chuông) phải là ô lưới, không phải absolute + top: số đo')
  assert.match(ruleOf('.grow > .rowact'), /grid-area:\s*1\s*\/\s*2/, 'chuông cụm ở cột 2, hàng 1')
  assert.match(ruleOf('.grow > .grow-head'), /padding-right:\s*0/,
    'đầu cụm không cộng padding — khoảng cách do chuông giữ, không thì thành 26px')
})

test('nhịp cụm nút phải thống nhất giữa dòng lẻ và cả cụm', () => {
  const row = ruleOf('.row')
  assert.match(row, /gap:\s*12px/, '.row gap phải 12px như cam kết trong HUONG-DAN')
  assert.match(row, /padding:\s*11px 14px/, '.row cách mép phải 14px')
  const bell = rulesWith('.grow > .rowact')
  assert.ok(bell.some((b) => /margin:\s*0 14px 0 12px/.test(b)),
    'chuông cụm: 12px từ mũi tên, 14px từ mép phải — đúng bằng .row')
  assert.ok(bell.some((b) => /margin:\s*0 10px 0 8px/.test(b)),
    'bản hẹp giữ cùng tỉ lệ: 8px giữa các nút, 10px từ mép phải')
})

test('nút mảnh cuối dòng meta là affordance mờ, không phải ô nút có hộp', () => {
  /* Nền dùng chung nằm ở `.rowact` (theo dõi + chia sẻ dùng cùng một cái), còn
     `.followbtn` chỉ còn giữ trạng thái "đang theo dõi". */
  const b = ruleOf('.rowact')
  assert.match(b, /opacity:\s*0/, 'hàng tĩnh thì chuông phải ẩn hẳn')
  assert.match(b, /border:\s*0/, 'không viền — có viền là quay lại cái hộp 26px bị phản đối')
  assert.match(b, /background:\s*none/, 'không nền')
  assert.match(b, /width:\s*18px/, 'ô 18px vừa đủ cho glyph 15px, không phải hộp 26px')
  assert.match(b, /flex:\s*none/, '.meta là flex nên chuông phải flex:none — co lại là lệch nhịp chữ')
  assert.ok(!/vertical-align/.test(b), 'hết thời `vertical-align`: .meta căn giữa bằng flex, khai nữa là số đo tay')
  /* An = khong duoc cham vao. Thieu no thi 18px trong cuoi dong meta van la mot
     nut: con tro bao bam duoc o cho khong co gi, va bôi đen dòng chữ là dính ô. */
  assert.match(b, /pointer-events:\s*none/)
  for (const sel of ['.row:hover .rowact', '.grow:hover > .rowact', '.rowact:focus-visible']) {
    assert.ok(rulesWith(sel).some((body) => /pointer-events:\s*auto/.test(body)),
      `"${sel}" phải mở lại pointer-events, không chỉ tăng opacity`)
  }
  /* phải là quy tắc LÀM HIỆN (opacity) chứ không chỉ quy tắc đổi glyph/chấm:
     chỉ kiếm chuỗi ".row:hover .followbtn" trong file thì nó khớp cả
     `.row:hover .followbtn.on > svg`, tức là bỏ mất đường hiện khi rê mà test
     vẫn xanh. */
  for (const sel of ['.row:hover .rowact', '.grow:hover > .rowact', '.rowact:focus-visible']) {
    const hits = rulesWith(sel)
    assert.ok(hits.length, `thiếu quy tắc "${sel}" — affordance ẩn mà không có đường hiện thì mất luôn lối tắt`)
    assert.ok(hits.some((body) => /opacity:/.test(body) && !/svg|::after/.test(body)),
      `"${sel}" phải đặt opacity cho chính nút`)
  }
  /* @media phải đọc trên CSS gốc: quy tắc một dòng `@media (...) { .x { y } }`
     làm bộ parse ở trên nhảy thẳng vào quy tắc con, mất tên @media.  */
  assert.match(css, /@media\s*\(hover:\s*none\)\s*\{[^{}]*\.rowact\s*\{[^{}]*opacity:[^}]*\}/,
    'màn cảm ứng không có "rê": phải có .rowact trong @media (hover: none) với opacity > 0')
  /* Hai nút mảnh đang cùng tồn tại (theo dõi + chia sẻ). Nút nào quên `.rowact`
     là tự dựng kiểu riêng và lệch nhịp với nút bên cạnh — đúng lỗi mà khối
     `.rowact` sinh ra để chặn. */
  assert.match(btn, /rowact followbtn/,
    'FollowBtn phải mang CẢ .rowact (nền chung) lẫn .followbtn (trạng thái)')
  assert.match(at('../components/ShareBtn.jsx'), /rowact sharebtn/,
    'ShareBtn phải mang CẢ .rowact lẫn .sharebtn')
})
  /* Vong focus: index.css chot bang THE (`button:focus-visible`), khong bang
     danh sach ten — ten chu ong co trong danh sach la mau hinh cu, va o day
     vong focus dang quan trong hon vi chinh thuoc no an. */
  assert.match(bare, /button:focus-visible[^{]*\{[^}]*outline:\s*2px solid/,
    'phải còn quy tắc THẺ button:focus-visible — không có là chuông (và mọi nút trần khác) mất vòng focus')
  assert.ok(!/\.followbtn:focus-visible\s*\{[^}]*outline:/.test(bare),
    'không viết riêng vòng focus cho .followbtn nữa — quy tắc thẻ đã lo; thêm tên vào là bắt đầu lại cái danh sách đã bỏ')


test('trạng thái bật = chấm 4px chồng đúng chỗ glyph (không nhảy 1px)', () => {
  const after = ruleOf('.followbtn::after')
  assert.match(after, /width:\s*4px/, 'chấm phải 4px')
  assert.match(after, /height:\s*4px/, 'chấm phải 4px')
  assert.match(after, /border-radius:\s*50%/, 'chấm tròn')
  /* "glyph va cham trung mot o" phai tim bang quy tac co CA HAI selector trong
     danh sach — ruleOf() tach theo dau phay nen goi tron
     `.rowact > svg, .followbtn::after` se khong bao gio khop. */
  assert.ok(RULES.some((r) => r.sels.includes('.rowact > svg') && r.sels.includes('.followbtn::after')
    && /grid-area:\s*1\s*\/\s*1/.test(r.body)),
    'glyph và chấm phải xếp chồng trong cùng một ô, nếu không dòng meta giật 1px khi rê')
  assert.match(ruleOf('.followbtn.on'), /color:\s*var\(--a-2\)/, 'đang bật thì đổi MÀU, không đổi hình hài')
  assert.ok(!ruleOf('.followbtn.on').includes('var(--a-soft)'),
    'không được biến chuông đang bật thành chip nền màu — chính là cái bị chê nặng')
})

/* hai ham JSX duoc cat theo ten de do vi tri trong markup — so sanh ca file
   thi vo nghia: votebtn o RequestRow nam SAU chuong cua RequestGroup khac,
   nen "indexOf > bellAt" duoc thoa man ngay ca khi bell bi dua ra sai cho. */
const between = (src, from, toRe) => {
  const a = src.indexOf(from)
  assert.ok(a >= 0, `không tìm thấy "${from}" trong App.jsx`)
  const rest = src.slice(a + from.length)
  const m = toRe.exec(rest)
  assert.ok(m && m.index > 0, `không tìm thấy ranh giới đóng của "${from}"`)
  return src.slice(a, a + from.length + m.index)
}
/* ranh giới ham: ham dau tien sau do co the la `export default function` (App) */
const NEXT_FN = /\n(?:export default )?function /

test('hàng trong cụm không còn ô ghost giữ chỗ', () => {
  assert.equal(rulesWith('.followbtn.is-ghost').length, 0, 'CSS "giữ chỗ" cho hàng trong cụm đã bỏ')
  assert.ok(!bare.includes(':not(:has(> .followbtn))'),
    'biến thể "cụm không chuông" không còn vì chuông nào cũng đứng ở đầu cụm')
  assert.match(btn, /export default function FollowBtn\(\{ on = false, onToggle \}\)/,
    'FollowBtn chỉ còn hai prop — không có `hidden`/`collapse` vì không còn ô giữ chỗ')
  const rowFn = between(app, 'function RequestRow(', NEXT_FN)
  const grpFn = between(app, 'function RequestGroup(', NEXT_FN)
  assert.match(rowFn, /\{onWatch && <FollowBtn/,
    'RequestRow chỉ dựng chuông khi dòng đó thật sự có quyền bật/tắt theo dõi')
  /* "bellAt < indexOf('votebtn')" KHONG du: dat chuong ngay TRUOC nut vote cung
     thoat (no van nam ben trai chu `votebtn`). Do bang cach tim phan tu <div
     className="meta"> va bao chuông phải rơi vao trong no. */
  const metaOpen = rowFn.indexOf('<div className="meta">')
  const metaClose = rowFn.indexOf('</div>', metaOpen)
  assert.ok(metaOpen >= 0 && metaClose > metaOpen, 'RequestRow phải còn <div className="meta">')
  const bellAt = rowFn.indexOf('{onWatch && <FollowBtn')
  assert.ok(bellAt > metaOpen && bellAt < metaClose,
    'chuông phải nằm TRONG dòng meta của hàng lẻ — đưa nó ra cụm nút mép phải là quay lại thiết kế cũ')
  assert.ok(bellAt > rowFn.indexOf('<Standing st={st} />'),
    'chuông phải là MỤC CUỐI của dòng meta — đưa nó lên trước Standing là đổi nhịp chữ')
  /* doi chieu tren THEO THE <FollowBtn .../>, khong tren ca ham: `aria-hidden`
     cua svg/spans trong hang cung co chu "hidden=" va lam assert nay luc nao cung
     do (mau test xanh gia nguoc lai: bao bao loi). `[^>]*` cung khong dung vi
     mui ten `=>` co dau `>` trong prop onToggle. */
  const tags = (src) => [...src.matchAll(/<FollowBtn\b([\s\S]*?)\/>/g)].map((m) => m[1])
  const allTags = tags(rowFn).concat(tags(grpFn))
  assert.equal(allTags.length, 2, 'phải còn đúng 2 chỗ đặt chuông: cuối dòng meta và đầu cụm')
  for (const tag of allTags) {
    assert.ok(!/\b(hidden|collapse)\s*=/.test(tag), `thẻ chuông không còn prop ẩn: ${tag.trim().slice(0, 60)}`)
  }
  /* Chuông của CỤM đứng TRƯỚC .grow-head (anh em, không lồng trong nút) — lồng
     vào là HTML sai; absolute là số đo; và nó phải là con trực tiếp của .grow
     để `grid-area: 1/2` áp được. */
  assert.ok(grpFn.indexOf('<FollowBtn') < grpFn.indexOf('className="grow-head"'),
    'chuông cụm phải là anh em đứng trước .grow-head, không nằm trong nút đầu cụm')
})
