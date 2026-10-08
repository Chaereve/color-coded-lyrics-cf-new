import { useEffect, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY,
} from '../lib/mysteryBox.js'
import './MysteryBox.css'

/* =========================================================
   MYSTERY BOX CARD — case-opening reveal (B2 polish 2026-10)
   ---------------------------------------------------------
   NĂM TRẠNG THÁI, đều do DỮ LIỆU THẬT quyết định:
     · locked    : chưa check-in hôm nay — hộp khoá, ổ khoá trên nắp
     · available : đã check-in, chưa mở — hộp "thở" mời gọi + nút Open
     · opening   : ĐANG MỞ theo một timeline chặt (khoá nút NGAY khi bấm):
         t0          charge  ~600ms  hộp "co người", ánh sáng thắt lại
                              — RPC mở hộp chạy SONG SONG trong lúc charge,
                                kết quả do server quyết TRƯỚC khi lộ ra
         ~600ms      shake   ~650ms  hộp rung, nắp nảy
         ~1250ms     reveal          tia sáng + nắp bay + phần thưởng pop
       Tổng ~2s. Reduced-motion bỏ cả hai nhịp đầu — kết quả hiện tức thì.
     · reveal    : phần thưởng lớn, rõ (kể cả "Nothing" vẫn có tia + pop —
                   không bao giờ trống rỗng như một lỗi)
     · already   : đã mở hôm nay — kết quả + lời hẹn hộp mới, KHÔNG còn CTA
   ========================================================= */

const Padlock = () => (
  <svg className="mystery-padlock" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
)

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MysteryBox({ userId, mystery, checkedIn, onOpened }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('idle')       // idle | charging | shaking
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const timers = useRef([])
  const busy = useRef(false)

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    const refresh = () => { if (!document.hidden && onOpened) onOpened() }
    const storage = event => { if (event.key === MYSTERY_SYNC_KEY) refresh() }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [onOpened])

  if (!mystery?.enabled) return null
  const day = mystery.day
  const opened = mystery.opened || (reveal && mystery.result !== null)

  const open = async () => {
    if (busy.current || phase !== 'idle' || opened || !checkedIn) return
    busy.current = true
    setError('')
    // Kết quả do SERVER quyết: RPC chạy song song với nhịp charge; UI chỉ
    // diễn tả đúng kết quả đó, không chọn gì ở client.
    const rpc = openMysteryBox(userId, day)
    const wait = ms => new Promise(resolve => timers.current.push(setTimeout(resolve, ms)))
    try {
      const quick = reducedMotion()
      const charge = quick ? 0 : 600
      const shake = quick ? 0 : 650
      setPhase('charging')
      const [result] = await Promise.all([
        rpc,
        wait(charge).then(() => { if (!quick) setPhase('shaking') }),
      ])
      announceMysteryChanged()
      await wait(shake)
      setPhase('idle')
      setReveal(true)
      if (onOpened) onOpened(result.mystery)
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

  return (
    <section
      className={`mystery-card${checkedIn ? '' : ' is-locked'}${opened ? ' is-opened' : ''}`
        + `${phase !== 'idle' ? ` is-${phase}` : ''}${reveal ? ' is-reveal' : ''}`}
      aria-label={t('mystery.cardLabel')}
      aria-busy={phase !== 'idle'}
    >
      <p className="mystery-title">{t('mystery.title')}</p>

      <div className="mystery-stage" aria-hidden="true">
        <span className="mystery-glow" />
        <span className="mystery-rays">
          {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ '--ray': `${i * 45}deg` }} />)}
        </span>
        <div className="mystery-box">
          <span className="mystery-lid" />
          <span className="mystery-bow" />
          <span className="mystery-q">{checkedIn ? '?' : <Padlock />}</span>
        </div>
        <span className="mystery-shadow" />
      </div>

      {/* MỘT vùng trạng thái, aria-live: mọi bước (mở → lộ quà) được đọc ra
          mà focus không phải di chuyển. */}
      <div className="mystery-outcome" role="status" aria-live="polite">
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
          phase !== 'idle'
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
