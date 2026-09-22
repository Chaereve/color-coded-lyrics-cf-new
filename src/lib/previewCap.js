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

/* =========================================================
   VỆT MỜ HAI MÉP KHUNG — số đo, và vì sao KHÔNG còn dải phủ
   ---------------------------------------------------------
   Bốn vòng liên tiếp quanh cùng một khung xem trước, nên ghi lại cho rõ:

     · vòng 26 — `controls=0` + `disablekb=1`: ẩn thanh điều khiển của YouTube,
       trang tự vẽ nút play/pause;
     · vòng 27 — chủ dự án gửi ảnh chụp "vẫn chưa ẩn hoàn toàn giao diện yt",
       nên thêm BỐN DẢI PHỦ ở bốn mép để che tiêu đề/kênh/logo/tấm "Video khác";
     · vòng 28 — chủ dự án nhìn bốn dải đó: "thấy gớm luôn", và gửi một mẫu để
       làm theo (100jsprojects · *video trailer popup*). Đúng là gớm: mỗi dải tối
       ở mép rồi cắt PHỰT về 0 ở mép trong, nên nó đọc ra thành bốn tấm băng dán,
       kèm một vạch ngang nhìn thấy được;
     · vòng 29 — "ko cần chèn cái nút pause/play trong video đâu": nút tự vẽ bị
       gỡ, và lớp phủ chặn cú bấm đi theo nó (nên cú bấm tới được player, mà
       player tự hiểu bấm-vào-hình là play/pause). Thanh điều khiển của YouTube
       thì KHÔNG quay lại: bản nháp bật nó lên và chủ dự án gửi ảnh chụp đúng
       cái thanh đó — `controls=0`/`disablekb=1` ở lại. Hai vệt mờ dưới đây cũng
       ở lại — chúng không che gì cả, chỉ để mép khung hoà vào nền đen.

   Nên bản này bỏ hẳn dải phủ. Cái còn lại là hai VỆT MỜ tan dần ở mép trên/dưới
   — hai vệt này KHÔNG nhằm che giao diện YouTube nữa; việc của chúng là để mép
   hình hoà vào sân khấu đen của popup (kiểu trailer popup). Vì thế:
     · alpha thấp (.55 / .6) và tan hết trước khi tới giữa khung;
     · tổng hai mép phủ 20% chiều cao — mức của một viền, không phải tấm che.

   ĐÁNH ĐỔI, ghi rõ để lần sau không ai ngạc nhiên: giao diện YouTube hiện lại —
   tiêu đề + avatar kênh ở mép trên (lúc mới mở và khi rê chuột), logo ở mép
   dưới. Đó là chọn lựa giữa "sạch, giống mẫu" và "không thấy gì của YouTube":
   cả hai cùng lúc thì không có cách nào, vì mọi cách che đều phải là một tấm phủ
   — đúng thứ vừa bị chê. Muốn quay lại che: tăng hai số dưới đây và thêm lại
   lớp phủ có `backdrop-filter` (xem mục Vòng 27 trong HUONG-DAN.md). */
export const FRAME_FADE = { top: 9, bottom: 11 }

/* ĐÃ CHẠM MỐC CHƯA? Số vắng/không phải số thì câu trả lời là "chưa biết" —
   thà không cắt còn hơn cắt nhầm một khung chưa kịp chạy. */
export function overCap(seconds, limit = PREVIEW_SECONDS) {
  const s = Number(seconds)
  return Number.isFinite(s) && s >= limit
}

/* VỊ TRÍ ĐANG XEM, đọc từ gói thông tin của player.
   ---------------------------------------------------------
   Một chỗ dễ sai và đã sai thật: trong lúc chạy QUẢNG CÁO, `currentTime` mà
   player báo là thời gian của **quảng cáo**, không phải của video (quảng cáo
   tính từ 0 và có `duration` riêng). Đem con số đó so với mốc 30 giây thì một
   pre-roll 35 giây — hoặc một quảng cáo dài bất kỳ — sẽ làm phần xem trước kết
   thúc trong khi video còn chưa bắt đầu.

   Dấu hiệu nhận ra quảng cáo, cả hai đều do player tự gửi:
     · `playerState === -1` trong lúc có `currentTime` đang chạy — trạng thái
       này chỉ có khi player đang phục vụ nội dung xen vào;
     · `videoData.isAd` (một số bằng 1).
   Còn một dấu hiệu nữa nằm ở chỗ khác: mốc thời gian *không lùi* bao giờ. Thấy
   `currentTime` nhảy về nhỏ hơn hẳn giá trị trước đó là quảng cáo vừa kết thúc
   và video vừa bắt đầu lại từ 0 — xem `keptTime`. */
function isAd(info) {
  if (Number(info?.playerState) === -1) return true
  const vd = info?.videoData
  return !!(vd && typeof vd === 'object' && Number(vd.isAd) === 1)
}

/**
 * Vị trí của VIDEO (không phải của quảng cáo).
 * @returns {{seconds:number, ad:boolean}|null} null = chưa biết gì
 */
export function playhead(info) {
  const s = Number(info?.currentTime)
  if (!Number.isFinite(s)) return null
  return { seconds: s, ad: isAd(info) }
}

/* Thời gian không lùi: trong lúc quảng cáo, vẫn phải nhớ vị trí thật của video
   để khi quảng cáo hết thì chỗ đang xem không tụt về 0. */
export function keptTime(prevSeconds, nextSeconds) {
  const prev = Number(prevSeconds)
  const next = Number(nextSeconds)
  if (!Number.isFinite(next)) return Number.isFinite(prev) ? prev : 0
  if (Number.isFinite(prev) && next < prev - 0.5) return prev
  return next
}

/* Phần trăm cho thanh tiến trình, kẹp sẵn về 0..100 ở đây (component không
   phải kiểm lại, và giá trị rác không làm bố cục nhảy). */
export function previewPct(seconds, limit = PREVIEW_SECONDS) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return 0
  return Math.min(100, (s / limit) * 100)
}
