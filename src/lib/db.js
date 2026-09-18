import { createClient } from '@supabase/supabase-js'
import { parseYoutube } from './youtube'
import { demoSpinStatus, drawDemoSpin, validateSpinResult } from './dailySpin'
import { getSpinDevice, withSpinLock } from './spinDevice'
import { SPIN_GATE_URL, VOTE_GATE_URL, fingerprintHash, acquireCaptchaToken } from './spinShield'
import { groupKey } from './board'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(URL && KEY && URL.startsWith('http'))
export const supabase = hasSupabase ? createClient(URL, KEY) : null

export const FREE_VOTES_PER_DAY = 3
export const MAX_REQUESTS_PER_HOUR = 3
/* Toi da bao nhieu paid request dang cho thanh toan cung luc (khop
   create_request trong migrations/20261103_vote_hardening.sql) */
export const MAX_PAID_AWAITING = 5

/* Ty gia quy doi USD -> VND (cap nhat khi can) */
export const USD_VND = 26100

/* Paid Request */
export const PAID_REQUEST = { usd: 0.75, vnd: 20000 }

/* Goi mua vote — VND lam tron den nghin gan nhat theo USD_VND */
export const VOTE_PACKS = [
  { id: 'v3',  qty: 3,  usd: 0.49, vnd: 13000 },
  { id: 'v10', qty: 10, usd: 1.29, vnd: 34000 },
  { id: 'v30', qty: 30, usd: 2.99, vnd: 78000 },
]

/* Mua le tung vote */
export const SINGLE_VOTE = { usd: 0.19, vnd: 5000 }

/* Tinh gia mua le theo so luong */
export const singlePrice = (n) => ({
  id: 'custom',
  qty: n,
  usd: Math.round(SINGLE_VOTE.usd * n * 100) / 100,
  vnd: Math.round((SINGLE_VOTE.vnd * n) / 1000) * 1000,
})

export const KINDS = ['Color Coded Lyrics', 'Full Album', '1 Hour Loop', 'Short']

/* Bang media:
   'featured' = video noi bat (hero lon giua trang chu)
   'video'    = cac link video admin dan tay (dai "Latest update")
   Giu them 'playlist' cho khop check constraint trong database. */
export const MEDIA_KINDS = ['featured', 'video', 'playlist']

/* =========================================================
   DEMO MODE (khi chua cau hinh .env)
   ========================================================= */
const LS = {
  user: 'ccl3_user', rows: 'ccl3_rows', votes: 'ccl3_votes', orders: 'ccl3_orders',
  prof: 'ccl3_prof', media: 'ccl3_media', spins: 'ccl3_spins',
}

/*
 * Demo data used to live under a couple of older keys.  Never seed over a
 * value that is already in the browser: migrate a known old key first, then
 * create the seed only when there really is no data at all.
 */
const LEGACY_LS = {
  rows: ['ccl2_rows', 'ccl_rows'], votes: ['ccl2_votes', 'ccl_votes'],
  orders: ['ccl2_orders', 'ccl_orders'], prof: ['ccl2_prof', 'ccl_prof'],
  media: ['ccl2_media', 'ccl_media'],
}
const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d } catch { return d } }
const readData = (k, d) => {
  const current = rd(k, null)
  if (current !== null) return current
  const base = Object.entries(LS).find(([, value]) => value === k)?.[0]
  for (const old of LEGACY_LS[base] || []) {
    const value = rd(old, null)
    if (value !== null) {
      try { localStorage.setItem(k, JSON.stringify(value)) } catch { /* ignore */ }
      return value
    }
  }
  return d
}
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

/* A read-only browser snapshot makes a temporary API/schema failure unable
   to blank a board that was already loaded.  It is not used to overwrite a
   successful (including empty) response from Supabase. */
const CACHE = {
  rows: 'ccl3_cache_requests', ranking: 'ccl3_cache_ranking', media: 'ccl3_cache_media',
}
const cacheRead = (k, d = null) => rd(k, d)
const cacheWrite = (k, value) => wr(k, value)
const isMissingSchemaObject = (error) => ['PGRST202', 'PGRST205'].includes(error?.code)
const today = () => new Date().toISOString().slice(0, 10)

