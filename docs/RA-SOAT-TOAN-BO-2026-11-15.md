# Rà soát toàn bộ chức năng Chaereve — 2026-11-15

Phạm vi: audit chỉ đọc toàn bộ luồng chức năng trong repo `Chaereve/color-coded-lyrics-cf-new` tại commit nền `c1e2cf5`, đối chiếu với Supabase production `yooxntqwdlvkxcblgqbw` bằng truy vấn chỉ đọc và đọc thân RPC trực tiếp từ `pg_proc`.
Không sửa code nghiệp vụ, không chạy migration, không ghi dữ liệu production, không deploy.

## 0. Kết luận ngắn

Build/test/smoke xanh **không đủ** để kết luận các chức năng “khớp nhau”. Lần rà soát này xác nhận một số mâu thuẫn thật giữa UI, tài liệu, RPC và cấu hình live; tập trung vào 4 vùng nghi ngờ:

1. **Cờ trả phí / đơn hàng:** `is_paid`, `payment_status`, `orders` và quyền ưu tiên pick chưa được ràng buộc thành một trạng thái thống nhất.
2. **Trạng thái request / Up next:** cron chọn một dòng, admin chọn cả cụm, vote-back khóa theo dòng; UI vẫn cho bấm Unpick sau khi đã trả thưởng.
3. **Thưởng theo ngày:** Daily Spin **không đi qua sổ cái `reward_events`**, nên không bị cap 30/ngày và không hiện trong breakdown; cron reset 31/10 lại xóa **toàn bộ** `bonus_credits`, không chỉ thưởng spin.
4. **Fallback Edge:** các đường fallback gọi thẳng RPC hiện **không thể thành công** khi `edge_gate` đang bật, dù comment/UI nói “app không chết vì cổng”.

Ngoài ra có một lỗi CI browser thật trên `main`: live smoke hỏng mục “Most voted” dù dữ liệu vote và `computedTop=true`.

## 1. Đã kiểm chứng tự động

| lệnh | kết quả |
|---|---|
| `npm test` | 966 tests, 922 pass, 44 skip, 0 fail |
| `npm run lint` | 283 file, 0 error, 15 warning |
| `npm run build` | thành công, 2059 modules |
| `npm run db:check` | 66 active, 1 quarantined, không destructive statement |
| `npm run schema:split:check` | đạt |
| `npm run smoke` | 424/424 mục đạt (jsdom) |
| `npm run check:browser-compat` | đạt sàn Chrome 80 / Safari 13 |

Giới hạn: smoke jsdom không chứng minh layout CSS, WebSocket thật, thanh toán thật, OAuth thật hay hành vi trình duyệt thật. Sandbox không có Chromium; bằng chứng browser thật lấy từ GitHub Actions.

## 2. Đối chiếu live Supabase

- Migration live đủ tới `20261223_pick_pause` ⇒ vấn đề lệch migration trong audit 12/11 đã hết.
- 29 bảng public đều bật RLS.
- `settings.pick.paused = true` từ `2026-11-12T09:20:11Z`; auto pick đang **tạm dừng**. `next_pick_at = 2026-11-15T06:00:00Z` nhưng cron không chọn bài khi paused.
- `reward_config`: cap 30, login +2/ngày, day7 +5, milestone7 +10, milestone30 +20, login/mystery/vote-back đều bật.
- `edge_gate` đang có token hash ⇒ cổng Edge **đã vũ khí hóa**; gọi thẳng RPC thiếu `p_gate_token` sẽ bị từ chối.
- Cron live: pick mỗi 30 phút + một job 17:00 UTC, reset bonus `0 0 31 10 *`, expire 17:15 UTC. Không có cron chốt thưởng mùa.
- `season_rewards_log` hiện rỗng.
- Dữ liệu hiện tại nhỏ: 13 closed requests, 1114 vote/31 ngày, 86 vote/7 ngày, 0 cụm open trùng bài. Nhiều lỗi dưới đây là **cơ chế**, chưa phải sự cố dữ liệu diện rộng.

## 3. Lỗi / mâu thuẫn xác nhận

### P1-01. Daily Spin né cap 30 vote thưởng/ngày và không vào sổ cái

**Bằng chứng**
- Live `spin_daily`: sau khi insert `daily_spins`, chạy thẳng:
  `update public.profiles set bonus_credits = bonus_credits + v_spin.reward`.
- Không gọi `grant_reward_event`, không insert `reward_events`.
- `docs/DAILY-REWARDS.md:52-53,120-121,171-173` và comment `src/lib/mysteryBox.js:28` nói cap 30 áp cho login/spin/mystery/vote-back/achievement.
- `login_reward_status` tính `today_total/cap_used/breakdown` từ `reward_events`, nên thưởng spin không xuất hiện ở thẻ thưởng Daily Login.

**Hệ quả**
- Người dùng có thể nhận thưởng spin vượt cap 30/ngày mà UI/tài liệu nói là bị chặn.
- Không đối soát được spin bằng sổ cái chung; không có `meta.requested/clipped`; không top-up.
- Hai nguồn thưởng cùng vào `bonus_credits` nhưng một bên có ledger, một bên không.

**Hướng xử lý đề xuất**
- Quyết định chính sách: spin **trong** hay **ngoài** cap.
- Nếu trong cap: chuyển spin sang `grant_reward_event` với ref idempotent theo `request_id`, giữ nguyên replay.
- Nếu ngoài cap: sửa tài liệu/UI, tách nhãn nguồn và không gọi nó là “cap chung”.

