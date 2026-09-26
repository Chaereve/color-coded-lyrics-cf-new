/* MÙA GIẢI — khoá luật bằng SỐ, không phải bằng mắt.
   ---------------------------------------------------------
   Ba thứ chỉ sai được một cách âm thầm:
   1. cửa sổ tuần/tháng theo giờ Việt Nam (đổi ngày lúc nửa đêm VN, tuần bắt
      đầu thứ Hai) — sai một tiếng là bài tối Chủ nhật rơi sang tuần sau;
   2. luật gom số theo mùa — bài bị từ chối không được tính, bài gửi ngoài
      cửa sổ nhưng XONG trong cửa sổ vẫn được tính là "xong trong mùa";
   3. hình dạng đầu ra phải khớp `requester_ranking` để `rankRows` xếp được
      mà không biết nó đang xếp bảng tổng hay bảng mùa.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TZ, PERIODS, vnDayKey, seasonWindow, seasonRows, seasonLabel, votesByRequest } from './season.js'

const at = (p) => fileURLToPath(new URL(p, import.meta.url))

/* Chủ nhật 2025-09-21, 17:30 UTC = thứ Hai 2025-09-22, 00:30 giờ Việt Nam.
   Một thời khắc, hai ngày lịch khác nhau — đúng loại ranh giới mà bảng mùa
   phải đứng về phía lịch Việt Nam. */
const NOW = Date.parse('2025-09-21T17:30:00Z')

test('múi giờ là giờ Việt Nam, và "hôm nay" đổi ngày lúc nửa đêm VN chứ không phải UTC', () => {
  assert.equal(TZ, 'Asia/Ho_Chi_Minh')
  assert.equal(vnDayKey(NOW), '2025-09-22', '17:30 UTC Chủ nhật đã là thứ Hai ở VN')
  /* 16:59 UTC vẫn còn là Chủ nhật theo giờ VN (23:59) — ranh giới nằm ở 17:00 */
  assert.equal(vnDayKey(Date.parse('2025-09-21T16:59:00Z')), '2025-09-21')
})

test('cửa sổ TUẦN: thứ Hai 00:00 VN tới thứ Hai kế tiếp 00:00 VN (loại trừ)', () => {
  const win = seasonWindow('week', NOW)
  /* "hôm nay" theo VN là thứ Hai 22/09 -> tuần bắt đầu ngay hôm nay */
  assert.equal(vnDayKey(win.start), '2025-09-22')
  assert.equal(new Date(win.start).getUTCHours(), 17, '00:00 VN = 17:00 UTC ngày trước')
  assert.equal(win.end - win.start, 7 * 86400000, 'đúng 7 ngày')
  /* nhìn từ thứ Tư giữa tuần thì cửa sổ vẫn neo về thứ Hai */
  const wed = seasonWindow('week', Date.parse('2025-09-24T05:00:00Z'))
  assert.equal(vnDayKey(wed.start), '2025-09-22')
  /* nhìn từ Chủ nhật VN (ngày CUỐI tuần) cũng không bị tràn sang tuần sau */
  const sun = seasonWindow('week', Date.parse('2025-09-28T16:00:00Z'))
  assert.equal(vnDayKey(sun.start), '2025-09-22', 'Chủ nhật 28/09 vẫn thuộc tuần 22–28')
})

test('cửa sổ THÁNG: mùng 1 tới mùng 1 tháng sau, và tháng 12 gối năm', () => {
  const win = seasonWindow('month', NOW)
  assert.equal(vnDayKey(win.start), '2025-09-01')
  assert.equal(vnDayKey(win.end), '2025-10-01')
  assert.equal(win.end - win.start, 30 * 86400000, 'tháng 9 có 30 ngày')
  const dec = seasonWindow('month', Date.parse('2025-12-15T05:00:00Z'))
  assert.equal(vnDayKey(dec.start), '2025-12-01')
  assert.equal(vnDayKey(dec.end), '2026-01-01', 'tháng 12 phải gối sang năm sau')
  assert.equal(seasonWindow('all', NOW), null, "'all' không có cửa sổ")
})