const SEED = [
  { kind: 'Color Coded Lyrics', artist: 'Stray Kids', title: 'FARMING', requester: 'ttokyeoni', status: 'in_progress', progress: 47, votes: 3 },
  /* Hàng mẫu đã vào Up next để demo trạng thái khóa vote */
  { kind: '1 Hour Loop', artist: 'TWICE', title: 'Moonlight Sunrise', requester: "O'Clock", status: 'queued', progress: 0, votes: 12,
    picked_at: new Date(Date.now() - 172800000).toISOString() },
  { kind: 'Color Coded Lyrics', artist: 'LE SSERAFIM', title: 'Pop Off Pop Off', requester: 'swanlychae', status: 'queued', progress: 0, votes: 14, is_paid: true, payment_status: 'paid' },
  { kind: 'Full Album', artist: 'NewJeans', title: 'Get Up', requester: 'lyricscsc', status: 'completed', progress: 100, votes: 27, video_url: 'https://youtu.be/dQw4w9WgXcQ' },
  { kind: 'Color Coded Lyrics', artist: 'aespa', title: 'Whiplash', requester: 'minji', status: 'pending', progress: 0, votes: 0 },
  { kind: 'Full Album', artist: 'IVE', title: 'IVE SWITCH', requester: 'ttokyeoni', status: 'queued', progress: 0, votes: 6 },
]
function demoRows() {
  const r = readData(LS.rows, null)
  if (r) return r
  const rows = SEED.map((x, i) => ({
    is_paid: false, payment_status: 'none', video_url: null, link: '', note: '', deny_reason: null,
    ...x, id: 'seed-' + i, user_id: i % 3 === 0 ? 'demo-user' : 'other-' + i,
    created_at: new Date(Date.now() - i * 5.4e6).toISOString(),
  }))
  wr(LS.rows, rows); return rows
}
const demoProfile = () => {
  // Ho cu chi co vote_credits (chung 1 vi voi bonus); ban demo moi tach san
  // bonus_credits rieng nhu database that.
  const p = readData(LS.prof, { vote_credits: 0, is_admin: true })
  if (!Number.isInteger(p.bonus_credits)) p.bonus_credits = 0
  return p
}

/* Du lieu mau: mot video noi bat + vai link video. Dung video that de
   thumbnail o che do demo tai duoc. */
const MEDIA_SEED = [
  { kind: 'featured', title: 'Stray Kids — FARMING [Color Coded Lyrics]',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { kind: 'video', title: 'CHUNG HA México (Versión Español) Lyrics',
    url: 'https://www.youtube.com/watch?v=WLNidQY8FuM' },
  { kind: 'video', title: 'tripleS World Wild Women Lyrics',
    url: 'https://www.youtube.com/watch?v=G_VfwOjJ-Do' },
]
function demoMedia() {
  const m = readData(LS.media, null)
  if (m) return m
  const rows = MEDIA_SEED.map((x, i) => ({
    note: '', thumb: null, is_hidden: false, ...x,
    id: 'media-' + i, position: i,
    created_at: new Date(Date.now() - i * 8.64e7).toISOString(),
    updated_at: new Date(Date.now() - i * 8.64e7).toISOString(),
  }))
  wr(LS.media, rows); return rows
}

/* ======================== AUTH ======================== */
const shape = (u, p = {}) => {
  const m = u.user_metadata || {}
  return {
    id: u.id, email: u.email,
    name: p.name || m.full_name || m.name || u.email?.split('@')[0] || 'User',
    avatar: p.avatar_url || m.avatar_url || m.picture || null,
    // so vote (da mua / bonus / tong) lay qua my_vote_status(), khong doc
    // thang tu bang profiles
    isAdmin: !!p.is_admin, credits: 0, purchased: 0, bonus: 0,
  }
}

export async function getUser() {
  if (!hasSupabase) {
    const u = rd(LS.user, null)
    if (!u) return null
    const pf = demoProfile()
    return {
      ...u,
      name: pf.name || u.name,
      avatar: pf.avatar_url ?? u.avatar ?? null,
      isAdmin: pf.is_admin,
      credits: (pf.vote_credits || 0) + (pf.bonus_credits || 0),
      purchased: pf.vote_credits || 0, bonus: pf.bonus_credits || 0,
    }
  }
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  const { data: p } = await supabase.from('profiles').select('id, name, avatar_url, is_admin').eq('id', data.user.id).maybeSingle()
  return shape(data.user, p || {})
}

export function onAuthChange(cb) {
  if (!hasSupabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange(async (_e, s) => {
    if (!s?.user) return cb(null)
    const { data: p } = await supabase.from('profiles').select('id, name, avatar_url, is_admin').eq('id', s.user.id).maybeSingle()
    cb(shape(s.user, p || {}))
  })
  return () => data.subscription.unsubscribe()
}

export async function signInGoogle(captchaToken) {
  if (!hasSupabase) {
    const u = { id: 'demo-user', name: 'Demo User', email: 'demo@gmail.com', avatar: null }
    const pf = demoProfile()
    wr(LS.user, u)
    return { ...u, ...pf, isAdmin: pf.is_admin,
      credits: (pf.vote_credits || 0) + (pf.bonus_credits || 0),
      purchased: pf.vote_credits || 0, bonus: pf.bonus_credits || 0 }
  }
  /* captchaToken: Supabase chi chap nhan OAuth khi enforcement CAPTCHA dang bat.
     Chua co token (chua cau hinh Turnstile) thi gui nhu cu — van dang nhap
     duoc cho den khi admin bat enforcement trong Dashboard. */
  /* prompt=select_account: KHONG duoc bo. Google van con phien dang nhap cua
     no sau khi minh signOut (do la phien cua Google, khong phai cua minh), nen
     mac dinh no cap lai token cho DUNG tai khoan cu ma khong hoi gi — bam
     "Dang xuat" roi dang nhap lai se roi tham vao chinh tai khoan vua thoat,
     khong the doi tai khoan. Tham so nay buoc Google hien man chon tai khoan. */
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: 'select_account' },
      ...(captchaToken ? { captchaToken } : {}),
    },
  })
  if (error) throw error
}

