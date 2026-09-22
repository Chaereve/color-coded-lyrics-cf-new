/* =========================================================
   MỐC 30 GIÂY CỦA KHUNG XEM TRƯỚC — phần LUẬT, tách khỏi React
   ---------------------------------------------------------
   Chủ dự án báo lần hai (22/09/2026): "cái preview 30s ở hall of fame vẫn
   không hoạt động được, nó vẫn không hoạt động khi tua nhanh qua 30s".

   Lần trước (vòng 23) khung đen đã được sửa bằng `<iframe>` nhúng thẳng
   `youtube-nocookie.com/embed/<id>?start=0&end=30…`. Nhưng tham số `end` của
   YouTube KHÔNG phải một cái khoá: nó chỉ là "chỗ đánh dấu kết thúc" của
   chính player ấy.

     · người xem kéo thanh thời gian qua vạch 30 giây → player phát tiếp bình
       thường (vạch đánh dấu còn bị bấm để bỏ luôn);
     · bấm các phím tắt [l] / [→] để nhảy 10 giây → cũng đi qua;
     · nên cả video vẫn xem trọn trong khung của web, đúng thứ mà "xem trước
       30 giây" sinh ra để chặn.

   Muốn mốc 30 giây thành luật thật thì phải ĐỌC ĐƯỢC vị trí đang phát và TỰ
   CẮT. Bản trước không đọc được vì YouTube IFrame Player API nạp
   `<script src="youtube.com/iframe_api">`, mà CSP của site (`public/_headers`)
   chặn `script-src 'self'` — thêm lại script đó là quay về đúng cái khung
   đen cũ.

   Đường đi không cần script bên thứ ba: player nhúng có sẵn một KÊNH
   `postMessage` cho chính trang chứa nó (đó là cách script chính thức nói
   chuyện với nó):
     · thêm `enablejsapi=1` + `origin=<origin của trang>` vào URL nhúng —
       thiếu `enablejsapi` thì player không nghe lệnh, thiếu `origin` thì nó
       gửi sự kiện về SAI đích và trình duyệt chặn (lỗi đã gặp thật, xem
       jiki-education/front-end#1165);
     · gửi tay `{"event":"listening","id":…,"channel":"widget"}` để nó biết có
       người nghe (chưa gửi thì nó không gửi sự kiện nào);
     · từ đó nó gửi `infoDelivery` vài lần mỗi giây, trong đó có `currentTime`;
     · gửi lệnh bằng `{"event":"command","func":"pauseVideo"}`.

   Tệp này là phần chữ nghĩa của kênh đó: dựng chuỗi gửi đi, đọc chuỗi gửi
   về, và luật "đã tới mốc chưa". Không có React, không có DOM — nên kiểm thử
   được từng luật một (src/lib/previewCap.test.js). Phần dây nối vào iframe
   nằm ở src/components/VideoPreviewModal.jsx.

   Cả kênh này là API NGẦM (YouTube không hứa gì bằng văn bản), nên nó chỉ là
   MỘT trong ba lớp của mốc 30 giây — hai lớp kia (`end=30` trong URL, và
   đồng hồ treo tường ở component) không phụ thuộc vào nó.
   ========================================================= */

/* Mốc của khung xem trước, tính bằng giây. Đây là nguồn số DUY NHẤT:
   `end=30` trong URL nhúng phải khớp con số này — communityPolish.test.js
   đọc cả hai chỗ và so, nên không có chuyện sửa một nơi rồi quên nơi kia. */
export const PREVIEW_SECONDS = 30

/* `id` là tem để player dán lại vào từng sự kiện; `channel:"widget"` là phần
   bắt buộc của phong bì (thiếu nó player coi như tin lạ và bỏ qua). */
export const PLAYER_ID = 'ccl-preview'
const CHANNEL = 'widget'

