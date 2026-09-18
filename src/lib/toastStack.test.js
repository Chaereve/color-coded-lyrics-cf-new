/* Kiem thu gộp/chồng toast — chay bang `npm test`. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeToast, TOAST_CAP } from './toastStack.js'

const t_ = (id, over = {}) => ({ id, tone: 'ok', title: 'Progress', body: 'Whiplash — aespa', ms: 8000, repeat: 1, out: false, ...over })

test('cung van ban thi gộp vao mẩu dang hien, khong moc them o', () => {
  const out = mergeToast([t_(2), t_(1)], t_(3, { id: 3 }))
  assert.equal(out.length, 2, 'chi mot mau duoc lam moi, khong them mau moi')
  assert.equal(out[0].id, 2, 'giu nguyen vi tri + id de khong nhay thu tu')
  assert.equal(out[0].repeat, 2)
  assert.equal(out[1].id, 1, 'mau khac van du giu lai')
})

test('gộp lien tiep van chi mot o, bo dem tang dan', () => {
  let list = []
  for (const id of [1, 2, 3, 4]) list = mergeToast(list, t_(id))
  assert.equal(list.length, 1)
  assert.equal(list[0].repeat, 4)
  assert.equal(list[0].id, 1)
})

test('mau dang chay animation .out khong bi gộp vao', () => {
  const out = mergeToast([t_(9, { out: true })], t_(10))
  assert.deepEqual(out.map(n => n.id), [10, 9], 'mau moi phai hien day du, mau cu sap mat')
  assert.equal(out[1].repeat, 1, 'mau cu gi nguyen bo dem cua no')
})

test('khac noi dung thi khong gộp', () => {
  const out = mergeToast([t_(1, { body: 'Whiplash — aespa' })], t_(2, { body: 'Drama — aespa' }))
  assert.deepEqual(out.map(n => n.id), [2, 1])
})

test('chong bi cat theo TOAST_CAP, roi mau cu nhat', () => {
  let list = []
  for (const [i, body] of ['a', 'b', 'c', 'd', 'e'].entries()) {
    list = mergeToast(list, t_(i + 1, { body }))
  }
  assert.equal(list.length, TOAST_CAP)
  assert.deepEqual(list.map(n => n.body), ['e', 'd', 'c'])
})

test('lam lai mẩu cung doi gio va hanh dong theo mau moi', () => {
  const old = t_(1, { ms: 8000, action: { label: 'Open', onClick() {} } })
  const out = mergeToast([old], t_(2, { ms: 4400, action: null }))
  assert.equal(out[0].ms, 4400)
  assert.equal(out[0].action, old.action, 'action null thi giu cua cu, mat het nut bam')
})

test('thieu item thi tra nguyen danh sach', () => {
  const list = [t_(1)]
  assert.equal(mergeToast(list, null), list)
  assert.deepEqual(mergeToast(undefined, t_(1)).map(n => n.id), [1])
})
