# Daily login & music quiz

> ⚠️ **Trạng thái hiện tại (retirement):** phần **Music quiz đã bị gỡ khỏi giao
> diện** — không còn mục menu, không còn màn quiz, và `/quiz` chỉ còn là đường
> dẫn cũ chuyển hướng về `/daily-login`. Dữ liệu quiz trong database vẫn được
> giữ nguyên (không xoá), và các cửa RPC quiz đã bị revoke khỏi mọi client role.
> Tài liệu dưới đây mô tả thiết kế gốc của hai tính năng; phần quiz là lịch sử,
> không còn là hướng dẫn vận hành. Xem `docs/DAILY-QUIZ-RETIREMENT.md` để biết
> cái gì còn, cái gì mất, và danh sách object cho giai đoạn dọn dẹp sau.

## 2026-10 B4: Vote-back 10% khi request được PICKED

> Đã duyệt và **đã apply production** (2026-10-10, run
> [38044695921](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38044695921)).
> Đơn vị duy nhất là **vote**. File
> `supabase/migrations/20261210_vote_back.sql` (một transaction, rerunnable)
> chạy sau B1 ledger (`grant_reward_event`) và catalog v2 (`firstVoteBack`).
> Cờ: `reward_config.vote_back_enabled`.

### Điều kiện kích hoạt

- Request chuyển **unpicked → PICKED**: `picked_at` từ NULL sang NOT NULL.
  Mọi đường pick đều dính cùng trigger (`pick_top_request`, `admin_pick`,
  `admin_pick_group`, SQL `UPDATE`).
- **Một lần trong đời request.** Cột latch `requests.vote_back_paid_at` được
  set **cùng transaction** với lần pick đầu, kể cả khi trả 0 vote. Unpick
  **không** xóa latch. Pick lần 2 / gỡ chốt rồi chốt lại = không trả thêm.
- Unpick (`admin_pick` / `admin_pick_group` với `p_picked = false`) **bị cấm**
  khi latch đã set → `err.unpickLocked`. Gỡ chốt thủ công sau khi đã trả
  không thuộc B4.
- Vote hai chiều khóa khi `picked_at` khác NULL (`err.voteLocked`) — không
  rút phiếu gốc sau khi đã nhận hoàn.

### Công thức 10%

Đếm trên bảng `votes` của đúng request đó (từng dòng = 1 phiếu):

| Vai trò | Công thức | Ví dụ |
| --- | --- | --- |
| Voter, `n ≥ 1` | `greatest(1, floor(n / 10))` | 1–9 phiếu → **1**; 10–19 → 1; 20–29 → 2 |
| Owner | `floor(total / 10)` | total &lt; 10 → **0** |
| Owner tự vote | **Cả hai** nguồn, 2 row ledger | 20 phiếu của chính mình → owner 2 + voter 2 |

`vote_back_owner` và `vote_back_voter` là hai **khoản thưởng vote**, không
phải hai lần thành tựu (xem `firstVoteBack` dưới).

### Cap

- **50 vote thưởng / request:** nếu `owner_raw + sum(voter_raw) > 50`, giữ
  phần owner trước (tối đa 50), voter chia phần còn theo largest-remainder.
  Phần bị clip **mất**, không top-up ngày sau.
- **30 vote thưởng / người / ngày VN:** đi qua `grant_reward_event` (cùng cap
  với login / spin / mystery / achievement). Phần clip **cũng mất** — vote-back
  là một lần/đời request, khác thành tựu (thành tựu tự bù slice).
- **Ngoài cap:** vote đã mua, quota free 3/ngày, `bonus_requests`, thưởng mùa
  do admin chốt.

### Cờ `vote_back_enabled`

- **Tắt:** trigger **vẫn set latch**, không trả thưởng, không ghi
  `reward_events`.
- **Bật lại:** chỉ request được pick **sau** lúc bật (chưa có latch) mới được
  trả. Bài đã latch lúc tắt **không** nhận thưởng truy thu.

Tắt cờ bằng SQL (không có đường client):

```sql
update public.reward_config
   set value = 'false'::jsonb, updated_at = clock_timestamp()
 where key = 'vote_back_enabled';
```

### Thành tựu `firstVoteBack`

- Catalog v2: +3 bonus votes, threshold 1, **một lần / tài khoản**.
- Máy chủ (`claim_achievements`): `EXISTS` bất kỳ row
  `reward_events.source IN ('vote_back_owner','vote_back_voter')` → progress
  **= 1**. Owner có cả hai row ledger **không** nhận badge hai lần, **không**
  cộng 2 vào tiến độ.
- Client (`achievementProgress`): `fact01` — mọi giá trị truthy / số ≥ 1
  gom về 1, nên UI không thể vẽ 2/1 nếu ai đó lỡ cộng hai nguồn.
- Phần +3 của badge đi qua cap 30 **và được tự bù** ở lần claim sau nếu bị
  cắt (đây là achievement, không phải khoản vote-back 10%).

### Vận hành

