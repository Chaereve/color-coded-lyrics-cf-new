/* =========================================================
   BẢNG YÊU CẦU — gom cụm trùng bài & xếp hạng theo TỔNG vote
   ---------------------------------------------------------
   Hai request cùng tên bài + nghệ sĩ (so sánh không phân biệt hoa
   thường / khoảng trắng thừa) là MỘT bài hát, nên khi xếp hạng phải
   cộng dồn vote của cả cụm.

   Bản cũ sắp xếp từng DÒNG trước rồi mới gom cụm, thành ra cụm đứng
   đúng ở vị trí của dòng đầu tiên: bài 9 vote bị xé làm 3 request
   (3 + 3 + 3) sẽ xếp DƯỚI bài 5 vote chỉ có một request — vote cộng
   dồn vẫn hiện trên thẻ nhưng hạng thì không tính tới nó.

   Ở đây thứ tự được quyết định theo hai tầng:
     · sortRows  — thứ tự các dòng TRONG một cụm (dòng mạnh nhất trước)
     · sortGroups— thứ tự các CỤM trên bảng, tính bằng tổng vote
   Tách ra file riêng (không nằm trong App.jsx) để còn kiểm thử được
   bằng dữ liệu giả mà không phải dựng cả giao diện.
   ========================================================= */

const ts = (v) => +new Date(v) || 0

/* Khoá gom cụm: cùng nghệ sĩ + cùng tên bài là một cụm. */
export const groupKey = (r) =>
  `${(r.artist || '').trim().toLowerCase()}\n${(r.title || '').trim().toLowerCase()}`

/* Nhat ra nhung request CUNG MOT BAI (cung artist + title, khong phan biet
   hoa thuong / khoang trong thua) ma van con "song" (queued | in_progress).
   Dung khi admin danh dau mot buoc cua video: mot bai chi lam MOT lan, nen tick
   ben request nay phai chay deu len moi request trung nhau — nguoi gui ban kia
   cung dang cho cung cai video do. `row` luon nam trong ket qua, ke ca khi no
   da completed (admin van co the sua lai). */
export const groupIds = (rows, row, statuses = ['queued', 'in_progress']) => {
  if (!row || row.id === undefined || row.id === null) return []
  const key = groupKey(row)
  const out = [row.id]
  for (const r of rows || []) {
    if (!r || r.id === row.id || r.id === undefined || r.id === null) continue
    if (!statuses.includes(r.status)) continue
    if (groupKey(r) === key) out.push(r.id)
  }
  return out
}

/* Nhiều vote hơn đứng trước; hoà vote thì bài mới hơn đứng trước. */
export const byVotes = (a, b) => ((b.votes || 0) - (a.votes || 0)) || (ts(b.created_at) - ts(a.created_at))
export const byNewest = (a, b) => ts(b.created_at) - ts(a.created_at)

/* Danh sách Up next: đang làm trước, rồi tới hàng chốt sớm hơn. */
export const byPickOrder = (a, b) =>
  ((a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1))
  || (ts(a.picked_at) - ts(b.picked_at))

/* Thứ tự từng dòng theo tab đang mở. Tab "Đang chờ" (mặc định) đẩy
   paid request lên đầu rồi mới xét tới vote, giống hệt thứ tự cũ. */
export function sortRows(rows, filter) {
  const out = [...rows]
  if (filter === 'picked') return out.sort(byPickOrder)
  if (filter === 'newest') return out.sort(byNewest)
  if (filter === 'top') return out.sort(byVotes)
  return out.sort((a, b) => ((b.is_paid ? 1 : 0) - (a.is_paid ? 1 : 0)) || byVotes(a, b))
}

/* Gom thành cụm. `rows` đã được sắp xếp nên dòng đầu của cụm là dòng
   "đại diện" — tên bài/nghệ sĩ của cụm lấy từ dòng đó, các dòng còn
   lại giữ đúng thứ tự của tab đang mở. */
export function groupRows(rows) {
  const order = []
  const byKey = new Map()
  for (const r of rows) {
    const k = groupKey(r)
    let g = byKey.get(k)
    if (!g) {
      g = { key: k, title: r.title, artist: r.artist, rows: [], votes: 0, paid: 0, newest: 0 }
      byKey.set(k, g)
      order.push(g)
    }
    g.rows.push(r)
    g.votes += r.votes || 0                              // TỔNG vote của cả bài
    if (r.is_paid) g.paid = 1                            // một dòng paid là cả cụm paid
    g.newest = Math.max(g.newest, ts(r.created_at))
  }
  return order
}

/* Xếp hạng CỤM — chỗ sửa chính: dùng `votes` đã cộng dồn của cả cụm
   chứ không dùng vote của riêng dòng đầu. */
export function sortGroups(groups, filter) {
  if (filter === 'picked') return groups                 // đã theo thứ tự làm việc, không xáo
  const out = [...groups]
  if (filter === 'newest') return out.sort((a, b) => (b.newest - a.newest) || (b.votes - a.votes))
  if (filter === 'top') return out.sort((a, b) => (b.votes - a.votes) || (b.newest - a.newest))
  return out.sort((a, b) => (b.paid - a.paid) || (b.votes - a.votes) || (b.newest - a.newest))
}

/* Bảng tổng vote theo từng bài, dùng cho chỗ nào vẫn phải liệt kê từng
   dòng riêng (bảng Admin chẳng hạn): key = groupKey, value = { n, total }. */
export function voteTotals(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = groupKey(r)
    const c = m.get(k) || { n: 0, total: 0 }
    c.n += 1
    c.total += r.votes || 0
    m.set(k, c)
  }
  return m
}

/* Danh sách cuối cùng để render + phân trang: cụm nhiều dòng thành một
   thẻ gập/mở được, cụm một dòng giữ nguyên hàng thường. */
export function boardItems(rows, filter) {
  return sortGroups(groupRows(sortRows(rows, filter)), filter)
    .map((g) => (g.rows.length > 1
      ? { type: 'group', ...g }
      : { type: 'row', key: g.key, r: g.rows[0] }))
}
