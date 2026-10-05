# Daily Login Vote Rewards — thiết kế đề xuất, chờ duyệt Phase 2

## 1. Quy tắc và quyết định cần owner xác nhận

Timezone duy nhất `Asia/Ho_Chi_Minh`; ngày lấy từ Postgres **sau khi lock wallet**. Claim là hành động chủ động, không cấp vote chỉ vì mở trang/login. Mỗi account một claim/day, DB-enforced.

| Claim streak day | Base | Bonus | Tổng |
|---|---:|---:|---:|
| 1–2 | 2 | 0 | 2 |
| 3 | 2 | 1 | 3 |
| 7 | 2 | 2 | 4 |
| 14 | 2 | 3 | 5 |
| 30 | 2 | 5 | 7 |

**Đề xuất cần duyệt**, không tự suy ra policy:
1. Milestones **đúng ngày**, không phải tier: ngày 4–6, 8–13, 15–29, 31+ nhận +2; không chu kỳ 30, không tự lặp +7 ở 60. Sau đứt streak rồi tới mốc lại thì được bonus lại. Nếu muốn tier/cycle, đổi design trước triển khai.
2. Reward streak bắt đầu từ ledger claim **mới**; không trả bù ngày cũ, không dùng activity/visit/spin streak. Lịch điểm danh cũ vẫn đọc được với nhãn “Điểm danh trước chương trình”, tách khỏi ngày nhận vote. Nếu muốn carry-over streak cũ, cần signoff cách tính và test riêng.
3. Chuyển policy tại 00:00 VN ngày T, không giữa ngày; PR1 backend/UI deploy disabled trước, PR2 retire quiz writers + UI rồi mới activate ngày T. Mọi payment quiz trước T giữ nguyên. `claim_daily_login` cũ từ T không được tiếp tục ghi ngày mới; báo client refresh, không gọi ngầm RPC mới trả tiền mà client tưởng +0. Như vậy không có +2 legacy và +2 mới cùng ngày.
4. Không tự bật +3 free votes/day cũ. Daily login cộng `profiles.bonus_credits`, không purchased. Bonus chịu **chính sách reset/expiry bonus chung hiện hữu** trừ khi owner yêu cầu đổi riêng; UI phải nói rõ, không ngụ ý purchased votes. Activity achievement vẫn hoạt động độc lập, không được cộng chung vào “daily login total” gây hiểu nhầm.
5. Cleanup giữ ledger `daily_login_rewards` cũ và migration audit history. “Loại bỏ hoàn toàn” nghĩa là không còn **active quiz feature/runtime/QA pipeline**, không rewrite lịch sử thanh toán. Xoá cả historical archive cần retention approval riêng.

## 2. Schema tối thiểu (3 tables mới; không sửa ledger cũ)

### `public.daily_login_policies`

`id uuid PK`, `effective_from date UNIQUE NOT NULL` (ngày VN), `timezone text CHECK = 'Asia/Ho_Chi_Minh'`, `base_votes int > 0`, `milestone_bonuses jsonb` (initial {"3":1,"7":2,"14":3,"30":5}), `created_at timestamptz`, `created_by uuid` (trusted admin UID).

Versioned append-only rows, trigger validate object shape: keys positive canonical integer, values nonnegative integers, no duplicate/invalid tiers, bounded amounts chống int overflow. Base/config không frontend hard-code; missing/invalid policy => fail closed, không fallback +2. Chỉ policy có hiệu lực mới chọn theo server day. Policy đã active không sửa/xoá; thay bằng version có ngày hiệu lực tương lai, quy trình admin audit. Mỗi claim lưu policy_id + số tiền thực tế. Không update lịch sử khi đổi mốc. Runtime kill switch trước mắt dùng revoke EXECUTE theo runbook, không cần env mới/secret frontend. Nếu cần admin feature control lâu dài, mở design riêng thay vì lạm dụng config JSON.