- Test: `npm run test:voteback:pglite` (7 kịch bản: làm tròn, latch/replay,
  cap 50 + cap 30, mọi đường pick, `voteLocked`, `firstVoteBack` một lần,
  flag off).
- Rollback: `supabase/rollback/20261210_vote_back.sql` — từ chối khi còn
  grant vote-back trong 48 giờ; không xóa `reward_events`; không claw-back ví.
- Không thuộc fresh-install bundle (`schema.sql` dừng ở 20261120).
- UI toast/inbox (B4.3) **không bắt buộc** cho payout — lịch sử Daily Login
  đã có nhãn `daily.source.vote_back_owner` / `vote_back_voter`.

## 2026-10 B2: Mystery Box — một hộp mỗi ngày, mở sau check-in

> Đã duyệt (2026-10). Đơn vị duy nhất là **vote** ("credits" cũ quy về vote).
> Chạy `supabase/migrations/20261129_mystery_box.sql` (một transaction,
> rerunnable) sau B1; cờ tắt/mở: `reward_config.mystery_box_enabled`.

Luật:
- **Khoá theo check-in**: phải điểm danh CÙNG ngày (VN) rồi hộp mới mở —
  chưa điểm danh RPC trả `err.mysteryLocked`, card hiện trạng khoá.
- **Một hộp/ngày/tài khoản**: PK `(user_id, day)` trên `mystery_opens`;
  mở lại/trong tab khác/retry → replay trả đúng kết quả đã commit, không rút lại.
- **Bảng thưởng** (rút đều 0..999; bản v3 siết tỉ lệ — DUY NHẤT một
  outcome +5 votes ở 4%; 0.4% = +1 free paid request, 0.1% = +2 free paid
  requests; mapping kind giữ từ `20261202_mystery_paid_v2.sql`, trọng số
  mới ở `20261204_mystery_odds.sql` — row cũ kind `paid_request` vẫn đọc được):
  | Kết quả | Trọng số | Thưởng |
  | --- | --- | --- |
  | Trống | 70% | — |
  | +1 vote | 16% | qua cap |
  | +3 votes | 8% | qua cap |
  | +5 votes | 4% | qua cap |
  | +10 votes | 1.5% | qua cap |
  | +1 free paid request | 0.4% | NGOÀI cap (`bonus_requests`) |
  | +2 free paid requests | 0.1% | NGOÀI cap (`bonus_requests`) |
- Phần thưởng vote đi qua `grant_reward_event` — **cùng cap 30 vote thưởng/ngày**
  với login/spin/vote-back/achievement; hộp vẫn tính đã mở nếu prize bị cap cắt
  hết (ledger giữ `meta.requested`).
- Không có cổng Turnstile riêng: RPC yêu cầu `p_gate_token` qua `edge_gate_ok`
  (chỉ Edge function cầm `EDGE_GATE_TOKEN` mới gọi được khi cổng được vũ khí hoá).
- Mystery Box là **TRANG RIÊNG `/mystery-box`** (duyệt 2026-10, tách khỏi
  /daily-login): entry "Mystery Box" nằm cạnh Daily Login trong menu, route
  lazy-load riêng, gate check-in dẫn người chơi về `/daily-login` — hai tính
  năng tách bạch UI/route.
- Migration chưa chạy / cờ tắt → `my_mystery_status` lỗi/tắt → trang báo
  "chưa khả dụng"; `/daily-login` không hề nhắc tới hộp quà.

## 2026-10 kế hoạch thưởng (B1): điểm danh trả vote lại, có cap 30/ngày

> Quyết định của chủ dự án (đã duyệt, 2026-10): điểm danh **trả vote trở lại**
> theo đúng spec dưới đây. Các mục "Điểm danh KHÔNG thưởng gì cả" bên dưới là
> **lịch sử chính sách** (20261118–20261124) — vẫn đúng cho dữ liệu đã ghi, nhưng
> không còn là luật hiện hành sau khi chạy ba migration B1.

Chạy **đúng thứ tự**, mỗi file một lượt trong SQL Editor hoặc qua guarded runner
(`npm run db:plan` → duyệt → `db:deploy`); mỗi file là một transaction, chạy lại
an toàn, chưa chạy thì tính năng mới tự ẩn (UI không vỡ):

1. `supabase/migrations/20261126_reward_ledger.sql` — sổ cái `reward_events`
   (append-only, idempotent theo `UNIQUE (source, user_id, day, ref)`), bảng
   config/flag `reward_config`, bảng mốc một-lần `reward_milestone_once`, và
   hàm cấp thưởng duy nhất `grant_reward_event` (tự scale theo cap).
2. `supabase/migrations/20261127_login_streak_rewards.sql` — `claim_daily_login_calendar`
   trả thưởng: **+2 mỗi ngày; ngày thứ 7 của chu kỳ nhận +5 CỘNG THÊM lên +2;
   trọn chu kỳ 7 ngày +10 (lặp lại ở 7/14/21/…); 30 ngày liên tiếp +20 MỘT LẦN
   (ngày 30 nhận 2 + 20 = 22)**. Bỏ lỡ một ngày → streak về 0, chu kỳ đếm lại.
   Cột `daily_login_rewards.reward` vẫn giữ nguyên bất biến (dòng mới = 0) —
   thưởng ghi hoàn toàn vào `reward_events` và ví bonus.
