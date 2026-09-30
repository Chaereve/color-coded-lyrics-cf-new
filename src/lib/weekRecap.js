/* =========================================================
   WEEK IN REVIEW (T7) — "tuần qua nhìn lại"
   ---------------------------------------------------------
   Một hàm thuần trả số liệu cho thẻ recap: cửa sổ 7 ngày lăn (đúng cửa sổ
   của "This week", xem board.js weeklyHighlights — không có hai định nghĩa
   "tuần" trong app), cộng ba mảnh:

     · windowVotes — tổng phiếu NHẬN trong cửa sổ (votesLog);
     · completed   — tối đa 3 bài XONG trong cửa sổ, mỗi bài một dòng
                     (một bài nhiều request chỉ đếm một lần);
     · top         — bài nhiều phiếu trong cửa sổ nhất (mượn nguyên
                     luật chọn của weeklyHighlights để hai khối không
                     bao giờ cãi nhau).

   Danh tính người gửi/không ai được nêu tên trên card recap: bảng phiếu
   theo RLS chỉ cho xem phiếu của chính mình, tên người thì privacy.html
   không cho phép xuất ra ảnh chia sẻ. Đây là số liệu sản phẩm.
   ========================================================= */
import { groupKey, weeklyHighlights } from './board.js'
import { votesByRequest } from './season.js'

const WEEK_MS = 7 * 86400000
const ts = (s) => Date.parse(s || '') || 0

export function weekRecap(rows, now = Date.now(), votesLog = []) {
  const since = now - WEEK_MS
  const votes = votesByRequest(votesLog, since, now)
  let windowVotes = 0
  for (const v of votes.values()) windowVotes += v

  /* Hoàn thành trong cửa sổ: completed_at (có thì dùng), không thì lui về
     updated_at/created_at — cùng thứ tự dấu thời gian với board.js. */
  const doneAt = (r) => ts(r.completed_at) || ts(r.updated_at) || ts(r.created_at)
  const seen = new Set()
  const completed = []
  const doneRows = (rows || [])
    .filter((r) => r && r.status === 'completed' && doneAt(r) >= since && doneAt(r) <= now)
    .sort((a, b) => doneAt(b) - doneAt(a))
  for (const r of doneRows) {
    const k = groupKey(r)
    if (seen.has(k)) continue
    seen.add(k)
    completed.push({ title: r.title, artist: r.artist, doneAt: doneAt(r), votes: votes.get(r.id) || 0 })
    if (completed.length >= 3) break
  }

  const { top, newcomer } = weeklyHighlights(rows, now, votesLog)
  return { since, until: now, windowVotes, completed, top, newcomer }
}

/* Câu tóm tắt một dòng cho UI — nơi gọi vẫn tự t() nhãn. */
export function recapStats(recap) {
  return [
    { key: 'statVotes', value: recap.windowVotes },
    { key: 'statDone', value: recap.completed.length },
    { key: 'statTop', value: recap.top?.votes ?? 0 },
  ]
}
