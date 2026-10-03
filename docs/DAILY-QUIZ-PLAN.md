# Daily Quiz — 5-question / +5 vote plan

Status: **implemented.** Migrations `20261115`–`20261117` and the five-question
screen are in place, and `20261118` removed the +2 check-in reward so the
quiz is the only vote source (max 5 votes/day). See §13 for what shipped
and what is still blocked.
This document was the output of Phase 2 (inspection + planning). Phase 1
(HTTP status schema migration) is finished and green; see §1–§3.

**The Daily Quiz is intentionally unavailable until approved, source-validated
questions are imported.** The 99 legacy questions are not eligible and cannot
award votes, so the pool is empty and `/quiz` shows a "coming soon" state.

Product rules as shipped:

- 5 questions per user per quiz date; launch mix = exactly **2 easy + 3 medium**
  (`hard_question_enabled = false` keeps hard questions out until the validated
  hard pool reaches `min_hard_pool_to_enable`, default 30).
- 1 correct answer = 1 bonus vote, wrong = 0, **hard cap 5 votes per user per
  quiz date**, enforced by `unique (user_id, quiz_date, question_id)`.
- The automatic 3-free-votes/day grant is retired (`free_vote_grant_enabled =
  false`), so quiz votes cannot stack with it; the switch is kept in
  `public.daily_quiz_config`.
- **Daily login awards nothing.** The calendar, streak, best streak,
  lifetime count and monthly progress stay; the +2 votes are gone
  (`20261118`). A check-in + five correct answers = 5 votes, never 7.

Product rule this plan implements:

- 5 random **eligible** questions per user per quiz date.
- 1 correct answer = 1 bonus vote; an incorrect answer = 0.
- Hard cap: **5 votes and 5 answered questions per user per quiz date**.
- The backend is the only authority on correctness and on awards; the client
  never receives the correct answer before submission.

---

## 1. Phase 1 changed files

New files

| File | What it is |
|---|---|
| `tools/question-bank/link-check.mjs` | **New module.** Link checker extracted from the validator so every HTTP scenario is testable offline: `createLinkChecker(cfg, deps)` (injectable `fetchImpl` + `sleep`), `factMatch`, `ACCESS_OK`, `SOFT404_TEXT`, `BAD_REDIRECT_TARGET`. Produces `initialStatus`, `finalStatus`, `finalUrl`, `redirectCount`, `chain`, `accessStatus`, `temporaryRedirect`, `html`/`title`/`text`, `note`. |
| `tools/validate-question-bank.mjs` | **New in this session** (rewritten for the new schema — see below). |
| `tools/question-bank.config.json` | Validator configuration (user agent, allowlist, rate limits, freshness, `fieldSemantics` documentation block added in Phase 1). |
| `tools/question-bank.test.mjs` | 66 offline tests. |
| `tools/question-bank/README.md` | Tool usage, column semantics, HTTP status table. |
| `tools/question-bank/sample-input.csv`, `tools/question-bank/sample-report.json` | 3-record sample bank + its report. |
| `data/kpop-quiz-bank/pilot-batch-01.csv`, `data/kpop-quiz-bank/pilot-batch-01.report.json` | 20 draft records (pending live verification) + report. |
| `docs/QUESTION-BANK-PROMOTION.md` | Draft → offline → live → human review → approved → daily-pool workflow. |

Modified for Phase 1

| File | Change |
|---|---|
| `tools/validate-question-bank.mjs` | 57-column schema; `source_http_status` split into `source_initial_http_status` / `source_final_http_status`, plus `secondary_initial_http_status` / `secondary_final_http_status` / `secondary_redirect_count`; imports `link-check.mjs` (inlined robots+fetch code deleted); `DRAFT_SENTINELS` gained `source_initial_http_status`; new `HIGH_RISK_SUBS` set; new error codes `bad_initial_status`, `bad_final_status`, `final_status_not_200`, `bad_secondary_status`, `secondary_status_not_200`, `missing_secondary_final_url`, `bad_secondary_redirect_count`; temporary redirect (302/307) on a high-risk sub-category is pushed to manual review. `grep -c 'source_http_status\b'` → **0**. |
| `tools/question-bank/link-check.mjs` | Two real bugs fixed (see §3): redirect-loop detection and per-path robots verdicts. |
| `tools/question-bank.test.mjs` | Rewritten: 57-column fixtures + new suites “HTTP status semantics” and “link checker: HTTP scenarios (stub fetch, no network)”. |
| `tools/question-bank/sample-input.csv`, `data/kpop-quiz-bank/pilot-batch-01.csv` | Migrated to 57 columns; drafts carry `unknown_not_observable` in both status columns and in `source_redirect_count`, blank `source_final_url`, blank secondary link fields. |
| `tools/question-bank/sample-report.json`, `data/kpop-quiz-bank/pilot-batch-01.report.json` | Regenerated. |
| `tools/question-bank/README.md` | Draft-sentinel block, live-run description, new **HTTP status semantics** table, production-eligibility list. |
| `tools/question-bank.config.json` | Added the `fieldSemantics` documentation block (initial vs final, draft sentinel, production eligibility). |
| `docs/QUESTION-BANK-PROMOTION.md` | Draft-sentinel block updated; promotion criteria now require `source_final_http_status = 200` + `source_final_url` present, redirect count 0–3, and state explicitly that an initial 200 alone is not evidence. |
| `package.json` | `test:question-bank` (`node --test tools/question-bank.test.mjs`), `question-bank:validate`, and `"tools/**/*.test.mjs"` added to the `test` glob. |

No quiz questions were created in Phase 1, and no application or database code
was touched.

## 2. Phase 1 test commands and results

Run from the repository root (Node ≥ 20, zero dependencies — `node_modules` is
empty in this sandbox, so these are plain `node --test` runs):

