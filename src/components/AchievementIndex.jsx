import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { ACHIEVEMENTS, evaluateAchievements } from '../lib/achievements.js'
import { useI18n } from '../lib/i18n.jsx'
import { useFocusTrap } from '../lib/useFocusTrap'

/* Danh mục luôn hiện cả mốc chưa đạt: người dùng cần thấy mình còn cách
   phần thưởng bao xa, không phải chỉ được xem một bộ sưu tập đã hoàn thành. */
export default function AchievementIndex({ metrics = {} }) {
  const { t } = useI18n()
  const [showModal, setShowModal] = useState(false)
  const achRef = useRef(null)
  /* Danh mục mở ra là một hộp thoại thật (lớp phủ chặn trang): Tab phải ở
     trong đó, và đóng thì trả tiêu điểm về nút vừa mở. */
  useFocusTrap(achRef, showModal)
  const items = useMemo(() => evaluateAchievements(metrics), [metrics])

  useEffect(() => {
    if (!showModal) return
    const onKey = (e) => { if (e.key === 'Escape') setShowModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showModal])

  /* Giữ phần xem nhanh ngắn: 3 mốc chưa đạt gần hoàn thành nhất. Danh mục đủ
     52 mốc, mô tả và phần thưởng vẫn ở popup "View all" bên dưới. */
  const preview = useMemo(() => items
        .filter(a => !a.earned && a.source !== 'leaderboard' && a.need > 0)
    .sort((a, b) => (b.progress / b.need) - (a.progress / a.need) || a.need - b.need)
    .slice(0, 3), [items])
  const earnedCount = items.filter(a => a.earned).length

  return (
    <section className="achievement-index" aria-labelledby="achievement-index-title">
      <div className="achievement-head">
        <h2 id="achievement-index-title"><Icon name="cup" size={15} />{t('ach.index')}</h2>
        <div className="achievement-head-side">
          <span className="achievement-count">{earnedCount}/{ACHIEVEMENTS.length}</span>
          <button type="button" className="achievement-all-btn" onClick={() => setShowModal(true)}>
            {t('ach.showAll', { n: items.length })}
          </button>
        </div>
      </div>
      <div className="achievement-next-label">{t('ach.closest')}</div>
      <div className="achievement-next-list" aria-label={t('ach.closest')}>
        {preview.map(a => {
          const percent = Math.min(100, Math.round((a.progress / a.need) * 100))
          return (
            <article className="achievement-next-row" key={a.id}>
              <div className="achievement-next-title">
                <b>{t(a.title)}</b>
                <strong>{a.progress}/{a.need}</strong>
              </div>
              <div className="achievement-next-bar" role="progressbar" aria-label={t(a.title)}
                aria-valuemin="0" aria-valuemax={a.need} aria-valuenow={a.progress}>
                <i style={{ width: `${percent}%` }} />
              </div>
            </article>
          )
        })}
        {preview.length === 0 && <div className="achievement-next-empty">{t('ach.noneClose')}</div>}
      </div>

      {showModal && createPortal(
        <div className="overlay achievement-overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal ach-modal" ref={achRef} role="dialog" aria-modal="true" aria-labelledby="ach-modal-title">
            <div className="modal-head">
              <h2 id="ach-modal-title" className="prof-h2">
                <Icon name="cup" size={16} /> {t('ach.popupTitle')}
                <span className="ach-modal-count">{earnedCount}/{items.length}</span>
              </h2>
              <button type="button" className="x" onClick={() => setShowModal(false)} aria-label={t('ach.close')}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body ach-modal-body" tabIndex={0} role="region" aria-label={t('ach.scrollRegion')}>
              <div className="achievement-grid-full">
                {items.map(a => (
                  <article className={`achievement-card${a.earned ? ' earned' : ''}`} key={a.id}>
                    <span className="achievement-icon" aria-hidden="true"><Icon name={a.earned ? 'check' : 'star'} size={14} /></span>
                    <div className="achievement-copy">
                      <b>{t(a.title)}</b>
                      <small>{t(a.desc)}</small>
                      <span><em>{t('ach.reward')}:</em> {t(a.reward)}</span>
                      {a.source !== 'leaderboard' && (
                        <div className="ach-prog-bar">
                          <i style={{ width: `${Math.min(100, Math.round((a.progress / a.need) * 100))}%` }} />
                        </div>
                      )}
                    </div>
                    <strong>{a.earned ? t('ach.earned') : `${a.progress}/${a.need}`}</strong>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
