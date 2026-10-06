# Daily Quiz retirement — what is off now, what is kept, what a cleanup may drop

Status: **retirement of the user-facing surface is part of the decoupling PR
(#30). The database cleanup below is NOT part of it.** Nothing in this repository
drops, deletes or rewrites quiz data today; the file that closes the quiz door
(`20261122_disable_daily_quiz_runtime.sql`) is revoke-only.

## 1. What is retired now

- **Route.** `/quiz` no longer has a screen. `src/App.jsx` keeps a single
  `RETIRED_PATHS = { '/quiz': '/daily-login' }` entry: the old address replaces
  the URL with `/daily-login` instead of pushing a new history entry, so a
  bookmark or an old link lands on the check-in calendar without a dead page and
  without a back-button trap.
- **UI.** `DailyRewards.jsx` / `DailyRewards.css` (the quiz + rewards screen) and
  its controller (`src/lib/dailyRewards.js`, `dailyRewardsDemo.js`) are deleted.
  The sidebar has no quiz entry, `Icon.jsx` no longer ships the quiz glyph,
  `sitemap.xml` no longer lists `/quiz`, and `public/_headers` keeps its
  `/daily-login` rule without advertising the retired path.
- **Text.** Every user-facing string that mentioned the quiz (47 i18n keys:
  quiz, questions, answers, "streak from quiz", quiz reward) is gone. What stays
  is the six `err.dailyQuiz*` failure messages, because the SQL functions still
  raise them and the i18n coverage test requires a translation for every raised
  code. They are unreachable from the retired flow — the only callers were the
  RPCs whose `EXECUTE` was revoked — and they disappear in the cleanup phase
  together with those functions.
- **Client API surface.** `src/lib/db.js` no longer calls `start_daily_quiz` /
  `submit_daily_quiz_answer`. A cached old bundle that still calls them is
  refused by the database: `20261122` revokes `EXECUTE` on the five client
  entry points from `public`, `anon` and `authenticated`.
- **Daily Login is independent.** The check-in calendar reads only
  `my_daily_login_status()`, `claim_daily_login_calendar(date)` and
  `my_daily_checkin_month(date)`; its payload has no quiz, credits, `earned_today`
  or `votes_awarded` fields. No quiz table is read to render it.

## 2. What is deliberately kept (and why)

| Kept | Reason |
| --- | --- |
| `daily_quiz_questions`, `daily_quiz_config`, `daily_quiz_attempts`, `daily_quiz_answers`, `daily_quiz_seen` | Historical product data. A retirement is not a licence to delete user history; dropping them is a separate, approved cleanup. |
| Every quiz function (bodies untouched) | `20261122` changes ACLs only. Dropping a function is destructive and belongs to the cleanup phase. |
| `daily_login_rewards` rows | Check-in history; the recorded amount is immutable (`err.dailyLoginRewardImmutable`). Untouched by this work. |
| `daily_vote_quota_earnings` rows, including `source = 'daily_quiz'` | The neutral vote ledger is the audit trail of what was already awarded. It stays even after the quiz is gone. |
| `daily_vote_quota_config` | Live vote policy. It must never be reconstructed from repo seeds. |
| `supabase/setup/12`–`14`, the quiz block in `schema.sql`, `data/kpop-quiz-bank/*`, `tools/question-bank*`, the question-bank workflow, `docs/DAILY-QUIZ-PLAN.md` | Repository-side install/authoring material and documentation, not a user-facing surface. They keep the fresh-install bundle verifiable against baseline `20261120`. |

## 3. Cleanup phase — the exact drop list (NOT executed here)

A later, separately approved migration (with a verified backup) may drop:

- **Tables (5):** `public.daily_quiz_questions`, `public.daily_quiz_config`,
  `public.daily_quiz_attempts`, `public.daily_quiz_answers`,
  `public.daily_quiz_seen`.
- **Constraint (1):** the `unique (user_id, quiz_day)` constraint on
  `daily_quiz_attempts` (`daily_quiz_attempts_user_id_quiz_day_key`).
- **Indexes (4):** `daily_quiz_answers_day_idx`,
  `daily_quiz_attempts_user_quiz_date_idx`, `daily_quiz_questions_pool_idx`,
  `daily_quiz_seen_recent_idx`.
- **Quiz-only functions (11):** `start_daily_quiz(uuid,date)`,
  `submit_daily_quiz_answer(uuid,uuid,text,text)`,
  `submit_daily_quiz(uuid,uuid,int[])`, `daily_quiz_bool(text,boolean)`,
  `daily_quiz_int(text,int)`, `daily_quiz_num(text)`, `daily_quiz_mix(jsonb)`,
  `daily_quiz_pick(...)`, `daily_quiz_pool(uuid,date)`,
  `daily_quiz_candidates(uuid,date)`, `daily_quiz_votes_on(uuid,date)`.
- **Legacy combined entry points (2, drop only after the Calendar has been the
  only live path for a full rollout):** `my_daily_rewards_status()`,
  `claim_daily_login(uuid,date)`. They are already revoked from every client role.
- **Install bundle:** setup chunks `12`–`14` and the quiz block in
  `supabase/schema.sql`, followed by `npm run schema:split` and a **new committed
  baseline** (the `20261120` fingerprint still describes the quiz objects, so
  removing them requires a new snapshot in the same PR — see
  `docs/DB-MIGRATIONS.md`).

**Never dropped by that cleanup:** `daily_vote_quota_earnings` (including
`source = 'daily_quiz'` rows), `daily_vote_quota_config`, `daily_login_rewards`,
and the history table.

## 4. Preconditions before any of the drops above

1. **Verified backup.** `npm run backup:db` followed by `npm run backup:verify`
   on a clean Postgres, with the dump stored off-machine (the free Supabase tier
   has no automatic backups).
2. **Archive/export first.** Export the five tables to a dated archive
   (JSON/CSV + row counts + SHA-256), and record the object inventory
   (`pg_dump --schema-only` section) in the cleanup PR.
3. **Stability window.** Daily Login + Calendar + the free/bonus/purchased vote
   order must have run in production without quiz-related incident for the agreed
   window (no client errors from the revoked RPCs, no missing vote quota).
4. **Rollback plan.** The cleanup PR must state how to restore: from the verified
   backup, plus a new append-only migration that recreates the objects if the
   drop has to be undone. Dropping in one transaction, one object family at a
   time, so a partial state is impossible.
5. **Approval.** The cleanup is its own PR with its own review; it is never part
   of the decoupling PR (#30) and never runs through the guarded runner by
   accident (`db:check` fails closed on destructive statements in the default
   path).
