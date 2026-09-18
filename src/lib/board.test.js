/* Kiểm thử luật xếp hạng của bảng yêu cầu — chạy bằng `npm test`
   (node:test có sẵn trong Node, không cần cài gì thêm).

   Đây là chỗ từng hỏng: cụm trùng bài được gom SAU khi đã sắp xếp từng
   dòng, nên hạng của cụm là hạng của dòng đầu tiên và số vote cộng dồn
   chỉ để trưng bày. Bài 9 vote xé làm 3 request bị xếp dưới bài 5 vote. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { boardItems, groupIds, groupKey, groupRows, sortGroups, sortRows, voteTotals } from './board.js'

const day = 86_400_000
const now = Date.UTC(2026, 8, 7)
let seq = 0

/* một request mẫu: id tự sinh để thứ tự nhập không ảnh hưởng kết quả */
const req = (artist, title, votes, extra = {}) => ({
  id: `r${seq++}`, user_id: 'u1', kind: 'Color Coded Lyrics', artist, title,
  requester: 'fan', status: 'queued', progress: 0, votes, is_paid: false,
  picked_at: null, created_at: new Date(now - (seq * day)).toISOString(),
  ...extra,
})

/* nhãn để so thứ tự — tên bài hạ chữ thường vì dòng đại diện của cụm
   (dòng nhiều vote nhất) có thể viết hoa/thường khác dòng đầu tiên nhập vào */
const labels = (items) => items.map(e => (e.type === 'group'
  ? `${e.title.trim().toLowerCase()} (${e.rows.length}×=${e.votes})`
  : `${e.r.title.trim().toLowerCase()} (${e.r.votes})`))

test('khoá gom cụm bỏ qua hoa thường và khoảng trắng thừa', () => {
  assert.equal(groupKey(req('  LE SSERAFIM ', 'Blue Flame')), groupKey(req('le sserafim', '  blue flame ')))
  assert.notEqual(groupKey(req('LE SSERAFIM', 'Blue Flame')), groupKey(req('LE SSERAFIM', 'Crazy')))
})

test('vote của cả cụm được cộng dồn', () => {
  const rows = [req('aespa', 'Whiplash', 3), req('AESPA', ' whiplash', 4), req('IVE', 'HEYA', 9)]
  const groups = groupRows(sortRows(rows, 'top'))
  const whiplash = groups.find(g => g.title.trim().toLowerCase() === 'whiplash')
  assert.equal(whiplash.votes, 7)
  assert.equal(whiplash.rows.length, 2)
})

test('Top voted: cụm nhiều vote cộng dồn xếp trên dòng lẻ nhiều vote hơn từng mảnh', () => {
  /* 3 request cùng bài = 9 vote tổng, đối thủ một mình 5 vote.
     Bản cũ: dòng đầu của cụm chỉ có 3 vote nên cụm rơi xuống hạng 3. */
  const rows = [
    req('Stray Kids', 'FARMING', 3),
    req('NewJeans', 'Ditto', 5),
    req('stray kids', 'farming', 3),
    req('Stray Kids', ' FARMING ', 3),
    req('IVE', 'HEYA', 4),
  ]
  const items = boardItems(rows, 'top')
  assert.deepEqual(labels(items), [
    'farming (3×=9)',
    'ditto (5)',
    'heya (4)',
  ])
})

test('hạng của cụm không đổi khi vote dồn vào một dòng hay chia đều', () => {
  const split = boardItems([
    req('A', 'Song', 3), req('A', 'Song', 3), req('A', 'Song', 3), req('B', 'Other', 8),
  ], 'top')
  const lumped = boardItems([
    req('A', 'Song', 9), req('B', 'Other', 8),
  ], 'top')
  /* cùng một thứ tự hạng; khác chăng chỉ là cụm 3 dòng hay 1 dòng */
  const rank = (items) => items.map(e => `${(e.type === 'group' ? e.title : e.r.title).toLowerCase()}:${e.type === 'group' ? e.votes : e.r.votes}`)
  assert.deepEqual(rank(split), rank(lumped))
})

test('Đang chờ: paid lên đầu, rồi mới tới tổng vote của cụm', () => {
  const items = boardItems([
    req('A', 'Song', 6), req('A', 'song', 6),
    req('B', 'Paid one', 20, { is_paid: true }),
  ], 'queued')
  assert.deepEqual(labels(items), ['paid one (20)', 'song (2×=12)'])
  /* một dòng paid cũng kéo cả cụm lên đầu */
  const mixed = boardItems([
    req('A', 'Song', 1), req('A', 'song', 2, { is_paid: true }), req('B', 'Other', 9),
  ], 'queued')
  assert.equal(mixed[0].title.toLowerCase(), 'song')
  assert.equal(mixed[0].votes, 3)
})

