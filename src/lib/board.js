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

/* `inChain` là luật của MỘT dòng (đã chốt? đang làm?) và nằm ở
   meta.js — board.js mượn chứ không định nghĩa lại: một luật mà hai chỗ viết
   thì sau một lần sửa, bảng và khối Up next kể hai câu chuyện khác nhau. */
import { inChain } from './meta.js'
import { votesByRequest } from './season.js'

const ts = (v) => +new Date(v) || 0

/* Chuẩn hoá một trường thành chuỗi so sánh được — kể cả khi nó không phải
   chuỗi (số, null) hay cả dòng request là null. */
const txt = (v) => (v == null ? '' : String(v)).trim().toLowerCase()

/* Khoá gom cụm: cùng nghệ sĩ + cùng tên bài là một cụm. */
export const groupKey = (r) => `${txt(r?.artist)}\n${txt(r?.title)}`

/* Chỉ giữ lại những dòng THẬT SỰ là object.
   Một phần tử null/rác trong mảng rows (payload realtime méo, một lần ghi
   localStorage hỏng, câu trả lời của PostgREST bị cắt) trước đây làm cả bảng
   ném lỗi ngay lúc render — mà render ném lỗi thì React gỡ sạch cây: cả trang
   biến mất chỉ vì MỘT dòng. Lọc ở đây rẻ hơn nhiều so với đi kiểm tra từng
   trường ở từng chỗ dùng. */
const real = (rows) => (rows || []).filter((r) => r && typeof r === 'object')

/* Bỏ dấu tiếng Việt để một từ khoá khớp cả ba cách người ta gõ tên bài:
   "Chung Hạ", "Chung Ha", "chung ha". Một chỗ định nghĩa, dùng cho cả ô tìm
   trên bảng lẫn ô tìm trong panel admin — trước đây admin có bản riêng và
   hai bản trả lời khác nhau cho cùng một câu hỏi.

   `đ` phải thay TAY: nó là ký tự riêng của tiếng Việt chứ không phải `d` +
   dấu, nên NFD không tách ra được — thiếu dòng đó thì "dang nhap" không tìm
   ra "Đặng Nhập" mà nhìn vào chẳng thấy sai ở đâu.
   Gộp khoảng trắng để "chung  ha" cũng khớp, và để hai vế so sánh được cùng
   một chuẩn. */
export const fold = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/\s+/g, ' ')
  .trim()

/* =========================================================
   TÌM KIẾM — so TỪNG TỪ, không so cả chuỗi
   ---------------------------------------------------------
   Bản cũ là MỘT phép `includes` trên cả cụm:
       fold(`${artist} ${title} ${kind} ${requester}`).includes(fold(q))
   Nghĩa là từ khoá chỉ khớp khi người gõ viết ĐÚNG THỨ TỰ các trường của
   hàng. Mà thứ tự đó (`nghệ sĩ` trước, `tên bài` sau) là thứ tự của CSDL,
   không phải thứ tự người ta gõ — và mọi đường dẫn vào bảng đều dựng từ
   khoá theo thứ tự NGƯỢC LẠI (`tên bài` trước, `nghệ sĩ` sau):
       · thẻ "This week"               → `?q=<title> <artist>`
       · Recent requests ở trang cá nhân → `?q=<title> <artist>`
   Hệ quả thật: bấm một bài trong trang cá nhân của người gửi thì bảng hiện
   "không có kết quả" cho CHÍNH bài đó — `Pop Off LE SSERAFIM` không phải là
   chuỗi con của `LE SSERAFIM Pop Off Color Coded Lyrics swanlychae`.

   Sửa ở tầng so sánh, không phải ở tầng dựng link: đổi sang AND-theo-từ thì
   thứ tự không còn quan trọng, và hai cách gõ ("Pop Off LE SSERAFIM",
   "LE SSERAFIM Pop Off") đều ra đúng một bài. Một từ khoá nhiều từ vẫn tìm
   được bài có tên ghép (`ive switch`) vì mỗi từ được dò độc lập.

   Trả lời hai câu hỏi khác nhau nên tách hai hàm:
       · allTermsIn(haystack, q) — cho chỗ tự dựng chuỗi để dò (bảng Admin dò
         cả ghi chú / trạng thái / loại đơn)
       · searchHit(row, q)       — cho MỘT hàng request: chuỗi dò do chính hàm
         này định nghĩa, nên bảng công khai và mọi đường link vào bảng không
         thể lệch nhau.
   ========================================================= */
