/* Đăng xuất / đổi tài khoản — chốt lại hai lỗi đã sửa.

   db.js đọc import.meta.env và dựng client Supabase ngay khi import, nên ở đây
   kiểm tra trên MÃ NGUỒN thay vì nạp module. Vẫn bắt được đúng thứ dễ bị xoá
   nhầm về sau, mà không cần dựng cả trình duyệt giả. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const db = readFileSync(new URL('./db.js', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
const body = (src, name) => {
  const at = src.indexOf(name)
  assert.notEqual(at, -1, `không tìm thấy ${name}`)
  return src.slice(at, at + 1400)
}

test('đăng nhập Google luôn hỏi chọn tài khoản', () => {
  const fn = body(db, 'export async function signInGoogle')
  // Google giữ phiên riêng của nó: thiếu prompt=select_account thì sau khi
  // đăng xuất, bấm đăng nhập lại sẽ rơi thẳng vào đúng tài khoản vừa thoát.
  assert.match(fn, /queryParams:\s*\{[^}]*prompt:\s*'select_account'/)
  // captchaToken không được ghi đè queryParams (spread phải nằm sau).
  assert.ok(fn.indexOf('prompt:') < fn.indexOf('captchaToken ?'),
    'spread captchaToken phải đứng sau queryParams')
})

test('đăng xuất dọn sạch phiên, kể cả khi mạng lỗi', () => {
  const fn = body(db, 'export async function signOut')
  assert.match(fn, /scope:\s*'global'/, 'phải đăng xuất toàn cục, không chỉ tab này')
  // Lỗi mạng không được chặn việc dọn máy này, nếu không nút "Đăng xuất"
  // bấm xong vẫn còn đăng nhập.
  assert.match(fn, /try\s*\{\s*await supabase\.auth\.signOut/)
  // Token còn sót trong localStorage sẽ được getUser() khôi phục ở lần tải sau.
  assert.match(fn, /startsWith\('sb-'\)/)
  assert.match(fn, /removeItem\(k\)/)
})

test('App trả về màn đăng nhập trước, rồi mới gọi server', () => {
  const fn = body(app, 'const doSignOut')
  assert.match(fn, /setUser\(null\)/)
  // Thứ tự quan trọng: dọn state TRƯỚC await, để promise lỗi không giữ
  // người dùng lại trong tài khoản cũ (lỗi của bản cũ .then(...)).
  assert.ok(fn.indexOf('setUser(null)') < fn.indexOf('await signOut()'))
  assert.match(fn, /try\s*\{\s*await signOut\(\)\s*\}\s*catch/)
  /* Bảng quản trị và hồ sơ của tài khoản cũ phải đóng theo. `admin` nay là
     TAB đang mở trong trang /admin (null = chưa chọn), nên giá trị dọn là
     `null` — vẫn phải có mặt, nếu không thì đăng xuất xong vẫn còn đứng trong
     khu vực quản trị của tài khoản cũ. */
  assert.match(fn, /setAdmin\(null\)/)
  assert.match(fn, /setProfile\(false\)/)
  // Bản cũ `signOut().then(() => setUser(null))` không được quay lại (bỏ qua
  // phần chú thích, chỉ soi mã thật).
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /signOut\(\)\.then/, 'bản .then cũ nuốt lỗi mạng')
})
