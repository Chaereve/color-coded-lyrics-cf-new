import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDailySpinStatus, performDailySpin, hasSupabase } from '../lib/db'
import { warmCaptcha } from '../lib/spinShield.js'
import {
  DAILY_SPIN_LIMIT, SPIN_REWARDS, SPIN_TIME_ZONE,
  SPIN_GRID_CELLS, SPIN_GRID_RENDER_ORDER,
  spinCellForReward, spinCountdown, spinSectorIndex, spinTier,
} from '../lib/dailySpin'
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
   DAILY SPIN — SQUARE GRID SPINNER (spec chốt 2026-10-09)
   ---------------------------------------------------------
   LƯỚI 3×3: 8 ô quanh viền (7 giải thật + 1 ô accent KHÔNG phải giải) và
   ô giữa là NÚT QUAY thật. KHÔNG wheel tròn, KHÔNG reel ngang — reel ngang
   là UI của Mystery Box.

   Thứ tự 8 ô theo CHIỀU KIM ĐỒNG HỒ (index = thứ tự vệt sáng chạy):
     0 top-left +1    1 top-mid +2     2 top-right +3   3 mid-right +5
     4 bottom-right ACCENT (giữa các lần chạy chỉ là điểm nhấn thị giác)
     5 bottom-mid +8  6 bottom-left +10                 7 mid-left +20
   Accent KHÔNG trong bảng giải, KHÔNG bao giờ là ô dừng; mỗi mức giải map
   ĐÚNG MỘT ô (find theo reward — duy nhất vì 7 giải khác nhau).

   NHỊP: bấm QUAY → khoá nút NGAY → vòng nhanh ≥3 vòng kim đồng hồ (70ms/
   bước) chạy trong lúc chờ server → server trả kết quả → giảm tốc 2,2s và
   DỪNG ĐÚNG ô giải đó (client KHÔNG chọn: không Math.random; ô đích đến từ
   `segment` của server qua spinSectorIndex) → ô trúng giữ active + result
   pop. Lỗi: dừng an toàn, bật lại nút, không tạo giải/lượt mới.
   Reduced-motion/replay: bỏ vòng chạy, ô trúng sáng tức thì — không mất
   kết quả.

   Backend GIỮ NGUYÊN 100%: performDailySpin, request-id idempotency, quota
   2 lượt/ngày, no-repeat, edge gate/Turnstile, cap — chỉ đổi cách PRESENT.
   ========================================================= */

const FAST_STEP_MS = 70      // nhịp vòng nhanh
const MIN_LOOPS = 3          // tối thiểu 3 vòng trước khi giảm tốc
const MIN_STEPS = MIN_LOOPS * 8
const DECEL_MS = 2200        // tổng thời gian giảm tốc

/* Vệt sáng chạy THEO CHIỀU KIM ĐỒNG HỒ = theo đúng thứ tự index spec. */
const nextCell = i => (i + 1) % 8

