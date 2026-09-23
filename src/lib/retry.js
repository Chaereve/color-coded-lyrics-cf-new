/* =========================================================
   THỬ LẠI KHI LỖI NHẤT THỜI
   ---------------------------------------------------------
   Lý do file này tồn tại: một lần nạp đầu của trang là MƯỜI
   cuộc gọi chạy song song (bảng request, xếp hạng, media,
   số bình luận, số phiếu…). Trước đây bất kỳ cuộc gọi nào
   hỏng vì mạng chập chờn (cold start của Supabase, đổi mạng
   giữa lúc đang tải, tab vừa mở trong lúc thiết bị đang
   chuyển wifi) là `Promise.allSettled` nuốt cái lỗi đó lại và
   bảng hiện "Nothing here yet." — không chữ nào nói là lỗi,
   không nút nào để bấm. Người dùng đọc đó là "web không load
   dữ liệu", bấm F5, và lần sau may mắn thì có.

   Thử lại chỉ dùng cho lỗi NHẤT THỜI. Lặp lại một lỗi có
   nghĩa (thiếu bảng PGRST205, sai quyền 401/403, dữ liệu
   không tồn tại) chỉ làm người dùng đợi lâu hơn để rồi nhận
   đúng một kết quả như cũ.

   Ba lần, lùi dần: 450ms → 900ms. Cộng phần chờ giữa các lần
   là ~1,4s. Riêng request TREO (không trả lời, không báo lỗi
   — đúng kiểu "vào web không thấy gì, F5 thì được") bị cắt
   sau `timeout` rồi thử lại; hết lượt thì ném, để trang hiện
   khối lỗi CÓ NÚT thay vì một bảng trống không lời giải.
   ========================================================= */

export const RETRY_DEFAULTS = { tries: 3, base: 450, factor: 2, max: 3000, jitter: 0.2 }

/* Mã trạng thái HTTP đáng để thử lại: quá tải / cổng hỏng / giới hạn nhịp.
   408 hết giờ chờ, 425 quá sớm, 429 quá nhiều, 500–504 lỗi phía máy chủ. */
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/* Mã CÓ NGHĨA: thử lại bao nhiêu lần cũng ra đúng kết quả đó.
   · PGRST202/205 — hàm/bảng chưa có (chưa chạy migration);
   · PGRST204/116 — cột/không có dòng (dữ liệu, không phải mạng).
   PGRST301 (JWT hết hạn) CỐ Ý không có trong danh sách này: supabase-js làm
   mới token ở dưới, nên lần gọi ngay sau đó thường chạy được — đó là đúng
   kiểu lỗi nhất thời mà thử lại sinh ra để giải quyết. */
const FINAL_CODES = new Set(['PGRST116', 'PGRST202', 'PGRST204', 'PGRST205'])

/* Mã NHẤT THỜI dù không kèm trạng thái HTTP: PGRST301 là "JWT hết hạn" —
   supabase-js làm mới token ở dưới, nên lần gọi kế tiếp thường chạy được. */
const RETRY_CODES = new Set(['PGRST301'])

/* Lỗi mạng của Node/fetch mang mã chữ E (ECONNRESET, ETIMEDOUT, ENOTFOUND…). */
const NODE_NET_CODE = /^E[A-Z_]{3,}$/

export function isTransientError(err) {
  if (!err || err === true) return false
  /* Bị huỷ là có chủ ý (unmount, đổi tài khoản) — không phải lỗi mạng. */
  if (err.name === 'AbortError' || err.code === 'ABORTED') return false

  const code = typeof err.code === 'string' ? err.code : ''
  if (FINAL_CODES.has(code)) return false
  if (RETRY_CODES.has(code)) return true

  const status = Number(err.status ?? err.statusCode)
  if (Number.isFinite(status) && status >= 400) return RETRY_STATUS.has(status)

  /* Mã chữ mà không phải mã mạng kiểu Node → lỗi đã được định nghĩa, dừng. */
  if (code) return NODE_NET_CODE.test(code)

  if (err instanceof TypeError) return true
  const name = String(err.name || '')
  if (name === 'TypeError' || name === 'AuthRetryableFetchError' || name === 'TimeoutError') return true

  /* fetch ném TypeError ở Safari/Chrome, nhưng vài đường (polyfill, Node 18,
     supabase-js bọc lại thành { message }) ném Error thường mang đúng câu đó.
     Safari nói "Load failed", Firefox nói "NetworkError", Chrome nói
     "Failed to fetch" — cả ba đều là cùng một lần mạng chập chờn. */
  return /fetch|network|timed?\s?out|socket|dns|connection|load failed/i.test(
    `${err.message || ''} ${err.hint || ''}`)
}

