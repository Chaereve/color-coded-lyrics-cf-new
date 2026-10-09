import { useEffect, useRef } from 'react'
import { REEL_GAP, REEL_ITEM_WIDTH, REEL_SETTLE_MS } from '../lib/mysteryBox.js'
import './CaseOpeningReel.css'

/* =========================================================
   CASE OPENING REEL — dải case-opening NGANG của MYSTERY BOX
   (Daily Spin dùng SQUARE GRID — spec 2026-10-09 tách hai UI)
   ---------------------------------------------------------
   Viewport: position:relative + overflow:hidden (bắt buộc — không item nào
   lòi ra ngoài). Track: flex, width:max-content, will-change:transform.
   Item: flex:0 0 var(--reel-item-width) — kích thước nội bộ cố định.
   Pointer:Neo giữa viewport, z-index cao nhất.

   SERVER LÀ NGUỒN QUYẾT: `items` do cha dựng từ KẾT QUẢ server trả về
   (ô tại `targetIndex` chính là phần thưởng thật); component này chỉ
   animate track tới đúng tâm ô đó rồi giữ nguyên. Không random, không
   chọn thưởng ở đây.

   Toạ độ đích TÍNH TỪ DOM (không hardcode):
     targetX = targetIndex · step − (viewportWidth/2 − itemWidth/2)
   với step đọc từ getBoundingClientRect của item + gap thực — đúng trên
   mọi viewport, kể cả mobile.

   Nhịp: reset KHÔNG transition → hai khung hình (đảm bảo browser kịp
   paint vị trí xuất phát) → một transition transform giảm tốc. Xong thì
   track Ở NGUYÊN vị trí kết quả. Unmount giữa nhịp: cleanup rAF + timer.
   Reduced-motion: transition rất ngắn (180ms) — kết quả vẫn đầy đủ.
   ========================================================= */

export function CaseReelViewport({ children, viewRef }) {
  return <div className="reel-viewport" ref={viewRef}>{children}</div>
}

export function CaseReelTrack({ children, trackRef, style }) {
  return <div className="reel-track" ref={trackRef} style={style}>{children}</div>
}

export function CaseReelItem({ kind, win, label, sub }) {
  return (
    <span className={`reel-item ${kind}${win ? ' is-win' : ''}`}>
      <b>{label}</b>
      {sub ? <small>{sub}</small> : null}
    </span>
  )
}

export function CaseReelPointer() {
  return <span className="reel-pointer" aria-hidden="true" />
}

export function CaseOpeningReel({
  items, spinning, targetIndex, duration = 3600, onSettled,
  label, settled = false,
}) {
  const view = useRef(null)
  const track = useRef(null)
  const onSettledRef = useRef(onSettled)
  // Neo callback QUA EFFECT (gán ref lúc render là副作用 cấm — react-compiler):
  // callback cha đổi identity mỗi render, ref phải bám theo sau mỗi render.
  useEffect(() => { onSettledRef.current = onSettled })

  useEffect(() => {
    if (!spinning || targetIndex == null) return undefined
    const viewEl = view.current
    const trackEl = track.current
    if (!viewEl || !trackEl) return undefined
    /* Bước cách nhau = bề rộng item THẬT + gap THẬT (đọc từ DOM — responsive
       đúng ngay cả khi CSS variable đổi ở breakpoint khác). */
    const first = trackEl.children[0]
    const itemW = first ? first.getBoundingClientRect().width : REEL_ITEM_WIDTH
    const gap = parseFloat(getComputedStyle(trackEl).columnGap) || REEL_GAP
    const step = (itemW || REEL_ITEM_WIDTH) + gap
    const vw = viewEl.getBoundingClientRect().width
    const targetX = targetIndex * step - (vw / 2 - itemW / 2)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ms = reduced ? REEL_SETTLE_MS : duration
    let raf = 0
    /* RESET KHÔNG TRANSITION trước mỗi nhịp: track về 0 tức thì, hai RAF kế
       tiếp mới gán transform đích — browser kịp vẽ điểm xuất phát. */
    trackEl.style.transition = 'none'
    trackEl.style.transform = 'translate3d(0, 0, 0)'
    void trackEl.offsetWidth
    raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      trackEl.style.transition = `transform ${ms}ms cubic-bezier(.08, .75, .11, 1)`
      trackEl.style.transform = `translate3d(${-targetX}px, 0, 0)`
    }))
    const timer = setTimeout(() => onSettledRef.current?.(), ms + 140)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [spinning, targetIndex, duration, track, view])

  return (
    <div className={`reel${settled ? ' is-settled' : ''}`} role="img" aria-label={label}>
      <CaseReelViewport viewRef={view}>
        <CaseReelTrack trackRef={track}>
          {items.map((it, i) => (
            <CaseReelItem key={i} kind={it.kind} win={it.win} label={it.label} sub={it.sub} />
          ))}
        </CaseReelTrack>
      </CaseReelViewport>
      <CaseReelPointer />
    </div>
  )
}

export default CaseOpeningReel
