# Audit baseline và test plan — 2026-10-05

## Kết quả đã thực sự chạy (source trước implementation)

| Check | Kết quả | Giới hạn |
|---|---|---|
| `npm ci --ignore-scripts` | Thành công, audit 0 vulnerabilities tại thời điểm chạy | Không là chứng nhận security toàn hệ thống |
| `npm run build` | PASS, Vite 8 build thành công | Không typecheck hoặc browser E2E |
| `npm run lint` | Exit 0; **29 warnings, 0 errors** | Không gọi là lint-clean |
| `npm test` (environment test DB không cấp) | **718 tests: 705 pass, 13 skipped, 0 fail**, 8 suites | Các integration PostgreSQL chưa chạy local; không có production transaction test |
| `npm run smoke` | **420/420 pass** | jsdom/demo; không real network/auth/RLS/responsive layout |
| `npm run db:check` | PASS: 36 active migrations, 1 quarantined | Chỉ static guard, không apply/plan tới DB |
| `npm run schema:split:check` | PASS: 16 setup chunks khớp schema.sql | Không thay schema/split files |
| Typecheck | **N/A — không có script typecheck/tsconfig**, project JS/JSX | Build/lint không thay static typecheck; thêm contract validation tests trong PR1 |
| Production routes/console/network/RLS | **Chưa kiểm chứng** | Không credentials DB, không authenticated test account; không dùng public config để tự claim thật |
| Real app viewport, screen reader, DST browser E2E | **Chưa chạy ở Phase1 baseline** | Mock preview không thay thế real app E2E |

Node v22.22.3, npm 10.9.8. Tests chạy với environment sạch để không vô tình dùng TEST_DATABASE_URL có sẵn trỏ môi trường khác. GitHub hiện có workflow test PostgreSQL18 throwaway; kết quả của PR này phải xem riêng ở Checks sau push, không dùng run main cũ làm bằng chứng cho diff mới.

## Findings cần sửa trong Phase2 (Phase1 KHÔNG sửa runtime)

| ID / mức | Evidence | Lỗi/rủi ro | Fix dự kiến / gate |
|---|---|---|---|
| F01 / blocker | `src/lib/dailyRewards.js`: DAILY_LOGIN_REWARD=0, validateQuizState; `DailyRewards.jsx`: applyStatus | Login +2 mới bị validator từ chối; Calendar vẫn gọi quiz payload | Dedicated login RPC/client/validator/component; test network không quiz |
| F02 / blocker | `20261117_daily_quiz_flow.sql`: cast_vote/my_vote_status → daily_free_vote_grant → quiz config/answers | Drop quiz làm hỏng vote ngay | Tách shared helper trước cleanup; full vote/refund/anti-fraud test |
| F03 / blocker | `20261120_daily_login_reward_immutable.sql` | Ledger cũ cấm insert reward≠0; không thể đơn giản đổi constant +2 | New paid ledger; không disable trigger hoặc rewrite history |
| F04 / high | `DailyLoginCalendar.jsx`: cache[month] có available=false vẫn chặn fetch | Load history fail không có retry độc lập; quay lại tháng đó vẫn lỗi đến remount | State loading/error riêng + Retry + abort/version keyed user/month |
| F05 / medium | `checkInCalendar.js`: Intl.DateTimeFormat('en') | Tháng/aria label English dù locale khác | Locale-aware formatter, không đổi authoritative date |
| F06 / medium | CHECK_IN_MILESTONES=[5,10,20], monthly checkedCount | Visual month milestones không phải streak milestone thưởng | Server policy projection, không suy luận bằng month count |
| F07 / medium | CSS check-in-nav 28px, nhiều border cards, gradient progress, celebration shadow | Target nhỏ, UI chưa đáp ứng redesign | Shared tokens, >=44px nav, reduced-motion, viewport/contrast QA |
| F08 / medium | buildCheckInCalendar: past days thiếu claim → missed | Account mới có thể bị coi bỏ lỡ ngày trước khi tham gia | not-enrolled/legacy/unknown states; không invent lịch sử |
| F09 / high, cần test | App applySpinBalance dùng server_now; vote/spin/claim chạy độc lập | Timestamp snapshot không là wallet revision toàn hệ thống | Race E2E, re-fetch/sequence guard; revision migration chỉ nếu cần |
| F10 / high | Backup dump và fingerprint session khác; fingerprint counts/names | Không chứng minh snapshot-consistent recovery/ACL/body | Runbook snapshot + data hashes + restore drill trước PR3 |
| F11 / high | stale /quiz tabs + quiz RPC vẫn callable nếu chỉ remove frontend | Tiếp tục cấp quiz votes sau cutover | Server writer cutoff/tombstone, grace period trước drop |
| F12 / medium | `daily-quiz-unavailable h4` CSS nhưng JSX dùng h3 | Selector stale, style heading có thể sai | Remove cùng quiz PR2; không standalone CSS patch Phase1 |
| F13 / high, product | Activity streak/achievement cùng mốc số ngày với login | Nhầm hai streak; accidental double reward/copy | Giữ semantics riêng, UI label rõ, integration audit indirect grants |

