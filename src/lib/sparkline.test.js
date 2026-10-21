/* Hình sparkline: ba dòng path, không thư viện.
   ---------------------------------------------------------
   Phần dễ sai của một sparkline không phải chỗ vẽ đường, mà là các dãy BIÊN:
   rỗng, một điểm, toàn số 0, mọi giá trị bằng nhau, có số âm. Sai ở đó thì
   hình hoặc ra NaN (không vẽ gì, ô số liệu trống trơn) hoặc nói dối bằng hình
   (toàn số 0 mà vẽ đường giữa khung = "đang có hoạt động").
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanSeries, SPARK_H, SPARK_W, sparkAreaPath, sparkPath, sparkPoints, sparkSummary,
} from './sparkline.js'

test('chuẩn hoá dãy: âm / NaN / chuỗi rác thành 0, giữ nguyên độ dài', () => {
  assert.deepEqual(cleanSeries([1, '3', -2, NaN, null, 0, 'x']), [1, 3, 0, 0, 0, 0, 0])
  assert.deepEqual(cleanSeries([]), [])
  assert.deepEqual(cleanSeries(undefined), [])
})

test('dãy rỗng vẫn là một đường phẳng ở ĐÁY, không phải NaN hay mảng rỗng', () => {
  const pts = sparkPoints([])
  assert.equal(pts.length, 2)
  assert.equal(pts[0].y, SPARK_H - 2)
  assert.equal(pts[1].y, SPARK_H - 2)
  assert.match(sparkPath(pts), /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/)
  assert.equal(sparkPath(pts).includes('NaN'), false)
})

test('dãy toàn số 0 cũng nằm ở đáy — "không có gì" không được trông như "có"', () => {
  const pts = sparkPoints([0, 0, 0, 0])
  assert.equal(pts.length, 4)
  for (const p of pts) assert.equal(p.y, SPARK_H - 2)
})

test('một điểm: một chấm giữa khung; path rỗng để component vẽ <circle>', () => {
  const pts = sparkPoints([5])
  assert.equal(pts.length, 1)
  assert.equal(pts[0].x, SPARK_W / 2)
  assert.equal(sparkPath(pts), '')
  assert.equal(sparkAreaPath(pts, SPARK_H), '')
  /* và một điểm 0 thì chấm nằm ở đáy, không phải giữa */
  assert.equal(sparkPoints([0])[0].y, SPARK_H - 2)
})

test('mọi giá trị bằng nhau: đường GIỮA khung, không dán đáy', () => {
  const pts = sparkPoints([4, 4, 4])
  const mid = SPARK_H / 2
  for (const p of pts) assert.ok(Math.abs(p.y - mid) < 0.001, `y=${p.y} phải ở giữa`)
})

test('đỉnh chạm mép trên, giá trị 0 chạm mép dưới — toạ độ nằm trong khung', () => {
  const pts = sparkPoints([0, 10, 5])
  assert.equal(pts[1].y, 2, 'giá trị lớn nhất phải sát mép trên (trừ padding)')
  assert.equal(pts[0].y, SPARK_H - 2)
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= SPARK_W, `x=${p.x} ra ngoài khung`)
    assert.ok(p.y >= 0 && p.y <= SPARK_H, `y=${p.y} ra ngoài khung`)
  }
  /* x trải đều từ trái sang phải: điểm cuối phải ở mép phải, nếu không hình
     sẽ co cụm một góc khi dãy ngắn. */
  assert.equal(pts[2].x, SPARK_W - 2)
})

test('path là chuỗi M/L hợp lệ và vùng tô khép xuống đáy khung', () => {
  const pts = sparkPoints([1, 2, 3])
  const line = sparkPath(pts)
  assert.match(line, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){2}$/)
  const area = sparkAreaPath(pts, SPARK_H)
  assert.ok(area.startsWith(line), 'vùng tô phải chép lại đúng đường')
  assert.ok(area.endsWith('Z'), 'vùng tô phải khép kín')
  assert.ok(area.includes(` ${SPARK_H} `), 'vùng tô phải chạm đáy khung')
})

test('câu tóm tắt: tổng, đỉnh, số điểm — và KHÔNG có đỉnh khi dãy im lặng', () => {
  assert.deepEqual(sparkSummary([0, 3, 1, 7, 2]), { total: 13, max: 7, peak: 4, points: 5 })
  assert.deepEqual(sparkSummary([]), { total: 0, max: 0, peak: 0, points: 0 })
  /* Tuần không có sự kiện: `max = 0` thì không được báo "đỉnh vào ngày cuối". */
  assert.deepEqual(sparkSummary([0, 0, 0]), { total: 0, max: 0, peak: 0, points: 3 })
})

test('kích thước truyền vào được tôn trọng (ô hẹp trong lưới số liệu)', () => {
  const pts = sparkPoints([1, 2], { width: 40, height: 12, pad: 1 })
  assert.equal(pts[0].x, 1)
  assert.equal(pts[1].x, 39)
  assert.ok(pts.every(p => p.y >= 1 && p.y <= 11))
})
