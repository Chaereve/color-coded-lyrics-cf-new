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
const read = (rel) => readFileSync(`${root}/${rel}`, 'utf8')

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
  assert.match(ruleOf('.status.s-pending::before'), /border:\s*1px solid color-mix/,
    'vòng chờ duyệt mảnh và mờ để không tranh với hàng đã vào hàng')
  assert.match(ruleOf('.status.s-queued::before'), /background:\s*none/,
    'đã xếp hàng là vòng rỗng')
  assert.match(ruleOf('.status.s-queued::before'), /border:\s*2px solid var\(--c/,
    'vòng của hàng đã xếp phải DÀY hơn hẳn vòng chờ duyệt — độ dày đọc được ở cỡ 7px, độ mờ thì không')
  /* Đang làm: VÒNG HỞ. Bản đầu dùng "chấm đặc + quầng" và Completed dùng "chấm
     đặc + viền mảnh" — ảnh chụp thật cho thấy hai cái chỉ khác nhau 2px đường
     kính, mắt đọc ra hai chấm có quầng. Nay đèn đổi sang bộ hình cấu trúc:
     rỗng (chờ / đã xếp) · hở (đang làm) · đặc (xong) · đứt (từ chối). */
  const prog = ruleOf('.status.s-in_progress::before')
  assert.match(prog, /border-right-color:\s*transparent/,
    'đang làm là vòng HỞ — khúc khuyết mới là thứ đọc ra "đang chạy" ở cỡ 7px')
  assert.match(prog, /animation:\s*status-spin/, 'vòng hở xoay chậm để nói "đang chạy"')
  assert.doesNotMatch(prog, /box-shadow/, 'bỏ quầng: nó chỉ làm chấm nhoè, không phân biệt được với trạng thái khác')
  assert.match(bare, /@media \(prefers-reduced-motion: reduce\) \{ \.status\.s-in_progress::before \{ animation: none/,
    'ai tắt hiệu ứng thì vòng đứng yên')
  /* Xong: chấm đặc trơn. */
  const done = ruleOf('.status.s-completed::before')
  assert.match(done, /background:\s*var\(--c, var\(--done\)\)/, 'xong là chấm đặc trơn')
  assert.doesNotMatch(done, /box-shadow/, 'không quầng — "đầy" thì vẽ đầy, không phát sáng')
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
  assert.match(paid, /color-mix\(in oklab, var\(--paid\) 7%/,
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

/* =========================================================
   "IN QUEUE" VÀ "UP NEXT" PHẢI KHÁC MÀU
   ---------------------------------------------------------
   Chủ dự án: "màu của up next vs in queue đang quá giống nhau". Đúng, và lý do
   nằm ở tầng dữ liệu: cả hai đều là `status === 'queued'`, nên chỗ nào gọi
   `statusColor(r.status)` là ra cùng một sắc. Nhãn đã tách từ trước
   (`statusLabel` trả "Up next" cho bài đã chốt) nhưng MÀU thì chưa tách theo.
   Bài này chốt: màu đi theo cặp với nhãn, và mọi chỗ vẽ nhãn đi qua một hàm.
   ========================================================= */
test('Up next có sắc riêng, không dùng chung --queued với In queue', async () => {
  const { statusColorOf } = await import('./meta.js')
  const picked = { status: 'queued', picked_at: '2026-10-01T00:00:00Z' }
  const waiting = { status: 'queued', picked_at: null }
  assert.equal(statusColorOf(picked), 'var(--upnext)', 'bài đã chốt vào Up next phải mang màu upnext')
  assert.equal(statusColorOf(waiting), 'var(--queued)', 'bài còn trong hàng giữ màu queued')
  /* Hai token phải thật sự khác nhau — nếu ai đó đặt chúng bằng nhau thì phép
     kiểm trên vẫn xanh mà màn hình lại y như cũ. */
  const tok = (name) => bare.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  const queued = tok('queued')
  const upnext = tok('upnext')
  assert.ok(queued && upnext, 'thiếu token --queued hoặc --upnext')
  assert.notEqual(queued.toLowerCase(), upnext.toLowerCase(),
    'hai bậc khác nhau của dây chuyền không được dùng chung một mã màu')
})

test('mọi nhãn trạng thái lấy màu qua statusColorOf, không tự tra theo chuỗi', () => {
  const files = ['src/App.jsx', 'src/components/AdminPanel.jsx', 'src/components/PublicProfile.jsx']
  for (const f of files) {
    const src = readFileSync(`${root}${f}`, 'utf8')
    assert.doesNotMatch(src, /statusColor\(/, 
      `${f} còn gọi statusColor(...) trực tiếp — đó là chỗ làm Up next trùng màu In queue`)
    assert.match(src, /statusColorOf\(/, `${f} phải lấy màu qua statusColorOf`)
  }
  /* Chip lọc: Queue và Up next là hai mục khác nhau thì hai màu khác nhau. */
  assert.match(app, /\{ k: 'picked',\s+c: 'var\(--upnext\)'/,
    'chip "Up next" phải mang màu upnext, cùng màu với nhãn trên hàng')
  /* Nhãn Up next trong .tags cũng vậy — cùng một hàng, cùng một sắc. */
  const upnext = ruleOf('.pill.upnext')
  assert.match(upnext, /color:\s*var\(--upnext\)/)
  assert.match(upnext, /border:\s*0/, 'nhãn Up next theo khuôn pill mềm của tem PAID: không viền')
  /* Hộp thư cũng vậy: tin "đã chốt vào Up next" và tin "đã duyệt" là hai bước
     khác nhau, không được cùng một màu. */
  const notes = readFileSync(`${root}src/components/Notifications.jsx`, 'utf8')
  assert.match(notes, /picked:\s*'var\(--upnext\)'/,
    'tin "picked" trong hộp thư phải mang màu upnext')
  assert.match(notes, /approved:\s*'var\(--queued\)'/,
    'tin "approved" vẫn là bước vào hàng, giữ màu queued')
})

/* =========================================================
   BẢNG MÀU NEON — MỘT NGUYÊN TẮC
   ---------------------------------------------------------
   Độ bão hoà dành cho thứ CÓ NGHĨA (trạng thái, tem PAID); thẻ thể loại là
   metadata nên trầm. Bài này chốt hai vế: các sắc trạng thái phải thật sự KHÁC
   nhau (không chỉ khác tên), và bốn thẻ thể loại phải cùng một mức bão hoà
   thấp — nếu ai đó "làm mới" bằng cách trả thẻ loại về màu bão hoà gốc thì hàng
   lại có 9 sắc chói cạnh nhau.
   ========================================================= */
test('bảng màu: sáu sắc gắt, tách hẳn nhau, và "đang làm" mang chính màu nhấn', () => {
  const hexOf = (name) => bare.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, 'i'))?.[1]
  const rgb = (h) => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  const hue = (h) => {
    const [r, g, b] = rgb(h)
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    if (!d) return 0
    let x
    if (mx === r) x = ((g - b) / d) % 6
    else if (mx === g) x = (b - r) / d + 2
    else x = (r - g) / d + 4
    return ((x * 60) % 360 + 360) % 360
  }
  const sep = (a, b) => Math.abs(((hue(a) - hue(b) + 540) % 360) - 180)

  const statuses = ['pending', 'queued', 'upnext', 'progress', 'done', 'denied']
  for (const s of statuses) assert.ok(hexOf(s), `thiếu token --${s}`)
  const seen = new Set(statuses.map(s => hexOf(s).toLowerCase()))
  assert.equal(seen.size, statuses.length, 'hai trạng thái đang dùng chung một mã màu')

  /* TÁCH HẲN NHAU VỀ HUE. Đây là vế mà bản "hạ bão hoà" đã đánh mất: xanh nhạt
     và tím nhạt cách nhau 20° thì ở cỡ 7px là một màu. Ngưỡng 25° loại đúng
     kiểu đó ra. (Pending được miễn: nó là xám, cố ý gần như không có hue.) */
  const strong = ['queued', 'upnext', 'progress', 'done', 'denied']
  for (let i = 0; i < strong.length; i++) {
    for (let j = i + 1; j < strong.length; j++) {
      const a = hexOf(strong[i]), b = hexOf(strong[j])
      assert.ok(sep(a, b) >= 25,
        `--${strong[i]} và --${strong[j]} chỉ cách nhau ${sep(a, b).toFixed(0)}° hue — ở cỡ 7px là một màu`)
    }
  }
  /* SỢI DÂY VỚI MÀU NHẤN, và nó là sợi dây NGHĨA: "đang làm" mang chính --a-2.
     Không bẻ năm sắc còn lại về họ indigo nữa — đó là thứ làm bảng nhạt đi. */
  const accent2 = bare.match(/--a-2:\s*#([0-9a-f]{6})/i)[1]
  assert.equal(hexOf('progress').toLowerCase(), accent2.toLowerCase(),
    'trạng thái "đang làm" phải mang đúng màu nhấn sáng của trang (--a-2)')
  /* Chữ nhãn: không pha xám quá tay. Nhãn pha 62% xám là lý do hàng trông bợt. */
  assert.match(ruleOf('.status'), /88%/,
    'chữ nhãn trạng thái chỉ được pha 12% xám — pha nhiều là mất màu')
})

/* =========================================================
   ĐỒNG BỘ SAU KHI ĐỔI BẢNG MÀU.
   Ba nhóm lỗi dưới đây đều là lỗi *cũ*, chỉ lộ ra khi cả bảng màu đổi: một quy
   tắc viết tay còn sót, một khai báo chết đè lên khai báo mới, và một nơi lấy
   màu nhấn cho thứ không phải màu nhấn. Khoá lại để lần đổi màu sau không phải
   đi mò lại từ đầu.
   ========================================================= */
test('không còn mã màu viết tay của bảng màu cũ trong CSS', () => {
  /* Ba bộ rgba cũ: xanh lá #4CBA88 (done cũ), đỏ #E26E69 (denied cũ), vàng
     #D7A63F (paid cũ). Sau khi token đổi, chúng vẫn vẽ ra ba màu không còn tồn
     tại ở đâu khác trên trang. */
  const stale = [/rgba\(\s*76,\s*186,\s*136/, /rgba\(\s*226,\s*110,\s*105/, /rgba\(\s*215,\s*166,\s*63/]
  for (const re of stale) {
    const hit = css.split('\n').map((l, i) => [l, i + 1]).filter(([l]) => re.test(l) && !/^\s*(\/\*|\*)/.test(l))
    assert.equal(hit.length, 0, `màu cũ còn sót ở dòng ${hit.map(h => h[1]).join(', ')} — dùng color-mix với token`)
  }
})

test('mỗi nhãn trạng thái chỉ được khai báo nền MỘT lần', () => {
  /* `.pill.gold` từng bị khai báo lại ở cuối file bằng rgba vàng cũ: cùng độ ưu
     tiên, bản sau thắng — nên đổi token ở tem PAID không có tác dụng gì. */
  const decls = [...css.matchAll(/^\.pill\.(gold|upnext)\s*\{([^}]*)\}/gm)]
  const byCls = {}
  for (const m of decls) {
    if (!/background/.test(m[2])) continue
    byCls[m[1]] = (byCls[m[1]] || 0) + 1
  }
  for (const [k, n] of Object.entries(byCls)) {
    assert.equal(n, 1, `.pill.${k} khai báo nền ${n} lần — bản sau sẽ đè bản trước`)
  }
})

test('không dùng --progress cho thứ không phải giai đoạn "đang làm"', () => {
  /* --progress giờ TRÙNG --a-2. Nơi nào lấy nó để nói "chú ý" hay "đã pick" thì
     ra đúng màu nút bấm, và hai ô thống kê cạnh nhau thành một màu. Cảnh báo
     dùng --warn, suất đã chốt dùng --upnext. */
  assert.doesNotMatch(ruleOf('.ferr.warn'), /--progress/, 'cảnh báo trong form không được mang màu nhấn')
  assert.doesNotMatch(ruleOf('.pick-cd.over b'), /--a-2|--progress/, 'đồng hồ quá mốc là CẢNH BÁO, không phải nhấn')
  assert.match(ruleOf('.pick-cd.over b'), /var\(--warn\)/, 'đồng hồ quá mốc phải dùng --warn')
  assert.match(read('src/index.css'), /--warn:\s*#/, 'thiếu token --warn')
  /* Ô thống kê "đã pick" không được mượn --a-2 (đã trùng --progress). */
  const statPicked = app.split('\n').filter(l => /<Stat\s+c=/.test(l) && /stage\.picked/.test(l))
  assert.equal(statPicked.length, 1, 'không tìm thấy ô thống kê "đã pick"')
  assert.match(statPicked[0], /var\(--upnext\)/, 'ô "đã pick" phải mang màu Up next')
  /* Tab admin "đã pick" cũng vậy. */
  const tabs = read('src/lib/adminTabs.js')
  const pickedTab = tabs.split('\n').find(l => /k: 'picked'/.test(l))
  assert.match(pickedTab, /var\(--upnext\)/, 'tab admin "đã pick" phải mang màu Up next')
})

test('Up next và trang trí Up next mang --upnext, không mượn --queued', () => {
  for (const sel of ['.now-n', '.pick-cd b']) {
    assert.match(ruleOf(sel), /var\(--upnext\)/, `${sel} phải mang màu Up next`)
  }
})

test('nhãn thể loại đọc ra cùng một chữ ở mọi nơi', () => {
  /* Hàng công khai in tên ngắn ("CCL"), admin và tấm vote lại in tên đầy đủ
     ("Color-coded lyrics") — cùng một bài, hai chữ khác nhau trên hai màn hình. */
  for (const f of ['src/components/AdminPanel.jsx', 'src/components/ActionModal.jsx', 'src/components/VoteModal.jsx']) {
    const txt = read(f)
    assert.match(txt, /kindShort\(/, `${f} phải dùng kindShort cho nhãn thể loại`)
  }
})
