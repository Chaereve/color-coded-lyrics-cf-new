import { useEffect, useRef, useState } from 'react'

/* =========================================================
   Đếm số — từ giá trị cũ chạy tới giá trị mới
   ---------------------------------------------------------
   Dùng cho thẻ thống kê và bảng xếp hạng: số nhảy bật ngửa trông như
   lỗi render, số đếm thì có cảm giác "đang tính". Một vòng rAF ngắn
   cho mỗi lần đổi, không giữ timer chạy nền.

   prefers-reduced-motion: hiện thẳng con số, không đếm.
   ========================================================= */
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const REDUCED = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useCountUp(value, ms = 480) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef(0)

  useEffect(() => {
    const target = Number(value) || 0
    const start = Number(from.current) || 0
    if (REDUCED() || start === target) { from.current = target; setShown(target); return }

    const t0 = performance.now()
    /* tự lấy mốc thời gian, không dùng timestamp rAF đưa vào: ở một vài
       môi trường (jsdom, Safari cũ khi tab bị đóng băng) hai đồng hồ này lệch
       gốc, hiệu số ra số âm và con số đếm lùi về số âm */
    const step = () => {
      const p = Math.max(0, Math.min(1, (performance.now() - t0) / ms))
      const n = Math.round(start + (target - start) * easeOut(p))
      setShown(n)
      if (p < 1) raf.current = requestAnimationFrame(step)
      else from.current = target
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, ms])

  return shown
}

/**
 * Gán --mx/--my cho phần tử [data-glow] dưới con trỏ, để vệt sáng bám
 * chuột chạy theo thẻ. MỘT listener cho cả trang, cắt bớt theo frame;
 * máy không có hover thật thì bỏ qua luôn.
 */
export function useGlow() {
  useEffect(() => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) return
    let raf = 0
    let last = null

    const clear = () => {
      if (!last) return
      last.style.removeProperty('--mx')
      last.style.removeProperty('--my')
      last = null
    }
    const onMove = (e) => {
      const el = e.target?.closest?.('[data-glow]') || null
      if (el !== last) clear()
      if (!el) return
      last = el
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`)
        el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`)
      })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
      clear()
    }
  }, [])
}
