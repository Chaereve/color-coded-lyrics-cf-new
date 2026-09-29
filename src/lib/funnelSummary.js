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