### Lint warning backlog (nguyên trạng, đủ 29 warnings)

- `worker/d1-shield.js:29`: unused ipHash, maxFpPerIp (2).
- `src/lib/confirm.jsx:75`, `notify.jsx:49`, `i18n.jsx:1173,1187`: only-export-components (4).
- `src/lib/board.test.js:470`: unused next (1).
- `src/lib/turnstile.js:43`: no-useless-escape (2).
- `src/components/ProfilePanel.jsx:5`: unused checkFile (1).
- Set-state-in-effect (12): VoteModal:38, ProfilePanel:43, MediaShowcase:39, Comments:66, AvatarCropper:47, AdminPanel:489; App:947,958,1062,1078,1126,1220.
- Purity (4): StreakStrip:28, Countdown:47, Leaderboard:133, App:1476.
- App:1017 immutability; App:1207 preserve-manual-memoization; App:1851 missing openModal dependency (3).

Warnings không tự chứng minh runtime exception. Ưu tiên reward/calendar/wallet regressions; unrelated fixes chia commit review riêng trong Phase2, không rewrite toàn App hoặc disable lint để xoá warning.

## Acceptance tests Phase2 (bắt buộc trước PR cuối)

### PostgreSQL transactions, grants, security

1. Fresh install + upgrade từ baseline 20261111/17/18/20 (quarantine vẫn không chạy); exact schema/chunks + schema-readiness; seed policies inactive. PostgreSQL version match target (CI18 không thay staging PG17 nếu production17).
2. New account với profile: first claim +2; purchased không đổi, bonus +2, một claims row, streak1, activity row. Missing profile: typed error, zero writes; sign-out/anon rejected ở grants và auth check; user B không đọc user A month/receipt/admin.
3. Exact days 1,2,3,4,6,7,8,13,14,15,29,30,31,60 theo policy chốt; config changed effective next day, malformed config reject; replay luôn giữ amount/policy snapshot cũ.
4. Same key 2 lần; khác key cùng ngày; 20+ requests đồng thời hai connections/account; retry sau timeout sau commit và trước commit; refresh hai tabs. Assert một ngày/one grant, một history, không balance increment trong replay.
5. Inject failure tại claim insert, wallet update, streak upsert, activity insert: toàn transaction rollback; retry sau rollback đúng một lần. Unique violation không để wallet tăng độc lập.
6. Concurrent claim với cast/refund vote, spin, claim_achievements, admin credits/bonus reset/order approval: giữ lock order, không lost update/deadlock/double award, purchased/bonus split đúng. Verify reward history riêng không ghi cả achievement vào login total.
7. Tamper expected UID/day/reward/streak/key, null args, SQL injection strings; no arbitrary user identity/date grant. Client cannot select/insert/update/delete/truncate tables, execute helpers, bypass admin gate; immutable ledger/policy không sửa qua REST. Check function owners/search_path/EXECUTE ACL thật.
8. Next-day streak after missed1/missed7, month/year/leap-day boundaries; history lâu năm indexed; duplicate/legacy history preserved; account deletion retention policy có test trước approval.
9. Cutover: old check-in/quiz trước T hợp lệ, từ T retired; cached JS không bypass; account đã claim +2 legacy không có duplicate grant ngày T. Remove quiz helpers trên staging **không** làm login status/month hoặc voting fail.

### Timezone / clock

