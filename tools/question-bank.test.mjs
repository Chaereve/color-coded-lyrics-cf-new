// Tests for the question-bank validator and its live link checker.
//
//   node --test tools/question-bank.test.mjs
//   npm run test:question-bank
//
// The CSV-level tests run the real validator in --offline mode: no network.
// The HTTP scenarios (redirects, dead links, soft-404s, blocks) are exercised
// against tools/question-bank/link-check.mjs with a stub fetch, so they are
// real assertions even though this sandbox has no outbound network.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLinkChecker, factMatch } from './question-bank/link-check.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VALIDATOR = join(ROOT, 'tools', 'validate-question-bank.mjs')
const LINK_CHECK = join(ROOT, 'tools', 'question-bank', 'link-check.mjs')
const SAMPLE = 'tools/question-bank/sample-input.csv'
const PILOT = 'data/kpop-quiz-bank/pilot-batch-01.csv'

const COLUMNS = ['id', 'category', 'sub_category', 'difficulty', 'question_type', 'question',
  'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'correct_answer', 'explanation',
  'artist_or_group', 'song_or_release', 'fact_type', 'time_scope', 'source_url', 'source_title',
  'source_tier', 'source_initial_http_status', 'source_final_http_status', 'source_final_url',
  'source_redirect_count', 'source_access_status', 'source_fact_match', 'source_evidence_locator',
  'source_last_checked', 'secondary_source_url', 'secondary_source_title',
  'secondary_initial_http_status', 'secondary_final_http_status', 'secondary_final_url',
  'secondary_redirect_count', 'secondary_evidence_locator', 'secondary_last_checked', 'last_verified',
  'lyrics_quote_word_count', 'lyrics_quote_type', 'paraphrase_check', 'official_context_status',
  'quality_score', 'factual_score', 'source_score', 'link_integrity_score', 'clarity_score',
  'fairness_score', 'copyright_score', 'uniqueness_score', 'daily_eligibility_status',
  'daily_selection_weight', 'cooldown_days', 'retirement_status', 'last_content_reviewed',
  'approval_status', 'rejection_reason', 'tags']

const SCORE_COLUMNS = ['factual_score', 'source_score', 'link_integrity_score', 'clarity_score',
  'fairness_score', 'copyright_score', 'uniqueness_score']

const today = () => new Date().toISOString().slice(0, 10)

// ------------------------------------------------------------------ fixtures
function csvCell (value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv (rows) {
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(h => csvCell(r[h])).join(','))].join('\n') + '\n'
}

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
  return rows.filter(r => r.some(v => v !== ''))
}

function baseRow (overrides = {}) {
  const row = {
    id: 'TEST001',
    category: 'profile',
    sub_category: 'agency_or_label',
    difficulty: 'easy',
    question_type: 'mcq',
    question: 'Which company formed the girl group Twice?',
    option_a: 'JYP Entertainment',
    option_b: 'SM Entertainment',
    option_c: 'YG Entertainment',
    option_d: 'Pledis Entertainment',
    correct_option: 'A',
    correct_answer: 'JYP Entertainment',
    explanation: 'Twice was formed by JYP Entertainment and debuted in 2015.',
    artist_or_group: 'Twice',
    song_or_release: '',
    fact_type: 'agency',
    time_scope: 'evergreen',
    source_url: 'https://en.wikipedia.org/wiki/Twice',
    source_title: 'Twice - Wikipedia',
    source_tier: 'D',
    source_initial_http_status: 'unknown_not_observable',
    source_final_http_status: 'unknown_not_observable',
    source_final_url: '',
    source_redirect_count: 'unknown_not_observable',
    source_access_status: 'unknown_not_observable',
    source_fact_match: 'pending_external_validation',
    source_evidence_locator: 'Lead section, first paragraph',
    source_last_checked: '',
    secondary_source_url: '',
    secondary_source_title: '',
    secondary_initial_http_status: '',
    secondary_final_http_status: '',
    secondary_final_url: '',
    secondary_redirect_count: '',
    secondary_evidence_locator: '',
    secondary_last_checked: '',
    last_verified: today(),
    lyrics_quote_word_count: '0',
    lyrics_quote_type: 'none',
    paraphrase_check: 'not_applicable',
    official_context_status: 'not_applicable',
    quality_score: '44',
    factual_score: '0',
    source_score: '0',
    link_integrity_score: '0',
    clarity_score: '12',
    fairness_score: '12',
    copyright_score: '13',
    uniqueness_score: '7',
    daily_eligibility_status: 'temporarily_ineligible',
    daily_selection_weight: '1',
    cooldown_days: '90',
    retirement_status: 'review_required',
    last_content_reviewed: today(),
    approval_status: 'pending_verification',
    rejection_reason: 'External live validation required before publication.',
    tags: 'twice;agency',
    ...overrides
  }
  // Unless a test injects a deliberately wrong total, keep the sum correct.
  if (!('quality_score' in overrides)) {
    row.quality_score = String(SCORE_COLUMNS.reduce((sum, c) => sum + Number(row[c]), 0))
  }
  return row
}

