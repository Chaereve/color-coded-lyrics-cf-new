# Bàn giao B1–B4 — production 2026-10-10

Tài liệu này là bản chốt sau khi bốn batch migration đã apply trên
**database production**. Không rollback. Không còn migration pending.

Nhánh làm việc: `arena/6a19d183-color-coded-lyrics-cf-new`
HEAD tại lúc bàn giao: xem `git log -1` trên nhánh đó (commit docs + tắt
plan-on-push đi cùng file này).

---

## 1. Xác nhận lần cuối

| Hạng mục | Kết quả |
| --- | --- |
| `db:plan` production | **0 pending.** Bằng chứng: post-plan job B4 (run [38044695921](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38044695921)) — không còn dòng `apply YYYYMMDD`. `db:plan --until 20261210` và `db:plan` trần đều sạch. |
| `db:check` (tĩnh, không cần DB) | **OK — 50 active / 1 quarantined**, không destructive trên đường mặc định, fresh-install bundle dừng ở baseline `20261120`. Quarantine: `20261118_daily_login_no_votes` (rewrite lịch sử check-in — **cấm** chạy). |
| Workflow deploy B1–B4 | Push **đã tắt** (`DISABLED-after-b1` … `DISABLED-after-b4`). Không tự apply khi push tiếp. |
| Workflow `DB plan production` | Push **đã tắt** sau B4 (`DISABLED-after-b4`). Còn `workflow_dispatch` nếu cần plan chỉ-đọc sau này. |
| Workflow `Sao lưu database` | Push **vẫn tắt** (`DISABLED-during-b1-deploy`) — đúng ý. Cron trên nhánh mặc định `main` không bị file này đụng (workflow này chưa merge `main`). |
| Fingerprint mốc rollback **pre-B1** | sha256 `e38b601292845f927d59312504a5329203f3c9a9821f0f2442a337e52de3927e` |
| Dump pre-B1 | UTC `2026-10-10T09:11:51Z` · dump sha256 `b86a7c53f98e43f033fb71c6d4d246e84fc8be94024daafa14047b1381659eaa` · run [38040455054](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38040455054) |

Không đụng `.env`. Token cổng **không** in, **không** nằm trong `wrangler.jsonc` `vars`. Production = Cloudflare Pages Secret + GitHub Actions `secrets.EDGE_GATE_TOKEN` + `set_edge_gate_token` trên DB.

---

## 2. Odds Mystery Box v3 (chốt — không hỏi lại)

| Kết quả | Trọng số | Thưởng |
| --- | --- | --- |
| Trống | **70%** | — |
| +1 vote | **16%** | qua cap 30 |
| +3 votes | **8%** | qua cap 30 |
| +5 votes | **4%** | qua cap 30 |
| +10 votes | **1.5%** | qua cap 30 |
| +1 free paid request | **0.4%** | NGOÀI cap (`bonus_requests`) |
| +2 free paid requests | **0.1%** | NGOÀI cap (`bonus_requests`) |

File: `supabase/migrations/20261204_mystery_odds.sql`. UI **cấm** in `\d+%`.

---

## 3. Bảng B1–B4

### B1 — ledger + điểm danh trả vote + achievements v2

| | |
| --- | --- |
| Files | `20261126_reward_ledger.sql` · `20261127_login_streak_rewards.sql` · `20261128_achievements_v2.sql` |
| Code | SQL B1 nằm trong lịch sử git trước `f71f6ca` |
| Deploy | `--until 20261128` · commit `f71f6ca` · run **success** [38041279497](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38041279497) |
| Smoke | verify + smoke B1 trong cùng run (ledger, streak, catalog 20 active) |
| Live | Sổ cái `reward_events` + `grant_reward_event` (cap 30/ngày, scale-down, idempotent). Điểm danh: **+2**/ngày; ngày 7 chu kỳ **+5 thêm**; mốc 7/14/21/… **+10**; 30 ngày liên tiếp **+20 một lần**. Thành tựu **20 active / 5 nhóm** (Request, Vote, Paid, Streak, Đặc biệt). 25 mục cũ deactivate, không xoá. |

### B2 — Mystery Box (case reel) + paid v2 + lịch tháng + odds v3