### P1-02. Cron 31/10 xóa toàn bộ bonus, không chỉ bonus spin

**Bằng chứng**
- Live `reset_bonus_votes`: `update public.profiles set bonus_credits = 0 where bonus_credits <> 0`.
- Cron live: `0 0 31 10 *` gọi hàm này.
- Login, mystery, vote-back, achievement, season reward đều cộng vào cùng `bonus_credits`.
- `supabase/migrations/20261031_bonus_reset.sql:8-11` mô tả “chỉ bonus từ vòng quay bị reset”; `docs/DAILY-REWARDS.md:212-214` cũng gắn reset với spin.

**Hệ quả**
- Thưởng điểm danh, thành tựu, vote-back, hộp quà, thưởng mùa tích lũy trước 31/10 bị xóa sạch cùng spin.
- Ledger không bị xóa nhưng ví bị reset ⇒ lịch sử thưởng và số dư không còn giải thích được bằng ledger nếu không có bản ghi reset.

**Hướng xử lý đề xuất**
- Nếu muốn hết hạn toàn bộ bonus: đổi tài liệu/UI thành “bonus hết hạn 31/10”, ghi sự kiện reset vào ledger/bảng đối soát.
- Nếu chỉ muốn reset spin: tách ví theo nguồn hoặc ghi expiry theo từng grant; không reset cả cột dùng chung.

### P1-03. Fallback spin/mystery/vote không hoạt động khi Edge gate đã bật

**Bằng chứng**
- Live `edge_gate_ok` trả false nếu thiếu token khi `edge_gate.token_hash` tồn tại; truy vấn live xác nhận gate đang bật.
- `cast_vote`, `spin_daily`, `open_mystery_box` đều bắt buộc `edge_gate_ok(p_gate_token)`.
- `worker/index.js:105-118` chỉ Worker thêm `p_gate_token`.
- Client fallback:
  - `src/lib/db.js:933-936` gọi `spin_daily` không có `p_gate_token`; RPC có default `NULL` nhưng `edge_gate_ok(NULL)` trả false khi gate đã bật.
  - `src/lib/db.js:1265-1272` gọi `cast_vote` không có `p_gate_token`; tương tự, bị gate từ chối.
  - `src/lib/mysteryBox.js:288,291` gọi `open_mystery_box` chỉ với `p_expected_day`; live RPC bắt buộc cả `p_gate_token` và không có default, nên lời gọi thiếu tham số cũng không thể thành công.
- Comment `src/lib/db.js:838-842` nói cổng sập thì gọi thẳng RPC để “app không chết vì cổng”.

**Hệ quả**
- Khi Pages Function/Worker lỗi, fallback không cứu được thao tác: spin/vote nhận lỗi gate; mystery nhận lỗi thiếu tham số/setup hoặc gate.
- Với vote, fail-closed có thể là chủ ý bảo mật; nhưng thông điệp và comment hiện gây hiểu nhầm.
- Với spin/mystery là thao tác idempotent, mất fallback làm giảm khả dụng không cần thiết.

**Hướng xử lý đề xuất**
- Không đưa `EDGE_GATE_TOKEN` xuống client.
- Hoặc bỏ fallback và nói rõ “cổng bắt buộc”; hoặc tạo cơ chế degraded an toàn phía server, ví dụ endpoint dự phòng qua Worker khác, hoặc chính sách gate có thời hạn/one-time operation id được kiểm soát server-side.

### P1-04. Cờ “Paid request” sửa được độc lập với đơn hàng và trạng thái thanh toán

**Bằng chứng**
- Live `admin_request_edit` cho đổi `is_paid` nhưng không tạo/đối soát `orders`, không đổi `payment_status`, và không ghi `admin_actions`.
- Live `admin_order` khi reject đơn `paid_request` chỉ đặt `payment_status='none'`, không hạ `is_paid`; request vẫn có thể mang nhãn PAID và được ưu tiên pick.
- `src/components/AdminPanel.jsx:273-279` để lộ switch “Paid request” cho admin sửa trực tiếp.
- `pick_top_request` ưu tiên `c.is_paid desc`; board hiển thị pill PAID theo `is_paid`.
- Achievement paid lại yêu cầu `is_paid AND payment_status='paid' AND EXISTS orders paid` (`claim_achievements`, `achievementMetrics.js:7-25`).
- Live có 9 request `is_paid=true` không kèm order `paid_request` đã paid; audit chưa đủ bằng chứng để kết luận cả 9 là sai sổ, vì có thể là bonus-funded/legacy/manual, nhưng hiện không có trường/nguồn nhật ký đủ để phân biệt.

**Hệ quả**
- Admin có thể bật PAID để ưu tiên pick mà không có đơn đã trả.
- Tắt PAID không hủy đơn/hoàn tiền; bật PAID không làm achievement paid tăng.
- “PAID” trên board, “paid” trong sổ sách và “paid achievement” là ba khái niệm có thể lệch nhau.
- Thay đổi cờ trả phí không có dấu vết kiểm toán riêng, nên khó đối soát về sau.

**Hướng xử lý đề xuất**
- Không cho sửa `is_paid` trực tiếp; suy ra từ order/bonus request.
- Nếu cần nhãn thủ công, tách `is_priority`/`comped` khỏi `is_paid`, có audit và lý do.
- Thêm ràng buộc đối soát: request paid phải có order paid hoặc bonus grant; order paid phải chiếu đúng request.

### P1-05. Paid request hứa “started immediately” nhưng thực tế chỉ vào hàng đợi