### `public.daily_login_claims` — vừa login record vừa immutable reward history

- `user_id uuid NOT NULL REFERENCES profiles(id)`; đề xuất `ON DELETE RESTRICT` cho audit, phải thiết kế retention/account deletion với owner trước rollout (không vô tình cản quy trình xoá tài khoản).
- `reward_day date NOT NULL`, **PK(user_id,reward_day)** — chống trùng ngày ở database.
- `idempotency_key uuid NOT NULL`, **UNIQUE(user_id,idempotency_key)** — key của request đầu tiên. Không coi key là secret/authorization.
- `policy_id uuid NOT NULL REFERENCES daily_login_policies(id)`.
- `streak_before int >= 0`, `streak_after int >= 1`, `previous_claim_day date NULL`, `streak_reset boolean`.
- `base_votes int > 0`, `streak_bonus int >= 0`, `total_votes_granted int > 0`, `CHECK(total_votes_granted=base_votes+streak_bonus)`.
- `granted_at timestamptz NOT NULL` (DB clock), `CHECK(reward_day=(granted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`.
- Composite PK hỗ trợ owner/month history; thêm index `(reward_day,user_id)` cho admin pagination nếu query plan cần. Không index thừa cùng leading key.
- No UPDATE/DELETE với client hoặc app RPC. Immutability trigger cho persisted amounts; privileged repair riêng, có before/after audit. Không lưu JWT/IP/email hoặc câu hỏi cũ.

`streak_before` = streak lưu sau claim gần nhất (có thể đã hết hạn); `streak_after` = before+1 nếu previous_day = today−1, ngược lại 1. UI `current_streak` = 0 khi last_day < today−1; distinction này phải ghi rõ trong admin audit.

### `public.daily_login_streaks`

`user_id uuid PK REFERENCES profiles(id)`, `last_claim_day date NOT NULL`, `current_streak int > 0`, `best_streak int >= current_streak`, `total_claims int >= best_streak`, `updated_at timestamptz`. Không tạo state row cho user chưa claim. Derived cache chỉ RPC cập nhật; đối soát/rebuild từ claims, không dùng làm nguồn cấp lại vote.

**Không thêm wallet riêng**, không dùng profile metadata do client sửa. Claim ledger và streak + wallet nằm cùng Postgres transaction. `activity_days` insert cùng transaction để giữ behavior điểm danh; trigger/achievement side effects phải audit bằng integration test. Activity write không tự gọi `claim_achievements` lần nữa.

## 3. API contract / auth / idempotency

RPC mới tách khỏi `dailyRewards.js`, không payload quiz:

- `my_daily_login_status()` authenticated: owner only, server day/time, policy public projection, streak, claim availability và wallet.
- `my_daily_login_month(p_month date)` authenticated: month là **read filter**, normalise first day, range bound, giới hạn ≤31 records + legacy dates; không nhận user ID để đọc người khác. Field `source=login_vote|legacy_checkin` rõ, legacy không invent bonus/streak.
- `claim_daily_login_votes(p_expected_user_id uuid, p_expected_day date, p_idempotency_key uuid)` authenticated. Expected user/day là **untrusted stale-UI guard**, chỉ để reject; recipient luôn `auth.uid()`, inserted date luôn DB clock. Không parameter reward/streak/total. Browser không được backdate/claim tương lai dù gửi date giả.
- `admin_daily_login_history(p_user_id uuid, p_from date, p_to date, p_cursor ...)`: SECURITY DEFINER, check admin bằng trusted DB role/`is_admin()` hiện hữu; không tin `user_metadata`. Bound range/page size, audit access nếu cần. Admin được xem đúng các fields đã yêu cầu; thường user chỉ xem history của mình. Phase2 có thể dùng restricted DBA SQL trước admin UI, cần owner chọn.

Ví dụ response (illustrative, không phải backend đã chạy):

