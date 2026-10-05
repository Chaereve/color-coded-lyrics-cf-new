# Phase 2 implementation plan — chờ review, KHÔNG triển khai

Ngày lập: 2026-10-05. Source/PR head đã kiểm tra: `99709f05511a8278b2a1645c4048fe101a65a273`.

**Trạng thái hiện tại: chỉ cập nhật tài liệu local theo đặc tả Daily Ritual owner đã chốt. Không chạy database test/migration, không đổi runtime, không commit/push, tạo implementation PR, merge hoặc deploy.** Không cập nhật PR #28 để tránh kích hoạt Cloudflare preview tự động khi push. Tài liệu này thay thế các **đề xuất policy chưa chốt** ở Phase 1; không sửa lại evidence audit lịch sử.

Các mục A–C giữ nguyên evidence của lượt audit trước; lần bổ sung đặc tả này không rerun test/lint hoặc xác minh lại trạng thái GitHub. Các mục D–H đã được cập nhật cho đủ Daily Login, Daily Card Flip, Fortune Cookie và Plant Growth; đây là scope đã chốt, không phải feature mở rộng cần xin thêm scope.

## A. Xác nhận PR #28

Đã đọc lại GitHub PR API: [PR #28](https://github.com/Chaereve/color-coded-lyrics-cf-new/pull/28) **OPEN, draft**, đúng **7 files added**, **959 additions, 0 deletions**, một commit `99709f0`:

1. `docs/daily-login-phase1/README.md`
2. `docs/daily-login-phase1/01-inventory.md`
3. `docs/daily-login-phase1/02-database.md`
4. `docs/daily-login-phase1/03-backup-rollback.md`
5. `docs/daily-login-phase1/04-design-rollout.md`
6. `docs/daily-login-phase1/05-audit-test-plan.md`
7. `docs/daily-login-phase1/calendar-preview.html`

**Không có source runtime, migration, RPC, route, config hoặc workflow trong diff.** Tài liệu Phase2 local này chưa nằm trong PR #28. Cloudflare branch preview đã tự chạy ở lượt push Phase1 trước, không phải lệnh deploy mới trong lượt này.

## B. Chính xác 13 DB tests bị skip ở lần chạy local Phase1

Đối chiếu từng dòng `# SKIP` trong TAP log `/tmp/phase1-tests.log` với test declaration và `process.env` trong source. Mỗi entry dưới là **top-level test**, một số chứa nhiều nested subtests; vì parent skip nên không có bằng chứng các subtest đó pass. Lý do chung: `skip: !url`, environment local cố ý không cấp URL DB.

| # | Tên test nguyên văn | File:line | Biến cần cấp |
|---|---|---|---|
| 1 | mode A — a database equivalent to post-20261117 is verified, and only then baselined | `supabase/tests/baselineReadiness.test.js:46` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 2 | mode A — every missing or incompatible object fails closed, writing no history | `supabase/tests/baselineReadiness.test.js:78` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 3 | mode B — a database that never applied 20261112-20261117 bootstraps instead of baselining | `supabase/tests/baselineReadiness.test.js:129` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 4 | mode C — a fresh install reaches the final state and never runs 20261118 | `supabase/tests/baselineReadiness.test.js:159` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 5 | mode D — a database where 20261118 ran is detected and still moves forward | `supabase/tests/baselineReadiness.test.js:177` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 6 | mode E — an unknown or partial database is refused with a diagnostic | `supabase/tests/baselineReadiness.test.js:206` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 7 | a baseline with no committed snapshot is refused | `supabase/tests/baselineReadiness.test.js:222` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 8 | comments, mentions, deletion and browser account quota — real PostgreSQL | `supabase/tests/commentsReplies.test.js:19` | `COMMENTS_TEST_DATABASE_URL` |
| 9 | Daily Quiz — real transactions, caps, idempotency, concurrency and pool rules | `supabase/tests/dailyQuiz.test.js:132` | `DAILY_QUIZ_TEST_DATABASE_URL` |
| 10 | Daily rewards — real transactions, permissions, replay and concurrency | `supabase/tests/dailyRewards.test.js:184` | `DAILY_REWARDS_TEST_DATABASE_URL` |
| 11 | Daily Spin — real PostgreSQL transactions and permissions | `supabase/tests/dailySpin.test.js:26` | `DAILY_SPIN_TEST_DATABASE_URL` |
| 12 | the recommended deployment path never runs the destructive migration | `supabase/tests/migrationDeploy.test.js:135` | `MIGRATION_DEPLOY_TEST_DATABASE_URL` |
| 13 | SQL Editor chunks install on separate connections into a disposable fresh DB | `supabase/tests/schemaChunks.test.js:44` | `SCHEMA_CHUNKS_TEST_DATABASE_URL` |

Kết quả local đã báo vẫn là **718 tests / 705 pass / 13 skipped / 0 fail**. Đây **không phải 13 lỗi**, cũng không phải 13 test đã được chứng minh pass.

### Cập nhật CI read-only

Check `guard` của PR hiện báo **PASS, 57s**, run [37300464088 / job 111731691586](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/37300464088/job/111731691586). Workflow cấu hình PostgreSQL18 service throwaway, cấp đủ 6 biến URL cho 13 entry trên rồi chạy `npm test`. Lượt này chỉ đọc check đã có, **không dispatch/rerun workflow**.

Download log qua cả run/job endpoint bị EOF, nên chưa xác nhận được tổng số tests/skips trong CI. Không lấy màu xanh làm bằng chứng “13/13 chắc chắn đã chạy”: cần TAP/log xác nhận từng tên trên không còn SKIP và nested subtests thực sự chạy.

### Kế hoạch chạy an toàn — chỉ sau owner duyệt kế hoạch/test execution

1. Tạo **PostgreSQL cluster throwaway riêng**, không chỉ database riêng trong cluster production. Dùng container/service tạm, volume tạm, không production secrets/pgpass/service file, không Supabase URL thật, không dữ liệu người dùng thật. PostgreSQL18 cho baseline fixtures hiện có; sau đó target major thật đã được xác minh (không tự sửa baseline18 để chạy17).
2. Network isolation: chỉ test runner ↔ DB test; không egress DB tới production, không proxy/tunnel qua localhost. Không dựa một mình vào hostname `127.0.0.1` để kết luận an toàn.
3. Preflight allowlist **cluster/container ID + test marker + database name + endpoint/port**; abort nếu thiếu marker, gặp cloud DB host/production project ID hoặc URL không thuộc fixture vừa tạo. Không dùng `SUPABASE_DB_URL` làm fallback cho test env.
4. Cấp 6 biến ở bảng trên bằng **cùng DSN của cluster disposable**. `TEST_DATABASE_URL` trong workflow không thay thế các biến suite-specific; chỉ đặt biến generic thì 13 test vẫn có thể skip.
5. Harness cần quyền CREATEDB/CREATEROLE hoặc local superuser **chỉ trong cluster disposable**: fixtures tạo auth stub, roles anon/authenticated/service_role BYPASSRLS, publication; tạo và drop DB có prefix `ccl_fix_`, `ccl_deploy_`, `ccl_setup_test_`, `ccl_daily_quiz_test_`, `ccl_daily_rewards_test_`, `ccl_spin_test_`, `ccl_comments_test_`. Roles là **cluster-wide**, lý do tuyệt đối không dùng shared/prod cluster.
6. Lượt baseline đầu chạy 7 files tuần tự bằng `node --test --test-concurrency=1 <7 files>` (baselineReadiness, commentsReplies, dailyQuiz, dailyRewards, dailySpin, migrationDeploy, schemaChunks). Tuần tự file không vô hiệu các bài concurrency dùng nhiều DB connections bên trong. Các harness riêng hiện chỉ catch duplicate_object khi CREATE ROLE; không bỏ qua lỗi race 23505. Sau baseline tuần tự, chạy full suite và kiểm tra parallel harness riêng trước khi dùng full parallel làm gate.
7. Thu TAP/JUnit, exit code, PostgreSQL version, commit SHA; **fail nếu bất kỳ 13 parent tests còn skip, có child skip ngoài allowlist được review hoặc fail**. Tổng test có thể tăng khi nested tests thật chạy; không yêu cầu phải đúng718. Giữ assertions quarantine và các historical fixtures.
8. Có fixture **cố ý mô phỏng incident 20261118** trong DB throwaway để test recovery mode D; đó là test lịch sử, không cho phép chạy archived migration lên database thật. Bước này cũng là lý do chưa thực thi tests DB trong lượt chờ review.
9. Đóng pool/connections, chỉ drop database đúng prefix + UUID đã tạo và được tracked bởi test run; sau đó teardown đúng cluster disposable. Không lệnh drop theo wildcard, không chạm backup hoặc shared DB. Nếu cleanup thất bại, báo lỗi thay vì che lỗi để suite xanh.
10. Sau khi baseline và implementation được duyệt: chạy integration mới trên cluster disposable, rồi staging Supabase **riêng** với synthetic accounts để test PostgREST JWT/RLS thực tế. PostgreSQL auth stub không thay cho staging auth/RPC permissions. Không chạy test write vào production.

**Điều kiện để tiếp tục:** owner cho phép chạy test harness có CREATE/DROP/migration trong cluster disposable. Phê duyệt đó không cho phép production migration hoặc cleanup.

## C. Phân loại đủ 29 lint warnings (baseline hiện hữu)

| Nhóm/rule | Số | Vị trí chính xác tại base audit | Rủi ro / cách xử lý |
|---|---:|---|---|
| `react(set-state-in-effect)` | 12 | `VoteModal.jsx:38`, `ProfilePanel.jsx:43`, `MediaShowcase.jsx:39`, `Comments.jsx:66`, `AvatarCropper.jsx:47`, `AdminPanel.jsx:489`; `App.jsx:947,958,1062,1078,1126,1220` | Cascading render/state reset; review effect lifecycle, derived state/event-driven update; không bỏ effect tuỳ tiện |
| `react(purity)` | 4 | `StreakStrip.jsx:28`, `Countdown.jsx:47`, `Leaderboard.jsx:133`, `App.jsx:1476` | Clock/impure render có thể gây inconsistency; clock state/tick có kiểm soát, không authoritative client date |
| `react(immutability)` | 1 | `App.jsx:1017` | Access variable trong initialization; ưu tiên review declaration/closure trước UI integration |
| `react(preserve-manual-memoization)` | 1 | `App.jsx:1207` | Compiler không giữ được memoization; kiểm correctness/dependencies trước tối ưu |
| `react-hooks(exhaustive-deps)` | 1 | `App.jsx:1851`, thiếu `openModal` | Stale closure; stable callback/dependency đúng, regression keyboard/menu |
| `react(only-export-components)` | 4 | `src/lib/confirm.jsx:75`, `notify.jsx:49`, `i18n.jsx:1173,1187` | Fast Refresh/module boundary; không tự chứng minh production bug; tách exports khi phù hợp |
| `eslint(no-unused-vars)` | 4 | `worker/d1-shield.js:29`: ipHash, maxFpPerIp (2); `src/lib/board.test.js:470`: next; `ProfilePanel.jsx:5`: checkFile | Dead parameters/imports hoặc behavior thiếu; đặc biệt không xoá anti-fraud input mà chưa hiểu contract |
| `eslint(no-useless-escape)` | 2 | `src/lib/turnstile.js:43:59,43:67` | Cleanup syntax ít rủi ro; vẫn test Turnstile selector |
| **Tổng** | **29** | **0 lint errors** | 19 React correctness/compiler/deps + 4 refresh + 6 hygiene |

### Gate “không tạo warning mới”

- Lưu baseline diagnostics theo **rule + file + message/symbol/context**; line number chỉ dùng để tra cứu, không là identity vì thêm code sẽ dịch dòng.
- CI so diff diagnostics: **zero added warning**, **zero error**. Không chỉ so tổng ≤29 (xoá1 nhưng thêm1 vẫn fail). File mới login/ritual/UI phải sạch warning.
- Không disable rule, thêm blanket ignore, đổi lint config, bỏ file khỏi scan hay rename biến nhằm che behavior bug.
- Fix những warning liên quan App/calendar/wallet trong commit nhỏ có tests; unrelated warning giữ baseline/backlog riêng. Khi fix thì baseline chỉ giảm qua review, không tự “re-baseline” để chấp nhận warning mới.
- Ngoài lint: build, JSX/component tests và real browser checks. Repo JS/JSX không có typecheck script; không gọi build là typecheck.

## D. Các quyết định owner đã chốt — thay thế đề xuất Phase1

### D1. Daily Login — feature riêng, điều kiện mở Daily Ritual

Daily Login là feature riêng. Chỉ **claim thành công trong ngày ICT hiện tại**, được server xác nhận bằng persisted claim, mới unlock Daily Card Flip và Fortune Cookie; login auth hoặc mở trang không đủ. Cùng transaction claim đó tự động water cây một lần. Record check-in legacy/seed history không tự unlock ritual hôm nay.

| Login streak day | Base bonus credits | Streak bonus thêm | TOTAL bonus credits |
|---|---:|---:|---:|
| Ngày thường (kể cả 1–2, 4–6, 8–13, 15–29) | 2 | 0 | 2 |
| 3 | 2 | 1 | 3 |
| 7 | 2 | 2 | 4 |
| 14 | 2 | 3 | 5 |
| 30 | 2 | 5 | 7 |
| 31 trở đi | 2 | 0 | 2 |

Mức day3/7/14/30 là **TOTAL payout**, không phải cộng nguyên 3/4/5/7 lên base+2. Milestone chỉ đúng ngày mốc, không tier+7 sau30, không cycle30/modulo30. Policy versioned server-side lưu base2 và exact-day bonuses `{3:1,7:2,14:3,30:5}`; frontend chỉ render policy/receipt. Sau miss rồi xây lại streak, tính theo streak thực tế. Daily boundary duy nhất `Asia/Ho_Chi_Minh`.

### D2. Carry-over lịch sử có kiểm chứng, KHÔNG backpay

- Source duy nhất cho seed: `daily_login_rewards` của đúng user, ngày **trước cutover**, không `activity_days`, không quiz/spin activity hay browser history.
- Khi first new claim đúng ngày T: kiểm tra chuỗi hợp lệ đi lùi từ **T−1**, dừng ở gap hoặc row mơ hồ đầu tiên. Ví dụ T−1/T−2 hợp lệ → seed2 → claim T là streak3, nhận +3 **duy nhất cho ngày T**. Không tạo claim/grant rows cho T−1/T−2, không cộng lại reward2 cũ.
- Cần xác minh PK `(user_id,reward_day)`, date/user lineage, timestamp/ngày VN và constraints/source history. Nếu duplicate do drift, row không đáng tin, date tương lai, mất anchor hoặc không thể đọc/xác minh: không dedupe để suy diễn một streak cao hơn. Lấy **lower bound đã chứng minh**, hoặc seed0 nếu không chứng minh được anchor. Không đi vòng qua gap/ambiguous row để nối run trước đó.
- PK của repo vốn không cho duplicate; vẫn kiểm live constraint/drift. Một ngày mất dữ liệu được coi là không chứng minh đã claim, không tự backfill bằng activity.
- First new claim ngày T+1 nhưng chưa claim T → có gap, streak1; không nối seed T−1 qua ngày T bị bỏ lỡ. Nếu first new claim T+N, cùng quy tắc đó. New user/missing history → seed0, claim đầu streak1; missing profile → fail closed, không tự tạo privileged profile.
- Lưu **seed audit không phải reward ledger** trong streak state/provenance: rollout version, seed_last_day, seed_length, checked_at, verified/partial/rejected, reason, evidence digest nếu cần. Seed chỉ dùng một lần, dưới profile lock, trong transaction first claim; replay không seed lại khi admin sửa history sau đó.
- Best streak không đoán từ lịch thiếu; trả giá trị xác minh/lower-bound có nhãn. Không sửa bất kỳ reward amount, legacy row hoặc balance lịch sử nào.

### D3. Canonical bonus wallet và ledger

Daily Login, Daily Card và Plant milestone đều credit canonical `profiles.bonus_credits` / existing bonus-credit ledger trong **cùng transaction của action tương ứng**. Reuse existing ledger nếu live inventory xác minh có; không dựng ví/ledger song song cạnh nguồn canonical hiện hữu. Purchased credits, free-vote quota/usage và spend ordering **free quota → bonus credits → purchased** giữ nguyên, trừ khi owner duyệt thay đổi riêng. Fortune Cookie không tạo monetary grant, không tăng bất kỳ balance/quota nào.

**Kết quả inventory source, không phải thiếu scope/spec:** chưa tìm thấy implementation Card/Cookie/Plant hoặc generic bonus-credit ledger trong repo đã audit. Có wallet canonical và ledgers theo nguồn (`daily_login_rewards`, `achievement_rewards`, quiz/spin...). Scope và rules đã chốt ở D7–D9; chỉ còn xác minh live ledger để reuse đúng, không tự tuyên bố source hiện tại có complete canonical ledger hoặc xây ví phụ.

Đề xuất một grant primitive **internal-only** dùng chung các ritual producers: validate source event đã được server xác nhận → INSERT immutable grant uniquely keyed theo source event → `bonus_credits += amount`; không expose RPC cho client gửi user/reward tuỳ ý. Daily Login claim, seed/streak, source record, grant history và wallet cùng transaction. Balance không được rebuild từ ledger mới vì nó chưa bao trùm mọi historical spin/admin/order/reset/debit.

Daily Ritual implementation bao gồm **Daily Card Flip + Fortune Cookie + Plant Growth**, mở bởi Daily Login riêng, theo rules D7–D9. Không còn blocker “thiếu đặc tả Card/Plant”. Gate backend/UI/DB phải bao đủ bốn phần; không gọi Login-only pass là toàn Ritual pass. Đặc tả được chốt không đồng nghĩa cho phép apply SQL/deploy trước review implementation PR.

### D4. Achievement overlap: badge/title-only sau cutover

Source hiện tại: `claim_achievements()` tính activity streak, ghi `achievement_rewards` và tăng bonus theo `achievement_definitions.bonus_votes`. Streak đó vẫn là activity streak, không tự đổi thành login streak.

- Giữ mọi historical achievement row/badge/title/cosmetic/bonus vote đã grant; không set reward lịch sử=0, không clawback, không grant lại.
- Từ T, các definitions `source='streak' AND threshold IN (3,7,14,30)` unlock badge/title/cosmetic như cũ nhưng **effective bonus_votes=0** cho grant mới. Không chỉ sửa4 IDs mà bỏ sót custom definition cùng source/threshold; inventory live trước implementation.
- Dùng server day **sau profile lock** + rollout policy, không dựa client day hoặc chỉ ẩn UI. Nếu threshold đã đạt trước T nhưng chưa được grant, request grant mới sau T vẫn badge/title-only, không tạo backpay loophole.
- Ghi history grant mới `bonus_votes=0`; response replay đọc amount đã lưu của row cũ thay vì render số mới từ definition. Bonus requests/achievements khác, including streak60+, không đổi nếu không có quyết định riêng.
- Display rewards trong AchievementIndex/i18n từ effective policy + persisted receipt: badge/title-only ở mốc overlapping, vẫn hiện đúng +votes từng nhận trong lịch sử. Không còn nhãn hứa +1/+3/+5/+10 sau T.
- Test simultaneous login + achievement và request treo qua midnight. Cả hai lock profile cùng thứ tự; không cộng chồng vote. Badge grant zero được phân biệt với money ledger, không giả thành paid grant.

### D5. Cutover configurable, không chốt ngày bây giờ

Rollout config riêng, protected, trạng thái `disabled → ready → scheduled → active` (active đánh giá theo server day; không cần cron), có `cutover_date NULL` mặc định, timezone cố định, schema version, backend/UI build SHA evidence, confirmed_at/confirmed_by và append-only audit event.

1. Migration + deploy Phase 2 hoàn tất, **test pass và owner duyệt/xác nhận rollout** mới được chuyển scheduled. Scheduling bằng trusted admin procedure, server kiểm schema/build evidence, operator không được giả mạo deploy status qua browser.
2. T do server tính: **ngày ICT kế tiếp sau ngày xác nhận readiness** (confirmation chỉ sau migration/deploy hoàn tất). Không dùng literal ngày tương lai trong SQL hiện tại. Nếu xác nhận sau midnight, T lùi sang ngày ICT kế tiếp của thời điểm xác nhận thực tế.
3. Before T: new ritual grant disabled. Deploy/scheduling giữa ngày không cấp new reward trong phần còn lại ngày đó.
4. Dùng cùng rollout authority và profile lock để kiểm cả old và new writers. Từ T, old policy không được grant nữa; stale tabs nhận retired/refresh response, không tự gọi paid RPC mới thay cho check-in+0 cũ.
5. Rollout phải chốt `scheduled` đúng lúc trước T; bất kỳ missing readiness/mixed deployment/ambiguous current-day trạng thái → new grant fail closed, **không tự bắt đầu ngay giữa ngày**. Reconfirm và schedule ICT ngày kế tiếp; không tự sửa T đã có grant. Epoch có grants thì immutable, giữ receipt/audit khi pause và resume.
6. Trong first new claim, kiểm persisted old-policy payout ngày đó (legacy login reward>0, quiz awarded, và old ritual sources thực tế sau inventory). Nếu đã có hoặc không xác minh được classification → không new ritual payment ngày đó; hiển thị ngày kế tiếp, giữ history. RLS/RPC lỗi đọc nguồn thì deny, không coi như “không payout”.
7. Planned T quiescence: old/new writer chọn effective day sau lock; request started trước midnight nhưng lấy lock sau midnight phải theo policy mới. Một request chứa timestamp sau lock nhưng commit sau midnight vẫn thuộc calendar day đã được server quyết định; new transaction bị serialised và không dùng client day.
8. Cross-source conflict chống **old regime + new regime** trong cùng user/calendar day; không đặt unique(user,day) chung cho tất cả sources làm vô tình cấm user nhận Login và Card/Plant hợp lệ cùng ngày. Login vẫn PK(user_id,reward_day); Card/Cookie dùng unique(user_id,ritual_day), Plant water unique(user_id,watered_day), Plant milestone unique(user_id,milestone_id) lifetime theo D7–D9. Read-only replay của receipt cũ không cấp reward mới và không cần claim login cho ngày khác.
9. Nếu guard/readiness pause sau T, achievement overlapping vote suppression vẫn theo cutover đã active, không tự bật lại payouts cũ để “fallback”. Không auto rollback kinh tế, không đổi free quota.

### D6. Cleanup gates giữ nguyên, chặt hơn

Không redirect `/quiz` hoặc xoá Quiz/Question Bank trước final go-live được duyệt và đủ cả4 điều kiện owner đặt:

- `cast_vote()` / `my_vote_status()` không còn **transitive** quiz dependency.
- Calendar không gọi quiz payload/controller/validator.
- Daily Login + Card Flip + Fortune Cookie + Plant Growth: backend + UI + database tests pass đầy đủ theo đặc tả đã chốt.
- Backup/restore drill đã được owner review.

Code tách dependency/disabled replacement có thể chuẩn bị trong PR, nhưng **không chạy SQL, activate retirement hoặc cleanup** chỉ vì code đã viết. PR2 removal/redirect và PR3 destructive cleanup vẫn approvals riêng. Migration lịch sử và financial audit không tự xoá.

### D7. Daily Card Flip — bonus nhỏ, không phải nguồn vote chính

**Eligibility và idempotency**

- Chỉ unlock sau successful Daily Login claim của **cùng user, cùng ngày server `Asia/Ho_Chi_Minh`**, cùng rollout hợp lệ. Server đọc claim đã commit; không tin flag `login_claimed` từ browser.
- Mỗi user reveal đúng một card/ngày. UNIQUE(user_id,ritual_day) và unique request key owner-scoped ở DB; retry/reload/hai tab/hai thiết bị kể cả đổi request key phải trả persisted outcome cũ, không random lại và không cộng bonus credits lại.
- Client chỉ gửi request identity/stale-account/day guard, không gửi tier, votes, result, probability hoặc `random_version` để chọn kết quả. Giữ nguyên receipt nếu replay qua midnight; không dùng key cũ tự reveal card ngày mới.

| Tier | Probability cố định | Bonus credits |
|---|---:|---:|
| calm | 60% | +1 |
| bright | 30% | +2 |
| bloom | 10% | +3 |

**Random/result contract**

- Không +0, không jackpot lớn, không reroll, không near miss. Không thay xác suất theo user behavior, streak, spend, timezone máy hoặc số lần retry.
- Server/database chọn bằng secure RNG; không client-side `Math.random`, không dùng JS animation để quyết định tier. Đề xuất CSPRNG với unbiased sampling/rejection sampling cho draw0–99: 0–59 calm, 60–89 bright, 90–99 bloom. Không modulo-biased mapping. Không expose RNG seed/entropy hoặc test override ở RPC production.
- Server-side versioned distribution validate tổng weights100 và tier/reward hợp lệ; launch version đúng60/30/10 và+1/+2/+3. Probability/tier update tương lai phải được review, tạo version mới; không client-configurable/adaptive tuning.
- Persist immutable `tier`, `votes_awarded`, `random_version`, reward-policy/rollout version, ritual_day, reveal timestamp, idempotency key và canonical grant reference. Snapshot amount/outcome không phụ thuộc config hiện tại khi replay.
- Card result + grant ledger + wallet increment cùng transaction; lỗi thì không trả outcome chưa commit. Sau success không reroll kể cả config đã thay hoặc timeout sau commit.

**UI:** một card reveal nhẹ, keyboard/focus và reduced-motion; không wheel, slot, casino/gambling-style UI, spinning reel, fake near miss hoặc CTA reroll. Không fork/reuse gambling-like presentation từ Daily Spin. Thể hiện rõ đây là bonus nhỏ và đã reveal hôm nay.

### D8. Fortune Cookie — daily moment, KHÔNG phải daily vote reward

- Unlock sau persisted Daily Login claim đúng ngày ICT; mỗi user mở một cookie/ngày. DB UNIQUE(user_id,ritual_day), idempotent request/response; retry/reload trả **exact fortune đã mở**, không chọn mới.
- Server chọn và lưu `fortune_id`; client không gửi/override fortune ID, nội dung hoặc kết quả. Có thể deterministic hoặc secure random server-side; lựa chọn kỹ thuật không thay quy tắc một cookie/ngày.
- Tránh fortune_id vừa xuất hiện gần đây khi catalog đủ lớn; cấu hình recent-window server-side, không hard-code preference theo behavior để dụ quay lại. Nếu catalog nhỏ, fallback chọn từ catalog approved còn hợp lệ, chấp nhận lặp khi không còn lựa chọn thay vì treo/vòng lặp vô hạn. Catalog rỗng/lỗi: trả unavailable/retry rõ, không fabricate fortune hoặc cấp tiền thay thế.
- Lưu immutable catalog revision/content snapshot đã phục vụ (kèm locale nếu có), category, fortune_id, opened_at, ritual_day, request key. Chỉ lưu ID trỏ tới text mutable là chưa đủ: catalog edit/retire sau đó không được đổi câu user đã mở. Giữ referenced version/snapshot để retry trả exact text cũ.
- Content ngắn, thân thiện; **không medical/legal/financial advice, không toxic, không bói toán gây hại, không quote bản quyền dài**. Dùng catalog curated/versioned, review nội dung trước activate; không realtime model generation hoặc external quote API trong open transaction.
- Categories chỉ: **calm, cozy, hopeful, playful, music, growth, rest, curiosity**. Constraints/validator reject category ngoài danh sách.
- Không cấp vote hằng ngày, không update bonus/purchased/free quota, không zero-money entry giả làm payout. Opening record là content history, không financial grant. Failure sau chọn nhưng trước commit rollback opening, không hiển thị như đã thành công.
- UI một daily moment đọc được bằng keyboard/screen reader, không hứa vận may tài chính/sức khoẻ, không gắn fortune với odds Card hoặc bonus amount.

### D9. Plant Growth — progress dài hạn, KHÔNG phải farm game

**Core và nguồn progress**

- Đúng **một cây/user** (PK user_id). Daily Login claim thành công tự động water một lần trong **chính transaction claim**. Water receipt UNIQUE(user_id,watered_day) và reference tới login claim; replay claim không water lại.
- Không nút water riêng, không client water/claim-milestone RPC, không inventory, marketplace, nhiều cây, grid/farm simulation. Không cron, không polling. Lấy state qua status reads theo event/mount/mutation; countdown local không network polling.
- Progress = **total watered days**, không consecutive streak. Bỏ ngày không reset/cây chết, không trừ progress, không gửi request để mô phỏng thời gian trôi. Login streak vẫn reset/nối theo calendar độc lập.
- Không suy seed streak lịch sử thành watered days. Theo thiết kế conservative không backfill: cây bắt đầu0 khi chưa có verified watering record; chỉ successful claims của chương trình mới tạo water record. Không dùng legacy check-in để retroactively grant Plant milestones. Nếu live có watering history ngoài inventory, xác minh/mapping riêng trước SQL, không tự reset progress thật đã tồn tại.

| Total watered days | Stage |
|---|---|
| 0–2 | seed |
| 3–6 | sprout |
| 7–13 | small_plant |
| 14–29 | growing_plant |
| 30–59 | flowering_plant |
| 60–99 | mature_plant |
| 100+ | legacy_plant |

| Milestone watered day | Effect | Bonus credits |
|---|---|---:|
| 3 | Visual unlock only | 0 |
| 7 | Milestone reward | +2 |
| 14 | Milestone reward | +3 |
| 30 | Milestone reward | +5 |
| 60 | Milestone reward | +8 |
| 100 | Badge/cosmetic/achievement; không thêm monetary payout vào plan này | 0 |

Không thêm large vote reward ở day100; không tự sáng tạo reward ngoài bảng. Các thresholds này là **total watered days**, không calendar date hoặc login streak day.

**Atomicity, one-time grant và overlap**

- Mỗi milestone unlock/reward **đúng một lần/user lifetime**: UNIQUE(user_id,milestone_id), stable semantic milestone key, không thêm policy_version/rollout_epoch vào uniqueness để re-grant khi đổi config/deploy.
- Claim mới insert water event, increment total, resolve stage, record milestone mới và grant+wallet (nếu milestone có tiền) **atomic cùng login claim**. Lỗi ở bất kỳ step thì rollback cả login receipt, login payout, water/progress, milestone và wallet; không để user đã claim nhưng mất Plant milestone. Không có separate client-side claim flow để sửa chữa.
- Read/replay/status không catch-up payout hay water thêm. Stage có thể derived từ total; total được đối soát từ unique water records, không tin client count hoặc stage. Total100+ giữ legacy_plant và tiếp tục accumulate, không reset/cycle.
- Paid Plant milestone có source event riêng trong canonical bonus ledger; day3/day100 chỉ record unlock/badge/cosmetic, không monetary grant giả. Nếu claim cùng lúc đạt login và plant milestone, cả **hai khoản hợp lệ khác nguồn** được ghi riêng: ví dụ login streak7 +4 và watered-day7 +2 => tổng wallet delta+6, không phải duplicate. Card nếu reveal sau đó là transaction/reward riêng; Fortune không tăng balance.
- Audit/map với existing achievement/reward semantic identities trước SQL. Nếu cùng **Plant milestone** đã có grant/unlock qua đường khác, reuse canonical event/receipt, không trả tiền lần nữa qua achievement API. Day100 cosmetic không được kích hoạt secondary achievement vote ngoài ý muốn. Giữ mọi historical badges/title/rewards; không global-disable các achievement khác chỉ vì trùng số7/14/30/60/100.
- Overlap achievement **login streak** vẫn theo D4; không dùng việc suppress streak votes để suppress nhầm Plant rewards owner đã chốt. Kiểm cả returned metadata/UI để không hứa thêm một payout trùng.

## E. Implementation theo dependency bắt buộc

`vote decoupling → calendar payload decoupling → schema/RPC/RLS → test DB/concurrency → UI integration`

Đây là thứ tự thiết kế/commit và review gate. Những commit schema/RPC có thể được viết trong repo sau duyệt implementation, nhưng **DB chỉ được áp dụng khi owner cho phép test/deploy đúng environment**. Không áp từng intermediate commit lên production.

### E1. Vote decoupling — giữ nguyên semantics

**Files:** `supabase/migrations/<next>_vote_policy_decoupling.sql` (chỉ sau review), mirrors schema/setup, `src/lib/db.js` contract nếu cần; tests voteHardening/dailyQuiz/dailySpin và tests quota mới. Không sửa Worker gate/fingerprint limits chỉ để bỏ quiz.

- Read-only inventory live policy trước: free_vote_grant_enabled, free_votes_per_day, global_daily_vote_cap_enabled, global_daily_vote_cap, actual `cast_vote`/`my_vote_status` signatures/grants. Không dùng default repo để quyết định live quota.
- Đưa quota sang **neutral vote policy** với đúng giá trị/semantics đã xác minh; helper mới không read daily_quiz_* tables/functions/config. Giữ API signatures/return shape/gate/refund behavior để không gây old client lỗi.
- Thứ tự source hiện tại theo repo: **free quota → bonus credits → purchased credits**; giữ nguyên. Refund đúng `votes.credit_kind`, không hoàn free thành bonus, không charge daily login amount vào free_used/free_limit.
- Có một trường hợp **blocker cần xử lý rõ**: live `global_daily_vote_cap_enabled=true` thì quota cũ tính theo quiz award count. Không được vừa bỏ dependency vừa âm thầm tăng/giảm quota. Cần compatibility design riêng: neutral per-day legacy award counter + server-only writer duy trì đúng semantics, snapshot/catch-up kiểm chứng trước switch; hoặc owner quyết định policy mới rõ ràng. Không thay bằng login award count và không hardcode0. Nếu chưa xác minh/mapping chưa được review thì **dừng E1 activation**.
- Stage code mới inactive; giữ quiz tables/writers cho regression, không bật tính năng reward mới. Thử equivalence trước/sau với mọi flag đã có, purchased/bonus balances, vote±/refund, fingerprint/Edge gate và race. Dependency scan cả function body late-bound SQL, không chỉ `pg_depend`.

**Gate E1:** output/side effects vote tương đương baseline hợp lệ; không quota change hoặc ordering change; mọi active voter dependency sau switch không quiz. Không drop helper cũ lúc này.

### E2. Calendar payload decoupling — chốt contract trước backend mới

**Files:** dedicated login client/validator module + tests, new controller boundary; plan thay `DailyRewards.jsx`, `DailyLoginCalendar.jsx`, `checkInCalendar.js`, `db.js` và App login mount. Chưa wire paid UI hoặc production route trong giai đoạn này.

- Contract riêng `my_daily_login_status()`, `my_daily_login_month(date)`, claim response. No quiz state, pool, question, progress, cap5 hoặc unavailable-quiz error.
- Fields: server day/now/timezone, rollout availability/reason/next eligible time, current/claim streak + seed verification, policy projection, base/bonus/total, claimed dates (legacy/new), receipt, balances. Không suy từ month total thành streak. Ritual status riêng/section rõ trả login-gated Card/Cookie availability, stored outcomes khi đã mở, plant total/stage/milestones; Calendar không phụ thuộc catalog Cookie hoặc RNG Card để claim login. Read status không reveal/open/water/grant.
- Legacy month history read-only, nhãn rõ old check-in ≠ new paid claim. Unknown history không phải missed. Auth guard/cancel stale requests account switch; history-error Retry không khoá claim hiện tại nếu status đáng tin.
- Define strict validators / contract fixtures trước implementation; retain current mounted page trong code đang chạy cho đến UI integration gate. Calendar status phải load được ngay cả quiz pool thiếu/broken.

**Gate E2:** source/import graph mới không quiz; tests assert không gọi `my_daily_rewards_status`, start/submit quiz; browser enforcement ở E5. Đây là payload decoupling, không phải đã thay UI trên production.

### E3. Schema/RPC/RLS và rollout bridge

Tên object sau là **proposal, chưa tạo SQL**; reuse object live nếu inventory chứng minh đã có, không duplicate wallet/ledger:

| Object dự kiến | Mục đích / invariant |
|---|---|
| neutral vote policy (+ neutral legacy usage nếu thực sự cần) | Chuyển cấu hình quota khỏi quiz, giữ semantics, không nhận client overrides |
| `daily_ritual_rollout` + append-only rollout audit | cutover_date nullable, server-scheduled, readiness evidence, owner confirmation, epoch/kill switch; default disabled |
| versioned login policy | base/exact-day bonuses/timezone; validated amounts, effective date, immutable used versions |
| `daily_login_claims` | PK(user_id,reward_day), UNIQUE(user_id,idempotency_key), granted_at, policy/rollout_id, streak before/after, base/bonus/total, link canonical grant |
| `daily_login_streaks` | Last day/current/best + verified carry-over provenance; derived state, not independent entitlement |
| canonical existing bonus-credit ledger; `bonus_credit_grants` chỉ nếu xác minh chưa có shared ledger | User/source/event key UNIQUE, actual amount, source day, policy/rollout/receipt linkage, immutable timestamp; grant+wallet atomic, no retro rows; không duplicate nguồn canonical |
| versioned Card distribution | Fixed launch60/30/10, rewards1/2/3, immutable random_version/policy; không user-behavior adjustment |
| `daily_card_reveals` | PK(user_id,ritual_day), unique user/request key, same-day login FK/eligibility, immutable tier/amount/random_version và grant link |
| curated Fortune catalog revisions | Immutable fortune_id/version/content/category; categories allowlist, active revision selection, referenced content không bị sửa mất history |
| `daily_fortune_openings` | PK(user_id,ritual_day), same-day login eligibility, chosen fortune_id/revision + served content snapshot, request key; không monetary grant |
| `user_plants` | PK(user_id), total_watered_days>=0, stage derived từ total hoặc constrained cache; một cây, không chết/reset |
| `plant_waterings` | PK(user_id,watered_day), exactly one event per successful new login claim, FK nguồn; immutable, no public writer |
| `plant_milestone_unlocks` | UNIQUE(user_id,milestone_id) lifetime, stable threshold/event key, visual/badge metadata hoặc paid grant link; policy update không re-award |

Không lấy “3 tables mới” ở Phase1 làm giới hạn cứng: scope Daily Ritual đã được cụ thể hoá thành Card/Cookie/Plant, rollout, carry-over và shared ritual ledger. Bảng trên liệt kê logical objects dự kiến, không bắt buộc mỗi policy/revision là một table riêng nếu có thể reuse safely. Khi thiết kế SQL thật phải review minimal object list, constraints, FKs/account-deletion retention và signatures trước apply.

**RPC transaction login:**

1. `auth.uid()` + expected-account guard; profile row `FOR UPDATE`; missing profile deny.
2. Đọc DB clock sau lock; resolve rollout và authoritative ICT day. Existing receipt theo key trả nguyên grant, không recalculation, kể cả paused/next day; return fresh status riêng. New claim mới kiểm gate/cutover/day.
3. Expected day do client gửi chỉ guard reject stale, không authorize date. Không client amount/streak. Stored key trùng user/day không grant lần2; khác key cùng ngày vẫn trả receipt cũ.
4. Check old/new regime conflict của đúng user/day; policy/rollout missing/ambiguous deny. Seed lower-bound từ history nếu đúng điều kiện D2; last_new_claim=yesterday mới nối streak, gap reset1.
5. Compute exact-day login bonus; insert claim + uniquely-linked canonical login grant; update streak; **auto-water một lần, tăng total, đổi stage, insert one-time Plant milestone unlock và paid Plant grant nếu vừa đạt mốc**; update `profiles.bonus_credits` đúng tổng các grants mới; insert activity day nếu giữ behavior cũ — tất cả **một transaction**. Constraint/FK bảo vệ user/day/source/amount và milestone lifetime uniqueness; no seed retro-grant, no manual water. Failure bất kỳ rollback cả login, plant, ledgers và wallet. Một profile UPDATE tổng các grants hoặc increments riêng trong cùng transaction đều phải khớp canonical grant records.
6. Achievement RPC dùng cùng profile lock/rollout cutoff; effective bonus0 cho mốc overlapping; response/historical receipt không ghi đè. Không gọi achievement lần nữa trong grant primitive để tránh recursion/double-award.
7. Trả persisted receipt breakdown `login_base`, `login_streak_bonus`, `login_total`, `plant_milestone_awards`, `total_bonus_credits_granted`, cùng plant progress và Card/Cookie eligibility sau commit. Không render combined wallet delta thành login total gây nhầm total+7 thành base+7. Card reveal là action riêng, không tự reveal/open Cookie khi login. Frontend never optimistic wallet increment; account/version guard, re-fetch sau concurrent vote/spin; timestamp không được coi là global wallet revision nếu chưa test.

**RPC contract mở rộng (proposal, chưa tạo code):**

- `my_daily_ritual_status()`: owner-only read, server day/rollout, card/cookie eligibility + stored outcome, plant progress/stage/unlocks. Không state mutation, RNG hoặc reward side effect; frontend fetch theo event, không polling.
- `reveal_daily_card(expected_user_id, expected_day, idempotency_key)`: authenticated identity/profile lock → replay persisted owner receipt nếu có → server day/rollout/conflict guard → same-day successful login → existing daily reveal lookup (khác request key vẫn replay) → secure draw theo version → insert immutable result + canonical grant + bonus wallet increment → response **chỉ sau commit**. Unique constraints + transaction là enforcement, không busy flag frontend.
- `open_daily_fortune(expected_user_id, expected_day, idempotency_key)`: cùng auth/profile/rollout/day/login/replay gates → choose curated server fortune tránh recent nếu đủ catalog → persist exact content revision/snapshot → return committed opening. Không wallet update, không grant money.
- `claim_daily_login_votes(...)` mở rộng transaction water/milestone ở trên; **không có** public `water_plant`, `claim_plant_milestone` hoặc arbitrary `grant_bonus` RPC. Client không gửi tier/result/fortune_id/random_version/water count/milestone/reward amount.
- Admin audit projections: login before/after/base/bonus; Card tier/amount/random_version; Cookie chosen ID/category/revision; Plant water source/counter/milestone/grant reference; shared grant linkage + server timestamp/request key. Owner-scoped month/status không lộ user khác hoặc internal random entropy.

Card/Cookie parent-login FK gồm cả user/day, không chỉ UUID để tránh cross-account/day reference. Mọi writer lock profile trước, rồi rollout/policy/source/plant theo order thống nhất, kể cả claim_achievements và grant helper; không network I/O trong transaction. Concurrent reveal khi login chưa commit phải đợi lock rồi kiểm receipt, hoặc fail rõ nếu login rollback, không unlock dựa trên optimistic client state.

**Security:** RLS trên tables; browser không SELECT nhạy cảm/INSERT/UPDATE/DELETE trực tiếp. Public EXECUTE mặc định revoke; chỉ authenticated cho owner RPC, admin history RPC kiểm trusted DB admin. Internal grant helpers không client EXECUTE và không nhận amount có thể caller tự chọn. SECURITY DEFINER minimal owner, explicit schema-qualified names, safe search_path; no dynamic SQL/user-selected identity. Config/cutover only trusted admin, audited; service secrets không frontend.

**Idempotency qua timeout/midnight:** browser giữ pending key+server day theo account, không tạo key mới tự động sau timeout. Receipt cũ có thì return, chưa commit và guard ngày cũ đã hết thì DAY_CHANGED không claim ngày mới. Unique constraints vẫn chặn double-click/new key/two devices. JWT account switch reject trước replay.

**Migration files dự kiến:** neutral vote policy; additive rollout/policies/canonical-ledger integration/login-streak schema; Card distribution + immutable reveals; curated Fortune catalog + openings; Plant state/waterings/milestone unlocks; owner/admin RPCs/RLS; achievement effective payout/semantic-overlap guard + old-writer cutoff guards; mirrors/new baseline và backward-compat tests. Những logical groups này có thể gộp migration theo dependency review, không sửa applied SQL. IDs monotonic sau head repo, không hardcode ngày rollout hoặc sửa applied migration/quarantine. No destructive cleanup trong PR1.

**Backup/rollback scope mở rộng:** manifest và restore drill phải bao cả rollout/policy/random versions, Card results/grant links, Fortune catalog revisions + exact opening snapshots, Plant waterings/progress/milestone unlocks và canonical bonus ledger; không chỉ login tables. Planned emergency pause chặn **mọi mutation mới** của login/card/cookie, giữ owner read/replay receipts và tất cả lịch sử. Không re-random Card, chọn lại Cookie, reset cây, xoá milestone hoặc trừ wallet theo tổng grants để rollback. Runbook thực thi phải được review với exact RPC signatures khi implementation tồn tại, chưa chạy gì ở bước kế hoạch.

**Gate E3:** reviewed schema/API + rollback/kill-switch design, disabled by default, no historical UPDATE/reward backfill, no bonus ledger retro rows, zero new lint warning. Owner duyệt test execution trước E4.

### E4. DB baseline/concurrency — chạy thật chỉ trên disposable/staging được duyệt

- Chạy đủ13 entry ở B; baseline pass/no skip, rồi suite mới. Preserve old migration fixtures, không đổi test lịch sử thành policy mới để fake green.
- Exact payout: 1,2,3,4,7,8,14,15,30,31,60; day60 vẫn+2. Existing seed29 → claim30+7; seed30 → claim31+2; missing yesterday/reset; boundary month/year/leapday; valid rows reward0/legacy2 chỉ dùng presence, không trả lại reward.
- Carry-over gaps/duplicate/drift/future row/mismatch timestamp/missing history/repair after seed; assert lower-bound, no retrospective claim/grant/balance changes.
- Double-click/same key/different keys/two accounts/20+ concurrent connections, commit then timeout, rollback then retry, old day key sau midnight. Assert một login receipt/ngày, một **login-source** bonus grant, một water event, tối đa một grant cho Plant milestone đạt hôm đó; wallet delta bằng login total + đúng paid Plant milestone. Không assertion sai “chỉ một grant tổng” vào ngày đạt Plant milestone.
- Fault injection vào từng claim/grant/wallet/streak/activity/**water/progress/milestone** step; total rollback. Concurrent vote/refund/spin/achievement/admin bonus reset: no lost update/deadlock, canonical spend order và quota unchanged.
- Achievement overlap: earned beforeT but ungranted, already granted beforeT, first unlock afterT, replay afterT, profile lock waits quaT; badge/title giữ, old amount giữ, new overlap vote0; other achievements không đổi.
- Cutover: disabled/nullT, schedule giữa ngày, confirm qua midnight, deploy partial, mixed versions/ambiguous day, existing old payout, old check-in0, old quiz submitted late, new attempt beforeT, pause/reschedule, new epoch after grants. Không tự hoán đổi ngày để né at-most-once.
- Asia/Ho_Chi_Minh authoritative, browser UTC/NY/DST/fake clock không đổi entitlement; locks qua 17:00UTC. DST client test không ngụ ý VN có DST.
- Auth/RLS/ACL: anon, own/other user, missing profile, ordinary user gọi admin/helper/config, tampered uid/date/amount; permission fail không bị coi là empty history.
- Target environment schema versions/fresh install/upgrade + rollback containment giữ tất cả financial rows. Backup restore drill chạy riêng và owner review trước go-live cleanup gate.

**Acceptance tests Card/Cookie/Plant bắt buộc thêm:**

- Eligibility: auth login nhưng chưa Daily Login claim → Card/Cookie denied; claim yesterday hoặc chỉ legacy row/seed → denied hôm nay; claim today thành công mới unlock. Card/Cookie concurrent với login uncommitted/rollback phải theo persisted DB state. Rollout disabled/ambiguous-day không bị bypass qua ritual endpoint.
- Card: 60/30/10 distribution config validation và mapping boundaries 0/59/60/89/90/99; secure RNG rejection sampling không bias, no client Math.random/result injection. Test RNG injection chỉ trong isolated harness, không test seed/override endpoint production. Không assert một sample nhỏ phải đúng chính xác60% gây flaky; statistical smoke chỉ bổ sung, không thay mapping/security tests.
- Card: tiers chỉ calm/bright/bloom và amounts1/2/3, không0; same/different key reload/two tabs/two devices/concurrency trả same persisted tier/amount/random_version, exactly one grant+wallet increment. Policy/version đổi sau reveal không đổi receipt. Fault wallet/result insert/timeout sau commit không reroll successful outcome.
- Cookie: đúng eight category allowlist; no medical/legal/financial advice/toxic/harmful fortune/long copyrighted quote trong curated catalog (content review + automated checks hỗ trợ, không chỉ regex). No client fortune_id; exact content/ID/category/revision replay dù catalog sau đó edit/retire. Avoid recent khi đủ candidates, small/empty catalog fallback đúng và bounded; no votes/no wallet/quota/grant-ledger change.
- Plant: đúng một cây/user; duplicate login/card/cookie/status reads không water thêm; không manual water/milestone RPC hoặc writable table từ client. Water increment và mốc atomic, no cron/poll dependency.
- Plant stages tại totals0/2/3/6/7/13/14/29/30/59/60/99/100/101; missed days giữ nguyên total/stage/cây, login streak reset độc lập. Seed login từ legacy streak30 không tự tạo30 watered days hoặc retro milestone grants.
- Plant milestones:3 visual-only,7+2,14+3,30+5,60+8,100 cosmetic-only theo plan; one-time lifetime kể cả replay/policy-version/rollout change. Simultaneous claim milestone và achievement mapping không duplicate; historical awarded rows unchanged. Fault Plant grant sau login insert phải rollback cả login wallet/streak/claim/water.
- Combined receipt: khi login streak7 đồng thời watered-day7, +4 login +2 Plant =+6; reveal Card sau đó cộng đúng1/2/3 riêng; Cookie không cộng. Không suppression nhầm Plant +2 vì achievement login7 badge-only. Các request này chạy concurrent với vote/refund vẫn bảo toàn free→bonus→purchased và quota.
- Midnight: Card/Cookie tính ngày **sau profile lock**, login hôm qua không unlock hôm nay; key đã commit hôm qua replay đúng outcome cũ không tính như mở hôm nay. Key chưa commit và stale day → DAY_CHANGED, không silently reveal/open ngày mới; new successful login ngày mới mới unlock.

**Gate E4:** TAP evidence không skip; counts/data invariants + privilege tests đủ Daily Login/Card/Cookie/Plant, no production DB writes. Không mark Card/Cookie/Plant N/A hoặc dùng Login-only pass để ký toàn Daily Ritual gate.

### E5. UI integration sau contract + DB gates

**Files:** App.jsx login/ritual integration, dedicated DailyLoginRewards.jsx/css, DailyLoginCalendar.jsx, DailyCardFlip/FortuneCookie/PlantGrowth components + CSS/tests theo token chung, checkInCalendar.js, db.js dedicated wrappers/demo, i18n.jsx, AchievementIndex/achievement presentation và tests; shared wallet refresh integration, route/network/E2E tests. Tên component cụ thể sẽ chốt trong implementation diff, không là file đã tạo. Existing quiz files/route giữ nguyên tới final approved redirect/removal.

- Calendar dùng design tokens, no gratuitous gradient/glow/card nesting; responsive 320/375/768/1024/1440 + zoom; keyboard grid full spec, aria-current/labels/live messages; locale dates.
- States disabled-before-cutover/ambiguous-day/loading/error/Retry/signed-out/new/ready/claimed; day3 thể hiện +2 base +1 bonus =+3 total, days31+ +2; policy server, không quiz ceiling5.
- Streak seed có provenance và không hứa history giả; legacy check-ins khác paid claims. Current streak trước claim/after claim rõ; next claim/start date + streak expiry **Asia/Ho_Chi_Minh**. Countdown re-fetch server sau rollover, không client-authorized date.
- Achievement label badge/title-only sauT, lịch sử rewards vẫn đúng amount; no misleading old +bonus copy.
- Daily Login UI riêng; Card/Cookie locked state nói rõ cần claim hôm nay, available/revealing-or-opening/completed/error/retry states giữ idempotency key. Card chỉ một flip, reveal exact stored outcome, không reroll/wheel/slot/near miss; Cookie hiển thị exact saved fortune, không badge+votes hay advice CTA.
- Plant read-only visual progress một cây + total watered days + stage + next milestone; thông báo “đã được tưới qua Daily Login”, không water/claim button/inventory/grid. Bỏ ngày không UI cây chết hoặc count giảm; no cron/no network polling (mount/resume/action-triggered reads được phép).
- Login success receipt tách base/streak/Plant payout và tổng bonus wallet delta; Card payout riêng, Cookie không tiền; milestones3/100 visual/cosmetic-only được label rõ. Content/cosmetic unlock giữ cả keyboard/screen reader không chỉ animation.
- Browser monitor console/requestfailed/permission errors, requests tháng cũ/retry/auth switch, wallet race. Calendar **zero quiz API calls/import/controller/validator**, mock/demo cũng tách để không che lỗi contract production.
- `/quiz` redirect tới `/daily-login` chỉ sau final go-live approval và đủ D6. Thiết kế server redirect + client fallback, sitemap/menu/header/footer cập nhật trong PR2 riêng; không xoá route ngay khi UI mới code xong.

**Gate E5:** build/test/lint zero added warning, actual database suite no skip, real browser screenshots/network/a11y evidence. Static mock không thay thế integrated UI pass. Chỉ sau owner review PR + migration/deploy plan mới deploy; xong deployment được xác nhận mới schedule T.

## F. PR và approval checkpoints

1. **Hiện tại:** PR #28 docs/mock bất biến; Phase2 plan local chờ owner. Không push nên không tạo deployment/CI mới.
2. **Sau review plan + cho phép implementation:** PR1 runtime theo E1→E5, all code/config inactive default; giữ same session branch, không switch/create branch khác. Nếu muốn PR riêng kế tiếp, cần xử lý docs PR lifecycle được owner duyệt trước; không gộp runtime vào #28 mà vẫn gọi “7 docs only”.
3. **Trước bất kỳ DB test:** owner cho phép ephemeral harness vì test có CREATE/DROP và schema apply. Đây không là production approval.
4. **Trước staging/production migration/deploy:** owner duyệt exact diff/migration list/rollback, đúng target/environment, backup và secret isolation. Không tự bấm deploy; push cũng cần lưu ý automatic Cloudflare preview.
5. **Sau migration+deploy xác nhận:** trusted rollout config mới schedule next ICT day; không lịch fixed bây giờ. Owner xác nhận final go-live.
6. **PR2 UI/routes/tooling retirement:** chỉ sau cả4 gate D6; `/quiz` redirect sau final go-live. Không drop tables/RPCs để làm code dead-check pass.
7. **PR3 destructive cleanup:** tiếp tục approval riêng sau vận hành ổn định và owner-reviewed restore drill; keep immutable historical migrations/baselines/financial records theo retention được duyệt.

## G. Những điểm chưa có thông tin, không tự suy đoán

- **Scope/rules Daily Login + Daily Card Flip + Fortune Cookie + Plant Growth đã chốt đầy đủ ở D1–D9**, không còn yêu cầu owner cung cấp lại game mechanics. Chi tiết kỹ thuật còn review trong implementation PR: schema/ledger live để reuse, RNG implementation, catalog nội dung curated/recent-window config, immutable snapshot và cosmetic/achievement semantic mapping; không dùng review kỹ thuật làm lý do loại feature khỏi scope.
- Actual production free quota/global cap semantics/DB version/objects/ACL; source defaults không chứng minh live config. Không tự set free quota0, bật+3 hoặc áp login payout vào cap.
- Financial audit retention và account deletion behavior của FK mới; không áp ON DELETE RESTRICT mà vô tình chặn xoá account, cũng không CASCADE mất audit chưa được duyệt.
- Approval chạy DB test trên cluster disposable, rồi staging/production từng bước. Lượt này chưa xin/nhận quyền qua suy diễn từ câu “đã chốt quyết định”.

## H. Exit condition của lượt lập kế hoạch

Chỉ cập nhật/giao tài liệu này; giữ nguyên các evidence PR #28/test/lint của lượt trước, không tuyên bố đã chạy lại audit trong lần bổ sung spec. Không source changes, không migrations executed, không rerun workflow, không PR merge, không deploy. Những giả định Phase1 như “streak mới luôn bắt đầu1” hoặc “automatic free quota=0” **không còn là implementation policy**; thực hiện theo carry-over kiểm chứng và quota-preservation mà owner đã chốt.
