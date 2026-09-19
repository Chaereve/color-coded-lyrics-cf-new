# Bước thủ công cần làm — sau khi merge PR #5 (vòng 17)

Bản vừa merge **chỉ đổi phần nhìn của frontend** (thanh lọc, thanh tiến độ, tài liệu). Kiểm
chứng bằng `git diff --name-only 79d7b18 47ed7e4` — 9 file, **không có file nào** trong
`supabase/`, `functions/`, `worker/` hay `.env`. Nên câu trả lời ngắn cho *"bản này cần chạy
SQL gì?"* là: **không có file SQL nào mới**.

Phần dưới là danh sách việc làm tay còn lại của **dự án thật**, xếp theo đúng thứ tự. Thứ tự
quan trọng thật: làm ngược là khoá luôn nút Spin/Vote của người dùng.

| # | Việc | Ai làm | Mất bao lâu |
|---|---|---|---|
| 1 | Chạy 3 migration còn thiếu (nếu chưa) | bạn, Supabase SQL Editor | 3–5 phút |
| 2 | KV `SPIN_SHIELD` + biến/secret trên Pages | bạn, Cloudflare Dashboard | 5 phút |
| 3 | Bật cổng `edge_gate` (bước cuối) | bạn + 1 câu SQL | 5 phút |
| 4 | Đặt secret cho job sao lưu | bạn, GitHub repo → Settings | 2 phút |
| 5 | Mở app ngó 4 chỗ vừa sửa | bạn | 30 giây |

---

## 0. Vì sao đợt trước dán `schema.sql` bị lag — và lần này sẽ không

`schema.sql` là **2808 dòng**, có **16 lệnh `create index`** và rất nhiều `alter table`. Dán
cả file vào SQL Editor nghĩa là **một** query khổng lồ: editor phải parse, gửi, dựng kế hoạch
cho toàn bộ, rồi mới trả về — treo là chuyện bình thường, không phải máy bạn yếu.

Ba điều rút ra, đúng cho từ giờ:

1. **Không bao giờ cần dán lại `schema.sql`.** Mọi file trong `supabase/` viết kiểu
   `create or replace` / `add column if not exists` / `create index if not exists` → chạy lại
   vô hại, và **không cần chạy lại file cũ để chạy được file mới**.
2. **Mỗi file một tab riêng.** Dán file 1 → `Run` → đợi chữ *Success* → mở tab mới cho file 2.
   Đừng gộp nhiều file vào một tab: vừa dễ treo, vừa không biết file nào lỗi.
3. **Ba file mới nhất đều là một transaction trọn vẹn** (`begin;` … `commit;`): file
   20261103 chỉ 667 dòng (nhỏ hơn `schema.sql` 4 lần), 20261104 là 164 dòng, 20261105 là 41
   dòng. Nếu giữa chừng có treo/lỗi thì **không có gì được ghi** — chạy lại là xong, không bao
   giờ rơi vào trạng thái nửa vời.

> Đừng cắt một file ra làm nhiều lần chạy. Cắt là mất cặp `begin;`/`commit;` — transaction mở
> mà không đóng sẽ giữ khoá bảng, lần sau chạy tiếp dễ lỗi hơn cả lúc đầu.

---

## 1. SQL — chạy theo đúng thứ tự này (mỗi file một tab)

### 1.0. Trước tiên: biết mình đang thiếu gì (1 câu, ~2 giây)

Dán vào SQL Editor:

```sql
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='profiles' and column_name='bonus_credits')  as bonus_credits,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='votes' and column_name='fp_slot')           as votes_fp_slot,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='daily_spins' and column_name='fp_slot')     as spins_fp_slot,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='edge_gate_ok')                                  as co_cong_gate,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='admin_review' and p.pronargs = 4)               as review_kem_link;
```

Kết quả `1` ở cột nào = phần đó đã có sẵn. Cách đọc:

| Cột | `1` nghĩa là | `0` thì chạy |
|---|---|---|
| `bonus_credits` | đã tách ví vote mua / bonus vòng quay | `20261031_bonus_reset.sql` |
| `votes_fp_slot` | đã siết vote theo vân tay | `20261103_vote_hardening.sql` |
| `spins_fp_slot` | đã chốt hạn mức quay trong Postgres | `20261102_spin_fp_quota.sql` |
| `co_cong_gate` | cổng `edge_gate` đã tồn tại | `20261103_vote_hardening.sql` |
| `review_kem_link` | hộp thoại Từ chối kèm được link video cũ | `20261105_desktop_review_media.sql` |

Nếu app hôm nay vẫn chạy bình thường thì gần như chắc chắn đã `1` ở ba cột đầu — chỉ còn hai
cột cuối là của đợt này.

### 1.1. Ba file cần chạy, theo thứ tự

Mỗi file: **Supabase → SQL Editor → New query → dán cả file → Run**.

| Thứ tự | File | Dòng | Việc nó làm | Kiểm tra sau khi chạy |
|---|---|---|---|---|
| 1 | `supabase/migrations/20261102_spin_fp_quota.sql` | 168 | hạn mức quay 2 lượt/ngày theo **vân tay** nằm trong Postgres — gọi thẳng RPC cũng bị chặn | cột `spins_fp_slot` = 1 |
| 2 | `supabase/migrations/20261103_vote_hardening.sql` | 667 | siết vote (khoá hàng, hạn mức vân tay, hoàn đúng ví) **và tạo cổng `edge_gate`** | `select * from public.edge_gate;` → đúng **1 dòng**, `token_hash` **null** |
| 3 | `supabase/migrations/20261104_spin_streak.sql` | 164 | vòng quay **không ra cùng một ô thưởng 2 lượt liên tiếp** trên cùng thiết bị | không có gì để xem — chạy xong là đủ |
| 4 | `supabase/migrations/20261105_desktop_review_media.sql` | 41 | `admin_review` nhận thêm `p_video_url`: Từ chối request vẫn kèm được link video có sẵn | cột `review_kem_link` = 1 |

Ghi chú:

- File nào đã chạy rồi thì **bỏ qua**; chạy lại cũng không sao (chỉ ghi đè hàm, không mất dữ liệu).
- File 1 **phải trước** file 2: hàm `spin_daily` bản mới có ghi cột `fp_slot` mà chỉ file 1 tạo
  ra. Chạy ngược thì tới lúc quay mới lỗi, chứ SQL Editor vẫn báo Success.
- File 4 bắt đầu bằng `drop function if exists` rồi `create` lại — cố tình như vậy, chạy lại
  vẫn an toàn.
- **Chưa chạy `20261103` thì chưa được bật cổng ở mục 3**: hàm `cast_vote`/`spin_daily` bản mới
  chưa tồn tại, cổng gọi vào là lỗi.

### 1.2. Hai file cũ hơn (chỉ chạy nếu bảng trên báo `0`)

| File | Dòng | Việc nó làm | Chạy trước |
|---|---|---|---|
| `supabase/migrations/20261031_bonus_reset.sql` | 289 | tách `profiles.bonus_credits` khỏi `vote_credits` + reset bonus hằng năm | `20261101`, `20261102` |
| `supabase/migrations/20261101_vote_status_split.sql` | 83 | trả riêng vote đã mua và bonus vòng quay trong API | sau `20261031_bonus_reset` |

Cả hai file đã có trong `schema.sql` mới, nên ai chạy `schema.sql` sau ngày 01/11/2026 thì
không cần đụng tới.

