#!/usr/bin/env node
// K-pop daily quiz bank validator.
//
//   node tools/validate-question-bank.mjs <input.csv> --offline
//   node tools/validate-question-bank.mjs <input.csv> --live
//   node tools/validate-question-bank.mjs <input.csv> --live --out validated.csv --report report.json
//
// --offline  Structural and editorial QA only. No network calls at all, so it
//            never invents link metadata.
// --live     Runs every offline check, then performs lawful public GETs for the
//            source URLs of records that are not already approved, records the
//            measured status / redirect chain / final URL / title, checks robots
//            rules, rate-limits per domain, and sets fact match from the page
//            content. Failures are set to needs_review or reject; nothing is
//            silently approved.
//
// Draft records (approval_status = pending_verification) are validated as
// drafts: their sentinel values are checked, the production thresholds are not
// applied, and they are reported as pending external validation.
//
// Exit status: 0 = no error-level failures, 1 = at least one error, 2 = usage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createLinkChecker, factMatch } from './question-bank/link-check.mjs'

const VERSION = '1.0.0'

const COLUMNS = ['id', 'category', 'sub_category', 'difficulty', 'question_type', 'question',
  'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'correct_answer', 'explanation',
  'artist_or_group', 'song_or_release', 'fact_type', 'time_scope', 'source_url', 'source_title',
  'source_tier', 'source_initial_http_status', 'source_final_http_status', 'source_final_url',
  'source_redirect_count', 'source_access_status', 'source_fact_match', 'source_evidence_locator',
  'source_last_checked', 'secondary_source_url', 'secondary_source_title',
  'secondary_initial_http_status', 'secondary_final_http_status', 'secondary_final_url',
  'secondary_redirect_count', 'secondary_evidence_locator', 'secondary_last_checked', 'last_verified',
  'lyrics_quote_word_count',
  'lyrics_quote_type', 'paraphrase_check', 'official_context_status', 'quality_score', 'factual_score',
  'source_score', 'link_integrity_score', 'clarity_score', 'fairness_score', 'copyright_score',
  'uniqueness_score', 'daily_eligibility_status', 'daily_selection_weight', 'cooldown_days',
  'retirement_status', 'last_content_reviewed', 'approval_status', 'rejection_reason', 'tags']

const PROFILE_SUBS = ['member', 'debut', 'release', 'discography', 'fandom', 'agency_or_label',
  'award', 'chart', 'sales_or_certification', 'mv_or_official_content', 'other_verified_fact']
const LYRICS_SUBS = ['lyrics_metadata', 'lyrics_theme', 'lyrics_context', 'lyrics_credit',
  'lyrics_language_or_version', 'lyrics_keyword']
const ACCESS_OK = ['public_accessible', 'accessible_with_redirect']
const ACCESS_BAD = ['retry_required', 'blocked', 'paywalled', 'login_required', 'region_restricted',
  'soft_404', 'dead', 'disallowed_domain', 'network_unavailable', 'unknown_not_observable']
const ACCESS_VALUES = [...ACCESS_OK, ...ACCESS_BAD]
const SCORE_CAPS = { factual_score: 25, source_score: 20, link_integrity_score: 15, clarity_score: 15, fairness_score: 15, copyright_score: 15, uniqueness_score: 10 }
const SCORE_MINS = { factual_score: 22, source_score: 16, link_integrity_score: 13, clarity_score: 12, fairness_score: 12, copyright_score: 13, uniqueness_score: 7 }
// Facts that need a second, independently validated source when the primary
// hop chain used a temporary redirect.
const HIGH_RISK_SUBS = new Set(['member', 'debut', 'release', 'discography', 'fandom',
  'agency_or_label', 'award', 'chart', 'sales_or_certification', 'mv_or_official_content',
  'lyrics_credit', 'lyrics_keyword', 'lyrics_theme', 'lyrics_context'])

const DRAFT_SENTINELS = {
  source_initial_http_status: 'unknown_not_observable',
  source_final_http_status: 'unknown_not_observable',
  source_final_url: '',
  source_redirect_count: 'unknown_not_observable',
  source_access_status: 'unknown_not_observable',
  source_fact_match: 'pending_external_validation',
  source_last_checked: ''
}

// Script ranges only: typographic punctuation such as U+2019 is not a script.
const NON_ENGLISH = /[\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3130-\u318F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/
const SENSITIVE = /\b(dating|dating rumou?r|girlfriend|boyfriend|marriage|divorce|pregnan|relationship status|sexual|height|weight|diet(?:ing)?|plastic surgery|cosmetic|attractive|ugliest|handsomest|body measur|mental health|depressi|anxiety|disab|illness|injur|self[-\s]?harm|suicid|passed away|death|died|politics|election|endors(e|ement)|immigration|visa|religio|race|ethnic|sexual orientation|gender identity|enlist|military service|lawsuit|allege|investigat|scandal|boycott|hate campaign|fan war|leak(ed)? content|sasaeng|most hated|least talented|worst singer|most controversial)\b/i
// Lyric completion, fill-in-the-blank and reconstruction formats are banned in
// every wording, including short "finish the title" and "___" placeholders.
const BANNED_FORMAT = /\b(next line|next word|next verse|complete the lyric|complete the title|complete this title|fill in the blank|fill the blank|fill in the missing|which word completes|which word comes|finish the lyric|finish this lyric|finish the song title|finish this song title|finish this title|missing word|missing lyric|what comes next|continue the lyric|continue the line|lyric reconstruction)\b|_{2,}/i
const TWO_QUESTIONS = /\?[^?]*\?|\b(which|who|what|when|where|how)\b[^?]*\band\b[^?]*\b(which|who|what|when|where|how)\b/i
const LOCATOR_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'page', 'lead', 'first', 'second', 'third', 'fourth', 'fifth', 'last', 'section', 'paragraph', 'infobox', 'table', 'list', 'track', 'notes', 'official', 'release', 'album', 'single', 'song', 'part', 'line', 'entry', 'category', 'chart', 'week', 'year', 'dated', 'credits', 'liner'])

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2)
const input = argv.find(a => !a.startsWith('--'))
const offline = argv.includes('--offline')
const live = argv.includes('--live')
const strictProduction = argv.includes('--strict-production')
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const outPath = flag('out')
const reportPath = flag('report')
const configPath = flag('config', 'tools/question-bank.config.json')

