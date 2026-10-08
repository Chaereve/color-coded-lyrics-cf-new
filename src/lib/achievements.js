/* Achievement index — một danh mục minh bạch, không phải một hệ điểm ẩn.
   ---------------------------------------------------------------
   CATALOG V2 (kế hoạch 2026-10, đã duyệt): ĐÚNG 20 thành tựu trong 5 nhóm —
   Request / Vote / Paid / Streak / Đặc biệt. Mỗi achievement nói rõ nguồn của
   nó và phần thưởng; không cộng điểm ngầm. Danh mục máy chủ
   (achievement_definitions sau migration 20261128) là nguồn sự thật; bản này
   chỉ vẽ tiến độ. Các huy hiệu của danh mục cũ đã nhận vẫn giữ nguyên trong
   achievement_rewards — catalogue cũ chỉ thôi hiển thị.

   Reward copy deliberately stays within three families:
     · bonus votes (luôn ghi là "votes")
     · free paid request (bonus_requests — không phải vote)
     · badge / title
   */

const milestone = (id, source, need, title, desc, reward) => ({
  id, source, need, title, desc, reward,
})

/* 20 achievements — đúng spec đã chốt:
   Request (5): 1/5/10/25/50 → +1/2/3/5/10 vote
   Vote    (5): 1/10/50/100/250 → +1/2/3/5/10 vote
   Paid    (4): 1/3/5/10 → 1/2/3/4 free paid request
   Streak  (3): 7/30/100 → +5/10/20 vote
   Đặc biệt(3): pick/vote-back/mystery lần đầu → +2/3/5 vote */
export const ACHIEVEMENTS = [
  milestone('firstRequest', 'requests', 1, 'ach2.firstRequest', 'ach2.firstRequestDesc', 'ach2.firstRequestReward'),
  milestone('request5', 'requests', 5, 'ach2.request5', 'ach2.request5Desc', 'ach2.request5Reward'),
  milestone('request10', 'requests', 10, 'ach2.request10', 'ach2.request10Desc', 'ach2.request10Reward'),
  milestone('request25', 'requests', 25, 'ach2.request25', 'ach2.request25Desc', 'ach2.request25Reward'),
  milestone('request50', 'requests', 50, 'ach2.request50', 'ach2.request50Desc', 'ach2.request50Reward'),
  milestone('votesCast1', 'votes', 1, 'ach2.votesCast1', 'ach2.votesCast1Desc', 'ach2.votesCast1Reward'),
  milestone('votesCast10', 'votes', 10, 'ach2.votesCast10', 'ach2.votesCast10Desc', 'ach2.votesCast10Reward'),
  milestone('votesCast50', 'votes', 50, 'ach2.votesCast50', 'ach2.votesCast50Desc', 'ach2.votesCast50Reward'),
  milestone('votesCast100', 'votes', 100, 'ach2.votesCast100', 'ach2.votesCast100Desc', 'ach2.votesCast100Reward'),
  milestone('votesCast250', 'votes', 250, 'ach2.votesCast250', 'ach2.votesCast250Desc', 'ach2.votesCast250Reward'),
  milestone('firstPaidRequest', 'paid', 1, 'ach2.firstPaidRequest', 'ach2.firstPaidRequestDesc', 'ach2.firstPaidRequestReward'),
  milestone('paid3', 'paid', 3, 'ach2.paid3', 'ach2.paid3Desc', 'ach2.paid3Reward'),
  milestone('paid5', 'paid', 5, 'ach2.paid5', 'ach2.paid5Desc', 'ach2.paid5Reward'),
  milestone('paid10', 'paid', 10, 'ach2.paid10', 'ach2.paid10Desc', 'ach2.paid10Reward'),
  milestone('streak7', 'streak', 7, 'ach2.streak7', 'ach2.streak7Desc', 'ach2.streak7Reward'),
  milestone('streak30', 'streak', 30, 'ach2.streak30', 'ach2.streak30Desc', 'ach2.streak30Reward'),
  milestone('streak100', 'streak', 100, 'ach2.streak100', 'ach2.streak100Desc', 'ach2.streak100Reward'),
  milestone('firstPick', 'pick', 1, 'ach2.firstPick', 'ach2.firstPickDesc', 'ach2.firstPickReward'),
  milestone('firstVoteBack', 'voteBack', 1, 'ach2.firstVoteBack', 'ach2.firstVoteBackDesc', 'ach2.firstVoteBackReward'),
  milestone('firstMystery', 'mystery', 1, 'ach2.firstMystery', 'ach2.firstMysteryDesc', 'ach2.firstMysteryReward'),
]

const nonNegative = (value) => Math.max(0, Number(value) || 0)
/* The special sources are one-time facts: either the event exists or it does
   not. truthy metrics (a picked_at timestamp, a ledger hit) collapse to 1. */
const fact01 = value => (value ? 1 : 0)

export function achievementProgress(metrics = {}) {
  const rank = Number(metrics.rank)
  return {
    streak: nonNegative(metrics.longestStreak),
    requests: nonNegative(metrics.requests),
    completed: nonNegative(metrics.completed),
    paidRequests: nonNegative(metrics.paidRequests),
    votes: nonNegative(metrics.votesCast ?? metrics.totalVotes),
    picked: fact01(metrics.picked),
    voteBack: fact01(metrics.voteBack),
    mystery: fact01(metrics.mystery),
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
              : a.source === 'pick' ? m.picked
                : a.source === 'voteBack' ? m.voteBack
                  : a.source === 'mystery' ? m.mystery
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