```json
{
  "user_id":"<auth.uid>",
  "day":"2026-10-05",
  "server_now":"2026-10-05T12:00:00Z",
  "next_claim_at":"2026-10-05T17:00:00Z",
  "timezone":"Asia/Ho_Chi_Minh",
  "claimed_today":false,
  "current_streak":2,
  "claim_streak":3,
  "streak_expires_at":"2026-10-05T17:00:00Z",
  "base_votes":2,
  "streak_bonus":1,
  "claim_total":3,
  "milestones":[{"day":3,"total":3},{"day":7,"total":4},{"day":14,"total":5},{"day":30,"total":7}],
  "credits":20,"purchased":10,"bonus":10
}
```

Khi đã claim: trả immutable `claim` (reward_day, before/after, base, bonus, total, granted_at, idempotency_key, policy_id), `replayed`, status **mới**. Nếu retry hôm sau trả receipt cũ + status hôm nay, không gán receipt cũ vào lịch hôm nay. `streak_expires_at`: last_day+2 tại 00:00 VN; hôm nay chưa claim với last_day hôm qua => midnight tới; đã claim hôm nay => midnight sau ngày mai. Empty streak thì null, không countdown mất streak giả.

### Transaction pseudocode (một RPC = một transaction)

```
uid := auth.uid(); reject null
reject expected_user_id != uid; reject null/invalid UUID key
SELECT profiles WHERE id=uid FOR UPDATE; if missing => PROFILE_NOT_READY (no writes)
now := clock_timestamp(); day := (now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
lookup receipt by (uid,key): if exists return original receipt + fresh own status
reject expected_day != day; no authorisation from client day
lookup receipt by (uid,day): if exists return stored receipt, replayed=true, no increment
reject day before approved activation / no effective policy
read effective policy row FOR SHARE; immutable version prevents mixed settings
read streak row (lock order profile -> policy -> streak; all writers same order)
next_streak := last_day=day-1 ? current+1 : 1
bonus := exact-day policy milestone bonus or 0
INSERT claim with server day + uid + amounts + before/after + key
UPDATE profiles SET bonus_credits = bonus_credits + total WHERE id=uid
UPSERT streak from computed values
INSERT activity_days(uid,day) ON CONFLICT DO NOTHING
return stored receipt + sanitized fresh status
any failure => full rollback (including wallet/streak/activity/claim)
```

Replay không đọc config để tính lại award. Unique PK/unique key là hàng rào cuối, **không** “check frontend rồi grant”. Nếu gặp unique violation bất ngờ: transaction fail rồi re-read owner-scoped receipt; không catch exception rồi tiếp tục increment. Profile row serializes cùng vote/spin/achievement paths; audit mọi balance writer để không đảo lock order. Không thực hiện network I/O trong transaction. Status balance sau concurrent vote có thể stale: frontend discard old account/request versions và re-fetch authoritative wallet sau mutations; `server_now` chỉ hỗ trợ ordering, không chứng minh một global wallet revision. Nếu test phát hiện stale vote-vs-spin issue, thêm revision shared cho mọi writer trong migration riêng, không âm thầm coi timestamp là đủ.

Timeout/reload: lưu idempotency key pending theo `(user_id, expected_server_day)` trong session/local storage, retry cùng key tới khi receipt xác nhận; không claim lại tự động khi mount. Trước retry qua midnight vẫn gửi guard ngày gốc. Nếu trước timeout transaction chưa commit và day đã đổi, RPC trả DAY_CHANGED, UI reload status và yêu cầu click mới, không âm thầm claim ngày mới. Key mới cho ngày đã claim vẫn trả receipt cũ, không grant lần hai. Account đổi thì huỷ pending UI, không gửi key account cũ cho account mới.

Missing profile: fail closed có retry/sign-in hướng dẫn, không tạo profile/role bằng metadata người dùng trong reward RPC. Test profile-bootstrap flow hiện hữu riêng.

