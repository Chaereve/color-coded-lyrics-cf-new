/* Khoá định tuyến Pages Functions công khai.
   File này CỐ Ý nằm ở worker/ chứ không nằm dưới functions/: Pages biến MỌI
   file .js trong functions/ thành một route công khai, nên nhét test vào đó là
   tự tạo endpoint lạ trên production. Chốt 3 API route + archive SSR, không thừa.
   Test "_worker.js" khoá việc Pages bỏ Functions khi output có file đó.
   Ba điều được khoá ở đây:
     1. functions/ chỉ có đúng 3 route API + 1 archive SSR.
     2. Ba API route trả JSON đúng mã/khoá lỗi như bản Workers.
     3. _routes.json + _redirects cấu hình đúng cho Functions và SPA. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

import worker, { healthResponse, spinRoute, voteRoute } from './index.js'
import { onRequest as health } from '../functions/api/daily-spin/health.js'
import { onRequest as spin } from '../functions/api/daily-spin/spin.js'
import { onRequest as vote } from '../functions/api/vote/cast.js'
import { onRequest as mystery } from '../functions/api/mystery/open.js'
import { onRequest as archive } from '../functions/archive.js'

const SITE = 'https://chaereve.pages.dev'
const API_ROUTES = ['/api/daily-spin/health', '/api/daily-spin/spin', '/api/vote/cast', '/api/mystery/open']
const FUNCTION_ROUTES = [...API_ROUTES, '/archive']
const hex64 = c => c.repeat(64)
const post = (path, body) => new Request(SITE + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
/* Thân request đúng định dạng nhưng đi cùng env trống: đủ để qua vòng kiểm tra
   đầu vào rồi rơi vào nhánh "thiếu cấu hình" — không chạm mạng, không chạm KV. */
const goodSpinBody = () => ({
  device_token: hex64('a'), request_id: crypto.randomUUID(),
  expected_user_id: crypto.randomUUID(), fp_hash: hex64('b'), user_token: 'jwt-gia',
})
const goodVoteBody = () => ({ request_id: crypto.randomUUID(), delta: 1, user_token: 'jwt-gia' })

/* public/_worker.js được Vite copy thành dist/_worker.js. Pages coi đó là
   Advanced mode và BỎ QUA functions/. _routes.json đưa /api/* và /archive vào
   worker đó, nên trang chủ vẫn hiện còn POST /api/vote/cast trả HTML 503
   "Under Maintenance" — client không parse được JSON và báo err.voteGate. */
test('không ship _worker.js bảo trì — nó nuốt /api/vote/cast', () => {
  for (const rel of ['../_worker.js', '../public/_worker.js']) {
    assert.equal(existsSync(new URL(rel, import.meta.url)), false,
      `${rel} khiến Pages bỏ Functions và vote chết với err.voteGate`)
  }
})

test('functions/ chỉ chứa đúng 3 API route và archive SSR — file lạ sẽ thành endpoint công khai', () => {
  const dir = new URL('../functions/', import.meta.url)
  const js = readdirSync(dir, { recursive: true })
    .filter(f => String(f).endsWith('.js'))
    .map(f => String(f).replace(/\\/g, '/'))
    .sort()
  assert.deepEqual(js, ['api/daily-spin/health.js', 'api/daily-spin/spin.js', 'api/mystery/open.js', 'api/vote/cast.js', 'archive.js'])
})

test('mọi route Pages đều export đúng onRequest (sai tên là Pages bỏ qua file)', () => {
  for (const fn of [health, spin, vote, mystery, archive]) assert.equal(typeof fn, 'function')
})

test('health thiếu binding vẫn 200 JSON { ok, shield:false, gate:false } — không phải HTML', async () => {
  const res = await health({ env: {} })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /application\/json/)
  assert.deepEqual(await res.json(), { ok: true, shield: false, shield_backend: 'none', gate: false })
})

test('health phản ánh đúng binding đã cấu hình, không lộ token', async () => {
  const res = await health({ env: { SPIN_SHIELD: {}, SUPABASE_URL: 'https://x.supabase.co', EDGE_GATE_TOKEN: 'bi-mat' } })
  const text = await res.text() // đọc một lần: body Response không đọc được lần hai
  assert.deepEqual(JSON.parse(text), { ok: true, shield: true, shield_backend: 'kv', gate: true })
  assert.ok(!text.includes('bi-mat'), 'health chỉ báo có/không token, không in token ra')
})

