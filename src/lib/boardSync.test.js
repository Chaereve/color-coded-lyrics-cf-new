/* Chốt chặn "SỐ PHẢI KHỚP VỚI THỨ ĐƯỢC LIỆT KÊ" + màn chờ phải có mặt.
   ---------------------------------------------------------
   Lỗi chủ dự án báo (19/09) không nằm ở một dòng code sai, mà ở chỗ các con số
   được đếm theo BA đơn vị khác nhau cho cùng một bảng:

     · badge tab đếm theo DÒNG, còn danh sách gom theo BÀI (một bài gửi ba lần
       là một thẻ) → "3" mà dưới chỉ có 1 thẻ;
     · "đã chốt nhưng chưa khởi động" không được đếm ở ô nào cả → bốn ô thống
       kê cộng lại thiếu so với bảng, và mục Up next nhìn như hệ thống khác;
     · hàng trên bảng, thẻ Up next và bảng Admin mỗi nơi tự ghép nhãn trạng thái
       → cùng một bài, ba chỗ gọi tên khác nhau.

   Ba điều đó không nhìn ra bằng mắt qua một lần chạy thử (số chỉ lệch khi có
   bài trùng hoặc bài đã chốt mà chưa làm), nên phải chốt bằng văn bản:

     1) songCount() và stageCounts() đếm theo bài, và bốn giai đoạn cộng đúng
        bằng tổng;
     2) App.jsx lấy số của khối thống kê từ stageCounts, số của khối Up next từ
        pickedGroups — không còn `.length` trên mảng dòng ở chỗ nào hiển thị
        cạnh danh sách gom cụm;
     3) nhãn trạng thái chỉ có MỘT hàm (statusLabel) cho cả ba nơi;
     4) màn chờ không đọc/ghi storage (hiện mỗi lần tải trang), có SÀN và TRẦN,
        và nhịp vào của nó khép trong khoảng sàn đó.

   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { songCount, stageCounts, groupKey } from './board.js'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const app = readFileSync(at('../App.jsx'), 'utf8')
const notifications = readFileSync(at('../components/Notifications.jsx'), 'utf8')
const css = readFileSync(at('../index.css'), 'utf8')
const metaSrc = readFileSync(at('./meta.js'), 'utf8')

const row = (o) => ({ artist: 'aespa', title: 'Whiplash', status: 'queued', votes: 0, ...o })
/* Bóc khối `const counts = useMemo(...)` để soi từng dòng số. */
const counts = app.match(/const counts = useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[pub/)?.[1]
const lineOf = (key) => counts?.match(new RegExp(`\\b${key}: ([^,]+),`))?.[1] || ''

test('songCount đếm BÀI trong tập dòng, không đếm dòng', () => {
  const rows = [row({}), row({ artist: '  AESPA ', title: 'whiplash' }), row({ artist: 'ILLIT', title: 'Lalaluka' })]
  assert.equal(rows.length, 3)
  assert.equal(songCount(rows), 2, 'ba dòng, hai bài')
  assert.equal(songCount([]), 0)
  assert.equal(songCount(undefined), 0)
  /* Cùng một phép gom với danh sách (groupKey): hai chỗ phải ra một số. */
  assert.equal(songCount(rows), new Set(rows.map(groupKey)).size)
})

test('stageCounts: bốn giai đoạn không chồng nhau và cộng đúng bằng tổng số bài', () => {
  const rows = [
    row({}),                                                     // chờ vote
    row({ title: 'Mantra' }),                                    // chờ vote
    row({ title: 'Mantra' }),                                    // trùng bài -> vẫn một
    row({ title: 'Supernova', picked_at: '2026-09-01T00:00:00Z' }),          // đã chốt, chưa làm
    row({ title: 'Armageddon', status: 'in_progress', picked_at: '2026-08-01T00:00:00Z' }),
    row({ title: 'Armageddon', status: 'in_progress', picked_at: '2026-08-01T00:00:00Z' }), // trùng
    row({ title: 'Drama', status: 'completed', picked_at: '2026-07-01T00:00:00Z' }),
    row({ title: 'Spicy', status: 'pending' }),                  // chưa công bố: không tính
    row({ title: 'Savage', status: 'denied' }),
  ]
  const c = stageCounts(rows)
  assert.deepEqual({ ...c }, { queued: 2, picked: 1, in_progress: 1, completed: 1, total: 5 })
  assert.equal(c.queued + c.picked + c.in_progress + c.completed, c.total,
    'bốn giai đoạn phải cộng lại đúng tổng — hở một giai đoạn là có bài vô hình')
  /* in_progress mà chưa có picked_at vẫn là "đang chạy", không rơi về queued */
  const c2 = stageCounts([row({ status: 'in_progress' })])
  assert.deepEqual({ ...c2 }, { queued: 0, picked: 0, in_progress: 1, completed: 0, total: 1 })
  assert.equal(stageCounts([]).total, 0)
  /* một bài nằm ở nhiều trạng thái thì lấy giai đoạn cao nhất, không nhân đôi */
  const c3 = stageCounts([row({}), row({ status: 'in_progress', picked_at: 'x' })])
  assert.equal(c3.total, 1)
  assert.equal(c3.in_progress, 1)
  assert.equal(c3.queued, 0)
})

test('khối thống kê lấy số từ bốn giai đoạn, không đếm dòng', () => {
  assert.match(app, /const stage = useMemo\(\(\) => stageCounts\(pub\)/, 'phải có stageCounts(pub)')
  const stats = app.match(/<div className="stats"[\s\S]*?<\/div>/)?.[0] || ''
  assert.ok(stats, 'không đọc được khối .stats trong App.jsx')
  const labels = [...stats.matchAll(/label=\{t\('(stat\.[a-zA-Z]+)'\)\}/g)].map((m) => m[1])
  assert.deepEqual(labels, ['stat.queued', 'stat.picked', 'stat.inProgress', 'stat.completed'],
    'bốn ô thống kê đúng là bốn giai đoạn, theo thứ tự')
  /* Bốn ô thống kê lấy THẲNG từ stageCounts: bốn giai đoạn không chồng nhau,
     cộng lại bằng tổng số bài. Trước đây hai ô đọc `counts.*` nên vô tình phụ
     thuộc vào cách đếm của badge tab — hai thứ có mục đích khác nhau. */
  for (const v of ['stage.queued', 'stage.picked', 'stage.in_progress', 'stage.completed']) {
    assert.ok(stats.includes(`v={${v}}`), `khối thống kê phải lấy ${v}`)
  }
  assert.ok(!/stat\.paid/.test(app), 'ô "Paid" cũ không phải một giai đoạn — nó phá phép cộng')
})

test('badge tab và khối Up next cùng lấy từ pickedGroups', () => {
  assert.match(lineOf('picked'), /pickedGroups\.length/,
    'tab "Up next" liệt kê cả dây chuyền nên badge = số bài trong pickedGroups')
  assert.match(lineOf('queued'), /songCount\(/,
    'tab "Queue" phải đếm theo bài — đếm theo dòng là badge lệch với danh sách gom cụm')
  for (const key of ['newest', 'top']) {
    assert.match(lineOf(key), /songCount\(/, `counts.${key} phải đếm theo bài`)
  }
  assert.match(lineOf('in_progress'), /pickedGroups\.length/,
    'badge tab In progress phải bằng số thẻ tab đó liệt kê — cùng tập với Up next')
  assert.match(app, /if \(filter === 'in_progress'\) base = picked/,
    'tab In progress liệt kê CẢ dây chuyền đã chốt (chủ dự án chốt 19/09), không chỉ bài đang chạy')
  /* Dây chuyền = đã chốt HOẶC đang làm. Thiếu vế thứ hai thì một bài
     in_progress mà không có picked_at (admin tick mốc trên request chưa chốt)
     biến mất khỏi mọi tab — Queue vì status khác, Up next/In progress vì thiếu
     picked_at, Done vì chưa xong. */
  assert.match(metaSrc, /export const inChain = \(r\) => isPicked\(r\) \|\| r\?\.status === 'in_progress'/,
    'inChain phải là phép HOẶC của isPicked và status in_progress')
  assert.match(app, /pub\.filter\(inChain\)/,
    'danh sách dây chuyền phải lọc bằng inChain, không phải isPicked')
  /* Nắp khối Up next: con số lớn + dòng tách giai đoạn cộng đúng bằng nó */
  const nowN = app.match(/<span className="now-n"[^>]*>\{([^}]+)\}/)?.[1]
  assert.equal(nowN, 'pickedGroups.length', 'số trên nắp khối Up next phải là số bài đã chốt')
  assert.match(app, /const working = useMemo\(\(\) => pickedGroups\.filter\(g => g\.rep\.status === 'in_progress'\)\.length/,
    'số bài đang chạy phải đếm trên chính pickedGroups (rep = in_progress nếu bài có dòng đang chạy)')
  assert.match(app, /t\('now\.split', \{ a: working, b: pickedGroups\.length - working \}\)/,
    'dòng tách phải lấy hai phần bù nhau của CÙNG một con số, không phải hai phép đếm rời')
})

test('nhãn trạng thái chỉ có một hàm, dùng chung ba nơi', () => {
  assert.match(metaSrc, /export const statusLabel = /, 'statusLabel phải nằm trong lib/meta.js')
  for (const [name, src] of [['App.jsx', app],
    ['AdminPanel.jsx', readFileSync(at('../components/AdminPanel.jsx'), 'utf8')]]) {
    assert.match(src, /statusLabel\(/, `${name} phải dùng statusLabel — tự ghép nhãn là ba nơi lệch nhau`)
  }
  /* RequestRow và thẻ Up next không còn tự ghép `t('status.' + …)` cho từng dòng */
  assert.ok(!/t\(`status\.\$\{r\.status\}`\)/.test(app),
    'còn chỗ tự ghép nhãn trạng thái trong App.jsx — dùng statusLabel(r, t)')
})

test('màn chờ hiện mỗi lần tải: không khoá storage, có sàn và trần', () => {
  assert.doesNotMatch(app, /sessionStorage\./, 'màn chờ không được đọc/ghi storage để tự tắt')
  assert.match(app, /const \[booting, setBooting\] = useState\(true\)/,
    'mỗi lần tải trang đều phải bắt đầu ở trạng thái boot')
  assert.match(app, /const SPLASH_MS = 560/, 'sàn của màn chờ')
  assert.match(app, /const SPLASH_MAX_MS = 2600/, 'trần của màn chờ — mạng hỏng thì vẫn phải mở')
  assert.match(app, /if \(booting\) return <Splash \/>/,
    'nhánh render lúc boot phải dựng màn chờ (không truyền hide)')
  assert.match(app, /if \(readyRef\.current\) setBooting\(false\)/,
    'hết sàn mà dữ liệu chưa xong thì màn chờ phải đứng lại, không tan trước')
})

test('nhịp vào của màn chờ khép trong khoảng sàn', () => {
  const floor = Number(app.match(/const SPLASH_MS = (\d+)/)?.[1])
  assert.ok(floor > 0, `không đọc được sàn (được ${floor})`)
  const fill = css.match(/animation: fill ([\d.]+)s var\(--e-out\) ([\d.]+)s/)
  assert.ok(fill, 'không tìm thấy nhịp đổ đầy của .splash-bar > i')
  const total = (Number(fill[1]) + Number(fill[2])) * 1000
  assert.ok(total <= floor,
    `thanh tải chạy ${total}ms nhưng màn chờ chỉ sống tối thiểu ${floor}ms — không bao giờ thấy nó đầy`)
  assert.match(css, /@keyframes fill \{/)
})

test('chuông báo tin chưa đọc bằng cả câu, không đọc trần con số', () => {
  assert.match(notifications, /role="status"/, 'số tin chưa đọc đổi thì phải tự báo (vùng live)')
  assert.match(notifications, /aria-atomic="true"/)
  assert.match(notifications, /t\('nt\.liveUnread', \{ n: unread \}\)/,
    'vùng live phải đọc câu có ngữ cảnh, không phải "3"')
  assert.match(notifications, /className="dotbadge" key=\{unread\}/,
    'badge phải đổi key theo số để nhịp nảy chạy lại mỗi lần số đổi')
})