### Least privilege

Tables RLS ON, không anon/authenticated SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Helpers revoke EXECUTE FROM PUBLIC/anon/authenticated. Entrypoints revoke default PUBLIC rồi chỉ grant authenticated trong cùng migration transaction. SECURITY DEFINER owner non-login role tối thiểu nếu Supabase cho phép; `SET search_path=''`, schema-qualified mọi table/function, không dynamic SQL/user identifier, không `SET ROLE` theo input. Admin RPC tự kiểm quyền, authenticated không có nghĩa là admin. Kiểm tra service-role ACL và default privileges sau create; service key không có trong client. Không tạo public view để tránh lách RLS.

## 4. Calendar wireframe và UI replacement

Mở [calendar-preview.html](calendar-preview.html) — mock độc lập, dữ liệu mẫu cố định, **không Supabase/API/storage/wallet**, không route mới của app. Before là wireframe tái dựng từ source, không screenshot production. After là design proposal, không claim đã tích hợp.

- Một section surface, header + inline statistics, một lịch 7 cột; không gradient/glow/card lồng card.
- Reuse `--font`, `--txt`, `--txt-2`, `--a`, `--a-2`, `--line`, `--surface`, `--r-md`, `--r-lg`; spacing 4/8/12/16/24 và `.btn`/Icon hiện hữu. Repo hiện dark-first; không tạo theme system riêng cho app. Mock dùng palette thật.
- 320/375/768/1280/1440px; desktop summary bên phải calendar, mobile xuống dưới; milestones wrap, không tooltip bắt buộc để hiểu reward. ≥44px target month/claim; date inspect ≥24px trên 320px, keyboard accessible.
- Claim rõ “+2 daily votes” + “Bonus streak +1” = “Nhận +3 votes”; sau claim báo tổng thực tế từ receipt, không +2 cố định trên ngày milestone.
- Ngày claim có check + text accessible, today border + aria-current=date, missed day chỉ đánh dấu từ khi enrolled; legacy riêng. Future milestone dự báo có chữ “dự kiến nếu claim liên tiếp”, không thể click lấy trước.
- `role=grid` chỉ nếu làm đầy đủ roving tabindex: arrows ±1/±7, Home/End đầu/cuối tuần, PageUp/PageDown đổi tháng, Enter/Space xem chi tiết (không vô tình claim). Claim CTA riêng. Hoặc semantic table không grid + month buttons focusable nếu không cần inspect; **đề xuất grid full keyboard cho UI mới**.
- Loading skeleton có aria-busy + status; empty/new user “Bắt đầu streak”; lỗi history có retry riêng không khoá claim hôm nay; lỗi claim giữ pending key; logout có CTA đăng nhập; pending disabled + focus giữ; midnight refresh từ server; hidden tab resume sync.
- Countdown dựa server_now + monotonic elapsed, không `new Date()` device day; hết hạn re-fetch trước bật claim. VN không có DST hiện đại; browser timezone có DST không thay ngày chuẩn. Month/date labels dùng locale lựa chọn, không hardcode English như helper hiện tại.

### Tất cả UI/text cũ đã tìm và replacement

