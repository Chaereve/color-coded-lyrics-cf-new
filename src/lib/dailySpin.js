/* Shared presentation / DEMO rules. Production draws, dates and quotas come
   exclusively from Supabase; none of these helpers authorizes a real reward. */
export const DAILY_SPIN_LIMIT = 2

/* Seven WEIGHTED sectors, clockwise from twelve o'clock. The odds are explicit,
   not a byproduct of counting slices — and the arc a player sees is EXACTLY as
   wide as its weight (360° × weight / 100), so the slice on screen IS the real
   chance:
     +1  30%  | +2  25%  | +3  20%  | +5  12%
     +8   8%  | +10  4%  | +20  1%  (jackpot, at six o'clock)
   Average 3.24 votes per spin, 6.48 per day at two spins. Every spin wins.
   The two tables must agree (same length, weights summing to 100) — the server
   refuses to draw otherwise (err.spinSetup), and because 256 % 7 <> 0 the SQL
   side draws through rejection sampling (two bytes, see 20261201_spin_v2.sql);
   this side samples r over the weight total directly, which is the same
   distribution without any rejection.

   MỘT LUẬT CHỒNG LÊN, KHÔNG ĐỔI BẢNG THƯỞNG: cùng một số thưởng không được ra
   quá 2 lần liên tiếp trên cùng một thiết bị (chủ dự án chốt 19/09 — với giải
   nhỏ trúng liên tiếp là chuyện thường về xác suất nhưng đọc ra thành "vòng
   quay gian"). Với 7 ô, mỗi giá trị sở hữu đúng MỘT ô, nên bị chặn = loại đúng
   một dải. Luật nằm ở `drawSegment` dưới đây và ở `spin_daily` trong
   `supabase/migrations/20261201_spin_v2.sql` — hai bên phải luôn khớp. */
export const SPIN_REWARDS = Object.freeze([1, 2, 3, 5, 8, 10, 20])
export const SPIN_WEIGHTS = Object.freeze([30, 25, 20, 12, 8, 4, 1])
export const SPIN_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DAY = 86_400_000
const VN_OFFSET = 7 * 3_600_000
const TIERS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7']

/* Trọng số của một bảng thưởng: dùng bảng đã duyệt nếu khớp độ dài, ngược lại
   rơi về ĐỀU NHAU. Bản deploy cũ (hoặc một payload thiếu `weights`) phải vẽ
   được đúng hình của chính nó — mỗi ô một cung bằng nhau — chứ không mượn odds
   của bảng v2. */
const weightsOf = (rewards, weights) =>
  Array.isArray(weights) && weights.length === rewards.length ? weights : rewards.map(() => 1)

export function spinDay(now = Date.now()) {
  return new Date(+new Date(now) + VN_OFFSET).toISOString().slice(0, 10)
}

export function nextSpinReset(now = Date.now()) {
  return new Date(Math.floor((+new Date(now) + VN_OFFSET) / DAY) * DAY + DAY - VN_OFFSET).toISOString()
}

/* ---- luật "không lặp quá hai lần" -----------------------------------------
   Trả về SỐ THƯỞNG đang bị chặn, hoặc null khi được rút tự do. `recent` là các
   số thưởng gần nhất của CÙNG một thiết bị, mới nhất đứng đầu. */
export function streakBlocked(recent = []) {
  return recent.length >= 2 && recent[0] === recent[1] ? recent[0] : null
}

/* Chọn ô để kim dừng. Rút theo TRỌNG SỐ: một số r 0..tổng trọng số-1 rơi vào
   dải tích luỹ nào thì ô đó thắng. Đang bị chặn thì dải mang số bị chặn bị
   LOẠI ngay từ đầu, tổng co lại theo — phân phối còn lại đúng bằng phân phối
   cũ có điều kiện (chính xác, không rút-rồi-rút-lại). */
export function drawSegment({ rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS, recent = [], random = Math.random } = {}) {
  const w = weightsOf(rewards, weights)
  const blocked = streakBlocked(recent)
  let pool = rewards.map((reward, i) => ({ reward, i, weight: w[i] }))
  if (blocked != null) {
    const allowed = pool.filter(p => p.reward !== blocked && p.weight > 0)
    if (allowed.length) pool = allowed
  }
  const total = pool.reduce((sum, p) => sum + p.weight, 0)
  if (total <= 0) return 0
  let r = Math.floor(random() * total)
  for (const p of pool) {
    r -= p.weight
    if (r < 0) return p.i
  }
  return pool[pool.length - 1].i
}

