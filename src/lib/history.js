/* =========================================================
   GHI VÀO ĐỊA CHỈ — QUA MỘT CỬA DUY NHẤT
   ---------------------------------------------------------
   Địa chỉ trang là thứ PHỤ: nhờ nó mà F5 giữ nguyên chỗ đang
   xem, và dán link cho người khác là họ mở đúng danh sách.
   Nhưng `pushState`/`replaceState` KHÔNG phải lúc nào cũng gọi
   được: tài liệu nằm trong iframe bị sandbox (bản xem trước của
   nền tảng chạy trong iframe), trang mở bằng `file://`, hoặc
   chế độ riêng tư của vài trình duyệt đều ném SecurityError.
   Gọi thẳng thì lỗi đó bắn ra từ trong một handler React — ván
   cờ kết thúc ở đó: địa chỉ không đổi, mà việc người dùng vừa
   bấm (mở bảng quản trị, gửi request) cũng không chạy nốt.

   Nên MỌI lần ghi đi qua hai hàm dưới đây. Chúng không bao giờ
   ném: hỏng thì coi như bản dựng này không có địa chỉ, còn phần
   còn lại của trang vẫn phải chạy.
   ========================================================= */

const canWrite = (fn) => {
  if (typeof window === 'undefined') return false
  return typeof window.history?.[fn] === 'function'
}

function write(fn, state, url) {
  if (!canWrite(fn)) return false
  try {
    window.history[fn](state, '', url)
    return true
  } catch {
    /* Sandbox / file:// / chế độ riêng tư: bỏ qua, KHÔNG làm chết handler. */
    return false
  }
}

/** Đẩy một mốc lịch sử mới (người dùng bấm Back sẽ quay lại chỗ cũ). */
export function pushUrl(state, url) {
  return write('pushState', state, url)
}

/** Thay địa chỉ hiện tại mà không thêm mốc (đổi tab, đổi bộ lọc, dọn tham số). */
export function putUrl(state, url) {
  return write('replaceState', state, url)
}

/** Địa chỉ hiện tại, dạng chuỗi — luôn đọc được kể cả khi không ghi được. */
export function here() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search
}

/* =========================================================
   DỰNG ĐỊA CHỈ — cũng chỉ MỘT cửa
   ---------------------------------------------------------
   Ba đường link trong app trỏ vào bảng/trang cá nhân: thẻ "This week",
   Recent requests của trang cá nhân, và tên người gửi trên mỗi hàng. Trước
   đây mỗi chỗ tự ghép chuỗi bằng tay, nên ba chỗ ghép BA kiểu (chỗ thì
   `encodeURIComponent`, chỗ thì quên, chỗ thì giữ nguyên `f=top` trong khi
   bài đã completed và `top` cố ý loại bài đã xong — bấm vào là danh sách
   rỗng). Ghép ở đây một lần, mọi chỗ dùng chung.
   ========================================================= */

/** Trang cá nhân công khai. Dạng tham số (`/?profile=<id>`) chứ không phải
 *  `/u/<id>`: `/u/…` là một đường dẫn thật, mà host tĩnh chỉ phục vụ
 *  `index.html` cho đúng `/` (xem `public/_redirects`) — dán link `/u/…` cho
 *  người khác là họ nhận 404. App vẫn ĐỌC được `/u/<id>` cho link cũ. */
export const profileUrl = (id) => `/?profile=${encodeURIComponent(id ?? '')}`

/** Từ khoá tìm một bài: tên bài + nghệ sĩ, khoảng trắng thừa đã dồn. */
export const songQuery = (title, artist) =>
  `${title ?? ''} ${artist ?? ''}`.replace(/\s+/g, ' ').trim()

/** Bảng yêu cầu đã mở sẵn một bài. `f=newest` là chủ ý: đó là cách nhìn thấy
 *  MỌI bài trên bảng, nên link vẫn dẫn tới đúng bài khi nó đã được chốt,
 *  đang làm, hay đã xong. `f=top` thì không — nó chỉ liệt kê bài đang xin
 *  phiếu. */
export const boardSearchUrl = (title, artist) => {
  const p = new URLSearchParams()
  p.set('f', 'newest')
  const q = songQuery(title, artist)
  if (q) p.set('q', q)
  return `/?${p.toString()}`
}

/** Đường dẫn tương đối thành URL TUYỆT ĐỐI — thứ duy nhất dán ra ngoài được.
 *  (`og:image` từng là đường dẫn tương đối và Telegram/Discord không hiện ảnh
 *  xem trước: crawler đọc HTML thô, không có origin để ghép — cùng một bài học.)
 *  Không ghép được thì trả về nguyên trạng, không ném. */
export function absolute(path) {
  try { return new URL(path, window.location.origin).href } catch { return path }
}
