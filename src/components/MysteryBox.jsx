import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY,
} from '../lib/mysteryBox.js'
import './MysteryBox.css'

/* =========================================================
   MYSTERY BOX — case-opening (v2, feedback 2026-10-09)
   ---------------------------------------------------------
   NĂM TRẠNG THÁI, đều do DỮ LIỆU THẬT quyết định:
     locked → available → opening (charge → reel) → reveal → already

   NHỊP MỞ (~2,7s, khoá nút NGAY khi bấm):
     t0        charge 450ms — hộp co người, sáng thắt lại
               RPC openMysteryBox chạy SONG SONG ngay từ t0: kết quả do
               SERVER quyết TRƯỚC khi reel dừng, client KHÔNG chọn gì
     ~450ms    reel — dải thưởng trượt ngang qua vạch giữa, giảm tốc
               trong 2,2s và DỪNG đúng ô kết quả trả về (chỉ là diễn xuất:
               ô đích được đặt sẵn theo result của server)
     ~2,65s    reveal — chớp sáng + prize pop; "Nothing" vẫn có chớp + pop

   Reduced-motion: bỏ charge + reel, fade thẳng tới kết quả đầy đủ.
   ========================================================= */

const TILE = 96          // bề ngang một ô thưởng trên dải
const GAP = 10
const STEP = TILE + GAP  // bước cách nhau của hai ô
const LAND = 21          // Ô ĐÍCH nằm ở vị trí này trên dải (cosmetic layout)
const REEL_MS = 2200

const Padlock = () => (
  <svg className="mystery-padlock" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
)

/* Dải trang trí: chuỗi CỐ ĐỊNH (không random) hoà trộn các loại ô cho giống
   một dải case-opening; ô tại LAND sẽ bị GHI ĐÈ bằng kết quả thật của server
   lúc mở. Thuần trình diễn — không liên quan xác suất. */
const FILLER = ['v1', 'x', 'v3', 'v5', 'x', 'v10', 'v1', 'paid', 'x', 'v3',
  'v5', 'x', 'v1', 'paid', 'x', 'v3', 'v10', 'x', 'v1', 'v5', 'x', 'v3', 'v5', 'paid']
