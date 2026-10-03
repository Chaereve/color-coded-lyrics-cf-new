/* DEMO ONLY. K-pop beginner questions, deliberately different from the
   production question bank in Postgres. Cannot authorize real rewards.
   Existing rounds keep their snapshots/drafts; the new bank is for new rounds.
   The shapes returned here are identical to the server RPCs so the shared
   validators and the UI exercise exactly one contract. */
import { spinDay, nextSpinReset } from './dailySpin.js'
import { DAILY_LOGIN_REWARD, DAILY_QUIZ_QUESTIONS, MAX_DAILY_QUIZ_VOTES,
  validateQuizAnswer } from './dailyRewards.js'
import { checkInStats, isCalendarMonth } from './checkInCalendar.js'

const BANK = [
  { id: 'demo-kpop-butter', category: 'Songs', prompt: 'Which K-pop group released "Butter"?', options: ['BTS', 'BLACKPINK', 'TWICE', 'EXO'], correct_option: 0, explanation: '"Butter" is a hit single by BTS.' },
  { id: 'demo-kpop-hylt', category: 'Songs', prompt: 'Which K-pop group sings "How You Like That"?', options: ['TWICE', 'BLACKPINK', 'ITZY', 'aespa'], correct_option: 1, explanation: '"How You Like That" is a BLACKPINK song.' },
  { id: 'demo-kpop-what-is-love', category: 'Songs', prompt: 'Which K-pop group released "What is Love?"?', options: ['Red Velvet', 'BLACKPINK', 'TWICE', 'IVE'], correct_option: 2, explanation: 'TWICE released the hit song "What is Love?".' },
  { id: 'demo-kpop-seven', category: 'Members', prompt: 'Which BTS member sings the solo hit "Seven"?', options: ['RM', 'Jin', 'SUGA', 'Jungkook'], correct_option: 3, explanation: '"Seven" is Jungkook’s solo single, featuring Latto.' },
  { id: 'demo-kpop-cheer-up', category: 'Lyrics', prompt: 'Which TWICE song has the famous "shy, shy, shy" hook?', options: ['TT', 'CHEER UP', 'LIKEY', 'Fancy'], correct_option: 1, explanation: '"CHEER UP" is known for its "shy shy shy" chorus.' },
  { id: 'demo-kpop-on-the-ground', category: 'Members', prompt: 'Which BLACKPINK member released "On The Ground"?', options: ['Lisa', 'Rosé', 'Jennie', 'Jisoo'], correct_option: 1, explanation: '"On The Ground" is Rosé’s solo debut single.' },
  { id: 'demo-kpop-dna', category: 'Songs', prompt: 'Which K-pop group released "DNA"?', options: ['Stray Kids', 'EXO', 'BTS', 'SEVENTEEN'], correct_option: 2, explanation: '"DNA" is a hit song by BTS.' },
  { id: 'demo-kpop-pink-venom', category: 'Songs', prompt: 'Which K-pop group sings "Pink Venom"?', options: ['TWICE', 'Red Velvet', 'ITZY', 'BLACKPINK'], correct_option: 3, explanation: '"Pink Venom" is a BLACKPINK song from Born Pink.' },
  { id: 'demo-kpop-maniac', category: 'Lyrics', prompt: 'Which Stray Kids song repeats "MANIAC" in its chorus?', options: ['MANIAC', 'God’s Menu', 'Thunderous', 'CASE 143'], correct_option: 0, explanation: '"MANIAC" is the title track of Stray Kids’ ODDINARY.' },
  { id: 'demo-kpop-psycho', category: 'Songs', prompt: 'Which K-pop girl group sings "Psycho"?', options: ['BLACKPINK', 'Red Velvet', 'TWICE', 'aespa'], correct_option: 1, explanation: '"Psycho" is a Red Velvet song.' },
  { id: 'demo-kpop-supernova', category: 'Songs', prompt: 'Which K-pop girl group released "Supernova"?', options: ['ITZY', 'IVE', 'aespa', 'TWICE'], correct_option: 2, explanation: '"Supernova" is a hit single by aespa.' },
  { id: 'demo-kpop-i-am', category: 'Songs', prompt: 'Which K-pop girl group sings "I AM"?', options: ['aespa', 'BLACKPINK', 'Red Velvet', 'IVE'], correct_option: 3, explanation: '"I AM" is a song by IVE.' },
  { id: 'demo-kpop-dynamite-hook', category: 'Lyrics', prompt: 'Which BTS song contains the hook "’Cause I-I-I’m in the stars tonight"?', options: ['Dynamite', 'Butter', 'Life Goes On', 'Boy With Luv'], correct_option: 0, explanation: '"Dynamite" opens with that line.' },
  { id: 'demo-kpop-ddu-du-hook', category: 'Lyrics', prompt: 'Which BLACKPINK song repeats "ddu-du ddu-du du"?', options: ['Whistle', 'DDU-DU DDU-DU', 'Boombayah', 'Stay'], correct_option: 1, explanation: 'The hook gives "DDU-DU DDU-DU" its name.' },
  { id: 'demo-kpop-gangnam-hook', category: 'Lyrics', prompt: 'Which K-pop global hit includes "Oppan Gangnam Style"?', options: ['Gangnam Style', 'Gentleman', 'Daddy', 'Hangover'], correct_option: 0, explanation: 'PSY’s "Gangnam Style" made that phrase world-famous.' },
  { id: 'demo-kpop-super-shy-hook', category: 'Lyrics', prompt: 'Which NewJeans song repeats "I’m super shy, super shy"?', options: ['Ditto', 'Hype Boy', 'Super Shy', 'Cool With You'], correct_option: 2, explanation: '"Super Shy" became a viral hook in 2023.' },
  { id: 'demo-kpop-leader-bts', category: 'Members', prompt: 'Who is the leader of BTS?', options: ['RM', 'Jin', 'SUGA', 'j-hope'], correct_option: 0, explanation: 'RM is the leader of BTS.' },
  { id: 'demo-kpop-maknae-blackpink', category: 'Members', prompt: 'Who is the maknae (youngest member) of BLACKPINK?', options: ['Lisa', 'Rosé', 'Jennie', 'Jisoo'], correct_option: 0, explanation: 'Lisa, born in 1997, is the youngest BLACKPINK member.' },
  { id: 'demo-kpop-leader-twice', category: 'Members', prompt: 'Who is the leader of TWICE?', options: ['Jihyo', 'Nayeon', 'Sana', 'Mina'], correct_option: 0, explanation: 'Jihyo is the leader of TWICE.' },
  { id: 'demo-kpop-cupid', category: 'Songs', prompt: 'Which K-pop group released the viral song "Cupid"?', options: ['FIFTY FIFTY', 'IVE', 'aespa', 'Kep1er'], correct_option: 0, explanation: '"Cupid" by FIFTY FIFTY went viral worldwide in 2023.' },
  { id: 'demo-kpop-tomboy', category: 'Songs', prompt: 'Which K-pop group released the hit song "TOMBOY"?', options: ['(G)I-DLE', 'ITZY', 'MAMAMOO', 'Red Velvet'], correct_option: 0, explanation: '"TOMBOY" is a 2022 hit by (G)I-DLE.' },
  { id: 'demo-kpop-midzy', category: 'Fandom', prompt: 'What are ITZY fans called?', options: ['MIDZY', 'MY', 'DIVE', 'Atiny'], correct_option: 0, explanation: 'ITZY’s fandom name is MIDZY.' },
  { id: 'demo-kpop-my', category: 'Fandom', prompt: 'What are aespa fans called?', options: ['MY', 'DIVE', 'NCTzen', 'MOA'], correct_option: 0, explanation: 'aespa’s fandom name is MY.' },
  { id: 'demo-kpop-carat', category: 'Fandom', prompt: 'What are SEVENTEEN fans called?', options: ['CARAT', 'MOA', 'ENGENE', 'STAY'], correct_option: 0, explanation: 'SEVENTEEN’s fandom name is CARAT.' },
  { id: 'demo-kpop-gender-blackpink', category: 'Groups', prompt: 'Is BLACKPINK a girl group or a boy group?', options: ['Girl group', 'Boy group', 'Co-ed group', 'Solo act'], correct_option: 0, explanation: 'BLACKPINK is a four-member girl group.' },
  { id: 'demo-kpop-count-seventeen', category: 'Groups', prompt: 'How many members does SEVENTEEN have?', options: ['13', '17', '7', '9'], correct_option: 0, explanation: 'SEVENTEEN has 13 members in three units.' },
  { id: 'demo-kpop-company-twice', category: 'Groups', prompt: 'Which company formed TWICE?', options: ['JYP Entertainment', 'YG Entertainment', 'SM Entertainment', 'HYBE'], correct_option: 0, explanation: 'TWICE was formed by JYP Entertainment.' },
  { id: 'demo-kpop-debut-bts', category: 'Groups', prompt: 'In which year did BTS debut?', options: ['2013', '2015', '2010', '2018'], correct_option: 0, explanation: 'BTS debuted on 13 June 2013.' },
  { id: 'demo-kpop-leader-aespa', category: 'Members', prompt: 'Who is the leader of aespa?', options: ['Karina', 'Giselle', 'Winter', 'Ningning'], correct_option: 0, explanation: 'Karina is the leader of aespa.' },
  { id: 'demo-kpop-leader-ateez', category: 'Members', prompt: 'Who is the leader of ATEEZ?', options: ['Hongjoong', 'Seonghwa', 'Yunho', 'Jongho'], correct_option: 0, explanation: 'Hongjoong leads ATEEZ and produces much of their music.' },
  { id: 'demo-kpop-maknae-itzy', category: 'Members', prompt: 'Who is the maknae of ITZY?', options: ['Yuna', 'Yeji', 'Chaeryeong', 'Ryujin'], correct_option: 0, explanation: 'Yuna is the youngest member of ITZY.' },
  { id: 'demo-kpop-realname-v', category: 'Members', prompt: 'Which BTS member’s real name is Kim Tae-hyung?', options: ['V', 'RM', 'Jimin', 'Jin'], correct_option: 0, explanation: 'V was born Kim Tae-hyung.' },
  { id: 'demo-kpop-fandom-bunnies', category: 'Fandom', prompt: 'What are NewJeans fans called?', options: ['Bunnies', 'Tokkis', 'Carats', 'DIVE'], correct_option: 0, explanation: 'NewJeans’ fandom name is Bunnies.' },
  { id: 'demo-kpop-fandom-exo-l', category: 'Fandom', prompt: 'What are the fans of K-pop group EXO called?', options: ['EXO-L', 'EXO-M', 'EXO-K', 'Eris'], correct_option: 0, explanation: 'EXO-L stands for EXO-Love.' },
  { id: 'demo-kpop-title-fake-love', category: 'Lyrics', prompt: 'Finish this BTS song title: "Fake ___"', options: ['Love', 'Hope', 'Smile', 'Friends'], correct_option: 0, explanation: '"Fake Love" was released in 2018.' },
  { id: 'demo-kpop-title-dalla-dalla', category: 'Lyrics', prompt: 'Which K-pop group debuted with the song "DALLA DALLA"?', options: ['ITZY', 'aespa', 'IVE', 'NMIXX'], correct_option: 0, explanation: 'ITZY debuted in 2019 with "DALLA DALLA".' },
]