function lyricsRow (overrides = {}) {
  return baseRow({
    id: 'TESTLYR',
    category: 'lyrics',
    sub_category: 'lyrics_metadata',
    question: 'Which BTS studio album later included the 2020 single "Dynamite"?',
    option_a: 'Be',
    option_b: 'Map of the Soul: 7',
    option_c: 'Wings',
    option_d: 'Love Yourself: Answer',
    correct_option: 'A',
    correct_answer: 'Be',
    explanation: '"Dynamite" was later included on Be, released in 2020.',
    artist_or_group: 'BTS',
    song_or_release: 'Dynamite',
    fact_type: 'album_metadata',
    time_scope: '2020-11-20',
    source_url: 'https://en.wikipedia.org/wiki/Dynamite_(BTS_song)',
    source_title: 'Dynamite (BTS song) - Wikipedia',
    paraphrase_check: 'pass',
    official_context_status: 'metadata_only',
    tags: 'bts;dynamite',
    ...overrides
  })
}

function approvedRow (overrides = {}) {
  return baseRow({
    approval_status: 'approved',
    daily_eligibility_status: 'eligible',
    retirement_status: 'active',
    daily_selection_weight: '100',
    rejection_reason: '',
    source_initial_http_status: '200',
    source_final_http_status: '200',
    source_final_url: 'https://en.wikipedia.org/wiki/Twice',
    source_redirect_count: '0',
    source_access_status: 'public_accessible',
    source_fact_match: 'pass',
    source_last_checked: today(),
    factual_score: '24',
    source_score: '17',
    link_integrity_score: '13',
    clarity_score: '14',
    fairness_score: '14',
    copyright_score: '15',
    uniqueness_score: '8',
    ...overrides
  })
}

// ------------------------------------------------------------------ runner
function runValidator ({ rows = null, file = null, args = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'qb-test-'))
  const inputPath = file ? resolve(ROOT, file) : join(dir, 'input.csv')
  if (!file) writeFileSync(inputPath, toCsv(rows))
  const reportPath = join(dir, 'report.json')
  const outPath = join(dir, 'out.csv')
  const argv = [VALIDATOR, inputPath, ...args]
  if (!args.includes('--report')) argv.push('--report', reportPath)
  if (!args.includes('--out')) argv.push('--out', outPath)
  const result = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8' })
  const report = existsSync(argv[argv.indexOf('--report') + 1])
    ? JSON.parse(readFileSync(argv[argv.indexOf('--report') + 1], 'utf8'))
    : null
  const output = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report, output, dir }
}

const errorCodes = r => new Set((r?.issues?.errors ?? []).map(e => e.code))

// ------------------------------------------------------------------ stub HTTP
const LONG_BODY = 'x'.repeat(800)

function stubFetch (script) {
  return async (url) => {
    const entry = typeof script === 'function' ? script(url) : script[url]
    if (!entry) return { status: 404, ok: false, headers: { get: () => null }, text: async () => 'not found' }
    return {
      status: entry.status,
      ok: entry.status >= 200 && entry.status < 300,
      headers: { get: name => (String(name).toLowerCase() === 'location' ? entry.location ?? null : null) },
      text: async () => entry.body ?? LONG_BODY
    }
  }
}

const checkerCfg = {
  userAgent: 'KpopQuizValidator/1.0 (contact: tests)',
  maxRedirects: 3,
  maxRetries: 0,
  retryBaseDelayMs: 0,
  timeoutMs: 1000,
  minBodyChars: 100,
  respectRobots: true
}

const makeChecker = (script, cfg = {}) =>
  createLinkChecker({ ...checkerCfg, ...cfg }, { fetchImpl: stubFetch(script), sleep: async () => {} })