export async function signOut() {
  if (!hasSupabase) { localStorage.removeItem(LS.user); return }
  /* scope 'local' van de lai token trong tab khac; dang xuat toan cuc de moi
     thiet bi/tab cung roi phien. Loi mang khong duoc chan viec don sach may
     nay — neu khong, nguoi dung bam "Dang xuat" ma van dang nhap. */
  try { await supabase.auth.signOut({ scope: 'global' }) } catch { /* van don o duoi */ }
  /* Don not het dau vet phien cua supabase-js trong localStorage. Neu con sot
     lai, lan tai trang sau getUser() se khoi phuc dung tai khoan vua thoat. */
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.includes('-auth-token')) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

/* ======================== READ ======================== */
export async function fetchRequests() {
  if (!hasSupabase) return demoRows()
  const { data, error } = await supabase.from('requests').select('*')
    .order('created_at', { ascending: false }).limit(800)
  if (!error) {
    cacheWrite(CACHE.rows, data)
    return data
  }
  /* A transient outage must not make previously loaded user data disappear.
     If the old browser snapshot exists, use it even while the owner repairs
     a missing schema object; never replace it with a fake empty board. */
  const cached = cacheRead(CACHE.rows)
  if (Array.isArray(cached)) return cached
  throw error
}

/* Tra ve Map: request_id -> so lan minh da vote cho request do */
export async function fetchMyVotes(uid) {
  const tally = (ids) => {
    const m = new Map()
    for (const id of ids) m.set(id, (m.get(id) || 0) + 1)
    return m
  }
  if (!uid) return new Map()
  if (!hasSupabase) return tally(readData(LS.votes, []).map(v => v.id))
  const { data, error } = await supabase.from('votes').select('request_id').eq('user_id', uid)
  if (!error) return tally(data.map(v => v.request_id))
  throw error
}

/* Chia so du thanh hai loai: vote da mua (khong het han) va bonus tu vong
   quay (reset cuoi thang 10). credits = tong cua hai loai, giu de phan con
   lai tinh toan nhu cu. Backend chua chay migration tach cot (chi tra tong
   credits) thi hien tat ve 'purchased' cho khong hong. */
export function splitCredits(r = {}) {
  const purchased = Number.isInteger(r.purchased) ? r.purchased
    : Number.isInteger(r.vote_credits) ? r.vote_credits
    : (Number.isInteger(r.credits) ? r.credits : 0)
  const bonus = Number.isInteger(r.bonus) ? r.bonus
    : Number.isInteger(r.bonus_credits) ? r.bonus_credits : 0
  const credits = Number.isInteger(r.credits) ? r.credits : purchased + bonus
  return { credits, purchased, bonus }
}

export async function fetchVoteStatus() {
  if (!hasSupabase) {
    const used = readData(LS.votes, []).filter(v => !v.credit && v.day === today()).length
    const prof = demoProfile()
    return { free_used: used, free_limit: FREE_VOTES_PER_DAY,
      ...splitCredits({ credits: (prof.vote_credits || 0) + (prof.bonus_credits || 0),
        purchased: prof.vote_credits || 0, bonus: prof.bonus_credits || 0 }) }
  }
  const { data, error } = await supabase.rpc('my_vote_status')
  if (error) throw error
  const r = Array.isArray(data) ? data[0] : data
  return { free_used: r.free_used, free_limit: r.free_limit, ...splitCredits(r) }
}

/* ======================== DAILY SPIN ======================== */
const spinSetupError = error => isMissingSchemaObject(error)
  ? new Error('err.spinSetup') : error

async function spinRpc(name, args) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await supabase.rpc(name, args).abortSignal(controller.signal)
    if (controller.signal.aborted) throw new Error('err.spinTimeout')
    return response
  } finally { clearTimeout(timeout) }
}

async function spinDevice() {
  return getSpinDevice(async () => {
    if (!hasSupabase) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    }
    const { data, error } = await spinRpc('register_daily_spin_device')
    if (error) throw spinSetupError(error)
    return data
  })
}

export async function fetchDailySpinStatus() {
  if (!hasSupabase && !rd(LS.user, null)) throw new Error('err.signin')
  const token = await spinDevice()
  if (!hasSupabase) {
    const prof = demoProfile()
    return demoSpinStatus({
      entries: rd(LS.spins, []), deviceToken: token, userId: rd(LS.user, null)?.id,
      purchased: prof.vote_credits || 0, bonus: prof.bonus_credits || 0,
    })
  }
  const { data, error } = await spinRpc('my_daily_spin_status', { p_device_token: token })
  if (error) throw spinSetupError(error)
  return data
}

/* Khi đã bật cổng Edge (VITE_SPIN_GATE_URL — Pages Functions trên production),
   lượt quay đi qua lá chắn Edge: Turnstile + KV check fingerprint/IP trước, rồi
   cổng uỷ quyền RPC bằng JWT của chính người dùng. Không có gate (hoặc cổng thiếu
   KV/secret) thì gọi thẳng RPC như trước đây — app không chết vì cổng. */