/* Từ khoá rỗng → không từ nào → không lọc gì. Từ chỉ có dấu câu (`-`, `·`,
   `()`) cũng bị bỏ: người ta dán "Pop Off - LE SSERAFIM" từ tiêu đề video, và
   một từ `-` không có trong hàng nào cả sẽ làm cả phép tìm về rỗng. */
export const searchTerms = (q) => fold(q).split(' ')
  .filter(term => /[\p{L}\p{N}]/u.test(term))

export const allTermsIn = (haystack, q) => {
  const terms = searchTerms(q)
  if (!terms.length) return true
  const hay = fold(haystack)
  return terms.every(term => hay.includes(term))
}

/* Các trường công khai của một hàng: đúng bốn trường người đọc nhìn thấy trên
   bảng (nghệ sĩ, tên bài, loại, người gửi). Không dò `note`/`link` ở bảng công
   khai — đó là chữ admin ghi cho mình. */
export const searchHit = (r, q) =>
  allTermsIn(`${r?.artist} ${r?.title} ${r?.kind} ${r?.requester}`, q)

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
/* =========================================================
   TÁCH MỘT TIÊU ĐỀ VIDEO THÀNH HAI Ô
   ---------------------------------------------------------
   Cách nhanh nhất để điền form là copy NGUYÊN tiêu đề video rồi dán vào ô
   tên bài — và đó cũng là cách chắc chắn nhất để ô tên bài chứa cả tên nghệ
   sĩ trong khi ô nghệ sĩ trống. Hàm này đọc hai khuôn phổ biến của tiêu đề
   nhạc (đặc biệt là nhạc Hàn/Nhật, nơi tên bài luôn nằm trong nháy):

     "CHUNG HA 청하 'Algorithm' MV"          → nháy: tên bài = Algorithm
     "aespa - Whiplash (Official Video)"     → gạch nối + nhãn ở cuối

   KHÔNG đoán khi không có dấu hiệu nào: "aespa Whiplash" trả về `null`, vì
   đoán sai thì người dùng phải sửa HAI ô thay vì một — gợi ý điền giúp mà
   bắt sửa nhiều hơn tự điền thì không phải gợi ý.
   Chỉ trả về khi CẢ HAI vế đều có nghĩa và khác nhau.
   ========================================================= */
const TAG_WORDS = [
  'mv', 'm/v', 'video', 'lyric', 'lyrics', 'audio', 'official', 'performance',
  'color coded', 'full album', '1 hour', 'loop', '4k', 'hd', '1080p', 'remaster',
  'teaser', 'visualizer', 'instruments',
]

/* Một nhóm trong ngoặc chỉ là NHÃN QUẢNG CÁO khi nó ngắn và chứa một trong
   các từ trên. Nhóm nằm GIỮA câu được giữ nguyên — "(feat. X)" là một phần
   thật của tên bài, không phải nhãn. */
const isTag = (inner) => {
  const w = inner.trim().toLowerCase()
  return w.length > 0 && w.length <= 28 && TAG_WORDS.some(x => w.includes(x))
}

function stripTags(str) {
  let out = str.trim()
  for (let i = 0; i < 4; i++) {
    const lead = out.match(/^[([{]([^)\]}]*)[)\]}]\s*/)
    const tail = out.match(/\s*[([{]([^)\]}]*)[)\]}]$/)
    if (lead && isTag(lead[1])) { out = out.slice(lead[0].length).trim(); continue }
    if (tail && isTag(tail[1])) { out = out.slice(0, out.length - tail[0].length).trim(); continue }
    break
  }
  return out
}

const tidy = (v) => v.replace(/\s+/g, ' ').replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, '').trim()

