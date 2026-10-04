# Hướng dẫn triển khai dành cho người không rành kỹ thuật

Tài liệu này dành cho **bạn**: người quản lý dự án, không cần biết SQL, không cần
gõ lệnh, không cần hiểu database. Mọi thứ ở đây viết theo dạng “cái gì → bấm gì
→ thấy gì → dừng lại khi nào”.

---

## 0. Đọc phần này trước (30 giây)

### 3 điều tuyệt đối không làm

1. **Không dán mật khẩu database, chuỗi kết nối (URL có dạng `postgres://…`),
   API key, service-role key hay bất kỳ mã bí mật nào** vào chat, vào comment
   GitHub, vào ảnh chụp màn hình, vào file gửi cho tôi, hay vào bất cứ nơi nào
   công khai. Không ai cần những thứ đó để giúp bạn ở bước này.
2. **Không tự chạy SQL lên database production đang có dữ liệu người dùng.**
   Phần database của đợt này **phải do developer chạy bằng quy trình có kiểm
   tra tự động**. Lý do ở mục 2.
3. **Không tự đoán trạng thái database.** Nếu kết quả kiểm tra không khớp y hệt
   mô tả → **DỪNG LẠI**, chụp màn hình, gửi cho developer. Không “thử tiếp”.

### Đợt này thay đổi cái gì (lời thường)

- **Điểm danh hằng ngày**: vẫn có lịch, vẫn có chuỗi ngày (streak), **nhưng
  không thưởng vote nữa**. Trước đây điểm danh cho +2 vote/ngày.
- **Quiz K-pop**: vẫn là cách **duy nhất** nhận vote thưởng: 5 câu/ngày,
  1 câu đúng = 1 vote, tối đa **5 vote/ngày**.
- **Dữ liệu cũ được giữ nguyên**: những ngày điểm danh cũ từng ghi “thưởng 2”
  thì vẫn ghi “2”. Không ai xoá, không ai sửa, không bị trừ vote đã cho.

### Ba tài liệu đi kèm

| Tài liệu | Dùng khi nào |
| --- | --- |
| `docs/NON_TECHNICAL_DEPLOYMENT_GUIDE_VI.md` (tài liệu này) | Trước khi merge, trước khi triển khai, khi cần quyết định GO / NO-GO |
| `docs/DEVELOPER_HANDOFF_VI.md` | Khi bạn gửi việc cho developer làm |
| `docs/POST_DEPLOY_VISUAL_CHECKLIST_VI.md` | Sau khi xong, để tự kiểm tra bằng mắt trên trình duyệt |

---

## 1. Bảng GO / NO-GO (điền bằng cách tick vào ô)

### 1.1. Khi nào **KHÔNG ĐƯỢC** merge PR #26

Tick nếu đúng — nếu **có bất kỳ ô nào được tick**, chưa merge:

- [ ] Tôi chưa đọc 3 điều “tuyệt đối không làm” ở mục 0.
- [ ] Trong PR có file/check chưa chạy xong (biểu tượng ❌ / “Some checks were
      not successful” / “failing”).
- [ ] Trong PR có comment của người review yêu cầu sửa mà chưa được giải quyết.
- [ ] Tôi thấy trong PR có nhắc đến migration **`20261118`** được đề nghị chạy.
      (Migration này **không bao giờ được chạy** — nó xoá dấu vết lịch sử.)
- [ ] Tôi (hoặc developer) **chưa có bản sao lưu (backup)** của database
      production, hoặc chưa chắc backup khôi phục được.
- [ ] Chưa có ai chạy thử trên **staging** (môi trường thử) — hoặc nếu không có
      staging, chưa có kế hoạch rõ ràng thay thế.
- [ ] Tôi không biết database production hiện đang ở trạng thái nào (kết quả
      kiểm tra ở mục 2.2 ra **E. KHÔNG RÕ** hoặc **D. CÓ DẤU HIỆU 20261118**).
- [ ] Đang trong giờ cao điểm của trang web và tôi không có thời gian theo dõi
      15–30 phút sau khi triển khai.

> Chỉ merge khi **không tick ô nào** ở trên **và** đã tick đủ các ô ở mục 1.4.

