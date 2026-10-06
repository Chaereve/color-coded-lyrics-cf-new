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
| What is `supabase/schema.sql`? | The assembled fresh-install baseline through `20261120`; it is cut verbatim into `supabase/setup/01`–`16`. The data-dependent `20261121_vote_calendar_decoupling.sql` deliberately stays out of that manual bundle and is applied by the guarded runner only. |
| Is there a migration history table? | Not in the app schema/setup bundle. The guarded runner creates `supabase_migrations.schema_migrations` after baseline verification and writes each migration row atomically; a pre-existing Supabase CLI history is also recognized. Migration 20261121 refuses to run without that table and its required source-state rows. |

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
baseline rows and apply `20261119` + `20261120` + `20261121`:

```
READY  baseline 20261117
skip 20261118  quarantined — Table-wide historical rewrite: …
skip 34 migration(s) at or below --baseline 20261117
recorded 34 migration(s) at or below --baseline 20261117 as applied
apply 20261119  20261119_preserve_legacy_daily_login_rewards.sql
apply 20261120  20261120_daily_login_reward_immutable.sql
apply 20261121  20261121_vote_calendar_decoupling.sql
```

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
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261120            # records the verified baseline, then applies 20261121
```

The runner records the verified pre-cutover history and applies the guarded
20261121 SQL in the same migration transaction as its history row. If any live
source/config/data check fails, it rolls back and records nothing for that
migration. This path still never reaches the quarantined 20261118 migration.

### D. Database where 20261118 already ran

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261118   # the incident state
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261118             # applies 20261119 + 20261120 + 20261121
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

## 5. Production runbook

| Step | Command | Gate |
| --- | --- | --- |
| 1 | `npm run backup:db` | backup file exists |
| 2 | `npm run db:verify-baseline` (no `--baseline`) | identifies the mode |
| 3 | `npm run db:verify-baseline -- --baseline <mode's version>` | prints `READY` |
| 4 | `npm run db:deploy -- --baseline <mode's version>` | records the verified baseline; applies `20261119`/`20261120` when pending, then fail-closed `20261121` |
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
| `npm run db:verify-baseline` | Read-only schema-readiness report: which baseline this database matches, or every missing/incompatible object. |
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
