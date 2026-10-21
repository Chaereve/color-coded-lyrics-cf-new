/* =========================================================
   SỐ LIỆU CỦA MỤC ĐƠN HÀNG — một phép tính, hai chỗ đọc
   ---------------------------------------------------------
   Mục Đơn hàng của trang quản trị có hai câu hỏi khác nhau mà trước đây
   không câu nào được trả lời:
     · "còn bao nhiêu đơn phải xử lý?"  → dải số liệu đã có (đơn `awaiting`)
     · "đã thu được bao nhiêu?"          → không có ở đâu cả
   Con số thứ hai phải đếm trên TOÀN BỘ đơn đã tải (App tải hết, xem
   `fetchOrders`), không phải trên trang đang nhìn — doanh thu không đổi khi
   admin bấm sang trang 2 hay gõ một từ khoá.

   Hàm thuần, không React, để test được bằng mảng thường: `orderStats` nhận
   `now` từ ngoài nên không phụ thuộc đồng hồ máy chạy test.
   ========================================================= */

export const ORDER_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const num = (v) => (Number.isFinite(+v) ? +v : 0)

/* Trạng thái đơn có thật trong bảng `orders` — trùng với ADMIN_ORDER_STATES
   bên adminTabs.js. Để ở đây một bản nữa là mở đường cho hai danh sách lệch
   nhau, nên file này nhập từ đó. */
export const ORDER_STATE_LABEL = {
  awaiting: 'adm.orderAwaiting',
  paid: 'order.paid',
  rejected: 'order.rejected',
}

/* Số đơn theo trạng thái + tiền ĐÃ NHẬN trong `windowDays` ngày gần nhất.
   Chỉ đơn `paid` mới là tiền vào: đơn `awaiting` chưa chắc thành tiền, đơn
   `rejected` thì không bao giờ. Cửa sổ tính theo `created_at` — cùng cột mà
   danh sách đang sắp xếp, nên con số và danh sách không thể lệch nhau. */
export function orderStats(orders = [], now = Date.now(), windowDays = ORDER_WINDOW_DAYS) {
  const since = now - windowDays * DAY_MS
  const out = {
    total: 0, awaiting: 0, paid: 0, rejected: 0,
    receivedVnd: 0, receivedUsd: 0, recentPaid: 0, windowDays,
  }
  for (const o of orders || []) {
    if (!o) continue
    out.total += 1
    if (o.status === 'awaiting') out.awaiting += 1
    else if (o.status === 'paid') out.paid += 1
    else if (o.status === 'rejected') out.rejected += 1

    if (o.status !== 'paid') continue
    const t = +new Date(o.created_at)
    /* Ngày hỏng (chuỗi rác) không được kéo con số về 0 một cách âm thầm —
       coi nó là "ngoài cửa sổ" giống mọi đơn cũ. */
    if (!Number.isFinite(t) || t < since) continue
    out.recentPaid += 1
    out.receivedVnd += num(o.amount_vnd)
    out.receivedUsd += num(o.amount_usd)
  }
  return out
}

/* Bộ lọc trạng thái của mục Đơn hàng. `all` = không lọc; giá trị lạ (gõ tay
   `?ost=abc`) đã bị `readAdminView` đưa về `all` trước khi tới đây. */
export const matchOrderState = (o, state) =>
  !state || state === 'all' || o?.status === state
