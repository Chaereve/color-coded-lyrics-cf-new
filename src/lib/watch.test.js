/* Kiểm thử logic "Theo dõi + thông báo" — `npm test`, không cần database.

   Bốn điều phải chắc chắn ĐÚNG vì nó quyết định tính năng này hữu ích hay
   là spam:
     · lượt nạp đầu im lặng;
     · một bài bị xé thành nhiều request lẻ chỉ sinh MỘT tin;
     · tin "sát nút" bắn ĐÚNG MỘT lần mỗi chu kỳ (không bắn theo từng phiếu);
     · không bao giờ tự ý bỏ bớt danh sách theo dõi khi chạm trần. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clearInbox, diffNotices, dropNotice, etaKey, markAllRead, markRead,
  ownNotices, otherNotices, pickEta, pickLadder, pushNotices, rowEvents, snapOf,
  groupNotices, syncOwnRequests, toastOf, toggleWatched, unreadCount, watchedKeys,
  DEFAULT_PREFS, ETA_DEFAULT_INTERVAL, ETA_MAX_RANK, INBOX_LIMIT, NEAR_GAP, WATCH_LIMIT,
} from './watch.js'

const AT = Date.UTC(2026, 8, 8, 12)
const DAY = 86_400_000
let seq = 0
const req = (artist, title, extra = {}) => ({
  id: `w${seq++}`, user_id: 'u1', kind: 'Color Coded Lyrics', artist, title,
  requester: 'fan', status: 'queued', progress: 0, votes: 4, is_paid: false,
  picked_at: null, video_url: null, created_at: new Date(AT - (++seq % 7) * DAY).toISOString(),
  ...extra,
})
const keyOf = (r) => `${r.artist.trim().toLowerCase()}\n${r.title.trim().toLowerCase()}`

/* Hai mặt trước/sau của CÙNG MỘT dòng — id phải giống nhau vì ngoài đời id
   request là bất biến. Gọi req() hai lần sẽ ra hai id khác nhau và diff
   không thấy gì; bẫy này đã mắc một lần, ghi lại kẻo ai tái phạm. */
const flip = (base, before = {}, after = {}, extra = {}) => [
  snapOf([{ ...base, ...before }], extra.uid, extra.rank ? pickLadder([{ ...base, ...before }]).rank : null),
  snapOf([{ ...base, ...after }], extra.uid, extra.rank ? pickLadder([{ ...base, ...after }]).rank : null),
]
/* snapshot kèm luôn hạng của chính nó: muốn biết "hồi nãy cách mấy vote" thì
   phải xếp hàng trên đúng dữ liệu của lúc đó, không phải lấy hàng của hiện tại */
const snap = (rows, uid = 'me') => snapOf(rows, uid, pickLadder(rows).rank)

const diff = (a, b, watched, prefs, cycle) =>
  diffNotices({ prev: a, next: b, watched: watched instanceof Set ? watched : new Set([watched]), prefs, cycle, at: AT })

test('lượt đầu chưa có snapshot cũ thì không nổ thông báo', () => {
  const rows = [req('aespa', 'Whiplash')]
  const found = diffNotices({ prev: new Map(), next: snapOf(rows), watched: new Set([keyOf(rows[0])]), at: AT })
  assert.equal(found.length, 0)
})

test('chỉ báo cho bài đang được theo dõi', () => {
  const [a, b] = flip(req('aespa', 'Whiplash'), { status: 'pending' }, { status: 'queued' })
  const k = keyOf(b.values().next().value)
  assert.equal(diff(a, b, new Set(), DEFAULT_PREFS).length, 0)
  assert.equal(diff(a, b, k, DEFAULT_PREFS).length, 1)
})