3. `supabase/migrations/20261128_achievements_v2.sql` — danh mục thành tựu
   **đúng 20 mục active trong 5 nhóm**: Request 1/5/10/25/50 → +1/2/3/5/10 vote;
   Vote 1/10/50/100/250 → +1/2/3/5/10 vote; Paid 1/3/5/10 → 1/2/3/4 free paid
   request; Streak 7/30/100 → +5/10/20 vote; Đặc biệt (pick/vote-back/mystery
   lần đầu) → +2/3/5 vote. 25 mục cũ bị **deactivate** (không xoá — huy hiệu đã
   nhận giữ nguyên trong `achievement_rewards`).

**Cap 30 vote thưởng/ngày/người** áp cho TỔNG vote thưởng từ: điểm danh, spin,
mystery, vote-back, achievement. NĂNGOÀI cap: vote mua, quota free 3/ngày,
thưởng mùa do admin chốt, free paid request. Grant bị cap cắt giữ `meta.requested`
trong sổ cái; thưởng thành tựu bị cắt sẽ **tự bù** ở lần claim sau (slice
`ach:<id>#<n>` / `once#<n>`), còn thưởng theo-ngày thì dừng ở mức headroom của
ngày đó.

Feature flags trong `reward_config` (chỉnh bằng SQL, không có đường client):
`login_rewards_enabled` (tắt = về hành vi lịch-only cũ), `daily_reward_cap`,
`login_daily_votes`, `login_day7_extra`, `login_milestone7_bonus`,
`login_milestone30_bonus`. Cờ hộp / vote-back (`mystery_box_enabled`,
`vote_back_enabled`) do B2/B4 thêm — xem các mục tương ứng. Rollback code:
file trong `supabase/rollback/` (đều có preflight, không bao giờ thu hồi
thưởng đã cấp).

Kiểm chứng: `npm run test:ledger:pglite` (PGlite — chain thật 9 kịch bản, gồm
đúc lệch cap và tự-bù), suite cũ vẫn xanh; test DB thật cần URL vẫn giữ nguyên
cơ chế skip.

Daily login là **cách duy nhất** còn lại trong nhóm này, bên cạnh vòng quay:

- **Daily login** → `/daily-login`
- **Music quiz** → `/quiz` (đã nghỉ hưu; chuyển hướng về `/daily-login`)
- **Daily Spin** → `/daily-spin` (chỉ vòng quay, giữ URL cũ)

Giao diện tiếp tục dùng tiếng Anh như phần còn lại của app.

## Luật mặc định

- **Daily login:** lịch điểm danh (thứ Hai → Chủ nhật) với **điều hướng tháng**: bấm ‹ › để xem lại các tháng trước, lịch sử lấy từ ledger thật của đúng tài khoản; tháng trước/tương lai chỉ đọc. Ngày đã nhận có dấu ✓, hôm nay nổi bật và là **ô duy nhất bấm được**, ngày sắp tới mờ.
  - Thống kê phía trên lịch: **This month** (số ngày đã điểm danh/tháng), **Streak** (chuỗi ngày liên tiếp, còn sống đến hết hôm nay), **Best streak**, **Lifetime** (tổng số ngày). Thanh tiến trình có mốc 5/10/20 ngày — **chỉ để hiển thị, không có jackpot và không có thưởng**.
  - Bấm ô **hôm nay** hoặc **Check in today** để **ghi nhận điểm danh**, một lần/tài khoản/ngày. Không nhận bù ngày trước, không nhận trước ngày tương lai. Không cần đăng xuất/đăng nhập lại; việc mở trang không tự điểm danh.
  - **Điểm danh KHÔNG thưởng gì cả**: 0 vote, 0 phiếu miễn phí, 0 điểm, 0 XP. Nó chỉ ghi ngày, giữ streak và lịch sử tháng. Music quiz là **đường duy nhất** tạo vote thưởng: 1 đáp án đúng = 1 vote, trần **5 vote/người/ngày**.
