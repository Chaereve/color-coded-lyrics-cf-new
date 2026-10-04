# Tin nhắn giao việc cho developer (tiếng Việt, dùng nguyên văn)

> Cách dùng: copy phần tin nhắn bên dưới, điền phần trong ngoặc `[…]`, gửi qua
> email/chat cho developer. **Không dán mật khẩu, chuỗi kết nối, khoá API hay
> service-role key vào tin nhắn** — người nhận sẽ dùng quyền truy cập của chính
> họ.

---

## Tin nhắn (copy từ đây)

Chào anh/chị,

Mình cần anh/chị triển khai một thay đổi đã được review trên GitHub. Mình không
rành kỹ thuật nên nhờ anh/chị làm **đúng quy trình có kiểm tra tự động**; mình
sẽ không tự dán SQL lên database production.

**PR:** `[DÁN LINK PR Ở ĐÂY — ví dụ: https://github.com/Chaereve/color-coded-lyrics-cf-new/pull/26]`
**Tài liệu kèm theo trong repo:** `docs/DB-MIGRATIONS.md` (quy trình), tài liệu
này cũng nằm ở `docs/DEVELOPER_HANDOFF_VI.md`.

### 1. Chính sách sản phẩm (không được thay đổi)

- **Điểm danh hằng ngày (`/daily-login`) chỉ ghi nhận chuỗi ngày (streak).
  Nó KHÔNG thưởng vote.** Không cộng vào `vote_credits`, `bonus_credits`,
  không tạo phiếu miễn phí, không tạo ledger vote nào.
- **Quiz K-pop (`/quiz`) là cách duy nhất nhận vote thưởng**: 5 câu/người/ngày
  quiz, 1 câu đúng = 1 vote, **trần 5 vote/ngày**. Điểm danh + 5 câu đúng = đúng
  5 vote, không bao giờ là 7.
- **Câu hỏi cũ (legacy) không được vào vòng quiz có thưởng.** Câu chưa được kiểm
  chứng nguồn/không đạt chuẩn thì không xuất hiện; khi chưa có câu đủ điều kiện,
  giao diện phải hiển thị trạng thái “chưa có câu” chứ không phải lỗi.
- Giữ nguyên `free_vote_grant_enabled = false`. Không thêm cột/tiền tệ/điểm/XP/
  huy hiệu mới.

### 2. Điều cấm tuyệt đối

- **KHÔNG chạy migration `20261118_daily_login_no_votes.sql`.** Nó có lệnh viết
  lại lịch sử (`UPDATE daily_login_rewards SET reward = 0`) và `CHECK (reward = 0)`
  toàn bảng. File này đã được đưa ra khỏi đường chạy (nằm trong
  `supabase/migrations/archive/`), **không được đưa lại vào**.
- **KHÔNG tự đoán baseline.** Baseline chỉ được ghi khi kiểm tra tự động trả về
  `READY`.
- **KHÔNG sửa/xoá dữ liệu lịch sử điểm danh.** Các dòng đã ghi `reward = 2` giữ
  nguyên; không UPDATE/DELETE, không trừ vote đã cấp.
- **KHÔNG dán mật khẩu, chuỗi kết nối hay khoá vào chat/GitHub/ảnh chụp.**

### 3. Quy trình bắt buộc (thứ tự không được đổi)

1. **Backup** database production (và xác nhận bản backup khôi phục được).
2. **Xác định trạng thái hiện tại** bằng lệnh chỉ đọc:
   `npm run db:verify-baseline` (không truyền `--baseline`) → xem database khớp
   mức nào (`20261111`, `20261117`, `20261118`, `20261120`).
3. **Diễn tập trên staging trước**: đưa bản sao production vào staging, rồi làm
   y hệt các bước 4–6 trên staging.