if (!input || (!offline && !live) || (offline && live)) {
  console.error('usage: node tools/validate-question-bank.mjs <input.csv> --offline|--live [--out validated.csv] [--report report.json] [--config tools/question-bank.config.json] [--strict-production]')
  process.exit(2)
}

const configFile = resolve(process.cwd(), configPath)
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {}
const cfg = {
  userAgent: config.userAgent || 'KpopQuizValidator/1.0 (contact: YOUR_EMAIL_OR_DOMAIN)',
  allowedDomains: Array.isArray(config.allowedDomains) ? config.allowedDomains.map(d => d.toLowerCase()) : [],
  requestsPerSecondPerDomain: Number(config?.rateLimit?.requestsPerSecondPerDomain ?? 0.5),
  maxRetries: Number(config?.rateLimit?.maxRetries ?? 2),
  retryBaseDelayMs: Number(config?.rateLimit?.retryBaseDelayMs ?? 1500),
  timeoutMs: Number(config?.rateLimit?.timeoutMs ?? 15000),
  maxRedirects: Number(config?.rateLimit?.maxRedirects ?? 3),
  dynamicDays: Number(config?.freshness?.dynamicDays ?? 30),
  evergreenDays: Number(config?.freshness?.evergreenDays ?? 90),
  domainConcurrency: Number(config?.concurrency?.domains ?? 4),
  minBodyChars: Number(config?.live?.minBodyChars ?? 400),
  respectRobots: config?.live?.respectRobots !== false,
  artistLimit: Number(config?.limits?.artistQuestions ?? 10),
  songLimit: Number(config?.limits?.songQuestions ?? 3)
}

// ------------------------------------------------------------------ CSV codec
function parseCsv (text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const csvCell = v => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
const toCsv = rows => [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(h => csvCell(r[h])).join(','))].join('\n') + '\n'
const words = s => String(s ?? '').trim().split(/\s+/).filter(Boolean)
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

// ------------------------------------------------------------------ reporting
const errors = []
const warnings = []
const byReason = new Map()
const errorIds = new Set()
const err = (code, message, id = '-', column = '') => {
  errors.push({ code, message, id, column })
  if (id && id !== '-') errorIds.add(id)
  byReason.set(`error:${code}`, (byReason.get(`error:${code}`) || 0) + 1)
}
const warn = (code, message, id = '-', column = '') => {
  warnings.push({ code, message, id, column })
  byReason.set(`warning:${code}`, (byReason.get(`warning:${code}`) || 0) + 1)
}

// ------------------------------------------------------------------ load rows
const raw = readFileSync(resolve(process.cwd(), input), 'utf8').replace(/^﻿/, '')
const table = parseCsv(raw)
const header = table[0] || []
if (header.join(',') !== COLUMNS.join(',')) {
  console.error('CSV header does not match the required schema.')
  const missing = COLUMNS.filter(c => !header.includes(c))
  const extra = header.filter(c => !COLUMNS.includes(c))
  if (missing.length) console.error('missing columns: ' + missing.join(', '))
  if (extra.length) console.error('unexpected columns: ' + extra.join(', '))
  process.exit(2)
}
const ragged = table.map((r, i) => ({ index: i + 1, len: r.length })).filter(r => r.len !== COLUMNS.length)
for (const r of ragged) err('csv_shape', `row ${r.index} has ${r.len} fields, expected ${COLUMNS.length}`, '-', '')

const rows = table.slice(1)
  .filter(r => r.some(v => String(v ?? '') !== ''))
  .map(r => Object.fromEntries(COLUMNS.map((h, i) => [h, r[i] ?? ''])))

// ------------------------------------------------------------------ offline QA
const seenIds = new Set()
const seenQuestions = new Map()
const factAtoms = new Map()
const perArtist = new Map()
const perSong = new Map()
const counts = {
  category: { profile: 0, lyrics: 0 },
  difficulty: { easy: 0, medium: 0, hard: 0 },
  questionType: { mcq: 0, true_false: 0 },
  tier: { A: 0, B: 0, C: 0, D: 0, E: 0 },
  approval: { approved: 0, pending_verification: 0, revise: 0, reject: 0 },
  eligibility: { eligible: 0, temporarily_ineligible: 0, needs_review: 0, retired: 0 },
  subCategory: {},
  zeroQuoteLyrics: 0,
  total: rows.length
}
const manualReview = []
const pendingExternal = []
const correctPositions = []