test('pending → queued là "approved"; sang completed là "done" kèm link', () => {
  const [a, b] = flip(req('aespa', 'Whiplash'), { status: 'pending' },
    { status: 'completed', progress: 100, video_url: 'https://youtu.be/abc' })
  const one = diff(a, b, keyOf(b.values().next().value), DEFAULT_PREFS)
  assert.equal(one.length, 1)
  assert.equal(one[0].type, 'done')                    // completed thắng mọi loại khác
  assert.equal(one[0].url, 'https://youtu.be/abc')
})

test('nhiều dòng cùng bài chỉ sinh MỘT tin', () => {
  const rows = [req('IVE', 'HEYA', { status: 'pending', votes: 2 }), req('ive', ' heya', { status: 'pending', votes: 5 })]
  const a = snapOf(rows)
  const b = snapOf(rows.map(r => ({ ...r, status: 'queued' })))
  const found = diffNotices({ prev: a, next: b, watched: new Set([keyOf(rows[0])]), at: AT })
  assert.equal(found.length, 1)
  assert.equal(found[0].type, 'approved')
})

test('tiến độ và mốc vote mặc định TẮT, bật prefs là có', () => {
  const [a, b] = flip(req('NewJeans', 'Ditto', { votes: 6 }),
    { status: 'in_progress', progress: 20 }, { status: 'in_progress', progress: 60, votes: 11 })
  const k = keyOf(b.values().next().value)
  assert.equal(diff(a, b, k, DEFAULT_PREFS).length, 0)

  const on = diff(a, b, k, { progress: true, votes: true })
  assert.equal(on.length, 1)                    // hai tin dồn về một, ưu tiên progress
  assert.equal(on[0].type, 'progress')
  assert.equal(on[0].pct, 60)
})

test('vào Up next là tin riêng, kể cả khi status không đổi', () => {
  const [a, b] = flip(req('TWICE', 'Talk that Talk'), {}, { picked_at: new Date(AT).toISOString() })
  const found = diff(a, b, keyOf(b.values().next().value), DEFAULT_PREFS)
  assert.equal(found.length, 1)
  assert.equal(found[0].type, 'picked')
})

test('rowEvents: không đổi gì thì trả về rỗng', () => {
  const r = req('LE SSERAFIM', 'Eve of a War')
  const s = snapOf([r]).get(r.id)
  assert.deepEqual(rowEvents(s, s), [])
})

/* ---------------- thang chốt (pickLadder) ---------------- */
test('xếp hạng theo đúng luật của database, không theo luật của bảng', () => {
  const paid = req('AAA', 'Paid Song', { is_paid: true, votes: 1 })
  const leader = req('BBB', 'Many Votes', { votes: 40, created_at: new Date(AT - 2 * DAY).toISOString() })
  const mine = req('CCC', 'My Song', { votes: 39, created_at: new Date(AT - DAY).toISOString() })
  const { rank } = pickLadder([leader, paid, mine])
  assert.equal(rank.get(keyOf(paid)).rank, 1, 'bài paid luôn đứng trước dù ít vote')
  assert.equal(rank.get(keyOf(leader)).rank, 2)
  assert.equal(rank.get(keyOf(mine)).rank, 3)
  /* bài của mình đứng sau MỘT bài paid → vote không bao giờ vượt được */
  assert.equal(rank.get(keyOf(mine)).blocked, true)
  assert.equal(rank.get(keyOf(leader)).blocked, true, 'còn bài paid trong hàng là bài thượng bị chặn')
  const paid2 = req('DDD', 'Other Paid', { is_paid: true, votes: 5 })
  assert.equal(pickLadder([paid, mine, paid2]).rank.get(keyOf(mine)).blocked, true)
  assert.equal(pickLadder([paid, paid2]).rank.get(keyOf(paid2)).blocked, false, 'paid đua với paid')
})