// ------------------------------------------------------------------ tests
describe('validator: shipped files', () => {
  test('offline validation passes for the sample input', () => {
    const { status, report } = runValidator({ file: SAMPLE, args: ['--offline'] })
    assert.equal(status, 0)
    assert.equal(report.summary.totalRecords, 3)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.summary.draftsPendingVerification, 3)
    assert.deepEqual(report.dailyPool.eligible, [])
  })

  test('offline validation passes for the pilot batch', () => {
    const { status, report } = runValidator({ file: PILOT, args: ['--offline'] })
    assert.equal(status, 0)
    assert.equal(report.summary.totalRecords, 20)
    assert.equal(report.summary.errors, 0)
    assert.equal(report.summary.draftsPendingVerification, 20)
    assert.equal(report.counts.byCategory.profile, 10)
    assert.equal(report.counts.byCategory.lyrics, 10)
    assert.equal(report.counts.byQuestionType.mcq, 17)
    assert.equal(report.counts.byQuestionType.true_false, 3)
    assert.equal(report.sources.checked, 0, 'offline mode must not check any URL')
  })

  test('strict production rejects the pilot batch', () => {
    const { status, stdout, report } = runValidator({ file: PILOT, args: ['--offline', '--strict-production'] })
    assert.equal(status, 1)
    assert.ok(errorCodes(report).has('strict_production'))
    assert.equal(report.summary.exitStatus, 1)
    assert.match(stdout, /strict_production/)
  })

  test('no file still uses the ambiguous source_http_status column', () => {
    for (const [name, text] of [
      ['validator', readFileSync(VALIDATOR, 'utf8')],
      ['pilot', readFileSync(resolve(ROOT, PILOT), 'utf8')],
      ['sample', readFileSync(resolve(ROOT, SAMPLE), 'utf8')]
    ]) {
      assert.ok(!/(^|[^_])source_http_status/.test(text), `${name} still mentions source_http_status`)
    }
  })
})

describe('validator: CSV parsing', () => {
  test('round-trips quoted commas, escaped quotes and embedded newlines', () => {
    const question = 'Which "group", with a comma, released it?'
    const explanation = 'He said "hello", then left.\nThe group is still active.'
    const { status, report, output } = runValidator({ rows: [baseRow({ question, explanation })], args: ['--offline'] })
    assert.equal(status, 0, JSON.stringify(report?.issues?.errors))
    assert.ok(!errorCodes(report).has('csv_shape'))
    const [header, ...data] = parseCsv(output)
    assert.deepEqual(header, COLUMNS)
    const row = Object.fromEntries(COLUMNS.map((h, i) => [h, data[0][i]]))
    assert.equal(row.question, question)
    assert.equal(row.explanation, explanation)
  })

  test('reports rows with the wrong number of fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qb-ragged-'))
    const path = join(dir, 'input.csv')
    writeFileSync(path, toCsv([baseRow()]).trimEnd() + '\nSHORT,ROW\n')
    const argv = [VALIDATOR, path, '--offline', '--report', join(dir, 'r.json')]
    const res = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8' })
    const report = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'))
    assert.equal(res.status, 1)
    assert.ok(errorCodes(report).has('csv_shape'))
  })
})