**Bằng chứng**
- `src/lib/strings.js:894-896`: “Approved and started immediately, no voting needed.”
- Live `create_request`: paid thường → `status='pending'`, `payment_status='awaiting'`, tạo order.
- Live `admin_order` approve paid request → `status='queued'`, không set `picked_at`, không `in_progress`.
- Auto pick đang paused; khi chạy cũng theo chu kỳ 4 ngày và chỉ ưu tiên paid lúc đến lượt.

**Hệ quả**
- Người trả tiền được hứa “làm ngay” nhưng vẫn chờ admin xác nhận tiền, chờ pick/start.
- Dễ phát sinh khiếu nại/hoàn tiền thủ công.

**Hướng xử lý đề xuất**
- Sửa copy đúng thực tế: “ưu tiên sau khi thanh toán được xác nhận”.
- Hoặc nếu muốn SLA thật: tự động pick/start paid request sau khi order paid, có hàng đợi sức chứa và thông báo rõ.

### P1-06. Thưởng mùa: hạng hiển thị một kiểu, chốt thưởng một kiểu, và chốt kỳ đang mở

**Bằng chứng**
- Leaderboard tháng xếp bằng trung bình `(total + completed + total_votes)/3`, vote lấy theo `votes_received` trong tháng (`ranking.js`, `season.js`, `Leaderboard.jsx`).
- Live `settle_season_rewards` xếp theo `completed_count DESC, total_votes DESC, total_submitted DESC`; `total_votes` là tổng vote hiện tại của các request thuộc kỳ, không phải vote nhận trong kỳ.
- `settle_current_season_rewards` tính kỳ **hiện tại** theo giờ VN rồi gọi settle ngay.
- Nút Admin “Settle week/month” nằm ở Overview (`AdminPanel.jsx:1173-1184`); không có cron; `season_rewards_log` đang rỗng.
- UI podium tháng hứa +50/+30/+20 và +1 request bonus cho top 1 (`strings.js:762-764`).

**Hệ quả**
- Top 3 người dùng nhìn thấy có thể khác top 3 được trả thưởng.
- Bấm chốt giữa tuần/giữa tháng sẽ khóa kết quả sớm; lần chốt sau của cùng kỳ không thể trả lại cho cùng rank do unique constraint.
- Không có lịch sử chốt thưởng nào để đối soát.

**Hướng xử lý đề xuất**
- Dùng chung một hàm xếp hạng cho UI và settlement.
- Chỉ chốt kỳ đã đóng; thêm `period_key` của kỳ trước, cảnh báo nếu kỳ chưa kết thúc.
- Thêm cron hoặc quy trình vận hành bắt buộc sau khi đóng kỳ; ghi log và hiển thị trạng thái “đã chốt/chưa chốt”.

### P1-07. Ghi chú “private” của request vẫn đọc được qua API công khai

**Bằng chứng**
- RLS `requests` là `USING (true)`; column privilege cho `anon`/`authenticated` có `note`.
- `src/lib/db.js:562,569` select `note` cho mọi lượt tải board.
- UI admin gọi ô này là “Private note for admins” (`strings.js:1113`); form người gửi nói “Anything the editor should know”.
- Live có 4 request chứa note. Audit không đọc/nội dung hóa các note này.

**Hệ quả**
- Ẩn khỏi giao diện công khai không phải bảo mật; ai gọi PostgREST cũng đọc được `note`.
- Mâu thuẫn với nhãn “private”; `deny_reason` đã được xử lý riêng nhưng `note` thì chưa.

**Hướng xử lý đề xuất**
- Thu hồi quyền đọc `note` khỏi anon/authenticated thông thường; trả qua RPC owner/admin giống `deny_reason`.
- Hoặc đổi nhãn thành ghi chú công khai nếu đúng chủ ý.

### P1-08. CI browser thật trên `main` đang đỏ ở mục “Most voted”

**Bằng chứng**
- GitHub Actions run `43188670626`, commit `c1e2cf5`, job browser:
  - dist demo: 108/108 đạt.
  - edge: 128/128 đạt.
  - live: 121/122 đạt, hỏng đúng mục `live desktop: có phiếu trong 7 ngày thì hiện Most voted`.
- Annotation: `recent=14/1000 · cards=none · appVotes=1000 · computedTop=true · requestRows=40`.

**Nhận định**
- Đây không phải lỗi cài Playwright như audit cũ; browser đã chạy và chỉ mục live smoke hỏng.
- Giả thuyết “RPC bị cắt ở 1000 hàng làm mất Most voted” không giải thích được annotation này: app đã `computedTop=true`, RPC `votes_received` xếp newest-first, và repo có test hồi quy đúng tình huống cap 1000 (`src/lib/board.test.js:668-686`).
- `computedTop=true` nhưng `cards=none` là hai lát đọc DOM không khớp nhau. Khả năng gồm smoke đọc label trước khi React commit card, bundle live khác thời điểm kiểm, hoặc lỗi render chỉ xảy ra trên site thật. Chưa đủ bằng chứng để kết luận người dùng cuối không thấy card, và cũng chưa đủ để bỏ qua CI đỏ.

**Hướng xử lý đề xuất**
- Chạy `node tools/browserSmoke.mjs --live https://chaereve.pages.dev` trên máy có Chromium, lưu ảnh/video và đọc `weeklyLabels` + `weeklyData` trong cùng một `page.evaluate` để loại bỏ race giữa hai lát đọc.
- Nếu vẫn hỏng, kiểm tra điều kiện dựng `.weekly-card`, thời điểm `votesLog`/`rows` về, và đối chiếu bundle live với commit đang smoke.

