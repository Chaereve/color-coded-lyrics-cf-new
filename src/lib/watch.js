/* =========================================================
   THÔNG BÁO REQUEST
   ---------------------------------------------------------
   Sau khi tầng "theo dõi bài" bị gỡ khỏi sản phẩm (chủ dự án chốt: một hàng
   request chỉ còn đúng một hành động là nghe bài), hộp thư còn ĐÚNG HAI nguồn:

     1. REQUEST CỦA CHÍNH MÌNH. Duyệt / từ chối / vào Up next / bắt đầu làm /
        xong / nhích tiến độ. Người đã gửi thì phải biết, không phải đi dò
        bảng — đây là lý do hộp thư tồn tại.
     2. TIN TỪ DATABASE (`fetchNotifications`), gộp vào bằng `mergeInbox`:
        thông báo do admin gửi và các tin phía máy chủ.

   Đã xoá cùng tầng theo dõi: danh sách bài đang theo dõi, bốn công tắc loại
   tin (`auto` · `near` · `progress` · `votes`), phép xếp hạng "còn N vote nữa
   là dẫn đầu" (pickLadder/pickEta) và mọi tin sinh từ bài của NGƯỜI KHÁC.

   Vì sao phép so sánh vẫn ở đây chứ không nằm thẳng trong App: nó là logic
   thuần, chạy được bằng `node --test` mà không cần React hay Supabase. Khi
   xuống database thì chỉ phải thay loadInbox/saveInbox.

   Thiết kế SQL: docs/THEO-DOI-THONG-BAO.md
   ========================================================= */
import { groupKey } from './board.js'

export const INBOX_LIMIT = 60

/* Ưu tiên khi CÙNG MỘT LƯỢT một bài có mấy thay đổi: chỉ giữ tin đáng đọc
   nhất. Tin "xong" đứng đầu vì nó là cái người gửi chờ lâu nhất. */
const PRIORITY = ['done', 'denied', 'picked', 'started', 'approved', 'progress']

/* ---------- lưu trữ (demo: localStorage) ---------- */
const K_BOX = (uid) => `ccl3_box:${uid || 'anon'}`

const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d } catch { return d } }
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* chế độ ẩn danh: bỏ qua */ } }

/* ---------- snapshot: thứ đem ra so sánh giữa hai lần bảng đổi ----------
   `own` là cờ DUY NHẤT quyết định một thay đổi có đáng báo không: hộp thư
   không còn theo dõi bài của người khác nữa. */
export function snapOf(rows, uid = null) {
  const m = new Map()
  for (const r of rows || []) {
    if (!r?.id) continue
    m.set(String(r.id), {
      key: groupKey(r),
      title: r.title || '', artist: r.artist || '', kind: r.kind || '',
      status: r.status || '', progress: Number(r.progress) || 0, votes: Number(r.votes) || 0,
      video_url: r.video_url || null, picked: !!r.picked_at,
      reason: r.deny_reason || null,
      own: !!uid && r.user_id === uid,
    })
  }
  return m
}

/* Một lần đổi của MỘT dòng → danh sách sự kiện (rỗng = không đáng báo).
   Tách riêng để test trực tiếp từng cặp trước/sau. */
export function rowEvents(p, n) {
  const out = []
  if (!p || !n) return out
  const s0 = p.status, s1 = n.status

  if (s1 !== s0) {
    if (s1 === 'denied') out.push({ type: 'denied', reason: n.reason || null, url: n.video_url || null })
    else if (s1 === 'completed') out.push({ type: 'done', url: n.video_url || null })
    else if (s1 === 'in_progress') out.push({ type: 'started' })
    /* pending → queued: vừa được duyệt, mở cho vote */
    else if (s0 === 'pending') out.push({ type: 'approved', votes: n.votes })
  }
  /* Vào Up next: vote đóng ngay tại đó — người gửi phải biết bài mình đã
     được chốt, kể cả khi chưa ai bấm gì thêm. */
  if (!p.picked && n.picked && s1 !== 'completed') out.push({ type: 'picked' })

  /* Tiến độ của bài CỦA MÌNH thì luôn báo: đó là thứ người gửi muốn biết
     nhất, để sau một công tắc "bật mới được xem" là không ai tìm thấy nó. */
  if (s1 === 'in_progress' && n.progress > p.progress) {
    out.push({ type: 'progress', pct: n.progress })
  }
  return out
}

