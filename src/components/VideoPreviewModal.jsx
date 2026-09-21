import { useEffect } from 'react'
import Icon from './Icon'
import { parseYoutube } from '../lib/youtube'
import { useI18n } from '../lib/i18n.jsx'

/* Hall of Fame opens a contained 30-second preview instead of throwing the
   user onto YouTube immediately. The end parameter is enforced by the player;
   the close button remains available when the viewer wants to leave early. */
export default function VideoPreviewModal({ video, onClose }) {
  const { t } = useI18n()
  const id = parseYoutube(video?.video_url || video?.url || '')?.id
  useEffect(() => {
    if (!video) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [video, onClose])
  if (!video || !id) return null
  const src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&start=0&end=30&controls=1&rel=0`
  return (
    <div className="video-preview-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <section className="video-preview" role="dialog" aria-modal="true" aria-labelledby="video-preview-title">
        <header className="video-preview-head">
          <div>
            <h2 id="video-preview-title">{video.title}</h2>
            <span>{t('preview.thirty')}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('preview.close')} title={t('preview.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="video-preview-frame">
          <iframe src={src} title={video.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
        <footer className="video-preview-foot">
          <a className="btn btn-sm" href={video.video_url} target="_blank" rel="noreferrer">
            <Icon name="ext" size={13} />{t('preview.open')}
          </a>
        </footer>
      </section>
    </div>
  )
}
