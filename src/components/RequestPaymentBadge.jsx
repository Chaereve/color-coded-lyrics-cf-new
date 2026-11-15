import { useI18n } from '../lib/i18n.jsx'
import { REQUEST_PAYMENT_CLASS, REQUEST_PAYMENT_HINT, REQUEST_PAYMENT_LABEL, requestPaymentState } from '../lib/requestPayment.js'

/** Một nhãn chung cho bảng, hồ sơ, modal và admin: không dán PAID cho bonus. */
export default function RequestPaymentBadge({ request = null, state: stateProp = null }) {
  const { t } = useI18n()
  const state = stateProp || requestPaymentState(request)
  if (state === 'free') return null
  return <span className={`pill ${REQUEST_PAYMENT_CLASS[state]}`} title={t(REQUEST_PAYMENT_HINT[state])}>
    {t(REQUEST_PAYMENT_LABEL[state])}
  </span>
}