```bash
node --test tools/question-bank.test.mjs              # or: npm run test:question-bank
node tools/validate-question-bank.mjs tools/question-bank/sample-input.csv --offline
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --offline \
  --report data/kpop-quiz-bank/pilot-batch-01.report.json
node tools/validate-question-bank.mjs data/kpop-quiz-bank/pilot-batch-01.csv --offline --strict-production
```

Results (this sandbox):

| Command | Result |
|---|---|
| `node --test tools/question-bank.test.mjs` | **66 tests / 66 pass / 0 fail** |
| `node --check tools/validate-question-bank.mjs`, `node --check tools/question-bank/link-check.mjs` | OK |
| sample `--offline` | 3 records, **0 errors / 1 warning**, exit **0** |
| pilot `--offline` | 20 records, **0 errors / 8 warnings**, exit **0** (all 20 `pending_verification`, 0 production-ready) |
| pilot `--offline --strict-production` | **1 error / 8 warnings**, exit **1** — `[strict_production] 20 record(s) are not production-ready` (expected: drafts) |

New automated tests required by Phase 1, all present and passing:

`200→200/0`, `301→200/1`, `308→200/1`, `302→200/1`, `307→200/1`, `404` dead,
`410` removed, `429` rate-limited, `403` blocked, `401` login, `5xx` retry,
redirect loop, `>3` redirects, soft-404 with HTTP 200, approved record with
`unknown_not_observable` HTTP fields, approved record with a non-200 final
status.

**No live validation has been run.** Outbound network from this sandbox is
blocked for both `curl` and Node `fetch`, so every HTTP status, redirect count
and final URL in the data files is still `unknown_not_observable`. No record in
`data/kpop-quiz-bank/pilot-batch-01.csv` is production-ready.

## 3. Unresolved validator limitations

Known, not fixed — each one needs either code work or a human reviewer:

1. **Retry is narrower than the documentation claimed (still open).**
   `fetchPage` retries only when `fetch` throws. A `429` or `5xx` response
   breaks out of the retry loop immediately and `Retry-After` is ignored. The
   README/config wording was adjusted; the code still needs a real backoff on
   `429`/`5xx` (or the wording must stay as-is and 429/5xx must be treated as
   “human re-run later”).
2. **Robots `Allow` precedence is not implemented.** Only `Disallow` rules from
   the `*` and `kpopquizvalidator` groups are applied, so a robots.txt that
   mixes `Allow`/`Disallow` can be marked allowed when it should not be.
3. **No JavaScript rendering.** Consent shells, cookie walls and JS-only pages
   (e.g. `ibighit.com`) are read as the raw HTML they return; a page that only
   *looks* like content passes until the fact-match step, and the fact-match can
   pass on boilerplate.
4. **Fact matching is a token-overlap heuristic**, not comprehension. It can
   pass on a page that mentions the right tokens in the wrong sentence, and fail
   on a correct page that paraphrases. Human review is still mandatory.
5. **Soft-404 detection is text-based** (`SOFT404_TEXT` list: “page not found”,
   “404”, “no results”, …). Localised or branded 404 pages are missed.
6. **Tier A/B sources are unreachable from here.** `jype.com/artist/TWICE/profile?lang=en`
   returns live 404; `ibighit.com/artist/bts/eng/` redirects to a Korean
   cookie/JS shell. The pilot therefore leans on English Wikipedia (Tier C), so
   the “≥70 % Tier A/B” target in the question-bank prompt is not met and must
   be disclosed, not faked.
7. **English-only fetching.** `accept-language: en-US` and Latin-token fact
   matching; Korean-language sources are effectively unusable today.
8. **`quality_score` is self-assigned by the author** of the record; the
   validator only checks the range, not the judgement.
9. **Duplicate / near-duplicate detection is manual.** Same song, same album,
   same chart week, same award event and “same fact atom, different wording”
   still need a human; the validator can only compare literal fields.
10. **Redirect targets are only shallow-checked** (`BAD_REDIRECT_TARGET`): a
    redirect to a generic home page or a search page is flagged, but a redirect
    to a *plausible but wrong* article is not.
11. **Freshness is a passive check.** Nothing re-checks a URL after promotion;
    a source that dies after approval stays in the pool until someone re-runs
    the validator. (`source_last_checked` + the freshness window is the only
    guard, and the daily pool must filter on it at draw time — see §6/§9.)
12. **Concurrency/rate limits are honour-system.** The tool respects
    `rateLimit.rpsPerDomain` and `robots.txt`, but nothing stops an operator from
    raising them.

Two real bugs were found *by* the Phase 1 tests and are fixed:

- **Redirect loops were never reported.** The old guard
  (`chain.some(step => step.to === next && step.from !== current)`) always lost
  the race with the max-redirects branch, so a loop was reported as “chain
  longer than 3”. Replaced with a `visited` set checked *before* the hop cap.
- **Robots verdicts were cached per origin**, so one path’s allow/deny leaked
  onto every other path on the same host. Caching now stores the parsed
  `disallow` rules per origin; the verdict is evaluated per path.

## 4. Application architecture findings

**Frontend.** React 19 + Vite 8. No router library: `src/App.jsx` owns a
`history.pushState` router with
`ROUTES = { board: '/', login: '/daily-login', quiz: '/quiz', spin: '/daily-spin', ranking: '/ranking', mine: '/profile', admin: '/admin' }`,
`sectionOf(path)` for direct URLs, `pushUrl`/`onPop` for Back/Forward, unknown
paths rewritten to `/`, and `/u/<id>` kept as a legacy public-profile form.
Global providers: `I18nProvider` (`src/lib/i18n.jsx`), `NotifyProvider`. Styling
is plain CSS files per feature (`DailyRewards.css`, `DailySpin.css`).

