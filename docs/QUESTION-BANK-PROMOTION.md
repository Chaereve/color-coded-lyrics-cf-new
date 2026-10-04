# Question-bank promotion workflow

Every K-pop quiz question travels the same path before it can award a vote.
Nothing skips a stage, and no stage can be satisfied by assumption.

```text
draft record
   ↓
offline CSV validation          (tools/validate-question-bank.mjs --offline)
   ↓
live URL validation             (--live, on a machine or CI runner with lawful public network access)
   ↓
human / QA review of flagged records
   ↓
approval_status = approved
daily_eligibility_status = eligible
retirement_status = active
   ↓
production daily quiz pool
```

## Stage 1 — Draft

A new question is written with one verifiable fact atom, four same-type options
(or a single true/false claim), and a source URL that was *actually observed*
through a permitted tool. Drafts always carry:

```text
approval_status                pending_verification
daily_eligibility_status       temporarily_ineligible
retirement_status              review_required
link_integrity_score           0
source_initial_http_status     unknown_not_observable
source_final_http_status       unknown_not_observable
source_final_url               (blank)
source_redirect_count          unknown_not_observable
source_access_status           unknown_not_observable
source_fact_match              pending_external_validation
source_last_checked            (blank)
secondary_initial_http_status  (blank)
secondary_final_http_status    (blank)
secondary_final_url            (blank)
secondary_redirect_count       (blank)
rejection_reason               External live validation required before publication.
```

Drafts are invisible to the daily pool and cannot award votes.

The current pilot is `data/kpop-quiz-bank/pilot-batch-01.csv` (20 records:
10 profile, 10 lyrics, 17 MCQ, 3 true/false). Its sources are reference pages
that were read while drafting; per the source hierarchy they are discovery
leads only, so production promotion requires replacing or supporting them with
Tier A/B primary evidence (official artist/label pages, official release pages
and tracklists, official award pages, Circle/Hanteo/Billboard/Oricon/RIAJ).

## Stage 2 — Offline validation

```bash
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --offline \
  --report build/offline-report.json
```

Checks schema, IDs, dates, enums, English-only text, answer integrity,
shuffle-safety, lyric-quote limits, banned formats, sensitive content,
duplicates, diversity caps and the draft sentinels. Exit status is non-zero on
any error. This stage makes no network calls, so it can never fabricate link
metadata.

The validator's own test suite runs entirely offline and should be green before
and after every batch:

```bash
npm run test:question-bank
```

## Stage 3 — Live URL validation

Run on a machine or CI runner with lawful public network access:

```bash
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --live \
  --out build/validated.csv --report build/live-report.json
```

The checker obeys `robots.txt` and the allowlist in
`tools/question-bank.config.json`, rate-limits per domain, retries transient
failures, and records what it measures: initial and final HTTP status, the
redirect chain, the final URL and the page title. It rejects dead links,
soft-404s, blank shells, consent or anti-bot interstitials, login and paywall
walls, redirect loops and chains longer than three hops. Fact match is `pass`
only when the retrieved page really contains the artist, the song or release and
the evidence locator — HTTP 200 alone proves nothing.

Failures are never silently approved: an already-approved record becomes `reject`
/ `retired`; anything else becomes `needs_review` and appears in the manual-review
list of the report.

## Stage 4 — Human / QA review

A reviewer reads the JSON report and the flagged records: the failed-source list,
the dead-link and soft-404 lists, the redirect report and the manual-review list.
For each record the reviewer confirms the fact atom, the tier of the source, the
evidence locator, the fairness and shuffle-safety of the options, the absence of
sensitive content, and that any high-risk claim (debut, agency, lineup, fandom,
chart, award, sales, certification, credit, lyric keyword) has a validated
secondary source.

## Stage 5 — Promotion

Only a record meeting **all** of the following may be promoted:

- `approval_status = approved`
- `daily_eligibility_status = eligible`
- `retirement_status = active`
- `source_fact_match = pass`
- `source_access_status` is `public_accessible` or `accessible_with_redirect`
- `source_final_http_status = 200` on the final URL (`source_final_url` present)
- `source_initial_http_status`, `source_redirect_count` (0-3) and
  `source_last_checked` hold **measured** values from a live run
- every required secondary source carries the same measured fields
  (`secondary_final_http_status = 200`, `secondary_final_url` present)
- an initial 200 on its own is never accepted as proof of validity
- freshness windows are met (30 days for dynamic facts, 90 days for evergreen)
- every required secondary source is validated
- quality, safety, copyright, diversity and duplicate requirements all pass
  (`quality_score >= 97/115` with each individual minimum met)
- `cooldown_days >= 30` and a blank `rejection_reason`

```bash
node tools/validate-question-bank.mjs build/validated.csv --offline --strict-production
```

That gate exits non-zero unless *every* record in the file is production-ready,
so it is the command to run in CI before the bank is imported.

## Stage 6 — Production daily pool

Promoted records are imported into `public.daily_quiz_questions` and become
selectable for the daily round. Server-side rules stay unchanged: the backend
decides correctness, one attempt per user per day, and the awarded votes come
from the frozen attempt snapshot — never from the client.

## Current status

- Stage 1 done for 20 draft records (pilot batch 01).
- Stage 2 passes: 0 errors, 8 warnings (secondary sources not yet validated).
- Stages 3–6 not started: this sandbox has no raw outbound network, so no live
  link validation has been performed and **no record is production-ready**.