/* Hàng mẫu: mốc thời gian dựng bằng ngày LỊCH VN (12:00 VN = 05:00 UTC) để
   không một hàng nào nằm trên ranh giới nửa đêm do nhầm lẫn của chính test. */
const vn = (day) => new Date(`${day}T12:00:00+07:00`).toISOString()
const R = (id, over) => ({
  id, user_id: 'u-' + id.split('-')[0], requester: id.split('-')[0],
  status: 'completed', votes: 0, created_at: vn('2025-09-22'), ...over,
})

/* Phiếu trong cửa sổ tuần 22–28/09 — dựng bằng mốc VN giống `vn()` */
const voteAt = (id, day) => ({ request_id: id, created_at: vn(day) })

test('gom theo mùa: một user một dòng, total = request THUỘC MÙA, phiếu = vote NHẬN TRONG MÙA', () => {
  const rows = [
    /* alice: 1 bài gửi + xong trong tuần, 1 bài cũ KHÔNG có vote trong tuần
       -> bài cũ không thuộc mùa, không đếm ở cột nào */
    R('alice-1', { created_at: vn('2025-09-22'), updated_at: vn('2025-09-23'), votes: 5 }),
    R('alice-2', { created_at: vn('2025-09-15'), updated_at: vn('2025-09-16'), votes: 9 }),
    /* bob: 1 bài gửi thứ Sáu, sang tuần sau mới xong -> tính là XONG tuần sau,
       tuần 22–28 chỉ có "gửi", chưa có "xong" */
    R('bob-1', { created_at: vn('2025-09-26'), updated_at: vn('2025-10-01'), status: 'in_progress', votes: 3 }),
    /* denied: không được tính ở bất kỳ bảng nào (cùng luật view) — kể cả khi
       có phiếu trong tuần */
    R('caro-1', { status: 'denied', votes: 7 }),
    /* dave: gửi ngoài cửa sổ, không vote trong tuần -> không xuất hiện */
    R('dave-1', { created_at: vn('2025-08-02'), updated_at: vn('2025-08-03') }),
  ]
  const votesLog = [
    voteAt('alice-1', '2025-09-23'), voteAt('alice-1', '2025-09-24'), voteAt('alice-1', '2025-09-25'),
    voteAt('bob-1', '2025-09-27'),
    voteAt('caro-1', '2025-09-27'),      /* denied: phiếu của nó không cứu được */
    voteAt('alice-2', '2025-09-10'),     /* NGOÀI tuần: không tính vào tuần này */
  ]
  const ranking = [
    { user_id: 'u-alice', name: 'Alice Official', avatar_url: 'a.png', total: 9, completed: 4, total_votes: 40 },
    { user_id: 'u-bob', name: 'Bob', avatar_url: null, total: 5, completed: 1, total_votes: 10 },
  ]
  const week = seasonRows(rows, ranking, 'week', NOW, votesLog)
  const byId = Object.fromEntries(week.map((p) => [p.user_id, p]))

  assert.deepEqual(Object.keys(byId).sort(), ['u-alice', 'u-bob'],
    'caro (denied) và dave (ngoài cửa sổ, không vote trong tuần) không được vào bảng mùa')
  assert.equal(byId['u-alice'].total, 1, 'chỉ request THUỘC MÙA mới đếm vào total (bài cũ không vote trong tuần không tính)')
  assert.equal(byId['u-alice'].completed, 1, 'bài xong tuần trước không tính vào tuần này')
  assert.equal(byId['u-alice'].total_votes, 3, 'phiếu NHẬN TRONG TUẦN — phiếu tuần trước (10/09) không tính')
  assert.equal(byId['u-alice'].name, 'Alice Official', 'tên lấy từ bảng tổng khi có')
  assert.equal(byId['u-alice'].avatar_url, 'a.png')
  assert.equal(byId['u-bob'].total, 1)
  assert.equal(byId['u-bob'].completed, 0, 'gửi tuần này, xong tuần sau -> chưa "xong" tuần này')
  assert.equal(byId['u-bob'].total_votes, 1)
  assert.equal(byId['u-bob'].key, 'u-bob', 'khoá dòng là user_id, không phải tên')
})