**Backend / DB.** Supabase: Postgres + PostgREST + Auth. There is **no ORM** —
everything is hand-written SQL in `supabase/migrations/*.sql`, mirrored verbatim
into `supabase/schema.sql` between `-- BEGIN …` markers, and split by
`scripts/split-schema.mjs` into `supabase/setup/*.sql` chunks (32 KiB cap;
chunk 11 is currently 23,143 B). Every client write goes through a
`security definer` RPC; tables are `revoke all … from public, anon, authenticated`
and have RLS enabled with no browser policies. `src/lib/db.js` wraps each RPC
with a 20 s `AbortController` timeout and maps missing-schema errors to
`err.*Setup`.

**Auth / user model.** Supabase Auth; `auth.uid()` inside every RPC;
`public.profiles(id → auth.users, vote_credits, bonus_credits, …)`.
`src/lib/db.js` exports `hasSupabase = Boolean(VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY)`;
when false the whole app runs in an offline **demo mode** backed by
`localStorage`.

**Wallet.** `profiles.vote_credits` = purchased votes (never reset);
`profiles.bonus_credits` = bonus votes from daily spin, daily login and quiz
(reset by the 31/10 rule). Wallet math lives in `my_vote_status()`,
`cast_vote()` and the daily-rewards RPCs; every mutation takes
`select … from public.profiles where id = v_uid for update` first, then reads
`clock_timestamp()`.

**Votes.** `public.votes(request_id, user_id, used_credit, vote_day, free_slot,
fp_slot, credit_kind, fp_hash, ip_hash)` with unique indexes
`(user_id, vote_day, free_slot)` and `(fp_hash, vote_day, fp_slot)`.
`cast_vote(p_request_id, p_delta)` spends 3 free votes per VN day, then credits.
Casting is additionally fronted by an **edge gate**: `functions/api/vote/cast.js`
(Cloudflare Pages Functions) → `worker/index.js` (shared logic, also deployable
as a Worker) → Turnstile + D1/KV shield → Supabase RPC with the user’s own JWT
plus `p_gate_token`.

**Existing quiz.** `public.daily_quiz_questions(id text pk, prompt, options
jsonb (exactly 4 strings), correct_option int 0–3, explanation, active bool,
category text default 'Songs')` — 99 active rows. `public.daily_quiz_attempts(
id uuid pk default gen_random_uuid(), user_id, quiz_day date, questions jsonb
(exactly 3, a frozen snapshot **including** `correct_option` and `explanation`),
answers int[], score, created_at, completed_at, unique (user_id, quiz_day))`.
RPCs: `my_daily_rewards_status()`, `claim_daily_login(uuid,date)`,
`start_daily_quiz(uuid,date)`, `submit_daily_quiz(uuid,uuid,int[])`,
`my_daily_checkin_month(date)`; the internal
`daily_rewards_payload(uuid,timestamptz)` is never granted to clients and only
strips `correct_option`/`explanation` until `completed_at is not null`.
Rewards today: login **+2**, quiz **+1 per correct, max +3**.
Selection today: `order by seen, random() limit 3`, where `seen` means “appeared
in one of this user’s attempts in the last 30 days”.

**Timezone.** One authoritative product timezone, `Asia/Ho_Chi_Minh`, is already
hardcoded consistently: in SQL
(`(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date`,
`reset_at = ((day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')`), in
`src/lib/season.js` (`TZ`, `vnDayKey`), in `src/lib/dailySpin.js`
(`SPIN_TIME_ZONE`) and in the edge shield (`worker/vnDay.js`, +7 h arithmetic).
All timestamps are stored `timestamptz` (UTC); the VN calendar date is always
derived, never stored, from a server-side clock.

**Demo/offline mode.** `src/lib/dailyRewardsDemo.js` holds a 36-question
beginner K-pop bank and `drawQuestions(seen, random)`; state lives in
`ccl.daily.rewards.demo.v1.<userId>` and the wallet lock is emulated with
`withSpinLock('ccl.spin.demo', …)`. `src/lib/dailyRewards.js` holds the shared
client-side validators (`validateDailyRewardsStatus`, `validateQuizAnswers`,
`validateCheckInMonth`) and the quiz draft helpers
(`readQuizDraft`/`saveQuizDraft`, key `ccl.daily.quiz.draft.v1.<userId>`).
`src/components/DailyRewards.jsx` is a single controller rendered with
`kind="login"` or `kind="quiz"`; `App.jsx` never renders both together, and
Daily Spin stays on its own route.

**Tests.** `node --test` over four globs
(`src/**/*.test.js`, `supabase/tests/**/*.test.js`, `worker/**/*.test.js`,
`tools/**/*.test.mjs`); component tests are *real React* via `jsdom` + a Vite
dev server in middleware mode (`server.ssrLoadModule`) — see
`src/components/DailyRewards.test.js`. Postgres tests use `pg` against a
disposable database (`DAILY_REWARDS_TEST_DATABASE_URL`, created and dropped per
run). `tools/smoke.mjs` is a 389-check static smoke suite;
`npm run schema:split:check` enforces the schema/chunk mirror.

**Deployment.** Production is Cloudflare Pages (`chaereve.pages.dev`, builds on
push; edge shield via Pages Functions). `vercel.json` provides an SPA rewrite
fallback. `vite build` → `dist`; `public/_headers` and `public/sitemap.xml` are
part of the deploy. Node 22.

## 5. Exact files that need to change for the 5-question Daily Quiz

New

- `supabase/migrations/2026xxxx_daily_quiz_v2.sql` — the whole feature (schema
  + RPCs + index/constraints), rerunnable, no backfilled rewards.
