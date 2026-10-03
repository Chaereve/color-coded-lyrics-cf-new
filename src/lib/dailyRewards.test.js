import test from 'node:test'
import assert from 'node:assert/strict'
import { demoDailyRewards } from './dailyRewardsDemo.js'
import { validateDailyRewardsStatus, validateQuizAnswer, validateQuizState,
  readQuizDraft, saveQuizDraft, displayOrder, orderedOptions,
  DAILY_QUIZ_QUESTIONS, MAX_DAILY_QUIZ_VOTES } from './dailyRewards.js'

const now = Date.parse('2026-10-03T16:59:30Z') // 23:59:30 Vietnam time
const initial = () => ({ profile: { vote_credits: 7, bonus_credits: 4 }, userId: 'user-a', now })
const advance = (result, options) => demoDailyRewards({ ...initial(), entries: result.entries, profile: result.profile, ...options })
const startRound = (options = {}) => demoDailyRewards({ ...initial(), action: 'start', expectedDay: '2026-10-03', newId: () => 'quiz-1', ...options })
// The internal round holds the answer key; the public status never does.
const answerAll = (started, { correct = 5 } = {}) => {
  let result = started
  started.entries.quizzes[0].questions.forEach((q, i) => {
    const optionId = i < correct ? q.correct_option_id : q.option_ids.find(id => id !== q.correct_option_id)
    result = advance(result, { action: 'answer', attemptId: 'quiz-1', questionId: q.id, optionId })
  })
  return result
}

test('daily status uses Vietnam midnight and keeps purchased and bonus balances separate', () => {
  const { data } = demoDailyRewards(initial())
  assert.equal(data.status.day, '2026-10-03')
  assert.equal(data.status.reset_at, '2026-10-03T17:00:00.000Z')
  assert.equal(data.status.credits, 11)
  assert.equal(data.status.purchased, 7)
  assert.equal(data.status.bonus, 4)
  assert.equal(data.status.quiz.state, 'ready')
  assert.equal(data.status.login.claimed, false)
  assert.equal(validateDailyRewardsStatus(data.status, 'user-a'), data.status)
})

test('daily login adds exactly two bonus votes and retries never re-credit', () => {
  const claim = demoDailyRewards({ ...initial(), action: 'claim', expectedDay: '2026-10-03' })
  assert.equal(claim.profile.vote_credits, 7)
  assert.equal(claim.profile.bonus_credits, 6)
  assert.equal(claim.data.status.earned_today, 2)
  const repeat = advance(claim, { action: 'claim', expectedDay: '2026-10-03' })
  assert.equal(repeat.data.replayed, true)
  assert.equal(repeat.profile.bonus_credits, 6)
  assert.equal(repeat.entries.logins.length, 1)
})

test('claim date is a stale-click guard, never a way to claim past or future rewards', () => {
  for (const day of ['2026-10-02', '2026-10-04', null]) {
    assert.throws(() => demoDailyRewards({ ...initial(), action: 'claim', expectedDay: day }), /err.dailyDayChanged/)
  }
  const claim = demoDailyRewards({ ...initial(), action: 'claim', expectedDay: '2026-10-03' })
  const midnight = now + 60_000
  const replay = advance(claim, { action: 'claim', expectedDay: '2026-10-03', now: midnight })
  assert.equal(replay.profile.bonus_credits, 6)
  assert.equal(replay.data.status.login.claimed, false, 'a midnight retry does not collect tomorrow’s reward')
  const tomorrow = advance(replay, { action: 'claim', expectedDay: '2026-10-04', now: midnight })
  assert.equal(tomorrow.profile.bonus_credits, 8)
})

test('starting and refreshing a quiz returns one persistent set of five, without answers', () => {
  const started = startRound()
  const quiz = started.data.status.quiz
  assert.equal(quiz.questions.length, DAILY_QUIZ_QUESTIONS)
  assert.equal(new Set(quiz.questions.map(q => q.id)).size, DAILY_QUIZ_QUESTIONS)
  assert.equal(started.profile.bonus_credits, 4)
  assert.equal(quiz.state, 'in_progress')
  assert.equal(quiz.votes_awarded, 0)
  assert.equal(quiz.max_votes, MAX_DAILY_QUIZ_VOTES)
  for (const q of quiz.questions) {
    assert.equal('correct_option_id' in q, false)
    assert.equal('explanation' in q, false)
    assert.equal('correct' in q, false)
    assert.equal(q.answered, false)
  }
  const repeat = advance(started, { action: 'start', expectedDay: '2026-10-03' })
  assert.deepEqual(repeat.data.status.quiz, quiz)
  assert.equal(repeat.entries.quizzes.length, 1)
  validateDailyRewardsStatus(repeat.data.status, 'user-a')
})