| | |
| --- | --- |
| Files | `20261129_mystery_box.sql` · `20261202_mystery_paid_v2.sql` · `20261203_mystery_month.sql` · `20261204_mystery_odds.sql` |
| Code UI hộp | `e2a14bb` (hộp 3D không nơ, lịch sử tháng popup, odds v3 client) |
| Deploy | `--until 20261204 --except 20261201` · commit `6229809` · run [38042210783](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38042210783) — **apply xanh**, smoke **đỏ** (GitHub `EDGE_GATE_TOKEN` lúc đó thiếu/không khớp) |
| Smoke lại | commit `6c207e4` · **không `--apply`** · run **success** [38043497992](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38043497992) |
| Live | Trang `/mystery-box`, một hộp/ngày sau check-in cùng ngày VN, replay idempotent, khoá `err.mysteryLocked` nếu chưa điểm danh. |

### B3 — Daily Spin v2 (square grid 7 ô trọng số)

| | |
| --- | --- |
| File | `20261201_spin_v2.sql` |
| Deploy | `--until 20261201` · commit `da4373c` · run **success** [38044119389](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38044119389) |
| Bảng | prizes `[1,2,3,5,8,10,20]` · weights `[30,25,20,12,8,4,1]` (tổng 100) |
| Không đổi | hạn mức 2/device + 2/account + 2/fingerprint, luật không-lặp, ví `bonus_credits` |
| Live | `/daily-spin` — trung bình ~3,24 vote/lượt. |

### B4 — Vote-back 10% khi PICKED

| | |
| --- | --- |
| File | `20261210_vote_back.sql` |
| Code | B4.1 `4fe2ced` · B4.2 `7d96b81` (docs + `firstVoteBack` không double-count). **B4.3 (toast/inbox) BỎ** — payout không phụ thuộc UI. |
| Plan | commit `072742f` · run chỉ-đọc [38044473017](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38044473017) — đúng 1 file |
| Deploy | `--until 20261210` · commit `32f14bb` · run **success** [38044695921](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38044695921) |
| Smoke | 10% owner+1 / voter+1 · replay không cộng · `err.unpickLocked` · `err.voteLocked` · cap 30 owner clip · cap 50 tổng paid 35 · flag-off vẫn latch, không trả |
| Live | Trigger `requests_vote_back_tri` lúc `picked_at` NULL→NOT NULL. Latch `vote_back_paid_at` **không bao giờ xóa**. |

UI ví / buy / vote-all (không phải migration): commit `5cf165f`.

---

## 4. Feature đã live trên **database production**

| Feature | Đường | Ghi chú |
| --- | --- | --- |
| Daily login reward | `/daily-login` | +2 / ngày 7 +5 extra / mốc 7 +10 / mốc 30 +20 một lần. Cột `daily_login_rewards.reward` vẫn bất biến (=0 trên dòng mới); thưởng nằm ở ledger. |
| Achievements v2 | claim RPC | 20 active; vote qua ledger + cap; thành tựu bị cắt **tự bù** lần sau. |
| Mystery Box | `/mystery-box` | Case reel, một hộp/ngày, odds v3, lịch sử tháng = nút → popup (không lịch). |
| Daily Spin v2 | `/daily-spin` | 7 ô trọng số, square grid. |
| Vote-back 10% | lúc pick | Voter `greatest(1, floor(n/10))`; owner `floor(total/10)`; owner tự vote nhận **cả hai** nguồn ledger, badge `firstVoteBack` vẫn progress = 1. |

**Frontend:** SQL + UI nằm trên nhánh phiên, **chưa merge `main`**, **không có PR mở**. Nếu Cloudflare Pages production trỏ `main`, giao diện mới (hộp 3D, 4 ô ví, buy chọn-rồi-mua, vote/take-back all) **chưa** lên Pages production — RPC/odds/vote-back **đã** chạy phía DB. Merge + deploy Pages là bước vận hành tiếp theo, ngoài phạm vi apply B1–B4.

---

## 5. Anti-abuse (đang bật)

