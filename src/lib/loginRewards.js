/* =========================================================
   LOGIN REWARDS — thuần logic, không I/O, không Supabase
   ---------------------------------------------------------
   Bản mirror chính sách của migration 20261126/20261127 (nguồn sự thật là DB):
     · mỗi check-in:            +2 vote
     · ngày thứ 7 của chu kỳ:   +5 vote CỘNG THÊM lên +2 (tổng 7)
     · trọn chu kỳ 7 ngày:      +10 vote (chu kỳ reset, lặp lại 7/14/21/…)
     · 30 ngày liên tiếp:       +20 vote, MỘT LẦN duy nhất
     · bỏ lỡ 1 ngày:            streak về 0, chu kỳ đếm lại
   Mọi khoản đều qua cap 30 vote thưởng/ngày (daily_reward_cap).

   Module này phục vụ HAI nơi duy nhất:
     · demo mode (không có Supabase) — mô phỏng đúng luật để preview;
     · UI chiếu "lần check-in kế trả bao nhiêu" khi chưa claim hôm nay.
   Production luôn đọc số thật từ RPC `my_login_reward_status` — con số ở đây
   không bao giờ override server.
   ========================================================= */

export const LOGIN_CYCLE_DAYS = 7
export const LOGIN_DAILY_VOTES = 2
export const LOGIN_DAY7_EXTRA = 5
export const LOGIN_MILESTONE7_BONUS = 10
export const LOGIN_MILESTONE30_BONUS = 20
export const LOGIN_REWARD_CAP = 30

export const LOGIN_REWARD_SOURCES = Object.freeze([
  'daily_login', 'login_day7', 'login_milestone7', 'login_milestone30',
  'daily_spin', 'mystery_box', 'vote_back_owner', 'vote_back_voter', 'achievement',
])

/** Ngày thứ mấy trong chu kỳ 7 ngày: streak 7 → 7, streak 8 → 1. */
export function cycleDayOf(streak) {
  const n = Math.max(0, Math.trunc(Number(streak)) || 0)
  return n === 0 ? 0 : ((n - 1) % LOGIN_CYCLE_DAYS) + 1
}

/** Tổng vote check-in của MỘT ngày khi ngày đó được claim với streak cho sẵn. */
export function checkInGrantsFor(streak) {
  const grants = []
  if (streak <= 0) return grants
  const cycle = cycleDayOf(streak)
  grants.push({ source: 'daily_login', amount: LOGIN_DAILY_VOTES })
  if (cycle === LOGIN_CYCLE_DAYS) {
    grants.push({ source: 'login_day7', amount: LOGIN_DAY7_EXTRA })
    grants.push({ source: 'login_milestone7', amount: LOGIN_MILESTONE7_BONUS })
  }
  return grants
}

/**
 * Chiếu thưởng của LẦN CHECK-IN KẾ (khi hôm nay chưa claim).
 * `milestone30Granted`: false nghĩa là mốc 30 vẫn còn chờ — nếu streak kế
 * đạt ≥ 30 (hoặc đang ≥ 30 mà chưa từng nhận đủ) thì lần claim kế có +20.
 */
export function nextCheckInGrants({ streak, milestone30Granted = false, claimedToday = false } = {}) {
  if (claimedToday) return []
  const nextStreak = (Math.max(0, Math.trunc(Number(streak)) || 0)) + 1
  const grants = checkInGrantsFor(nextStreak)
  if (nextStreak >= 30 && !milestone30Granted) {
    grants.push({ source: 'login_milestone30', amount: LOGIN_MILESTONE30_BONUS })
  }
  return grants
}

/** Áp cap lên danh sách grant: cắt phần vượt theo thứ tự khai báo. */
export function applyCap(grants, usedToday = 0, cap = LOGIN_REWARD_CAP) {
  let left = Math.max(0, cap - usedToday)
  return (grants || []).map(grant => {
    const pay = Math.min(grant.amount, left)
    left -= pay
    return { ...grant, amount: pay }
  }).filter(grant => grant.amount > 0)
}
