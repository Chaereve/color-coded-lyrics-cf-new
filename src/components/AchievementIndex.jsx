import { useMemo } from 'react'
import Icon from './Icon'
import { ACHIEVEMENTS, evaluateAchievements } from '../lib/achievements.js'
import { useI18n } from '../lib/i18n.jsx'

/* Danh mục luôn hiện cả mốc chưa đạt: người dùng cần thấy mình còn cách
   phần thưởng bao xa, không phải chỉ được xem một bộ sưu tập đã hoàn thành. */
export default function AchievementIndex({ metrics = {} }) {
  const { t } = useI18n()
  const items = useMemo(() => evaluateAchievements(metrics), [metrics])
  return (
    <section className="achievement-index" aria-labelledby="achievement-index-title">
      <div className="achievement-head">
        <h2 id="achievement-index-title"><Icon name="cup" size={15} />{t('ach.index')}</h2>
        <span>{items.filter(a => a.earned).length}/{ACHIEVEMENTS.length}</span>
      </div>
      <div className="achievement-grid">
        {items.map(a => (
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
    </section>
  )
}