test('health ưu tiên D1 và công khai backend không bí mật để xác nhận rollout', async () => {
  const res = await health({ env: {
    RATE_SHIELD: {}, SPIN_SHIELD: {}, SUPABASE_URL: 'https://x.supabase.co',
  } })
  assert.deepEqual(await res.json(), { ok: true, shield: true, shield_backend: 'd1', gate: false })
})

test('spin/vote nhầm method vẫn trả JSON 405 để frontend dịch được', async () => {
  const s = await spin({ request: new Request(SITE + '/api/daily-spin/spin'), env: {} })
  assert.equal(s.status, 405)
  assert.deepEqual(await s.json(), { error: 'err.spinRequest' })
  const v = await vote({ request: new Request(SITE + '/api/vote/cast'), env: {} })
  assert.equal(v.status, 405)
  assert.deepEqual(await v.json(), { error: 'err.voteQty' })
})

test('body rác bị từ chối 400 bằng key i18n', async () => {
  const s = await spin({ request: post('/api/daily-spin/spin', 'khong-phai-json{'), env: {} })
  assert.equal(s.status, 400)
  assert.deepEqual(await s.json(), { error: 'err.spinRequest' })
  const v = await vote({ request: post('/api/vote/cast', { delta: 'nhieu' }), env: {} })
  assert.equal(v.status, 400)
  assert.deepEqual(await v.json(), { error: 'err.voteQty' })
})

test('thiếu KV/secret thì 503 có kiểm soát — app rơi về RPC, không chết', async () => {
  const s = await spin({ request: post('/api/daily-spin/spin', goodSpinBody()), env: {} })
  assert.equal(s.status, 503)
  assert.deepEqual(await s.json(), { error: 'err.spinSetup' })
  const v = await vote({ request: post('/api/vote/cast', goodVoteBody()), env: {} })
  assert.equal(v.status, 503)
  assert.deepEqual(await v.json(), { error: 'err.voteGate' })
})

test('Pages gọi đúng hàm dùng chung với Workers (một nguồn sự thật)', async () => {
  const env = {}
  assert.equal((await health({ env })).status, healthResponse(env).status)
  assert.equal(
    await (await spin({ request: new Request(SITE + '/api/x'), env })).text(),
    await spinRoute(new Request(SITE + '/api/x'), env).text(),
  )
  assert.equal(
    await (await vote({ request: new Request(SITE + '/api/x'), env })).text(),
    await voteRoute(new Request(SITE + '/api/x'), env).text(),
  )
})

test('Workers và Pages trả đồng nhất status + body cho cùng một request', async () => {
  const env = {}
  const cases = [
    ['/api/daily-spin/health', () => new Request(SITE + '/api/daily-spin/health'), health],
    ['/api/daily-spin/spin', () => new Request(SITE + '/api/daily-spin/spin'), spin],
    ['/api/vote/cast', () => new Request(SITE + '/api/vote/cast'), vote],
    ['/api/daily-spin/spin', () => post('/api/daily-spin/spin', 'rac'), spin],
    ['/api/vote/cast', () => post('/api/vote/cast', { delta: 0 }), vote],
  ]
  for (const [path, make, pagesHandler] of cases) {
    // Body request chỉ đọc được một lần nên mỗi bên dùng một Request riêng.
    const a = await worker.fetch(make(), env)
    const b = await pagesHandler({ request: make(), env })
    assert.equal(b.status, a.status, path)
    assert.equal(await b.text(), await a.text(), path)
  }
})

/* So khớp pattern exact hoặc wildcard cuối theo ngữ nghĩa Pages Routes. */
const covers = (pattern, path) => pattern === path
  || (pattern.endsWith('/*') && (path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1))))

test('_routes.json: chỉ API và /archive gọi Functions, quy tắc trong giới hạn Cloudflare', () => {
  const raw = readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')
  const routes = JSON.parse(raw) // vỡ JSON là deploy lỗi — test này bắt trước
  assert.equal(routes.version, 1)
  assert.ok((routes.include?.length || 0) >= 1, 'Cloudflare bắt buộc ít nhất một include')
  assert.ok((routes.include.length + (routes.exclude?.length || 0)) <= 100, 'tối đa 100 quy tắc')
  for (const r of FUNCTION_ROUTES) {
    assert.ok(routes.include.some(p => covers(p, r)), `${r} phải có Functions xử lý`)
    assert.ok(!(routes.exclude || []).some(p => covers(p, r)), `${r} không được nằm trong exclude`)
  }
})

