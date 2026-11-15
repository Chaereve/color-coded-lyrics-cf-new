/* Chốt chặn hàng ĐƠN trong About me (My orders).
   ---------------------------------------------------------
   Ảnh production 2026-11-15: tiêu đề + số tiền của đơn xếp dọc từng ký tự ở mép
   trái, phần còn lại của hàng trống. Nguyên nhân: `.order-payment-details` là
   con trực tiếp của `.row` (flex, KHÔNG wrap) và có flex-basis:100%; nó hút gần
   hết bề ngang, còn `.body` với min-width:0 bị ép về gần 0. Khung thanh toán phải
   xuống DÒNG RIÊNG, và chỉ hàng đơn mới được wrap — hàng request vẫn giữ cột
   phiếu bên phải. browserSmoke.mjs đo thêm bằng Chromium trên dist demo. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = at('../index.css').replace(/\/\*[\s\S]*?\*\//g, '')
const app = at('../App.jsx')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, ' '), body }))
const bodies = sel => rules.filter(r => r.sel.split(',').map(s => s.trim()).includes(sel)).map(r => r.body)

test('hàng đơn About me có lớp riêng và khung thanh toán nằm trong hàng đó', () => {
  assert.match(app, /className="row order-row" key=\{o\.id\}/,
    'hàng đơn phải mang .order-row để không sửa nhầm hàng request của bảng')
  const start = app.indexOf('id={`mine-order-${o.id}`}')
  const end = app.indexOf('\n            ))}', start)
  const row = app.slice(start, end > start ? end : start + 3000)
  assert.match(row, /<OrderPayment order=\{o\} \/>/,
    'khung thanh toán vẫn là con trực tiếp của hàng đơn, không dời sang modal khác')
  const payment = at('../components/OrderPayment.jsx')
  assert.match(payment, /<details className="order-payment-details"/,
    'giữ nút mở gốc bằng details/summary để dùng được bàn phím')
  assert.match(row, /!\(o\.kind === 'paid_request' && orderDisplayStatus\(o\) === 'awaiting'\)/,
    'đơn đang chờ chỉ in mã trong OrderPayment, không lặp ở metadata phía trên')
})

test('hàng đơn wrap để khối chữ không bị khung thanh toán ép về gần 0', () => {
  const row = bodies('.row.order-row').join(';')
  assert.match(row, /flex-wrap:\s*wrap/,
    'thiếu wrap thì flex-basis:100% của details lại ép .body thành cột chữ dọc')
  const details = bodies('.order-payment-details').join(';')
  assert.match(details, /flex:\s*0 0 100%|flex-basis:\s*100%/,
    'khung thanh toán phải chiếm trọn một dòng riêng')
  assert.match(details, /min-width:\s*0/,
    'khung thanh toán phải co được trong hàng, không đẩy tràn ngang')
  assert.doesNotMatch(bodies('.row').join(';'), /flex-wrap:\s*wrap/,
    'không wrap mọi .row: hàng request vẫn là một dòng có cột phiếu bên phải')
})
