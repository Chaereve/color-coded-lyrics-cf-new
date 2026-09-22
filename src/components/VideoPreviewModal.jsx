import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { parseYoutube, thumbUrl } from '../lib/youtube'
import {
  PREVIEW_SECONDS, PLAYER_ORIGIN, FRAME_FADE, handshake, command,
  readWidgetEvent, mergeInfo, overCap, playhead, keptTime, previewPct,
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

   ĐIỀU KHIỂN: YOUTUBE TỰ VẼ, TRANG KHÔNG CHÈN NÚT NÀO
   ---------------------------------------------------------
   Bốn vòng liên tiếp quanh cùng một khung, nên ghi lại cho rõ — mỗi vòng là một
   lựa chọn khác nhau của CÙNG một câu hỏi: để ai vẽ điều khiển?

     · vòng 26 — chủ dự án: "ẩn mấy cái giao diện của YouTube lúc chiếu video, chỉ
       bấm play/pause được thôi". Nên URL nhúng có `controls=0` (bỏ thanh điều
       khiển, kèm nút *Watch on YouTube*) + `disablekb=1` (bỏ phím tắt nhảy 10
       giây), và trang tự vẽ một nút play/pause phủ giữa khung.
     · vòng 27 — ảnh chụp cho thấy giao diện YouTube vẫn còn; phủ bốn dải lên bốn
       mép.
     · vòng 28 — "thấy gớm luôn": gỡ bốn dải, đi theo bố cục trailer popup.
     · vòng 29 (bản này) — chủ dự án: "ko cần chèn cái nút pause/play trong video
       đâu". Bản nháp của vòng này hiểu thành "vậy thì bật lại điều khiển của
       YouTube", bỏ `controls=0`/`disablekb=1` — và chủ dự án gửi ảnh chụp ngay:
       thanh điều khiển đầy đủ (0:01 / 3:34, vạch tiến trình, ô chất lượng, CC,
       tấm "Video khác", logo YouTube, nút toàn màn hình), kèm câu "bỏ cái phần
       trong hình t gửi và để video giống bản trước đó".

   CHỐT LẠI — và đây là điều cả ba vòng 26, 28, 29 cùng nói: khung xem trước
   KHÔNG vẽ nút nào, và YouTube cũng KHÔNG hiện thanh điều khiển của nó.

     · không nút tự vẽ: không còn lớp điều khiển, không còn nút, và luật trạng
       thái nút trong previewCap.js cũng đã xoá — không còn gì của trang phủ lên
       mặt video;
     · `controls=0` + `disablekb=1` giữ nguyên như vòng 26, nên thanh điều khiển
       trong ảnh chụp không quay lại (nó cũng là thứ mang theo *Watch on
       YouTube*, phím tắt nhảy 10 giây và tấm "Video khác");
     · LỚP PHỦ CHẶN CÚ BẤM cũng đi theo nút: nó chỉ tồn tại để nút của trang là
       chỗ bấm duy nhất. Bỏ nó thì cú bấm rơi vào chính player — mà player của
       YouTube, kể cả khi `controls=0`, vẫn tự hiểu cú bấm vào mặt video là
       play/pause. Đó là "dùng nút của YouTube" đúng nghĩa: nút của nó, không
       phải thanh điều khiển của nó.

   Nói thẳng phần còn lại, vì nó là giới hạn thật (đã đo ở vòng 27, xem
   HUONG-DAN.md): tiêu đề + avatar kênh ở mép trên (khi mới mở hoặc rê chuột)
   và logo ở mép dưới vẫn do YouTube vẽ trong iframe; không tham số nào tắt
   riêng chúng, mà che thì phải phủ — đúng thứ bị chê là "gớm" ở vòng 27. Khung
   vẫn giữ nguyên bố cục trailer popup của vòng 28.

   Thanh 0→30 giây của trang vẫn nằm trong khung như vòng 28 (nó là control
   duy nhất của trang, và thanh điều khiển của YouTube thì đã tắt nên không
   chồng lên ai): nói ra phần xem trước dài bao nhiêu và cho tua nhanh trong
   phạm vi đó. Tua RA NGOÀI 30 giây vẫn bị chặn bởi vòng canh ở lớp 2.

   Quảng cáo pre-roll không tắt được (đó là tiền của kênh) và cũng không có nút
   nào để tắt hộ: vòng canh đã biết bỏ qua đồng hồ của quảng cáo (`playhead`)
   nên phần xem trước không bị cắt oan (`playerState === -1` lúc quảng cáo chạy).

   Phần còn lại vẫn như cũ và vẫn phải giữ: ảnh bìa nằm DƯỚI iframe (mạng
   chậm/adblock vẫn thấy hình), nhánh `<video>` cho mp4/webm/ogv/mov/m4v (cũng
   bị cắt ở giây 30, bằng chính thẻ video đó — nhánh này KHÔNG có YouTube nên
   điều khiển là của trình duyệt: `controls` trên chính thẻ `<video>`, để khung
   vẫn bấm phát được), câu `preview.noEmbed` cho link lạ, Esc + bấm nền để đóng,
   khoá cuộn nền.
   ========================================================= */

