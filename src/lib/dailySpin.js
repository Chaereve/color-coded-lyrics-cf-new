/* Shared presentation / DEMO rules. Production draws, dates and quotas come
   exclusively from Supabase; none of these helpers authorizes a real reward. */
export const DAILY_SPIN_LIMIT = 2

/* Sixteen EQUAL sectors, clockwise from twelve o'clock. Equal sectors matter:
   the server draws one sector uniformly, so the slice a player sees IS the real
   chance — no thin slice secretly paying like a fat one.
     +1 vote  x9 = 56.25%   |  +2 votes x4 = 25%
     +3 votes x2 = 12.5%    |  +5 votes x1 = 6.25%  (jackpot, at six o'clock)
   Average 1.75 votes per spin, 3.5 per day, most 10 per day. Every spin wins.
   The count must stay a divisor of 256 so one random byte needs no rejection
   sampling (both SQL and the tests check this).

   MỘT LUẬT CHỒNG LÊN, KHÔNG ĐỔI BẢNG THƯỞNG: cùng một số thưởng không được ra
   quá 2 lần liên tiếp trên cùng một thiết bị (chủ dự án chốt 19/09 — 9/16 ô là
   "+1", nên ba lượt liền ra +1 là chuyện thường về xác suất nhưng đọc ra thành
   "vòng quay gian"). Luật nằm ở `drawSegment` dưới đây và ở `spin_daily` trong
   `supabase/migrations/20261104_spin_streak.sql` — hai bên phải luôn khớp. */
export const SPIN_REWARDS = Object.freeze([1, 2, 1, 3, 1, 1, 2, 1, 5, 1, 2, 1, 3, 1, 2, 1])
export const SPIN_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DAY = 86_400_000
const VN_OFFSET = 7 * 3_600_000
const TIERS = ['t1', 't2', 't3', 't4']
const SHADES = ['v1', 'v2', 'v3']

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

/* Chọn ô để kim dừng. Không chặn gì thì rút đều trên 16 ô như cũ; đang bị chặn
   thì hẹp tập ô lại rồi rút đều TRONG TẬP ĐÓ — chứ không rút rồi rút lại, vì
   cách đó vừa lệch xác suất vừa có thể lặp vô hạn. */
export function drawSegment({ rewards = SPIN_REWARDS, recent = [], random = Math.random } = {}) {
  const blocked = streakBlocked(recent)
  const allowed = blocked == null ? null : rewards.map((r, i) => (r === blocked ? -1 : i)).filter(i => i >= 0)
  const pool = allowed && allowed.length ? allowed : rewards.map((_, i) => i)
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

export function rewardOdds(rewards = SPIN_REWARDS) {
  const counts = new Map()
  for (const reward of rewards) counts.set(reward, (counts.get(reward) || 0) + 1)
  return [...counts].sort(([a], [b]) => a - b)
    .map(([reward, count]) => ({
      reward, count, chance: count * 100 / rewards.length, tier: spinTier(reward, rewards),
    }))
}

/* Brighter slice = rarer, bigger prize. Derived from the reward list itself, so
   retuning the odds restyles the wheel and the odds table together. */
export function spinTier(reward, rewards = SPIN_REWARDS) {
  const values = [...new Set(rewards)].sort((a, b) => a - b)
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, values.indexOf(reward)))]
}

/* Sắc độ trong cùng một hạng: các ô cùng giá trị không tô y hệt nhau, mà xoay
   vòng qua 3 sắc độ để 16 ô trông đa dạng mà vẫn đọc được "cùng màu = cùng
   giải". Trả về mảng 'v1'|'v2'|'v3' theo đúng thứ tự ô trên vòng quay. */
export function spinShades(rewards = SPIN_REWARDS) {
  const seen = new Map()
  return rewards.map(reward => {
    const n = seen.get(reward) || 0
    seen.set(reward, n + 1)
    return SHADES[n % SHADES.length]
  })
}

export function spinTiers(rewards = SPIN_REWARDS) {
  return Object.fromEntries([...new Set(rewards)].map(reward => [reward, spinTier(reward, rewards)]))
}

