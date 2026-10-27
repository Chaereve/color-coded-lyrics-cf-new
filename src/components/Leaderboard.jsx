import { useMemo, useRef, useState } from 'react'
import { useCountUp } from '../lib/motion'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { usePager } from '../lib/usePager'
import { rankRowsByAverage } from '../lib/ranking.js'
import { PERIODS, seasonRows, seasonWindow, seasonLabel } from '../lib/season.js'
import { useNav, spaLink } from '../lib/nav'
import { profileUrl } from '../lib/history'
import Pager from './Pager'

const PER_PAGE = 25

const initials = (name) => (name || '?').trim()[0]?.toUpperCase() || '?'

function Face({ p, size = 'md' }) {
  return p.avatar_url
    ? <img className={`lb-av ${size}`} src={p.avatar_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span className={`lb-av ${size} ph`}>{initials(p.name)}</span>
}

function PodiumFace({ p, place, period = 'all' }) {
  const { t } = useI18n()
  const nav = useNav()
  const average = useCountUp(p.score, 620)
  const reward = period === 'month'
    ? (place === 1 ? t('rank.reward.m1') : place === 2 ? t('rank.reward.m2') : place === 3 ? t('rank.reward.m3') : null)
    : null

  return (
    <article className={`lb-pod p${place}`} style={{ '--i': place - 1 }}>
      <div className="lb-pod-person">
        <span className="lb-pod-facewrap">
          <Face p={p} size="lg" />
          {place === 1 && <span className="lb-pod-crown" aria-hidden="true"><Icon name="crown" size={12} /></span>}
        </span>
        <span className="lb-pod-name-row">
          {p.user_id
            ? <a className="requester-link lb-pod-name" href={profileUrl(p.user_id)} onClick={spaLink(nav.openProfile, p.user_id)} title={p.name}>{p.name}</a>
            : <span className="lb-pod-name" title={p.name}>{p.name}</span>}
        </span>
        <span className="lb-pod-num">
          <b>{Number(average || 0).toFixed(2)}</b>
          <span>{t('rank.averageScore')}</span>
        </span>
        {reward && <span className="lb-pod-reward"><Icon name="cup" size={11} /> {reward}</span>}
      </div>
      <div className="lb-pedestal" aria-hidden="true"><b>{place}</b></div>
    </article>
  )
}

function PeriodSeg({ period, setPeriod }) {
  const { t } = useI18n()
  return (
    <div className="lb-tabs lb-periodseg" role="group" aria-label={t('rank.periodLabel')}>
      {PERIODS.map((p) => (
        <button key={p.k} type="button" className={`lb-tab${period === p.k ? ' on' : ''}`}
          onClick={() => setPeriod(p.k)} aria-pressed={period === p.k}>
          {p.k === 'all' ? t('rank.period.all') : t('rank.period.month')}
        </button>
      ))}
    </div>
  )
}

function RankingsHeader({ period, setPeriod, showNotRanked = false, range = null }) {
  const { t } = useI18n()
  return (
    <div className="lb-list-head">
      <div className="lb-list-heading">
        <h3><Icon name="cup" size={14} />{t('rank.listTitle')}</h3>
        {showNotRanked && <span className="lb-not-ranked">{t('rank.noMe')}</span>}
      </div>
      <PeriodSeg period={period} setPeriod={setPeriod} />
      {range && <span className="sr-only">{range}</span>}
    </div>
  )
}

export default function Leaderboard({ rows, allRows = [], ranking = [], meId, initialPeriod = 'all', now = null, votesLog = [], loading = false }) {
  const { t } = useI18n()
  const nav = useNav()
  const [period, setPeriod] = useState(PERIODS.some(p => p.k === initialPeriod) ? initialPeriod : 'all')
  const nowMs = useMemo(() => now ?? Date.now(), [now])

  /* `votesLog` = phiếu nhận gần đây (db.js fetchRecentVotes): bảng tháng đếm
     "vote nhận trong tháng" nên cần mốc từng phiếu, không chỉ tổng vote trên
     hàng request. Leaderboard hiện chỉ có All time và This month. */
  const view = useMemo(
    () => (period === 'all' ? (rows || []) : seasonRows(allRows, ranking, period, nowMs, votesLog)),
    [rows, allRows, ranking, period, nowMs, votesLog])

  const ranked = useMemo(() => rankRowsByAverage(view), [view])

  const podium = ranked.slice(0, 3)
  const meRanked = ranked.some(p => p.user_id === meId)

  const tableRef = useRef(null)
  const pg = usePager(ranked, PER_PAGE, [period])
  const win = period === 'all' ? null : seasonWindow(period, nowMs)
  const range = win ? seasonLabel(period, nowMs) : null
  const rangeLabel = range ? t('rank.range', { from: range.from, to: range.to }) : null

  /* ĐANG TẢI vs RỖNG THẬT. Bảng này chỉ là một cách NHÌN cùng dữ liệu của
     bảng request, nên khi bảng còn đang nạp (lần đầu, hoặc sau khi mất mạng
     rồi được kéo lại) nó từng in thẳng "No data yet." — một câu SAI: dữ liệu
     đang tới, không phải không có. Chỉ hiện xương khi thật sự chưa có dòng
     nào để vẽ; đã có số rồi thì mọi lần làm mới đều im lặng. */
  const showSkeleton = loading && !ranked.length
  const isEmpty = !showSkeleton && !ranked.length

  return (
    <div className="lb" data-reveal>
      <h2 className="sr-only">{t('rank.title')}</h2>
      <p className="lb-rule sr-only">
        {period === 'all' ? t('rank.rule.average') : t('rank.periodRule.average')}
      </p>
      {!isEmpty && !showSkeleton && (
        <div key={period} className={`lb-top c${Math.min(podium.length, 3)}`}>
          {[podium[1], podium[0], podium[2]].filter(Boolean).map(p => (
            <PodiumFace key={p.key || p.user_id || p.place} p={p} place={p.place} period={period} />
          ))}
        </div>
      )}

      <RankingsHeader period={period} setPeriod={setPeriod} showNotRanked={ranked.length > 0 && !meRanked} range={rangeLabel} />

      {isEmpty && (
        /* Khối rỗng theo khuôn chung (icon + giải thích + hành động): kỳ không
           có dữ liệu thì lối ra tự nhiên nhất là quay về All time — đừng bắt
           người đọc tự tìm nút đổi kỳ ở trên. */
        <div className="empty">
          <span className="empty-ico" aria-hidden="true"><Icon name="cup" size={18} /></span>
          <b>{t(`rank.emptyPeriod.${period}`)}</b>
          {period !== 'all' && (
            <span className="empty-acts">
              <button type="button" className="btn btn-sm" onClick={() => setPeriod('all')}>{t('rank.emptyCta')}</button>
            </span>
          )}
        </div>
      )}

      {showSkeleton && (
        <div className="sklist" role="status" aria-label={t('board.loading')}>
          {Array.from({ length: 5 }, (_, i) => (
            <div className="skrow" key={i} style={{ '--i': i }} aria-hidden="true">
              <span className="sk sk-l1" />
              <span className="sk sk-l2" />
              <span className="sk sk-vote" />
            </div>
          ))}
        </div>
      )}

      {ranked.length > 0 && (
        <div className="lb-twrap">
          <table className="lb-table" ref={tableRef}>
            <thead>
              <tr>
                <th className="c-rk" scope="col">#</th>
                <th scope="col">{t('rank.player')}</th>
                <th className="num score-col" scope="col">{t('rank.averageScore')}</th>
                <th className="num" scope="col">{t('rank.requests')}</th>
                <th className="num hide-sm" scope="col">{t('rank.completed')}</th>
                <th className="num" scope="col">{t('rank.votes')}</th>
              </tr>
            </thead>
            <tbody key={period}>
              {pg.items.map((p, i) => (
                <tr key={p.key || p.user_id || p.place} className={p.user_id === meId ? 'me' : ''} style={{ '--i': Math.min(i, 20) }}>
                  <td className="c-rk"><b>{p.place}</b></td>
                  <td className="c-pl">
                    <span className="lb-pl-in">
                      <Face p={p} />
                      {p.user_id
                        ? <a className="requester-link lb-nm" href={profileUrl(p.user_id)} onClick={spaLink(nav.openProfile, p.user_id)} title={p.name}>{p.name}</a>
                        : <span className="lb-nm" title={p.name}>{p.name}</span>}
                      {p.user_id === meId && <span className="lb-you">{t('rank.you')}</span>}
                    </span>
                    <i className="lb-underline" style={{ width: `${Math.round(p.share * 100)}%` }} aria-hidden="true" />
                  </td>
                  <td className="num score-col"><b>{Number(p.score || 0).toFixed(2)}</b></td>
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

    </div>
  )
}
