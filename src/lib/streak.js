/* =========================================================
   CHUỖI NGÀY HOẠT ĐỘNG (streak) — đếm trên dấu ngày server
   ---------------------------------------------------------
   Nguồn dữ liệu: bảng `activity_days` (migration 20260921_activity_days.sql)
   — mỗi hàng là MỘT NGÀY mà người đó có ít nhất một hành động cộng đồng:
   gửi request · vote · bình luận · quay spin. Trigger in dấu ngày theo LỊCH
   VIỆT NAM, cùng múi giờ với daily spin và mùa giải của leaderboard — một
   "ngày" của cộng đồng này bắt đầu/kết thúc lúc nửa đêm giờ VN.

   Module này chỉ ĐẾM, không suy diễn: đầu vào là mảng chuỗi 'YYYY-MM-DD',
   đầu ra là ba con số trả lời ba câu hỏi người xem tự hỏi được:

     · `current`  — chuỗi ngày hiện tại còn sống không, dài mấy ngày?
     · `longest`  — chuỗi dài nhất từng đạt (badge cột mốc bám số này: một
                    cột mốc đã mở thì KHÔNG tắt lại khi chuỗi hiện tại đứt —
                    đó là thành tích, không phải trạng thái);
     · `earned`   — các mốc 7 / 30 / 100 đã mở.

   LUẬT "CHƯA HOẠT ĐỘNG HÔM NAY" (giống Duolingo): lúc 9 giờ sáng mà hôm nay
   chưa làm gì, chuỗi KHÔNG được coi là đứt — nó còn sống tới hết ngày hôm
   nay, và chỉ mất nếu ngày mai trôi qua mà vẫn không có dấu nào. Nên
   `currentStreak` bắt đầu đếm từ hôm nay, và nếu hôm nay chưa có dấu thì lùi
   về HÔM QUA mà đếm — chứ không trả về 0.

   Ba mốc 7/30/100 là SỐ NGÀY CHUỖI, không phải số hành động: cột mốc kể câu
   chuyện "quay lại đều đặn", đúng thứ mà một cộng đồng request cần hơn là
   "bấm nhiều" (tinh thần C3-14: không thưởng đua số lượng).
   ========================================================= */

import { vnDayKey } from './season.js'

export const STREAK_MILESTONES = [7, 30, 100]

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000

/* 'YYYY-MM-DD' -> millis (mốc UTC trưa không cần: chỉ cần phép trừ một ngày
   trên LỊCH, và lịch UTC không có DST nên trừ 86400000ms trên mốc UTC nửa
   đêm luôn ra ngày liền trước đúng nghĩa) */
const keyMs = (k) => Date.parse(`${k}T00:00:00Z`)
const prevKey = (k) => new Date(keyMs(k) - DAY_MS).toISOString().slice(0, 0 + 10)

/* Lọc sạch đầu vào méo (null, chuỗi lạ, timestamp nguyên vẹn) — streak là
   khối UI nhỏ, không được phép ném lỗi vì một hàng cache hỏng. Regex thôi
   chưa đủ: '2025-13-45' khớp khuôn \d{2} nhưng Date.parse ra NaN, và một
   phép toISOString() trên ngày NaN là RangeError ném thẳng vào render. */
export function dayKeys(days) {
  const set = new Set()
  for (const d of days || []) {
    if (typeof d === 'string' && DAY_KEY.test(d) && Number.isFinite(keyMs(d))) set.add(d)
  }
  return set
}

/* Chuỗi hiện tại, kể cả khi hôm nay chưa có dấu (xem luật ở đầu file). */
export function currentStreak(days, now = Date.now()) {
  const set = dayKeys(days)
  if (!set.size) return 0
  let key = vnDayKey(now)
  if (!set.has(key)) key = prevKey(key)
  let n = 0
  while (set.has(key)) { n++; key = prevKey(key) }
  return n
}

/* Chuỗi dài nhất từng đạt — duyệt ngày tăng dần, gặp chỗ đứt thì bắt nhịp mới. */
export function longestStreak(days) {
  const keys = [...dayKeys(days)].sort()
  let best = 0, run = 0, prev = null
  for (const k of keys) {
    run = prev !== null && prevKey(k) === prev ? run + 1 : 1
    if (run > best) best = run
    prev = k
  }
  return best
}

export function streakStats(days, now = Date.now()) {
  const current = currentStreak(days, now)
  const longest = longestStreak(days)
  return {
    current,
    longest,
    earned: STREAK_MILESTONES.filter((m) => longest >= m),
  }
}
