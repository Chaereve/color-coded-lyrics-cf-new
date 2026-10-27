import { useCallback, useEffect, useRef, useState } from 'react'
import DailyLoginCalendar from './DailyLoginCalendar'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { hasSupabase } from '../lib/supabaseClient.js'
import {
  announceDailyLoginCalendarChanged, claimDailyLoginCalendar,
  fetchLoginRewardStatus,
  DAILY_LOGIN_CALENDAR_SYNC_KEY, fetchDailyLoginCalendarMonth,
  fetchDailyLoginCalendarStatus,
} from '../lib/dailyLoginCalendar.js'
import { LOGIN_CYCLE_DAYS, nextCheckInGrants } from '../lib/loginRewards.js'
import { spinCountdown } from '../lib/dailySpin.js'
import './DailyLogin.css'

/* =========================================================
   /daily-login — LỊCH ĐIỂM DANH + THƯỞNG CHECK-IN (B1)
   ---------------------------------------------------------
   Hai cột trên desktop (lịch 60% | thẻ thưởng 40%), một cột trên
   mobile. Thẻ thưởng dùng bố cục gọn, phẳng; giữ palette brand và
   Be Vietnam Pro / JetBrains Mono, tránh thêm chi tiết trang trí.

   Thẻ phải là CUÔN CỦA SỐ THẬT: mọi con số đến từ RPC
   `my_login_reward_status` (20261127) hoặc từ kết quả claim. RPC chưa
   có (database chưa chạy migration) hoặc bị owner tắt
   (login_rewards_enabled = false) → thẻ TỰ ẨN, trang lịch vẫn nguyên.
   ========================================================= */

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* Đếm số mượt 0 → target trong ~600ms; reduced-motion hoặc SSR thì nhảy thẳng. */
function useCountUp(target, enabled = true) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const to = Math.max(0, Math.trunc(Number(target)) || 0)
    if (!enabled || prefersReducedMotion() || to === fromRef.current) {
      fromRef.current = to
      setValue(to)
      return undefined
    }
    const from = fromRef.current
    const started = performance.now()
    let raf
    const tick = now => {
      const t = Math.min(1, (now - started) / 600)
      const eased = 1 - (1 - t) ** 3
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); fromRef.current = to }
  }, [target, enabled])
  return value
}

const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0)

/* Mức cap quyết định MÀU thanh (xanh → vàng → đỏ), tất cả đều token sẵn có. */
const capLevel = (used, cap) => {
  const ratio = cap > 0 ? used / cap : 0
  return ratio >= 0.85 ? 'high' : ratio >= 0.6 ? 'mid' : 'low'
}

/* Confetti NHẸ: 12 mảnh, vị trí/trễ suy ra từ chỉ số (dự đoán được, không
   nhảy loạn giữa các lần render). ChỉNHỈ xuất hiện khi `.is-fete`. */
const CONFETTI = Array.from({ length: 12 }, (_, i) => ({
  dx: `${((i % 2 ? -1 : 1) * (10 + (i * 29) % 90))}px`,
  delay: `${(i % 6) * 90}ms`,
  drift: `${(i % 2 ? -1 : 1) * (14 + (i * 13) % 30)}px`,
}))

