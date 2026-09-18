import { useCallback, useEffect, useRef, useState } from 'react'
import { useNotify } from '../lib/notify'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   TOASTER — chồng thông báo góc trên phải
   ---------------------------------------------------------
   Mỗi mẩu tự đếm giờ bằng rAF (không phải setTimeout) để:
     · rê chuột vào hàng là đồng hồ DỪNG lại thật sự, đúng như cái
       thanh tiến độ đang hiện — người đọc không bị mất thông báo
       giữa câu vì hết giờ;
     · tab ẩn thì đồng hồ nghỉ, quay lại vẫn còn nguyên.
   Hết giờ thì tự bắn onDone → provider đánh dấu .out, animation
   trượt ra chạy xong mới nhấc DOM.
   ========================================================= */

const ICON = {
  ok: <path d="M8.2 15.1 4 10.9l1.3-1.3 2.9 2.9 6.5-6.5L16 7.3 8.2 15.1Z" fill="currentColor" />,
  err: <path d="M12 2.6A9.4 9.4 0 1 0 21.4 12 9.4 9.4 0 0 0 12 2.6Zm4 12-1.4 1.4L12 13.4l-2.6 2.6L8 14.6 10.6 12 8 9.4 9.4 8 12 10.6 14.6 8 16 9.4 13.4 12 16 14.6Z" fill="currentColor" />,
  info: <path d="M12 2.6A9.4 9.4 0 1 0 21.4 12 9.4 9.4 0 0 0 12 2.6Zm.9 13.9h-1.8v-6h1.8v6Zm0-7.6h-1.8V7h1.8v1.9Z" fill="currentColor" />,
  gold: <path d="m12 3.3 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8L12 3.3Z" fill="currentColor" />,
}

function Toast({ n, onDone, onClose }) {
  const { t } = useI18n()
  const barRef = useRef(null)
  const leftRef = useRef(n.ms)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!n.ms) return
    let raf = 0
    let prev = performance.now()
    let alive = true
    const tick = (now) => {
      if (!alive) return
      /* trần 100ms cho một khung: tab bị ngủ đông rồi thức dậy có thể trả
         hiệu số khổng lồ, mẩu tin vừa hiện ra đã mất */
      const dt = Math.min(100, Math.max(0, now - prev))
      prev = now
      if (!paused && !document.hidden) {
        leftRef.current -= dt
        if (barRef.current) barRef.current.style.transform = `scaleX(${Math.max(0, leftRef.current / n.ms)})`
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
      <span className="toast-ico" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24">{ICON[n.tone] || ICON.info}</svg>
      </span>
      <div className="toast-tx">
        <b>{n.title}{n.repeat > 1 && (
          /* mot cú tick sinh ba o giong het nhau -> gộp lại thành một, dem so lan */
          <em className="toast-rep" title={t('toast.repeated', { n: n.repeat })}>×{n.repeat}</em>
        )}</b>
        {n.body && <p>{n.body}</p>}
        {n.action && (
          <button type="button" className="toast-act" onClick={() => { n.action.onClick(); onClose() }}>
            {n.action.label}
          </button>
        )}
      </div>
      <button type="button" className="toast-x" aria-label={t('notif.dismiss')} onClick={onClose}>×</button>
      {n.ms > 0 && <i className="toast-bar" ref={barRef} aria-hidden="true" />}
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

  if (!items.length) return null

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