function Pips({ remaining, limit }) {
  return <span className="spin-pips" aria-hidden="true">
    {Array.from({ length: limit }, (_, i) => <i key={i} className={i < remaining ? 'on' : ''} />)}
  </span>
}

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
  const [activeCell, setActiveCell] = useState(-1)  // ô đang sáng (vệt chạy/ô trúng)
  // Con số được giữ yên khi grid đang chạy (giao dịch đã xong nhưng không spoil).
  const [activeRequest, setActiveRequest] = useState(null)
  const [clock, setClock] = useState(() => performance.now())
  const [deadline, setDeadline] = useState(null)
  const busy = useRef(false)
  const mounted = useRef(false)
  const readVersion = useRef(0)
  const spinTimers = useRef([])     // mọi timeout của nhịp chạy — cleanup khi unmount/lỗi
  const spinResultRef = useRef(null)
  const planRef = useRef(null)      // { winCell } — có SAU khi server trả
  const stepsRef = useRef(0)
  const rewardsRef = useRef(SPIN_REWARDS)

  const clearSpinTimers = () => { spinTimers.current.forEach(clearTimeout); spinTimers.current = [] }
  const later = (fn, ms) => spinTimers.current.push(setTimeout(fn, ms))

  /* Dừng NHỊP CHẠY một cách an toàn (lỗi/unmount): xoá lịch chạy, không giữ
     ô nào sáng — nút do caller bật lại. */
  const stopRun = () => { clearSpinTimers(); planRef.current = null; if (mounted.current) setActiveCell(-1) }

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

  /* Grid dừng: lộ kết quả, trả nút, đồng bộ các tab khác. Gọi bởi bước cuối
     của lịch decel (hoặc tức thì ở reduced-motion/replay). */
  const settle = useCallback(() => {
    if (!mounted.current) return
    const spin = spinResultRef.current
    busy.current = false
    setPhase('idle')
    if (spin) {
      setResult(spin)
      const top = Math.max(...rewardsRef.current)
      sfx.spinWin(spin.reward >= top)
    }
    load()
  }, [load])

  /* Lịch decel: từ ô hiện tại chạy TIẾP theo chiều kim đồng hồ đủ bước để
     dừng ĐÚNG ô trúng (ô trúng luôn là ô giải — accent không bao giờ là đích
     vì accent không phải giá trị giải nào). Delay mỗi bước tỉ lệ trọng số
     ease-out, chuẩn hoá đúng tổng DECEL_MS; bước cuối gọi settle. */
  const runDecel = (from, winIndex) => {
    let steps = (winIndex - from + 8) % 8
    if (steps === 0) steps = 8                    // luôn đi tiếp ít nhất một ô
    const total = steps + 2 * 8                   // thêm 2 vòng cho đỡ tụt đột ngột
    const raw = Array.from({ length: total }, (_, i) => 1 + 3.1 * (i / total) ** 2.4)
    const sum = raw.reduce((a, b) => a + b, 0)
    let acc = 0
    let cell = from
    raw.forEach((w, i) => {
      acc += w
      const at = Math.round((DECEL_MS * acc) / sum)
      const last = i === total - 1
      later(() => {
        if (!mounted.current) return
        cell = nextCell(cell)
        setActiveCell(cell)
        if (last) later(settle, 140)
      }, at)
    })
  }

  /* Vòng nhanh: chạy ĐỀU theo kim đồng hồ cho tới khi (a) server đã trả
     (planRef) VÀ (b) đã đủ ≥ MIN_LOOPS vòng — khi đó chuyển sang decel. */
  const fastLoop = cell => {
    if (!mounted.current) return
    cell = nextCell(cell)
    stepsRef.current += 1
    setActiveCell(cell)
    const plan = planRef.current
    if (plan && stepsRef.current >= MIN_STEPS) {
      setPhase('spinning')
      runDecel(cell, plan.winCell)
      return
    }
    later(() => fastLoop(cell), FAST_STEP_MS)
  }

  const spin = async () => {
    if (busy.current || !status || (!status.remaining && !pending)) return
    busy.current = true
    ++readVersion.current // a stale status read must not overwrite the committed result
    setLoading(false); setPhase('requesting'); setError(''); setResult(null)
    setActiveRequest(null)
    sfx.spinGo()
    planRef.current = null
    stepsRef.current = 0
    later(() => fastLoop(7), FAST_STEP_MS)
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
      /* `rewards` là bảng ô do MÁY CHỦ trả về. Bản deploy cũ (hoặc một hàm SQL
         chưa cập nhật) có thể trả payload thiếu khoá này — đọc thẳng là
         TypeError giữa lúc quay, người dùng mất lượt mà không thấy gì. Thiếu
         thì rơi về đúng 7 ô mặc định. */
      const rewards = data.status?.rewards?.length ? data.status.rewards : SPIN_REWARDS
      rewardsRef.current = rewards
      /* Ô trúng DO SERVER quyết: segment → mức giải → ô grid DUY NHẤT chứa
         mức đó. Server trả xong mới lập kế hoạch decel — client không chọn. */
      const winIndex = spinSectorIndex(data.spin.segment, rewards)
      const winCell = spinCellForReward(rewards[winIndex], rewards)
      spinResultRef.current = data.spin
      if (reducedMotion() || data.replayed) {
        // Reduced-motion/replay: bỏ vòng chạy — ô trúng sáng tức thì, đủ kết quả.
        clearSpinTimers()
        setPhase('spinning')
        setActiveCell(winCell)
        later(settle, 60)
      } else {
        planRef.current = { winCell }   // fastLoop tự chuyển sang decel khi đủ vòng
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
      stopRun()
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
  const spinning = phase === 'spinning'

  /* Mỗi ô: mức giải (tier màu) + nhãn "+N". Ô accent có gem riêng. */
  const cells = useMemo(() => SPIN_GRID_CELLS.map(c => ({
    ...c,
    tier: c.reward === null ? 'accent' : spinTier(c.reward, rewards),
  })), [rewards])
  const wonCell = result
    ? SPIN_GRID_CELLS.find(c => c.reward === result.reward)?.index ?? -1
    : -1

  // The transaction is already committed, but do not spoil the result while
  // the grid is still running. Leaving the page never loses the real credit.
  const history = (status?.history || []).filter(item => !active || item.request_id !== activeRequest)
  /* Nhãn nút giữa là QUAY/SPIN CỐ ĐỊNH (spec 2026-10-09): nhãn không nhảy
     chữ khi requesting/spinning — trạng thái được vùng live ở panel đọc ra
     ("Spinning…"/kết quả), nút chỉ đổi DISABLE. */

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

      <div className="spin-stage">
        <div className="spin-dial">
          {/* TRỌNG TÂM: LƯỚI 3×3. Tám ô viền aria-hidden (trạng thái được đọc
              qua vùng live ở panel); ô giữa là NÚT QUAY thật, keyboard trực
              tiếp. Vệt sáng chỉ nằm trên ô viền — không đè nút. */}
          <div className="spin-grid" role="group" aria-label={t('spin.gridLabel')}
            data-state={spinning ? 'spinning' : active ? 'busy' : 'idle'}>
            {SPIN_GRID_RENDER_ORDER.map(idx => {
              if (idx === null) {   // ô giữa — nút QUAY thật
                return (
                  <div className="spin-grid-center" key="center">
                    <button type="button" className="btn btn-primary spin-button" onClick={spin}
                      disabled={active || loading || !status || (!remaining && !pending)}
                      aria-label={t('spin.action')}>
                      {t('spin.action')}
                    </button>
                  </div>
                )
              }
              const c = cells[idx]
              return <GridCell key={c.index} cell={c}
                active={activeCell === c.index} won={wonCell === c.index} />
            })}
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
        </div>

        {/* CỘT PHỤ đúng bốn thứ: lượt còn lại · kết quả mới nhất (nút QUAY đã
            nằm giữa lưới) · lịch sử ngắn. Bảng odds/% KHÔNG được quay lại đây. */}
        <aside className="spin-panel">
          <div className="spin-remaining">
            <span>{t('spin.available')}</span>
            <b>{status ? remaining : '–'}<small> / {limit}</small></b>
            <Pips remaining={status ? remaining : 0} limit={limit} />
          </div>

          {/* VÙNG LIVE DUY NHẤT: đọc cả trạng thái đang quay lẫn kết quả. */}
          <div className={`spin-result${result ? ' won' : ''}`} role="status" aria-live="polite" aria-atomic="true">
            {result
              ? <><strong key={result.reward} className="spin-won-num">{t(result.reward === 1 ? 'spin.wonOne' : 'spin.won', { n: result.reward })}</strong>
                <small>{t('spin.wonNote')}</small></>
              : active ? <span className="spin-live">{t('spin.spinning')}</span>
              : null}
          </div>

          <div className="spin-history">
            <div className="spin-history-head">
              <h3>{t('spin.history')}</h3>
              <button type="button" className="spin-vote-link" onClick={onVote}>
                {t('spin.useVotes')} <span aria-hidden="true">→</span>
              </button>
            </div>
            {history.length ? <ul>
              {/* Mỗi dòng mang HẠNG của phần thưởng (cùng tông với ô trên
                  lưới): nhìn lịch sử là thấy ngay hôm nay có trúng giải cao
                  nhất hay không, không phải đọc từng con số. */}
              {history.map(item => <li key={item.request_id} className={spinTier(item.reward, rewards)}>
                <b>{t(item.reward === 1 ? 'spin.rewardOne' : 'spin.reward', { n: item.reward })}</b>
                <time dateTime={item.created_at} title={t('spin.addedAt', { time: timeOf(item.created_at) })}>{timeOf(item.created_at)}</time>
              </li>)}
            </ul> : <p>{t('spin.historyEmpty')}</p>}
            {/* Tổng của chính danh sách bên trên — con số duy nhất trên trang
                cộng từ dữ liệu thật, và là câu trả lời cho "hôm nay được gì". */}
            {history.length > 0 && (
              <p className="spin-total">{t('spin.todayTotal', {
                n: history.reduce((sum, item) => sum + item.reward, 0),
              })}</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

/* Ô viền: giải thì "+N", accent thì gem hình thoi — phân biệt bằng HÌNH THỨC
   chứ không chỉ màu. Active (vệt chạy) = viền + glow + scale; won (ô trúng
   sau khi dừng) giữ nguyên hiệu ứng đó tới khi lượt tiếp theo. */
function GridCell({ cell, active, won }) {
  return (
    <span
      className={`spin-cell ${cell.tier}${active ? ' is-active' : ''}${won ? ' is-won' : ''}`}
      aria-hidden="true"
    >
      {cell.reward === null
        ? <i className="spin-cell-gem" />
        : <b className="spin-cell-num">+{cell.reward}</b>}
    </span>
  )
}