test('bài GỬI ngoài mùa nhưng XONG trong mùa vẫn được đếm là xong trong mùa', () => {
  const rows = [R('erin-1', { created_at: vn('2025-08-10'), updated_at: vn('2025-09-23'), votes: 2 })]
  const week = seasonRows(rows, [], 'week', NOW)
  assert.equal(week.length, 1)
  assert.equal(week[0].completed, 1)
  assert.equal(week[0].total, 1, 'request thuộc mùa (vì XONG trong mùa) vẫn đếm vào total')
  assert.equal(week[0].name, 'erin', 'không có trong bảng tổng thì lấy tên trên hàng')
})

test('bài CŨ được vote TRONG TUẦN phải hiện trong bảng tuần — đúng ca chủ dự án báo (26/09)', () => {
  const rows = [
    /* gus: bài gửi 4 tuần trước, không xong; 4 phiếu CỘNG DỒN nhưng 2 phiếu
       vừa nhận thứ Bảy 27/09 -> thuộc tuần 22–28 với đúng 2 phiếu đó */
    R('gus-1', { created_at: vn('2025-08-25'), updated_at: vn('2025-09-27'), status: 'queued', votes: 4 }),
    /* hen: bài gửi tuần này, chưa ai vote trong tuần -> có mặt vì GỬI trong tuần */
    R('hen-1', { created_at: vn('2025-09-24'), status: 'queued', votes: 0 }),
  ]
  const votesLog = [
    voteAt('gus-1', '2025-09-05'),  /* tuần trước: không tính */
    voteAt('gus-1', '2025-09-27'),  /* thứ Bảy trong tuần: tính */
    voteAt('gus-1', '2025-09-28'),  /* Chủ nhật CUỐI tuần: tính (tuần 22–28) */
  ]
  const week = seasonRows(rows, [], 'week', NOW, votesLog)
  const byId = Object.fromEntries(week.map((p) => [p.user_id, p]))
  assert.deepEqual(Object.keys(byId).sort(), ['u-gus', 'u-hen'])
  assert.equal(byId['u-gus'].total, 1)
  assert.equal(byId['u-gus'].total_votes, 2, 'đúng 2 phiếu nhận trong tuần — phiếu 05/09 không tính')
  /* Tháng cũng thấy bài của gus (cửa sổ tháng 09 chứa cả 3 phiếu? không —
     phiếu 05/09, 27/09, 28/09 đều trong tháng 09) -> 3 phiếu trong tháng */
  const month = seasonRows(rows, [], 'month', NOW, votesLog)
  const gusMonth = month.find(p => p.user_id === 'u-gus')
  assert.equal(gusMonth.total_votes, 3, 'cửa sổ tháng rộng hơn: cả 3 phiếu tháng 09 đều tính')
})

test('votesByRequest: đếm phiếu NHẬN trong [start, end), chịu cả hai hình dạng phiếu và dữ liệu rác', () => {
  /* Đúng cửa sổ tuần của NOW (thứ Hai 22/09 00:00 VN = 21/09 17:00 UTC tới
     thứ Hai 29/09 00:00 VN) — cùng mốc mà seasonWindow('week', NOW) trả về. */
  const start = Date.parse('2025-09-21T17:00:00Z')
  const end = Date.parse('2025-09-28T17:00:00Z')
  const log = [
    { request_id: 'r1', created_at: vn('2025-09-22') },  /* VN 22/09 12:00 = 05:00Z, trong tuần */
    { request_id: 'r1', created_at: vn('2025-09-28') },  /* VN 28/09 12:00 = 05:00Z, trong tuần */
    { id: 'r2', at: Date.parse('2025-09-24T12:00:00Z') },   /* hình dạng demo */
    { request_id: 'r3', created_at: new Date(start).toISOString() },  /* đúng start: gồm */
    { request_id: 'r4', created_at: new Date(end).toISOString() },    /* đúng end: LOẠI (loại trừ) */
    { request_id: 'r5', created_at: 'not-a-date' },
    { created_at: vn('2025-09-24') },           /* thiếu id */
    null,
  ]
  const m = votesByRequest(log, start, end)
  assert.equal(m.get('r1'), 2)
  assert.equal(m.get('r2'), 1)
  assert.equal(m.get('r3'), 1, 'mốc bắt đầu cửa sổ là GỒM')
  assert.equal(m.get('r4'), undefined, 'mốc kết thúc cửa sổ là LOẠI TRỪ')
  assert.equal(m.get('r5'), undefined, 'mốc rác không đếm')
  assert.deepEqual(votesByRequest(null, start, end), new Map(), 'không có phiếu = Map rỗng, không lỗi')
})

