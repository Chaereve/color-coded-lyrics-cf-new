import { hasSupabase, supabase } from './supabaseClient.js'
import { spinDay, nextSpinReset } from './dailySpin.js'
import { isCalendarMonth, monthLength } from './checkInCalendar.js'
import { SPIN_GATE_URL } from './spinShield.js'
import { gateShouldFallback } from './gateFallback.js'

/* =========================================================
   MYSTERY BOX — thuần logic + I/O mỏng (20261129)
   ---------------------------------------------------------
   Một hộp mỗi ngày, mở SAU khi điểm danh cùng ngày Việt Nam.
   Bảng Prize (đồng bộ 1:1 với migration 20261204 — nguồn sự thật là DB):
     result 0  nothing                    70%
     result 1  +1 vote                    16%
     result 2  +3 votes                    8%
     result 3  +5 votes                    4%
     result 4  +10 votes                 1.5%
     result 5  +1 free paid request      0.4%  (ngoài cap — không phải vote)
     result 6  +2 free paid requests     0.1%
   Phần thưởng vote đi qua cap 30 vote thưởng/ngày giống login/spin.
   Production luôn đọc số thật từ RPC `my_mystery_status` /
   `open_mystery_box` — bảng này chỉ phục vụ demo mode và UI hiển thị.
   ========================================================= */

/* BẢNG GIẢI v3 — siết tỉ lệ, 7 outcome, tổng 1000:
   70 nothing · 16 +1 vote · 8 +3 votes · 4 +5 votes · 1.5 +10 votes ·
   0.4 +1 free paid request · 0.1 +2 free paid requests.
   DUY NHẤT một outcome +5 votes; hai mức paid tách số lượng.
   `requests` = số free paid request (KHÔNG cộng vote, KHÔNG vào cap 30). */
export const MYSTERY_PRIZES = Object.freeze([
  { result: 0, kind: 'nothing', votes: 0, requests: 0, weight: 700 },
  { result: 1, kind: 'votes', votes: 1, requests: 0, weight: 160 },
  { result: 2, kind: 'votes', votes: 3, requests: 0, weight: 80 },
  { result: 3, kind: 'votes', votes: 5, requests: 0, weight: 40 },
  { result: 4, kind: 'votes', votes: 10, requests: 0, weight: 15 },
  { result: 5, kind: 'free_paid_request', votes: 0, requests: 1, weight: 4 },
  { result: 6, kind: 'free_paid_request', votes: 0, requests: 2, weight: 1 },
])

/* Tổng trọng số phải đúng 1000 — bảng giải là hợp đồng, sai là lỗi dữ liệu. */
if (MYSTERY_PRIZES.reduce((sum, p) => sum + p.weight, 0) !== 1000) {
  throw new Error('mystery prize weights must sum to 1000')
}

/* Row v1 (trước migration 20261202): 2% là 'paid_request' (+1), 1% là +5
   votes. Người đọc chấp nhận CẢ hai chính tảkind để row cũ không vỡ. */
/* ---- Case reel (mystery-only) — hằng số hình học/hợp đồng thời gian ----
   Sống ở lib (không phải file .jsx) để cả component lẫn test nạp bằng node
   trần dùng chung một nguồn; file .jsx chỉ xuất component (fast-refresh). */
export const REEL_ITEM_WIDTH = 96
export const REEL_GAP = 10
export const REEL_STEP = REEL_ITEM_WIDTH + REEL_GAP
export const REEL_SETTLE_MS = 180          // reduced-motion / replay slide
/* Ô ĐÍCH trên dải trang trí — vị trí cố định, cha ghi đè nội dung ô này bằng
   kết quả server. Dải cần ≥ 22 ô để lúc dừng, nửa trái viewport không trống. */
/* Vòng 5 (bản mẫu): dải 44 ô, ô đích ở giữa sâu (34) để nửa trái viewport
   luôn kín ô khi dừng — reel TRỒI LÊN nằm phía trên hộp quà. */
export const REEL_TARGET_INDEX = 34
export const REEL_ITEM_COUNT = 44

export const MYSTERY_KINDS = Object.freeze(['nothing', 'votes', 'paid_request', 'free_paid_request'])
const LEGACY_PRIZES = Object.freeze({
  5: { kind: 'paid_request', votes: 0 },
  6: { kind: 'votes', votes: 5 },
})

