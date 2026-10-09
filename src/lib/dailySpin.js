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
const mod360 = n => ((n % 360) + 360) % 360

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
export function spinSectors(rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS) {
  const w = weightsOf(rewards, weights)
  const total = w.reduce((sum, x) => sum + x, 0)
  const deg = u => u * 360 / total
  let acc = 0
  const starts = w.map(weight => { const s = acc; acc += weight; return s })
  /* Tâm ô giải cao nhất (dải cuối — bảng tăng dần) rơi vào 180°. */
  const shift = 180 - deg(starts[rewards.length - 1] + w[rewards.length - 1] / 2)
  return rewards.map((reward, i) => ({
    reward,
    weight: w[i],
    tier: spinTier(reward, rewards),
    from: mod360(deg(starts[i]) + shift),
    span: deg(w[i]),
    angle: mod360(deg(starts[i] + w[i] / 2) + shift),  // tâm ô, độ, 0° = 12 giờ
  }))
}

/* Ô TRÚNG theo thứ tự VẼ: server trả về chỉ số ô trong bảng rút và bản vẽ giữ
   nguyên thứ tự đó (xem spinSectors), nên đây là phép kiểm tra biên — chỉ số
   phải nằm trong bảng, sai là dữ liệu rác từ server (err.spinResponse). */
export function spinSectorIndex(segment, rewards = SPIN_REWARDS) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= rewards.length) {
    throw new Error('err.spinResponse')
  }
  return segment
}

/* ---- NHÃN TRÊN ĐĨA — vị trí TÍNH TOÁN, không tọa độ cứng -------------------
   Mỗi ô MỘT nhãn, xoay dọc theo bán kính ở tâm ô. Bán kính neo và cỡ chữ co
   theo ĐỘ RỘNG CỦA Ô (span): lát rộng nhất (+1, 108°) chứa chữ 17px thoải mái,
   lát +10 (14,4°) hạ còn 12px, còn +20 (3,6° — nhỏ hơn cả chữ) là MỘT badge
   hồng 34×18px đặt trên đúng lát nó, đẩy ra bán kính 150 — mép trong của badge
   cách mép ngoài chữ "+10" ≥ 6px nên không đè lên nhãn nào.

   Mỗi nhãn trả về `w` = bề rộng THEO PHƯƠNG TIẾP TUYẾN (px) và `h` = bề dài
   THEO BÁNH KÍNH (px) — JSX vẽ đúng khối lượng đó, test đo đúng khối lượng đó,
   nên hai bên không thể lệch nhau. An toàn hình học (test chốt):
     · radial:  [r − h/2, r + h/2] ⊂ [52, 162]  — không sát trục, không tràn vành;
     · cặp nhãn bất kỳ không chồng nhau ĐỒNG THỜI theo góc và theo bán kính
       (chồng một trong hai chiều thì chưa đủ để đè nhau). */
const LABEL_TEXT_RATIO = 0.62   // bề rộng ký tự mono ~0.62em
const LABEL_THICK_RATIO = 1.18  // bề cao dòng ~1.18em
const LABEL_MIN_R = 52
const LABEL_MAX_R = 162

export function spinLabels(rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS) {
  return spinSectors(rewards, weights).map(s => {
    const isJackpot = s.span < 8
    const size = s.span >= 30 ? 17 : s.span >= 18 ? 15 : s.span >= 16 ? 13 : 12
    const r = isJackpot ? 150 : s.span >= 20 ? 132 : 126
    const chars = String(s.reward).length + 1            // "+20" → 3 ký tự
    const w = isJackpot ? 34 : Math.ceil(size * LABEL_THICK_RATIO)
    const h = isJackpot ? 18 : Math.ceil(chars * size * LABEL_TEXT_RATIO)
    return { reward: s.reward, tier: s.tier, angle: s.angle, span: s.span, r, size, w, h }
  })
}

export { LABEL_MIN_R, LABEL_MAX_R }

export function spinTiers(rewards = SPIN_REWARDS) {
  return Object.fromEntries([...new Set(rewards)].map(reward => [reward, spinTier(reward, rewards)]))
}

/* Giá trị kỳ vọng MỖI LƯỢT theo trọng số: Σ(trọng số × thưởng) / tổng. */
export function spinAverage(rewards = SPIN_REWARDS, weights = SPIN_WEIGHTS) {
  const w = weightsOf(rewards, weights)
  const total = w.reduce((sum, x) => sum + x, 0)
  return rewards.reduce((sum, reward, i) => sum + reward * w[i], 0) / total
}

/* 30 / 25 / 20 / 12 / 8 / 4 / 1 — never 33.333333333333336 in the odds list. */
export function formatChance(chance) {
  return String(Math.round(chance * 100) / 100)
}

