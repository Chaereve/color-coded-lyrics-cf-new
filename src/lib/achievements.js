/* Achievement index — một danh mục minh bạch, không phải một hệ điểm ẩn.
   ---------------------------------------------------------------
   Mỗi achievement nói rõ nguồn của nó (streak / completed request / rank) và
   phần thưởng chỉ là huy hiệu hoặc danh hiệu hiển thị. Không cộng vote ảo,
   không tự đặt trọng số, không biến thứ hạng thành một con số "điểm" mới.
*/

export const ACHIEVEMENTS = [
  { id: 'streak7', source: 'streak', title: 'ach.streak7', desc: 'ach.streak7Desc', reward: 'ach.streak7Reward', need: 7 },
  { id: 'streak30', source: 'streak', title: 'ach.streak30', desc: 'ach.streak30Desc', reward: 'ach.streak30Reward', need: 30 },
  { id: 'streak60', source: 'streak', title: 'ach.streak60', desc: 'ach.streak60Desc', reward: 'ach.streak60Reward', need: 60 },
  { id: 'streak100', source: 'streak', title: 'ach.streak100', desc: 'ach.streak100Desc', reward: 'ach.streak100Reward', need: 100 },
  { id: 'firstRequest', source: 'requests', title: 'ach.firstRequest', desc: 'ach.firstRequestDesc', reward: 'ach.firstRequestReward', need: 1 },
  { id: 'request5', source: 'requests', title: 'ach.request5', desc: 'ach.request5Desc', reward: 'ach.request5Reward', need: 5 },
  { id: 'firstCompletion', source: 'completed', title: 'ach.firstCompletion', desc: 'ach.firstCompletionDesc', reward: 'ach.firstCompletionReward', need: 1 },
  { id: 'completion5', source: 'completed', title: 'ach.completion5', desc: 'ach.completion5Desc', reward: 'ach.completion5Reward', need: 5 },
  { id: 'top10', source: 'leaderboard', title: 'ach.top10', desc: 'ach.top10Desc', reward: 'ach.top10Reward', need: 10 },
  { id: 'podium', source: 'leaderboard', title: 'ach.podium', desc: 'ach.podiumDesc', reward: 'ach.podiumReward', need: 3 },
  { id: 'votesCast10', source: 'votes', title: 'ach.votesCast10', desc: 'ach.votesCast10Desc', reward: 'ach.votesCast10Reward', need: 10 },
  { id: 'comment1', source: 'community', title: 'ach.comment1', desc: 'ach.comment1Desc', reward: 'ach.comment1Reward', need: 1 },
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
  const votes = Math.max(0, Number(metrics.votesCast) || Number(metrics.totalVotes) || 0)
  const community = Math.max(0, Number(metrics.comments) || 0)
  return ACHIEVEMENTS.map(a => {
    const value = a.source === 'streak' ? m.streak
      : a.source === 'requests' ? m.requests
        : a.source === 'completed' ? m.completed
          : a.source === 'votes' ? votes
            : a.source === 'community' ? community
              : (m.rank && m.rank <= a.need ? a.need : 0)
    const earned = a.source === 'leaderboard' ? !!m.rank && m.rank <= a.need : value >= a.need
    return { ...a, value, earned, progress: a.source === 'leaderboard' ? (earned ? a.need : 0) : Math.min(value, a.need) }
  })
}