async function performSpinViaGate(requestId, userId) {
  const token = await spinDevice()
  const [fpHash, captchaToken] = await Promise.all([fingerprintHash(), acquireCaptchaToken()])
  const { data: session } = await supabase.auth.getSession()
  const userToken = session?.session?.access_token
  if (!userToken) throw new Error('err.signin')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  let response
  try {
    response = await fetch(`${SPIN_GATE_URL}/spin`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_token: token, request_id: requestId, expected_user_id: userId,
        fp_hash: fpHash, turnstile_token: captchaToken, user_token: userToken,
      }),
    })
  } catch {
    throw new Error('err.spinGate')
  } finally { clearTimeout(timeout) }
  let data = null
  try { data = await response.json() } catch { throw new Error('err.spinGate') }
  if (!response.ok) {
    // Cổng từ chối: { error: 'err.xxx' }. PostgREST chuyển tiếp: { message: 'err.xxx' }.
    const key = data?.error
      || (typeof data?.message === 'string' && data.message.startsWith('err.') ? data.message : '')
    throw new Error(key || 'err.spinGate')
  }
  return validateSpinResult(data, userId, requestId)
}

export async function performDailySpin(requestId, userId) {
  if (hasSupabase && SPIN_GATE_URL) return performSpinViaGate(requestId, userId)
  const token = await spinDevice()
  if (!hasSupabase) {
    return withSpinLock('ccl.spin.demo', () => {
      const current = rd(LS.user, null)
      if (!current) throw new Error('err.signin')
      if (current.id !== userId) throw new Error('err.spinAccountChanged')
      const entries = rd(LS.spins, [])
      const { entry, replayed } = drawDemoSpin({
        entries, deviceToken: token, userId, requestId,
      })
      const prof = demoProfile()
      if (!replayed) {
        entries.push(entry)
        // Thuong tu vong quay vao bonus (nhu database that: bonus reset cuoi
        // thang 10, vote da mua thi khong).
        prof.bonus_credits += entry.reward
        // Demo only: local storage is not a secure/transactional database.
        localStorage.setItem(LS.spins, JSON.stringify(entries))
        localStorage.setItem(LS.prof, JSON.stringify(prof))
      }
      const { request_id, reward, segment, created_at, day } = entry
      return {
        spin: { request_id, reward, segment, created_at, day }, replayed,
        status: demoSpinStatus({ entries, deviceToken: token, userId,
          purchased: prof.vote_credits || 0, bonus: prof.bonus_credits || 0 }),
      }
    })
  }
  // Never send reward, segment, remaining spins, date or a credit balance.
  // Send the browser fingerprint hash even when the Edge gate is NOT deployed:
  // Postgres now enforces the per-fingerprint quota itself, so a direct RPC call
  // is blocked exactly like one routed through the gate. If fingerprinting is
  // unavailable (privacy browser, blocked storage) the spin stays allowed but is
  // not tracked — same behaviour as before the quota existed.
  let fpHash = null
  try { fpHash = await fingerprintHash() } catch { /* spin proceeds, untracked */ }
  const { data, error } = await spinRpc('spin_daily', {
    p_device_token: token, p_request_id: requestId, p_expected_user_id: userId,
    p_fp_hash: fpHash,
  })
  if (error) throw spinSetupError(error)
  return validateSpinResult(data, userId, requestId)
}

export async function fetchRanking() {
  if (!hasSupabase) {
    const m = {}
    for (const r of demoRows()) {
      if (r.status === 'denied') continue
      const k = `${r.user_id}::${r.requester}`
      m[k] ??= { user_id: r.user_id, key: k, name: r.requester, avatar_url: null, total: 0, completed: 0, total_votes: 0 }
      m[k].total++
      if (r.status === 'completed') m[k].completed++
      m[k].total_votes += r.votes
    }
    return Object.values(m)
  }
  const { data, error } = await supabase.from('requester_ranking').select('*')
  if (!error) {
    cacheWrite(CACHE.ranking, data)
    return data
  }
  const cached = cacheRead(CACHE.ranking)
  if (Array.isArray(cached)) return cached
  throw error
}

/* ======================== KÊNH (media) ======================== */
/* Doc cong khai. Hang an (is_hidden) bi RLS loc o phia database,
   o che do demo thi loc o day cho giong nhau. */
export async function fetchMedia() {
  /* chế độ demo phải xếp thứ tự giống câu lệnh order() bên Supabase,
     không thì nút lên/xuống trong bảng Admin nhìn như không ăn */
  if (!hasSupabase) {
    return demoMedia().slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(b.created_at) - new Date(a.created_at))
  }
  const { data, error } = await supabase.from('media').select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
  if (!error) {
    cacheWrite(CACHE.media, data)
    return data
  }
  /* `media` was added after the original schema.  Until the additive
     migration is run, PGRST205 here must not block requests, votes, or the
     already existing board. */
  if (error.code === 'PGRST205') return cacheRead(CACHE.media, []) || []
  const cached = cacheRead(CACHE.media)
  if (Array.isArray(cached)) return cached
  throw error
}

