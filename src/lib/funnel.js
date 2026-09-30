/* =========================================================
   FUNNEL — số liệu đường đi của người dùng ("metric, not vibes")
   ---------------------------------------------------------
   Trả lời câu hỏi mà trước giờ chỉ có cảm tính: *người mới bỏ đi ở bước
   nào?* Năm sự kiện, đúng một cửa ghi:

     visit   mở trang (tối đa MỘT lần mỗi phiên — sessionStorage)
     request gửi request thành công (meta: kind, paid)
     vote    vote thành công (meta: n)
     buy     tạo đơn mua vote (meta: pack)
     spin    quay xong một lượt

   Kỷ luật free-tier (docs/GOI-Y-ECC §6):
     · ghi thẳng Supabase bằng MỘT RPC `track_funnel` — không qua Workers KV;
     · KHÔNG thêm cron: server tự dọn dòng > 30 ngày (xem migration
       20261110_funnel_events.sql);
     · demo mode (không có Supabase) thì không ghi gì — và không bao giờ để
       việc đo lường làm hỏng việc chính: hàm nuốt mọi lỗi, không throw,
       không await ở nơi gọi.
   Riêng tư: chỉ TÊN sự kiện + meta tối đa vài byte. Không IP, không vân tay,
   không định danh thiết bị — bảng sản phẩm, không phải bảng truy vết.
   ========================================================= */

export const FUNNEL_EVENTS = ['visit', 'request', 'vote', 'buy', 'spin']
const VISIT_KEY = 'ccl_funnel_visit'
const MAX_META_KEYS = 6

/* Client được db.js TỰ ĐĂNG KÝ khi khởi tạo (_useFunnelClient(supabase)).
   Funnel không import db.js: một module thuần thì test được bằng node --test
   (bài học voteHardening/board/shareCard — đừng kéo cả đống import Vite vào
   file muốn kiểm), và không có vòng tròn import với db.js. */
let client = null
export function _useFunnelClient(c) { client = c ?? null }

/* Ghi một sự kiện. Trả về true nếu đã CỐ GHI (không nói lên thành công —
   đây là fire-and-forget có chủ đích: đo lường không bao giờ được chặn
   thao tác người dùng, và lỗi mạng ở đường đo lường không ai cần thấy). */
export function trackFunnel(event, meta = {}) {
  try {
    if (!client || !FUNNEL_EVENTS.includes(event)) return false
    /* meta gọn: tối đa 6 khoá, giá trị nguyên thuỷ, không nhét object lạ */
    const small = {}
    for (const [k, v] of Object.entries(meta || {}).slice(0, MAX_META_KEYS)) {
      if (typeof v === 'number' || typeof v === 'boolean') small[k] = v
      else if (typeof v === 'string') small[k] = v.slice(0, 40)
    }
    client.rpc('track_funnel', { p_event: event, p_meta: small })
      .then(() => {}, () => {})
    return true
  } catch {
    return false
  }
}

/* visit: tối đa MỘT lần mỗi phiên trình duyệt. sessionStorage có thể bị
   chặn (trình duyệt riêng tư) — khi đó ghi mỗi lần mở trang vẫn được,
   server tự dọn, và đếm "phiên" vẫn đúng nghĩa gần đúng. */
export function trackVisitOnce() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem(VISIT_KEY)) return false
      sessionStorage.setItem(VISIT_KEY, '1')
    }
  } catch { /* storage chặn: bỏ qua, vẫn ghi */ }
  return trackFunnel('visit')
}
