# Security audit and hardening report — 22 September 2026

**Repository:** `Chaereve/color-coded-lyrics-cf-new`  
**Environment:** source review and local regression/build only. No production or staging credentials were used and no live data was changed.  
**Conclusion:** this is a hardening pass, not a claim that the product is completely secure.

## 1. Scope and method

Reviewed the frontend, Supabase schema and migration sequence, RLS policies, `SECURITY DEFINER` functions, Worker/Pages gate, profile/avatar flow, payment/order flow, comments/replies/mentions, headers, privacy policy, and the achievement catalog. The review specifically looked for:

- caller-controlled `user_id`, role, amount, reward, status, and payment fields;
- IDOR/BOLA through direct PostgREST/table/RPC access;
- duplicate votes, race conditions, replay and double crediting;
- authorization on admin, scheduled and edge paths;
- upload/XSS and public-data disclosure;
- missing or misleading privacy documentation.

The canonical additive migration is `supabase/migrations/20261106_security_audit.sql`; the same final definitions are appended to `supabase/schema.sql` so a fresh schema and an upgraded database converge.

## 2. Findings and risk decisions

### Critical — arbitrary season reward grant (fixed)

`grant_season_reward(text,int,int,text)` was `SECURITY DEFINER`, accepted an arbitrary target and amounts, and was executable by `authenticated`. A normal user could credit their own or another account and alter the reward economy.

**Fix:** the low-level helper now validates the target and amount, refuses non-admin JWT callers, and is executable only by `service_role`. The idempotent season ledger remains the gate for scheduled settlement; the public admin helper validates the current period server-side.

### High — reward persistence was not server-authoritative (fixed)

The previous achievement catalog was presentation-only. Client metrics must not mint balances.

**Fix:** added `achievement_definitions`, a unique `achievement_rewards` ledger, and `claim_achievements()`. The RPC calculates all six metric families from database data, locks the profile row, inserts the unique ledger row, and increments balances only when that insert succeeds. It accepts no client user, amount, status, or reward values. Rewards are limited to vote bonuses, free paid requests, and badge/title identifiers. The existing 42-entry catalog and locked-progress UI remain intact.

### High — cross-request reply / comment abuse (fixed)

Reply insertion is now checked against a qualified parent row whose `request_id` matches the new comment. A trigger repeats that invariant and applies a serialized limit of 10 comments per account per minute. Mention fan-out is capped at five recipients and notification signatures remain unique.

### High — free paid-request redemption and order flooding (fixed)

`create_request()` now locks the profile before checking and decrementing `bonus_requests`, accepts only a boolean redemption intent, and creates a paid/queued request without a client price or client target. The decrement is guarded by `bonus_requests > 0`. Vote-order creation keeps server price validation, serializes the pending-order count, and caps awaiting vote orders at 20 per account. Manual admin approval was already one-shot (`status = 'awaiting'`); replaying approval cannot credit twice.

### Medium — public role flag and activity privacy (fixed)

The `profiles.is_admin` column is no longer granted to public/authenticated profile reads. The client uses the current-user `is_admin()` RPC. Raw `activity_days` are now owner/admin-scoped; public profiles receive only aggregate current/longest streak and earned milestones through `public_streak(uuid)`.

### Medium — avatar upload and stored URL validation (fixed)

The browser previously accepted any `image/*` MIME and the profile RPC accepted arbitrary avatar text. SVG/data HTML and MIME spoofing were unnecessary attack surface.

**Fix:** JPEG, PNG, GIF, and WebP are the only accepted types; file signatures and decoded dimensions are checked; SVG is rejected; Cloudinary responses must be HTTPS Cloudinary URLs; the database accepts only allowlisted Google/Cloudinary HTTPS URLs or base64 raster data URIs and enforces a 200 KB stored URL bound.

### Medium — browser security headers (fixed)

Added a tested CSP to `public/_headers` for the actual app dependencies: Supabase, Cloudinary upload, YouTube frames/thumbnails, Google avatars, Turnstile, VietQR/edge endpoints, `blob:`/`data:` where the app needs them, and no `unsafe-eval`. Worker JSON responses also carry `no-store`, `nosniff`, same-origin resource policy, frame denial and no referrer. The edge endpoint deliberately emits no `Access-Control-Allow-Origin`; it is a same-origin bearer-token route rather than a cookie/CORS API.

### Low — activity/public-content disclosure (documented)

Requests, links, notes, public comments/replies, display names, avatars, approved request summaries and aggregate streaks are intentionally public board data. The Privacy Policy now says so and warns users not to put private information in those fields. Email, raw vote history for other accounts, raw activity dates, spin rewards and hashes are not public.

### Residual — optional edge deployment and payment integration

The Worker/Pages gate is effective only when production routes go through `/api/*`, the required Turnstile/KV secrets are configured, and `EDGE_GATE_TOKEN` is enabled in both the Worker and database. Direct Supabase calls remain a supported fallback while the gate is off; Postgres still enforces account/race limits, but fingerprint/IP shielding is then not equivalent to the edge path.

