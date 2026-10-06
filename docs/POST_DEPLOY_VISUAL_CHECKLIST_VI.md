# Kiểm tra bằng mắt sau khi triển khai (không cần kỹ thuật)

Dùng tài liệu này **sau khi** phần database và phần giao diện đã được triển khai.
Bạn chỉ cần: trình duyệt, tài khoản người dùng của bạn trên trang web, và 15
phút. Không cần SQL, không cần lệnh.

**Cách ghi kết quả:** tick ✅ (đạt) hoặc ❌ (không đạt). Nếu có bất kỳ ❌ → dừng
lại, chụp màn hình, gửi cho developer (hoặc gửi cho tôi). **Không thử sửa gì.**

Giao diện hiện tại của ứng dụng hiển thị bằng **tiếng Anh**, nên bên dưới ghi rõ
đúng câu tiếng Anh bạn sẽ nhìn thấy, kèm nghĩa tiếng Việt.

---

## Chuẩn bị (2 phút)

- [ ] Mở trang web bằng trình duyệt thường dùng (điện thoại hoặc máy tính).
- [ ] Đăng nhập bằng tài khoản của bạn.
- [ ] Ghi lại **số vote hiện tại** của bạn (số dư bonus/vote, thường hiện ở
      trang cá nhân hoặc phần tổng vote). Viền đỏ số này lại — bạn sẽ so sánh
      sau: `Số vote TRƯỚC: ………………`
- [ ] (Khuyến khích) mở thêm một cửa sổ ẩn danh/điện thoại khác để kiểm tra
      nhanh sau khi refresh.

---

## 1. Trang Điểm danh (`/daily-login`)

| # | Kiểm tra | Kết quả đạt | ✅/❌ |
| --- | --- | --- | --- |
| 1 | Vào menu **Daily Login** (hoặc gõ `/daily-login`) | Trang mở ra, có tiêu đề **“Daily check-in”** và khối **“Your check-in calendar”** | |
| 2 | Lịch tháng hiện ra | Thấy lịch tháng với các ô ngày; có ô “Checked in”, “Not checked in”, “Upcoming” | |
| 3 | Thống kê hiện đủ | Có ba mục **“Streak”** (chuỗi ngày), **“Best streak”** (chuỗi cao nhất), **“Lifetime”** (tổng số ngày) | |
| 4 | Tiến trình tháng | Có dòng **“n of total days checked in this month”** (số ngày đã điểm danh trong tháng) | |
| 5 | Nút điểm danh | Có nút **“Check in today”** (nếu hôm nay chưa điểm danh) | |
| 6 | **Bấm điểm danh** | Hiện **“Checked in for today. See you tomorrow!”**, ngày hôm nay trong lịch chuyển sang trạng thái đã điểm danh | |
| 7 | Điểm danh lại trong ngày | Hiện **“You are already checked in for today.”** — không tạo thêm gì, không lỗi | |
| 8 | **Không có vote nào được cộng** | Số vote của bạn **không đổi** so với “Số vote TRƯỚC” | |
| 9 | **Không còn chữ “+2” / “bonus votes”** gắn với điểm danh | Có dòng **“Check-ins never award votes.”**; không thấy “+2 votes”, “Daily Login reward” ở bất cứ đâu | |
| 10 | Ngày trong quá khứ | Các ngày đã qua **không bấm được** để điểm danh (hoặc bấm không có tác dụng). Có dòng giải thích kiểu **“Past days cannot be checked in.”** | |
| 11 | Refresh trang (F5) | Trang load lại bình thường, vẫn hiện trạng thái đã điểm danh, không trắng trang, không báo lỗi | |

---

## 2. Daily Quiz đã nghỉ hưu (địa chỉ cũ `/quiz`)

> Từ bản này, **Daily Quiz không còn là một phần của ứng dụng**. Database vẫn
> giữ nguyên dữ liệu quiz cũ (không ai xoá), nhưng người dùng không còn màn
> quiz, không còn mục menu, và không còn cách nào kiếm vote từ quiz.

