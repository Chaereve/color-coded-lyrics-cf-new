import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { parseYoutube, thumbUrl } from '../lib/youtube'
import {
  PREVIEW_SECONDS, PLAYER_ORIGIN, handshake, command,
  readWidgetEvent, mergeInfo, overCap, previewPct,
} from '../lib/previewCap.js'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   XEM TRƯỚC VIDEO TRONG HALL OF FAME — 30 GIÂY THẬT SỰ
   ---------------------------------------------------------
   LỖI ĐÃ GẶP THẬT, LẦN 1 (chủ dự án báo): "bấm vào preview trong Hall of Fame
   không hiện gì, đen xì".
   Bản trước dựng người chơi bằng YouTube IFrame Player API, tức là nó chèn
   một thẻ `<script src="https://www.youtube.com/iframe_api">` vào trang. CSP
   của site (`public/_headers`) chỉ cho `script-src 'self' https://challenges.cloudflare.com`
   — script của YouTube bị chặn, promise `loadYT()` không bao giờ resolve, và
   trong khung 16:9 chỉ còn đúng nền đen. Không có lỗi nào hiện ra: khung đen
   là tất cả những gì người dùng nhận được.
   Cách sửa lượt đó: `<iframe>` EMBED thẳng, do React dựng — không tải script
   của bên thứ ba (CSP đã cho `frame-src` youtube.com / youtube-nocookie.com từ
   trước), ảnh bìa nằm sau iframe nên khung không bao giờ là một tấm đen.

   LỖI ĐÃ GẶP THẬT, LẦN 2 (cùng người báo): "cái preview 30s ở hall of fame vẫn
   không hoạt động được, nó vẫn không hoạt động khi tua nhanh qua 30s".
   Lượt đó chỉ có `end=30` trong URL — mà `end` KHÔNG phải một cái khoá, nó chỉ
   là chỗ đánh dấu kết thúc của chính player ấy. Kéo thanh thời gian qua vạch
   đó (hoặc bấm [l] / [→] để nhảy 10 giây) là player phát tiếp bình thường:
   cả video xem trọn trong khung của web, đúng thứ mà "xem trước 30 giây"
   sinh ra để chặn. Không có lỗi nào hiện ra lần này nữa — vì không có gì hỏng
   cả, chỉ là không ai giữ mốc.

   NAY MỐC 30 GIÂY CÓ BA LỚP, và chỉ một lớp dựa vào thiện chí của YouTube:

     1. `start=0&end=30` trong URL nhúng — player tự dừng ở giây 30 khi xem
        bình thường (không cần một dòng JS nào);
     2. VÒNG CANH trong trang: đọc `currentTime` do chính player gửi về qua
        kênh `postMessage` (`enablejsapi=1` + `origin=<origin của trang>`,
        KHÔNG nạp script của YouTube — xem src/lib/previewCap.js), chạm mốc
        là gỡ luôn iframe. Lớp này chặn việc TUA QUA 30 giây: tua là quá mốc
        y như xem hết, không có đường vòng;
     3. ĐỒNG HỒ TREO TƯỜNG: chưa từng đọc được vị trí (đổi giao thức, mạng
        chặn, iframe bị chặn) thì đúng 30 giây sau khi mở khung, phần xem trước
        kết thúc — ít nhất nó cũng kết thúc.

   Cắt bằng cách GỠ IFRAME chứ không chỉ gửi lệnh `pauseVideo`: lệnh là một
   postMessage bất đồng bộ, còn gỡ phần tử thì trình duyệt dừng tiếng ngay và
   không có nhánh nào (quảng cáo tự phát lại, player lờ lệnh) sống sót.

   Phần còn lại vẫn như cũ và vẫn phải giữ: ảnh bìa nằm DƯỚI iframe (mạng
   chậm/adblock vẫn thấy hình), nhánh `<video>` cho mp4/webm/ogv/mov/m4v (cũng
   bị cắt ở giây 30, bằng chính thẻ video đó), câu `preview.noEmbed` cho link
   lạ, Esc + bấm nền để đóng, khoá cuộn nền.
   ========================================================= */

/* Hai chuỗi dưới đây là HỢP ĐỒNG với YouTube, viết nguyên văn:
   · `end=30` — communityPolish.test.js chốt đúng con số này, và bài đó còn so
     nó với `PREVIEW_SECONDS` trong previewCap.js (một nguồn số, hai chỗ dùng);
   · `enablejsapi=1` — thiếu nó thì player KHÔNG nghe postMessage (và cũng
     không gửi sự kiện nào về), tức mất luôn lớp canh thứ hai;
   · `origin=…` được ghép thêm lúc chạy (xem bên dưới) vì trang này chạy ở
     nhiều tên miền; thiếu nó thì player gửi sự kiện về sai đích và trình duyệt
     chặn im lặng. */