- **Music quiz:** một vòng **5 câu dễ/trung bình về K-pop**, chia loại **Lyrics · Songs · Groups · Members · Fandom** — hook lời bài hát, bài hit, số thành viên, tên fandom, lightstick. Không còn câu nhạc lý chung (BPM, nhạc cụ, v.v.).
  - **Chỉ câu đã duyệt mới được chọn.** Câu phải có `approval_status = approved`, `daily_eligibility_status = eligible`, `retirement_status = active`, `source_fact_match = pass`, `source_final_http_status = 200`, `source_final_url`, `source_last_checked` còn hạn, `quality_score >= 97` và không có cờ an toàn/bản quyền/trùng lặp. **99 câu legacy chưa có nguồn được kiểm chứng sẽ không bao giờ được chọn và không thể trả thưởng** (chúng vẫn nằm trong bảng để thực hành và để được nghiên cứu, kiểm chứng rồi nâng cấp từng câu sau này).
  - Khi chưa đủ 5 câu đủ điều kiện, trang quiz hiện trạng thái **“not available yet”** có chủ đích thay vì rút từ ngân hàng chưa kiểm chứng.
  - Tỉ lệ ra mắt: **đúng 2 câu easy + 3 câu medium**. Câu hard bị khoá cho đến khi cờ `hard_question_enabled` bật (và ngân hàng hard đạt `min_hard_pool_to_enable`, mặc định 30 câu); lúc đó tối đa **1 câu hard** mỗi vòng.
  - Máy chủ **tránh câu đã hỏi trong 90 ngày**, tối đa 2 câu/nghệ sĩ, ưu tiên ≥3 nghệ sĩ khác nhau, ≥1 câu profile và ≥1 câu lyrics, tối đa 1 câu đúng/sai và 1 câu `lyrics_keyword`, và không trùng bài/album/sự kiện trong cùng một vòng.
  - Dạng câu lấy cảm hứng từ các bộ K-pop phổ biến trên Sporcle ([danh sách thẻ Kpop Quiz](https://www.sporcle.com/games/tags/kpopquiz)): nhóm nam/nữ, ai là leader, ai là maknae, tên thật của idol, tên fandom, công ty/năm debut, và **điền tiếp tên bài hát**. Chỉ lấy ý tưởng định dạng; **toàn bộ câu hỏi được viết lại**, không copy nội dung của họ.
  - Giao diện: thẻ câu hỏi có nhãn loại, 4 đáp án dạng thẻ (A/B/C/D) **được xáo thứ tự ở client nhưng vẫn mang option id ổn định**, thanh bước 1–5 bấm được, phím **1–4** chọn, **←/→** chuyển câu, **Enter** nộp. **Nộp từng câu**: mỗi câu đúng **+1 bonus**, sai **+0**, trần **+5/ngày**. Câu đã nộp khoá lại và hiện đáp án đúng + giải thích ngay. Sau 5 câu: thẻ điểm, review từng câu và đếm ngược đến lượt mới.
  - **Vote:** mỗi ngày một người chỉ nhận tối đa **5 vote từ quiz** (1 vote/đáp án đúng). Khoản **3 vote miễn phí tự động mỗi ngày** (theo ngày Việt Nam) đã **bật lại theo quyết định có review** bằng migration `20261124_restore_daily_free_votes` (`free_vote_grant_enabled = true`, `free_votes_per_day = 3` ở **cả hai** bản config phải khớp nhau: `public.daily_vote_quota_config` và `public.daily_quiz_config`); 3 vote này **tách biệt** với ví bonus/purchased chứ không cộng dồn vào đó. Trần chung tuỳ chọn `global_daily_vote_cap_enabled` không bị migration này thay đổi.
- **Daily Spin (v2):** vòng quay **7 ô trọng số** `+1 30% · +2 25% · +3 20% · +5 12% · +8 8% · +10 4% · +20 1%` (bảng đã duyệt 2026-10, migration `20261201_spin_v2`). Mỗi ô **một mức thưởng**, độ rộng cung đúng bằng xác suất thật (trung bình **3,24 vote/lượt**, ~6,48/ngày với 2 lượt miễn phí — giữ nguyên hạn mức 2/device + 2/account + 2/fingerprint). Server rút qua hai byte + lấy mẫu loại bỏ để mỗi ô đúng trọng số đã duyệt; **luật không-lặp giữ nguyên**: hai lượt gần nhất của cùng trình duyệt trúng cùng một giải thì lượt kế không ra giải đó. Giải về `bonus_credits` như cũ (reset 31/10), và phần thưởng hiện bằng **votes** trên toàn bộ UI.
- Ngày mới bắt đầu lúc **00:00 Asia/Ho_Chi_Minh (GMT+7)**. Câu chưa nộp của ngày trước hết hạn. Vòng mới có thể gặp lại câu cũ.
- Bonus cộng vào `profiles.bonus_credits`, **không** vào vote đã mua; dùng và hết hạn cuối tháng 10 theo luật ví đang có. Ledger nhận thưởng không bị xóa khi ví reset, nên reset ví không cho nhận lại thưởng đã lấy.
- Tải lại trang giữ nguyên bộ câu hỏi. Lựa chọn đang làm lưu nháp theo tài khoản + ID lượt chơi trên trình duyệt (nếu storage được cho phép); đổi thiết bị vẫn có cùng câu hỏi nhưng phải chọn lại câu trả lời chưa nộp. Kết quả đã nộp lưu trên máy chủ.

## Áp dụng cho database đang dùng, chưa có daily rewards

1. Sao lưu theo hướng dẫn hiện có (`npm run backup:db`).
2. Xác nhận các migration bonus, activity và security hiện tại đã có (đến `20261111_shared_ip_spin.sql`).
3. Chạy **toàn bộ** `supabase/migrations/20261112_daily_rewards.sql`, rồi `supabase/migrations/20261113_calendar_kpop_quiz.sql` bằng SQL Editor → **Run**. Các file có transaction, chạy lại an toàn, không backfill thưởng và không reset dữ liệu cũ.
4. Deploy frontend cùng thay đổi. Không cần Worker mới, biến môi trường mới hay cron mới. Nếu đã có daily rewards thì chỉ cần migration calendar/K-pop trong mục bên dưới.

**Không chạy lại `schema.sql` hoặc các file setup trên database đang dùng.** Với project mới, làm theo `supabase/setup/README.md`, gồm file `10-daily-rewards.sql` đã được cắt từ schema. Nếu chưa cài migration, app hiển thị thông báo setup và nút refresh; vòng quay cũ vẫn dùng được.

## Cập nhật calendar nâng cao & quiz K-pop cho database đã có daily rewards

1. Sao lưu; xác nhận đã chạy `20261112_daily_rewards.sql`.
2. Chạy **toàn bộ** `supabase/migrations/20261113_calendar_kpop_quiz.sql` trong SQL Editor. Sau đó deploy frontend.
3. Migration bổ sung `login.claimed_days` cho tháng/ngày Việt Nam từ `daily_login_rewards` của đúng tài khoản. Chỉ tắt 24 câu seed cũ và thêm 24 câu K-pop dễ; không đụng dữ liệu thưởng, số dư, câu hỏi admin tự thêm hoặc snapshot quiz đã có. Có thể chạy lại, không cộng thưởng mới.
4. Lượt quiz đã bắt đầu/đã nộp vẫn giữ câu hỏi, nháp, kết quả và quota cũ; bộ K-pop mới áp dụng cho **lượt mới**, không reset quiz để nhận thưởng hai lần trong ngày. Điều này áp dụng cả demo.
5. Nếu frontend đi trước migration, check-in hôm nay vẫn hoạt động; các ngày cũ hiện **History unavailable**, không giả định là chưa điểm danh. Production chỉ đổi sang bank K-pop sau khi chạy migration.

### Nâng cấp calendar (tháng trước, streak) và ngân hàng câu hỏi lớn

1. Sao lưu; xác nhận đã chạy `20261112_daily_rewards.sql` **và** `20261113_calendar_kpop_quiz.sql`.
2. Chạy **toàn bộ** `supabase/migrations/20261114_daily_rewards_upgrade.sql` trong SQL Editor, rồi deploy frontend.
3. Migration: thêm cột `category` cho câu hỏi, thêm **39 câu K-pop dễ** (tổng 63 câu active), đổi `start_daily_quiz` để ưu tiên câu chưa hỏi trong 30 ngày, mở RPC đọc-only `my_daily_checkin_month(date)` để xem lịch tháng bất kỳ, và bổ sung `login.total_days` / `streak` / `best_streak` / `first_day`.
4. **Không** đổi mức thưởng, không cộng/reset ví, không xoá ledger hay snapshot, không đổi quyền truy cập bảng. Chạy lại được nhiều lần. Streak chỉ là bộ đếm hiển thị — bỏ một ngày là đếm lại từ 0, không có thưởng streak.
5. Nếu frontend đi trước migration này, lịch vẫn đúng tháng hiện tại nhưng thống kê hiện **—** và không bấm được mũi tên tháng; các chức năng thưởng không đổi.

Database mới dùng các file setup `01`–`11` như trước: file `10` + `11` đã chứa cả ba migration. **Không** chạy lại schema/setup trên database đang dùng.

## Daily Quiz 5 câu (migration 20261115 → 20261117)

1. Sao lưu; xác nhận đã chạy `20261112`, `20261113` và `20261114`.
2. Chạy **toàn bộ** từng file, đúng thứ tự, trong SQL Editor → **Run**:
   `20261115_daily_quiz_schema.sql` → `20261116_daily_quiz_pool.sql` → `20261117_daily_quiz_flow.sql`.
   Ba file tách nhau vì giới hạn 32 KB của luồng cài tay; mỗi file là một transaction, chạy lại an toàn, không backfill thưởng.
3. Deploy frontend cùng thay đổi.
4. Sau bước 2, quiz **chưa có câu nào đủ điều kiện** (99 câu legacy bị đánh dấu `draft`/`ineligible`) nên trang `/quiz` hiện “not available yet” — đây là trạng thái mong đợi cho đến khi ngân hàng câu đã kiểm chứng được import.
5. Đường nộp cũ `submit_daily_quiz(uuid,uuid,int[])` bị khoá (`err.dailyQuizRetired`): vòng 3 câu của phiên bản trước không thể trả thưởng nữa.

Database mới dùng thêm các file setup `12-daily-quiz-schema.sql`, `13-daily-quiz-pool.sql`, `14-daily-quiz-flow.sql`.

### Cấu hình (`public.daily_quiz_config`, một dòng mỗi khoá)

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `questions_per_day` | `5` | Số câu mỗi vòng |
| `easy_count` / `medium_count` / `hard_count` | `2` / `3` / `0` | Tỉ lệ lúc ra mắt |
| `hard_question_enabled` | `false` | Bật câu hard |
| `min_hard_pool_to_enable` | `30` | Ngân hàng hard tối thiểu để cờ có hiệu lực |
| `max_hard_per_set` | `1` | Tối đa 1 câu hard mỗi vòng |
| `min_distinct_artists` / `max_per_artist` | `3` / `2` | Đa dạng nghệ sĩ |
| `min_profile` / `min_lyrics` | `1` / `1` | Có ít nhất một câu profile và một câu lyrics |
| `max_true_false` / `max_lyrics_keyword` | `1` / `1` | Giới hạn định dạng |
| `repeat_cooldown_days` / `freshness_days` | `90` / `30` | Không lặp lại câu / hạn kiểm tra nguồn |
| `min_quality_score` / `max_source_redirects` | `97` / `3` | Cửa chất lượng và link |
| `daily_vote_cap` | `5` | Trần vote quiz mỗi ngày |
| `free_vote_grant_enabled` | `true` (từ 20261124) | 3 vote miễn phí/ngày VN, tách khỏi ví bonus |
| `global_daily_vote_cap_enabled` / `global_daily_vote_cap` | `false` / `5` | (Tuỳ chọn) trần chung mọi nguồn vote |
| `legacy_pool_enabled` | `false` | Ngân hàng legacy, luôn không được chọn |

Giá trị thiếu hoặc đọc không được luôn rơi về phía an toàn (ít câu hơn, trần thấp hơn).

## Điểm danh không còn thưởng vote (migration 20261119 + 20261120, thay thế 20261118)

**Lý do:** điểm danh từng cộng **+2 vote/ngày**. Cộng với 5 câu đúng của quiz (trần +5) thành **7 vote/ngày**, vượt trần dự kiến của sản phẩm.

**Ba migration, và thứ tự khuyến nghị**

| File | Vai trò |
| --- | --- |
| `20261118_daily_login_no_votes.sql` | Bản sửa đầu tiên. **ĐÃ BỊ CÁCH LY — không bao giờ chạy**: chạy `UPDATE daily_login_rewards SET reward = 0` trên toàn bảng (viết lại lịch sử) và thêm `CHECK (reward = 0)`. File đã chuyển sang `supabase/migrations/archive/20261118_daily_login_no_votes.sql.superseded` (cùng `archive/quarantine.json`), nên không nằm trong đường chạy mặc định của runner hay Supabase CLI, và không có trong `schema.sql`/file setup. |
| `20261119_preserve_legacy_daily_login_rewards.sql` | Bỏ ràng buộc toàn bảng, **không** UPDATE/DELETE dòng nào; chỉ chặn bản ghi **mới** bằng trigger. Chứa đủ phần sửa của 20261118 nên có thể thay thế nó. |
| `20261120_daily_login_reward_immutable.sql` | Khoá **bất biến** giá trị đã ghi: không cho sửa `2 → 0`, `0 → 2` hay bất kỳ thay đổi nào của cột `reward`. |

**Nguyên tắc sau sửa**

| | Điểm danh | Music quiz |
| --- | --- | --- |
| Vote thưởng | **0** (không có) | 1 / đáp án đúng |
| Trần mỗi ngày | — | **5** |
| Ghi nhận | `daily_login_rewards` (ngày; dòng mới `reward = 0`) | `daily_quiz_answers` (unique `user_id, quiz_date, question_id`) |
| Hiển thị | lịch tháng, streak, best streak, lifetime, tiến trình tháng | số câu đã trả lời, số vote 0–5 |

**Ngữ nghĩa lưu vết (audit) — giá trị đã ghi là bất biến**

- **Dòng lịch sử** giữ nguyên `reward` (kể cả `2`). Không cập nhật, không xoá, không đổi cách hiểu, và **không bao giờ** tạo vote mới: không hàm nào cộng `reward` vào ví, `earned_today` không đọc cột này.
- **Dòng mới** luôn `reward = 0`, `votes_awarded = 0`; không đụng `vote_credits`, `bonus_credits`, phiếu miễn phí hay ledger vote nào. Chỉ ghi ngày, streak và lịch sử tháng.
- Trigger `daily_login_rewards_no_vote` (`BEFORE INSERT OR UPDATE OF reward`):
  - `INSERT`: chỉ chấp nhận `reward = 0`, giá trị khác ném `err.dailyLoginRewardImmutable`.
  - `UPDATE OF reward`: **mọi** thay đổi giá trị đều bị chối (`2 → 0`, `2 → 5`, `0 → 2`, `0 → 1`), lỗi `err.dailyLoginRewardImmutable`.
  - Cập nhật trường khác (vd. `created_at`) hoặc ghi lại chính giá trị cũ vẫn được phép — trigger không cản.
- Vì chỉ chặn **thao tác ghi**, việc restore dữ liệu cũ có `reward = 2` vẫn được chấp nhận và không sinh vote.
- Client không có đường ghi: RLS bật, không policy ghi, privilege đã revoke; migration **từ chối cài** nếu tồn tại policy INSERT/UPDATE/DELETE. `claim_daily_login` (security definer) là đường duy nhất.
- Điểm danh **không** có điểm/XP/huy hiệu/badge/cột mới thay thế. Điểm danh cũng **không** cộng vote dù công tắc `free_vote_grant_enabled` đang bật (`true`, 3/ngày từ `20261124`): check-in chỉ ghi lịch sử (`reward = 0`).
- **Không** thu hồi vote đã cấp: không migration nào trừ ví hay xoá ledger vote.
- Payload RPC: `login.vote_reward = 0` (thay cho `login.reward = 2` cũ); `earned_today` chỉ tính vote của quiz. Frontend **từ chối** payload cũ còn báo `reward = 2`.

**Sửa dữ liệu lịch sử trong trường hợp đặc biệt**

Không có đường sửa nào trong app: không RPC, không frontend, không role `authenticated`. Nếu bắt buộc phải sửa, đó là **một migration một lần, chỉ admin chạy**, gồm: (1) ghi log trước/sau (số dòng theo từng mức `reward` và các cặp `user_id`/`reward_day` bị ảnh hưởng); (2) chạy trong một transaction, tắt trigger đúng thời điểm câu lệnh sửa rồi bật lại ngay; (3) không để lại đường sửa nào sau đó. Quy trình này được ghi trong phần chú thích đầu file `20261120`.

**Cách chạy**

Cách chạy chính thức (chi tiết, kịch bản khôi phục, lệnh kiểm tra) nằm ở **`docs/DB-MIGRATIONS.md`**. Tóm tắt:

**a) Production chưa chạy migration nào trong chuỗi này (trường hợp khuyến nghị)**

1. Sao lưu (`npm run backup:db`).
2. Đối chiếu schema (bắt buộc): `SUPABASE_DB_URL='…' npm run db:verify-baseline -- --baseline 20261117` — phải in `READY`.
3. Xem kế hoạch — phải đúng 2 file: `SUPABASE_DB_URL='…' npm run db:plan -- --baseline 20261117`
4. Chạy: `SUPABASE_DB_URL='…' npm run db:deploy -- --baseline 20261117` (lệnh này tự chạy lại bước 2; **không bao giờ** dùng `--baseline` khi bước 2 chưa qua)

`20261118` **không bao giờ** nằm trong kế hoạch: nó đã bị cách ly, nên lệnh trên không cần ai nhớ phải bỏ qua nó.

**b) Môi trường đã lỡ chạy `20261118`**