### 1.2. Cần kiểm tra gì trên GitHub trước khi merge

Mở PR: `https://github.com/Chaereve/color-coded-lyrics-cf-new/pull/26`
(thay đúng link nếu repository của bạn khác).

- [ ] Tab **Conversation**: không còn ý kiến “request changes” chưa xử lý.
- [ ] Tab **Checks** (hoặc biểu tượng ✓/❌ gần nút merge): tất cả đều xanh
      (“success”). Nếu có mục đỏ → không merge, báo developer.
- [ ] Tab **Files changed**: có các nhóm file sau (tên file lạ cũng không sao,
      nhưng phải có những nhóm này):
  - file trong `supabase/migrations/` tên có `20261119` và `20261120`;
  - file/thư mục `supabase/migrations/archive/` (bản `20261118` bị đưa ra khỏi
    đường chạy);
  - file trong `supabase/baselines/`;
  - file tài liệu trong `docs/`.
- [ ] **Không thấy** file nào trong `supabase/migrations/` (thư mục gốc, không
      tính thư mục con) có tên chứa `20261118`. Nếu thấy → không merge.

### 1.3. Staging (môi trường thử) có bắt buộc không?

**Có.** Trước production phải chạy thử ít nhất một lần trên một database
khác (staging) hoặc một bản sao của production.

- [ ] Đã chạy thử trên staging và không có lỗi.
- [ ] Đã kiểm tra giao diện trên staging theo
      `docs/POST_DEPLOY_VISUAL_CHECKLIST_VI.md`.

**Nếu bạn không thể tự vào hoặc vận hành staging**, hãy gửi cho developer nội
dung sau (chỉnh phần trong ngoặc):

> “Tôi không có quyền/không rành để tự chạy staging. Anh/chị vui lòng: (1) tạo
> hoặc dùng staging project; (2) đưa dữ liệu production (bản sao lưu) vào
> staging; (3) chạy thử đúng quy trình; (4) gửi lại cho tôi: ngày giờ chạy,
> kết quả “READY”, tên 2 migration đã chạy, và 3 ảnh chụp màn hình giao diện
> (trang điểm danh, trang quiz, số vote trước/sau). Tôi sẽ không cung cấp mật
> khẩu hay chuỗi kết nối; anh/chị tự thao tác trên quyền truy cập của mình.”

### 1.4. Phải xác nhận gì trước khi triển khai production

- [ ] Đã merge PR #26 (sau khi xong mục 1.1–1.2).
- [ ] Đã có **backup** production và đã xác nhận backup mở được / khôi phục được.
- [ ] Đã có **kết quả kiểm tra trạng thái database** (mục 2.2) do developer chạy:
      phải là **A** hoặc **B**. (C/D/E → dừng, báo developer.)
- [ ] Nếu là **B**: developer đã chạy lệnh đối chiếu schema và nhận
      **`READY  baseline 20261117`**.
- [ ] Có mặt trong 30 phút sau khi triển khai để kiểm tra giao diện.
- [ ] Biết cách quay lại: “dừng lại, không bấm thêm, giữ nguyên màn hình, gọi
      developer”.

### 1.5. Nếu kết quả kiểm tra báo **NOT READY** (hoặc “KHÔNG RÕ”, “DỪNG LẠI”)

1. **DỪNG LẠI.** Không bấm tiếp, không “thử lại lần nữa”, không tự chọn trạng
   thái database, không nhờ ai “chỉ cần chạy hai file kia”.
2. Chụp màn hình toàn bộ kết quả (phải thấy rõ chữ `NOT READY` hoặc
   `E. KHÔNG RÕ` / `D. CÓ DẤU HIỆU ĐÃ CHẠY 20261118`, các dòng lỗi bên dưới).
3. Ghi lại: ngày giờ, ai chạy, chạy trên production hay staging.
4. Gửi ảnh + thông tin trên cho developer (không gửi mật khẩu).
5. Chờ developer xử lý. Database của bạn **không bị thay đổi gì** ở bước này —
   đó chính là mục đích của việc dừng lại.

### 1.6. Nếu bạn thấy **lỗi** bất kỳ lúc nào

