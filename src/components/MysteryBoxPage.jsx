import { useCallback, useEffect, useRef, useState } from 'react'
import MysteryBox from './MysteryBox'
import Icon from './Icon'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useModalExit } from '../lib/useModalExit'
import { hasSupabase } from '../lib/supabaseClient.js'
import {
  fetchMysteryStatus, fetchMysteryMonth, rememberMysteryOpen, buildMysteryMonth,
  MYSTERY_PRIZES, MYSTERY_SYNC_KEY,
} from '../lib/mysteryBox.js'
import {
  fetchDailyLoginCalendarStatus, DAILY_LOGIN_CALENDAR_SYNC_KEY,
} from '../lib/dailyLoginCalendar.js'
import { monthOf, shiftMonth, isCalendarMonth } from '../lib/checkInCalendar.js'
import { spinCountdown, nextSpinReset } from '../lib/dailySpin.js'
import './MysteryBox.css'

/* =========================================================
   /mystery-box — TRANG RIÊNG của Mystery Box (B2, tách khỏi /daily-login)
   ---------------------------------------------------------
   Một hộp mỗi ngày, mở SAU khi điểm danh. Trang này KHÔNG điểm danh hộ ai:
   chưa check-in thì hộp khoá và dẫn người chơi sang /daily-login. Trạng thái
   `checked_in` là dữ liệu thật từ RPC `my_mystery_status`; riêng demo mode
   (không Supabase) đọc lịch demo để biết hôm nay đã điểm danh chưa.

   Không có dữ liệu (migration chưa chạy / cờ tắt / lỗi RPC) → trang báo
   "chưa khả dụng" thay vì dựng một card giả.

   Bảng giải và lịch sử tháng không chiếm layout: nút mở popup
   (danh sách lần mở, không lưới lịch).
   ========================================================= */

const formatPct = w => `${(w / 10).toLocaleString('en-US')}%`

