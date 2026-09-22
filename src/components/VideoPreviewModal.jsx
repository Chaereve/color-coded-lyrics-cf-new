import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { parseYoutube } from '../lib/youtube'
import { useI18n } from '../lib/i18n.jsx'

const MAX_SECONDS = 30
const YT_SRC = 'https://www.youtube.com/iframe_api'

function loadYT() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT)
  if (window._ytLoading) return window._ytLoading
  window._ytLoading = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${YT_SRC}"]`)
    if (!existing) {
      const s = document.createElement('script')
      s.src = YT_SRC
      s.async = true
      document.head.appendChild(s)
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev()
      resolve(window.YT)
    }
    // fallback polling in case ready already fired
    let tries = 0
    const iv = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(iv)
        resolve(window.YT)
      }
      if (++tries > 80) clearInterval(iv)
    }, 100)
  })
  return window._ytLoading
}

/* Hall of Fame preview: strictly 30s.
   - Uses YT IFrame Player API instead of static iframe ?end=30 (seek bypass)
   - Polls getCurrentTime() every 250ms, forces pause + seekTo(30) if >=30
   - Also handles user seeking past 30 by snapping back
   - Cleanup on close */
export default function VideoPreviewModal({ video, onClose }) {
  const { t } = useI18n()
  const id = parseYoutube(video?.video_url || video?.url || '')?.id
  const holderRef = useRef(null)
  const playerRef = useRef(null)
  const timerRef = useRef(null)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    if (!video) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [video, onClose])

  useEffect(() => {
    if (!video || !id || !holderRef.current) return undefined
    let cancelled = false
    setAtEnd(false)

    loadYT().then((YT) => {
      if (cancelled || !YT || !holderRef.current) return
      // clear any previous player
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }
      const elId = `yt-preview-${id}-${Date.now()}`
      holderRef.current.innerHTML = ''
      const div = document.createElement('div')
      div.id = elId
      div.style.width = '100%'
      div.style.height = '100%'
      holderRef.current.appendChild(div)

      const player = new YT.Player(elId, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          start: 0,
          end: MAX_SECONDS,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        events: {
          onReady: (e) => {
            try { e.target.playVideo() } catch {}
          },
          onStateChange: (e) => {
            // If user somehow resumes after end, snap back
            if (e.data === YT.PlayerState.PLAYING) {
              try {
                const cur = e.target.getCurrentTime ? e.target.getCurrentTime() : 0
                if (cur >= MAX_SECONDS - 0.3) {
                  try { e.target.pauseVideo(); e.target.seekTo(MAX_SECONDS, true) } catch {}
                  setAtEnd(true)
                }
              } catch {}
            }
          },
        },
      })
      playerRef.current = player

      timerRef.current = setInterval(() => {
        if (!player || !player.getCurrentTime) return
        try {
          const cur = player.getCurrentTime()
          if (cur >= MAX_SECONDS - 0.15) {
            try { player.pauseVideo() } catch {}
            try { player.seekTo(MAX_SECONDS, true) } catch {}
            setAtEnd(true)
          } else if (cur < MAX_SECONDS - 0.8) {
            setAtEnd(false)
          }
        } catch {}
      }, 250)
    })

    return () => {
      cancelled = true
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch {}
        playerRef.current = null
      }
      if (holderRef.current) holderRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, video])

  if (!video || !id) return null

  return (
    <div className="video-preview-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <section className="video-preview" role="dialog" aria-modal="true" aria-labelledby="video-preview-title">
        <header className="video-preview-head">
          <div>
            <h2 id="video-preview-title">{video.title}</h2>
            <span>{t('preview.thirty')}{atEnd ? ' — ended' : ''}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('preview.close')} title={t('preview.close')}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="video-preview-frame" ref={holderRef} />
        <footer className="video-preview-foot">
          <a className="btn btn-sm" href={video.video_url || video.url} target="_blank" rel="noreferrer">
            <Icon name="ext" size={13} />{t('preview.open')}
          </a>
        </footer>
      </section>
    </div>
  )
}
