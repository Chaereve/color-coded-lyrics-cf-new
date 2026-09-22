/* Achievement index — một danh mục minh bạch, không phải một hệ điểm ẩn.
   ---------------------------------------------------------------
   Mỗi achievement nói rõ nguồn của nó (streak / request / completed / paid /
   votes / rank) và phần thưởng hiển thị. Các mốc được đánh giá từ số liệu đã
   có trong hồ sơ; không cộng điểm ngầm và không biến thứ hạng thành một điểm
   số mới.

   Reward copy deliberately stays within three families:
     · vote bonus
     · free paid request
     · badge / title
   */

const milestone = (id, source, need, title, desc, reward) => ({
  id, source, need, title, desc, reward,
})

/* 42 achievements: enough room for a new member to keep finding a next
   milestone without turning the popup into a wall of near-identical cards. */
export const ACHIEVEMENTS = [
  milestone('streak3', 'streak', 3, 'ach.streak3', 'ach.streak3Desc', 'ach.streak3Reward'),
  milestone('streak7', 'streak', 7, 'ach.streak7', 'ach.streak7Desc', 'ach.streak7Reward'),
  milestone('streak14', 'streak', 14, 'ach.streak14', 'ach.streak14Desc', 'ach.streak14Reward'),
  milestone('streak30', 'streak', 30, 'ach.streak30', 'ach.streak30Desc', 'ach.streak30Reward'),
  milestone('streak60', 'streak', 60, 'ach.streak60', 'ach.streak60Desc', 'ach.streak60Reward'),
  milestone('streak100', 'streak', 100, 'ach.streak100', 'ach.streak100Desc', 'ach.streak100Reward'),
  milestone('streak180', 'streak', 180, 'ach.streak180', 'ach.streak180Desc', 'ach.streak180Reward'),
  milestone('streak365', 'streak', 365, 'ach.streak365', 'ach.streak365Desc', 'ach.streak365Reward'),
  milestone('firstRequest', 'requests', 1, 'ach.firstRequest', 'ach.firstRequestDesc', 'ach.firstRequestReward'),
  milestone('request3', 'requests', 3, 'ach.request3', 'ach.request3Desc', 'ach.request3Reward'),
  milestone('request5', 'requests', 5, 'ach.request5', 'ach.request5Desc', 'ach.request5Reward'),
  milestone('request10', 'requests', 10, 'ach.request10', 'ach.request10Desc', 'ach.request10Reward'),
  milestone('request25', 'requests', 25, 'ach.request25', 'ach.request25Desc', 'ach.request25Reward'),
  milestone('request50', 'requests', 50, 'ach.request50', 'ach.request50Desc', 'ach.request50Reward'),
  milestone('request100', 'requests', 100, 'ach.request100', 'ach.request100Desc', 'ach.request100Reward'),
  milestone('request250', 'requests', 250, 'ach.request250', 'ach.request250Desc', 'ach.request250Reward'),
  milestone('firstCompletion', 'completed', 1, 'ach.firstCompletion', 'ach.firstCompletionDesc', 'ach.firstCompletionReward'),
  milestone('completion3', 'completed', 3, 'ach.completion3', 'ach.completion3Desc', 'ach.completion3Reward'),
  milestone('completion5', 'completed', 5, 'ach.completion5', 'ach.completion5Desc', 'ach.completion5Reward'),
  milestone('completion10', 'completed', 10, 'ach.completion10', 'ach.completion10Desc', 'ach.completion10Reward'),
  milestone('completion25', 'completed', 25, 'ach.completion25', 'ach.completion25Desc', 'ach.completion25Reward'),
  milestone('completion50', 'completed', 50, 'ach.completion50', 'ach.completion50Desc', 'ach.completion50Reward'),
  milestone('completion100', 'completed', 100, 'ach.completion100', 'ach.completion100Desc', 'ach.completion100Reward'),
  milestone('firstPaidRequest', 'paid', 1, 'ach.firstPaidRequest', 'ach.firstPaidRequestDesc', 'ach.firstPaidRequestReward'),
  milestone('paid3', 'paid', 3, 'ach.paid3', 'ach.paid3Desc', 'ach.paid3Reward'),
  milestone('paid5', 'paid', 5, 'ach.paid5', 'ach.paid5Desc', 'ach.paid5Reward'),
  milestone('paid10', 'paid', 10, 'ach.paid10', 'ach.paid10Desc', 'ach.paid10Reward'),
  milestone('paid25', 'paid', 25, 'ach.paid25', 'ach.paid25Desc', 'ach.paid25Reward'),
  milestone('paid50', 'paid', 50, 'ach.paid50', 'ach.paid50Desc', 'ach.paid50Reward'),
  milestone('votesCast1', 'votes', 1, 'ach.votesCast1', 'ach.votesCast1Desc', 'ach.votesCast1Reward'),
  milestone('votesCast10', 'votes', 10, 'ach.votesCast10', 'ach.votesCast10Desc', 'ach.votesCast10Reward'),
  milestone('votesCast25', 'votes', 25, 'ach.votesCast25', 'ach.votesCast25Desc', 'ach.votesCast25Reward'),
  milestone('votesCast50', 'votes', 50, 'ach.votesCast50', 'ach.votesCast50Desc', 'ach.votesCast50Reward'),
  milestone('votesCast100', 'votes', 100, 'ach.votesCast100', 'ach.votesCast100Desc', 'ach.votesCast100Reward'),
  milestone('votesCast250', 'votes', 250, 'ach.votesCast250', 'ach.votesCast250Desc', 'ach.votesCast250Reward'),
  milestone('votesCast500', 'votes', 500, 'ach.votesCast500', 'ach.votesCast500Desc', 'ach.votesCast500Reward'),
  milestone('votesCast1000', 'votes', 1000, 'ach.votesCast1000', 'ach.votesCast1000Desc', 'ach.votesCast1000Reward'),
  milestone('top10', 'leaderboard', 10, 'ach.top10', 'ach.top10Desc', 'ach.top10Reward'),
  milestone('top5', 'leaderboard', 5, 'ach.top5', 'ach.top5Desc', 'ach.top5Reward'),
  milestone('podium', 'leaderboard', 3, 'ach.podium', 'ach.podiumDesc', 'ach.podiumReward'),
  milestone('runnerUp', 'leaderboard', 2, 'ach.runnerUp', 'ach.runnerUpDesc', 'ach.runnerUpReward'),
  milestone('champion', 'leaderboard', 1, 'ach.champion', 'ach.championDesc', 'ach.championReward'),
]

const nonNegative = (value) => Math.max(0, Number(value) || 0)

export function achievementProgress(metrics = {}) {
  const rank = Number(metrics.rank)
  return {
    streak: nonNegative(metrics.longestStreak),
    requests: nonNegative(metrics.requests),
    completed: nonNegative(metrics.completed),
    paidRequests: nonNegative(metrics.paidRequests),
    votes: nonNegative(metrics.votesCast ?? metrics.totalVotes),
    rank: Number.isFinite(rank) && rank > 0 ? rank : null,
  }
}

export function evaluateAchievements(metrics = {}) {
  const m = achievementProgress(metrics)
  return ACHIEVEMENTS.map(a => {
    const value = a.source === 'streak' ? m.streak
      : a.source === 'requests' ? m.requests
        : a.source === 'completed' ? m.completed
          : a.source === 'paid' ? m.paidRequests
            : a.source === 'votes' ? m.votes
              : 0
    const earned = a.source === 'leaderboard' ? !!m.rank && m.rank <= a.need : value >= a.need
    return {
      ...a,
      value,
      earned,
      progress: a.source === 'leaderboard' ? (earned ? a.need : 0) : Math.min(value, a.need),
    }
  })
}
