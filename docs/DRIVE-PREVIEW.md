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

Pages Production và Preview phải cùng có binding `RATE_SHIELD`. Nếu không có binding, code chỉ dùng bộ đếm trong bộ nhớ của từng isolate; đó là lớp dự phòng, **không đủ làm giới hạn Production**. D1 chỉ lưu hash IP, không lưu IP thô. Nếu deployment cũ đã gắn D1 nhưng thiếu riêng bảng `drive_video_rate_limits`, API tự tạo bảng theo migration 0002 rồi thử lại bộ đếm đúng một lần. Các lỗi D1 khác vẫn chặn yêu cầu (503), không bỏ qua rate limit. Khi credentials chưa được cấu hình, finder trả 503; modal báo lỗi kết nối và vẫn cho dùng YouTube thay thế.

## Workers chạy bằng Wrangler (tuỳ chọn)

Đặt ba OAuth value bằng secrets, không ghi vào `wrangler.jsonc`:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

Có thể đặt `GOOGLE_DRIVE_FOLDER_ID` trong `vars` nếu cần đổi folder; sau đó deploy Worker theo quy trình hiện có.

## Chẩn đoán “có file nhưng web không nhận”

Mở `/api/drive-video/find?artist=KickFlip&title=Band-Aid` trên **đúng domain đang lỗi** (Production và Preview có cấu hình riêng). Sau bản sửa này, API phân biệt:

| HTTP / `error` | Ý nghĩa / xử lý |
|---|---|
| 200 / `url` | Đã tìm thấy file. Nếu player lỗi, xem request `/stream` và codec của MP4. |
| 404 / `clip_not_found` | Không tìm thấy MP4 đúng tên trong folder mà tài khoản OAuth của **web** nhìn thấy. Kiểm tra folder ID, tên và quyền đọc. |
| 503 / `drive_not_configured` | Thiếu một trong ba biến `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` trên Pages. Đặt trong Dashboard và redeploy. |
| 503 / `drive_auth_failed` | Không đổi được refresh token thành access token. Kiểm tra OAuth client/token, cấp lại quyền nếu token bị thu hồi/hết hạn. |
| 502 / `drive_access_denied` | Google từ chối đọc Drive. Kiểm tra Drive API đã bật, scope `drive.readonly`, và tài khoản có quyền đọc folder/file. |
| 503 / `drive_rate_limit_unavailable` | D1 lỗi hoặc không tạo được bảng preview. Kiểm tra binding và áp migration 0002 nếu cần. |
| 429 / `rate_limited` | Đợi theo `Retry-After` trước khi thử lại. |
| 502 / `drive_unavailable` | Lỗi mạng, timeout hoặc phản hồi Google không hợp lệ; không đồng nghĩa file bị thiếu. |

Kết nối Google Drive trong Arena chỉ giúp kiểm tra file; **không tự cấu hình OAuth cho Cloudflare Pages**. Không gửi token/secret qua chat và không bật public cho file để chữa lỗi này.

Modal chỉ coi `404 clip_not_found` là không có clip. Lỗi dịch vụ có thông báo và nút **Retry clip**, lookup có timeout, và lỗi phát stream chuyển sang video gốc kèm thông báo thay vì để player đen.
