import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { useFocusTrap } from '../lib/useFocusTrap'
import { vnd, usd } from '../lib/meta'
import { orderDisplayStatus, orderTransferContent, reconcileOrder } from '../lib/requestPayment.js'

/** Đối soát thủ công trước khi gọi admin_order: không prefill số tiền/mã để
    admin không vô tình xác nhận một biên lai chưa đọc. */
export default function OrderReviewDialog({ order, busy = false, onClose, onConfirm }) {
  const { t } = useI18n()
  const panelRef = useRef(null)
  const amountRef = useRef(null)
  const [method, setMethod] = useState('bank')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  useFocusTrap(panelRef, true, { initial: () => amountRef.current })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const currency = method === 'paypal' ? 'USD' : 'VND'
  const expected = method === 'paypal' ? Number(order.amount_usd) : Number(order.amount_vnd)
  const check = reconcileOrder(order, { method, amount, reference })
  const touched = amount !== '' || reference.trim() !== ''
  const late = orderDisplayStatus(order) === 'expired'
  const submit = () => {
    if (busy || !check.ok) return
    onConfirm?.({ method, amount: Number(amount), reference: reference.trim(), reason: reason.trim() || null })
  }
  return (
    <div className="overlay dlg-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={panelRef} className="modal narrow dlg" role="dialog" aria-modal="true"
        aria-labelledby="order-review-title" aria-describedby="order-review-body">
        <div className="dlg-head">
          <span className="dlg-ico" aria-hidden="true"><Icon name="receipt" size={15} /></span>
          <h2 className="dlg-title" id="order-review-title">{t('adm.paymentTitle')}</h2>
        </div>
        <p className="dlg-body" id="order-review-body">{t('adm.paymentBody')}</p>
        <p className="fhint order-review-ref">{t('order.reference', { ref: orderTransferContent(order) })}</p>
        {late && <p className="msg err" role="alert">{t('adm.paymentLate')}</p>}
        <label className="dlg-field">
          <span>{t('adm.paymentMethod')}</span>
          <select className="sel" value={method} onChange={e => { setMethod(e.target.value); setAmount('') }}>
            <option value="bank">{t('pay.bank')}</option>
            <option value="paypal">{t('pay.paypal')}</option>
          </select>
        </label>
        <label className="dlg-field">
          <span>{t('adm.paymentAmount', { currency })}</span>
          <input ref={amountRef} type="number" inputMode="decimal" min="0"
            step={method === 'paypal' ? '0.01' : '1'} value={amount}
            placeholder={String(expected)} onChange={e => setAmount(e.target.value)} />
        </label>
        <p className="fhint">{t('adm.paymentExpected', { amount: method === 'paypal' ? usd(expected) : vnd(expected) })}</p>
        <label className="dlg-field">
          <span>{t('adm.paymentReference')}</span>
          <input type="text" value={reference} maxLength={80} autoComplete="off"
            placeholder={orderTransferContent(order)} onChange={e => setReference(e.target.value)} />
        </label>
        <label className="dlg-field">
          <span>{t('adm.paymentNote')}</span>
          <textarea value={reason} maxLength={300} rows={2} onChange={e => setReason(e.target.value)} />
        </label>
        {touched && (check.ok
          ? <p className="msg ok" role="status">{t('adm.paymentMatch')}</p>
          : <p className="msg err" role="alert">{t(check.code)}</p>)}
        <div className="dlg-acts">
          <button type="button" className="btn" onClick={onClose}>{t('btn.cancel')}</button>
          <button type="button" className="btn btn-ok" disabled={busy || !check.ok} onClick={submit}>
            {busy ? '…' : t('adm.paymentConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
