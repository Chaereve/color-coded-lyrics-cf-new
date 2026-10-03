/* Presentation/validation only. Real dates, answers, correctness, votes and
   rewards are authorized exclusively by the Supabase RPCs, never by these
   browser constants. */
import { isCalendarDay, isCalendarMonth } from './checkInCalendar.js'

/* Product policy: a check-in is presence only. It awards no votes, no points
   and no other currency — the K-pop quiz is the single vote-awarding path
   (1 correct answer = 1 vote, hard ceiling 5 a day). The constant stays
   explicit so a server that still promises a check-in reward is rejected
   instead of being rendered as free votes. */
export const DAILY_LOGIN_REWARD = 0
export const DAILY_QUIZ_QUESTIONS = 5
export const QUIZ_CORRECT_REWARD = 1
/* The ceiling is a product rule, not a UI hint: the server enforces the same
   number against public.daily_quiz_answers (one row per user, day, question). */
export const MAX_DAILY_QUIZ_VOTES = 5
export const DAILY_REWARDS_SYNC_KEY = 'ccl.daily.rewards.changed.v1'
const draftKey = userId => `ccl.daily.quiz.draft.v1.${userId}`
const natural = n => Number.isInteger(n) && n >= 0
const OPTION_KEYS = ['opt-a', 'opt-b', 'opt-c', 'opt-d']

// Legacy IDs only, no question content or answer keys. Explain retained
// snapshots instead of silently replacing drafts or reopening a paid round.
const legacyQuizIds = new Set([
  'kpop-dynamite',
  'kpop-ddudu',
  'kpop-gods-menu',
  'kpop-ditto',
  'kpop-super',
  'kpop-cheer-up',
  'kpop-love-shot',
  'kpop-psy',
  'kpop-maknae',
  'kpop-bias',
  'kpop-comeback',
  'lyrics-colors',
  'lyrics-romanization',
  'music-bpm',
  'music-acappella',
  'music-chorus',
  'music-duet',
  'music-ep',
  'music-mv',
  'music-encore',
  'music-instrumental',
  'music-bridge',
  'music-lightstick',
  'music-cover',
  'demo-staff',
  'demo-piano',
  'demo-trio',
  'demo-lyrics',
  'demo-strings',
  'demo-mic',
])

export function isLegacyDailyQuiz(quiz) {
  return !!quiz?.questions?.some(q => legacyQuizIds.has(q.id))
}

/* ------------------------------------------------------------------ */
/* Client-side option shuffling                                         */
/* ------------------------------------------------------------------ */
/* The server grades a stable option id, never a display position, so the
   browser is free to show the options in any order. The order is derived from
   the attempt id + question id, which makes it stable across re-renders and
   reloads while still being unpredictable to the player. */
