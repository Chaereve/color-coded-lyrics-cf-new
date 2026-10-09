import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY, REEL_TARGET_INDEX,
} from '../lib/mysteryBox.js'
import CaseOpeningReel from './CaseOpeningReel.jsx'
import './MysteryBox.css'

/* =========================================================
   MYSTERY BOX — case-opening reel (v3, feedback 2026-10-09)
   ---------------------------------------------------------
   NĂM TRẠNG THÁI: locked → available → opening (charge → reel) → reveal
   → already. Route/gate/luật 1 lần-ngày-sau-check-in GIỮ NGUYÊN.

   NHỊP MỞ (~4,1s, khoá nút NGAY khi bấm):
     t0      charge 450ms — hộp co người, sáng thắt; RPC openMysteryBox chạy
             SONG SONG ngay từ t0: kết quả do SERVER quyết TRƯỚC khi reel dừng
     ~450ms  CASE REEL (CaseOpeningReel — chỉ Mystery dùng) chạy 3,6s qua kim
             giữa và dừng đúng ô kết quả server trả (ô tại REEL_TARGET_INDEX
             được GHI ĐÈ bằng kết quả thật — client không chọn, không
             Math.random)
     dừng    chớp sáng + prize pop; "Nothing" vẫn có chớp + pop + copy riêng

   Reduced-motion: bỏ charge + reel, fade thẳng tới kết quả đầy đủ.
   ========================================================= */

/* Dải trang trí CỐ ĐỊNH (không random) — kindClass theo thang reel chung. */
const FILLER = ['s1', 'none', 's2', 's3', 'none', 's4', 's1', 's5', 'none',
  's2', 's3', 'none', 's1', 's5', 'none', 's2', 's4', 'none', 's1', 's3', 'none']
const TAIL = ['none', 's1', 's3', 'none', 's2', 'none']
const KIND_LABEL = {
  s1: '+1', s2: '+3', s3: '+5', s4: '+10', s5: '+1', none: '—',
}
/* Kết quả server → ô trên reel (chỉ hiển thị, không quyết kết quả).
   Paid có HAI mức phân biệt bằng con số: result 5 = +1, result 6 = +2 (v1
   row 'paid_request' luôn là +1). Dấu ô: s5 = ô giải paid. */
const RESULT_TILE = {
  nothing: { kind: 'none', label: '—' },
  paid_request: { kind: 's5', label: '+1' },
  free_paid_request: { kind: 's5', label: '' },  // label theo result bên dưới
}
const VOTES_TILE = { 1: 's1', 3: 's2', 5: 's3', 10: 's4' }
const MYSTERY_REEL_MS = 3600

const Padlock = () => (
  <svg className="mystery-padlock" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
)

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MysteryBox({ userId, mystery, checkedIn, onOpened }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('idle')   // idle | charging | reeling
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [winTile, setWinTile] = useState(null) // ô kết quả server (kind+label)
  const timers = useRef([])
  const busy = useRef(false)
  const resultRef = useRef(null)
  const outcomeRef = useRef(null)
  // onOpened là arrow inline của page (đổi identity mỗi lần page render — đồng
  // hồ tick 1s). Neo vào ref: finish phải ỔN ĐỊNH, nếu không effect reel sẽ
  // cleanup + đặt lại timeout vô hạn và reveal không bao giờ tới.
  const onOpenedRef = useRef(onOpened)
  // Neo callback QUA EFFECT (gán ref lúc render là副作用 cấm — react-compiler).
  useEffect(() => { onOpenedRef.current = onOpened })

  const finish = useCallback(() => {
    setPhase('idle')
    setReveal(true)
    onOpenedRef.current?.(resultRef.current?.mystery)
    // Trả focus về vùng kết quả — animation không được làm rơi focus.
    outcomeRef.current?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    const refresh = () => { if (!document.hidden && onOpenedRef.current) onOpenedRef.current() }
    const storage = event => { if (event.key === MYSTERY_SYNC_KEY) refresh() }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [])

  if (!mystery?.enabled) return null
  const day = mystery.day
  const opened = mystery.opened || (reveal && mystery.result !== null)

  const wait = ms => new Promise(resolve => timers.current.push(setTimeout(resolve, ms)))

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
        const prizeResult = result?.mystery?.result
        const votes = result?.mystery?.reward_votes
        if (kind === 'votes') {
          setWinTile({ kind: VOTES_TILE[votes] || 's1', label: `+${votes}` })
        } else if (kind === 'free_paid_request' || kind === 'paid_request') {
          // Hai mức paid phân biệt bằng con số trên ô: +1 hay +2. Số đọc từ
          // reward_amount SERVER trả (master prompt); payload cũ thiếu trường
          // thì derive theo result — không bao giờ tự chế số khác.
          const amount = Number.isInteger(result?.mystery?.reward_amount)
            ? result.mystery.reward_amount
            : (prizeResult === 6 ? 2 : 1)
          setWinTile({ kind: 's5', label: `+${amount}` })
        } else {
          setWinTile(RESULT_TILE[kind] || RESULT_TILE.nothing)
        }
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

  const working = phase !== 'idle'
  const prize = opened ? mystery.result : null
  const kind = opened ? mystery.reward_kind : null
  const votes = opened ? mystery.reward_votes : 0

  const fillerTile = k => ({ kind: k, label: KIND_LABEL[k] })
  const items = [
    ...FILLER.map(fillerTile),
    winTile || fillerTile('none'),   // ô đích — được ghi đè bằng kết quả server
    ...TAIL.map(fillerTile),
  ]

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

      {/* Trạng thái hôm nay — không tiết lộ outcome, chỉ còn/đã mở. */}
      <p className={`mystery-statuschip${opened ? ' done' : ''}`}>
        {opened ? t('mystery.todayDone') : t('mystery.todayOpen')}
      </p>

      {phase === 'reeling' && (
        <CaseOpeningReel items={items} spinning targetIndex={REEL_TARGET_INDEX}
          duration={MYSTERY_REEL_MS} onSettled={finish}
          label={t('mystery.cardLabel')} />
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
              {(kind === 'paid_request' || kind === 'free_paid_request')
                && t((Number.isInteger(mystery.reward_amount) && mystery.reward_amount > 0
                  ? mystery.reward_amount
                  : (prize === 6 ? 2 : 1)) === 2 ? 'mystery.paidRequestTwo' : 'mystery.paidRequestOne')}
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