| # | Kiểm tra | Kết quả đạt | ✅/❌ |
| --- | --- | --- | --- |
| 12 | Nhìn menu bên trái | **Không còn mục “Music quiz” / “Quiz”**; chỉ còn Daily Login, Daily Spin, Xếp hạng, Của tôi | |
| 13 | Gõ thẳng địa chỉ cũ `/quiz` vào thanh địa chỉ | Bị đưa về **`/daily-login`** — hiện trang **“Daily check-in”**, **không** hiện màn quiz, **không** báo lỗi 404 | |
| 14 | Bấm **F5 (refresh)** khi đang ở `/quiz` | Vẫn về trang điểm danh như bước 13, không trắng trang | |
| 15 | **Không còn chữ “quiz” ở bất cứ đâu trên giao diện** | Không thấy “Today’s K-pop challenge”, “Quiz votes today”, “n/5 answered”… ở bất kỳ trang nào | |
| 16 | **Không có vote nào được cộng** khi mở địa chỉ cũ | Số vote **không đổi** so với “Số vote TRƯỚC” — dù bạn bấm gì ở địa chỉ cũ | |
| 17 | Nếu bạn còn bookmark/link cũ tới `/quiz` | Bấm vào cũng về `/daily-login` như bước 13 | |

## 3. Kiểm tra toàn trang (5 phút)

- [ ] Vào lại trang chủ, vài trang khác (bảng xếp hạng, trang cá nhân, admin nếu
      có quyền) — **không trang nào trắng màn hình**.
- [ ] Bấm **F5 (refresh)** ở từng trang: **Daily Login**, **Daily Spin** (vòng
      quay, nếu có), **Xếp hạng**, trang cá nhân, trang chủ — không lỗi, không
      mất dữ liệu hiển thị. Nhớ thử F5 cả ở địa chỉ cũ `/quiz`.
- [ ] Thử thoát ra đăng nhập lại: lịch điểm danh vẫn hiển thị đúng các ngày đã
      điểm danh trước đó.
- [ ] Thử trên điện thoại (nếu có): các trang không vỡ, nút bấm được.
- [ ] **Không thấy bất kỳ chữ nào kiểu “+2 votes”, “Daily Login reward”,
      “bonus votes” gắn với việc điểm danh.**

---

## 4. Đối chiếu cuối cùng

- [ ] `Số vote TRƯỚC: ………………`
- [ ] `Số vote SAU (sau khi điểm danh và mở địa chỉ cũ /quiz): ………………`
- [ ] **Hiệu số = 0.** Điểm danh không cộng vote, và mở `/quiz` cũng không cộng
      gì (Daily Quiz đã nghỉ hưu). Vote mua/bonus sẵn có không bị mất.
- [ ] Số dòng lịch sử điểm danh **không bị mất** (lịch vẫn hiện các ngày đã
      điểm danh từ trước).

---

## 5. Kết luận

- [ ] **ĐẠT** — tất cả các mục đều ✅ → ghi “hoàn tất, ngày giờ: ………” và lưu
      ảnh chụp màn hình (trang điểm danh sau khi điểm danh, và màn hình sau khi
      mở địa chỉ cũ `/quiz`).
- [ ] **KHÔNG ĐẠT** — có ít nhất một ❌ → **dừng sử dụng các bước tiếp theo**,
      chụp màn hình mục ❌ đó, ghi rõ bạn đang làm gì khi nó xảy ra, gửi cho
      developer hoặc gửi cho tôi. Không tự thao tác thêm trên database.

> Nhắc lại: **không ai cần mật khẩu, chuỗi kết nối hay khoá của bạn** để xử lý
> các mục ❌. Chỉ cần ảnh chụp màn hình (nhớ che kín phần nào hiện URL/khoá) và
> mô tả ngắn gọn điều bạn vừa bấm.