/* Nơi nhận lệnh. Iframe trỏ tới youtube-nocookie.com nên tài liệu trong đó
   mang đúng origin này; gửi `'*'` cũng chạy nhưng là mở cửa cho mọi nơi, còn
   gửi đúng origin thì trình duyệt tự chặn nếu khung đã bị đổi hướng. */
export const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com'

const envelope = (body) => JSON.stringify({ ...body, id: PLAYER_ID, channel: CHANNEL })

/* Câu chào: "trang này đang nghe đây". Phải gửi lại vài lần cho tới khi player
   trả lời, vì lúc iframe vừa dựng thì nó còn chưa gắn listener. */
export const handshake = () => envelope({ event: 'listening' })

/* Lệnh điều khiển: pauseVideo, playVideo, seekTo… (`args` luôn là mảng). */
export const command = (func, args = []) => envelope({ event: 'command', func, args })

/* Máy chủ nhận sự kiện: đúng hai họ tên miền của YouTube, luôn qua https.
   Danh sách này KHÔNG phải hàng rào an ninh chính — hàng rào chính là so
   `event.source` với chính contentWindow của iframe mình dựng (xem
   VideoPreviewModal), và không ai khác gửi được từ trong khung đó ra. Đây chỉ
   là lớp lọc thứ hai, rộng vừa đủ cho các tên miền YouTube dùng thật. */
const HOSTS = ['youtube.com', 'youtube-nocookie.com']
export function isPlayerOrigin(origin) {
  let u
  try { u = new URL(String(origin || '')) } catch { return false }
  return u.protocol === 'https:' && HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))
}

/**
 * Đọc một sự kiện do player gửi về.
 * @returns {{kind:'info', info:object}
 *          |{kind:'state', state:number}
 *          |{kind:'error', code:number|null}
 *          |null}  null = không phải chuyện của player (hoặc rác)
 */
export function readWidgetEvent(origin, raw) {
  if (!isPlayerOrigin(origin)) return null
  let data = raw
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return null }
  }
  if (!data || typeof data !== 'object' || data.channel !== CHANNEL) return null

  if (data.event === 'onStateChange') {
    const state = Number(data.info)
    return Number.isFinite(state) ? { kind: 'state', state } : null
  }
  if (data.event === 'initialDelivery' || data.event === 'infoDelivery') {
    if (!data.info || typeof data.info !== 'object') return null
    return { kind: 'info', info: data.info }
  }
  if (data.event === 'onError') {
    const code = Number(data.info)
    return { kind: 'error', code: Number.isFinite(code) ? code : null }
  }
  return null
}

/* `infoDelivery` là ẢNH CHỤP TỪNG PHẦN: chỉ những khoá vừa đổi được gửi lên.
   Gán đè thẳng cả cục là mất dần thông tin — ví dụ `videoData` về sau chỉ còn
   một khoá. Trộn theo từng khoá (và trộn sâu một tầng cho các nhánh con) mới
   dựng lại được thông tin đầy đủ mới nhất. */
export function mergeInfo(prev, patch) {
  const out = { ...(prev || {}) }
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue
    const deep = v && typeof v === 'object' && !Array.isArray(v)
      && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
    out[k] = deep ? { ...out[k], ...v } : v
  }
  return out
}

/* ĐÃ CHẠM MỐC CHƯA? Số vắng/không phải số thì câu trả lời là "chưa biết" —
   thà không cắt còn hơn cắt nhầm một khung chưa kịp chạy. */
export function overCap(seconds, limit = PREVIEW_SECONDS) {
  const s = Number(seconds)
  return Number.isFinite(s) && s >= limit
}

/* Phần trăm cho thanh tiến trình, kẹp sẵn về 0..100 ở đây (component không
   phải kiểm lại, và giá trị rác không làm bố cục nhảy). */
export function previewPct(seconds, limit = PREVIEW_SECONDS) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return 0
  return Math.min(100, (s / limit) * 100)
}
