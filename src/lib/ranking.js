import { isRewardEligibleRequest, requestWorkKey } from './requestEligibility.js'

/* =========================================================
   LUẬT XẾP HẠNG — một chỗ, một câu trả lời
   ---------------------------------------------------------
   Bảng xếp hạng trước đây tự sắp trong component, và chuỗi so sánh có một lỗi
   thật: khi đang xếp theo `total_votes`, hai khoá phá hoà ĐẦU TIÊN đều là
   chính `total_votes` — khoá thứ hai không bao giờ chạy, còn khoá thứ ba mới
   tới lượt. Hệ quả: hai người bằng phiếu thì thứ tự rơi xuống so theo… tên,
   trong khi một người có 12 bài đã xong đứng ngang hàng người có 1 bài. Người
   xem không gọi được tên lỗi, chỉ thấy "bảng này xếp kỳ".

   Bản này gom luật vào một module thuần (không React, không mạng) để test
   được bằng số, và khai rõ từng khoá phá hoà theo thứ tự:

     1. `completed`    — số BÀI ĐÃ XONG (mặc định), nhiều hơn đứng trước
     2. `total_votes`  — tổng phiếu mà các bài của người đó nhận được
     3. `total`        — số BÀI đã gửi, nhiều hơn đứng trước

   Mọi cách xếp dùng CÙNG một chuỗi phá hoà (trừ chính khoá đang xếp): bài đã
   xong → tổng phiếu → số bài → tỉ lệ hoàn thành → tên. Ba điều đáng nói:

   · SỐ BÀI, KHÔNG PHẢI SỐ DÒNG. Dữ liệu đếm theo bài (artist + title, đã
     chuẩn hoá) — cùng luật với bảng request và với việc gộp cụm trùng. Trước
     đây một bài do ba người gửi được tính là ba "request", nên gửi trùng là
     một cách leo hạng: đúng thứ mà cả phần còn lại của app đang chống.
   · KHOÁ PHÁ HOÀ KHÔNG BAO GIỜ TRÙNG KHOÁ CHÍNH. Xếp theo phiếu thì khoá phá
     hoà đầu tiên là số bài đã xong, không phải phiếu (trùng khoá chính là
     khoá chết).
   · TỈ LỆ HOÀN THÀNH chỉ dùng khi số bài ĐÃ BẰNG NHAU. 6/6 thắng 6/30, nhưng
     30 bài xong không bị 7/7 đè — số lượng thật vẫn là sự thật chính.
   ========================================================= */

/* =========================================================
   KHÔNG CÒN "ĐIỂM" — ba con số THẬT, không con số nào tự đặt
   ---------------------------------------------------------
   Bản trước có một cột ĐIỂM: `điểm = 10 × số bài đã xong + tổng phiếu`. Con số
   đó do chính bảng tự đặt ra, và trọng số 10 chẳng ứng với thứ gì trong sản
   phẩm: không phải giá của một bài, không phải mốc phiếu nào, không xuất hiện ở
   bất kỳ màn hình nào khác. Người xem muốn hiểu thứ tự phải tin vào một phép
   nhân không giải thích được — đúng lý do bị gọi là "tiêu chí điểm kì lạ", và
   cũng là lý do bảng phải có thêm một câu giải thích dài dưới tiêu đề.

   Nay bảng chỉ xếp theo BA con số ĐẾM ĐƯỢC, mỗi con số trả lời một câu hỏi mà
   người xem tự hỏi được:

     · `completed`   — ai có nhiều bài được làm xong nhất  (MẶC ĐỊNH)
     · `total_votes` — ai nhận được nhiều phiếu nhất
     · `total`       — ai gửi nhiều bài nhất

   Ba cách xếp này vốn đã có từ trước; việc bỏ cột điểm KHÔNG làm mất thông tin
   nào, vì mọi đầu vào của nó (`completed`, `total_votes`) đều đã là một cột
   riêng trong bảng và một cách xếp riêng. Bớt được một cột, một tab, và một
   câu giải thích — cũng là bớt đúng cái "rối mắt" của trang.

   Thứ tự mặc định là BÀI ĐÃ XONG, không phải số bài gửi: gửi nhiều mà không có
   bài nào lên sóng thì không leo hạng — đúng thứ mà cả phần còn lại của app
   đang bảo vệ (gom cụm trùng, bài bị từ chối không tính hạng).
   ========================================================= */

/* Bốn góc nhìn, mỗi góc một câu hỏi. `field` là khoá chính; `tone` là màu của
   núm chọn (khớp màu chữ của cột tương ứng trong bảng); `minis` là hai con số
   phụ in dưới bục — hai chỉ báo quan trọng nhất của góc nhìn đó. */
export const RANK_SORTS = [
  { k: 'completed', field: 'completed', tone: 'var(--done)', minis: ['total_votes', 'total'] },
  { k: 'total_votes', field: 'total_votes', tone: 'var(--paid)', minis: ['completed', 'total'] },
  { k: 'total', field: 'total', tone: 'var(--queued)', minis: ['completed', 'total_votes'] },
]

