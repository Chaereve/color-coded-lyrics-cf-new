/* =========================================================
   THEO DÕI REQUEST + THÔNG BÁO
   ---------------------------------------------------------
   Ba việc, theo đúng thứ tự người dùng cần:

     1. GỬI RỒI THÌ PHẢI BIẾT. Request của chính mình được TỰ ĐỘNG theo dõi
        (đừng bắt người ta đi dò cái chuông): duyệt / từ chối / lên sóng là
        ba tin bắt buộc, không có công tắc tắt.

     2. BIẾT MÌNH ĐỨNG Ở ĐÂU SO VỚI GIỜ CHỐT. Mỗi đợt chốt chỉ lấy MỘT bài
        (xem pick_top_request trong schema.sql), nên "còn 2 vote nữa là tới
        lượt" là tin DUY NHẤT mà người đọc làm được điều gì đó. Một cái log
        trạng thái thì bảng đã hiện sẵn, chẳng cần báo.

     3. ĐỌC LÚC NÀO CŨNG ĐƯỢC. Hộp thư là pop-up NGAY TẠI CHỖ (không có trang
        riêng — bản có trang "Updates" đã bỏ theo yêu cầu người dùng): bấm ra
        ngoài là đóng, badge còn thì tin còn, vào lúc nào cũng đọc được.

   Logic thuần: không React, không Supabase — chạy trong demo (localStorage),
   test bằng `node --test`, và khi xuống database thì CHỈ phải thay
   loadWatched/saveWatched/loadInbox/saveInbox, phần so sánh giữ nguyên.
   Thiết kế SQL: docs/THEO-DOI-THONG-BAO.md

   Khoá theo dõi là groupKey(artist + title) — đúng cái board.js dùng để gom
   cụm — nên một bài bị ba người gửi lẻ vẫn chỉ là MỘT mục theo dõi, và dòng
   request bị xoá không làm mất dấu bài.
   ========================================================= */
import { groupKey } from './board.js'

/* ---------- trần & ngưỡng ---------- */
const DAY = 86_400_000                 /* một ngày tính bằng ms, cho sàn thời gian */
export const WATCH_LIMIT = 60
export const INBOX_LIMIT = 60
/* "Sát nút" = cách vị trí được chốt không quá N vote. Đặt 3 vì một lá phiếu
   lẻ là đổi hạng được ngay, mà nhắc sớm hơn thì thành vô duyên */
export const NEAR_GAP = 3

/* Ưu tiên khi CÙNG MỘT LƯỢT một bài có mấy thay đổi: chỉ giữ tin đáng đọc
   nhất. `near`/`lead` đứng đầu vì nó hết hạn sau vài giờ, các tin khác để
   trong hộp thư vẫn đọc được. */
const PRIORITY = ['near', 'lead', 'done', 'denied', 'picked', 'started', 'approved', 'progress', 'votes']

/* ---------- lưu trữ (demo: localStorage) ---------- */
const K_WATCH = (uid) => `ccl3_watch:${uid || 'anon'}`
const K_BOX = (uid) => `ccl3_box:${uid || 'anon'}`
const K_PREF = (uid) => `ccl3_pref:${uid || 'anon'}`
/* Những bài CỦA MÌNH mà người dùng ĐÃ TAY tắt theo dõi: danh sách này để
   `syncOwnRequests` không dám bật lại — tắt là tắt hẳn. */
const K_OFF = (uid) => `ccl3_woff:${uid || 'anon'}`

const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d } catch { return d } }
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* chế độ ẩn danh: bỏ qua */ } }

/* prefs — bốn cái, đều có nghĩa thật:
   auto     : tự theo dõi request do chính mình gửi
   near     : nhắc khi sát giờ chốt / khi vừa lên vị trí số 1
   progress : % tiến độ nhích — ồn, mặc định TẮT
   votes    : mỗi mốc 5 vote — ồn, mặc định TẮT */
export const DEFAULT_PREFS = { auto: true, near: true, progress: false, votes: false }

export function loadPrefs(uid) { return { ...DEFAULT_PREFS, ...rd(K_PREF(uid), {}) } }
export function savePrefs(uid, p) { wr(K_PREF(uid), p) }

/* Mảng, không phải Set, để mỗi mục nhớ thêm: bài của mình (own) và lúc bắt
   đầu theo dõi — hộp thông báo tách "Của bạn" khỏi "Đang theo dõi" bằng
   đúng cờ đó. */