describe('validator: record level rules', () => {
  const cases = [
    ['duplicate id', () => [baseRow(), baseRow({ id: 'TEST001' })], 'duplicate_id'],
    ['duplicate question', () => [baseRow(), baseRow({ id: 'TEST002' })], 'duplicate_question'],
    ['correct_option / correct_answer mismatch', () => [baseRow({ correct_option: 'B' })], 'answer_mismatch'],
    ['invalid score total', () => [baseRow({ quality_score: '999' })], 'quality_sum'],
    ['invalid difficulty', () => [baseRow({ difficulty: 'trivial' })], 'bad_difficulty'],
    ['profile record with a lyric quote', () => [baseRow({ lyrics_quote_word_count: '3' })], 'profile_quote'],
    ['invalid date', () => [baseRow({ last_verified: '03-10-2026' })], 'bad_date'],
    ['cooldown below 30', () => [baseRow({ cooldown_days: '10' })], 'cooldown_too_short'],
    ['non-integer cooldown', () => [baseRow({ cooldown_days: 'soon' })], 'bad_cooldown'],
    ['non-English user-facing text', () => [baseRow({ question: '트와이스는 어떤 회사에서 결성되었나요?' })], 'non_english'],
    ['sensitive content', () => [baseRow({ question: 'Which member discussed her dating history in 2019?' })], 'sensitive_content'],
    ['lyrics record without a song', () => [lyricsRow({ song_or_release: '' })], 'missing_song'],
    ['mcq with a blank option', () => [baseRow({ option_d: '' })], 'mcq_options'],
    ['true_false with extra options', () => [baseRow({ question_type: 'true_false', option_a: 'True', option_b: 'False', option_c: 'Maybe', option_d: '', correct_option: 'A', correct_answer: 'True', question: 'Blackpink was formed by YG Entertainment.' })], 'tf_options'],
    ['true_false with a vague quantifier', () => [baseRow({ question_type: 'true_false', option_a: 'True', option_b: 'False', option_c: '', option_d: '', correct_option: 'A', correct_answer: 'True', question: 'Most K-pop groups debut with an extended play.' })], 'tf_quantifier'],
    ['missing evidence locator', () => [baseRow({ source_evidence_locator: '' })], 'missing_locator'],
    ['tracking-parameter URL', () => [baseRow({ source_url: 'https://en.wikipedia.org/wiki/Twice?utm_source=x' })], 'bad_url'],
    ['lyrics_keyword without a secondary source', () => [lyricsRow({ sub_category: 'lyrics_keyword', lyrics_quote_word_count: '2', lyrics_quote_type: 'keyword' })], 'keyword_secondary']
  ]

  for (const [name, build, code] of cases) {
    test(`rejects ${name}`, () => {
      const { status, report } = runValidator({ rows: build(), args: ['--offline'] })
      assert.equal(status, 1)
      assert.ok(errorCodes(report).has(code), `expected ${code}, got ${[...errorCodes(report)].join(', ')}`)
    })
  }

  test('rejects a lyric quote longer than 8 words', () => {
    const { status, report } = runValidator({
      rows: [lyricsRow({ sub_category: 'lyrics_keyword', lyrics_quote_word_count: '9', lyrics_quote_type: 'keyword' })],
      args: ['--offline']
    })
    assert.equal(status, 1)
    assert.ok(errorCodes(report).has('quote_too_long'))
  })

  test('rejects every fill-in-the-blank / lyric-completion wording', () => {
    const banned = [
      'Finish this BTS song title: "Fake ___"',
      'Which word completes the lyric from Dynamite?',
      'What comes next in the chorus line?',
      'Complete the lyric from the second verse of Dynamite',
      'Fill in the blank: "Dynamite, ___"'
    ]
    for (const question of banned) {
      const { status, report } = runValidator({ rows: [lyricsRow({ question })], args: ['--offline'] })
      assert.equal(status, 1, `expected rejection: ${question}`)
      assert.ok(errorCodes(report).has('banned_lyric_format'), `expected banned_lyric_format: ${question}`)
    }
  })

  test('warns when every MCQ hides the answer in the same slot', () => {
    const rows = Array.from({ length: 5 }, (_, i) => baseRow({ id: `T${i}`, question: `Question number ${i} about Twice?` }))
    const { report } = runValidator({ rows, args: ['--offline'] })
    assert.ok(report.issues.warnings.some(w => w.code === 'answer_position_bias'))
  })

  test('accepts a fully approved, production-ready record', () => {
    const { status, report } = runValidator({ rows: [approvedRow()], args: ['--offline', '--strict-production'] })
    assert.equal(status, 0, JSON.stringify(report?.issues?.errors))
    assert.equal(report.summary.approvedProductionReady, 1)
    assert.deepEqual(report.dailyPool.eligible, ['TEST001'])
  })
})

