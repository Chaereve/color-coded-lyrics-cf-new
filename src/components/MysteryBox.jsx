import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY,
  REEL_TARGET_INDEX, REEL_ITEM_COUNT,
} from '../lib/mysteryBox.js'
import { confettiBurst } from '../lib/confetti.js'
import CaseOpeningReel from './CaseOpeningReel.jsx'
import './MysteryBox.css'

/* =========================================================
   DAILY BOX — hộp quà 3D + reel trồi lên (vòng 5, theo BẢN MẪU chủ sở hữu)
   ---------------------------------------------------------
   NĂM TRẠNG THÁI: locked → available → opening (shake → open → reel) →
   reveal → already. Route/gate/luật 1 lần-ngày-sau-check-in GIỮ NGUYÊN.

   NHỊP MỞ (~7s, khoá nút NGAY khi bấm — kết quả do SERVER quyết từ t0 vì
   RPC chạy SONG SONG với nhịp lắc):
     t0      LẮC 800ms — hộp lắc lư (rotate ±6°, vibrate nhẹ); RPC
             openMysteryBox chạy SONG SONG ngay từ t0
     ~0,8s   MỞ NẮP — nắp lật ngửa 112° quanh BẢN LỀ CẠNH SAU (transform-
             style preserve-3d), tia sáng bung từ hộp, starfield sẵn sẵn
     ~1,3s   REEL TRỒI LÊN nằm PHÍA TRÊN hộp (.rw.up, overshoot) — 44 ô,
             dừng CHÍNH XÁC ô kết quả server trả dưới kim giữa (~4,6s trượt
             giảm tốc), kim nảy theo từng ô
     dừng    ô đích sáng + còn lại mờ + rays xoay theo độ hiếm + confetti +
             rbar hiện kết quả (label bắt buộc: +N votes / +1/+2 free paid
             requests / Better luck next time) + countdown hộp kế

   Ô trên dải: FILLER TẤT ĐỊNH (không random), ô đích GHI ĐÈ bằng kết quả
   server. Reduced-motion: bỏ lắc + reel dài, fade thẳng tới kết quả đầy đủ.
   ========================================================= */

/* Dải trang trí CỐ ĐỊNH (không random) — chu kỳ 6 kind, ô đích ghi đè. */
const FILLER_CYCLE = ['s1', 'none', 's2', 's3', 'none', 's4', 's1', 's5', 'none', 's2']
const TAIL_CYCLE = ['none', 's1', 's3', 'none', 's2', 'none', 's1', 'none', 's3']
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
const MYSTERY_SHAKE_MS = 800   // lắc trước khi mở nắp
const MYSTERY_RISE_MS = 950    // reel trồi lên phía trên hộp
const MYSTERY_REEL_MS = 4600   // trượt giảm tốc tới ô đích

/* Độ hiếm hiển thị (màu rays/rbar) theo outcome — chỉ trình diễn. */
const RARITY_CLASS = { 0: 'r0', 1: 'r0', 2: 'r1', 3: 'r1', 4: 'r2', 5: 'r2', 6: 'r3' }
const rarityOf = (kind, result) => (kind === 'nothing' ? 'r0' : RARITY_CLASS[result] || 'r1')

/* Sao trời TẤT ĐỊNH: 18 điểm [left%, top%, delay s] — không Math.random. */
const STARS = [
  [6, 12, 0], [14, 64, .7], [22, 30, 1.4], [31, 82, .3], [38, 8, 2.1],
  [46, 52, 1.1], [54, 18, .5], [61, 74, 1.8], [69, 38, .9], [77, 88, 2.4],
  [84, 22, .2], [92, 58, 1.5], [11, 42, 2.2], [27, 6, 1.9], [49, 90, .6],
  [66, 10, 1.2], [81, 46, 2.0], [95, 84, .8],
]

const GiftGlyph = () => (
  <svg className="box-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20 7h-2.2a3.2 3.2 0 0 0 .2-1.1A2.9 2.9 0 0 0 15.1 3c-1.2 0-2.3.6-3.1 1.6A4.2 4.2 0 0 0 8.9 3 2.9 2.9 0 0 0 6 5.9c0 .4.1.8.2 1.1H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7.6h2V12h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM8.9 5a1 1 0 0 1 1 1v1H8.1a1.1 1.1 0 0 1-1.1-1.1A.9.9 0 0 1 7.9 5zm6.2 2h-1.8V6a1 1 0 0 1 1-1 1 1 0 0 1 1.1 1.1c0 .5-.1.9-.3.9zM5 13v6.2A1.8 1.8 0 0 0 6.8 21H11v-8zm8 8h4.2a1.8 1.8 0 0 0 1.8-1.8V13h-6z" />
  </svg>
)