| Vị trí | Hiện tại | Replacement |
|---|---|---|
| App SECTIONS/ROUTES + Sidebar/nav i18n | `/quiz`, Music quiz; subtitle bonus votes | PR2 bỏ nav quiz; giữ `/daily-login`, label Daily Login Votes |
| App `/daily-login` auth gate | sign-in trước calendar | Signed-out calendar preview read-only + sign-in CTA, không fetch owner RPC |
| `DailyRewards.jsx` heading/mission/form/footer | quiz title, 5 question progress, score, answers, reset, review | PR2 remove quiz UI; `/quiz` redirect/retirement notice tới login |
| `i18n.jsx` `daily.quizUnavailableTitle/Body`, `err.dailyQuizUnavailable` | “Today’s quiz is not available yet” | Không tái dùng cho login; login lỗi service “Chưa tải được phần thưởng. Thử lại” |
| `daily.quizEarned`, `daily.votesToday`, quiz progress/steps/track | quiz earned/max5 | Claim receipt base/bonus/total; không cap5 ảnh hưởng day30 +7 |
| `daily.loginDesc`, `daily.loginNoVotes`, `daily.loginHeading` | check-in never awards votes | +2 daily votes + server milestones; history cũ label legacy |
| `calendar.milestone`, CHECK_IN_MILESTONES | mốc 5/10/20 ngày trong tháng | Streak days 3/7/14/30 từ policy RPC, không month-count reward |
| `daily.*` generic Daily Rewards names + db validators | Login phụ thuộc quiz payload | New dedicated `dailyLogin.*` contract; không quiz import/network trong Calendar |
| Question Bank/admin QA | Không thấy web route; docs/CSV/tool/workflow | Retire tooling PR2, docs hướng dẫn admin login audit mới |
| Achievements/Profile/StreakStrip | activity streak/bonus metadata shared, không quiz source | Giữ, ghi rõ khác login streak; không retrofit claims cũ |
| sitemap.xml + _headers | /quiz SEO/cache path | PR2 sitemap bỏ quiz; redirect `_redirects` mới + client fallback, review Pages precedence |
| Footer/header | Nav do App cung cấp; không thấy quiz link độc lập khác | Regression crawl desktop/mobile/account menus; reject stale copy |

Redirect `/quiz` cần cả server Pages redirect và client history.replaceState khi SPA đã mở, query/hash xử lý không loop, preserve deep-link reload/back. Không thêm route Question Bank chỉ để xoá một trang vốn không tồn tại.

## 5. Migrations dự kiến — tên logic, chưa tạo file

Repo có IDs tới `20261120` dù ngày audit 2026-10-05. **Không dùng ngày hiện tại tạo version thấp hơn**; chọn version monotonic lớn hơn head thực tế khi triển khai. Những tên dưới không là lệnh chạy.

| Migration logic | PR | Nội dung | Reversible |
|---|---|---|---|
| daily_login_vote_schema | 1 | 3 tables, constraints, indexes, RLS/grants, policy validation/immutability | Trước data: disable; không auto drop. Sau data: giữ audit |
| daily_login_vote_rpcs | 1 | Status/month/claim/admin RPCs, least privilege, activation future/disabled | Revoke claim, frontend maintenance, giữ records |
| daily_login_cutover_retire_quiz | 2 | Cutoff writers legacy, vote helper không quiz, retired RPC stubs | Restore definitions có policy guard; không re-award |
| quiz_cleanup_reviewed | 3 | Exact explicit signature/table DROP RESTRICT sau dependency check | Data restore từ verified backup; không pretend reversible bằng empty CREATE |

Không tự đặt destructive migration trong default deploy folder trước PR3 approval. Down/restore scripts phải có target guard, checksums, tested order và explicit approval; không chạy trong CI production. Quarantine cũ `20261118` vẫn giữ, không copy destructive statements đó sang fresh schema.

## 6. Files dự kiến thay đổi sau duyệt

**PR1 mới**: `src/components/DailyLoginRewards.jsx`, `DailyLoginRewards.css`, `src/lib/dailyLoginRewards.js`, `dailyLoginRewardsDemo.js`, tests tương ứng, `supabase/tests/dailyLoginVotes.test.js`, migrations additive, baseline mới. **Sửa**: App.jsx (login only), DailyLoginCalendar.jsx, checkInCalendar.js/tests, db.js (login wrapper riêng), i18n.jsx, DailySpin.jsx/shared wallet tests nếu cần, schema.sql/setup + splitter (đồng bộ new definitions), CI thêm DB suite. Nếu admin UI được duyệt: AdminPanel/Admin tabs + bounded history view riêng.