export function splitSong(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (s.length < 4) return null
  const cut = stripTags(s)

  /* 1. Tên bài nằm trong cặp nháy — khuôn của gần như mọi MV nhạc Hàn/Nhật. */
  const q = cut.match(/[\u2018\u2019'"\u201c\u201d]([^\u2018\u2019'"\u201c\u201d]{2,80})[\u2018\u2019'"\u201c\u201d]/)
  if (q) {
    const artist = tidy(cut.slice(0, q.index))
    const title = tidy(q[1])
    /* Một vế chỉ có MỘT ký tự thì chưa đủ để gọi là tên nghệ sĩ hay tên bài:
       "A - B" không phải là một tiêu đề video, và đoán bừa ở đây bắt người
       dùng sửa hai ô thay vì một. */
    if (artist.length >= 2 && title.length >= 2 && artist.length <= 120 && title.length <= 160
      && artist.toLowerCase() !== title.toLowerCase()) {
      return { artist, title }
    }
  }

  /* 2. Gạch nối giữa hai phần: lấy dấu gạch ĐẦU TIÊN, phần còn lại là tên bài. */
  const m = cut.match(/^(.{1,120}?)\s+[-–—]\s+(.{1,160})$/)
  if (m) {
    const artist = tidy(m[1])
    const title = tidy(m[2])
    if (artist.length >= 2 && title.length >= 2 && artist.toLowerCase() !== title.toLowerCase()) {
      return { artist, title }
    }
  }
  return null
}

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
  const out = real(rows)
  if (filter === 'picked') return out.sort(byPickOrder)
  /* Tab "In progress" là danh sách việc ĐANG CHẠY: xếp việc gần xong lên trước
     (%, giảm dần), hoà thì theo vote. Xếp theo vote như bảng thường là sai ngữ
     cảnh — người xem đang hỏi "còn bao lâu", không hỏi "bài nào nhiều phiếu". */
  if (filter === 'in_progress') return out.sort((a, b) => (b.progress || 0) - (a.progress || 0) || byVotes(a, b))
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
  for (const r of real(rows)) {
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
  /* Cụm trong tab In progress: lấy % cao nhất trong cụm làm mốc — một bài có
     hai dòng đang chạy thì dòng đi xa nhất mới là điều người xem cần thấy. */
  if (filter === 'in_progress') return out.sort((a, b) =>
    Math.max(0, ...b.rows.map(r => r.progress || 0)) - Math.max(0, ...a.rows.map(r => r.progress || 0))
    || (b.votes - a.votes))
  if (filter === 'newest') return out.sort((a, b) => (b.newest - a.newest) || (b.votes - a.votes))
  if (filter === 'top') return out.sort((a, b) => (b.votes - a.votes) || (b.newest - a.newest))
  return out.sort((a, b) => (b.paid - a.paid) || (b.votes - a.votes) || (b.newest - a.newest))
}

/* Bảng tổng vote theo từng bài, dùng cho chỗ nào vẫn phải liệt kê từng
   dòng riêng (bảng Admin chẳng hạn): key = groupKey, value = { n, total }. */
export function voteTotals(rows) {
  const m = new Map()
  for (const r of real(rows)) {
    const k = groupKey(r)
    const c = m.get(k) || { n: 0, total: 0 }
    c.n += 1
    c.total += r.votes || 0
    m.set(k, c)
  }
  return m
}

/* Bốn GIAI ĐOẠN của bảng — không chồng nhau, cộng lại đúng tổng số bài.
   ---------------------------------------------------------
   Khối thống kê và badge tab phải kể cùng một câu chuyện. Trước đây không ai
   đếm "đã chốt nhưng chưa khởi động": bài đó không nằm trong In queue (vì đã
   chốt), không nằm trong In progress (vì chưa chạy), cũng không nằm trong
   Completed — nó rơi vào khoảng trống, nên bốn con số cộng lại thiếu so với
   bảng và mục Up next nhìn như thuộc hệ thống khác.

   Mỗi BÀI vào đúng một giai đoạn, lấy theo dòng "cao nhất" của bài đó (một bài
   có ba người gửi thì cả ba dòng nằm chung một thẻ, không nhân ba con số).
   `total` là số bài — hằng đẳng thức queued + picked + in_progress + completed
   === total được test giữ, nên không ai lặng lẽ bỏ rơi một giai đoạn nữa. */
export const STAGES = ['queued', 'picked', 'in_progress', 'completed']
export function stageCounts(rows) {
  const rank = new Map()
  for (const r of rows || []) {
    if (!r || !STAGES.includes(r.status)) continue
    /* in_progress mà chưa có picked_at vẫn là "đang chạy" — xếp trên picked */
    const own = r.status === 'completed' ? 3
      : r.status === 'in_progress' ? 2
      : (r.picked_at ? 1 : 0)
    const key = groupKey(r)
    const prev = rank.get(key)
    if (prev === undefined || own > prev) rank.set(key, own)
  }
  const out = { queued: 0, picked: 0, in_progress: 0, completed: 0 }
  for (const own of rank.values()) out[STAGES[own]] += 1
  out.total = rank.size
  return out
}

