import { useEffect, useMemo } from 'react'
import Icon from './Icon'
import { parseYoutube, thumbUrl } from '../lib/youtube'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   XEM TRƯỚC VIDEO TRONG HALL OF FAME — 30 GIÂY, KHÔNG CẦN SCRIPT NGOÀI
   ---------------------------------------------------------
   LỖI ĐÃ GẶP THẬT (chủ dự án báo): "bấm vào preview trong Hall of Fame
   không hiện gì, đen xì".

   Bản trước dựng người chơi bằng YouTube IFrame Player API, tức là nó
   chèn một thẻ `<script src="https://www.youtube.com/iframe_api">` vào
   trang. CSP của site (`public/_headers`) chỉ cho `script-src 'self'
   https://challenges.cloudflare.com` — script của YouTube bị chặn, promise
   `loadYT()` không bao giờ resolve, và trong khung 16:9 chỉ còn đúng nền
   đen của `.video-preview-frame`. Không có lỗi nào hiện ra: khung đen là
   tất cả những gì người dùng nhận được.

   Nay khung xem trước là một `<iframe>` EMBED thẳng, do React dựng:
   · không tải script của bên thứ ba, nên CSP không thể giết nó (frame-src
     đã cho phép youtube.com / youtube-nocookie.com từ trước);
   · `end=30` là tham số của chính YouTube — video tự dừng ở giây thứ 30;
   · ảnh bìa nằm sau iframe nên khung không bao giờ là một tấm đen tuyền,
     kể cả khi mạng chậm hoặc iframe bị chặn (adblock, DNS…);
   · video KHÔNG phải link YouTube (mp4, link lạ) vẫn mở được hộp này và
     có đường đi tiếp, thay vì `return null` — bấm mà không có gì xảy ra.
   ========================================================= */

/* Tham số `end=30` phải nằm NGUYÊN VĂN trong chuỗi: nó là hợp đồng với
   YouTube, và communityPolish.test.js chốt đúng con số đó. */
const EMBED_BASE = 'https://www.youtube-nocookie.com/embed/'
const EMBED_QUERY = '?autoplay=1&start=0&end=30&rel=0&modestbranding=1&playsinline=1'

const isVideoFile = (url) => /\.(mp4|webm|ogv|mov|m4v)([?#]|$)/i.test(url || '')

export default function VideoPreviewModal({ video, onClose }) {
  const { t } = useI18n()
  const url = video?.video_url || video?.url || ''
  const id = useMemo(() => parseYoutube(url)?.id || null, [url])

  /* Esc để đóng + khoá cuộn nền: cùng luật với các hộp thoại khác của app. */
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

  if (!video) return null

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
          {id ? (
            <>
              {/* Ảnh bìa là LỚP DƯỚI: iframe phủ lên khi nó vẽ xong. Mạng chậm
                  thì người dùng thấy ảnh bìa, không thấy khung đen. */}
              <img className="video-preview-poster" src={thumbUrl(id, 'hq')} alt="" aria-hidden="true" />
              <iframe
                className="video-preview-iframe"
                src={`${EMBED_BASE}${id}${EMBED_QUERY}`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </>
          ) : isVideoFile(url) ? (
            <video className="video-preview-file" src={url} controls autoPlay playsInline />
          ) : (
            /* Link không phải YouTube cũng không phải file video: nói ra, và
               để nút bên dưới mở nó ở tab mới. Im lặng mới là lỗi. */
            <p className="video-preview-fallback">{t('preview.noEmbed')}</p>
          )}
        </div>

        <footer className="video-preview-foot">
          {url && (
            <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
              <Icon name="ext" size={13} />{t(id ? 'preview.open' : 'preview.openLink')}
            </a>
          )}
        </footer>
      </section>
    </div>
  )
}