/* Số free paid request của một row ĐÃ MỞ: v2 đọc từ bảng; row v1 (kind
   'paid_request') luôn là +1. Row votes/nothing → 0. */
export const mysteryRequests = prize => {
  if (!prize) return 0
  if (prize.kind === 'paid_request') return 1
  return prize.requests || 0
}
export const MYSTERY_SYNC_KEY = 'ccl.mystery.changed.v1'
const DEMO_KEY = userId => `ccl.mystery.demo.v1.${userId}`
const HISTORY_KEY = userId => `ccl.mystery.history.v1.${userId}`
const RPC_SETUP_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703'])

/* Hợp đồng payload: 8 khoá = RPC 20261129 (prod CHƯA migrate 20261202);
   9 khoá = sau migration (thêm reward_amount theo master prompt). validate
   chấp nhận CẢ hai để card không biến mất khi deploy client trước migration. */
const STATUS_KEYS = Object.freeze(['user_id', 'day', 'enabled', 'checked_in', 'opened',
  'result', 'reward_votes', 'reward_kind'])
const STATUS_KEYS_V2 = Object.freeze([...STATUS_KEYS, 'reward_amount'])

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const natural = value => Number.isInteger(value) && value >= 0

/* Validate: hợp đồng key chính xác — thừa key cũng là lỗi (payload lạ phải
   dừng lại thay vì bị hiểu sai). Null = migration chưa chạy / lỗi RPC: card
   tự ẩn, trang lịch không chết. */
export function validateMysteryStatus(status, expectedUserId) {
  const v2 = exactKeys(status, STATUS_KEYS_V2)
  if (!v2 && !exactKeys(status, STATUS_KEYS)) throw new Error('err.mysteryResponse')
  if (status.user_id !== expectedUserId) throw new Error('err.mysteryAccount')
  if (!isDay(status.day) || typeof status.enabled !== 'boolean'
    || typeof status.checked_in !== 'boolean' || typeof status.opened !== 'boolean'
    || !natural(status.reward_votes)
    || (v2 && (!natural(status.reward_amount)
      || (status.opened ? false : status.reward_amount !== 0)))
    || (status.opened ? !(Number.isInteger(status.result)
        && status.result >= 0 && status.result <= 6
        && MYSTERY_KINDS.includes(status.reward_kind))
      : !(status.result === null && status.reward_votes === 0 && status.reward_kind === null))) {
    throw new Error('err.mysteryResponse')
  }
  const prize = MYSTERY_PRIZES[status.result]
  const legacy = LEGACY_PRIZES[status.result]
  /* Paid/nothing KHÔNG được mang vote (reward_votes phải 0) — kẻo một payload
     lạ biến giải paid thành "paid + vote" mà không ai để ý. Payload v2: kiểm
     thêm reward_amount ĐÚNG NGHIÊM (votes = số vote đã trả; FPR = 1|2 theo
     result; nothing = 0) — dữ liệu khoe sai số lượng là dừng, không render. */
  const matches = table => table && table.kind === status.reward_kind
    && (status.reward_kind !== 'votes' || status.reward_votes <= table.votes)
    && (status.reward_kind === 'votes' || Number(status.reward_votes) === 0)
  const amountMatches = !v2 || (status.reward_kind === 'votes'
    ? status.reward_amount === status.reward_votes
    : status.reward_kind === 'nothing' ? status.reward_amount === 0
    : status.reward_amount === (status.result === 6 ? 2 : 1))
  if (status.opened && ((!matches(prize) && !matches(legacy)) || !amountMatches)) {
    throw new Error('err.mysteryResponse')
  }
  return status
}

/* ---------------- demo mode (preview only) ---------------- */

const readDemo = userId => {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_KEY(userId)) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      day: isDay(parsed.day) ? parsed.day : null,
      result: Number.isInteger(parsed.result) && parsed.result >= 0 && parsed.result <= 6 ? parsed.result : null,
      votes: natural(parsed.votes) ? parsed.votes : 0,
    }
  } catch { return null }
}

const writeDemo = (userId, state) => {
  try { localStorage.setItem(DEMO_KEY(userId), JSON.stringify(state)) } catch { /* demo only */ }
}

/* Roll deterministic theo (userId, day) — preview ổn định qua mỗi lần render;
   hash phân bổ đều nên trọng số vẫn đúng. */
