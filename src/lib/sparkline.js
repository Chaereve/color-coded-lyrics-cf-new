/* =========================================================
   SPARKLINE — một dãy số thành một hình, không cần thư viện
   ---------------------------------------------------------
   Tổng 7 ngày là một con số; con số đó KHÔNG nói được "đang lên hay đang
   xuống". Một dãy 7 điểm vẽ bằng polyline thì nói được — và nó không cần
   chart library nào: một `<svg>` với ba dòng path là đủ.
   Hàm thuần, tách khỏi component, vì vài luật dưới đây đều là chỗ dễ sai mà
   test bằng chuỗi thì rẻ hơn test bằng ảnh:
     · dãy rỗng / toàn số 0 → một đường phẳng ở đáy, không phải NaN
     · một điểm → một chấm giữa khung, không phải một đường chia cho 0
     · mọi giá trị bằng nhau → đường GIỮA khung (không dán đáy)
     · giá trị âm / không phải số → kẹp về 0
   ========================================================= */

export const SPARK_W = 96
export const SPARK_H = 26
const PAD = 2

/* Chuẩn hoá đầu vào: chỉ số hữu hạn ≥ 0, giữ nguyên độ dài dãy (kể cả điểm 0). */
export function cleanSeries(values = []) {
  return (values || []).map((v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  })
}

/* Toạ độ các điểm trên khung W×H. Toạ độ y bị đảo (SVG tính từ trên xuống). */
export function sparkPoints(values, { width = SPARK_W, height = SPARK_H, pad = PAD } = {}) {
  const data = cleanSeries(values)
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)
  const max = Math.max(0, ...data)
  /* Đường phẳng nằm ĐÁY khung: một tuần không có sự kiện nào phải trông
     giống "không có gì", không phải trông giống "đầy". */
  const flatY = height - pad
  if (!data.length) return [{ x: pad, y: flatY }, { x: pad + innerW, y: flatY }]
  if (data.length === 1) {
    const y = max > 0 ? pad + innerH : flatY
    return [{ x: pad + innerW / 2, y }]
  }
  const step = innerW / (data.length - 1)
  /* Mọi giá trị bằng nhau và > 0 thì vẽ ở GIỮA: dán đáy là nói dối "về 0". */
  const flatMid = max > 0 && data.every((n) => n === max) ? pad + innerH / 2 : null
  return data.map((n, i) => {
    const ratio = max > 0 ? n / max : 0
    const y = flatMid ?? (max > 0 ? pad + (1 - ratio) * innerH : flatY)
    return { x: pad + i * step, y }
  })
}

const round = (n) => Math.round(n * 100) / 100

export function sparkPath(points = []) {
  if (!points.length) return ''
  if (points.length === 1) {
    /* Một điểm: path rỗng, component vẽ `<circle>` thay thế. */
    return ''
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
}

/* Vùng tô dưới đường: chép lại đường rồi khép xuống đáy khung. */
export function sparkAreaPath(points = [], height = SPARK_H) {
  if (points.length < 2) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${sparkPath(points)} L${round(last.x)} ${height} L${round(first.x)} ${height} Z`
}

/* Câu đọc thay cho hình — sparkline là trang trí với mắt nhưng phải trả lời
   được bằng chữ khi có trình đọc màn hình (hoặc khi ai đó tắt CSS). */
export function sparkSummary(values = []) {
  const data = cleanSeries(values)
  const total = data.reduce((a, b) => a + b, 0)
  const max = Math.max(0, ...data)
  /* `peak` là NGÀY có đỉnh (1-based), 0 khi không có đỉnh nào. Dãy toàn số 0
     cũng có `max = 0`; nếu không chặn thì `lastIndexOf(0) + 1` biến tuần im
     lặng thành "đỉnh vào ngày 7" — câu chữ sai hoàn toàn. */
  const peak = data.length && max > 0 ? data.lastIndexOf(max) + 1 : 0
  return { total, max, peak, points: data.length }
}
