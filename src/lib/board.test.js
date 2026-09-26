/* Kiểm thử luật xếp hạng của bảng yêu cầu — chạy bằng `npm test`
   (node:test có sẵn trong Node, không cần cài gì thêm).

   Đây là chỗ từng hỏng: cụm trùng bài được gom SAU khi đã sắp xếp từng
   dòng, nên hạng của cụm là hạng của dòng đầu tiên và số vote cộng dồn
   chỉ để trưng bày. Bài 9 vote xé làm 3 request bị xếp dưới bài 5 vote. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allTermsIn, boardItems, chainRows, creditText, filterBoard, findDuplicate, fold, groupIds,
  groupKey, groupRows, parseRequestPrefill, pickBoardParam, searchHit, searchTerms, sortGroups,
  sortRows, splitSong, STAGES, voteTotals, weeklyHighlights } from './board.js'

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
     khoá cho hai kết quả khác nhau ở hai màn hình. Nay cả hai màn hình đi qua
     lib/board.js: bảng công khai dùng `searchHit`, admin dùng `allTermsIn`
     (chuỗi dò khác nhau vì admin dò cả ghi chú, còn phép bỏ dấu là MỘT). */
  for (const [f, uses] of [['../App.jsx', /\bfilterBoard\(/], ['../components/AdminPanel.jsx', /\ballTermsIn\(/]]) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /normalize\('NFD'\)/, `${f} tự chuẩn hoá lại — phải dùng hàm của lib/board.js`)
    /* `.includes(fold(...))` là dấu hiệu của bản cũ: ghép chuỗi rồi so CẢ cụm,
       nên thứ tự các cột quyết định kết quả tìm (xem test ngay dưới đây). */
    assert.doesNotMatch(src, /\.includes\(fold\(/, `${f} tự ghép chuỗi để dò — phải qua filterBoard/allTermsIn`)
    assert.match(src, uses, `${f} phải lọc bằng hàm dùng chung`)
  }
  /* App.jsx nay KHÔNG tự bỏ dấu ở đâu cả: việc lọc nằm trong filterBoard. */
  assert.doesNotMatch(readFileSync(new URL('../App.jsx', import.meta.url), 'utf8'), /\bfold\(/,
    'App.jsx không được tự lọc/bỏ dấu — khối đó nằm trong lib/board.js')
  const boardSrc = readFileSync(new URL('./board.js', import.meta.url), 'utf8')
  assert.equal((boardSrc.match(/normalize\('NFD'\)/g) || []).length, 1,
    'fold() chỉ được định nghĩa đúng một lần trong lib/board.js')
})

/* =========================================================
   TÌM KIẾM — so theo từ, không so cả chuỗi
   ---------------------------------------------------------
   Lỗi thật: mọi đường link vào bảng (thẻ "This week", Recent requests của
   trang cá nhân) dựng từ khoá `tên bài + nghệ sĩ`, còn chuỗi để dò của hàng
   lại là `nghệ sĩ + tên bài + loại + người gửi`. Với MỘT phép `includes` cả
   cụm thì hai thứ tự đó không bao giờ gặp nhau: bấm vào bài "Pop Off" trong
   trang cá nhân của người gửi trả về danh sách RỖNG cho chính bài đó.
   ========================================================= */
test('tìm kiếm: thứ tự gõ không quyết định kết quả', () => {
  const row = req('LE SSERAFIM', 'Pop Off', 14, { requester: 'swanlychae' })
  /* Đúng ca chủ dự án báo: từ khoá dựng theo "tên bài trước". */
  assert.equal(searchHit(row, 'Pop Off LE SSERAFIM'), true)
  assert.equal(searchHit(row, 'LE SSERAFIM Pop Off'), true)
  /* Vẫn dò được từng vế riêng, và dò cả loại bài lẫn người gửi. */
  assert.equal(searchHit(row, 'pop off'), true)
  assert.equal(searchHit(row, 'swanlychae'), true)
  assert.equal(searchHit(row, 'color coded'), true)
  assert.equal(searchHit(row, 'LE SSERAFIM Crazy'), false)
})

test('tìm kiếm: từ khoá rỗng là "không lọc", hàng rác không làm vỡ phép dò', () => {
  const row = req('aespa', 'Whiplash', 5)
  for (const empty of ['', '   ', null, undefined]) {
    assert.equal(searchHit(row, empty), true, `từ khoá ${JSON.stringify(empty)} không được loại hàng nào`)
    assert.deepEqual(searchTerms(empty), [])
  }
  /* Một dòng null/thiếu trường giữa mảng (payload realtime méo) không được ném
     lỗi — xem thêm renderGuard.test.js. */
  for (const bad of [null, undefined, {}, { title: 'Whiplash' }]) {
    assert.equal(typeof searchHit(bad, 'whiplash'), 'boolean')
  }
  assert.equal(searchHit({ title: 'Whiplash' }, 'whiplash'), true)
  assert.equal(searchHit(null, 'whiplash'), false)
})

test('tìm kiếm: vẫn bỏ dấu và gom khoảng trắng như fold()', () => {
  const row = req('Chung Hạ', 'Hoa Hồng', 3)
  assert.equal(searchHit(row, 'chung ha'), true)
  assert.equal(searchHit(row, 'CHUNG  HẠ'), true)
  assert.equal(searchHit(row, 'hoa hong chung ha'), true, 'hai từ ở hai trường khác nhau vẫn khớp')
})

test('tìm kiếm: admin và bảng công khai trả lời giống nhau cho cùng một từ khoá', () => {
  /* Admin dò thêm `note`/`status`, nhưng với một từ khoá chỉ có tên bài +
     nghệ sĩ thì hai màn hình phải ra cùng một kết luận — đây là chỗ đã từng
     lệch vì hai bản `fold`/`norm` riêng. */
  const row = req('NewJeans', 'Get Up', 27, { note: 'album xong rồi' })
  for (const q of ['Get Up NewJeans', 'NewJeans Get Up', 'get up', 'newjeans']) {
    assert.equal(allTermsIn(`${row.title} ${row.artist} ${row.note}`, q), searchHit(row, q),
      `lệch nhau ở từ khoá "${q}"`)
  }
})

/* =========================================================
   LỌC BẢNG — ca kiểm thử của lỗi "bấm Recent Request mà bảng nói không có kết quả"
   ---------------------------------------------------------
   Bốn vế, đúng bốn thứ đã cùng lúc hỏng: từ khoá dựng theo "tên bài trước",
   `f=top` loại bài đã xong/đã vào dây chuyền, chip giai đoạn còn bật, và chip
   loại bài còn bật. Mỗi vế là một ca riêng để lần sau hỏng chỗ nào biết ngay
   chỗ đó.
   ========================================================= */
const boardRows = () => {
  const pop = req('LE SSERAFIM', 'Pop Off', 14)
  const done = req('NewJeans', 'Get Up', 27, {
    kind: 'Full Album', status: 'completed', progress: 100, video_url: 'https://youtu.be/x',
  })
  const working = req('Stray Kids', 'FARMING', 3, {
    status: 'in_progress', progress: 47, picked_at: new Date(now - day).toISOString(),
  })
  const next = req('TWICE', 'Moonlight Sunrise', 12, {
    kind: '1 Hour Loop', picked_at: new Date(now - 2 * day).toISOString(),
  })
  const pending = req('aespa', 'Whiplash', 0, { status: 'pending' })
  /* `pub` là thứ App.jsx đưa vào: bài công bố, không pending/denied. */
  return { pub: [pop, done, working, next], rows: [pop, done, working, next, pending], done, working, pending, pop, next }
}

test('lọc bảng: link "tên bài + nghệ sĩ" tìm ra bài ĐÃ XONG (đúng ca đã báo lỗi)', () => {
  const { pub, rows, done } = boardRows()
  for (const q of ['Get Up NewJeans', 'NewJeans Get Up', 'get up newjeans', 'GET UP   NEWJEANS']) {
    const out = filterBoard({ pub, rows, filter: 'newest', q })
    assert.equal(out.length, 1, `từ khoá "${q}" phải ra đúng một bài`)
    assert.equal(out[0].id, done.id)
  }
})

test('lọc bảng: chip giai đoạn còn bật sẽ giấu bài đã xong — nên mở một bài phải XOÁ nó', () => {
  const { pub, rows } = boardRows()
  /* Đây chính xác là trạng thái của người dùng trước khi bấm: họ đang xem
     Queue (chip `Queued` bật), rồi mở trang cá nhân và bấm một bài đã xong. */
  assert.deepEqual(filterBoard({ pub, rows, filter: 'queued', statusFilters: ['queued'], q: 'Get Up NewJeans' }), [])
  /* Và sau khi `openSong` dọn bộ lọc thì bài hiện ra. */
  assert.equal(filterBoard({ pub, rows, filter: 'newest', statusFilters: [], q: 'Get Up NewJeans' }).length, 1)
})

test('lọc bảng: chip loại bài còn bật cũng giấu bài — cùng một lý do', () => {
  const { pub, rows } = boardRows()
  assert.deepEqual(filterBoard({ pub, rows, filter: 'newest', kindFilters: ['Color Coded Lyrics'], q: 'Get Up NewJeans' }), [],
    'bài đó là Full Album')
  assert.equal(filterBoard({ pub, rows, filter: 'newest', kindFilters: ['Full Album'], q: 'Get Up NewJeans' }).length, 1)
  assert.equal(filterBoard({ pub, rows, filter: 'newest', kindFilters: [], q: 'Get Up NewJeans' }).length, 1)
})

test('lọc bảng: `top` loại bài đã xong và bài đang làm — link tới MỘT BÀI phải dùng `newest`', () => {
  const { pub, rows, done, working, pop } = boardRows()
  /* Thẻ "Most voted" bản cũ trỏ vào `?f=top&q=…`: nếu bài nổi nhất tuần đã
     được chốt hoặc đã xong thì người bấm nhận một trang TRỐNG. */
  assert.deepEqual(filterBoard({ pub, rows, filter: 'top', q: 'Get Up NewJeans' }), [])
  assert.deepEqual(filterBoard({ pub, rows, filter: 'top', q: 'FARMING Stray Kids' }), [])
  assert.equal(filterBoard({ pub, rows, filter: 'newest', q: 'FARMING Stray Kids' })[0].id, working.id)
  assert.equal(filterBoard({ pub, rows, filter: 'top', q: 'Pop Off LE SSERAFIM' })[0].id, pop.id,
    'bài còn đang xin phiếu thì `top` vẫn thấy — đó là lý do nó tồn tại')
  assert.equal(filterBoard({ pub, rows, filter: 'newest', q: 'Get Up' })[0].id, done.id)
})

test('lọc bảng: chọn NHIỀU giai đoạn cùng lúc, và `watch` thấy cả bài chưa duyệt', () => {
  const { pub, rows, pending, pop, done, next } = boardRows()
  const ids = (out) => out.map(r => r.id).sort()
  assert.deepEqual(
    ids(filterBoard({ pub, rows, filter: 'queued', statusFilters: ['queued', 'completed'] })),
    ids([pop, done]),
    '`queued` là chờ vote chưa được chốt — Moonlight Sunrise đã có picked_at nên không thuộc về nó')
  assert.deepEqual(ids(filterBoard({ pub, rows, filter: 'queued', statusFilters: [...STAGES] })), ids(pub),
    'chọn cả bốn giai đoạn thì bằng cả bảng')
  /* Đang theo dõi một bài chưa duyệt: tab Following lấy từ `rows`, không `pub`. */
  const watched = new Set([groupKey(pending)])
  assert.deepEqual(ids(filterBoard({ pub, rows, filter: 'watch', watchedSet: watched })), ids([pending]))
  assert.deepEqual(filterBoard({ pub, rows, filter: 'watch', watchedSet: new Set() }), [])
})

test('lọc bảng: "Start production" không đẩy request khỏi filter "Up next"', () => {
  const { pub, rows, working, next } = boardRows()
  const ids = (out) => out.map(r => r.id).sort()
  /* working = bài ĐÃ CHỐT (picked_at) rồi admin bấm "Start production"
     (status → in_progress). Lỗi đã báo: đúng khoảnh khắc đó request biến
     khỏi filter "Up next", trong khi khối Up next vẫn hiện nó, tab vẫn hiện
     nó và badge vẫn ĐẾM nó — số lệch với danh sách. */
  const upNext = filterBoard({ pub, rows, filter: 'picked', statusFilters: ['picked'] })
  assert.ok(upNext.some(r => r.id === working.id),
    'request vừa start production phải vẫn nằm trong filter Up next')
  assert.deepEqual(ids(upNext), ids([working, next]),
    'chip Up next = cả dây chuyền (đang làm + chờ tới lượt), không chỉ bài chưa khởi động')
  /* Chip, khối Up next và tab phải là MỘT tập — so thẳng với chainRows. */
  assert.deepEqual(ids(upNext), ids(chainRows(pub)))
  /* Chip In progress dùng CÙNG tập (tab của nó cũng cùng tập, chỉ khác
     thứ tự) — badge của nó là pickedGroups.length nên danh sách phải khớp. */
  assert.deepEqual(ids(filterBoard({ pub, rows, filter: 'in_progress', statusFilters: ['in_progress'] })), ids(chainRows(pub)))
  /* Bài chưa từng được chốt nhưng admin tick mốc tiến độ (in_progress,
     không có picked_at) cũng thuộc dây chuyền — không được rơi khỏi chip
     Up next như đã từng rơi khỏi mọi tab. */
  const ticked = req('ILLIT', 'Lalaluka', 2, { status: 'in_progress', progress: 40 })
  const pub2 = [...pub, ticked]
  assert.ok(filterBoard({ pub: pub2, rows: pub2, filter: 'picked', statusFilters: ['picked'] }).some(r => r.id === ticked.id))
})

test('lọc bảng: dữ liệu rác không ném lỗi, gọi thiếu tham số vẫn chạy', () => {
  assert.deepEqual(filterBoard(), [])
  assert.deepEqual(filterBoard({ pub: null, rows: null }), [])
  assert.deepEqual(filterBoard({ pub: [null, undefined, { status: 'queued' }] , filter: 'newest' }).length, 1,
    'một dòng null giữa mảng không được làm vỡ bảng')
  assert.deepEqual(filterBoard({ pub: [{ status: 'queued', title: 'x' }], q: null, filter: 'newest' }).length, 1)
})

test('chainRows: bài đang chạy lên trước, rồi theo ngày chốt; bài chưa chốt không vào', () => {
  const { pub, working, next, pop, done } = boardRows()
  const chain = chainRows(pub)
  assert.deepEqual(chain.map(r => r.id), [working.id, next.id],
    'đang làm trước, rồi tới bài chốt sớm hơn; bài chờ vote và bài đã xong không thuộc dây chuyền')
  assert.equal(chainRows(null).length, 0)
  assert.ok(!chain.some(r => r.id === pop.id || r.id === done.id))
})

/* =========================================================
   TÁCH TIÊU ĐỀ VIDEO — người dùng dán nguyên tiêu đề vào ô tên bài
   ---------------------------------------------------------
   Hai khuôn thật của tiêu đề nhạc: tên bài nằm trong cặp nháy (nhạc Hàn/Nhật)
   và "Nghệ sĩ - Tên bài" kèm nhãn quảng cáo ở cuối. Cả hai đều phải ra đúng
   hai vế, và thứ KHÔNG đoán được thì phải trả về `null` — một gợi ý sai bắt
   người dùng sửa hai ô thay vì một.
   ========================================================= */
test('tách tiêu đề video: tên bài trong nháy, dấu gạch nối, và nhãn quảng cáo ở hai đầu', () => {
  assert.deepEqual(splitSong("CHUNG HA 청하 'Algorithm' MV"), { artist: 'CHUNG HA 청하', title: 'Algorithm' })
  assert.deepEqual(splitSong('Billie Eilish - "Birds of a Feather"'), { artist: 'Billie Eilish', title: 'Birds of a Feather' })
  assert.deepEqual(splitSong('aespa - Whiplash (Official Video)'), { artist: 'aespa', title: 'Whiplash' })
  assert.deepEqual(splitSong('[4K] (Official) aespa - Whiplash'), { artist: 'aespa', title: 'Whiplash' })
  assert.deepEqual(splitSong('Artist - Title - Extra'), { artist: 'Artist', title: 'Title - Extra' },
    'dấu gạch nối ĐẦU TIÊN mới là chỗ tách — phần còn lại là tên bài')
  /* Nhãn nằm GIỮA câu là một phần thật của tên bài, không phải nhãn quảng cáo. */
  assert.deepEqual(splitSong('IU - Love wins all (feat. someone)'), { artist: 'IU', title: 'Love wins all (feat. someone)' })
})

test('This week: 0 phiếu không phải Most voted, không mất thẻ New khi chỉ có một bài, và tính cả bài pending', () => {
  const at = (ago) => new Date(Date.now() - ago).toISOString()
  const only = weeklyHighlights([
    { artist: 'Niziu', title: 'Sour Grapes', requester: 'Isabelle', status: 'queued', votes: 0, created_at: at(3600_000) },
  ])
  assert.equal(only.top, null, 'chưa ai vote thì không được gắn nhãn most voted')
  assert.equal(only.newcomer?.title, 'Sour Grapes')
  assert.equal(only.newcomer?.requester, 'Isabelle')

  const same = weeklyHighlights([
    { artist: 'Niziu', title: 'Sour Grapes', requester: 'Isabelle', status: 'queued', votes: 4, created_at: at(3600_000) },
    { artist: 'Niziu', title: 'sour grapes', requester: 'Mina', status: 'queued', votes: 1, created_at: at(7200_000) },
  ])
  assert.equal(same.top?.votes, 5, 'hai request cùng bài trong tuần phải cộng phiếu')
  assert.equal(same.newcomer?.title, 'Sour Grapes', 'không được làm mất thẻ New khi chỉ có một bài')

  const split = weeklyHighlights([
    { artist: 'Niziu', title: 'Sour Grapes', requester: 'Isabelle', status: 'queued', votes: 0, created_at: at(3600_000) },
    { artist: 'IVE', title: 'Accendio', requester: 'fan', status: 'queued', votes: 2, created_at: at(2 * 86400000) },
    { artist: 'aespa', title: 'Whiplash', requester: 'minji', status: 'pending', votes: 0, created_at: at(1000) },
    { artist: 'TWICE', title: 'Old', requester: 'fan', status: 'queued', votes: 40, created_at: at(8 * 86400000) },
  ])
  assert.equal(split.top?.title, 'Accendio')
  assert.equal(split.top?.votes, 2)
  assert.equal(split.newcomer?.title, 'Whiplash', 'bài pending mới nhất phải hiện ở thẻ New')
  assert.equal(split.newcomer?.requester, 'minji')
})

test('tách tiêu đề video: không có dấu hiệu nào thì KHÔNG đoán', () => {
  for (const s of ['aespa Whiplash', 'Whiplash', '', '   ', null, undefined, 'A - B', '- -']) {
    assert.equal(splitSong(s), null, `không được đoán từ ${JSON.stringify(s)}`)
  }
  /* Hai vế giống nhau thì tách ra cũng vô nghĩa. */
  assert.equal(splitSong('Ditto - Ditto'), null)
  /* Không bao giờ trả về vế rỗng hay chữ thừa ở hai đầu. */
  const got = splitSong("  aespa   -   Whiplash  ")
  assert.deepEqual(got, { artist: 'aespa', title: 'Whiplash' })
})
