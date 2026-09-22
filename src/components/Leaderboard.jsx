import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { useCountUp } from '../lib/motion'
import { usePager } from '../lib/usePager'
import { RANK_SORTS, rankRows } from '../lib/ranking.js'
import { PERIODS, seasonRows, seasonWindow, seasonLabel } from '../lib/season.js'
import Pager from './Pager'

const PER_PAGE = 25

const SORTS = RANK_SORTS

const initials = (name) => (name || '?').trim()[0]?.toUpperCase() || '?'

function Face({ p, size = 'md' }) {
  return p.avatar_url
    ? <img className={`lb-av ${size}`} src={p.avatar_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span className={`lb-av ${size} ph`}>{initials(p.name)}</span>
}

const NUM_LABEL = { total: 'requests', completed: 'completed', total_votes: 'votes' }

function PodiumFace({ p, place, max, sort, period = 'all' }) {
  const { t } = useI18n()
  const n = useCountUp(p[sort.field], 620)
  const pct = max ? Math.round((p[sort.field] / max) * 100) : 0
  const minis = sort.minis
  const reward = period === 'week'
    ? (place === 1 ? t('rank.reward.w1') : place === 2 ? t('rank.reward.w2') : place === 3 ? t('rank.reward.w3') : null)
    : period === 'month'
      ? (place === 1 ? t('rank.reward.m1') : place === 2 ? t('rank.reward.m2') : place === 3 ? t('rank.reward.m3') : null)
      : null

  return (
    <div className={`lb-pod p${place}`} style={{ '--i': place - 1 }}>
      <span className="lb-medal" aria-hidden="true">
        <Icon name="star" size={16} />
        <b>{place}</b>
      </span>
      <Face p={p} size="lg" />
      <div className="lb-pod-name" title={p.name}>{p.name}</div>
      <div className="lb-pod-num">
        <b key={sort.k}>{n}</b>
        <span>{t(`rank.${NUM_LABEL[sort.field]}`)}</span>
      </div>
      <div className="lb-pod-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="lb-pod-mini">
        {minis.map(f => <span key={f}>{p[f] ?? 0} {t(`rank.${NUM_LABEL[f]}`)}</span>)}
      </div>
      {reward && (
        <div className="lb-pod-reward" title={reward}>
          <Icon name="cup" size={11} /> {reward}
        </div>
      )}
    </div>
  )
}

function PeriodSeg({ period, setPeriod, title }) {
  const { t } = useI18n()
  return (
    <div className="lb-tabs lb-periodseg" role="group" aria-label={t('rank.periodLabel')} title={title}>
      {PERIODS.map((p) => (
        <button key={p.k} type="button" className={`lb-tab${period === p.k ? ' on' : ''}`}
          onClick={() => setPeriod(p.k)} aria-pressed={period === p.k}>
          {p.k === 'all' ? t('rank.period.all') : p.k === 'week' ? t('rank.period.week') : t('rank.period.month')}
        </button>
      ))}
    </div>
  )
}

function RewardsModal({ open, onClose }) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="lb-rewards-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <section className="lb-rewards-modal" role="dialog" aria-modal="true" aria-labelledby="lb-rewards-title">
        <header className="lb-rewards-head">
          <div>
            <h3 id="lb-rewards-title"><Icon name="cup" size={14} /> {t('rank.rewards.title')}</h3>
            <span>{t('rank.rewards.subtitle')}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('btn.close')} title={t('btn.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="lb-rewards-body">
          <div className="lb-rewards-group">
            <div className="lb-rewards-sub">{t('rank.rewards.weekTitle')}</div>
            <p className="lb-rewards-desc">{t('rank.rewards.weekDesc')}</p>
            <ul>
              <li><b>1st</b> — {t('rank.reward.w1')}</li>
              <li><b>2nd</b> — {t('rank.reward.w2')}</li>
              <li><b>3rd</b> — {t('rank.reward.w3')}</li>
            </ul>
          </div>
          <div className="lb-rewards-group">
            <div className="lb-rewards-sub">{t('rank.rewards.monthTitle')}</div>
            <p className="lb-rewards-desc">{t('rank.rewards.monthDesc')}</p>
            <ul>
              <li><b>1st</b> — {t('rank.reward.m1')}</li>
              <li><b>2nd</b> — {t('rank.reward.m2')}</li>
              <li><b>3rd</b> — {t('rank.reward.m3')}</li>
            </ul>
          </div>
        </div>
        <footer className="lb-rewards-foot">
          <small>{t('rank.rewards.note')}</small>
        </footer>
      </section>
    </div>
  )
}