export default function MysteryBoxPage({ userId, onDailyLogin }) {
  const { t } = useI18n()
  const [mystery, setMystery] = useState(null)
  const [demoClaimed, setDemoClaimed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deadline, setDeadline] = useState(null)
  const [clock, setClock] = useState(() => performance.now())
  const [oddsOpen, setOddsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [monthOpens, setMonthOpens] = useState([])
  const [viewMonth, setViewMonth] = useState(null)
  const mounted = useRef(false)
  const readVersion = useRef(0)
  const oddsRef = useRef(null)
  const historyRef = useRef(null)
  const { mounted: oddsMounted, closing: oddsClosing } = useModalExit(oddsOpen)
  const { mounted: historyMounted, closing: historyClosing } = useModalExit(historyOpen)
  useFocusTrap(oddsRef, oddsOpen)
  useFocusTrap(historyRef, historyOpen)

  const load = useCallback(async () => {
    if (!userId) return
    const version = ++readVersion.current
    try {
      const box = await fetchMysteryStatus(userId)
      if (!mounted.current || version !== readVersion.current) return
      setMystery(box)
      if (box?.opened) rememberMysteryOpen(userId, box)
      setError('')
      // Reset nửa đêm Việt Nam — cùng mốc của server (spinDay/nextSpinReset),
      // trôi lệch đồng hồ máy chỉ ảnh hưởng đồng hồ hiển thị, không ảnh hưởng
      // quyền mở hộp: quyền nằm ở RPC và poll 60s sẽ tự làm mới dữ liệu.
      const reset = Date.parse(nextSpinReset())
      if (Number.isFinite(reset)) setDeadline(performance.now() + Math.max(0, reset - Date.now()))
      if (!hasSupabase) {
        // Demo: card tự biết "đã mở hay chưa", nhưng "đã check-in chưa" nằm ở
        // lịch demo — đọc song song, lỗi lịch chỉ là khoá hộp, không chết trang.
        try {
          const status = await fetchDailyLoginCalendarStatus(userId)
          if (mounted.current && version === readVersion.current) setDemoClaimed(status.login.claimed)
        } catch { if (mounted.current) setDemoClaimed(false) }
      }
    } catch (e) {
      if (mounted.current && version === readVersion.current) setError(errMsg(t, e))
    } finally {
      if (mounted.current && version === readVersion.current) setLoading(false)
    }
  }, [userId, t])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (!document.hidden) load() }
    // Hai nguồn thay đổi: hộp được mở ở tab khác, hoặc check-in vừa xảy ra.
    const storage = event => {
      if (event.key === MYSTERY_SYNC_KEY || event.key === DAILY_LOGIN_CALENDAR_SYNC_KEY) refresh()
    }
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
    const id = setTimeout(() => load(), Math.max(500, deadline - performance.now() + 100))
    return () => clearTimeout(id)
  }, [deadline, load])

  const today = mystery?.day || null
  const currentMonth = today ? monthOf(today) : null
  const month = isCalendarMonth(viewMonth) ? viewMonth : currentMonth

  const loadMonth = useCallback(async (target) => {
    if (!userId || !isCalendarMonth(target)) return
    try {
      const payload = await fetchMysteryMonth(userId, target)
      if (!mounted.current) return
      setMonthOpens(payload.opens)
      setViewMonth(payload.month)
    } catch {
      if (mounted.current) setMonthOpens([])
    }
  }, [userId])

  useEffect(() => {
    if (historyOpen && month) loadMonth(month)
  }, [historyOpen, month, mystery?.opened, mystery?.result, loadMonth])

  useEffect(() => {
    if (!oddsOpen && !historyOpen) return
    const onKey = e => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (historyOpen) setHistoryOpen(false)
      else setOddsOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [oddsOpen, historyOpen])

  const checkedIn = hasSupabase ? !!mystery?.checked_in : demoClaimed
  const titleId = 'mystery-page-title'
  const oddsOut = oddsClosing ? ' out' : ''
  const historyOut = historyClosing ? ' out' : ''
  const openHistory = () => {
    setOddsOpen(false)
    setHistoryOpen(true)
  }
  return (
    <section className="mystery-page" aria-labelledby={titleId} aria-busy={loading}>
      <header className="mystery-page-head">
        {/* H1 trang đã là "Daily Box" — h2 chỉ cho a11y, không lặp chữ trên màn. */}
        <h2 id={titleId} className="sr-only">{t('mystery.cardLabel')}</h2>
        {mystery && (
          <div className="mystery-page-acts">
            <button type="button" className="btn mystery-odds-btn"
              aria-haspopup="dialog" aria-expanded={oddsOpen}
              aria-controls="mystery-odds-dialog"
              onClick={() => { setHistoryOpen(false); setOddsOpen(true) }}>
              <Icon name="gift" size={15} />
              {t('mystery.oddsTitle')}
            </button>
            <button type="button" className="btn mystery-history-btn"
              aria-haspopup="dialog" aria-expanded={historyOpen}
              aria-controls="mystery-history-dialog"
              onClick={openHistory}>
              <Icon name="calendar" size={15} />
              {t('mystery.monthTitle')}
            </button>
          </div>
        )}
        {(!mystery || !mystery.opened) && (
          <div className="mystery-page-reset" title={t('spin.ruleReset')}>
            <span>{t('spin.resetIn')}</span>
            <b>{deadline === null ? '--:--:--' : spinCountdown(deadline - clock)}</b>
          </div>
        )}
      </header>

      {error && (
        <div className="mystery-page-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={load}>
            {t('spin.refresh')}
          </button>
        </div>
      )}

      {loading && <p className="mystery-page-loading" role="status">{t('daily.loading')}</p>}

      {!loading && !mystery && (
        <p className="mystery-page-unavailable" role="status">{t('mystery.unavailable')}</p>
      )}

      {mystery && (
        <>
          <MysteryBox userId={userId} mystery={mystery} checkedIn={checkedIn}
            onOpened={next => {
              if (next) {
                rememberMysteryOpen(userId, next)
                setMystery(next)
              } else load()
            }}
            nextResetAt={Date.parse(nextSpinReset())} />
          {!checkedIn && !mystery.opened && (
            <button type="button" className="btn mystery-gate-link" onClick={onDailyLogin}>
              {t('mystery.goCheckin')}
            </button>
          )}
        </>
      )}

      {oddsMounted && (
        <div className={`overlay${oddsOut}`}
          onMouseDown={e => { if (e.target === e.currentTarget) setOddsOpen(false) }}>
          <div ref={oddsRef} id="mystery-odds-dialog"
            className={`modal narrow mystery-odds-modal${oddsOut}`}
            role="dialog" aria-modal="true" aria-labelledby="mystery-odds-title">
            <div className="modal-head">
              <h2 className="dlg-title" id="mystery-odds-title">{t('mystery.oddsTitle')}</h2>
              <button type="button" className="x" onClick={() => setOddsOpen(false)}
                aria-label={t('btn.close')}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <ul className="mystery-odds">
                {MYSTERY_PRIZES.map(prize => (
                  <li key={prize.result}>
                    <span>
                      {prize.kind === 'nothing' && t('mystery.nothing')}
                      {prize.kind === 'votes' && (prize.votes === 1
                        ? t('mystery.votesOne') : t('mystery.votesMany', { n: prize.votes }))}
                      {/* Hai mức paid khác nhau RÕ số lượng: result 5 = +1,
                          result 6 = +2 — không gộp, không nhãn mơ hồ. */}
                      {prize.kind === 'free_paid_request'
                        && t(prize.requests === 2 ? 'mystery.paidRequestTwo' : 'mystery.paidRequestOne')}
                    </span>
                    <b>{formatPct(prize.weight)}</b>
                  </li>
                ))}
              </ul>
              <ul className="mystery-rules">
                <li>{t('mystery.ruleOnce')}</li>
                <li>{t('mystery.ruleCap')}</li>
                <li>{t('mystery.rulePaid')}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {historyMounted && (
        <div className={`overlay${historyOut}`}
          onMouseDown={e => { if (e.target === e.currentTarget) setHistoryOpen(false) }}>
          <div ref={historyRef} id="mystery-history-dialog"
            className={`modal narrow mystery-month-modal${historyOut}`}
            role="dialog" aria-modal="true" aria-labelledby="mystery-history-title"
            aria-describedby="mystery-history-caption">
            <MysteryHistory today={today} month={month} currentMonth={currentMonth}
              opens={monthOpens}
              onShift={delta => setViewMonth(shiftMonth(month, delta))}
              onClose={() => setHistoryOpen(false)} />
          </div>
        </div>
      )}
    </section>
  )
}

function prizeCopy(open, t) {
  if (!open) return t('mystery.monthIdle')
  if (open.reward_kind === 'nothing') return t('mystery.nothing')
  if (open.reward_kind === 'votes') {
    const n = open.reward_votes || open.reward_amount || 0
    return n === 1 ? t('mystery.votesOne') : t('mystery.votesMany', { n })
  }
  const n = open.reward_amount || (open.result === 6 ? 2 : 1)
  return t(n === 2 ? 'mystery.paidRequestTwo' : 'mystery.paidRequestOne')
}

function dayLabel(day) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))
}

