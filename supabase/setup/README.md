# Cài Supabase khi `schema.sql` quá dài cho SQL Editor

`supabase/schema.sql` là **bản SQL gộp (khoảng 240 KiB)**, gồm schema gốc và nhiều bản vá theo thứ tự. Kích thước này là **kích thước câu lệnh để dán vào Dashboard**, không phải dung lượng database/bảng đã đầy. Nếu nút **Save** trong SQL Editor báo lỗi, lưu ý: **Save chỉ lưu bản nháp query; phải bấm Run để áp dụng SQL vào database. Không cần bấm Save.** Nếu Run báo lỗi, nguyên nhân có thể *khác* kích thước file — xem thông báo lỗi cụ thể.

## Chọn đúng trường hợp

- **Đã có database đang dùng / có dữ liệu:** **KHÔNG chạy các file `01`–`17`, cũng không chạy lại `schema.sql`**. Sao lưu trước (`npm run backup:db` theo `HUONG-DAN.md`), xác định phiên bản đã cài, rồi chạy **chỉ những file còn thiếu** trong `supabase/migrations/`, theo thứ tự phụ thuộc. Không chạy cả thư mục migrations một cách mù quáng. Nếu không rõ bước nào đã chạy, gửi thông báo lỗi Supabase và trạng thái database để xác định migration cần dùng.
- **Project Supabase mới, chưa cài app:** Làm các bước bên dưới. Trước khi chạy, kiểm tra bằng query nhỏ này trong **Database → SQL Editor → New query → Run**:

```sql
select to_regclass('public.profiles') is null
   and to_regclass('public.requests') is null
   and to_regclass('public.daily_spins') is null
   and to_regclass('public.request_comments') is null as app_chua_cai;
```

Chỉ tiếp tục nếu `app_chua_cai = true`. Nếu đã chạy lỗi một phần của `schema.sql` thì đừng xoá bảng/tiếp tục đoán mò: ghi lại lỗi gốc và hỏi cách khôi phục phần đang dở.

## DB mới: chạy từng file nhỏ, theo đúng thứ tự

Mở **New query**, copy **toàn bộ nội dung đúng MỘT file** từ danh sách sau vào SQL Editor, bấm **Run** và chờ báo thành công **trước khi** mở query kế tiếp. Không cần bấm Save; đừng chọn chạy riêng một phần của file. Các khối `BEGIN/COMMIT` và `$$…$$` đều đã nằm trọn trong từng file; **không cắt file tuỳ ý**. Dừng ngay nếu có lỗi, đừng chạy tiếp file sau.

| Bước | File (trong thư mục này) | Cỡ gần đúng |
| --- | --- | ---: |
| 1 | `01-core-requests.sql` | 23 KB |
| 2 | `02-pick-media.sql` | 19 KB |
| 3 | `03-daily-spin.sql` | 24 KB |
| 4 | `04-spin-quota-rls.sql` | 16 KB |
| 5 | `05-vote-hardening.sql` | 31 KB |
| 6 | `06-watch-comments-streak.sql` | 25 KB |
| 7 | `07-security-audit.sql` | 30 KB |
| 8 | `08-comments-activity.sql` | 24 KB |
| 9 | `09-funnel-events.sql` | 10 KB |
| 10 | `10-daily-rewards.sql` | 24 KB |
| 11 | `11-daily-rewards-upgrade.sql` | 23 KB |
| 12 | `12-daily-quiz-schema.sql` | 15 KB |
| 13 | `13-daily-quiz-pool.sql` | 16 KB |
| 14 | `14-daily-quiz-flow.sql` | 19 KB |
| 15 | `15-daily-login-no-votes.sql` | 11 KB |
| 16 | `16-preserve-legacy-daily-login-rewards.sql` | 12 KB |
| 17 | `17-daily-login-reward-immutable.sql` | 4 KB |

Bước 15–17 là bản sửa chính sách điểm danh (append-only): điểm danh hằng ngày **không** thưởng vote; chỉ quiz K-pop mới thưởng (1 câu đúng = 1 vote, tối đa 5/ngày).

> **Bước 15 (`15-daily-login-no-votes.sql`, migration `20261118`) đã BỊ THAY THẾ — không dùng cho production.** Nó chạy `UPDATE daily_login_rewards SET reward = 0` trên toàn bảng (viết lại lịch sử) và thêm `CHECK (reward = 0)`. Nó chỉ còn ở đây để tương thích với project nào đã lỡ chạy; **bước 16 và 17 sửa lại đúng trạng thái đó trước khi đưa vào dùng**: 16 bỏ ràng buộc toàn bảng và không đụng vào dòng lịch sử nào, 17 khoá luôn giá trị đã ghi (không cho sửa `2 → 0` hay chiều ngược lại). Cả hai đều append-only và chạy được sau 15.

Không trừ vote đã cấp ở bất kỳ bước nào.

Sau bước 17, kiểm tra các bảng/RPC/chính sách quan trọng (tất cả phải là `true`):

```sql
select to_regclass('public.requests') is not null as requests_ok,
       to_regclass('public.daily_spins') is not null as spins_ok,
       to_regclass('public.request_comments') is not null as comments_ok,
       to_regclass('public.activity_days') is not null as activity_ok,
       to_regclass('public.achievement_rewards') is not null as achievements_ok,
       to_regprocedure('public.spin_daily(text,uuid,uuid,text,text,text)') is not null as spin_rpc_ok,
       to_regprocedure('public.touch_my_activity()') is not null as visit_rpc_ok,
       to_regprocedure('public.my_daily_rewards_status()') is not null as daily_rewards_ok,
       to_regprocedure('public.submit_daily_quiz_answer(uuid,uuid,text,text)') is not null as quiz_rpc_ok,
       to_regclass('public.daily_quiz_answers') is not null as quiz_answers_ok,
       to_regclass('public.daily_quiz_seen') is not null as quiz_seen_ok,
       (select count(*) = 0 from pg_constraint
         where conrelid = 'public.daily_login_rewards'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%reward%') as login_no_table_check_ok,
       exists (select 1 from pg_trigger where tgrelid = 'public.daily_login_rewards'::regclass
               and tgname = 'daily_login_rewards_no_vote') as login_trigger_ok,
       exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'votes'
                 and policyname = 'read own votes') as votes_rls_ok;
```

Nếu SQL Editor vẫn từ chối ngay cả một file nhỏ trên **DB mới**, có thể chạy bản gộp *từ máy của bạn* bằng PostgreSQL client `psql` với **Session pooler / SSL** lấy ở Supabase → **Connect** (không dán URL/mật khẩu vào chat hoặc commit):

```sh
# Chỉ dùng cho project MỚI, sau khi đã xác nhận app_chua_cai = true.
# SUPABASE_DB_URL được cấu hình riêng trên máy của bạn; tuyệt đối không commit.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

Lệnh trên **không** dùng `--single-transaction`: bản gộp đã có các cặp `BEGIN/COMMIT` của các migration. Nếu thấy lỗi, dừng và lấy nguyên văn thông báo lỗi; đừng thử chạy cả file lại trên production.

## Giữ các file nhỏ đồng bộ

Các file `01`–`14` được **cắt nguyên văn từ `supabase/schema.sql`**; ghép lại theo thứ tự khôi phục đúng từng byte của bản gộp. Khi sửa schema, chạy `npm run schema:split`, sau đó `npm run schema:split:check` và `npm test` trước khi đưa lên repo. Không chỉnh SQL trong các file nhỏ bằng tay.