- Server VN 23:59:59.999 → 00:00:00; UTC rollover ở 17:00; hai requests chờ profile lock qua midnight tính ngày **sau lock**. Replay receipt cũ không grant ngày mới.
- Máy client UTC, Asia/Ho_Chi_Minh, America/New_York, Pacific/Auckland; fake device clock ±48h; browser DST spring-forward/fall-back. HCM không có DST hiện đại, không dùng browser midnight.
- Countdown monotonic không grant; khi tab sleep/visibility resume/network reconnect phải fetch server status; stale expected day báo refresh, không tự claim lại. Midnight changes month grid/next deadline chính xác.
- Test clock trong harness/local DB injection **không** expose `p_now` hoặc admin time travel RPC production.

### Frontend/unit/components

- Validator rejects missing policy, wrong account, negative/noninteger amount, inconsistent base+bonus/credits, malformed dates, duplicate future claims; optional legacy source đúng nhãn; zero quiz state dependency.
- Rendering đủ signed-out/loading/new/ready/claiming/claimed/error/history-error/maintenance/missing-profile; retry giữ key, không click spam; cancellation account switch/unmount; today claim CTA duy nhất.
- Mock month load race, failed history retry, locale names, leap year, pre-enrollment days; computed calendar không tự authorise reward.
- A11y keyboard arrows/Home/End/PageUp/PageDown, roving tabindex, focus sau error/claim, aria-current/date, status announcement không mỗi giây countdown; semantic grid đầy đủ hoặc table strategy được review. Screen-reader test manual; automated axe smoke không đủ.

### Real browser integration/E2E và toàn site

- Chromium + Firefox/WebKit nếu toolchain cho phép, staging project riêng, accounts test được duyệt. Capture console.error/unhandled rejection, requestfailed/HTTP4xx5xx (phân biệt expected auth rejection), PostgREST permissions, render loops. Repo dùng createRoot client render; không có SSR hydration path mặc định, kiểm render/mount thay vì tuyên bố đã test SSR hydration.
- Routes `/`, `/daily-login`, `/quiz` redirect, `/daily-spin`, `/ranking`, `/profile`, `/admin`, archive và navigation/footer/header/account mobile menus; direct GET, SPA navigation, reload, back/forward, canonical/sitemap, expired session, logout cross-tab.
- Viewports 320,375,768,1024,1280,1440; portrait/landscape, 200% zoom, long labels, OS font scaling, reduced-motion, dark theme. Assert no document overflow, clipped reward, button/icon misalignment, tooltip collision; screenshot approved.
- Balance updates header/sidebar/modal immediately after confirmed receipt; reject stale snapshots; real claim-vote race/backpressure/timeout handling; no optimistic grant before commit.
- Search built JS + active source for Daily Quiz, unavailable text, question bank, imports/env flags/quiz RPC URL. Historical migration docs/fixtures là explicit allowlist, không xóa history để vượt scan. Browser Calendar **zero calls** tới my_daily_rewards_status/start_daily_quiz/submit_daily_quiz_answer hoặc quiz table.
- Regression achievements/reward metadata, spin/account quota/Turnstile vote gate, comments/requests/admin orders/loading/empty; security headers unchanged trừ reviewed redirect rules.

## Go / no-go

Không gọi “đã audit/fix toàn site” chỉ vì static tests xanh. PR1/2 cuối phải có staging logs/screenshot/check results, DB suites thực sự chạy (không skipped), zero new lint warnings và resolution/waiver có owner cho existing warnings. PR3 còn cần production observation + backup restore drill + exact live object manifest + approval riêng. Phase1 chỉ ghi findings và kế hoạch, không fix runtime trái yêu cầu.

## Mock preview verification

Đã thử cài Playwright Chromium cho kiểm tra mock; download browser bị `ECONNRESET` từ cdn.playwright.dev. Vì vậy **không có real-browser screenshot/viewport pass** được tuyên bố. Bản giao là HTML wireframe responsive để owner mở xem; logic mock được kiểm bằng jsdom riêng, không test app production. Không thêm Playwright dependency hoặc browser artifact vào repo.

Mock jsdom đã PASS: 6 trạng thái, 31 ngày, đúng một roving tabstop, ArrowRight di chuyển focus, claim mô phỏng, before/after toggle, không JavaScript error. Static server chỉ phục vụ thư mục docs tại port 4174; đây không phải app/production deploy.