function MysteryHistory({ today, month, currentMonth, opens, onShift, onClose }) {
  const { t } = useI18n()
  const calendar = today && month ? buildMysteryMonth(today, month, opens) : null
  const rows = (calendar?.cells || []).filter(cell => cell?.open).reverse()
  const earliest = currentMonth ? shiftMonth(currentMonth, -11) : null
  const count = calendar?.openedCount || 0
  return (
    <>
      <div className="modal-head">
        <h2 className="dlg-title" id="mystery-history-title">{t('mystery.monthTitle')}</h2>
        <button type="button" className="x" onClick={onClose} aria-label={t('btn.close')}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="modal-body mystery-month">
        <div className="mystery-month-head">
          <div className="mystery-month-nav">
            <button type="button" onClick={() => onShift(-1)}
              disabled={!earliest || !month || month <= earliest}
              aria-label={t('mystery.prevMonth')}>
              <Icon name="prev" size={16} />
            </button>
            <strong>{calendar?.monthLabel || '—'}</strong>
            <button type="button" onClick={() => onShift(1)}
              disabled={!currentMonth || !month || month >= currentMonth}
              aria-label={t('mystery.nextMonth')}>
              <Icon name="next" size={16} />
            </button>
          </div>
          <span className="mystery-month-count" id="mystery-history-caption">
            {calendar ? t('mystery.monthCaption', { month: calendar.monthLabel }) : t('mystery.monthIdle')}
          </span>
        </div>
        {count === 0 ? (
          <p className="mystery-month-empty">
            {t('mystery.monthEmpty')}
            <small>{t('mystery.monthIdle')}</small>
          </p>
        ) : (
          <ul className="mystery-history">
            {rows.map(cell => (
              <li key={cell.day} className={cell.open.reward_kind === 'nothing' ? 'is-miss' : 'is-hit'}>
                <time dateTime={cell.day}>{dayLabel(cell.day)}</time>
                <span>
                  <b>{prizeCopy(cell.open, t)}</b>
                  <small>{cell.open.reward_kind === 'nothing' ? t('mystery.monthMiss') : t('mystery.monthHit')}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        {count > 0 && (
          <p className="mystery-month-note">
            {t(count === 1 ? 'mystery.monthSummaryOne' : 'mystery.monthSummary', { n: count })}
          </p>
        )}
      </div>
    </>
  )
}
