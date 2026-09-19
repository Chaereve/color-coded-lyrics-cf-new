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