test('vote của cả cụm được cộng dồn khi xếp hạng; hoà vote thì bài cũ hơn thắng', () => {
  const old1 = req('IVE', 'HEYA', { votes: 3, created_at: new Date(AT - 5 * DAY).toISOString() })
  const old2 = req('ive', ' heya', { votes: 4, created_at: new Date(AT - 4 * DAY).toISOString() })
  const single = req('aespa', 'Drama', { votes: 6, created_at: new Date(AT - 6 * DAY).toISOString() })
  const { ladder, rank } = pickLadder([single, old1, old2])
  assert.equal(ladder[0].key, keyOf(old1), 'cụm 7 vote vượt bài lẻ 6 vote')
  assert.equal(rank.get(keyOf(old1)).total, 7)
  assert.equal(rank.get(keyOf(single)).gap, 2, 'cần 2 phiếu để bắt kịp (7+1-6)')
})

test('hàng đã chốt / đang làm / pending không được tính là ứng viên', () => {
  const rows = [
    req('A', 'Picked', { picked_at: new Date().toISOString(), votes: 99 }),
    req('B', 'Pending', { status: 'pending', votes: 90 }),
    req('C', 'Open', { votes: 2 }),
  ]
  const { ladder } = pickLadder(rows)
  assert.deepEqual(ladder.map(g => `${g.artist}/${g.title}`), ['C/Open'])
})

/* ---------------- tin "sát nút" / "đang dẫn đầu" ---------------- */
const nearSetup = (mineVotes, otherVotes, extraMine = {}) => {
  const mine = req('Zed', 'My Song', { votes: mineVotes, user_id: 'me', ...extraMine })
  const rival = req('Rival', 'Top Song', { votes: otherVotes })
  return { mine, rows: [mine, rival] }
}