for (const r of rows) {
  const id = r.id || '(blank)'
  const isDraft = r.approval_status === 'pending_verification'
  const isApproved = r.approval_status === 'approved'
  if (Object.hasOwn(counts.approval, r.approval_status)) counts.approval[r.approval_status]++
  if (Object.hasOwn(counts.eligibility, r.daily_eligibility_status)) counts.eligibility[r.daily_eligibility_status]++

  // identity ----------------------------------------------------------------
  if (!r.id) err('missing_id', 'record has no id', id, 'id')
  if (seenIds.has(r.id)) err('duplicate_id', `id ${r.id} appears more than once`, id, 'id')
  seenIds.add(r.id)

  // enums -------------------------------------------------------------------
  if (r.category === 'profile' || r.category === 'lyrics') counts.category[r.category]++
  else err('bad_category', `category "${r.category}" is not profile or lyrics`, id, 'category')
  const subs = r.category === 'profile' ? PROFILE_SUBS : LYRICS_SUBS
  if (!subs.includes(r.sub_category)) err('bad_sub_category', `sub_category "${r.sub_category}" is not valid for ${r.category}`, id, 'sub_category')
  counts.subCategory[r.sub_category] = (counts.subCategory[r.sub_category] || 0) + 1
  if (!['easy', 'medium', 'hard'].includes(r.difficulty)) err('bad_difficulty', `difficulty "${r.difficulty}" is invalid`, id, 'difficulty')
  else counts.difficulty[r.difficulty]++
  if (!['mcq', 'true_false'].includes(r.question_type)) err('bad_question_type', `question_type "${r.question_type}" is invalid`, id, 'question_type')
  else counts.questionType[r.question_type]++
  if (!['A', 'B', 'C', 'D', 'E'].includes(r.source_tier)) err('bad_tier', `source_tier "${r.source_tier}" is invalid`, id, 'source_tier')
  else counts.tier[r.source_tier]++
  if (!ACCESS_VALUES.includes(r.source_access_status)) err('bad_access_status', `source_access_status "${r.source_access_status}" is not a permitted value`, id, 'source_access_status')
  if (!['pass', 'fail', 'pending_external_validation'].includes(r.source_fact_match)) err('bad_fact_match', `source_fact_match "${r.source_fact_match}" is invalid`, id, 'source_fact_match')
  if (!['none', 'keyword', 'short_quote'].includes(r.lyrics_quote_type)) err('bad_quote_type', `lyrics_quote_type "${r.lyrics_quote_type}" is invalid`, id, 'lyrics_quote_type')
  if (!['eligible', 'temporarily_ineligible', 'needs_review', 'retired'].includes(r.daily_eligibility_status)) err('bad_eligibility', `daily_eligibility_status "${r.daily_eligibility_status}" is invalid`, id, 'daily_eligibility_status')
  if (!['active', 'review_required', 'retired', 'superseded'].includes(r.retirement_status)) err('bad_retirement', `retirement_status "${r.retirement_status}" is invalid`, id, 'retirement_status')
  if (!['approved', 'pending_verification', 'revise', 'reject'].includes(r.approval_status)) err('bad_approval', `approval_status "${r.approval_status}" is invalid`, id, 'approval_status')

  // English, safety, wording ------------------------------------------------
  const userFacing = [r.question, r.option_a, r.option_b, r.option_c, r.option_d, r.correct_answer, r.explanation, r.tags]
  if (userFacing.some(v => NON_ENGLISH.test(v))) err('non_english', 'non-English characters in a user-facing field', id, 'question')
  if (SENSITIVE.test(userFacing.join(' '))) err('sensitive_content', 'sensitive-content pattern in a user-facing field', id, 'question')
  if (BANNED_FORMAT.test(r.question)) err('banned_lyric_format', 'lyric-completion or fill-in-the-blank format', id, 'question')
  if (TWO_QUESTIONS.test(r.question)) warn('multiple_fact_atoms', 'question reads as more than one fact atom', id, 'question')
  const qWords = words(r.question).length
  if (qWords < 4) err('question_too_short', `question has ${qWords} words`, id, 'question')
  if (qWords > 30) warn('question_too_long', `question has ${qWords} words (soft limit 30)`, id, 'question')
  if (words(r.explanation).length > 35) err('explanation_too_long', 'explanation exceeds 35 words', id, 'explanation')

  // answers -----------------------------------------------------------------
  if (r.question_type === 'true_false') {
    if (r.option_a !== 'True' || r.option_b !== 'False') err('tf_options', 'true_false needs option_a=True and option_b=False', id, 'option_a')
    if (r.option_c !== '' || r.option_d !== '') err('tf_options', 'true_false needs empty option_c and option_d', id, 'option_c')
    if (!['A', 'B'].includes(r.correct_option)) err('tf_correct_option', 'true_false correct_option must be A or B', id, 'correct_option')
    if (/\b(many|most|some|often|usually|always|never|best|greatest)\b/i.test(r.question)) err('tf_quantifier', 'true_false uses a vague quantifier', id, 'question')
  } else {
    const opts = [r.option_a, r.option_b, r.option_c, r.option_d]
    if (opts.some(o => String(o).trim() === '')) err('mcq_options', 'mcq needs exactly four non-empty options', id, 'option_a')
    if (new Set(opts).size !== 4) err('mcq_options', 'mcq options are not distinct', id, 'option_a')
    if (!['A', 'B', 'C', 'D'].includes(r.correct_option)) err('mcq_correct_option', 'mcq correct_option must be A, B, C or D', id, 'correct_option')
  }
  const selected = { A: r.option_a, B: r.option_b, C: r.option_c, D: r.option_d }[r.correct_option]
  if (selected !== r.correct_answer) err('answer_mismatch', 'correct_answer does not match the option selected by correct_option', id, 'correct_answer')
  if (r.question_type === 'mcq') correctPositions.push(r.correct_option)

  // lyrics policy -----------------------------------------------------------
  const quote = Number(r.lyrics_quote_word_count)
  if (!Number.isInteger(quote) || quote < 0) err('bad_quote_count', 'lyrics_quote_word_count must be an integer >= 0', id, 'lyrics_quote_word_count')
  if (quote > 8) err('quote_too_long', `lyric quote of ${quote} words exceeds the 8-word limit`, id, 'lyrics_quote_word_count')
  if (r.category === 'profile') {
    if (quote !== 0) err('profile_quote', 'profile records must have lyrics_quote_word_count = 0', id, 'lyrics_quote_word_count')
    if (r.paraphrase_check !== 'not_applicable' || r.official_context_status !== 'not_applicable') err('profile_lyrics_fields', 'profile records need not_applicable lyrics fields', id, 'paraphrase_check')
  } else {
    if (!r.song_or_release) err('missing_song', 'lyrics records require song_or_release', id, 'song_or_release')
    if (quote === 0) counts.zeroQuoteLyrics++
    if (quote === 0 && r.lyrics_quote_type !== 'none') err('quote_type_mismatch', 'zero-quote record must use lyrics_quote_type = none', id, 'lyrics_quote_type')
    if (quote > 0 && r.lyrics_quote_type === 'none') err('quote_type_mismatch', 'quoted record cannot use lyrics_quote_type = none', id, 'lyrics_quote_type')
    if (quote > 0 && r.sub_category !== 'lyrics_keyword') warn('quote_outside_keyword', 'quotation is only expected in lyrics_keyword records', id, 'sub_category')
    if (r.paraphrase_check !== 'pass') err('paraphrase', 'lyrics records require paraphrase_check = pass', id, 'paraphrase_check')
    if (!['official', 'reputable_editorial', 'metadata_only'].includes(r.official_context_status)) err('bad_context_status', 'official_context_status must be official, reputable_editorial or metadata_only', id, 'official_context_status')
    if (r.sub_category === 'lyrics_keyword' && !r.secondary_source_url) err('keyword_secondary', 'lyrics_keyword requires a secondary source', id, 'secondary_source_url')
  }

  // sources -----------------------------------------------------------------
  for (const [urlCol, titleCol] of [['source_url', 'source_title'], ['secondary_source_url', 'secondary_source_title']]) {
    const url = r[urlCol]
    if (!url) continue
    if (!/^https:\/\/[^\s]+\.[a-z]{2,}(\/|$)/i.test(url)) err('bad_url', `${urlCol} is not a canonical https URL: ${url}`, id, urlCol)
    if (/\/(search|results?)\?|\?s=|utm_|gclid=|fbclid=|^https:\/\/(t\.co|bit\.ly|tinyurl\.com|goo\.gl)\//i.test(url)) err('bad_url', `${urlCol} looks like a search, tracking or shortener URL`, id, urlCol)
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { /* handled above */ }
    if (host && cfg.allowedDomains.length && !cfg.allowedDomains.some(d => host === d || host.endsWith(`.${d}`))) {
      warn('domain_not_allowlisted', `${urlCol} host ${host} is not in the live-fetch allowlist`, id, urlCol)
    }
    if (!r[titleCol]) warn('missing_source_title', `${titleCol} is empty`, id, titleCol)
  }
  if (!r.source_url) err('missing_source', 'record has no source_url', id, 'source_url')
  if (!r.source_evidence_locator) err('missing_locator', 'source_evidence_locator is required', id, 'source_evidence_locator')
  if (!r.source_title) err('missing_source_title', 'source_title is required', id, 'source_title')

  // Link metadata may only hold measured values. Drafts use the documented
  // sentinel; approved records must carry a real status and redirect count.
  if (r.source_redirect_count === 'unknown_not_observable') {
    if (isApproved) err('bad_redirect_count', 'approved records need a measured source_redirect_count of 0-3', id, 'source_redirect_count')
  } else {
    const hops = Number(r.source_redirect_count)
    if (!Number.isInteger(hops) || hops < 0 || hops > 3) err('bad_redirect_count', 'source_redirect_count must be an integer 0-3', id, 'source_redirect_count')
  }
  if (isApproved && !/^\d{3}$/.test(r.source_initial_http_status) && r.source_initial_http_status !== 'unknown_not_observable') {
    err('bad_initial_status', 'source_initial_http_status must be a measured three-digit status or the draft sentinel', id, 'source_initial_http_status')
  }

  // dates -------------------------------------------------------------------
  for (const col of ['last_verified', 'last_content_reviewed']) {
    if (!isDate(r[col])) err('bad_date', `${col} must be YYYY-MM-DD`, id, col)
  }
  const dynamic = r.time_scope !== 'evergreen'
  const window = dynamic ? cfg.dynamicDays : cfg.evergreenDays
  if (isDate(r.last_verified) && daysBetween(r.last_verified, today()) > window) {
    (isApproved ? err : warn)('stale_verification', `last_verified is older than the ${window}-day ${dynamic ? 'dynamic' : 'evergreen'} window`, id, 'last_verified')
  }
  if (r.secondary_source_url) {
    // A draft keeps these blank until the secondary source has really been checked.
    if (!isDate(r.secondary_last_checked)) {
      if (isApproved) err('bad_date', 'secondary_last_checked must be YYYY-MM-DD when a secondary source exists', id, 'secondary_last_checked')
      else warn('secondary_unchecked', 'secondary source present but not yet validated', id, 'secondary_last_checked')
    } else if (isDate(r.last_verified) && r.secondary_last_checked < r.last_verified) {
      err('secondary_stale', 'secondary source was checked before the fact was verified', id, 'secondary_last_checked')
    }
  }

  // draft sentinels vs production requirements -------------------------------
  if (isDraft) {
    for (const [col, expected] of Object.entries(DRAFT_SENTINELS)) {
      if ((r[col] ?? '') !== expected) err('draft_sentinel', `draft record must set ${col} to ${expected === '' ? 'blank' : `"${expected}"`}`, id, col)
    }
    if (Number(r.link_integrity_score) !== 0) err('draft_sentinel', 'draft records must set link_integrity_score = 0', id, 'link_integrity_score')
    if (r.rejection_reason !== 'External live validation required before publication.') {
      err('draft_sentinel', 'draft records must carry the standard pending rejection reason', id, 'rejection_reason')
    }
    if (r.daily_eligibility_status !== 'temporarily_ineligible') err('draft_sentinel', 'draft records must be temporarily_ineligible', id, 'daily_eligibility_status')
    if (r.retirement_status !== 'review_required') err('draft_sentinel', 'draft records must be review_required', id, 'retirement_status')
    pendingExternal.push(r.id)
  }

  // scores -------------------------------------------------------------------
  let sum = 0
  for (const [col, cap] of Object.entries(SCORE_CAPS)) {
    const v = Number(r[col])
    if (!Number.isInteger(v)) { err('bad_score', `${col} must be an integer`, id, col); continue }
    if (v < 0 || v > cap) err('bad_score', `${col} ${v} is outside 0-${cap}`, id, col)
    if (isApproved && v < SCORE_MINS[col]) err('score_below_minimum', `${col} ${v} is below the ${SCORE_MINS[col]} approval minimum`, id, col)
    sum += v
  }
  if (Number(r.quality_score) !== sum) err('quality_sum', `quality_score ${r.quality_score} does not equal the subscore sum ${sum}`, id, 'quality_score')
  if (isApproved) {
    if (sum < 97) err('quality_below_threshold', `quality_score ${sum} is below the 97 approval threshold`, id, 'quality_score')
    if (['chart', 'award', 'sales_or_certification'].includes(r.sub_category) && Number(r.source_score) < 18) err('source_score_minimum', 'chart/award/sales records require source_score >= 18', id, 'source_score')
    if (['lyrics_credit', 'lyrics_keyword'].includes(r.sub_category) && Number(r.source_score) < 17) err('source_score_minimum', 'credit/keyword records require source_score >= 17', id, 'source_score')
    if (r.category === 'lyrics' && Number(r.copyright_score) < 13) err('copyright_score_minimum', 'lyrics records require copyright_score >= 13', id, 'copyright_score')
    if (!ACCESS_OK.includes(r.source_access_status)) err('source_not_accessible', `approved record has source_access_status ${r.source_access_status}`, id, 'source_access_status')
    if (r.source_fact_match !== 'pass') err('fact_match_not_passed', 'approved record must have source_fact_match = pass', id, 'source_fact_match')
    if (!r.source_final_url) err('missing_final_url', 'approved record must record a validated final URL', id, 'source_final_url')
    if (!/^\d{3}$/.test(r.source_final_http_status)) {
      err('bad_final_status', 'approved records need a measured three-digit source_final_http_status', id, 'source_final_http_status')
    } else if (r.source_final_http_status !== '200') {
      err('final_status_not_200', `source_final_http_status is ${r.source_final_http_status}; production requires 200 on the final URL`, id, 'source_final_http_status')
    }
    if (!/^\d{3}$/.test(r.source_initial_http_status)) {
      err('bad_initial_status', 'approved records need a measured three-digit source_initial_http_status', id, 'source_initial_http_status')
    }
    if (r.secondary_source_url) {
      if (!/^\d{3}$/.test(r.secondary_final_http_status)) err('bad_secondary_status', 'approved records need a measured three-digit secondary_final_http_status', id, 'secondary_final_http_status')
      else if (r.secondary_final_http_status !== '200') err('secondary_status_not_200', 'secondary_final_http_status must be 200', id, 'secondary_final_http_status')
      if (!r.secondary_final_url) err('missing_secondary_final_url', 'approved records need a validated secondary_final_url', id, 'secondary_final_url')
      const secondaryHops = Number(r.secondary_redirect_count)
      if (!Number.isInteger(secondaryHops) || secondaryHops < 0 || secondaryHops > 3) err('bad_secondary_redirect_count', 'secondary_redirect_count must be an integer 0-3', id, 'secondary_redirect_count')
    }
    if (!isDate(r.source_last_checked)) err('missing_source_check_date', 'approved record needs a validated source_last_checked', id, 'source_last_checked')
    else if (isDate(r.last_verified) && r.source_last_checked < r.last_verified) err('source_check_stale', 'source_last_checked is older than last_verified', id, 'source_last_checked')
    if (r.daily_eligibility_status !== 'eligible') err('not_eligible', 'approved record must be daily eligible', id, 'daily_eligibility_status')
    if (r.retirement_status !== 'active') err('not_active', 'approved record must have retirement_status = active', id, 'retirement_status')
    if (r.rejection_reason !== '') err('rejection_reason_not_blank', 'approved records must have a blank rejection_reason', id, 'rejection_reason')
  }

  const cooldown = Number(r.cooldown_days)
  if (!Number.isInteger(cooldown)) err('bad_cooldown', 'cooldown_days must be an integer', id, 'cooldown_days')
  else if (cooldown < 30) err('cooldown_too_short', 'cooldown_days must never be below 30', id, 'cooldown_days')
  const weight = Number(r.daily_selection_weight)
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) err('bad_weight', 'daily_selection_weight must be 1-100', id, 'daily_selection_weight')

  const tags = String(r.tags).split(';').map(t => t.trim()).filter(Boolean)
  if (tags.length < 1 || tags.length > 4) err('bad_tags', 'tags must hold 1-4 semicolon-separated values', id, 'tags')

  // duplicates and diversity --------------------------------------------------
  const normalised = r.question.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
  if (seenQuestions.has(normalised)) err('duplicate_question', `duplicate of ${seenQuestions.get(normalised)}`, id, 'question')
  seenQuestions.set(normalised, r.id)
  const atom = [r.artist_or_group, r.song_or_release, r.sub_category, normalised.split(' ').filter(w => w.length > 3).sort().join(' ')].join('|')
  if (factAtoms.has(atom)) warn('near_duplicate_fact', `near-duplicate fact atom of ${factAtoms.get(atom)}`, id, 'question')
  factAtoms.set(atom, r.id)

  if (r.artist_or_group) perArtist.set(r.artist_or_group, (perArtist.get(r.artist_or_group) || 0) + 1)
  if (r.song_or_release) perSong.set(r.song_or_release, (perSong.get(r.song_or_release) || 0) + 1)
}

