import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useNotify } from '../lib/notify'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   TOASTER — notification kiểu Alert, phủ lớp liquid glass
   ---------------------------------------------------------
   Đồng hồ tự ẩn vẫn chạy bằng rAF; khi rê chuột/focus hoặc ẩn tab thì
   tạm dừng. Không còn progress bar nhìn như trạng thái tải.
   ========================================================= */

function Toast({ n, onDone, onClose }) {
  const { t } = useI18n()
  const leftRef = useRef(n.ms)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!n.ms) return
    let raf = 0
    let prev = performance.now()
    let alive = true
    const tick = (now) => {
      if (!alive) return
      /* trần 100ms: khi tab thức lại, toast không biến mất đột ngột */
      const dt = Math.min(100, Math.max(0, now - prev))
      prev = now
      if (!paused && !document.hidden) {
        leftRef.current -= dt
        if (leftRef.current <= 0) { onDone(); return }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [paused, n.ms, onDone])

  return (
    <div className={`toast ${n.tone}${n.out ? ' out' : ''}`} data-toast
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="toast-dot" aria-hidden="true" />
      <div className="toast-tx">
        <b>{n.title}{n.repeat > 1 && (
          <em className="toast-rep" title={t('toast.repeatCount')}>×{n.repeat}</em>
        )}</b>
        {n.body && <p>{n.body}</p>}
        {n.action && (
          <button type="button" className="toast-act" onClick={() => { n.action.onClick(); onClose() }}>
            {n.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast-x" aria-label={t('notif.dismiss')} onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

export default function Toaster() {
  const { items, dismiss } = useNotify()
  const { t } = useI18n()

  /* Esc đóng mẩu mới nhất — đúng thứ tự người dùng mong đợi */
  const onClose = useCallback(() => { if (items[0]) dismiss(items[0].id) }, [items, dismiss])
  useEffect(() => {
    if (!items.length) return
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [items.length, onClose])

  /* Vùng live tồn tại cả khi rỗng để trình đọc màn hình nhận được toast đầu tiên. */
  return (
    <div className="toasts" role="region" aria-label={t('notif.region')}>
      <div className="toasts-live" aria-live="polite" aria-atomic="false">
        {items.map(n => (
          <Toast key={n.id} n={n} onDone={() => dismiss(n.id)} onClose={() => dismiss(n.id)} />
        ))}
      </div>
    </div>
  )
}
