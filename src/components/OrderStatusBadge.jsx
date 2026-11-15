import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { orderDeadline, orderDisplayStatus } from '../lib/requestPayment.js'

const CLASS = { paid: 'completed', rejected: 'denied', expired: 'queued', awaiting: 'pending' }
const LABEL = { paid: 'order.paid', rejected: 'order.rejected', expired: 'order.expired', awaiting: 'order.awaiting' }

/** Một nhãn trạng thái đơn cho cả My activity, Buy tab và Admin. */
export default function OrderStatusBadge({ order, showDeadline = true }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  const status = orderDisplayStatus(order, now)
  const deadline = orderDeadline(order, now)
  useEffect(() => {
    if (order?.status !== 'awaiting' || !order?.expires_at) return undefined
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [order?.status, order?.expires_at])
  const date = deadline ? new Date(deadline.at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : ''
  return (
    <span className="order-state">
      <span className={`pill ${CLASS[status] || 'pending'}`}
        title={status === 'expired' ? t('order.expiredHint') : undefined}>
        {t(LABEL[status] || 'order.awaiting')}
      </span>
      {showDeadline && deadline && (
        <small className={`order-deadline${deadline.expired ? ' over' : ''}`}
          title={t('order.deadlineAt', { date })}>
          {deadline.expired ? t('order.windowEnded') : t('order.payWithin', { h: deadline.hoursLeft })}
        </small>
      )}
    </span>
  )
}
