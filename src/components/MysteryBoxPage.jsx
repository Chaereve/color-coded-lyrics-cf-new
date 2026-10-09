import { useCallback, useEffect, useRef, useState } from 'react'
import MysteryBox from './MysteryBox'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { hasSupabase } from '../lib/supabaseClient.js'
import { fetchMysteryStatus, MYSTERY_PRIZES, MYSTERY_SYNC_KEY } from '../lib/mysteryBox.js'
import {
  fetchDailyLoginCalendarStatus, DAILY_LOGIN_CALENDAR_SYNC_KEY,
} from '../lib/dailyLoginCalendar.js'
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
  const mounted = useRef(false)
  const readVersion = useRef(0)

  const load = useCallback(async () => {
    if (!userId) return
    const version = ++readVersion.current
    try {
      const box = await fetchMysteryStatus(userId)
      if (!mounted.current || version !== readVersion.current) return
      setMystery(box)
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

  const checkedIn = hasSupabase ? !!mystery?.checked_in : demoClaimed
  const titleId = 'mystery-page-title'
  return (
    <section className="mystery-page" aria-labelledby={titleId} aria-busy={loading}>
      <header className="mystery-page-head">
        <div className="mystery-page-heading">
          <h2 id={titleId}>{t('mystery.cardLabel')}</h2>
          <p className="mystery-page-sub">{t('mystery.ready')}</p>
        </div>
        <div className="mystery-page-reset" title={t('spin.ruleReset')}>
          <span>{t('spin.resetIn')}</span>
          <b>{deadline === null ? '--:--:--' : spinCountdown(deadline - clock)}</b>
        </div>
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
        <div className="mystery-page-grid">
          <div className="mystery-page-stage">
            <MysteryBox userId={userId} mystery={mystery} checkedIn={checkedIn}
              onOpened={next => (next ? setMystery(next) : load())} />
            {!checkedIn && !mystery.opened && (
              <button type="button" className="btn mystery-gate-link" onClick={onDailyLogin}>
                {t('mystery.goCheckin')}
              </button>
            )}
          </div>

          <aside className="mystery-side" aria-label={t('mystery.oddsTitle')}>
            <p className="mystery-side-title">{t('mystery.oddsTitle')}</p>
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
          </aside>
        </div>
      )}
    </section>
  )
}
