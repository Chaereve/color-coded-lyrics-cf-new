/* =========================================================
   TUỔI CỦA MỘT YÊU CẦU — "chờ bao lâu rồi"
   ---------------------------------------------------------
   Bảng quản trị đã có cách xếp "Waiting longest", nhưng chỉ khi admin tự chọn
   nó; còn từng hàng thì không nói gì. Hệ quả: một bài nằm chờ ba tuần trông
   y hệt một bài vừa gửi sáng nay, và nhịp chốt bài (`settings.pick.interval_days`)
   bị vượt mà không có dấu hiệu nào trên màn hình.
   Hai con số ở đây chỉ để trả lời hai câu:
     · hàng này đã chờ bao nhiêu ngày (từ lúc gửi)
     · hàng này đã quá nhịp chốt chưa (chỉ với hàng còn mở)
   Hàm thuần, `now` truyền từ ngoài — test không phụ thuộc đồng hồ máy chạy.
   ========================================================= */

const DAY_MS = 24 * 60 * 60 * 1000

/* Những trạng thái còn "đang chờ" trên thực tế: đã gửi, chưa vào sản xuất.
   `in_progress` không tính — bài đó đã được chốt, đồng hồ chờ đã dừng. */
export const WAITING_STATES = ['pending', 'queued']

export function ageInDays(iso, now = Date.now()) {
  /* `+new Date(null)` là 0 (1970) chứ không phải NaN — thiếu ngày mà không
     chặn trước thì một hàng dữ liệu khuyết sẽ tự nhận "chờ 20.000 ngày" và
     hiện chip đỏ. Thiếu ngày = không biết tuổi, không phải tuổi cực đại. */
  if (!iso) return 0
  const t = +new Date(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

/* Quá hạn = còn chờ VÀ đã chờ lâu hơn nhịp chốt bài. Nhịp lấy từ cấu hình
   (`pick.interval_days`), không viết cứng ở đây: đổi nhịp trong DB là cảnh báo
   đổi theo, đúng một nguồn.
   `picked_at` có nghĩa là bài đã được chọn vào Up next — không còn "quá hạn
   chờ" nữa dù status còn là `queued`. */
export function ageChip(r, intervalDays = 4, now = Date.now()) {
  if (!r || !WAITING_STATES.includes(r.status) || r.picked_at) return null
  const days = ageInDays(r.created_at, now)
  const interval = Number.isFinite(+intervalDays) && +intervalDays > 0 ? +intervalDays : 4
  return { days, overdue: days > interval, interval }
}