test('vừa nhảy vào vùng 3 vote thì báo "near" MỘT lần, vote tiếp vẫn im lặng', () => {
  const { mine, rows } = nearSetup(8, 10)
  const prevRows = rows.map(r => (r === mine ? { ...r, votes: 6 } : r))
  const prev = snap(prevRows)
  const next = snap(rows)
  const found = diffNotices({ prev, next, watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c1', at: AT })
  assert.equal(found.length, 1)
  assert.equal(found[0].type, 'near')
  assert.equal(found[0].gap, NEAR_GAP)
  assert.equal(found[0].rank, 2)
  assert.equal(found[0].own, true, 'tin phải nhớ là bài của mình để bảng thông báo xếp lên đầu')

  // một phiếu nữa: vẫn còn trong vùng near nhưng đã báo rồi -> im lặng
  const next2 = snap(rows.map(r => (r === mine ? { ...r, votes: 9 } : r)))
  const again = diffNotices({ prev: next, next: next2, watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c1', at: AT })
  assert.equal(again.length, 0, 'mỗi chu kỳ chỉ nhắc đúng một lần')
})

test('lên vị trí số 1 là tin "lead", tách riêng', () => {
  const { mine, rows } = nearSetup(12, 10)
  const prev = snap(rows.map(r => (r === mine ? { ...r, votes: 9 } : r)))
  const next = snap(rows)
  const found = diffNotices({ prev, next, watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c1', at: AT })
  assert.equal(found[0].type, 'lead')
})

test('đứng sau một bài paid thì không hứa “thiếu N vote”', () => {
  const mine = req('Zed', 'My Song', { votes: 9, user_id: 'me' })
  const paid = req('Rival', 'Paid Song', { votes: 10, is_paid: true })
  const found = diffNotices({
    prev: snap([{ ...mine, votes: 8 }, paid]),
    next: snap([mine, paid]),
    watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c1', at: AT,
  })
  assert.equal(found.length, 0, 'blocked thì im lặng, đừng dỗ người ta vote vô ích')
})

test('chu kỳ chốt mới cho phép nhắc lại cùng một bài', () => {
  const { mine, rows } = nearSetup(8, 10)
  const prev = snap(rows.map(r => (r === mine ? { ...r, votes: 6 } : r)))
  const next = snap(rows)
  const a = diffNotices({ prev, next, watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c1', at: AT })
  const b = diffNotices({ prev, next, watched: new Set([keyOf(mine)]), prefs: DEFAULT_PREFS, cycle: 'c2', at: AT })
  assert.notEqual(a[0].id, b[0].id)
})

test('tắt prefs.near là không còn tin nhắc', () => {
  const { mine, rows } = nearSetup(8, 10)
  const prev = snap(rows.map(r => (r === mine ? { ...r, votes: 6 } : r)))
  const next = snap(rows)
  const found = diffNotices({ prev, next, watched: new Set([keyOf(mine)]), prefs: { near: false }, cycle: 'c1', at: AT })
  assert.equal(found.length, 0)
})

/* ---------------- tự theo dõi bài của mình ---------------- */
test('gửi request là được theo dõi luôn, gọi lại cũng không thêm trùng', () => {
  const rows = [req('aespa', 'Whiplash', { user_id: 'me' }), req('IVE', 'HEYA', { user_id: 'someone' })]
  const res = syncOwnRequests(rows, 'me', [], DEFAULT_PREFS, AT)
  assert.equal(res.list.length, 1)
  assert.equal(res.list[0].own, true)
  assert.equal(res.added, 1)
  assert.equal(syncOwnRequests(rows, 'me', res.list, DEFAULT_PREFS, AT), null, 'idempotent')
  assert.equal(syncOwnRequests(rows, 'me', [], { auto: false }, AT), null, 'tắt auto là tôn trọng')
  assert.equal(syncOwnRequests(rows, null, [], DEFAULT_PREFS, AT), null, 'chưa đăng nhập thì đừng làm gì')
})

test('tắt theo dõi bài của mình rồi thì không bị bật lại', () => {
  const rows = [req('aespa', 'Drama', { user_id: 'me' })]
  const first = syncOwnRequests(rows, 'me', [], DEFAULT_PREFS, AT)
  const off = toggleWatched(first.list, rows[0], AT)
  assert.equal(off.added, false)
  assert.equal(off.list.length, 0)
  /* lần đồng bộ kế tiếp sẽ thêm lại — đây là hành vi ĐÃ BIẾT: người dùng
     tắt một bài đang pending thì khi nó được duyệt vẫn còn nằm trong danh
     sách. Kiểm tra để sau này đổi có mà sửa test chứ không sửa nhầm code. */
  assert.equal(syncOwnRequests(rows, 'me', off.list, DEFAULT_PREFS, AT).list.length, 1)
})

/* ---------------- trần, hộp thư, toast ---------------- */
test('chạm trần 60 bài thì từ chối thêm, KHÔNG loại bài cũ âm thầm', () => {
  let list = []
  const rows = Array.from({ length: WATCH_LIMIT + 2 }, (_, i) => req(`art${i}`, `song${i}`))
  for (const r of rows.slice(0, WATCH_LIMIT)) list = toggleWatched(list, r, AT).list
  assert.equal(list.length, WATCH_LIMIT)
  const over = toggleWatched(list, rows[WATCH_LIMIT], AT)
  assert.deepEqual(over.list, list, 'danh sách phải nguyên vẹn')
  assert.equal(over.added, false)
  assert.equal(over.full, true)
})

test('theo dõi gắn với BÀI chứ không với dòng: hoa thường / khoảng trắng vẫn khớp', () => {
  const added = toggleWatched([], req('LE SSERAFIM ', 'Blue Flame'))
  const off = toggleWatched(added.list, req('le sserafim', ' blue flame '))
  assert.equal(off.added, false)
  assert.equal(off.list.length, 0)
})

test('chạy lại diff trên cùng dữ liệu không sinh tin trùng', () => {
  const [a, b] = flip(req('Stray Kids', 'FARMING'), { progress: 10 }, { status: 'in_progress', progress: 40 })
  const k = keyOf(b.values().next().value)
  const found = diff(a, b, k, DEFAULT_PREFS)
  assert.equal(found.length, 1)
  assert.ok(found[0].id.startsWith(k), 'id là hàm của (bài, loại, trạng thái) nên ổn định')
  let box = pushNotices([], found)
  box = pushNotices(box, found)
  box = pushNotices(box, found)
  assert.equal(box.length, 1)
})

test('hộp thư: mới nhất trước, unread đếm đúng, đọc/xoá/rỗng không vỡ', () => {
  let box = pushNotices([], [
    { id: 'x1|done', key: 'x1', type: 'done', at: AT, own: true },
    { id: 'x2|picked', key: 'x2', type: 'picked', at: AT + 1, own: false },
  ])
  assert.deepEqual(box.map(n => n.id), ['x2|picked', 'x1|done'])
  assert.equal(unreadCount(box), 2)
  box = markRead(box, 'x2|picked')
  assert.equal(unreadCount(box), 1)
  box = markAllRead(box)
  assert.equal(unreadCount(box), 0)
  box = pushNotices(box, [{ id: 'x3|approved', key: 'x3', type: 'approved', at: AT + 9, own: true }])
  box = dropNotice(box, 'x1|done')
  assert.deepEqual(box.map(n => n.id), ['x3|approved', 'x2|picked'])
  assert.deepEqual(clearInbox(), [])
  assert.deepEqual(ownNotices(box).map(n => n.id), ['x3|approved'])
  assert.deepEqual(otherNotices(box).map(n => n.id), ['x2|picked'])
})

test('hộp thư cắt theo INBOX_LIMIT, không phình vô hạn', () => {
  let box = []
  for (let i = 0; i < INBOX_LIMIT + 30; i++) box = pushNotices(box, [{ id: `k|t${i}`, key: 'k', type: 'progress', at: AT + i }])
  assert.equal(box.length, INBOX_LIMIT)
  assert.equal(box[0].id, `k|t${INBOX_LIMIT + 29}`)
})

test('nhiều bài cùng đổi thì gom về MỘT toast', () => {
  const toast = toastOf([{ type: 'done', title: 'A' }, { type: 'near' }, { type: 'picked' }])
  assert.equal(toast.type, 'many')
  assert.equal(toast.n, 3)
  assert.equal(toast.first.type, 'done', 'tin đầu vẫn là tin để bấm vào')
  assert.equal(toastOf([{ type: 'near' }]).type, 'near')
})

test('watchedKeys là Set khoá, đủ để lọc bảng', () => {
  const list = [{ key: 'a\nb' }, { key: 'c\nd' }]
  const set = watchedKeys(list)
  assert.equal(set.size, 2)
  assert.equal(set.has('a\nb'), true)
})

/* ---------------- pham vi bao: theo doi + da vote ---------------- */

test('bài mình đã vote nhưng không theo dõi vẫn nhận được kết quả chốt', () => {
  const base = req('aespa', 'Whiplash', { picked_at: null })
  const a = snapOf([{ ...base, status: 'queued', picked_at: null }], 'u1')
  const b = snapOf([{ ...base, status: 'in_progress', picked_at: new Date(AT).toISOString() }], 'u1')
  const k = keyOf(base)

  /* chỉ người theo dõi: chưa bật chuông thì im */
  assert.equal(diffNotices({ prev: a, next: b, watched: new Set(), prefs: DEFAULT_PREFS, at: AT }).length, 0)
  /* người đã bỏ phiếu cho bài đó: quyền biết kết quả là của họ */
  const found = diffNotices({ prev: a, next: b, watched: new Set(), voted: new Set([k]), prefs: DEFAULT_PREFS, at: AT })
  assert.equal(found.length, 1)
  assert.equal(found[0].type, 'picked')
})

test('tiến độ bài CỦA MÌNH luôn được báo, không cần bật tuỳ chọn', () => {
  const base = req('aespa', 'Whiplash', { status: 'in_progress', progress: 10 })
  const a = snapOf([base], 'u1')
  const b = snapOf([{ ...base, progress: 45 }], 'u1')
  const mine = diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].type, 'progress')
  assert.equal(mine[0].pct, 45)
  assert.equal(mine[0].own, true)

  /* bài của người khác thì vẫn phải bật `progress` mới báo — mặc định tắt */
  const other = diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT })
  assert.equal(other.length, 1)
  const quiet = diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT })
  assert.equal(quiet.length, 1)
})

test('bài người khác: tắt progress là im lặng thật sự', () => {
  const base = req('aespa', 'Whiplash', { status: 'in_progress', progress: 10, user_id: 'u9' })
  const a = snapOf([base], 'u1')
  const b = snapOf([{ ...base, progress: 45 }], 'u1')
  assert.equal(diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT }).length, 0)
  assert.equal(diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: { ...DEFAULT_PREFS, progress: true }, at: AT }).length, 1)
})

