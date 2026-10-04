import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import DailyLoginCalendar from './DailyLoginCalendar'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { hasSupabase, fetchDailyRewardsStatus, claimDailyLogin, startDailyQuiz,
  submitDailyQuizAnswer, fetchCheckInMonth } from '../lib/db'
import {
  DAILY_QUIZ_QUESTIONS, QUIZ_CORRECT_REWARD, MAX_DAILY_QUIZ_VOTES,
  DAILY_REWARDS_SYNC_KEY, readQuizDraft, saveQuizDraft, announceDailyRewardsChange,
  orderedOptions,
} from '../lib/dailyRewards.js'
import { SPIN_SYNC_KEY, announceSpinChange } from '../lib/spinDevice.js'
import { spinCountdown } from '../lib/dailySpin.js'
import './DailyRewards.css'

/* Two independent screens share the same ledger/controller. App never
   renders them together, and the wheel remains on its own route. */
export default function DailyRewards({ kind, userId, onBalance }) {
  const { t } = useI18n()
  const isQuiz = kind === 'quiz'
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Draft selections only: question id -> stable option id. Correctness,
  // votes and the final answer live on the server.
  const [answers, setAnswers] = useState({})
  const [step, setStep] = useState(0)
  const [deadline, setDeadline] = useState(null)
  const [clock, setClock] = useState(() => performance.now())
  const mounted = useRef(false)
  const busy = useRef(false)
  const readVersion = useRef(0)
  const attemptRef = useRef(null)
  const dayRef = useRef(null)
  const questionRef = useRef(null)
  const formRef = useRef(null)

  // Read-only calendar browsing; an old server simply reports no history.
  const loadMonth = useCallback(month => fetchCheckInMonth(userId, month), [userId])

  const applyStatus = useCallback(next => {
    if (next?.user_id !== userId) throw new Error('err.dailyAccountChanged')
    const now = performance.now()
    setDeadline(now + Math.max(0, Date.parse(next.reset_at) - Date.parse(next.server_now)))
    setClock(now)
    if (next.day !== dayRef.current) { setNotice(''); dayRef.current = next.day }
    const quiz = next.quiz
    if (quiz?.attempt_id !== attemptRef.current) {
      attemptRef.current = quiz?.attempt_id
      const draft = readQuizDraft(userId, quiz?.attempt_id)
      setAnswers(draft)
      const firstOpen = quiz?.questions?.findIndex(q => !q.answered) ?? -1
      setStep(firstOpen < 0 ? Math.max(0, (quiz?.questions?.length || 1) - 1) : firstOpen)
    } else if (quiz?.completed) setAnswers({})
    setStatus(next)
    onBalance(next)
  }, [userId, onBalance])

  const load = useCallback(async () => {
    if (busy.current) return
    const version = ++readVersion.current
    try {
      const next = await fetchDailyRewardsStatus(userId)
      if (!mounted.current || version !== readVersion.current || busy.current) return
      applyStatus(next)
      setError('')
    } catch (e) {
      if (mounted.current && version === readVersion.current) setError(errMsg(t, e))
    } finally {
      if (mounted.current && version === readVersion.current) setLoading(false)
    }
  }, [userId, applyStatus, t])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (!document.hidden) load() }
    const storage = e => { if ([DAILY_REWARDS_SYNC_KEY, SPIN_SYNC_KEY].includes(e.key)) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', refresh)
    const tick = setInterval(() => setClock(performance.now()), 1000)
    const poll = setInterval(refresh, 60_000)
    return () => {
      mounted.current = false
      clearInterval(tick); clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  useEffect(() => {
    if (deadline === null) return
    const id = setTimeout(load, Math.max(500, deadline - performance.now() + 100))
    return () => clearTimeout(id)
  }, [deadline, load])

  const run = async actionKind => {
    if (busy.current || !status || (isQuiz ? actionKind === 'claim' : actionKind !== 'claim')) return
    busy.current = true
    ++readVersion.current // a read that began before this mutation cannot undo it
    setAction(actionKind); setError(''); setNotice(''); setLoading(false)
    let refreshDay = false
    try {
      const data = actionKind === 'claim' ? await claimDailyLogin(userId, status.day)
        : actionKind === 'start' ? await startDailyQuiz(userId, status.day)
          : await submitDailyQuizAnswer(userId, status.quiz.attempt_id,
              status.quiz.questions[step].id, answers[status.quiz.questions[step].id])
      announceDailyRewardsChange()
      announceSpinChange()
      // A committed result still updates the wallet after leaving this page;
      // the parent also verifies user_id, so account changes cannot leak it.
      if (!mounted.current) { onBalance(data.status); return }
      applyStatus(data.status)
      if (actionKind === 'claim') setNotice(t(data.replayed ? 'daily.alreadyClaimed' : 'daily.claimSuccess'))
      if (actionKind === 'answer') {
        // The server decides: the toast reports what was actually awarded.
        setNotice(t(data.replayed ? 'daily.answerLocked'
          : data.correct ? 'daily.answerCorrect' : 'daily.answerWrong', { n: data.awarded }))
      }
      if (actionKind === 'start') requestAnimationFrame(() => questionRef.current?.focus())
    } catch (e) {
      if (mounted.current) {
        setError(errMsg(t, e))
        refreshDay = e?.message === 'err.dailyDayChanged'
      }
    } finally {
      busy.current = false
      if (mounted.current) {
        setAction(null)
        if (refreshDay) load()
      }
    }
  }

  const attemptId = status?.quiz?.attempt_id
  const quiz = status?.quiz
  const questions = quiz?.questions || []
  const question = questions[step]
  const liveQuestion = isQuiz && question && !question.answered && !quiz.locked
  // Options are shown in a shuffled order but always submitted by stable id.
  const options = useMemo(
    () => (question ? orderedOptions(question, attemptId) : []),
    [question, attemptId])
  const selected = question ? answers[question.id] : null

  const choose = useCallback(optionId => {
    const current = question
    if (!current || current.answered) return
    setAnswers(prev => {
      const next = { ...prev, [current.id]: optionId }
      saveQuizDraft(userId, attemptId, next)
      return next
    })
  }, [userId, attemptId, question])

  const move = useCallback(value => {
    setStep(value)
    requestAnimationFrame(() => questionRef.current?.focus())
  }, [])

  // Keyboard play: 1–4 picks an option, arrows move, Enter submits the answer.
  useEffect(() => {
    if (!isQuiz || !liveQuestion || !status || !!action) return
    const onKey = event => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input:not([type=radio]), textarea, select')) return
      const digit = ['1', '2', '3', '4'].indexOf(event.key)
      if (digit >= 0) { event.preventDefault(); choose(options[digit]?.id); return }
      if (event.key === 'ArrowRight' && step < DAILY_QUIZ_QUESTIONS - 1) { event.preventDefault(); move(step + 1) }
      if (event.key === 'ArrowLeft' && step > 0) { event.preventDefault(); move(step - 1) }
      if (event.key === 'Enter' && !(target instanceof HTMLElement && target.tagName === 'BUTTON')) {
        event.preventDefault()
        if (selected) formRef.current?.requestSubmit()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isQuiz, liveQuestion, action, status, step, options, selected, choose, move])

  const categoryLabel = category => {
    const label = t(`daily.cat.${category}`)
    return label === `daily.cat.${category}` ? category : label
  }
  const answeredCount = quiz?.answered_count ?? questions.filter(q => q.answered).length
  const votesToday = quiz?.votes_awarded ?? 0
  const disabled = loading || !!action || !status
  const titleId = `daily-${kind}-title`
  const unavailable = isQuiz && quiz?.state === 'unavailable'
  const retired = isQuiz && quiz?.state === 'retired'

  return (
    <section className={`daily-rewards ${isQuiz ? 'music-quiz-page' : 'daily-login-page'}`} aria-labelledby={titleId} aria-busy={loading || !!action}>
      <header className="daily-rewards-head">
        <div>
          <h2 id={titleId}>{t(isQuiz ? 'daily.quizHeading' : 'daily.loginHeading')}</h2>
          <p>{isQuiz ? t('daily.quizSubtitle', { n: MAX_DAILY_QUIZ_VOTES }) : t('daily.loginSubtitle')}</p>
        </div>
        <div className="daily-rewards-reset" title={t('daily.resetRule')}>
          <span>{t('daily.nextReset')}</span>
          <b>{deadline === null ? '--:--:--' : spinCountdown(deadline - clock)}</b>
        </div>
      </header>
      {!hasSupabase && <p className="daily-demo">{t('daily.demo')}</p>}
      {error && <div className="daily-error" role="alert">
        <span>{error}</span>
        <button type="button" className="btn btn-sm" disabled={!!action} onClick={load}>{t('daily.refresh')}</button>
      </div>}
      <div className="daily-missions">
        {!isQuiz && <article className={`daily-mission${status?.login.claimed ? ' is-complete' : ''}`}>
          <div className="daily-mission-heading">
            <span className="daily-mission-icon"><Icon name="calendar" size={21} /></span>
            <h3>{t('daily.loginTitle')}</h3>
          </div>
          <p>{t(status?.login.claimed ? 'daily.loginDone' : 'daily.loginDesc')}</p>
          {status && <DailyLoginCalendar status={status} disabled={disabled} onClaim={() => run('claim')} loadMonth={loadMonth} />}
          <button type="button" className={`btn${status?.login.claimed ? ' btn-ok' : ' btn-primary'} daily-claim`}
            disabled={disabled || status?.login.claimed} onClick={() => run('claim')}>
            {status?.login.claimed && <Icon name="check" size={15} />}
            {t(action === 'claim' ? 'daily.claiming' : status?.login.claimed ? 'daily.claimed' : 'daily.claim')}
          </button>
        </article>}
        {isQuiz && <article className={`daily-mission${quiz?.locked ? ' is-complete' : ''}`}>
          <div className="daily-mission-heading">
            <span className="daily-mission-icon"><Icon name="quiz" size={21} /></span>
            <h3>{t('daily.quizTitle')}</h3>
            <span className="daily-quiz-level">{t('daily.easy')}</span>
            <b className="daily-reward-tag">{t('daily.upTo', { n: MAX_DAILY_QUIZ_VOTES })}</b>
          </div>
          <p>{t('daily.quizDesc', { total: DAILY_QUIZ_QUESTIONS, n: QUIZ_CORRECT_REWARD, max: MAX_DAILY_QUIZ_VOTES })}</p>
          <p className="daily-quiz-topics">{t('daily.quizTopics')}</p>
          {quiz && ['in_progress', 'completed'].includes(quiz.state) && <p className="daily-quiz-votes">
            <b>{t('daily.votesToday', { n: votesToday, max: MAX_DAILY_QUIZ_VOTES })}</b>
          </p>}
          {unavailable && <div className="daily-quiz-unavailable" role="status">
            <h3>{t('daily.quizUnavailableTitle')}</h3>
            <p>{t('daily.quizUnavailableBody')}</p>
          </div>}
          {retired && <div className="daily-quiz-unavailable" role="status">
            <h3>{t('daily.savedRound')}</h3>
            <p>{t('daily.quizRetiredBody')}</p>
          </div>}
          {/* No round yet (or the status has not loaded): the launch control is
              always present so the page never looks broken, but it stays
              disabled until the server confirms a round can be drawn. */}
          {(!quiz || quiz.state === 'ready') && <div className="daily-quiz-launch">
            <button type="button" className="btn daily-quiz-start"
              disabled={disabled || quiz?.state !== 'ready'} onClick={() => run('start')}>
              {t(action === 'start' ? 'daily.starting' : 'daily.start')}
            </button>
            <span>{t('daily.quizStartHint', { total: DAILY_QUIZ_QUESTIONS, n: MAX_DAILY_QUIZ_VOTES })}</span>
          </div>}
          {quiz && ['in_progress', 'completed'].includes(quiz.state) && <span className="daily-quiz-state">
            <Icon name={quiz.locked ? 'check' : 'play'} size={15} />
            {quiz.locked
              ? t('daily.score', { score: votesToday, total: DAILY_QUIZ_QUESTIONS, n: votesToday })
              : t('daily.inProgress', { n: answeredCount, total: DAILY_QUIZ_QUESTIONS })}
          </span>}
        </article>}
      </div>
      {loading && <p className="daily-loading" role="status">{t('daily.loading')}</p>}
      <p className="daily-notice" role="status" aria-live="polite">{notice}</p>
      {isQuiz && question && !quiz.locked && <form className="daily-quiz" ref={formRef} onSubmit={e => {
        e.preventDefault()
        if (!disabled && selected && !question.answered) run('answer')
      }}>
        <div className="daily-quiz-progress">
          <b>{t('daily.question', { n: step + 1, total: DAILY_QUIZ_QUESTIONS })}</b>
          <span>{t('daily.answeredCount', { n: answeredCount, total: DAILY_QUIZ_QUESTIONS })}</span>
        </div>
        <div className="daily-quiz-track" aria-hidden="true">
          {questions.map((q, i) => <i key={q.id} className={`${q.answered ? ' answered' : ''}${i === step ? ' current' : ''}${q.correct === false ? ' is-wrong' : ''}`} />)}
        </div>
        <div className="daily-quiz-steps">
          {questions.map((q, i) => <button key={q.id} type="button" className={`daily-quiz-step${i === step ? ' is-current' : ''}${q.answered ? ' is-answered' : ''}`}
            aria-current={i === step ? 'step' : undefined} aria-label={t('daily.jumpQuestion', { n: i + 1 })}
            disabled={disabled} onClick={() => move(i)}>{i + 1}</button>)}
        </div>
        <div className="daily-quiz-card">
          <span className="daily-quiz-cat">{categoryLabel(question.category)}</span>
          <fieldset disabled={disabled || !!question.answered}>
            <legend ref={questionRef} tabIndex={-1}>{question.prompt}</legend>
            <div className="daily-quiz-options">
              {options.map((option, i) => <label key={option.id} className={selected === option.id ? ' selected' : ''}>
                <input type="radio" name={`daily-quiz-${question.id}`} value={option.id} checked={selected === option.id} onChange={() => choose(option.id)} />
                <b className="daily-quiz-key" aria-hidden="true">{'ABCD'[i]}</b>
                <span>{option.label}</span>
              </label>)}
            </div>
          </fieldset>
          {/* The verdict, the vote and the explanation come from the server and
              only exist once this answer has been locked in. */}
          {question.answered && <div className={`daily-quiz-verdict${question.correct ? ' is-correct' : ' is-wrong'}`} role="status">
            <b>{t(question.correct ? 'daily.answerCorrect' : 'daily.answerWrong', { n: question.awarded })}</b>
            {!question.correct && <span>{t('daily.correctAnswer', { answer: question.options[question.option_ids.indexOf(question.correct_option_id)] })}</span>}
            <span className="daily-explanation">{question.explanation}</span>
          </div>}
        </div>
        <div className="daily-quiz-actions">
          <button type="button" className="btn" disabled={disabled || step === 0} onClick={() => move(step - 1)}>{t('daily.back')}</button>
          {!question.answered
            ? <button type="submit" className="btn btn-primary daily-quiz-submit" disabled={disabled || !selected}>
              {t(action === 'answer' ? 'daily.submittingAnswer' : 'daily.submitAnswer')}
            </button>
            : step < DAILY_QUIZ_QUESTIONS - 1
              ? <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => move(step + 1)}>{t('daily.nextQuestion')}</button>
              : <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => move(firstOpenStep(questions, step))}>{t('daily.lastQuestion')}</button>}
        </div>
        <p className="daily-quiz-hint">{question.answered ? t('daily.answerLocked') : t('daily.pickOne')}</p>
      </form>}
      {isQuiz && quiz?.locked && <div className="daily-quiz-review">
        <div className="daily-quiz-result" data-score={votesToday}>
          <b>{votesToday}/{DAILY_QUIZ_QUESTIONS}</b>
          <strong>{t(votesToday === DAILY_QUIZ_QUESTIONS ? 'daily.perfect' : votesToday > 0 ? 'daily.great' : 'daily.tryAgain')}</strong>
          <span>{t('daily.resultSummary', { score: votesToday, total: DAILY_QUIZ_QUESTIONS, n: votesToday })}</span>
        </div>
        <h3 className="daily-quiz-review-title">{t('daily.reviewTitle')}</h3>
        <ol>{quiz.questions.map(q => {
          const pickedLabel = q.options[q.option_ids.indexOf(q.option_id)]
          return <li key={q.id} className={q.correct ? 'is-correct' : 'is-wrong'}>
            <h3><Icon name={q.correct ? 'check' : 'close'} size={16} /><span>{q.prompt}</span></h3>
            <p>{t('daily.yourAnswer', { answer: pickedLabel })}</p>
            {!q.correct && <p className="daily-correct-answer">{t('daily.correctAnswer', { answer: q.options[q.option_ids.indexOf(q.correct_option_id)] })}</p>}
            <p className="daily-explanation">{q.explanation}</p>
          </li>
        })}</ol>
        <p className="daily-quiz-next">{t('daily.nextQuizIn', { time: deadline === null ? '--:--:--' : spinCountdown(deadline - clock) })}</p>
      </div>}
      <footer className="daily-rewards-foot">
        <span>{!status ? t('daily.resetRule')
          : isQuiz ? t('daily.quizEarned', { n: votesToday })
            : t(status.login.claimed ? 'daily.checkedInToday' : 'daily.notCheckedIn')}</span>
        <span>{t(isQuiz ? 'daily.bonusRule' : 'daily.loginNoVotes')}</span>
      </footer>
    </section>
  )
}

// After the last answer, jump back to any question the player has not
// answered yet — otherwise "finish" simply stays on the review summary.
function firstOpenStep(questions, current) {
  const open = questions.findIndex(q => !q.answered)
  return open < 0 ? current : open
}
