import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

const VIEW = 224          // cạnh khung xem trước (px)
const MAX_ZOOM = 4

/**
 * Khung chỉnh ảnh đại diện: kéo để dời, lăn chuột hoặc kéo thanh trượt để phóng to.
 * Gọi onChange({ sx, sy, size }) — toạ độ vùng cắt theo pixel của ảnh gốc.
 */
export default function AvatarCropper({ img, onChange }) {
  const { t } = useI18n()
  const box = useRef(null)
  const drag = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })

  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // tỉ lệ tối thiểu để ảnh luôn phủ kín khung
  const base = VIEW / Math.min(iw, ih)
  const scale = base * zoom
  const dw = iw * scale
  const dh = ih * scale

  /* Giữ ảnh không bị kéo hở mép */
  const clamp = useCallback((o, s) => {
    const mx = Math.max(0, (iw * s - VIEW) / 2)
    const my = Math.max(0, (ih * s - VIEW) / 2)
    return {
      x: Math.min(mx, Math.max(-mx, o.x)),
      y: Math.min(my, Math.max(-my, o.y)),
    }
  }, [iw, ih])

  /* Đổi vị trí + độ phóng thành vùng cắt trên ảnh gốc */
  useEffect(() => {
    onChange({
      sx: (dw / 2 - VIEW / 2 - off.x) / scale,
      sy: (dh / 2 - VIEW / 2 - off.y) / scale,
      size: VIEW / scale,
    })
  }, [off, scale, dw, dh, onChange])

  /* Đổi ảnh khác thì đưa về mặc định */
  useEffect(() => { setZoom(1); setOff({ x: 0, y: 0 }) }, [img])

  const changeZoom = useCallback((z) => {
    setZoom(prev => {
      const next = Math.min(MAX_ZOOM, Math.max(1, z))
      const ratio = next / prev
      setOff(o => clamp({ x: o.x * ratio, y: o.y * ratio }, base * next))
      return next
    })
  }, [base, clamp])

  /* Lăn chuột để phóng to.
     React gắn onWheel ở chế độ passive nên preventDefault() trong đó không có tác dụng
     → trang phía sau vẫn cuộn theo. Phải tự gắn listener với passive: false. */
  const zoomRef = useRef(zoom)
  const fnRef = useRef(changeZoom)
  useEffect(() => { zoomRef.current = zoom; fnRef.current = changeZoom })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      fnRef.current(zoomRef.current * (e.deltaY < 0 ? 1.12 : 0.89))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const down = (e) => {
    e.preventDefault()
    box.current?.setPointerCapture?.(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }
  }
  const move = (e) => {
    if (!drag.current) return
    e.preventDefault()
    const d = drag.current
    setOff(clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }, scale))
  }
  const up = (e) => {
    drag.current = null
    box.current?.releasePointerCapture?.(e.pointerId)
  }

  return (
    <div className="crop">
      <div ref={box} className="crop-box" style={{ width: VIEW, height: VIEW }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        role="application" aria-label={t('crop.hint')}>
        <img className="crop-img" src={img.src} alt="" draggable="false"
          style={{
            width: dw, height: dh,
            left: `calc(50% + ${off.x}px)`, top: `calc(50% + ${off.y}px)`,
          }} />
        <div className="crop-mask" />
      </div>

      <div className="crop-ctrl">
        <button type="button" className="crop-z" onClick={() => changeZoom(zoom - 0.25)}
          disabled={zoom <= 1} aria-label="−">−</button>
        <input type="range" className="crop-range" min="1" max={MAX_ZOOM} step="0.02"
          value={zoom} onChange={e => changeZoom(Number(e.target.value))}
          aria-label={t('crop.zoom')} />
        <button type="button" className="crop-z" onClick={() => changeZoom(zoom + 0.25)}
          disabled={zoom >= MAX_ZOOM} aria-label="+">+</button>
      </div>
      <div className="crop-hint">{t('crop.hint')}</div>
    </div>
  )
}