describe('validator: HTTP status semantics', () => {
  test('a direct 200 with 0 redirects is production eligible', () => {
    const { status, report } = runValidator({
      rows: [approvedRow({ source_initial_http_status: '200', source_final_http_status: '200', source_redirect_count: '0' })],
      args: ['--offline', '--strict-production']
    })
    assert.equal(status, 0, JSON.stringify(report?.issues?.errors))
    assert.equal(report.summary.approvedProductionReady, 1)
  })

  test('a 301 or 308 permanent redirect to a 200 page is production eligible', () => {
    for (const initial of ['301', '308']) {
      const { status, report } = runValidator({
        rows: [approvedRow({
          source_initial_http_status: initial,
          source_final_http_status: '200',
          source_redirect_count: '1',
          source_access_status: 'accessible_with_redirect'
        })],
        args: ['--offline', '--strict-production']
      })
      assert.equal(status, 0, `${initial} should be eligible: ${JSON.stringify(report?.issues?.errors)}`)
    }
  })

  test('a 302 or 307 temporary redirect to a 200 page is production eligible', () => {
    for (const initial of ['302', '307']) {
      const { status, report } = runValidator({
        rows: [approvedRow({
          source_initial_http_status: initial,
          source_final_http_status: '200',
          source_redirect_count: '1',
          source_access_status: 'accessible_with_redirect'
        })],
        args: ['--offline', '--strict-production']
      })
      assert.equal(status, 0, `${initial} should be eligible: ${JSON.stringify(report?.issues?.errors)}`)
    }
  })

  test('an approved record with unknown_not_observable HTTP fields is rejected', () => {
    for (const overrides of [
      { source_initial_http_status: 'unknown_not_observable' },
      { source_final_http_status: 'unknown_not_observable' },
      { source_initial_http_status: 'unknown_not_observable', source_final_http_status: 'unknown_not_observable' }
    ]) {
      const { status, report } = runValidator({ rows: [approvedRow(overrides)], args: ['--offline', '--strict-production'] })
      assert.equal(status, 1, JSON.stringify(overrides))
      assert.equal(report.summary.approvedProductionReady, 0)
    }
  })

  test('an approved record with a non-200 final status is rejected', () => {
    for (const final of ['301', '302', '404', '410', '429', '500', '503']) {
      const { status, report } = runValidator({
        rows: [approvedRow({ source_initial_http_status: '200', source_final_http_status: final })],
        args: ['--offline', '--strict-production']
      })
      assert.equal(status, 1, `final ${final} must be rejected`)
      assert.ok(errorCodes(report).has('final_status_not_200'), `final ${final} should report final_status_not_200`)
    }
  })

  test('an initial 200 alone never makes a record eligible', () => {
    const { status, report } = runValidator({
      rows: [approvedRow({ source_initial_http_status: '200', source_final_http_status: '404', source_access_status: 'dead' })],
      args: ['--offline', '--strict-production']
    })
    assert.equal(status, 1)
    assert.ok(errorCodes(report).has('final_status_not_200'))
    assert.ok(errorCodes(report).has('source_not_accessible'))
  })

  test('a redirect count above 3 is rejected', () => {
    const { status, report } = runValidator({
      rows: [approvedRow({ source_initial_http_status: '301', source_redirect_count: '4' })],
      args: ['--offline', '--strict-production']
    })
    assert.equal(status, 1)
    assert.ok(errorCodes(report).has('bad_redirect_count'))
  })

  test('an approved record needs measured secondary link data too', () => {
    const withSecondary = approvedRow({
      secondary_source_url: 'https://en.wikipedia.org/wiki/The_Story_Begins',
      secondary_source_title: 'The Story Begins - Wikipedia',
      secondary_evidence_locator: 'Lead section, first paragraph',
      secondary_last_checked: today()
    })
    const { status, report } = runValidator({ rows: [withSecondary], args: ['--offline', '--strict-production'] })
    assert.equal(status, 1, 'a secondary source without measured link data must fail')
    assert.ok(errorCodes(report).has('bad_secondary_status'))

    const measured = approvedRow({
      ...withSecondary,
      secondary_initial_http_status: '200',
      secondary_final_http_status: '200',
      secondary_final_url: 'https://en.wikipedia.org/wiki/The_Story_Begins',
      secondary_redirect_count: '0'
    })
    const ok = runValidator({ rows: [measured], args: ['--offline', '--strict-production'] })
    assert.equal(ok.status, 0, JSON.stringify(ok.report?.issues?.errors))

    const badFinal = approvedRow({ ...measured, secondary_final_http_status: '404' })
    const bad = runValidator({ rows: [badFinal], args: ['--offline', '--strict-production'] })
    assert.equal(bad.status, 1)
    assert.ok(errorCodes(bad.report).has('secondary_status_not_200'))
  })

  test('draft sentinels cover both HTTP status columns', () => {
    const variants = [
      ['source_initial_http_status', '200', 'draft_sentinel'],
      ['source_final_http_status', '200', 'draft_sentinel'],
      ['source_final_url', 'https://en.wikipedia.org/wiki/Twice', 'draft_sentinel'],
      ['source_redirect_count', '0', 'draft_sentinel'],
      ['source_access_status', 'public_accessible', 'draft_sentinel'],
      ['source_fact_match', 'pass', 'draft_sentinel'],
      ['link_integrity_score', '13', 'draft_sentinel'],
      ['daily_eligibility_status', 'eligible', 'draft_sentinel'],
      ['retirement_status', 'active', 'draft_sentinel'],
      ['rejection_reason', '', 'draft_sentinel']
    ]
    for (const [column, value, code] of variants) {
      const { status, report } = runValidator({ rows: [baseRow({ [column]: value })], args: ['--offline'] })
      assert.equal(status, 1, `${column} = ${value} should fail`)
      assert.ok(errorCodes(report).has(code), `${column} = ${value} should report ${code}`)
    }
  })
})

