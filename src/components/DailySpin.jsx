import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDailySpinStatus, performDailySpin, hasSupabase } from '../lib/db'
import { warmCaptcha } from '../lib/spinShield.js'
import {
  DAILY_SPIN_LIMIT, SPIN_REWARDS, SPIN_TIME_ZONE,
  SPIN_RING, spinRingSlot, spinRingTarget, spinCountdown, spinSectorIndex, spinTier,
} from '../lib/dailySpin'
import { confettiBurst } from '../lib/confetti.js'
import {
  SPIN_SYNC_KEY, readPendingSpin, getPendingSpin, clearPendingSpin,
  announceSpinChange, withSpinLock, resetSpinDevice,
} from '../lib/spinDevice'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { sfx } from '../lib/sfx'
import './DailySpin.css'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const timeOf = iso => new Intl.DateTimeFormat('en-GB', {
  timeZone: SPIN_TIME_ZONE, hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

/* =========================================================
   DAILY SPIN — BOARD 7×5 (vòng 5, theo BẢN MẪU của chủ sở hữu)
   ---------------------------------------------------------
   20 ô vuông BAO QUANH một lõi chữ nhật (CSS grid 7×5, lõi chiếm
   grid-area 2/2/5/7). Bấm SPIN:
     1. PREPARE — khoá nút ngay, xoá win cũ, aria-live báo "Good luck…",
        gọi performDailySpin (flow hiện tại giữ nguyên: idempotency, quota,
        no-repeat, edge gate/Turnstile, cap, server draw).
     2. RING RUN — đèn chạy VÒNG QUANH 20 ô theo chiều kim đồng hồ, đuôi
        comet 3 ô (.on/.t1/.t2), ≥ 3 vòng, ease-out quint (nhanh → chậm dần).
        Con số giữa lõi đổi theo ô đèn đang chạy.
     3. LAND — dừng ĐÚNG ô chứa mức giải SERVER trả (spinRingTarget chọn ô
        tất định phía trước; client KHÔNG random, KHÔNG chọn thưởng). Ô trúng
        nổ (.win pulse), cả board mờ đi trừ ô trúng, confetti bung một nhịp.
     4. RESULT — lõi hiện "+N bonus votes" + độ hiếm; còn lượt thì nút bật
        lại, hết lượt thì nút thành đếm ngược tới reset.
     5. ERROR — dừng an toàn, bật lại nút, lỗi i18n; không tạo thưởng/lượt.

   20 ô lặp lại 7 mức giải THEO TRỌNG SỐ (1×5 · 2×4 · 3×4 · 5×2 · 8×2 ·
   10×2 · 20×1) — ô nào trúng vẫn do server quyết, board chỉ là bàn diễn.
   Reduced-motion: chạy nhanh đều (18ms/bước), vẫn dừng đúng ô + đủ kết quả.
   ========================================================= */

const RING_RUN_STEPS = 60   // tối thiểu 3 vòng trước khi đáp
const rarityOfTier = tier => (tier <= 3 ? 0 : tier <= 5 ? 1 : tier === 6 ? 2 : 3)
const rarityOfReward = (reward, rewards) => rarityOfTier(Number(spinTier(reward, rewards).slice(1)))
const RARITY_KEYS = ['rar.common', 'rar.rare', 'rar.epic', 'rar.legendary']

/* Icon riêng từng mức (đa dạng ô) — SVG fill-currentColor trên lưới 24. */
const ICON_PATHS = {
  1: (  // cỏ bốn lá
    <><circle cx="8.4" cy="8.4" r="3.8" /><circle cx="15.6" cy="8.4" r="3.8" />
      <circle cx="12" cy="13.8" r="4.2" /><path d="M10.9 14.6c-.8 2.9-2.6 4.9-5.2 6.2 3.1-.3 5.5-1.4 7-3.3z" /></>
  ),
  2: (<path d="M12 2.4l2.9 6 6.6.9-4.8 4.5 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.3l6.6-.9z" />),
  3: (<path d="M13.4 2 4.6 13.6h5.9L9.1 22l8.9-12.4h-6.1z" />),
  5: (<path d="M6.2 8.6 12 2.2l5.8 6.4L12 21.8z" />),
  8: (  // hoa nổ
    <><circle cx="12" cy="5.6" r="3.3" /><circle cx="12" cy="18.4" r="3.3" />
      <circle cx="5.6" cy="12" r="3.3" /><circle cx="18.4" cy="12" r="3.3" />
      <circle cx="12" cy="12" r="3" /></>
  ),
  10: ( // cúp
    <path d="M7 3.2h10v2.6h3.6v2.6a5.1 5.1 0 0 1-4.5 5.1 5.7 5.7 0 0 1-2.1 2v2h3v3.3H7v-3.3h3v-2a5.7 5.7 0 0 1-2.1-2 5.1 5.1 0 0 1-4.5-5.1V5.8H7zm-1.7 5.2v.9c0 1.2.8 2.3 2 2.8a10 10 0 0 1-.2-3.7zm13.4 0h-1.8a10 10 0 0 1-.2 3.7c1.2-.5 2-1.6 2-2.8z" />
  ),
  20: ( // vương miện
    <><path d="M2.9 8.7 8.1 11.7 12 4.5l3.9 7.2 5.2-3L19.2 19H4.8z" />
      <rect x="4.8" y="20.1" width="14.4" height="1.9" rx=".95" /></>
  ),
}
const CellIcon = ({ reward }) => (
  <svg className="spin-cell-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {ICON_PATHS[reward]}
  </svg>
)
const GiftIcon = () => (
  <svg className="spin-now-gift" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20 7h-2.2a3.2 3.2 0 0 0 .2-1.1A2.9 2.9 0 0 0 15.1 3c-1.2 0-2.3.6-3.1 1.6A4.2 4.2 0 0 0 8.9 3 2.9 2.9 0 0 0 6 5.9c0 .4.1.8.2 1.1H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7.6h2V12h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zM8.9 5a1 1 0 0 1 1 1v1H8.1a1.1 1.1 0 0 1-1.1-1.1A.9.9 0 0 1 7.9 5zm6.2 2h-1.8V6a1 1 0 0 1 1-1 1 1 0 0 1 1.1 1.1c0 .5-.1.9-.3.9zM5 13v6.2A1.8 1.8 0 0 0 6.8 21H11v-8zm8 8h4.2a1.8 1.8 0 0 0 1.8-1.8V13h-6z" />
  </svg>
)

export default function DailySpin({ userId, onBalance, onVote }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Lỗi thuộc về token thiết bị: hiện thêm nút tự cấp lại (xem spinDevice.js).
  const [deviceBroken, setDeviceBroken] = useState(false)
  const [phase, setPhase] = useState('idle')        // idle | requesting | spinning
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(() => !!readPendingSpin(userId))
  const [onSlot, setOnSlot] = useState(-1)          // ô đèn đang chạy
  const [winSlot, setWinSlot] = useState(-1)        // ô trúng (giữ sáng sau khi dừng)
  const [dimBoard, setDimBoard] = useState(false)   // sau khi trúng: mờ ô còn lại
  // Con số được giữ yên khi đèn đang chạy (giao dịch đã xong nhưng không spoil).
  const [activeRequest, setActiveRequest] = useState(null)
  const [clock, setClock] = useState(() => performance.now())
  const [deadline, setDeadline] = useState(null)
  const busy = useRef(false)
  const mounted = useRef(false)
  const readVersion = useRef(0)
  const spinTimers = useRef([])
  const spinResultRef = useRef(null)
  const ringPos = useRef(0)                         // slot đèn đứng hiện tại
  const rewardsRef = useRef(SPIN_REWARDS)

  const clearSpinTimers = () => { spinTimers.current.forEach(clearTimeout); spinTimers.current = [] }

  useEffect(() => () => { mounted.current = false; clearSpinTimers() }, [])

  const applyStatus = useCallback(next => {
    if (next?.user_id !== userId) throw new Error('err.spinAccountChanged')
    /* Mốc giờ để tự nạp lại lúc nửa đêm của server: `server_now` có thể thiếu
       (gate cũ) hoặc hỏng (payload lạ) — lấy giờ máy khách làm mốc, và nếu vẫn
       không ra con số thì GIỮ hẹn cũ chứ đừng set NaN: NaN giết luôn cái timer
       ở dưới và in chữ rác lên ô đếm ngược. */
    const ref = Number.isFinite(+new Date(next.server_now)) ? +new Date(next.server_now) : Date.now()
    const left = +new Date(next.reset_at) - ref
    if (Number.isFinite(left)) setDeadline(performance.now() + Math.max(0, left))
    setClock(performance.now())
    setStatus(next)
    onBalance(next)
  }, [userId, onBalance])

  const load = useCallback(async () => {
    if (busy.current) return
    const version = ++readVersion.current
    try {
      const next = await fetchDailySpinStatus()
      if (!mounted.current || readVersion.current !== version || busy.current) return
      applyStatus(next)
      setError(next.device_account_blocked ? t('err.spinDeviceAccount') : '')
      setDeviceBroken(false)
      setPending(!!readPendingSpin(userId))
    } catch (e) {
      if (mounted.current && readVersion.current === version) {
        setError(errMsg(t, e))
        setDeviceBroken(['err.spinDevice', 'err.spinStorage'].includes(e?.message))
      }
    } finally {
      if (mounted.current && readVersion.current === version) setLoading(false)
    }
  }, [userId, t, applyStatus])

  useEffect(() => {
    mounted.current = true
    /* Người dùng đã chủ động mở trang Spin: làm ấm Turnstile song song với
       status fetch để lúc bấm quay không phải chờ tải script lần đầu. */
    void warmCaptcha()
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (!document.hidden) load() }
    const storage = e => { if (e.key === SPIN_SYNC_KEY) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', refresh)
    const tick = setInterval(() => setClock(performance.now()), 1000)
    const poll = setInterval(refresh, 60_000)
    return () => {
      mounted.current = false
      clearSpinTimers()
      clearInterval(tick); clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  useEffect(() => {
    if (deadline === null) return
    const id = setTimeout(() => load(), Math.max(500, deadline - performance.now() + 100))
    return () => clearTimeout(id)
  }, [deadline, load]) // server midnight, also refreshed on focus / every minute

  /* Đèn đáp: ô trúng nổ, board mờ đi, confetti, trả nút, đồng bộ tab khác. */
  const settle = useCallback(() => {
    if (!mounted.current) return
    const spin = spinResultRef.current
    busy.current = false
    setPhase('idle')
    if (spin) {
      const win = ringPos.current
      setWinSlot(win)
      setDimBoard(true)
      setResult(spin)
      const tile = document.querySelector(`.spin-tile[data-slot="${win}"]`)
      if (tile && !reducedMotion()) {
        const r = tile.getBoundingClientRect()
        const top = Math.max(...rewardsRef.current)
        confettiBurst(r.left + r.width / 2, r.top + r.height / 2, spin.reward >= top ? 170 : 90)
      }
      const top = Math.max(...rewardsRef.current)
      sfx.spinWin(spin.reward >= top)
    }
    load()
  }, [load])

  /* Đèn chạy vòng: ≥ 3 vòng (60 bước) + đủ bước tới ô đích tất định, mỗi bước
     chậm dần theo ease-out quint (nhanh lúc đầu, đáp êm). */
  const runRing = (targetSteps, done) => {
    const n = RING_RUN_STEPS + targetSteps
    const delayFor = i => (reducedMotion() ? 18 : 34 + 290 * (i / n) ** 5)
    let i = 0
    const step = () => {
      if (!mounted.current) return
      i += 1
      ringPos.current = (ringPos.current + 1) % SPIN_RING.length
      setOnSlot(ringPos.current)
      if (i < n) spinTimers.current.push(setTimeout(step, delayFor(i)))
      else spinTimers.current.push(setTimeout(done, 240))  // một nhịp thấy ô đọng
    }
    spinTimers.current.push(setTimeout(step, delayFor(0)))
  }

  const spin = async () => {
    if (busy.current || !status || (!status.remaining && !pending)) return
    busy.current = true
    ++readVersion.current // a stale status read must not overwrite the committed result
    setLoading(false); setPhase('requesting'); setError(''); setResult(null)
    setActiveRequest(null)
    setWinSlot(-1); setDimBoard(false)
    sfx.spinGo()
    let requestId
    try {
      requestId = await withSpinLock(`ccl.spin.pending.${userId}`, () => getPendingSpin(userId))
      setPending(true); setActiveRequest(requestId)
      const data = await performDailySpin(requestId, userId)
      clearPendingSpin(userId, requestId)
      announceSpinChange()
      // The parent guards user_id too: late responses after sign-out must never
      // update a different account's balance. The credit is already committed.
      if (!mounted.current) { onBalance(data.status); return }
      applyStatus(data.status)
      setPending(!!readPendingSpin(userId))
      /* `rewards` là bảng mức do MÁY CHỦ trả về; thiếu (deploy cũ) thì rơi về
         đúng 7 mức mặc định thay vì vỡ giữa lúc quay. */
      const rewards = data.status?.rewards?.length ? data.status.rewards : SPIN_REWARDS
      rewardsRef.current = rewards
      /* Ô đáp DO SERVER quyết: segment → mức giải → ô tất định phía trước trên
         vòng. Client không chọn thưởng, không Math.random. */
      const winIndex = spinSectorIndex(data.spin.segment, rewards)
      const targetSteps = spinRingTarget(rewards[winIndex], ringPos.current)
      spinResultRef.current = data.spin
      setPhase('spinning')
      if (data.replayed) {
        // Giao dịch cũ đã commitment — không diễn lại màn quay: đặt đèn thẳng
        // vào ô chứa mức giải đó (tất định) rồi hiện kết quả ngay.
        const steps = spinRingTarget(rewards[winIndex], ringPos.current)
        ringPos.current = (ringPos.current + steps) % SPIN_RING.length
        setOnSlot(ringPos.current)
        settle()
      } else {
        runRing(targetSteps, settle)
      }
    } catch (e) {
      // Known SQL rejections rolled back, so there is nothing to recover. Keep
      // the same ID for network/unknown errors: it may have committed already.
      if (e?.code === 'P0001' || [
        'err.spinDeviceLimit', 'err.spinAccountLimit', 'err.spinAccountChanged', 'err.spinDeviceAccount',
        'err.spinDevice', 'err.spinRequest', 'err.signin', 'err.spinSetup',
        // Edge từ chối trước khi chạm database: không có ledger để retry.
        'err.spinEdgeFp', 'err.spinEdgeIp', 'err.spinCaptcha', 'err.spinFingerprint',
      ].includes(e?.message)) clearPendingSpin(userId, requestId)
      busy.current = false
      spinResultRef.current = null
      clearSpinTimers()
      if (!mounted.current) return
      setPhase('idle'); setError(errMsg(t, e)); setPending(!!readPendingSpin(userId))
      setDeviceBroken(['err.spinDevice', 'err.spinStorage'].includes(e?.message))
      sfx.error()
      load()
    }
  }

  const rewards = status?.rewards || SPIN_REWARDS
  const remaining = status?.remaining ?? 0
  const limit = status?.limit || DAILY_SPIN_LIMIT
  const active = phase !== 'idle'

  // The transaction is already committed, but do not spoil the result while
  // the ring is still running. Leaving the page never loses the real credit.
  const history = (status?.history || []).filter(item => !active || item.request_id !== activeRequest)
  const spent = !!status && !remaining && !pending
  const nowReward = active ? SPIN_RING[onSlot] : (result ? result.reward : null)
  const nowRarity = nowReward === null ? -1 : rarityOfReward(nowReward, rewards)

  return (
    <section className="daily-spin" aria-label={t('spin.playLabel')}>
      <header className="spin-head">
        <div className="spin-head-text">
          <h2>{t('spin.playLabel')}</h2>
          {/* Nhãn demo ở lại (nó nói dữ liệu này là dữ liệu mẫu, một điều người
              dùng PHẢI biết); khi không có nhãn thì cả dòng phụ không được
              dựng — không để lại một thẻ rỗng. */}
          {!hasSupabase && (
            <p><span className="spin-demo" role="note">{t('spin.demo')}</span></p>
          )}
        </div>
        <div className="spin-reset" title={t('spin.ruleReset')}>
          <span>{t('spin.resetIn')}</span>
          <b>{status ? spinCountdown(deadline - clock) : '--:--:--'}</b>
        </div>
      </header>

      {/* BOARD 7×5: 20 ô vuông quanh lõi chữ nhật — đèn chạy vòng quanh. */}
      <div className={`spin-board${dimBoard ? ' dim' : ''}`}>
        {SPIN_RING.map((reward, slot) => {
          const [row, col] = spinRingSlot(slot)
          const rarity = rarityOfReward(reward, rewards)
          return (
            <span key={slot} data-slot={slot} aria-hidden="true"
              style={{ gridArea: `${row} / ${col}` }}
              className={`spin-tile r${rarity}${onSlot === slot ? ' on' : ''}`
                + `${(onSlot + 19) % 20 === slot ? ' t1' : ''}${(onSlot + 18) % 20 === slot ? ' t2' : ''}`
                + `${winSlot === slot ? ' win' : ''}`}>
              <CellIcon reward={reward} />
              <b>+{reward}</b>
              <small>{t('spin.reward', { n: reward }).replace(/^\+\d+\s*/, '')}</small>
            </span>
          )
        })}

        {/* LÕI: trạng thái + nút SPIN — vùng live duy nhất đọc toàn bộ nhịp. */}
        <div className="spin-core">
          <div aria-live="polite">
            <div className="spin-core-k">{t('spin.todaySpin')}</div>
            <div className={`spin-now${result ? ' pop' : ''}`} key={active ? onSlot : 'r'}>
              {nowReward === null ? <GiftIcon /> : <b className={`r${nowRarity}`}>+{nowReward}</b>}
            </div>
            <div className="spin-pn" key={`pn-${active ? onSlot : result ? result.reward : 'idle'}`}>
              {result ? t(result.reward === 1 ? 'spin.wonOne' : 'spin.won', { n: result.reward })
                : active ? t('spin.goodLuck') : t('spin.ready')}
            </div>
            <div className={`spin-rar${nowRarity >= 0 ? ` r${nowRarity}` : ''}`}>
              {nowReward === null ? '' : t(RARITY_KEYS[nowRarity])}
            </div>
            <button type="button" className="spin-cta" onClick={spin}
              disabled={active || loading || !status || (!remaining && !pending)}>
              {active ? t('spin.spinning')
                : loading ? t('spin.loading')
                : spent ? t('spin.nextIn', { time: spinCountdown(deadline - clock) })
                : t('spin.action')}
            </button>
          </div>
        </div>
      </div>

      {pending && !active && <p className="spin-pending">{t('spin.pending')}</p>}
      {error && <div className="spin-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-sm" disabled={loading || active}
          onClick={() => { setLoading(true); setError(''); load() }}>{t('spin.refresh')}</button>
        {/* Token trình duyệt hỏng thì "Try again" không bao giờ thoát được:
            cho người dùng tự cấp lại thay vì bắt liên hệ hỗ trợ. */}
        {deviceBroken && (
          <button type="button" className="btn btn-sm" title={t('spin.deviceResetHint')}
            disabled={active}
            onClick={() => { resetSpinDevice(); window.location.reload() }}>
            {t('spin.deviceReset')}
          </button>
        )}
      </div>}

      {/* Dải dưới gọn: lượt còn lại · hôm nay được gì · link dùng votes. */}
      <aside className="spin-strip">
        <div className="spin-remaining">
          <span>{t('spin.available')}</span>
          <b>{status ? remaining : '–'}<small> / {limit}</small></b>
          <span className="spin-pips" aria-hidden="true">
            {Array.from({ length: limit }, (_, i) => <i key={i} className={i < remaining ? 'on' : ''} />)}
          </span>
        </div>
        <div className="spin-history">
          <div className="spin-history-head">
            <h3>{t('spin.history')}</h3>
            <button type="button" className="spin-vote-link" onClick={onVote}>
              {t('spin.useVotes')} <span aria-hidden="true">→</span>
            </button>
          </div>
          {history.length ? <ul>
            {history.map(item => <li key={item.request_id} className={`r${rarityOfReward(item.reward, rewards)}`}>
              <b>{t(item.reward === 1 ? 'spin.rewardOne' : 'spin.reward', { n: item.reward })}</b>
              <time dateTime={item.created_at} title={t('spin.addedAt', { time: timeOf(item.created_at) })}>{timeOf(item.created_at)}</time>
            </li>)}
          </ul> : <p>{t('spin.historyEmpty')}</p>}
          {history.length > 0 && (
            <p className="spin-total">{t('spin.todayTotal', {
              n: history.reduce((sum, item) => sum + item.reward, 0),
            })}</p>
          )}
        </div>
      </aside>
    </section>
  )
}
