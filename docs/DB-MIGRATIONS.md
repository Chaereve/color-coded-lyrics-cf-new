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

Why not the alternatives: “please skip it” is not a control; editing the file in
place breaks append-only discipline for environments where it already ran;
deleting it destroys the audit trail of what was once shipped.

---

## 4. Exact commands

### A. Production / staging that has never run 20261112–20261120

```sh
# 0. Back up first (see HUONG-DAN.md).
npm run backup:db

# 1. Nothing is applied yet — print the plan. It must list exactly two files.
SUPABASE_DB_URL='postgresql://…' npm run db:plan -- --baseline 20261117

# 2. Apply.
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261117
```

`--baseline 20261117` means “everything up to and including 20261117 is already
in this database; only run what comes after it”. The runner refuses to continue
without it when the history table is empty and app tables exist, so it can never
replay old migrations against live data.

Expected plan output:

```
skip 20261118  quarantined — Table-wide historical rewrite: …
skip 34 migration(s) at or below --baseline 20261117 (they will be recorded as applied, not executed)
would apply 20261119  20261119_preserve_legacy_daily_login_rewards.sql
would apply 20261120  20261120_daily_login_reward_immutable.sql
```

`--apply` writes the baseline down first (`baseline 20261117: recorded, not
executed`), so running the same command twice is a no-op instead of a replay:
the second run prints `up to date — nothing to apply`. The runner records each
migration and its history row in one transaction, and takes a transaction-scoped
advisory lock so two deploys cannot interleave.

SQL Editor fallback (same result, still safe because the destructive file is not
in the folder): paste `20261119…sql`, Run; paste `20261120…sql`, Run.

### B. An environment where 20261118 already ran

```sh
# If the migration history is tracked (the CLI was used): just deploy —
# the runner reports the quarantined row and never re-runs it.
SUPABASE_DB_URL='postgresql://…' npm run db:deploy

# If nothing is tracked (files were pasted by hand): declare the baseline.
SUPABASE_DB_URL='postgresql://…' npm run db:deploy -- --baseline 20261118
```

Both apply `20261119` then `20261120`. They remove the table-wide `CHECK` and
install the immutability trigger, so **no further** history can be rewritten —
but reward values that 20261118 already set to `0` are **not** restored. That
restore, if it is ever wanted, is the separate administrator-only repair
migration documented in the header of `20261120` (before/after audit log,
trigger disabled for one statement).

If you later adopt the Supabase CLI and `db push` refuses with
`Remote migration versions not found in local migrations directory.`:

```sh
supabase migration repair 20261118 --status reverted   # deletes the history row only
```

This runs **no SQL** and touches **no data**. Run it only while
`supabase/migrations/20261118_daily_login_no_votes.sql` does **not** exist
locally (it does not — it is quarantined); otherwise `db push` would try to
execute it again.

### C. Fresh installation (empty project)

Recommended, in **Database → SQL Editor → New query → Run**, one file per query,
in order: `supabase/setup/01-core-requests.sql` … `supabase/setup/16-daily-login-reward-immutable.sql`
(each file is a mirror of a slice of `supabase/schema.sql`, kept in sync by
`npm run schema:split`). Details: `supabase/setup/README.md`.

Or, from your own machine with `psql` and the **Session pooler** URL:

```sh
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

Neither path contains the destructive rewrite: there is no chunk for 20261118,
and `schema.sql` no longer carries it.

### D. Partial history (staging, dev, half-applied)

```sh
SUPABASE_DB_URL='postgresql://…' npm run db:plan        # shows what is missing
SUPABASE_DB_URL='postgresql://…' npm run db:deploy      # applies only those
```

The runner compares the file list with `supabase_migrations.schema_migrations`
and applies only what is missing, in filename order, each migration in a single
transaction together with its history row.

---

## 5. Verification after any deployment

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

## 6. Rollback and recovery

| Situation | What to do |
| --- | --- |
| A migration fails mid-way | Each migration runs in one transaction with its history row; nothing partial is committed. Fix the cause and re-run `db:deploy`. |
| Wrong data written by a new migration | Write a **new** migration that corrects it. Never edit a file that may already have been applied anywhere. |
| A destructive statement must be removed from the path | Move it to `supabase/migrations/archive/`, add it to `archive/quarantine.json`, remove its mirror from `schema.sql`, re-run `npm run schema:split`, and keep the repair as a new append-only migration. |
| 20261118 already ran | Section B above. Zeroed rows are not restorable from the database alone — use the backup taken before it ran, or the administrator-only repair migration in `20261120`. |
| Point-in-time restore needed | `npm run backup:db` / `npm run backup:verify` (`scripts/backup-db.sh`, `scripts/verify-backup.sh`) and Supabase PITR. |

---

## 7. Adding a migration

- New file: `supabase/migrations/<YYYYMMDD>_<snake_case_name>.sql`, one
  transaction (`begin;` … `commit;`), rerunnable.
- Never modify a file that may already have been applied anywhere.
- Never rewrite check-in history: no `update daily_login_rewards set reward = …`,
  no `delete from daily_login_rewards`, no table-wide `CHECK (reward = 0)`.
  `npm run db:check` fails the build if one appears.
- Mirror the file into `supabase/schema.sql`, then `npm run schema:split` and
  `npm run schema:split:check`.

---

## 8. Automated guards

| Command | What it proves |
| --- | --- |
| `npm run db:check` | No destructive statement in any active migration, in `schema.sql`, or in a setup chunk; the quarantine manifest is consistent. No database needed. |
| `npm test` | Includes `tools/migration-safety.test.mjs` (9 static deployment-safety tests) and, when a test Postgres is configured, `supabase/tests/migrationDeploy.test.js` (scenarios A, B, D on a real database) and `supabase/tests/schemaChunks.test.js` (scenario C, fresh install). |
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