export function demoRoll(userId, day) {
  const text = `${userId}|${day}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000)
}

export function demoResultFor(userId, day) {
  const roll = demoRoll(userId, day)
  let acc = 0
  for (const prize of MYSTERY_PRIZES) {
    acc += prize.weight
    if (roll < acc) return prize
  }
  return MYSTERY_PRIZES[0]
}

function makeDemoStatus(userId, now = Date.now()) {
  const day = spinDay(now)
  const saved = readDemo(userId)
  const opened = !!saved && saved.day === day && saved.result !== null
  const prize = opened ? MYSTERY_PRIZES[saved.result] : null
  return {
    user_id: userId,
    day,
    enabled: true,
    checked_in: false, // caller ghi đè bằng trạng thái lịch thật
    opened,
    result: opened ? saved.result : null,
    reward_votes: opened ? saved.votes : 0,
    reward_amount: opened ? (prize.kind === 'votes' ? prize.votes : prize.requests) : 0,
    reward_kind: opened ? prize.kind : null,
  }
}

/* ---------------- I/O ---------------- */

async function assertCurrentAccount(expectedUserId) {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data?.user || data.user.id !== expectedUserId) throw new Error('err.mysteryAccount')
}

async function mysteryRpc(name, args) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await supabase.rpc(name, args).abortSignal(controller.signal)
    if (controller.signal.aborted) throw new Error('err.mysteryGate')
    if (response.error) {
      if (RPC_SETUP_CODES.has(response.error.code)) throw new Error('err.mysterySetup')
      throw response.error
    }
    return response.data
  } finally { clearTimeout(timeout) }
}

/* NULL = không mở được trạng thái (RPC chưa có, flag tắt, lỗi mạng) — card
   tự ẩn, giống cách thẻ thưởng tự ẩn của B1. */
export async function fetchMysteryStatus(userId) {
  if (!userId) return null
  if (!hasSupabase) return makeDemoStatus(userId)
  try {
    await assertCurrentAccount(userId)
    const payload = await mysteryRpc('my_mystery_status')
    const status = payload ? validateMysteryStatus(payload, userId) : null
    if (status?.opened) rememberMysteryOpen(userId, status)
    return status
  } catch {
    return null
  }
}

/* Mở hộp. Qua Edge gate khi có URL (giống Daily Spin — open là idempotent nên
   fallback khi gate sập là an toàn: DB replay kết quả cũ, không rút lại). */
export async function openMysteryBox(userId, expectedDay) {
  if (!userId) throw new Error('err.signin')
  if (!isDay(expectedDay)) throw new Error('err.dailyDayChanged')

  if (!hasSupabase) {
    const current = makeDemoStatus(userId)
    if (current.day !== expectedDay) throw new Error('err.dailyDayChanged')
    if (!current.opened) {
      const prize = demoResultFor(userId, expectedDay)
      writeDemo(userId, { day: expectedDay, result: prize.result, votes: prize.votes })
    }
    const after = makeDemoStatus(userId)
    rememberMysteryOpen(userId, after)
    return { replayed: current.opened, mystery: after }
  }

  await assertCurrentAccount(userId)
  const { data: session } = await supabase.auth.getSession()
  const userToken = session?.session?.access_token
  if (!userToken) throw new Error('err.signin')

  let data = null
  if (SPIN_GATE_URL) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    let response
    try {
      response = await fetch(`${SPIN_GATE_URL}/mystery/open`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expected_day: expectedDay, user_token: userToken }),
      })
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error('err.mysteryGate')
      throw Object.assign(new Error('err.mysteryGate'), { gateDown: true })
    } finally { clearTimeout(timeout) }
    const contentType = response.headers.get('content-type') || ''
    try { data = await response.json() } catch { data = null }
    if (gateShouldFallback({ status: response.status, contentType, payload: data })) {
      data = await mysteryRpc('open_mystery_box', { p_expected_day: expectedDay })
    } else if (!response.ok) {
      const key = data?.error
        || (typeof data?.message === 'string' && data.message.startsWith('err.') ? data.message : '')
      throw new Error(key || 'err.mysteryGate')
    }
  } else {
    data = await mysteryRpc('open_mystery_box', { p_expected_day: expectedDay })
  }

  if (!data || typeof data.replayed !== 'boolean') throw new Error('err.mysteryResponse')
  data.mystery = validateMysteryStatus(data.mystery, userId)
  rememberMysteryOpen(userId, data.mystery)
  return data
}

export function announceMysteryChanged() {
  try { localStorage.setItem(MYSTERY_SYNC_KEY, String(Date.now())) } catch { /* no storage */ }
}

const monthOfDay = day => day.slice(0, 7)
const monthLabelOf = month => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`))