for (const [artist, n] of perArtist) {
  if (n > cfg.artistLimit) err('artist_limit', `"${artist}" has ${n} questions (limit ${cfg.artistLimit})`, '-', 'artist_or_group')
}
for (const [song, n] of perSong) {
  if (n > cfg.songLimit) err('song_limit', `"${song}" has ${n} questions (limit ${cfg.songLimit})`, '-', 'song_or_release')
}

// distribution expectations (production scale; warnings at pilot scale)
const total = rows.length
const pct = n => (total ? Math.round((n / total) * 100) : 0)
if (total >= 100) {
  if (pct(counts.difficulty.easy) < 35 || pct(counts.difficulty.easy) > 45) warn('difficulty_mix', `easy share ${pct(counts.difficulty.easy)}% is outside 35-45%`, '-', 'difficulty')
  if (pct(counts.difficulty.medium) < 40 || pct(counts.difficulty.medium) > 50) warn('difficulty_mix', `medium share ${pct(counts.difficulty.medium)}% is outside 40-50%`, '-', 'difficulty')
  if (pct(counts.difficulty.hard) < 10 || pct(counts.difficulty.hard) > 20) warn('difficulty_mix', `hard share ${pct(counts.difficulty.hard)}% is outside 10-20%`, '-', 'difficulty')
  if (counts.questionType.true_false / total > 0.08) warn('tf_share', `true_false share ${pct(counts.questionType.true_false)}% exceeds the 8% cap`, '-', 'question_type')
  if (counts.category.profile < Math.ceil(total * 0.56)) warn('category_mix', `profile count ${counts.category.profile} is below the 56% share`, '-', 'category')
  if (perArtist.size < 60) warn('artist_diversity', `${perArtist.size} distinct artists (target 60 for a full bank)`, '-', 'artist_or_group')
}