export function loadWatched(uid) {
  const list = rd(K_WATCH(uid), [])
  return Array.isArray(list) ? list.filter(x => x && typeof x.key === 'string') : []
}
export function saveWatched(uid, list) { wr(K_WATCH(uid), list.slice(0, WATCH_LIMIT)) }
export const watchedKeys = (list) => new Set((list || []).map(w => w.key))

export function toggleWatched(list, row, at = Date.now(), off = []) {
  const key = groupKey(row)
  const cur = Array.isArray(list) ? list : []
  const optOut = Array.isArray(off) ? off : []
  if (cur.some(w => w.key === key)) {
    /* tắt bài của mình -> ghi vào `off`, tự động không được bật lại */
    const nextOff = row.own || cur.find(w => w.key === key)?.own ? [...new Set([...optOut, key])] : optOut
    return { list: cur.filter(w => w.key !== key), added: false, full: false, key, off: nextOff }
  }
  /* Chạm trần thì KHÔNG loại bài cũ âm thầm: người dùng phải tự bỏ, vì
     quietly mất một cái đã bật là lỗi khó chịu hơn từ chối thêm một cái. */
  if (cur.length >= WATCH_LIMIT) return { list: cur, added: false, full: true, key, off: optOut }
  return {
    list: [{ key, title: row.title, artist: row.artist, own: !!row.own, at }, ...cur],
    added: true, full: false, key,
    /* bat lai thu cong la xoa ten khoi danh sach "don xin cho" */
    off: optOut.filter(k => k !== key),
  }
}

/* Tự theo dõi bài của chính mình: CHỈ thêm, không bao giờ xoá, gọi lại mỗi
   lần bảng đổi nên idempotent. Trả về null khi không có gì mới — caller khỏi
   set state, khỏi ghi localStorage không việc gì. */
export function syncOwnRequests(rows, uid, list, prefs = {}, at = Date.now(), off = []) {
  if (prefs.auto === false || !uid) return null
  const optedOut = new Set(Array.isArray(off) ? off : [])
  const cur = Array.isArray(list) ? list : []
  const has = new Set(cur.map(w => w.key))
  const fresh = []
  for (const r of rows) {
    if (r.user_id !== uid) continue
    const k = groupKey(r)
    if (has.has(k) || optedOut.has(k)) continue
    has.add(k)
    fresh.push({ key: k, title: r.title, artist: r.artist, own: true, at })
  }
  if (!fresh.length) return null
  const merged = [...fresh, ...cur]
  const trimmed = merged.length > WATCH_LIMIT
  return { list: merged.slice(0, WATCH_LIMIT), trimmed, added: fresh.length }
}

/* ---------- vị trí so với đợt chốt kế tiếp ----------
   Mô phỏng ĐÚNG thứ tự của pick_top_request(): hàng queued chưa chốt, paid
   trước, rồi tới TỔNG vote của cả bài (tính cả hàng đang in_progress), rồi
   created_at SỚM hơn thắng. Có chỗ khác với tab "Top voted" ngoài bảng (ở
   đó bài mới hơn thắng khi hoà vote) — nhưng nhắc người dùng thì phải theo
   luật của database, vì chính nó quyết định bài nào được làm. */
export function pickLadder(rows, pick = null, now = Date.now()) {
  const totals = new Map()
  for (const r of rows || []) {
    if (r.status !== 'queued' && r.status !== 'in_progress') continue
    const k = groupKey(r)
    totals.set(k, (totals.get(k) || 0) + (Number(r.votes) || 0))
  }
  const byKey = new Map()
  for (const r of rows || []) {
    if (r.status !== 'queued' || r.picked_at) continue     // chỉ hàng này mới được chốt
    const k = groupKey(r)
    const cand = {
      key: k, title: r.title, artist: r.artist,
      total: totals.get(k) || 0, paid: !!r.is_paid, created: +new Date(r.created_at) || 0,
    }
    if (!byKey.has(k) || cand.created < byKey.get(k).created) byKey.set(k, cand)
  }
  const ladder = [...byKey.values()].sort((a, b) =>
    (b.paid - a.paid) || (b.total - a.total) || (a.created - b.created))
  const leader = ladder[0]
  const anyPaid = ladder.some(g => g.paid)
  const rank = new Map()
  ladder.forEach((g, i) => {
    /* bài dẫn đầu là paid thì vote không vượt được (database xếp paid
       trước, không kể vote) — nói "thiếu 5 vote" trong lúc đó là nói dối */
    const blocked = i > 0 && anyPaid && !g.paid
    rank.set(g.key, {
      rank: i + 1,
      total: g.total,
      paid: g.paid,
      /* cần bao nhiêu phiếu NỮA để vượt lên dẫn đầu */
      gap: i === 0 ? 0 : Math.max(1, (leader.total + 1) - g.total),
      blocked,
      /* Sàn thời gian tới lượt. Gắn vào đây chứ không bắt từng chỗ gọi tự
         tính: mọi nơi đang hiện "bài này đứng đâu" đều đã có `st` trong tay,
         nên "bao giờ" đi tới đó mà không phải luồn thêm prop qua mấy tầng. */
      eta: pickEta({ rank: i + 1, blocked }, pick, now),
    })
  })
  return { ladder, rank }
}