export function spinAverage(rewards = SPIN_REWARDS) {
  return rewards.reduce((total, reward) => total + reward, 0) / rewards.length
}

/* 56.25 / 25 / 12.5 / 6.25 — never 56.25000000000001 in the odds table. */
export function formatChance(chance) {
  return String(Math.round(chance * 100) / 100)
}

/* Sector zero is centred at 12 o'clock; positive angles turn clockwise.
   Always land at the CENTRE of the server's sector, not a visual boundary. */
export function spinRotation(current, segment, count = SPIN_REWARDS.length) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= count) throw new Error('err.spinResponse')
  const mod = n => ((n % 360) + 360) % 360
  return current + 5 * 360 + mod(-segment * 360 / count - mod(current))
}

/* ---- tiếng "tách" khi mép ô chạy qua kim ----------------------------------
   Đĩa quay theo cubic-bezier(.12,.72,.12,1) đúng như CSS, nên lịch phát tiếng
   phải bám vào chính đường cong đó: dồn dập lúc đầu, thưa dần khi sắp dừng.
   Hàm thuần, không đụng Web Audio, để test chạy được ngoài trình duyệt. */
const EASE = { x1: .12, y1: .72, x2: .12, y2: 1 }
const bez = (a, b, t) => { const u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t }

/** Thời điểm (giây) mỗi mép ô đi qua kim, kèm "độ mạnh" 0..1 theo tốc độ.
    Bỏ bớt tiếng cách nhau dưới `minGap` để lúc quay nhanh không thành tiếng ù. */
export function spinTicks(totalDeg, count = SPIN_REWARDS.length, durationMs = 4500,
  { minGap = 0.05, maxTicks = 140 } = {}) {
  if (!(durationMs > 0) || !(totalDeg > 0) || !(count > 0)) return []
  const crossings = totalDeg / (360 / count)
  const samples = 2000
  const ticks = []
  let next = 1, prevY = 0, prevX = 0
  for (let i = 1; i <= samples && next <= crossings; i++) {
    const t = i / samples
    const x = bez(EASE.x1, EASE.x2, t)      // phần thời gian đã trôi, 0..1
    const y = bez(EASE.y1, EASE.y2, t)      // phần góc đã quay, 0..1
    // tốc độ tức thời, chuẩn hoá theo tốc độ trung bình → dùng làm âm lượng
    const speed = (y - prevY) / Math.max(1e-9, x - prevX)
    while (next <= y * crossings && next <= crossings) {
      const at = Math.round(x * durationMs) / 1000
      if (!ticks.length || at - ticks[ticks.length - 1].at >= minGap) {
        ticks.push({ at, gain: Math.min(1, Math.max(.3, 1 / (1 + speed * .5))) })
      }
      next++
    }
    prevY = y; prevX = x
  }
  return ticks.length > maxTicks ? ticks.slice(ticks.length - maxTicks) : ticks
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
  const total = Number.isInteger(credits)
    ? credits
    : (purchased || 0) + (bonus || 0)
  return {
    user_id: userId, day, server_now: new Date(now).toISOString(), reset_at: nextSpinReset(now),
    limit: DAILY_SPIN_LIMIT, device_used: deviceUsed, account_used: mine.length,
    remaining: Math.max(0, DAILY_SPIN_LIMIT - Math.max(deviceUsed, mine.length)),
    credits: total, purchased: purchased || 0, bonus: bonus || 0,
    rewards: [...SPIN_REWARDS],
    history: mine.map(({ request_id, reward, segment, created_at, day }) =>
      ({ request_id, reward, segment, created_at, day })).reverse(),
  }
}

export function drawDemoSpin({ entries, deviceToken, userId, requestId, now = Date.now(), random = Math.random }) {
  if (!userId) throw new Error('err.signin')
  if (!requestId) throw new Error('err.spinRequest')
  const previous = entries.find(s => s.user_id === userId && s.request_id === requestId)
  if (previous) {
    if (previous.device_token !== deviceToken) throw new Error('err.spinRequest')
    return { entry: previous, replayed: true }
  }
  const status = demoSpinStatus({ entries, deviceToken, userId, credits: 0, now })
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
