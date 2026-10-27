# Chaereve — Color Coded Lyrics Request & Voting Board

Ứng dụng web gửi yêu cầu bài hát (Song Request), bình chọn theo thời gian thực (Voting + Vote-back), điểm danh hằng ngày (Daily Login), mở hộp quà (Daily Box / Mystery Box), vòng quay may mắn (Daily Spin), và bảng quản trị tiến độ sản xuất video cho kênh **Chaereve**.

---

## Kiến trúc tổng quan (Architecture)

- **Frontend (`src/`):** React 19 + Vite 8 SPA. Tự động chạy ở **Demo Mode** (dữ liệu mẫu trong `localStorage`) khi chưa cấu hình biến môi trường Supabase, hoặc kết nối thật với **Supabase Auth + PostgreSQL + Realtime** khi có `.env`.
- **Edge Gateway & SSR (`functions/` + `worker/`):**
  - Chạy chính thức trên **Cloudflare Pages Functions** (`functions/api/*` và `functions/archive.js`), dùng chung một nguồn logic duy nhất trong `worker/` (`index.js`, `shield.js`, `d1-shield.js`, `driveVideo.js`) để tương thích 1:1 với Cloudflare Workers (`wrangler.jsonc`).
  - Bảo vệ các thao tác nhạy cảm (`/api/daily-spin/spin`, `/api/vote/cast`, `/api/mystery/open`, `/api/drive-video/*`) bằng Turnstile siteverify, rate-limit theo vân tay trên Cloudflare D1 (`RATE_SHIELD`, fallback KV `SPIN_SHIELD`, không bao giờ lưu IP thô), và khoá uỷ quyền `EDGE_GATE_TOKEN` tới PostgREST RPC.
  - Trang lưu trữ SEO `/archive` được render phía server (SSR HTML, không cần JS phía trình duyệt). Trong môi trường dev/preview cục bộ, `vite.config.js` tự động nối cầu (bridge) cả `/api/*` lẫn `/archive`.
- **Database & Migrations (`supabase/` + `tools/`):**
  - `supabase/schema.sql` và `supabase/setup/01..16.sql`: gói cài đặt mới ở mốc baseline `20261120`.
  - `supabase/migrations/`: 65 migration đang hoạt động (tới `20261222_achievement_pick_fix.sql`); bản `20261118` đã bị cách ly (quarantine) vĩnh viễn và cấm chạy để bảo toàn lịch sử điểm danh.
  - `tools/migrate.mjs`: bộ kiểm tra tĩnh, xác minh baseline, lập kế hoạch (`--plan`) và triển khai có khoá an toàn (`--apply`).

---

## Khởi chạy nhanh (Quickstart)

Yêu cầu **Node.js 22+**.

```bash
# 1. Cài đặt phụ thuộc
npm ci

# 2. Chạy dev server (http://localhost:5173 — mặc định chạy Demo Mode nếu chưa có .env)
npm run dev
```

Để nối với Supabase / Cloudflare Turnstile thật ở máy local, sao chép `.env.example` sang `.env` và điền các khoá công khai `VITE_*` (xem hướng dẫn chi tiết từng biến trong `.env.example` và `HUONG-DAN.md`). **Tuyệt đối không đặt khoá bí mật (`TURNSTILE_SECRET_KEY`, `EDGE_GATE_TOKEN`, `SUPABASE_DB_URL`, `sb_secret_...`) vào biến `VITE_*`.**

---

## Các lệnh kiểm tra & vận hành chính (Scripts)

| Lệnh | Mục đích |
| --- | --- |
| `npm run dev` | Chạy Vite dev server cổng `5173` (kèm bridge `/api/*` và `/archive`) |
| `npm run build` | Dựng bản production vào `dist/` |
| `npm run preview` | Xem thử bản build tĩnh ở cổng `4173` (kèm bridge `/api/*` và `/archive`) |
| `npm run lint` | Kiểm tra mã nguồn bằng `oxlint` |
| `npm test` | Chạy toàn bộ unit, contract & Edge tests (`src/`, `supabase/tests/`, `worker/`, `tools/`) |
| `npm run smoke` | Dựng bản build và chạy kiểm thử tích hợp DOM (`jsdom`) cho toàn bộ luồng giao diện |
| `npm run db:check` | Kiểm tra tĩnh chuỗi migration, quarantine manifest và tính nguyên vẹn của baseline |
| `npm run schema:split:check` | Xác nhận các mảnh `supabase/setup/*.sql` khớp từng byte với `supabase/schema.sql` |
| `npm run test:free-votes:pglite` | Kiểm thử chuỗi free-votes trên PostgreSQL WASM (PGlite) |
| `npm run test:ledger:pglite` | Kiểm thử sổ cái thưởng & chuỗi điểm danh B1 trên PGlite |
| `npm run test:mystery:pglite` | Kiểm thử Mystery Box B2 trên PGlite |
| `npm run test:spinv2:pglite` | Kiểm thử Daily Spin v2 B3 trên PGlite |
| `npm run test:voteback:pglite` | Kiểm thử hoàn phiếu 10% (Vote-back B4) trên PGlite |
| `npm run test:migration:pglite` | Kiểm thử trình chạy migration end-to-end trên PGlite |
| `npm run db:plan` | Xem trước kế hoạch migration trên database (`SUPABASE_DB_URL`, chỉ đọc) |
| `npm run db:deploy` | Áp các migration còn thiếu lên database sau khi đã duyệt `db:plan` |
| `npm run backup:db` | Dump database + sinh dấu vân tay đối soát vào `backup/` |
| `npm run backup:verify` | Thử phục hồi bản dump vào một PostgreSQL sạch và đối chiếu dấu vân tay |

---

## Tài liệu chi tiết trong kho mã

- `HUONG-DAN.md`: Cẩm nang vận hành, cấu hình Supabase, Cloudflare Pages/D1/Turnstile, thanh toán QR, và sao lưu tự động.
- `docs/DB-MIGRATIONS.md`: Quy trình quản lý migration, baseline `20261120`, và cách dùng `tools/migrate.mjs`.
- `supabase/setup/README.md`: Hướng dẫn khởi tạo database mới từ các file chia nhỏ `supabase/setup/01..16.sql`.
