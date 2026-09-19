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

/* =========================================================
   BỘ LỌC ĐÃ NHỚ — URL trước, rồi tới giá trị đã lưu, cuối cùng mới mặc định
   ---------------------------------------------------------
   Ba nguồn, xếp theo thứ tự ưu tiên rõ ràng:
     1. URL  — dán link là mở ĐÚNG chỗ người gửi muốn chỉ (link luôn thắng)
     2. localStorage — lần ghé trước đang xem tab nào thì ghé sau vẫn ở đó
     3. mặc định của app
   Giá trị lạ (URL cũ, dữ liệu lưu từ bản trước đổi tên tab) bị bỏ qua chứ
   không đẩy vào state: một tab không tồn tại sẽ làm danh sách rỗng mà không
   ai hiểu vì sao.
   ========================================================= */
export const pickBoardParam = (fromUrl, saved, valid, dflt) => {
  if (valid.includes(fromUrl)) return fromUrl
  if (valid.includes(saved)) return saved
  return dflt
}

/* =========================================================
   BÀI ĐÃ CÓ TRÊN BẢNG? — dò trùng ngay lúc gõ, không đợi tới lúc gửi
   ---------------------------------------------------------
   Quy tắc dò dùng ĐÚNG `groupKey` mà bảng dùng để gom cụm (cùng tên bài +
   cùng nghệ sĩ, bỏ qua hoa/thường và khoảng trắng thừa), nên câu trả lời ở
   form và cách bảng cộng dồn vote không bao giờ nói hai chuyện khác nhau.

   Vì sao cần: một bài bị ba người gửi lẻ là gốc của cả việc "9 vote mà xếp
   dưới 5 vote" lẫn việc farm vote bằng nhiều tài khoản. Chặn ở ô nhập rẻ hơn
   nhiều so với phát hiện rồi gộp ở tầng SQL.

   Trả về `null` khi CHƯA đủ để kết luận: tên bài dưới 3 ký tự mà đã báo trùng
   thì gõ tới đâu cũng thấy gợi ý, và người dùng học được cách phớt lờ nó.
   ========================================================= */
export function findDuplicate(rows, draft) {
  const title = (draft?.title || '').trim()
  const artist = (draft?.artist || '').trim()
  if (title.length < 3 || !artist) return null

  const key = groupKey({ title, artist })
  const hit = (rows || []).filter((r) => r && groupKey(r) === key)
  if (!hit.length) return null

  const open = hit.filter((r) => r.status === 'queued' || r.status === 'in_progress')
  /* Bài để bấm vào vote: nhiều vote nhất trong số còn sống (vote thêm vào
     dòng yếu nhất là làm cụm mạnh thêm nhưng không đẩy hạng lên). */
  const best = [...open].sort(byVotes)[0] || null
  /* `pending` đếm riêng: hàng đang chờ duyệt KHÔNG hiện trên bảng nên không
     thể "vote cho nó" được, nhưng nó vẫn là lý do để không gửi lại lần nữa —
     gửi trùng của chính mình là ca trùng phổ biến nhất. */
  const pending = hit.filter((r) => r.status === 'pending').length
  return {
    key,
    rows: hit,
    title: hit[0].title,
    artist: hit[0].artist,
    votes: hit.reduce((n, r) => n + (r.votes || 0), 0),
    open: open.length,
    pending,
    best,
    /* Video đã làm xong: gợi ý này đổi thành "xem rồi", không gợi ý vote nữa */
    video: hit.find((r) => r.status === 'completed' && r.video_url)?.video_url || null,
  }
}

/* =========================================================
   LINK MỜI GỬI BÀI — `/?add=1&artist=…&title=…`
   ---------------------------------------------------------
   Chủ kênh dán link này vào mô tả video / ghim bình luận: người xem bấm là
   vào thẳng form gửi request, đã điền sẵn tên bài. Đây là đường ngắn nhất từ
   "đang xem video" tới "đã gửi request", và nó KHÔNG tốn gì: bộ lọc đã nằm
   trên URL từ trước, chỉ cần đọc thêm ba tham số.

   Cắt độ dài theo đúng `maxLength` của ô nhập: dán một URL dài ngoằng vào
   không được tạo ra cái form mà chính nó không gửi được.
   ========================================================= */
export function parseRequestPrefill(params, limits = { artist: 120, title: 160, link: 500 }) {
  /* `?add` trần, `?add=1`, `?add=true`, `?add=TRUE` đều là "mở form"; còn
     `?add=0` / `?add=false` / `?add=no` là không. Đọc bằng `has()` chứ không
     phải bằng giá trị: tham số trần (`?add`) trả về CHUỖI RỖNG, và chuỗi rỗng
     là falsy — bản đầu của hàm này vì thế mà âm thầm bỏ qua đúng cái link
     ngắn nhất, loại link người ta hay gõ tay nhất. */
  if (!params?.has?.('add')) return null
  const v = (params.get('add') || '').trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'no') return null
  const clip = (v, n) => (v || '').trim().slice(0, n)
  return {
    artist: clip(params.get('artist'), limits.artist),
    title: clip(params.get('title'), limits.title),
    link: clip(params.get('link'), limits.link),
  }
}

/* =========================================================
   GHIM CÔNG — chữ để dán vào mô tả video YouTube
   ---------------------------------------------------------
   Người gửi request là người làm nên tập phim đó; ghi tên họ vào mô tả là thứ
   duy nhất khiến họ gửi tiếp. Việc này đang phải làm bằng tay: mở bảng, đọc
   từng dòng, gõ lại tên — nên nó thường bị bỏ.
   Chỉ nhận `title`/`artist` + danh sách dòng của CÙNG bài (lọc bằng groupKey
   trước khi gọi), trả về một khối chữ thuần, dán được ngay.
   ========================================================= */
export function creditText(song, maxNames = 8) {
  const title = (song?.title || '').trim()
  const artist = (song?.artist || '').trim()
  if (!title) return ''
  const names = [...new Set((song.rows || [])
    .map((r) => (r?.requester || '').trim())
    .filter(Boolean))]
  const head = [artist, title].filter(Boolean).join(' - ')
  if (!names.length) return head
  const shown = names.slice(0, maxNames)
  const more = names.length - shown.length
  const list = shown.join(', ') + (more > 0 ? ` +${more}` : '')
  return `${head}\nRequested by: ${list}`
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