### P2-01. Auto pick chọn một dòng, admin pick chọn cả cụm, vote-back trả theo dòng

**Bằng chứng**
- Live `pick_top_request` xếp theo tổng vote cụm nhưng chỉ `UPDATE ... WHERE id = r.id` một dòng.
- Live `admin_pick_group` update mọi dòng cùng artist/title đang queued/in_progress.
- Trigger `requests_vote_back_tri` chạy theo từng dòng đổi `picked_at`.
- Board gom cụm và cộng vote (`board.js:357-373`), nhưng vote-lock và vote-back theo từng request.

**Hệ quả**
- Khi có nhiều người cùng xin một bài, cron có thể pick một người; những dòng còn lại vẫn mở vote hoặc không được vote-back như kỳ vọng “một bài làm một lần”.
- Hiện live chưa có cụm open trùng nên chưa phát sinh dữ liệu xấu, nhưng cơ chế sẽ lệch khi tải tăng.

**Hướng xử lý đề xuất**
- Thống nhất đơn vị nghiệp vụ là `work_key`: cron pick cả cụm hoặc chọn một dòng đại diện rồi khóa vote toàn cụm.
- Vote-back nên quyết định rõ trả theo dòng hay theo bài; nếu theo bài, chia thưởng cho các requester/voter của cụm.

### P2-02. UI vẫn cho Unpick sau khi vote-back đã trả

**Bằng chứng**
- Live `admin_pick`/`admin_pick_group` từ chối unpick nếu `vote_back_paid_at IS NOT NULL` → `err.unpickLocked`.
- `AdminPanel.jsx:230-233` luôn hiện nút Unpick khi `picked`, không biết latch.
- `fetchRequests` không select `vote_back_paid_at`.

**Hệ quả**
- Admin bấm được nhưng server từ chối; bulk unpick có thể hỏng cả mẻ vì một dòng đã khóa.
- Khó quản lý: nút trông như thao tác hợp lệ nhưng thực tế bị cấm vĩnh viễn.

**Hướng xử lý đề xuất**
- Trả `vote_back_paid_at` hoặc cờ `can_unpick` cho admin; ẩn/disable nút và giải thích lý do.
- Bulk nên bỏ qua dòng khóa hoặc báo danh sách dòng không thể unpick trước khi chạy.

### P2-03. Hồ sơ công khai dùng badge/stat cũ, lệch với Achievements v3 và Leaderboard

**Bằng chứng**
- `PublicProfile.jsx:175-185` dựng badge bằng ngưỡng cứng: 1/5 request, 1/5 completed, 10 votes, streak 7/30.
- About me dùng catalog 52 mốc và `claim_achievements`; badge lưu trong `achievement_rewards`.
- `publicProfileShape` đếm số dòng request; leaderboard/achievement đếm work duy nhất theo artist/title.

**Hệ quả**
- Cùng một người có thể có badge khác nhau giữa hồ sơ công khai và About me.
- Số “requests/completed” trên hồ sơ có thể khác leaderboard khi có request trùng bài.

**Hướng xử lý đề xuất**
- Hồ sơ công khai đọc badge đã cấp từ server, không tự suy diễn ngưỡng cũ.
- Thống nhất đơn vị đếm: work duy nhất cho thưởng/xếp hạng, số dòng chỉ là “số lượt gửi”.

### P2-04. Sửa danh sách video không nguyên tử

**Bằng chứng**
- `App.jsx:2162-2199`: xóa trước, rồi update từng mục, thêm từng mục, cuối cùng reorder.
- `db.js:1858-1876`: `deleteMediaMany` chạy song song từng cụm 8, gặp lỗi thì throw nhưng các lời gọi khác trong cụm có thể đã thành công.
- Không có RPC “commit media list” một transaction.

**Hệ quả**
- Mạng lỗi giữa chừng có thể để danh sách video ở trạng thái nửa vời: đã xóa nhưng chưa thêm/reorder xong.
- Admin thấy lỗi nhưng không biết phần nào đã ghi.

**Hướng xử lý đề xuất**
- Thêm RPC nhận toàn bộ danh sách đích, so sánh và ghi trong một transaction.
- Hoặc ít nhất trả kết quả từng phần và nút “thử lại phần còn thiếu”.

### P2-05. Tab mua vote lấy nhầm đơn chờ của loại khác và nội dung chuyển khoản khó đối soát

**Bằng chứng**
- `ActionModal.jsx:856`: `pendingOrder = myOrders.find(o => o.status === 'awaiting')`, không lọc `kind === 'votes'`.
- `PaymentMethods` nhận số tiền từ `lastOrder`, có thể là đơn paid request $0.75 trong khi người dùng đang mua gói vote.
- `content={userName}`; QR không chứa order id. Đối soát doanh thu dựa vào tên người chuyển và admin bấm tay.

**Hệ quả**
- Hóa đơn mua vote có thể hiện số tiền của đơn paid request đang chờ.
- Nhiều đơn cùng tên/số tiền khó khớp; chuyển khoản thiếu/sai số vẫn phải xử lý thủ công.

**Hướng xử lý đề xuất**
- Chỉ lấy pending order đúng loại đang mua; sau khi tạo order mới, hiển thị đúng order đó.
- Nội dung chuyển khoản chứa mã ngắn duy nhất của order; admin có màn đối soát theo mã.

### P2-06. Cấu hình auth có nguy cơ nghẽn mail nếu dùng email/password

