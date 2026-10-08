# Database migrations — how this project deploys them, and why 20261118 is quarantined

Audience: anyone applying SQL to a Supabase project for this app (production,
staging, or a fresh install). Read the “exact commands” section before you run
anything.

---

## 1. What the migration mechanism actually is here (verified in this repo)

| Question | Answer in this repository |
| --- | --- |
| Is there a migration runner in CI? | **No.** `.github/workflows/` contains only `backup-db.yml` (scheduled backup). No workflow applies SQL. |
| Is the Supabase CLI configured? | **No.** There is no `supabase/config.toml` and no `supabase link`. |
| How do migrations get applied today? | By hand: paste one file into **Dashboard → SQL Editor → Run**, or `psql -f`. |
| What is `supabase/schema.sql`? | The assembled fresh-install baseline through `20261120`; it is cut verbatim into `supabase/setup/01`–`16`. The data-dependent `20261121_vote_calendar_decoupling.sql` and the ACL-only `20261122_disable_daily_quiz_runtime.sql` deliberately stay out of that manual bundle and are applied by the guarded runner only. |
| Is there a migration history table? | Not in the app schema/setup bundle. The guarded runner creates `supabase_migrations.schema_migrations` after baseline verification and writes each migration row atomically; a pre-existing Supabase CLI history is also recognized. Migration 20261121 refuses to run without that table and its required source-state rows; 20261122 additionally refuses to run until 20261121 is recorded. |

