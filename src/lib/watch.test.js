/* Kiểm thử logic THÔNG BÁO — `npm test`, không cần database.

   Sau khi tầng "theo dõi bài" bị gỡ, hộp thư chỉ còn tin về request CỦA
   CHÍNH MÌNH (cộng tin từ database gộp vào bằng mergeInbox). Bốn điều phải
   chắc chắn đúng, vì đây là thứ quyết định hộp thư hữu ích hay chỉ là spam:
     · lượt nạp đầu im lặng;
     · một bài bị xé thành nhiều request lẻ chỉ sinh MỘT tin;
     · thay đổi của bài NGƯỜI KHÁC thì im lặng tuyệt đối;
     · chạy lại trên cùng dữ liệu không sinh tin trùng. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clearInbox, diffNotices, dropNotice, isDismissed, markAllRead, markRead, mergeInbox, noticeDbId,
  ownNotices, otherNotices, pushNotices, rowEvents, snapOf,
  groupNotices, toastOf, unreadCount,
  INBOX_LIMIT,
} from './watch.js'

const AT = Date.UTC(2026, 8, 8, 12)
const DAY = 86_400_000
let seq = 0
const req = (artist, title, extra = {}) => ({
  id: `w${seq++}`, user_id: 'me', kind: 'Color Coded Lyrics', artist, title,
  requester: 'fan', status: 'queued', progress: 0, votes: 4, is_paid: false,
  picked_at: null, video_url: null, created_at: new Date(AT - (++seq % 7) * DAY).toISOString(),
  ...extra,
})

/* Hai mặt trước/sau của CÙNG MỘT dòng — id phải giống nhau vì ngoài đời id
   request là bất biến. Gọi req() hai lần sẽ ra hai id khác nhau và diff
   không thấy gì; bẫy này đã mắc một lần, ghi lại kẻo ai tái phạm. */
const between = (base, before = {}, after = {}, uid = 'me') => ({
  prev: snapOf([{ ...base, ...before }], uid),
  next: snapOf([{ ...base, ...after }], uid),
})
const snap = (rows, uid = 'me') => snapOf(rows, uid)

test('lượt đầu chưa có snapshot cũ thì không nổ thông báo', () => {
  const r = req('aespa', 'Whiplash')
  assert.deepEqual(diffNotices({ prev: null, next: snap([r]) }), [])
  assert.deepEqual(diffNotices({ prev: new Map(), next: snap([r]) }), [])
})

test('chỉ báo cho request CỦA CHÍNH MÌNH', () => {
  const mine = req('aespa', 'Whiplash')
  const theirs = req('ILLIT', 'Lalaluka', { user_id: 'u2' })
  const { prev, next } = between(mine, { status: 'queued' }, { status: 'completed', video_url: 'https://youtu.be/x' })
  const their = between(theirs, { status: 'queued' }, { status: 'completed' })
  assert.deepEqual(diffNotices({ prev, next }).map(n => n.type), ['done'])
  assert.deepEqual(diffNotices({ prev: their.prev, next: their.next }), [],
    'bài của người khác có đổi trạng thái cũng không được báo — không còn theo dõi để mà báo')
})

test('pending → queued là "approved"; sang completed là "done" kèm link', () => {
  const base = req('aespa', 'Whiplash', { status: 'pending' })
  const a = between(base, {}, { status: 'queued', votes: 1 })
  assert.deepEqual(diffNotices(a).map(n => [n.type, n.votes]), [['approved', 1]])

  const b = between(base, { status: 'in_progress', progress: 100 }, { status: 'completed', video_url: 'https://youtu.be/abc' })
  const [done] = diffNotices(b)
  assert.equal(done.type, 'done')
  assert.equal(done.url, 'https://youtu.be/abc')
})

test('nhiều dòng cùng bài chỉ sinh MỘT tin', () => {
  const one = req('aespa', 'Whiplash')
  const two = req('aespa', 'Whiplash', { user_id: 'u2' })
  const prev = snapOf([{ ...one, status: 'queued' }, { ...two, status: 'queued' }], 'me')
  const next = snapOf([
    { ...one, status: 'completed', video_url: 'https://youtu.be/a' },
    { ...two, status: 'completed', video_url: 'https://youtu.be/a' },
  ], 'me')
  const found = diffNotices({ prev, next })
  assert.equal(found.length, 1, 'ba người gửi cùng một bài vẫn là một tin')
})

test('tiến độ bài CỦA MÌNH luôn được báo', () => {
  const base = req('aespa', 'Whiplash', { status: 'in_progress' })
  const { prev, next } = between(base, { progress: 40 }, { progress: 47 })
  assert.deepEqual(diffNotices({ prev, next }).map(n => [n.type, n.pct]), [['progress', 47]])
})

test('vào Up next là tin riêng, kể cả khi status không đổi', () => {
  const base = req('aespa', 'Whiplash', { status: 'queued' })
  const { prev, next } = between(base, { picked_at: null }, { picked_at: new Date(AT).toISOString() })
  assert.deepEqual(diffNotices({ prev, next }).map(n => n.type), ['picked'])
})

test('rowEvents: không đổi gì thì trả về rỗng', () => {
  const base = req('aespa', 'Whiplash', { status: 'in_progress', progress: 40 })
  const s = snapOf([base], 'me')
  const only = [...s.values()][0]
  assert.deepEqual(rowEvents(only, { ...only }), [])
  assert.deepEqual(rowEvents(null, only), [])
})