No payment webhook endpoint exists in this repository: payments are manual and `admin_order()` is the approval boundary. If a provider webhook is added, it must verify a provider signature, bind the event to the stored order, reject amount/currency mismatches, and persist a unique provider event ID before crediting. Do not add a webhook that trusts an order/user/amount from the request body.

## 3. Files changed

- `supabase/migrations/20261106_security_audit.sql` — final security migration: rewards, comments, activity privacy, avatar/profile validation, order cap, atomic redemption.
- `supabase/schema.sql` — synchronized final definitions; no tables/data are dropped or truncated.
- `supabase/migrations/20260920_request_comments.sql` and `20260922_comment_notifications.sql` — earlier migration definitions also corrected so a clean sequence does not temporarily grant the vulnerable reward helper or the tautological reply policy.
- `src/lib/db.js`, `src/App.jsx`, `src/components/ActionModal.jsx` — server reward claim/load and atomic free paid-request redemption UI; role RPC instead of public role-column reads.
- `src/lib/avatar.js`, `src/components/ProfilePanel.jsx` — raster signature/dimension and Cloudinary URL hardening.
- `public/_headers`, `worker/index.js` — CSP and API response security headers.
- `public/privacy.html` — actual public data, activity aggregate/raw scope, comments, rewards, identifiers and retention clarified.
- `supabase/tests/securityAudit.test.js` — source regression tests for the controls below.

## 4. Regression coverage

The local suite covers the existing guest/user/admin, vote/spin, RLS-contract, replay and UI regressions plus new static gates for:

- ordinary-user season reward escalation and arbitrary amount/target payloads;
- server-only achievement minting, profile lock and unique reward ledger;
- cross-request reply IDOR, mention fan-out and comment rate limit;
- atomic free paid-request redemption and server-fixed pricing/order queue cap;
- one-shot admin order approval;
- SVG/MIME spoof/avatar URL rejection;
- public role-column removal and owner-only raw activity days/public aggregate streak;
- CSP source allowlist and absence of `unsafe-eval`.

A connected staging database should additionally run the SQL cases in section 6. Static tests cannot prove a deployed Supabase project has actually run its latest migration.

## 5. Test/build result

- `npm test` — **447 tests, 446 passed, 1 skipped, 0 failed** after the final changes.
- `npm run build` — **passed**.
- `npm run lint` — **0 errors, existing warnings only** (the repository already reports React/lint warnings unrelated to this audit).

## 6. Authorized staging verification checklist

Run as separate identities; never use a service-role key in browser code.

```sql
-- 1. Verify final grants
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('grant_season_reward','claim_achievements','public_streak')
order by routine_name, grantee;

-- grant_season_reward must not list anon/authenticated.

-- 2. RLS/policy shape
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('request_comments','activity_days','achievement_rewards');

-- 3. Invariants and audit ledgers
select conrelid::regclass, conname
from pg_constraint
where conname in ('profiles_bonus_credits_nonneg','profiles_bonus_requests_nonneg',
                  'requests_progress_range');
select indexname from pg_indexes
where schemaname = 'public' and indexname like '%achievement%';
```

Use two test users and two requests in a disposable/staging project:

1. user A inserts a comment on request A; user A attempting `parent_id` from request B must fail;
2. user A calls `grant_season_reward` with their own and user B IDs and negative/large amounts — all ordinary-user calls must fail;
3. call `claim_achievements()` concurrently from two sessions after one metric crosses a threshold — exactly one ledger row and one balance increment;
4. call `create_request(..., p_paid=true, p_use_bonus=true)` concurrently with one bonus request — exactly one request succeeds and the balance never becomes negative;
5. approve the same order concurrently/twice — exactly one approval/credit;
6. replay the same spin/vote request — no second row/credit; verify edge-on and edge-off behavior separately;
7. upload SVG, MIME-spoofed HTML, oversized image and valid JPEG/PNG/WebP/GIF — only the raster cases succeed; render returned profile URLs in an `<img>` context;
8. verify an anonymous client cannot select `profiles.is_admin` or raw `activity_days`, but can call aggregate `public_streak()`.

## 7. Deployment and remaining actions

1. Apply `20261106_security_audit.sql` after the existing migration sequence; it is additive/rerunnable and does not delete user data.
2. Deploy Pages/Worker with `/api/*` routes and configure Turnstile secret, KV binding, Supabase URL/key, and a random `EDGE_GATE_TOKEN` in both environments; then set the same hashed gate token with the service/admin deployment procedure.
3. Confirm the health endpoint and run the authorized staging checklist before enabling the gate for production.
4. Keep payment confirmation manual until a signed, idempotent provider webhook is deliberately designed.
5. Review public request/comment content policy and provide a real legal controller/contact/retention decision before treating the placeholder Privacy Policy as legal advice.

No “fully secure” claim is made: deployment configuration, Supabase effective grants, provider settings, account takeover, third-party Cloudinary/Google/Turnstile behavior, and future code changes remain operational risks.
