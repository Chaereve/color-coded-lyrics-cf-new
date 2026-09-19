/* Luật xếp hạng — khoá bằng SỐ, không bằng mắt người.
   ---------------------------------------------------------
   Ba việc phải đúng, và cả ba đều là lỗi đã từng có trong bảng thật:
     1. khoá phá hoà không bao giờ trùng khoá chính (bản cũ xếp theo phiếu mà
        hai khoá phá hoà đầu tiên cũng là phiếu → khoá chết, thứ tự rơi xuống
        so theo tên);
     2. số bài đã xong phải được ưu tiên trước tổng phiếu khi xếp theo số bài;
     3. tỉ lệ hoàn thành chỉ có tiếng nói khi số bài ĐÃ BẰNG NHAU.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { RANK_SORTS, rankDemo, rankRows, rateOf, ratePct } from './ranking.js'

const P = (name, total, completed, total_votes) => ({ name, total, completed, total_votes })

test('xếp theo số bài: nhiều bài hơn đứng trước, hoà thì ai xong nhiều hơn', () => {
  const rows = [P('b', 5, 1, 40), P('a', 9, 2, 10), P('c', 5, 4, 12)]
  const out = rankRows(rows, 'total')
  assert.deepEqual(out.map(p => p.name), ['a', 'c', 'b'])
  assert.deepEqual(out.map(p => p.place), [1, 2, 3])
  assert.equal(out[0].share, 1, 'người dẫn đầu luôn có tỉ lệ 1')
  assert.equal(out[1].share, 5 / 9)
})

test('xếp theo bài đã xong: không bị số bài gửi đè lên', () => {
  const rows = [P('many-but-few-done', 30, 3, 90), P('few-but-done', 4, 3, 8), P('none-done', 20, 0, 200)]
  const out = rankRows(rows, 'completed')
  /* 3 bài xong đứng trên 0 bài xong, dù người 0 bài có 20 request và 200 phiếu
     — số bài GỬI KHÔNG mua được hạng ở cách xếp này, đó là cả mục đích của nó.
     Hai người cùng 3 bài xong thì người có nhiều phiếu hơn đứng trước. */
  assert.deepEqual(out.map(p => p.name), ['many-but-few-done', 'few-but-done', 'none-done'])
})

test('xếp theo phiếu: hoà phiếu thì ai XONG NHIỀU HƠN đứng trước (khoá chết đã bị gỡ)', () => {
  const rows = [P('same-votes-low', 10, 1, 50), P('same-votes-high', 4, 4, 50)]
  const out = rankRows(rows, 'total_votes')
  assert.equal(out[0].name, 'same-votes-high',
    'hai người bằng phiếu: người có 4/4 bài xong phải trên người 1/10')
  assert.equal(out[0].place, 1)
})

test('tỉ lệ hoàn thành chỉ dùng khi số bài bằng nhau', () => {
  const rows = [P('many', 30, 30, 0), P('few', 1, 1, 0)]
  const out = rankRows(rows, 'total')
  assert.equal(out[0].name, 'many', '30 bài xong không bị 1 bài xong đè, dù cùng tỉ lệ 100%')
  const tie = rankRows([P('six-of-six', 6, 6, 0), P('six-of-thirty', 6, 2, 0)], 'total')
  assert.equal(tie[0].name, 'six-of-six', 'cùng 6 bài thì ai xong hết đứng trước')
})

test('dữ liệu méo không làm sập bảng và không tạo thứ tự ngẫu nhiên', () => {
  const rows = [
    { name: 'missing', total: undefined, completed: null, total_votes: 'abc' },
    { name: 'ok', total: 3, completed: 1, total_votes: 4 },
    null,
  ]
  const out = rankRows(rows, 'total')
  assert.equal(out[0].name, 'ok')
  assert.equal(out.length, 3)
  assert.equal(ratePct({ total: 0, completed: 5 }), 0, 'chia cho 0 không được ra NaN')
  assert.equal(rateOf({}), 0)
  assert.deepEqual(rankRows([], 'total'), [])
  assert.equal(rankRows(rows, 'không-có-thật')[0].name, 'ok', 'khoá lạ rơi về cách xếp đầu')
})

test('gom số demo: một user_id là MỘT dòng, dù đổi tên hiển thị', () => {
  const rows = [
    { user_id: 'demo-user', requester: 'ttokyeoni', status: 'completed', votes: 5 },
    { user_id: 'demo-user', requester: 'ttokyeoni', status: 'queued', votes: 2 },
    { user_id: 'demo-user', requester: 'lyricscsc', status: 'in_progress', votes: 3 },
    { user_id: 'other-1', requester: 'minji', status: 'queued', votes: 9 },
  ]
  const out = rankDemo(rows)
  assert.equal(out.length, 2, 'hai người thật, không phải bốn dòng theo tên')
  const me = out.find(p => p.user_id === 'demo-user')
  assert.deepEqual({ total: me.total, completed: me.completed, total_votes: me.total_votes },
    { total: 3, completed: 1, total_votes: 10 })
  assert.equal(me.name, 'ttokyeoni', 'tên dùng nhiều nhất thắng (2 lần so với 1)')
  assert.equal(me.key, 'demo-user', 'khoá dòng là user_id — trùng với cách chọn hàng "bạn"')
})