/* Số BÀI trong một tập dòng — không phải số dòng. Mọi con số đứng cạnh danh
   sách (badge tab, ô thống kê) phải đếm theo cùng đơn vị với thứ được liệt kê:
   bảng gom cụm theo bài, nên một bài có ba người gửi là MỘT thẻ. Đếm theo dòng
   thì badge ghi 3 mà dưới chỉ có 1 thẻ — đó là kiểu "lệch số" người dùng nhìn
   ra ngay mà không gọi được tên. */
export const songCount = (rows) => new Set(real(rows).map(groupKey)).size

/* Hai thẻ "This week". Cửa sổ là 7 ngày lăn, không phải tuần lịch.
   "Hoạt động trong cửa sổ" = MỘT request của bài được GỬI trong cửa sổ,
   HOẶC XONG trong cửa sổ, HOẶC NHẬN ÍT NHẤT MỘT VOTE trong cửa sổ — cùng luật
   "vote nhận trong mùa" của Leaderboard (src/lib/season.js, chủ dự án chốt
   26/09): bài cũ mà được vote nhiều 7 ngày qua vẫn thuộc "This week".
   Không tính bài bị từ chối (denied). Bài chờ duyệt (pending) vẫn được hiện
   ở thẻ bài mới nhất để người gửi thấy yêu cầu của mình ngay.
   "Most voted" = bài NHIỀU VOTE NHẬN TRONG CỬA SỔ NHẤT, phải có ÍT NHẤT một
   phiếu nhận trong cửa sổ. Bài mới chưa ai vote không được đội nhãn đó chỉ
   vì nó là hàng duy nhất trong cửa sổ. Con số in trên thẻ là phiếu NHẬN
   TRONG CỬA SỔ, không phải cộng dồn.
   Thẻ "New this week" luôn giữ bài mới GỬI nhất trong cửa sổ (bài chỉ "mới"
   vì được vote không phải bài mới). Nếu bài nhiều phiếu nhất cũng là bài mới
   nhất và còn bài mới khác thì thẻ New lấy bài mới kế tiếp; nếu chỉ có một
   bài mới thì vẫn giữ thẻ New để không làm mất phần yêu cầu mới nhất. */
const WEEK_MS = 7 * 86400000
export function weeklyHighlights(rows, now = Date.now(), votesLog = []) {
  const since = now - WEEK_MS
  const votes = votesByRequest(votesLog, since, now)
  const doneAt = (r) => ts(r.completed_at) || ts(r.updated_at) || ts(r.created_at)
  const recent = real(rows).filter((r) => {
    if (r.status === 'denied') return false
    if (ts(r.created_at) >= since) return true
    if (r.status === 'completed' && doneAt(r) >= since) return true
    return (votes.get(r.id) || 0) > 0
  })
  const groups = groupRows(recent)
  for (const g of groups) g.windowVotes = g.rows.reduce((n, r) => n + (votes.get(r.id) || 0), 0)
  const byVotes = [...groups].sort((a, b) => b.windowVotes - a.windowVotes || b.newest - a.newest)
  const topGroup = byVotes.find((g) => g.windowVotes > 0) || null
  const newGroups = groups.filter((g) => g.rows.some((r) => ts(r.created_at) >= since))
  const byNew = newGroups.sort((a, b) => b.newest - a.newest || b.windowVotes - a.windowVotes)
  const newGroup = (topGroup && byNew.length > 1 && byNew[0].key === topGroup.key)
    ? byNew[1]
    : (byNew[0] || null)
  const card = (g, windowVotes) => {
    if (!g) return null
    const newest = [...g.rows].sort((a, b) => ts(b.created_at) - ts(a.created_at))[0]
    return {
      title: g.title,
      artist: g.artist,
      votes: windowVotes ?? g.votes,
      requester: newest?.requester || '',
    }
  }
  return { top: card(topGroup, topGroup?.windowVotes), newcomer: card(newGroup) }
}

/* DÂY CHUYỀN đã chốt, bài đang chạy lên trước rồi tới ngày chốt — nguồn của
   khối Up next VÀ của hai tab "Up next"/"In progress". Cùng một tập thì badge,
   nắp khối và danh sách không thể lệch nhau (xem boardSync.test.js). */
export const chainRows = (rows) => real(rows).filter(inChain).sort((a, b) =>
  (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1)
  || ((+new Date(a.picked_at) || 0) - (+new Date(b.picked_at) || 0)))