describe('validator: production gating', () => {
  test('a pending_verification record cannot pass strict production', () => {
    const { status, report } = runValidator({ rows: [baseRow()], args: ['--offline', '--strict-production'] })
    assert.equal(status, 1)
    assert.ok(errorCodes(report).has('strict_production'))
  })

  test('an approved record with a dead, soft-404 or blocked source cannot pass', () => {
    for (const access of ['dead', 'soft_404', 'blocked', 'paywalled', 'login_required', 'region_restricted', 'retry_required', 'unknown_not_observable']) {
      const { status, report } = runValidator({
        rows: [approvedRow({ source_access_status: access })],
        args: ['--offline', '--strict-production']
      })
      assert.equal(status, 1, `${access} should fail`)
      assert.ok(errorCodes(report).has('source_not_accessible'))
      assert.ok(errorCodes(report).has('strict_production'))
    }
  })

  test('an approved record without a validated fact match, final URL or check date cannot pass', () => {
    const variants = [
      approvedRow({ source_fact_match: 'pending_external_validation' }),
      approvedRow({ source_final_url: '' }),
      approvedRow({ source_last_checked: '' }),
      approvedRow({ quality_score: '90', factual_score: '20' })
    ]
    for (const row of variants) {
      const { status, report } = runValidator({ rows: [row], args: ['--offline', '--strict-production'] })
      assert.equal(status, 1)
      assert.equal(report.summary.approvedProductionReady, 0)
    }
  })
})

describe('validator: offline mode never promotes', () => {
  test('the written CSV keeps pending status and untouched link metadata', () => {
    const { output, report } = runValidator({ rows: [baseRow()], args: ['--offline'] })
    const [header, ...data] = parseCsv(output)
    const row = Object.fromEntries(header.map((h, i) => [h, data[0][i]]))
    assert.equal(row.approval_status, 'pending_verification')
    assert.equal(row.daily_eligibility_status, 'temporarily_ineligible')
    assert.equal(row.retirement_status, 'review_required')
    assert.equal(row.source_initial_http_status, 'unknown_not_observable')
    assert.equal(row.source_final_http_status, 'unknown_not_observable')
    assert.equal(row.source_access_status, 'unknown_not_observable')
    assert.equal(row.source_fact_match, 'pending_external_validation')
    assert.equal(row.source_final_url, '')
    assert.equal(row.source_last_checked, '')
    assert.deepEqual(report.dailyPool.eligible, [])
  })
})

