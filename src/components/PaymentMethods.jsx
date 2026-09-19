import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import QRCode from 'qrcode'
import { PAYMENT, vietQRPayload, paypalPayload, cleanContent } from '../lib/payment'
import { vnd, usd } from '../lib/meta'
import { useI18n } from '../lib/i18n.jsx'
import logoVietQR from '../assets/pay/vietqr.svg'
import logoPaypal from '../assets/pay/paypal.svg'

/* ============ Logo chính chủ của từng cổng thanh toán ============ */
const METHODS = [
  { k: 'bank',   src: logoVietQR, nameKey: 'pay.bank',   alt: 'VietQR', c: 'var(--queued)' },
  { k: 'paypal', src: logoPaypal, nameKey: 'pay.paypal', alt: 'PayPal', c: '#0070ba' },
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
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(v) } catch { /* ignore */ }
    setDone(true); setTimeout(() => setDone(false), 1600)
  }
  return (
    <div className="pay-row">
      <span className="pay-k">{k}</span>
      <span className={`pay-v${mono ? ' mono' : ''}`}>{v}</span>
      <button type="button" className={`copy${done ? ' done' : ''}`} onClick={copy}>
        {done ? <Icon name="check" size={14} /> : t('pay.copy')}
      </button>
    </div>
  )
}

export default function PaymentMethods({ amountVnd = 0, amountUsd = 0, content = '' }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(null)
  const desc = cleanContent(content)
  const active = METHODS.find(m => m.k === open)

  return (
    <div className="pay">
      <div className="paygrid">
        {METHODS.map(({ k, src, nameKey, alt }) => (
          <button key={k} type="button"
            className={`paytile${open === k ? ' on' : ''} ${k}`}
            onClick={() => setOpen(o => (o === k ? null : k))}
            aria-pressed={open === k} aria-label={t(nameKey)} title={t(nameKey)}>
            <img className="paytile-logo" src={src} alt={alt} />
          </button>
        ))}
      </div>

      {active && (
        <div className="pay-panel">
          <div className="pay-grid">
            <div className="pay-info">
              {active.k === 'bank' && <>
                <CopyRow k={t('pay.bankName')} v={PAYMENT.bank.bankName} />
                <CopyRow k={t('pay.accNo')} v={PAYMENT.bank.accountNumber} mono />
                <CopyRow k={t('pay.accName')} v={PAYMENT.bank.accountName} />
              </>}
              {active.k === 'paypal' && <>
                <CopyRow k="PayPal.me" v={`paypal.me/${PAYMENT.paypal.username}`} />
                <CopyRow k={t('pay.email')} v={PAYMENT.paypal.email} />
              </>}

              {active.k === 'paypal'
                ? (amountUsd > 0 && <CopyRow k={t('pay.amount')} v={usd(amountUsd)} mono />)
                : (amountVnd > 0 && <CopyRow k={t('pay.amount')} v={vnd(amountVnd)} mono />)}
              {desc && <CopyRow k={active.k === 'paypal' ? t('pay.memo') : t('pay.content')} v={desc} mono />}
            </div>

            <div className="pay-qr">
              {active.k === 'bank'   && <QR text={vietQRPayload(amountVnd, desc)} />}
              {active.k === 'paypal' && <QR text={paypalPayload(amountUsd)} color="#003087" />}
              <div className="pay-qr-cap">
                {active.k === 'bank' ? t('pay.scanBank') : t('pay.scanPaypal')}
              </div>
            </div>
          </div>

          {active.k === 'paypal' && (
            <div className="pay-tip">
              <a href={paypalPayload(amountUsd)} target="_blank" rel="noreferrer">paypal.me/{PAYMENT.paypal.username}</a>
              {amountUsd > 0 && <span> · {usd(amountUsd)}</span>}
            </div>
          )}
        </div>
      )}

      {!active && <div className="pay-hint">{t('pay.hint')}</div>}
    </div>
  )
}
