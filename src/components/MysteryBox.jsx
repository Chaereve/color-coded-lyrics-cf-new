import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY,
  REEL_TARGET_INDEX, REEL_ITEM_COUNT,
} from '../lib/mysteryBox.js'
import { confettiBurst } from '../lib/confetti.js'
import { sfx } from '../lib/sfx.js'
import CaseOpeningReel from './CaseOpeningReel.jsx'
import Icon from './Icon.jsx'
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
     ~0,8s   MỞ NẮP — nắp lật ngửa quanh BẢN LỀ CẠNH SAU (transform-style
             preserve-3d, rotateX 158°), tia sáng bung từ hộp, starfield sẵn sẵn
     ~1,3s   REEL TRỒI LÊN nằm PHÍA TRÊN hộp (.rw.up, overshoot) — 44 ô,
             dừng CHÍNH XÁC ô kết quả server trả dưới kim giữa (~4,6s trượt
             giảm tốc), kim nảy theo từng ô
   dừng    ô đích sáng + còn lại mờ + rays xoay theo độ hiếm + confetti +
            rbar hiện kết quả (label bắt buộc: +N votes / +1/+2 free paid
            requests / Better luck next time) + countdown hộp kế
   +1,8s   ĐÓNG NẮP (is-settled): hộp TRÚNG cũng phải sập nắp — sân khấu
            lặng xuống (reel phai, rays/beam tắt, veil mờ), quà đọc trên
            box-bar. Hộp không trượt đi đường is-miss riêng (đóng sau 900ms).
            Vào lại trang/tab khác với hộp đã mở: nắp đóng NGAY, không diễn lại

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
const MYSTERY_MISS_MS = 900    // hộp không: xem kết quả rồi đóng nắp + phai
const MYSTERY_SETTLE_MS = 1800 // hộp TRÚNG: xem ô thưởng/rays/confetti một
                               // nhịp rồi ĐÓNG NẮP, sân khấu lặng xuống —
                               // kết quả vẫn đọc trên thanh box-bar

/* Độ hiếm hiển thị (màu rays/rbar) theo outcome — chỉ trình diễn. */
const RARITY_CLASS = { 0: 'r0', 1: 'r0', 2: 'r1', 3: 'r1', 4: 'r2', 5: 'r2', 6: 'r3' }
const rarityOf = (kind, result) => (kind === 'nothing' ? 'r0' : RARITY_CLASS[result] || 'r1')

