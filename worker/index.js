/* =========================================================
   CỔNG EDGE cho Daily Spin VÀ Vote (Turnstile + KV + uỷ quyền RPC)
   ---------------------------------------------------------
   Logic dưới đây chạy ở HAI nơi nhưng chỉ viết MỘT lần:
     · ĐƯỜNG CHÍNH THỨC (production chaereve.pages.dev): Cloudflare Pages
       Functions — functions/api/daily-spin/health.js, .../spin.js và
       functions/api/vote/cast.js là lớp vỏ mỏng gọi lại đúng các hàm
       healthResponse/spinRoute/voteRoute trong file này. Pages tự build khi
       push GitHub, không ai chạy `wrangler deploy`.
     · PHƯƠNG ÁN THAY THẾ: Cloudflare Workers (wrangler.jsonc) dùng export
       default fetch() ở cuối file — cùng các hàm trên nên hai đường không bao
       giờ trôi lệch nhau. Sửa hành vi route thì sửa ở đây, cả hai tự theo.
   ---------------------------------------------------------
   Luồng dữ liệu (hybrid):
     Client (fp hash + Turnstile token + JWT phiên Supabase)
        → Worker: xác minh Turnstile → kiểm tra KV (xác thực kép
          fingerprint + rate-limit theo IP/vân tay)
        → Worker gọi Supabase RPC BẰNG JWT của chính người dùng
          (auth.uid() trong SQL vẫn đúng người nhận), kèm
          p_gate_token để Postgres biết lời gọi ĐI QUA cổng này
        → Supabase ghi ledger / phiếu bầu + cộng trừ vote trong một transaction
        → Worker đếm lượt vào KV (chỉ khi database đã ghi thành công)
        → trả nguyên phản hồi về client (client tự validate như cũ)

   KV chỉ chắn spam; hạn mức và tiền thưởng do Postgres quyết định.

   Biến môi trường (Pages Dashboard → Settings, đặt cho cả Production lẫn
   Preview; Workers thì dùng wrangler secret — xem wrangler.jsonc):
     SPIN_SHIELD           — binding KV namespace
     SUPABASE_URL          — https://<ref>.supabase.co
     SUPABASE_ANON_KEY     — khoá anon công khai (auth thật nằm ở JWT người dùng)
     TURNSTILE_SECRET_KEY  — secret, KHÔNG bao giờ đặt vào biến VITE_*
     EDGE_GATE_TOKEN       — secret, phải khớp public.set_edge_gate_token(...)
                             trong Supabase. Có nó thì gọi thẳng PostgREST
                             (không qua Worker) sẽ bị từ chối — đây là thứ làm
                             cho Turnstile/KV ở đây thật sự có giá trị.
   ========================================================= */
import { shieldCheck, shieldCommit, voteShieldCheck, voteShieldCommit } from './shield.js'

/* `no-store` đặt Ở ĐÂY chứ không chỉ trong public/_headers: file _headers áp
   cho tài nguyên tĩnh, còn response do Function sinh ra thì không chắc được nó
   phủ (doc Cloudflare cảnh báo riêng chuyện này). Ba route này là lá chắn chống
   farm — một lượt quay hay một lá phiếu bị trình duyệt/CDN trả lại từ cache là
   luật chơi bị phá mà không có log nào để soi. */
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH64 = /^[a-f0-9]{64}$/

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
/* Lỗi luôn trả về KEY để từ điển i18n bên frontend dịch ra câu chữ. */
const deny = (reason, status = 403) => json({ error: reason }, status)

/* Băm IP trước khi ghi xuống Supabase: đủ để đối soát sự cố, không lưu IP thô. */
async function sha256hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/* Gọi siteverify của Cloudflare; thiếu secret (môi trường dev) thì bỏ qua. */
async function verifyTurnstile(secret, token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  })
  const data = await res.json().catch(() => null)
  return Boolean(data?.success)
}

/* Uỷ quyền RPC cho Supabase bằng JWT của người dùng: Worker không cầm service
   role nên không thể tự thưởng / tự bỏ phiếu cho ai ngoài chính người gọi. */
function callRpc(env, name, userToken, args) {
  return fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ ...args, p_gate_token: env.EDGE_GATE_TOKEN ?? null }),
  })
}

