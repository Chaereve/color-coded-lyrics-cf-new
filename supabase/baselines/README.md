# Baseline fingerprints — what a migration is allowed to claim

`tools/migrate.mjs` records a **baseline** when a database already contains
migrations that were applied before migration history existed (this project
applied SQL by hand). Recording `--baseline 20261117` says: *this database is
equivalent to the state produced by 20261112…20261117*. If that claim is wrong,
those migrations are skipped and the database ends up half-migrated — so it is
never taken on trust. Before a baseline is recorded, the runner compares the
live schema against one of these fingerprints, object by object, and refuses on
any missing or incompatible object.

| File | Database state it proves |
| --- | --- |
| `20261111.json` | Core app only — before the Daily Rewards / Daily Quiz migrations. |
| `20261117.json` | Core + 20261112…20261117 — the normal production state (mode A). |
| `20261118.json` | The state left behind by the destructive `20261118` (mode D). |
| `20261120.json` | The final state: core + 20261112…20261117 + 20261119 + 20261120 — also what a fresh install produces (mode C). |

What each fingerprint contains, for every table and function in `public`:
columns and types, nullability, defaults and generated columns; primary keys,
unique, foreign key and check constraints; indexes; RLS state and every policy
(command, roles, `using` / `with check`); security-definer functions with their
full signature, return type, volatility and language; triggers with their
definitions; and every `daily_quiz_config` row. Objects that a *later*
migration creates are also checked for: finding one means the declared baseline
is too low, which is refused as `ahead-of-baseline`.

## Regenerating a fingerprint

Only from a **known-good reference database**, and the result is a reviewed
change:

```sh
# 1. Build a throwaway project and install it up to the baseline you need
#    (fresh install: supabase/setup/01…16), or point at a verified database.
# 2. Capture it.
SUPABASE_DB_URL='postgresql://…' npm run db:baseline:snapshot -- --baseline 20261117
# 3. Review the diff, then commit supabase/baselines/20261117.json.
```

`npm test` (with a test PostgreSQL configured) rebuilds the reference states
from the repository's own files and checks them against these fingerprints, so a
stale or hand-edited snapshot fails the suite.

## Rules

- Do not hand-edit a fingerprint to make a failing deployment pass — that
  defeats the check. Fix the database, or generate a fingerprint for a state
  that has been reviewed.
- A fingerprint belongs to the PostgreSQL major version it was captured on.
  Regenerate it on the target version if the deployment reports only cosmetic
  definition differences.