/* supabase-js KHÔNG ném lỗi mạng: nó trả `{ data: null, error: { message, code } }`
   và nuốt cả AbortError. Không đổi cái đó thành lỗi ném ra thì `withRetry`
   tưởng là thành công và trả về một bảng trống. */
export function coerceSupabaseError(error) {
  if (!error || error instanceof Error) return error
  const message = String(error.message || error.hint || 'request failed')
  const err = new Error(message)
  err.code = typeof error.code === 'string' ? error.code : ''
  if (error.status) err.status = error.status
  if (error.hint) err.hint = error.hint
  if (/TypeError|Failed to fetch|NetworkError|Load failed/i.test(message)) err.name = 'TypeError'
  return err
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const t = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' })) }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

const timeoutError = (cause) => Object.assign(new Error('timed out'), {
  name: 'TimeoutError', code: 'ETIMEDOUT', cause,
})

/* `{ error }` của supabase mà là lỗi nhất thời thì ném ra, để vòng thử lại
   bên dưới bắt được. Lỗi có nghĩa (PGRST205, 403…) giữ nguyên để chỗ gọi
   tự xử lý — thử lại cũng chẳng đổi kết quả. */
function lift(result, timedOut) {
  if (!result || typeof result !== 'object' || !('error' in result) || !result.error) return result
  if (timedOut) throw timeoutError(result.error)
  const err = coerceSupabaseError(result.error)
  if (isTransientError(err)) throw err
  return result
}

async function invoke(run, attempt, { timeout, signal }) {
  if (!timeout) return lift(await run(attempt, signal), false)
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort(timeoutError())
  }, timeout)
  const onParentAbort = () => ac.abort(signal.reason)
  if (signal?.aborted) ac.abort(signal.reason)
  else signal?.addEventListener?.('abort', onParentAbort, { once: true })
  try {
    return lift(await run(attempt, ac.signal), timedOut)
  } catch (err) {
    if (signal?.aborted) throw err
    if (timedOut || err?.name === 'TimeoutError' || err?.code === 'ETIMEDOUT') throw timeoutError(err)
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onParentAbort)
  }
}

/**
 * Chạy `run` và thử lại khi nó ném lỗi nhất thời — hoặc khi nó trả về
 * `{ error }` kiểu supabase-js (thư viện này nuốt lỗi mạng, không ném).
 *
 * `run(attempt, signal)` nhận số thứ tự lần thử (0 = lần đầu) và một
 * AbortSignal. Có `timeout` thì signal đó bị abort khi hết giờ, để request
 * TREO không giữ trang ở trạng thái "đang tải" mãi.
 * Trả về đúng giá trị của `run`; ném lỗi CUỐI CÙNG nếu hết lượt.
 */
export async function withRetry(run, options = {}) {
  const { tries, base, factor, max, jitter, signal, timeout, shouldRetry, onRetry } =
    { ...RETRY_DEFAULTS, ...options }
  const retry = shouldRetry || isTransientError
  let attempt = 0
  for (;;) {
    try {
      return await invoke(run, attempt, { timeout, signal })
    } catch (err) {
      attempt += 1
      if (signal?.aborted || attempt >= tries || !retry(err)) throw err
      const wait = Math.min(max, base * factor ** (attempt - 1))
      const delay = wait + Math.round(wait * jitter * Math.random())
      try { onRetry?.({ attempt, delay, error: err }) } catch { /* chỗ gọi lỗi thì không được làm hỏng việc thử lại */ }
      await sleep(delay, signal)
    }
  }
}
