/* Cổng Edge (Pages Function /api/vote và /api/daily-spin) là đường ưu tiên.
   Khi cổng không chạy — trang bảo trì HTML, mất mạng trước khi có phản hồi,
   hoặc 5xx vì thiếu secret — phiếu/lượt quay phải đi thẳng RPC. Từ chối thật
   (hết vote, captcha, khoá Up next, hạn mức vân tay) KHÔNG được rơi xuống RPC:
   đó là cách đi vòng Turnstile. Timeout cũng không rơi xuống: request có thể
   đã ghi phiếu, gọi lại là cộng đôi. */

const SETUP = new Set(['err.voteGate', 'err.spinGate', 'err.spinSetup'])

export function gateErrorKey(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.error === 'string' && payload.error.startsWith('err.')) return payload.error
  if (typeof payload.message === 'string' && payload.message.startsWith('err.')) return payload.message
  return ''
}

/* true = cổng không xử lý được lượt này, gọi thẳng RPC vẫn an toàn. */
export function gateShouldFallback({ status = 0, contentType = '', payload = null, network = false } = {}) {
  if (network) return true
  const type = String(contentType || '').toLowerCase()
  if (type.includes('text/html')) return true
  if (payload == null && !type.includes('application/json') && !type.includes('+json')) return true
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    const key = gateErrorKey(payload)
    return !key || SETUP.has(key)
  }
  return false
}