`npm run db:deploy` (có lịch sử) hoặc `npm run db:deploy -- --baseline 20261118` (chạy tay, chưa có lịch sử). Cả hai chạy tiếp `20261119` rồi `20261120`: bỏ ràng buộc toàn bảng và khoá giá trị đã ghi, nhưng **không** khôi phục được các dòng lịch sử mà 20261118 đã đưa về 0 — việc đó, nếu cần, là quy trình sửa một lần ở mục trên.

**c) Cài mới (project trống)**

Dùng file setup `01`–`16`. **Không có bước nào cho `20261118`**: đường cài mới không chứa bản viết lại lịch sử.

**Không** chạy lại `schema.sql` hay setup trên database đang dùng. Kiểm tra sau khi chạy:

```sql
-- Giá trị lịch sử giữ nguyên (có mức 2 là BÌNH THƯỜNG nếu trước đây từng thưởng điểm danh).
select reward, count(*) from public.daily_login_rewards group by reward order by reward;
-- Không còn ràng buộc toàn bảng trên cột reward (kỳ vọng: 0 dòng).
select count(*) as reward_checks from pg_constraint
 where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%reward%';
-- Trigger bảo vệ (kỳ vọng: 1 dòng).
select tgname from pg_trigger where tgrelid = 'public.daily_login_rewards'::regclass and not tgisinternal;
```

