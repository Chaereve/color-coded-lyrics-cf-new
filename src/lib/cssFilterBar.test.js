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
test('.fbar dính mép trên khi cuộn, và dấu hiệu "đang dính" chỉ thêm viền + bóng', () => {
  const bar = anchor('.fbar', /position:\s*sticky/, 'dính mép trên')
  assert.match(bar, /position:\s*sticky/)
  assert.match(bar, /top:\s*0/)
  assert.match(bar, /z-index:\s*\d+/)
  /* nền mờ để chữ bên dưới không lộ qua; máy không có backdrop-filter vẫn phải đục */
  const fallback = bodies('.fbar').join(' ')
  assert.match(fallback, /backdrop-filter/)
  assert.match(css, /@supports not \(backdrop-filter/, 'phải có đường lui cho máy không hỗ trợ')
  assert.match(anchor('.fbar.stuck', /border-color/), /border-color/)
  assert.match(anchor('.fbar.stuck', /box-shadow/), /box-shadow/)
})

test('máy hẹp: nút Bộ lọc hiện ra, khối lọc thứ hai gấp lại cho tới khi bấm', () => {
  const mq = css.slice(css.indexOf('@media (max-width: 620px)'))
  assert.match(mq, /\.fmore \{ display: inline-flex/, 'nút Bộ lọc phải hiện trên máy hẹp')
  assert.match(mq, /\.fbar:not\(\.open\) \.fbar-more \{ display: none/, 'khối lọc phải gấp lại mặc định')
  assert.match(mq, /\.fbar\.open \.fbar-more/, 'bấm thì khối lọc phải mở ra')
  assert.match(mq, /\.fcount \{ display: none/, 'dòng đếm nhường chỗ cho nút Bộ lọc')
})

test('chip lọc đủ to để chạm trên thiết bị cảm ứng, bản desktop không đổi', () => {
  assert.ok(/@media \(pointer: coarse\)/.test(css), 'phải có một luật riêng cho thiết bị chạm')
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
  assert.match(coarse, /\.fchip \{ min-height: 4\dpx/, 'chip phải cao ≥40px trên cảm ứng')
  assert.match(anchor('.fchip', /white-space:\s*nowrap/, 'không ngắt dòng'),
    /white-space:\s*nowrap/, 'nhãn chip không được tự xuống dòng')
})

test('nhãn đang chọn mang đúng màu của nó, không dùng màu trang trí chung', () => {
  assert.ok(has('.fchip.on', /var\(--c\)/), 'chip đang chọn phải ăn màu của chính nó')
  assert.ok(has('.fchip .fdot', /background: var\(--c/), 'chấm màu của chip lấy từ cùng biến')
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
