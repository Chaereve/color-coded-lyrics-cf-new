# Giấy phép font

Toàn bộ font dùng trong dự án đều theo **SIL Open Font License 1.1 (OFL)**.

OFL cho phép: dùng cho mục đích thương mại, nhúng vào website, sửa đổi, phân phối lại —
**miễn phí, không cần xin phép, không cần ghi công trên trang**.
Điều kiện duy nhất: không bán lại chính file font, và giữ nguyên phần khai báo bản quyền
bên trong file. Cả hai điều này dự án đều đang tuân thủ.

| File | Font | Bản quyền | Kho phát hành gốc |
|---|---|---|---|
| `bvp-400/500/600/700.woff2` | Be Vietnam Pro | Copyright 2021 The Be Vietnam Pro Project Authors | https://github.com/bettergui/BeVietnamPro |
| `jetbrains-mono.woff2` | JetBrains Mono 2.305 | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono |
| `archivo-display.woff2` | Archivo | Copyright 2020 The Archivo Project Authors | https://github.com/Omnibus-Type/Archivo |

Toàn văn giấy phép: `OFL.txt` trong cùng thư mục, hoặc https://scripts.sil.org/OFL

## Các file đã được xử lý lại

Font gốc được cắt gọn để giảm dung lượng, OFL cho phép việc này:

- **Be Vietnam Pro** — cắt còn latin + tiếng Việt, 4 nét 400/500/600/700.
- **JetBrains Mono** — giữ trục độ đậm 100–800, cắt còn latin + tiếng Việt.
- **Archivo** — ghim bề rộng 110 và độ đậm 700, cắt còn latin + tiếng Việt.

**DM Sans đã bị loại** vì chỉ có 38/132 ký tự tiếng Việt.

Phần khai báo bản quyền và giấy phép bên trong mỗi file đều được giữ nguyên
(name ID 0, 13, 14) — kiểm tra được bằng bất kỳ công cụ đọc font nào.

## Font đã bị loại bỏ

**Halvar Breit** (TypeMates) là font **thương mại**, dùng cho dự án có doanh thu là phải
mua giấy phép. Đã thay bằng Archivo.
