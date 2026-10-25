import { isRewardEligibleRequest, requestWorkKey } from './requestEligibility.js'

/* Shared ranking helpers. The Leaderboard's fixed display order uses the
   arithmetic mean of requests, completed requests, and votes (see
   rankRowsByAverage below). `rankRows` remains available for existing callers
   that intentionally need a single-metric ordering. */

/* Legacy single-metric ordering definitions; the Leaderboard no longer
   exposes these as user-selectable controls. */
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

/* Leaderboard's fixed overall ranking: the arithmetic mean of its three
   visible measures. Keep the unrounded mean for ordering; presentation may
   format it to two decimals. */
export const averageRankScore = (p) => (
  n(p?.total) + n(p?.completed) + n(p?.total_votes)
) / 3

export function rankRowsByAverage(rows) {
  const list = (rows || []).map(p => ({ ...p, score: averageRankScore(p) }))
  const max = list.reduce((m, p) => Math.max(m, p.score), 0)
  return list
    .sort((a, b) => (b.score - a.score) || tieBreak(a, b, 'score'))
    .map((p, i) => ({
      ...p,
      place: i + 1,
      rate: ratePct(p),
      share: max ? p.score / max : 0,
    }))
}