Supabase CLI behaviour, for the day someone adopts it ([CLI reference](https://supabase.com/docs/reference/cli/supabase-migration-repair)):

- `supabase db push` applies every **top-level** `supabase/migrations/<timestamp>_<name>.sql`
  in filename order, skipping versions already recorded in
  `supabase_migrations.schema_migrations`. [migration list](https://supabase.com/docs/reference/cli/supabase-migration)
- Subdirectories are **not** scanned — the CLI only supports a flat migrations
  directory ([discussion #34058](https://github.com/orgs/supabase/discussions/34058)).
- If the remote history holds a version with no local file, `db push` **refuses**
  (`Remote migration versions not found in local migrations directory.`) — it does
  not silently skip it.
- `supabase migration repair --status applied` **inserts** a history row without
  running SQL; `--status reverted` **deletes** a history row without running SQL.
  Neither command touches schema or data.

The consequence that matters: because deployment is “run the files in the
folder, in order”, **a destructive file sitting in the folder is a loaded gun**.
Telling people to skip it is not a control — one `for f in supabase/migrations/*.sql`
loop, one careless paste, or one `db push` later and it runs.

---

## 2. What was wrong with 20261118 (now quarantined), and what replaced it

The quarantined `20261118_daily_login_no_votes.sql` contained:

```sql
update public.daily_login_rewards set reward = 0 where reward <> 0;

alter table public.daily_login_rewards
  add constraint daily_login_rewards_reward_check check (reward = 0);
```

A recorded check-in reward is **history**: a `2` recorded under the retired
policy must stay a `2`. This statement overwrites it irreversibly. It is
replaced by:

- `20261119_preserve_legacy_daily_login_rewards.sql` — same policy outcome (a
  check-in awards no vote) with **no** `UPDATE`/`DELETE` of history and no
  table-wide `CHECK`; future writes are blocked by a row trigger.
- `20261120_daily_login_reward_immutable.sql` — a recorded `reward` can never
  change after `INSERT` (`2 → 0`, `2 → 5`, `0 → 2` all raise
  `err.dailyLoginRewardImmutable`).

### 20261121 — vote quota + Calendar decoupling (supersedes Draft PR #29)

`20261121_vote_calendar_decoupling.sql` is a new, data-dependent cutover. It
copies the four **live** quota rows, snapshots the existing quiz-answer ledger,
backfills only already-awarded answer events into a neutral vote ledger, and
checks source/copy counts, exact rows, uniqueness, per-user/day totals and the
actual source-vs-neutral grant result before replacing vote functions. It does
not seed a quota, edit wallet balances/history or change free/bonus/purchased
spending order. Baseline readiness requires all four live quota keys but does not
compare their production values to repo seeds; 20261121 validates and copies the
actual values and proves equivalence before cutover. A new quiz answer records
its already-existing +1 bonus award in the neutral ledger in the same
transaction; replay does not write twice.

The same migration introduces Calendar-only status/claim RPCs. Claim identity
comes only from `auth.uid()`; `p_expected_day` is a stale-client guard, while
the server day comes from its Vietnam-local clock. Calendar responses omit quiz,
wallet and vote-award fields. Existing Quiz RPCs remain available.

The migration validates required source objects, signatures, RLS/ACL, indexes,
constraints, live config and migration state; locks source tables; and keeps
snapshot, backfill, assertions, cutover and commit together. Any exception
rolls back neutral objects/data and leaves source functions untouched. The
runner strips the migration file's outer `BEGIN/COMMIT` because it owns the
transaction that also writes migration history. A partially present target is
refused, not overwritten; do not try to clean it up with `DROP/CASCADE`.

The cutover keeps every fingerprint-visible attribute of the function it
replaces: `daily_free_vote_grant` stays `returns integer language sql stable
security definer` exactly as recorded in `supabase/baselines/20261120.json`,
so `db:verify-baseline --baseline 20261120` still reports READY after the
cutover, and the migration history row is what proves the cutover ran. The
fail-closed reads live in two internal helpers (`daily_vote_quota_bool`,
`daily_vote_quota_int`) that raise `err.voteQuotaConfig` on a missing, NULL or
mistyped neutral config row instead of substituting a default, and are revoked
from `public`, `anon` and `authenticated`. Changing a replacement function's
language/volatility/security-definer/return shape against a committed
fingerprint is what broke the migration guard on Draft PR #29; if a future
cutover must change those attributes, add a new baseline in the same PR.

`npm run test:migration:pglite` executes this file end to end against PostgreSQL
compiled to WASM: it proves the strict catalog preflight matches a real server,
that the live config/ledger equivalence and the cutover commit together, that
the Calendar RPCs answer under a real `auth.uid()`, and that every abort class
leaves no neutral object and no history row behind. It is the check to run
before requesting deploy approval when no disposable Postgres is available.

It is intentionally **not** mirrored into `schema.sql` or setup chunk `17`:
those files remain a verifiable `20261120` baseline. A fresh install first runs
setup `01`–`16`, verifies baseline `20261120`, and (only after separate deploy
approval) uses `npm run db:deploy -- --baseline 20261120` to apply this guarded
migration. Do not paste the cutover into an untracked SQL Editor session or run
it against production as part of this PR.

### 20261122 — Daily Quiz runtime off (client surface retired, data untouched)

`20261122_disable_daily_quiz_runtime.sql` closes the quiz entry points to every
client role now that the product no longer shows the Daily Quiz. It is
**revoke-only**: no `DROP`, no `DELETE`, no `UPDATE`, no function body change and
no new object. Five client-callable entry points lose `EXECUTE` for `public`,
`anon` and `authenticated` — `start_daily_quiz(uuid,date)`,
`submit_daily_quiz_answer(uuid,uuid,text,text)`,
`submit_daily_quiz(uuid,uuid,int[])`, `my_daily_rewards_status()` and
`claim_daily_login(uuid,date)` — so an old cached bundle cannot start a round or
claim the legacy combined payload even though the tables are still there.

The preflight fails closed unless the cutover is the recorded state: 20261121
must be in `supabase_migrations.schema_migrations`, the five quiz source tables
must exist as regular tables, the five signatures above must exist, the Calendar
RPCs (`my_daily_login_status()`, `claim_daily_login_calendar(date)`,
`my_daily_checkin_month(date)`) must still be callable by `authenticated`, and
the check-in immutability trigger must be active. Post-conditions run in the same
transaction: the five entry points are no longer executable by a client role,
the Calendar and vote APIs kept their grants, and quiz/check-in row counts are
identical to the snapshot taken before the revoke. Any failure aborts the whole
migration and writes no history row.

Because the file creates no object, it does not move the fresh-install bundle:
`schema.sql` and setup `01`–`16` stay at baseline `20261120`, the function
fingerprint is unchanged (function ACLs are not part of it), and
`db:verify-baseline --baseline 20261120` still reports READY after the revoke. It
is intentionally **not** mirrored into `schema.sql` or a setup chunk: a fresh
install verifies baseline `20261120`, then `npm run db:deploy -- --baseline
20261120` applies 20261121 and 20261122 in order.

The corrective rollback is `supabase/rollback/20261122_disable_daily_quiz_runtime.sql`.
After separate approval it restores `EXECUTE` for `authenticated` on the four
entry points that had it before 20261122 — `submit_daily_quiz(uuid,uuid,int[])`
was already closed by 20261117 and stays closed — and refuses to run when the
grants are back, the legacy single-shot is open, or the Calendar API is missing.
It never touches quiz rows, the check-in reward policy, wallet balances or the
Calendar/vote APIs. The historical quiz tables, answers and `daily_login_rewards`
rows are deliberately kept until the separately approved cleanup phase (see
`docs/DAILY-QUIZ-RETIREMENT.md`).

### 20261123 — production reconciled to the repo (policy, index, ACLs)

`20261123_reconcile_security_drift.sql` closes the gap that made
`db:verify-baseline -- --baseline 20261120` return NOT READY on production after
the PostgreSQL-version noise was separated out (see `tools/schema-drift-report.mjs`):
the comment policy was weaker than the bundle, `requests_picked_idx` was a
non-partial `(picked_at DESC)` index, and two ACL surfaces had never been
cleaned up. It does four things and nothing else:

| Part | Change | Why |
| --- | --- | --- |
| A | `alter policy request_comments_authenticated_insert … with check (…deleted_at is null…)` | production's live policy required `auth.uid() = user_id` and kept the "parent belongs to the same request" clause, but omitted **both** `deleted_at IS NULL` checks (`shadow preflight`, 2026-10-06). The preflight accepts exactly two known weak starting shapes — that one and the older bare `auth.uid() = user_id` — and aborts on anything else; the target expression is unchanged, so nothing is loosened |
| B | rebuild `requests_picked_idx` as the partial index `(picked_at) WHERE picked_at IS NOT NULL` | every query asks "has this been picked", so the partial index is the cheaper shape; measured 4 ms to rebuild on 5,000 rows |
| C1 | `revoke all on function public.create_request(text,text,text,text,text,boolean) from public, anon, authenticated` | the 20261103 overload kept the default `EXECUTE` to `PUBLIC`; it is unreachable by arity while the 7-argument version exists, but it is an unnecessary surface. Not dropped, so an old bundle still gets a 42501 and therefore the app's "please refresh" message instead of a PostgREST 404 |
| C2 | revoke `EXECUTE` from `public, anon` on `admin_expire_request`, `queue_expired_requests`, `requests_video_url_guard` | all three are `SECURITY DEFINER` and were created without a revoke; `queue_expired_requests()` writes rows and has no caller check |
| D | `revoke insert, update on public.request_comments from anon, authenticated`, `revoke insert/update (<every column>)` from both client roles, `grant insert (request_id, user_id, parent_id, body)` to `authenticated` | the 20260920 table-level grant allowed a client to set `deleted_at` at INSERT — the other half of the hole part A closes. **ACLs are not part of any fingerprint**, so no verifier reports this axis. Measured on production on 2026-10-06 the ACL was already column-scoped (`insert` at table level = false, `deleted_at` = false), so D is a no-op there; the statement pin the exact bundle ACL instead of trusting that the database happens to be right, and the post-check compares the full ACL (table-level flags plus column lists for both roles) against the bundle state |

The file never writes data: it only alters a policy, rebuilds an index, changes
privileges and writes comments. Its preflight refuses unknown shapes (a policy
text that is neither the old weak form nor the bundle form, an index definition
that is neither shape, a missing 7-argument `create_request`), and its
post-conditions re-count rows for `requests`, `request_comments`,
`notifications`, `daily_login_rewards`, the five quiz tables and the vote ledger
inside the same transaction.

How it is applied: on the production database the runner still refuses
`--baseline 20261120` when the deploy starts, because the live schema differs from
the committed fingerprint — that difference is the drift this migration fixes. It
is therefore applied out-of-band with `psql -X -v ON_ERROR_STOP=1 -f …` (mode E,
step 2 above), which is safe because the file is self-guarded and transactional.
Afterwards `db:verify-baseline -- --baseline 20261120` prints READY, and
`db:deploy -- --baseline 20261120` applies `20261121` and `20261122` and then
re-runs `20261123` as a no-op, recording its history row.

Rollback is `supabase/rollback/20261123_reconcile_security_drift.sql`. It
restores the previous policy text, the previous `request_comments` ACL (table-level
flags **and** column lists for both client roles) and the previous index definition
**from the record the migration wrote into the policy comment** — never from a
guess, and never wider than that record. On a database whose ACL was already
column-scoped, the rollback therefore leaves it column-scoped; it does not
re-grant `insert, update` at table level. It re-grants the legacy `create_request`
overload because that is something 20261123 genuinely closed, and refuses to run
unless the reconciled state is live — so running it twice aborts instead of
half-restoring. Reopening the weaker policy and the legacy overload reopens the
hole: that needs separate approval.

---
---

### 20261124 — daily free votes restored (3 per Vietnamese day)

`20261124_restore_daily_free_votes.sql` fixes the reported "Free today 0 / 0".
The engine for the daily quota already existed and was correct, but the live
policy still carried the retired value `free_vote_grant_enabled = false`, so
`daily_free_vote_grant()` returned 0 — and the panel, which renders
`free_left / free_limit` from `public.my_vote_status()`, showed 0 / 0 while the
bonus wallet (`profiles.bonus_credits`, a different column) was untouched.

The file is config-only. It writes exactly two keys in both copies that must stay
equal key for key — `public.daily_vote_quota_config` (what the vote functions
read) and `public.daily_quiz_config` (the mirror 20261121 copied from, whose
equality the 20261121 corrective rollback still verifies):

- `free_vote_grant_enabled`: `false` → `true`
- `free_votes_per_day`: `*` → `3`

`global_daily_vote_cap_enabled` and `global_daily_vote_cap` are **not** changed.
With the optional global cap on, the grant is
`least(free_votes_per_day, cap - earned_today)`, so a cap that cannot leave 3 free
votes after today's largest earning would silently deliver less. The file does not
guess and does not touch the cap: it refuses to run in that case and leaves the
policy decision to a reviewed change (one of the abort cases pinned by
`supabase/tests/dailyFreeVotes.test.js`).

Preflight (all reads; any failure aborts the whole transaction): the
guarded-runner history exists and records 20261121 + 20261122 + 20261123 but not
20261124; the neutral readers/writers exist and `daily_free_vote_grant()`,
`my_vote_status()` and `cast_vote()` really read the neutral config; both copies
hold all four keys with the expected JSON types and agree key for key; the
free-vote guarantee holds under an enabled cap. The previous live values are
recorded in the comment of `public.daily_vote_quota_config` (comments are
metadata: no fingerprint, no ACL, no API surface), which is what makes the
corrective rollback exact instead of a guess. The post-check re-reads both
copies, calls the live formula for a fresh account **and** `my_vote_status()` for
a real profile (the same call the browser makes), verifies the Daily Login claim
path still writes no vote and the check-in immutability trigger is active, and
re-compares every row count and both wallet sums in the same transaction.

Nothing else moves: no wallet, vote row, check-in row, quiz row or neutral ledger
row is written, and no function/table/index/policy/ACL is created or replaced —
so `supabase/schema.sql` + `supabase/setup/01`–`16` stay exactly at baseline
20261120 and `db:verify-baseline -- --baseline 20261120` still prints READY after
the flip (the four live quota keys are deliberately outside the fingerprint
comparison, see `LIVE_VOTE_QUOTA_CONFIG_KEYS`).

Apply with the guarded runner, after the cutover chain:

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:plan   -- --baseline 20261120
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261120
```

Rollback is `supabase/rollback/20261124_restore_daily_free_votes.sql`: it
restores exactly the recorded values (in production `false` + `3`, i.e. the
retired grant) in both copies, clears the record so a second rollback aborts, and
refuses to run when the target state is not live. Do not re-run 20261124 after a
rollback — its own preflight refuses a recorded version; re-enabling the quota is
a new forward migration.

Tests: `supabase/tests/dailyFreeVotes.pglite.mjs` (no server needed,
`npm run test:free-votes:pglite`) and `supabase/tests/dailyFreeVotes.test.js`
(real PostgreSQL through `MIGRATION_DEPLOY_TEST_DATABASE_URL`, run by the DB
migration safety workflow).

---

### 20261125 — reward eligibility and quota-race hardening (Batch 1)

`20261125_reward_eligibility_and_quota_races.sql` is an append-only forward
migration. It does not change an RPC signature, response JSON shape, achievement
catalog, or the `(user_id, achievement_id)` reward idempotency key, and it never
removes an existing achievement or credit.

- `claim_achievements()` counts only `queued` / `in_progress` / `completed`
  requests and counts one normalized artist/title per user. A paid achievement
  additionally needs `is_paid`, `payment_status = 'paid'`, and an `orders` row for
  that request/user with `kind = 'paid_request'` and `status = 'paid'`. In this
  schema, admin settlement is stored as `paid` (not a `completed` order status).
- `create_request()` locks the user's profile before reading either quota,
  re-checks the existing free-hour or awaiting-paid-order limit, then inserts in
  the same transaction. It does not introduce a quota ledger or backfill.
- `requester_ranking`, the season settlement helper, client demo/season ranking,
  and achievement preview use the same accepted states and distinct-work rule.
  The achievement preview uses a paginated, user-scoped request query rather
  than the public board's 800-row window, and the order fetch paginates beyond
  the former 200-row cap before it calculates paid progress.
- The migration creates an `orders(request_id)` btree only if catalog inspection
  finds no usable index with that leading key. The reviewed bundle has
  `orders_status_idx(status, created_at DESC)` and no request-id index.

Tests: `supabase/tests/rewardAbuse.test.js` runs the migration and behavioral
fixtures in PGlite as part of `npm test`. PGlite serializes work on one connection,
so it is not a true race proof; four opt-in multi-session PostgreSQL race cases
cover the free-quota boundary, a four-call free burst, the awaiting-paid-order
cap, and single bonus-credit redemption. They require
`REWARD_ABUSE_RUN_CONCURRENCY_TEST=1` and a disposable
`REWARD_ABUSE_TEST_DATABASE_URL` (the fixture creates and drops its own database).

This migration source has **not** been applied. Before any persistent test/staging
or production application, review `npm run db:plan -- --baseline 20261120` and get
separate approval. Do not deploy the app as part of this migration step.

---

## 3. The strategy chosen: quarantine (20261118 never runs) + guarded runner + clean fresh-install path

1. **Quarantine (Option B).** The file moved out of the execution path:
   `supabase/migrations/20261118_daily_login_no_votes.sql` →
   `supabase/migrations/archive/20261118_daily_login_no_votes.sql.superseded`.
   - The Supabase CLI does not scan subdirectories.
   - The name no longer ends in `.sql`, so no `*.sql` glob can match it.
   - The text is preserved (git history still shows the original path) — nothing
     was rewritten, and `supabase/migrations/archive/README.md` says why it is
     there. `archive/quarantine.json` is the machine-readable list the runner
     and the tests read.
2. **Guarded runner (Option A for bookkeeping).** `tools/migrate.mjs`
   (`npm run db:check` / `db:plan` / `db:deploy`) reads only the top level,
   skips quarantined versions, skips versions already recorded in history,
   refuses to guess a baseline for a populated database, and **fails closed** if
   any migration in the default path rewrites check-in history.
3. **Clean fresh-install path (Option C).** The superseded 20261118 block is absent from
   `supabase/schema.sql`; setup chunks `01`–`16` land exactly at baseline 20261120.
   The data-dependent 20261121 cutover is a separate guarded-runner step, not a
   manually pasted setup chunk. **This is enforced, not just documented:** `db:check`
   derives the objects that only migrations *after* the newest committed baseline create
   (for 20261120 that is `daily_vote_quota_config`, `daily_vote_quota_earnings`,
   `daily_vote_earned_on`, `daily_vote_quota_bool`, `daily_vote_quota_int`,
   `daily_login_calendar_payload`, `my_daily_login_status`, `claim_daily_login_calendar`)
   and fails closed — with the offending file, object and migration named — if a
   regenerated `schema.sql` or setup chunk declares one of them. Live-DB verification is
   deliberately *not* used for this: a post-cutover database legitimately contains these
   objects and must still verify as "READY for baseline 20261120", because the migration
   history row is what proves the cutover ran. The bundle is the artifact that must stay
   at the baseline; regenerate it only from a pre-cutover database, or supersede the
   baseline in a reviewed PR.
4. **Baseline hardening.** Recording a baseline says "this database already
   contains everything up to migration X". Because this project applied SQL by
   hand, that claim is easy to get wrong and impossible to notice later — so the
   runner verifies it: the live schema is compared against a committed
   fingerprint (`supabase/baselines/<version>.json`) of tables, columns, types,
   defaults, constraints, indexes, RLS, policies, functions, triggers and
   `daily_quiz_config` rows, plus a check for objects that a *later* migration
   creates. Any mismatch refuses the baseline, records nothing and applies
   nothing (modes A–E below).

Why not the alternatives: “please skip it” is not a control; editing the file in
place breaks append-only discipline for environments where it already ran;
deleting it destroys the audit trail of what was once shipped.

---

## 4. The five deployment modes — and the exact commands

> **Do not use `--baseline` unless the automated schema-readiness verification
> passes.** A baseline is a claim that the database already contains everything
> up to that migration. The runner only records it after comparing the live
> schema against a committed fingerprint (`supabase/baselines/<version>.json`),
> object by object. If that claim is unverifiable, the runner records nothing
> and applies nothing.

First, find out which mode you are in — this is read-only and safe to run
anytime:

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline
# no --baseline: verifies against every known baseline and prints a report
```

### A. Existing database already equivalent to post-20261117

```sh
npm run backup:db
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261117   # must print READY
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261117            # verifies again, then applies
```

`db:deploy` re-runs the readiness check inside the same invocation; it is not a
separate step you can forget. Only when it passes does the runner write the
baseline rows and apply every migration still pending after that baseline —
today that is `20261119` … `20261125`:

```
READY  baseline 20261117
skip 20261118  quarantined — Table-wide historical rewrite: …
skip 34 migration(s) at or below --baseline 20261117
recorded 34 migration(s) at or below --baseline 20261117 as applied
apply 20261119  20261119_preserve_legacy_daily_login_rewards.sql
apply 20261120  20261120_daily_login_reward_immutable.sql
apply 20261121  20261121_vote_calendar_decoupling.sql
apply 20261122  20261122_disable_daily_quiz_runtime.sql
apply 20261123  20261123_reconcile_security_drift.sql
apply 20261124  20261124_restore_daily_free_votes.sql
apply 20261125  20261125_reward_eligibility_and_quota_races.sql
```

`db:plan -- --baseline <version>` prints the same `skip …` lines plus a
`<n> migration(s) would be applied:` header and one `apply <version>  <file.sql>`
line per pending migration, and writes nothing at all — use it to see the plan
before running `db:deploy`. (Before this was fixed the plan branch returned before
printing the list, so a database with pending work printed only the `skip …` lines.)

Running the same command again prints `up to date — nothing to apply`.

### B. Existing database that has NOT applied 20261112–20261117

`--baseline 20261117` will be **refused** (the readiness check lists the missing
tables, RPCs, triggers and config rows). Do not work around it. Declare the
state that *is* there and let the runner apply the rest for real:

```sh
npm run backup:db
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261111
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261111
```

That applies `20261112 → 20261113 → 20261114 → 20261115 → 20261116 → 20261117 →
20261119 → 20261120 → 20261121` as real SQL. `20261118` is quarantined, so it is
skipped without anyone having to remember; historical `reward = 2` rows written
after 20261112 are preserved. The 20261121 source/config/data preflight must pass
before any vote function is replaced. Finish with
`npm run db:verify-baseline -- --baseline 20261120` (must print `READY`); that
committed fingerprint covers the source baseline, while the migration history
row confirms the post-baseline cutover was applied.

If the database is somewhere in between (some of 20261112–20261117 applied), it
is **mode E**, not mode B — the `ahead-of-baseline` check refuses
`--baseline 20261111` as soon as it sees an object a later migration creates.

### C. Fresh empty database

No baseline, no migrations — use the install path:

- **SQL Editor:** `supabase/setup/01-core-requests.sql` … `supabase/setup/16-daily-login-reward-immutable.sql`, one file per query, in order.
- **psql:** `psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/schema.sql`

Then verify the result instead of trusting it:

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261120   # must print READY
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261120            # records the verified baseline, then applies 20261121 … 20261125
```

The runner records the verified pre-cutover history and applies the guarded
20261121 SQL in the same migration transaction as its history row. If any live
source/config/data check fails, it rolls back and records nothing for that
migration. This path still never reaches the quarantined 20261118 migration.

### D. Database where 20261118 already ran

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261118   # the incident state
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261118             # applies 20261119 + 20261120, then the cutover chain 20261121 … 20261125
```

The report also tells you when a database you assumed was clean is not:
verifying an affected database against `20261117` prints the incompatible
`reward` default and CHECK **and** the note

```
note: a CHECK on the reward column exists (daily_login_rewards_reward_check: CHECK ((reward = 0))) —
20261118 appears to have run here. Use --baseline 20261118 (mode D) …
```

Afterwards the table-wide `CHECK` is gone and the immutability trigger is
installed. **Rewards that 20261118 already set to 0 are NOT restored** — that is
the administrator-only repair described in `20261120`, never an automatic step.

### E. Unknown or partial database

Do not migrate. Produce a report and choose deliberately:

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline        # diagnostics for every baseline
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261117
```

The runner refuses every `--baseline` whose fingerprint does not match, prints
every missing/incompatible object, writes no history and applies nothing.
Recovery options, in order of preference:

1. Restore the database from backup to a state that verifies (then mode A/B/C).
2. Bring the database forward by hand, one file at a time in SQL Editor, until
   `db:verify-baseline -- --baseline <the state it now matches>` prints `READY`.
3. If the state is legitimate and permanent, have a fingerprint generated for it
   and reviewed: build a reference database in that exact state, run
   `npm run db:baseline:snapshot -- --baseline <version>`, review the diff and
   commit it. Never hand-edit a fingerprint to make a deploy pass.

Option 2 is how the 20261123 reconcile migration is applied when the live schema
still differs from the committed fingerprint (that difference is exactly why the
runner refuses every `--baseline`): the migration is self-guarded (its own
fail-closed preflight and post-check, one transaction, no data writes), so it can
be applied by hand and the recorded verification then passes. Applying it a second
time — which is what `db:deploy` will do, because the manual run is not in the
history table — is a no-op that finally records the history row.

**PostgreSQL version differences are not drift.** PostgreSQL 18 records every
`NOT NULL` as a `pg_constraint` row (`contype = 'n'`); older majors do not. The
readiness check therefore ignores that difference in **both** directions, but only
where the column itself is still `not null` — a column that really lost `NOT NULL`
remains an `incompatible-nullability` problem, and a fingerprint captured on an
older server does not make a newer CI database fail. The drift report prints the
ignored rows separately.

## 5. Production runbook

| Step | Command | Gate |
| --- | --- | --- |
| 1 | `npm run backup:db` | backup file exists |
| 2 | `npm run db:verify-baseline` (no `--baseline`) | identifies the mode |
| 3 | `npm run db:verify-baseline -- --baseline <mode's version>` | prints `READY` |
| 4 | `npm run db:deploy -- --baseline <mode's version>` | records the verified baseline; applies `20261119`/`20261120` when pending, then the fail-closed `20261121` … `20261125` chain |
| 5 | queries in section 6 | histogram unchanged, 0 reward CHECKs, 1 trigger |
| 6 | deploy the frontend in the same release | — |

Never pass `--baseline` on the strength of "it looks up to date" or "we pasted
those files last year". If the readiness check fails, you are in mode E.

## 5b. Staging runbook

Staging is where the baseline is proven before production:

1. Restore the production snapshot into staging (`npm run backup:db` → restore).
2. `npm run db:verify-baseline` — confirm it reports the same mode you expect in production.
3. Run the same `db:deploy -- --baseline <version>` you intend to run in production.
4. Run the section 6 queries; compare the `reward` histogram with production.
5. Exercise the app: check-in (0 votes, wallet unmoved) and a full quiz (5 correct = 5 votes, never 7).
6. Only then repeat steps 1–5 against production.

A staging database that has drifted (mode E) is a finding, not an obstacle:
rebuild it from the production snapshot rather than inventing a new baseline.

## 6. Verification after any deployment

```sql
-- 1. History is untouched: rows with reward = 2 are EXPECTED and must survive.
select reward, count(*) from public.daily_login_rewards group by reward order by reward;

-- 2. No table-wide rule on reward (expect 0).
select count(*) as reward_checks from pg_constraint
 where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%reward%';

-- 3. The immutability trigger is installed (expect 1 row).
select tgname from pg_trigger
 where tgrelid = 'public.daily_login_rewards'::regclass and not tgisinternal;

-- 4. A recorded amount cannot be changed any more (must raise
--    err.dailyLoginRewardImmutable).
update public.daily_login_rewards set reward = 0 where reward <> 0;

-- 5. A check-in awards nothing (expect reward 0 / votes_awarded 0, wallet unmoved).
select public.claim_daily_login(auth.uid(), (now() at time zone 'Asia/Ho_Chi_Minh')::date);
```

The quiz rules are unchanged: 5 questions per user per quiz day, 1 correct
answer = 1 vote, maximum 5 quiz votes per day, Daily Login awards 0.

---

## 7. Rollback and recovery

| Situation | What to do |
| --- | --- |
| A migration fails mid-way | Each migration body and its history row run in one transaction; nothing partial is committed. Fix the cause and re-run `db:deploy` only after confirming the original transaction rolled back. |
| 20261121 vote cutover needs a functional rollback | After separate approval and a compatible app release, run `supabase/rollback/20261121_vote_calendar_decoupling.sql`. It requires the recorded cutover state and exact agreement between live quota config, source awards and neutral ledger; on drift it aborts rather than restoring a stale quota. It restores the source-based vote functions and Quiz answer writer, but keeps neutral tables/data, grants/RLS and the Calendar-only API. The neutral ledger then remains an audit snapshot; future Quiz awards return to the source answer table. It does not DROP/CASCADE or change balances/history. Do not re-run 20261121; a later re-cutover needs a new reviewed migration. |
| 20261122 quiz door must be reopened (coordinated frontend rollback) | After separate approval, run `supabase/rollback/20261122_disable_daily_quiz_runtime.sql`. It restores `EXECUTE` to `authenticated` on the four entry points that had it, keeps the legacy single-shot closed, and aborts if the revoke is not the live state or the Calendar API is missing. It does not re-enable quiz awards or the route, and it touches no quiz row. |
| 20261123 reconcile caused a regression | After separate approval, run `supabase/rollback/20261123_reconcile_security_drift.sql`. It restores the policy text, the `request_comments` ACL and the index definition recorded in the migration's own comment (the ACL never comes back wider than it was), re-grants the legacy `create_request` overload, and aborts unless the reconciled state is live. It reopens a weaker policy and a legacy function surface — only use it for a real incident, and prefer fixing forward with a new migration. |
| 20261124 daily free votes must be retired again | After separate approval, run `supabase/rollback/20261124_restore_daily_free_votes.sql`. It restores exactly the policy recorded in the comment of `public.daily_vote_quota_config` (in production the retired `false` + `3`), in both config copies, and aborts unless the 20261124 state is live. It touches no wallet, vote row, check-in row or ledger row, and it clears the record so it cannot be replayed. Prefer fixing forward with a new migration; do not re-run 20261124. |
| Wrong data written by a new migration | Write a **new** migration that corrects it. Never edit a file that may already have been applied anywhere. |
| A destructive statement must be removed from the path | Move it to `supabase/migrations/archive/`, add it to `archive/quarantine.json`, remove its mirror from `schema.sql`, re-run `npm run schema:split`, and keep the repair as a new append-only migration. |
| 20261118 already ran | Mode D above. Zeroed rows are not restorable from the database alone — use the backup taken before it ran, or the administrator-only repair migration in `20261120`. |
| A baseline was recorded against the wrong state | The migrations it skipped were never applied. Do not "fix" it by editing `supabase_migrations.schema_migrations` by hand — re-verify with `db:verify-baseline`, then bring the database forward with the real migrations (mode B) or from backup (mode E). |
| Point-in-time restore needed | `npm run backup:db` / `npm run backup:verify` (`scripts/backup-db.sh`, `scripts/verify-backup.sh`) and Supabase PITR. |

---

## 8. Adding a migration

- New file: `supabase/migrations/<YYYYMMDD>_<snake_case_name>.sql`. Transactional migrations may have an explicit outer `begin;` … `commit;`; the guarded runner removes that pair so migration SQL and its history row commit together. A data-dependent fail-closed cutover may deliberately reject reruns/partial target state rather than use `IF NOT EXISTS`.
- Never modify a file that may already have been applied anywhere.
- Never rewrite check-in history: no `update daily_login_rewards set reward = …`,
  no `delete from daily_login_rewards`, no table-wide `CHECK (reward = 0)`.
  `npm run db:check` fails the build if one appears.
- Mirror ordinary static schema changes into `supabase/schema.sql`, then run
  `npm run schema:split` and `npm run schema:split:check`. Do **not** mirror a
  data-dependent cutover into the manual fresh-install bundle unless its
  baseline/history path has been reviewed; 20261121 is the explicit guarded-
  runner exception described above.
- Regenerate affected baseline fingerprints only from a known-good PostgreSQL
  database (`npm run db:baseline:snapshot`) and commit the reviewed result.
  Never hand-author a snapshot to make a deploy pass.

---

## 9. Automated guards

| Command | What it proves |
| --- | --- |
| `npm run db:check` | No destructive statement in any active migration, in `schema.sql`, or in a setup chunk; the quarantine manifest is consistent; and the fresh-install bundle (`schema.sql` + setup chunks) contains no object that only a migration after the newest committed baseline creates. No database needed. |
| `npm run db:verify-baseline` | Read-only schema-readiness report: which baseline this database matches, or every missing/incompatible object. Differences that are only the PostgreSQL catalog encoding of `NOT NULL` (`contype = 'n'`, present on PostgreSQL 18 and absent on older majors) are reported as notes, in both directions, and only when the column is actually `not null`; `npm run db:verify-baseline` exits non-zero only for real drift. |
| `npm run test:baseline:db` | On a real database: mode A/B/C/D/E behaviour, every failure class, and that a failed readiness check writes no migration history. |
| `npm run test:migration:pglite` | `supabase/tests/voteCalendarDecoupling.pglite.mjs`: builds the `20261117`+`20261119`+`20261120` source state inside PGlite (PostgreSQL compiled to WASM, bundled as a dev dependency) and runs the real `20261121` migration and rollback files against it — live-config copy, backfill/equivalence, RLS/ACL, spending order, quiz idempotency, the Calendar-only RPCs, the drift-refusing rollback and every abort class. No server, no credentials, no network; opt-in so the default `npm test` stays fast. |
| `npm test` | Includes `tools/migration-safety.test.mjs` (12 static/deployment-runner tests) and, when a test Postgres is configured, `supabase/tests/migrationDeploy.test.js`, `supabase/tests/baselineReadiness.test.js`, `supabase/tests/voteCalendarDecoupling.test.js` (real cutover, live quota, RLS, Calendar and rollback checks), and `supabase/tests/schemaChunks.test.js`. PostgreSQL-only tests are reported as skipped unless a disposable test database URL is configured. |
| `npm run schema:split:check` | The setup chunks still concatenate byte-for-byte to `schema.sql`. |
| `.github/workflows/db-migration-safety.yml` | On every push/PR touching `supabase/**`, `tools/migrate.mjs` or `scripts/split-schema.mjs`: `npm run db:check`, `npm run schema:split:check`, `npm test`, `npm run lint`. It applies nothing and needs no credentials. |

Test databases are opt-in and local-only — never point them at production:

```sh
export MIGRATION_DEPLOY_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres
export SCHEMA_CHUNKS_TEST_DATABASE_URL=$MIGRATION_DEPLOY_TEST_DATABASE_URL
export DAILY_REWARDS_TEST_DATABASE_URL=$MIGRATION_DEPLOY_TEST_DATABASE_URL
export DAILY_QUIZ_TEST_DATABASE_URL=$MIGRATION_DEPLOY_TEST_DATABASE_URL
export DAILY_SPIN_TEST_DATABASE_URL=$MIGRATION_DEPLOY_TEST_DATABASE_URL
export COMMENTS_TEST_DATABASE_URL=$MIGRATION_DEPLOY_TEST_DATABASE_URL
npm test
```

---

## 20261126 → 20261128 — B1: reward ledger, login rewards, achievements v2

Ba file append-only, một transaction mỗi file, rerunnable, KHÔNG thuộc
fresh-install bundle (bundle dừng ở baseline 20261120 như 20261121+):

| File | Vai trò |
| --- | --- |
| `20261126_reward_ledger.sql` | Sổ cái `reward_events` + `reward_config` + `reward_milestone_once` + hàm cấp duy nhất `grant_reward_event` (cap 30/ngày, scale-down, idempotent). Chưa có đường client nào gọi trực tiếp. |
| `20261127_login_streak_rewards.sql` | `claim_daily_login_calendar` trả thưởng (+2; ngày 7 chu kỳ +5 cộng thêm; mốc 7 ngày +10; mốc 30 ngày +20 một lần) và RPC mới `my_login_reward_status` (exact-key, thêm RPC chứ không đổi payload lịch — bundle cũ không vỡ). |
| `20261128_achievements_v2.sql` | Catalog 42 → **20 active** (25 deactivate, không xoá), nới CHECK `source` thêm `pick/vote_back/mystery`, `claim_achievements` trả vote qua ledger + cap với tự-bù slice. |

Quy tắc an toàn được giữ vững: **không** đụng cột `daily_login_rewards.reward`
(trigger 20261120 vẫn là chốt cuối), **không** UPDATE/DELETE dữ liệu lịch sử,
thưởng đã cấp không bao giờ bị rollback thu hồi. Rollback: `supabase/rollback/2026112{6,7,8}_*.sql`
— 20261126 chỉ xoá được khi sổ cái còn trống; 20261128 từ chối nếu đã có người
giả mốc Đặc biệt. Test: `npm run test:ledger:pglite`; các manifest test của
runner (`tools/migration-safety.test.mjs`) đã cập nhật lên 44 migration active.
