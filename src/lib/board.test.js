/* Kiểm thử luật xếp hạng của bảng yêu cầu — chạy bằng `npm test`
   (node:test có sẵn trong Node, không cần cài gì thêm).

   Đây là chỗ từng hỏng: cụm trùng bài được gom SAU khi đã sắp xếp từng
   dòng, nên hạng của cụm là hạng của dòng đầu tiên và số vote cộng dồn
   chỉ để trưng bày. Bài 9 vote xé làm 3 request bị xếp dưới bài 5 vote. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boardItems, creditText, findDuplicate, fold, groupIds, groupKey, groupRows, parseRequestPrefill,
  pickBoardParam, sortGroups, sortRows, voteTotals } from './board.js'

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

/* ------------------------------------------------------------------
   Bộ lọc đã nhớ: thứ tự ưu tiên URL → giá trị đã lưu → mặc định
   ------------------------------------------------------------------ */
test('pickBoardParam: URL thắng giá trị đã lưu', () => {
  assert.equal(pickBoardParam('top', 'newest', ['top', 'newest', 'queued'], 'queued'), 'top')
})

test('pickBoardParam: không có trên URL thì dùng giá trị đã lưu', () => {
  assert.equal(pickBoardParam(null, 'completed', ['queued', 'completed'], 'queued'), 'completed')
})

test('pickBoardParam: giá trị lạ bị bỏ qua, không đẩy vào state', () => {
  /* tab đã bị đổi tên ở bản trước để lại trong localStorage, hoặc URL cũ ai đó
     dán vào: cả hai đều phải rơi về mặc định chứ không làm danh sách rỗng */
  assert.equal(pickBoardParam('khong-co-tab-nay', 'cung-khong', ['queued', 'top'], 'queued'), 'queued')
  assert.equal(pickBoardParam('', undefined, ['queued', 'top'], 'queued'), 'queued')
})

/* ------------------------------------------------------------------
   Dò trùng lúc gõ: câu trả lời phải khớp ĐÚNG cách bảng gom cụm
   ------------------------------------------------------------------ */
const dupSample = [
  req('aespa', 'Whiplash', 5, { status: 'queued' }),
  req('  AESPA ', '  whiplash', 4, { status: 'in_progress' }),
  req('aespa', 'Whiplash', 3, { status: 'completed', video_url: 'https://youtu.be/x' }),
  req('Itzy', 'Whiplash', 9, { status: 'queued' }),   // khác nghệ sĩ -> bài khác
]

test('findDuplicate: gom đúng cụm trùng và cộng TỔNG vote của cả cụm', () => {
  const d = findDuplicate(dupSample, { artist: 'Aespa', title: 'WHIPLASH' })
  assert.ok(d)
  assert.equal(d.rows.length, 3)
  assert.equal(d.votes, 12)          // 5 + 4 + 3, kể cả dòng đã xong
  assert.equal(d.open, 2)            // queued + in_progress
  assert.equal(d.video, 'https://youtu.be/x')
})

test('findDuplicate: chỗ bấm vote là dòng còn sống nhiều vote nhất', () => {
  const d = findDuplicate(dupSample, { artist: 'aespa', title: 'whiplash' })
  assert.equal(d.best.id, dupSample[0].id)
  assert.equal(d.best.votes, 5)
})

test('findDuplicate: khác nghệ sĩ hoặc khác tên bài thì KHÔNG báo trùng', () => {
  assert.equal(findDuplicate(dupSample, { artist: 'Itzy', title: 'Dalla Dalla' }), null)
  assert.equal(findDuplicate(dupSample, { artist: 'Aespa', title: 'Supernova' }), null)
})

test('findDuplicate: chưa đủ dữ liệu thì im lặng, không gợi ý sớm', () => {
  /* gõ tới ký tự thứ hai đã thấy "đã có trên bảng" là cách dạy người dùng
     phớt lờ gợi ý */
  assert.equal(findDuplicate(dupSample, { artist: 'aespa', title: 'wh' }), null)
  assert.equal(findDuplicate(dupSample, { artist: '', title: 'Whiplash' }), null)
  assert.equal(findDuplicate(dupSample, { artist: 'aespa', title: '   ' }), null)
})

test('findDuplicate: bài chỉ còn dòng đã xong thì không có gì để vote', () => {
  const d = findDuplicate([req('aespa', 'Whiplash', 3, { status: 'completed' })],
    { artist: 'aespa', title: 'Whiplash' })
  assert.equal(d.open, 0)
  assert.equal(d.best, null)
})

test('findDuplicate: không có dòng nào thì không sập', () => {
  assert.equal(findDuplicate([], { artist: 'aespa', title: 'Whiplash' }), null)
  assert.equal(findDuplicate(null, { artist: 'aespa', title: 'Whiplash' }), null)
  assert.equal(findDuplicate([undefined, null], { artist: 'aespa', title: 'Whiplash' }), null)
})

test('findDuplicate: đếm riêng hàng đang chờ duyệt (không vote được nhưng vẫn là trùng)', () => {
  const d = findDuplicate([req('aespa', 'Whiplash', 0, { status: 'pending' })],
    { artist: 'aespa', title: 'Whiplash' })
  assert.equal(d.pending, 1)
  assert.equal(d.open, 0)
  assert.equal(d.best, null)      // chờ duyệt thì chưa có gì để bấm vào vote
})