## Tính toàn vẹn

- Máy chủ quyết định người nhận (`auth.uid()`), ngày, câu hỏi, đáp án và điểm. `p_expected_user_id` chỉ là chốt chống đổi phiên; `p_expected_day` chỉ chặn thao tác cũ qua nửa đêm, không cho browser chọn ngày thưởng.
- Ba bảng `daily_login_rewards`, `daily_quiz_questions`, `daily_quiz_attempts` bật RLS và **revoke all** khỏi `public`, `anon`, `authenticated`; không có đường đọc/ghi REST trực tiếp, kể cả đáp án trong snapshot.
- Chỉ 4 RPC cho người đã đăng nhập: `my_daily_rewards_status`, `claim_daily_login`, `start_daily_quiz`, `submit_daily_quiz_answer`. Helper `daily_rewards_payload` không có quyền execute cho browser. RPC cũ `submit_daily_quiz(uuid,uuid,int[])` bị revoke.
- Khóa row ví trước khi ghi ledger; ghi kết quả và cộng bonus trong cùng transaction. Unique `(user_id, reward_day)` và `(user_id, quiz_day)` ngăn nhận lại từ tab/thiết bị khác. Retry trả kết quả đã lưu, không cộng lại tiền.
- Mỗi lượt quiz chụp snapshot câu hỏi và đáp án; chỉnh ngân hàng sau khi người dùng bắt đầu không đổi kết quả của lượt đó. Đáp án/explanation chỉ trả về **sau khi câu đó đã nộp**, không phải trước.
- `daily_quiz_answers` có khoá chính `(user_id, quiz_date, question_id)`: một câu chỉ được trả lời và chỉ được thưởng **một lần mỗi ngày**, bất kể retry, tab thứ hai hay request trùng lặp. Trần 5 vote/ngày được tính lại trong cùng transaction, sau khi đã khoá ví.
- Hạn mức **theo tài khoản**, không phải thiết bị/IP. Đây không phải cơ chế chống tạo nhiều tài khoản; các giới hạn fingerprint/Turnstile của vòng quay không tự áp dụng cho daily missions.