- `supabase/setup/12-daily-quiz-v2.sql` — new chunk produced by
  `npm run schema:split` (chunk 11 is 23,143 B of the 32 KiB cap, so a new
  chunk is almost certainly required).
- `supabase/tests/dailyQuizV2.test.js` — DB-level tests (cap, idempotency,
  concurrency, timezone, eligibility, cooldown, diversity).
- `docs/DAILY-QUIZ-PLAN.md` — this document.
- An import path for the question bank: `tools/question-bank/to-seed-sql.mjs`
  (CSV → idempotent `insert … on conflict` SQL for `daily_quiz_questions`), so
  the CSV stays the source of truth.

Modified

- `supabase/schema.sql` — mirror the new migration.
- `supabase/tests/schemaChunks.test.js`, `supabase/tests/dailyRewards.test.js`
  (3 → 5 assertions), `scripts/split-schema.mjs` (chunk map if needed).
- `src/lib/db.js` — RPC wrappers (`startDailyQuiz`, `submitDailyQuiz` with the
  new payload, `fetchDailyRewardsStatus` unchanged in shape but new fields).
- `src/lib/dailyRewards.js` — `DAILY_QUIZ_QUESTIONS = 5`, `QUIZ_CORRECT_REWARD = 1`,
  `MAX_DAILY_QUIZ_VOTES = 5`, new validators (option-id payload, per-question
  results), shuffle/restore helpers.
- `src/lib/dailyRewardsDemo.js` — 5-question draw obeying the same constraints
  (the demo bank has 36 questions, enough for the diversity rules).
- `src/components/DailyRewards.jsx` — 5 steps instead of 3, per-question option
  shuffle, submit mapping, locked state, review screen, new counters.
- `src/components/DailyRewards.css` — 5-step track/stepper, locked rows.
- `src/lib/i18n.jsx` — new strings (question count, votes, locked, shuffle).
- `src/components/DailyRewards.test.js`, `src/lib/dailyRewards.test.js`,
  `src/lib/dailyRoutes.test.js` — updated/added cases.
- `tools/smoke.mjs` — new static checks.
- `docs/DAILY-REWARDS.md` — reward rules (+2 login, up to **+5** quiz).

Not touched: `src/App.jsx` routing constants, the spin page, the vote gate, and
the separate `/daily-login`, `/quiz`, `/daily-spin` pages (the three pages stay
separate and navigation/Back/Forward keep working because nothing in the router
changes).

## 6. Database schema and migration plan

All in one rerunnable migration, `2026xxxx_daily_quiz_v2.sql`, installed after
`20261114_daily_rewards_upgrade.sql`. Install path stays
`20261112 → 20261113 → 20261114 → 2026xxxx`; never rerun the full schema on a
live database.

**6.1 Extend `public.daily_quiz_questions`** (additive columns only, so existing
rows and frozen snapshots keep working):

```sql
alter table public.daily_quiz_questions
  add column if not exists artist            text,
  add column if not exists difficulty        text   not null default 'easy'
             check (difficulty in ('easy','medium','hard')),
  add column if not exists sub_category      text   not null default 'profile'
             check (sub_category in ('profile','lyrics','lyrics_keyword')),
  add column if not exists question_type     text   not null default 'mcq'
             check (question_type in ('mcq','true_false')),
  add column if not exists fact_key          text,          -- dedupe atom
  add column if not exists song_key          text,          -- artist|song|release
  add column if not exists quality_score     int    check (quality_score between 0 and 100),
  add column if not exists approval_status   text   not null default 'approved'
             check (approval_status in ('draft','pending_verification','approved','rejected')),
  add column if not exists daily_eligibility_status text not null default 'eligible'
             check (daily_eligibility_status in ('eligible','temporarily_ineligible','ineligible')),
  add column if not exists retirement_status text   not null default 'active'
             check (retirement_status in ('active','review_required','retired')),
  add column if not exists source_url        text,
  add column if not exists source_initial_http_status text,
  add column if not exists source_final_http_status   text,
  add column if not exists source_final_url           text,
  add column if not exists source_redirect_count      text,
  add column if not exists source_access_status       text,
  add column if not exists source_fact_match          text,
  add column if not exists source_last_checked        date,
  add column if not exists safety_flags      text[] not null default '{}',
  add column if not exists copyright_flags   text[] not null default '{}',
  add column if not exists duplicate_of      text  references public.daily_quiz_questions(id);
```

Existing rows are back-filled to the safe, currently-shipped state:
`approval_status='approved'`, `daily_eligibility_status='eligible'`
(± `temporarily_ineligible` for rows the bank marks inactive),
`retirement_status='active'`, `difficulty='easy'`, `sub_category='profile'`
(`'lyrics'` for the `lyrics-*` ids), `source_*` left `null` **and therefore not
eligible under the strict filter** until the bank is imported — see 6.6.

**6.2 Stable option identity.** `options` becomes an array of objects so that
shuffling cannot break grading:

```json
[{"id":"opt-a","text":"BTS"},{"id":"opt-b","text":"BLACKPINK"}, …]
```

plus `correct_option_id text not null`. `options` stays `jsonb` (array of 4) and
`correct_option int` is kept and maintained as the *index of the correct id* so
the old `submit_daily_quiz(uuid,uuid,int[])` signature keeps working during
rollout; the new submission path uses ids only. A `check` constraint asserts
`correct_option_id` is one of the four option ids.

**6.3 Per-question answer + award ledger (the idempotency anchor):**

```sql
create table if not exists public.daily_quiz_answers (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  quiz_date    date not null,
  question_id  text not null references public.daily_quiz_questions(id),
  attempt_id   uuid not null references public.daily_quiz_attempts(id) on delete cascade,
  option_id    text not null,
  correct      boolean not null,
  awarded      int  not null default 0 check (awarded in (0,1)),
  answered_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, quiz_date, question_id)
);
```