/* Chuỗi dưới đây là HỢP ĐỒNG với YouTube, viết nguyên văn:
   · `end=30` — communityPolish.test.js chốt đúng con số này, và bài đó còn so
     nó với `PREVIEW_SECONDS` trong previewCap.js (một nguồn số, hai chỗ dùng);
   · `enablejsapi=1` — thiếu nó thì player KHÔNG nghe postMessage (và cũng
     không gửi sự kiện nào về), tức mất luôn lớp canh thứ hai;
   · `origin=…` được ghép thêm lúc chạy (xem bên dưới) vì trang này chạy ở
     nhiều tên miền; thiếu nó thì player gửi sự kiện về sai đích và trình duyệt
     chặn im lặng;
   · `autoplay=1&playsinline=1` — chạy ngay khi mở khung, và không tự phóng to
     trên điện thoại;
   · `rel=0` — hết phần xem trước thì tấm gợi ý chỉ dẫn tới kênh đó, không phải
     một rừng video lạ.
   `controls=0` + `disablekb=1` Ở LẠI (vòng 26 → 29): vòng 29 gỡ nút tự vẽ của
   trang, nhưng thanh điều khiển của YouTube cũng không được quay lại — chủ dự
   án gửi ảnh chụp đúng cái thanh đó và nói "bỏ cái phần trong hình t gửi". */