| Lớp | Luật |
| --- | --- |
| Cap 30 vote thưởng / người / ngày VN | `grant_reward_event` — login + spin + mystery vote + vote-back + achievement. Phần clip **mất** (trừ achievement tự bù). NGOÀI cap: vote mua, free 3/ngày, `bonus_requests`, thưởng mùa admin. |
| Cap 50 vote-back / request | Owner giữ trước (tối đa 50), voter chia phần còn theo largest-remainder. Clip **mất**. |
| Latch vote-back | `vote_back_paid_at` set cùng transaction pick đầu, kể cả trả 0. Unpick **không** xóa. Pick lại = 0. |
| Idempotency | Ledger `UNIQUE (source, user_id, day, ref)`. Mystery PK `(user_id, day)`. Replay / unpick+re-pick không cộng. |
| Khóa sau pick | `err.unpickLocked` · `err.voteLocked` (không rút phiếu gốc sau khi đã hoàn). |
| Flag rollback mềm | Tắt cờ → **không** trả thưởng. Vote-back: **vẫn set latch** (không truy thu khi bật lại). Mystery/login: RPC/trang báo tắt. |
| Cổng Edge | `p_gate_token` phải khớp `EDGE_GATE_TOKEN`. **Không tắt** `edge_gate` để “sửa smoke”. |

---

## 6. Vận hành

### 6.1 Bật / tắt feature flag

Chỉ SQL (owner / SQL Editor). Không có đường client. Không commit giá trị vào git.

```sql
-- xem
select key, value, updated_at from public.reward_config order by key;

-- tắt vote-back (vẫn latch, không trả, không truy thu khi bật lại)
update public.reward_config
   set value = 'false'::jsonb, updated_at = clock_timestamp()
 where key = 'vote_back_enabled';

-- tắt mystery box
update public.reward_config
   set value = 'false'::jsonb, updated_at = clock_timestamp()
 where key = 'mystery_box_enabled';

-- tắt thưởng điểm danh (lịch vẫn ghi ngày)
update public.reward_config
   set value = 'false'::jsonb, updated_at = clock_timestamp()
 where key = 'login_rewards_enabled';

-- bật lại: 'true'::jsonb
-- đổi cap ngày (mặc định 30):
update public.reward_config
   set value = '30'::jsonb, updated_at = clock_timestamp()
 where key = 'daily_reward_cap';
```

Cờ số khác (B1): `login_daily_votes`, `login_day7_extra`, `login_milestone7_bonus`, `login_milestone30_bonus`.

Spin v2 **không** có flag riêng — rollback SQL nếu cần trả bảng cũ.

### 6.2 Rollback từng batch (SQL, không claw-back ví)

Luôn **ngược thứ tự apply**. Mỗi file có preflight: từ chối nếu còn grant trong ~48 giờ (hoặc ledger đã có hàng — B1/26). **Không** xóa `reward_events`. **Không** thu hồi vote đã vào ví.

Thứ tự:

1. `supabase/rollback/20261210_vote_back.sql` — B4 (đợi 48h sau grant vote-back; revert client `err.unpickLocked` trước).
2. `supabase/rollback/20261201_spin_v2.sql` — B3 (đợi 48h còn lượt quay; CHECK 8/10/20 giữ nếu ledger đã có giải đó).
3. B2 ngược: `20261204_mystery_odds.sql` → `20261203_mystery_month.sql` → `20261202_mystery_paid_v2.sql` (từ chối nếu còn row result 6 `free_paid_request`) → `20261129_mystery_box.sql`.
4. B1 ngược: `20261128_achievements_v2.sql` → `20261127_login_streak_rewards.sql` → `20261126_reward_ledger.sql` (26 từ chối nếu ledger **không rỗng**).

Lỗi giữa chừng / smoke đỏ: **DỪNG, không tự rollback** — đúng quy tắc đã duyệt.

### 6.3 Rollback toàn DB về pre-B1

Chỉ khi owner duyệt restore.

- Artifact / dump run [38040455054](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/38040455054)
- Fingerprint phải khớp `e38b601292845f927d59312504a5329203f3c9a9821f0f2442a337e52de3927e`
- Dump sha256 `b86a7c53f98e43f033fb71c6d4d246e84fc8be94024daafa14047b1381659eaa`
- Restore = **mất mọi dữ liệu sau 2026-10-10 09:11:51 UTC** (kể cả vote/request thật). Không làm nếu chỉ muốn tắt một feature — dùng flag.