**Bằng chứng live**
- SMTP chưa cấu hình, `rate_limit_email_sent = 2/giờ`, autoconfirm tắt, signup mở.
- UI hiện chỉ đăng nhập Google; email/password vẫn bật ở tầng Auth.

**Hệ quả**
- Nếu người dùng đi qua luồng email/password hoặc recovery, mail xác nhận có thể nghẽn rất nhanh.
- Google OAuth không thay thế được nhu cầu recovery/email nếu sau này bật UI email.

**Hướng xử lý đề xuất**
- Hoặc tắt hẳn email/password nếu không dùng; hoặc cấu hình SMTP riêng, tăng rate limit hợp lý và kiểm thử luồng xác nhận/recovery.

### P3-01. Demo dùng ngày UTC, production dùng ngày Việt Nam

**Bằng chứng**
- `src/lib/db.js:118`: `today = () => new Date().toISOString().slice(0,10)` cho demo vote/request.
- Production RPC dùng `Asia/Ho_Chi_Minh`; daily login/spin demo đã dùng `spinDay` giờ VN.

**Hệ quả**
- Chế độ demo có thể reset free vote lệch 7 giờ so với production. Không ảnh hưởng tiền thưởng thật, nhưng làm test/demo thiếu nhất quán.

### P3-02. Doanh thu “đã nhận” tính theo ngày tạo đơn, không phải ngày duyệt

**Bằng chứng**
- `adminOrders.js:34-55` chỉ cộng đơn `paid` nhưng cửa sổ lọc theo `created_at`.
- Bảng `orders` không có `paid_at/processed_at`.

**Hệ quả**
- Đơn tạo tháng trước, duyệt tháng này vẫn bị loại khỏi “received in last 30 days”.
- Con số doanh thu gần đúng, không phải sổ cái thanh toán.

### P3-03. Giới hạn 20 đơn vote chờ không được nói trước khi bấm mua

**Bằng chứng**
- Live `buy_votes` chặn tối đa 20 đơn votes `awaiting` → `err.orderQueueLimit`.
- UI mua vote không hiển thị hạn này; chỉ hiện lỗi sau khi bấm.

**Hệ quả**
- Không phải lỗ hổng giá; giá đã được server đối soát chính xác. Nhưng UX gây bất ngờ và khó quản lý hàng chờ thanh toán.

## 4. Vấn đề đã đóng, không nên báo lại như lỗi hiện hành

| nghi vấn cũ | kết luận |
|---|---|
| Migration live thiếu chuỗi mới | Đã đủ tới `20261223_pick_pause`. |
| Giá mua vote do client quyết | Sai; live `buy_votes` đối soát giá chính xác từng gói/custom. |
| `firstPick` mất sau khi completed | Live `claim_achievements` bản 20261222 đã giữ bằng ledger/notification/admin_actions/badge cũ. |
| P0 CSS This week/Up next đè nhau | Đã bọc `.board-now`; CI live xác nhận không đè. |
| P0 body scroll kẹt | `html overflow-x:hidden`, `body overflow:visible`; CI live xác nhận cửa sổ cuộn được. |
| Quiz còn chạy | Đã retire runtime; `/quiz` chuyển hướng, RPC bị revoke. |
| Bulk admin request không nguyên tử | Live đã có `admin_*_many` một transaction; fallback per-id chỉ dùng khi thiếu RPC. |

## 5. Khoảng trống quản trị khó vận hành

Đây không hẳn là bug tức thời, nhưng làm hệ thống khó quản lý khi tải tăng:

1. **Không có trình sửa cấu hình thưởng/pick:** `reward_config`, `settings.pick.interval_days`, giá, hạn mức phải sửa SQL tay.
2. **Không có đối soát thanh toán/refund:** chưa có mã chuyển khoản, webhook, `paid_at`, refund, bằng chứng giao dịch.
3. **Không có quản lý user/role/ban:** admin chỉ sửa request/order/media; không có màn khóa tài khoản, cấp/thu admin, xem lịch sử ví.
4. **Không có deadline/assignee/sức chứa sản xuất:** Up next không nói ai làm, bao giờ xong; paid request dễ quá hứa.
5. **Không có health dashboard:** cron, gate, D1/KV, mail, realtime, migration drift chưa có một màn trạng thái chung.
6. **Tài liệu thưởng trộn lịch sử và hiện hành:** `DAILY-REWARDS.md` còn mục quiz/0 vote cũ; dễ vận hành nhầm nếu đọc một mục lẻ.

## 6. Thứ tự ưu tiên đề xuất

1. **Khóa chính sách ví thưởng:** P1-01 + P1-02. Quyết định spin trong/ngoài cap và reset nguồn nào; sửa ledger/cron/tài liệu cùng lúc.
2. **Khóa trạng thái tiền:** P1-04 + P1-05 + P2-05. Không cho `is_paid` đi trước sổ sách; sửa hứa hẹn paid; đối soát order bằng mã.
3. **Sửa thưởng mùa:** P1-06. Một luật xếp hạng, chỉ chốt kỳ đóng, có log.
4. **Sửa bảo mật note:** P1-07. Thu hồi đọc công khai hoặc đổi nhãn.
5. **Làm rõ Edge fallback:** P1-03. Hoặc bỏ fallback, hoặc thiết kế degraded an toàn; không giữ comment sai.
6. **Tái hiện và sửa CI live Most voted:** P1-08.
7. **Thống nhất cụm bài/vote-back/unpick:** P2-01 + P2-02.
8. **Các mục UX/đối soát còn lại:** P2-03, P2-04, P2-06, P3.

## 7. Bằng chứng chính trong repo