for (const id of new Set([...pendingExternal])) manualReview.push({ id, reason: 'pending external live validation' })

// Shuffling safety: if every MCQ hides its answer in the same slot, the bank
// leaks the answer as soon as a user notices the pattern.
if (correctPositions.length >= 5 && new Set(correctPositions).size === 1) {
  warn('answer_position_bias', `every MCQ uses correct_option ${correctPositions[0]}`, '-', 'correct_option')
}

// ------------------------------------------------------------------ live pass
const sourceChecks = []
const deadLinks = []
const soft404 = []
const blocked = []
const redirects = []
const failedSources = []

function locatorTokens (locator) {
  return words(String(locator).toLowerCase().replace(/[^a-z0-9 ]/g, ' '))
    .filter(w => w.length > 3 && !LOCATOR_STOPWORDS.has(w))
}

const checker = createLinkChecker(cfg)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function runLive () {
  const byUrl = new Map()
  rows.forEach(r => {
    for (const url of [r.source_url, r.secondary_source_url].filter(Boolean)) {
      if (!byUrl.has(url)) byUrl.set(url, [])
      byUrl.get(url).push(r)
    }
  })

  const byHost = new Map()
  for (const url of byUrl.keys()) {
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch { continue }
    if (!byHost.has(host)) byHost.set(host, [])
    byHost.get(host).push(url)
  }

  const minInterval = 1000 / Math.max(0.1, cfg.requestsPerSecondPerDomain)
  const queue = [...byHost.entries()]
  const checkedAt = today()

  const worker = async () => {
    for (;;) {
      const entry = queue.shift()
      if (!entry) return
      const [, urls] = entry
      for (const [index, url] of urls.entries()) {
        if (index > 0) await sleep(minInterval)
        const host = new URL(url).hostname.toLowerCase()
        const permitted = cfg.allowedDomains.length === 0 || cfg.allowedDomains.some(d => host === d || host.endsWith(`.${d}`))
        if (!permitted) {
          sourceChecks.push({ url, host, accessStatus: 'disallowed_domain', factMatch: 'fail', checkedAt, note: 'host is not in the allowlist' })
          blocked.push(url)
          continue
        }
        const robots = await checker.robotsAllowed(url)
        if (!robots.allowed) {
          sourceChecks.push({ url, host, accessStatus: 'disallowed_domain', factMatch: 'fail', checkedAt, note: robots.note })
          blocked.push(url)
          continue
        }
        const result = await checker.fetchPage(url)
        const records = byUrl.get(url)
        const tokens = []
        for (const r of records) {
          tokens.push(...words(r.artist_or_group).filter(w => w.length > 2))
          tokens.push(...words(r.song_or_release).filter(w => w.length > 2 && !/^[\d\s]+$/.test(w)))
          tokens.push(...locatorTokens(r.source_evidence_locator))
        }
        const match = result.text
          ? factMatch(result.text, tokens)
          : { match: 'fail', hits: [], note: result.note || 'no page body retrieved' }
        const factMatchResult = match.match
        const evidence = match.note
        sourceChecks.push({
          url,
          host,
          initialStatus: result.initialStatus,
          finalStatus: result.finalStatus,
          finalUrl: result.finalUrl,
          redirectChain: result.chain,
          redirectCount: result.redirectCount,
          title: result.title,
          accessStatus: result.accessStatus,
          factMatch: factMatchResult,
          temporaryRedirect: result.temporaryRedirect,
          evidence,
          checkedAt,
          note: result.note,
          records: records.map(r => r.id)
        })
        if (result.redirectCount) redirects.push({ url, redirectCount: result.redirectCount, finalUrl: result.finalUrl })
        if (result.accessStatus === 'dead') deadLinks.push(url)
        if (result.accessStatus === 'soft_404') soft404.push(url)
        if (['blocked', 'paywalled', 'login_required', 'region_restricted', 'disallowed_domain'].includes(result.accessStatus)) blocked.push(url)
        if (!ACCESS_OK.includes(result.accessStatus) || factMatchResult === 'fail') failedSources.push(url)

        for (const r of records) {
          const primary = r.source_url === url
          if (primary) {
            r.source_initial_http_status = result.initialStatus === null ? 'unknown_not_observable' : String(result.initialStatus)
            r.source_final_http_status = result.finalStatus === null ? 'unknown_not_observable' : String(result.finalStatus)
            r.source_final_url = result.finalUrl || ''
            r.source_redirect_count = String(result.redirectCount)
            r.source_access_status = result.accessStatus
            r.source_fact_match = factMatchResult
            r.source_last_checked = checkedAt
            if (!String(r.source_title).trim() && result.title) r.source_title = result.title
            const ok = ACCESS_OK.includes(result.accessStatus) && factMatchResult === 'pass'
            if (!ok) {
              if (r.approval_status === 'approved') {
                r.approval_status = 'reject'
                r.daily_eligibility_status = 'retired'
                r.retirement_status = 'retired'
                r.daily_selection_weight = '1'
                r.rejection_reason = `source check: ${result.accessStatus}, fact match ${factMatchResult}`
              } else {
                r.approval_status = 'pending_verification'
                r.daily_eligibility_status = 'needs_review'
                r.retirement_status = 'review_required'
                r.rejection_reason = 'External live validation required before publication.'
                manualReview.push({ id: r.id, reason: `source check: ${result.accessStatus}, fact match ${factMatchResult}` })
              }
            } else if (r.approval_status === 'pending_verification') {
              const highRisk = HIGH_RISK_SUBS.has(r.sub_category) || r.category === 'lyrics'
              if (result.temporaryRedirect && highRisk && !r.secondary_source_url) {
                r.daily_eligibility_status = 'needs_review'
                r.rejection_reason = 'External live validation required before publication.'
                manualReview.push({ id: r.id, reason: 'temporary redirect (302/307): high-risk fact needs a validated secondary source' })
              } else {
                manualReview.push({ id: r.id, reason: 'link validated, awaiting human approval' })
              }
            }
          } else {
            r.secondary_initial_http_status = result.initialStatus === null ? 'unknown_not_observable' : String(result.initialStatus)
            r.secondary_final_http_status = result.finalStatus === null ? 'unknown_not_observable' : String(result.finalStatus)
            r.secondary_final_url = result.finalUrl || ''
            r.secondary_redirect_count = String(result.redirectCount)
            r.secondary_last_checked = checkedAt
          }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.domainConcurrency, queue.length || 1)) }, worker))
}

