import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
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
   mobile — đúng mockup đã duyệt, giữ nguyên design language (token
   --surface/--line/--a của app, không thêm màu mới).

   Thẻ phải là CUÔN CỦA SỐ THẬT: mọi con số đến từ RPC
   `my_login_reward_status` (20261127) hoặc từ kết quả claim. RPC chưa
   có (database chưa chạy migration) hoặc bị owner tắt
   (login_rewards_enabled = false) → thẻ TỰ ẨN, trang lịch vẫn nguyên
   — nâng cấp không được phá tính năng đang chạy.
   ========================================================= */

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* Đếm số mượt 0 → target trong ~500ms; reduced-motion hoặc SSR thì nhảy thẳng. */
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
      const t = Math.min(1, (now - started) / 500)
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

/* Thẻ thưởng: tổng hôm nay (counter), breakdown theo nguồn, tiến độ chu kỳ
   7 ngày, hai mốc 7/30 và đồng hồ cap 30 vote/ngày. */
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
  const m30Progress = rewards.milestone30_granted ? 30 : Math.min(rewards.streak, 30)

  return (
    <article className={`login-rewards${fete ? ' is-fete' : ''}`} aria-labelledby="login-rewards-title">
      <span className="login-rewards-pulse" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</span>
      <h3 id="login-rewards-title"><Icon name="flame" size={15} />{t('daily.rewardsTitle')}</h3>
      <div className="login-rewards-total" aria-label={t('daily.counterLabel')}>
        <b className="login-rewards-counter">{t(total === 1 ? 'daily.rewardOne' : 'daily.rewardMany', { n: total })}</b>
        <span>{t('daily.rewardsToday')}</span>
      </div>
      <p className="login-rewards-live" role="status" aria-live="polite">
        {claimed || !nextTotal
          ? null
          : t(nextTotal === 1 ? 'daily.nextCheckinOne' : 'daily.nextCheckin', { n: nextTotal })}
      </p>
      <div className="login-rewards-cycle">
        <div className="login-rewards-cycle-head">
          <span>{cycle > 0 ? t('daily.cycleDay', { n: cycle }) : t('daily.cycleFresh')}</span>
          <b>{t('daily.streakLabel')} {rewards.streak}</b>
        </div>
        <div className="login-rewards-cycle-bar" role="img"
          aria-label={cycle > 0 ? t('daily.cycleDay', { n: cycle }) : t('daily.cycleFresh')}>
          {Array.from({ length: LOGIN_CYCLE_DAYS }, (_, i) => (
            <i key={i} className={i < cycle ? 'is-on' : ''} />
          ))}
        </div>
      </div>
      <ul className="login-rewards-milestones">
        <li className={m7Done ? 'is-done' : ''}>
          <span className="login-rewards-milestone-bar"><i style={{ width: `${pct(cycle, LOGIN_CYCLE_DAYS)}%` }} /></span>
          <span className="login-rewards-milestone-copy">{t('daily.milestone7')}</span>
          <em>{m7Done ? t('daily.milestoneDone') : t('daily.milestoneLocked')}</em>
        </li>
        <li className={rewards.milestone30_granted ? 'is-done' : ''}>
          <span className="login-rewards-milestone-bar"><i style={{ width: `${pct(m30Progress, 30)}%` }} /></span>
          <span className="login-rewards-milestone-copy">{t('daily.milestone30')}</span>
          <em>{rewards.milestone30_granted ? t('daily.milestoneDone') : t('daily.milestoneLocked')}</em>
        </li>
      </ul>
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
      <div className="login-rewards-cap" role="progressbar"
        aria-valuenow={rewards.cap_used} aria-valuemin={0} aria-valuemax={rewards.cap}
        aria-label={t('daily.capUsage', { used: rewards.cap_used, cap: rewards.cap })}>
        <div className="login-rewards-cap-head">
          <span>{t('daily.capTitle')}</span>
          <b>{t('daily.capUsage', { used: rewards.cap_used, cap: rewards.cap })}</b>
        </div>
        <div className="login-rewards-cap-bar"><i style={{ width: `${pct(rewards.cap_used, rewards.cap)}%` }} /></div>
      </div>
    </article>
  )
}

/* Named export for the SSR render test — production code always imports the
   default (the page) and never needs this. */
export { RewardCard }

export default function DailyLogin({ userId }) {
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
    const id = setTimeout(() => setFete(false), 1600)
    return () => clearTimeout(id)
  }, [fete])

  const disabled = loading || action || !status
  const titleId = 'daily-login-title'
  const showRewards = !!rewards?.enabled
  return <section className={`daily-rewards daily-login-page${showRewards ? ' has-side' : ''}`} aria-labelledby={titleId} aria-busy={loading || action}>
    <header className="daily-rewards-head">
      <div>
        <h2 id={titleId}>{t('daily.loginHeading')}</h2>
        <p>{t('daily.loginSubtitle')}</p>
      </div>
      <div className="daily-rewards-reset" title={t('daily.resetRule')}>
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
        <div className="daily-missions">
          <article className={`daily-mission${status?.login.claimed ? ' is-complete' : ''}`}>
            <div className="daily-mission-heading">
              <span className="daily-mission-icon"><Icon name="calendar" size={21} /></span>
              <h3>{t('daily.loginTitle')}</h3>
            </div>
            <p>{t(status?.login.claimed ? 'daily.loginDone' : 'daily.loginDesc')}</p>
            {status && <DailyLoginCalendar status={status} disabled={disabled} onClaim={claim} loadMonth={loadMonth} />}
            <button type="button" className={`btn${status?.login.claimed ? ' btn-ok' : ' btn-primary'} daily-claim`}
              disabled={disabled || status?.login.claimed} onClick={claim}>
              {status?.login.claimed && <Icon name="check" size={15} />}
              {t(action ? 'daily.claiming' : status?.login.claimed ? 'daily.claimed' : 'daily.claim')}
            </button>
          </article>
        </div>
      </div>
      {showRewards && <aside className="daily-side" aria-label={t('daily.rewardsCardLabel')}>
        <RewardCard rewards={rewards} claimed={!!status?.login.claimed} fete={fete} />
      </aside>}
    </div>
    {loading && <p className="daily-loading" role="status">{t('daily.loading')}</p>}
    <p className="daily-notice" role="status" aria-live="polite">{notice}</p>
    <footer className="daily-rewards-foot">
      <span>{!status ? t('daily.resetRule')
        : t(status.login.claimed ? 'daily.checkedInToday' : 'daily.notCheckedIn')}</span>
      <span>{t('daily.loginRewardRule')}</span>
    </footer>
  </section>
}
