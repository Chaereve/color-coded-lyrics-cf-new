/* =========================================================
   MÙA GIẢI — tuần này / tháng này, tính ngay trên máy người xem
   ---------------------------------------------------------
   Bảng xếp hạng cũ chỉ có MỘT góc nhìn: toàn bộ thời gian. Người mới gửi
   bài tháng này không có cửa nào so với người đã tích luỹ hai năm — và
   người xem không trả lời được câu đơn giản nhất: "tuần này ai được lên
   sóng nhiều nhất?".

   Vì sao không làm bằng SQL:
   · Bảng `requests` KHÔNG có cột `completed_at` (schema chỉ có created_at,
     updated_at, picked_at). Muốn có mốc "xong lúc nào" THẬT thì phải thêm
     cột + backfill — một lần migration cho một tính năng đọc.
   · Toàn bộ hàng đang xem đã có sẵn trên máy (`fetchRequests`, tối đa 800
     hàng mới nhất). Gom lại theo cửa sổ thời gian là việc thuần tuý của
     client, không cần round-trip nào.
   Quyết định: tính client-side, KHÔNG migration. Cái giá phải trả là mốc
   "bài xong trong mùa" chỉ là XẤP XỈ — nói rõ bên dưới.

   MỐC BÀI XONG (hàm `doneAt`): cùng một luật fallback mà khối Hall of fame
   đang dùng (`completed_at || updated_at || created_at`), lấy nguồn gốc từ
   đó mà ra:
   · `completed_at` — chưa tồn tại trong schema, nhưng nếu một ngày nào đó
     cột được thêm, code này tự dùng nó trước, không phải sửa;
   · `updated_at`   — hàng đã xong mà được chạm vào sau này (admin sửa link,
     đổi ghi chú) sẽ bị tính theo lần chạm đó. Đây là chỗ xấp xỉ, chấp nhận
     được vì bài vừa được sửa thường cũng là bài vừa được xong;
   · `created_at`   — chốt chặn cuối, không bao giờ là NaN.

   LUẬT XẾP TRONG MÙA: xếp theo SỐ BÀI ĐÃ XONG trong cửa sổ, không xếp theo
   số bài gửi. Ghi chú C3-14 trong docs đã hoãn một bảng "top người gửi
   tháng" đúng vì nó khuyến khích đua số lượng; mùa giải ở đây trả lời câu
   "cộng đồng nhận được gì trong tuần/tháng này", không phải "ai bấm gửi
   nhiều nhất". Cách xếp vẫn đổi được (ba con số như bảng tổng), nhưng mọi
   con số đều bị cắt theo cửa sổ và câu luật trên màn hình nói rõ điều đó.

   PHIẾU: bảng `votes` không có mốc thời gian theo bài trong dữ liệu đang
   tải về, nên KHÔNG thể đếm "phiếu nhận trong mùa". Con số phiếu trên bảng
   mùa là phiếu của các bài GỬI trong mùa (cộng dồn tới nay) — UI phải nói
   đúng câu đó, không được để người xem tự hiểu là "phiếu trong tuần".

   Múi giờ: Asia/Ho_Chi_Minh. "Tuần này" của một bảng request tiếng Việt
   phải đổi ngày lúc nửa đêm giờ Việt Nam, không phải nửa đêm UTC — lệch
   nhau 7 tiếng, đủ để một bài xong tối Chủ nhật rơi sang tuần sau.
   Tuần bắt đầu THỨ HAI (lịch Việt Nam), không phải Chủ nhật.
   ========================================================= */

export const TZ = 'Asia/Ho_Chi_Minh'

/* Ba góc nhìn thời gian. `all` là bảng cũ — toàn bộ thời gian, không cửa sổ.
   Nhãn nút nằm trong từ điển (rank.period.*) và được gọi nguyên văn từng key
   trong Leaderboard — không ghép động, vì họ key này không có tiền tố động. */
export const PERIODS = [{ k: 'all' }, { k: 'week' }, { k: 'month' }]

const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/* "Hôm nay" theo lịch Việt Nam, dạng 'YYYY-MM-DD'. `en-CA` vì nó là locale
   duy nhất in ra đúng thứ tự năm-tháng-ngày, không phải ngày/tháng kiểu Mỹ.
   `now` nhận vào là millis UTC — mọi hàm trong module này đều nhận `now` để
   test khoá được bằng một ngày cố định, không phụ thuộc đồng hồ máy chạy test. */
export function vnDayKey(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now))
}

/* 'YYYY-MM-DD' (ngày theo LỊCH, không phải thời khắc) -> millis UTC của
   00:00:00 giờ Việt Nam ngày đó. Date.parse coi chuỗi không-múi-giờ là UTC,
   nên phải trừ đúng số giờ mà Việt Nam đang lệch (UTC+7, không DST — nhưng
   vẫn hỏi lại formatToParts thay vì hardcode 7, để nếu lịch sử đổi thì code
   đổi theo). */