- [ ] Không bấm thêm nút nào.
- [ ] Không chạy lại lệnh vừa chạy.
- [ ] Chụp màn hình **toàn bộ** thông báo lỗi (đừng cắt).
- [ ] Ghi: bạn đang ở bước nào, trên production hay staging, ngày giờ.
- [ ] Gửi cho developer. Nếu đang ở production và trang web có dấu hiệu bất
      thường (trắng trang, không điểm danh được, không vote được) → báo ngay,
      ưu tiên khôi phục từ backup.

---

## 2. Hướng dẫn Supabase SQL Editor — từng cú click

### 2.1. SQL Editor có an toàn để bạn tự dùng không? Trả lời thẳng thắn

| Trường hợp | Bạn tự làm được không? | Ghi chú |
| --- | --- | --- |
| **Chạy câu lệnh KIỂM TRA (chỉ đọc)** | **CÓ — an toàn** | Câu lệnh này **không thay đổi dữ liệu**. Dùng để biết database đang ở trạng thái nào. Hướng dẫn ở mục 2.2. |
| **Nâng cấp database production đang có dữ liệu** | **KHÔNG** | Phải do developer chạy bằng quy trình có kiểm tra tự động. Dán tay hai file migration **không an toàn**, vì không ai chứng minh được database của bạn đúng là đang ở trạng thái cần thiết. |
| **Cài mới một project Supabase hoàn toàn trống** | **CÓ, nhưng nên nhờ developer** | 16 file, dán lần lượt. Sai một file là phải làm lại từ đầu. Hướng dẫn ở mục 2.4. |

> Vì vậy: **bạn chỉ tự làm mục 2.2 (kiểm tra) và chụp kết quả**. Phần nâng cấp
> giao cho developer (mục 3, tài liệu `docs/DEVELOPER_HANDOFF_VI.md`).

---

### 2.2. BƯỚC 1 — Chạy câu lệnh KIỂM TRA (chỉ đọc, an toàn)

**Cách mở:**

1. Đăng nhập **Supabase** → chọn project (chọn **production** trước, hoặc
   staging nếu bạn đang thử).
2. Bấm **SQL Editor** ở menu trái.
3. Bấm **New query** (nút “+ New query”).

**Câu lệnh cần dán — copy đúng toàn bộ khối dưới đây:**