export default function Leaderboard({ rows, allRows = [], ranking = [], meId, initialPeriod = 'all', now = null }) {
  const { t } = useI18n()
  const [sort, setSort] = useState(SORTS[0])
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [period, setPeriod] = useState(PERIODS.some(p => p.k === initialPeriod) ? initialPeriod : 'all')
  const nowMs = useMemo(() => now ?? Date.now(), [now])

  const view = useMemo(
    () => (period === 'all' ? (rows || []) : seasonRows(allRows, ranking, period, nowMs)),
    [rows, allRows, ranking, period, nowMs])

  const ranked = useMemo(() => rankRows(view, sort.k), [view, sort.k])

  const max = ranked[0] ? Number(ranked[0][sort.field]) || 0 : 0
  const podium = ranked.slice(0, 3)
  const rest = ranked.slice(3)
  const me = ranked.find(p => p.user_id === meId)

  const tableRef = useRef(null)
  const pg = usePager(rest, PER_PAGE, [sort.k, period])

  const win = period === 'all' ? null : seasonWindow(period, nowMs)
  const range = win ? seasonLabel(period, nowMs) : null
  const seasonTitle = [
    range ? t('rank.range', { from: range.from, to: range.to }) : null,
    t('rank.rangeTip'),
    period === 'all' ? null : t('rank.votesNote'),
  ].filter(Boolean).join(' · ')

  const isEmpty = !ranked.length

  return (
    <div className="lb" data-reveal>
      <div className="lb-bar">
        <div className="lb-bar-tx">
          <span className="lb-kicker">{t('rank.kicker')}</span>
          <h2 className="lb-title">
            {t('rank.title')}
            <button type="button" className="lb-help" aria-label={t('rank.rewards.title')} title={t('rank.rewards.title')} onClick={() => setRewardsOpen(true)}>
              ?
            </button>
          </h2>
          {/* Rule is always shown so empty week still has context, but empty message replaces podium */}
          <p className="lb-rule">
            {period === 'all' ? t(`rank.rule.${sort.k}`) : t(`rank.periodRule.${sort.k}`)}
          </p>
        </div>
        <div className="lb-bar-ctl">
          <PeriodSeg period={period} setPeriod={setPeriod} title={seasonTitle} />
          {/* Always show sort chips, even when empty, so user sees categories */}
          <div className="lb-seg" role="group" aria-label={t('rank.sortLabel')}>
            {SORTS.map((s, i) => (
              <button key={s.k} type="button" className={`lb-segb${sort.k === s.k ? ' on' : ''}`}
                style={{ '--c': s.tone, '--i': i }} onClick={() => setSort(s)} aria-pressed={sort.k === s.k}>
                {t(`rank.sort.${s.k}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isEmpty && <div className="empty">{t(`rank.emptyPeriod.${period}`)}</div>}

      {!isEmpty && (
        <div key={`top-${period}`} className={`lb-top c${Math.min(podium.length, 3)}`}>
          {[podium[1], podium[0], podium[2]].filter(Boolean).map(p => (
            <PodiumFace key={p.key || p.user_id || p.place} p={p} place={p.place} max={max} sort={sort} period={period} />
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <div key={`tbl-${period}`} className="lb-twrap">
          <table className="lb-table" ref={tableRef}>
            <thead>
              <tr>
                <th className="c-rk" scope="col">#</th>
                <th scope="col">{t('rank.player')}</th>
                <th className="num" scope="col">{t('rank.requests')}</th>
                <th className="num hide-sm" scope="col">{t('rank.completed')}</th>
                <th className="num" scope="col">{t('rank.votes')}</th>
              </tr>
            </thead>
            <tbody>
              {pg.items.map((p, i) => (
                <tr key={p.key || p.user_id || p.place} className={p.user_id === meId ? 'me' : ''} style={{ '--i': Math.min(i, 20) }}>
                  <td className="c-rk"><b>{p.place}</b></td>
                  <td className="c-pl">
                    <span className="lb-pl-in">
                      <Face p={p} />
                      <span className="lb-nm" title={p.name}>{p.name}</span>
                      {p.user_id === meId && <span className="lb-you">{t('rank.you')}</span>}
                    </span>
                    <i className="lb-underline" style={{ width: `${Math.round(p.share * 100)}%` }} aria-hidden="true" />
                  </td>
                  <td className="num">{p.total}</td>
                  <td className="num hide-sm">
                    <b>{p.completed}</b>
                    <span className="lb-rate">{p.rate}%</span>
                  </td>
                  <td className="num lb-votes"><b>{p.total_votes}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager {...pg} onChange={pg.setPage} scrollTo={tableRef} />

      {!isEmpty && <div className={`lb-me${me ? ' has' : ''}`}>
        {me ? (
          <>
            <span className="lb-me-rk">{me.place}</span>
            <Face p={me} />
            <span className="lb-me-nm">{me.name}</span>
            <span className="lb-me-stats">
              <span>{t('rank.position', { n: me.place, total: ranked.length })}</span>
              <span className="dot" aria-hidden="true" />
              <span>{me.total} {t('rank.requests')}</span>
              <span className="dot" aria-hidden="true" />
              <span>{me.total_votes} {t('rank.votes')}</span>
            </span>
          </>
        ) : (
          <span className="lb-me-nm">{t('rank.noMe')}</span>
        )}
      </div>}

      <RewardsModal open={rewardsOpen} onClose={() => setRewardsOpen(false)} />
    </div>
  )
}