export function vnDayStartUtc(dayKey) {
  const base = Date.parse(`${dayKey}T00:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(base))
  const at = (t) => Number(parts.find((p) => p.type === t)?.value || 0)
  return base - ((at('hour') * 60 + at('minute')) * 60 + at('second')) * 1000
}

/* Cửa sổ [start, end) của một mùa, theo giờ Việt Nam. Trả về `null` cho
   'all' — không cửa sổ nghĩa là không lọc.
   - week: Tuần lịch Thứ Hai - Chủ Nhật, reset vào 00:00 Thứ Hai (giờ VN).
   - month: Tháng lịch (từ ngày 1 đến ngày 1 tháng kế tiếp, giờ VN). */
export function seasonWindow(period, now = Date.now()) {
  if (period !== 'week' && period !== 'month') return null
  const day = vnDayKey(now)
  const start = vnDayStartUtc(day)
  if (period === 'week') {
    /* Thứ trong tuần phải hỏi LỊCH VN (chuỗi `day`), không phải mốc UTC vừa
       dựng: 00:00 thứ Hai giờ VN vẫn là 17:00 Chủ nhật UTC, đọc getUTCDay
       trên mốc đó là lùi sai hẳn một tuần. `Date.parse('YYYY-MM-DD…Z')` cho
       đúng thứ của ngày theo lịch; 0 = Chủ nhật, và lịch Việt Nam coi thứ Hai
       là ngày đầu tuần nên Chủ nhật phải lùi 6 ngày chứ không phải 0. */
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
    const weekStart = start - ((dow + 6) % 7) * 86400000
    return { start: weekStart, end: weekStart + 7 * 86400000 }
  }
  const [y, m] = day.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start: vnDayStartUtc(`${y}-${String(m).padStart(2, '0')}-01`), end: vnDayStartUtc(next) }
}

export const seasonWindowCalendar = seasonWindow

/* Mốc "bài này xong lúc nào" — xem giải thích luật fallback ở đầu file.
   Hàng CHƯA xong thì mốc là mốc GỬI: để đếm "bài gửi trong mùa". */
const doneAt = (r) => {
  const t = (v) => { const ms = Date.parse(v); return Number.isFinite(ms) ? ms : NaN }
  for (const k of ['completed_at', 'updated_at', 'created_at']) {
    const ms = t(r?.[k])
    if (!Number.isNaN(ms)) return ms
  }
  return NaN
}

const sentAt = (r) => {
  const ms = Date.parse(r?.created_at)
  return Number.isFinite(ms) ? ms : NaN
}

/* =========================================================
   GOM SỐ THEO MÙA — ra CÙNG HÌNH DẠNG với `requester_ranking`
   ---------------------------------------------------------
   Một `user_id` là một dòng: { total, completed, total_votes } — nhưng cả ba
   con số đều bị cắt theo cửa sổ:
   · `total`     — bài GỬI trong mùa (bị từ chối không tính, cùng luật view);
   · `completed` — bài XONG trong mùa (theo mốc `doneAt` ở trên);
   · `total_votes` — phiếu (cộng dồn) của các bài GỬI trong mùa.
   Tên + avatar lấy từ bảng xếp hạng tổng (`ranking`) khi có — đó là tên hiển
   thị và ảnh đã được chốt ở view thật; hàng demo không có trong đó thì lùi
   về `requester` trên chính hàng request, giống `rankDemo`.
   Người có bài trong mùa nhưng chưa xong bài nào VẪN có mặt (total > 0,
   completed = 0): bảng nói thật là họ có gửi, thay vì biến mất.
   ========================================================= */
export function seasonRows(rows, ranking, period, now = Date.now()) {
  if (period !== 'week' && period !== 'month') return rows || []
  const win = seasonWindow(period, now)
  if (!win) return rows || []
  const byUser = new Map()
  for (const r of rows || []) {
    if (!r || r.status === 'denied') continue
    const sent = sentAt(r)
    const done = r.status === 'completed' ? doneAt(r) : NaN
    const sentIn = Number.isFinite(sent) && sent >= win.start && sent < win.end
    const doneIn = r.status === 'completed' && Number.isFinite(done) && done >= win.start && done < win.end
    if (!sentIn && !doneIn) continue
    const id = r.user_id ?? 'anon'
    let g = byUser.get(id)
    if (!g) byUser.set(id, g = { user_id: id, names: new Map(), total: 0, completed: 0, total_votes: 0 })
    const nm = String(r.requester ?? '').trim()
    if (nm) g.names.set(nm, (g.names.get(nm) || 0) + 1)
    if (sentIn) { g.total++; g.total_votes += n(r.votes) }
    if (doneIn) g.completed++
  }
  const known = new Map((ranking || []).map((p) => [p?.user_id, p]))
  return [...byUser.values()].map((g) => {
    const prof = known.get(g.user_id)
    let name = prof?.name || ''
    if (!name) {
      /* không có trong bảng tổng: lấy tên dùng nhiều nhất trên các hàng,
         bằng nhau thì theo thứ tự chữ — đúng luật `max(name)` của view. */
      let best = -1
      for (const [nm, count] of g.names) {
        if (count > best || (count === best && nm > name)) { name = nm; best = count }
      }
    }
    return {
      user_id: g.user_id, key: g.user_id, name: name || 'anon',
      avatar_url: prof?.avatar_url ?? null,
      total: g.total, completed: g.completed, total_votes: g.total_votes,
    }
  })
}

/* Nhãn khoảng ngày cho UI: '15/09 – 21/09' (ngày/tháng, giờ Việt Nam).
   Chỉ dùng cho week/month — 'all' không có khoảng nào để in. */
export function seasonLabel(period, now = Date.now(), locale = 'en-GB') {
  const win = seasonWindow(period, now)
  if (!win) return ''
  const fmt = new Intl.DateTimeFormat(locale, { timeZone: TZ, day: '2-digit', month: '2-digit' })
  /* end là mốc LOẠI TRỪ (00:00 ngày kế tiếp) — lùi 1ms để in đúng ngày cuối. */
  return { from: fmt.format(new Date(win.start)), to: fmt.format(new Date(win.end - 1)) }
}