/* ------------------------------------------------------------------
   Link mời gửi bài: /?add=1&artist=…&title=…
   ------------------------------------------------------------------ */
const q = (str) => new URLSearchParams(str)

test('parseRequestPrefill: mở form khi có tham số add', () => {
  assert.deepEqual(parseRequestPrefill(q('?add=1&artist=aespa&title=Whiplash')),
    { artist: 'aespa', title: 'Whiplash', link: '' })
  /* `?add` trần và `?add=TRUE` cũng phải mở — link do người dùng gõ tay */
  assert.ok(parseRequestPrefill(q('?add')))
  assert.ok(parseRequestPrefill(q('?add=true')))
})

test('parseRequestPrefill: không có add (hoặc add=0) thì im lặng', () => {
  assert.equal(parseRequestPrefill(q('?artist=aespa&title=Whiplash')), null)
  assert.equal(parseRequestPrefill(q('?add=0')), null)
  assert.equal(parseRequestPrefill(q('?add=false')), null)
  assert.equal(parseRequestPrefill(null), null)
})

test('parseRequestPrefill: cắt độ dài theo đúng maxLength của ô nhập', () => {
  const p = parseRequestPrefill(q(`?add=1&artist=${'a'.repeat(300)}&title=${'t'.repeat(300)}`))
  assert.equal(p.artist.length, 120)
  assert.equal(p.title.length, 160)
})

/* ------------------------------------------------------------------
   Ghim công: chữ dán vào mô tả video
   ------------------------------------------------------------------ */
test('creditText: tên nghệ sĩ đứng trước, gom người gửi, bỏ trùng', () => {
  const song = {
    artist: 'aespa', title: 'Whiplash',
    rows: [{ requester: 'An' }, { requester: 'Bình' }, { requester: 'An' }],
  }
  assert.equal(creditText(song), 'aespa - Whiplash\nRequested by: An, Bình')
})

test('creditText: quá nhiều người thì gộp phần đuôi', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ requester: `U${i}` }))
  const out = creditText({ artist: 'a', title: 't', rows })
  assert.match(out, /Requested by: U0, U1, U2, U3, U4, U5, U6, U7 \+3$/)
})

test('creditText: bài chưa có tên thì trả rỗng, không in dòng cụt', () => {
  assert.equal(creditText({ artist: 'a', title: '  ', rows: [{ requester: 'X' }] }), '')
  assert.equal(creditText(null), '')
})

test('creditText: không có người gửi thì chỉ có dòng tên bài', () => {
  assert.equal(creditText({ artist: 'aespa', title: 'Whiplash', rows: [] }), 'aespa - Whiplash')
  assert.equal(creditText({ artist: '', title: 'Whiplash', rows: [{}] }), 'Whiplash')
})

/* ------------------------------------------------------------------
   Tìm kiếm bỏ dấu: một luật duy nhất cho cả bảng lẫn panel admin
   ------------------------------------------------------------------ */
test('fold: bỏ dấu, hạ chữ thường, gộp khoảng trắng', () => {
  assert.equal(fold('Chung Hạ'), 'chung ha')
  assert.equal(fold('  CHUNG   Ha  '), 'chung ha')
  assert.equal(fold('Whiplash'), 'whiplash')
  assert.equal(fold(null), '')
  assert.equal(fold(undefined), '')
})

test('fold: "đ" là ký tự riêng của tiếng Việt, không phải d có dấu', () => {
  /* NFD không tách được "đ" — thiếu bước thay tay thì "dang nhap" không tìm ra
     "Đặng Nhập", mà nhìn vào code chẳng thấy sai ở đâu. */
  assert.equal(fold('Đặng Nhập'), 'dang nhap')
  assert.equal(fold('đường'), 'duong')
  assert.equal(fold('ĐƯỜNG'), 'duong')
})

test('fold: gõ không dấu vẫn ra bài có dấu, và ngược lại', () => {
  const rows = [req('Chung Hạ', 'Hoa Hồng', 3), req('aespa', 'Whiplash', 5)]
  const search = (q) => rows
    .filter(r => fold(`${r.artist} ${r.title}`).includes(fold(q)))
    .map(r => r.artist)
  assert.deepEqual(search('chung ha'), ['Chung Hạ'])
  assert.deepEqual(search('CHUNG HẠ'), ['Chung Hạ'])
  assert.deepEqual(search('hoa hong'), ['Chung Hạ'])
  assert.deepEqual(search('whiplash'), ['aespa'])
  assert.deepEqual(search('blabla'), [])
})

test('bỏ dấu: chỉ MỘT chỗ định nghĩa, không bản sao thứ hai', () => {
  /* Panel admin từng có `norm()` riêng không xử lý được "đ", nên cùng một từ
     khoá cho hai kết quả khác nhau ở hai màn hình. */
  for (const f of ['../App.jsx', '../components/AdminPanel.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /normalize\('NFD'\)/, `${f} tự chuẩn hoá lại — phải dùng fold()`)
    assert.match(src, /\bfold\(/, `${f} phải lọc bằng fold()`)
  }
})
