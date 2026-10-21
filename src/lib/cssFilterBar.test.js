/* Chốt chặn TĨNH cho bốn thứ người dùng chỉ ra bằng lời (vòng 8–9) nhưng không
   có ảnh chụp nào đo được:
     1. "thanh filter còn sơ sài và chưa tích hợp giao diện cho các thiết bị" →
        một hàng chip trạng thái ĐỦ chỗ trên desktop, gấp lại sau nút Bộ lọc
        trên máy hẹp, dính mép trên khi cuộn, và đủ to để chạm;
     2. "các nhãn tag đôi lúc bị chồng hoặc vướng vào nhau" → mọi nhãn là
        `nowrap` (một nhãn không bao giờ tự xuống dòng giữa chữ) và mọi cụm
        nhãn nằm trong `.tags` (thứ tự xuống dòng);
     3. "chỗ search bị lỗi icon lòi ra ngoài" → icon nằm trong ô, canh giữa
        theo chiều dọc;
     4. "màu thanh progress chưa đẹp" → ruột thanh tô theo ĐÚNG màu trạng thái
        của nó (không có bảng màu thứ hai đi kèm).
   Đây là hợp đồng theo CẶP giống cssTapTarget.test.js: mỗi mục phải còn cả vế
   desktop LẪN vế máy hẹp, vì vế máy hẹp là thứ bị xoá đầu tiên khi dọn CSS.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const cssRaw = at('../index.css')
const app = at('../App.jsx')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')   // bỏ ghi chú, chỉ đọc luật

const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({
    sels: sel.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean),
    body: body.replace(/\s+/g, ' ').trim(),
  }))
/* Nhiều khối cho cùng một selector là BÌNH THƯỜNG ở đây (bản desktop, bản máy
   hẹp, bản reduced-motion, các biến thể .pill.gold…). Nên phép kiểm không phải
   "chỉ một khối" mà là "có MỘT khối giữ vai trò gốc": tìm theo đúng thuộc tính
   làm nên vai trò đó, và khối gốc ấy phải là duy nhất. */
const bodies = (sel) => RULES.filter((r) => r.sels.includes(sel)).map((r) => r.body)
const anchor = (sel, re, what = '') => {
  const hits = bodies(sel).filter((b) => re.test(b))
  assert.equal(hits.length, 1, `\`${sel}\` phải có đúng một khối ${what} (đang có ${hits.length})`)
  return hits[0]
}
const has = (sel, re) => bodies(sel).some((b) => re.test(b))

/* ---------- 1. thanh lọc ---------- */
/* BẢN 2026-10: thanh lọc đổi hẳn cấu trúc — từ "hai dải chip + một nút gấp"
   sang ba điều khiển trên một đường ngang. Bộ kiểm cũ khoá chặt `.fchip`,
   `.fchips`, `.fmore` nên đã được thay bằng bộ kiểm cho cấu trúc mới, GIỮ
   NGUYÊN TINH THẦN: mỗi luật phải còn cả vế desktop lẫn vế máy hẹp, và mỗi
   lỗi người dùng từng báo phải có một phép kiểm đứng canh. */
test('.fbar nằm TRONG DÒNG — không dính, không nổi trên danh sách khi cuộn', () => {
  const bar = anchor('.fbar', /background:\s*var\(--panel\)/, 'khối trong dòng')
  assert.doesNotMatch(bodies('.fbar').join(' '), /position:\s*sticky/,
    'thanh lọc không được dính mép trên')
  assert.doesNotMatch(bodies('.fbar').join(' '), /backdrop-filter/,
    'thanh lọc không được dùng nền mờ (chữ sẽ chồng lên nhau)')
  const marginDigits = bar.replace(/var\([^)]*\)/g, '')
  assert.doesNotMatch(marginDigits, /margin:[^;]*-\d/, 'thanh không được tràn ra ngoài cột nội dung')
})

