# K-pop quiz bank validator

`tools/validate-question-bank.mjs` checks a quiz-bank CSV before any record is
allowed into the daily quiz pool. It has two modes:

| Mode | What it does | Network |
|---|---|---|
| `--offline` | Structural, editorial, safety, duplicate and scoring checks | none at all |
| `--live` | Everything above, plus real public GETs for every source URL | required |

The tool never invents link metadata. In `--offline` mode it cannot know an HTTP
status, so draft records keep the sentinel `unknown_not_observable` instead of a
number. Measured values are only written by a `--live` run.

## Requirements

- Node.js 20 or newer (uses the built-in `fetch`, `AbortSignal.timeout` and ESM).
- No npm install: the validator has zero dependencies.

```bash
node --version          # must be >= 20
git clone <this repo> && cd color-coded-lyrics-cf-new
```

## Configuration

Edit `tools/question-bank.config.json` before any live run:

| Key | Meaning |
|---|---|
| `userAgent` | Sent on every request. **Replace `YOUR_EMAIL_OR_DOMAIN` with a real contact.** |
| `allowedDomains` | Hosts the live checker is permitted to fetch. Anything else is skipped and reported as `disallowed_domain`. |
| `rateLimit.requestsPerSecondPerDomain` | Minimum spacing between requests to the same host. |
| `rateLimit.maxRetries` / `retryBaseDelayMs` | Backoff for network errors, 429 and 5xx. |
| `rateLimit.timeoutMs` | Per-request timeout. |
| `rateLimit.maxRedirects` | Maximum followed redirects (3). Longer chains are rejected. |
| `freshness.dynamicDays` / `evergreenDays` | Re-check windows (30 / 90). |
| `concurrency.domains` | How many hosts are checked in parallel (never more than one request per host at a time). |
| `live.respectRobots` | Fetch and obey `robots.txt` before requesting a path. |
| `live.minBodyChars` | Below this body size a page counts as a shell / soft-404. |
| `limits.artistQuestions` / `songQuestions` | Diversity caps (10 questions per artist, 3 per song or release). |

## Usage

```bash
# 1. Structural check only - safe anywhere, including sandboxes without network.
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --offline

# 2. Full check with real link validation, writing back the measured metadata.
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --live \
  --out build/validated.csv --report build/report.json

# 3. Gate a release: fail unless every single record is production-ready.
node tools/validate-question-bank.mjs build/validated.csv --offline --strict-production

# Other flags
#   --config <path>   use another config file (default tools/question-bank.config.json)
```

Exit codes: `0` = no error-level failures, `1` = at least one error, `2` = usage
or header problem.

## Tests

```bash
npm run test:question-bank        # node --test tools/question-bank.test.mjs
```

41 assertions covering the shipped files, the CSV parser (quoted commas,
escaped quotes, embedded newlines, ragged rows), every rejection rule, the
draft sentinels, the production gate, the fact that offline mode never promotes
a record, and a static review of the live-mode code path. The suite never
touches the network.

## Files

| Path | Purpose |
|---|---|
| `tools/validate-question-bank.mjs` | The validator. |
| `tools/question-bank.config.json` | Allowlist, rate limits, freshness, user agent, retries. |
| `tools/question-bank/sample-input.csv` | Three-record example input (2 profile, 1 lyrics; MCQ and true/false). |
| `tools/question-bank/sample-report.json` | The JSON report produced from that sample. |
| `data/kpop-quiz-bank/pilot-batch-01.csv` | 20 draft questions, all `pending_verification`. |
| `tools/question-bank.test.mjs` | Automated tests for the validator (offline only, no network). |
| `docs/QUESTION-BANK-PROMOTION.md` | Draft → production workflow. |

## What the offline run checks

- UTF-8 RFC4180 CSV parsing, exact required columns, consistent column count.
- Unique IDs, unique question text, near-duplicate fact atoms.
- Dates in `YYYY-MM-DD`, plus freshness windows for dynamic and evergreen facts.
- Link metadata honesty: `source_redirect_count` is `0-3` (or the draft
  sentinel) and a promoted record must carry a measured three-digit
  `source_http_status` — never the sentinel.
- Answer-position bias: warns when every MCQ in a bank hides its answer in the
  same slot, since that is a clue no amount of client-side shuffling fixes.
- `cooldown_days` is never below 30, for drafts and approved records alike.
- Every enum value: category, sub-category, difficulty, question type, source
  tier, access status, fact match, eligibility, retirement, approval.
- English-only user-facing fields (real script ranges; typographic punctuation
  such as `’` is not treated as a foreign script).
