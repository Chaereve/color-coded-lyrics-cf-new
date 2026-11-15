import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import QRCode from 'qrcode'
import { PAYMENT, vietQRPayload, paypalPayload, cleanContent } from '../lib/payment'
import { vnd, usd } from '../lib/meta'
import { useI18n } from '../lib/i18n.jsx'
import { copyText } from '../lib/clipboard'
import { useTransient } from '../lib/useTransient'
import logoVietQR from '../assets/pay/vietqr.svg'
import logoPaypal from '../assets/pay/paypal.svg'

/* ============ Logo chính chủ của từng cổng thanh toán ============ */
/* Trường `c` (màu nhấn của cổng) đã bỏ: không nơi nào đọc nó, mà bản cũ của
   VietQR lại mượn `--queued` — một token TRẠNG THÁI — để tô một thương hiệu.
   Đó đúng là kiểu rò rỉ khiến đổi bảng màu xong vẫn còn một chỗ xanh lạnh
   không rõ vì sao. Logo là ảnh SVG chính chủ, màu đã nằm trong tệp. */
const METHODS = [
  { k: 'bank',   src: logoVietQR, nameKey: 'pay.bank',   alt: 'VietQR' },
  { k: 'paypal', src: logoPaypal, nameKey: 'pay.paypal', alt: 'PayPal' },
]

/* ---------- QR vẽ bằng canvas, hoạt động offline ---------- */
function QR({ text, color = '#0a0d14' }) {
  const { t } = useI18n()
  const ref = useRef(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!ref.current || !text) return
    setErr(false)
    QRCode.toCanvas(ref.current, text, {
      width: 190, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: color, light: '#ffffff' },
    }).catch(() => setErr(true))
  }, [text, color])
  return (
    <>
      <canvas ref={ref} className="qr-canvas" style={err ? { display: 'none' } : undefined} />
      {err && <div className="qr-fail">{t('pay.qrFail1')}<br />{t('pay.qrFail2')}</div>}
    </>
  )
}

/* ---------- dòng thông tin có nút sao chép ---------- */
function CopyRow({ k, v, mono }) {
  const { t } = useI18n()
  const [done, flashDone] = useTransient()
  const [failed, setFailed] = useState(false)
  const copy = async () => {
    const ok = await copyText(v)
    setFailed(!ok)
    if (ok) flashDone()
  }
  return (
    <div className="iv-row">
      <span className="iv-k">{k}</span>
      <span className={`iv-v${mono ? ' mono' : ''}`}>{v}</span>
      <button type="button" className={`iv-copy${done ? ' done' : ''}`}
        onClick={copy} aria-label={t('pay.copyField', { field: k })} title={done ? t('pay.copied') : t('pay.copy')}>
        <Icon name={done ? 'check' : 'copy'} size={13} />
      </button>
      <span className="sr-only" role="status">{done ? t('pay.copied') : failed ? t('pay.copyFailed') : ''}</span>
      {failed && <small className="iv-copy-failed" role="status">{t('pay.copyFailed')}</small>}
    </div>
  )
}

export default function PaymentMethods({ amountVnd = 0, amountUsd = 0, content = '', awaiting = false, showAmount = true, showReference = true, defaultMethod = null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultMethod)
  const desc = cleanContent(content)
  const active = METHODS.find(m => m.k === open)
  /* Chọn phương thức là có NGAY tờ hóa đơn, không phải một bảng chi tiết rời
     rạc: số tiền là thứ to nhất, mã QR nằm cạnh các dòng cần chép.

     Số tiền do ActionModal quyết định: có đơn đang chờ thì lấy đúng số của đơn
     (`awaiting` → chờ tiền), chưa có đơn thì lấy gói đang chọn (`draft`). Hai
     trạng thái này KHÁC nhau về ý nghĩa nên nhãn cũng khác — không dán chữ
     "Awaiting transfer" lên một tờ giấy chưa có đơn nào. Luồng thanh toán
     (chuyển khoản / PayPal, nội dung, payload QR) không đổi. */
  const isPaypal = active?.k === 'paypal'
  const amount = isPaypal ? amountUsd : amountVnd
  const hasAmount = amount > 0

  return (
    <div className="pay">
      <div className="paygrid">
        {METHODS.map(({ k, src, nameKey, alt }) => (
          <button key={k} type="button"
            className={`paytile ${k}${open === k ? ' on' : ''}`}
            onClick={() => setOpen(o => (o === k ? null : k))}
            aria-pressed={open === k}>
            <span className="paytile-box"><img className="paytile-logo" src={src} alt={alt} /></span>
            <small className="paytile-name">{t(nameKey)}</small>
            {open === k && <span className="paytile-tick" aria-hidden="true"><Icon name="check" size={10} /></span>}
          </button>
        ))}
      </div>

      {active ? (
        <div className="iv" key={active.k}>
          <div className="iv-head">
            <div className="iv-htop">
              <span className="iv-title">{t(showAmount ? 'pay.invoice' : 'pay.transferDetails')}</span>
              {showAmount && <span className={`iv-status${awaiting ? '' : ' draft'}`}>
                {awaiting && <i aria-hidden="true" />}
                {awaiting ? t('pay.awaiting') : t('pay.details')}
              </span>}
            </div>
            {showAmount && <div className="iv-sum">
              <span className="iv-amt">
                {hasAmount ? (isPaypal ? usd(amountUsd) : vnd(amountVnd)) : '—'}
              </span>
              {hasAmount && (
                <span className="iv-amt-sub">≈ {isPaypal ? vnd(amountVnd) : usd(amountUsd)}</span>
              )}
            </div>}
          </div>

          <div className="iv-body">
            <div className="iv-qr">
              {isPaypal
                ? <QR text={paypalPayload(amountUsd)} color="#003087" />
                : <QR text={vietQRPayload(amountVnd, desc)} />}
              <span className="iv-qr-cap">
                {isPaypal ? t('pay.scanPaypal') : t(awaiting ? 'pay.scanBankPrefilled' : 'pay.scanBank')}
              </span>
            </div>

            <div className="iv-rows">
              {active.k === 'bank' && <>
                <CopyRow k={t('pay.bankName')} v={PAYMENT.bank.bankName} />
                <CopyRow k={t('pay.accNo')} v={PAYMENT.bank.accountNumber} mono />
                <CopyRow k={t('pay.accName')} v={PAYMENT.bank.accountName} />
              </>}
              {active.k === 'paypal' && <>
                <CopyRow k="PayPal.me" v={`paypal.me/${PAYMENT.paypal.username}`} />
                <CopyRow k={t('pay.email')} v={PAYMENT.paypal.email} />
              </>}
              {showAmount && hasAmount && <CopyRow k={t('pay.amount')} v={isPaypal ? usd(amountUsd) : vnd(amountVnd)} mono />}
              {showReference && desc && <CopyRow k={isPaypal ? t('pay.memo') : t('pay.content')} v={desc} />}
            </div>
          </div>

          <div className="iv-foot">
            {isPaypal ? (
              <>
                <a className="iv-go" href={paypalPayload(amountUsd)} target="_blank" rel="noreferrer">
                  {t('pay.openPaypal')}<Icon name="ext" size={12} />
                </a>
                {showReference && desc && <span>{t('pay.paypalReferenceHint')}</span>}
              </>
            ) : (
              <span>{t(awaiting ? 'pay.checkBeforeSending' : 'pay.exact')}</span>
            )}
            <span>{t('pay.afterPay')}</span>
          </div>
        </div>
      ) : (
        <div className="pay-hint">{t('pay.hint')}</div>
      )}
    </div>
  )
}
