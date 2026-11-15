import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanContent, PAYMENT, paypalPayload, vietQRPayload } from './payment.js'
import { canonicalReference, normalizeReference, orderReference, orderTransferContent, reconcileOrder } from './requestPayment.js'

/* Đọc TLV thật, không tìm chuỗi con trong cả payload: mã phải nằm ĐÚNG trường
   nội dung chuyển khoản 62/08 mà app ngân hàng điền vào, không chỉ tình cờ xuất
   hiện ở một trường khác. Trả lại nguyên văn, không dùng normalize để chấm bài. */
function fields(text) {
  const result = new Map()
  let at = 0
  while (at < text.length) {
    const id = text.slice(at, at + 2)
    const length = Number(text.slice(at + 2, at + 4))
    assert.match(id, /^\d{2}$/)
    assert.ok(Number.isInteger(length) && length > 0 && length <= 99)
    assert.equal(result.has(id), false, `trường ${id} bị lặp`)
    const value = text.slice(at + 4, at + 4 + length)
    assert.equal(value.length, length, `độ dài trường ${id} không khớp`)
    result.set(id, value)
    at += 4 + length
  }
  assert.equal(at, text.length)
  return result
}
function crc16(text) {
  let crc = 0xffff
  for (const byte of Buffer.from(text, 'ascii')) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}
const order = { id: 'dceafd94-8ce3-40e1-b6b2-e37dede3a064', kind: 'paid_request', amount_vnd: 20000, amount_usd: 0.75 }
const canonical = 'PR-DCEAFD948CE340E1B6B2E37DEDE3A064'
const reference = 'PR-3Or9lIzjQOG2suN97eOgZA'

test('mã chuyển khoản giữ nguyên gạch nối và toàn bộ 128 bit UUID trong 25 ký tự', () => {
  assert.equal(orderReference(order), canonical)
  assert.equal(orderTransferContent(order), reference)
  assert.equal(cleanContent(` ${reference} `), reference)
  assert.equal(cleanContent(reference).length, 25)
  assert.equal(normalizeReference(reference), normalizeReference(canonical))
  assert.equal(cleanContent('Đặng Thanh--toán 01'), 'Dang Thanh--toan 01')
  assert.equal(cleanContent(null), '')
  /* base64url có thể chứa `_`; xoá nó là QR lệch nút Copy và app bank điền thiếu. */
  const underscore = { id: 'cfcd2084-95d5-65ef-66e7-dff9f98764da', kind: 'paid_request' }
  const compact = orderTransferContent(underscore)
  assert.equal(compact, 'PR-z80ghJXVZe9m59_5-Ydk2g')
  assert.equal(cleanContent(compact), compact)
  assert.equal(compact.length, 25)
})

test('QR của đơn trong ảnh: đúng người nhận, 20.000 VND và mã chuyển khoản nguyên văn tại 62/08', () => {
  const payload = vietQRPayload(order.amount_vnd, orderTransferContent(order))
  const root = fields(payload)
  assert.equal(root.get('00'), '01')
  assert.equal(root.get('01'), '12', 'QR có số tiền phải là dynamic')
  assert.equal(root.get('53'), '704')
  assert.equal(root.get('54'), '20000')
  assert.equal(root.get('58'), 'VN')
  const merchant = fields(root.get('38'))
  assert.equal(merchant.get('00'), 'A000000727')
  const beneficiary = fields(merchant.get('01'))
  assert.equal(beneficiary.get('00'), PAYMENT.bank.bin)
  assert.equal(beneficiary.get('01'), PAYMENT.bank.accountNumber)
  assert.equal(merchant.get('02'), 'QRIBFTTA')
  assert.equal(fields(root.get('62')).get('08'), reference)
  assert.equal(root.get('63'), crc16(payload.slice(0, -4)))
  /* CRC-16/CCITT-FALSE: chuỗi chuẩn là phép thử độc lập của vòng lặp CRC.
     Không đòi residue bằng 0 — đó là tính chất của họ CRC khác. */
  assert.equal(crc16('123456789'), '29B1')
})

test('QR không có số tiền vẫn là static; tên người mua không bị đổi dấu gạch', () => {
  const root = fields(vietQRPayload(0, 'Nguyễn Văn-A'))
  assert.equal(root.get('01'), '11')
  assert.equal(root.has('54'), false)
  assert.equal(fields(root.get('62')).get('08'), 'Nguyen Van-A')
  const empty = fields(vietQRPayload())
  assert.equal(empty.has('62'), false)
  assert.equal(empty.get('63'), crc16(vietQRPayload().slice(0, -4)))
})

test('nội dung ngân hàng có/không gạch nối vẫn đối soát được đơn cũ, không nhận thiếu mã', () => {
  assert.equal(normalizeReference(canonical), normalizeReference(canonical.replace('-', '')))
  assert.equal(normalizeReference(reference), normalizeReference(canonical))
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 20000, reference }).ok, true)
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 20000, reference: canonical.replace('-', '').toLowerCase() }).ok, true)
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 20000, reference: reference.slice(0, -1) }).ok, false)
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 19999, reference }).ok, false)
  /* Vài app tự viết hoa nội dung: vẫn nhận đúng đơn này và lưu mã canonical. */
  const upper = reference.toUpperCase()
  assert.equal(reconcileOrder(order, { method: 'bank', amount: 20000, reference: upper }).ok, true)
  assert.equal(canonicalReference(order, upper), normalizeReference(canonical))
  assert.equal(reconcileOrder({ ...order, id: '00000000-0000-0000-0000-000000000000' }, { method: 'bank', amount: 20000, reference: upper }).ok, false)
  const votes = { ...order, kind: 'votes' }
  assert.equal(fields(fields(vietQRPayload(20000, orderTransferContent(votes))).get('62')).get('08'), orderTransferContent(votes))
  assert.equal(reconcileOrder(votes, { method: 'bank', amount: 20000, reference: orderTransferContent(votes) }).ok, true)
})

test('PayPal giữ số USD trong link nhưng không giả vờ mang mã trong QR', () => {
  assert.equal(paypalPayload(0.75), `https://paypal.me/${PAYMENT.paypal.username}/0.75USD`)
  assert.equal(paypalPayload(0), `https://paypal.me/${PAYMENT.paypal.username}`)
  assert.equal(paypalPayload(0.75).includes(reference), false)
})