- One fact atom: flags questions reading as two questions in one.
- MCQ: exactly four distinct options, `correct_answer` equal to the selected
  option, no duplicated answer text.
- true/false: `option_a=True`, `option_b=False`, empty `option_c`/`option_d`, no
  vague quantifiers.
- Score ranges, per-score minimums for approved records, and an exact
  `quality_score` sum.
- Lyric policy: quote word count, quote type, paraphrase check, banned
  lyric-completion and fill-in-the-blank patterns, keyword secondary source.
- Safety: sensitive-content and degrading-language patterns across question,
  options, explanation and tags.
- Diversity: per-artist and per-song/release caps, plus difficulty,
  question-type and category mix at production scale.
- Draft sentinels (see below) and production gates for approved records.
- Daily-pool eligibility: nothing unapproved can be counted as eligible.

## Draft sentinels

A draft record that has not passed live external validation must carry exactly
these values, and the validator enforces them:

```text
approval_status              = pending_verification
daily_eligibility_status     = temporarily_ineligible
retirement_status            = review_required
link_integrity_score         = 0
source_initial_http_status   = unknown_not_observable
source_final_http_status     = unknown_not_observable
source_final_url             = (blank)
source_redirect_count        = unknown_not_observable
source_access_status         = unknown_not_observable
source_fact_match            = pending_external_validation
source_last_checked          = (blank)
secondary_initial_http_status = (blank)
secondary_final_http_status   = (blank)
secondary_final_url           = (blank)
secondary_redirect_count      = (blank)
rejection_reason             = External live validation required before publication.
```

The pilot also sets `factual_score = 0` and `source_score = 0` because nothing
has been independently verified yet; measured subscores are filled in only after
a live run and human review. With those zeros the total sits far below the 97
approval threshold, so a draft can never be published by accident.

## What the live run adds

- Obeys `robots.txt` and the domain allowlist; never bypasses CAPTCHA, login,
  paywall, rate limit or region controls (such pages are reported, not retried
  through a workaround).
- Browser-like GET with the configured user agent, never HEAD-only.
- Records `source_initial_http_status` (response to the requested URL),
  `source_final_http_status` (response to the final URL), `source_final_url`,
  the full redirect chain, `source_redirect_count` and the page title. The same
  four measured fields are written for the secondary source. The JSON report
  keeps every one of them per URL.
- Caches `robots.txt` per origin so a host is asked at most once per run.
- Rejects dead links (404/410), final 4xx/5xx, redirect loops, chains longer
  than three hops, redirects to generic homepages / search / login / app-store /
  country selectors, blank shells, soft-404 markers and consent interstitials.
- Fact match is set to `pass` only when the retrieved page contains the artist,
  the song or release, and the tokens from `source_evidence_locator`. HTTP 200
  alone is never treated as proof.
- Writes the measured values back into the CSV, and downgrades failures: a
  record that was already approved becomes `reject` / `retired`, anything else
  becomes `needs_review` and lands in the manual-review list.
- Validates secondary sources with the same rules.

## HTTP status semantics

| Field | Meaning |
|---|---|
| `source_initial_http_status` | status returned by the requested `source_url` |
| `source_final_http_status` | status returned by the final resolved `source_final_url` |
| `source_final_url` | final canonical URL after redirects |
| `source_redirect_count` | redirects followed from `source_url` to `source_final_url` |

The same definitions apply to `secondary_initial_http_status`,
`secondary_final_http_status`, `secondary_final_url` and
`secondary_redirect_count`.

| Situation | Initial | Final | Redirects |
|---|---|---|---|
| Direct valid page | 200 | 200 | 0 |
| Permanent redirect | 301 / 308 | 200 | 1 |
| Temporary redirect | 302 / 307 | 200 | 1 |
| Dead link | 200 | 404 / 410 | 0 |

Production eligibility is decided by the **final** status only:

- `source_final_http_status = 200`
- `source_final_url` present
- `source_fact_match = pass`
- `source_access_status` is `public_accessible` or `accessible_with_redirect`
- `source_redirect_count <= 3`
- `source_last_checked` inside the freshness window

An initial 200 is never treated as evidence of validity by itself: a 200 page
can still be a soft-404, a consent shell or a page that does not contain the
fact at all. A temporary redirect (302/307) on a high-risk fact also requires a
validated secondary source before promotion.

## Report contents

`--report` writes JSON with: summary counts, counts by category / sub-category /
difficulty / question type / tier / approval / eligibility, distinct-artist and
top-artist counts, every issue grouped by reason code, per-URL source details
(status, redirects, title, fact-match evidence, check date), failed sources,
dead links, soft-404 list, blocked list, redirect report, records requiring
manual review, and the daily-pool eligibility report.
