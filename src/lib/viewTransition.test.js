/* Cửa duy nhất cho chuyển cảnh giữa hai mục.
   ---------------------------------------------------------
   Chủ dự án báo "chồng trang" kèm ảnh chụp. View Transitions là thứ duy nhất
   trong app vẽ ẢNH CHỤP của trang cũ lên trên trang mới, nên nó là chỗ phải
   soi trước tiên — và soi bằng cách chạy thật ba tình huống không thể dựng
   được trong trình duyệt một cách chủ động:

     · hai cú bấm liên tiếp (mở chuyến thứ hai khi chuyến thứ nhất còn bay →
       ảnh chụp dính luôn cả ảnh của chuyến trước = nhiều lớp trang);
     · API có nhưng chết giữa chừng;
     · chuyến bị bỏ (skipTransition) → phải nhả cờ, kẻo từ đó hết chuyển cảnh
       mà không ai biết vì sao.

   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSectionTransition } from './viewTransition.js'

/** Một `document` giả: chỉ có `documentElement.dataset` và API chuyển cảnh. */
function fakeDoc({ throwOnStart = false } = {}) {
  const dataset = {}
  const calls = { starts: 0, changes: 0 }
  let release = () => {}
  const finished = new Promise((resolve, reject) => { release = { resolve, reject } })
  const doc = {
    dataset,
    documentElement: { dataset },
    startViewTransition(change) {
      calls.starts += 1
      if (throwOnStart) throw new Error('API chết')
      /* Trình duyệt gọi callback ở nhịp sau, KHÔNG ngay trong lời gọi này. */
      queueMicrotask(() => { calls.changes += 1; change() })
      return { finished }
    },
  }
  return { doc, calls, finish: (err) => (err ? release.reject(err) : release.resolve()), finished }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

test('không có API (jsdom, Firefox cũ): đổi thẳng, không đụng data-nav', async () => {
  const run = createSectionTransition({ doc: { documentElement: { dataset: {} } } })
  let done = 0
  assert.equal(run('fwd', () => { done++ }), null)
  assert.equal(done, 1)
})

test('người dùng xin giảm chuyển động: đổi thẳng', () => {
  const { doc, calls } = fakeDoc()
  const run = createSectionTransition({ doc, reduced: () => true })
  let done = 0
  assert.equal(run('fwd', () => { done++ }), null)
  assert.equal(calls.starts, 0, 'xin giảm chuyển động thì không được mở chuyến nào')
  assert.equal(done, 1)
})

test('có API: mở đúng MỘT chuyến, đặt hướng đi, rồi dọn sạch khi xong', async () => {
  const { doc, calls, finish } = fakeDoc()
  const run = createSectionTransition({ doc })
  let done = 0
  const t = run('back', () => { done++ })

  assert.ok(t, 'phải trả về chuyến chuyển cảnh')
  assert.equal(doc.documentElement.dataset.nav, 'back', 'hướng đi cho CSS')
  await flush()
  assert.equal(done, 1, 'callback của trình duyệt là chỗ đổi mục')

  finish()
  await flush()
  assert.equal('nav' in doc.documentElement.dataset, false,
    'xong rồi mà còn data-nav là dạy sai hướng cho chuyến sau')

  /* Đã dọn thì chuyến sau phải mở được — cờ "đang bay" không được kẹt. */
  run('fwd', () => {})
  assert.equal(calls.starts, 2)
})

test('hướng đi lạ thì mặc định là fwd, và bỏ chuyến (reject) vẫn phải dọn', async () => {
  const { doc, calls, finish } = fakeDoc()
  const run = createSectionTransition({ doc })
  run(undefined, () => {})
  assert.equal(doc.documentElement.dataset.nav, 'fwd')

  finish(new Error('skipped'))
  await flush()
  assert.equal('nav' in doc.documentElement.dataset, false, 'chuyến bị bỏ cũng phải dọn')
  run('fwd', () => {})
  assert.equal(calls.starts, 2, 'bỏ chuyến không được làm kẹt cờ')
})

test('ĐANG có chuyến bay: KHÔNG mở chuyến thứ hai, nhưng vẫn phải đổi mục', async () => {
  const { doc, calls, finish } = fakeDoc()
  const run = createSectionTransition({ doc })
  let first = 0
  let second = 0
  run('fwd', () => { first++ })
  await flush()
  assert.equal(first, 1)

  run('fwd', () => { second++ })
  assert.equal(second, 1, 'bấm liên tiếp thì lần sau đi thẳng — người dùng vẫn tới nơi')
  assert.equal(calls.starts, 1, 'chuyến thứ hai là ảnh chụp lồng ảnh: đúng thứ làm ra "chồng trang"')
  assert.equal(calls.changes, 1)

  finish()
  await flush()
  run('fwd', () => {})
  assert.equal(calls.starts, 2, 'chuyến trước xong thì chuyển cảnh lại chạy bình thường')
})

test('API có nhưng chết: người dùng vẫn tới nơi, và cờ không kẹt', async () => {
  const { doc, calls } = fakeDoc({ throwOnStart: true })
  const run = createSectionTransition({ doc })
  let done = 0
  assert.equal(run('fwd', () => { done++ }), null)
  assert.equal(done, 1, 'chuyển cảnh hỏng không được làm cú bấm mất tác dụng')
  assert.equal(calls.starts, 1, 'API có thì phải thử gọi nó')
  assert.equal('nav' in doc.documentElement.dataset, false)
  /* Và lần sau vẫn thử được: API "chết" chỉ là chuyện của một lần, nó không
     được để lại cờ "đang bay" — có cờ kẹt là hết chuyển cảnh từ đó. */
  const ok = createSectionTransition({ doc: fakeDoc().doc })
  let later = 0
  ok('fwd', () => { later++ })
  await flush()
  assert.equal(later, 1, 'lần sau vẫn phải mở được chuyến mới (cờ đã được nhả)')
})