- `src/App.jsx`: load/realtime 1238-1327; derived weekly 1783-1796; handlers 1939-2262; media commit 2162-2199.
- `src/lib/db.js`: today 118; fetchRequests 548-595; fetchRecentVotes 650-686; spin fallback 838-941; castVote 1210-1346; admin edit/update 1455-1545; media 1783-1877.
- `src/lib/mysteryBox.js`: prize table 38-46; fallback 232-298.
- `src/lib/gateFallback.js`: chính sách fallback 19-41.
- `src/components/AdminPanel.jsx`: nút pick/unpick 230-233; sửa paid/note 266-280; settle season 1173-1184.
- `src/components/ActionModal.jsx`: mua vote/pending order 840-1003; paid copy 650-700.
- `src/components/PublicProfile.jsx`: badge cũ 175-185.
- `src/lib/achievementMetrics.js`: paid cần settled order 7-25; picked 33-40.
- `src/lib/ranking.js`, `src/lib/season.js`, `src/components/Leaderboard.jsx`: luật xếp hạng hiển thị.
- `worker/index.js`: callRpc thêm gate token 105-118; mystery route 258-275.
- `supabase/migrations/20261126_reward_ledger.sql`, `20261127_login_streak_rewards.sql`, `20261201_spin_v2.sql`, `20261210_vote_back.sql`, `20261222_achievement_pick_fix.sql`, `20261223_pick_pause.sql`.
- GitHub Actions run `43188670626` và annotation của job `131082165637`.


---

## Cập nhật lượt sửa 15/11/2026 — trọng tâm thanh toán

Đã sửa trong working tree (chưa apply DB, chưa deploy production):

- **P1-04 / P2 liên quan:** thêm `payment_source` (`money` / `bonus` / `legacy`) bằng migration `20261224_payment_source.sql`; request trả tiền phải có order `paid_request`, request dùng thưởng tiêu `bonus_requests` và không có order, mua vote vẫn là `orders.kind=votes`. Admin không còn bật/tắt `is_paid` tay; `admin_order` reject hạ `is_paid/payment_status/payment_source`.
- **P1-05:** copy không còn hứa “started immediately” / “skips the queue”; nói đúng là vào hàng chờ ưu tiên sau xác nhận thanh toán, hoặc dùng reward không cần trả tiền.
- **P2 BuyTab:** chỉ lấy đơn `kind=votes` làm hóa đơn mua vote; hiện số đơn chờ và chặn ở mốc 20; nội dung chuyển khoản có mã đối soát `V-…` / `PR-…`. Đơn paid request có khối thanh toán riêng trong About me → My orders.
- **Nhãn thống nhất:** `PAID · MONEY`, `PAID · REWARD`, `AWAITING PAYMENT`, `PAYMENT UNVERIFIED` cho hàng legacy chưa đủ bằng chứng; không đoán 9 request paid không order là bonus.
- **Kiểm chứng lại:** `npm test` 972 test / 928 pass / 44 skip integration / 0 fail; smoke 424/424; lint 0 error (15 warning nền); build, browser-compat, db:check, schema:split:check, test:migrate và test:payment-source:pglite đều đạt.
- **Chờ duyệt riêng:** áp migration `20261224_payment_source` lên Supabase production trước khi deploy frontend mới. Rollback và runbook đã ghi trong `docs/DB-MIGRATIONS.md`.

---

## Cập nhật lượt sửa 15/11/2026 — Giai đoạn 1 cải thiện payment

Đã làm trong working tree, **chưa apply DB / chưa deploy production**:

1. **Doanh thu theo ngày thu tiền:** thêm `paid_at/rejected_at/expired_at`; `orderStats` tính cửa sổ 30 ngày bằng `paid_at`, không dùng `created_at`. Đơn lịch sử chưa có ngày thu được đếm riêng, không đoán ngày thu.
2. **Hạn thanh toán 72 giờ:** `orders.expires_at`, trạng thái `expired`, cron `*/15` giải phóng hàng đợi 5/20; UI hiện “Pay within …h / Payment window ended”. Đơn đang chờ lúc deploy được gia hạn mới, không hết hạn hồi tố.
3. **Thông báo đơn:** approve/reject/expire ghi inbox `order_paid/order_rejected/order_expired`, chuông có nhóm Payments, bấm tin về My activity → My orders.
4. **Đối soát thủ công:** tab Orders tìm được mã `V-/PR-` đầy đủ; hộp Confirm payment bắt nhập phương thức, số tiền thực nhận và mã khớp trước khi gọi RPC; cảnh báo lệch tiền/mã và cảnh báo thanh toán muộn. CSV có thêm mốc thời gian, phương thức, tiền nhận, mã và lý do.
5. **An toàn tiền:** vẫn xác nhận thủ công, chưa webhook/PayPal Checkout; duyệt đơn khóa bằng `FOR UPDATE`, gọi lại không cộng credit lần hai; cron ghi nhật ký system vì không có `auth.uid()`.

Kiểm chứng: `npm test` 981 test / 937 pass / 44 skip / 0 fail; smoke 424/424; lint 0 error / 15 warning nền; build + browser-compat đạt; db:check 68 active; schema:split:check; test:migrate 25/25; payment-source và payment-operations PGlite đều đạt. Chờ duyệt riêng trước khi áp `20261224` → `20261225` rồi deploy frontend.

---

## Audit trước merge — kết quả cuối lượt 15/11/2026

