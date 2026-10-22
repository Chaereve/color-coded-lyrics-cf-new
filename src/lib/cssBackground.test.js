/* Chốt chặn TĨNH cho lớp nền — sau khi đổi sang mesh tím/hồng lấy bảng màu
   Daily Spin (vòng 31).

   Vì sao cần: trước lần đổi này, `.bgfx` có NĂM khối luật nằm ở bốn chỗ trong
   tệp và ba trong số đó đã vô hiệu (`display: none`). Sửa một chỗ, bốn chỗ
   kia vẫn nói câu cũ — đúng loại nợ đã làm hỏng thanh lọc một lần. Bộ kiểm
   dưới đây giữ cho nền chỉ còn MỘT nguồn sự thật, và khoá hai lỗi đã từng
   xảy ra thật:
     1. "màu đậm quá"  → độ đậm đi qua đúng MỘT biến (--mesh-tone);
     2. "nhạt quá không thấy gì" → giảm độ HAI lần (alpha × opacity) trên
        cùng một lớp. Phép kiểm chốt alpha lõi phải đủ đậm để còn thấy.
   Chạy: npm test */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const cssRaw = at('../index.css')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')   // bỏ ghi chú, chỉ đọc luật
const jsx = at('../components/Background.jsx')

const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({
    sels: sel.split(',').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean),
    body: body.replace(/\s+/g, ' ').trim(),
  }))
const bodies = (sel) => RULES.filter((r) => r.sels.includes(sel)).map((r) => r.body)
/* Nhiều khối cho cùng một selector là BÌNH THƯỜNG ở đây: bản giảm chuyển động
   và bản giảm trong suốt đều nhắc lại `.bgfx` để tắt nó. Nên phép kiểm không
   phải "chỉ một khối" mà là "đúng MỘT khối giữ vai trò gốc" — tìm theo thuộc
   tính làm nên vai trò đó. */
const one = (sel, re) => {
  const hits = bodies(sel).filter((b) => re.test(b))
  assert.equal(hits.length, 1, `\`${sel}\` phải có đúng một khối ${re} (đang có ${hits.length})`)
  return hits[0]
}

test('nền chỉ có MỘT nguồn sự thật: không còn luật .bgfx thứ hai', () => {
  one('.bgfx', /position:\s*fixed/)
  /* Hai tên cũ đã chết hẳn — để lại là mầm "sửa một chỗ, bốn chỗ nói câu cũ". */
  assert.doesNotMatch(css, /\.bgfx-aurora|\.bgfx-grain|auroraDrift/,
    'tàn dư của nền aurora cũ phải bị xoá')
  one('.bgfx-mesh', /animation:\s*meshDrift/)   // bản giảm chuyển động được phép nhắc lại tên này
  assert.equal(bodies('.bgfx-veil').length, 1, 'lớp tối viền phải có đúng một khối')
})