/* So hai snapshot, chỉ xét BÀI CỦA CHÍNH MÌNH, ép về một tin / bài. */
export function diffNotices({ prev, next, at = Date.now() }) {
  if (!prev?.size || !next?.size) return []
  const best = new Map()
  for (const [id, n] of next) {
    if (!n.own) continue
    const p = prev.get(id)
    if (!p) continue                                  // dòng mới xuất hiện: chưa có gì để so
    for (const ev of rowEvents(p, n)) {
      const sig = ev.type === 'done' ? `done:${n.video_url || ''}`
        : ev.type === 'progress' ? `progress:${ev.pct}`
        : `${ev.type}:${n.status}:${n.picked ? 1 : 0}`
      const item = {
        id: `${n.key}|${sig}`,
        key: n.key, type: ev.type, at, own: true,
        title: n.title, artist: n.artist, kind: n.kind,
        request_id: id, url: ev.url || n.video_url || null,
        pct: ev.pct, votes: ev.votes ?? n.votes, reason: ev.reason || null,
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

/* ---------- tin đã xóa ----------
   Xóa trên chuông mà chỉ lọc mảng trong bộ nhớ thì lần vào sau tin sống lại:
   `fetchNotifications` kéo lại mọi dòng trong bảng `notifications` rồi gộp
   vào hộp thư những id chưa có. Id của tin database (`db-12`) không nằm trong
   hộp thư vừa xóa, nên nó bị coi là tin mới.

   Danh sách này là bản nhớ trên máy, kiểm trước khi gộp. Bản bền (đổi máy,
   xóa localStorage) là cột `dismissed_at`, ghi bằng RPC — xem db.js. */
export const DISMISS_LIMIT = 400
const K_DROP = (uid) => `ccl3_ndrop:${uid || 'anon'}`

export function loadDismissed(uid) {
  const v = rd(K_DROP(uid), [])
  return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [])
}

export function rememberDismissed(uid, ids) {
  const prev = rd(K_DROP(uid), [])
  const list = Array.isArray(prev) ? prev.filter(x => typeof x === 'string' && x) : []
  for (const id of [].concat(ids)) {
    if (typeof id !== 'string' || !id) continue
    const at = list.indexOf(id)
    if (at >= 0) list.splice(at, 1)
    list.push(id)
  }
  const kept = list.slice(-DISMISS_LIMIT)
  wr(K_DROP(uid), kept)
  return new Set(kept)
}

/* `db-12` là id hộp thư của một dòng database. Id local (`bài|loại:…`) không
   phải số, đừng gửi nó vào tham số p_id. */
export function noticeDbId(id) {
  const m = /^db-(\d+)$/.exec(String(id || ''))
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}

export function isDismissed(dismissed, notice) {
  if (!notice) return false
  const set = dismissed instanceof Set ? dismissed : new Set(dismissed || [])
  if (notice.id && set.has(notice.id)) return true
  if (notice.sig && set.has(notice.sig)) return true
  /* Tin local dùng chính id làm chữ ký (`bài|done:url`). Tin database mang
     chữ ký đó ở `sig` — xóa một bên phải chặn được bên kia. */
  if (notice.id && set.has(notice.sig)) return true
  return false
}

export function withoutDismissed(list, dismissed) {
  return (list || []).filter(n => n && !isDismissed(dismissed, n))
}

/* Gộp hộp thư local với hộp thư database. Tin đã xóa không được quay lại,
   tin trùng chữ ký không được hiện hai lần. */
export function mergeInbox(local, remote, dismissed) {
  const base = withoutDismissed(local, dismissed)
  const seen = new Set()
  for (const n of base) {
    if (n.id) seen.add(n.id)
    if (n.sig) seen.add(n.sig)
  }
  const fresh = []
  for (const n of remote || []) {
    if (!n || isDismissed(dismissed, n)) continue
    /* Chữ ký database trùng id của tin local đã có — đừng hiện hai dòng cho
       cùng một sự kiện. `seen` đã chứa id local, nên so sig với seen là đủ. */
    if ((n.id && seen.has(n.id)) || (n.sig && seen.has(n.sig))) continue
    if (n.id) seen.add(n.id)
    if (n.sig) seen.add(n.sig)
    fresh.push(n)
  }
  return [...fresh, ...base].slice(0, INBOX_LIMIT)
}

/* Hộp thông báo (pop-up, không có trang riêng) dựng hai khối từ cùng một hộp thư */
export const ownNotices = (inbox) => (inbox || []).filter(n => n.own)
export const otherNotices = (inbox) => (inbox || []).filter(n => !n.own)

/* ---------- gom tin theo TRẠNG THÁI để hiển trong bảng thông báo ----------
   Người đọc không quan tâm "loại tin" chi li bằng việc bài của mình đang ở
   đâu: Needs you (vừa được duyệt, còn vote được) → Up next (kết quả chốt) →
   Denied (kèm lý do) → In progress → Out. Nhóm rỗng thì không dựng nhãn. */
export const NOTICE_GROUPS = [
  { id: 'need', types: ['approved'] },
  { id: 'upnext', types: ['picked'] },
  { id: 'denied', types: ['denied'] },
  { id: 'work', types: ['started', 'progress'] },
  { id: 'out', types: ['done', 'expired'] },
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