`unique (user_id, quiz_date, question_id)` is the required guarantee: one row,
one award, ever. A second insert for the same question on the same day is
rejected by the primary key, not by application logic.

**6.4 Attempt changes.**

```sql
alter table public.daily_quiz_attempts
  add column if not exists quiz_date date,                  -- VN date, derived
  add column if not exists submitted_at timestamptz,
  add column if not exists locked boolean not null default false,
  add column if not exists max_votes int not null default 5 check (max_votes = 5),
  add column if not exists votes_awarded int not null default 0
             check (votes_awarded between 0 and 5);
```

`quiz_day` is kept (and kept `not null`) for backwards compatibility; `quiz_date`
is written together with it, and the existing `unique (user_id, quiz_day)`
continues to enforce **one attempt per user per VN day**. The `questions` jsonb
check changes from `jsonb_array_length(questions) = 3` to `= 5`, and `score`
from `between 0 and 3` to `between 0 and 5`; the completion check changes
`cardinality(answers) = 3` to `= 5`. These are `drop constraint` + `add
constraint` pairs so the migration is rerunnable. **Existing 3-question attempts
are preserved as-is** (the constraints must therefore permit them: keep the
array-length check at `>= 1` for historical rows by scoping the new check with a
`completed_at is null or quiz_date is not null` guard, or accept the length check
only for rows written by the new RPC — this is a decision to confirm, see §12).

**6.5 Seen-tracking for the 90-day no-repeat rule** — a scan over the attempts
jsonb for every candidate question is too slow at pool scale:

```sql
create table if not exists public.daily_quiz_seen (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  question_id text not null references public.daily_quiz_questions(id),
  last_seen  date not null,
  primary key (user_id, question_id)
);
create index if not exists daily_quiz_seen_recent
  on public.daily_quiz_seen (user_id, last_seen);
```

Written at `start_daily_quiz` (the questions have been handed out, so they count
as seen), in the same transaction as the attempt insert.

**6.6 Eligibility index** (matches the draw-time filter in §9):

```sql
create index if not exists daily_quiz_questions_pool
  on public.daily_quiz_questions (artist, difficulty, sub_category)
  where active
    and approval_status = 'approved'
    and daily_eligibility_status = 'eligible'
    and retirement_status = 'active'
    and coalesce(quality_score, 0) >= 97
    and coalesce(source_fact_match, '') = 'pass'
    and coalesce(source_final_http_status, '') = '200'
    and source_final_url is not null and source_final_url <> ''
    and coalesce(source_access_status, '') in ('public_accessible','accessible_with_redirect')
    and coalesce(source_redirect_count, '9')::int <= 3
    and coalesce(cardinality(safety_flags), 0) = 0
    and coalesce(cardinality(copyright_flags), 0) = 0
    and duplicate_of is null;
```

Freshness (`source_last_checked` within the configured window) cannot be a
partial-index predicate (it moves), so it is applied as a filter in the
selection query.

**6.7 Migration safety.** RLS on every new table, `revoke all … from public,
anon, authenticated`, `grant all … to service_role`; no new grants to clients
beyond the three RPCs. No backfilled rewards, no cron, no changes to
`vote_credits`. Then: mirror into `supabase/schema.sql`, run
`npm run schema:split` + `npm run schema:split:check`, and update
`supabase/tests/schemaChunks.test.js`.

## 7. API endpoints and request/response contracts

Read

```http
POST /rest/v1/rpc/my_daily_rewards_status          → daily_rewards_payload()
```

Additions to the `quiz` object (existing fields kept):

```jsonc
"quiz": {
  "attempt_id": "uuid",
  "quiz_date": "2026-10-03",
  "completed": false,
  "question_count": 5,
  "max_votes": 5,
  "votes_awarded": 0,
  "score": null,
  "answers": null,
  "locked": false,
  "questions": [                       // frozen snapshot, in draw order
    { "id": "KPQ001", "prompt": "…", "category": "Songs",
      "difficulty": "easy", "sub_category": "profile", "question_type": "mcq",
      // display order is decided by the CLIENT; `options` is the canonical order
      "options": [ { "id": "opt-a", "text": "BTS" }, … ] }
  ]
  // correct_option / explanation appear ONLY when completed = true
}
```

Start

```http
POST /rest/v1/rpc/start_daily_quiz
{ "p_expected_user_id": "<uuid>", "p_expected_day": "2026-10-03" }
→ { "attempt_id": "uuid", "quiz_date": "2026-10-03", "replayed": false,
    "status": { …same payload as above… } }
```

Errors: `err.signin`, `err.dailyAccountChanged`, `err.dailyDayChanged`,
`err.dailySetup` (fewer than 5 eligible questions).

Submit (once, then locked)

```http
POST /rest/v1/rpc/submit_daily_quiz
{ "p_expected_user_id": "<uuid>",
  "p_attempt_id": "<uuid>",
  "p_answers": [                      // jsonb, one element per frozen slot
    { "question_id": "KPQ001", "option_id": "opt-c" },
    { "question_id": "KPQ014", "option_id": "opt-a" }   // exactly 5
  ] }
→ { "score": 4, "votes_awarded": 4, "replayed": false, "locked": true,
    "results": [ { "question_id": "KPQ001", "correct": true,
                   "correct_option_id": "opt-c", "explanation": "…" } ],
    "status": { …payload, now with correct_option/explanation… } }
```

Contract rules:

- The server grades against the **frozen attempt snapshot** and compares
  `option_id` (stable id), never a display position or A/B/C/D letter.
- Unknown `question_id`s, ids that are not in the snapshot, duplicates, and
  anything other than exactly 5 entries → `err.dailyQuizAnswers`.
