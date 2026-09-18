# Gói 2 — Cache tài nguyên (`_headers`)

**Gửi gì:** dán toàn bộ file này làm tin nhắn, đính kèm các file trong `kem-theo/`.

---

## BỐI CẢNH DỰ ÁN

Web `chaereve.pages.dev` — bảng yêu cầu video colour-coded lyrics.
Stack: React 19 + Vite 8 + CSS thuần. **Deploy production: Cloudflare Pages** (nối GitHub,
tự chạy `npm run build` mỗi lần push → thư mục `dist/`).

Repo còn 2 đường deploy khác **không phải production**, chỉ là phương án thay thế:
- `wrangler.jsonc` — Cloudflare Workers with Static Assets (`wrangler deploy`)
- `vercel.json` — Vercel

## SỐ ĐO HIỆN TẠI (đo thật trên bản deploy)

```
$ curl -sI https://chaereve.pages.dev/assets/index-XXXX.css
cache-control: public, max-age=0, must-revalidate      ← vấn đề
content-encoding: br                                    ← nén Brotli: OK
HTTP/2 200                                              ← HTTP/2: OK

$ curl -sI https://chaereve.pages.dev/fonts/bvp-400.woff2
cache-control: public, max-age=0, must-revalidate       ← vấn đề
```

Tên file trong `/assets/` do Vite sinh **đã có hash nội dung** (`index-CQFtwVv_.js`) → đổi code là
đổi tên file → **cache 1 năm là an toàn tuyệt đối**, không bao giờ phục vụ bản cũ.
Hiện tại đang để `must-revalidate` nên **mỗi lần vào lại phải hỏi máy chủ** (nhận 304), chậm hơn
mức cần thiết và bỏ phí hoàn toàn cơ chế hash.

---

## VIỆC CẦN LÀM

Tạo file **`public/_headers`** (không có phần mở rộng). Cloudflare Pages đọc file này ở gốc thư mục
output — ở repo này là `public/_headers` (Vite copy nguyên `public/` sang `dist/`).

Nội dung cần đạt:

| Đường dẫn | `Cache-Control` | Vì sao |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | tên có hash nội dung |
| `/fonts/*` | `public, max-age=31536000, immutable` | 6 file woff2, hiếm khi đổi |
| `/icons/*` | `public, max-age=604800` | icon PWA, đổi ít nhưng không có hash → 7 ngày |
| `/manifest.webmanifest` | `public, max-age=3600` | |
| `/` (và mặc định) | `public, max-age=0, must-revalidate` | để lần deploy sau nhận bản mới |

**Quan trọng — không được cache:**
- `/api/*` — Pages Functions (lá chắn chống farm cho Daily Spin và Vote). Cache là **hỏng tính năng**.
- `index.html` — phải luôn mới, nếu không người dùng kẹt ở bản cũ và không nhận JS/CSS mới.
- `/sw.js` nếu sau này có service worker (hiện chưa có).

## ĐỊNH DẠNG TRẢ LỜI MONG MUỐN

1. **Nội dung `public/_headers`** nguyên văn, đúng cú pháp Cloudflare Pages (mỗi đường dẫn một
   dòng, dòng sau thụt lề 2 dấu cách cho header). Kiểm tra kỹ: Cloudflare yêu cầu **đường dẫn
   bắt đầu bằng `/`** và **không dùng ký tự đại diện kiểu `**`**.
2. **Giải thích ngắn**: vì sao `immutable` an toàn ở đây, và vì sao `/api/*` không được cache.
3. **Câu lệnh kiểm tra** sau khi deploy để tôi tự chạy (dùng `curl -sI`).
4. **Trả lời rõ 1 câu hỏi**: nếu sau này tôi muốn thêm service worker để chạy offline thì phần
   cache trong SW và `_headers` có chồng nhau không, và nên để cái nào quyết định?

## RÀNG BUỘC

- Chỉ thêm **1 file mới**. Không sửa `vercel.json`, không sửa `wrangler.jsonc`, không sửa
  `public/_redirects`, không sửa `public/_routes.json` (chúng phục vụ đường deploy khác).
- Không đổi tên thư mục `assets/` hay `fonts/` — Vite và các thẻ `<link rel="preload">` trong
  `index.html` đang trỏ vào đúng các đường dẫn đó.
- Không cài thêm plugin/service worker ở bước này.
