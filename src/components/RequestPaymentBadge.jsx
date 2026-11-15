import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { REQUEST_PAYMENT_CLASS, REQUEST_PAYMENT_HINT, REQUEST_PAYMENT_LABEL, requestPaymentState } from '../lib/requestPayment.js'

/** Một nhãn chung cho bảng, hồ sơ, modal và admin.
    Paid thường = tem vàng + sao; bonus = tem tím + hộp quà, KHÔNG dán PAID.
    Khác cả chữ lẫn hình để không phân biệt bằng màu một mình. */
export default function RequestPaymentBadge({ request = null, state: stateProp = null }) {
  const { t } = useI18n()
  const state = stateProp || requestPaymentState(request)
  if (state === 'free') return null
  return <span className={`pill ${REQUEST_PAYMENT_CLASS[state]}`} data-payment-state={state}
    title={t(REQUEST_PAYMENT_HINT[state])}>
    {state === 'bonus' && <Icon name="gift" size={10} className="req-payment-ico" />}
    {t(REQUEST_PAYMENT_LABEL[state])}
  </span>
}