Phạm vi lượt này: đọc toàn bộ diff payment đang chờ merge, đối chiếu lại Supabase production bằng truy vấn **chỉ đọc**, rồi chạy lại bộ kiểm chứng sau sửa. **Chưa commit/PR, chưa apply migration, chưa deploy, chưa merge.**

### lỗi phát hiện thêm và đã sửa trong working tree

1. **CI thiếu bộ kiểm payment + nguy cơ xanh giả:** `db-migration-safety.yml` chưa chạy `test:payment-source:pglite` / `test:payment-operations:pglite`; bước `npm test` cũ chỉ tin exit code, trong khi `node --test` có thể exit 0 dù TAP còn `# fail N`. Đã thêm hai bước PGlite và chặn theo TAP summary.
2. **Cron hết hạn bị ghi nhận như người thật:** `expire_payment_orders()` ghi `actor NULL`, nhưng `admin_actions_page` cũ coalesce mọi profile thiếu thành `Admin`. Đã sửa reader trả `System` cho actor NULL, rollback khôi phục reader cũ, PGlite kiểm đúng dòng nhật ký system.
3. **Client cũ gọi `admin_order(id, approve)` thiếu thông điệp xử lý được:** nhờ DEFAULT, lời gọi cũ vẫn resolve vào hàm mới nhưng trước đó rơi vào lỗi phương thức chung. Đã thêm `err.paymentEvidenceRequired` ở SQL + demo, không cộng credit, có test PGlite/demo và câu mời refresh/nhập biên lai.
4. **BuyTab giữ hóa đơn ma sau khi hủy đơn vừa tạo:** `picked` fallback về snapshot cũ dù đơn đã biến mất khỏi `myOrders`. Đã bỏ snapshot có id không còn tồn tại; smoke đi đường thật **tạo đơn vote → thấy mã đối soát → hủy → không còn mời trả tiền cho mã cũ**.
5. **Tin thanh toán chưa đưa tới đúng đơn:** trước đây chỉ đổi nhóm My orders, đơn ở trang phân trang sau không được mở/cuộn tới. Đã thêm `orderFocusLocation`, đặt đúng trang rồi scroll/focus hàng `mine-order-<id>`; có test thuần cho nhóm/trang.
6. **Realtime đơn mua vote không làm mới ví:** đơn `votes` paid không chạm bảng `requests`, nên đường realtime cũ chỉ tải lại orders, số dư vote có thể kẹt tới lần F5. `loadOrdersOnly` nay tải cả `fetchVoteStatus` với guard phiên/balance version; có test chốt đường dây.
7. **KPI/bộ lọc admin lệch badge khi đơn chạm hạn:** hàng chờ đếm `status='awaiting'` thô trong khi badge đã hiểu `expires_at`. Đã dùng cùng `orderDisplayStatus` + đồng hồ phút cho KPI/filter/search; đơn awaiting quá hạn không còn nằm trong “còn phải xử lý”.
8. **CSV có nguy cơ formula injection:** tên người mua/ghi chú bắt đầu bằng `=`, `+`, `-`, `@` có thể thành công thức khi mở Excel/Sheets. `csvCell` nay prefix apostrophe cho chuỗi nguy hiểm, giữ số âm thật; có test.
9. **PayPal.me không mang mã trong link + hủy đơn sau khi đã chuyển tiền:** thêm nhắc copy mã vào note PayPal trước khi gửi, và cảnh báo contact support trước khi hủy đơn. Không đổi cơ chế xác nhận thủ công.
10. **Phím tắt trang lọt sau hộp đối soát:** khi `OrderReviewDialog` mở, phím `/` có thể kéo focus ra ô tìm kiếm phía sau. Bộ bắt phím Admin nay im khi hộp đối soát mở.

### Đối chiếu live bổ sung (chỉ đọc)

- `20261224_payment_source` và `20261225_payment_operations` **chưa có** trong migration live; constraint `orders_status_check` vẫn 3 trạng thái, `notifications_kind_check` chưa có `order_*`, cron chưa có `ccl-expire-payment-orders`. Đúng trạng thái chờ duyệt, không phải drift âm thầm.
- Tiền kiểm cho migration: **0** request free lệch `payment_status`, **0** nhóm order paid_request sống trùng một request, **0** order paid_request sống mồ côi request. `orders` bật RLS, policy chỉ owner/admin đọc; `authenticated` chỉ có SELECT, không INSERT/UPDATE/DELETE trực tiếp.
- **9 paid request legacy không có order paid** vẫn là dữ liệu cần đối soát riêng: UI nay gắn `PAYMENT UNVERIFIED`, không đoán là bonus và không tính vào doanh thu có bằng chứng.
- Hai nghi vấn trong ghi chú audit trước đã được kiểm lại và **không phải bug cần sửa thêm**: (a) `adminLog.js` không thiếu nhãn lifecycle vì SQL không ghi `paid_at/rejected_at/expired_at` vào `detail` — nhật ký dùng `status/reason` + bằng chứng, CSV mới chứa mốc thời gian; (b) Worker/Pages Functions hiện không phải đường xử lý order, nên không cần nhắc `admin_order` trong worker.

### Kiểm chứng cuối sau sửa

| lệnh | kết quả |
|---|---|
| `npm test` | **986 tests · 942 pass · 44 skip · 0 fail** |
| `npm run smoke` | **427/427** (có tạo/hủy đơn vote và kiểm hóa đơn ma) |
| `npm run lint` | **0 error · 15 warning nền** |
| `npm run build` | đạt |
| `npm run check:browser-compat` | đạt |
| `npm run db:check` | **68 active · 1 quarantined**, không destructive/default-path, không post-baseline trong fresh install |
| `npm run schema:split:check` | đạt |
| `npm run test:migrate` | **25/25** |
| `npm run test:payment-source:pglite` | **1/1** |
| `npm run test:payment-operations:pglite` | **6/6** |
| `git diff --check` | sạch |