test('độ đậm đi qua ĐÚNG một biến, và đủ đậm để còn thấy', () => {
  const mesh = one('.bgfx-mesh', /opacity:/)
  assert.match(mesh, /opacity:\s*var\(--mesh-tone\)/, 'cả nhóm màu qua một cửa opacity duy nhất')
  /* Lỗi v36: hạ alpha lõi XUỐNG .42 rồi nhân thêm opacity .45 → .19, mất hút.
     Nay lõi giữ alpha .82–.96 và bù lại phần bị blur làm loãng. */
  const alphas = [...css.matchAll(/radial-gradient\(circle at 50% 50%,\s*var\(--mesh-\d\) 0%/g)]
  assert.ok(alphas.length >= 3, 'các khối màu phải là gradient tròn quanh một token')
  /* Lõi phải đặc (1.0) — mọi độ trong suốt nằm ở các điểm dừng phía ngoài. */
  assert.doesNotMatch(css, /radial-gradient\(circle at 50% 50%,\s*color-mix/, 'điểm dừng đầu phải là màu gốc đặc')
  assert.match(css, /--mesh-tone:\s*\.4\s*;/, 'mức đã chốt với chủ dự án là 40%')
})

test('nền KHÔNG dùng filter blur và chỉ có MỘT thứ chuyển động', () => {
  /* Sự cố thật: mỗi khối tự trôi, mỗi khối mang filter blur 78px + mix-blend
     screen, khối phủ 46–96% khung hình. Mỗi khung hình là bốn texture cỡ màn
     hình phải làm nhoè lại; trên GPU yếu tiến trình vẽ chết và cả trang đứng
     ở một màu phẳng — người dùng thấy "trang đen", "sandbox không khởi động".
     Chốt: không filter trên bất kỳ khối nào, và animation chỉ nằm trên NHÓM,
     chỉ dùng transform. Độ mềm lo bằng điểm dừng gradient. */
  const bgRules = css.match(/\.bgfx[^{]*\{[^}]*\}/g) || []
  for (const r of bgRules) assert.doesNotMatch(r, /filter:/, 'lớp nền không được dùng filter')
  for (const body of bodies('.bgfx-mesh i')) {
    assert.doesNotMatch(body, /animation:/, 'khối con phải đứng yên')
  }
  assert.match(one('.bgfx-mesh', /opacity:/), /animation:\s*meshDrift\s/, 'chỉ nhóm được trôi')
  const kf = css.match(/@keyframes meshDrift\s*\{([^@]*)\}/)
  assert.ok(kf, 'phải có keyframes meshDrift')
  assert.doesNotMatch(kf[1], /filter|box-shadow/, 'chuyển động chỉ được là transform')
  assert.match(kf[1], /transform:/)
})

test('khối phải trải rộng: gradient tắt dần tới ≥80% bán kính', () => {
  /* Lỗi gốc của "trang đen": lõi sáng nhỏ rồi tắt ở 72% → ở mức 40% chỉ còn
     bốn đốm trên nền đen. Điểm dừng phải kéo ra gần mép thì bốn khối mới nối
     thành một mảng sáng phủ khung. */
  const stops = [...css.matchAll(/radial-gradient\(circle at 50% 50%,[\s\S]*?transparent (\d+)%\)/g)]
    .map((m) => Number(m[1]))
  assert.equal(stops.length, 4, 'bốn khối, bốn gradient')
  for (const end of stops) assert.ok(end >= 80, `gradient phải tắt dần tới ≥80% (đang ${end}%)`)
  assert.match(css, /--mesh-tone:\s*\.4\s*;/, 'mức đã chốt với chủ dự án là 40%')
})

test('bảng màu lấy đúng bốn mã của Daily Spin, không tự bịa màu thứ năm', () => {
  const spin = at('../components/DailySpin.css')
  for (const [token, hex] of [
    ['--mesh-1', '#5d22e1'], ['--mesh-2', '#3d05dd'],
    ['--mesh-3', '#dc94ef'], ['--mesh-4', '#fcb0f3'],
  ]) {
    assert.match(css, new RegExp(`${token}:\\s*${hex}\\s*;`), `${token} phải là ${hex}`)
    assert.match(spin, new RegExp(hex, 'i'), `${hex} phải có thật trong DailySpin.css`)
  }
})

test('khung nền: fixed, kín màn hình, không 100dvh; body chỉ mang màu gốc', () => {
  const bgfx = one('.bgfx', /position:\s*fixed/)
  assert.match(bgfx, /inset:\s*0/)
  assert.match(bgfx, /z-index:\s*-1/)
  assert.doesNotMatch(bgfx, /100dvh|100vh/, 'chiều cao theo viewport làm nền giật trên mobile')
  /* body không được vẽ gradient thứ hai — nếu có, hai lớp màu chồng nhau và
     "đổi độ đậm" lại thành chuyện của hai chỗ. */
  const body = one('body', /background:/)
  assert.match(body, /background:\s*var\(--mesh-base\)/)
  assert.doesNotMatch(body, /radial-gradient|linear-gradient/, 'body chỉ là màu phẳng')
})

test('Daily Spin vẫn có nền riêng; giảm chuyển động vẫn tắt được', () => {
  assert.match(css, /html\[data-section="spin"\] \.bgfx\s*\{[^}]*display:\s*none/,
    'trang quay số ẩn nền dùng chung (chạy cả trước khi trang lazy tải)')
  assert.match(css, /prefers-reduced-motion[\s\S]{0,400}\.bgfx-mesh \{ animation: none/,
    'giảm chuyển động: dừng trôi, giữ màu')
})

test('JSX chỉ dựng khung: bốn khối + lớp tối, không logic', () => {
  assert.match(jsx, /className="bgfx"/)
  assert.match(jsx, /className="bgfx-mesh"/)
  assert.equal((jsx.match(/<i\s*\/>/g) || []).length, 4, 'đúng bốn khối sáng')
  assert.doesNotMatch(jsx, /useState|useEffect|onClick/, 'nền không giữ state, không bắt sự kiện')
  assert.match(jsx, /aria-hidden="true"/, 'nền là trang trí: phải ẩn với trình đọc màn hình')
})