export function rewardOdds(rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS) {
  const w = weightsOf(rewards, weights)
  const total = w.reduce((sum, x) => sum + x, 0)
  return rewards.map((reward, i) => ({
    reward, weight: w[i], chance: w[i] * 100 / total, tier: spinTier(reward, rewards),
  }))
}

/* Brighter slice = rarer, bigger prize. Derived from the reward list itself, so
   retuning the odds restyles the wheel and the odds table together. */
export function spinTier(reward, rewards = SPIN_REWARDS) {
  const values = [...new Set(rewards)].sort((a, b) => a - b)
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, values.indexOf(reward)))]
}

/* THỨ TỰ VẼ = THỨ TỰ RÚT.
   -----------------------------------------------------------
   Bảng rút là 7 ô với trọng số đã duyệt (SPIN_WEIGHTS); server rút qua các dải
   tích luỹ 30|55|75|87|95|99|100 và trả về chỉ số ô trong chính bảng này, nên
   ô vẽ thứ i chính là ô rút thứ i — không còn bước "gom ô cùng thưởng thành
   dải" của bản 16 ô. Mỗi ô là MỘT dải, độ rộng cung = trọng số, và cả vòng
   được xoay để tâm ô giải cao nhất (giá trị lớn nhất) rơi đúng 180° (6 giờ),
   đối diện con trỏ — như hai bản trước.

   Trả về { reward, weight, tier, from, span, angle } với `from`/`span` là cung
   hiển thị (độ) và `angle` là tâm ô, 0° = 12 giờ. Mỗi ô tự nó là một nhãn. */
/* Ô TRÚNG theo CHỈ SỐ BẢNG RÚT: server rút segment 0..6 và client PHẢI dùng
   đúng chỉ số đó để tra mức giải — không chọn lại, không random client.
   Sai biên (segment rác) là dữ liệu hỏng từ server (err.spinResponse). */
export function spinSectorIndex(segment, rewards = SPIN_REWARDS) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= rewards.length) {
    throw new Error('err.spinResponse')
  }
  return segment
}


/* =========================================================
   SQUARE GRID SPINNER — bản đồ 8 ô viền (spec chốt 2026-10-09)
   ---------------------------------------------------------
   KHÔNG wheel tròn, KHÔNG reel ngang cho Spin: lưới 3×3, 8 ô quanh viền chạy
   vệt sáng theo CHIỀU KIM ĐỒNG HỒ, ô giữa là nút QUAY. Bảy giải thật + MỘT ô
   accent (điểm nhấn thị giác — KHÔNG thuộc bảng rút, KHÔNG bao giờ là ô
   dừng). `reward: null` = accent.
   ========================================================= */
export const SPIN_GRID_CELLS = [
  { index: 0, reward: 1 },                       // top-left
  { index: 1, reward: 2 },                       // top-middle
  { index: 2, reward: 3 },                       // top-right
  { index: 3, reward: 5 },                       // middle-right
  { index: 4, reward: null, type: 'accent' },    // bottom-right — không phải giải
  { index: 5, reward: 8 },                       // bottom-middle
  { index: 6, reward: 10 },                      // bottom-left
  { index: 7, reward: 20 },                      // middle-left
]

/* Thứ tự RENDER theo dòng của CSS grid — 9 slot row-major, sentinel `null`
   là ô GIỮA (nút QUAY, không phải ô giải):
   [0 1 2 / 7 NÚT 3 / 6 5 4] để index spec khớp vị trí hình học. */
export const SPIN_GRID_RENDER_ORDER = [0, 1, 2, 7, null, 3, 6, 5, 4]

/* Mức giải server trả → ô grid DUY NHẤT chứa mức đó. Accent không thể là kết
   quả (không phải giá trị giải nào); mức lạ từ server là dữ liệu hỏng. */
export function spinCellForReward(reward, rewards = SPIN_REWARDS) {
  const value = rewards[spinSectorIndex(rewards.indexOf(reward), rewards)]
  const cell = SPIN_GRID_CELLS.find(c => c.reward === value)
  if (!cell) throw new Error('err.spinResponse')
  return cell.index
}

export function spinAverage(rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS) {
  const w = weightsOf(rewards, weights)
  const total = w.reduce((sum, x) => sum + x, 0)
  return rewards.reduce((sum, reward, i) => sum + reward * w[i], 0) / total
}

/* 30 / 25 / 20 / 12 / 8 / 4 / 1 — never 33.333333333333336 in the odds list. */
export function formatChance(chance) {
  return String(Math.round(chance * 100) / 100)
}

export function spinCountdown(ms) {
  /* Nan la "NaN:NaN:NaN" in thang len man hinh (dem nguoc hong khi moc gio cua
     cua portal khong doc duoc) -> khong co moc thi dem ve 0, dung de gia do. */
  const s = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000))
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60]
    .map(n => String(n).padStart(2, '0')).join(':')
}

