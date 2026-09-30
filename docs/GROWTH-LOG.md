# Growth Log — bài học rút ra theo mẫu *tín hiệu → căn nguyên → quy luật*

> Định dạng học từ skill `growth-log` của [affaan-m/ECC](https://github.com/affaan-m/ecc):
> **không viết nhật ký** ("đã sửa lỗi X"), mà trích ra *mẫu tái sử dụng* — lần sau gặp
> đúng tín hiệu đó thì biết làm gì. Mỗi entry **4–8 câu**, một entry = **một căn nguyên**.
>
> **Ngưỡng ghi:** công việc có debug, làm lại, rollback, hoặc một quyết định không hiển
> nhiên → ghi. Sửa typo, đổi một dòng config → không ghi.
> **Trộn trùng (nguyên tắc Bole):** trước khi ghi entry mới, tìm entry cũ cùng căn
> nguyên — trùng thì thêm *tín hiệu* mới vào entry cũ, đừng tạo bản sao.
> **Thử thách mỗi entry:** viết được câu "Lần sau gặp [tín hiệu], tôi [hành động]".
> Viết không được nghĩa là chưa trích được quy luật.
>
> Nhật ký tường thuật từng vòng vẫn nằm ở `DA-LAM-VA-GOI-Y.md`. File này chỉ giữ quy luật.

---

## 2026-09 — Lưới an toàn có thể biến 1 lỗi thành hỏng cả trang

**Tín hiệu:** một khung "chống màn hình đen" (ErrorBoundary + khối `.bootfail`) tự hiện
ra phủ kín app sau một lỗi render nhỏ; chủ dự án phải xoá tay class trên trình duyệt mới
dùng được web.

**Căn nguyên:** lưới an toàn được thiết kế cho *lỗi hệ thống* nhưng lại bắt cả *lỗi một
component* — một cây React bị gỡ thì khối thay thế to bằng cả trang sẽ che mọi thứ, kể
cả phần lành lặn.

**Quy luật:** Lần sau thấy ý tưởng "thêm khung an toàn bao trang", tôi hỏi *nó che những
gì khi kích hoạt* — lưới đúng phải thu nhỏ dần theo phạm vi lỗi (một khối, một dòng
toast), không bao giờ to hơn lỗi nó chữa. Ghi tiếp tín hiệu mới vào entry này nếu cùng
căn nguyên.

---

## 2026-09 — Hai chỗ đếm cùng một tập phải đi qua MỘT hàm

**Tín hiệu:** huy hiệu tab "In progress" hiện **1** trong khi danh sách tab liệt kê **2**
bài — số ngay trên đầu lệch với nội dung ngay dưới nó.

**Căn nguyên:** badge và tab cùng mô tả "tập bài đang làm" nhưng mỗi nơi tự lọc lại dữ
liệu đầu vào; một bên còn tính cả bài đã chốt. Không có gì báo lỗi vì cả hai hàm đều
"đúng" theo định nghĩa riêng của chúng.

**Quy luật:** Lần sau có hai UI hiển thị cùng một khái niệm đếm được (badge ↔ danh sách,
ô thống kê ↔ bộ lọc), tôi gom về **một** hàm trả tập + số, và viết test chốt "hai cửa sổ
lấy cùng một nguồn" (`boardSync.test.js` là mẫu).

---

## 2026-09 — Địa chỉ là bản sao; state mới là nguồn sự thật

**Tín hiệu:** link nội bộ bấm không chạy gì cả trong bản xem trước bị sandbox iframe
(`pushState` ném `SecurityError`), và cả trên `file://`; `preventDefault()` đã chạy trước
nên trình duyệt cũng không đi link thật.

**Căn nguyên:** handler tin `window.history.pushState` là con đường chính, trong khi nó
là thứ *ghi lại sau*; chỗ nào không ghi được thì mọi setState cũng trùng giá trị nên
React không render lại — link chết không dấu vết.

**Quy luật:** Lần sau làm điều hướng SPA, tôi đổi state trước (nguồn sự thật), ghi URL
sau qua hàm bọc không bao giờ ném (`lib/history.js`), và để `href` thật còn nguyên trên
thẻ — không đi trong app được thì trình duyệt đi thật, vẫn tới nơi (`lib/nav.js`).

---

## 2026-09 — File "chạy lại được" phải chứa đủ mọi lớp siết, và có test canh

**Tín hiệu:** `schema.sql` ghi "chạy lại an toàn" nhưng đã tụt hậu 4 lớp siết của
migration `20260906_rls_hardening` — ai "chạy lại cho chắc" là tự mở lại lỗ hổng vote.

**Căn nguyên:** có hai nguồn sự thật cho cùng một schema (file tổng + migration), quy ước
"append verbatim" chỉ được giữ ở một chỗ; không có test nào so hai nguồn với nhau.

**Quy luật:** Lần sau có file cài đặt lại được (schema, config, manifest), tôi (a) chốt
một nguồn sự thật duy nhất hoặc append *verbatim* + test so khớp, (b) thêm đúng test
"file tổng phải chứa khối siết" bên cạnh — lệch là đỏ (`backup.test.js`, `voteHardening.test.js`
là mẫu). Không tin dòng comment "chạy lại an toàn" khi chưa có test chứng minh.

---

## 2026-09-29 — `transition: all` mọc ngược từ những lần bảo trì vô tội

**Tín hiệu:** quét CSS tháng 9 còn **7 chỗ** `transition: all` — đều nằm ở khu bình luận
và nút phụ, nơi được thêm *sau* khi phần chính đã viết đúng luật.

**Căn nguyên:** `transition: all` không có gì để "sửa" khi thêm thuộc tính mới vào rule —
nó âm thầm nhận luôn thuộc tính mới (kể cả layout), nên lỗi không sinh ra ở lần vi phạm
đầu tiên mà ở lần bảo trì thứ N. Luật miệng không chặn được điều này.

**Quy luật:** Lần sau viết/sửa CSS có transition, tôi liệt kê đúng thuộc tính đang đổi,
và luật này phải sống trong **test tự động** chứ không trong trí nhớ
(`src/lib/cssTransitionScope.test.js` — quét mọi `.css`, bỏ qua comment, đỏ khi có
`transition: all` / `will-change: all`).