export async function handleSpin(request, env) {
  // IP thật do Cloudflare đặt sẵn — client không tự khai được.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  let body
  try { body = await request.json() } catch { return deny('err.spinRequest', 400) }

  const { device_token: deviceToken, request_id: requestId, expected_user_id: userId, fp_hash: fpHash, turnstile_token: captcha, user_token: userToken } = body || {}
  if (!HASH64.test(deviceToken || '') || !UUID.test(requestId || '') || !UUID.test(userId || '')
    || !HASH64.test(fpHash || '') || typeof userToken !== 'string' || !userToken) {
    return deny('err.spinRequest', 400)
  }
  if (!env.SPIN_SHIELD || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return deny('err.spinSetup', 503)

  try {
    // 1) Bot chặn đứng ở đây: không token Turnstile hợp lệ thì không qua cửa.
    if (env.TURNSTILE_SECRET_KEY) {
      if (!captcha || !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, captcha, ip))) return deny('err.spinCaptcha')
    }

    // 2) Xác thực kép + rate-limit theo IP bằng KV (xem worker/shield.js).
    const check = await shieldCheck(env.SPIN_SHIELD, { ip, fpHash })
    if (!check.ok) return deny(check.reason)

    // 3) Postgres ghi ledger + cộng thưởng trong một transaction.
    const spin = await callRpc(env, 'spin_daily', userToken, {
      p_device_token: deviceToken,
      p_request_id: requestId,
      p_expected_user_id: userId,
      p_fp_hash: fpHash,
      p_ip_hash: await sha256hex(ip),
    })
    const text = await spin.text()
    if (!spin.ok) {
      // Lỗi PostgREST/SQL (hết lượt, đổi tài khoản…) trả nguyên văn cho client dịch.
      return new Response(text, { status: spin.status, headers: JSON_HEADERS })
    }

    // 4) Ledger đã ghi mới đếm vào KV; retry (replayed) không tính lần hai.
    let result = null
    try { result = JSON.parse(text) } catch { /* phản hồi lạ: bỏ qua đếm */ }
    if (result && !result.replayed) {
      try { await shieldCommit(env.SPIN_SHIELD, { ip, fpHash }) } catch { /* KV lỗi không làm mất thưởng */ }
    }
    return new Response(text, { status: 200, headers: JSON_HEADERS })
  } catch {
    // Mọi thứ ngoài dự kiến: không suy đoán kết quả, client sẽ retry cùng request_id.
    return deny('err.spinGate', 500)
  }
}

/* ---------------------------------------------------------
   VOTE (2026-11-03)
   Trước đây vote đi thẳng từ trình duyệt tới PostgREST: không Turnstile, không
   fingerprint, không IP — tức là không có gì cản một người mở 10 tài khoản
   Google để lấy 30 vote miễn phí mỗi ngày, và cũng không để lại dấu vết nào
   cho việc điều tra sau này. Cổng này gắn ba thứ đó vào mỗi lượt vote.
   Hạn mức vẫn do Postgres giữ (3 free/ngày cho MỘT tài khoản và cho MỘT vân
   tay, cộng ví bonus/đã mua), cổng chỉ chặn bot và ghi dấu vết.
   --------------------------------------------------------- */
export async function handleVote(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  let body
  try { body = await request.json() } catch { return deny('err.voteQty', 400) }

  const { request_id: requestId, delta, fp_hash: fpHash, turnstile_token: captcha, user_token: userToken } = body || {}
  const n = Number(delta)
  if (!UUID.test(requestId || '') || !Number.isInteger(n) || n === 0 || Math.abs(n) > 100
    || typeof userToken !== 'string' || !userToken) {
    return deny('err.voteQty', 400)
  }
  // Vân tay là tuỳ chọn (trình duyệt riêng tư có thể không lấy được); thiếu thì
  // vote vẫn chạy, chỉ mất lớp hạn mức theo vân tay — đúng như Daily Spin.
  const fp = HASH64.test(fpHash || '') ? fpHash : null
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return deny('err.voteGate', 503)

  try {
    if (env.TURNSTILE_SECRET_KEY) {
      if (!captcha || !(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, captcha, ip))) return deny('err.spinCaptcha')
    }

    if (env.SPIN_SHIELD) {
      const check = await voteShieldCheck(env.SPIN_SHIELD, { fpHash: fp })
      if (!check.ok) return deny(check.reason, 429)
    }

    const res = await callRpc(env, 'cast_vote', userToken, {
      p_request_id: requestId,
      p_delta: n,
      p_fp_hash: fp,
      p_ip_hash: await sha256hex(ip),
    })
    const text = await res.text()
    if (!res.ok) return new Response(text, { status: res.status, headers: JSON_HEADERS })

    if (env.SPIN_SHIELD) {
      try { await voteShieldCommit(env.SPIN_SHIELD, { fpHash: fp }) } catch { /* KV lỗi không làm mất phiếu */ }
    }
    return new Response(text, { status: 200, headers: JSON_HEADERS })
  } catch {
    return deny('err.voteGate', 500)
  }
}

/* Ba hàm route — export để Pages Functions gọi lại, Workers cũng dùng chung:
   kiểm tra method ở đây (thay vì onRequestPost riêng) để phản hồi 405 cũng là
   JSON { error } cho frontend dịch, chứ không phải trang lỗi mặc định của nền tảng. */
export function healthResponse(env) {
  return json({
    ok: true,
    shield: Boolean(env.SPIN_SHIELD && env.SUPABASE_URL),
    // Cổng đã có token chưa (không lộ token). false = gọi thẳng RPC vẫn được.
    gate: Boolean(env.EDGE_GATE_TOKEN),
  })
}

export function spinRoute(request, env) {
  return request.method === 'POST' ? handleSpin(request, env) : deny('err.spinRequest', 405)
}

export function voteRoute(request, env) {
  return request.method === 'POST' ? handleVote(request, env) : deny('err.voteQty', 405)
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/daily-spin/health') return healthResponse(env)
    if (pathname === '/api/daily-spin/spin') return spinRoute(request, env)
    if (pathname === '/api/vote/cast') return voteRoute(request, env)
    // Mọi đường dẫn còn lại: file tĩnh của app (SPA fallback do cấu hình assets lo).
    if (pathname.startsWith('/api/')) return deny('err.spinRequest', 404)
    return env.ASSETS.fetch(request)
  },
}
