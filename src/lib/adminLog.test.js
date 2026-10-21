/* Cách đọc một dòng nhật ký quản trị.
   Điều phải chốt: một lần bấm đổi nhiều trường thì câu kể phải nêu VIỆC CHÍNH
   (duyệt, không phải "sửa"), và trường lạ không được hiện ra dưới dạng
   `undefined` hay một mã thô.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_LABEL, FIELD_LABEL, actionKind, changedFields, describeAction, shortValue } from './adminLog.js'

const translate = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key)
const t = (k) => translate(k)

test('mỗi việc và mỗi trường đều có nhãn — không có mã thô nào lọt ra màn hình', () => {
  for (const [k, key] of Object.entries(ACTION_LABEL)) assert.match(key, /^adm\.log\./, k)
  for (const [k, key] of Object.entries(FIELD_LABEL)) assert.match(key, /^adm\.log\.f\./, k)
})

test('detail dạng cặp [cũ, mới] và dạng {from,to} đọc như nhau', () => {
  assert.deepEqual(changedFields({ status: ['pending', 'queued'] }),
    [{ key: 'status', fieldKey: 'adm.log.f.status', from: 'pending', to: 'queued' }])
  assert.deepEqual(changedFields({ note: { from: 'a', to: 'b' } }),
    [{ key: 'note', fieldKey: 'adm.log.f.note', from: 'a', to: 'b' }])
  /* trường không có nhãn: bỏ, không hiện "undefined" */
  assert.deepEqual(changedFields({ bí_mật: ['x', 'y'] }), [])
  assert.deepEqual(changedFields(null), [])
  assert.deepEqual(changedFields('rác'), [])
})

test('việc chính: duyệt thắng "sửa", xoá thắng tất cả', () => {
  assert.equal(actionKind({ action: 'approve' }), 'approve')
  assert.equal(actionKind({ action: 'delete' }), 'delete')
  /* action lạ/rỗng thì suy từ detail thay vì in mã thô */
  assert.equal(actionKind({ action: '', detail: { status: ['pending', 'queued'] } }), 'approve')
  assert.equal(actionKind({ action: '???', detail: { status: ['pending', 'denied'] } }), 'deny')
  assert.equal(actionKind({ action: null, detail: { status: ['queued', 'completed'] } }), 'complete')
  assert.equal(actionKind({ action: null, detail: { title: ['a', 'b'] } }), 'rename')
  assert.equal(actionKind({ action: null, detail: {} }), 'edit')
})

test('một dòng đã sẵn sàng để vẽ, kể cả khi request đã bị xoá', () => {
  const d = describeAction({
    id: 7, action: 'approve', label: 'aespa — Whiplash', actor_name: 'Chung Hạ',
    created_at: '2026-10-20T00:00:00.000Z', target_id: 't1',
    detail: { status: ['pending', 'queued'], picked_at: [null, '2026-10-20'] },
  })
  assert.equal(d.kind, 'approve')
  assert.equal(d.labelKey, 'adm.log.approve')
  assert.equal(d.subject, 'aespa — Whiplash', 'tên bài là ảnh chụp lúc thao tác, không đọc lại từ requests')
  assert.equal(d.actor, 'Chung Hạ')
  assert.deepEqual(d.fields.map(f => f.key), ['status', 'picked_at'])
  /* thiếu người thao tác: hiện "Admin" thay vì một khoảng trắng */
  assert.equal(describeAction({ action: 'deny' }).actor, 'Admin')
})

test('giá trị hiện ra ngắn gọn: null, boolean, chuỗi dài', () => {
  assert.equal(shortValue(null, t), '—')
  assert.equal(shortValue('', t), '—')
  assert.equal(shortValue(true, t), 'adm.log.on')
  assert.equal(shortValue(false, t), 'adm.log.off')
  assert.equal(shortValue('pending', t), 'pending')
  const long = 'https://www.youtube.com/watch?v=abcdefghijklmnopqrstuvwxyz'
  assert.ok(shortValue(long, t).length <= 31, 'link dài phải bị cắt')
  assert.ok(shortValue(long, t).endsWith('…'))
})