if (live) await runLive()

// ------------------------------------------------------------------ outputs
// A record only counts as production-ready when it carries no error-level
// issue at all, not merely when its three status fields look right.
const eligibleNow = rows.filter(r =>
  r.approval_status === 'approved' &&
  r.daily_eligibility_status === 'eligible' &&
  r.retirement_status === 'active' &&
  !errorIds.has(r.id))
// Run this before the report is built so the JSON report, the summary exit
// status and the process exit code always agree.
if (strictProduction && rows.length !== eligibleNow.length) {
  err('strict_production', `${rows.length - eligibleNow.length} record(s) are not production-ready`, '-', 'approval_status')
}
const report = {
  tool: 'validate-question-bank.mjs',
  version: VERSION,
  mode: live ? 'live' : 'offline',
  generatedAt: new Date().toISOString(),
  inputFile: input,
  configFile: configPath,
  config: {
    userAgent: cfg.userAgent,
    allowedDomains: cfg.allowedDomains,
    requestsPerSecondPerDomain: cfg.requestsPerSecondPerDomain,
    maxRetries: cfg.maxRetries,
    maxRedirects: cfg.maxRedirects,
    dynamicDays: cfg.dynamicDays,
    evergreenDays: cfg.evergreenDays,
    respectRobots: cfg.respectRobots,
    artistLimit: cfg.artistLimit,
    songLimit: cfg.songLimit
  },
  summary: {
    totalRecords: rows.length,
    draftsPendingVerification: pendingExternal.length,
    approvedProductionReady: eligibleNow.length,
    rejected: rows.filter(r => r.approval_status === 'reject').length,
    errors: errors.length,
    warnings: warnings.length,
    exitStatus: errors.length ? 1 : 0
  },
  counts: {
    byCategory: counts.category,
    bySubCategory: counts.subCategory,
    byDifficulty: counts.difficulty,
    byQuestionType: counts.questionType,
    bySourceTier: counts.tier,
    byApprovalStatus: counts.approval,
    byEligibility: counts.eligibility,
    distinctArtists: perArtist.size,
    topArtists: [...perArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => `${name}: ${n}`),
    songsReferenced: perSong.size,
    zeroQuoteLyrics: counts.zeroQuoteLyrics
  },
  checksByReason: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])),
  issues: { errors, warnings },
  sources: {
    checked: sourceChecks.length,
    failedSources,
    deadLinks,
    soft404,
    blocked,
    redirects,
    details: sourceChecks
  },
  recordsRequiringManualReview: manualReview,
  dailyPool: {
    eligible: eligibleNow.map(r => r.id),
    temporarilyIneligible: rows.filter(r => r.daily_eligibility_status === 'temporarily_ineligible').map(r => r.id),
    needsReview: rows.filter(r => r.daily_eligibility_status === 'needs_review').map(r => r.id),
    retired: rows.filter(r => r.daily_eligibility_status === 'retired').map(r => r.id),
    excludedFromVoting: rows.filter(r => !eligibleNow.includes(r)).length
  }
}

