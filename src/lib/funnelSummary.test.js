import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateFunnel, conversionRates, FUNNEL_CONVERSIONS, FUNNEL_EVENT_KEYS, seriesByDay, votesPerRequest,
} from './funnelSummary.js'

test('cộng các nhóm ngày thành tổng 7 ngày, giữ đủ năm sự kiện', () => {
  assert.deepEqual(aggregateFunnel([
    { day: '2026-10-01', event: 'visit', n: '12' },
    { day: '2026-10-02', event: 'visit', n: 8 },
    { day: '2026-10-02', event: 'request', n: '3' },
    { day: '2026-10-02', event: 'vote', n: 7 },
    { day: '2026-10-02', event: 'buy', n: 1 },
    { day: '2026-10-02', event: 'spin', n: 4 },
  ]), { visit: 20, request: 3, vote: 7, buy: 1, spin: 4 })
})

test('không cộng event lạ, giá trị âm hoặc không phải số', () => {
  assert.deepEqual(aggregateFunnel([
    { event: 'admin_login', n: 9 }, { event: 'visit', n: -2 },
    { event: 'vote', n: 'not-a-number' }, { event: 'buy', n: null },
  ]), { visit: 0, request: 0, vote: 0, buy: 0, spin: 0 })
})

test('tổng hợp chỉ xuất whitelist event — không mang ngày hay danh tính sang UI', () => {
  const out = aggregateFunnel([{ event: 'visit', n: 2, user_id: 'private', device_id: 'private' }])
  assert.deepEqual(Object.keys(out), FUNNEL_EVENT_KEYS)
  assert.equal(JSON.stringify(out).includes('private'), false)
})

/* ================= CHUỖI THEO NGÀY (sparkline) ================= */
test('mỗi sự kiện có một dãy đúng bằng số ngày, ngày trống là 0 chứ không bị bỏ', () => {
  const { days, series } = seriesByDay([
    { day: '2026-10-01', event: 'visit', n: 5 },
    { day: '2026-10-01', event: 'visit', n: 2 },   // cùng ngày: cộng dồn
    { day: '2026-10-03', event: 'request', n: 1 },
  ], 3, '2026-10-03')
  assert.deepEqual(days, ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.deepEqual(series.visit, [7, 0, 0], 'ngày 02 không có ai vào thì phải là 0, không được rút ngắn dãy')
  assert.deepEqual(series.request, [0, 0, 1])
  assert.deepEqual(Object.keys(series), FUNNEL_EVENT_KEYS)
})

test('dãy chỉ nhận ngày trong cửa sổ và chỉ event có thật', () => {
  const { series } = seriesByDay([
    { day: '2026-09-01', event: 'visit', n: 99 },       // ngoài cửa sổ
    { day: '2026-10-03', event: 'admin_login', n: 9 },  // event lạ
    { day: '2026-10-03', event: 'visit', n: -4 },       // âm
    { day: '2026-10-03', event: 'visit', n: 'x' },      // không phải số
  ], 2, '2026-10-03')
  assert.deepEqual(series.visit, [0, 0])
  assert.equal(Object.hasOwn(series, 'admin_login'), false)
})

test('cửa sổ 30 ngày và ngày cuối không hợp lệ vẫn ra dãy dùng được', () => {
  assert.equal(seriesByDay([], 30, '2026-10-03').days.length, 30)
  /* Hàm phải tự chống lại `days` rác: 0 / NaN / chuỗi đều không được làm dãy
     rỗng (dãy rỗng = sparkline không có gì để vẽ), nên chúng rơi về 7 ngày. */
  assert.equal(seriesByDay([], 0, '2026-10-03').days.length, 7)
  assert.equal(seriesByDay([], 'abc', '2026-10-03').days.length, 7)
  const bad = seriesByDay([{ day: '2026-10-03', event: 'visit', n: 1 }], 3, 'not-a-date')
  assert.equal(bad.days.length, 3, 'ngày cuối hỏng thì lùi về hôm nay, không ném lỗi')
})

/* ================= TỈ LỆ CHUYỂN ĐỔI ================= */
test('tỉ lệ chuyển đổi là phần trăm của một tập con, mẫu số 0 thì là null', () => {
  assert.deepEqual(conversionRates({ visit: 200, request: 10, buy: 5 }),
    { visitRequest: 5, visitBuy: 2.5 })
  /* "chưa có ai để tính" KHÁC "có người nhưng không ai chuyển đổi" — màn hình
     hiện "—" cho cái đầu và "0.0%" cho cái sau. */
  assert.deepEqual(conversionRates({ visit: 0, request: 3, buy: 0 }),
    { visitRequest: null, visitBuy: null })
  assert.deepEqual(conversionRates({}), { visitRequest: null, visitBuy: null })
})

test('tỉ lệ bị kẹp trong 0–100% vì tử số luôn là tập con của mẫu số', () => {
  /* Dữ liệu bẩn (đếm trùng, event ghi sai) không được vẽ ra 250%. */
  assert.deepEqual(conversionRates({ visit: 4, request: 10, buy: 0 }),
    { visitRequest: 100, visitBuy: 0 })
})

test('vote trên mỗi request là TỈ SỐ, không bị kẹp về 100%', () => {
  /* Một request nhận được 20 vote là chuyện bình thường (vote mua được). Kẹp
     về 100% là nói dối đúng chỗ admin cần biết: bài nào đang hút vote. */
  assert.equal(votesPerRequest({ request: 2, vote: 41 }), 20.5)
  assert.equal(votesPerRequest({ request: 0, vote: 41 }), null)
  /* Thiếu hẳn số vote là "chưa biết", không phải "không ai vote" — cùng lý do
     với mẫu số 0 ở trên. */
  assert.equal(votesPerRequest({ request: 3 }), null)
  assert.equal(votesPerRequest({ request: 3, vote: 0 }), 0)
  assert.equal(votesPerRequest({}), null)
})

test('ba tỉ lệ khai báo đúng một nguồn: không có tỉ lệ nào tự tính riêng trong UI', () => {
  /* `requestVote` từng nằm trong danh sách này và bị KẸP về 100% — sai bản
     chất. Nó đã được tách thành `votesPerRequest` (tỉ số), xem test trên. */
  assert.deepEqual(FUNNEL_CONVERSIONS.map(c => c.key), ['visitRequest', 'visitBuy'])
  for (const c of FUNNEL_CONVERSIONS) {
    assert.ok(FUNNEL_EVENT_KEYS.includes(c.from), `${c.key}: mẫu số phải là sự kiện có thật`)
    assert.ok(FUNNEL_EVENT_KEYS.includes(c.to), `${c.key}: tử số phải là sự kiện có thật`)
  }
})