test('chạy lại diff trên cùng dữ liệu không sinh tin trùng', () => {
  const base = req('aespa', 'Whiplash')
  const { prev, next } = between(base, { status: 'queued' }, { status: 'completed' })
  const first = diffNotices({ prev, next })
  const again = diffNotices({ prev: next, next })
  assert.equal(first.length, 1)
  assert.deepEqual(again, [], 'snapshot mới làm prev thì không còn gì để báo')
  /* Dồn hai lần cùng một danh sách cũng chỉ ra MỘT dòng (id là chữ ký). */
  assert.equal(pushNotices(pushNotices([], first), first).length, 1)
})

test('hộp thư: mới nhất trước, unread đếm đúng, đọc/xoá/rỗng không vỡ', () => {
  const a = { id: 'a', at: AT, read: false }
  const b = { id: 'b', at: AT + 1, read: false }
  const box = pushNotices([], [a, b])
  assert.deepEqual(box.map(n => n.id), ['b', 'a'])
  assert.equal(unreadCount(box), 2)
  assert.equal(markRead(box, 'a').find(n => n.id === 'a').read, true)
  assert.equal(unreadCount(markRead(box, 'a')), 1)
  assert.equal(unreadCount(markAllRead(box)), 0)
  assert.deepEqual(dropNotice(box, 'a').map(n => n.id), ['b'])
  assert.deepEqual(clearInbox(), [])
  assert.deepEqual(pushNotices(undefined, []), [])
})

test('xóa tin rồi gộp lại từ database không làm nó sống lại', () => {
  const local = [{ id: 'db-1', at: AT, read: false }]
  const dismissed = new Set(['db-1'])
  assert.deepEqual(mergeInbox(local, [], dismissed), [])
  const merged = mergeInbox(local, [{ id: 'db-1', sig: 'k|done:x', at: AT }], dismissed)
  assert.equal(merged.length, 0, 'tin đã xoá phải bị chặn ở cả hai phía')
  assert.equal(isDismissed(dismissed, { id: 'db-1' }), true)
  assert.equal(noticeDbId('db-12'), 12)
  assert.equal(noticeDbId('aespa\nwhiplash|done:x'), null)
})

test('tin database mới được gộp lên đầu, không nhân đôi theo chữ ký', () => {
  const local = [{ id: 'db-1', sig: 'k|done:a', at: AT, read: true }]
  const remote = [{ id: 'db-2', sig: 'k|done:a', at: AT }, { id: 'db-3', sig: 'k|denied', at: AT }]
  const out = mergeInbox(local, remote, new Set())
  assert.deepEqual(out.map(n => n.id), ['db-3', 'db-1'])
})

test('hộp thư cắt theo INBOX_LIMIT, không phình vô hạn', () => {
  const many = Array.from({ length: INBOX_LIMIT + 5 }, (_, i) => ({ id: `n${i}`, at: AT + i, read: false }))
  const box = pushNotices([], many)
  assert.equal(box.length, INBOX_LIMIT)
})

test('nhiều bài cùng đổi thì gom về MỘT toast', () => {
  const one = [{ type: 'done', title: 'a' }]
  const many = [{ type: 'done', title: 'a' }, { type: 'denied', title: 'b' }]
  assert.equal(toastOf(one).type, 'done')
  assert.equal(toastOf(many).type, 'many')
  assert.equal(toastOf(many).n, 2)
})

test('Denied mang theo lý do để hiện thẳng trong dòng tin', () => {
  const base = req('aespa', 'Whiplash')
  const { prev, next } = between(base, { status: 'queued' },
    { status: 'denied', deny_reason: 'Link không xem được' })
  const [n] = diffNotices({ prev, next })
  assert.equal(n.type, 'denied')
  assert.equal(n.reason, 'Link không xem được')
})

test('groupNotices: một bài chỉ xuất hiện ở MỘT nhóm, mọi tin đều có chỗ', () => {
  const box = [
    { id: 'a', type: 'done', at: AT, read: false },
    { id: 'b', type: 'picked', at: AT + 1, read: true },
    { id: 'c', type: 'lạ', at: AT + 2, read: false },
  ]
  const groups = groupNotices(box)
  const seen = groups.flatMap(g => g.items.map(n => n.id))
  assert.deepEqual(seen.sort(), ['a', 'b', 'c'])
  assert.deepEqual(groups.map(g => g.id), ['upnext', 'out', 'other'])
  assert.equal(groupNotices([]).length, 0)
})

test('ownNotices / otherNotices tách đúng hai khối của hộp thư', () => {
  const box = [{ id: '1', own: true }, { id: '2' }, { id: '3', own: true }]
  assert.deepEqual(ownNotices(box).map(n => n.id), ['1', '3'])
  assert.deepEqual(otherNotices(box).map(n => n.id), ['2'])
})

/* Chốt ở mức NGUỒN: tầng theo dõi không được mọc lại bằng một export thừa. */
test('watch.js không còn tàn dư của tầng theo dõi', () => {
  /* Bỏ chú thích trước khi soát: chính đầu tệp nhắc tên những thứ đã xoá để
     người đọc sau biết chúng từng ở đâu. */
  const src = readFileSync(new URL('./watch.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  for (const dead of ['toggleWatched', 'watchedKeys', 'syncOwnRequests', 'pickLadder', 'pickEta',
    'etaKey', 'DEFAULT_PREFS', 'loadPrefs', 'loadWatched', 'WATCH_LIMIT', 'NEAR_GAP']) {
    assert.ok(!new RegExp(`\\b${dead}\\b`).test(src), `watch.js còn "${dead}"`)
  }
  assert.ok(!/watched|prefs/.test(src), 'không còn chữ "watched"/"prefs" trong tầng thông báo')
})
