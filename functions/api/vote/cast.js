/* =========================================================
   Pages Function: POST /api/vote/cast
   ---------------------------------------------------------
   Lớp vỏ mỏng: Turnstile + KV + uỷ quyền RPC nằm hết trong worker/index.js
   (voteRoute/handleVote). File này chỉ nối request của Pages vào đúng hàm đó.
   Dùng onRequest (mọi method) thay vì onRequestPost để GET nhầm cũng nhận
   JSON { error: 'err.voteQty' } mã 405 như bản Workers — Pages mặc định trả
   lỗi 405 dạng text/HTML khi thiếu handler, frontend sẽ không dịch được.
   ========================================================= */
import { voteRoute } from '../../../worker/index.js'

export async function onRequest(context) {
  return voteRoute(context.request, context.env)
}
