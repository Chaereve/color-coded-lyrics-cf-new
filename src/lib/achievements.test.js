import test from 'node:test'
import assert from 'node:assert/strict'
import { ACHIEVEMENTS, achievementProgress, evaluateAchievements } from './achievements.js'

test('achievement index has more than forty explicit, reward-bearing milestones', () => {
  assert.ok(ACHIEVEMENTS.length > 40)
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.id && a.source && a.title && a.desc && a.reward && a.need > 0)
    assert.match(a.reward, /Reward$/)
  }
  assert.ok(ACHIEVEMENTS.some(a => a.source === 'paid'))
})

test('streak, request, completion, paid, vote and leaderboard achievements evaluate independently', () => {
  const got = evaluateAchievements({
    longestStreak: 30,
    requests: 5,
    completed: 5,
    paidRequests: 3,
    rank: 3,
    votesCast: 10,
  })
  assert.deepEqual(got.filter(a => a.earned).map(a => a.id), [
    'streak3', 'streak7', 'streak14', 'streak30',
    'firstRequest', 'request3', 'request5',
    'firstCompletion', 'completion3', 'completion5',
    'firstPaidRequest', 'paid3',
    'votesCast1', 'votesCast10',
    'top10', 'top5', 'podium',
  ])
  assert.equal(got.find(a => a.id === 'streak100').progress, 30)
  assert.equal(got.find(a => a.id === 'paid5').progress, 3)
})

test('invalid metrics never create a fake leaderboard rank or negative progress', () => {
  assert.deepEqual(achievementProgress({
    longestStreak: -4, requests: 'nope', paidRequests: -2, votesCast: -9, rank: NaN,
  }), {
    streak: 0, requests: 0, completed: 0, paidRequests: 0, votes: 0, rank: null,
  })
  assert.ok(evaluateAchievements({ rank: null }).every(a => !a.earned && a.progress === 0))
})
