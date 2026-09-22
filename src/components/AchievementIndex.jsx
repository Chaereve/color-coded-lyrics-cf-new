import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { ACHIEVEMENTS, evaluateAchievements } from '../lib/achievements.js'
import { useI18n } from '../lib/i18n.jsx'

/* Danh mục luôn hiện cả mốc chưa đạt: người dùng cần thấy mình còn cách
   phần thưởng bao xa, không phải chỉ được xem một bộ sưu tập đã hoàn thành. */
export default function AchievementIndex({ metrics = {} }) {
  const { t } = useI18n()
  const [showModal, setShowModal] = useState(false)
  const items = useMemo(() => evaluateAchievements(metrics), [metrics])

  useEffect(() => {
    if (!showModal) return
    const onKey = (e) => { if (e.key === 'Escape') setShowModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showModal])

  /* Hiển thị tóm tắt 4 thành tựu đầu trên trang About me; xem toàn bộ qua popup */
  const preview = items.slice(0, 4)
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
      <div className="achievement-grid">
        {preview.map(a => (
          <article className={`achievement-card${a.earned ? ' earned' : ''}`} key={a.id}>
            <span className="achievement-icon" aria-hidden="true"><Icon name={a.earned ? 'check' : 'star'} size={14} /></span>
            <div className="achievement-copy">
              <b>{t(a.title)}</b>
              <small>{t(a.desc)}</small>
              <span><em>{t('ach.reward')}:</em> {t(a.reward)}</span>
            </div>
            <strong>{a.earned ? t('ach.earned') : t('ach.locked')}</strong>
          </article>
        ))}
      </div>

      {showModal && (
        <div className="overlay achievement-overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal ach-modal" role="dialog" aria-modal="true" aria-labelledby="ach-modal-title">
            <div className="modal-head">
              <h2 id="ach-modal-title" className="prof-h2">
                <Icon name="cup" size={16} /> {t('ach.popupTitle')}
                <span className="ach-modal-count">{earnedCount}/{items.length}</span>
              </h2>
              <button type="button" className="x" onClick={() => setShowModal(false)} aria-label={t('ach.close')}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="modal-body ach-modal-body">
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
        </div>
      )}
    </section>
  )
}
