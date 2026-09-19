/* Đường lùi của clipboard: máy không có `navigator.clipboard` (không HTTPS,
   webview cũ) thì nút sao chép vẫn phải làm được việc. Đây là thứ dễ bị xoá
   nhầm vì trên máy dev lúc nào cũng có API đó. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyText } from './clipboard.js'

/* Node 22 khai `navigator` là accessor chỉ-đọc trên globalThis nên không gán
   trực tiếp được: phải đè bằng descriptor, và trả lại nguyên trạng sau mỗi ca
   để ca sau không thừa hưởng `navigator` của ca trước. */
const NAV = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const setNav = (v) => Object.defineProperty(globalThis, 'navigator',
  { value: v, configurable: true, writable: true })
const resetNav = () => {
  if (NAV) Object.defineProperty(globalThis, 'navigator', NAV)
  else delete globalThis.navigator
}

const fakeDoc = (copied = 'ok') => {
  const el = {
    value: '', style: { cssText: '' },
    setAttribute() {}, select() {}, remove() {},
  }
  return {
    el,
    body: { appendChild() {} },
    createElement: () => el,
    execCommand: () => copied === 'ok',
  }
}

test('copyText: dùng navigator.clipboard khi có', async () => {
  const wrote = []
  setNav({ clipboard: { writeText: async (t) => wrote.push(t) } })
  assert.equal(await copyText('xin chào', fakeDoc()), true)
  assert.deepEqual(wrote, ['xin chào'])
  resetNav()
})

test('copyText: clipboard lỗi (không HTTPS) thì rơi xuống execCommand', async () => {
  setNav({ clipboard: { writeText: async () => { throw new Error('denied') } } })
  const doc = fakeDoc('ok')
  assert.equal(await copyText('abc', doc), true)
  assert.equal(doc.el.value, 'abc')
  resetNav()
})

test('copyText: không có gì dùng được thì trả false, không ném lỗi', async () => {
  setNav(undefined)
  assert.equal(await copyText('abc', null), false)
  assert.equal(await copyText('abc', fakeDoc('fail')), false)
  resetNav()
})
