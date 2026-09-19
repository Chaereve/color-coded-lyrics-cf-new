/* =========================================================
   XUẤT CSV — để bảng quản trị không phải là nơi dữ liệu chỉ đi vào
   ---------------------------------------------------------
   Quản trị viên cần đưa danh sách ra khỏi trang: đối chiếu với video đã đăng,
   lọc trong bảng tính, hoặc giữ một bản trước khi xoá hàng loạt. Việc này chạy
   HOÀN TOÀN trong trình duyệt (Blob + thẻ <a> tải xuống) nên không tốn request
   nào của gói miễn phí và không có dữ liệu nào rời khỏi máy người dùng trước
   khi họ tự mở file.

   CSV có ba cái bẫy, cả ba đều được xử ở đây:
     1. dấu phẩy và dấu xuống dòng TRONG dữ liệu — bọc trong nháy kép;
     2. nháy kép trong dữ liệu — nhân đôi nó (luật RFC 4180);
     3. Excel mở file không dấu thành chữ rác — thêm BOM UTF-8.
   Giữ hàm THUẦN để test bằng chuỗi, không cần trình duyệt.
   ========================================================= */

const NEEDS_QUOTE = /[",\r\n]/

/** Một ô: luôn là chuỗi, nháy kép được nhân đôi, có dấu phẩy thì bọc lại. */
export function csvCell(v) {
  const s = v == null ? '' : String(v)
  return NEEDS_QUOTE.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Dựng nội dung CSV từ danh sách dòng và danh sách cột.
 * @param {Array<object>} rows
 * @param {Array<{k: string, label: string, get?: (row: object) => unknown}>} cols
 * @returns {string} kèm BOM ở đầu và kết thúc bằng một dòng trống
 */
export function toCsv(rows, cols) {
  const head = cols.map(c => csvCell(c.label)).join(',')
  const body = (rows || []).map(r =>
    cols.map(c => csvCell(c.get ? c.get(r) : r?.[c.k])).join(','))
  return '\ufeff' + [head, ...body].join('\r\n') + '\r\n'
}

/** Tên file an toàn: bỏ mọi thứ có thể gây lạ trong hệ thống file. */
export function csvFileName(base, date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const safe = String(base || 'danh-sach').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${safe || 'danh-sach'}-${day}.csv`
}

/** Tải một chuỗi thành file. Không làm gì nếu trình duyệt thiếu API. */
export function downloadText(name, text, type = 'text/csv;charset=utf-8') {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  /* Thu hồi URL ngay ở nhịp sau: thu hồi trước khi trình duyệt kịp đọc là file
     rỗng, còn để luôn là rò rỉ bộ nhớ cho tới khi tải lại trang. */
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