function normalizeOpen(row) {
  if (!row || !isDay(row.day) || !Number.isInteger(row.result) || row.result < 0 || row.result > 6) return null
  if (!MYSTERY_KINDS.includes(row.reward_kind)) return null
  return {
    day: row.day,
    result: row.result,
    reward_kind: row.reward_kind,
    reward_votes: natural(row.reward_votes) ? row.reward_votes : 0,
    reward_amount: natural(row.reward_amount) ? row.reward_amount : 0,
  }
}

function readHistory(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY(userId)) || '{}')
    if (!all || typeof all !== 'object' || Array.isArray(all)) return []
    return Object.values(all).map(normalizeOpen).filter(Boolean)
  } catch { return [] }
}

function rememberOpenRow(userId, row) {
  const open = normalizeOpen(row)
  if (!userId || !open) return
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY(userId)) || '{}')
    const next = all && typeof all === 'object' && !Array.isArray(all) ? all : {}
    next[open.day] = open
    localStorage.setItem(HISTORY_KEY(userId), JSON.stringify(next))
  } catch { /* private mode / SSR */ }
}

/* Ghi một lần mở vào lịch sử tháng trên máy này — bổ sung cho RPC tháng
   (khi migration chưa chạy, hoặc demo không có server). */
export function rememberMysteryOpen(userId, mystery) {
  if (!mystery?.opened) return
  rememberOpenRow(userId, mystery)
}

/* Lưới tháng: chỉ đánh dấu ngày CÓ dữ liệu mở. Ngày quá khứ không có
   bản ghi là `idle` (không bịa "missed") — thiếu RPC thì không được nói dối. */
export function buildMysteryMonth(today, month, opens) {
  if (!isDay(today) || !isCalendarMonth(month)) return null
  const daysInMonth = monthLength(month)
  const first = new Date(`${month}-01T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  const rows = (opens || []).filter(o => o && isDay(o.day))
  const byDay = new Map(rows.map(o => [o.day, o]))
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => {
    const number = index - offset + 1
    if (number < 1 || number > daysInMonth) return null
    const day = `${month}-${String(number).padStart(2, '0')}`
    const open = byDay.get(day) || null
    const isToday = day === today
    const state = day > today ? 'upcoming'
      : open ? (open.reward_kind === 'nothing' ? 'empty' : 'hit')
      : isToday ? 'today' : 'idle'
    return { day, number, isToday, state, open }
  })
  return {
    month,
    monthLabel: monthLabelOf(month),
    cells,
    openedCount: [...byDay.keys()].filter(day => monthOfDay(day) === month).length,
  }
}

export async function fetchMysteryMonth(userId, month) {
  if (!userId) throw new Error('err.signin')
  if (!isCalendarMonth(month)) throw new Error('err.dailyDayChanged')
  const today = spinDay()
  const local = readHistory(userId).filter(o => monthOfDay(o.day) === month && o.day <= today)
  if (!hasSupabase) {
    return { user_id: userId, month, opens: local, available: true }
  }
  try {
    await assertCurrentAccount(userId)
    const payload = await mysteryRpc('my_mystery_month', { p_month: `${month}-01` })
    if (!payload || payload.user_id !== userId || payload.month !== month || !Array.isArray(payload.opens)) {
      throw new Error('err.mysteryResponse')
    }
    const opens = payload.opens.map(normalizeOpen).filter(Boolean)
      .filter(o => o.day.startsWith(month) && o.day <= today)
    for (const open of opens) rememberOpenRow(userId, open)
    return { user_id: userId, month, opens, available: true }
  } catch (e) {
    if (e?.message === 'err.signin' || e?.message === 'err.mysteryAccount') throw e
    return { user_id: userId, month, opens: local, available: false }
  }
}

/* Helper cho UI: reset_at của ngày mystery (khớp giờ reset Việt Nam). */
export { nextSpinReset as mysteryResetAt, spinDay as mysteryDay }
