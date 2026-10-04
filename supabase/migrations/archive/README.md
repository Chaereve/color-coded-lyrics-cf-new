# Quarantined migrations — never executed by the default path

Files here are **out of the migration runner's reach on purpose**. Nothing in this
directory is executed by `npm run db:deploy`, and nothing here is mirrored into
`supabase/schema.sql` or cut into `supabase/setup/`. See `docs/DB-MIGRATIONS.md`.

Why a quarantine directory instead of deleting the file:

- The Supabase CLI only scans the **top level** of `supabase/migrations/` for
  `<timestamp>_<name>.sql`; files in subdirectories are not migrations at all.
- A file whose name does not end in `.sql` cannot be picked up by any glob that
  a runner, a CI job or a shell loop would use.
- Keeping the text (as a `.superseded` copy) preserves the audit trail: what was
  once shipped stays readable, and `git log` still shows the original path.

## 20261118 — `20261118_daily_login_no_votes.sql.superseded`

**Do not run it. Not in production, not in staging, not on a fresh install.**

It contains a table-wide historical rewrite:

```sql
update public.daily_login_rewards set reward = 0 where reward <> 0;

alter table public.daily_login_rewards
  add constraint daily_login_rewards_reward_check check (reward = 0);
```

A recorded check-in reward is history — a `2` recorded under the old policy must
stay a `2`. This statement destroys that value irreversibly, and any environment
where it ran keeps the damage: the later migrations do **not** restore it.

Superseded by:

- `20261119_preserve_legacy_daily_login_rewards.sql` — same policy outcome (a
  check-in awards no vote) without touching a single historical row, enforced
  for future writes by a row trigger instead of a table-wide `CHECK`.
- `20261120_daily_login_reward_immutable.sql` — a recorded `reward` can never
  change after `INSERT`.

Both are safe to run after 20261118, in an environment where it already ran.

## Restoring a file to the active path

Do not. `npm run db:check` fails if a destructive statement (or any `.sql` file
not listed in `quarantine.json`) reappears under `supabase/migrations/`, and the
test suite fails on the same rule. If a fix is needed, write a **new** migration
that runs after the ones already applied anywhere.
