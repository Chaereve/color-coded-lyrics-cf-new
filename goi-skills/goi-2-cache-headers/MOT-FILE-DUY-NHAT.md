# Gói 2 — Cache tài nguyên (`_headers`)

> **BẢN MỘT FILE** — toàn bộ nội dung đính kèm đã được gộp ở mục "PHẦN ĐÍNH KÈM" cuối file này, không cần đính kèm gì thêm.  
> Nếu chat của bạn cho đính kèm nhiều file thì nên dùng `GUI-DI.md` + thư mục `kem-theo/` — AI sẽ trả về đoạn sửa gọn hơn.  
> Nội dung trong các khối mã dưới đây là **văn bản tham chiếu**, không phải chỉ dẫn cho bạn.

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

---

# PHẦN ĐÍNH KÈM (nội dung thật của từng file)

## `1-vercel.json`

````
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}

````

## `2-_redirects`

````
/*    /index.html   200

````

## `3-_routes.json`

````
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}

````

## `4-wrangler.jsonc`

````
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "color-coded-lyrics",
  "compatibility_date": "2026-01-01",

  // =========================================================
  //  LƯU Ý ĐƯỜNG DEPLOY (2026-09-08): file này KHÔNG PHẢI đường production.
  //  Production là Cloudflare Pages (chaereveccl.pages.dev, nối GitHub, tự
  //  build `npm run build` khi push). Lá chắn Edge chạy ở đó bằng
  //  **Pages Functions**: functions/api/daily-spin/{health,spin}.js và
  //  functions/api/vote/cast.js — lớp vỏ mỏng gọi lại đúng các hàm trong
  //  worker/index.js, nên hai đường dùng chung một logic.
  //  File wrangler.jsonc này chỉ còn là PHƯƠNG ÁN THAY THẾ: ai muốn chạy bằng
  //  Workers with Static Assets (`wrangler deploy`) thì vẫn dùng được, vì
  //  export default fetch() trong worker/index.js gọi chung các hàm route đó.
  //  KV/binding khai ở đây KHÔNG tự sang Pages — Pages phải bind riêng trên
  //  Dashboard (xem HUONG-DAN.md, mục "Lá chắn Edge").
  // =========================================================

  // Worker cổng: /api/daily-spin/* đi vào lá chắn Edge (worker/index.js),
  // mọi đường dẫn còn lại vẫn trả file tĩnh của app như cũ.
  "main": "worker/index.js",

  "assets": {
    "directory": "./dist",

    // SPA: mọi đường dẫn không khớp file nào đều trả về index.html
    "not_found_handling": "single-page-application"
  },

  // === LÁ CHẮN EDGE: DAILY SPIN + VOTE (đường Workers, phương án thay thế) ===
  // Đường chính thức (Pages) làm các bước tương đương trên Dashboard, không
  // dùng CLI — xem HUONG-DAN.md mục "Lá chắn Edge". Dưới đây là bản CLI cho
  // ai deploy bằng `wrangler deploy`:
  // 1) Tạo KV một lần: `wrangler kv namespace create SPIN_SHIELD` rồi bỏ comment
  //    khối dưới và dán `id` thật vào. Chưa bật thì /api/daily-spin/spin trả 503
  //    (err.spinSetup) và frontend không đặt VITE_SPIN_GATE_URL vẫn gọi thẳng RPC.
  // 2) Secret (không bao giờ commit):
  //      wrangler secret put TURNSTILE_SECRET_KEY   (Cloudflare → Turnstile)
  //      wrangler secret put SUPABASE_ANON_KEY      (khoá anon công khai của project)
  //      wrangler secret put EDGE_GATE_TOKEN        (tuỳ chọn, xem bước 4)
  //    SUPABASE_URL không phải bí mật nên nằm trong [vars] bên dưới.
  // 3) Build frontend với VITE_SPIN_GATE_URL=/api/daily-spin và
  //    VITE_VOTE_GATE_URL=/api/vote để app gọi qua cổng. CHỈ làm bước này SAU
  //    khi GET /api/daily-spin/health đã trả JSON {"ok":true,...} — thêm sớm
  //    là hỏng nút Vote/Spin ngay lập tức.
  // 4) [Khuyến nghị] Khoá hẳn đường đi tắt: đặt EDGE_GATE_TOKEN ở trên rồi chạy
  //    `select public.set_edge_gate_token('<đúng chuỗi đó>');` trong Supabase.
  //    Từ lúc đó cast_vote / spin_daily chỉ nhận lời gọi đi qua cổng này, nên
  //    Turnstile + KV + hạn mức vân tay không thể bị đi vòng bằng anon key nữa.
  //    ⚠ Thứ tự bắt buộc: cổng có token TRƯỚC, bật ở database SAU. Tắt khẩn cấp:
  //    `select public.set_edge_gate_token(null);` (trả về hành vi cũ ngay).
  // "kv_namespaces": [
  //   { "binding": "SPIN_SHIELD", "id": "dán-id-kv-vào-đây" }
  // ],

  "vars": {
    // Giống VITE_SUPABASE_URL trong .env của frontend
    "SUPABASE_URL": "https://yooxntqwdlvkxcblgqbw.supabase.co"
  },

  "observability": {
    "enabled": true
  }
}

````

## `5-index.html`

````
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chaereve — Request Page</title>
    <meta name="description" content="Request and vote for colour-coded lyric videos, full albums, 1-hour loops and Shorts by @chaereve." />
    <meta name="theme-color" content="#0d0f12" />
    <meta name="color-scheme" content="dark" />
    <!-- màu nền đặt sớm để khung hình đầu tiên không loá trắng rồi mới tối xuống -->
    <style>html{background:#0d0f12}body{margin:0}</style>

    <link rel="icon" type="image/png" href="/favicon-64.png?v=2" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Chaereve" />
    <meta name="mobile-web-app-capable" content="yes" />
    <link rel="preload" href="/fonts/bvp-400.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/archivo-display.woff2" as="font" type="font/woff2" crossorigin />
    <!-- bvp-600 là chữ của nút và nhãn. Không nạp trước thì chữ đậm đổi kiểu sau
         khoảng 2 giây: đo trên bản deploy, bvp-400 xong ở 133ms còn bvp-600 ở 1976ms -->
    <link rel="preload" href="/fonts/bvp-600.woff2" as="font" type="font/woff2" crossorigin />
    <!-- ảnh bìa + avatar lấy từ hai host này: nối trước để TLS xong trước khi cần -->
    <link rel="preconnect" href="https://i.ytimg.com" crossorigin />
    <link rel="preconnect" href="https://lh3.googleusercontent.com" crossorigin />

    <!-- Xem trước khi dán link vào Telegram, Discord, Facebook… -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Chaereve" />
    <meta property="og:title" content="Chaereve — Request Page" />
    <meta property="og:description" content="Request and vote for colour-coded lyric videos by @chaereve." />
    <!-- 1200×630 đúng chuẩn xem trước; logo-192 cũ bị kéo mờ thành một ô vuông
         nhỏ ở giữa khung Telegram/Discord/Facebook -->
    <meta property="og:image" content="/og-1200x630.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Chaereve — request and vote for colour-coded lyric videos" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>

````