export function demoSpinStatus({ entries, deviceToken, userId, credits, purchased, bonus, now = Date.now() }) {
  const day = spinDay(now)
  const today = entries.filter(s => s.day === day)
  const deviceUsed = today.filter(s => s.device_token === deviceToken).length
  const mine = today.filter(s => s.user_id === userId)
  const deviceAccountBlocked = today.some(s => s.device_token === deviceToken && s.user_id !== userId)
  const total = Number.isInteger(credits)
    ? credits
    : (purchased || 0) + (bonus || 0)
  return {
    user_id: userId, day, server_now: new Date(now).toISOString(), reset_at: nextSpinReset(now),
    limit: DAILY_SPIN_LIMIT, device_used: deviceUsed, account_used: mine.length,
    device_account_blocked: deviceAccountBlocked,
    remaining: deviceAccountBlocked ? 0 : Math.max(0, DAILY_SPIN_LIMIT - Math.max(deviceUsed, mine.length)),
    credits: total, purchased: purchased || 0, bonus: bonus || 0,
    rewards: [...SPIN_REWARDS],
    weights: [...SPIN_WEIGHTS],
    history: mine.map(({ request_id, reward, segment, created_at, day }) =>
      ({ request_id, reward, segment, created_at, day })).reverse(),
  }
}

export function drawDemoSpin({ entries, deviceToken, userId, requestId, now = Date.now(), random = Math.random } = {}) {
  if (!userId) throw new Error('err.signin')
  if (!requestId) throw new Error('err.spinRequest')
  const previous = entries.find(s => s.user_id === userId && s.request_id === requestId)
  if (previous) {
    if (previous.device_token !== deviceToken) throw new Error('err.spinRequest')
    return { entry: previous, replayed: true }
  }
  const status = demoSpinStatus({ entries, deviceToken, userId, credits: 0, now })
  if (status.device_account_blocked) throw new Error('err.spinDeviceAccount')
  if (status.device_used >= DAILY_SPIN_LIMIT) throw new Error('err.spinDeviceLimit')
  if (status.account_used >= DAILY_SPIN_LIMIT) throw new Error('err.spinAccountLimit')
  /* Hai lượt gần nhất của CHÍNH thiết bị này quyết định lượt này có bị chặn
     hay không — giống hệt điều kiện trong SQL (device_hash = v_hash). */
  const recent = entries
    .filter(s => s.device_token === deviceToken)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 2)
    .map(s => s.reward)
  const segment = drawSegment({ recent, random })
  return {
    replayed: false,
    entry: {
      request_id: requestId, user_id: userId, device_token: deviceToken,
      day: status.day, created_at: new Date(now).toISOString(), segment, reward: SPIN_REWARDS[segment],
    },
  }
}

/* Reject incomplete/mismatched responses rather than guessing a win or allowing
   another click after a possibly committed transaction. Keep the retry ID. */
export function validateSpinResult(result, userId, requestId) {
  const { status, spin } = result || {}
  if (!status || !spin || status.user_id !== userId || spin.request_id !== requestId
    || !Array.isArray(status.rewards) || !Number.isInteger(spin.segment)
    || spin.segment < 0 || spin.segment >= status.rewards.length
    || spin.reward !== status.rewards[spin.segment]
    || !Number.isInteger(status.remaining) || status.remaining < 0 || status.remaining > DAILY_SPIN_LIMIT
    || !Number.isInteger(status.credits)) throw new Error('err.spinResponse')
  // Bảng trọng số (v2) luon di kem rewards; backend cu khong gui — vang mat thi
  // bo qua, con gui len thi phai dung do dai va la so nguyen khong am.
  if (status.weights != null && (!Array.isArray(status.weights)
    || status.weights.length !== status.rewards.length
    || !status.weights.every(x => Number.isInteger(x) && x >= 0))) {
    throw new Error('err.spinResponse')
  }
  // So du tach loai (vote da mua / bonus) chi co tren backend moi; backend cu
  // chi tra tong credits. Co thi phai la so nguyen khong am, khong ep tong.
  for (const k of ['purchased', 'bonus']) {
    if (status[k] != null && (!Number.isInteger(status[k]) || status[k] < 0)) {
      throw new Error('err.spinResponse')
    }
  }
  // Mốc giờ (co the vang o backend cu) ma gui len thi phai doc duoc: con so
  // NaN se chay thang vao o dem nguoc tren man hinh.
  for (const k of ['server_now', 'reset_at']) {
    if (status[k] != null && !Number.isFinite(+new Date(status[k]))) throw new Error('err.spinResponse')
  }
  return result
}
