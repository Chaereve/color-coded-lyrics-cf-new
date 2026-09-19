import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { thumbUrl } from '../lib/youtube'

/* =========================================================
   TRANG CHỦ — "Featured" + dải "Latest update"
   ---------------------------------------------------------
   Toàn bộ video do admin tự thêm trong Admin → Videos.
   Một video lớn ở giữa (sân khấu) + hai nút mũi tên hai bên
   để xoay vòng qua lại giữa các video, như khung "Janette's
   Pick" của trang mẫu: bấm trái/phải là video trước/sau, vòng
   hết danh sách thì quay lại đầu. Dải ảnh nhỏ dưới chân vừa là
   mục lục vừa là chỗ bấm nhảy thẳng tới đúng video; video đang
   mở được khoanh sáng. Bấm vào sân khấu vẫn mở video đó trên
   YouTube ở tab mới.
   ========================================================= */

/* Ảnh bìa: ưu tiên ảnh admin dán; không thì dựng từ ID video.
   Thử bản nét nhất trước (maxres 1280px cho sân khấu, hq 480px
   cho thẻ nhỏ), lỗi thì tự hạ xuống bản thấp hơn — video cũ có
   thể không có maxres. */
function thumbSrcs(item) {
  if (item.thumb) return [item.thumb]
  const { id } = item
  if (!id) return []
  return item.size === 'lg' ? [thumbUrl(id, 'maxres'), thumbUrl(id, 'hq')]
    : [thumbUrl(id, 'hq'), thumbUrl(id, 'mq')]
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

/* Nút phát chỉ là dấu hiệu "bấm được", không phát trong trang */
const Play = ({ sm }) => (
  <span className={`playbtn${sm ? ' sm' : ''}`} aria-hidden="true">
    <Icon name="play" size={sm ? 13 : 17} fill="currentColor" />
  </span>
)

/* Mũi tên qua lại của sân khấu */
const Chev = ({ dir }) => (
  <Icon name={dir < 0 ? 'prev' : 'next'} size={17} />
)

const ytLink = (v) => v.url || (v.id ? `https://youtu.be/${v.id}` : null)

export default function MediaShowcase({ featured = null, videos = [], canEdit, onAdd, limit = 20 }) {
  const { t } = useI18n()

  /* Một danh sách duy nhất cho cả sân khấu lẫn dải mục lục: video nổi
     bật đứng đầu, sau đó là các link mới — mũi tên xoay vòng đúng thứ
     tự admin đã xếp. */
  const items = (featured ? [featured, ...videos] : videos).slice(0, Math.min(20, limit))
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
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector('.pvrow.on')
    if (!el) return
    const left = el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    try { strip.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' }) }
    catch { strip.scrollLeft = Math.max(0, left) }
  }, [at, n])

  if (!n) {
    return (
      <section className="pick" id="home-media" data-reveal>
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

  return (
    <section className="pick" id="home-media" data-reveal>
      <div className="pick-main">
        {/* Sân khấu + hai nút qua lại. Nút phải đứng NGOÀI link (không
            lồng button trong a) nên khung bao .pick-hero giữ cả hai;
            phím ←/→ cũng xoay video khi focus đang trong khung. */}
        <div className="pick-hero"
          onKeyDown={e => {
            if (n < 2) return
            if (e.key === 'ArrowLeft') { e.preventDefault(); setSel(s => s - 1) }
            if (e.key === 'ArrowRight') { e.preventDefault(); setSel(s => s + 1) }
          }}>
          {/* key theo video đang mở: đổi video là sân khấu dựng lại,
              ảnh fade-in một nhịp thay vì nhảy cắt củ khoai */}
          <a className="pick-stage" key={cur.key ?? cur.id} href={ytLink(cur)} target="_blank" rel="noreferrer"
            aria-label={`${t('media.openYT')}: ${cur.title}`}>
            <Thumb item={{ ...cur, size: 'lg' }} eager />
            <Play />
            {isFeat && <span className="pick-flag">{t('media.featured')}</span>}
            <span className="pick-cap">
              <b>{cur.title}</b>
            </span>
          </a>

          {n > 1 && (
            <>
              <button type="button" className="pick-nav prev" onClick={() => setSel(s => s - 1)}
                aria-label={t('media.prev')}>
                <Chev dir={-1} />
              </button>
              <button type="button" className="pick-nav next" onClick={() => setSel(s => s + 1)}
                aria-label={t('media.next')}>
                <Chev dir={1} />
              </button>
            </>
          )}
        </div>

        {n > 1 && (
          <div className="pick-side">
            <div className="pv-label">
              {t('media.latest')}
              <span className="pv-count">{at + 1} / {n}</span>
              {canEdit && (
                <button type="button" className="pv-add" onClick={onAdd}>{t('adm.mediaAddShort')}</button>
              )}
            </div>
            <div className="pvlist" ref={stripRef}>
              {items.map((v, i) => (
                <button type="button" className={`pvrow${i === at ? ' on' : ''}`} key={v.key ?? v.id}
                  style={{ '--i': Math.min(i, 11) }} onClick={() => setSel(i)}
                  aria-label={t('media.view', { t: v.title })}
                  aria-current={i === at ? 'true' : undefined}>
                  <span className="pv-thumb">
                    <Thumb item={v} />
                    <Play sm />
                  </span>
                  <span className="pv-tx">
                    <b>{v.title}</b>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
