/* =========================================================
   "CHỈ BẠN THẤY" — hàng chờ duyệt / bị từ chối trên trang cá nhân
   ---------------------------------------------------------
   Bảng công khai ẩn cả `pending` lẫn `denied` (đúng: bài chưa duyệt thì người
   lạ chưa được biết tên, bài bị từ chối là chuyện riêng của người gửi). Nhưng
   hệ quả là chính NGƯỜI GỬI không có chỗ nào xem lại — họ chỉ nhận một thông
   báo, còn hàng biến mất kèm cả lý do từ chối. Chủ dự án gặp đúng chỗ đó:
   "trang t hàng denied ko có xuất hiện".

   Bài này chốt ranh giới, vì đây là chỗ dễ rò rỉ dữ liệu nhất:
     1. dữ liệu riêng nằm ở mảng RIÊNG (`privateRecent`), không trộn vào
        `recent` — `recent` là thứ dựng link `?q=` và đếm số liệu công khai;
     2. chỉ trả về khi người xem LÀ chủ hồ sơ, và khi đó câu truy vấn cũng
        không lọc hai trạng thái đó nữa;
     3. UI vẽ chúng KHÔNG có link (bảng vẫn ẩn, link sẽ dẫn tới danh sách
        rỗng) và kèm lý do từ chối;
     4. khối có nhãn "chỉ bạn thấy" + khung viền đứt để không ai nhầm đây là
        danh sách công khai.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const db = readFileSync(`${root}src/lib/db.js`, 'utf8')
const page = readFileSync(`${root}src/components/PublicProfile.jsx`, 'utf8')
const app = readFileSync(`${root}src/App.jsx`, 'utf8')
const css = readFileSync(`${root}src/index.css`, 'utf8')
const strings = readFileSync(`${root}src/lib/strings.js`, 'utf8')

test('dữ liệu riêng của chủ hồ sơ nằm ở mảng riêng, không trộn vào recent', () => {
  /* Luật cũ vẫn còn nguyên: `recent` chỉ chứa hàng công khai. */
  assert.match(db, /const publicRequestsOf = \(rows\) => \(rows \|\| \[\]\)\s*\n\s*\.filter\(r => r && r\.status !== 'pending' && r\.status !== 'denied'\)/,
    'recent vẫn phải lọc pending/denied — đây là dữ liệu công khai')
  assert.match(db, /const privateRequestsOf = \(rows\) => \(rows \|\| \[\]\)\s*\n\s*\.filter\(r => r && \(r\.status === 'pending' \|\| r\.status === 'denied'\)\)/,
    'hàng riêng là đúng hai trạng thái chờ duyệt / bị từ chối, không phải "mọi thứ còn lại"')
  assert.match(db, /privateRecent: ownerView \? privateRequestsOf\(rows\)\.slice\(0, PUBLIC_RECENT\) : \[\]/,
    'mảng riêng chỉ được trả về khi người xem là chủ; người ngoài nhận mảng rỗng')
})

test('chỉ chủ hồ sơ mới tải và thấy hàng chờ duyệt / bị từ chối', () => {
  assert.match(db, /export async function fetchPublicProfile\(userId, viewerId = null\)/,
    'nguồn dữ liệu phải nhận thêm người đang xem')
  assert.match(db, /const ownerView = !!viewerId && viewerId === userId/,
    'quyết định "chủ hay không" nằm ở so sánh id, không phải ở chỗ render')
  /* Câu truy vấn: người ngoài vẫn lọc ngay ở DB, chủ thì tải cả hai loại. */
  assert.match(db, /if \(!ownerView\) q\.neq\('status', 'pending'\)\.neq\('status', 'denied'\)/,
    'người ngoài không được tải những hàng đó về client')
  assert.match(db, /deny_reason/, 'phải chọn cả lý do từ chối — thiếu nó thì khối này vô nghĩa')
  /* Đường demo và đường Supabase phải trả lời giống nhau. */
  const demoCall = db.match(/publicProfileShape\(\s*\{ id: userId, name, avatar_url: null \}, rows, ownerView\)/)
  assert.ok(demoCall, 'đường demo cũng phải truyền ownerView — không thì chỉ bản deploy mới có khối này')
  assert.match(app, /<PublicProfile userId=\{profileId\} viewerId=\{user\?\.id\}/,
    'App phải truyền người đang đăng nhập xuống trang cá nhân')
})

test('khối "chỉ bạn thấy" không dựng link và có lý do từ chối', () => {
  const block = page.slice(page.indexOf('privateRecent.length > 0'), page.indexOf('{recent.length > 0'))
  assert.ok(block.length > 200, 'không tìm thấy khối hàng riêng trong PublicProfile')
  assert.doesNotMatch(block, /boardSearchUrl|<a /,
    'không dựng link cho hàng riêng: bảng vẫn ẩn chúng, link sẽ dẫn tới danh sách rỗng')
  assert.match(block, /public-deny/, 'hàng bị từ chối phải hiện lý do')
  assert.match(block, /t\('public\.private'\)/, 'khối phải có nhãn "chỉ bạn thấy"')
  assert.match(block, /t\('public\.privateNote'\)/, 'phải có câu giải thích vì sao không thấy trên bảng')
  assert.match(page, /api\.profile\(userId, viewerId\)/,
    'trang cá nhân phải chuyển tiếp người đang xem cho nguồn dữ liệu')
  assert.match(page, /\}, \[userId, viewerId, fetchers, retry\]\)/,
    'đổi người xem phải tải lại — thiếu `viewerId` trong deps là thấy dữ liệu của người trước')
})

test('khối riêng trông khác khối công khai ngay từ khung', () => {
  assert.match(css, /\.public-private \{[^}]*border:\s*1px dashed var\(--line-2\)/,
    'viền đứt là ngôn ngữ của "chưa công khai" trong chính app này')
  assert.match(css, /\.public-deny \{[^}]*var\(--denied\)/,
    'lý do từ chối mang màu từ chối, không phải chữ xám')
  assert.match(strings, /'public\.private': /, 'thiếu chuỗi nhãn khối riêng')
  assert.match(strings, /'public\.privateNote': /, 'thiếu chuỗi giải thích khối riêng')
})
