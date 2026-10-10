import test from 'node:test'
import assert from 'node:assert/strict'
import { ACHIEVEMENTS, achievementProgress, evaluateAchievements } from './achievements.js'

/* Catalog v3 (20261211, trên nền v2 20261128): ĐÚNG 52 mục trong 7 nhóm.
   Danh mục máy chủ (achievement_definitions sau 20261211) là nguồn sự thật;
   bài test này chốt bản client vẽ đúng cùng một bộ 52. */
test('catalog v3 has exactly fifty-two milestones across the seven approved groups', () => {
  assert.equal(ACHIEVEMENTS.length, 52)
  const bySource = {}
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.id && a.source && a.title && a.desc && a.reward && a.need > 0)
    assert.match(a.title, /^ach2\./)
    assert.match(a.desc, /^ach2\./)
    assert.match(a.reward, /^ach2\./)
    bySource[a.source] = (bySource[a.source] || 0) + 1
  }
  assert.deepEqual(bySource, {
    requests: 9, votes: 9, paid: 7, completed: 8, streak: 9, leaderboard: 7,
    pick: 1, voteBack: 1, mystery: 1,
  })
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, 52)
  // Mốc đúng spec 20261211 (server = bản gốc, id ↔ threshold).
  const need = id => ACHIEVEMENTS.find(a => a.id === id)?.need
  assert.deepEqual(['firstRequest', 'request3', 'request5', 'request10', 'request25',
    'request50', 'request100', 'request250', 'request500'].map(need),
  [1, 3, 5, 10, 25, 50, 100, 250, 500])
  assert.deepEqual(['votesCast1', 'votesCast10', 'votesCast25', 'votesCast50', 'votesCast100',
    'votesCast250', 'votesCast500', 'votesCast1000', 'votesCast2500'].map(need),
  [1, 10, 25, 50, 100, 250, 500, 1000, 2500])
  assert.deepEqual(['firstPaidRequest', 'paid3', 'paid5', 'paid10', 'paid25', 'paid50', 'paid100'].map(need),
    [1, 3, 5, 10, 25, 50, 100])
  assert.deepEqual(['firstCompletion', 'completion3', 'completion5', 'completion10',
    'completion25', 'completion50', 'completion100', 'completion200'].map(need),
  [1, 3, 5, 10, 25, 50, 100, 200])
  assert.deepEqual(['streak3', 'streak7', 'streak14', 'streak30', 'streak60',
    'streak100', 'streak180', 'streak365', 'streak500'].map(need),
  [3, 7, 14, 30, 60, 100, 180, 365, 500])
  assert.deepEqual(['top50', 'top25', 'top10', 'top5', 'podium', 'runnerUp', 'champion'].map(need),
    [50, 25, 10, 5, 3, 2, 1])
  assert.deepEqual(['firstPick', 'firstVoteBack', 'firstMystery'].map(need), [1, 1, 1])
})

test('streak, request, paid, vote and special achievements evaluate independently', () => {
  const got = evaluateAchievements({
    longestStreak: 30,
    requests: 5,
    completed: 5,
    paidRequests: 3,
    votesCast: 10,
    picked: true,
    voteBack: 0,
    mystery: false,
  })
  assert.deepEqual(got.filter(a => a.earned).map(a => a.id).sort(), [
    'completion3', 'completion5', 'firstCompletion', 'firstPaidRequest', 'firstPick',
    'firstRequest', 'paid3', 'request3', 'request5',
    'streak3', 'streak7', 'streak14', 'streak30', 'votesCast1', 'votesCast10',
  ].sort())
  assert.equal(got.find(a => a.id === 'streak100').progress, 30)
  assert.equal(got.find(a => a.id === 'paid5').progress, 3)
  assert.equal(got.find(a => a.id === 'firstVoteBack').progress, 0)
  assert.equal(got.find(a => a.id === 'firstMystery').progress, 0)
})

test('special sources are one-time facts: any truthy metric counts, nothing else does', () => {
  const truthy = evaluateAchievements({ picked: 'req-uuid', voteBack: 1, mystery: true })
  for (const id of ['firstPick', 'firstVoteBack', 'firstMystery']) {
    assert.equal(truthy.find(a => a.id === id).progress, 1)
    assert.ok(truthy.find(a => a.id === id).earned)
  }
  const falsy = evaluateAchievements({})
  for (const id of ['firstPick', 'firstVoteBack', 'firstMystery']) {
    assert.equal(falsy.find(a => a.id === id).progress, 0)
    assert.ok(!falsy.find(a => a.id === id).earned)
  }
})

test('firstVoteBack does not double-count owner + voter ledger rows', () => {
  /* Server: EXISTS (vote_back_owner OR vote_back_voter) → 1.
     Client fact01 must collapse a summed count (2) the same way so the card
     never reads 2/1 or implies two badges. */
  for (const voteBack of [1, 2, 99, true, 'owner+voter']) {
    const a = evaluateAchievements({ voteBack }).find(x => x.id === 'firstVoteBack')
    assert.equal(a.progress, 1, `voteBack=${String(voteBack)}`)
    assert.ok(a.earned)
  }
  assert.equal(achievementProgress({ voteBack: 2 }).voteBack, 1)
})

test('invalid metrics never create a fake leaderboard rank or negative progress', () => {
  assert.deepEqual(achievementProgress({
    longestStreak: -4, requests: 'nope', paidRequests: -2, votesCast: -9, rank: NaN,
  }), {
    streak: 0, requests: 0, completed: 0, paidRequests: 0, votes: 0,
    picked: 0, voteBack: 0, mystery: 0, rank: null,
  })
  assert.ok(evaluateAchievements({ rank: null }).every(a => !a.earned && a.progress === 0))
})
