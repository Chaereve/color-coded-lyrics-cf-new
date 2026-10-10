/* Achievement index — một danh mục minh bạch, không phải một hệ điểm ẩn.
   ---------------------------------------------------------------
   CATALOG V3 (20261211, trên nền v2 20261128): ĐÚNG 52 thành tựu trong 7
   nhóm — Request / Vote / Paid / Completion / Streak / Leaderboard / Đặc
   biệt. Mỗi achievement nói rõ nguồn của nó và phần thưởng; không cộng điểm
   ngầm. Danh mục máy chủ (achievement_definitions sau migration
   20261211_achievements_v3) là nguồn sự thật; bản này chỉ vẽ tiến độ. Các
   huy hiệu đã nhận vẫn giữ nguyên trong achievement_rewards — claim() luôn
   on conflict do nothing nên không bao giờ phát thưởng hai lần.

   Reward copy deliberately stays within three families:
     · bonus votes (luôn ghi là "votes")
     · free paid request (bonus_requests — không phải vote)
     · badge / title
   */

const milestone = (id, source, need, title, desc, reward) => ({
  id, source, need, title, desc, reward,
})

/* 52 achievements — đúng spec đã chốt (20261211, trên nền v2 20261128):
   Request   (9): 1/3/5/10/25/50/100/250/500
   Vote      (9): 1/10/25/50/100/250/500/1000/2500
   Paid      (7): 1/3/5/10/25/50/100 → free paid request
   Completed (8): 1/3/5/10/25/50/100/200
   Streak    (9): 3/7/14/30/60/100/180/365/500
   Leaderboard(7): top50/25/10/5 · podium · runner-up · champion
   Đặc biệt  (3): pick/vote-back/mystery lần đầu → +2/3/5 vote.
   firstVoteBack đọc sổ cái B4: EXISTS (vote_back_owner OR vote_back_voter)
   → đúng 1. Owner nhận cả hai nguồn 10% vẫn chỉ một badge, không cộng 2. */