**Tuỳ chọn, không bắt buộc:** file `20261031_bonus_reset` và `20260908_pick_cycle_fix` có lên
lịch `pg_cron`, nhưng cả hai đều tự kiểm tra `pg_cron` đã bật chưa rồi mới đặt lịch — không bật
vẫn chạy SQL được, chỉ là không có job tự động. Muốn kiểm tra: `select * from cron.job;` —
chạy được và thấy job `auto-pick-top` là đang bật; báo *relation "cron.job" does not exist* là
chưa bật (Supabase → **Database → Extensions → pg_cron**).

---

## 2. Cloudflare Pages — KV + biến (làm một lần, sau đó chỉ kiểm tra)

Chỉ cần làm nếu tới giờ bạn **chưa** bật lá chắn Edge. Cách biết chắc: xem mục 2.3.

### 2.1. Tạo KV namespace

Cloudflare Dashboard → **Workers & Pages → KV** (menu trái) → **Create a namespace** → tên
`SPIN_SHIELD` → **Add**.

### 2.2. Gắn binding + đặt biến

1. **Workers & Pages → tên project Pages → Settings → Bindings → KV namespaces → Add binding**:
   *Variable name* `SPIN_SHIELD`, *Namespace* chọn namespace vừa tạo. Nhớ tick **cả
   Production lẫn Preview** → **Save**.
2. **Settings → Environment variables** (bản dashboard mới ghi *Variables and Secrets*) →
   **Add variables**, mỗi biến cũng tick **cả Production lẫn Preview**:

| Tên | Loại | Lấy ở đâu |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Secret | Cloudflare → Turnstile → widget của site → **Secret key** (khác Site key công khai trong `.env`) |
| `SUPABASE_ANON_KEY` | Secret | Supabase → Settings → API Keys → khoá công khai |
| `SUPABASE_URL` | Plaintext | `https://<project-ref>.supabase.co` |

Thiếu binding/biến ở môi trường nào thì cổng ở môi trường đó trả 503 — app tự rơi về gọi thẳng
RPC, không chết nút, nhưng lá chắn coi như chưa bật.

### 2.3. Bắt buộc phải thấy JSON này trước khi sang mục 3

Đổi biến xong, vào **Deployments → ⋯ ở bản mới nhất → Retry deployment** (không deploy lại thì
cổng vẫn chạy cấu hình cũ), rồi mở:

```
https://<domain-thật>/api/daily-spin/health
```

| Thấy | Nghĩa là | Làm gì |
|---|---|---|
| `{"ok":true,"shield":true,"gate":false}` | đạt — KV + biến đã nhận, cổng chưa bật (đúng ở bước này) | sang mục 3 |
| `{"ok":true,"shield":false,...}` | thiếu KV binding hoặc `SUPABASE_URL` | quay lại 2.1–2.2, nhớ tick **cả** Production và Preview rồi Retry deployment |
| **HTML của trang web** | Functions chưa chạy (deploy thiếu `functions/` hoặc mất `_routes.json`) | **tuyệt đối chưa sang mục 3** — xem mục gỡ rối trong `HUONG-DAN.md` |

`"gate":false` ở bước này là **đúng**: cổng là việc cuối cùng.

---

## 3. Cổng `edge_gate` — bước cuối cùng (chỉ khi mục 2 đã xanh)

Cổng là thứ làm Turnstile + KV có giá trị thật: anon key nằm công khai trong bundle nên ai cũng
gọi thẳng PostgREST được, trừ khi database từ chối mọi lời gọi không đi qua cổng. Làm **đúng
thứ tự hai bước**, và chỉ sau khi bạn đã thử quay + vote thật một lượt qua cổng.

**Bước 1 — Pages có token trước.** Settings → Environment variables → thêm `EDGE_GATE_TOKEN`,
loại **Secret**, giá trị là chuỗi ngẫu nhiên **≥ 32 ký tự**, tick cả Production lẫn Preview →
Save → **Retry deployment**. Kiểm tra `/api/daily-spin/health` → `"gate":true`.

**Bước 2 — database bật sau** (SQL Editor):

```sql
select public.set_edge_gate_token('<đúng chuỗi ở bước 1>');
```