const EMBED_BASE = 'https://www.youtube-nocookie.com/embed/'
const EMBED_QUERY = '?autoplay=1&start=0&end=30&rel=0&modestbranding=1&playsinline=1&enablejsapi=1'

const isVideoFile = (url) => /\.(mp4|webm|ogv|mov|m4v)([?#]|$)/i.test(url || '')

/* Mã lỗi của player nghĩa là "video này không nhúng được": 100 = không tồn
   tại/bị xoá/để riêng tư, 101 và 150 = chủ video tắt nhúng. Lúc đó không có
   gì để canh mốc 30 giây nữa, và cũng không nên im lặng: nói ra lý do rồi
   đưa nút mở video. (2 = tham số sai, 5 = lỗi player tạm thời — bỏ qua, hai
   thứ đó tự khỏi.) */
const EMBED_DENIED = new Set([100, 101, 150])

export default function VideoPreviewModal({ video, onClose }) {
  const { t } = useI18n()
  const url = video?.video_url || video?.url || ''
  const id = useMemo(() => parseYoutube(url)?.id || null, [url])

  const frameRef = useRef(null)
  const infoRef = useRef({})      /* gói thông tin mới nhất player gửi về */
  const stateRef = useRef(null)   /* 1 = đang phát, 2 = đang dừng */
  const seenRef = useRef(0)       /* lần cuối nghe được player */
  const [runId, setRunId] = useState(0)      /* đổi số này = dựng lại iframe */
  const [at, setAt] = useState(0)            /* vị trí đang phát, để vẽ */
  const [over, setOver] = useState(false)    /* đã chạm mốc 30 giây */
  const [blocked, setBlocked] = useState(false)  /* player báo không nhúng được */

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

  const send = useCallback((payload) => {
    const win = frameRef.current?.contentWindow
    if (!win) return
    try { win.postMessage(payload, PLAYER_ORIGIN) } catch { /* khung vừa bị gỡ giữa hai nhịp */ }
  }, [])

  /* Hết phần xem trước: gửi lệnh dừng (cho chắc) rồi để React gỡ iframe. */
  const cut = useCallback(() => {
    send(command('pauseVideo'))
    setAt(PREVIEW_SECONDS)
    setOver(true)
  }, [send])

  const replay = useCallback(() => {
    /* Quên hết những gì player cũ kể — vị trí 47 giây nằm trong đó. Không xoá
       thì vòng canh của phiên mới đọc lại đúng con số vừa làm nó cắt và cắt
       luôn phiên vừa mở (bài kiểm smoke bắt được đúng ca này). */
    infoRef.current = {}
    stateRef.current = null
    seenRef.current = 0
    setAt(0)
    setBlocked(false)
    setOver(false)
    setRunId((n) => n + 1)
  }, [])

  /* ---------- nghe player ---------- */
  useEffect(() => {
    if (!id || over || blocked) return undefined
    const onMsg = (e) => {
      /* Hàng rào thật: chỉ nhận tin từ CHÍNH khung mình dựng. Không ai khác
         gửi được từ trong đó ra, nên đây là điều kiện mạnh hơn mọi danh sách
         tên miền. */
      const frame = frameRef.current
      if (!frame || e.source !== frame.contentWindow) return
      const msg = readWidgetEvent(e.origin, e.data)
      if (!msg) return
      seenRef.current = Date.now()
      if (msg.kind === 'info') {
        infoRef.current = mergeInfo(infoRef.current, msg.info)
        const ps = Number(infoRef.current.playerState)
        if (Number.isFinite(ps)) stateRef.current = ps
        return
      }
      if (msg.kind === 'state') { stateRef.current = msg.state; return }
      if (msg.kind === 'error' && EMBED_DENIED.has(msg.code)) setBlocked(true)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [id, over, blocked])

  /* ---------- vòng canh: bắt tay, đọc vị trí, cắt khi quá mốc ----------
     Một chỗ đã biết là chưa hoàn hảo: quảng cáo pre-roll dài hơn 30 giây cũng
     bị tính là "quá mốc" (player báo thời gian của chính quảng cáo), nên phần
     xem trước có thể kết thúc trước khi video bắt đầu. Phần lớn pre-roll ngắn
     hơn 30 giây nên ca này hiếm, và nút *xem lại* nằm ngay trên thẻ — đổi lại
     là mốc 30 giây không thể lách, kể cả khi người xem tua. */
  useEffect(() => {
    if (!id || over || blocked) return undefined
    const startedAt = Date.now()
    const iv = setInterval(() => {
      /* Player chỉ gửi sự kiện khi biết có người nghe, và lúc iframe vừa dựng
         thì nó chưa gắn listener — nên câu chào phải gửi lại vài lần. */
      if (!seenRef.current && Date.now() - startedAt < 12000) send(handshake())

      const pos = Number(infoRef.current.currentTime)
      const measured = Number.isFinite(pos)
      if (measured && overCap(pos)) { cut(); return }
      if (measured) setAt(pos)

      const late = Date.now() - startedAt
      /* (a) chưa từng đọc được vị trí: hết 30 giây là hết phần xem trước. */
      if (!measured && late >= (PREVIEW_SECONDS + 1) * 1000) { cut(); return }
      /* (b) đang phát mà mất liên lạc: vẫn cắt, muộn nhất là 32 giây. */
      if (measured && stateRef.current === 1 && Date.now() - seenRef.current > 4000
        && late >= (PREVIEW_SECONDS + 2) * 1000) cut()
    }, 250)
    return () => clearInterval(iv)
  }, [id, over, blocked, runId, send, cut])

  if (!video) return null

  const pct = previewPct(at)
  const secs = Math.floor(at)
  /* `origin` phải là origin THẬT của trang đang chứa khung, nên tính lúc chạy:
     web này chạy ở nhiều tên miền (chaereve.pages.dev, miền riêng, bản xem
     trước trong sandbox của nền tảng). */
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const src = id
    ? `${EMBED_BASE}${id}${EMBED_QUERY}${origin ? `&origin=${encodeURIComponent(origin)}` : ''}`
    : null

  let body
  if (over) {
    /* Thẻ "hết phần xem trước": nói ra vì sao khung dừng, và mở đường đi tiếp. */
    body = (
      <div className="video-preview-end" aria-live="polite">
        <div className="video-preview-endbox">
          <b>{t('preview.ended')}</b>
          <p>{t('preview.endedNote', { total: PREVIEW_SECONDS })}</p>
          <div className="video-preview-endacts">
            <button type="button" className="btn btn-sm" onClick={replay}>
              <Icon name="play" size={13} />{t('preview.replay')}
            </button>
            {url && (
              <a className="btn btn-sm btn-primary" href={url} target="_blank" rel="noreferrer">
                <Icon name="ext" size={13} />{t(id ? 'preview.open' : 'preview.openLink')}
              </a>
            )}
          </div>
        </div>
      </div>
    )
  } else if (blocked) {
    body = <p className="video-preview-fallback">{t('preview.noEmbed')}</p>
  } else if (src) {
    body = (
      <>
        {/* Ảnh bìa là LỚP DƯỚI: iframe phủ lên khi nó vẽ xong. Mạng chậm
            thì người dùng thấy ảnh bìa, không thấy khung đen. */}
        <img className="video-preview-poster" src={thumbUrl(id, 'hq')} alt="" aria-hidden="true" />
        <iframe
          key={runId}
          ref={frameRef}
          className="video-preview-iframe"
          src={src}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => send(handshake())}
          allowFullScreen
        />
      </>
    )
  } else if (isVideoFile(url)) {
    /* File video không phải YouTube: cùng một luật 30 giây, nhưng thẻ <video>
       tự báo vị trí nên không cần postMessage. */
    body = (
      <video
        className="video-preview-file" src={url} controls autoPlay playsInline
        onTimeUpdate={(e) => {
          const s = e.currentTarget.currentTime
          setAt(s)
          if (overCap(s)) { e.currentTarget.pause(); cut() }
        }}
      />
    )
  } else {
    /* Link không phải YouTube cũng không phải file video: nói ra, và để nút
       bên dưới mở nó ở tab mới. Im lặng mới là lỗi. */
    body = <p className="video-preview-fallback">{t('preview.noEmbed')}</p>
  }

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

        <div className="video-preview-frame">{body}</div>

        <footer className="video-preview-foot">
          {/* Thanh tiến trình 0→30 giây: nói ra con số mà mắt không phải đoán.
              Hết phần xem trước thì nó đứng ở đầy, khớp với thẻ bên trên. */}
          {id && (
            <div className="video-preview-tick" role="progressbar" aria-label={t('preview.thirty')}
              aria-valuemin={0} aria-valuemax={PREVIEW_SECONDS} aria-valuenow={secs}>
              <span className="video-preview-track" aria-hidden="true">
                <i style={{ '--pv': `${pct}%` }} />
              </span>
              <b>{t('preview.counter', { s: secs, total: PREVIEW_SECONDS })}</b>
            </div>
          )}
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