**PR2 sửa/gỡ**: App.jsx quiz nav/route; Sidebar.jsx; DailyRewards.jsx/css/test chỉ còn legacy quiz rồi remove; dailyRewards.js/demo/test (giữ helper shared đã relocate); db.js quiz exports/activity demo; i18n quiz keys; Icon quiz-only; dailyRoutes/profileNav tests; public/sitemap.xml/_headers, **mới** `_redirects`; package.json quiz commands; bank files toàn bộ ở inventory; live pilot workflow; docs active, smoke và runtime quiz tests. **Giữ** migration fixtures/tests chứng minh upgrade cũ và immutability.

**PR3**: cleanup SQL riêng sau signoff, rollback artifacts ngoài Git nếu chứa data, migration safety explicit allowlist đã review (không tắt guard rộng), schema.sql/fresh setup plan + scripts/split-schema.mjs, new baseline, regression tests source không quiz runtime. Không xoá các migrations lịch sử/baselines cũ để “làm test xanh”. Danh sách cụ thể cuối cùng phải là diff được review, không auto áp toàn inventory.

## 7. PR / deploy gates

- **PR preview hiện tại**: docs + mock only, draft, không implementation. Merge tài liệu cũng không đồng nghĩa cho phép Phase2.
- **PR1**: implement backend + new UI sau explicit Phase2 approval; staging DB riêng; deploy production còn cần owner duyệt. Backend tồn tại trước UI; UI feature inactive/status maintenance trước activation. Giữ quiz để rollback trong grace period.
- **PR2**: owner duyệt remove UI/routes/tooling và retire server writers; tách voting dependencies; ngày T mới activate login. Giữ các quiz tables cho audit/rollback. Không có khoảng cả hai cơ chế trả thưởng cùng ngày.
- **PR3**: riêng sau owner xác nhận login ổn định + verified backup + retention + all tests/telemetry gates. Không merge/deploy tự động. Đề xuất observation ≥7 ngày, >=2 midnight rollover; day14/day30 kiểm staging clock, không cần chờ 30 ngày nhưng owner quyết định.
- Session này cố định branch `arena/01a10bae-color-coded-lyrics-cf-new`. PR preview rồi các PR sau tuần tự cùng branch (mỗi lần diff còn lại sau merge được duyệt); không tạo/switch branch khác. Không bật auto-merge. Không push main.

## 8. Thao tác thủ công của owner/DBA (chưa cần làm trong Phase1)

1. Xác nhận policy 5 điểm ở §1, audit retention/account deletion và có cần admin history UI.
2. Read-only xác minh Supabase deployed schema, manual cron/functions/importer, DB version/ACL; xác minh Cloudflare Production branch=`main` và Preview branch policy. GitHub deployments API hiện trả rỗng, không chứng minh Cloudflare chưa deploy.
3. Tạo staging Supabase riêng, không preview write vào production. Không paste secret trong PR/chat. Không secret mới bắt buộc cho login RPC; frontend vẫn anon key + user JWT, admin dùng trusted auth, service role chỉ server/DBA.
4. Approve backup/export + restore drill; tự quản encrypted archive và retention, không commit dump.
5. Sau từng signoff áp migration đúng kế hoạch đang được review; không `schema.sql` full lên database đang có dữ liệu; `NOTIFY pgrst` reload schema sau commit.
6. Cloudflare deploy đúng Pages path khi owner cho phép; không đổi wrangler/D1/KV/Turnstile/spin gate cho tính năng login. Chỉ invalidate affected stale assets theo kế hoạch rollback, không purge account data.
7. Không cần cron reset streak/reward: RPC/date lazy evaluation đủ; backup cron vẫn giữ. Nếu live có quiz scheduler ngoài repo, export config rồi owner tắt theo PR2, không trước.
8. Production verification checklist ở backup runbook; signoff riêng trước destructive cleanup.