test('_redirects giữ SPA fallback ở DÒNG CUỐI (Cloudflare so từ trên xuống)', () => {
  const lines = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  assert.ok(lines.length > 0, 'thiếu _redirects là F5 ở đường dẫn con sẽ 404')
  const [from, to, status] = lines[lines.length - 1].split(/\s+/)
  assert.equal(from, '/*')
  assert.equal(to, '/index.html')
  assert.equal(status, '200')
})

/* =========================================================
   CACHE — chốt hai nửa của cùng một quyết định: tài nguyên tĩnh cache dài,
   API thì KHÔNG được cache ở bất kỳ tầng nào.
   ========================================================= */

/* Đọc _headers thành các khối { pattern, headers[] } theo đúng cú pháp
   Cloudflare: dòng không thụt là pattern, dòng thụt là "Name: value",
   dòng bắt đầu bằng # là comment. */
const parseHeaders = () => {
  const out = []
  for (const line of readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) { out.push({ pattern: line.trim(), headers: [] }); continue }
    const [name, ...rest] = line.trim().split(':')
    out.at(-1).headers.push({ name: name.trim().toLowerCase(), value: rest.join(':').trim() })
  }
  return out
}

test('_headers: không có khối bắt-all nào đặt Cache-Control', () => {
  /* Doc Cloudflare: request khớp nhiều rule thì header của MỌI rule được gộp,
     và cùng một header xuất hiện hai lần thì giá trị bị NỐI BẰNG DẤU PHẨY.
     Thêm `/*  Cache-Control: must-revalidate` là /assets/* nhận về
     "…, immutable, public, max-age=0, must-revalidate" — hai vế ngược nhau,
     mất trắng lợi ích của tên file có hash. Lỗi này không hiện ở đâu cả:
     header vẫn 200, chỉ có cache là không chạy. */
  const all = parseHeaders()
  assert.ok(all.length >= 5, 'phải đọc được các khối của _headers')
  const bad = all.filter(b => b.pattern === '/*' && b.headers.some(h => h.name === 'cache-control'))
  assert.deepEqual(bad.map(b => b.pattern), [],
    'bỏ Cache-Control khỏi khối /* — khai từng đường dẫn thay vào đó')
  assert.ok(all.length <= 100, 'Cloudflare cho tối đa 100 rule')
})

test('_headers: khối /* mang security headers, và không header nào bị khai hai lần', () => {
  /* Cloudflare NỐI giá trị khi cùng một header khớp hai rule (xem đầu tệp
     _headers), nên header an toàn phải nằm ở ĐÚNG MỘT khối. Khai lặp không làm
     trang hỏng, nó chỉ nhân đôi giá trị — im lặng, và lớn dần mỗi lần có người
     thêm rule mới. */
  const all = parseHeaders()
  const root = all.find(b => b.pattern === '/*')
  assert.ok(root, 'phải có khối /* mang header an toàn')
  const get = (n) => root.headers.find(h => h.name === n)?.value
  assert.equal(get('x-content-type-options'), 'nosniff')
  assert.match(get('referrer-policy') || '', /strict-origin-when-cross-origin/)
  assert.match(get('permissions-policy') || '', /camera=\(\)/)
  assert.match(get('strict-transport-security') || '', /max-age=\d{7,}/)
  /* Không được kèm includeSubDomains/preload: hai thứ đó áp cho mọi miền con và
     rất khó rút lại — không nên tự bật cho một trang chỉ cần HTTPS. */
  assert.doesNotMatch(get('strict-transport-security') || '', /includeSubDomains|preload/i)

  const names = ['x-content-type-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security', 'content-security-policy']
  for (const n of names) {
    const blocks = all.filter(b => b.headers.some(h => h.name === n))
    assert.deepEqual(blocks.map(b => b.pattern), ['/*'],
      `${n} chỉ được khai ở khối /*, đang có ở: ${blocks.map(b => b.pattern).join(', ')}`)
  }
  const csp = get('content-security-policy') || ''
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com/)
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.supabase\.co/)
  /* Realtime đi bằng WebSocket: `https://*.supabase.co` KHÔNG phủ `wss://`
     (khác scheme là khác nguồn), nên phải khai riêng. Test ngay bên dưới chốt
     bằng đúng URL mà live smoke thấy bị từ chối trên production. */
  assert.match(csp, /connect-src[^;]*wss:\/\/\*\.supabase\.co/)
  assert.match(csp, /frame-src[^;]*https:\/\/www\.youtube\.com/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.ok(!/unsafe-eval/.test(csp), 'CSP không được mở unsafe-eval')
})