/* Số nguyên an toàn từ dữ liệu có thể méo (chuỗi, null, NaN) — bảng xếp hạng
   là chỗ cuối cùng được phép ném lỗi vì một ô trống. */
const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export const rateOf = (p) => {
  const total = n(p?.total)
  return total > 0 ? n(p?.completed) / total : 0
}

/* Tỉ lệ hoàn thành, làm tròn tới số nguyên phần trăm để hiển thị. */
export const ratePct = (p) => Math.round(rateOf(p) * 100)

/* Chuỗi phá hoà, dùng chung cho cả ba cách xếp. `primary` là khoá đang xếp
   nên bị loại khỏi chuỗi — không có khoá nào so với chính nó. */
const tieBreak = (a, b, primary) => {
  const chain = ['completed', 'total_votes', 'total']
  for (const f of chain) {
    if (f === primary) continue
    const d = n(b?.[f]) - n(a?.[f])
    if (d) return d
  }
  /* cùng mọi con số thì ai xong tỉ lệ cao hơn đứng trước (6/6 hơn 6/30) */
  const r = rateOf(b) - rateOf(a)
  if (r) return r
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''))
}

/* =========================================================
   GOM SỐ TỪ DỮ LIỆU DEMO — phải ra CÙNG HÌNH DẠNG với view thật
   ---------------------------------------------------------
   Một `user_id` là một dòng, pending/denied không đủ điều kiện, và mỗi bài
   chuẩn hoá theo artist + title chỉ đóng góp một lần. Phiếu của các request
   trùng vẫn cộng dồn; completed là đúng khi ít nhất một request trong cụm đã
   hoàn tất. Tên theo max(name), khớp requester_ranking.
   ========================================================= */
export function rankDemo(rows) {
  const byUser = new Map()
  for (const r of rows || []) {
    if (!isRewardEligibleRequest(r)) continue
    const id = r.user_id ?? 'demo-user'
    let g = byUser.get(id)
    if (!g) byUser.set(id, g = { user_id: id, name: '', works: new Map() })
    const nm = String(r.requester ?? '').trim() || 'demo-user'
    if (nm > g.name) g.name = nm
    const workKey = requestWorkKey(r)
    let work = g.works.get(workKey)
    if (!work) g.works.set(workKey, work = { completed: false, total_votes: 0 })
    work.completed ||= r.status === 'completed'
    work.total_votes += n(r.votes)
  }
  return [...byUser.values()].map((g) => {
    const works = [...g.works.values()]
    return {
      user_id: g.user_id, key: g.user_id, name: g.name,
      avatar_url: null,
      total: works.length,
      completed: works.filter(work => work.completed).length,
      total_votes: works.reduce((sum, work) => sum + work.total_votes, 0),
    }
  })
}

/* Rank used by claim_achievements() for top-10/podium badges. This intentionally
   matches that RPC's existing order (unique work count, votes, user_id), not the
   leaderboard tab's selectable presentation order. */
export function achievementRank (rows, userId) {
  if (userId == null) return 0
  const list = (rows || []).filter(row => row?.user_id != null).slice().sort((a, b) => {
    const score = n(b.total) - n(a.total) || n(b.total_votes) - n(a.total_votes)
    if (score) return score
    const aId = String(a.user_id)
    const bId = String(b.user_id)
    return aId < bId ? -1 : aId > bId ? 1 : 0
  })
  const index = list.findIndex(row => String(row.user_id) === String(userId))
  return index < 0 ? 0 : index + 1
}

/* Xếp hạng + gắn số thứ tự và tỉ lệ so với người dẫn đầu (để vẽ vạch tỉ lệ).
   Trả về mảng mới — không sửa mảng đầu vào. Mọi phép đọc đều qua `?.` và `n()`
   vì dòng `null` (payload bị cắt, một lần ghi localStorage hỏng) từng làm cả
   bảng xếp hạng ném lỗi ngay trong lúc sắp — mà ném lỗi trong render thì React
   gỡ cả cây. */
export function rankRows(rows, sortKey = 'completed') {
  const field = (RANK_SORTS.find(s => s.k === sortKey) || RANK_SORTS[0]).field
  /* Dữ liệu méo (null, chữ) đi qua `n()` nên không bao giờ ra NaN — NaN trong
     phép so sánh thì thứ tự sắp xếp thành ngẫu nhiên. */
  const list = (rows || []).map(p => ({ ...p }))
  const max = list.reduce((m, p) => Math.max(m, n(p?.[field])), 0)
  return list
    .sort((a, b) => (n(b?.[field]) - n(a?.[field])) || tieBreak(a, b, field))
    .map((p, i) => ({
      ...p,
      place: i + 1,
      rate: ratePct(p),
      share: max ? n(p?.[field]) / max : 0,
    }))
}
