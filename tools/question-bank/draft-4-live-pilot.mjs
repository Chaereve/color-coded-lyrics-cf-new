#!/usr/bin/env node
// GitHub-hosted, read-only live URL pilot for exactly B1Q026-B1Q029.
// No CLI arguments or ID inputs are accepted. The source bank remains read-only;
// only a four-row CSV snapshot and JSON report are written under RUNNER_TEMP.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createLinkChecker, factMatch } from './link-check.mjs'

const PILOT_IDS = Object.freeze(['B1Q026', 'B1Q027', 'B1Q028', 'B1Q029'])
const SOURCE_CSV = resolve('data/kpop-quiz-bank/batch-01.csv')
const CONFIG_FILE = resolve('tools/question-bank.config.json')
const RUNNER_TEMP = process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp'
const PILOT_DIR = join(RUNNER_TEMP, 'qb-draft-4-live-pilot')
const PILOT_CSV = join(PILOT_DIR, 'draft-4.csv')
const REPORT_FILE = join(PILOT_DIR, 'draft-4.report.json')
const EXPECTED_STATES = {
  approval_status: 'pending_verification',
  daily_eligibility_status: 'temporarily_ineligible',
  retirement_status: 'review_required',
  source_fact_match: 'pending_external_validation'
}
const ACCESS_OK = new Set(['public_accessible', 'accessible_with_redirect'])
const ROBOTS_UNAVAILABLE = /^(robots check failed|robots\.txt returned (?:401|403|429|5\d\d)\b)/i
const ROBOTS_NOT_FOUND = /^robots\.txt returned (?:404|410)\b/i
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'page', 'lead', 'first',
  'second', 'third', 'fourth', 'fifth', 'last', 'section', 'paragraph',
  'infobox', 'table', 'list', 'track', 'notes', 'official', 'release', 'album',
  'single', 'song', 'part', 'line', 'entry', 'category', 'chart', 'week', 'year',
  'dated', 'credits', 'liner'
])

function parseCsv (text) {
  const table = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(field); field = ''; continue }
    if (char === '\n') { row.push(field); table.push(row); row = []; field = ''; continue }
    if (char !== '\r') field += char
  }
  if (field.length || row.length) { row.push(field); table.push(row) }
  if (quoted) throw new Error('CSV ended inside a quoted field')
  return table
}