test('Mới nhất: cụm đứng theo request mới nhất trong cụm', () => {
  const oldOne = req('A', 'Song', 1, { created_at: new Date(now - 30 * day).toISOString() })
  const fresh = req('A', 'song', 1, { created_at: new Date(now).toISOString() })
  const mid = req('B', 'Other', 1, { created_at: new Date(now - 5 * day).toISOString() })
  const items = boardItems([oldOne, mid, fresh], 'newest')
  assert.deepEqual(labels(items), ['song (2×=2)', 'other (1)'])
})

test('Up next giữ nguyên thứ tự làm việc, không xáo theo vote', () => {
  const a = req('A', 'Song', 2, { status: 'queued', picked_at: new Date(now - 2 * day).toISOString() })
  const b = req('B', 'Other', 40, { status: 'in_progress', picked_at: new Date(now - 9 * day).toISOString() })
  const items = boardItems([a, b], 'picked')
  assert.deepEqual(labels(items), ['other (40)', 'song (2)'])
})

test('một dòng vẫn là hàng thường, nhiều dòng mới thành thẻ cụm', () => {
  const items = boardItems([req('A', 'Song', 1), req('A', 'song', 1)], 'top')
  assert.equal(items[0].type, 'group')
  assert.equal(items[0].key, groupKey(items[0].rows[0]))
  const single = boardItems([req('A', 'Song', 1)], 'top')
  assert.equal(single[0].type, 'row')
  assert.ok(single[0].r.id)
})

test('dòng trong cụm: dòng nhiều vote nhất đứng đầu', () => {
  const rows = [req('A', 'Song', 1), req('A', 'Song', 7), req('A', 'Song', 3)]
  const g = groupRows(sortRows(rows, 'top'))[0]
  assert.deepEqual(g.rows.map(r => r.votes), [7, 3, 1])
})

test('hoà tổng vote thì bài mới hơn đứng trước', () => {
  const older = req('A', 'Song', 4, { created_at: new Date(now - 10 * day).toISOString() })
  const newer = req('B', 'Other', 4, { created_at: new Date(now - 1 * day).toISOString() })
  const items = boardItems([older, newer], 'top')
  assert.deepEqual(labels(items), ['other (4)', 'song (4)'])
})

test('sortGroups không phá mảng gốc, voteTotals đếm đủ số dòng', () => {
  const groups = groupRows([req('A', 'Song', 2), req('A', 'song', 5), req('B', 'Other', 9)])
  const sorted = sortGroups(groups, 'top')
  assert.notEqual(sorted, groups)
  assert.equal(sorted[0].title, 'Other')
  const totals = voteTotals(groups.flatMap(g => g.rows))
  assert.deepEqual(totals.get(groupKey({ artist: 'a', title: 'SONG' })), { n: 2, total: 7 })
})

test('thiếu votes / created_at cũng không NaN', () => {
  const items = boardItems([{ id: 'x', artist: 'A', title: 'S' }, { id: 'y', artist: 'a', title: 's', votes: 2 }], 'top')
  assert.equal(items[0].votes, 2)
  assert.equal(items.length, 1)
})

/* ---- tic mot moc tien do phai chay deu len ca cum (xem AdminPanel + App) ---- */

const row = (id, artist, title, status = 'queued') => ({ id, artist, title, status, votes: 1 })
const cluster = [
  row('a', 'Aespa', 'Whiplash'),
  row('b', '  aespa ', 'WHIPLASH\n', 'in_progress'),
  row('c', 'aespa', 'whiplash', 'completed'),      // xong roi -> khong dong lay
  row('d', 'aespa', 'whiplash', 'denied'),         // bi tu choi -> khong dong lay
  row('e', 'Itzy', 'Whiplash'),                     // khac artist -> khong lien quan
]

test('groupIds: gom moi request cung bai dang cho, va giu chinh dong duoc tick', () => {
  assert.deepEqual(groupIds(cluster, cluster[0]), ['a', 'b'])
  /* dong duoc tick da completed van nam trong ket qua, va 3 moc la tai san CHUNG
     cua ca bai nen no keo theo ca hai dang xin chua xong (bo tiep dang xong) */
  assert.deepEqual(groupIds(cluster, cluster[2]), ['c', 'a', 'b'])
  assert.deepEqual(groupIds(cluster, cluster[4]), ['e'])
})

test('groupIds: dong khong co id va danh sach rong khong lam bai', () => {
  assert.deepEqual(groupIds(cluster, null), [])
  assert.deepEqual(groupIds([], cluster[0]), ['a'])
  assert.deepEqual(groupIds([undefined, null, { artist: 'x' }], cluster[0]), ['a'])
})

test('groupIds: noi ket qua cho admin, khong phai cho rieng tung hang', () => {
  const ids = groupIds(cluster, cluster[1], ['queued', 'in_progress', 'completed'])
  assert.deepEqual(ids, ['b', 'a', 'c'])
})
