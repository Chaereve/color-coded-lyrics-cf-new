# Backup / rollback runbook — BẢN KẾ HOẠCH, CHƯA THỰC THI

Không chạy block nào bên dưới trên production trong Phase 1. Không có `.sql` executable/migration mới trong PR preview. Chỉ DBA được duyệt mới thực hiện sau khi đối chiếu target; không gửi connection string hoặc data dump vào chat/Git.

## Evidence hiện có và giới hạn

- GitHub workflow `Sao lưu database` active, run [37239241360](https://github.com/Chaereve/color-coded-lyrics-cf-new/actions/runs/37239241360) ngày 2026-10-04 báo success.
- Artifact `db-backup-19`, 180736 bytes, API báo chưa expired; expires 2026-11-03T22:15:35Z. Chỉ đọc metadata, **không download data/không tự restore**. Không coi đó là backup đủ mới cho cutover tương lai.
- `scripts/backup-db.sh` dump public + auth.users riêng, rồi lấy fingerprint trong session khác: có thể lệch snapshot nếu đang ghi. Script xoá file backup cũ trong BACKUP_DIR; phải dùng thư mục timestamp mới mỗi lần, không chạy trên kho lưu trữ hiện hữu.
- `db-fingerprint.sql` so counts/tên objects, không chứng minh nội dung từng hàng, body function, RLS expression, ACL hay full auth recovery. `verify-backup.sh` không fail mọi restore error nếu counts khớp. Vì vậy PR3 cần restore drill bổ sung; không tắt backup cron chung.

## 1. Chốt scope live (read-only, trước khi viết SQL destructive)

DBA xác nhận project ID/host, môi trường, PostgreSQL major, migration history, deployed SHA; lưu output catalog ở kho hạn chế quyền, không repo. Đối chiếu 6 bảng ở inventory cùng mọi dependent object phát hiện thêm.

Ví dụ catalog SQL **chỉ đọc** (một phần checklist, chưa chạy):

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(), version(), current_user;
SELECT n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS owner, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND
 (c.relname LIKE 'daily_quiz_%' OR c.relname = 'daily_login_rewards');
SELECT * FROM information_schema.columns
WHERE table_schema = 'public' AND
 (table_name LIKE 'daily_quiz_%' OR table_name = 'daily_login_rewards')
ORDER BY table_name, ordinal_position;
SELECT * FROM pg_policies WHERE schemaname = 'public';
SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
SELECT * FROM pg_indexes WHERE schemaname = 'public';
SELECT tgrelid::regclass, tgname, pg_get_triggerdef(oid)
FROM pg_trigger WHERE NOT tgisinternal;
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner,
       p.proacl, p.proconfig, p.prosecdef, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f','p');
SELECT schemaname, viewname, definition FROM pg_views WHERE schemaname = 'public';
SELECT schemaname, matviewname, definition FROM pg_matviews WHERE schemaname = 'public';
SELECT pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent,
       pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) AS referenced,
       d.deptype
FROM pg_depend d
WHERE (d.refclassid = 'pg_class'::regclass AND d.refobjid IN (
 SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND (c.relname LIKE 'daily_quiz_%' OR c.relname='daily_login_rewards')
)) OR (d.refclassid='pg_proc'::regclass AND d.refobjid IN (
 SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'daily_quiz_%' OR p.proname LIKE 'daily_rewards_%')
));
SELECT extname FROM pg_extension ORDER BY extname;
-- Nếu pg_cron tồn tại: DBA đọc cron.job/job_run_details riêng (không public log).
-- Đọc pg_publication_tables, default ACLs và migration history table thực tế.
COMMIT;
```

Không thấy jobs trong source không chứng minh Dashboard không có cron, scheduled Edge Function hoặc importer ngoài repo. Phải kiểm tra Supabase Dashboard, Cloudflare Pages/Workers Triggers, GitHub workflows/artifacts, external scheduler và admin QA thủ công. Không thay setting trong lần xác minh.

## 2. Backup nhất quán và export tất cả quiz tables

- Freeze DDL/importer và retire quiz writers theo cutoff được duyệt trước dump cuối. Không freeze/xoá wallet history. Lập maintenance window và owner ký xác nhận.
- Dùng pg_dump cùng/compatible major production; `PGSERVICE`/pgpass secret file được provision ngoài repo, không đưa mật khẩu lên command line/log.
- Giữ session A `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();` mở tới khi dump **và mọi count/CSV** xong. Session B dùng `pg_dump --snapshot="$SNAPSHOT"`; session C `SET TRANSACTION SNAPSHOT` ngay sau BEGIN, trước query đầu tiên. Nếu snapshot mất thì bỏ bộ backup đó và làm lại.
- Dump toàn `public` format custom (kèm data, pre/post-data, indexes, functions, policies, ACLs; giữ owner manifest), vì table-only dump không tự bao đủ external dependencies. Export thêm auth prerequisites được phép; không giả định auth.users CSV khôi phục được toàn bộ Supabase Auth/Storage.

```sh
# PSEUDOCOMMANDS: DBA điền snapshot + thư mục MỚI, chưa chạy trong Phase 1.
# PGSERVICE=approved_source được cấu hình trong secret store, không trong repo.
pg_dump --format=custom --schema=public --snapshot="$SNAPSHOT" \
  --file="$NEW_ENCRYPTED_BACKUP_DIR/public.dump"