/* ---------- connect-src: khoá bằng URL THẬT mà live smoke bắt được ----------
   Site thật ngày 2026-10-06: live smoke 32/34, hai mục đỏ đều là "không có lỗi
   console / exception" (desktop + mobile), cùng một câu:

     Refused to connect to 'wss://<ref>.supabase.co/realtime/v1/websocket?apikey=…&vsn=2.0.0'
     because it violates the following Content Security Policy directive:
     "connect-src 'self' https://*.supabase.co …"

   `npm test` và `npm run smoke` KHÔNG bắt được: jsdom không mở socket thật, và
   bundle CI không có VITE_SUPABASE_* nên `hasSupabase` = false — hai kênh
   `live`/`live-media` trong src/App.jsx chưa bao giờ được dựng. Chỉ site đã
   deploy mới lộ. Vì vậy ba phép kiểm dưới đây chốt bằng chính URL đó. */

/* Project ref thật, cùng giá trị với VITE_SUPABASE_URL trong .env.example và
   với host trong câu lỗi CSP ở trên. Đổi project thì đổi cả ba chỗ. */
const SUPABASE_HOST = 'yooxntqwdlvkxcblgqbw.supabase.co'
const REALTIME_URL = `wss://${SUPABASE_HOST}/realtime/v1/websocket?apikey=sb_publishable_4jGXNIjGvToqfcTCMGVP-g_u0FYOhdt&vsn=2.0.0`

/* Danh sách nguồn của một directive, đọc từ CSP của khối bắt-all trong _headers. */
const cspSources = (directive) => {
  const csp = parseHeaders().find(b => b.pattern === '/*')?.headers
    .find(h => h.name === 'content-security-policy')?.value || ''
  const part = csp.split(';').map(s => s.trim()).find(s => s.startsWith(`${directive} `))
  return part ? part.slice(directive.length + 1).split(/\s+/).filter(Boolean) : []
}

/* Một URL có được danh sách nguồn cho phép không. Chỉ cài ĐÚNG ba luật mà tệp
   này cần (không cài hết spec CSP): nguồn phải có scheme tường minh, scheme phải
   khớp đúng từng chữ — `https://` không kéo theo `wss://` — và `*.` chỉ khớp
   miền con. */
const cspAllows = (sources, rawUrl) => {
  const u = new URL(rawUrl)
  const scheme = u.protocol.replace(/:$/, '').toLowerCase()
  const host = u.hostname.toLowerCase()
  return sources.some(src => {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/]+)$/i.exec(src)
    if (!m) return false                        // 'self', data:, blob: … không xét ở đây
    if (m[1].toLowerCase() !== scheme) return false
    const pattern = m[2].toLowerCase()
    if (pattern === '*') return true
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1))
    return host === pattern
  })
}

test('_headers: connect-src đủ cho Realtime (wss) lẫn REST/auth (https) của Supabase', () => {
  const connect = cspSources('connect-src')
  assert.ok(connect.length >= 5, `không đọc được connect-src: "${connect.join(' ')}"`)

  /* Đúng URL bị từ chối ở trên — đây là phép kiểm trả lời câu "sửa xong chưa". */
  assert.ok(cspAllows(connect, REALTIME_URL),
    `Realtime vẫn bị CSP chặn: connect-src = ${connect.join(' ')}`)
  /* Sửa wss không được làm rớt ba cửa https đang dùng (PostgREST, Auth, Storage). */
  for (const path of ['/rest/v1/requests?select=*', '/auth/v1/token?grant_type=refresh_token', '/storage/v1/object/public/avatars/a.png']) {
    assert.ok(cspAllows(connect, `https://${SUPABASE_HOST}${path}`),
      `https://${SUPABASE_HOST}${path} phải qua được connect-src`)
  }
})

