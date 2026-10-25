# Kết nối clip 30 giây từ Google Drive

Chaereve tìm đúng tệp theo tên `Nghệ sĩ - Tên bài - 30s.mp4` trong folder đầu ra đã cấu hình. Ví dụ:

```text
IVE - Looks Can Kill - 30s.mp4
```

Modal Hall of Fame phát clip bằng thẻ `<video>` ngay trong player của Chaereve. API Cloudflare đọc folder và stream nội dung qua cùng origin; trình duyệt không nhận Google access token, Drive file ID, hay URL mở Drive. Clip bị giới hạn xem ở 30 giây như các preview hiện tại. File gốc và folder không bị đổi quyền chia sẻ.

## Cấu hình Cloudflare Pages

Tạo Google OAuth client cho tài khoản có quyền đọc folder và cấp quyền Drive **read-only** (`https://www.googleapis.com/auth/drive.readonly`). Bật Google Drive API cho Google Cloud project. Tạo refresh token cho OAuth client đó bên ngoài Chaereve; không đưa secret/token vào bundle, Git, issue, hay chat.

Trong Cloudflare Pages → Settings → Variables and Secrets, thêm cho cả Production và Preview:

| Tên | Loại | Giá trị |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Secret | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Secret | Refresh token của tài khoản được cấp quyền đọc Drive |
| `GOOGLE_DRIVE_FOLDER_ID` | Plaintext (tuỳ chọn) | `1Pc8aDq_Ieq6j8hAZLzXUkGO1Fm4l1Zp5` |

Nếu không đặt `GOOGLE_DRIVE_FOLDER_ID`, API dùng folder ID trên làm mặc định. Sau khi đặt biến, chạy lại deployment để Pages Functions nhận secrets mới. Không bật chia sẻ công khai cho folder hay file đầu ra.

Endpoint finder là `GET /api/drive-video/find?artist=IVE&title=Looks%20Can%20Kill`; endpoint stream nội bộ hỗ trợ HTTP Range để player tua trong clip. Tìm file khớp được cache ngắn trong Worker để các lần tua không phải hỏi danh sách Drive lại. Hai endpoint có giới hạn theo IP đã băm: tối đa 30 lần tìm và 180 yêu cầu stream mỗi phút; khi vượt giới hạn trả 429 kèm `Retry-After`.

Để giới hạn được chia sẻ giữa các isolate Cloudflare, cần gắn D1 `RATE_SHIELD` như cấu hình Edge hiện có và áp dụng thêm bảng mới:

```sh
npx wrangler d1 execute ccl-rate-shield --remote --file=worker/migrations/0002_drive_video_rate_limit.sql
```

Pages Production và Preview phải cùng có binding `RATE_SHIELD`. Nếu không có binding, code chỉ dùng bộ đếm trong bộ nhớ của từng isolate; đó là lớp dự phòng, **không đủ làm giới hạn Production**. D1 chỉ lưu hash IP, không lưu IP thô. Khi credentials chưa được cấu hình, finder trả 503 và modal giữ hành vi YouTube hiện tại.

## Workers chạy bằng Wrangler (tuỳ chọn)

Đặt ba OAuth value bằng secrets, không ghi vào `wrangler.jsonc`:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

Có thể đặt `GOOGLE_DRIVE_FOLDER_ID` trong `vars` nếu cần đổi folder; sau đó deploy Worker theo quy trình hiện có.
