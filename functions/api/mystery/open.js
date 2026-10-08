/* =========================================================
   Pages Function: POST /api/mystery/open
   ---------------------------------------------------------
   Lớp vỏ mỏng: gate + uỷ quyền RPC nằm hết trong worker/index.js
   (mysteryRoute/handleMystery). Dùng onRequest thay vì onRequestPost để
   GET nhầm cũng nhận JSON { error: 'err.mysteryRequest' } mã 405 như bản
   Workers — không bao giờ trả trang lỗi HTML của nền tảng.
   ========================================================= */
import { mysteryRoute } from '../../../worker/index.js'

export async function onRequest(context) {
  return mysteryRoute(context.request, context.env)
}
