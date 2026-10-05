import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import DailyLoginCalendar from './DailyLoginCalendar'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { hasSupabase } from '../lib/supabaseClient.js'
import {
  announceDailyLoginCalendarChanged, claimDailyLoginCalendar,
  DAILY_LOGIN_CALENDAR_SYNC_KEY, fetchDailyLoginCalendarMonth,
  fetchDailyLoginCalendarStatus,
} from '../lib/dailyLoginCalendar.js'
import { spinCountdown } from '../lib/dailySpin.js'
import './DailyRewards.css'

/* A Calendar-only screen. It never imports the quiz controller or calls the
   legacy combined rewards payload; all identity checks stay client-local. */
export default function DailyLogin({ userId }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
      const next = await fetchDailyLoginCalendarStatus(userId)
      if (!mounted.current || version !== readVersion.current || busy.current) return
      applyStatus(next)
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
      setNotice(t(result.replayed ? 'daily.alreadyClaimed' : 'daily.claimSuccess'))
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

  const disabled = loading || action || !status
  const titleId = 'daily-login-title'
  return <section className="daily-rewards daily-login-page" aria-labelledby={titleId} aria-busy={loading || action}>
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
    {loading && <p className="daily-loading" role="status">{t('daily.loading')}</p>}
    <p className="daily-notice" role="status" aria-live="polite">{notice}</p>
    <footer className="daily-rewards-foot">
      <span>{!status ? t('daily.resetRule')
        : t(status.login.claimed ? 'daily.checkedInToday' : 'daily.notCheckedIn')}</span>
      <span>{t('daily.loginNoVotes')}</span>
    </footer>
  </section>
}
