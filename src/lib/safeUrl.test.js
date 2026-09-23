import test from 'node:test'
import assert from 'node:assert/strict'
import { safeHttpUrl } from './safeUrl.js'

test('chỉ http(s) được thành link bấm được', () => {
  assert.equal(safeHttpUrl('https://youtu.be/abc'), 'https://youtu.be/abc')
  assert.equal(safeHttpUrl('http://example.com/watch?v=1'), 'http://example.com/watch?v=1')
  assert.equal(safeHttpUrl('javascript:void(0)'), null)
  assert.equal(safeHttpUrl('data:text/html,hi'), null)
  assert.equal(safeHttpUrl('https://user:pass@evil.example'), null)
  assert.equal(safeHttpUrl(''), null)
  assert.equal(safeHttpUrl(null), null)
  assert.equal(safeHttpUrl('không-phải-link'), null)
})
