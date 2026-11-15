import { lazy, Suspense, useId, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { copyText } from '../lib/clipboard'
import { useTransient } from '../lib/useTransient'
import { ORDER_PAYMENT_HOURS, orderTransferContent } from '../lib/requestPayment.js'

/* Chỉ tải bộ vẽ QR khi người mua thật sự mở bước thanh toán. */
const PaymentMethods = lazy(() => import('./PaymentMethods'))

/** Một khối, một việc: mở cách trả tiền, rồi đối chiếu đúng mã của đơn này.
    Với đơn chờ trả, mã đầy đủ chỉ nằm ở đây (kể cả khi đóng); các đơn khác
    giữ mã trong metadata của hàng. Không in cùng một chuỗi ở cả hai nơi.
    <details> giữ được hành vi bàn phím vốn có, không cần tự quản lý phím. */
export default function OrderPayment({ order }) {
  const { t } = useI18n()
  const id = useId()
  const summaryRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [copied, flashCopied] = useTransient()
  const [copyFailed, setCopyFailed] = useState(false)
  const reference = orderTransferContent(order)

  const copyReference = async () => {
    const ok = await copyText(reference)
    setCopyFailed(!ok)
    if (ok) flashCopied()
  }
  const close = () => {
    setOpen(false)
    /* Đóng bằng nút bên trong: trả tiêu điểm về đúng nút vừa mở, không bỏ
       người dùng bàn phím ở đầu trang hoặc trên một nút đã biến mất. */
    summaryRef.current?.focus()
  }

  return (
    <details className="order-payment-details" data-payment-ui="compact-20261115" open={open}
      onToggle={e => setOpen(e.currentTarget.open)}>
      <summary ref={summaryRef} className="order-pay-toggle" aria-controls={`${id}-panel`}>
        <span className="order-pay-label">
          <Icon name="receipt" size={15} />
          <span>{t(open ? 'order.hidePayment' : 'order.payNow')}</span>
        </span>
        <Icon name="chevron" size={15} className="order-pay-chevron" />
      </summary>
      {open && (
        <div className="order-payment-panel" id={`${id}-panel`}>
          <div className="order-reference">
            <div className="order-reference-text">
              <span className="order-reference-label">{t('order.transferCode')}</span>
              <code>{reference}</code>
            </div>
            <button type="button" className={`order-reference-copy${copied ? ' done' : ''}`}
              onClick={copyReference} aria-label={t('order.copyReference')}
              title={copied ? t('pay.copied') : t('order.copyReference')}>
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              <span>{t(copied ? 'pay.copied' : 'pay.copy')}</span>
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copied ? t('order.referenceCopied') : copyFailed ? t('pay.copyFailed') : ''}
            </span>
          </div>
          {copyFailed && <p className="fhint order-copy-fallback" role="status">{t('pay.copyFailed')}</p>}
          <Suspense fallback={<span className="fhint" role="status">{t('order.paymentLoading')}</span>}>
            <PaymentMethods amountVnd={order.amount_vnd} amountUsd={Number(order.amount_usd)}
              content={orderTransferContent(order)} awaiting showAmount={false} showReference={false} defaultMethod="bank" />
          </Suspense>
          <div className="order-payment-foot">
            <p className="fhint">{t('order.windowHelp', { h: ORDER_PAYMENT_HOURS })}</p>
            <button type="button" className="order-payment-close" onClick={close}>
              {t('order.hidePayment')}
            </button>
          </div>
        </div>
      )}
    </details>
  )
}