const OPTION_IDS = ['opt-a', 'opt-b', 'opt-c', 'opt-d']

// The demo bank mirrors the production metadata so the same selection rules,
// the same validators and the same UI apply offline.
const demoDifficulty = (id, index) => (index % 5 < 2 ? 'easy' : 'medium')
const decorated = BANK.map((q, index) => ({
  ...q,
  option_ids: OPTION_IDS,
  correct_option_id: OPTION_IDS[q.correct_option],
  difficulty: demoDifficulty(q.id, index),
  sub_category: q.category === 'Lyrics' ? 'lyrics' : 'profile',
  question_type: 'mcq',
}))

const shuffle = (pool, random) => {
  const copy = [...pool]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/* Same rules as the server: five questions in the launch mix (2 easy +
   3 medium), at most two per artist, and no question the player saw in the
   last 90 days while the bank can still supply alternatives. */
const drawQuestions = (seen, random) => {
  const ranked = shuffle(decorated, random)
    .sort((a, b) => Number(seen.includes(a.id)) - Number(seen.includes(b.id)))
  const picked = []
  const perArtist = {}
  const take = (difficulty, count) => {
    for (const q of ranked) {
      if (count <= 0) return
      if (q.difficulty !== difficulty || picked.includes(q)) continue
      const artist = q.prompt.slice(0, 24)
      if ((perArtist[artist] || 0) >= 2) continue
      perArtist[artist] = (perArtist[artist] || 0) + 1
      picked.push(q)
      count--
    }
  }
  take('easy', 2)
  take('medium', 3)
  return structuredClone(picked)
}

const publicQuestion = (q, answered) => answered
  ? { id: q.id, prompt: q.prompt, options: q.options, option_ids: q.option_ids, category: q.category,
      difficulty: q.difficulty, sub_category: q.sub_category, question_type: q.question_type,
      answered: true, option_id: q.answered_option_id, correct: q.correct, awarded: q.awarded,
      correct_option_id: q.correct_option_id, explanation: q.explanation }
  : { id: q.id, prompt: q.prompt, options: q.options, option_ids: q.option_ids, category: q.category,
      difficulty: q.difficulty, sub_category: q.sub_category, question_type: q.question_type,
      answered: false }

const quizState = quiz => {
  if (!quiz) return { state: 'ready', question_count: DAILY_QUIZ_QUESTIONS, max_votes: MAX_DAILY_QUIZ_VOTES }
  // A round stored by an older version of the quiz keeps its history but can
  // no longer award votes — exactly what the production payload reports.
  if (quiz.questions.length !== DAILY_QUIZ_QUESTIONS) return { state: 'retired' }
  const answeredCount = quiz.questions.filter(q => q.answered).length
  const locked = answeredCount === DAILY_QUIZ_QUESTIONS
  return {
    state: locked ? 'completed' : 'in_progress',
    attempt_id: quiz.attempt_id,
    quiz_date: quiz.day,
    question_count: DAILY_QUIZ_QUESTIONS,
    max_votes: MAX_DAILY_QUIZ_VOTES,
    votes_awarded: quiz.questions.reduce((sum, q) => sum + (q.awarded || 0), 0),
    answered_count: answeredCount,
    locked,
    submitted_at: locked ? quiz.updated_at : null,
    questions: quiz.questions.map(q => publicQuestion(q, q.answered)),
  }
}

export function demoDailyRewards({ entries = { logins: [], quizzes: [] }, profile, userId,
  action = 'status', expectedDay, attemptId, questionId, optionId, month, now = Date.now(),
  random = Math.random, newId = () => crypto.randomUUID(),
}) {
  entries = structuredClone(entries)
  profile = { ...profile }
  const day = spinDay(now)
  const at = new Date(now).toISOString()
  let replayed = false, reward, score

  const todayQuiz = () => entries.quizzes.find(q => q.day === day)

  if (action === 'month') {
    // Read-only calendar browsing: the real ledger, never future days.
    if (!isCalendarMonth(month)) throw new Error('err.dailyResponse')
    const ledger = [...new Set((entries.logins || []).map(l => l.day))].sort()
    return { entries, profile, data: { user_id: userId, month, day,
      days: ledger.filter(d => d.startsWith(`${month}-`) && d <= day) } }
  }

  if (action === 'claim') {
    replayed = entries.logins.some(l => l.day === expectedDay)
    if (!replayed) {
      if (expectedDay !== day) throw new Error('err.dailyDayChanged')
      entries.logins.push({ day, created_at: at })
      profile.bonus_credits += DAILY_LOGIN_REWARD
    }
    reward = DAILY_LOGIN_REWARD
  } else if (action === 'start') {
    if (expectedDay !== day) throw new Error('err.dailyDayChanged')
    replayed = !!todayQuiz()
    if (!replayed) {
      const seen = (entries.quizzes || []).filter(q => q.day > shiftDays(day, -90))
        .flatMap(q => q.questions.map(item => item.id))
      entries.quizzes.push({ attempt_id: newId(), day, questions: drawQuestions(seen, random),
        updated_at: at })
    }
  } else if (action === 'answer') {
    const quiz = entries.quizzes.find(q => q.attempt_id === attemptId)
    if (!quiz) throw new Error('err.dailyQuizSession')
    if (quiz.day !== day) throw new Error('err.dailyDayChanged')
    const answer = validateQuizAnswer(questionId, optionId)
    const question = quiz.questions.find(q => q.id === answer.question_id)
    if (!question) throw new Error('err.dailyQuizQuestion')
    if (!question.option_ids.includes(answer.option_id)) throw new Error('err.dailyQuizOption')
    replayed = !!question.answered
    if (!replayed) {
      const correct = answer.option_id === question.correct_option_id
      const awardedAlready = quiz.questions.reduce((sum, q) => sum + (q.awarded || 0), 0)
      const awarded = correct && awardedAlready < MAX_DAILY_QUIZ_VOTES ? 1 : 0
      question.answered = true
      question.answered_option_id = answer.option_id
      question.correct = correct
      question.awarded = awarded
      quiz.updated_at = at
      if (awarded) profile.bonus_credits += awarded
    }
    reward = question.awarded
    score = quiz.questions.reduce((sum, q) => sum + (q.awarded || 0), 0)
  }

  // Recomputed after the action: a fresh claim must appear on the calendar.
  const allDays = [...new Set((entries.logins || []).map(l => l.day))].sort()
  const claimed = entries.logins.some(l => l.day === day)
  const claimedDays = allDays.filter(d => d.startsWith(`${day.slice(0, 7)}-`) && d <= day)
  const stats = checkInStats(allDays, day)
  const quiz = todayQuiz()
  const status = {
    user_id: userId, day, server_now: at, reset_at: nextSpinReset(now),
    purchased: profile.vote_credits || 0, bonus: profile.bonus_credits || 0,
    credits: (profile.vote_credits || 0) + (profile.bonus_credits || 0),
    login: { claimed, reward: DAILY_LOGIN_REWARD, claimed_days: claimedDays,
      total_days: stats.total, first_day: stats.first, streak: stats.streak, best_streak: stats.best },
    earned_today: (claimed ? DAILY_LOGIN_REWARD : 0) + (quiz?.questions.reduce((sum, q) => sum + (q.awarded || 0), 0) || 0),
    quiz: quizState(quiz),
  }
  return { entries, profile, data: { status, replayed, reward, score } }
}

function shiftDays(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}