test('đầu ra khớp HÌNH DẠNG requester_ranking và luật phá hoà của ranking.js', async () => {
  const rows = [
    R('fay-1', { created_at: vn('2025-09-22'), updated_at: vn('2025-09-22'), votes: 1 }),
    R('fay-2', { created_at: vn('2025-09-23'), updated_at: vn('2025-09-23'), votes: 1 }),
    R('gus-1', { created_at: vn('2025-09-22'), updated_at: vn('2025-09-22'), votes: 8 }),
  ]
  const season = seasonRows(rows, [], 'week', NOW)
  for (const p of season) {
    for (const f of ['user_id', 'key', 'name', 'avatar_url', 'total', 'completed', 'total_votes']) {
      assert.ok(f in p, `thiếu trường ${f} — rankRows/Leaderboard sẽ đọc ra undefined`)
    }
  }
  const { rankRows } = await import('./ranking.js')
  const ranked = rankRows(season, 'completed')
  assert.equal(ranked[0].name, 'fay', '2 bài xong thắng 1 bài xong')
  assert.equal(ranked[0].place, 1)
  assert.ok(ranked[0].share === 1, 'người dẫn đầu giữ vạch tỉ lệ 100%')
})

test('dữ liệu méo không làm bảng mùa ném lỗi (null, thiếu ngày, phiếu rác)', () => {
  const rows = [
    null,
    { id: 'x', status: 'completed' },
    { id: 'y', user_id: 'u-y', status: 'completed', created_at: 'not-a-date', votes: '12' },
    R('zoe-1', { created_at: vn('2025-09-22'), votes: '4' }),
  ]
  const votesLog = [
    { request_id: 'zoe-1', created_at: vn('2025-09-24') },
    { request_id: 'x', created_at: 'not-a-date' },  /* phiếu mốc rác */
    { created_at: vn('2025-09-24') },               /* phiếu thiếu id */
    null,
  ]
  const week = seasonRows(rows, null, 'week', NOW, votesLog)
  assert.equal(week.length, 1, 'chỉ zoe có ngày hợp lệ trong cửa sổ — phiếu rác không cứu được hàng thiếu ngày')
  assert.equal(week[0].total_votes, 1, 'phiếu hợp lệ trong cửa sổ mới đếm — phiếu mốc rác/thiếu id bỏ qua')
  assert.deepEqual(seasonRows(rows, null, 'all', NOW), rows, "'all' trả nguyên đầu vào")
})

test('nhãn khoảng ngày in đúng ngày đầu/cuối theo lịch VN', () => {
  const lbl = seasonLabel('week', NOW)
  assert.deepEqual(lbl, { from: '22/09', to: '28/09' })
  const m = seasonLabel('month', NOW)
  assert.deepEqual(m, { from: '01/09', to: '30/09' })
  assert.equal(seasonLabel('all', NOW), '', "'all' không có khoảng ngày để in")
})

test('component thật phải cắt mùa qua season.js, không tự lọc ngày trong JSX', () => {
  const src = readFileSync(at('../components/Leaderboard.jsx'), 'utf8')
  assert.match(src, /seasonRows\(/, 'bảng mùa phải gom số bằng seasonRows')
  assert.match(src, /seasonWindow\(/, 'khoảng ngày trên UI phải đọc từ cùng một cửa sổ')
  /* Không một phép so ngày tự chế nào trong component — luật nằm một chỗ. */
  assert.doesNotMatch(src, /new Date\((?!nowMs)/, 'Leaderboard không được tự dựng mốc thời gian')
})

test('ba mùa là ba nút, và All time giữ nguyên luật cũ', () => {
  assert.deepEqual(PERIODS.map((p) => p.k), ['all', 'week', 'month'])
  assert.equal(PERIODS.length, 3)
})
