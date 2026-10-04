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
| 9 | **Không còn chữ “+2” / “bonus votes”** gắn với điểm danh | Có dòng **“Check-ins never award votes — only the K-pop quiz does.”**; không thấy “+2 votes”, “Daily Login reward” ở bất cứ đâu | |
| 10 | Ngày trong quá khứ | Các ngày đã qua **không bấm được** để điểm danh (hoặc bấm không có tác dụng). Có dòng giải thích kiểu **“Past days cannot be checked in.”** | |
| 11 | Refresh trang (F5) | Trang load lại bình thường, vẫn hiện trạng thái đã điểm danh, không trắng trang, không báo lỗi | |

---

## 2. Trang Quiz K-pop (`/quiz`)

| # | Kiểm tra | Kết quả đạt | ✅/❌ |
| --- | --- | --- | --- |
| 12 | Vào menu **Quiz** (hoặc `/quiz`) | Trang mở ra, tiêu đề **“Today’s K-pop challenge”** | |
| 13 | Số câu | Đúng **5 câu** (hiển thị “n/5 answered” khi làm) | |
| 14 | Bắt đầu làm | Nút bắt đầu hoạt động; mỗi câu có 4 lựa chọn; trả lời xong hiện đúng/sai kèm giải thích | |
| 15 | **1 câu đúng = 1 vote** | Mỗi câu đúng tăng đúng 1 vào **“Quiz votes today: n/5”** | |
| 16 | **Trần 5 vote/ngày** | Làm xong 5 câu: **“Quiz votes today: 5/5”**; không bao giờ vượt quá 5 | |
| 17 | Tổng nhận được | Dòng kết quả kiểu **“You scored 5/5 · +5 bonus votes”** (nếu đúng 5 câu). Nếu bạn điểm danh + làm 5 câu đúng: tổng vote tăng **đúng 5**, không bao giờ 7 | |
| 18 | Làm lại / refresh | Làm lại trong ngày **không cộng thêm vote**; refresh không làm mất kết quả, không cho làm thêm | |
| 19 | **Chưa có câu đủ điều kiện** (nếu chưa có câu hỏi được duyệt) | Hiện **“Today’s quiz is not available yet”** kèm dòng giải thích về việc câu hỏi đang được kiểm duyệt — đây là trạng thái bình thường, **không phải lỗi** | |
| 20 | **Không có câu hỏi cũ/không kiểm chứng** | Không xuất hiện câu hỏi kiểu cũ, câu thiếu nguồn, câu “chưa duyệt”. Nếu bạn thấy câu hỏi không rõ nguồn gốc → đánh dấu ❌ và báo ngay | |
| 21 | Vòng cũ từ phiên bản trước (nếu có) | Hiện thông báo kiểu **“This round was created by an older version of the quiz…”** — vòng đó **không cộng vote**, vòng mới mở vào ngày hôm sau | |

---

## 3. Kiểm tra toàn trang (5 phút)

- [ ] Vào lại trang chủ, vài trang khác (bảng xếp hạng, trang cá nhân, admin nếu
      có quyền) — **không trang nào trắng màn hình**.
- [ ] Bấm **F5 (refresh)** ở từng trang: **Daily Login**, **Quiz**,
      **Daily Spin** (vòng quay, nếu có), trang chủ — không lỗi, không mất dữ
      liệu hiển thị.
- [ ] Thử thoát ra đăng nhập lại: lịch điểm danh và kết quả quiz hôm nay vẫn
      hiển thị đúng.
- [ ] Thử trên điện thoại (nếu có): các trang không vỡ, nút bấm được.
- [ ] **Không thấy bất kỳ chữ nào kiểu “+2 votes”, “Daily Login reward”,
      “bonus votes” gắn với việc điểm danh.**

---

## 4. Đối chiếu cuối cùng

- [ ] `Số vote TRƯỚC: ………………`
- [ ] `Số vote SAU (sau khi điểm danh + làm xong quiz): ………………`
- [ ] **Hiệu số = đúng số câu trả lời đúng trong quiz** (tối đa 5).
      Ví dụ: điểm danh + 5 câu đúng → hiệu số **5**. Điểm danh không làm tăng
      hiệu số này.
- [ ] Số dòng lịch sử điểm danh **không bị mất** (lịch vẫn hiện các ngày đã
      điểm danh từ trước).

---

## 5. Kết luận

- [ ] **ĐẠT** — tất cả các mục đều ✅ → ghi “hoàn tất, ngày giờ: ………” và lưu
      ảnh chụp màn hình (trang điểm danh sau khi điểm danh, và trang quiz sau
      khi làm xong).
- [ ] **KHÔNG ĐẠT** — có ít nhất một ❌ → **dừng sử dụng các bước tiếp theo**,
      chụp màn hình mục ❌ đó, ghi rõ bạn đang làm gì khi nó xảy ra, gửi cho
      developer hoặc gửi cho tôi. Không tự thao tác thêm trên database.

> Nhắc lại: **không ai cần mật khẩu, chuỗi kết nối hay khoá của bạn** để xử lý
> các mục ❌. Chỉ cần ảnh chụp màn hình (nhớ che kín phần nào hiện URL/khoá) và
> mô tả ngắn gọn điều bạn vừa bấm.