export async function fetchOrders(user) {
  if (!hasSupabase) return readData(LS.orders, [])
  let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200)
  if (!user.isAdmin) q = q.eq('user_id', user.id)
  const { data, error } = await q
  if (error) throw error
  return data
}

/* Lỗi có mã để lớp giao diện tự dịch sang ngôn ngữ đang chọn */
export const appError = (code, vars) => Object.assign(new Error(code), { code, vars })

/* PostgREST reports a missing RPC/table as a technical code.  Keep that
   detail out of the form and point the owner to the non-destructive schema
   migration instead. */
const setupError = (error) => isMissingSchemaObject(error)
  ? appError('err.databaseSetup')
  : error

/* Các hàm SQL raise thẳng key i18n ('err.rateLimit', 'err.notEnoughVotes'…) và
   gửi con số đi kèm qua DETAIL của lỗi Postgres, vì RAISE không nhét được
   biến vào giữa key. Ở đây ghép hai thứ lại thành appError(key, { n }) để lớp
   giao diện dịch ra câu hoàn chỉnh thay vì in một câu tiếng Anh cứng từ SQL. */
const rpcError = (error) => {
  const msg = typeof error?.message === 'string' ? error.message : ''
  if (!msg.startsWith('err.')) return setupError(error)
  const n = Number(error?.details)
  return appError(msg, Number.isFinite(n) ? { n } : undefined)
}

/* Cùng việc đó cho phản hồi lỗi đi qua cổng Edge: cổng trả { error: 'err.x' },
   PostgREST chuyển tiếp thì là { message: 'err.x', details: '3' }. */
const gateError = (payload, fallback) => {
  const key = payload?.error
    || (typeof payload?.message === 'string' && payload.message.startsWith('err.') ? payload.message : '')
  const n = Number(payload?.details)
  return appError(key || fallback, Number.isFinite(n) ? { n } : undefined)
}

/* ======================== WRITE ======================== */
export async function addRequest(form, user, paid = false) {
  if (!hasSupabase) {
    const rows = demoRows()
    if (!paid) {
      const recent = rows.filter(r => r.user_id === user.id && !r.is_paid
        && Date.now() - new Date(r.created_at) < 36e5)
      if (recent.length >= MAX_REQUESTS_PER_HOUR)
        throw appError('err.rateLimit', { n: MAX_REQUESTS_PER_HOUR })
    } else {
      // Paid request trước đây không bị chặn gì: một script tạo được vô hạn
      // request pending + đơn hàng. Giới hạn giống hàm create_request.
      const waiting = readData(LS.orders, []).filter(o =>
        o.user_id === user.id && o.kind === 'paid_request' && o.status === 'awaiting')
      if (waiting.length >= MAX_PAID_AWAITING)
        throw appError('err.paidPending', { n: MAX_PAID_AWAITING })
    }
    const row = {
      id: crypto.randomUUID(), user_id: user.id, kind: form.kind,
      artist: form.artist.trim(), title: form.title.trim(), link: form.link, note: form.note,
      requester: user.name, status: 'pending', progress: 0, votes: 0,
      is_paid: paid, payment_status: paid ? 'awaiting' : 'none',
      video_url: null, deny_reason: null, created_at: new Date().toISOString(),
    }
    wr(LS.rows, [row, ...rows])
    if (paid) {
      wr(LS.orders, [{
        id: crypto.randomUUID(), user_id: user.id, kind: 'paid_request', qty: 0,
        amount_usd: PAID_REQUEST.usd, amount_vnd: PAID_REQUEST.vnd,
        request_id: row.id, status: 'awaiting', created_at: new Date().toISOString(),
        requester_name: user.name,
      }, ...readData(LS.orders, [])])
    }
    return row
  }
  const { data, error } = await supabase.rpc('create_request', {
    p_kind: form.kind, p_artist: form.artist, p_title: form.title,
    p_link: form.link, p_note: form.note, p_paid: paid,
  })
  if (error) throw rpcError(error)
  return data
}

/* delta = +1 them mot vote, -1 rut lai mot vote.
   Khong gioi han so lan vote cho cung mot request.

   Ba lớp chống gian lận, xếp từ ngoài vào (xem migrations/20261103):
     · Cổng Edge (VITE_VOTE_GATE_URL): Turnstile + KV + cổng tự lấy IP từ kết nối.
     · fp_hash: một VÂN TAY chỉ có 3 vote miễn phí/ngày dù đổi bao nhiêu acc.
     · Postgres: khoá hàng profiles + unique index giữ hạn mức, không phải logic. */
async function castVoteViaGate(id, delta) {
  const [fpHash, captchaToken] = await Promise.all([
    fingerprintHash().catch(() => null),
    acquireCaptchaToken(),
  ])
  const { data: session } = await supabase.auth.getSession()
  const userToken = session?.session?.access_token
  if (!userToken) throw appError('err.signin')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetch(`${VOTE_GATE_URL}/cast`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: id, delta, fp_hash: fpHash,
        turnstile_token: captchaToken, user_token: userToken,
      }),
    })
  } catch {
    throw appError('err.voteGate')
  } finally { clearTimeout(timeout) }

  let data = null
  try { data = await response.json() } catch { throw appError('err.voteGate') }
  if (!response.ok) throw gateError(data, 'err.voteGate')
  const r = Array.isArray(data) ? data[0] : data
  return { myVotes: r?.my_votes ?? 0 }
}