## Bổ sung câu hỏi

Dùng SQL Editor với quyền quản trị (hoặc backend `service_role`), **không** đưa service key vào frontend:

Câu hỏi muốn **được chọn và được trả thưởng** phải có đủ metadata nguồn; nếu không, nó vẫn nằm trong bảng (thực hành) nhưng không bao giờ vào vòng chơi:

```sql
insert into public.daily_quiz_questions
  (id, prompt, options, correct_option, explanation, category, difficulty, sub_category,
   question_type, artist, fact_key, song_key, quality_score,
   approval_status, daily_eligibility_status, retirement_status,
   source_url, source_final_url, source_initial_http_status, source_final_http_status,
   source_redirect_count, source_access_status, source_fact_match, source_last_checked)
values
  ('unique-question-id', 'Your question?', '["Option A","Option B","Option C","Option D"]'::jsonb,
   1, 'Explain why Option B is correct.', 'Songs', 'easy', 'profile', 'mcq',
   'Artist name', 'fact:unique', 'song:artist:release', 99,
   'approved', 'eligible', 'active',
   'https://en.wikipedia.org/wiki/...', 'https://en.wikipedia.org/wiki/...',
   '200', '200', '0', 'public_accessible', 'pass', current_date);
```

`correct_option` đếm từ **0 đến 3**; `correct_option_id` (option id ổn định để chấm khi client xáo thứ tự) được **tự sinh** từ `option_ids`, không nhập tay. `source_final_http_status` phải là trạng thái của **URL cuối cùng** (`source_final_url`), không phải của URL ban đầu. `source_last_checked` phải còn trong `freshness_days` (mặc định 30 ngày).

