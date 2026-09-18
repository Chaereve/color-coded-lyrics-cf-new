/* Chốt chặn TĨNH cho hộp thông báo: cùng một kiểu lỗi mà mắt người dùng thấy
   còn tool thì không — "mỗi khối tự cham một số đo". Trong popover, header,
   nhãn nhóm, dòng tin và dòng cài đặt đều phải chung một khoảng lùi; trước đây
   nó là 12 / 12 / 13 / (10+2) / 14 nên chữ so le 1–2px và muốn sửa một khối là
   ba khối kia lệch theo. Kèm hai điều đã thỏa thuận với người dùng: bấm một tin
   là NHẢY xuống dòng request, không mở hộp thoại — nên hộp thoại đó (và CSS của
   nó, và dòng đếm ngược ở nhãn nhóm) không được quay lại.

   Sandbox không có trình duyệt nên chỉ đo được bằng văn bản; ảnh chụp màn hình
   vẫn là người dùng duyệt. Xem thêm src/lib/cssGridRows.test.js.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const css = readFileSync(at('../index.css'), 'utf8')
const panel = readFileSync(at('../components/Notifications.jsx'), 'utf8')
/* bỏ comment để không đếm cả những gì nằm trong ghi chú */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
const cssRaw = css   // CSS GOC con comment: `bare` o tren da boc comment di

const PITCH = 12

/* quy tắc đầu tiên (bản desktop) của một selector */
function block(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = bare.match(new RegExp(`(^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`))?.[2] || ''
  assert.ok(body, `không tìm thấy quy tắc CSS cho ${sel}`)
  return body
}
/* padding shorthand -> khoảng lùi trái/phải, tính bằng px */
function padXY(body) {
  const raw = body.match(/(?:^|[;{\s])padding:\s*([^;}]+)/)?.[1]
  if (!raw) return { l: 0, r: 0 }
  const n = (x) => (x === '0' ? 0 : Number(x.replace(/px$/, '')))
  const v = raw.trim().split(/\s+/).map(n)
  if (v.some(Number.isNaN)) return { l: NaN, r: NaN }
  if (v.length === 1) return { l: v[0], r: v[0] }
  if (v.length <= 3) return { l: v[1], r: v[1] }
  return { l: v[3], r: v[1] }
}

test('trong popover, mọi khối cùng một khoảng lùi 12px (bản desktop)', () => {
  /* .nt-pop KHÔNG được cộng padding ngang: nếu cộng thì mọi con số dưới đây
     bị đẩy thêm, và bảng sẽ có hai hệ tọa độ cùng lúc. */
  const pop = padXY(block('.nt-pop'))
  assert.equal(pop.l, 0, '.nt-pop phải bỏ trống mép ngang cho các khối tự lo')
  assert.equal(pop.r, 0, '.nt-pop phải bỏ trống mép ngang cho các khối tự lo')

  for (const sel of ['.nt-head', '.nt-grp-h', '.nt-pref', '.nt-empty']) {
    const p = padXY(block(sel))
    assert.equal(p.l, PITCH, `${sel}: mép trái phải ${PITCH}px như header`)
    assert.equal(p.r, PITCH, `${sel}: mép phải phải ${PITCH}px như header`)
  }
  /* dòng tin: chữ tính từ mép trái, cụm nút tính từ mép phải */
  assert.equal(padXY(block('.nt-hit')).l, PITCH, '.nt-hit: dot phải thẳng cột với nhãn nhóm')
  const right = padXY(block('.nt-i')).r + padXY(block('.nt-acts')).r
  assert.equal(right, PITCH, 'mép phải của cụm nút = .nt-i + .nt-acts, không được cộng lẻ (10+2)')
})

test('bản hẹp (<=620px) giữ đúng con số đó, không tự bày số khác', () => {
  assert.match(bare, /\.nt-i\s*\{[^}]*padding-right:\s*12px/, 'mobile: mép phải 12px')
  assert.match(bare, /\.nt-hit\s*\{[^}]*padding-left:\s*12px/, 'mobile: mép trái 12px')
  assert.match(bare, /\.nt-acts\s*\{[^}]*padding:\s*0 0 9px 12px/, 'mobile: hàng nút dưới lùi 12px')
})

test('mọi nút trong hộp thông báo đều có vòng focus bàn phím', () => {
  /* App KHONG con gi danh sach ten cho :focus-visible nua — mot danh sach la
     mot luong thung moi khi them nut (quyet 2026-09-08: 32 class nut khong duoc
     lie ke). index.css chot bang THE, nen o day ba dieu phai giu:
     (1) quy tắc the con day; (2) khong ai `outline: none` cho nut/link ma khong
     thay bang dau khac; (3) moi ngoai le (offset am / bo goc) phai duoc ghi ten
     ben canh ly do — tuc la phai con COMMENT o rule cua no. */
  assert.match(bare, /(^|\n)\s*button:focus-visible[^{]*\{[^}]*outline:\s*2px solid/)
  assert.match(bare, /a:focus-visible[^{]*\{[^}]*outline:\s*2px solid/)
  const btnRules = (cssRaw.match(/[^{}]*button[^{}]*:focus-visible[^{]*\{[^}]*\}/g) || [])
  for (const r of btnRules) {
    if (/outline:\s*none/.test(r) && !/input|select|textarea/.test(r)) {
      assert.fail(`nut bi tat outline ma khong co dau thay the: ${r.slice(0, 70)}`)
    }
  }
  assert.match(cssRaw, /\.nt-hit:focus-visible[^{]*\{[^}]*outline-offset:\s*-2px/,
    'ngoai le offset am cua .nt-hit phai con, va phai co comment giai thich o tren')
  assert.ok(!/\.nt-btn:focus-visible|\.nt-back:focus-visible/.test(cssRaw),
    'dung them ten tung nut vao danh sach — quy tac the da bao, danh sach la loi')
})


test('bấm một tin là nhảy tới request: không hộp thoại, không đồng hồ ở nhãn nhóm', () => {
  assert.ok(!existsSync(at('../components/SongPopup.jsx')),
    'hộp thoại "This song" đã bỏ theo yêu cầu người dùng — bấm tin phải đưa tới hàng request')
  assert.ok(!/\.modal\.pop\b|\.pop-(song|why|tag|reason|meta|acts|hint)\b/.test(bare),
    'CSS của hộp thoại đã xoá vẫn còn trong index.css (xong việc là xoá hết, để lại là ma)')
  assert.ok(!/import Countdown/.test(panel),
    'bảng thông báo không được nhúng lại đồng hồ; đầu nhóm "Needs your votes" là nut Vote now')
  assert.ok(!/\.nt-grp-h\s+\.pick-cd/.test(bare),
    'không có quy tắc cứu chữ của Countdown trong header nữa — Countdown không nằm ở đó')
})
