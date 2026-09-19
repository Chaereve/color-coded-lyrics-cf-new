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

     1. `total`        — số BÀI đã gửi, nhiều hơn đứng trước
     2. `completed`    — số bài đã xong, nhiều hơn đứng trước
     3. `total_votes`  — tổng phiếu mà các bài của người đó nhận được

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

/* Ba góc nhìn, mỗi góc một câu hỏi. `field` là khoá chính; `tone` là màu của
   núm chọn (khớp màu chữ của cột tương ứng trong bảng). */
export const RANK_SORTS = [
  { k: 'total', field: 'total', tone: 'var(--a-2)' },
  { k: 'completed', field: 'completed', tone: 'var(--done)' },
  { k: 'total_votes', field: 'total_votes', tone: 'var(--paid)' },
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
   View `requester_ranking` bên Postgres gom theo `user_id` và lấy `max(name)`.
   Bản demo trước đây gom theo `user_id::requester`, nên cùng một người mà đổi
   tên hiển thị là thành HAI người trên bảng: hai dòng đều được tô "bạn", và
   ô "hạng của bạn" chỉ đọc được một trong hai — cùng một lỗi identity mà phần
   còn lại của app đã vá (xem `inChain`, gom cụm theo bài).
   Hàm này gom lại đúng như view: một `user_id` = một dòng. Tên của dòng là
   tên được dùng nhiều nhất (bằng số thì lấy tên lớn hơn theo thứ tự chữ, giống
   `max()`), và bài bị từ chối không được tính vào hạng.
   ========================================================= */
export function rankDemo(rows) {
  const byUser = new Map()
  for (const r of rows || []) {
    if (!r || r.status === 'denied') continue
    const id = r.user_id ?? 'demo-user'
    let g = byUser.get(id)
    if (!g) byUser.set(id, g = { user_id: id, names: new Map(), total: 0, completed: 0, total_votes: 0 })
    const nm = String(r.requester ?? '').trim() || 'demo-user'
    g.names.set(nm, (g.names.get(nm) || 0) + 1)
    g.total++
    if (r.status === 'completed') g.completed++
    g.total_votes += n(r.votes)
  }
  return [...byUser.values()].map((g) => {
    let name = '', best = -1
    for (const [nm, count] of g.names) {
      if (count > best || (count === best && nm > name)) { name = nm; best = count }
    }
    return {
      user_id: g.user_id, key: g.user_id, name,
      avatar_url: null, total: g.total, completed: g.completed, total_votes: g.total_votes,
    }
  })
}

/* Xếp hạng + gắn số thứ tự và tỉ lệ so với người dẫn đầu (để vẽ vạch tỉ lệ).
   Trả về mảng mới — không sửa mảng đầu vào. Mọi phép đọc đều qua `?.` và `n()`
   vì dòng `null` (payload bị cắt, một lần ghi localStorage hỏng) từng làm cả
   bảng xếp hạng ném lỗi ngay trong lúc sắp — mà ném lỗi trong render thì React
   gỡ cả cây. */
export function rankRows(rows, sortKey = 'total') {
  const field = (RANK_SORTS.find(s => s.k === sortKey) || RANK_SORTS[0]).field
  const max = (rows || []).reduce((m, p) => Math.max(m, n(p?.[field])), 0)
  return [...(rows || [])]
    .sort((a, b) => (n(b?.[field]) - n(a?.[field])) || tieBreak(a, b, field))
    .map((p, i) => ({
      ...p,
      place: i + 1,
      rate: ratePct(p),
      share: max ? n(p?.[field]) / max : 0,
    }))
}