test('bài bị từ chối không vào hạng, và dòng méo không làm sập bảng', () => {
  const rows = [
    { user_id: 'u', requester: 'a', status: 'denied', votes: 100 },
    { user_id: 'u', requester: 'a', status: 'completed', votes: 1 },
    null,
    { user_id: 'v', requester: '  ', status: 'queued', votes: null },
  ]
  const out = rankDemo(rows)
  assert.equal(out.find(p => p.user_id === 'u').total, 1, 'bài denied bị bỏ qua')
  assert.equal(out.find(p => p.user_id === 'v').name, 'demo-user', 'tên trống có tên thay thế')
  assert.equal(out.find(p => p.user_id === 'v').total_votes, 0, 'votes null thành 0, không thành NaN')
})

test('xếp MẶC ĐỊNH theo bài đã xong: gửi nhiều mà không bài nào lên sóng thì không leo hạng', () => {
  /* Ba người này là ba kiểu leo hạng: gửi thật nhiều, làm ra ít, và được cộng
     đồng đòi thật nhiều. Bản trước cộng cả ba vào một con số "điểm" do chính
     bảng tự đặt ra (10 × bài xong + phiếu) — người xem muốn hiểu thứ tự phải
     tin vào một phép nhân không giải thích được. Nay xếp theo đúng số bài ĐÃ
     LÀM XONG, và không con số nào tự đặt. */
  const out = rankRows([
    P('spam', 40, 0, 20),
    P('maker', 4, 2, 3),
    P('star', 1, 1, 40),
  ])
  assert.deepEqual(out.map(p => p.name), ['maker', 'star', 'spam'])
  assert.deepEqual(out.map(p => p.place), [1, 2, 3])
  assert.equal(out[0].share, 1, 'người dẫn đầu luôn có tỉ lệ 1')
  /* Dòng trả về KHÔNG có khoá `points`: bỏ con số tự đặt là bỏ hẳn, không để
     lại một trường chết mà lần sau ai đó lại đọc. */
  for (const p of out) assert.ok(!('points' in p), 'không còn trường điểm')
})

test('cùng số bài đã xong thì ai có nhiều phiếu hơn đứng trước (khoá phá hoà chạy thật)', () => {
  const out = rankRows([P('few-votes', 6, 3, 10), P('many-votes', 6, 3, 44)])
  assert.equal(out[0].name, 'many-votes', 'cùng 3 bài xong: 44 phiếu trên 10 phiếu')
})

test('bảng chỉ xếp theo BA con số có thật trong dữ liệu trả về', () => {
  /* Không còn hằng số trọng số nào để lệch: mỗi cách xếp là một khoá có thật
     trong view `requester_ranking` (total, completed, total_votes). */
  assert.deepEqual(RANK_SORTS.map(s => s.field), ['completed', 'total_votes', 'total'])
  const shape = new Set(['total', 'completed', 'total_votes'])
  for (const s of RANK_SORTS) assert.ok(shape.has(s.field), `${s.k} phải là một cột có thật`)
  /* Mặc định là bài đã xong, không phải số bài gửi. */
  assert.equal(RANK_SORTS[0].k, 'completed')
  assert.equal(rankRows([P('x', 9, 0, 90)])[0].place, 1)
})

test('mỗi cách xếp có màu riêng và khoá chính nằm trong dữ liệu nhận về', () => {
  /* Ba cách xếp = ba câu hỏi. Cột "điểm" thứ tư đã bị gỡ cùng con số tự đặt
     của nó, nên bảng cũng bớt được một tab và một cột. */
  assert.equal(RANK_SORTS.length, 3)
  assert.equal(RANK_SORTS[0].k, 'completed', 'mặc định là số bài đã xong')
  for (const s of RANK_SORTS) {
    assert.ok(s.tone.startsWith('var(--'), `${s.k} phải có màu theo token`)
    assert.equal(s.minis.length, 2, `${s.k}: bục chỉ in hai chỉ báo phụ`)
    assert.ok(!s.minis.includes(s.field), `${s.k}: chỉ báo phụ không được lặp lại khoá chính`)
    const out = rankRows([P('x', 1, 1, 1)], s.k)
    assert.equal(out[0].place, 1)
    assert.equal(typeof out[0][s.field], 'number', `${s.k}: khoá chính phải có trong dòng trả về`)
  }
  /* Không cách xếp nào sinh ra trường điểm nữa — bỏ là bỏ hẳn. */
  for (const s of RANK_SORTS) assert.ok(!('points' in rankRows([P('x', 1, 1, 1)], s.k)[0]))
})