pg_restore --list "$NEW_ENCRYPTED_BACKUP_DIR/public.dump"
sha256sum "$NEW_ENCRYPTED_BACKUP_DIR/public.dump"
```

Trong session C (psql, client-side \copy để data không nằm trên DB server), xuất từng bảng, cùng snapshot:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- SET TRANSACTION SNAPSHOT '<snapshot từ session A>';
-- Đường dẫn dưới đây chỉ là ví dụ trong thư mục backup bảo mật MỚI.
\copy (SELECT * FROM public.daily_quiz_config ORDER BY key) TO 'daily_quiz_config.csv' CSV HEADER
\copy (SELECT * FROM public.daily_quiz_questions ORDER BY id) TO 'daily_quiz_questions.csv' CSV HEADER
\copy (SELECT * FROM public.daily_quiz_attempts ORDER BY user_id, quiz_day, id) TO 'daily_quiz_attempts.csv' CSV HEADER
\copy (SELECT * FROM public.daily_quiz_answers ORDER BY user_id, quiz_date, question_id) TO 'daily_quiz_answers.csv' CSV HEADER
\copy (SELECT * FROM public.daily_quiz_seen ORDER BY user_id, question_id) TO 'daily_quiz_seen.csv' CSV HEADER
\copy (SELECT * FROM public.daily_login_rewards ORDER BY user_id, reward_day) TO 'daily_login_rewards.csv' CSV HEADER
-- Tính count/hash từng CSV; totals reward theo ngày/user, duplicate checks.
COMMIT;
```

Sau PR1 cần backup thêm `daily_login_policies`, `daily_login_claims`, `daily_login_streaks`; public dump đã bao gồm chúng. Đối chiếu `profiles` purchased/bonus, `votes.credit_kind`, spin ledger, `activity_days`, `achievement_rewards`, season rewards ở cùng snapshot. CSV questions chứa generated column `correct_option_id`: **không COPY * trực tiếp khi restore**; dùng pg_restore hoặc list columns bỏ generated column.

Manifest bắt buộc: project/environment, DB version, source SHA, migration versions, snapshot time, row counts, sorted data hashes, reward sums, per-object definitions/owner/ACL, dump SHA256, backup ID/location, người kiểm chứng, restore timestamp và retention được duyệt. Encrypt at rest/in transit, hạn chế DBA, không public PR artifact có PII/answer keys. Giữ tối thiểu qua toàn bộ observation + rollback window; đề xuất 90 ngày cần owner duyệt. Không tự xoá artifacts cũ.

## 3. Restore drill — gate cứng trước PR3

1. Dựng **database/project throwaway trống**, allowlist rõ target ID, cấm source ID. Dựng auth/roles/extensions prerequisites từ schema thực tế (repo stubs chỉ phù hợp test, không thay production security).
2. Restore dump bằng `pg_restore --exit-on-error` theo pre-data → data → post-data; xử lý trước xung đột schema/extensions có giải thích, không bỏ qua lỗi chung chung.
3. So row counts **và hashes nội dung**, constraints/FK/index, generated columns, function full body, owner/search_path, EXECUTE/table grants, policies, triggers; kiểm tra read/claim với anon, account A/B và admin trên staging. So reward sums và wallet snapshot; không rerun grant.
4. Thử down/recovery của từng migration, dependency order không CASCADE, fresh-install/upgrade path và rollback sau đã có login claims mới. Ghi RTO thực đo; RPO mục tiêu 0 cho quiz sau freeze, không claim RPO=0 toàn site nếu vote tiếp tục thay đổi.
5. Nếu mất backup, hết retention, checksum lệch, còn unknown dependency hoặc restore fail: **NO-GO cleanup**.

