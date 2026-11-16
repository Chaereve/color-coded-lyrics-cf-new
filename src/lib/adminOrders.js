/* =========================================================
   SỐ LIỆU ĐƠN HÀNG — doanh thu theo NGÀY XÁC NHẬN THU TIỀN
   ---------------------------------------------------------
   `created_at` là lúc khách đặt đơn, không phải lúc tiền về. Một đơn tạo tháng
   trước nhưng admin đối soát hôm nay phải vào cửa sổ hôm nay; đơn cũ đã paid
   trước khi có `paid_at` thì không đoán ngày thu từ ngày tạo.
   ========================================================= */
import { orderDisplayStatus } from './requestPayment.js'

export const ORDER_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const num = (v) => (Number.isFinite(+v) ? +v : 0)
const round2 = (v) => Math.round(v * 100) / 100

export const ORDER_STATE_LABEL = {
  awaiting: 'adm.orderAwaiting',
  paid: 'order.paid',
  rejected: 'order.rejected',
  expired: 'order.expired',
}

export function orderStats(orders = [], now = Date.now(), windowDays = ORDER_WINDOW_DAYS) {
  const since = now - windowDays * DAY_MS
  const out = {
    total: 0, awaiting: 0, reported: 0, paid: 0, rejected: 0, expired: 0, legacyPaid: 0,
    receivedVnd: 0, receivedUsd: 0, recentPaid: 0, windowDays,
  }
  for (const o of orders || []) {
    if (!o) continue
    out.total += 1
    const status = orderDisplayStatus(o, now)
    if (status === 'awaiting') {
      out.awaiting += 1
      if (o.transfer_reported_at) out.reported += 1
    }
    else if (status === 'paid') out.paid += 1
    else if (status === 'rejected') out.rejected += 1
    else if (status === 'expired') out.expired += 1

    if (status !== 'paid') continue
    const t = +new Date(o.paid_at)
    /* Đơn lịch sử chưa có ngày thu / bằng chứng thì đếm là legacy, không ghép
       bừa vào doanh thu 30 ngày và không nhân đôi VND + USD của cùng một đơn. */
    if (!Number.isFinite(t) || !o.payment_method) { out.legacyPaid += 1; continue }
    if (t < since || t > now) continue
    out.recentPaid += 1
    const amount = num(o.received_amount)
    if (o.received_currency === 'VND') out.receivedVnd += amount
    else if (o.received_currency === 'USD') out.receivedUsd += amount
  }
  out.receivedVnd = round2(out.receivedVnd)
  out.receivedUsd = round2(out.receivedUsd)
  return out
}

export const matchOrderState = (o, state, now = Date.now()) =>
  !state || state === 'all' || orderDisplayStatus(o, now) === state