export async function castVote(id, delta = 1) {
  const n = Math.abs(Math.trunc(delta))
  if (!n || n > 100) throw appError('err.voteQty')

  if (!hasSupabase) {
    const votes = readData(LS.votes, [])
    const prof = demoProfile()
    prof.vote_credits ||= 0; prof.bonus_credits ||= 0

    /* Up next khóa vote cả hai chiều, kể cả rút lại */
    const target = demoRows().find(r => r.id === id)
    if (target?.picked_at && (target.status === 'queued' || target.status === 'in_progress'))
      throw appError('err.voteLocked')

    if (delta < 0) {
      const mine = votes.filter(v => v.id === id).length
      if (mine < n) throw appError('err.notVoted')
      let left = n
      for (let k = votes.length - 1; k >= 0 && left > 0; k--) {
        if (votes[k].id !== id) continue
        // Hoàn về ĐÚNG ví đã tiêu: bonus về bonus (vẫn reset 31/10), vote đã
        // mua về vote đã mua. Dòng cũ không ghi kind thì theo hành vi cũ.
        const kind = votes[k].kind || (votes[k].credit ? 'purchased' : 'free')
        if (kind === 'bonus') prof.bonus_credits++
        else if (kind === 'purchased') prof.vote_credits++
        votes.splice(k, 1); left--
      }
      wr(LS.prof, prof)
    } else {
      const used = votes.filter(v => !v.credit && v.day === today()).length
      const freeLeft = Math.max(0, FREE_VOTES_PER_DAY - used)
      const useFree = Math.min(n, freeLeft)
      const useCredit = n - useFree
      const totalCredits = prof.vote_credits + prof.bonus_credits
      if (useCredit > totalCredits)
        throw appError('err.notEnoughVotes', { n: freeLeft + totalCredits })
      const useBonus = Math.min(useCredit, prof.bonus_credits)
      if (useCredit > 0) {
        // Tiêu bonus trước, thiếu mới dùng vote đã mua.
        prof.bonus_credits -= useBonus
        prof.vote_credits -= useCredit - useBonus
        wr(LS.prof, prof)
      }
      for (let k = 0; k < n; k++) {
        const kind = k < useFree ? 'free' : (k < useFree + useBonus ? 'bonus' : 'purchased')
        votes.push({ id, day: today(), credit: kind !== 'free', kind })
      }
    }

    wr(LS.votes, votes)
    wr(LS.rows, demoRows().map(r => (
      r.id === id ? { ...r, votes: Math.max(0, r.votes + (delta > 0 ? n : -n)) } : r
    )))
    return { myVotes: votes.filter(v => v.id === id).length }
  }

  if (VOTE_GATE_URL) return castVoteViaGate(id, Math.trunc(delta))

  // Chưa bật cổng Edge: gọi thẳng RPC như cũ, nhưng vẫn gửi vân tay để hạn mức
  // theo vân tay trong Postgres hoạt động. Không lấy được vân tay (trình duyệt
  // riêng tư, chặn script) thì vote vẫn chạy, chỉ mất lớp đó.
  let fpHash = null
  try { fpHash = await fingerprintHash() } catch { /* vote vẫn tiếp tục */ }
  const { data, error } = await supabase.rpc('cast_vote', {
    p_request_id: id, p_delta: delta, p_fp_hash: fpHash,
  })
  if (error) throw rpcError(error)
  const r = Array.isArray(data) ? data[0] : data
  return { myVotes: r.my_votes }
}

export async function deleteRequest(id) {
  if (!hasSupabase) {
    wr(LS.rows, demoRows().filter(r => r.id !== id))
    wr(LS.votes, readData(LS.votes, []).filter(v => v.id !== id))
    return
  }
  const { error } = await supabase.rpc('delete_my_request', { p_id: id })
  if (error) throw rpcError(error)
}

export async function buyVotes(pack) {
  if (!hasSupabase) {
    const o = {
      id: crypto.randomUUID(), user_id: 'demo-user', kind: 'votes', pack: pack.id,
      qty: pack.qty, amount_usd: pack.usd, amount_vnd: pack.vnd,
      status: 'awaiting', created_at: new Date().toISOString(), requester_name: 'Demo User',
    }
    wr(LS.orders, [o, ...readData(LS.orders, [])])
    return o
  }
  const { data, error } = await supabase.rpc('buy_votes', {
    p_pack: pack.id, p_qty: pack.qty, p_usd: pack.usd, p_vnd: pack.vnd,
  })
  if (error) throw error
  return data
}

/* Nguoi dung tu huy don dat mua cua minh (chi khi con dang cho xac nhan) */
/* Doi ten hien thi + anh dai dien.
   avatar = null nghia la quay ve anh Google mac dinh. */
