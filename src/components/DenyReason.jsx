import { createPortal } from 'react-dom'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

/* A denial reason is private information. Callers render this control only for
   the requester or an admin; the reason itself stays out of the DOM until the
   user explicitly opens it. A body portal keeps the small popover clear of the
   clipped request-list card. */
export default function DenyReason({ reason, label, className = '', style }) {
  const { t } = useI18n()
  const id = useId()
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  const measure = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect || typeof window === 'undefined') return
    const width = Math.max(140, Math.min(300, window.innerWidth - 24))
    setPosition({
      top: rect.bottom + 6,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
      maxHeight: Math.max(72, Math.min(200, window.innerHeight - rect.bottom - 18)),
    })
  }, [])

  const toggle = () => {
    if (!open) measure()
    setOpen(value => !value)
  }

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = event => {
      if (buttonRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onMove = () => measure()
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, measure])

  if (!reason) return null
  return <>
    <button ref={buttonRef} type="button"
      className={`deny-reason-trigger ${className}`.trim()}
      style={style}
      aria-label={`${label}. ${t('deny.showReason')}`}
      aria-expanded={open}
      aria-controls={open ? `deny-reason-${id}` : undefined}
      onClick={toggle}>
      {label}
    </button>
    {open && position && createPortal(
      <div ref={popoverRef} id={`deny-reason-${id}`} className="deny-reason-popover"
        role="status" aria-live="polite"
        style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
        <b>{t('deny.reasonLabel')}</b>
        <span>{reason}</span>
      </div>,
      document.body,
    )}
  </>
}
