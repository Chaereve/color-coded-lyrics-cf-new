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
| What is `supabase/schema.sql`? | The assembled current state (base schema + every migration in order). It is cut verbatim into `supabase/setup/NN-*.sql`, which is the fresh-install path. |
| Is there a migration history table? | Not in the app schema. `supabase_migrations.schema_migrations` only exists if/when the Supabase CLI is used. |

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
3. **Clean fresh-install path (Option C).** The superseded 20261118 block is removed from
   `supabase/schema.sql`, so the regenerated setup chunks are `01 … 16`, with no
   superseded destructive chunk in the recommended list.
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
baseline rows and apply `20261119` + `20261120`:

```
READY  baseline 20261117
skip 20261118  quarantined — Table-wide historical rewrite: …
skip 34 migration(s) at or below --baseline 20261117
recorded 34 migration(s) at or below --baseline 20261117 as applied
apply 20261119  20261119_preserve_legacy_daily_login_rewards.sql
apply 20261120  20261120_daily_login_reward_immutable.sql
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
20261119 → 20261120` as real SQL. `20261118` is quarantined, so it is skipped
without anyone having to remember; historical `reward = 2` rows written after
20261112 are preserved. Finish with
`npm run db:verify-baseline -- --baseline 20261120` (must print `READY`).

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
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261120            # records history, applies nothing
```

The second command only seeds the migration history — no SQL is applied — and
neither path reaches the quarantined migration.

### D. Database where 20261118 already ran

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:verify-baseline -- --baseline 20261118   # the incident state
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261118             # applies 20261119 + 20261120
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
| 4 | `npm run db:deploy -- --baseline <mode's version>` | prints the two applied migrations |
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
| A migration fails mid-way | Each migration runs in one transaction with its history row; nothing partial is committed. Fix the cause and re-run `db:deploy`. |
| Wrong data written by a new migration | Write a **new** migration that corrects it. Never edit a file that may already have been applied anywhere. |
| A destructive statement must be removed from the path | Move it to `supabase/migrations/archive/`, add it to `archive/quarantine.json`, remove its mirror from `schema.sql`, re-run `npm run schema:split`, and keep the repair as a new append-only migration. |
| 20261118 already ran | Mode D above. Zeroed rows are not restorable from the database alone — use the backup taken before it ran, or the administrator-only repair migration in `20261120`. |
| A baseline was recorded against the wrong state | The migrations it skipped were never applied. Do not "fix" it by editing `supabase_migrations.schema_migrations` by hand — re-verify with `db:verify-baseline`, then bring the database forward with the real migrations (mode B) or from backup (mode E). |
| Point-in-time restore needed | `npm run backup:db` / `npm run backup:verify` (`scripts/backup-db.sh`, `scripts/verify-backup.sh`) and Supabase PITR. |

---

## 8. Adding a migration

- New file: `supabase/migrations/<YYYYMMDD>_<snake_case_name>.sql`, one
  transaction (`begin;` … `commit;`), rerunnable.
- Never modify a file that may already have been applied anywhere.
- Never rewrite check-in history: no `update daily_login_rewards set reward = …`,
  no `delete from daily_login_rewards`, no table-wide `CHECK (reward = 0)`.
  `npm run db:check` fails the build if one appears.
- Mirror the file into `supabase/schema.sql`, then `npm run schema:split` and
  `npm run schema:split:check`.
- Regenerate the affected baseline fingerprints (`npm run db:baseline:snapshot`)
  if the migration changes an object any of them covers, and commit the result:
  `npm run test:baseline:db` fails while a fingerprint is stale.

---

## 9. Automated guards

| Command | What it proves |
| --- | --- |
| `npm run db:check` | No destructive statement in any active migration, in `schema.sql`, or in a setup chunk; the quarantine manifest is consistent. No database needed. |
| `npm run db:verify-baseline` | Read-only schema-readiness report: which baseline this database matches, or every missing/incompatible object. |
| `npm run test:baseline:db` | On a real database: mode A/B/C/D/E behaviour, every failure class, and that a failed readiness check writes no migration history. |
| `npm test` | Includes `tools/migration-safety.test.mjs` (9 static deployment-safety tests) and, when a test Postgres is configured, `supabase/tests/migrationDeploy.test.js` (deployment scenarios on a real database), `supabase/tests/baselineReadiness.test.js` (18 baseline-safety tests) and `supabase/tests/schemaChunks.test.js` (fresh install). |
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