4. **Đối chiếu schema trước khi ghi baseline** (bắt buộc):
   - Trường hợp bình thường: `npm run db:verify-baseline -- --baseline 20261117`
     → **phải in `READY  baseline 20261117`**.
   - Nếu database chưa có các migration 20261112–20261117: dùng
     `--baseline 20261111` để chạy thật các migration còn thiếu.
   - Nếu phát hiện đã từng chạy `20261118`: dùng `--baseline 20261118`
     (mode D) và **không được hứa khôi phục** các giá trị đã bị đưa về 0.
   - Nếu không khớp mức nào (mode E): **dừng**, báo lại cho mình kèm báo cáo.
5. **Triển khai**: `npm run db:deploy -- --baseline <mức đã READY>`. Lệnh này tự
   chạy lại bước đối chiếu; nếu không `READY` nó sẽ từ chối và **không ghi gì**.
6. **Kiểm tra sau triển khai** (trong `docs/DB-MIGRATIONS.md` mục “Verification”):
   - phân bố các mức `reward` **không đổi** (có mức `2` là bình thường);
   - không còn ràng buộc `CHECK` trên cột `reward` (kỳ vọng 0);
   - trigger `daily_login_rewards_no_vote` tồn tại (kỳ vọng 1);
   - thử `UPDATE` đổi `reward` phải bị chối
     (`err.dailyLoginRewardImmutable`);
   - gọi thử điểm danh: trả `reward = 0`, `votes_awarded = 0`, số dư không đổi.
7. **Deploy phần giao diện cùng đợt**, rồi **tự kiểm tra bằng mắt** theo
   `docs/POST_DEPLOY_VISUAL_CHECKLIST_VI.md` (mình sẽ kiểm tra lại).
8. Giữ bản backup cho đến khi bước 6 và 7 đều đạt.

### 4. Những gì mình cần anh/chị gửi lại (để mình lưu hồ sơ)

1. Ngày giờ chạy, và chạy trên **staging** hay **production**.
2. Kết quả `db:verify-baseline` (dòng `READY …` hoặc `NOT READY …` đầy đủ).
3. Tên các migration đã chạy (kỳ vọng chỉ có `20261119` và `20261120`, trừ
   trường hợp `20261111` thì có thêm `20261112`–`20261117`).
4. Kết quả 5 kiểm tra sau triển khai (mục 3.6).
5. Ảnh chụp giao diện: trang điểm danh (trước/sau điểm danh), trang quiz
   (trước/sau khi làm xong), số dư vote trước/sau.
6. Xác nhận: “đã có backup, backup khôi phục được”.

**Không gửi cho mình:** mật khẩu, chuỗi kết nối, khoá API, service-role key.

### 5. Nếu có lỗi

- Dừng ngay, **không chạy lại lệnh**, không “thử tiếp”.
- Gửi cho mình: ảnh/chữ lỗi đầy đủ, đang ở bước nào, trên staging hay production.
- Nếu production có dấu hiệu hỏng: ưu tiên khôi phục từ backup, báo mình ngay.

Cảm ơn anh/chị. Nếu quy trình trên khác với những gì anh/chị định làm, xin báo
lại trước khi thực hiện — mình sẽ không duyệt cách làm “dán tay cho nhanh”.

---

## Ghi chú cho bạn (không gửi cho developer)

- Nếu developer đề nghị “chỉ cần chạy 2 file 20261119 và 20261120 là xong”:
  **chưa đồng ý** nếu họ chưa chạy `db:verify-baseline` và chưa có `READY`.
  Việc bỏ qua bước đó là rủi ro chính của đợt này.
- Nếu developer nói “database nhìn là up to date rồi”: yêu cầu họ **chạy lệnh
  đối chiếu** và gửi dòng `READY`. Cảm giác không phải là bằng chứng.
- Nếu họ hỏi bạn “chọn baseline nào”: câu trả lời là **không chọn** — công cụ
  kiểm tra sẽ chỉ ra mức nào khớp.
