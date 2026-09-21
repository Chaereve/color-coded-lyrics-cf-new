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
import { TZ, PERIODS, vnDayKey, seasonWindow, seasonRows, seasonLabel } from './season.js'

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

test('gom theo mùa: một user một dòng, đếm đúng bài gửi / bài xong TRONG cửa sổ', () => {
  const rows = [
    /* alice: 2 bài gửi trong tuần, 1 xong trong tuần, 1 xong NGOÀI tuần
       (gửi tuần trước, updated_at tuần trước) -> không được đếm xong */
    R('alice-1', { created_at: vn('2025-09-22'), updated_at: vn('2025-09-23'), votes: 5 }),
    R('alice-2', { created_at: vn('2025-09-15'), updated_at: vn('2025-09-16'), votes: 9 }),
    /* bob: 1 bài gửi thứ Sáu, sang tuần sau mới xong -> tính là XONG tuần sau,
       tuần 22–28 chỉ có "gửi", chưa có "xong" */
    R('bob-1', { created_at: vn('2025-09-26'), updated_at: vn('2025-10-01'), status: 'in_progress', votes: 3 }),
    /* denied: không được tính ở bất kỳ bảng nào (cùng luật view) */
    R('caro-1', { status: 'denied', votes: 7 }),
    /* dave: gửi ngoài cửa sổ, không có gì trong tuần -> không xuất hiện */
    R('dave-1', { created_at: vn('2025-08-02'), updated_at: vn('2025-08-03') }),
  ]
  const ranking = [
    { user_id: 'u-alice', name: 'Alice Official', avatar_url: 'a.png', total: 9, completed: 4, total_votes: 40 },
    { user_id: 'u-bob', name: 'Bob', avatar_url: null, total: 5, completed: 1, total_votes: 10 },
  ]
  const week = seasonRows(rows, ranking, 'week', NOW)
  const byId = Object.fromEntries(week.map((p) => [p.user_id, p]))

  assert.deepEqual(Object.keys(byId).sort(), ['u-alice', 'u-bob'],
    'caro (denied) và dave (ngoài cửa sổ) không được vào bảng mùa')
  assert.equal(byId['u-alice'].total, 1, 'chỉ bài GỬI trong tuần mới đếm vào total')
  assert.equal(byId['u-alice'].completed, 1, 'bài xong tuần trước không tính vào tuần này')
  assert.equal(byId['u-alice'].total_votes, 5, 'phiếu của bài gửi trong mùa')
  assert.equal(byId['u-alice'].name, 'Alice Official', 'tên lấy từ bảng tổng khi có')
  assert.equal(byId['u-alice'].avatar_url, 'a.png')
  assert.equal(byId['u-bob'].total, 1)
  assert.equal(byId['u-bob'].completed, 0, 'gửi tuần này, xong tuần sau -> chưa "xong" tuần này')
  assert.equal(byId['u-bob'].key, 'u-bob', 'khoá dòng là user_id, không phải tên')
})

test('bài GỬI ngoài mùa nhưng XONG trong mùa vẫn được đếm là xong trong mùa', () => {
  /* đây chính là câu "cộng đồng nhận được gì tuần này" — bài lên sóng thứ Ba
     dù được gửi từ tháng trước vẫn là thành quả của tuần này */
  const rows = [R('erin-1', { created_at: vn('2025-08-10'), updated_at: vn('2025-09-23'), votes: 2 })]
  const week = seasonRows(rows, [], 'week', NOW)
  assert.equal(week.length, 1)
  assert.equal(week[0].completed, 1)
  assert.equal(week[0].total, 0, 'nhưng không bị đếm là "gửi trong tuần"')
  assert.equal(week[0].name, 'erin', 'không có trong bảng tổng thì lấy tên trên hàng')
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

test('dữ liệu méo không làm bảng mùa ném lỗi (null, thiếu ngày, votes chữ)', () => {
  const rows = [
    null,
    { id: 'x', status: 'completed' },                                   // không có ngày nào
    { id: 'y', user_id: 'u-y', status: 'completed', created_at: 'not-a-date', votes: '12' },
    R('zoe-1', { votes: '4' }),
  ]
  const week = seasonRows(rows, null, 'week', NOW)
  assert.equal(week.length, 1, 'chỉ zoe có ngày hợp lệ trong cửa sổ')
  assert.equal(week[0].total_votes, 4, 'votes dạng chữ vẫn đếm được')
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