Log nền: `.cache/audit/premerge-final.log` (không đưa vào Git).

### Giới hạn và kết luận

- Sandbox vẫn **không có Chromium**; chưa chứng minh layout/CSS/WebSocket/OAuth/thanh toán thật bằng trình duyệt thật trong lượt này. Push nhánh/main sẽ kích hoạt `quiz-retirement-browser.yml`; live smoke production chỉ có ý nghĩa **sau** khi deploy đúng bundle + DB.
- Các mục P1/P2 **ngoài phạm vi payment** ở phần audit nền phía trên vẫn mở, không được coi là đã đóng bởi nhánh này.
- Kết luận cho nhánh payment: **các lỗi/regression phát hiện thêm đã sửa và bộ kiểm local xanh**. Điều kiện bắt buộc trước khi deploy frontend: duyệt backup/plan rồi apply **`20261224_payment_source` → `20261225_payment_operations`**, sau đó mới deploy frontend. Chưa merge/apply/deploy khi chưa có duyệt riêng.

---

## Rollout production 15/11/2026 — DB đã áp dụng, chờ merge/deploy frontend

Phần này cập nhật sau khi người vận hành duyệt chuỗi rollout. Các kết luận “chưa apply/chưa deploy” ở phần audit trước chỉ mô tả trạng thái trước lượt này.

1. **Backup đã giữ bền vững:** lượt `Sao lưu database` chạy lúc `2026-11-15T06:01:41Z`, dump public schema bằng `pg_dump 17.12`, phục hồi thử vào PostgreSQL 17 sạch và khớp **236 dòng fingerprint** (`7039` dòng dữ liệu, `538` object). Artifact GitHub mặc định chỉ giữ manifest/fingerprint; bản dump đã được mã hoá CMS (RSA-4096 + AES-256) và giữ trong Google Drive **chỉ chủ tài khoản truy cập**, khoá giải mã ở thư mục riêng tư tách biệt. Đường truyền ciphertext tạm qua nhánh đã được gỡ khỏi working tree trước merge; không đưa khoá hay bản rõ vào Git.
2. **Plan chỉ đọc:** sau khi chuẩn hoá tên history của migration cũ `20261218_votes_received_recent_first` (hàm live đã khớp body md5 `05dce38b…`, chỉ thiếu tên chuẩn trong `supabase_migrations.schema_migrations`), plan cuối còn đúng **2 migration pending**: `20261224_payment_source` → `20261225_payment_operations`.
3. **Đã áp dụng theo đúng thứ tự:** sandbox không có `SUPABASE_DB_URL`, nên dùng Supabase connector `create_migration` với tên đúng file repo, sau đó chuẩn hoá `version` history về đúng file stem để guarded runner không replay. Body đã áp dụng khớp repo sau khi bỏ newline cuối (`20261224`: `fe754ef4…`; `20261225`: `f2627a4a…`).
4. **Verify live sau apply:** đủ 9 cột lifecycle; `orders_status_check` có `expired`; CHECK resolution/evidence đúng; `admin_order(uuid,boolean,text,numeric,text,text)` là chữ ký duy nhất; `expire_payment_orders()` chỉ `service_role`/owner; cron `ccl-expire-payment-orders` job 7 active `*/15 * * * *`; notification kinds + trigger `orders_notify_resolution` có; `admin_actions_page` trả `System` cho actor NULL; orders vẫn RLS + client chỉ SELECT + realtime publication; ngày lịch sử paid/rejected không bị đoán; **0 conflict**, `27` orders, `40` requests (`money=1`, `legacy=9`, `none=30`). Gọi kiểm tra `expire_payment_orders()` trả `0` vì không có đơn chờ quá hạn. Health auth/db/pooler/realtime/rest/storage/pg_bouncer đều `ACTIVE_HEALTHY`.
5. **Frontend:** thêm edge marker `err.paymentEvidenceRequired` để chứng minh bundle mới đã lên CDN sau merge. Điều kiện cứng vẫn giữ: chỉ merge/deploy frontend sau khi DB đã verify như trên; live smoke production chạy sau deploy.

---

## Hotfix sau deploy 15/11/2026 — quyền đọc cột `payment_source`

Live smoke production sau merge PR #62 báo bảng public không tải (`requestRows=0`). Nguyên nhân thật: `public.requests` cấp SELECT **theo cột** cho `anon`/`authenticated` để giữ cột riêng tư; cột mới `payment_source` của `20261224` chưa được cấp quyền, nên client chọn cột này bị lỗi quyền đọc. Đã áp hotfix `20261226_payment_source_read_grant` chỉ cấp `SELECT (payment_source)` cho `anon`/`authenticated`, không đổi dữ liệu thanh toán và không mở cột riêng tư (`deny_reason` vẫn bị ẩn). History đã chuẩn hoá về đúng version repo.

Repo thêm migration/rollback tương ứng, mở rộng PGlite payment-source để khoá tình huống column-level grant (trước hotfix không đọc được, sau hotfix đọc được, cột riêng tư vẫn ẩn), và sửa live smoke chờ thẻ `Most voted` render thật thay vì đoán 200ms sau RPC vote. Kiểm tra targeted: payment-source PGlite 2/2, payment-operations PGlite 6/6, migration-safety 25/25, db:check 69 active, schema split đạt.