test('thanh lọc chỉ còn BA điều khiển, dải chip cũ đã bị gỡ hẳn', () => {
  /* Hai dải chip + một nút gấp là ba tầng điều khiển cho cùng một việc. Nay:
     ô tìm, Status, Type, Sort, Clear — và không còn dấu vết nào của bản cũ. */
  assert.doesNotMatch(app, /className="fchip/, 'không còn chip lọc kiểu cũ trong JSX')
  assert.doesNotMatch(css, /\.fchips|\.fchip\b|\.fmore\b/, 'luật CSS của dải chip cũ phải bị xoá')
  for (const sel of ['.fb-fac', '.fb-sort', '.fb-clear', '.fb-icon']) {
    assert.ok(bodies(sel).length > 0, `thiếu luật cho \`${sel}\``)
  }
  /* Facet hiện GIÁ TRỊ đang chọn chứ không chỉ tên trường: mở bảng ra để nhớ
     mình đã chọn gì là việc thừa. */
  assert.match(app, /className="v">\{stageText\}/, 'pill Status phải in giá trị đang chọn')
  assert.match(app, /className="v">\{kindText\}/, 'pill Type phải in giá trị đang chọn')
})

test('bảng chọn neo ngay dưới chính cái pill mở nó', () => {
  /* Không tính toạ độ bằng JS: mỗi facet là một khối `position: relative`, bảng
     nằm trong đó. Đổi bề rộng cửa sổ là bảng vẫn dính đúng pill. */
  const wrap = anchor('.fb-wrap', /position:\s*relative/, 'khối neo')
  assert.match(wrap, /display:\s*inline-flex/)
  assert.match(anchor('.fb-pop', /position:\s*absolute/, 'bảng nổi'), /top:\s*calc\(100% \+ 8px\)/)
  assert.match(app, /<span className="fb-wrap">/, 'JSX phải thật sự bọc pill trong khối neo')
})

test('máy hẹp: Status/Type vào MỘT bảng, Sort ra icon riêng, chip đang lọc hiện ra', () => {
  const mq = css.slice(css.indexOf('.fb-main { gap: 6px;'))   /* khối thanh lọc, không phải @media đầu tiên trong tệp */
  assert.match(mq, /\.fb-wrap:not\(\.fb-wrap-end\) \{ display: none/,
    'hai khối neo của Status/Type phải gập lại')
  assert.match(mq, /\.fb-icon \{ display: inline-flex/, 'nút mở bảng lọc phải hiện trên máy hẹp')
  assert.match(mq, /\.fb-applied \{ display: flex/, 'dải chip "đang lọc" chỉ có nghĩa ở bố cục gọn')
  assert.match(mq, /\.fb-pop \{ left: 0; right: 0; width: auto/, 'bảng lọc phải rộng hết thanh')
  /* Sort KHÔNG phải bộ lọc nên nó không chui vào bảng lọc: nó ở lại thành nút
     icon riêng, và tên nút vẫn đọc được (clip, không phải display:none). */
  assert.match(mq, /\.fb-sort \.v \{\s*position: absolute; width: 1px; height: 1px/,
    'nhãn sort phải bị ẩn bằng clip để không mất tên khỏi cây trợ năng')
  assert.doesNotMatch(mq, /\.fb-sort \{[^}]*display: none/, 'nút sort không được biến mất')
  assert.match(mq, /\.fb-sort \{[\s\S]{0,120}width: 32px/, 'máy hẹp: sort là nút icon vuông')
})

test('bề rộng ô tìm KHÔNG phụ thuộc vào việc đang lọc hay chưa', () => {
  /* Lỗi người dùng báo: "trước và sau khi tick chọn filter thì chiều dài
     search bar bị lỗi". Hai nguyên nhân, cả hai đều phải bị chốt:
       1. nút Clear ẩn vẫn chiếm chỗ (visibility) → ở bố cục gọn phải ẩn HẲN;
       2. ô tìm co giãn theo NỘI DUNG (flex-basis: auto) → đổi sang basis 0. */
  const mq = css.slice(css.indexOf('.fb-main { gap: 6px;'))   /* khối thanh lọc, không phải @media đầu tiên trong tệp */
  assert.match(mq, /\.fb-main \.fb-clear, \.fb-main \.fb-clear\[hidden\] \{ display: none/,
    'bố cục gọn không được giữ chỗ cho nút Clear')
  assert.match(mq, /\.fbar \.searchwrap \{ flex: 1 1 0; \}/,
    'ô tìm phải lớn lên từ 0, không từ nội dung bên trong')
  /* và thanh cuộn của trang không được làm cả trang rộng ra khi danh sách ngắn lại */
  assert.match(css, /scrollbar-gutter:\s*stable/, 'giữ chỗ thanh cuộn để bề ngang không nhảy')
})

test('bảng lọc không chứa mục sắp xếp, và menu sắp xếp là một lựa chọn', () => {
  const filtersPanel = app.slice(app.indexOf("id=\"fb-filters\""), app.indexOf('</div>', app.indexOf("id=\"fb-filters\"")))
  assert.ok(filtersPanel.includes('fb-opt') === false || !/filter\.newest|filter\.top/.test(filtersPanel),
    'bảng lọc không được chứa Newest/Top voted — sort không phải bộ lọc')
  assert.match(app, /role="menuitemradio"/, 'menu sort phải là lựa chọn MỘT ô')
  assert.match(css, /\.fb-mi\[aria-checked="true"\]/, 'mục đang chọn phải có trạng thái nhìn thấy được')
})

test('đang lọc thì có MỘT tín hiệu, không phải ba', () => {
  /* Pill đang lọc: viền nhấn. KHÔNG tô chữ bằng màu nhấn (hai tín hiệu cho một
     sự thật), KHÔNG chấm màu trong pill. */
  const on = anchor('.fb-fac.on', /box-shadow:\s*inset 0 0 0 1px color-mix/, 'viền nhấn')
  assert.doesNotMatch(on, /color:/, 'không tô chữ bằng màu nhấn')
  assert.doesNotMatch(bodies('.fb-fac').join(' '), /\.fb-fac \.pips|border-radius:\s*999px/,
    'không quay lại khuôn "viên thuốc + chấm màu"')
})

test('chip lọc và nút icon đủ to để chạm', () => {
  const coarse = css.slice(css.lastIndexOf('@media (pointer: coarse)'))
  assert.match(coarse, /\.fbar \.searchwrap, \.fbar \.search \{ height: 44px/, 'ô tìm 44px khi chạm')
  assert.match(coarse, /\.fb-icon, \.fb-sort \{ width: 44px; height: 44px/, 'hai nút icon 44px khi chạm')
  assert.match(coarse, /\.fb-opt \{ height: 44px/, 'mục trong bảng chọn 44px khi chạm')
  assert.match(anchor('.fb-chip', /white-space:\s*nowrap/, 'chip không ngắt dòng'), /white-space:\s*nowrap/)
})

test('bốn chặng của dây chuyền đứng đúng thứ tự công việc', () => {
  /* Bản cũ trộn bốn chặng với hai "cách nhìn" vào cùng một dải, và để "In
     progress" đứng sau "Top voted": dây chuyền bị cắt làm hai khúc. Nay bảng
     chọn Status dựng từ STAGES (thứ tự công việc), còn newest/top nằm ở menu
     sắp xếp. */
  const stages = app.match(/STAGE_COLOR = \{([\s\S]*?)\n\}/)[1]
  const order = [...stages.matchAll(/(\w+):/g)].map(m => m[1])
  assert.deepEqual(order, ['queued', 'picked', 'in_progress', 'completed'],
    'thứ tự chặng đã đổi khỏi thứ tự công việc')
  assert.match(app, /\{STAGES\.map\(k => \(/, 'bảng Status phải dựng từ STAGES')
  /* Menu Sort dựng từ SORTS (board.js), không phải từ một mảng viết tay
     trong JSX — thêm một cách xếp thì không phải sửa ba chỗ. */
  assert.match(app, /\{SORTS\.map\(k => \(/, 'menu Sort phải dựng từ SORTS')
  assert.doesNotMatch(app, /\[\['newest', 'up'\]/, 'không quay lại mảng cặp viết tay')
  /* Đang xem một CHẶNG thì nút Sort không được in tên một cách xếp nào. */
  assert.match(app, /sortKey \? t\(`filter\.\$\{sortKey\}`\) : t\('board\.sortLabel'\)/,
    'nút Sort phải trung tính khi danh sách đang xếp theo chặng')
  assert.doesNotMatch(app, /watchedSet/, 'tab "Following" đã bị gỡ')
})

/* ---------- 2. nhãn / tag ---------- */
test('mọi nhãn là nowrap, và mọi cụm nhãn nằm trong một hộp biết xuống dòng', () => {
  for (const sel of ['.pill', '.kind']) {
    assert.ok(has(sel, /white-space: nowrap/), `${sel} không được ngắt dòng giữa chữ`)
    assert.ok(has(sel, /flex: none/), `${sel} không được bị bóp méo trong hàng`)
    assert.ok(has(sel, /line-height: 1/), `${sel} phải cao theo một dòng, không theo chữ trong nó`)
  }
  const tags = anchor('.tags', /flex-wrap:\s*wrap/, 'biết xuống dòng')
  assert.match(tags, /display: (?:inline-)?flex/)
  assert.match(tags, /gap:\s*\d/, 'hai nhãn cạnh nhau phải có khe, không dính chữ vào nhau')
})

test('ô tiêu đề bài có nhãn: phần chữ được phép co, phần nhãn thì không', () => {
  /* `.tags` chỉ có tác dụng nếu nó là một ô trong hàng co giãn được — thiếu
     `min-width: 0` thì nó đẩy cả hàng tràn ra ngoài. */
  assert.ok(has('.tags', /min-width:\s*0/), '.tags phải co được trong hàng')
  assert.ok(/className="tags"/.test(app), 'bảng phải thật sự dùng .tags, không chỉ khai trong CSS')
  const uses = (app.match(/className="tags"/g) || []).length
  assert.ok(uses >= 2, `cụm nhãn phải được bọc ở mọi chỗ có nhiều nhãn (đang có ${uses})`)
})

/* ---------- 3. ô tìm kiếm ---------- */
test('icon kính lúp nằm TRONG ô: canh giữa theo chiều dọc, không nhận chuột', () => {
  const ico = anchor('.search-ico', /position:\s*absolute/, 'định vị trong ô')
  assert.match(ico, /position:\s*absolute/)
  assert.match(ico, /top:\s*50%/, 'thiếu top là icon lòi ra khỏi ô — lỗi người dùng báo')
  assert.match(ico, /translateY\(-50%\)/, 'canh giữa theo chiều dọc')
  assert.match(ico, /pointer-events:\s*none/, 'bấm vào icon vẫn phải vào được ô nhập')
  assert.ok(/className="search-ico"/.test(app), 'bảng phải thật sự dùng lớp này')
  assert.ok(has('.searchwrap', /position:\s*relative/), 'icon absolute cần mốc canh')
  /* và mọi ô tìm kiếm phải CHỪA CHỖ cho icon — không chỉ ô ở trang chủ. Lỗi cũ:
     luật `padding-left` chỉ áp cho `.fbar .search`, nên ô tìm trong bảng quản
     trị (cùng lớp .search, cùng icon) có chữ nằm ngay dưới kính lúp. */
  const pad = anchor('.searchwrap .search', /padding-left:/, 'chừa chỗ cho icon')
  assert.match(pad, /padding-left:\s*calc\(var\(--ico-x\) \+ var\(--ico-w\)/,
    'khoảng chừa cho icon phải áp cho MỌI ô tìm kiếm và tính theo bề rộng icon')
  assert.ok(has('.searchwrap', /--ico-w:/), 'bề rộng icon phải là biến, để đổi icon là khoảng chừa đi theo')

  /* BÊN PHẢI CŨNG PHẢI CHỪA CHỖ: nút xoá trên thiết bị chạm được nới lên 30px,
     còn khoảng chừa từng là 26px viết cứng — chữ gõ vào chui xuống dưới nút. */
  assert.match(pad, /padding-right:\s*calc\(var\(--x-x\) \+ var\(--x-w\)/,
    'khoảng chừa bên phải phải tính từ bề rộng nút xoá, không viết cứng')
  assert.ok(has('.searchwrap', /--x-w:/), 'bề rộng nút xoá phải là biến')
  const x = anchor('.search-x', /position:\s*absolute/, 'nằm đè trong ô')
  assert.match(x, /right:\s*var\(--x-x\)/, 'nút xoá phải neo theo cùng biến')
  assert.match(x, /width:\s*var\(--x-w\)/, 'bề rộng nút xoá phải lấy từ biến — nới nút là khoảng chừa tự theo')
  /* Luật này nằm ở khối `@media (pointer: coarse)` của phần ô tìm, KHÔNG phải
     khối cuối tệp của thanh lọc — nên dò trên toàn tệp, đừng cắt theo mốc cuối. */
  assert.match(css, /\.searchwrap \{ --x-w: 30px; --x-x: 5px; \}/,
    'trên thiết bị chạm nút xoá to hơn, và khoảng chừa phải đi theo')
  /* Nhãn đọc được cho trình đọc màn hình: placeholder không phải nhãn. */
  assert.match(app, /className="search" placeholder=\{t\('board\.search'\)\}[\s\S]{0,80}aria-label=\{t\('board\.search'\)\}/,
    'ô tìm kiếm của bảng phải có nhãn đọc được')
})

/* ---------- 4. thanh tiến độ ---------- */
test('ruột thanh tiến độ tô theo màu trạng thái truyền vào, và luôn thấy được', () => {
  const fill = anchor('.prog-track > i', /var\(--sc\b/, 'tô theo màu trạng thái')
  assert.match(fill, /var\(--sc\b/, 'màu ruột phải lấy từ biến trạng thái')
  assert.ok(has('.prog-track > i', /min-width:\s*\d+px/),
    'vừa bắt đầu làm cũng phải thấy một vạch, không phải 0px')
  assert.ok(has('.prog-track', /height:\s*\d+px/), 'rãnh phải có chiều cao xác định')
  assert.ok(has('.prog-track', /border-radius/), 'hai đầu thanh phải tròn theo khuôn của trang')
  assert.ok(has('.prog-num', /font-variant-numeric:\s*tabular-nums/),
    'số không được nhảy bề rộng khi đổi')
})