/* =========================================================
   BAO GIỜ TỚI LƯỢT BÀI NÀY — câu hỏi tốn tiền nhất, và câu trả lời phải là SÀN
   ---------------------------------------------------------
   Người đã gửi request (nhất là người đã trả tiền) chỉ hỏi một câu: "bao giờ
   có video?". Bảng trả lời được "còn cách 2 vote" — nhưng đó là việc của
   NGƯỜI KHÁC bỏ phiếu, không phải một mốc thời gian ai cũng tự tính được.

   Cách tính:
     · tới đợt chốt kế tiếp: lấy từ settings.pick.next_pick_at — đúng cái mốc
       mà đồng hồ đếm ngược trên đầu bảng đang chạy, nên hai chỗ không bao giờ
       nói hai chuyện khác nhau. Chưa tới thì lấy tròn theo chu kỳ;
     · mỗi đợt chốt lấy MỘT bài và cách nhau interval_days (mặc định 4), nên
       bài đang đứng hạng r phải qua thêm (r - 1) đợt nữa.

   Vì sao luôn nói "sớm nhất": bài khác có thể vượt lên bằng vote, tức thời
   gian thật chỉ có thể MUỘN HƠN con số này. Một con số kèm chữ "khoảng" mà
   lại có thể trễ hơn thì vẫn là nói thật; một con số không có gì bảo đảm thì
   là hứa.

   Không trả về gì khi: bài đang dẫn đầu (đồng hồ đếm ngược đã nói rồi, thêm
   nữa chỉ lặp), bài bị một request đã trả tiền chặn trước (không hứa được
   gì), hoặc hạng quá xa — lúc đó con số chỉ còn là trò chơi chữ.
   ========================================================= */
export const ETA_MAX_RANK = 20
export const ETA_DEFAULT_INTERVAL = 4

export function pickEta(st, pick, now = Date.now()) {
  if (!st || !st.rank || st.blocked) return null
  if (st.rank === 1 || st.rank > ETA_MAX_RANK) return null
  const interval = Math.max(1, Math.round(Number(pick?.interval_days) || ETA_DEFAULT_INTERVAL))
  const next = +new Date(pick?.next_pick_at || 0) || 0
  /* Đếm theo NGÀY TRÒN: "còn 6 giờ nữa chốt" phải hiện là 1 ngày chứ không
     phải 0 — hứa "0 ngày" là nói sai rõ ràng nhất. */
  const toNext = next > now ? Math.ceil((next - now) / DAY) : interval
  return { days: toNext + (st.rank - 1) * interval, interval, rank: st.rank }
}

/* Đơn vị để hiển thị: ngày → tuần → tháng. Trả về KHOÁ TỪ ĐIỂN chứ không trả
   về câu chữ: watch.js là logic thuần, không biết gì về i18n (và nhờ vậy
   kiểm thử được bằng node --test, không cần dựng giao diện). */
export function etaKey(days) {
  const d = Math.max(1, Math.round(Number(days) || 0))
  if (d < 12) return { key: 'standing.etaDays', n: d }
  if (d < 56) return { key: 'standing.etaWeeks', n: Math.max(1, Math.round(d / 7)) }
  /* Sàn 2 tháng: "ít nhất 1 tháng" cho một con số 57 ngày là nói giảm */
  return { key: 'standing.etaMonths', n: Math.max(2, Math.round(d / 30)) }
}

/* ---------- snapshot: thứ đem ra so sánh giữa hai lần bảng đổi ----------
   `uid` + `rank` được nhét luôn vào snapshot để lần sau còn biết "hồi nãy
   nó đứng thứ mấy, cách bao xa" — nhờ đó tin "sát nút" chỉ bắn MỘT lần khi
   bài vừa nhảy vào vùng 3 vote, chứ không bắn theo từng lá phiếu. */
