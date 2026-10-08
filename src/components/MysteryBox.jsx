import { useEffect, useRef, useState } from 'react'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import {
  openMysteryBox, announceMysteryChanged, MYSTERY_SYNC_KEY,
} from '../lib/mysteryBox.js'
import './MysteryBox.css'

/* =========================================================
   MYSTERY BOX CARD (300×300) — một hộp mỗi ngày, mở sau check-in
   ---------------------------------------------------------
   Bốn trạng thái, đều do DỮ LIỆU THẬT quyết định:
     · enabled = false hoặc status null → card không được render (cha lo)
     · locked   : chưa check-in hôm nay — hộp khoá, mở được sau khi điểm danh
     · ready    : đã check-in, chưa mở — nút "Open the box"
     · opened   : đã mở (kể cả replay) — hiện kết quả đã commit trong DB
   Hiệu ứng: lắc hộp khi đang mở, pop khi lộ quà; prefers-reduced-motion
   tắt hết. Chỉ hiển thị "votes" — không đơn vị nào khác.
   ========================================================= */

export function MysteryBox({ userId, mystery, checkedIn, onOpened }) {
  const { t } = useI18n()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [reveal, setReveal] = useState(false)
  const timer = useRef(null)
  const busy = useRef(false)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    const refresh = () => { if (!document.hidden && onOpened) onOpened() }
    const storage = event => { if (event.key === MYSTERY_SYNC_KEY) refresh() }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [onOpened])

  if (!mystery?.enabled) return null
  const day = mystery.day
  const opened = mystery.opened || (reveal && mystery.result !== null)

  const open = async () => {
    if (busy.current || opening || opened || !checkedIn) return
    busy.current = true
    setOpening(true)
    setError('')
    try {
      const result = await openMysteryBox(userId, day)
      announceMysteryChanged()
      setReveal(true)
      // Nhịp lắc ~700ms trước khi lộ quà: chờ animation chạy xong rồi mới
      // báo lên để cha cập nhật trạng thái.
      timer.current = setTimeout(() => {
        setOpening(false)
        if (onOpened) onOpened(result.mystery)
      }, 720)
    } catch (e) {
      setOpening(false)
      setError(errMsg(t, e))
    } finally {
      busy.current = false
    }
  }

  const prize = opened ? mystery.result : null
  const kind = opened ? mystery.reward_kind : null
  const votes = opened ? mystery.reward_votes : 0

  return (
    <section
      className={`mystery-card${opening ? ' is-opening' : ''}${opened ? ' is-opened' : ''}${!checkedIn ? ' is-locked' : ''}`}
      aria-label={t('mystery.cardLabel')}
      aria-busy={opening}
    >
      <p className="mystery-title">{t('mystery.title')}</p>

      <div className="mystery-box-stage" aria-hidden="true">
        <div className="mystery-box">
          <span className="mystery-lid" />
          <span className="mystery-ribbon" />
          <span className="mystery-q">?</span>
        </div>
      </div>

      {opened ? (
        <p className="mystery-prize" role="status">
          {kind === 'nothing' && t('mystery.nothing')}
          {kind === 'votes' && (votes === 1 ? t('mystery.votesOne') : t('mystery.votesMany', { n: votes }))}
          {kind === 'paid_request' && t('mystery.paidRequest')}
        </p>
      ) : checkedIn ? (
        <>
          <p className="mystery-copy">{t('mystery.ready')}</p>
          <button type="button" className="btn btn-primary mystery-open" onClick={open} disabled={opening}>
            {t(opening ? 'mystery.opening' : 'mystery.openNow')}
          </button>
        </>
      ) : (
        <p className="mystery-copy">{t('mystery.locked')}</p>
      )}

      {error ? <p className="mystery-error" role="alert">{error}</p> : null}
    </section>
  )
}

export default MysteryBox