describe('link checker: HTTP scenarios (stub fetch, no network)', () => {
  const URL_A = 'https://example.test/a'

  test('200 -> 200 with 0 redirects', async () => {
    const checker = makeChecker({ [URL_A]: { status: 200, body: LONG_BODY } })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.initialStatus, 200)
    assert.equal(r.finalStatus, 200)
    assert.equal(r.finalUrl, URL_A)
    assert.equal(r.redirectCount, 0)
    assert.equal(r.accessStatus, 'public_accessible')
    assert.equal(r.temporaryRedirect, false)
  })

  test('301 -> 200 with 1 redirect', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 301, location: 'https://example.test/b' },
      'https://example.test/b': { status: 200, body: LONG_BODY }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.initialStatus, 301)
    assert.equal(r.finalStatus, 200)
    assert.equal(r.finalUrl, 'https://example.test/b')
    assert.equal(r.redirectCount, 1)
    assert.equal(r.accessStatus, 'accessible_with_redirect')
    assert.equal(r.temporaryRedirect, false)
  })

  test('308 -> 200 with 1 redirect', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 308, location: 'https://example.test/b' },
      'https://example.test/b': { status: 200, body: LONG_BODY }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.initialStatus, 308)
    assert.equal(r.finalStatus, 200)
    assert.equal(r.redirectCount, 1)
    assert.equal(r.accessStatus, 'accessible_with_redirect')
  })

  test('302 -> 200 with 1 redirect (temporary)', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 302, location: 'https://example.test/b' },
      'https://example.test/b': { status: 200, body: LONG_BODY }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.initialStatus, 302)
    assert.equal(r.finalStatus, 200)
    assert.equal(r.redirectCount, 1)
    assert.equal(r.accessStatus, 'accessible_with_redirect')
    assert.equal(r.temporaryRedirect, true)
  })

  test('307 -> 200 with 1 redirect (temporary)', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 307, location: 'https://example.test/b' },
      'https://example.test/b': { status: 200, body: LONG_BODY }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.initialStatus, 307)
    assert.equal(r.finalStatus, 200)
    assert.equal(r.temporaryRedirect, true)
  })

  test('404 is dead and 410 is permanently removed', async () => {
    for (const status of [404, 410]) {
      const checker = makeChecker({ [URL_A]: { status, body: 'gone' } })
      const r = await checker.fetchPage(URL_A)
      assert.equal(r.finalStatus, status)
      assert.equal(r.accessStatus, 'dead')
      assert.match(r.note, /final HTTP/)
    }
  })

  test('429 rate limiting is reported, not bypassed', async () => {
    const checker = makeChecker({ [URL_A]: { status: 429, body: 'slow down' } })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.finalStatus, 429)
    assert.equal(r.accessStatus, 'retry_required')
  })

  test('403 is blocked and 401 is login required', async () => {
    for (const status of [403, 401]) {
      const checker = makeChecker({ [URL_A]: { status, body: 'denied' } })
      const r = await checker.fetchPage(URL_A)
      assert.equal(r.finalStatus, status)
      assert.equal(r.accessStatus, 'blocked')
    }
  })

  test('5xx responses are retry-required', async () => {
    for (const status of [500, 502, 503]) {
      const checker = makeChecker({ [URL_A]: { status, body: 'error' } })
      const r = await checker.fetchPage(URL_A)
      assert.equal(r.finalStatus, status)
      assert.equal(r.accessStatus, 'retry_required')
    }
  })

  test('a redirect loop is blocked', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 301, location: 'https://example.test/b' },
      'https://example.test/b': { status: 301, location: URL_A }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.accessStatus, 'blocked')
    assert.equal(r.note, 'redirect loop')
  })

  test('more than 3 redirects is blocked', async () => {
    const script = {}
    const urls = ['https://example.test/a', 'https://example.test/b', 'https://example.test/c', 'https://example.test/d', 'https://example.test/e']
    urls.forEach((u, i) => {
      script[u] = i === urls.length - 1
        ? { status: 200, body: LONG_BODY }
        : { status: 301, location: urls[i + 1] }
    })
    const checker = makeChecker(script)
    const r = await checker.fetchPage(urls[0])
    assert.equal(r.accessStatus, 'blocked')
    assert.equal(r.redirectCount, 4)
    assert.match(r.note, /redirect chain longer than 3/)
  })

  test('a soft-404 body returned with HTTP 200 is not accepted', async () => {
    const checker = makeChecker({ [URL_A]: { status: 200, body: 'Page not found. The page you requested could not be found.' } })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.finalStatus, 200, 'the marker check must run even when the status is 200')
    assert.equal(r.accessStatus, 'soft_404')
  })

  test('an empty shell body is treated as a soft-404', async () => {
    const checker = makeChecker({ [URL_A]: { status: 200, body: '<html><body></body></html>' } })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.accessStatus, 'soft_404')
    assert.match(r.note, /empty or a shell/)
  })

  test('a redirect to a generic homepage is blocked', async () => {
    const checker = makeChecker({
      [URL_A]: { status: 301, location: 'https://example.test/' },
      'https://example.test/': { status: 200, body: LONG_BODY }
    })
    const r = await checker.fetchPage(URL_A)
    assert.equal(r.accessStatus, 'blocked')
    assert.match(r.note, /generic page/)
  })

  test('robots rules are fetched, cached and obeyed', async () => {
    const script = {
      'https://example.test/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private\n' },
      'https://example.test/public/page': { status: 200, body: LONG_BODY }
    }
    const checker = makeChecker(script)
    assert.equal((await checker.robotsAllowed('https://example.test/private/x')).allowed, false)
    assert.equal((await checker.robotsAllowed('https://example.test/public/page')).allowed, true)
    assert.equal((await checker.robotsAllowed('https://example.test/public/page')).allowed, true)
  })

  test('fact match needs the tokens, not just a 200 page', async () => {
    const body = 'BTS released Dynamite in 2020 and it later appeared on the album Be.'
    assert.equal(factMatch(body, ['bts', 'dynamite', 'be']).match, 'pass')
    assert.equal(factMatch(body, ['twice', 'cheer']).match, 'fail')
    assert.equal(factMatch('', ['bts']).match, 'fail')
  })
})