export function snapOf(rows, uid = null, rank = null) {
  const m = new Map()
  for (const r of rows || []) {
    if (!r?.id) continue
    const key = groupKey(r)
    const st = rank?.get(key)
    m.set(String(r.id), {
      key,
      title: r.title || '', artist: r.artist || '', kind: r.kind || '',
      status: r.status || '', progress: Number(r.progress) || 0, votes: Number(r.votes) || 0,
      video_url: r.video_url || null, picked: !!r.picked_at,
      reason: r.deny_reason || null,
      own: !!uid && r.user_id === uid,
      rank: st ? { rank: st.rank, gap: st.gap, blocked: st.blocked } : null,
    })
  }
  return m
}

/* Một lần đổi của MỘT dòng → danh sách sự kiện (rỗng = không đáng báo).
   Tách riêng để test trực tiếp từng cặp trước/sau. */
export function rowEvents(p, n, prefs = {}) {
  const out = []
  if (!p || !n) return out
  const s0 = p.status, s1 = n.status

  if (s1 !== s0) {
    if (s1 === 'denied') out.push({ type: 'denied', reason: n.reason || null })
    else if (s1 === 'completed') out.push({ type: 'done', url: n.video_url || null })
    else if (s1 === 'in_progress') out.push({ type: 'started' })
    /* pending → queued: vừa được duyệt, mở cho vote */
    else if (s0 === 'pending') out.push({ type: 'approved', votes: n.votes })
  }
  /* Vào Up next: vote đóng ngay tại đó, đang theo dõi mà không biết là
     mất tiền oan (vote vào bài đã chốt thì bị chặn ở database). */
  if (!p.picked && n.picked && s1 !== 'completed') out.push({ type: 'picked' })

  /* Tien do bai CUA MINH thi bao bat buoc: day la cai nguoi gui muon biet
     nhat, de sau mot cong tac "bat moi duoc xem" la khong ai tim thay no. */
  if ((prefs.progress || n.own) && s1 === 'in_progress' && n.progress > p.progress) {
    out.push({ type: 'progress', pct: n.progress })
  }
  if (prefs.votes && n.votes > p.votes && Math.floor(n.votes / 5) > Math.floor(p.votes / 5)) {
    out.push({ type: 'votes', votes: n.votes })
  }

  if (prefs.near !== false && s1 === 'queued' && !n.picked) {
    const now = n.rank, was = p.rank
    if (now?.rank === 1 && was && was.rank > 1) out.push({ type: 'lead' })
    else if (now && now.rank > 1 && !now.blocked && now.gap <= NEAR_GAP
             && !(was && !was.blocked && was.gap <= NEAR_GAP)) {
      out.push({ type: 'near', rank: now.rank, gap: now.gap })
    }
  }
  return out
}

/* So hai snapshot, chỉ xét bài ĐƯỢC THEO DÕI, ép về một tin / bài.
   `cycle` là last_pick_at: id tin "sát nút" có nó, nên mỗi chu kỳ chốt chỉ
   nhắc ĐÚNG MỘT LẦN cho một bài, và cùng một thay đổi realtime đẩy về hai
   lần vẫn không nhân đôi dòng nào. */
export function diffNotices({ prev, next, watched, voted = null, prefs = {}, cycle = '', at = Date.now() }) {
  if (!prev?.size || !next?.size) return []
  /* Hop nhat "dang theo doi" + "minh da vote" — dung Set cong dan, vi `new
     Set()` trong tay la gia tri that (truthy) nen dung dung `a || b` la
     danh mat tap hop con lai. */
  const scope = new Set()
  if (watched?.size) for (const k of watched) scope.add(k)
  if (voted?.size) for (const k of voted) scope.add(k)
  if (!scope.size) return []
  const best = new Map()
  for (const [id, n] of next) {
    if (!scope.has(n.key)) continue
    const p = prev.get(id)
    if (!p) continue                                  // dòng mới xuất hiện: chưa có gì để so
    for (const ev of rowEvents(p, n, prefs)) {
      const sig = ev.type === 'done' ? `done:${n.video_url || ''}`
        : ev.type === 'progress' ? `progress:${ev.pct}`
        : ev.type === 'votes' ? `votes:${ev.votes}`
        : ev.type === 'near' || ev.type === 'lead' ? `${ev.type}:${cycle}:${ev.gap ?? ''}`
        : `${ev.type}:${n.status}:${n.picked ? 1 : 0}`
      const item = {
        id: `${n.key}|${sig}`,
        key: n.key, type: ev.type, at, own: !!n.own,
        title: n.title, artist: n.artist, kind: n.kind,
        request_id: id, url: ev.url || n.video_url || null,
        pct: ev.pct, votes: ev.votes ?? n.votes, reason: ev.reason || null,
        rank: ev.rank ?? n.rank?.rank, gap: ev.gap,
      }
      const prio = PRIORITY.indexOf(ev.type)
      const cur = best.get(n.key)
      if (!cur || prio < cur.prio) best.set(n.key, { prio, item })
    }
  }
  return [...best.values()]
    .sort((a, b) => (a.prio - b.prio) || b.item.at - a.item.at)
    .map(x => x.item)
}

