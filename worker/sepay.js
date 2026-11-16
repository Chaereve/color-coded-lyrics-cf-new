/* =========================================================
   SePay webhook — SỔ LOG CHUYỂN KHOẢN, LOG-ONLY (2026-11-15)
   ---------------------------------------------------------
   Ngân hàng báo "có tiền về" → SePay → POST vào đây. Handler này:
     · xác minh header  `Authorization: Apikey <SEPAY_WEBHOOK_KEY>`
       (so khớp tuyệt đối + độ dài trước, cùng tinh thần các cổng khác);
     · kiểm shape tối thiểu: `transferAmount` (số > 0) và `content`
       (chuỗi, giữ nguyên hoa/thường — mã compact của app phân biệt case);
     · forward sang RPC `sepay_record_event` — RPC tự giải mã mã đơn trong
       nội dung, đối chiếu số tiền, ghi vào `public.payment_events`
       LOG-ONLY và trả về nhãn matched / underpaid / overpaid / unknown.
   TUYỆT ĐỐI KHÔNG đổi trạng thái đơn, KHÔNG cộng credits, KHÔNG báo người
   mua/admin tự động. Đơn vẫn chờ admin xác nhận thủ công — handler chỉ
   ghi sổ để Pha 2 (enforce) có dữ liệu đo.
   ---------------------------------------------------------
   Không dùng:
     · Turnstile / D1 / KV shield — người gọi không phải người dùng;
     · SERVICE ROLE — RPC nhận p_gate_token (EDGE_GATE_TOKEN) giống hệt
       mô hình spin/vote; cổng edge là nơi duy nhất cầm token.
   Biến môi trường (Pages Dashboard → Settings, cả Production lẫn Preview):
     SEPAY_WEBHOOK_KEY   — secret; đặt đúng header SePay gửi khi cấu hình webhook
     SUPABASE_URL        — https://<ref>.supabase.co
     SUPABASE_ANON_KEY   — khoá anon công khai
     EDGE_GATE_TOKEN     — secret, phải khớp public.set_edge_gate_token(...)
   SePay gọi lại khi nhận mã khác 2xx — hãy trả 2xx khi đã ghi sổ thành công
   (kể cả match_status = unknown) để tránh retry vô hạn; 4xx/5xx chỉ dành
   cho lỗi thật (sai key, body hỏng, RPC chết).
   ========================================================= */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
}
const RPC_TIMEOUT_MS = 15_000

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
const deny = (reason, status = 403) => json({ error: reason }, status)

/* So khớp token có kiềm chế timing: content-length check trước, === sau.
   Đây không phải đường kênh đọc được, token nằm trong header bí mật; chuẩn
   này tương đương các phép so chuỗi đã dùng cho cổng spin/vote. */
const keyMatches = (provided, expected) =>
  typeof provided === 'string' && typeof expected === 'string'
  && provided.length === expected.length && provided === expected

/* Gọi RPC bằng khoá anon + gate token — RPC tự chặn qua edge_gate_ok(). */
async function callRpcAnon(env, name, args, timeoutMs = RPC_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(args),
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function handleSepay(request, env) {
  if (request.method !== 'POST') return deny('err.sepayMethod', 405)
  if (!env.SEPAY_WEBHOOK_KEY) return deny('err.sepaySetup', 503)

  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Apikey ') ? auth.slice('Apikey '.length).trim() : ''
  if (!keyMatches(token, env.SEPAY_WEBHOOK_KEY)) return deny('err.sepayAuth', 401)

  let body
  try { body = await request.json() } catch { return deny('err.sepayBody', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny('err.sepayBody', 400)

  const amount = Number(body.transferAmount ?? body.amount)
  const content = String(body.content ?? body.transferContent ?? body.description ?? '')
  if (!Number.isFinite(amount) || amount <= 0 || !content.trim()) return deny('err.sepayBody', 400)

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return deny('err.sepaySetup', 503)

  try {
    const res = await callRpcAnon(env, 'sepay_record_event', {
      p_gate_token: env.EDGE_GATE_TOKEN ?? null,
      p_payload: body,
    })
    const text = await res.text()
    if (!res.ok) return new Response(text, { status: res.status, headers: JSON_HEADERS })
    // RPC trả jsonb (match_status…) — đẩy nguyên về cho SePay xem là 200.
    return new Response(text, { status: 200, headers: JSON_HEADERS })
  } catch {
    return deny('err.sepayGate', 500)
  }
}

/* Một hàm route dùng chung cho Workers (export default) lẫn Pages Functions. */
export function sepayRoute(request, env) {
  return handleSepay(request, env)
}