**Trỏ app vào cổng** (làm giữa bước 1 và 2, sau khi health đã xanh): thêm hai biến build
**Plaintext**, tick cả hai môi trường → **deploy lại** (biến `VITE_*` được nướng vào bundle lúc
build, thêm mà không build lại thì app vẫn gọi đường cũ):

```
VITE_SPIN_GATE_URL=/api/daily-spin
VITE_VOTE_GATE_URL=/api/vote
```

Thêm hai biến này **sớm**, khi health còn chưa trả JSON, là hỏng ngay nút Spin/Vote — app sẽ
gọi vào một cổng chưa tồn tại.

**Tắt khẩn cấp** (người thật bị khoá, hoặc cổng đang sự cố) — chạy một câu, hiệu lực ngay,
không cần động vào Pages:

```sql
select public.set_edge_gate_token(null);
```

Chưa đặt token = cổng **tắt**, mọi thứ chạy y như trước. Còn bật token ở database trước khi
Pages có token thì người dùng thật nhận `err.voteGate` / `err.spinGate`.

---

## 4. Sao lưu — việc dọn dẹp sau merge (2 phút)

Gói free của Supabase **không có backup tự động**: workflow `.github/workflows/backup-db.yml`
là bản sao duy nhất. Nó chạy **19:00 UTC = 02:00 giờ VN** mỗi ngày, và không chỉ copy file: nó
đổ bản dump vào một Postgres sạch rồi so dấu vân tay (số dòng từng bảng, function, policy,
trigger) — lệch một dòng là job đỏ.

- Repo → **Settings → Secrets and variables → Actions → New repository secret**:
  tên `SUPABASE_DB_URL`, giá trị là **chuỗi Session pooler, cổng 5432** (Supabase → Connect).
  Chưa đặt secret này thì job đỏ ngay ở bước dump.
- Giữ bản sao **lâu hơn 30 ngày** là tuỳ chọn: thêm 4 secret `R2_BUCKET`, `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Cron chỉ chạy trên nhánh mặc định (`main`), nhưng bấm **Run workflow** tay được từ nhánh nào
  cũng chạy — dùng để thử ngay sau khi đặt secret.

---

## 5. Mở app ngó 4 chỗ vừa sửa (bản vừa merge)

1. **Dải chip lọc trên cùng** — vẫn **một hàng**, không xuống dòng; cửa sổ hẹp thì kéo ngang.
2. **Cuộn trang** — **không còn** thanh chạy trên đỉnh màn hình (đã bỏ hẳn, không phải lỗi tải).
3. **Tab Đang xử lý** — thanh tiến độ trong từng hàng nhỏ gọn: rãnh 4px, số tiến độ nhỏ hơn số
   cạnh nó; đưa chuột lên thấy chú thích *Layout 40% · Lyrics 40% · Edit 20%*.
4. **Lọc theo type** — không còn tím/hồng: *All types* là vòng rỗng, chip đang chọn ăn theo màu
   của type đó.

---

## 6. Bốn thứ **đừng** làm

- Đừng dán lại `supabase/schema.sql` — đây chính là chỗ gây lag lần trước, và không cần thiết.
- Đừng gộp nhiều file SQL vào một tab, và đừng cắt một file ra nhiều lần chạy (mất
  `begin;`/`commit;`).
- Đừng đặt `VITE_SPIN_GATE_URL` / `VITE_VOTE_GATE_URL` trước khi `/api/daily-spin/health` trả
  JSON `"shield":true`; đừng bật `set_edge_gate_token(...)` trước khi Pages có `EDGE_GATE_TOKEN`.
- Đừng xoá `public/_routes.json` (giữ Functions chỉ chạy ở `/api/*`) và đừng dán khoá
  `service_role` vào `.env` hay biến `VITE_*` — khoá đó bỏ qua mọi quy tắc bảo mật.
