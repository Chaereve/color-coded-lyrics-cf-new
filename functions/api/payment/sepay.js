/* =========================================================
   Pages Function: POST /api/payment/sepay
   ---------------------------------------------------------
   Lớp vỏ mỏng: xác minh Apikey SePay + gọi RPC nằm hết trong
   worker/sepay.js (handleSepay). Pages Functions và Workers dùng
   chung đúng một nguồn logic nên hai đường không bao giờ trôi lệch.
   Dùng onRequest (mọi method) để GET nhầm cũng nhận JSON 405.
   ========================================================= */
import { sepayRoute } from '../../../worker/sepay.js'

export async function onRequest(context) {
  return sepayRoute(context.request, context.env)
}