export async function updateProfile({ name, avatar }) {
  const clean = String(name || '').trim().slice(0, 40)
  if (clean.length < 2) throw appError('err.nameShort')

  if (!hasSupabase) {
    const prof = demoProfile()
    wr(LS.prof, { ...prof, name: clean, avatar_url: avatar ?? null })
    const u = rd(LS.user, null)
    if (u) wr(LS.user, { ...u, name: clean, avatar: avatar ?? null })
    // ten hien tren cac request cu cung phai doi theo
    wr(LS.rows, demoRows().map(r => (r.user_id === (u?.id ?? 'demo-user') ? { ...r, requester: clean } : r)))
    return
  }
  const { error } = await supabase.rpc('update_my_profile', { p_name: clean, p_avatar: avatar ?? null })
  if (error) throw error
}

export async function cancelOrder(id) {
  if (!hasSupabase) {
    const orders = readData(LS.orders, [])
    const o = orders.find(x => x.id === id)
    if (!o) throw appError('err.orderMissing')
    if (o.status !== 'awaiting') throw appError('err.orderLocked')
    wr(LS.orders, orders.filter(x => x.id !== id))
    // don paid request thi xoa luon request di kem neu van dang cho duyet
    if (o.kind === 'paid_request' && o.request_id) {
      const rows = demoRows()
      const r = rows.find(x => x.id === o.request_id)
      if (r && r.status === 'pending') wr(LS.rows, rows.filter(x => x.id !== o.request_id))
    }
    return
  }
  const { error } = await supabase.rpc('cancel_my_order', { p_id: id })
  if (error) throw error
}

/* ======================== ADMIN ======================== */
export async function adminReview(id, approve, reason = null) {
  if (!hasSupabase) {
    wr(LS.rows, demoRows().map(r => r.id === id
      ? { ...r, status: approve ? 'queued' : 'denied', deny_reason: approve ? null : reason } : r))
    return
  }
  const { error } = await supabase.rpc('admin_review', { p_id: id, p_approve: approve, p_reason: reason })
  if (error) throw error
}

/* Tien do = Layout 40% + Lyrics 40% + Edit 20% */
export const MILESTONES = [
  { k: 'done_layout', label: 'Layout', pct: 40 },
  { k: 'done_lyrics', label: 'Lyrics', pct: 40 },
  { k: 'done_edit',   label: 'Edit',   pct: 20 },
]
export const progressOf = (r) =>
  MILESTONES.reduce((n, m) => n + (r?.[m.k] ? m.pct : 0), 0)

export async function adminUpdate(id, patch) {
  if (!hasSupabase) {
    wr(LS.rows, demoRows().map(r => {
      if (r.id !== id) return r
      const next = { ...r, ...patch }
      next.progress = patch.status === 'completed' ? 100
        : (patch.progress ?? progressOf(next))
      return next
    }))
    return
  }
  /* ten bai / nghe si: trim truoc khi gui; chuoi trang gui thang de
     database tra loi 'err.needFields' chu khong am tham giu ten cu */
  const { error } = await supabase.rpc('admin_update', {
    p_id: id,
    p_status: patch.status ?? null,
    p_progress: patch.progress ?? null,
    p_video_url: patch.video_url ?? null,
    p_layout: patch.done_layout ?? null,
    p_lyrics: patch.done_lyrics ?? null,
    p_edit: patch.done_edit ?? null,
    p_artist: patch.artist == null ? null : String(patch.artist).trim(),
    p_title: patch.title == null ? null : String(patch.title).trim(),
  })
  if (error) throw error
}

/* Ghi cung mot patch cho NHIEU request (thuong la ca cum trung bai — xem
   groupIds trong src/lib/board.js). demo: MOT lan ghi localStorage de cac dong
   khong nhay loi theo tung id; live: goi lai admin_update tung cai vi trong DB
   khong co RPC nao nhan danh sach id (va minh khong them migration nao).
   Khong nguyen tu: neu loi giua chung thi vai dong da doi — App se bao lai so
   dong thuc su lien quan. */
export async function adminUpdateMany(ids = [], patch = {}) {
  const uniq = [...new Set((ids || []).filter(x => x !== undefined && x !== null))]
  if (!uniq.length) return 0
  if (!hasSupabase) {
    const set = new Set(uniq)
    wr(LS.rows, demoRows().map(r => {
      if (!set.has(r.id)) return r
      const next = { ...r, ...patch }
      next.progress = patch.status === 'completed' ? 100
        : (patch.progress ?? progressOf(next))
      return next
    }))
    return uniq.length
  }
  for (const id of uniq) await adminUpdate(id, patch)
  return uniq.length
}

export async function adminOrder(orderId, approve) {
  if (!hasSupabase) {
    const orders = readData(LS.orders, [])
    const o = orders.find(x => x.id === orderId)
    if (!o) return
    o.status = approve ? 'paid' : 'rejected'
    if (approve) {
      if (o.kind === 'votes') {
        const p = demoProfile(); p.vote_credits += o.qty; wr(LS.prof, p)
      } else if (o.request_id) {
        wr(LS.rows, demoRows().map(r => r.id === o.request_id
          ? { ...r, status: 'queued', payment_status: 'paid' } : r))
      }
    }
    wr(LS.orders, orders)
    return
  }
  const { error } = await supabase.rpc('admin_order', { p_order_id: orderId, p_approve: approve })
  if (error) throw error
}