```sql
-- CHỈ ĐỌC. Không thay đổi dữ liệu.
with st as (
  select
    to_regclass('public.daily_login_rewards') as bang_diem_danh,
    to_regclass('public.daily_quiz_answers') as bang_quiz_1,
    to_regclass('public.daily_quiz_attempts') as bang_quiz_2,
    to_regclass('public.daily_quiz_seen') as bang_quiz_3,
    to_regclass('public.daily_quiz_questions') as bang_quiz_4,
    to_regclass('public.daily_quiz_config') as bang_cau_hinh,
    to_regprocedure('public.start_daily_quiz(uuid,date)') as ham_quiz_1,
    to_regprocedure('public.submit_daily_quiz_answer(uuid,uuid,text,text)') as ham_quiz_2,
    to_regprocedure('public.claim_daily_login(uuid,date)') as ham_diem_danh,
    to_regprocedure('public.my_daily_rewards_status()') as ham_trang_thai,
    (select count(*) from pg_trigger
      where tgrelid = to_regclass('public.daily_login_rewards')
        and tgname = 'daily_login_rewards_no_vote') as so_trigger,
    (select count(*) from pg_constraint
      where conrelid = to_regclass('public.daily_login_rewards')
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%reward%') as so_check_reward,
    (select count(*) from pg_constraint
      where conrelid = to_regclass('public.daily_login_rewards')
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%reward = 0%') as so_check_reward_0
)
select 1 as stt, 'Bảng điểm danh (daily_login_rewards)' as muc,
       case when bang_diem_danh is null then 'THIẾU' else 'CÓ' end as ket_qua,
       'phải là CÓ trên database đang chạy' as ky_vong from st
union all select 2, 'Các bảng quiz (answers/attempts/seen/questions)',
       case when bang_quiz_1 is not null and bang_quiz_2 is not null
                 and bang_quiz_3 is not null and bang_quiz_4 is not null
            then 'CÓ' else 'THIẾU' end, 'CÓ' from st
union all select 3, 'Bảng cấu hình quiz (daily_quiz_config)',
       case when bang_cau_hinh is null then 'THIẾU' else 'CÓ' end, 'CÓ' from st
union all select 4, 'Hàm quiz mới (start_daily_quiz / submit_daily_quiz_answer)',
       case when ham_quiz_1 is not null and ham_quiz_2 is not null then 'CÓ' else 'THIẾU' end, 'CÓ' from st
union all select 5, 'Hàm điểm danh (claim_daily_login / my_daily_rewards_status)',
       case when ham_diem_danh is not null and ham_trang_thai is not null then 'CÓ' else 'THIẾU' end, 'CÓ' from st
union all select 6, 'Khoá bảo vệ lịch sử điểm danh (trigger daily_login_rewards_no_vote)',
       case when so_trigger > 0 then 'ĐÃ CÓ' else 'CHƯA CÓ' end,
       'CHƯA CÓ = chưa chạy 20261119/20261120; ĐÃ CÓ = đã chạy xong' from st
union all select 7, 'Ràng buộc cũ trên cột reward',
       case when so_check_reward = 0 then 'KHÔNG CÓ'
            when so_check_reward_0 > 0 then 'CÓ (reward = 0) — dấu hiệu đã chạy 20261118'
            else 'CÓ (reward = 2) — bình thường trước khi nâng cấp' end,
       'sau nâng cấp phải là KHÔNG CÓ' from st
union all select 8, 'KẾT LUẬN',
       case
         when so_check_reward_0 > 0 then
           'D. CÓ DẤU HIỆU ĐÃ CHẠY 20261118 — DỪNG LẠI, nhờ developer xử lý (mode D)'
         when so_trigger > 0 and so_check_reward = 0 then
           'A. ĐÃ Ở TRẠNG THÁI CUỐI — chỉ cần kiểm tra giao diện (không chạy thêm SQL)'
         when bang_quiz_1 is not null and bang_quiz_2 is not null and bang_quiz_3 is not null
              and bang_quiz_4 is not null and bang_cau_hinh is not null
              and ham_quiz_1 is not null and ham_quiz_2 is not null and so_trigger = 0 then
           'B. CẦN NÂNG CẤP — nhờ developer chạy đúng quy trình (baseline 20261117)'
         else
           'E. KHÔNG RÕ — DỪNG LẠI, nhờ developer kiểm tra (không tự chạy thêm SQL)'
       end,
       'chỉ tiếp tục khi là A hoặc B' from st
order by stt;
```

4. Dán vào ô soạn thảo trong **SQL Editor**.
5. Bấm **Run** (nút chạy, thường ở góc dưới bên phải).
6. Đợi vài giây. Kết quả hiện ra dạng bảng có 3 cột: `stt`, `muc`, `ket_qua`,
   `ky_vong`.

**Kết quả ĐÚNG trông như thế nào:** bảng có 8 dòng, dòng 8 bắt đầu bằng
**A.** hoặc **B.**. (Dòng 1–5 đều là “CÓ”.)

**Kết quả cần DỪNG:** dòng 8 là **D.** hoặc **E.**, hoặc bạn thấy thông báo màu
đỏ (lỗi), hoặc bảng không hiện ra 8 dòng.

---

### 2.3. BƯỚC 2 — Chỉ chạy khi Bước 1 ra **A** hoặc **B** (vẫn là chỉ đọc)

Copy nguyên khối sau vào một **New query** mới, bấm **Run**:

```sql
-- CHỈ ĐỌC. Số liệu để đối chiếu trước/sau khi nâng cấp.
select 'Số câu quiz mỗi ngày (questions_per_day)' as muc,
       coalesce((select value::text from public.daily_quiz_config where key = 'questions_per_day'), 'THIẾU') as ket_qua,
       '5' as ky_vong
union all
select 'Các mức thưởng điểm danh đang lưu trong lịch sử',
       coalesce((select string_agg(format('mức %s: %s dòng', reward, so_dong), '; ' order by reward)
                 from (select reward, count(*)::text as so_dong
                       from public.daily_login_rewards group by reward) h), 'chưa có dòng nào'),
       'giữ nguyên sau nâng cấp; mức 2 là bình thường (lịch sử cũ)'
union all
select 'Số dòng lịch sử điểm danh',
       (select count(*)::text from public.daily_login_rewards),
       'không được giảm sau khi nâng cấp';
```