- An already-completed attempt → `replayed: true`, the stored result is returned,
  **no balance change**.
- Attempt started on a different VN day → `err.dailyDayChanged`.
- The client never sees `correct_option_id`/`explanation` before completion; the
  payload builder strips them (existing behaviour, extended to option ids).
- Demo mode (`src/lib/dailyRewardsDemo.js`) must return the exact same shapes so
  `validateDailyRewardsStatus` is shared by both paths.

No new HTTP routes: everything stays inside the existing Supabase RPC surface,
so the Cloudflare edge shield, the JWT/RLS model and the timeout/retry wrapper
in `src/lib/db.js` all apply unchanged.

## 8. Transaction and idempotency strategy

Locking order is fixed and identical on every path (profile → attempt → ledger):

1. `perform 1 from public.profiles where id = v_uid for update` — the same
   wallet lock used by `claim_daily_login`, `start_daily_quiz`,
   `submit_daily_quiz`, `cast_vote` and the spin.
2. `pg_advisory_xact_lock(hashtext('daily_quiz:' || v_uid::text || ':' || to_char(v_day, 'YYYY-MM-DD')))`
   — serialises concurrent submits from multiple tabs/devices for the same user
   and day; released automatically at transaction end.
3. `select * from public.daily_quiz_attempts where id = p_attempt_id and
   user_id = v_uid for update`.
4. Time is captured **after** the locks (`clock_timestamp()`), as today; the VN
   date is derived from that server time, never from the client.

Submission is then:

- If `a.completed_at is not null` → return the stored result (`replayed: true`),
  touch nothing.
- Insert each answer into `daily_quiz_answers` with `on conflict do nothing`,
  then `select` the rows that now exist for `(user_id, quiz_date)`. The primary
  key makes a replay, a retry, a double-click, a multi-tab submit or a crafted
  duplicate a **no-op instead of a second award**.
- `votes_awarded = count(*) where correct and awarded = 1`, capped at 5 by
  construction (5 questions, one row each) **and** asserted by a final
  `check (votes_awarded between 0 and 5)` plus a guard that raises if the count
  exceeds `max_votes`.
- Award exactly the delta: `update public.profiles set bonus_credits =
  bonus_credits + v_delta` once, inside the same transaction, where `v_delta`
  is computed from the ledger, never from a client value.
- Mark `completed_at`, `submitted_at`, `locked = true`, `score`, `votes_awarded`
  in the same statement batch.

Client side (defence in depth, not authority): the existing `busy` ref +
`readVersion` counter in `DailyRewards.jsx` prevents double submits in one tab;
the `storage` listener plus `DAILY_REWARDS_SYNC_KEY` (and `SPIN_SYNC_KEY`) syncs
other tabs; `announceDailyRewardsChange()` broadcasts after every mutation.
A unique attempt id per attempt already exists (`daily_quiz_attempts.id uuid
default gen_random_uuid()`) and is returned to the client and echoed back on
submit, so a stale/replayed submit is detected server-side.

## 9. Question-selection algorithm

Runs inside `start_daily_quiz`, after the locks, in one statement.

**Eligibility CTE** — every one of these must hold (this is the filter named in
the request):

`active`, `approval_status='approved'`,
`daily_eligibility_status='eligible'`, `retirement_status='active'`,
`source_fact_match='pass'`,
`source_access_status in ('public_accessible','accessible_with_redirect')`,
`source_final_http_status='200'`, `source_final_url` present,
`source_last_checked` inside the freshness window, `quality_score >= 97`,
`safety_flags`/`copyright_flags` empty, `duplicate_of is null`.

**Exclusion CTE** — questions in `daily_quiz_seen` with
`last_seen > v_day - 90` for this user (prefer not to repeat within 90 days).

**Constraint repair, in this order** (each step fills the remaining slots from
the remaining pool; if a step cannot be satisfied the constraint is relaxed for
that step only and the relaxation is recorded in the attempt for audit):

1. Take up to 5 from the unseen pool, `order by random()`.
2. **Difficulty mix**: 1–2 easy, 2–3 medium, 0–1 hard; never more than 2 hard.
3. **Artist diversity**: never more than 2 questions from the same artist, and
   prefer at least 3 distinct artists.
4. **Category mix**: at least 1 `profile` and at least 1 `lyrics` (including
   `lyrics_keyword`) whenever enough eligible records exist.
5. **Format caps**: at most 1 `true_false`, at most 1 `lyrics_keyword`.
6. **Fact dedupe**: no two questions sharing `song_key` / `fact_key` (same song,
   album, release, chart week, award event, or fact atom) in one set.
7. If fewer than 5 remain after all of the above, first drop the 90-day
   exclusion, then the artist-diversity *preference* (never the hard caps, never
   eligibility). If still fewer than 5 eligible questions exist, raise
   `err.dailySetup` and award nothing — **never pad the set with an ineligible
   question**.

Implementation notes:

- One `with` chain: `eligible` → `unseen` → a greedy loop in PL/pgSQL over the
  ranked candidates applying the caps, or a single SQL pass with window
  functions (`row_number() over (partition by artist order by random())`) plus
  quota arithmetic. The greedy loop is easier to test; the window version is
  faster. Recommend the greedy loop with a deterministic tie-break, given the
  pool is small (hundreds, not millions).
- `random()` is seeded for tests via `setseed()`; production uses the default.
- The chosen ids are written to `daily_quiz_seen` (`last_seen = v_day`,
  `on conflict (user_id, question_id) do update set last_seen = excluded.last_seen`)
  in the same transaction as the attempt insert, so a crash cannot hand out a
  question without recording it.
- The frozen snapshot copies prompt, options (with ids), category, difficulty,
  sub_category and the private `correct_option_id`/`explanation`, so later edits
  or retirements cannot change a started round.