/* Admin chốt / gỡ một request khỏi Up next (đặt hoặc xóa picked_at).
   Hàng đã chốt thì cast_vote ở database từ chối, không lách được. */
export async function adminPick(id, picked = true) {
  const at = picked ? new Date().toISOString() : null
  if (!hasSupabase) {
    wr(LS.rows, demoRows().map(r => (r.id === id ? { ...r, picked_at: at } : r)))
    return
  }
  const { error } = await supabase.rpc('admin_pick', { p_id: id, p_picked: !!picked })
  if (error) throw error
}

/* Chốt / gỡ cả cụm trung bài (cùng artist + title) lên Up next. Backend dùng
   admin_pick_group để gom đúng khoá groupKey bên web (src/lib/board.js). */
export async function adminPickGroup(id, picked = true) {
  const at = picked ? new Date().toISOString() : null
  if (!hasSupabase) {
    const rows = demoRows()
    const target = rows.find(r => r.id === id)
    const key = target ? groupKey(target) : null
    if (key) {
      wr(LS.rows, rows.map(r =>
        (groupKey(r) === key && ['queued', 'in_progress'].includes(r.status))
          ? { ...r, picked_at: at } : r))
    }
    return
  }
  const { error } = await supabase.rpc('admin_pick_group', { p_id: id, p_picked: !!picked })
  if (error) throw error
}

/* ======================== ADMIN — VIDEO NỔI BẬT (media) ======================== */
/* Thêm mới khi item không có id, sửa khi có. Link phải là link MỘT video
   YouTube (không nhận playlist) — kiểm tra ở cả đây lẫn trong hàm
   admin_media_save của database. */
export async function saveMedia(item = {}) {
  const title = String(item.title || '').trim().slice(0, 120)
  const url = String(item.url || '').trim().slice(0, 300)
  const note = String(item.note || '').trim().slice(0, 200)
  const thumb = String(item.thumb || '').trim().slice(0, 300) || null
  const kind = MEDIA_KINDS.includes(item.kind) ? item.kind : 'featured'

  if (title.length < 2) throw appError('err.mediaTitle')
  if (!parseYoutube(url)?.id) throw appError('err.mediaUrl')

  if (!hasSupabase) {
    const rows = demoMedia()
    const now = new Date().toISOString()
    if (item.id) {
      const i = rows.findIndex(r => r.id === item.id)
      if (i < 0) throw appError('err.mediaMissing')
      rows[i] = {
        ...rows[i], kind, title, note, url, thumb,
        is_hidden: item.is_hidden ?? rows[i].is_hidden, updated_at: now,
      }
      wr(LS.media, rows)
      return rows[i]
    }
    const row = {
      id: crypto.randomUUID(), kind, title, note, url, thumb,
      is_hidden: !!item.is_hidden,
      position: rows.reduce((n, r) => Math.max(n, r.position ?? 0), -1) + 1,
      created_at: now, updated_at: now,
    }
    wr(LS.media, [row, ...rows])
    return row
  }

  const { data, error } = await supabase.rpc('admin_media_save', {
    p_id: item.id || null, p_kind: kind, p_title: title, p_note: note,
    p_url: url, p_thumb: thumb, p_hidden: item.is_hidden ?? null,
  })
  if (error) throw setupError(error)
  return data
}

export async function deleteMedia(id) {
  if (!hasSupabase) {
    wr(LS.media, demoMedia().filter(m => m.id !== id))
    return
  }
  const { error } = await supabase.rpc('admin_media_delete', { p_id: id })
  if (error) throw error
}

/* ids = danh sách id theo thứ tự muốn hiện; các mục không có trong danh
   sách vẫn giữ nguyên thứ tự cũ của chúng. */
export async function reorderMedia(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return
  if (!hasSupabase) {
    const order = new Map(ids.map((id, i) => [id, i]))
    wr(LS.media, demoMedia().map(r => (order.has(r.id) ? { ...r, position: order.get(r.id) } : r)))
    return
  }
  const { error } = await supabase.rpc('admin_media_reorder', { p_ids: ids })
  if (error) throw error
}

/* Xoa nhieu muc media mot luot (nut "Xoa het" dai video). */
export async function deleteMediaMany(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
  if (!list.length) return 0
  if (!hasSupabase) {
    const gone = new Set(list)
    wr(LS.media, demoMedia().filter(m => !gone.has(m.id)))
    return list.length
  }
  const CHUNK = 8
  for (let i = 0; i < list.length; i += CHUNK) {
    const results = await Promise.allSettled(
      list.slice(i, i + CHUNK).map(id =>
        supabase.rpc('admin_media_delete', { p_id: id }).then(({ error }) => { if (error) throw error })
      )
    )
    const failed = results.find(r => r.status === 'rejected')
    if (failed) throw failed.reason
  }
  return list.length
}