### 6.4 Xoay `EDGE_GATE_TOKEN`

Ba chỗ **cùng một chuỗi** ≥ 32 ký tự. Không in token. Cloudflare Pages thường **không xem lại** secret đã lưu — lấy từ password manager hoặc xoay mới.

1. Sinh chuỗi mới.
2. Pages → Settings → Environment variables → `EDGE_GATE_TOKEN` (Secret) Production **và** Preview → Save → **Retry deployment** để cổng nhận token. Health `/api/daily-spin/health` → `"gate":true`.
3. GitHub repo → Settings → Secrets → `EDGE_GATE_TOKEN` (cùng chuỗi) — cần cho smoke CI sau này.
4. **Sau khi cổng đã có token mới**, SQL Editor:
   ```sql
   select public.set_edge_gate_token('<đúng chuỗi bước 2>');
   ```
5. **Không** `set_edge_gate_token(null)` trừ khẩn cấp (cổng sự cố, user bị `err.voteGate` / `err.spinGate`). Null = ai cầm anon key đi vòng được Turnstile.

Thứ tự bắt buộc: Pages secret **trước**, DB **sau**. Làm ngược → user thật bị gate error.

### 6.5 Lệnh kiểm tra (máy có `SUPABASE_DB_URL`)

```sh
npm run db:check                          # tĩnh, không cần DB
npm run db:plan                           # phải in up-to-date / 0 apply
npm run test:ledger:pglite
npm run test:mystery:pglite
npm run test:spinv2:pglite
npm run test:voteback:pglite
```

Deploy migration **cấm** `db:deploy` trần. Luôn `--until` (và `--except` nếu hold file).

---

## 7. Không còn việc dở (phạm vi B1–B4)

| Hạng mục | Trạng thái |
| --- | --- |
| Migration pending | Không. 50 active đã ghi history (kể cả 20261210). 1 quarantined không bao giờ chạy. |
| PR B1–B4 | Không có PR mở từ nhánh phiên. |
| TODO/FIXME trong code B1–B4 | Không. (Chuỗi `WIP` trong `weekRecap.test.js` là fixture bài hát, không phải việc dở.) |
| Docs trạng thái “chưa apply” | Đã sửa `docs/DAILY-REWARDS.md`, `docs/DB-MIGRATIONS.md`, `docs/UI-POLISH-2026-10.md`. Luật đầy đủ: `docs/DAILY-REWARDS.md` + mục 20261126–20261210 trong `docs/DB-MIGRATIONS.md`. |
| Workflow deploy/plan/backup trên nhánh phiên | Đều DISABLED push. |
| B4.3 toast/inbox | **Cố ý bỏ** — không phải thiếu. |

**Ngoài phạm vi B1–B4 (ghi nhận, không làm trong bàn giao này):**

- Merge nhánh phiên → `main` rồi deploy Cloudflare Pages nếu muốn UI mới lên production web.
- Bật lại cron backup trên `main` nếu muốn dump hằng ngày (workflow backup hiện **chưa** nằm trên `main` từ nhánh này).
- Restore drill từ artifact pre-B1 — chưa chạy.

---

## 8. Commits neo

| SHA | Việc |
| --- | --- |
| `e2a14bb` | Daily Box 3D, odds v3 UI, lịch sử tháng popup |
| `5cf165f` | 4 ô ví, buy chọn-rồi-mua, Vote all / Take back all |
| `4fe2ced` | B4.1 SQL + PGlite |
| `7d96b81` | B4.2 docs + firstVoteBack |
| `f71f6ca` | Deploy B1 |
| `6229809` | Deploy B2 (apply) |
| `6c207e4` | Smoke B2 lại |
| `da4373c` | Deploy B3 |
| `32f14bb` | Deploy B4 |
| `e0df067` | Tắt B4 deploy-on-push |

Rollback SQL: `supabase/rollback/20261126_*.sql` … `20261210_vote_back.sql`.
Smoke/verify: `scripts/verify-b{1,2,3,4}-post-deploy.sql`, `scripts/smoke-b{1,2,3,4}.sql`.
)