## 10. Frontend flow plan

`src/components/DailyRewards.jsx` (`kind="quiz"`), unchanged in its overall
shape: header + mission card + one question per step + review.

1. **Start.** `run('start')` → `startDailyQuiz(userId, status.day)` → 5 frozen
   questions. `attemptRef` changes → draft is reset.
2. **Shuffle.** For each question the client derives a display permutation from
   a seeded PRNG keyed by `attempt_id + question.id` (deterministic across
   re-renders and reloads, unpredictable to the player). `options` are rendered
   in the shuffled order but carry their stable `option.id`.
3. **Answer.** `choose(optionId)` stores the **option id** in the answers array
   and persists the draft (`saveQuizDraft`, keyed by user + attempt). Keyboard
   support (1–4, ←/→, Enter) is extended from 3 to 5 steps.
4. **Lock before submit.** Once submitted (or once the server reports
   `completed`), the form is replaced by the review list; `fieldset disabled`
   plus the server-side `locked` flag make the answers final. The correct answer
   and explanation arrive only in the post-submit payload.
5. **Submit.** One call with the 5 `{question_id, option_id}` pairs; on
   `replayed: true` the UI shows “already submitted” and does not change the
   wallet. On `err.dailyDayChanged` the page reloads (existing behaviour).
6. **Refresh / retry / multi-tab.** `load()` re-reads
   `my_daily_rewards_status()`; a completed attempt restores the server's
   answers; an incomplete attempt restores the local draft. `busy`/`readVersion`
   guards, `storage` listeners and `announceDailyRewardsChange()` are already in
   place.
7. **Counters and copy.** “Question n/5”, “x/5 answered”, “up to +5 votes”,
   “+1 vote per correct answer”, and the reset countdown to 00:00
   Asia/Ho_Chi_Minh. New strings are added to the single English dictionary `S`
   in `src/lib/i18n.jsx` (941 keys today; there is no second locale — the app
   ships one language, with Vietnamese used in code comments);
   `DailyRewards.css` gets a 5-step track/stepper.
8. **Demo mode.** `src/lib/dailyRewardsDemo.js` draws 5 questions from its 36-item
   bank with the same constraints (artist caps, ≥1 Lyrics, ≥1 profile-ish
   category, no repeats within 90 days using the local attempt history) and
   grades by `option.id`, so the offline path exercises the same contract.
9. **Pages stay separate.** `/daily-login`, `/quiz` and `/daily-spin` keep their
   own routes and menu items; no component renders another page's content;
   Back/Forward, direct URLs, guest gates and public-profile isolation are
   untouched.

## 11. Test plan

Static / unit (`node --test`, no DB)

- `src/lib/dailyRewards.js`: `DAILY_QUIZ_QUESTIONS = 5`, `MAX_DAILY_QUIZ_VOTES = 5`;
  `validateQuizAnswers` accepts only 5 entries; the new payload validator
  rejects a payload that leaks `correct_option_id`/`explanation` before
  completion, rejects option-id answers that are not in the frozen options, and
  rejects `votes_awarded > 5`.
- Shuffle helpers: the permutation is a permutation (same multiset), is stable
  for the same seed, and mapping display position → `option.id` round-trips.
- `tools/smoke.mjs`: new checks for the 5-question constants, the new columns in
  the migration text, and the new i18n keys.

Component (jsdom + Vite `ssrLoadModule`, as in `DailyRewards.test.js`)

- Renders 5 steps; answering all 5 and submitting shows the review with the
  correct answers; submitting twice (double-click) calls the RPC once.
- Refresh mid-round restores the draft; a completed round restores the server's
  answers and is read-only.
- Option order on screen differs from the canonical order, and the submitted
  payload still contains the canonical `option_id`.
- Demo mode: full round offline, wallet +5 at most.

Database (`supabase/tests/dailyQuizV2.test.js`, real Postgres via
`DAILY_REWARDS_TEST_DATABASE_URL`)

- **Vote cap 5**: a perfect round awards exactly +5 `bonus_credits`; a second
  call in the same day adds 0.
- **Duplicate submission**: submitting the same attempt twice (same and
  different payloads) leaves `bonus_credits` and the ledger unchanged and
  returns `replayed: true`.
- **Concurrency**: N parallel clients submit the same attempt; the wallet moves
  by exactly the correct delta once (advisory lock + PK).
- **Timezone**: with `set timezone` / a controlled `now`, 16:59 UTC = VN
  “today”, 17:00 UTC = VN “tomorrow”; the same user can hold two attempts across
  the boundary, and each day caps at 5.
- **Option shuffle**: submitting answers in shuffled order scores identically to
  canonical order; submitting a wrong `option_id` scores 0.
- **Eligibility**: a question with `source_final_http_status='404'`, a stale
  `source_last_checked`, `quality_score < 97`, a safety flag, or
  `daily_eligibility_status <> 'eligible'` is never drawn.
- **Cooldown**: a question seen today is not drawn again within 90 days while
  the pool is large enough; after 90 days it becomes eligible again.
- **Diversity**: over many draws, each set has ≤2 hard, ≤2 per artist, ≤1
  true/false, ≤1 lyrics_keyword, ≥1 profile and ≥1 lyrics when the pool allows,
  and no duplicate `fact_key`/`song_key` inside one set.
- **One attempt per day**: `unique (user_id, quiz_day)` rejects a second start.
- **Migration mirror**: the migration text appears in `supabase/schema.sql` and
  in the split chunks; `npm run schema:split:check` passes.

Manual / staging

- Two tabs, two devices: submit simultaneously, verify one award.
- Offline demo: verify the same 5-question flow with no Supabase env vars.
- Verify `/daily-login`, `/quiz`, `/daily-spin` each render only their own
  content and that Back/Forward and direct URLs still work.

