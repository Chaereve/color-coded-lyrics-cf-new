/* Achievement index — một danh mục minh bạch, không phải một hệ điểm ẩn.
   ---------------------------------------------------------------
   Mỗi achievement nói rõ nguồn của nó (streak / completed request / rank) và
   phần thưởng chỉ là huy hiệu hoặc danh hiệu hiển thị. Không cộng vote ảo,
   không tự đặt trọng số, không biến thứ hạng thành một con số "điểm" mới.
*/

export const ACHIEVEMENTS = [
  { id: 'streak7', source: 'streak', title: 'ach.streak7', desc: 'ach.streak7Desc', reward: 'ach.streak7Reward', need: 7 },
  { id: 'streak30', source: 'streak', title: 'ach.streak30', desc: 'ach.streak30Desc', reward: 'ach.streak30Reward', need: 30 },
  { id: 'streak100', source: 'streak', title: 'ach.streak100', desc: 'ach.streak100Desc', reward: 'ach.streak100Reward', need: 100 },
  { id: 'firstRequest', source: 'requests', title: 'ach.firstRequest', desc: 'ach.firstRequestDesc', reward: 'ach.firstRequestReward', need: 1 },
  { id: 'firstCompletion', source: 'completed', title: 'ach.firstCompletion', desc: 'ach.firstCompletionDesc', reward: 'ach.firstCompletionReward', need: 1 },
  { id: 'top10', source: 'leaderboard', title: 'ach.top10', desc: 'ach.top10Desc', reward: 'ach.top10Reward', need: 10 },
  { id: 'podium', source: 'leaderboard', title: 'ach.podium', desc: 'ach.podiumDesc', reward: 'ach.podiumReward', need: 3 },
]

export function achievementProgress(metrics = {}) {
  const streak = Math.max(0, Number(metrics.longestStreak) || 0)
  const requests = Math.max(0, Number(metrics.requests) || 0)
  const completed = Math.max(0, Number(metrics.completed) || 0)
  const rank = Number(metrics.rank)
  return { streak, requests, completed, rank: Number.isFinite(rank) ? rank : null }
}

export function evaluateAchievements(metrics = {}) {
  const m = achievementProgress(metrics)
  return ACHIEVEMENTS.map(a => {
    const value = a.source === 'streak' ? m.streak
      : a.source === 'requests' ? m.requests
        : a.source === 'completed' ? m.completed
          : (m.rank && m.rank <= a.need ? a.need : 0)
    const earned = a.source === 'leaderboard' ? !!m.rank && m.rank <= a.need : value >= a.need
    return { ...a, value, earned, progress: a.source === 'leaderboard' ? earned ? a.need : 0 : Math.min(value, a.need) }
  })
}