- **Kết quả ĐÚNG:** dòng “Số câu quiz mỗi ngày” = **5**; dòng “Số dòng lịch sử
  điểm danh” là một con số (ghi con số này lại).
- **DỪNG LẠI nếu:** báo lỗi đỏ, hoặc “Số câu quiz mỗi ngày” không phải 5.

**Gửi lại cho developer / cho tôi:** ảnh chụp 2 bảng kết quả (Bước 1 và Bước 2),
kèm dòng ghi “đây là production” hay “đây là staging”.
**Không chụp và không gửi** phần URL kết nối, mật khẩu, hay khoá API — hãy che
kín các phần đó nếu chúng hiện trên màn hình.

> Lưu ý trung thực: hai bước trên là **kiểm tra sơ bộ**. Kiểm tra đầy đủ (đối
> chiếu từng bảng, cột, ràng buộc, policy, hàm, trigger, cấu hình) cần chạy bằng
> công cụ dòng lệnh → **việc của developer**. Hai bước này chỉ giúp bạn biết
> nên gọi developer làm gì, và cung cấp bằng chứng trước/sau.

---

### 2.4. BƯỚC 3 (chỉ cho project **hoàn toàn mới, chưa có dữ liệu**)

> ⚠️ **Không làm mục này trên database đang có người dùng.** Chỉ dành cho một
> project Supabase mới tinh, chưa từng cài app. Nếu bạn không chắc → dừng lại,
> hỏi developer. Khuyến nghị: nhờ developer làm; sai một bước là phải xoá project
> làm lại.

1. Mở repository trên GitHub → vào thư mục **`supabase/setup/`**.
2. Mở file **`01-core-requests.sql`** trước tiên. Bấm nút copy (hoặc “Raw” rồi
   copy toàn bộ).
3. Trong Supabase → **SQL Editor** → **New query** → dán → bấm **Run**.
4. Đợi thông báo thành công (màu xanh / “Success. No rows returned”).
5. Lặp lại đúng thứ tự với:
   `02-pick-media.sql` → `03-daily-spin.sql` → `04-spin-quota-rls.sql` →
   `05-vote-hardening.sql` → `06-watch-comments-streak.sql` →
   `07-security-audit.sql` → `08-comments-activity.sql` →
   `09-funnel-events.sql` → `10-daily-rewards.sql` →
   `11-daily-rewards-upgrade.sql` → `12-daily-quiz-schema.sql` →
   `13-daily-quiz-pool.sql` → `14-daily-quiz-flow.sql` →
   **`15-preserve-legacy-daily-login-rewards.sql`** →
   **`16-daily-login-reward-immutable.sql`**.
6. **Thành công:** sau mỗi file hiện thông báo xanh, không có chữ đỏ.
7. **Thất bại (chữ đỏ, hoặc thiếu thông báo):** **DỪNG LẠI ngay**, không chạy
   file tiếp theo. Chụp màn hình thông báo đỏ + tên file, gửi developer.
8. **Không có file nào tên chứa `20261118`.** Nếu bạn thấy file như vậy trong
   danh sách → dừng lại, báo developer (đó là bản bị loại bỏ).
9. Sau khi xong 16 file: chạy lại **Bước 1** (mục 2.2). Kết quả phải là
   **A. ĐÃ Ở TRẠNG THÁI CUỐI**.

**Cách dừng/khôi phục ở mục này:** nếu lỗi giữa chừng, **không tự xoá bảng**,
**không chạy lại từ đầu**. Dừng lại, chụp màn hình, gửi developer. Với project
mới tinh, cách “khôi phục” đơn giản nhất là **xoá project và tạo lại** — nhưng
hãy để developer quyết định.

---

## 3. Quyền truy cập bạn cần (chỉ liệt kê những gì thật sự cần)