/* Một dòng toast cho cả đợt: 4 bài cùng nhúc nhích mà 4 toast thì không ai
   đọc kịp, mà im hết thì lại thành tin không tới nơi. */
export const toastOf = (found) => (found.length > 1
  ? { type: 'many', n: found.length, first: found[0] }
  : { type: found[0].type, n: 1, first: found[0] })

/* ---------- hộp thư ---------- */
export function loadInbox(uid) {
  const list = rd(K_BOX(uid), [])
  return Array.isArray(list) ? list : []
}
export function saveInbox(uid, list) { wr(K_BOX(uid), list.slice(0, INBOX_LIMIT)) }

/* Dồn tin mới vào đầu, bỏ tin có id đã có, cắt theo INBOX_LIMIT. */
export function pushNotices(inbox, found) {
  if (!found?.length) return Array.isArray(inbox) ? inbox : []
  const seen = new Set((inbox || []).map(n => n.id))
  const fresh = []
  for (const n of found) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    fresh.unshift(n)
  }
  if (!fresh.length) return inbox || []
  return [...fresh, ...(inbox || [])].slice(0, INBOX_LIMIT)
}

export const unreadCount = (inbox) => (inbox || []).filter(n => !n.read).length
export function markRead(inbox, id) { return (inbox || []).map(n => (n.id === id ? { ...n, read: true } : n)) }
export function markAllRead(inbox) { return (inbox || []).map(n => (n.read ? n : { ...n, read: true })) }
export function dropNotice(inbox, id) { return (inbox || []).filter(n => n.id !== id) }
export const clearInbox = () => []

/* Hộp thông báo (pop-up, không có trang riêng) dựng hai khối từ cùng một hộp thư */
export const ownNotices = (inbox) => (inbox || []).filter(n => n.own)
export function loadOff(uid) { const v = rd(K_OFF(uid), []); return Array.isArray(v) ? v : [] }
export function saveOff(uid, keys) { wr(K_OFF(uid), Array.from(new Set(keys || [])).slice(0, WATCH_LIMIT)) }
export const otherNotices = (inbox) => (inbox || []).filter(n => !n.own)

/* ---------- gom tin theo TRẠNG THÁI để hiển trong bảng thông báo ----------
   Người đọc không quan tâm "loại tin" chi li bằng việc bài của mình đang ở
   đâu: Needs you (còn vote được, sắp tới lượt) → Up next (kết quả chốt) →
   Denied (kèm lý do) → In progress → Out. Nhóm rỗng thì không dựng nhãn. */
export const NOTICE_GROUPS = [
  { id: 'need', types: ['near', 'lead', 'approved', 'votes'] },
  { id: 'upnext', types: ['picked'] },
  { id: 'denied', types: ['denied'] },
  { id: 'work', types: ['started', 'progress'] },
  { id: 'out', types: ['done'] },
]

export function groupNotices(inbox) {
  const list = Array.isArray(inbox) ? inbox : []
  const taken = new Set()
  const out = []
  for (const g of NOTICE_GROUPS) {
    const items = list.filter(n => n && g.types.includes(n.type))
    items.forEach(n => taken.add(n.id))
    if (items.length) {
      out.push({
        id: g.id,
        /* chua doc len truoc, trong cung mot hang thi moi hon truoc */
        items: items.sort((a, b) => (a.read === b.read ? b.at - a.at : a.read ? 1 : -1)),
        unread: items.filter(n => !n.read).length,
      })
    }
  }
  /* tin lạ (thêm sau này) không được biến mất khỏi hộp thư */
  const rest = list.filter(n => n && !taken.has(n.id))
  if (rest.length) out.push({ id: 'other', items: rest, unread: rest.filter(n => !n.read).length })
  return out
}

/* ---------------- chọn bài trên bảng ----------------
   key cua cum chua ky tu xuong dong va co the co dau nhay kep, ma no duoc
   ghep vao selector `[data-song="..."]` de tim phan tu — phai rua truoc. */
export const songAttr = (k) => (k || '').replace(/\n/g, ' ').replace(/["\\]/g, '')
