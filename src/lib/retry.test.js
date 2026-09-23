/* Chốt chặn THỬ LẠI KHI LỖI NHẤT THỜI (lib/retry.js)
   ---------------------------------------------------------
   Hai chiều đều phải đúng, và cả hai đều là lỗi đã gặp thật
   ở app này dưới dạng "vào web không thấy dữ liệu, bấm F5
   thì được":

   1. Lỗi mạng / 502 / 429 PHẢI được thử lại — đây là chín
      phần mười các lần nạp đầu hỏng, và thử lại xong là có
      dữ liệu ngay, không cần người dùng làm gì.
   2. Lỗi CÓ NGHĨA (thiếu bảng PGRST205, sai quyền 403,
      dữ liệu không tồn tại) KHÔNG được thử lại — lặp lại
      một lỗi như vậy chỉ bắt người dùng đợi thêm ~1,4 giây
      để nhận đúng một kết quả như cũ.

   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { RETRY_DEFAULTS, isTransientError, sleep, withRetry } from './retry.js'

test('lỗi nhất thời thì thử lại, lỗi có nghĩa thì dừng ngay', () => {
  const net = new TypeError('Failed to fetch')
  const gateway = { message: 'Bad Gateway', status: 502 }
  const tooMany = { message: 'rate limited', status: 429, code: 'PGRST301' }
  const staleJwt = { message: 'JWT expired', code: 'PGRST301' }
  assert.equal(isTransientError(net), true, 'fetch hỏng (TypeError) phải thử lại')
  assert.equal(isTransientError(gateway), true, '502 phải thử lại')
  assert.equal(isTransientError({ message: 'n', status: 503 }), true, '503 phải thử lại')
  assert.equal(isTransientError(tooMany), true, '429 phải thử lại — mã PGRST đi kèm không được che mất trạng thái')
  assert.equal(isTransientError(staleJwt), true, 'JWT hết hạn phải thử lại: supabase-js làm mới token ở dưới')

  /* Có nghĩa: thử lại bao nhiêu lần cũng ra đúng kết quả đó. */
  assert.equal(isTransientError({ message: 'x', code: 'PGRST205' }), false, 'thiếu bảng: dừng')
  assert.equal(isTransientError({ message: 'x', code: 'PGRST202' }), false, 'thiếu hàm: dừng')
  assert.equal(isTransientError({ message: 'x', status: 401 }), false, 'chưa đăng nhập: dừng')
  assert.equal(isTransientError({ message: 'x', status: 403 }), false, 'sai quyền: dừng')
  assert.equal(isTransientError({ message: 'x', status: 404 }), false, 'không có: dừng')
  assert.equal(isTransientError({ message: 'err.signin', code: 'P0001' }), false, 'lỗi nghiệp vụ do RPC raise: dừng')

  /* Bị huỷ là có chủ ý, không phải lỗi mạng. */
  assert.equal(isTransientError(Object.assign(new Error('x'), { name: 'AbortError' })), false)
  assert.equal(isTransientError(null), false)
  assert.equal(isTransientError(undefined), false)
})

test('thử lại đến khi được, rồi trả đúng giá trị của lần thành công', async () => {
  let calls = 0
  const rows = [{ id: 'a' }]
  const out = await withRetry(async (attempt) => {
    calls += 1
    if (attempt < 2) throw new TypeError('Failed to fetch')
    return rows
  }, { tries: 3, base: 1, factor: 1, max: 2, jitter: 0 })
  assert.equal(calls, 3)
  assert.equal(out, rows)
})

test('hết lượt thì ném lỗi CUỐI CÙNG, không phải lỗi đầu tiên', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls += 1
      throw Object.assign(new Error(`lần ${calls}`), { status: 502 })
    }, { tries: 3, base: 1, factor: 1, max: 2, jitter: 0 }),
    /lần 3/,
    'lỗi ném ra phải là của lần thử cuối — nó là cái mang thông tin mới nhất')
  assert.equal(calls, 3)
})

test('lỗi có nghĩa không tốn thêm một lần gọi nào', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => {
      calls += 1
      throw { message: 'Could not find the table', code: 'PGRST205' }
    }, { tries: 3, base: 1 }),
    (e) => e?.code === 'PGRST205')
  assert.equal(calls, 1, 'thiếu bảng mà cũng thử ba lần là bắt người dùng đợi vô ích')
})

test('bị huỷ thì dừng ngay, không đợi hết lượt', async () => {
  const ac = new AbortController()
  let calls = 0
  const p = withRetry(async () => {
    calls += 1
    ac.abort()
    throw new TypeError('Failed to fetch')
  }, { tries: 5, base: 5, signal: ac.signal })
  await assert.rejects(p, /Failed to fetch/)
  assert.equal(calls, 1)
})

test('ba lần thử nằm trong trần 2,6s của màn chờ', () => {
  const { tries, base, factor, max, jitter } = RETRY_DEFAULTS
  let total = 0
  for (let i = 1; i < tries; i++) {
    const wait = Math.min(max, base * factor ** (i - 1))
    total += wait * (1 + jitter)
  }
  assert.ok(total < 2600,
    `tổng thời gian chờ giữa các lần thử (${Math.round(total)}ms) phải ngắn hơn trần màn chờ 2600ms`)
})

test('sleep nghe lệnh huỷ', async () => {
  const ac = new AbortController()
  const p = sleep(10_000, ac.signal)
  ac.abort()
  await assert.rejects(p)
})

test('supabase nuốt lỗi mạng thành { error } vẫn được thử lại', async () => {
  let calls = 0
  const out = await withRetry(async () => {
    calls += 1
    if (calls < 2) return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
    return { data: [{ id: 'a' }], error: null }
  }, { tries: 3, base: 1, factor: 1, max: 2, jitter: 0 })
  assert.equal(calls, 2)
  assert.equal(out.data[0].id, 'a')
})

test('Safari "Load failed" cũng là lỗi mạng, không phải bảng trống', async () => {
  let calls = 0
  const out = await withRetry(async () => {
    calls += 1
    if (calls < 2) return { data: null, error: { message: 'TypeError: Load failed', code: '' } }
    return { data: [], error: null }
  }, { tries: 3, base: 1, factor: 1, max: 2, jitter: 0 })
  assert.equal(calls, 2)
  assert.deepEqual(out.data, [])
})

test('supabase trả lỗi có nghĩa thì không thử lại, trả nguyên kết quả', async () => {
  let calls = 0
  const out = await withRetry(async () => {
    calls += 1
    return { data: null, error: { message: 'missing', code: 'PGRST205' } }
  }, { tries: 3, base: 1, factor: 1, max: 2, jitter: 0 })
  assert.equal(calls, 1, 'thiếu bảng mà cũng thử ba lần là bắt người dùng đợi vô ích')
  assert.equal(out.error.code, 'PGRST205')
})

test('request treo bị cắt giờ, abort, rồi thử lại', async () => {
  let calls = 0
  const out = await withRetry((attempt, signal) => {
    calls += 1
    if (attempt === 0) {
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          resolve({ data: null, error: { message: 'AbortError: The operation was aborted.', code: '', hint: 'Request was aborted' } })
        })
      })
    }
    return { data: [{ id: 'ok' }], error: null }
  }, { timeout: 30, tries: 3, base: 1, factor: 1, max: 2, jitter: 0 })
  assert.equal(calls, 2)
  assert.equal(out.data[0].id, 'ok')
})
