# Comments, self mentions & Daily Spin — 2026-09-22

## Deploy

1. Back up the database using the existing backup procedure.
2. Apply `supabase/migrations/20261107_comments_spin_fixes.sql` **after**
   `20261106_security_audit.sql`. Its filename follows the repository's existing
   migration ordering, even though this fix was prepared on September 22.
3. Deploy the frontend. Deploy SQL first: the client now uses the fingerprint-aware
   two-argument `my_daily_spin_status` RPC and no longer silently retries comment
   writes without `parent_id`.

The migration is transactional and rerunnable; `supabase/schema.sql` contains
its exact contents for fresh installs. It does not delete or reparent existing
comments or reset any reward ledger/balance.

## Behavior

- Every comment/reply has Reply (logged-out users are prompted to sign in).
- Arbitrarily deep replies retain the **selected row's ID** as `parent_id`.
  Presentation is flat within the original root thread, avoiding excessive
  indentation. Fetching is paginated instead of truncating the thread at 20 rows.
- Database INSERT policy requires the same request and an active parent. A
  definer trigger additionally validates the entire ancestor chain, including
  historical rows, so hidden, missing, cyclic and cross-request chains cannot be
  extended. A composite FK guards new parent/request pairs; immutable identity
  and ancestry prevent UPDATE-based bypasses.
- The existing advisory lock and **10 comments per author per minute** remain.
  Clients cannot choose `created_at`, overwrite ancestry or moderate through
  direct UPDATE.
- Owners can delete their own comments; admins can delete any author's comment,
  including hidden rows. The policy uses `is_admin()` rather than directly reading
  the now-restricted `profiles.is_admin` column. A zero-row DELETE is reported as
  failure, not silently presented as success.
- **Deleting a parent deletes its entire subtree**, including other authors'
  replies, through the existing cascade semantics. Hiding a parent similarly
  hides every descendant. Unhiding does not automatically resurrect descendants;
  any individually restored child requires an active parent. Admin lists refresh
  after deletion to handle descendants outside the currently loaded page.
- Reply notifications target the **immediate parent author**, never implicitly the
  root author. Reply + automatic mention of that author yields one reply notice.
  Neither self replies nor self mentions notify the sender.
- Display names remain real names, including immediately after submitting;
  `park ssaem` becomes `@park_ssaem`, never `@You`. SQL matches whole normalized
  handles rather than prefixes and retains the five-mention recipient cap.
  Display names are not unique identifiers: if two profiles share a normalized
  handle, both may match an explicit mention (reply recipients are ID-based).

### Daily Spin: agreed scope

The first **successful** spin binds a device token/fingerprint to **one account
for the Vietnam calendar day**. Other accounts cannot use the second spin. The
original account still gets at most two daily spins across devices. Existing
row/advisory locks serialize competing accounts; replay IDs, credit atomicity,
IP anti-abuse ceiling and prize selection remain unchanged. Deleting the first
account does not free the device that day. Status checks also recognize the
fingerprint on a fresh token, without revealing another account's history.

This is **browser identity**, not physical-device identification. As agreed, no
new shared-IP account restriction is imposed. Different browsers can produce
different fingerprints. Fingerprints are client-supplied signals, not hardware
attestation; when unavailable the existing token/account checks remain in place.
Production should keep the existing Edge gate/Turnstile configuration enabled;
this change does not claim to prevent identity spoofing or browser+network changes.

### Historical data

The composite FK is added `NOT VALID` so an old cross-request row does not block
an otherwise safe upgrade. It still constrains new rows. The INSERT trigger
refuses to extend a malformed historical chain; it never rewrites it to a root.
Review any legacy inconsistencies before validating the constraint:

```sql
select c.id, c.request_id, c.parent_id, p.request_id as parent_request_id
from public.request_comments c
left join public.request_comments p on p.id = c.parent_id
where c.parent_id is not null
  and (p.id is null or p.request_id <> c.request_id);

-- After manual review/remediation (not necessary to enable the new safeguards):
alter table public.request_comments validate constraint request_comments_parent_request_fk;
```

## Regression tests

```sh
npm ci
npm test
npm run build
npm run lint

# Use a LOCAL/TEST PostgreSQL superuser with CREATEDB, never a production URL.
# Each suite creates and drops only a uniquely named disposable database.
COMMENTS_TEST_DATABASE_URL=postgres://... npm run test:comments:db
DAILY_SPIN_TEST_DATABASE_URL=postgres://... npm run test:spin:db
```

Without those variables, the two live-database suites explicitly skip. Tests
cover actual PostgreSQL RLS/privileges, R1/R2 parent IDs and request isolation,
notifications/self notifications, owner/admin deletion, soft-hide cascade and
insert races, 10/minute concurrency, legacy chain rejection, browser-account
binding, idempotent retries, deleted accounts and reset. JSDOM tests click real
Reply buttons at multiple depths, submit through the real demo DB helper, reload,
check normalized self handles and exercise owner/admin subtree deletion. Transport
tests ensure rejected inserts never retry without `parent_id` and denied deletes
never report success.

Two pre-existing avatar test assertions were corrected only to allow the full
suite to run: an invalid regex escape, and an outdated expectation that GIF was
still allowed. No avatar behavior was changed. The schema's activity-read policy
also now drops itself before recreation, matching the security migration, so the
existing spin schema-rerun test can exercise the final schema idempotently.