/* Sao trời TẤT ĐỊNH: 18 điểm [left%, top%, delay s] — không Math.random. */
const STARS = [
  [12, 18, 0], [28, 8, 1.1], [48, 22, .4], [70, 12, 1.6],
  [86, 28, .8], [18, 72, 2], [78, 68, 1.3], [92, 80, .5],
]
/* Tia nổ lúc mở nắp — vị trí tất định, chỉ chạy khi is-reeling. */
const SPARKS = [
  [46, 36, 0], [54, 32, .08], [40, 40, .14], [60, 38, .2],
  [50, 28, .1], [36, 34, .22], [64, 30, .16], [48, 44, .26],
]

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
  const [settled, setSettled] = useState(false) // trúng thưởng: đã đóng nắp sau reveal
  const [winTile, setWinTile] = useState(null) // ô kết quả server (kind+label)
  const [winRarity, setWinRarity] = useState('r1')
  const [error, setError] = useState('')
  const [miss, setMiss] = useState(() => !!mystery?.opened && mystery.reward_kind === 'nothing')
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
    const kind = result?.mystery?.reward_kind
    const votes = result?.mystery?.reward_votes ?? 0
    const empty = kind === 'nothing'
    if (empty) sfx.boxEmpty()
    else sfx.boxWin(kind === 'free_paid_request' || votes >= 10)
    // Rays + confetti theo độ hiếm — hộp không thì không bung giấy.
    const stage = outcomeRef.current?.closest('.box-stage')
    if (stage && !empty && !reducedMotion()) {
      const reelEl = stage.querySelector('.reel-viewport')
      if (reelEl) {
        const r = reelEl.getBoundingClientRect()
        const big = kind === 'free_paid_request' || votes >= 10
        confettiBurst(r.left + r.width / 2, r.top + r.height / 2, big ? 170 : 90)
      }
    }
    if (empty) {
      const wait = reducedMotion() ? 0 : MYSTERY_MISS_MS
      timers.current.push(setTimeout(() => setMiss(true), wait))
    } else {
      /* Trúng thưởng cũng phải ĐÓNG NẮP: cho người chơi thấy ô thưởng,
         rays + confetti một nhịp, rồi sân khấu lặng xuống (nắp sập, reel
         phai, đèn tắt). Quà không mất — nó nằm trên thanh box-bar kèm
         đồng hồ hộp kế. Không hẹn thì hộp mở nắp CẢ NGÀY. */
      timers.current.push(setTimeout(() => setSettled(true), reducedMotion() ? 0 : MYSTERY_SETTLE_MS))
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

  /* Tab khác / lần vào lại: hộp không thì nắp đã đóng. Không đụng nhịp
     mở đang chạy (reveal) — finish tự hẹn đóng sau MYSTERY_MISS_MS. */
  useEffect(() => {
    if (phase !== 'idle' || reveal) return
    if (mystery?.opened && mystery.reward_kind === 'nothing') setMiss(true)
  }, [mystery?.opened, mystery?.reward_kind, phase, reveal])

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
    setMiss(false)
    setSettled(false)
    sfx.boxOpen()
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
  /* Nắp chỉ mở TRONG NHỊP diễn (reeling/reveal). Đã mở xong — trúng hay
     trượt, ở bản địa sau khi settle hay vào lại trang/tab khác (opened mà
     không có reveal cục bộ) — hộp ĐÓNG NẮP, sân khấu lặng; kết quả hôm nay
     đọc trên thanh box-bar. Hộp trượt đi thêm đường is-miss (đóng sớm 900ms). */
  const closedLook = miss || settled || (opened && !reveal)
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
        + `${working ? ` is-${phase}` : ''}${reveal ? ' is-reveal' : ''}${risen ? ' is-risen' : ''}`
        + `${miss ? ' is-miss' : ''}${closedLook ? ' is-settled' : ''}`}>
        {/* FX ngoài cây 3D — overflow:hidden không cắt preserve-3d. */}
        <div className="box-stage-fx" aria-hidden="true">
          <span className={`box-rays ${winRarity}`} />
          <span className="box-beam" />
          {STARS.map(([left, top, delay], i) => (
            <i key={i} className="box-star"
              style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }} />
          ))}
          {SPARKS.map(([left, top, delay], i) => (
            <i key={`spk-${i}`} className="box-spark"
              style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }} />
          ))}
        </div>
        <span className="box-stage-veil" aria-hidden="true" />
        <span className="box-floor" aria-hidden="true" />

        {(phase === 'reeling' || reveal) && (
          <div className={`box-reel${risen ? ' up' : ''}`} aria-hidden="true">
            <CaseOpeningReel items={items} spinning={phase === 'reeling'}
              settled={reveal} targetIndex={REEL_TARGET_INDEX}
              duration={MYSTERY_REEL_MS} hold={MYSTERY_RISE_MS} onSettled={finish}
              label={t('mystery.cardLabel')} />
          </div>
        )}

        <div className="box-slot">
          <button type="button" className={`box3d${working ? ' working' : ''}`}
            onClick={open}
            disabled={!checkedIn || opened || working}
            aria-label={opened ? t('mystery.todayDone')
              : checkedIn ? t('mystery.openNow') : t('mystery.lockedAria')}>
            <span className="cube" aria-hidden="true">
              <span className="box-body">
                <i className="box-face box-in box-in-b" />
                <i className="box-face box-in box-in-l" />
                <i className="box-face box-in box-in-r" />
                <i className="box-face box-glow" />
                <i className="box-face box-front box-ribbon" />
                <i className="box-face box-back" />
                <i className="box-face box-left" />
                <i className="box-face box-right box-ribbon" />
                {opened || working ? null : <span className="box-face-mark">{checkedIn ? '?' : <Padlock />}</span>}
              </span>
              <span className="box-lid">
                <i className="box-face box-lid-under" />
                <i className="box-face box-front box-ribbon" />
                <i className="box-face box-back" />
                <i className="box-face box-left" />
                <i className="box-face box-right box-ribbon" />
                <i className="box-face box-lid-top box-ribbon" />
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* THANH KẾT QUẢ: MỘT vùng live — locked/ready/mở/résultat + countdown. */}
      <div className={`box-bar ${rarity}`} role="status" aria-live="polite" aria-atomic="true"
        tabIndex={-1} ref={outcomeRef}>
        <span className="box-bar-icon"><Icon name="gift" size={30} className="box-glyph" /></span>
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