test('Denied mang theo lý do để hiện thẳng trong dòng tin', () => {
  const base = req('aespa', 'Whiplash', { status: 'pending' })
  const a = snapOf([base], 'u1')
  const b = snapOf([{ ...base, status: 'denied', deny_reason: 'Link không xem được' }], 'u1')
  const found = diffNotices({ prev: a, next: b, watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT })
  assert.equal(found.length, 1)
  assert.equal(found[0].type, 'denied')
  assert.equal(found[0].reason, 'Link không xem được')
  /* không có lý do thì không bịa ra dòng rỗng */
  const bare = diffNotices({
    prev: a, next: snapOf([{ ...base, status: 'denied' }], 'u1'),
    watched: new Set([keyOf(base)]), prefs: DEFAULT_PREFS, at: AT,
  })
  assert.equal(bare[0].reason, null)
})

test('groupNotices: một bài chỉ xuất hiện ở MỘT nhóm, mọi tin đều có chỗ', () => {
  const g = groupNotices([
    { id: 'a', key: 'k', type: 'near', read: false, at: 1, own: true },
    { id: 'b', key: 'k', type: 'progress', read: false, at: 2, own: false },
    { id: 'c', key: 'k', type: 'picked', read: true, at: 3, own: true },
  ])
  assert.deepEqual(g.map(x => x.id), ['need', 'upnext', 'work'])
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), 3)
})

