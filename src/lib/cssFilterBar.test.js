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
test('.fbar nằm TRONG DÒNG — không dính, không nổi trên danh sách khi cuộn', () => {
  const bar = anchor('.fbar', /background:\s*var\(--panel\)/, 'khối trong dòng')
  /* LỖI NGƯỜI DÙNG CHỈ RA (vòng 13 — "đừng để cái filter search bar floating lúc
     cuộn trang"): thanh từng `position: sticky; top: 0`, nên suốt lúc cuộn nó
     phủ lên các hàng request; ở máy hẹp nó cao gần nửa màn hình. Nay nó trôi
     theo trang. Chốt hai vế: KHÔNG sticky, và KHÔNG còn khối luật `.stuck` mồ
     côi (đổi nền + viền + bóng của trạng thái dính). */
  assert.doesNotMatch(bodies('.fbar').join(' '), /position:\s*sticky/,
    'thanh lọc không được dính mép trên nữa')
  assert.equal(bodies('.fbar.stuck').length, 0, 'khối luật của trạng thái "đang dính" phải bị gỡ')
  assert.doesNotMatch(css, /\.fbar\.stuck/, 'không còn tham chiếu nào tới .fbar.stuck')
  /* Vẫn phải là khối ĐỤC: nền trong suốt là lý do hàng request hiện xuyên qua. */
  assert.match(bar, /background:\s*var\(--panel\)/)
  assert.doesNotMatch(bodies('.fbar').join(' '), /backdrop-filter/,
    'thanh lọc không được dùng nền mờ (đó là nguyên nhân chữ chồng lên nhau)')
  /* Mép thanh phải TRÙNG mép danh sách: lề âm làm thanh thò ra ngoài cột nội
     dung, và đó là một nửa của cảm giác "thanh này không thuộc trang". */
  assert.doesNotMatch(bar, /margin:[^;]*-\d/, 'thanh không được tràn ra ngoài cột nội dung')
})

