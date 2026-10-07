/* ĐUA NHAU GIỮA HAI LƯỢT NẠP — lượt cũ về sau không được ghi đè lượt mới.
   ---------------------------------------------------------
   Lỗi có thật trong `App.jsx`: `setRows`/`setMyVotes` (và ranking/đơn hàng/
   dấu ngày) được ghi thẳng, không ai kiểm lượt nào mới hơn. Một sự kiện realtime
   mở lượt nạp thứ hai trong khi lượt đầu còn đang bay; trên mạng chậm, LƯỢT ĐẦU
   (dữ liệu cũ hơn) trả về SAU và ghi đè — người dùng vừa bỏ một phiếu, bảng vừa
   nhảy lên, rồi tự nhảy về như trước, không có gì giải thích.

   Bài này dựng ĐÚNG thứ tự đó bằng hai promise mở khoá bằng tay (chậm/mau), chứ
   không chỉ kiểm phép so sánh: điều cần chứng minh là "về sau" không thắng.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTicket, stillLatest } from './latestOnly.js'

/* Một promise mở khoá từ bên ngoài — dùng để điều khiển thứ tự trả về. */
const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

/* Mô phỏng đúng cách `App.jsx` dùng: mỗi lượt xin một số, và chỉ ghi khi số đó
   còn là mới nhất. */
const makeLoader = () => {
  const seq = { current: 0 }
  const rows = { value: null, writes: 0 }
  return {
    seq, rows,
    load (source) {
      const ticket = nextTicket(seq)
      return source.then((value) => {
        if (!stillLatest(seq, ticket)) return false
        rows.value = value; rows.writes++
        return true
      })
    },
  }
}

test('lượt nạp cũ trả về SAU lượt mới không được ghi vào state', async () => {
  const L = makeLoader()
  const slow = deferred()
  const fast = deferred()

  const p1 = L.load(slow.promise)      // lượt 1 (dữ liệu cũ) — còn đang bay
  const p2 = L.load(fast.promise)      // lượt 2 (realtime) mở sau đó

  fast.resolve(['mới'])                // lượt 2 về trước
  assert.equal(await p2, true, 'lượt mới nhất phải được ghi')
  assert.deepEqual(L.rows.value, ['mới'])

  slow.resolve(['cũ'])                 // lượt 1 về SAU — đúng ca lỗi
  assert.equal(await p1, false, 'lượt cũ không được ghi')
  assert.deepEqual(L.rows.value, ['mới'], 'lượt cũ đã ghi đè số liệu mới')
  assert.equal(L.rows.writes, 1, 'chỉ đúng một lần ghi')

  /* Và lượt mới NHẤT vẫn ghi được bình thường — chốt chặn không được thành
     chặn hết. */
  const p3 = L.load(Promise.resolve(['mới nhất']))
  assert.equal(await p3, true)
  assert.deepEqual(L.rows.value, ['mới nhất'])
  assert.equal(L.rows.writes, 2)
})

test('lượt mới nhất HỎNG thì giữ nguyên dữ liệu cũ, không nhận lượt cũ về sau', async () => {
  const L = makeLoader()
  const slow = deferred()
  const fast = deferred()

  const p1 = L.load(slow.promise)
  const p2 = L.load(fast.promise)
  fast.resolve(['mới']); await p2
  slow.resolve(['cũ']); await p1
  assert.deepEqual(L.rows.value, ['mới'], 'lượt cũ vẫn chen được vào')
  /* Bây giờ lượt mới nhất ném lỗi: state phải GIỮ NGUYÊN thứ đang hiển thị
     (không có lượt cũ nào quay lại lấp vào chỗ trống). */
  const bad = L.load(Promise.reject(new Error('mạng hỏng')).catch(() => { throw new Error('mạng hỏng') }))
  await assert.rejects(bad)
  assert.deepEqual(L.rows.value, ['mới'], 'lỗi của lượt mới nhất làm mất dữ liệu đang xem')
})