describe('live mode: static source review (not executed here)', () => {
  const validatorSource = readFileSync(VALIDATOR, 'utf8')
  const linkSource = readFileSync(LINK_CHECK, 'utf8')
  const source = validatorSource + '\n' + linkSource
  const livePart = validatorSource.slice(validatorSource.indexOf('async function runLive'))
  const beforeLive = validatorSource.slice(0, validatorSource.indexOf('async function runLive'))

  test('uses real GET requests, never HEAD-only checks', () => {
    assert.match(linkSource, /fetchImpl\(current, \{/)
    assert.match(linkSource, /redirect: 'manual'/)
    assert.doesNotMatch(source, /method:\s*['"]HEAD['"]/i)
  })

  test('limits redirects to the configured maximum of 3', () => {
    assert.match(validatorSource, /maxRedirects: Number\(config\?\.rateLimit\?\.maxRedirects \?\? 3\)/)
    assert.match(linkSource, /if \(chain\.length > cfg\.maxRedirects\)/)
    assert.match(linkSource, /redirect chain longer than/)
    assert.match(linkSource, /note: 'redirect loop'/)
    assert.match(linkSource, /BAD_REDIRECT_TARGET\.test\(last\.to\)/)
  })

  test('does not bypass access controls', () => {
    for (const forbidden of ['cookie', 'authorization', 'set-cookie', 'proxy', 'x-forwarded-for', 'cf_clearance', 'bypass', 'captcha-solver']) {
      assert.doesNotMatch(source.toLowerCase(), new RegExp(forbidden), `source must not contain ${forbidden}`)
    }
    assert.match(source, /robots\.txt/)
    assert.match(validatorSource, /if \(!robots\.allowed\)/)
    assert.match(validatorSource, /accessStatus: 'disallowed_domain'/)
    assert.match(linkSource, /finalStatus === 404 \|\| finalStatus === 410\) accessStatus = 'dead'/)
    assert.match(linkSource, /finalStatus === 401 \|\| finalStatus === 403\) accessStatus = 'blocked'/)
    assert.match(linkSource, /accessStatus = 'retry_required'/)
  })

  test('rate-limits per domain and retries with backoff', () => {
    assert.match(validatorSource, /requestsPerSecondPerDomain: Number\(config\?\.rateLimit\?\.requestsPerSecondPerDomain \?\? 0\.5\)/)
    assert.match(validatorSource, /const minInterval = 1000 \/ Math\.max\(0\.1, cfg\.requestsPerSecondPerDomain\)/)
    assert.match(validatorSource, /if \(index > 0\) await sleep\(minInterval\)/)
    assert.match(linkSource, /await pause\(cfg\.retryBaseDelayMs \* \(attempt \+ 1\)\)/)
    assert.match(validatorSource, /byHost\.set\(host, \[\]\)/)
  })

  test('sends the configured user agent', () => {
    assert.match(validatorSource, /userAgent: config\.userAgent \|\| 'KpopQuizValidator\/1\.0 \(contact: YOUR_EMAIL_OR_DOMAIN\)'/)
    assert.match(linkSource, /'user-agent': cfg\.userAgent/)
  })

  test('never passes a source on HTTP 200 alone', () => {
    assert.match(linkSource, /if \(text\.trim\(\)\.length < cfg\.minBodyChars\)/)
    assert.match(linkSource, /if \(SOFT404_TEXT\.test\(text\.slice\(0, 8000\)\)\)/)
    assert.match(linkSource, /const pass = hits\.length >= Math\.ceil\(list\.length \/ 2\)/)
    assert.match(validatorSource, /const ok = ACCESS_OK\.includes\(result\.accessStatus\) && factMatchResult === 'pass'/)
  })

  test('detects common soft-404 markers', () => {
    for (const marker of ['page not found', 'video unavailable', 'no results', 'enable javascript', 'captcha', 'log in to continue', 'access denied']) {
      assert.match(linkSource.toLowerCase(), new RegExp(marker.replace(/ /g, '[\\s(?:is|has been)?]*')), `soft-404 marker missing: ${marker}`)
    }
  })

  test('writes link metadata only after live validation', () => {
    for (const column of ['source_initial_http_status', 'source_final_http_status', 'source_final_url', 'source_redirect_count', 'source_access_status', 'source_fact_match', 'source_last_checked', 'secondary_initial_http_status', 'secondary_final_http_status', 'secondary_final_url', 'secondary_redirect_count']) {
      const assignment = new RegExp(`r\\.${column}\\s*=\\s*[^=]`)
      assert.ok(assignment.test(livePart), `${column} must be written inside runLive`)
      assert.ok(!assignment.test(beforeLive), `${column} must not be written outside live mode`)
    }
    assert.match(validatorSource, /if \(live\) await runLive\(\)/)
  })

  test('cannot promote a pending record during a live run', () => {
    assert.ok(!livePart.includes("approval_status = 'approved'"))
    assert.match(livePart, /reason: 'link validated, awaiting human approval'/)
    assert.match(livePart, /reason: 'temporary redirect \(302\/307\): high-risk fact needs a validated secondary source'/)
  })
})