/* GÓC DỪNG CỦA ĐĨA — tính theo GÓC CỦA Ô TRÚNG TRÊN BẢN VẼ, không theo chỉ số.
   ------------------------------------------------------------------
   Hợp đồng (giữ từ bản 16 ô sau lỗi "quay ra ko đúng phần thưởng"): truyền vào
   GÓC TÂM của ô trúng trên bản vẽ (`sectors[spinSectorIndex(segment)].angle`),
   và đĩa quay sao cho tâm ô đó dừng ở 0° (12 giờ). Số vòng quay tối thiểu 5
   vòng giữ nguyên. */
export function spinRotation(current, angle) {
  if (!Number.isFinite(angle)) throw new Error('err.spinResponse')
  const mod = n => ((n % 360) + 360) % 360
  return current + 5 * 360 + mod(-angle - mod(current))
}

/* ĐĨA DỪNG Ở Ô NÀO? — phép kiểm ngược của `spinRotation`, dùng cho test và cho
   bất cứ ai cần biết "kim đang chỉ vào ô nào sau khi quay R độ". Các ô có cung
   KHÔNG ĐỀU nhau (trọng số 30..1), nên tìm ô chứa góc kim trong [from, from +
   span) thay vì làm tròn ra lưới đều như bản cũ. */
export function sectorAtPointer(rotation, sectors) {
  const at = mod360(-rotation)
  return sectors.find(s => mod360(at - s.from) < s.span + 1e-9) ?? null
}

/* ---- tiếng "tách" khi mép ô chạy qua kim ----------------------------------
   Đĩa quay theo cubic-bezier(.12,.72,.12,1) đúng như CSS, nên lịch phát tiếng
   phải bám vào chính đường cong đó: dồn dập lúc đầu, thưa dần khi sắp dừng.
   Hàm thuần, không đụng Web Audio, để test chạy được ngoài trình duyệt. Nhịp
   đếm theo Ô (một vòng = SPIN_REWARDS.length mép ô); các cung không đều nên
   tiếng chỉ xấp xỉ mép ô — đủ cho tai, và lịch của nó vẫn là đường cong thật. */
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

/* =========================================================
   KÉO ĐĨA BẰNG TAY — đếm vạch để tiếng tách bám đúng tay
   ---------------------------------------------------------
   Khi máy tự quay, `spinTicks` tính trước CẢ đường cong rồi xếp lịch một lần:
   biết trước đĩa đi bao nhiêu độ, trong bao lâu, nên biết trước từng mốc vạch
   đi qua kim. Kéo bằng tay thì ngược lại — mỗi lần con trỏ nhích, ta chỉ biết
   "vừa đi thêm bao nhiêu độ". Vì vậy phải hỏi TỪNG NHỊP: từ góc này sang góc
   kia thì mấy vạch đã đi qua, và tiếng đó to nhỏ ra sao.

   Hàm thuần để đếm vạch kiểm được ngoài trình duyệt (không cần Web Audio).

   `trunc` chứ không phải `floor`: kéo ngược chiều kim đồng hồ phải kêu y như
   kéo xuôi. Với `floor`, một góc âm nhỏ (-10°) bị tính thành -1 vạch ngay khi
   vừa chạm tay vào đĩa — tiếng tách kêu trước cả khi đĩa kịp nhúc nhích.

   `gain` theo TỐC ĐỘ kéo (độ/giây): kéo chậm thì tiếng nhẹ, kéo mạnh thì tiếng
   rõ. Sàn 0,45 vì tiếng tách quá nhỏ thì coi như không có; trần 1 vì trên
   ngưỡng đó tai không phân biệt thêm được gì, chỉ có nguy cơ chói. */

export const DRAG_SECTOR_DEG = 360 / 7    // một vạch ≈ một ô trên bản vẽ (360/7 ≈ 51,43°)
export const DRAG_MIN_DEG = 55            // kéo dưới ngưỡng này coi như chạm hụt
export const DRAG_TICK_GAP_MS = 45        // nhanh hơn nữa là tiếng ù, không phải nhịp

export function dragTicks(fromDeg, toDeg, { sectorDeg = DRAG_SECTOR_DEG, ms = 0 } = {}) {
  if (!(sectorDeg > 0) || !Number.isFinite(fromDeg) || !Number.isFinite(toDeg)) {
    return { count: 0, gain: .6 }
  }
  const count = Math.trunc(toDeg / sectorDeg) - Math.trunc(fromDeg / sectorDeg)
  const speed = ms > 0 ? Math.abs(toDeg - fromDeg) / (ms / 1000) : 0
  const gain = Math.min(1, Math.max(.45, .45 + speed / 900))
  return { count, gain }
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
