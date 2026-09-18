/* =========================================================
   Pages Function: GET /api/daily-spin/health
   ---------------------------------------------------------
   Lớp vỏ mỏng: toàn bộ logic nằm trong worker/index.js (healthResponse) để
   Workers và Pages dùng chung một nguồn sự thật, không trôi lệch nhau.
   Dùng onRequest thay vì onRequestGet để mọi method đều trả cùng một JSON —
   health check không bao giờ được trả trang lỗi HTML của nền tảng, vì lúc đó
   người kiểm tra không phân biệt được "cổng chưa cấu hình" với "route hỏng".
   ========================================================= */
import { healthResponse } from '../../../worker/index.js'

export async function onRequest(context) {
  return healthResponse(context.env)
}