if (outPath) {
  const target = resolve(process.cwd(), outPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, toCsv(rows))
}
if (reportPath) {
  const target = resolve(process.cwd(), reportPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(report, null, 2) + '\n')
}

const say = (...a) => console.log(...a)
say('=== question bank validation =================================')
say(`mode                : ${live ? 'live' : 'offline'}`)
say(`records             : ${rows.length}`)
say(`approved eligible   : ${eligibleNow.length}`)
say(`pending verification: ${pendingExternal.length}`)
say(`errors / warnings   : ${errors.length} / ${warnings.length}`)
say(`profile / lyrics    : ${counts.category.profile} / ${counts.category.lyrics}`)
say(`mcq / true_false    : ${counts.questionType.mcq} / ${counts.questionType.true_false}`)
say(`easy/medium/hard    : ${counts.difficulty.easy}/${counts.difficulty.medium}/${counts.difficulty.hard}`)
say(`distinct artists    : ${perArtist.size}`)
if (live) {
  say(`sources checked     : ${sourceChecks.length}`)
  say(`failed sources      : ${failedSources.length} (dead ${deadLinks.length}, soft-404 ${soft404.length}, blocked ${blocked.length})`)
  say(`redirected sources  : ${redirects.length}`)
}
if (errors.length) {
  say('--- errors ---')
  for (const e of errors.slice(0, 40)) say(`  [${e.code}] ${e.id} ${e.column ? `(${e.column})` : ''}: ${e.message}`)
  if (errors.length > 40) say(`  ... ${errors.length - 40} more`)
}
if (warnings.length) {
  say('--- warnings ---')
  for (const w of warnings.slice(0, 20)) say(`  [${w.code}] ${w.id} ${w.column ? `(${w.column})` : ''}: ${w.message}`)
  if (warnings.length > 20) say(`  ... ${warnings.length - 20} more`)
}
say('===============================================================')
process.exit(errors.length ? 1 : 0)