const EMBED_BASE = 'https://www.youtube-nocookie.com/embed/'
const EMBED_QUERY = '?autoplay=1&start=0&end=30&rel=0&playsinline=1&enablejsapi=1&controls=0&disablekb=1'

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
  const atRef = useRef(0)         /* vị trí đã biết (để không tụt về 0 sau quảng cáo) */
  const [runId, setRunId] = useState(0)      /* đổi số này = dựng lại iframe */
  const [at, setAt] = useState(0)            /* vị trí đang phát, để vẽ */
  const [over, setOver] = useState(false)    /* đã chạm mốc 30 giây */
  const [blocked, setBlocked] = useState(false)  /* player báo không nhúng được */
  const videoRef = useRef(null)              /* thẻ <video> của nhánh file */

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
    atRef.current = 0
    setAt(0)
    setBlocked(false)
    setOver(false)
    setRunId((n) => n + 1)
  }, [])

  /* Tua trong phạm vi 30 giây: thanh thời gian ở chân hộp là control của
     trang, nên nó chỉ gửi `seekTo` tới một mốc đã kẹp. Tua RA NGOÀI phần xem
     trước thì không có đường: kẹp ở đây, và vòng canh vẫn cắt nếu player báo
     về một vị trí quá mốc (mốc thời gian không lùi, nên không lách được). */
  const seekTo = useCallback((seconds) => {
    const s = Math.max(0, Math.min(PREVIEW_SECONDS - 0.5, Number(seconds) || 0))
    atRef.current = s
    setAt(s)
    send(command('seekTo', [s, true]))
  }, [send])

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
     Mốc 30 giây đếm theo VỊ TRÍ CỦA VIDEO. Quảng cáo trước video (pre-roll) tự
     chạy từ 0 và có đồng hồ riêng, nên nó không được tính vào mốc — nếu không,
     một pre-roll dài hơn 30 giây sẽ kết thúc phần xem trước trong khi video còn
     chưa bắt đầu. Dấu hiệu nhận ra quảng cáo đều do player tự gửi
     (`playerState` -1, `videoData.isAd`) — xem `playhead` trong previewCap.js.
     Chưa từng nghe được player (đổi giao thức, mạng chặn) thì lớp đồng hồ treo
     tường vẫn cắt, và lúc đó tính cả quảng cáo — chấp nhận, vì cửa còn lại là
     "không bao giờ cắt". */
  useEffect(() => {
    if (!id || over || blocked) return undefined
    const startedAt = Date.now()
    const iv = setInterval(() => {
      /* Player chỉ gửi sự kiện khi biết có người nghe, và lúc iframe vừa dựng
         thì nó chưa gắn listener — nên câu chào phải gửi lại vài lần. */
      if (!seenRef.current && Date.now() - startedAt < 12000) send(handshake())

      /* Vị trí của VIDEO, không phải của quảng cáo: pre-roll dài hơn 30 giây
         mà bị tính vào mốc thì phần xem trước kết thúc khi video còn chưa bắt
         đầu (xem `playhead` trong previewCap.js). */
      const head = playhead(infoRef.current)
      const measured = !!head && !head.ad
      if (measured) {
        if (overCap(head.seconds)) { cut(); return }
        atRef.current = keptTime(atRef.current, head.seconds)
        setAt(atRef.current)
      }
      const late = Date.now() - startedAt
      /* (a) chưa từng đọc được vị trí: hết 30 giây là hết phần xem trước. */
      if (!measured && late >= (PREVIEW_SECONDS + 1) * 1000) { cut(); return }
      /* (b) đang phát mà mất liên lạc: vẫn cắt, muộn nhất là 32 giây. */
      if (measured && stateRef.current === 1 && Date.now() - seenRef.current > 4000
        && late >= (PREVIEW_SECONDS + 2) * 1000) cut()
    }, 250)
    return () => clearInterval(iv)
  }, [id, over, blocked, runId, send, cut])

  /* ---------- tua trên thanh thời gian (control của trang) ---------- */
  const barRef = useRef(null)
  const seekFromEvent = useCallback((e) => {
    const bar = barRef.current
    if (!bar) return
    const box = bar.getBoundingClientRect()
    if (!box.width) return
    const ratio = (e.clientX - box.left) / box.width
    seekTo(ratio * PREVIEW_SECONDS)
  }, [seekTo])
  const dragRef = useRef(false)
  /* Vị trí đang kéo, giữ ở CẢ ref lẫn state: state để vẽ, ref để lúc nhả tay
     gửi lệnh. Không đọc state trong hàm cập nhật state (React gọi hàm đó hai
     lần ở chế độ dev, và gửi lệnh hai lần là hệ quả trực tiếp của việc đó). */
  const dragValRef = useRef(null)
  const [dragAt, setDragAt] = useState(null)
  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return
      const bar = barRef.current
      if (!bar) return
      const box = bar.getBoundingClientRect()
      if (!box.width) return
      const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
      dragValRef.current = ratio * PREVIEW_SECONDS
      setDragAt(dragValRef.current)
    }
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = false
      const v = dragValRef.current
      dragValRef.current = null
      setDragAt(null)
      if (v !== null) seekTo(v)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [seekTo])

  if (!video) return null

  /* Vị trí để VẼ: đang kéo thanh thì theo ngón tay, còn lại theo player. */
  const shownAt = dragAt === null ? at : dragAt
  const pct = previewPct(shownAt)
  const secs = Math.floor(shownAt)
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
       tự báo vị trí nên không cần postMessage. Nhánh này cũng để chính player
       vẽ điều khiển — ở đây là `controls` của trình duyệt, đúng tinh thần vòng
       29 ("xài nút của youtube" = để player tự vẽ, không chèn nút của trang). */
    body = (
      <>
        <video
          ref={videoRef}
          className="video-preview-file" src={url} playsInline controls
          onTimeUpdate={(e) => {
            const s = e.currentTarget.currentTime
            atRef.current = keptTime(atRef.current, s)
            setAt(s)
            if (overCap(s)) { e.currentTarget.pause(); cut() }
          }}
        />
      </>
    )
  } else {
    /* Link không phải YouTube cũng không phải file video: nói ra, và để nút
       bên dưới mở nó ở tab mới. Im lặng mới là lỗi. */
    body = <p className="video-preview-fallback">{t('preview.noEmbed')}</p>
  }

  return (
    <div className="video-preview-scrim" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="video-preview-stage">
        <section className="video-preview-player" role="dialog" aria-modal="true" aria-labelledby="video-preview-title">
          <div className="video-preview-frame">
            {/* Hai vệt mờ tan dần ở mép khung (số đo ở FRAME_FADE): đủ để mép hình
                hoà vào nền đen, KHÔNG phải băng che — alpha thấp, tan hết trước
                khi tới giữa khung. */}
            <span className="video-preview-fade" aria-hidden="true"
              style={{ '--vp-fade-top': `${FRAME_FADE.top}%`, '--vp-fade-bottom': `${FRAME_FADE.bottom}%` }}>
              <i className="vp-f-top" />
              <i className="vp-f-bottom" />
            </span>

            {body}

            {/* Vạch thời gian 0→30 giây — control DUY NHẤT của trang, ở mép dưới
                khung như vòng 28. Nó không chồng lên thanh điều khiển nào của
                YouTube: thanh đó đã tắt (`controls=0`). Việc của nó là nói ra
                phần xem trước dài bao nhiêu và cho tua nhanh trong phạm vi đó;
                tua RA NGOÀI 30 giây thì vòng canh cắt. Hết phần xem trước thì
                thẻ "hết" đã phủ kín khung nên vạch ẩn đi. */}
            {id && !over && (
              <div className="video-preview-timeline">
                <span
                  ref={barRef}
                  className="video-preview-bar"
                  role="slider" tabIndex={0}
                  aria-label={t('preview.scrub')}
                  aria-valuemin={0} aria-valuemax={PREVIEW_SECONDS} aria-valuenow={secs}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    dragRef.current = true
                    seekFromEvent(e)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(shownAt - 1) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(shownAt + 1) }
                  }}>
                  <span className="video-preview-track" aria-hidden="true">
                    <i style={{ '--pv': `${pct}%` }} />
                    <u style={{ '--pv': `${pct}%` }} />
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Nút ✕ nổi ở góc phải trên khung — đúng kiểu trailer popup, không nằm
              trong một thanh tiêu đề. */}
          <button type="button" className="video-preview-close" onClick={onClose}
            aria-label={t('preview.close')} title={t('preview.close')}>
            <Icon name="close" size={16} />
          </button>
        </section>

        <div className="video-preview-meta">
          <div className="video-preview-meta-t">
            <h2 id="video-preview-title">{video.title}</h2>
            <span>{t('preview.thirty')}</span>
          </div>
          {id && <b className="video-preview-count">{t('preview.counter', { s: secs, total: PREVIEW_SECONDS })}</b>}
          {url && (
            <a className="video-preview-open" href={url} target="_blank" rel="noreferrer">
              <Icon name="ext" size={12} />{t(id ? 'preview.open' : 'preview.openLink')}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
