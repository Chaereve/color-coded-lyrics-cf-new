import { useI18n } from '../lib/i18n.jsx'
import { REQUEST_PAYMENT_CLASS, REQUEST_PAYMENT_HINT, REQUEST_PAYMENT_LABEL, requestPaymentState } from '../lib/requestPayment.js'

/** Một nhãn chung cho bảng, hồ sơ, modal và admin.
    Paid thường = tem vàng, chữ PAID; bonus = tem tím, chữ BONUS, KHÔNG dán PAID.
    Chủ dự án chốt chỉ giữ chữ: khác chữ + màu, không sao/hộp quà. Nghĩa đầy đủ
    của tem vẫn nằm ở title/hint. */
export default function RequestPaymentBadge({ request = null, state: stateProp = null }) {
  const { t } = useI18n()
  const state = stateProp || requestPaymentState(request)
  if (state === 'free') return null
  return <span className={`pill ${REQUEST_PAYMENT_CLASS[state]}`} data-payment-state={state}
    data-payment-badge="b-text-20261115" title={t(REQUEST_PAYMENT_HINT[state])}>
    {t(REQUEST_PAYMENT_LABEL[state])}
  </span>
}