/* ------------------------------------------------------------------
   "Bao giờ tới lượt" — câu trả lời phải là SÀN, không phải lời hứa
   ------------------------------------------------------------------ */
const NOW = Date.UTC(2026, 8, 1, 0)
const pickIn = (days, interval = 4) => ({
  interval_days: interval, next_pick_at: new Date(NOW + days * DAY).toISOString(),
})

test('pickEta: đợt chốt kế tiếp cộng số chu kỳ còn phải qua', () => {
  const eta = pickEta({ rank: 3 }, pickIn(2), NOW)
  assert.equal(eta.days, 2 + 2 * 4)
  assert.equal(eta.interval, 4)
  assert.equal(eta.rank, 3)
})

test('pickEta: còn vài tiếng nữa chốt vẫn tính là MỘT ngày, không phải 0', () => {
  const eta = pickEta({ rank: 2 }, { interval_days: 4, next_pick_at: new Date(NOW + 6 * 3600_000).toISOString() }, NOW)
  assert.equal(eta.days, 1 + 4)
})

test('pickEta: thiếu lịch chốt thì lấy chu kỳ làm mốc, không bịa ra số 0', () => {
  assert.equal(pickEta({ rank: 2 }, null, NOW).days, ETA_DEFAULT_INTERVAL * 2)
  assert.equal(pickEta({ rank: 2 }, { interval_days: 0 }, NOW).days, ETA_DEFAULT_INTERVAL * 2)
  /* mốc đã trôi qua (cron chưa chạy) thì tính như sắp tới — không ra số âm */
  assert.equal(pickEta({ rank: 2 }, pickIn(-5), NOW).days, 4 + 4)
})