export function displayOrder(attemptId, questionId, optionIds = OPTION_KEYS) {
  const seed = `${attemptId || ''}:${questionId || ''}`
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const copy = [...optionIds]
  // Fisher-Yates driven by a small xorshift on the FNV-1a seed above.
  let state = (hash >>> 0) || 1
  for (let i = copy.length - 1; i > 0; i--) {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    const j = state % (i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/* The options of one question, in display order, with their stable ids. */
export function orderedOptions(question, attemptId) {
  const ids = Array.isArray(question?.option_ids) && question.option_ids.length
    ? question.option_ids : OPTION_KEYS.slice(0, question?.options?.length || 0)
  return displayOrder(attemptId, question?.id, ids).map((id, index) => ({
    id,
    index,
    label: question.options?.[ids.indexOf(id)] ?? '',
  }))
}

export function validateQuizQuestion(question) {
  return typeof question?.id === 'string' && !!question.id
    && typeof question.prompt === 'string' && !!question.prompt
    && Array.isArray(question.options) && question.options.length === 4
    && question.options.every(s => typeof s === 'string')
    && Array.isArray(question.option_ids) && question.option_ids.length === 4
    && question.option_ids.every(s => typeof s === 'string' && !!s)
}

/* The only thing the client is allowed to send: an assigned question id and
   one of that question's stable option ids. */
export function validateQuizAnswer(questionId, optionId) {
  if (typeof questionId !== 'string' || !questionId.trim() || questionId.length > 128) {
    throw new Error('err.dailyQuizAnswers')
  }
  if (typeof optionId !== 'string' || !/^opt-[a-z0-9_-]{1,32}$/.test(optionId)) {
    throw new Error('err.dailyQuizOption')
  }
  return { question_id: questionId, option_id: optionId }
}

export function validateDailyRewardsStatus(status, userId) {
  if (status?.user_id !== userId) throw new Error('err.dailyAccountChanged')
  const bad = () => { throw new Error('err.dailyResponse') }
  if (!isCalendarDay(status.day)
      || !Number.isFinite(Date.parse(status.server_now)) || !Number.isFinite(Date.parse(status.reset_at))
      || ![status.credits, status.purchased, status.bonus, status.earned_today].every(natural)
      || status.credits !== status.purchased + status.bonus
      || typeof status.login?.claimed !== 'boolean') bad()
  // A check-in may never carry a vote amount. `vote_reward` is the migrated
  // name; `reward` is the legacy one an un-migrated server still sends as 2
  // — whichever key arrives, the only acceptable value is 0.
  for (const key of ['vote_reward', 'reward']) {
    if (status.login[key] !== undefined && status.login[key] !== DAILY_LOGIN_REWARD) bad()
  }
  // Optional on older installations, strict when present. No fabricated
  // history: only real, ordered, owner-scoped dates in the server's month.
  if ('claimed_days' in status.login) {
    const days = status.login.claimed_days
    if (!Array.isArray(days) || days.length > 31 || new Set(days).size !== days.length
        || !days.every((day, index) => isCalendarDay(day) && day.slice(0, 7) === status.day.slice(0, 7)
          && day <= status.day && (index === 0 || days[index - 1] < day))
        || days.includes(status.day) !== status.login.claimed) bad()
  }
  // Optional read-only statistics, strict when the upgraded server sends them.
  const login = status.login
  if ('total_days' in login || 'streak' in login || 'best_streak' in login || 'first_day' in login) {
    if (![login.total_days, login.streak, login.best_streak].every(natural)
        || login.streak > login.total_days || login.best_streak > login.total_days
        || login.best_streak < login.streak) bad()
    // An empty ledger has no first day; a real first day can never be future.
    if (login.total_days === 0 ? login.first_day !== null
        : !isCalendarDay(login.first_day) || login.first_day > status.day) bad()
    const monthDays = Array.isArray(login.claimed_days) ? login.claimed_days.length : 0
    if (login.total_days < monthDays) bad()
  }
  validateQuizState(status.quiz, status)
  // Votes earned today come from the quiz alone: a check-in adds nothing.
  if (status.earned_today !== (status.quiz?.votes_awarded || 0)) bad()
  return status
}

/* The quiz object has four intentional states; anything else is a bad or
   tampered response and must never be rendered as a playable round. */
export function validateQuizState(quiz, status) {
  const bad = () => { throw new Error('err.dailyResponse') }
  if (quiz === null || quiz === undefined) bad()
  if (typeof quiz.state !== 'string') bad()
  if (['unavailable', 'retired'].includes(quiz.state)) {
    // No questions, no answers, nothing to play.
    if ('questions' in quiz || 'attempt_id' in quiz) bad()
    return quiz
  }
  if (quiz.state === 'ready') {
    if (quiz.question_count !== DAILY_QUIZ_QUESTIONS || quiz.max_votes !== MAX_DAILY_QUIZ_VOTES) bad()
    return quiz
  }
  if (quiz.state !== 'in_progress' && quiz.state !== 'completed') bad()
  if (typeof quiz.attempt_id !== 'string' || !quiz.attempt_id
      || quiz.question_count !== DAILY_QUIZ_QUESTIONS
      || quiz.max_votes !== MAX_DAILY_QUIZ_VOTES
      || !natural(quiz.votes_awarded) || quiz.votes_awarded > MAX_DAILY_QUIZ_VOTES
      || !natural(quiz.answered_count) || quiz.answered_count > DAILY_QUIZ_QUESTIONS
      || (quiz.state === 'completed') !== !!quiz.locked
      || typeof quiz.quiz_date !== 'string' || !isCalendarDay(quiz.quiz_date)) bad()
  if (!Array.isArray(quiz.questions) || quiz.questions.length !== DAILY_QUIZ_QUESTIONS
      || new Set(quiz.questions.map(q => q.id)).size !== DAILY_QUIZ_QUESTIONS) bad()
  for (const q of quiz.questions) {
    if (!validateQuizQuestion(q)) bad()
    if (q.category !== undefined && (typeof q.category !== 'string' || !q.category)) bad()
    if (typeof q.answered !== 'boolean') bad()
    if (q.answered) {
      // Revealed only after this answer has been locked in by the server.
      if (typeof q.correct_option_id !== 'string' || !q.option_ids.includes(q.correct_option_id)) bad()
      if (typeof q.explanation !== 'string' || typeof q.correct !== 'boolean') bad()
      if (typeof q.option_id !== 'string' || !q.option_ids.includes(q.option_id)) bad()
      if (![0, 1].includes(q.awarded)) bad()
    } else if ('correct_option_id' in q || 'explanation' in q || 'correct' in q || 'awarded' in q) {
      bad() // a round that leaks answers before submission is not playable
    }
  }
  const answered = quiz.questions.filter(q => q.answered).length
  if (answered !== quiz.answered_count) bad()
  if (quiz.state === 'completed' && answered !== DAILY_QUIZ_QUESTIONS) bad()
  if (quiz.votes_awarded > quiz.answered_count) bad()
  // Votes can only ever come from correct answers that were actually awarded.
  if (quiz.votes_awarded > quiz.questions.filter(q => q.awarded === 1).length) bad()
  if (status && isCalendarDay(status.day) && quiz.quiz_date !== status.day) bad()
  return quiz
}

/* Read-only month browsing. The RPC can only return the caller's own real
   check-in dates, never future days and never another account's ledger. */
export function validateCheckInMonth(payload, userId) {
  if (payload?.user_id !== userId) throw new Error('err.dailyAccountChanged')
  if (!isCalendarMonth(payload.month) || !isCalendarDay(payload.day)) throw new Error('err.dailyResponse')
  const days = payload.days
  if (!Array.isArray(days) || days.length > 31 || new Set(days).size !== days.length
      || !days.every((day, index) => isCalendarDay(day) && day.startsWith(`${payload.month}-`)
        && day <= payload.day && (index === 0 || days[index - 1] < day))) {
    throw new Error('err.dailyResponse')
  }
  return { month: payload.month, day: payload.day, days }
}

/* Answers are keyed by the stable option id, so a shuffle can never silently
   change what the player submitted. */
export function readQuizDraft(userId, attemptId) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(userId)) || 'null')
    if (draft?.attempt_id === attemptId && draft.answers
        && typeof draft.answers === 'object' && !Array.isArray(draft.answers)) {
      const clean = {}
      for (const [questionId, optionId] of Object.entries(draft.answers)) {
        if (typeof questionId === 'string' && typeof optionId === 'string') clean[questionId] = optionId
      }
      return clean
    }
  } catch { /* Progress storage is optional; real attempts remain on the server. */ }
  return {}
}

export function saveQuizDraft(userId, attemptId, answers) {
  try { localStorage.setItem(draftKey(userId), JSON.stringify({ attempt_id: attemptId, answers })) }
  catch { /* Blocked storage must not prevent participating. */ }
}

export function announceDailyRewardsChange() {
  try { localStorage.setItem(DAILY_REWARDS_SYNC_KEY, crypto.randomUUID()) }
  catch { /* Optional cross-tab refresh; the ledger is authoritative. */ }
}
