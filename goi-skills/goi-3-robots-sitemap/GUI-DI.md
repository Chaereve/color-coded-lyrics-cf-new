# Gói 3 — `robots.txt` + `sitemap.xml`

**Gửi gì:** dán toàn bộ file này làm tin nhắn, đính kèm các file trong `kem-theo/`.

---

## BỐI CẢNH DỰ ÁN

Web `chaereve.pages.dev` — bảng yêu cầu video colour-coded lyrics.
Stack: React 19 + Vite 8, SPA dùng **đường dẫn thật** (không phải dấu `#`), deploy Cloudflare Pages.

Chủ dự án **muốn Google index được** — HUONG-DAN của repo ghi rõ: *"Dùng đường dẫn thật chứ không
phải dấu `#`, nên link nhìn sạch và Google index được."*

## SỐ ĐO HIỆN TẠI (đo thật)

```
$ curl -s -o /dev/null -w "%{http_code}" https://chaereve.pages.dev/robots.txt   → 200
$ curl -s -o /dev/null -w "%{http_code}" https://chaereve.pages.dev/sitemap.xml  → 200

# nhưng nội dung KHÔNG phải file thật:
$ curl -s https://chaereve.pages.dev/robots.txt | head -2
<!doctype html>            ← trả về index.html
```

Tức **mọi URL không tồn tại đều trả `index.html` + 200** (soft-404). Hệ quả:
- Không có robots.txt / sitemap.xml thật.
- Google có thể thu thập vô số URL rác, tất cả đều "200 OK" nên không tự loại được.
- `index.html` **chưa có** thẻ `<link rel="canonical">` và chưa có `<meta name="robots">`.

## 4 ROUTE CẦN KHAI (nguồn: `ROUTES` trong `src/App.jsx`, trích trong `kem-theo/`)

| Đường dẫn | Tiêu đề tab (do JS đặt) |
|---|---|
| `/` | `Chaereve — Request Page` |
| `/daily-spin` | `Daily Spin · Chaereve` |
| `/ranking` | `Xếp hạng — Color Coded Lyrics` |
| `/profile` | `Của tôi — Color Coded Lyrics` |

Tiêu đề được đặt bằng JS ở `src/App.jsx` (`document.title = section === 'board' ? … : \`${t(\`nav.${section}\`)} · Chaereve\``),
nên **`index.html` chỉ có 1 tiêu đề chung** cho mọi route.

---

## VIỆC CẦN LÀM

1. **`public/robots.txt`** — cho phép index 4 đường dẫn trên, **chặn `/api/`** (Pages Functions là
   lá chắn chống farm, không có gì để index), và ghi dòng `Sitemap:` trỏ tới
   `https://chaereve.pages.dev/sitemap.xml`. Dùng `User-agent: *` và `Allow: /`.
2. **`public/sitemap.xml`** — đúng 4 `<url>`, mỗi cái có `<loc>` (đường dẫn tuyệt đối,
   `https://chaereve.pages.dev/…`), `<lastmod>` là ngày hôm nay (2026-09-18),
   `<changefreq>` và `<priority>` hợp lý cho một bảng yêu cầu cập nhật thường xuyên.
   Đúng chuẩn `http://www.sitemaps.org/schemas/sitemap/0.9`.
3. **`index.html`** — thêm **1 dòng** `<link rel="canonical" href="https://chaereve.pages.dev/" />`.
   Vì đây là SPA, canonical cho từng route phải do JS đặt — hãy **nói rõ** trong câu trả lời cách
   làm đúng (gợi ý: cập nhật thẻ canonical trong cùng `useEffect` đang đặt `document.title` ở
   `src/App.jsx`), nhưng **chưa cần viết code JSX ở bước này** — tôi sẽ quyết sau.

## ĐỊNH DẠNG TRẢ LỜI MONG MUỐN

1. Nội dung nguyên văn `public/robots.txt`.
2. Nội dung nguyên văn `public/sitemap.xml`.
3. Dòng cần thêm vào `index.html` + đặt ở vị trí nào (kèm 1 dòng comment tiếng Việt giải thích
   *vì sao* cần canonical — theo giọng comment trong file `index.html` đính kèm).
4. **Cảnh báo giúp tôi**: vì mọi URL lạ đều trả 200 + `index.html`, có cách nào để Google biết
   một URL là 404 thật không (SPA + Cloudflare Pages)? Nếu phải sửa `functions/` hoặc viết
   `_routes.json` thì nói rõ — tôi muốn biết trước khi làm.
5. Lệnh `curl` để tôi tự kiểm tra sau khi deploy.

## RÀNG BUỘC

- Chỉ thêm file mới trong `public/` + **1 dòng** trong `index.html`. Không sửa `_redirects`,
  `_routes.json`, `wrangler.jsonc`, `vercel.json`.
- Không thêm thư viện, không đổi cơ chế route trong `src/App.jsx` ở bước này.
- Không đặt `noindex` — chủ dự án muốn được index.