/* =========================================================
   LỌC BẢNG — MỘT hàm cho mọi đường vào bảng
   ---------------------------------------------------------
   Khối này từng nằm trong App.jsx (`const visible = useMemo(...)`), tức là
   không có cách nào kiểm thử nó mà không dựng cả giao diện. Mà đây đúng là
   chỗ sinh ra lỗi người dùng báo: "bấm một bài trong trang cá nhân thì bảng
   nói KHÔNG CÓ KẾT QUẢ" — từ khoá đúng, nhưng một bộ lọc CÒN SÓT (chip
   `Queued` bật từ lần trước, hoặc `f=top` mà link cũ để lại) đã giấu bài đó.
   Tách ra đây để mỗi vế của luật đó có một ca kiểm thử.

   Thứ tự áp dụng:
     1. `statusFilters` (chọn NHIỀU giai đoạn) thắng `filter` khi có mặt.
        Chip "Up next"/"In progress" lọc bằng `inChain` (đã chốt HOẶC đang
        làm) — cùng tập với khối Up next, với tab và với badge
        (pickedGroups.length), nên request bấm "Start production" vẫn hiện
        trong filter Up next; "Queue" là chờ vote chưa chốt, "Done" là xong;
     2. rỗng thì `filter` quyết định tập nền: queued / picked / in_progress /
        completed / newest (cả bảng);
     3. `top` CHỈ liệt kê bài đang xin phiếu — bài đã xong hoặc đã vào dây
        chuyền bị loại. Vì vậy một link muốn dẫn tới MỘT BÀI BẤT KỲ phải dùng
        `newest`; dùng `top` là bấm vào bài đang làm rồi nhận trang trống;
     4. `watch` lấy từ `rows`, không từ `pub`: người theo dõi muốn thấy cả bài
        đang chờ duyệt / bị từ chối của chính mình;
     5. `kindFilters` rỗng nghĩa là mọi loại bài;
     6. từ khoá đi qua `searchHit` (bỏ dấu + so theo từ).
   ========================================================= */
export function filterBoard(opts = {}) {
  const {
    pub = [], rows = [], filter = 'queued',
    statusFilters = [], kindFilters = [], q = '', watchedSet = new Set(),
  } = opts
  const picked = opts.picked || chainRows(pub)
  const t = (q ?? '').trim()
  let base = real(pub)
  if (filter === 'newest' && t && rows?.length) {
    base = real(rows).filter(r => r.status !== 'denied')
  } else if (statusFilters.length) {
    /* Chip "Up next" và "In progress" lọc bằng `inChain` — ĐÚNG tập của khối
       Up next, của hai tab và của số badge (pickedGroups.length): bài đã chốt
       (picked_at) HAY đang làm. Vì vậy request vẫn ở lại filter Up next sau
       khi admin bấm "Start production" (queued → in_progress). Bản cũ dùng
       `isPicked && status !== 'in_progress'` nên đúng lúc đó request biến mất
       khỏi filter — mà số badge vẫn đếm nó, thành ra lệch số. Chip In
       progress trước đây chỉ lọc `status === 'in_progress'` (bỏ qua bài đã
       chốt đang chờ tới lượt) cũng lệch với tab/badge của chính nó. */
    base = base.filter(r => statusFilters.some(s => s === 'picked' || s === 'in_progress'
      ? inChain(r)
      : s === 'queued' ? r.status === 'queued' && !r.picked_at
      : s === 'completed' && r.status === 'completed'))
  } else if (filter === 'queued') base = base.filter(r => r.status === 'queued' && !r.picked_at)
  else if (filter === 'picked' || filter === 'in_progress') base = picked
  else if (filter === 'completed') base = base.filter(r => r.status === 'completed')
  /* `newest` và `top` giữ tập nền rồi mới lọc tiếp ở hai dòng dưới. */
  if (filter === 'top') base = base.filter(r => r.status !== 'completed' && !inChain(r))
  if (filter === 'watch') base = real(rows).filter(r => watchedSet.has(groupKey(r)))
  if (kindFilters.length) base = base.filter(r => kindFilters.includes(r.kind))
  if (t) base = base.filter(r => searchHit(r, t))
  return base
}

/* Danh sách cuối cùng để render + phân trang: cụm nhiều dòng thành một
   thẻ gập/mở được, cụm một dòng giữ nguyên hàng thường. */
export function boardItems(rows, filter) {
  return sortGroups(groupRows(sortRows(real(rows), filter)), filter)
    .map((g) => (g.rows.length > 1
      ? { type: 'group', ...g }
      : { type: 'row', key: g.key, r: g.rows[0] }))
}