const csvCell = value => {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\n') + '\n'
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const words = value => String(value ?? '').trim().split(/\s+/).filter(Boolean)
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

function recordsFromCsv (text) {
  const table = parseCsv(text.replace(/^\uFEFF/, ''))
  const headers = table[0] || []
  const values = table.slice(1).filter(row => row.some(value => value !== ''))
  const records = values.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  return { headers, values, records }
}

function isRobotsDecisionKnown (robots) {
  const note = String(robots?.note ?? '')
  if (ROBOTS_UNAVAILABLE.test(note)) return false
  if (!robots?.allowed) return true
  if (ROBOTS_NOT_FOUND.test(note)) return true
  return note === 'robots allows this path' || note === 'robots check disabled'
}

function hostAllowlistMatch (url, domains) {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch {
    return { host, allowed: false, matchedDomain: null, rule: 'invalid URL' }
  }
  const matchedDomain = domains.find(domain => host === domain || host.endsWith(`.${domain}`)) || null
  return {
    host,
    allowed: Boolean(matchedDomain),
    matchedDomain,
    rule: !matchedDomain ? 'no allowlist match' : (host === matchedDomain ? 'exact host match' : `host ends with .${matchedDomain}`)
  }
}

function locatorTokens (locator) {
  return words(String(locator ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' '))
    .filter(word => word.length > 3 && !STOPWORDS.has(word))
}

function factTokens (row, evidenceLocator) {
  return [
    ...words(row.artist_or_group).filter(word => word.length > 2),
    ...words(row.song_or_release).filter(word => word.length > 2 && !/^[\d\s]+$/.test(word)),
    ...locatorTokens(evidenceLocator)
  ]
}

function makeReport () {
  return {
    tool: 'draft-4-live-pilot.mjs',
    version: '1.0.0',
    mode: 'github_hosted_live_read_only',
    generatedAt: new Date().toISOString(),
    inputFile: 'data/kpop-quiz-bank/batch-01.csv',
    configFile: 'tools/question-bank.config.json',
    pilotCsvPath: PILOT_CSV || null,
    reportPath: REPORT_FILE,
    pilotIds: PILOT_IDS,
    runner: {
      githubActions: process.env.GITHUB_ACTIONS === 'true',
      environment: process.env.RUNNER_ENVIRONMENT || null,
      os: process.env.RUNNER_OS || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runNumber: process.env.GITHUB_RUN_NUMBER || null
    },
    preflight: { passed: false, errors: [] },
    config: null,
    readOnlyGuarantees: {
      sourceCsvWritten: false,
      sourceCsvStatusFieldsChanged: false,
      databaseTouched: false,
      configChanged: false,
      migrationChanged: false,
      sqlGenerated: false,
      qualityScoresChanged: false,
      questionRowsPromoted: false
    },
    sourceCsvIntegrity: { sha256Before: null, sha256After: null, unchanged: null },
    records: [],
    summary: {
      requestedDraftIds: PILOT_IDS,
      pilotRecords: 0,
      pilotCsvLinesIncludingHeader: null,
      checkedUrls: 0,
      primaryUrls: 0,
      configuredSecondaryUrls: 0,
      accessAndFactPass: 0,
      nonPassingOrUnmeasured: 0,
      robotsDisallowed: 0,
      robotsUnmeasured: 0,
      finalUrlMeasurementsUnavailable: 0,
      outcome: 'not_run'
    },
    sources: { checked: 0, details: [] },
    interpretation: {
      passRule: 'A URL passes only when finalStatus is 200, accessStatus is public_accessible or accessible_with_redirect, redirectCount is within the configured maximum, and factMatch is pass.',
      approvalRule: 'URL checks never approve a record, change eligibility/retirement, or assign quality_score.'
    }
  }
}

async function main () {
  const report = makeReport()
  let sourceBufferBefore = null
  let cfg = null
  let exitCode = 1

  try {
    if (process.argv.length > 2) throw new Error('This fixed-scope pilot accepts no command-line arguments.')
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
      throw new Error('Live URL checks are permitted only inside a GitHub-hosted Actions runner; no source requests were sent.')
    }
    if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required; refusing to write pilot data outside the runner temp directory.')
    if (!existsSync(SOURCE_CSV)) throw new Error(`Source CSV not found: ${SOURCE_CSV}`)
    if (!existsSync(CONFIG_FILE)) throw new Error(`Validator config not found: ${CONFIG_FILE}`)

    sourceBufferBefore = readFileSync(SOURCE_CSV)
    report.sourceCsvIntegrity.sha256Before = sha256(sourceBufferBefore)
    const source = recordsFromCsv(sourceBufferBefore.toString('utf8'))
    if (source.headers.length === 0) throw new Error('Source CSV has no header.')
    if (source.values.some(row => row.length !== source.headers.length)) throw new Error('Source CSV contains a row with a non-matching field count.')

    const sourceCounts = new Map()
    for (const row of source.records) sourceCounts.set(row.id, (sourceCounts.get(row.id) || 0) + 1)
    const missing = PILOT_IDS.filter(id => !sourceCounts.has(id))
    const duplicates = PILOT_IDS.filter(id => sourceCounts.get(id) !== 1)
    if (missing.length || duplicates.length) {
      throw new Error(`Source CSV does not contain exactly one of each fixed pilot ID. missing=${missing.join(',') || 'none'}; duplicateOrCountMismatch=${duplicates.join(',') || 'none'}`)
    }

    const selected = PILOT_IDS.map(id => source.records.find(row => row.id === id))
    for (const row of selected) {
      for (const [field, expected] of Object.entries(EXPECTED_STATES)) {
        if (row[field] !== expected) throw new Error(`${row.id} has unexpected ${field}=${JSON.stringify(row[field])}; expected ${expected}`)
      }
      if (!row.source_url) throw new Error(`${row.id} has no primary source_url.`)
    }

    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    cfg = {
      userAgent: config.userAgent || 'KpopQuizValidator/1.0 (contact: YOUR_EMAIL_OR_DOMAIN)',
      allowedDomains: Array.isArray(config.allowedDomains) ? config.allowedDomains.map(domain => domain.toLowerCase()) : [],
      requestsPerSecondPerDomain: Number(config?.rateLimit?.requestsPerSecondPerDomain ?? 0.5),
      maxRetries: Number(config?.rateLimit?.maxRetries ?? 2),
      retryBaseDelayMs: Number(config?.rateLimit?.retryBaseDelayMs ?? 1500),
      timeoutMs: Number(config?.rateLimit?.timeoutMs ?? 15000),
      maxRedirects: Number(config?.rateLimit?.maxRedirects ?? 3),
      domainConcurrency: Number(config?.concurrency?.domains ?? 4),
      minBodyChars: Number(config?.live?.minBodyChars ?? 400),
      respectRobots: config?.live?.respectRobots !== false
    }
    if (!cfg.respectRobots) throw new Error('Live pilot requires respectRobots=true; refusing to send source requests.')
    if (cfg.allowedDomains.length === 0) throw new Error('Live pilot requires a non-empty host allowlist; refusing to send source requests.')
    report.config = {
      allowedDomains: cfg.allowedDomains,
      requestsPerSecondPerDomain: cfg.requestsPerSecondPerDomain,
      maxRetries: cfg.maxRetries,
      maxRedirects: cfg.maxRedirects,
      timeoutMs: cfg.timeoutMs,
      respectRobots: cfg.respectRobots,
      domainConcurrency: cfg.domainConcurrency
    }

    mkdirSync(PILOT_DIR, { recursive: true })
    const pilotCsvText = toCsv(source.headers, selected)
    writeFileSync(PILOT_CSV, pilotCsvText, { flag: 'w' })
    const pilot = recordsFromCsv(readFileSync(PILOT_CSV, 'utf8'))
    const pilotIds = pilot.records.map(row => row.id)
    if (pilot.headers.join(',') !== source.headers.join(',')) throw new Error('Pilot CSV header differs from source CSV header.')
    if (pilot.values.length !== 4 || pilot.records.length !== 4 || pilotIds.join(',') !== PILOT_IDS.join(',')) {
      throw new Error(`Pilot CSV must have exactly header + four fixed records; got rows=${pilot.records.length}, ids=${pilotIds.join(',')}`)
    }
    if (pilot.values.some(row => row.length !== pilot.headers.length)) throw new Error('Pilot CSV contains a row with a non-matching field count.')

    report.preflight = {
      passed: true,
      errors: [],
      exactHeaderCopied: true,
      dataRows: pilot.records.length,
      ids: pilotIds,
      requiredStatesVerified: true,
      pilotCsvWrittenOutsideRepository: true
    }
    report.summary.pilotRecords = pilot.records.length
    report.summary.pilotCsvLinesIncludingHeader = pilot.records.length + 1
    report.records = pilot.records.map(row => ({
      id: row.id,
      statusSnapshotFromCsv: {
        approval_status: row.approval_status,
        daily_eligibility_status: row.daily_eligibility_status,
        retirement_status: row.retirement_status,
        source_fact_match: row.source_fact_match
      },
      secondaryConfiguredInCsv: Boolean(row.secondary_source_url),
      urls: []
    }))

    const jobs = []
    for (const row of pilot.records) {
      jobs.push({
        recordId: row.id,
        role: 'primary',
        url: row.source_url,
        title: row.source_title,
        evidenceLocator: row.source_evidence_locator,
        row
      })
      if (row.secondary_source_url) jobs.push({
        recordId: row.id,
        role: 'secondary',
        url: row.secondary_source_url,
        title: row.secondary_source_title,
        evidenceLocator: row.secondary_evidence_locator,
        row
      })
    }

    const checker = createLinkChecker(cfg)
    const grouped = new Map()
    for (const job of jobs) {
      const hostInfo = hostAllowlistMatch(job.url, cfg.allowedDomains)
      if (!grouped.has(hostInfo.host)) grouped.set(hostInfo.host, [])
      grouped.get(hostInfo.host).push({ ...job, hostInfo })
    }
    const queue = [...grouped.entries()]
    const details = []
    const intervalMs = 1000 / Math.max(0.1, cfg.requestsPerSecondPerDomain)

    async function checkJob (job) {
      const checkedAt = new Date().toISOString()
      const detail = {
        recordId: job.recordId,
        role: job.role,
        url: job.url,
        title: job.title,
        requestedHost: job.hostInfo.host,
        allowlist: {
          allowed: job.hostInfo.allowed,
          matchedDomain: job.hostInfo.matchedDomain,
          rule: job.hostInfo.rule
        },
        initialStatus: null,
        finalStatus: null,
        finalUrl: null,
        redirectChain: [],
        redirectCount: null,
        temporaryRedirect: null,
        accessStatus: null,
        factMatch: 'not_checked',
        evidence: 'No page body was checked.',
        matchedTokens: [],
        checkedAt,
        robotsResult: { checked: false, allowed: null, note: 'not checked' },
        blockedResult: null,
        disallowedResult: null,
        finalUrlMeasured: false,
        redirectCountMeasured: false,
        temporaryRedirectMeasured: false,
        factMatchEvaluated: false,
        urlPass: false,
        note: ''
      }

      if (!job.hostInfo.allowed) {
        detail.accessStatus = 'disallowed_domain'
        detail.disallowedResult = { disallowed: true, reason: 'host is not in the configured allowlist' }
        detail.robotsResult = { checked: false, allowed: null, decisionMeasured: false, note: 'robots.txt not requested because host is not allowlisted' }
        detail.note = 'No HTTP request was sent.'
        return detail
      }

      let robots
      try {
        robots = await checker.robotsAllowed(job.url)
      } catch (error) {
        robots = { allowed: false, note: `robots check failed (${error?.message || String(error)})` }
      }
      const robotsNote = String(robots.note ?? '')
      const robotsStatusMatch = robotsNote.match(/^robots\.txt returned (\d{3})\b/i)
      const robotsDecisionKnown = isRobotsDecisionKnown(robots)
      detail.robotsResult = {
        checked: true,
        httpStatus: robotsStatusMatch ? Number(robotsStatusMatch[1]) : null,
        allowed: robotsDecisionKnown ? Boolean(robots.allowed) : null,
        checkerReturnedAllowed: Boolean(robots.allowed),
        decisionMeasured: robotsDecisionKnown,
        note: robotsNote
      }

      if (!robotsDecisionKnown) {
        detail.accessStatus = 'network_unavailable'
        detail.note = 'Page request skipped because robots permission could not be measured.'
        return detail
      }
      if (!robots.allowed) {
        detail.accessStatus = 'blocked'
        detail.blockedResult = { blocked: true, reason: 'robots_disallow', note: robotsNote }
        detail.note = 'Page request skipped because robots.txt disallows this path.'
        return detail
      }

      let result
      try {
        result = await checker.fetchPage(job.url)
      } catch (error) {
        detail.accessStatus = 'network_unavailable'
        detail.note = `fetch error: ${error?.message || String(error)}`
        return detail
      }

      detail.initialStatus = result.initialStatus
      detail.finalStatus = result.finalStatus
      detail.accessStatus = result.accessStatus
      detail.note = result.note || ''
      if (result.initialStatus != null) {
        detail.finalUrl = result.finalUrl || null
        detail.finalUrlMeasured = Boolean(result.finalUrl)
        detail.redirectChain = result.chain || []
        detail.redirectCount = result.redirectCount
        detail.redirectCountMeasured = Number.isInteger(result.redirectCount)
        detail.temporaryRedirect = detail.redirectChain.some(step => step.status === 302 || step.status === 307)
        detail.temporaryRedirectMeasured = true
      } else {
        detail.finalUrl = null
        detail.redirectChain = []
        detail.redirectCount = null
        detail.temporaryRedirect = null
      }

      if (result.text) {
        const match = factMatch(result.text, factTokens(job.row, job.evidenceLocator))
        detail.factMatch = match.match
        detail.evidence = match.note
        detail.matchedTokens = match.hits
        detail.factMatchEvaluated = true
      } else {
        detail.factMatch = 'not_checked'
        detail.evidence = result.note || 'No page body was retrieved; fact match was not checked.'
      }

      const finalHost = result.finalUrl ? hostAllowlistMatch(result.finalUrl, cfg.allowedDomains) : null
      if (finalHost) detail.finalHostAllowlist = finalHost
      detail.urlPass = result.finalStatus === 200 && ACCESS_OK.has(result.accessStatus) && detail.factMatch === 'pass' && result.redirectCount <= cfg.maxRedirects
      if (['blocked', 'paywalled', 'login_required', 'region_restricted', 'disallowed_domain'].includes(result.accessStatus)) {
        detail.blockedResult = { blocked: true, reason: result.accessStatus, note: result.note || '' }
      }
      return detail
    }

    async function worker () {
      for (;;) {
        const item = queue.shift()
        if (!item) return
        const [, hostJobs] = item
        for (let index = 0; index < hostJobs.length; index++) {
          if (index > 0) await delay(intervalMs)
          details.push(await checkJob(hostJobs[index]))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.domainConcurrency, queue.length || 1)) }, worker))
    details.sort((left, right) => left.recordId.localeCompare(right.recordId) || (left.role === 'primary' ? -1 : 1))
    report.sources = { checked: details.length, details }
    for (const record of report.records) record.urls = details.filter(detail => detail.recordId === record.id)

    const passing = details.filter(detail => detail.urlPass).length
    report.summary = {
      requestedDraftIds: PILOT_IDS,
      pilotRecords: pilot.records.length,
      pilotCsvLinesIncludingHeader: pilot.records.length + 1,
      checkedUrls: details.length,
      primaryUrls: details.filter(detail => detail.role === 'primary').length,
      configuredSecondaryUrls: details.filter(detail => detail.role === 'secondary').length,
      accessAndFactPass: passing,
      nonPassingOrUnmeasured: details.length - passing,
      robotsDisallowed: details.filter(detail => detail.robotsResult?.decisionMeasured && detail.robotsResult?.allowed === false).length,
      robotsUnmeasured: details.filter(detail => detail.robotsResult?.decisionMeasured === false).length,
      finalUrlMeasurementsUnavailable: details.filter(detail => !detail.finalUrlMeasured).length,
      outcome: passing === details.length ? 'all_url_checks_passed_pending_human_review' : 'review_required_or_measurement_incomplete'
    }
    exitCode = passing === details.length ? 0 : 1
  } catch (error) {
    const message = error?.message || String(error)
    if (report.preflight.passed) {
      report.executionError = message
      report.summary.outcome = 'pilot_execution_error_review_required'
    } else {
      report.preflight.errors.push(message)
      report.summary.outcome = 'preflight_failed_no_url_checks'
      report.sources = { checked: 0, details: [] }
      report.records = []
    }
    exitCode = 2
  }

  if (sourceBufferBefore !== null) {
    try {
      const sourceBufferAfter = readFileSync(SOURCE_CSV)
      report.sourceCsvIntegrity.sha256After = sha256(sourceBufferAfter)
      report.sourceCsvIntegrity.unchanged = report.sourceCsvIntegrity.sha256Before === report.sourceCsvIntegrity.sha256After
      if (!report.sourceCsvIntegrity.unchanged) {
        report.readOnlyGuarantees.sourceCsvWritten = 'detected_change'
        report.readOnlyGuarantees.sourceCsvStatusFieldsChanged = 'possible_change_detected'
        report.preflight.errors.push('Source CSV hash changed during the pilot.')
        report.summary.outcome = 'source_csv_integrity_failure'
        exitCode = 2
      }
    } catch (error) {
      report.sourceCsvIntegrity.unchanged = null
      report.preflight.errors.push(`Could not re-check source CSV integrity: ${error?.message || String(error)}`)
      exitCode = 2
    }
  }

  report.generatedAt = new Date().toISOString()
  mkdirSync(PILOT_DIR, { recursive: true })
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ reportFile: REPORT_FILE, summary: report.summary, preflight: report.preflight }, null, 2))
  process.exitCode = exitCode
}

await main()