const TILE_LABEL = {
  v1: '+1', v3: '+3', v5: '+5', v10: '+10', paid: '+1 req', x: '—',
}
const KIND_TO_TILE = { votes: null, nothing: 'x', paid_request: 'paid' }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MysteryBox({ userId, mystery, checkedIn, onOpened }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('idle')   // idle | charging | reeling
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [tiles, setTiles] = useState(FILLER)   // dải có ô đích được ghi đè
  const timers = useRef([])
  const busy = useRef(false)
  const resultRef = useRef(null)
  // onOpened là arrow inline của page (đổi identity mỗi lần page render — đồng
  // hồ tick 1s). Neo vào ref: finish phải ỔN ĐỊNH, nếu không effect reel sẽ
  // cleanup + đặt lại timeout vô hạn và reveal không bao giờ tới.
  const onOpenedRef = useRef(onOpened)
  onOpenedRef.current = onOpened
  const viewRef = useRef(null)
  const stripRef = useRef(null)
  const outcomeRef = useRef(null)

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    const refresh = () => { if (!document.hidden && onOpened) onOpened() }
    const storage = event => { if (event.key === MYSTERY_SYNC_KEY) refresh() }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [onOpened])

  const wait = ms => new Promise(resolve => timers.current.push(setTimeout(resolve, ms)))

  const finish = useCallback(() => {
    setPhase('idle')
    setReveal(true)
    onOpenedRef.current?.(resultRef.current?.mystery)
    // Trả focus về vùng kết quả — animation không được làm rơi focus.
    outcomeRef.current?.focus?.({ preventScroll: true })
  }, [])

  /* Reel: dải bắt đầu ở translateX(0); sau hai khung hình gán transform đích
     với transition giảm tốc 2,2s — ô tại LAND dừng đúng dưới vạch giữa.
     Hết nhịp (hoặc fallback timer) là reveal. */
  useEffect(() => {
    if (phase !== 'reeling') return
    const w = viewRef.current?.clientWidth || 284
    const offset = LAND * STEP + TILE / 2 - w / 2
    const strip = stripRef.current
    let raf = 0
    if (strip) {
      raf = requestAnimationFrame(() => requestAnimationFrame(() => {
        strip.style.transition = `transform ${REEL_MS}ms cubic-bezier(.1, .72, .14, 1)`
        strip.style.transform = `translateX(${-offset}px)`
      }))
    }
    const t = setTimeout(finish, REEL_MS + 180)
    timers.current.push(t)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [phase, finish])
  if (!mystery?.enabled) return null
  const day = mystery.day
  const opened = mystery.opened || (reveal && mystery.result !== null)


  const open = async () => {
    if (busy.current || phase !== 'idle' || opened || !checkedIn) return
    busy.current = true
    setError('')
    setReveal(false)
    // Kết quả do SERVER quyết: RPC chạy SONG SONG với nhịp charge; reel sau
    // đó chỉ diễn tả lại ô đích đã định.
    const rpc = openMysteryBox(userId, day)
    try {
      const quick = reducedMotion()
      if (quick) {
        resultRef.current = await rpc
        announceMysteryChanged()
        finish()
      } else {
        setPhase('charging')
        const [result] = await Promise.all([rpc, wait(450)])
        announceMysteryChanged()
        resultRef.current = result
        // Ghi đè ô đích trên dải bằng kết quả thật, rồi khởi động reel.
        const kind = result?.mystery?.reward_kind
        const votes = result?.mystery?.reward_votes
        const landed = kind === 'votes' ? `v${votes}` : (KIND_TO_TILE[kind] ?? 'x')
        setTiles(FILLER.map((k, i) => (i === LAND ? landed : k)))
        setPhase('reeling')
      }
    } catch (e) {
      timers.current.forEach(clearTimeout); timers.current = []
      setPhase('idle')
      setError(errMsg(t, e))
    } finally {
      busy.current = false
    }
  }

  const prize = opened ? mystery.result : null
  const kind = opened ? mystery.reward_kind : null
  const votes = opened ? mystery.reward_votes : 0
  const working = phase !== 'idle'

  return (
    <section
      className={`mystery-card${checkedIn ? '' : ' is-locked'}${opened ? ' is-opened' : ''}`
        + `${working ? ` is-${phase}` : ''}${reveal ? ' is-reveal' : ''}`}
      aria-label={t('mystery.cardLabel')}
      aria-busy={working}
    >
      <p className="mystery-title">{t('mystery.title')}</p>

      <div className="mystery-stage" aria-hidden="true">
        <span className="mystery-glow" />
        <span className="mystery-flash" />
        <div className="mystery-box">
          <span className="mystery-lid" />
          <span className="mystery-bow" />
          <span className="mystery-q">{checkedIn ? '?' : <Padlock />}</span>
        </div>
        <span className="mystery-shadow" />
      </div>

      {phase === 'reeling' && (
        <div className="mystery-reel" ref={viewRef} aria-hidden="true">
          <span className="mystery-marker" />
          <div className="mystery-strip" ref={stripRef}>
            {tiles.map((k, i) => (
              <span key={i} className={`mystery-tile ${k}${i === LAND ? ' is-land' : ''}`}>
                {TILE_LABEL[k]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* MỘT vùng trạng thái, aria-live: charge/reel/reveal đều được đọc ra
          tại đây; reveal nhận focus (tabIndex -1) để người màn hình đọc không
          bị rơi giữa chừng. */}
      <div className="mystery-outcome" role="status" aria-live="polite" tabIndex={-1} ref={outcomeRef}>
        {opened ? (
          <>
            <p key={prize} className={`mystery-prize ${kind}`}>
              {kind === 'nothing' && t('mystery.nothing')}
              {kind === 'votes' && (votes === 1 ? t('mystery.votesOne') : t('mystery.votesMany', { n: votes }))}
              {kind === 'paid_request' && t('mystery.paidRequest')}
            </p>
            <p className="mystery-again">{t('mystery.again')}</p>
          </>
        ) : checkedIn ? (
          working
            ? <p className="mystery-openlabel">{t('mystery.opening')}</p>
            : <>
              <p className="mystery-copy">{t('mystery.ready')}</p>
              <button type="button" className="btn btn-primary mystery-open" onClick={open}>
                {t('mystery.openNow')}
              </button>
            </>
        ) : (
          <p className="mystery-copy">{t('mystery.locked')}</p>
        )}
      </div>

      {error ? <p className="mystery-error" role="alert">{error}</p> : null}
    </section>
  )
}

export default MysteryBox