const Padlock = () => (
  <svg className="mystery-padlock" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
)

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MysteryBox({ userId, mystery, checkedIn, onOpened, nextResetAt = null }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('idle')   // idle | shaking | reeling
  const [risen, setRisen] = useState(false)    // reel đã trồi lên (điều khiển .up)
  const [reveal, setReveal] = useState(false)
  const [winTile, setWinTile] = useState(null) // ô kết quả server (kind+label)
  const [winRarity, setWinRarity] = useState('r1')
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() => Date.now())
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
    const result = resultRef.current
    // Rays + confetti theo độ hiếm — chỉ trình diễn sau khi reel dừng.
    const stage = outcomeRef.current?.closest('.box-stage')
    if (stage && !reducedMotion()) {
      const reelEl = stage.querySelector('.reel-viewport')
      if (reelEl) {
        const r = reelEl.getBoundingClientRect()
        const kind = result?.mystery?.reward_kind
        const big = kind === 'free_paid_request' || (result?.mystery?.reward_votes ?? 0) >= 10
        confettiBurst(r.left + r.width / 2, r.top + r.height / 2, big ? 170 : 90)
      }
    }
    onOpenedRef.current?.(result?.mystery)
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

  // Đồng hồ đếm ngược hộp kế — chỉ chạy khi đã mở và có mốc reset.
  useEffect(() => {
    if (!nextResetAt) return undefined
    const tick = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [nextResetAt])

  /* useMemo TRƯỚC early-return (luật hooks) + identity ỔN ĐỊNH qua mỗi
     re-render của page (đồng hồ/props) — reel tính offset MỘT lần từ items;
     mảng mới giữa nhịp làm nó snap lại. */
  const fillerTile = k => ({ kind: k, label: KIND_LABEL[k] })
  const items = useMemo(() => [
    ...Array.from({ length: REEL_TARGET_INDEX }, (_, i) => fillerTile(FILLER_CYCLE[i % FILLER_CYCLE.length])),
    winTile ? { ...winTile, win: true } : fillerTile('none'),   // ô đích — kết quả server
    ...Array.from({ length: REEL_ITEM_COUNT - REEL_TARGET_INDEX - 1 }, (_, i) => fillerTile(TAIL_CYCLE[i % TAIL_CYCLE.length])),
  ], [winTile])

  if (!mystery?.enabled) return null
  const day = mystery.day
  const opened = mystery.opened || (reveal && mystery.result !== null)

  const wait = ms => new Promise(resolve => timers.current.push(setTimeout(resolve, ms)))

  const open = async () => {
    if (busy.current || phase !== 'idle' || opened || !checkedIn) return
    busy.current = true
    setError('')
    setReveal(false)
    setRisen(false)
    // Kết quả do SERVER quyết: RPC chạy SONG SONG với nhịp lắc; reel sau đó
    // chỉ diễn tả lại ô đích đã định.
    const rpc = openMysteryBox(userId, day)
    try {
      const quick = reducedMotion()
      if (quick) {
        resultRef.current = await rpc
        announceMysteryChanged()
        finish()
      } else {
        setPhase('shaking')
        navigator.vibrate?.([30, 40, 30])
        const [result] = await Promise.all([rpc, wait(MYSTERY_SHAKE_MS)])
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
          // reward_amount SERVER trả; payload cũ thì derive theo result.
          const amount = Number.isInteger(result?.mystery?.reward_amount)
            ? result.mystery.reward_amount
            : (prizeResult === 6 ? 2 : 1)
          setWinTile({ kind: 's5', label: `+${amount}` })
        } else {
          setWinTile(RESULT_TILE[kind] || RESULT_TILE.nothing)
        }
        setWinRarity(rarityOf(kind, prizeResult))
        setPhase('reeling')
        // Reel TRỒI LÊN sau một nhịp paint; CaseOpeningReel tự chờ `hold`
        // (bằng đúng nhịp rise) rồi mới trượt tới ô đích.
        timers.current.push(setTimeout(() => setRisen(true), 60))
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
  const rarity = opened ? rarityOf(kind, prize) : 'r0'
  const countdown = opened && nextResetAt
    ? Math.max(0, nextResetAt - clock)
    : null


  return (
    <div className="box-wrap">
      {/* SÂN KHẤU: sao trời + rays + reel TRÊN + hộp quà 3D (nắp bản lề sau) */}
      <div className={`box-stage${checkedIn ? '' : ' is-locked'}${opened ? ' is-opened' : ''}`
        + `${working ? ` is-${phase}` : ''}${reveal ? ' is-reveal' : ''}${risen ? ' is-risen' : ''}`}>
        <span className={`box-rays ${winRarity}`} aria-hidden="true" />
        {STARS.map(([left, top, delay], i) => (
          <i key={i} className="box-star" aria-hidden="true"
            style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }} />
        ))}
        {!opened && (
          <p className="box-hint" aria-hidden="true">
            {checkedIn ? t('mystery.tap') : t('mystery.locked')}
          </p>
        )}

        {/* Reel GIỮ NGUYÊN qua reveal (không unmount — không mất transform):
            đang chạy thì spinning, reveal thì settled highlight ô đích. */}
        {(phase === 'reeling' || reveal) && (
          <div className={`box-reel${risen ? ' up' : ''}`} aria-hidden="true">
            <CaseOpeningReel items={items} spinning={phase === 'reeling'}
              settled={reveal} targetIndex={REEL_TARGET_INDEX}
              duration={MYSTERY_REEL_MS} hold={MYSTERY_RISE_MS} onSettled={finish}
              label={t('mystery.cardLabel')} />
          </div>
        )}

        {/* HỘP QUÀ 3D: chính hộp là NÚT MỞ (mẫu gốc) — keyboard + aria-label. */}
        <button type="button" className={`box3d${working ? ' working' : ''}`}
          onClick={open}
          disabled={!checkedIn || opened || working}
          aria-label={opened ? t('mystery.todayDone')
            : checkedIn ? t('mystery.openNow') : t('mystery.lockedAria')}>
          <span className="box-shadow" aria-hidden="true" />
          <span className="box-beam" aria-hidden="true" />
          <span className="cube" aria-hidden="true">
            <span className="bd">
              <i className="f in ib" /><i className="f in il" /><i className="f in ir" />
              <i className="f gl" />
              <i className="f fr s" /><i className="f bk" /><i className="f lf" /><i className="f rt s" />
              {opened ? null : <span className="box-face-mark">{checkedIn ? '?' : <Padlock />}</span>}
            </span>
            <span className="lid">
              <i className="f lu" /><i className="f fr s" /><i className="f bk" />
              <i className="f lf" /><i className="f rt s" /><i className="f lt s" />
              <span className="bow"><u /></span>
            </span>
          </span>
        </button>
      </div>

      {/* THANH KẾT QUẢ: MỘT vùng live — locked/ready/mở/résultat + countdown. */}
      <div className={`box-bar ${rarity}`} role="status" aria-live="polite" aria-atomic="true"
        tabIndex={-1} ref={outcomeRef}>
        <span className="box-bar-icon">{opened ? <GiftGlyph /> : <GiftGlyph />}</span>
        <span className="box-bar-text">
          <b className="box-bar-pn">
            {error
              ? error
              : working
                ? t('mystery.opening')
                : opened
                ? <span key={prize} className={`box-prize ${kind}`}>
                  {kind === 'nothing' && t('mystery.nothing')}
                  {kind === 'votes' && (votes === 1 ? t('mystery.votesOne') : t('mystery.votesMany', { n: votes }))}
                  {(kind === 'paid_request' || kind === 'free_paid_request')
                    && t((Number.isInteger(mystery.reward_amount) && mystery.reward_amount > 0
                      ? mystery.reward_amount
                      : (prize === 6 ? 2 : 1)) === 2 ? 'mystery.paidRequestTwo' : 'mystery.paidRequestOne')}
                </span>
                : checkedIn ? t('mystery.readyBar') : t('mystery.locked')}
          </b>
          <small className="box-bar-sub">
            {opened
              ? t('mystery.nextBox', {
                time: countdown === null ? '--:--:--' : clockText(countdown),
              })
              : checkedIn ? t('mystery.tap') : t('mystery.goCheckin')}
          </small>
        </span>
      </div>
    </div>
  )
}

/* hh:mm:ss từ ms — cùng phong cách spinCountdown nhưng dùng Date (mốc epoch). */
function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(v => String(v).padStart(2, '0')).join(':')
}

export default MysteryBox