Đặt `active=false` hoặc `daily_eligibility_status <> 'eligible'` để ngừng chọn câu cho vòng mới; câu đã nằm trong lượt đã bắt đầu vẫn giữ nguyên trong snapshot. Cần ít nhất 5 câu đủ điều kiện để mở một vòng. Không chạy migration cũ để đổi mức thưởng: **0 vote cho điểm danh** và +1/đáp án đúng, trần +5/ngày là luật cố định trong RPC, constraint và các hằng UI; thay mức thưởng cần một migration mới và cập nhật test/UI tương ứng.

## Kiểm tra

```sh
npm test
npm run build
npm run lint
npm run schema:split:check
npm run smoke

# Chỉ database LOCAL/TEST với quyền CREATEDB. Tạo database tạm rồi tự xóa.
DAILY_REWARDS_TEST_DATABASE_URL=postgres://... npm run test:daily:db

# Daily Quiz (5 câu, trần 5 phiếu, chỉ câu đã duyệt)
DAILY_QUIZ_TEST_DATABASE_URL=postgres://... npm run test:dailyquiz:db
```

Bộ DB test kiểm tra upgrade (calendar, bank K-pop, nâng cấp streak/tháng), lịch nhiều tháng và đúng tài khoản, quyền table/RPC, 20 request đồng thời, điểm 0–3, replay, câu hỏi không lặp, đổi tài khoản, hết ngày, snapshot, rollback ví, chạy lại migration và xóa tài khoản. Bộ UI test bấm ô hôm nay, thống kê/tháng, làm quiz bằng chuột lẫn phím, tải lại, xem đáp án, xác nhận số dư thật và cô lập tài khoản.

Kiểm tra thủ công: đăng nhập → mở Daily login → thấy lịch đúng tháng → bấm ô hôm nay → dấu check + hiệu ứng, **ví vote không đổi** → bấm ‹ xem tháng trước (chỉ đọc) → refresh/đổi tab không nhận thêm → sang Music quiz → làm quiz → thấy số điểm và bonus (tối đa +5) → cộng điểm danh + 5 câu đúng vẫn là **5** vote, không phải 7 → refresh vẫn khóa lượt → qua 00:00 VN mở lại lượt mới. Đăng xuất thì chỉ còn lời mời đăng nhập; kiểm tra thêm trên màn hình hẹp.