## 4. Rollback SQL / cách phục hồi từng PR

### PR1 additive backend/UI

Trước mọi claim: có thể disable execute/new UI, giữ empty schema thay vì drop (down destructive vẫn cần duyệt). Sau có claim: tuyệt đối không chạy `bonus_credits = bonus_credits - sum(...)`, không delete ledger. User có thể đã tiêu votes; rollback kinh tế chỉ là audited compensation riêng có duyệt.

Ví dụ emergency containment SQL (template cho RPC **dự kiến**, không tồn tại ở Phase1):

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION public.claim_daily_login_votes(uuid,date,uuid)
  FROM PUBLIC, anon, authenticated;
-- Giữ status/history cho user và admin. Chờ inflight transaction hoàn tất,
-- kiểm tra audit/wallet; RPC revoke không huỷ request đang chạy.
COMMIT;
NOTIFY pgrst, 'reload schema';
```

Khôi phục frontend về release tương thích maintenance/read-only, không về client + policy cũ có thể phát thưởng khác. Resume chỉ sau fix+test, grant lại đúng authenticated, không PUBLIC. Quy trình planned maintenance lấy lock theo cùng thứ tự writer để drain, không đảo lock gây deadlock.

### PR2 retirement/routing

Revert UI/route riêng nếu cần; `/quiz` có thể giữ redirect. Không re-enable quiz thưởng tự động khi login đang active. Object definitions trước cutover + grants lưu trong backup; restore chúng trong transaction **sau khi** chọn policy cutover mới và ngăn hai cơ chế trả thưởng cùng ngày. Không sửa migration history để giả vờ PR2 chưa từng chạy.

### PR3 destructive cleanup

Rollback bằng restore selective, không phải đảo `DROP`. Artifact bắt buộc trước approval: `quiz-pre-data.sql`, `quiz-data.sql`, `quiz-post-data.sql`, `shared-functions-before.sql`, `owners-acls.sql` lấy từ **live backup đã restore thử**, không tự dựng từ baseline có thể lệch live.

```sql
-- Mẫu psql transaction, KHÔNG được copy-run thiếu artifacts đã review.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Assert các quiz objects vắng mặt và target đúng trước khi include.
\ir quiz-pre-data.sql
-- Tables restore parent trước child; self-FK questions ở post-data.
\ir quiz-data.sql
\ir quiz-post-data.sql
-- Chỉ shared functions thực sự cần phục hồi; mặc định vẫn giữ login cutover.
\ir shared-functions-before.sql
\ir owners-acls.sql
-- Run assertions counts/hash/FK/ACL trước COMMIT, abort nếu lệch.
COMMIT;
NOTIFY pgrst, 'reload schema';
```

Pre-data restore theo config/questions/attempts/seen trước answers; functions helper trước entrypoint. Không dùng `pg_restore --clean` lên public production, không restore profiles/votes/claims mới từ snapshot cũ. Restore quiz data không đồng nghĩa re-award hay bật quiz lại. Những user đã bị xoá hợp lệ sau backup cần policy restore FK/PII được duyệt, không hồi sinh account từ backup. Thực thi transaction này vẫn cần owner duyệt riêng.

## 5. Checklist production sau deploy được duyệt

- [ ] Deployed SHA, DB versions và Pages environment đúng; không preview trỏ nhầm production cho test write.
- [ ] New user / existing user / missing profile / signed out đúng state; cross-account data không lộ.
- [ ] Claim base/milestone/replay: một ledger, một wallet increment; purchased không đổi.
- [ ] Calendar tháng trước/hôm nay, timezone VN và rollover 17:00 UTC đúng; tab cũ không trả quiz.
- [ ] Vote cast/refund, spin, achievements, activity, leaderboard và admin không regression.
- [ ] `/quiz` deep link reload/back/forward redirect đúng; sitemap/canonical/header/footer không link quiz.
- [ ] Không console exception/failed RPC/permission error; rate/error/latency ổn, connection lock waits bình thường.
- [ ] Admin audit query owner-scoped cho user, admin kiểm role trusted; reward policy snapshot đủ.
- [ ] Backup mới chạy và restore được; không còn writer/read dependency quiz trước PR3.
- [ ] Owner ký nhận riêng từng rollout và cleanup; quan sát đề xuất ≥7 ngày + hai midnight rollovers (không thay thế test milestone day30).
