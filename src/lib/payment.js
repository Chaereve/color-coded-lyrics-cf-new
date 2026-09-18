/* =========================================================
   CẤU HÌNH THANH TOÁN  —  SỬA THÔNG TIN CỦA BẠN Ở ĐÂY
   =========================================================
   Sau khi sửa, QR sẽ tự sinh lại, không cần làm gì thêm.
   ========================================================= */

/* Kenh lien he ho tro / hoan tien */
export const SUPPORT = {
  telegram: 'ssochuz',
  telegramUrl: 'https://t.me/ssochuz',
}

export const PAYMENT = {
  /* --- 1. Chuyển khoản ngân hàng (QR chuẩn VietQR, quét bằng mọi app ngân hàng) --- */
  bank: {
    bin: '970436',                    // Vietcombank — xem bảng mã BIN bên dưới
    bankName: 'Vietcombank',
    accountNumber: '1050799733',
    accountName: 'NGO THUY KIM THU',  // in hoa, không dấu
  },

  /* --- 2. PayPal --- */
  paypal: {
    username: 'Somnial06',            // paypal.me/<username>
    email: 'kimtong1906@gmail.com',
  },
}

/* Mã BIN một số ngân hàng phổ biến:
   Vietcombank 970436 · Techcombank 970407 · MB Bank 970422 · ACB 970416
   VPBank 970432 · BIDV 970418 · VietinBank 970415 · Agribank 970405
   TPBank 970423 · Sacombank 970403 · VIB 970441 · HDBank 970437
   Cake 546034 · Timo 963388 · MSB 970426 · OCB 970448
   Danh sách đầy đủ: https://api.vietqr.io/v2/banks
*/

/* ---------------------------------------------------------
   Sinh chuỗi VietQR (chuẩn EMVCo) — quét được bằng app ngân hàng
   --------------------------------------------------------- */
const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value

function crc16(str) {
  let crc = 0xFFFF
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Bỏ dấu tiếng Việt, chỉ giữ ký tự hợp lệ cho nội dung chuyển khoản */
export const cleanContent = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 40)

/**
 * @param {number} amount  số tiền VND (0 = QR không kèm số tiền)
 * @param {string} content nội dung chuyển khoản
 */
export function vietQRPayload(amount = 0, content = '') {
  const { bin, accountNumber } = PAYMENT.bank

  const merchant = tlv('00', 'A000000727')
    + tlv('01', tlv('00', bin) + tlv('01', accountNumber))
    + tlv('02', 'QRIBFTTA')

  let payload =
      tlv('00', '01')
    + tlv('01', amount > 0 ? '12' : '11')
    + tlv('38', merchant)
    + tlv('53', '704')
    + (amount > 0 ? tlv('54', String(Math.round(amount))) : '')
    + tlv('58', 'VN')

  const desc = cleanContent(content)
  if (desc) payload += tlv('62', tlv('08', desc))

  payload += '6304'
  return payload + crc16(payload)
}

/** Nội dung QR cho PayPal */
export function paypalPayload(usd = 0) {
  const base = `https://paypal.me/${PAYMENT.paypal.username}`
  return usd > 0 ? `${base}/${usd.toFixed(2)}USD` : base
}
