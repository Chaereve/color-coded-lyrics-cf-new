import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import LoadErr from './LoadErr'
import { thumbUrl } from '../lib/youtube'
import { safeHttpUrl } from '../lib/safeUrl'
import { HOMEPAGE_VIDEO_LIMIT } from '../lib/mediaLimits.js'

/* =========================================================
   TRANG CHỦ — showcase video mới nhất
   ---------------------------------------------------------
   Một video 16:9 với thông tin đặt cạnh bên; dải ảnh bên dưới dùng để
   chọn slide, còn ảnh lớn và nút Watch on YouTube mở cùng video ở tab mới.
   Mũi tên trong header đổi slide theo thứ tự; vòng cuối về đầu danh sách.
   Không phát video trong trang, không tự chạy slideshow.
   ========================================================= */

/* Ảnh bìa: ưu tiên ảnh admin dán; không thì chỉ thử hai bản YouTube 16:9.
   `hqdefault` là 4:3 nên tạo viền đen hai bên trong khung 16:9; dùng maxres
   trước rồi mq (320×180) để mọi thẻ giữ đúng tỷ lệ mà không cắt ảnh. */
function thumbSrcs(item) {
  if (item.thumb) return [item.thumb]
  const { id } = item
  if (!id) return []
  return [thumbUrl(id, 'maxres'), thumbUrl(id, 'mq')]
}

function Thumb({ item, eager = false }) {
  const srcs = thumbSrcs(item)
  const key = srcs.join('|')
  const [idx, setIdx] = useState(0)
  const [ready, setReady] = useState(false)
  /* Đổi video mà giữ state cũ thì ảnh mới hiện ngay ở trạng thái "xong"
     của ảnh cũ (hoặc kẹt ở bản fallback). Reset theo src thật. */
  useEffect(() => { setIdx(0); setReady(false) }, [key])
  const src = srcs[idx] || null

  return (
    <span className={`mthumb${ready ? ' ready' : ''}`}>
      {src
        ? <img src={src} alt="" loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : 'auto'}
            decoding="async" referrerPolicy="no-referrer"
            /* ảnh nằm sẵn trong cache thì load xong TRƯỚC khi React kịp gắn
               onLoad — kiểm tra complete tại chỗ, không thì khung ảnh để
               trống tới lần đổi src kế tiếp */
            ref={el => { if (el?.complete && el.naturalWidth > 0) setReady(true) }}
            onLoad={() => setReady(true)}
            onError={() => setIdx(i => i + 1)} />
        : <span className="mthumb-ph" aria-hidden="true"><Icon name="play" size={18} /></span>}
    </span>
  )
}

/* Mũi tên qua lại của sân khấu */
const Chev = ({ dir }) => (
  <Icon name={dir < 0 ? 'prev' : 'next'} size={17} />
)

