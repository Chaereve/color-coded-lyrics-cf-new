/* Tổng hợp số đếm đã được funnel_summary() gom theo ngày/sự kiện.
   Module thuần: không truy cập client, không lấy danh tính, dễ kiểm thử. */
export const FUNNEL_EVENT_KEYS = ['visit', 'request', 'vote', 'buy', 'spin']

export function aggregateFunnel(rows = []) {
  const totals = Object.fromEntries(FUNNEL_EVENT_KEYS.map((key) => [key, 0]))
  for (const row of rows || []) {
    if (!Object.hasOwn(totals, row?.event)) continue
    const n = Number(row?.n)
    if (Number.isFinite(n) && n > 0) totals[row.event] += n
  }
  return totals
}

/* =========================================================
   CHUỖI THEO NGÀY — từ cùng những dòng `funnel_summary` đã có
   ---------------------------------------------------------
   `aggregateFunnel` trả về một con số cho mỗi sự kiện; con số đó không nói
   được xu hướng. Hàm này giữ lại trục thời gian: một dãy đúng `days` phần tử
   cho mỗi sự kiện, cộng dồn theo ngày, ngày không có sự kiện là 0 chứ không
   bị bỏ khỏi dãy (bỏ đi là sparkline vẽ sai hình).
   `end` truyền từ ngoài (ngày cuối, dạng YYYY-MM-DD) để test không phụ thuộc
   đồng hồ máy chạy — lúc chạy thật thì mặc định là hôm nay.
   ========================================================= */
const DAY_MS = 24 * 60 * 60 * 1000
const dayKey = (d) => new Date(d).toISOString().slice(0, 10)

export function seriesByDay(rows = [], days = 7, end = new Date()) {
  const n = Math.max(1, Math.trunc(Number(days)) || 7)
  const endMs = +new Date(`${String(end).slice(0, 10)}T00:00:00.000Z`)
  const base = Number.isFinite(endMs) ? endMs : Date.now()
  const keys = Array.from({ length: n }, (_, i) => dayKey(base - (n - 1 - i) * DAY_MS))
  const at = new Map(keys.map((k, i) => [k, i]))
  const series = Object.fromEntries(FUNNEL_EVENT_KEYS.map((e) => [e, keys.map(() => 0)]))

  for (const row of rows || []) {
    const i = at.get(String(row?.day || '').slice(0, 10))
    if (i === undefined) continue
    if (!Object.hasOwn(series, row?.event)) continue
    const value = Number(row?.n)
    if (!Number.isFinite(value) || value <= 0) continue
    series[row.event][i] += value
  }
  return { days: keys, series }
}

/* =========================================================
   TỈ LỆ CHUYỂN ĐỔI — cái mà năm con số tuyệt đối không nói được
   ---------------------------------------------------------
   "1.200 visit và 3 request" chỉ có nghĩa khi chia cho nhau. Mẫu số 0 trả về
   null (không phải 0%, cũng không phải NaN): "chưa có ai để tính" khác hẳn
   "có người nhưng không ai chuyển đổi", và màn hình phải nói được hai thứ đó
   khác nhau.
   ========================================================= */
export const FUNNEL_CONVERSIONS = [
  { key: 'visitRequest', from: 'visit', to: 'request' },
  { key: 'visitBuy', from: 'visit', to: 'buy' },
]

/* Tỉ lệ chuyển đổi: luôn nằm trong 0–100%, vì mẫu số là một nhóm người và tử
   số là một TẬP CON của nhóm đó. Mẫu số 0 → null. */
export function conversionRates(totals = {}) {
  const out = {}
  for (const { key, from, to } of FUNNEL_CONVERSIONS) {
    const base = Number(totals?.[from])
    const hit = Number(totals?.[to])
    out[key] = Number.isFinite(base) && base > 0 && Number.isFinite(hit)
      ? Math.max(0, Math.min(100, (hit / base) * 100))
      : null
  }
  return out
}

/* Số vote trên mỗi request là TỈ SỐ, không phải phần trăm: một request có thể
   nhận 20 vote (người ta vote nhiều lần, và vote mua được). Kẹp nó về 100% là
   nói dối đúng chỗ admin cần biết nhất — request nào đang hút vote. */
export function votesPerRequest(totals = {}) {
  const requests = Number(totals?.request)
  const votes = Number(totals?.vote)
  if (!Number.isFinite(requests) || requests <= 0 || !Number.isFinite(votes)) return null
  return Math.max(0, votes / requests)
}
