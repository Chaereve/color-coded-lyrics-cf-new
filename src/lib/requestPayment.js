/* Phân biệt REQUEST trả phí với ĐƠN MUA VOTE, và nguồn tài trợ của request.
 * `is_paid` chỉ nói request thuộc luồng ưu tiên; nó KHÔNG chứng minh đã thu
 * tiền. `payment_source='bonus'` là phần thưởng đã tiêu, không có hóa đơn.
 * Hàng cũ chưa ghi nguồn thì phải nói là chưa xác minh, không đoán là tiền. */
export const MAX_VOTE_AWAITING = 20
export const ORDER_PAYMENT_HOURS = 72

export function requestPaymentState(request) {
  if (!request?.is_paid) return 'free'
  if (request.payment_source === 'bonus') return 'bonus'
  if (request.payment_status === 'awaiting') return 'awaiting'
  if (request.payment_source === 'money' && request.payment_status === 'paid') return 'paid'
  return 'unverified'
}

export const REQUEST_PAYMENT_LABEL = {
  awaiting: 'req.paymentAwaiting',
  paid: 'req.paymentMoney',
  bonus: 'req.paymentBonus',
  unverified: 'req.paymentUnverified',
}
export const REQUEST_PAYMENT_HINT = {
  awaiting: 'req.paymentAwaitingHint',
  paid: 'req.paymentMoneyHint',
  bonus: 'req.paymentBonusHint',
  unverified: 'req.paymentUnverifiedHint',
}
export const REQUEST_PAYMENT_CLASS = {
  awaiting: 'pending', paid: 'gold', bonus: 'bonus', unverified: 'queued',
}

/* Lát cắt cho admin: tách REQUEST trả tiền khỏi REQUEST dùng thưởng. Khác
   `requestPaymentState` (badge), money awaiting vẫn thuộc luồng tiền để admin
   đối soát một chỗ; bonus không bao giờ bị gọi là money. */
export function requestFundingKind(request) {
  if (!request?.is_paid) return 'free'
  if (request.payment_source === 'money') return 'money'
  if (request.payment_source === 'bonus') return 'bonus'
  return 'unverified'
}
export const matchesRequestFunding = (request, filter) =>
  !filter || filter === 'all' || requestFundingKind(request) === filter

/** Hạng ưu tiên hàng chờ: money đã thu > bonus đã tiêu > free.
    Tiền đang chờ / legacy chưa xác minh KHÔNG được kéo lên hạng money. */
export function requestPriorityRank(request) {
  const state = requestPaymentState(request)
  if (state === 'paid') return 2
  if (state === 'bonus' && request?.payment_status === 'paid') return 1
  return 0
}

export const orderExpiresAt = order => order?.expires_at || null
export const isOrderExpired = (order, now = Date.now()) => {
  if (order?.status === 'expired') return true
  const raw = orderExpiresAt(order)
  if (!raw) return false
  const at = +new Date(raw)
  return order?.status === 'awaiting' && Number.isFinite(at) && at <= now
}
export const isOrderAwaiting = (order, now = Date.now()) =>
  order?.status === 'awaiting' && !isOrderExpired(order, now)
export const pendingOrdersOfKind = (orders, kind, now = Date.now()) =>
  (orders || []).filter(order => order?.kind === kind && isOrderAwaiting(order, now))
export const orderDisplayStatus = (order, now = Date.now()) =>
  isOrderExpired(order, now) ? 'expired' : order?.status

/** Hạn thanh toán hiển thị được; trả null khi đơn không còn ở cửa sổ chờ. */
export function orderDeadline(order, now = Date.now()) {
  const status = orderDisplayStatus(order, now)
  if (status !== 'awaiting' && status !== 'expired') return null
  const at = +new Date(orderExpiresAt(order))
  if (!Number.isFinite(at)) return null
  return { at, expired: status === 'expired', hoursLeft: Math.max(0, Math.ceil((at - now) / 3_600_000)) }
}

/** Nhóm trong My activity: paid request giữ một nhóm riêng, vote theo trạng thái. */
export function orderActivityCategory(order, now = Date.now()) {
  if (order?.kind === 'paid_request') return 'paid_request'
  const status = orderDisplayStatus(order, now)
  return status === 'paid' ? 'successful' : status === 'rejected' ? 'rejected' : status === 'expired' ? 'expired' : 'awaiting'
}

/** Đích của một tin thanh toán: nhóm My activity + trang chứa đúng đơn đó.
    Không chỉ đổi nhóm rồi để người đọc tự dò qua nhiều trang phân trang. */
export function orderFocusLocation(orders, id, perPage = 10, now = Date.now()) {
  const list = Array.isArray(orders) ? orders : []
  const order = list.find(o => o?.id === id)
  if (!order || !(perPage > 0)) return null
  const category = orderActivityCategory(order, now)
  const peers = list.filter(o => orderActivityCategory(o, now) === category)
  const index = peers.findIndex(o => o.id === id)
  return { order, category, index, page: Math.floor(index / perPage) + 1 }
}

/** Mã đối soát đầy đủ: 35 ký tự kể cả tiền tố, không cắt UUID thành mã dễ đụng. */
export function orderReference(order) {
  const id = String(order?.id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (!id) return ''
  return `${order.kind === 'paid_request' ? 'PR' : 'V'}-${id.slice(0, 32)}`
}

export function orderTransferContent(order) {
  return orderReference(order)
}

/** So khớp mã trong nội dung ngân hàng: không phân biệt hoa/thường/dấu gạch. */
export const normalizeReference = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const referenceMatches = (order, value) => {
  const expected = normalizeReference(orderReference(order))
  return !!expected && normalizeReference(value) === expected
}

/** Đối chiếu thủ công, KHÔNG phải bằng chứng cổng thanh toán đã xác minh. */
export function reconcileOrder(order, { method = 'bank', amount, reference = '' } = {}) {
  const currency = method === 'paypal' ? 'USD' : method === 'bank' ? 'VND' : null
  const expected = currency === 'USD' ? Number(order?.amount_usd) : Number(order?.amount_vnd)
  const received = Number(amount)
  if (!currency || !Number.isFinite(received) || received <= 0) return { ok: false, code: 'err.paymentAmountInvalid', currency, expected, received }
  if (!referenceMatches(order, reference)) return { ok: false, code: 'err.paymentReferenceMismatch', currency, expected, received }
  if (Math.abs(received - expected) > 0.001) return { ok: false, code: 'err.paymentAmountMismatch', currency, expected, received }
  return { ok: true, currency, expected, received }
}