function RewardCard({ rewards, claimed, fete }) {
  const { t } = useI18n()
  const total = useCountUp(rewards.today_total)
  const nextGrants = nextCheckInGrants({
    streak: rewards.streak,
    milestone30Granted: rewards.milestone30_granted,
    claimedToday: claimed,
  })
  const nextTotal = nextGrants.reduce((sum, g) => sum + g.amount, 0)
  const cycle = rewards.cycle_day
  const m7Done = claimed && rewards.breakdown.some(s => s.source === 'login_milestone7')
  const m30Done = rewards.milestone30_granted
  const m30Progress = m30Done ? 30 : Math.min(rewards.streak, 30)

  /* Chỉ đánh dấu chuyển động nhẹ khi mốc 30 ngày vừa hoàn tất. */
  const prev30 = useRef(null)
  const [m30Unlocked, setM30Unlocked] = useState(false)
  useEffect(() => {
    if (prev30.current === false && m30Done) setM30Unlocked(true)
    prev30.current = m30Done
  }, [m30Done])
  useEffect(() => {
    if (!m30Unlocked) return undefined
    const id = setTimeout(() => setM30Unlocked(false), 900)
    return () => clearTimeout(id)
  }, [m30Unlocked])

  return (
    <article className={`login-rewards${fete ? ' is-fete' : ''}`} aria-label={t('daily.rewardsCardLabel')}>
      <div className="login-rewards-lead">
        <div className="login-rewards-current">
          <span className="login-rewards-overline">{t('daily.currentStreak')}</span>
          <div className="login-rewards-streak-value">
            <b className="login-rewards-streak-num">{rewards.streak}</b>
            <span>{t(rewards.streak === 1 ? 'daily.dayOne' : 'daily.dayMany')}</span>
          </div>
        </div>
        <div className="login-rewards-earned">
          <span className="login-rewards-overline">{t('daily.todayReward')}</span>
          <strong className="login-rewards-counter">{t(total === 1 ? 'daily.rewardOne' : 'daily.rewardMany', { n: total })}</strong>
          <span>{t('daily.rewardsToday')}</span>
        </div>
      </div>

      {/* FX — chỉ khi vừa nhận thưởng: số vote bay lên + confetti rơi nhẹ */}
      {fete && (
        <div className="login-rewards-fx" aria-hidden="true">
          {rewards.breakdown.slice(0, 3).map((slice, i) => (
            <b key={`${slice.source}-${i}`} className="fx-vote"
              style={{ '--fx-x': `${18 + i * 26}%`, '--fx-delay': `${i * 160}ms` }}>
              {t(slice.amount === 1 ? 'daily.rewardOne' : 'daily.rewardMany', { n: slice.amount })}
            </b>
          ))}
          {CONFETTI.map((piece, i) => (
            <i key={i} className="fx-confetti"
              style={{ left: `${8 + i * 7.6}%`, '--fx-dx': piece.dx, '--fx-drift': piece.drift, '--fx-delay': piece.delay }} />
          ))}
        </div>
      )}

      <p className="login-rewards-live" role="status" aria-live="polite">
        {claimed || !nextTotal
          ? null
          : t(nextTotal === 1 ? 'daily.nextCheckinOne' : 'daily.nextCheckin', { n: nextTotal })}
      </p>

      <div className="login-rewards-divider" aria-hidden="true" />

      {/* Chu kỳ 7 ngày — tiến độ rõ ràng, không đánh dấu mục tiêu bằng viền rời. */}
      <div className="login-rewards-cycle">
        <div className="login-rewards-cycle-head">
          <div className="login-rewards-cycle-copy">
            <span>{t('daily.source.login_milestone7')}</span>
            <small>{t('daily.milestone7')}</small>
          </div>
          <b className="login-rewards-cycle-count">{cycle} / {LOGIN_CYCLE_DAYS}</b>
        </div>
        <div className={`login-rewards-cycle-bar${cycle === LOGIN_CYCLE_DAYS ? ' is-complete' : ''}`}
          role="img" aria-label={`${cycle > 0 ? t('daily.cycleDay', { n: cycle }) : t('daily.cycleFresh')}; ${t('daily.milestone7')}; ${m7Done ? t('daily.milestoneDone') : t('daily.milestoneLocked')}`}>
          {Array.from({ length: LOGIN_CYCLE_DAYS }, (_, i) => (
            <i key={i} className={i < cycle ? 'is-on' : ''} />
          ))}
        </div>
      </div>

      {/* Tóm tắt mốc 30 ngày và giới hạn ngày — cùng bố cục gọn như preview. */}
      <div className="login-rewards-summary">
        <div className={`login-rewards-summary-item${m30Done ? ' is-done' : ''}${m30Unlocked ? ' just-unlocked' : ''}`}
          role="progressbar" aria-valuenow={m30Progress} aria-valuemin={0} aria-valuemax={30}
          aria-label={`${t('daily.milestone30')}: ${m30Progress} of 30; ${m30Done ? t('daily.milestoneDone') : t('daily.milestoneLocked')}`}>
          <div className="login-rewards-summary-line">
            <span>{t('daily.source.login_milestone30')}</span>
            <b>{m30Progress} / 30 · {t('daily.rewardMany', { n: 20 })}</b>
          </div>
          <div className="login-rewards-summary-meter"><i style={{ width: `${pct(m30Progress, 30)}%` }} /></div>
        </div>
        <div className="login-rewards-summary-item login-rewards-summary-cap login-rewards-cap"
          role="progressbar" data-level={capLevel(rewards.cap_used, rewards.cap)}
          aria-valuenow={rewards.cap_used} aria-valuemin={0} aria-valuemax={rewards.cap}
          aria-label={t('daily.capUsage', { used: rewards.cap_used, cap: rewards.cap })}>
          <div className="login-rewards-summary-line">
            <span>{t('daily.capTitle')}</span>
            <b>{t('daily.capUsage', { used: rewards.cap_used, cap: rewards.cap })}</b>
          </div>
          <div className="login-rewards-summary-meter login-rewards-cap-bar"><i style={{ width: `${pct(rewards.cap_used, rewards.cap)}%` }} /></div>
        </div>
      </div>

      {rewards.breakdown.length > 0 && (
        <div className="login-rewards-breakdown">
          <p className="login-rewards-breakdown-title">{t('daily.breakdown')}</p>
          <ul>
            {rewards.breakdown.map((slice, index) => (
              <li key={`${slice.source}-${index}`}>
                <span>{t(`daily.source.${slice.source}`)}</span>
                <b>{t(slice.amount === 1 ? 'daily.rewardOne' : 'daily.rewardMany', { n: slice.amount })}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

    </article>
  )
}

export default function DailyLogin({ userId, onReward = null }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [rewards, setRewards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fete, setFete] = useState(false)
  const [deadline, setDeadline] = useState(null)
  const [clock, setClock] = useState(() => performance.now())
  const mounted = useRef(false)
  const busy = useRef(false)
  const readVersion = useRef(0)

  const applyStatus = useCallback(next => {
    if (next?.user_id !== userId) throw new Error('err.dailyAccountChanged')
    const now = performance.now()
    setDeadline(now + Math.max(0, Date.parse(next.reset_at) - Date.parse(next.server_now)))
    setClock(now)
    setStatus(next)
  }, [userId])

  const loadMonth = useCallback(month => fetchDailyLoginCalendarMonth(userId, month), [userId])
  const load = useCallback(async () => {
    if (busy.current) return
    const version = ++readVersion.current
    try {
      // Lịch là tính năng chính — fetch song song với thẻ thưởng nhưng KHÔNG
      // để lỗi thẻ thưởng làm trang lịch chết (fetchLoginRewardStatus tự nuốt).
      const [next, reward] = await Promise.all([
        fetchDailyLoginCalendarStatus(userId),
        fetchLoginRewardStatus(userId),
      ])
      if (!mounted.current || version !== readVersion.current || busy.current) return
      applyStatus(next)
      setRewards(reward)
      setError('')
    } catch (e) {
      if (mounted.current && version === readVersion.current) setError(errMsg(t, e))
    } finally {
      if (mounted.current && version === readVersion.current) setLoading(false)
    }
  }, [userId, applyStatus, t])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (!document.hidden) load() }
    const storage = event => { if (event.key === DAILY_LOGIN_CALENDAR_SYNC_KEY) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', refresh)
    const tick = setInterval(() => setClock(performance.now()), 1000)
    const poll = setInterval(refresh, 60_000)
    return () => {
      mounted.current = false
      clearInterval(tick); clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  useEffect(() => {
    if (deadline === null) return
    const timer = setTimeout(load, Math.max(500, deadline - performance.now() + 100))
    return () => clearTimeout(timer)
  }, [deadline, load])

  const claim = async () => {
    if (busy.current || !status || status.login.claimed) return
    busy.current = true
    ++readVersion.current
    setAction(true)
    setError('')
    setNotice('')
    let refreshDay = false
    try {
      const result = await claimDailyLoginCalendar(userId, status.day)
      announceDailyLoginCalendarChanged()
      onReward?.(result)
      if (!mounted.current) return
      applyStatus(result.status)
      if (result.rewards) setRewards(result.rewards)
      setNotice(t(result.replayed ? 'daily.alreadyClaimed' : 'daily.claimSuccess'))
      // Chỉ ăn mừng khi ngày đó THẬT SỰ được nhận thưởng (không phải replay).
      if (!result.replayed && result.rewards?.breakdown?.length) setFete(true)
    } catch (e) {
      if (mounted.current) {
        setError(errMsg(t, e))
        refreshDay = e?.message === 'err.dailyDayChanged'
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setAction(false)
        if (refreshDay) load()
      }
    }
  }

  useEffect(() => {
    if (!fete) return undefined
    const id = setTimeout(() => setFete(false), 1900)
    return () => clearTimeout(id)
  }, [fete])

  const disabled = loading || action || !status
  const titleId = 'daily-login-title'
  const showRewards = !!rewards?.enabled
  return <section className={`daily-rewards daily-login-page${showRewards ? ' has-side' : ''}`} aria-labelledby={titleId} aria-busy={loading || action}>
    <header className="daily-rewards-head">
      <h2 id={titleId} className="sr-only">{t('daily.loginHeading')}</h2>
      <div className="daily-rewards-reset">
        <span>{t('daily.nextReset')}</span>
        <b>{deadline === null ? '--:--:--' : spinCountdown(deadline - clock)}</b>
      </div>
    </header>
    {!hasSupabase && <p className="daily-demo">{t('daily.demo')}</p>}
    {error && <div className="daily-error" role="alert">
      <span>{error}</span>
      <button type="button" className="btn btn-sm" disabled={action} onClick={load}>{t('daily.refresh')}</button>
    </div>}
    <div className="daily-cols">
      <div className="daily-main">
        {status && <DailyLoginCalendar status={status} disabled={disabled} onClaim={claim} loadMonth={loadMonth} />}
        {!status?.login.claimed && (
          <div className="daily-checkin-footer">
            <button type="button" className="btn btn-primary daily-claim" disabled={disabled} onClick={claim}>
              {t(action ? 'daily.claiming' : 'daily.claim')}
            </button>
          </div>
        )}
      </div>
      {showRewards && <aside className="daily-side" aria-label={t('daily.rewardsCardLabel')}>
        <RewardCard rewards={rewards} claimed={!!status?.login.claimed} fete={fete} />
      </aside>}
    </div>
    {loading && <p className="daily-loading" role="status">{t('daily.loading')}</p>}
    <p className="daily-notice sr-only" role="status" aria-live="polite">{notice}</p>
  </section>
}

/* Named export for the SSR render test — production code always imports the
   default (the page) and never needs this. */
export { RewardCard }