- [ ] **GitHub**: quyền ghi/merge trên repository (để merge PR #26).
- [ ] **Supabase**: quyền admin project **hoặc** quyền chạy migration/database
      trên project đích (production). Cần cho người trực tiếp thao tác
      (developer nếu bạn không tự làm).
- [ ] **Quyền tạo/khôi phục backup** của database production (thường là quyền
      admin Supabase, hoặc người có quyền truy cập bản sao lưu tổ chức).
- [ ] **Staging project** (nếu có): quyền admin hoặc quyền database, để chạy thử
      trước production.
- [ ] **Nền tảng triển khai giao diện** (Vercel/Cloudflare Pages/… ) **nếu**
      phần giao diện được deploy tách riêng khỏi database: cần quyền deploy để
      đưa bản frontend mới lên cùng lúc.

**Không cần:** mật khẩu database gửi qua chat, khoá service-role, chuỗi kết nối.
Người làm việc trực tiếp trên hệ thống sẽ dùng quyền của chính họ.

---

## 4. Đường đi an toàn nếu **không có developer**

1. **Chưa merge PR #26.**
2. **Chạy Bước 1 (mục 2.2)** trên Supabase để biết database đang ở trạng thái
   nào. (Chỉ đọc — an toàn.)
3. Chụp màn hình kết quả, gửi cho tôi (nhớ che kín mọi URL/mật khẩu/khoá hiện
   trên màn hình).
4. Cùng kết quả đó, tôi sẽ nói chính xác bạn thuộc trường hợp **A / B / D / E**:
   - **A** (đã ở trạng thái cuối): bạn **không cần chạy SQL gì cả**. Chỉ cần
     deploy phần giao diện rồi kiểm tra theo
     `docs/POST_DEPLOY_VISUAL_CHECKLIST_VI.md`.
   - **B** (cần nâng cấp): **phần database phải do người có quyền chạy lệnh
     thực hiện**. Không có developer → gửi tài liệu
     `docs/DEVELOPER_HANDOFF_VI.md` cho bất kỳ ai bạn thuê/kế tiếp; họ sẽ làm
     đúng quy trình có kiểm tra.
   - **D** hoặc **E**: **DỪNG LẠI**. Đây là trường hợp cần người có chuyên môn
     xem xét. Không tự chạy thêm bất cứ lệnh nào.
5. **Điểm dừng rõ ràng:** nếu kết quả Bước 1 không hiện đúng 8 dòng, hoặc dòng 8
   không bắt đầu bằng **A** hoặc **B** → dừng. Không đoán, không “thử tiếp”.
6. **Thứ bạn cần copy gửi lại cho tôi:** ảnh chụp đầy đủ bảng kết quả Bước 1
   (và Bước 2 nếu chạy được), kèm dòng: “đây là production/staging, chạy lúc
   [ngày giờ]”. **Tuyệt đối không gửi:** mật khẩu, chuỗi kết nối, khoá API,
   service-role key.

> Không ai được yêu cầu bạn “chọn baseline” hay “đoán trạng thái”. Baseline là
> việc của công cụ kiểm tra tự động; nếu nó không xác nhận, câu trả lời là
> dừng lại.

---

## 5. Tóm tắt một trang

| Câu hỏi | Trả lời ngắn |
| --- | --- |
| Tự nâng cấp database production bằng cách dán SQL được không? | **Không.** |
| Tự chạy câu lệnh kiểm tra (chỉ đọc) được không? | **Có** — mục 2.2 và 2.3. |
| Có được chạy migration `20261118` không? | **Không bao giờ.** |
| Staging có bắt buộc? | **Có.** |
| Khi nào dừng? | Khi kết quả không đúng y hệt mô tả, hoặc thấy chữ đỏ/lỗi. |
| Dừng rồi làm gì? | Không bấm thêm; chụp màn hình; gửi developer hoặc gửi cho tôi. |
| Có bị mất dữ liệu cũ không? | Không — lịch sử điểm danh (kể cả mức 2 cũ) được giữ nguyên; không trừ vote đã cho. |
| Sau cùng, vote đến từ đâu? | Chỉ từ **quiz K-pop**: 5 câu/ngày, 1 câu đúng = 1 vote, tối đa 5 vote/ngày. |