test('lọc status giữ một hàng — hết chỗ thì cuộn ngang, không gãy thành hai hàng', () => {
  /* Đây là lỗi người dùng báo trực tiếp: các pill trạng thái bị bẻ thành hai
     hàng trong cùng một rãnh, hàng trên/dưới lệch nhau và nhìn như hai thanh
     khác nhau. Rãnh phải nowrap ở luật gốc, và luật desktop không được đè lại
     bằng `flex-wrap: wrap` + `overflow: visible`. */
  const strip = anchor('.fchips', /flex-wrap:\s*nowrap/, 'không xuống hàng')
  assert.match(strip, /overflow-x:\s*auto/, 'hết chỗ phải cuộn ngang trong rãnh')
  assert.doesNotMatch(css, /\.fbar \.fchips\s*\{[^}]*flex-wrap:\s*wrap/,
    'desktop không được bật lại xuống hàng cho dải status')
  const desktop = css.slice(css.indexOf('.fbar-top { flex-wrap: wrap; align-items: center'))
  assert.match(desktop, /\.fbar-top > \.fchips\s*\{[\s\S]*flex-wrap:\s*nowrap/,
    'desktop phải giữ dải status một hàng')
})

test('màn rộng vẫn với tới được bộ lọc loại bài (lỗi cũ: hàng đó chỉ mở trên máy hẹp)', () => {
  /* Khối lọc thứ hai từng chỉ có mặt trong `@media (max-width: 620px)`, còn nút
     mở nó cũng chỉ hiện ở đó — trên desktop không có cách nào chọn loại bài. */
  assert.match(css, /\.fbar-more \{ display: flex/, 'hàng lọc thứ hai phải hiện mặc định')
  const mq = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(mq, /\.fbar:not\(\.open\) \.fbar-more \{ display: none/,
    'máy hẹp vẫn phải gấp được (hai vế của cùng một luật)')
  /* Điện thoại: hàng trên xuống dòng được, nếu không dải chip bị bóp còn vài
     chục pixel trong khi ô tìm kiếm chiếm hết chỗ. */
  assert.match(mq, /\.fbar-top \{ flex-wrap: wrap/, 'hàng trên phải xuống dòng trên máy hẹp')
  assert.match(mq, /\.fchips\.kinds \{ flex-wrap: wrap/,
    'chip loại bài trong khối gấp phải xuống dòng để thấy hết')
  /* và con số kết quả chỉ được in MỘT lần trên màn rộng */
  assert.match(css, /@media \(min-width: 621px\) \{ \.fbar-meta > span:first-child \{ display: none/,
    'màn rộng không in con số kết quả hai lần')
})

test('máy hẹp: nút Bộ lọc hiện ra, khối lọc thứ hai gấp lại cho tới khi bấm', () => {
  const mq = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(mq, /\.fmore \{ display: inline-flex/, 'nút Bộ lọc phải hiện trên máy hẹp')
  assert.match(mq, /\.fbar:not\(\.open\) \.fbar-more \{ display: none/, 'khối lọc phải gấp lại mặc định')
  assert.match(mq, /\.fbar\.open \.fbar-more/, 'bấm thì khối lọc phải mở ra')
  assert.match(mq, /\.fbar \.fcount \{ display: none/, 'dòng đếm nhường chỗ cho nút Bộ lọc')
})

test('máy hẹp: mỗi hàng một việc — dải chip trọn một hàng, ô tìm kiếm trọn hàng dưới', () => {
  /* Trước đây dải chip (co được tới 0) và ô tìm kiếm chen nhau trên một hàng,
     nên chip bị bóp còn vài chục pixel: người dùng chỉ thấy một mẩu chip cụt. */
  /* Luật "chip trọn một hàng" nay nằm ở mốc 899px — đúng mốc mà dải bảy chip
     hết chỗ chen với ô tìm kiếm; ≤620px chỉ còn việc gấp khối lọc. */
  const narrow = css.slice(css.indexOf('.fbar-top { flex-wrap: wrap'))
  assert.match(narrow, /\.fchips \{ flex: 1 1 100%/, 'dải chip phải chiếm trọn một hàng')
  assert.match(narrow, /\.fbar-top > \.searchwrap \{ flex: 1 1 auto/, 'ô tìm kiếm co giãn ở hàng trên')
  const mq = css.slice(css.indexOf('@media (max-width: 620px)'))
  /* Dải chip vẫn cuộn ngang được (không xuống dòng): thanh lọc không được cao
     thêm ở màn hình vốn đã hẹp, nhưng phải biết DỪNG ở từng chip. */
  assert.match(mq, /scroll-snap-type: x proximity/, 'cuộn ngang có điểm dừng ở mỗi chip')
  assert.match(mq, /\.fchip \{ scroll-snap-align: start/, 'chip phải là điểm dừng')
})

test('loại bài đang lọc hiện thành chip bỏ được — chỉ trên máy hẹp', () => {
  /* Trên màn hẹp khối lọc gấp sau nút Bộ lọc, nên nếu không có chip này thì
     không có chỗ nào NÓI RA là danh sách đang bị lọc theo loại bài: người dùng
     chỉ thấy danh sách thiếu bài. Trên màn rộng khối lọc luôn hiện nên chip đó
     là chỗ thứ hai nói cùng một điều. */
  assert.match(app, /className="fchip kind on onkind"/, 'thiếu chip loại bài đang lọc')
  assert.match(app, /kindFilter !== 'all' && \(/, 'chip chỉ hiện khi ĐANG lọc theo loại bài')
  assert.match(app, /board\.clearKind/, 'chip phải có nhãn đọc được, không chỉ một dấu ×')
  assert.match(app, /onClick=\{\(\) => setKindFilter\('all'\)\}/, 'bấm chip là bỏ lọc đó')
  const mq = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(mq, /\.fchip\.onkind \{ display: inline-flex/, 'máy hẹp phải thấy chip này')
  assert.match(css, /@media \(min-width: 621px\) \{ \.fchip\.onkind \{ display: none; \} \}/,
    'màn rộng không nói lại điều khối lọc đang nói')
})

test('chip lọc đủ to để chạm trên thiết bị cảm ứng, bản desktop không đổi', () => {
  assert.ok(/@media \(pointer: coarse\)/.test(css), 'phải có một luật riêng cho thiết bị chạm')
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
  assert.match(coarse, /\.fchip \{ min-height: 4\dpx/, 'chip phải cao ≥40px trên cảm ứng')
  /* Ô tìm kiếm và nút Bộ lọc là hai thứ ngón tay chạm nhiều nhất trong thanh —
     34px là dưới ngưỡng chạm thoải mái. */
  assert.match(coarse, /min-height: 44px/, 'ô tìm kiếm / nút Bộ lọc phải đủ 44px khi chạm')
  assert.match(anchor('.fchip', /white-space:\s*nowrap/, 'không ngắt dòng'),
    /white-space:\s*nowrap/, 'nhãn chip không được tự xuống dòng')
})

test('dải lọc là vạch + chữ, không phải hàng chip: bỏ rãnh, bỏ chấm, bỏ huy hiệu số', () => {
  /* VÒNG 15 — người dùng chỉ ra đúng ba chữ: "phần hiện status xấu quá", "nhìn
     AI". Ba lớp bo tròn xếp lên nhau trên một hàng (rãnh thuốc → chip thuốc →
     huy hiệu số, cộng thêm chấm tròn màu) là khuôn mẫu của mọi bảng điều khiển
     máy sinh. Chốt lại bằng ba vế, đúng ba thứ đã bị gỡ — vì đây là loại thứ
     được "dọn CSS" trả lại đầu tiên khi có người sửa thanh lọc sau này. */
  const strip = anchor('.fchips', /flex-wrap:\s*nowrap/, 'không xuống hàng')
  for (const [prop, re] of [['background', /background\s*:/], ['viền', /border\s*:/], ['bo góc', /border-radius\s*:/]]) {
    assert.doesNotMatch(strip, re, `rãnh của dải lọc không được có ${prop} — đó là lớp bo tròn thừa`)
  }
  assert.equal(bodies('.fchip .fdot').length, 0, 'chấm tròn màu của chip phải bị gỡ (không còn luật nào)')
  assert.doesNotMatch(app, /className="fdot"/, 'JSX cũng không được dựng lại chấm tròn')
  /* Con số chỉ là số: không nền, không huy hiệu. */
  const num = anchor('.fchip .fnum', /var\(--txt-3\)/, 'số của mục lọc')
  assert.doesNotMatch(num, /background\s*:/, 'con số không được nhốt trong một viên thuốc nữa')
  assert.match(num, /font-variant-numeric:\s*tabular-nums/, 'số phải đứng yên khi giá trị đổi')
})

test('mục đang chọn mang đúng màu của nó, và không tô nền', () => {
  /* Màu của một mục lọc là DỮ LIỆU (giai đoạn nào đang có việc), không phải
     trang trí — nó sống trong VẠCH, lấy từ cùng biến `--c` mà thanh tiến độ
     của hàng request đang dùng. */
  assert.ok(has('.fchip .ftick', /background: var\(--c/), 'vạch màu của mục lấy từ biến của chính nó')
  assert.ok(has('.fchip.on .ftick', /opacity:\s*1/), 'mục đang chọn phải giữ vạch ở đủ màu')
  assert.ok(has('.fchip.on .fnum', /var\(--c/), 'số của mục đang chọn mang màu của mục đó')
  /* Vế QUAN TRỌNG NHẤT: không tô nền cho mục đang chọn. Một viên thuốc phết
     màu nhạt là thứ ai cũng vẽ được, và nó chính là thứ làm hàng này đọc ra
     "do máy sinh" — chữ trắng + vạch đầy màu đã nói đủ. */
  assert.ok(!bodies('.fchip.on').some(b => /background\s*:/.test(b)),
    'mục đang chọn không được tô nền (chỉ chữ + vạch)')
})

test('dây chuyền không bị cắt: bốn giai đoạn đứng liền nhau, đúng thứ tự công việc', () => {
  /* Bản cũ xếp FILTERS là queued · picked · newest · top · in_progress ·
     completed, tức "In progress" đứng SAU "Top voted": bốn giai đoạn của cùng
     một dây chuyền bị một trục khác chen vào giữa. Nay thứ tự nhóm là
     pipe → view → you, và trong nhóm pipe là thứ tự việc chạy. */
  const order = [...app.matchAll(/\{\s*k:\s*'(\w+)',\s*c:[^,]+,\s*ax:\s*'(\w+)'\s*\}/g)]
    .map(m => ({ k: m[1], ax: m[2] }))
  assert.deepEqual(order.map(x => x.k), ['queued', 'picked', 'in_progress', 'completed', 'newest', 'top', 'watch'],
    'thứ tự mục lọc đã đổi khỏi thứ tự dây chuyền')
  assert.deepEqual([...new Set(order.map(x => x.ax))], ['pipe', 'view', 'you'],
    'ba nhóm phải đứng liền nhau, không xen kẽ')
  /* Vạch ngăn chỉ mọc ở mục ĐẦU của một nhóm mới, và nhóm vắng mặt thì vạch
     ngăn của nó biến mất theo — không để lại một vạch lẻ giữa hai mục. */
  assert.match(app, /i > 0 && f\.ax !== list\[i - 1\]\.ax && <span className="dot"/,
    'vạch ngăn giữa hai nhóm phải theo nhóm, không viết cứng vào JSX')
  assert.match(app, /FILTERS\.filter\(f => f\.ax !== 'you' \|\| watchedSet\.size > 0\)/,
    'nhóm "đang theo dõi" chỉ hiện khi có bài được theo dõi')
  assert.ok(has('.fchips .dot', /align-self:\s*center/),
    'vạch ngăn phải tự canh giữa hàng (dùng lại lớp .dot của dòng meta)')
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
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
  assert.match(coarse, /\.searchwrap \{ --x-w: 30px; --x-x: 5px; \}/,
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