export const ACHIEVEMENTS = [
  milestone('firstRequest', 'requests', 1, 'ach2.firstRequest', 'ach2.firstRequestDesc', 'ach2.firstRequestReward'),
  milestone('request3', 'requests', 3, 'ach2.request3', 'ach2.request3Desc', 'ach2.request3Reward'),
  milestone('request5', 'requests', 5, 'ach2.request5', 'ach2.request5Desc', 'ach2.request5Reward'),
  milestone('request10', 'requests', 10, 'ach2.request10', 'ach2.request10Desc', 'ach2.request10Reward'),
  milestone('request25', 'requests', 25, 'ach2.request25', 'ach2.request25Desc', 'ach2.request25Reward'),
  milestone('request50', 'requests', 50, 'ach2.request50', 'ach2.request50Desc', 'ach2.request50Reward'),
  milestone('request100', 'requests', 100, 'ach2.request100', 'ach2.request100Desc', 'ach2.request100Reward'),
  milestone('request250', 'requests', 250, 'ach2.request250', 'ach2.request250Desc', 'ach2.request250Reward'),
  milestone('request500', 'requests', 500, 'ach2.request500', 'ach2.request500Desc', 'ach2.request500Reward'),
  milestone('votesCast1', 'votes', 1, 'ach2.votesCast1', 'ach2.votesCast1Desc', 'ach2.votesCast1Reward'),
  milestone('votesCast10', 'votes', 10, 'ach2.votesCast10', 'ach2.votesCast10Desc', 'ach2.votesCast10Reward'),
  milestone('votesCast25', 'votes', 25, 'ach2.votesCast25', 'ach2.votesCast25Desc', 'ach2.votesCast25Reward'),
  milestone('votesCast50', 'votes', 50, 'ach2.votesCast50', 'ach2.votesCast50Desc', 'ach2.votesCast50Reward'),
  milestone('votesCast100', 'votes', 100, 'ach2.votesCast100', 'ach2.votesCast100Desc', 'ach2.votesCast100Reward'),
  milestone('votesCast250', 'votes', 250, 'ach2.votesCast250', 'ach2.votesCast250Desc', 'ach2.votesCast250Reward'),
  milestone('votesCast500', 'votes', 500, 'ach2.votesCast500', 'ach2.votesCast500Desc', 'ach2.votesCast500Reward'),
  milestone('votesCast1000', 'votes', 1000, 'ach2.votesCast1000', 'ach2.votesCast1000Desc', 'ach2.votesCast1000Reward'),
  milestone('votesCast2500', 'votes', 2500, 'ach2.votesCast2500', 'ach2.votesCast2500Desc', 'ach2.votesCast2500Reward'),
  milestone('firstPaidRequest', 'paid', 1, 'ach2.firstPaidRequest', 'ach2.firstPaidRequestDesc', 'ach2.firstPaidRequestReward'),
  milestone('paid3', 'paid', 3, 'ach2.paid3', 'ach2.paid3Desc', 'ach2.paid3Reward'),
  milestone('paid5', 'paid', 5, 'ach2.paid5', 'ach2.paid5Desc', 'ach2.paid5Reward'),
  milestone('paid10', 'paid', 10, 'ach2.paid10', 'ach2.paid10Desc', 'ach2.paid10Reward'),
  milestone('paid25', 'paid', 25, 'ach2.paid25', 'ach2.paid25Desc', 'ach2.paid25Reward'),
  milestone('paid50', 'paid', 50, 'ach2.paid50', 'ach2.paid50Desc', 'ach2.paid50Reward'),
  milestone('paid100', 'paid', 100, 'ach2.paid100', 'ach2.paid100Desc', 'ach2.paid100Reward'),
  milestone('firstCompletion', 'completed', 1, 'ach2.firstCompletion', 'ach2.firstCompletionDesc', 'ach2.firstCompletionReward'),
  milestone('completion3', 'completed', 3, 'ach2.completion3', 'ach2.completion3Desc', 'ach2.completion3Reward'),
  milestone('completion5', 'completed', 5, 'ach2.completion5', 'ach2.completion5Desc', 'ach2.completion5Reward'),
  milestone('completion10', 'completed', 10, 'ach2.completion10', 'ach2.completion10Desc', 'ach2.completion10Reward'),
  milestone('completion25', 'completed', 25, 'ach2.completion25', 'ach2.completion25Desc', 'ach2.completion25Reward'),
  milestone('completion50', 'completed', 50, 'ach2.completion50', 'ach2.completion50Desc', 'ach2.completion50Reward'),
  milestone('completion100', 'completed', 100, 'ach2.completion100', 'ach2.completion100Desc', 'ach2.completion100Reward'),
  milestone('completion200', 'completed', 200, 'ach2.completion200', 'ach2.completion200Desc', 'ach2.completion200Reward'),
  milestone('streak3', 'streak', 3, 'ach2.streak3', 'ach2.streak3Desc', 'ach2.streak3Reward'),
  milestone('streak7', 'streak', 7, 'ach2.streak7', 'ach2.streak7Desc', 'ach2.streak7Reward'),
  milestone('streak14', 'streak', 14, 'ach2.streak14', 'ach2.streak14Desc', 'ach2.streak14Reward'),
  milestone('streak30', 'streak', 30, 'ach2.streak30', 'ach2.streak30Desc', 'ach2.streak30Reward'),
  milestone('streak60', 'streak', 60, 'ach2.streak60', 'ach2.streak60Desc', 'ach2.streak60Reward'),
  milestone('streak100', 'streak', 100, 'ach2.streak100', 'ach2.streak100Desc', 'ach2.streak100Reward'),
  milestone('streak180', 'streak', 180, 'ach2.streak180', 'ach2.streak180Desc', 'ach2.streak180Reward'),
  milestone('streak365', 'streak', 365, 'ach2.streak365', 'ach2.streak365Desc', 'ach2.streak365Reward'),
  milestone('streak500', 'streak', 500, 'ach2.streak500', 'ach2.streak500Desc', 'ach2.streak500Reward'),
  milestone('top50', 'leaderboard', 50, 'ach2.top50', 'ach2.top50Desc', 'ach2.top50Reward'),
  milestone('top25', 'leaderboard', 25, 'ach2.top25', 'ach2.top25Desc', 'ach2.top25Reward'),
  milestone('top10', 'leaderboard', 10, 'ach2.top10', 'ach2.top10Desc', 'ach2.top10Reward'),
  milestone('top5', 'leaderboard', 5, 'ach2.top5', 'ach2.top5Desc', 'ach2.top5Reward'),
  milestone('podium', 'leaderboard', 3, 'ach2.podium', 'ach2.podiumDesc', 'ach2.podiumReward'),
  milestone('runnerUp', 'leaderboard', 2, 'ach2.runnerUp', 'ach2.runnerUpDesc', 'ach2.runnerUpReward'),
  milestone('champion', 'leaderboard', 1, 'ach2.champion', 'ach2.championDesc', 'ach2.championReward'),
  milestone('firstPick', 'pick', 1, 'ach2.firstPick', 'ach2.firstPickDesc', 'ach2.firstPickReward'),
  milestone('firstVoteBack', 'voteBack', 1, 'ach2.firstVoteBack', 'ach2.firstVoteBackDesc', 'ach2.firstVoteBackReward'),
  milestone('firstMystery', 'mystery', 1, 'ach2.firstMystery', 'ach2.firstMysteryDesc', 'ach2.firstMysteryReward'),
]

const nonNegative = (value) => Math.max(0, Number(value) || 0)
/* The special sources are one-time facts: either the event exists or it does
   not. truthy metrics collapse to 1 so a caller that sums both vote-back
   ledger sources (owner + voter) cannot show progress 2 or imply two badges.
   Matches claim_achievements: EXISTS (vote_back_owner OR vote_back_voter). */
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
