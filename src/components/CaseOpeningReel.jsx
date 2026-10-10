import { useEffect, useRef, useState } from 'react'
import { REEL_GAP, REEL_ITEM_WIDTH, REEL_SETTLE_MS } from '../lib/mysteryBox.js'
import './CaseOpeningReel.css'

/* =========================================================
   CASE OPENING REEL — dải case-opening NGANG của DAILY BOX
   (Daily Spin dùng board 7×5 riêng — spec vòng 5 tách hai UI)
   ---------------------------------------------------------
   Viewport: position:relative + overflow:hidden + mask 2 mép (không item
   nào lòi). Track: flex, will-change:transform. Pointer: kim dọc chính giữa
   có mũi tên 2 đầu, NẢY nhẹ mỗi khi một ô đi qua (rAF đọc ma trận transform
   — sample vòng 5).

   SERVER LÀ NGUỒN QUYẾT: `items` do cha dựng từ KẾT QUẢ server trả về
   (ô tại `targetIndex` chính là phần thưởng thật); component này chỉ
   animate track tới đúng tâm ô đó rồi giữ nguyên. Không random, không
   chọn thưởng ở đây — không jitter: dừng CHÍNH XÁC dưới kim.

   Nhịp (vòng 5): RESET không transition → 2 frame paint vị trí xuất phát →
   chờ `hold` ms (cho reel TRỒI LÊN phía trên hộp xong) → transition transform
   giảm tốc cubic-bezier(.08,.6,.12,1) → dừng CHÍNH XÁC → ô đích .is-win,
   các ô khác mờ (.is-settled) → onSettled. Unmount giữa nhịp: cleanup rAF +
   timer. Reduced-motion: transition rất ngắn (180ms) — kết quả vẫn đầy đủ.
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

function CaseOpeningReel({
  items, spinning, targetIndex, duration = 3600, onSettled,
  label, settled = false, hold = 0,
}) {
  const view = useRef(null)
  const track = useRef(null)
  const pointer = useRef(null)
  const [done, setDone] = useState(false)
  const onSettledRef = useRef(onSettled)
  // Neo callback QUA EFFECT (gán ref lúc render là副作用 cấm — react-compiler):
  // callback cha đổi identity mỗi render, ref phải bám theo sau mỗi render.
  useEffect(() => { onSettledRef.current = onSettled })

  useEffect(() => {
    if (!spinning || targetIndex == null) return undefined
    const viewEl = view.current
    const trackEl = track.current
    if (!viewEl || !trackEl) return undefined
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ms = reduced ? REEL_SETTLE_MS : duration
    const holdMs = reduced ? 0 : hold
    let raf = 0
    let wiggleRaf = 0
    /* Kim NẢY mỗi khi một ô đi qua — đọc ma trận transform mỗi frame. */
    const startWiggle = step => {
      if (reduced || holdMs >= ms) return
      let last = -1
      const tick = () => {
        if (!pointer.current) return
        const m = new DOMMatrix(getComputedStyle(trackEl).transform)
        const index = Math.floor((viewEl.clientWidth / 2 - m.m41) / step)
        if (index !== last) {
          last = index
          pointer.current.animate(
            [{ transform: 'rotate(7deg) scaleY(1.05)' }, { transform: 'none' }],
            { duration: 110 },
          )
        }
        wiggleRaf = requestAnimationFrame(tick)
      }
      wiggleRaf = requestAnimationFrame(tick)
    }
    /* Sau HOLD (reel đã trồi lên XONG, scale = 1) mới đo + bắn transition:
       đo sớm hơn thì getBoundingClientRect trả số nhân scale(.3) — target lệch. */
    const start = setTimeout(() => {
      raf = requestAnimationFrame(() => requestAnimationFrame(() => {
        /* Bước cách nhau = bề rộng item THẬT + gap THẬT (đọc từ DOM — responsive
           đúng ngay cả khi CSS variable đổi ở breakpoint khác). */
        const first = trackEl.children[0]
        const itemW = first ? first.getBoundingClientRect().width : REEL_ITEM_WIDTH
        const gap = parseFloat(getComputedStyle(trackEl).columnGap) || REEL_GAP
        const step = (itemW || REEL_ITEM_WIDTH) + gap
        const vw = viewEl.getBoundingClientRect().width
        const targetX = targetIndex * step - (vw / 2 - itemW / 2)
        /* RESET KHÔNG TRANSITION trước nhịp chạy: track về vị trí xuất phát tức
           thì, hai RAF kế tiếp mới gán transform đích — browser kịp vẽ. */
        trackEl.style.transition = `transform ${ms}ms cubic-bezier(.08, .6, .12, 1)`
        trackEl.style.transform = `translate3d(${-targetX}px, 0, 0)`
        startWiggle(step)
      }))
    }, holdMs)
    const timer = setTimeout(() => {
      cancelAnimationFrame(wiggleRaf)
      setDone(true)   // ô đích sáng + các ô khác mờ — rồi mới báo cha
      setTimeout(() => onSettledRef.current?.(), reduced ? 60 : 620)
    }, holdMs + ms + 140)
    return () => {
      clearTimeout(start); clearTimeout(timer)
      cancelAnimationFrame(raf); cancelAnimationFrame(wiggleRaf)
    }
  }, [spinning, targetIndex, duration, hold, track, view])

  return (
    <div className={`reel${done || settled ? ' is-settled' : ''}`} role="img" aria-label={label}>
      <CaseReelViewport viewRef={view}>
        <CaseReelTrack trackRef={track}>
          {items.map((it, i) => (
            <CaseReelItem key={i} kind={it.kind} win={it.win} label={it.label} sub={it.sub} />
          ))}
        </CaseReelTrack>
      </CaseReelViewport>
      <span className="reel-pointer" aria-hidden="true" ref={pointer} />
    </div>
  )
}

export default CaseOpeningReel