## 12. Risks, assumptions and open questions

Risks

1. **Pool size.** The strict eligibility filter (final status 200 + freshness +
   `quality_score >= 97` + no flags) may leave fewer than 5 questions. The
   current 99 active rows have **no `source_*` data at all**, so under the new
   filter they are all ineligible until the bank is imported. Either the import
   runs first, or a grandfather clause is needed (see questions).
2. **Historical attempts.** Existing attempts hold 3-question snapshots. The
   array-length and score constraints must either be scoped to new rows or
   grandfathered, otherwise the migration fails on real data.
3. **Chunk size.** `supabase/setup/11-*.sql` is already 23,143 B of the 32 KiB
   cap; the new migration will not fit, so a chunk 12 is required and
   `supabase/tests/schemaChunks.test.js` must be updated in the same change.
4. **Client shuffle is untrusted by design.** A tampered client can submit any
   `option_id`, but it can only ever win 1 vote per question per day, so the
   upside of tampering is capped at +5/day and the ledger makes it auditable.
5. **Demo mode cannot enforce any of this.** `localStorage` is advisory only;
   the demo must not be presented as a security boundary (the UI already labels
   it).
6. **`random()` in SQL is not uniform enough for adversarial players** at small
   pool sizes, and `setseed` is session-wide — tests must set it explicitly and
   production must not.
7. **Reward economics change.** Login +2 and quiz up to **+5** means up to +7
   bonus votes/day (spin is separate). Flagged here because the earlier
   instruction was “keep reward economics unchanged”; the user has since chosen
   the 5/+5 rule explicitly.

Assumptions

- The authoritative product timezone stays `Asia/Ho_Chi_Minh`; timestamps stay
  UTC `timestamptz`; `quiz_date` is always derived server-side.
- Quiz votes are **bonus** votes (`bonus_credits`), like today, and remain
  subject to the existing 31/10 bonus reset and the 3 free votes/day rule for
  casting.
- One attempt per user per VN day, frozen at start — the existing model, kept.
- The question bank CSV in `data/kpop-quiz-bank/` remains the source of truth;
  the database is a generated artifact.
- No new edge route is needed: the quiz stays inside the Supabase RPC surface.

Questions for the user

1. **Grandfather the current 99 questions?** They have no `source_*` data, so
   under the strict filter the daily pool would be empty. Options: (a) import
   the new bank before shipping the filter, (b) mark the 99 legacy rows
   `daily_eligibility_status='temporarily_ineligible'` and let them age out as
   verified questions arrive (this shrinks the live pool to 0 until batch 1
   lands), or (c) allow a `source_verified` boolean set by a human reviewer as a
   temporary substitute for the measured fields.
2. **Should the quiz stay “all easy”?** The requested mix is 1–2 easy / 2–3
   medium / 0–1 hard, which contradicts the earlier “quiz must be easy”
   instruction. Confirm the mix, or confirm easy-only with the diversity rules
   applied instead of difficulty.
3. **Do the 5 quiz votes stack with the 3 free votes/day** for casting (i.e. 8
   votes usable per day), or should the quiz be capped so the *total* daily
   bonus from login + quiz is 5?
4. **Should `start_daily_quiz` be edge-gated** (Turnstile + D1/KV, like spin and
   vote) or is the per-day uniqueness enough?
5. **When should the 20 pilot records be promoted?** They are still
   `pending_verification` with `unknown_not_observable` HTTP fields; no live
   validation is possible from this sandbox.


---

## 13. What shipped

| Deliverable | Where |
|---|---|
| Schema, config, ledger constraints | `supabase/migrations/20261115_daily_quiz_schema.sql` |
| Eligible pool + sanitized payload | `supabase/migrations/20261116_daily_quiz_pool.sql` |
| Start, per-answer submission, vote accounting | `supabase/migrations/20261117_daily_quiz_flow.sql` |
| Mirror + SQL Editor chunks | `supabase/schema.sql`, `supabase/setup/12…14-*.sql` |
| DB tests (6 static + 14 real-Postgres) | `supabase/tests/dailyQuiz.test.js` |
| Client library: constants, validators, shuffle | `src/lib/dailyRewards.js` |
| Offline demo with the same contract | `src/lib/dailyRewardsDemo.js` |
| Screen: 5 steps, per-answer submit, verdict, locked state | `src/components/DailyRewards.jsx`, `.css` |
| Strings | `src/lib/i18n.jsx` |
| Static smoke checks | `tools/smoke.mjs` (section "daily quiz") |
| Documentation | `docs/DAILY-REWARDS.md`, this file |
| Corrective migration: check-in awards no vote | `supabase/migrations/20261118_daily_login_no_votes.sql`, `supabase/setup/15-daily-login-no-votes.sql` |

### Still open

1. **No approved questions exist yet.** Everything is in place except the
   question bank: `/quiz` reports `unavailable` until records with full source
   validation are imported into `public.daily_quiz_questions`.
2. **Legacy promotion path.** The 99 legacy rows sit at
   `approval_status = 'draft'`, `daily_eligibility_status = 'ineligible'` with
   `unknown_not_observable` source fields. Promoting one is a researched UPDATE
   (source, link check, fact match, safety review, then `approved` + `eligible`),
   not an automatic grandfathering.
3. **Hard questions** stay disabled until the validated hard pool reaches
   `min_hard_pool_to_enable` (30).
4. **Nothing else may award votes.** `20261118` removed the +2 check-in
   reward, so a check-in plus five correct answers is 5 votes, never 7. Any
   future reward source needs its own migration, config flag and cap test.
5. **Robots `Allow` precedence and 429/5xx retry** in the validator are still
   unresolved (see §3) — they affect how fast the bank can be validated, not how
   the quiz behaves.
