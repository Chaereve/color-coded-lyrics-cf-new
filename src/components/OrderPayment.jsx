import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { errMsg, useI18n } from '../lib/i18n.jsx'
import { copyText } from '../lib/clipboard'
import { useTransient } from '../lib/useTransient'
import { useModalExit } from '../lib/useModalExit'
import { useFocusTrap } from '../lib/useFocusTrap'
import { reportTransfer } from '../lib/db'
import { ORDER_PAYMENT_HOURS, orderTransferContent } from '../lib/requestPayment.js'

/* Chỉ tải bộ vẽ QR khi người mua thật sự mở bước thanh toán. */
const PaymentMethods = lazy(() => import('./PaymentMethods'))

/** Một khối, một việc: mở cách trả tiền, rồi đối chiếu đúng mã của đơn này.
    Mã chỉ xuất hiện trong hộp thoại — danh sách đơn không in cùng một chuỗi ở
    cả hai nơi. Trả tiền là việc rời khỏi trang (quét QR / mở app ngân hàng)
    nên phần trả tiền mở dạng POPUP thật (role=dialog), không bung inline
    trong hàng đơn như trước: danh sách đơn giữ nguyên mật độ, mã QR không bị
    cuộn dưới ngón tay, Esc / bấm nền / nút X đều đóng được, tiêu điểm nằm
    trong hộp và được trả về nút Pay now. */
export default function OrderPayment({ order }) {
  const { t } = useI18n()
  const id = useId()
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [copied, flashCopied] = useTransient()
  const [copyFailed, setCopyFailed] = useState(false)
  const reference = orderTransferContent(order)
  /* Người mua báo đã chuyển khoản: chỉ ĐÁNH DẤU giờ, không đổi trạng thái đơn.
     Server là nơi quyết định (RPC idempotent, chỉ chủ đơn, đơn còn chờ & chưa
     hết 72h); ở đây chỉ phản chiếu kết quả. `order.transfer_reported_at` do
     parent chọn cột về, nên có sẵn sau mỗi lần nạp lại danh sách đơn. */
  /* Không đồng bộ bằng effect: `reportedAt` là GIÁ TRỊ DẪN XUẤT. Đơn từ server
     nói `transfer_reported_at` (đã nạp lại danh sách sau claim), còn ở client
     giữ tạm dấu của chính lần bấm claim để UI không chớp khi parent chưa kịp
     nạp lại. Claim thành công xong thì dấu local lấn át giá trị cũ của đơn —
     nó là dữ liệu mới hơn, không phải ghi đè ai. */
  const [claimAt, setClaimAt] = useState(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState('')
  const reportedAt = claimAt ?? order.transfer_reported_at ?? null
  const { mounted, closing } = useModalExit(open)
  /* Tiêu điểm: mở ra rơi vào nút X (mốc rõ ràng cho bàn phím), Tab nhốt trong
     hộp, đóng thì trả về nút Pay now — useFocusTrap lo cả ba. */
  useFocusTrap(panelRef, open, { initial: () => closeRef.current })
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const claim = async () => {
    if (reportedAt || claiming) return
    setClaiming(true)
    setClaimError('')
    try {
      const updated = await reportTransfer(order.id)
      setClaimAt(updated?.transfer_reported_at || new Date().toISOString())
    } catch (e) {
      setClaimError(errMsg(t, e))
    } finally {
      setClaiming(false)
    }
  }
  const claimed = Boolean(reportedAt)

  const copyReference = async () => {
    const ok = await copyText(reference)
    setCopyFailed(!ok)
    if (ok) flashCopied()
  }
  const close = () => setOpen(false)
  const out = closing ? ' out' : ''

  return (
    <div className="order-payment-details" data-payment-ui="popup-20261116">
      <button type="button" ref={triggerRef} className="order-pay-toggle"
        onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="order-pay-label">
          <Icon name="receipt" size={15} />
          <span>{t('order.payNow')}</span>
        </span>
        <Icon name="ext" size={14} className="order-pay-ext" />
      </button>
      {/* Portal vào <body>: hàng đơn (và tổ tiên của nó) có transform trong lúc
          dựng animation — position:fixed bên trong một tổ tiên có transform sẽ
          CHỈ phủ tổ tiên đó thay vì cả màn hình. Đúng kiểu lỗi "popup bị kẹt
          trong hàng đơn" đã tự kiểm chứng: overlay chỉ cao 114px và hộp thoại
          nhảy xuống nửa dưới màn hình. Portal thoát khỏi mọi containing block.
          SSR render lúc đầu luôn `mounted === false` nên không chạm `document`. */}
      {mounted && createPortal(
        <div className={`overlay pay-overlay${out}`}
          onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={panelRef} className={`modal order-pay-modal${out}`}
            role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
            <div className="pay-modal-head">
              <span className="pay-modal-title" id={`${id}-title`}>
                <span className="pay-modal-ico" aria-hidden="true"><Icon name="receipt" size={15} /></span>
                <span>{t('order.paymentTitle')}</span>
              </span>
              <button type="button" ref={closeRef} className="order-payment-close pay-modal-close"
                onClick={close} aria-label={t('order.hidePayment')} title={t('order.hidePayment')}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="pay-modal-body" id={`${id}-panel`}>
        <div className="order-payment-panel">
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
              content={orderTransferContent(order)} awaiting showReference={false} defaultMethod="bank" />
          </Suspense>
          <div className="order-claim-row">
            {claimed ? (
              /* Một thông báo DUY NHẤT, đủ đậm để thấy: dấu + việc đang chờ admin. */
              <div className="notice ok order-claim-done" role="status">
                <span className="notice-ic tick-dot"><Icon name="check" size={15} /></span>
                <div className="notice-tx">
                  <p className="notice-lead">{t('order.claimedTransfer')}</p>
                  <p className="notice-sub">{t('order.claimNote')}</p>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="order-claim" onClick={claim} disabled={claiming}>
                  <span className="claim-tick"><Icon name="check" size={13} /></span>
                  <span>{claiming ? t('order.claimSending') : t('order.claimTransfer')}</span>
                </button>
                {/* Caption trấn an: trần chữ, không khung — không đấm ngang
                    cùng tông với strip vàng và banner xanh bên dưới. */}
                <p className="assure">
                  <Icon name="shield" size={13} />
                  <span>{t('order.claimNote')}</span>
                </p>
              </>
            )}
            {claimError && <p className="order-claim-error" role="alert">{claimError}</p>}
          </div>
          {/* Footer bar: hairline trên, đồng hồ amber — tách hẳn khỏi vùng
              nút bấm để hai dòng nhắc việc không còn chồng hình dạng lên nhau */}
          <div className="pay-modal-foot">
            <p className="row-note expire">
              <Icon name="clock" size={12} />
              <span><b>{t('order.expireLead', { h: ORDER_PAYMENT_HOURS })}</b> {t('order.expireRest')}</span>
            </p>
          </div>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  )
}