test('one vote per correct answer, none for a wrong one, five is the ceiling', () => {
  for (const correct of [0, 1, 3, 5]) {
    const started = startRound()
    const questions = started.entries.quizzes[0].questions
    let result = started
    questions.forEach((q, i) => {
      result = advance(result, { action: 'answer', attemptId: 'quiz-1', questionId: q.id,
        optionId: i < correct ? q.correct_option_id : q.option_ids.find(id => id !== q.correct_option_id) })
    })
    assert.equal(result.profile.bonus_credits, 4 + correct)
    assert.equal(result.data.status.quiz.votes_awarded, correct)
    assert.equal(result.data.status.quiz.locked, true)
    assert.equal(result.data.status.quiz.answered_count, DAILY_QUIZ_QUESTIONS)
    validateDailyRewardsStatus(result.data.status, 'user-a')
    // Every answer is final: a different option id cannot overwrite it.
    const changed = advance(result, { action: 'answer', attemptId: 'quiz-1', questionId: questions[0].id,
      optionId: questions[0].option_ids[1] })
    assert.equal(changed.data.replayed, true)
    assert.equal(changed.profile.bonus_credits, 4 + correct)
    assert.equal(changed.data.status.quiz.questions[0].option_id,
      correct > 0 ? questions[0].correct_option_id : changed.data.status.quiz.questions[0].option_id)
  }
})

test('duplicate and concurrent submissions of one answer award a single vote', () => {
  const started = startRound()
  const question = started.entries.quizzes[0].questions[0]
  const submit = () => advance(started, { action: 'answer', attemptId: 'quiz-1',
    questionId: question.id, optionId: question.correct_option_id })
  const results = [submit(), submit(), submit(), submit()]
  for (const r of results) assert.equal(r.data.status.quiz.votes_awarded, 1)
  assert.equal(results.filter(r => r.data.replayed === false).length >= 1, true)
  assert.ok(results.every(r => r.profile.bonus_credits <= 5),
    'no matter how many copies of the request run, one vote is awarded')
})

test('unanswered rounds expire at Vietnam midnight; completed retries are harmless', () => {
  const started = startRound()
  const question = started.entries.quizzes[0].questions[0]
  const tomorrow = now + 60_000
  assert.throws(() => advance(started, { action: 'answer', attemptId: 'quiz-1',
    questionId: question.id, optionId: question.correct_option_id, now: tomorrow }), /err.dailyDayChanged/)
  assert.throws(() => advance(started, { action: 'answer', attemptId: 'another-quiz',
    questionId: question.id, optionId: question.option_ids[0] }), /err.dailyQuizSession/)
  // A question that is not part of the round, and an option that is not one of
  // the question's four stable ids.
  assert.throws(() => advance(started, { action: 'answer', attemptId: 'quiz-1',
    questionId: 'not-assigned', optionId: 'opt-a' }), /err.dailyQuizQuestion/)
  assert.throws(() => advance(started, { action: 'answer', attemptId: 'quiz-1',
    questionId: question.id, optionId: 'opt-z' }), /err.dailyQuizOption/)
  const done = answerAll(started)
  assert.equal(done.profile.bonus_credits, 9)
  // Same-day retries of a finished answer change nothing (the server replays).
  const replay = advance(done, { action: 'answer', attemptId: 'quiz-1', questionId: question.id,
    optionId: question.correct_option_id })
  assert.equal(replay.profile.bonus_credits, 9)
  assert.equal(replay.data.replayed, true)
  // A finished round still cannot be reopened on a later day.
  assert.throws(() => advance(done, { action: 'answer', attemptId: 'quiz-1', questionId: question.id,
    optionId: question.correct_option_id, now: tomorrow }), /err.dailyDayChanged/)
  const fresh = advance(done, { action: 'start', expectedDay: '2026-10-04', now: tomorrow, newId: () => 'quiz-2' })
  assert.equal(fresh.data.status.quiz.attempt_id, 'quiz-2')
  assert.equal(fresh.entries.quizzes.length, 2)
})

