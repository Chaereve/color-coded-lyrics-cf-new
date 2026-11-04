import test from 'node:test'
import assert from 'node:assert/strict'
import { hasOwnPolyfill, atPolyfill, randomUUIDPolyfill } from './polyfills.js'

/* Node 22 đã có sẵn Object.hasOwn / Array.at / crypto.randomUUID, nên
   import polyfills.js ở trên KHÔNG ghi đè gì (các nhánh `if (!...)` đều
   false). Vì vậy kiểm thẳng ba hàm cài đặt bằng cách gọi chúng, chứ không
   kiểm "máy thiếu thì sao" — muốn mô phỏng máy thiếu phải xoá API toàn
   cục, ảnh hưởng bài test khác. Logic của polyfill mới là thứ cần chốt. */

test('hasOwnPolyfill: phân biệt khoá riêng và khoá thừa kế', () => {
  const obj = { a: 1 }
  assert.equal(hasOwnPolyfill(obj, 'a'), true)
  assert.equal(hasOwnPolyfill(obj, 'toString'), false)   // thừa kế từ prototype
  assert.equal(hasOwnPolyfill(obj, 'missing'), false)
})

test('hasOwnPolyfill: an toàn với object không có prototype', () => {
  const bare = Object.create(null)
  bare.x = 5
  assert.equal(hasOwnPolyfill(bare, 'x'), true)
  assert.equal(hasOwnPolyfill(bare, 'toString'), false)
})

test('atPolyfill: chỉ số dương, âm và ngoài khoảng trên mảng', () => {
  const arr = ['a', 'b', 'c']
  assert.equal(atPolyfill.call(arr, 0), 'a')
  assert.equal(atPolyfill.call(arr, 2), 'c')
  assert.equal(atPolyfill.call(arr, -1), 'c')           // đếm từ cuối
  assert.equal(atPolyfill.call(arr, -3), 'a')
  assert.equal(atPolyfill.call(arr, 3), undefined)      // ngoài khoảng
  assert.equal(atPolyfill.call(arr, -4), undefined)
})

test('atPolyfill: chỉ số thập phân bị cắt (Math.trunc), undefined về 0', () => {
  const arr = ['a', 'b', 'c']
  assert.equal(atPolyfill.call(arr, 1.9), 'b')
  assert.equal(atPolyfill.call(arr, -1.9), 'c')
  assert.equal(atPolyfill.call(arr, undefined), 'a')
  assert.equal(atPolyfill.call([], 0), undefined)
})

test('atPolyfill: array-like có length âm/NaN bị kẹp về 0 như spec', () => {
  assert.equal(atPolyfill.call({ 0: 'a', length: -3 }, 0), undefined)
  assert.equal(atPolyfill.call({ 0: 'a', length: NaN }, 0), undefined)
})

test('atPolyfill: dùng được cho chuỗi (cùng một hàm array-like)', () => {
  assert.equal(atPolyfill.call('abc', -1), 'c')
  assert.equal(atPolyfill.call('abc', 1), 'b')
  assert.equal(atPolyfill.call('abc', 9), undefined)
})

test('randomUUIDPolyfill: đúng định dạng 8-4-4-4-12 và bit version/variant', () => {
  const uuid = randomUUIDPolyfill()
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('randomUUIDPolyfill: các lần gọi không trùng nhau', () => {
  const seen = new Set(Array.from({ length: 200 }, () => randomUUIDPolyfill()))
  assert.equal(seen.size, 200)
})

test('import polyfills.js không ghi đè API gốc của môi trường đã có', () => {
  /* Node có sẵn cả ba — sau khi import, chúng vẫn phải là bản gốc
     (polyfill chỉ định nghĩa khi thiếu). Đây là lời hứa "máy mới không
     bị thay bằng bản chậm hơn". */
  assert.equal(typeof Object.hasOwn, 'function')
  assert.equal(typeof Array.prototype.at, 'function')
  assert.equal(typeof globalThis.crypto.randomUUID, 'function')
  // bản gốc của Node vẫn hoạt động đúng
  assert.equal([1, 2, 3].at(-1), 3)
  assert.equal(Object.hasOwn({ k: 1 }, 'k'), true)
})
