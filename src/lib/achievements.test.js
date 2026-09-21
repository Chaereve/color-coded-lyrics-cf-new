import test from 'node:test'
import assert from 'node:assert/strict'
import { ACHIEVEMENTS, achievementProgress, evaluateAchievements } from './achievements.js'

test('achievement index keeps every source and cosmetic reward explicit', () => {
  assert.deepEqual(ACHIEVEMENTS.map(a => a.id), [
    'streak7', 'streak30', 'streak100', 'firstRequest', 'firstCompletion', 'top10', 'podium',
  ])
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.source && a.title && a.desc && a.reward && a.need > 0)
  }
})

test('streak, request, completion and leaderboard achievements evaluate independently', () => {
  const got = evaluateAchievements({ longestStreak: 30, requests: 1, completed: 1, rank: 3 })
  assert.deepEqual(got.filter(a => a.earned).map(a => a.id), [
    'streak7', 'streak30', 'firstRequest', 'firstCompletion', 'top10', 'podium',
  ])
  assert.equal(got.find(a => a.id === 'streak100').progress, 30)
})

test('invalid metrics never create a fake leaderboard rank or negative progress', () => {
  assert.deepEqual(achievementProgress({ longestStreak: -4, requests: 'nope', rank: NaN }), {
    streak: 0, requests: 0, completed: 0, rank: null,
  })
  assert.ok(evaluateAchievements({ rank: null }).every(a => !a.earned && a.progress === 0))
})