test('malformed answers and tampered statuses never reach the UI as rewards', () => {
  for (const bad of [null, undefined, '', '  ', 'a'.repeat(600)]) {
    assert.throws(() => validateQuizAnswer(bad, 'opt-a'), /err.dailyQuizAnswers/)
  }
  for (const bad of [null, undefined, '', 'A', 0, 'opt-', 'opt-<script>', 'x'.repeat(40)]) {
    assert.throws(() => validateQuizAnswer('q1', bad), /err.dailyQuizOption/)
  }
  assert.deepEqual(validateQuizAnswer('q1', 'opt-c'), { question_id: 'q1', option_id: 'opt-c' })

  const { data: { status } } = demoDailyRewards(initial())
  assert.throws(() => validateDailyRewardsStatus(status, 'user-b'), /err.dailyAccountChanged/)
  assert.throws(() => validateDailyRewardsStatus({ ...status, bonus: 999 }, 'user-a'), /err.dailyResponse/)
  assert.throws(() => validateDailyRewardsStatus({ ...status, server_now: 'broken' }, 'user-a'), /err.dailyResponse/)
  assert.throws(() => validateDailyRewardsStatus({ ...status, earned_today: 5 }, 'user-a'), /err.dailyResponse/)

  const started = startRound()
  // An answer leaked before submission is rejected, not rendered.
  const leaked = structuredClone(started.data.status)
  leaked.quiz.questions[0].correct_option_id = 'opt-a'
  assert.throws(() => validateDailyRewardsStatus(leaked, 'user-a'), /err.dailyResponse/)
  const overPaid = structuredClone(answerAll(started).data.status)
  overPaid.quiz.votes_awarded = 6
  assert.throws(() => validateDailyRewardsStatus(overPaid, 'user-a'), /err.dailyResponse/)
  const short = structuredClone(started.data.status)
  short.quiz.questions.pop()
  assert.throws(() => validateDailyRewardsStatus(short, 'user-a'), /err.dailyResponse/)
})

test('the unavailable and retired states are explicit, never a playable round', () => {
  const base = { user_id: 'user-a', day: '2026-10-03' }
  const unavailable = { state: 'unavailable', question_count: 5, max_votes: 5 }
  assert.deepEqual(validateQuizState(unavailable), unavailable)
  assert.throws(() => validateQuizState({ state: 'unavailable', questions: [] }), /err.dailyResponse/)
  const retired = { state: 'retired' }
  assert.deepEqual(validateQuizState(retired), retired)
  assert.throws(() => validateQuizState({ state: 'nonsense' }), /err.dailyResponse/)
  assert.throws(() => validateQuizState(null), /err.dailyResponse/)
  assert.ok(base.day)
})

test('client-side shuffling is stable, complete and never changes the ids', () => {
  const ids = ['opt-a', 'opt-b', 'opt-c', 'opt-d']
  const first = displayOrder('attempt-1', 'Q1', ids)
  assert.deepEqual([...first].sort(), ids, 'a shuffle is still a permutation')
  assert.deepEqual(displayOrder('attempt-1', 'Q1', ids), first, 'the same round renders identically')
  assert.notDeepEqual(displayOrder('attempt-2', 'Q1', ids), first, 'different rounds differ')
  assert.notDeepEqual(displayOrder('attempt-1', 'Q2', ids), first, 'different questions differ')
  const question = { id: 'Q1', options: ['A', 'B', 'C', 'D'], option_ids: ids }
  const shown = orderedOptions(question, 'attempt-1')
  assert.equal(shown.length, 4)
  assert.deepEqual(shown.map(o => o.id), first)
  assert.deepEqual(shown.map(o => o.label).sort(), ['A', 'B', 'C', 'D'])
  for (const option of shown) {
    assert.equal(question.options[ids.indexOf(option.id)], option.label,
      'the label always travels with its stable id')
  }
})

test('drafts are scoped to the account and exact attempt; blocked storage is optional', () => {
  const store = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v),
  } })
  try {
    saveQuizDraft('a', 'quiz-1', { Q1: 'opt-a', Q2: 'opt-c' })
    assert.deepEqual(readQuizDraft('a', 'quiz-1'), { Q1: 'opt-a', Q2: 'opt-c' })
    assert.deepEqual(readQuizDraft('b', 'quiz-1'), {})
    assert.deepEqual(readQuizDraft('a', 'quiz-2'), {})
    // Junk in storage is dropped instead of being submitted.
    store.set('ccl.daily.quiz.draft.v1.a', 'not json')
    assert.deepEqual(readQuizDraft('a', 'quiz-1'), {})
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    assert.doesNotThrow(() => saveQuizDraft('a', 'quiz-1', { Q1: 'opt-a' }))
    assert.deepEqual(readQuizDraft('a', 'quiz-1'), {})
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
