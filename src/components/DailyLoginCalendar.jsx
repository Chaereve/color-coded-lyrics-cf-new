import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { DAILY_LOGIN_REWARD } from '../lib/dailyRewards.js'
import {
  buildCheckInCalendar, shiftMonth, monthOf, isCalendarMonth, isCalendarDay, CHECK_IN_MILESTONES,
} from '../lib/checkInCalendar.js'

const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/* A real check-in calendar: the current month comes from the reward status and
   older months are read from the same owner-scoped ledger. Only today's cell is
   actionable, so browsing can never claim a past or future reward. */
export default function DailyLoginCalendar({ status, disabled, onClaim, loadMonth }) {
  const { t } = useI18n()
  const today = isCalendarDay(status?.day) ? status.day : null
  const currentMonth = today ? monthOf(today) : null
  const [browsed, setBrowsed] = useState(null)
  const [cache, setCache] = useState({})
  const [celebrate, setCelebrate] = useState(false)
  const [seenClaimed, setSeenClaimed] = useState(false)

  // Browsing is derived: an unset or impossible month always falls back to the
  // server's current Vietnam month, so today can never scroll out of view.
  const month = isCalendarMonth(browsed) ? browsed : currentMonth
  const historyAvailable = Array.isArray(status?.login?.claimed_days)
  const view = month === currentMonth
    ? { days: historyAvailable ? status.login.claimed_days : null, available: historyAvailable }
    : cache[month] || null

  useEffect(() => {
    if (!month || month === currentMonth || !loadMonth || cache[month]) return
    let alive = true
    Promise.resolve(loadMonth(month))
      .then(result => { if (alive && result?.month === month) setCache(old => ({ ...old, [month]: { days: result.days, available: true } })) })
      .catch(() => { if (alive) setCache(old => ({ ...old, [month]: { days: null, available: false } })) })
    return () => { alive = false }
  }, [month, currentMonth, loadMonth, cache])

  // Celebrate the moment the ledger confirms today's claim, then fade it out.
  const claimed = !!status?.login?.claimed
  if (claimed !== seenClaimed) {
    setSeenClaimed(claimed)
    if (claimed) setCelebrate(true)
  }
  useEffect(() => {
    if (!celebrate) return
    const id = setTimeout(() => setCelebrate(false), 1600)
    return () => clearTimeout(id)
  }, [celebrate])

  const calendar = buildCheckInCalendar(status, { month, days: view?.days, available: view?.available })
  if (!calendar) return null
  const { monthLabel, cells, daysInMonth, checkedCount, currentMonth: isCurrent } = calendar
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const earliest = isCalendarDay(status.login?.first_day) ? monthOf(status.login.first_day) : currentMonth
  const stats = status.login || {}
  const progress = checkedCount === null ? 0 : Math.round((checkedCount / daysInMonth) * 100)
  const monthCount = checkedCount === null ? null : checkedCount
  const go = delta => setBrowsed(shiftMonth(month, delta))

  return <div className={`check-in-calendar${celebrate ? ' is-celebrating' : ''}`}>
    <div className="check-in-calendar-head">
      <div className="check-in-calendar-nav">
        <button type="button" className="check-in-nav" onClick={() => go(-1)}
          disabled={!earliest || !month || month <= earliest}
          aria-label={t('calendar.prevMonth')}><Icon name="prev" size={16} /></button>
        <strong className="check-in-calendar-month">{monthLabel}</strong>
        <button type="button" className="check-in-nav" onClick={() => go(1)}
          disabled={!currentMonth || !month || month >= currentMonth}
          aria-label={t('calendar.nextMonth')}><Icon name="next" size={16} /></button>
      </div>
      <span>
        {monthCount === null ? t('calendar.unknown')
          : t(monthCount === 1 ? 'calendar.monthSummaryOne' : 'calendar.monthSummary', { n: monthCount, reward: monthCount * DAILY_LOGIN_REWARD })}
      </span>
    </div>
    <div className="check-in-stats" aria-label={t('calendar.stats')}>
      <span className="check-in-stat is-main">
        <b>{monthCount === null ? '—' : `${monthCount}/${daysInMonth}`}</b>
        <i>{t('calendar.thisMonth')}</i>
      </span>
      <span className="check-in-stat">
        <b><Icon name="flame" size={13} />{typeof stats.streak === 'number' ? stats.streak : '—'}</b>
        <i>{t('calendar.streak')}</i>
      </span>
      <span className="check-in-stat">
        <b>{typeof stats.best_streak === 'number' ? stats.best_streak : '—'}</b>
        <i>{t('calendar.best')}</i>
      </span>
      <span className="check-in-stat">
        <b>{typeof stats.total_days === 'number' ? stats.total_days : '—'}</b>
        <i>{t('calendar.lifetime')}</i>
      </span>
    </div>
    <div className="check-in-progress" role="img"
      aria-label={monthCount === null ? t('calendar.unknown') : t('calendar.progress', { n: monthCount, total: daysInMonth })}>
      <i style={{ width: `${progress}%` }} />
      {CHECK_IN_MILESTONES.map(days => <b key={days} className={monthCount !== null && monthCount >= days ? 'is-reached' : ''}
        style={{ left: `${(days / daysInMonth) * 100}%` }} title={t('calendar.milestone', { n: days })}>{days}</b>)}
    </div>
    <table className="check-in-calendar-grid">
      <caption>{t('calendar.caption', { month: monthLabel })}</caption>
      <thead><tr>{weekdays.map(day => <th key={day} scope="col"><abbr title={t(`calendar.${day}Long`)}>{t(`calendar.${day}`)}</abbr></th>)}</tr></thead>
      <tbody>{weeks.map((week, index) => <tr key={index}>{week.map((cell, column) => {
        if (!cell) return <td key={`blank-${column}`} aria-hidden="true" />
        const label = `${cell.label} — ${t(`calendar.${cell.state}`)}`
        const className = `check-in-day is-${cell.state}${cell.isToday ? ' is-today' : ''}`
        const content = <><time dateTime={cell.day}>{cell.number}</time>
          <span className="check-in-day-mark" aria-hidden="true">
            {cell.state === 'checked' ? <Icon name="check" size={14} /> : cell.isToday ? `+${DAILY_LOGIN_REWARD}` : cell.state === 'missed' ? '—' : '·'}
          </span></>
        return <td key={cell.day} title={label}>{cell.isToday && isCurrent
          ? <button type="button" className={className} data-day={cell.day} aria-current="date"
            aria-label={cell.state === 'checked' ? label : t('calendar.claimDay', { day: cell.label, n: DAILY_LOGIN_REWARD })}
            disabled={disabled || cell.state === 'checked'} onClick={onClaim}>{content}</button>
          : <div className={className} data-day={cell.day} aria-label={label}>{content}</div>}
        </td>
      })}</tr>)}</tbody>
    </table>
    <div className="check-in-calendar-legend" aria-label={t('calendar.legend')}>
      <span><i className="is-checked" />{t('calendar.checked')}</span>
      <span><i className="is-today" />{t('calendar.today')}</span>
      <span><i className="is-upcoming" />{t('calendar.upcoming')}</span>
      {view?.available && <span><i className="is-missed" />{t('calendar.missed')}</span>}
    </div>
    <p className="check-in-calendar-note">{t(isCurrent ? 'calendar.rule' : 'calendar.pastRule')}</p>
    {!view?.available && <p className="check-in-calendar-unavailable" role="status">
      {t(cache[month] === undefined ? 'calendar.historyUnavailable' : 'calendar.historyFailed')}
    </p>}
  </div>
}