test('pickEta: im lặng ở đúng những chỗ không hứa được gì', () => {
  assert.equal(pickEta({ rank: 1 }, pickIn(1), NOW), null, 'bài dẫn đầu đã có đồng hồ đếm ngược')
  assert.equal(pickEta({ rank: 3, blocked: true }, pickIn(1), NOW), null, 'bị request trả tiền chặn thì đừng hứa')
  assert.equal(pickEta({ rank: ETA_MAX_RANK + 1 }, pickIn(1), NOW), null, 'hạng quá xa thì con số chỉ là trò chơi chữ')
  assert.equal(pickEta(null, pickIn(1), NOW), null)
  assert.ok(pickEta({ rank: ETA_MAX_RANK }, pickIn(1), NOW), 'sát trần vẫn phải có')
})

test('etaKey: ngày → tuần → tháng, không bao giờ ra "0" hay "1 tháng"', () => {
  assert.deepEqual(etaKey(1), { key: 'standing.etaDays', n: 1 })
  assert.deepEqual(etaKey(11), { key: 'standing.etaDays', n: 11 })
  assert.deepEqual(etaKey(12), { key: 'standing.etaWeeks', n: 2 })
  assert.deepEqual(etaKey(27), { key: 'standing.etaWeeks', n: 4 })
  assert.deepEqual(etaKey(55), { key: 'standing.etaWeeks', n: 8 })
  assert.deepEqual(etaKey(56), { key: 'standing.etaMonths', n: 2 })
  assert.deepEqual(etaKey(400), { key: 'standing.etaMonths', n: 13 })
  assert.deepEqual(etaKey(0), { key: 'standing.etaDays', n: 1 }, '"0 ngày" là câu sai rõ nhất')
})

test('pickLadder: mỗi hạng tự mang theo sàn thời gian của nó', () => {
  /* Gắn vào chính mục xếp hạng, không bắt từng chỗ gọi tự tính — nhờ vậy bảng,
     hộp thông báo và trang Của tôi cùng một con số mà không phải luồn prop. */
  const rows = [req('a', 'A', { votes: 9 }), req('b', 'B', { votes: 5 }), req('c', 'C', { votes: 1 })]
  const { rank } = pickLadder(rows, pickIn(2), NOW)
  assert.equal(rank.get(keyOf(rows[0])).eta, null, 'hạng 1 không cần sàn')
  assert.equal(rank.get(keyOf(rows[1])).eta.days, 2 + 4)
  assert.equal(rank.get(keyOf(rows[2])).eta.days, 2 + 8)
  /* không truyền `pick` (bản cũ, hoặc settings chưa nạp) thì vẫn chạy như trước */
  assert.equal(pickLadder(rows).rank.get(keyOf(rows[1])).eta.days, ETA_DEFAULT_INTERVAL * 2)
})

test('câu chữ của sàn thời gian có thật trong từ điển', () => {
  /* i18nKeys.test.js chỉ soi được `t('literal')`; etaKey trả khoá qua BIẾN nên
     thiếu một khoá là UI in ra nguyên "standing.etaWeeks" mà test kia im lặng. */
  const dict = readFileSync(new URL('./i18n.jsx', import.meta.url), 'utf8')
  for (const k of ['standing.etaDays', 'standing.etaWeeks', 'standing.etaMonths']) {
    assert.ok(dict.includes(`'${k}':`), `thiếu ${k}`)
  }
  assert.match(dict, /'standing\.etaWhy':\s*'[^']*\{d\}[^']*\{c\}/, 'etaWhy phải giải thích bằng đủ {d} và {c}')
})

test('mua vote: nút chỉ gắn với tin "sát nút", không rải khắp hộp thư', () => {
  const src = readFileSync(new URL('../components/Notifications.jsx', import.meta.url), 'utf8')
  assert.match(src, /n\.type === 'near' && onBuy/, 'CTA mua vote phải nằm trong tin "near"')
  assert.match(src, /onBuy = null/, 'prop onBuy phải có mặc định: chỗ nào không truyền thì nút không hiện')
})
