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

/* So hai snapshot, chỉ xét BÀI CỦA CHÍNH MÌNH, ép về một tin / bài.
   `sig` được đặt khớp 1-1 với chữ ký SQL (`admin_review` và `requests_notify`)
   để khi `fetchNotifications` đọc về sau 400ms, `mergeInbox` không bao giờ
   nhân đôi thành hai dòng thông báo cho cùng một sự kiện. */
export function diffNotices({ prev, next, at = Date.now() }) {
  if (!prev?.size || !next?.size) return []
  const best = new Map()
  for (const [id, n] of next) {
    if (!n.own) continue
    const p = prev.get(id)
    if (!p) continue                                  // dòng mới xuất hiện: chưa có gì để so
    for (const ev of rowEvents(p, n)) {
      const tail = ev.type === 'done' ? `done:${n.video_url || ''}`
        : ev.type === 'progress' ? `progress:${ev.pct}`
        : `${ev.type}:${n.status}`
      const localId = `${n.key}|${tail}`
      const dbSig = (ev.type === 'approved' || ev.type === 'denied')
        ? `review|${id}|${n.status}`
        : localId
      const item = {
        id: localId,
        sig: dbSig,
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

/* Dồn tin mới vào đầu, bỏ tin có id hoặc chữ ký đã có, cắt theo INBOX_LIMIT. */
export function pushNotices(inbox, found) {
  if (!found?.length) return Array.isArray(inbox) ? inbox : []
  const seen = new Set()
  for (const n of inbox || []) {
    for (const k of noticeAliases(n)) seen.add(k)
  }
  const fresh = []
  for (const n of found) {
    const aliases = noticeAliases(n)
    if (aliases.some(k => seen.has(k))) continue
    for (const k of aliases) seen.add(k)
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

/* Tin nhắc Admin duyệt bài quá hạn 1 tháng (chưa xoá) mang sig `expiry-admin|…`. */
export function isAdminExpiryNotice(notice) {
  return notice?.type === 'expired' && String(notice?.sig || '').startsWith('expiry-admin|')
}

/* Mọi khoá nhận diện của cùng một thông báo (id local, id có hậu tố `:0`/`:1`
   của phiên cũ, và chữ ký `sig` trên database) để chống nhân đôi và chống hồi
   sinh sau khi xoá. */
export function noticeAliases(notice) {
  if (!notice || typeof notice !== 'object') return []
  const out = new Set()
  const add = (v) => { if (typeof v === 'string' && v) out.add(v) }
  add(notice.id)
  add(notice.sig)
  if (notice.id && noticeDbId(notice.id) == null) {
    add(String(notice.id).replace(/:[01]$/, ''))
  }
  if (notice.type === 'approved' || notice.type === 'denied') {
    const st = notice.type === 'approved' ? 'queued' : 'denied'
    if (notice.request_id) add(`review|${notice.request_id}|${st}`)
    if (notice.key) {
      add(`${notice.key}|${notice.type}:${st}`)
      add(`${notice.key}|${notice.type}:${st}:0`)
      add(`${notice.key}|${notice.type}:${st}:1`)
    }
  } else if (notice.key && (notice.type === 'picked' || notice.type === 'started')) {
    const raw = (notice.sig && String(notice.sig).startsWith(`${notice.key}|${notice.type}:`))
      ? String(notice.sig)
      : (noticeDbId(notice.id) == null && String(notice.id || '').startsWith(`${notice.key}|${notice.type}:`)
        ? String(notice.id)
        : '')
    const base = raw ? raw.replace(/:[01]$/, '') : ''
    if (base) {
      add(base)
      add(`${base}:0`)
      add(`${base}:1`)
    }
  }
  return [...out]
}

export function isDismissed(dismissed, notice) {
  if (!notice) return false
  const set = dismissed instanceof Set ? dismissed : new Set(dismissed || [])
  return noticeAliases(notice).some(k => set.has(k))
}

export function withoutDismissed(list, dismissed) {
  return (list || []).filter(n => n && !isDismissed(dismissed, n))
}

/* Gộp hộp thư local với hộp thư database. Tin đã xóa không được quay lại,
   tin trùng chữ ký không được hiện hai lần, và trạng thái đã đọc / id DB được
   hợp nhất hai chiều. */
export function mergeInbox(local, remote, dismissed) {
  const base = withoutDismissed(local, dismissed).map(n => ({ ...n }))
  const indexByAlias = new Map()
  base.forEach((n, idx) => {
    for (const k of noticeAliases(n)) {
      if (!indexByAlias.has(k)) indexByAlias.set(k, idx)
    }
  })
  const fresh = []
  for (const n of remote || []) {
    if (!n || isDismissed(dismissed, n)) continue
    const aliases = noticeAliases(n)
    const hitIdx = aliases.map(k => indexByAlias.get(k)).find(idx => idx !== undefined)
    if (hitIdx !== undefined) {
      const cur = base[hitIdx]
      const merged = {
        ...cur,
        id: noticeDbId(cur.id) != null ? cur.id : (noticeDbId(n.id) != null ? n.id : cur.id),
        sig: cur.sig || n.sig || null,
        reason: cur.reason || n.reason || null,
        url: n.url || cur.url || null,
        read: Boolean(cur.read || n.read),
      }
      base[hitIdx] = merged
      for (const k of noticeAliases(merged)) {
        if (!indexByAlias.has(k)) indexByAlias.set(k, hitIdx)
      }
      continue
    }
    for (const k of aliases) indexByAlias.set(k, -1)
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
    const items = list.filter(n => n && g.types.includes(n.type) && !(g.id === 'out' && isAdminExpiryNotice(n)))
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
  /* tin lạ hoặc tin thưởng / nhắc duyệt quá hạn không bị biến mất khỏi hộp thư */
  const rest = list
    .filter(n => n && !taken.has(n.id))
    .sort((a, b) => (a.read === b.read ? b.at - a.at : a.read ? 1 : -1))
  if (rest.length) out.push({ id: 'other', items: rest, unread: rest.filter(n => !n.read).length })
  return out
}

/* ---------------- chọn bài trên bảng ----------------
   key cua cum chua ky tu xuong dong va co the co dau nhay kep, ma no duoc
   ghep vao selector `[data-song="..."]` de tim phan tu — phai rua truoc. */
export const songAttr = (k) => (k || '').replace(/\n/g, ' ').replace(/["\\]/g, '')