test('_headers: connect-src liệt kê đúng danh sách nguồn — thêm/bớt phải sửa test có chủ đích', () => {
  /* Khoá cứng cả danh sách vì lỗi ở đây im lặng tuyệt đối: thiếu một nguồn thì
     tính năng chết trên production còn `npm test` vẫn xanh (xem ghi chú trên).
     Test đỏ nghĩa là CÓ NGUỒN MỚI được mở ra — phải là một quyết định, không
     phải một dòng tiện tay. */
  assert.deepEqual(cspSources('connect-src'), [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.cloudinary.com',
    'https://api.vietqr.io',
    'https://challenges.cloudflare.com',
    'https://*.pages.dev',
    'https://*.workers.dev',
    'https://i.ytimg.com',
  ])
})

test('_headers: wss chỉ mở cho *.supabase.co — không mở socket ra mọi host', () => {
  const connect = cspSources('connect-src')
  /* `wss:` (mọi host) và `wss://*` là hai cách viết "cho hết": một trang bị chèn
     mã sẽ nối ra máy chủ lạ mà CSP không nói một lời. Cũng không được có `*`
     trần — nó mở luôn cả https/wss cho mọi nơi. */
  for (const bad of ['wss:', 'wss://*', '*', 'ws:', 'ws://*']) {
    assert.ok(!connect.includes(bad), `connect-src không được chứa "${bad}"`)
  }
  assert.equal(connect.filter(s => s.startsWith('wss')).length, 1,
    'chỉ MỘT nguồn wss được mở')
  assert.ok(!cspAllows(connect, 'wss://evil.example.com/realtime/v1/websocket'),
    'socket tới host lạ phải bị chặn')
  assert.ok(!cspAllows(connect, 'wss://supabase.co.evil.example.com/'),
    'wildcard phải khớp theo nhãn miền, không theo chuỗi con')
})

test('_headers: bundle/font cache 1 năm, HTML luôn hỏi lại, API no-store', () => {
  const cc = (p) => parseHeaders().find(b => b.pattern === p)?.headers
    .find(h => h.name === 'cache-control')?.value
  for (const p of ['/assets/*', '/fonts/*']) {
    assert.match(cc(p) || '', /max-age=31536000/, `${p} phải cache 1 năm`)
    assert.match(cc(p) || '', /immutable/, `${p} có hash nội dung nên khai immutable được`)
  }
  assert.equal(cc('/api/*'), 'no-store', 'API chống farm không được cache')
  for (const p of ['/', '/index.html', '/daily-login', '/quiz', '/daily-spin', '/ranking', '/profile']) {
    assert.match(cc(p) || '', /must-revalidate/,
      `${p} là HTML: cache là người dùng kẹt ở bản cũ, không nhận bundle mới`)
  }
})

test('mọi response của 3 route API đều no-store — cả Pages lẫn Workers', async () => {
  /* _headers không chắc phủ được response do Function sinh ra (doc Cloudflare
     cảnh báo riêng), nên header phải đi ra từ CHÍNH code dựng response.
     Đây là chỗ duy nhất kiểm chứng được điều đó trước khi deploy. */
  const env = {}
  const cases = [
    ['health', () => new Request(SITE + '/api/daily-spin/health'), health],
    ['spin 405', () => new Request(SITE + '/api/daily-spin/spin'), spin],
    ['spin 400', () => post('/api/daily-spin/spin', 'rac'), spin],
    ['spin 503', () => post('/api/daily-spin/spin', goodSpinBody()), spin],
    ['vote 400', () => post('/api/vote/cast', { delta: 'nhieu' }), vote],
    ['vote 503', () => post('/api/vote/cast', goodVoteBody()), vote],
  ]
  for (const [name, make, pagesHandler] of cases) {
    const pages = await pagesHandler({ request: make(), env })
    assert.equal(pages.headers.get('cache-control'), 'no-store', `Pages · ${name}`)
    const wrk = await worker.fetch(make(), env)
    assert.equal(wrk.headers.get('cache-control'), 'no-store', `Workers · ${name}`)
    /* `nosniff` phải đi ra từ chính code, không trông vào _headers: response do
       Function/Worker sinh không chắc được _headers phủ (xem ghi chú đầu tệp). */
    assert.equal(wrk.headers.get('x-content-type-options'), 'nosniff', `Workers · ${name}`)
    assert.equal(pages.headers.get('x-content-type-options'), 'nosniff', `Pages · ${name}`)
  }
})