const ytLink = (v) => v.url || (v.id ? `https://youtu.be/${v.id}` : null)
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export default function MediaShowcase({ featured = null, videos = [], canEdit, onAdd, limit = HOMEPAGE_VIDEO_LIMIT, state = 'ready', onRetry }) {
  const { t } = useI18n()

  /* Một danh sách duy nhất cho cả sân khấu lẫn dải mục lục: video nổi
     bật đứng đầu, sau đó là các link mới — mũi tên xoay vòng đúng thứ
     tự admin đã xếp. */
  const videoLimit = Math.max(0, Math.min(HOMEPAGE_VIDEO_LIMIT, limit))
  const items = [...(featured ? [featured] : []), ...videos.slice(0, videoLimit)]
  const n = items.length

  /* `sel` được phép tràn (sau khi xoay vòng, hoặc admin vừa xoá video
     đang mở): chỉ số "quấn vòng" luôn rơi về một vị trí hợp lệ, không
     cần effect kẹp lại nên không có nhịp render thừa. */
  const [sel, setSel] = useState(0)
  const cur = n ? items[((sel % n) + n) % n] : null
  const at = n ? ((sel % n) + n) % n : 0
  const isFeat = !!cur && !!featured && cur.key === featured.key

  /* Video đang mở tự được kéo vào giữa dải mục lục — chọn bằng mũi tên
     thì mắt phải thấy nó ở đâu đó, không bị bỏ lại ngoài rìa dải. */
  const stripRef = useRef(null)
  useIsoLayoutEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector('.pvrow.on')
    if (!el) return
    const left = el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2
    /* The selected video changes immediately; smooth scrolling made the
       highlight trail behind the selection. Reposition in the same frame. */
    try { strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' }) }
    catch { strip.scrollLeft = Math.max(0, left) }
  }, [at, n, cur?.key ?? cur?.id])

  /* Chưa có dòng nào để vẽ: ba khả năng, ba câu trả lời KHÁC NHAU.
     Bản cũ gộp cả ba vào nhánh rỗng, nên mất mạng là dải video nói "chưa có
     video nào" — người xem kết luận sai về kênh, và không có gì để bấm tiếp.
     `state` do App truyền xuống (`loading | ready | error`), cùng luật với
     bảng: chỉ hiện khối lỗi khi THẬT SỰ chưa có gì để xem. */
  if (!n && (state === 'loading' || state === 'error')) {
    return (
      <section className="pick pick-showcase" id="home-media" data-reveal>
        {state === 'loading'
          ? (
            <div className="sklist" role="status" aria-label={t('board.loading')}>
              {Array.from({ length: 3 }, (_, i) => (
                <div className="skrow" key={i} style={{ '--i': i }} aria-hidden="true">
                  <span className="sk sk-l1" />
                  <span className="sk sk-l2" />
                  <span className="sk sk-vote" />
                </div>
              ))}
            </div>
            )
          : <LoadErr onRetry={onRetry} titleKey="err.blockTitle" bodyKey="err.blockBody" retryKey="err.blockRetry" />}
      </section>
    )
  }

  if (!n) {
    return (
      <section className="pick pick-showcase" id="home-media" data-reveal>
        <div className="channel-state" role="status">
          <div>{canEdit ? t('media.emptyAdmin') : t('media.emptyPublic')}</div>
          {canEdit && (
            <div className="empty-acts">
              <button className="btn btn-sm" onClick={onAdd}>{t('adm.mediaAddShort')}</button>
            </div>
          )}
        </div>
      </section>
    )
  }

  const videoHref = safeHttpUrl(ytLink(cur))
  const handleKeyDown = (e) => {
    if (n < 2 || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSel(s => s - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); setSel(s => s + 1) }
  }

  return (
    <section className="pick pick-showcase" id="home-media" data-reveal onKeyDown={handleKeyDown}>
      <header className="pick-showcase-head">
        <h2 className="pick-showcase-label">{t('media.latest')}</h2>
        <div className="pick-showcase-controls">
          {n > 1 && (
            <div className="pick-showcase-pager">
              <span className="pv-count pick-showcase-count" key={cur.key ?? cur.id} aria-live="polite">{at + 1} / {n}</span>
              <div className="pick-showcase-arrows">
                <button type="button" className="pick-nav prev" onClick={() => setSel(s => s - 1)}
                  aria-label={t('media.prev')}>
                  <Chev dir={-1} />
                </button>
                <button type="button" className="pick-nav next" onClick={() => setSel(s => s + 1)}
                  aria-label={t('media.next')}>
                  <Chev dir={1} />
                </button>
              </div>
            </div>
          )}
          {canEdit && <button type="button" className="pv-add" onClick={onAdd}>{t('adm.mediaAddShort')}</button>}
        </div>
      </header>

      <div className="pick-main">
        <div className="pick-hero">
          <a className="pick-stage" key={cur.key ?? cur.id} href={videoHref || undefined}
            target="_blank" rel="noreferrer"
            aria-label={`${isFeat ? `${t('media.featured')} — ` : ''}${t('media.openYT')}: ${cur.title}`}>
            <Thumb item={cur} eager />
          </a>
        </div>
        <div className="pick-info">
          <div className="pick-copy" key={cur.key ?? cur.id}>
            <h3 className="pick-showcase-title">{cur.title}</h3>
          </div>
          {videoHref && (
            <a className="pick-watch" key={`watch-${cur.key ?? cur.id}`} href={videoHref}
              target="_blank" rel="noreferrer">
              <span>{t('media.openYT')}</span><Icon name="ext" size={14} />
            </a>
          )}
        </div>
      </div>

      {n > 1 && (
        <div className="pick-side">
          <div className={`pvlist${n > 3 ? ' has-overflow' : ''}`} ref={stripRef}>
            {items.map((v, i) => (
              <button type="button" className={`pvrow${i === at ? ' on' : ''}`} key={v.key ?? v.id}
                style={{ '--i': Math.min(i, 11) }} onClick={() => setSel(i)}
                aria-label={t('media.view', { t: v.title })}
                aria-current={i === at ? 'true' : undefined} aria-pressed={i === at}>
                <span className="pv-thumb"><Thumb item={v} /></span>
                <span className="pv-tx"><b>{v.title}</b></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
