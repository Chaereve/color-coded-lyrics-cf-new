# Đã làm gì, và còn gợi ý gì — tất cả trong gói miễn phí

Cập nhật 22/09/2026 · nhánh `arena/01a0c8a3-color-coded-lyrics-cf-new` · **số kiểm thử mới nhất
nằm ở cuối file** (phần XIV — vòng 24: `npm test` 468 ca, `npm run smoke` 332/332); các con số
ngay dưới đây là của mốc 19/09
So với mốc đầu phiên (`bc65c01`): **~90 file, +10 300 dòng**, `npm test` **333 ca — 332 đạt / 0 lỗi / 1 skip**,
`npm run smoke` **58/58 mục đạt** (dựng thật cả app trong jsdom rồi bấm thử, xem mục **J** và **K**),
`npx oxlint` **0 lỗi**. Bản dựng hiện tại: `index-BxQ09EV7.js` 359 kB.

> **Đã làm tiếp (cùng ngày):** mục **C1-1 (sao lưu database)** và **cả ba việc ở C1-2/3/4** nay đã
> xong — xem phần *F. Đã làm tiếp* ở cuối file.

---

## A. Đã làm

### A1. Sửa lỗi thật (không phải tô điểm)

| Lỗi | Ai nhìn thấy | Cách sửa |
|---|---|---|
| `.tabs` có `overflow: hidden` + 6 tab | Trên màn 390px, tab **Completed** (và **Following** khi đang theo dõi) **bị cắt mất, không cách nào bấm tới** | Cho dải tab tự cuộn ngang ở bản hẹp |
| `og:image` là đường dẫn tương đối `/logo-192.png` | Dán link lên Telegram/Discord/Facebook **không có ảnh xem trước** (crawler đọc HTML thô, không có origin để ghép) | URL tuyệt đối + `og:url`, `twitter:title/description/image`, kích thước, `og:image:alt` |
| `privacy.html` giữ bản sao token cũ | Màu nhấn còn xanh dương cũ; `--txt-3` còn đúng màu mà app đã phải đổi vì **chỉ đạt 3.9:1, trượt WCAG AA** | Chép đúng `:root`, link dùng `--a-2`, nạp thêm nét 500 |
| `manifest.background_color: #0b0d10` | Lệch ở đúng chỗ người dùng thấy khi mở app từ màn hình chính (app dùng `#0d0f12`) | Sửa về `#0d0f12` |
| `robots.txt` tự mâu thuẫn | Comment ghi tên miền **không phải** `chaereve.pages.dev`, dòng `Sitemap:` ngay dưới lại trỏ vào đó | Comment nói đúng + danh sách 4 chỗ phải sửa cùng nhau khi đổi tên miền |
| 6 nút chỉ có `title` (dấu ×, ↑, ↓) | Trình đọc màn hình đọc ra **nút trống** | Thêm `aria-label` cùng chuỗi |
| Thanh âm lượng chạy `width: 0 → 64px` | Chữ *"Âm thanh"* bên cạnh **bị bóp rồi giãn** mỗi lần rê chuột (animate thuộc tính layout) | Giữ nguyên 64px, chỉ đổi `opacity` |
| Ô sáng sidebar + vạch tiến độ cuộn | Animate `height` / `width` — bắt trình duyệt tính lại layout | Bỏ `height` thừa; vạch dùng `transform: scaleX` |
| `HUONG-DAN.md` ghi nhịp so le **28ms** (CSS là 40ms), ghi *"còn đúng 2 box-shadow"*, ghi màu nhấn là "xanh dương" | Tài liệu dạy sai người sửa sau | Sửa cả ba; nay là **32ms, chặn 10 nhịp**, ultramarine `#2b22e2` |
| Lỗi tự gây ra: chú thích đặt **giữa danh sách prop** JSX | `propContract.test.js` đọc chữ trong comment thành tên prop → báo "dây đứt" oan | Chuyển chú thích lên TRƯỚC thẻ, ghi lại trong tài liệu |
| Lỗi tự gây ra: `params.get('add')` so với chuỗi rỗng | Tham số **trần** (`?add`) trả về chuỗi rỗng → âm thầm bỏ qua đúng loại link người ta hay gõ tay nhất | Đọc bằng `has()` rồi mới xét giá trị; thêm ca kiểm thử cho `?add` trần |
| `[plugin:vite:oxc]` báo lỗi ở `src/App.jsx:836` | Cả trang dev **không mở được** (overlay đỏ) sau một lần sửa khối `counts` | Thừa một dấu `)` ở đuôi `useMemo` + một dep đã cũ (`stage`) còn sót; sửa, và ghi lại mẹo: sau mỗi lần sửa khối đó phải soi đúng đuôi `}), [deps])` |
| Huy hiệu **In progress** đếm một đằng, tab liệt kê một nẻo | Người dùng thấy số **1** mà danh sách có **2** bài — sai ngay ở chỗ họ đang nhìn | Cả bốn giai đoạn đi qua **một** hàm `stageCounts()`; huy hiệu lấy đúng tập mà tab liệt kê, ô thống kê lấy đúng con số giai đoạn; `src/lib/boardSync.test.js` chốt lại cả hai |
| Render ném lỗi → **trang đen** (chủ dự án gặp thật) | React 19 gỡ sạch cây DOM khi render ném lỗi. Bản đầu mình thêm **hai lưới an toàn** (màn lỗi trong React + `.bootfail` sau 8 giây ở `index.html`) — **đã gỡ cả hai (19/09/2026)**: lưới đó biến MỘT lỗi render thành khối đen che hết trang, chủ dự án phải xoá tay class ngay trên trình duyệt mới dùng được web | Nay lỗi chỉ ghi ra console (`[ccl] …`, xem `src/main.jsx`), lỗi nghiệp vụ vẫn đi toast đỏ. Thứ thật sự chặn "trang đen" là **dữ liệu bẩn không được làm vỡ render**: `statusColor()` / `kindCls()` luôn trả kết quả, `board.js` lọc dòng rác, và `src/lib/renderGuard.test.js` chốt lại cả hai — kèm điều cấm dựng lại lưới cũ. Bản xem trước trong sandbox vẫn phục vụ **`dist/` dựng sẵn** (`vite preview`) chứ không phải vite dev, vì proxy của môi trường chặn WebSocket của `/@vite/client` |

### A2. Chuyển động — bớt đi, và bớt đúng chỗ

Theo `kylezantos/design-motion-principles` (cổng tần suất của Emil Kowalski: *thao tác càng lặp nhiều thì chuyển động càng phải ít và nhanh*):

| Chỗ | Trước | Sau |
|---|---|---|
| Ba tầng easing | `--e-pop` (nảy) dùng cho công tắc, toast, nút điều hướng | `--e-pop` **chỉ còn cho khoảnh khắc ăn mừng** (bục xếp hạng, vòng quay); còn lại dùng `--e-out` / `--e-soft` |
| Bốn mục sidebar | Trượt vào lệch 45ms mỗi lần mở trang | Đứng yên (sidebar đứng yên suốt phiên) |
| Bốn ô thống kê | Tự chạy `rowIn` lệch 60ms | Không chạy nữa — khối cha đã có `[data-reveal]` |
| Tiêu đề trang | Kéo ra bằng `clip-path` mỗi lần đổi mục | Mờ dần + nhích 6px. Chữ là nội dung **tĩnh** |
| Nhấp nhô khi rê | Hầu hết mọi thứ đều nhấc/phóng | Còn **đúng hai**: nút hành động chính + khung video chính |
| Đồng hồ "quá mốc" | Nhấp nháy vô hạn 1,6s | Đổi màu + một chấm tĩnh |
| Vệt sáng thanh tiến độ | **Mọi** hàng "đang làm" (10 bài = 10 vòng lặp vô hạn) | Chỉ khối Up next, và chỉ khi thật sự có bài đang chạy (`nowbar.live`) |
| Nhịp so le danh sách | 40ms/hàng, không chặn (hàng 12 phải chờ ~0,5s) | **32ms/hàng, chặn ở 10 nhịp** |
| Khoảnh khắc ăn mừng của vòng quay | Không có gì ngoài cái đĩa quay rồi dừng | **Một** nhịp ngắn khi kết quả an vị: số trúng nảy lên, cung đậm chạy ngoài vành, 12 hạt bắn ra từ trục — chạy đúng một lần rồi tắt, không lặp |
| Ô đánh dấu | Hộp tick do hệ điều hành vẽ (`accent-color` chỉ với tới phần tô) | Ô vẽ bằng SVG: dấu tick vẽ ra trong 0,18 giây, hộp nảy nhẹ + vòng loang — và **chỉ khi người dùng tự bấm**, hộp đã tick sẵn lúc mở bảng thì đứng yên |
| Màn chờ | Ghim cứng 1,7 giây, rồi bỏ hẳn bằng cờ `sessionStorage` | **Chạy mỗi lần tải trang** (chủ dự án chốt 19/09): sàn 560 ms để logo kịp "vào", trần 2,6 giây để không ai bị giữ lại |

### A3. Bố cục

| Việc | Chi tiết |
|---|---|
| **Bảng yêu cầu thành hai cột từ 1300px** | Cột trái giữ việc chính (thống kê, Up next, Vote của bạn, danh sách), cột phải 320px là video của kênh. Ngưỡng **tính ra** chứ không chọn cho đẹp: từ 900px `.shell` đã chừa 252px cho sidebar nên cần `650 + 24 + 320 + 52 + 252 ≈ 1298`. Đổi bằng `grid-template-areas`, **không đổi thứ tự DOM** |
| Trong cột 320px | Dải mục lục video xếp **dọc** (ảnh 112px trái, tên phải) thay vì cuộn ngang |
| Bản hẹp | Thống kê 4 ô về **một hàng** (tiết kiệm ~60px); dải mục lục video còn **ảnh bìa 96px** (tiết kiệm ~80px) |
| Dòng phụ dưới tiêu đề trang | Tiêu đề đứng một mình ở góc để lại khoảng trống không rõ chức năng; thêm một dòng nói trang này để **làm gì** |
| **Bốn ô thống kê = bốn giai đoạn** | Queued · Picked · In progress · Completed chia nhau **toàn bộ** bài trên bảng — không đè lên nhau, không sót bài nào. Lưới `auto-fit` với vách ngăn 1px thay cho bốn khối rời rạc |
| **Khối Up next nói cả dây chuyền** | Thêm một dòng nhỏ dưới tiêu đề: *"2 in progress · 3 picked, not started"* — con số trên huy hiệu tab và số trong khối là **cùng một tập**, nên không còn cảnh đếm một đằng liệt kê một nẻo |

### A4. Tính năng mới (tất cả miễn phí, không cần dịch vụ nào)

| # | Tính năng | Ghi chú |
|---|---|---|
| 1 | **Dò trùng ngay lúc gõ** (`findDuplicate`) | Gõ xong tên bài + nghệ sĩ là form báo *"bài này đã có trên bảng: 3 requests, 12 votes"* kèm nút mở thẳng hộp vote. **Gợi ý, không chặn.** Dò cả hàng chờ duyệt để bắt ca *chính mình gửi lại*. Dùng đúng `groupKey` mà bảng dùng để gom cụm |
| 2 | **Nhớ bộ lọc** (`pickBoardParam`) | URL → đã lưu → mặc định; giá trị lạ bị bỏ qua; `q` **không** nhớ (tìm kiếm là chuyện của phiên) |
| 3 | **Link mời gửi bài** `/?add=1&artist=…&title=…` | Dán vào mô tả video YouTube: người xem bấm là form mở sẵn. Dùng một lần rồi xoá khỏi URL |
| 4 | **Nút chia sẻ** trên mỗi request | Link trỏ về **chính bảng** (`?f=top&q=…`) để người nhận bấm là vote được ngay; cảm ứng mở hộp chia sẻ hệ thống, desktop copy + toast |
| 5 | **Copy credits** trong Admin | Chép sẵn *"aespa - Whiplash / Requested by: An, Bình"* để dán vào mô tả video. Gom mọi dòng cùng bài, bỏ trùng, quá 8 người thì `+3` |
| 6 | **Dấu phân cách dòng metadata** | Bỏ hẳn ký tự `·` (12 chỗ), thay bằng **vạch mảnh 1×9px** có `aria-hidden` |
| 7 | **`copyText()` có đường lùi** | Máy không HTTPS / webview cũ vẫn copy được (đường lùi `execCommand`) |
| 8 | **Hai nút mảnh dùng chung `.rowact`** | Một chỗ khai số đo, một cặp cỡ chạm — trước đây thêm nút thứ hai là phải chép lại toàn bộ số đo |

### A5. Tài liệu

- **`docs/DESIGN.md` (mới, 303 dòng)** — token + luật + **lý do** trong cùng một file, kèm *Design Read* (loại trang, người dùng, nhịp dùng) và ba dial: `DESIGN_VARIANCE 5 · MOTION_INTENSITY 3 · VISUAL_DENSITY 7`. Có mục "Những thứ đã cố ý KHÔNG làm" và checklist trước khi ship một thay đổi giao diện.
- **`HUONG-DAN.md`** — thêm mục *Giới hạn của các gói miễn phí*, *Trang Bảng yêu cầu: hai cột từ 1300px*, *Màn chờ dài bao lâu*, *Bài đã có trên bảng?*, *Link mời gửi bài*, *Ghim công người gửi*, và ba nhật ký kiểm thử của ba vòng.

### A6. Kiểm thử

`npm test` **257 đạt / 0 lỗi / 1 skip** (258 ca) · `npx oxlint` **0 lỗi, 16 cảnh báo** — toàn bộ là hai loại đã có từ trước (fast-refresh, set-state-in-effect) · `npm run build` sạch, bundle 348 kB (gzip 111 kB): bộ icon Lucide thêm khoảng 5 kB thô / 2 kB gzip.

Ba tệp kiểm thử mới canh đúng ba chỗ dễ hỏng câm lặng:

| Tệp | Chốt cái gì |
|---|---|
| `src/lib/boardSync.test.js` (8 ca) | Bốn ô thống kê = bốn giai đoạn; huy hiệu *Up next* và dòng *"n in progress"* lấy từ **cùng một tập**; `statusLabel` chỉ có một nguồn; màn chờ không nhớ gì và sàn/trần thời gian đúng như tài liệu |
| `src/lib/renderGuard.test.js` (4 ca) | Không file nguồn nào còn `__cclBoot` / `bootfail` / `.crash` / `'crash.` — bộ khung màn hình đen không được quay lại; **dữ liệu bẩn không làm vỡ bảng** (trạng thái lạ, loại bài lạ, ngày rác, cả một dòng `null`); chỗ render không tra trần `STATUS_META[` / `KIND_META[`; payload vòng quay thiếu khoá thì vẫn quay |
| `src/components/Icon.test.js` (3 ca) | Mọi tên icon viết thẳng, viết trong biểu thức, và trong bảng ánh xạ (`NAV_ICON`, `TONE`) đều có thật trong `SET`; và `SET` không có tên chết — nó vừa bắt được một tên như vậy (`send`) |

### A7. Bộ icon, ô đánh dấu, lưới an toàn (đợt hai trong ngày)

| Việc | Chi tiết |
|---|---|
| **Toàn bộ icon chuyển sang Lucide** | `components/Icon.jsx` là **một** chỗ khai duy nhất: tên gọi theo *việc* (`close`, `prev`, `bellOn`, `share`…) → icon Lucide, nét **1.7** cho khớp nét viền 1px của trang, `aria-hidden` sẵn, và `fill` chỉ truyền khi thật cần (nút play đặc). Mọi `<svg>` vẽ tay lẫn mọi glyph chữ (`× − + ✓ ‹ › ↗ ▶`) đã bị thay. Còn đúng ba thứ vẽ tay — logo thương hiệu (YouTube/Telegram/Google: Lucide cố ý không vẽ logo) và hình của vòng quay |
| **Ô đánh dấu vẽ bằng SVG** | Lấy ý từ element `plastic-moth-91` trên uiverse.io: `input` thật bị làm trong suốt (bàn phím, trình đọc màn hình, `:checked` vẫn nguyên), phần hình do SVG vẽ, dấu tick *vẽ ra* khi bật. Bốn họ checkbox của trang — cài đặt thông báo, 3 mốc tiến độ admin, "ẩn khỏi trang chủ", "yêu cầu trả phí" — dùng chung một component, mỗi nơi giữ màu trạng thái của mình qua biến `--chk` |
| **Gỡ bộ khung "màn hình đen"** | Từng có hai tầng lưới an toàn (`components/ErrorBoundary.jsx` + khối `.bootfail` trong `index.html`). Chúng bị gỡ hẳn sau khi chủ dự án gặp đúng cảnh chúng gây ra: một lỗi render → khối đen phủ kín trang → phải xoá tay class mới thấy lại app. Nay `main.jsx` dựng app thẳng vào `#root`, lỗi runtime chỉ ghi ra console với tiền tố `[ccl]`, và `src/lib/renderGuard.test.js` cấm bộ khung cũ quay lại |

---

## B. Giới hạn gói miễn phí đang chạm — số thật

Cả chồng dịch vụ đang chạy **miễn phí hoàn toàn** (Cloudflare Pages + Pages Functions, Supabase, Turnstile, GitHub). Không tính năng nào đã làm cần trả tiền. Năm con số quyết định cách viết code:

| Giới hạn | Ở đâu | Hệ quả |
|---|---|---|
| **100.000 request/ngày** | Workers/Pages Functions | Rất rộng cho quy mô này |
| **10 ms CPU/request** | Workers/Pages Functions | Đừng tính toán nặng trong Function — để **Postgres** làm, Function chỉ gọi **một** RPC. Thời gian chờ mạng không tính vào 10 ms |
| **5 cron trigger / TÀI KHOẢN** (không phải per worker) | Workers | Mọi việc định kỳ phải gộp vào **một** cron (hiện dùng 1 cho lượt chốt request) |
| **50 request con / lượt gọi** | Workers | Nếu gửi thông báo ra ngoài thì phải **gộp nhiều tin vào một lần gửi** |
| **20.000 file / deploy** | Pages/Workers | Sinh sẵn một trang tĩnh cho mỗi video đã làm thì được — vài trăm bài không sao |

### ⚠️ Ba điều đáng lo hơn mọi tính năng còn thiếu

**1. Workers KV gói free chỉ cho 1.000 lượt GHI mỗi ngày.** (100.000 lượt đọc — nhưng chỉ **1.000 ghi**.) Đây là con số chặt nhất trong cả chồng dịch vụ, và nó **đang nằm ngay trên đường đi của vote**: `worker/index.js` gọi `shieldCommit()` sau mỗi lượt vote và mỗi lượt quay, và `worker/shield.js` ghi 1–2 khoá mỗi lần (khoá vân tay + khoá IP).
Ước lượng: **~300–500 lượt vote+spin mỗi ngày là chạm trần.** Khi vượt, lệnh ghi thất bại — và vì code có bọc `try/catch` ("KV lỗi không làm mất thưởng") nên **app không sập**: người dùng vẫn vote/spin bình thường, nhưng tấm khiên chống farm **ngừng đếm**. Postgres vẫn giữ hạn mức thật (2 lượt quay/ngày/vân tay, 3 vote miễn phí/ngày) nên thiệt hại có giới hạn, nhưng lớp chặn spam ngoài cùng mất tác dụng.
→ **Cách sửa, tất cả đều miễn phí:** (a) ghi KV cách quãng (ví dụ mỗi 5 lượt vote mới ghi 1 lần — phanh lỏng hơn 5 lần nhưng lượng ghi giảm 5 lần); (b) chuyển bộ đếm sang **D1** — gói free cho **100.000 lượt ghi/ngày** (gấp 100 lần KV) và 5 GB dung lượng; (c) chỉ giữ KV cho Daily Spin (2 lượt/ngày/vân tay nên lượng ghi vốn thấp) và để vote dùng D1.

**2. Gói free của Supabase KHÔNG có backup tự động.** Request, vote, đơn hàng, lịch sử vòng quay chỉ nằm ở **một chỗ duy nhất**. Cách rẻ nhất để ngủ ngon: một GitHub Action chạy `pg_dump` định kỳ rồi cất file — GitHub Actions miễn phí cho repo công khai (và 2.000 phút/tháng cho repo riêng), việc này tốn vài phút mỗi lần. Nơi cất: artifact của Actions, hoặc **R2** (gói free: 10 GB, không tính phí băng thông ra).

**3. Project free của Supabase tự tạm dừng sau 7 ngày không có hoạt động**, và phải vào dashboard bấm khởi động lại (~60 giây). Site có người vào hằng ngày thì không bao giờ chạm; nhưng nếu app im ắng, nó sẽ ngủ. Lượt cron chốt request *có* gọi database nên tự giữ project thức — miễn là cron còn chạy.

> **Đừng dùng gói free của Vercel cho app này:** Hobby cấm mục đích sinh doanh thu, mà app có bán vote. Xem bảng so sánh trong `HUONG-DAN.md`.

---

## C. Gợi ý tính năng — tất cả miễn phí

Cột **"Trần free"** là giới hạn liên quan nhất của gợi ý đó.

### C1. Nên làm ngay (rẻ, giá trị rõ, không cần chốt gì)

| # | Việc | Được gì | Công | Trần free |
|---|---|---|---|---|
| 1 | **Sao lưu database định kỳ** (GitHub Action chạy `pg_dump`) | Ngủ ngon. Đây là việc đáng làm **trước** mọi tính năng khác | Rất rẻ — bạn chỉ cần dán 1 secret | GitHub Actions free; R2 free 10 GB |
| 2 | **Ước lượng thời gian chờ** cho bài của mình: *"khoảng 3–5 tuần"* | Trả lời câu hỏi tốn tiền nhất của người mua request: *"tôi bỏ 20k rồi thì bao giờ có?"*. Dữ liệu đã có đủ: số bài đứng trước nó × `interval_days` | Rẻ (thuần logic + một dòng chữ) | Không đụng dịch vụ nào. Phải là **khoảng làm tròn** kèm cách tính, không phải số giả-chính-xác |
| 3 | **CTA mua vote đúng lúc "còn 2 vote nữa là tới lượt"** | Khoảnh khắc chuyển đổi tự nhiên nhất, dữ liệu `near`/`lead` **đã có sẵn** trong hộp thư | Rẻ | Không. Phải giữ giọng trung tính: *"muốn bài tới lượt sớm hơn?"*, không phải *"trả tiền đi"* |
| 4 | **Tìm kiếm không dấu cho bảng công khai** | Hàm `norm()` đã có sẵn trong `AdminPanel.jsx` (bỏ dấu tiếng Việt) — "chung ha" tìm ra "Chung Hạ" | Rẻ | Không |
| 5 | **Lịch sử vote / sổ credit của người dùng** | Bảng `credit_ledger` + `votes` đã có trong schema; chỉ cần view + một khối trong trang *Của tôi*. Người trả tiền có quyền thấy tiền mình đi đâu | Rẻ–vừa | Không |
| 6 | **Copy credits cho CẢ video (nhiều bài một lượt)** | Mở rộng việc đã làm: chọn nhiều bài đã xong → một khối chữ để dán mô tả | Rẻ | Không |
| 7 | **Báo cáo tuần cho admin** | Tổng request/vote/đơn/top bài gom thành **một khối trong bảng Admin** (một tệp JSON kèm lượt cron đang chạy) — đọc trong 10 giây, không cần thêm dịch vụ nào | Rẻ | 1 cron (đã dùng 1 cho chốt request → nhét chung vào lượt đó); không tốn gì thêm |

### C2. Đáng làm, cần bạn chốt vài quyết định

| # | Việc | Được gì | Công | Trần free |
|---|---|---|---|---|
| 8 | **Chuyển bộ đếm lá chắn từ KV sang D1** | Gỡ đúng cái trần chặt nhất (1.000 ghi/ngày → 100.000 ghi/ngày) | Vừa | D1 free: 5 GB, 5 triệu lượt đọc dòng/ngày, 100.000 lượt ghi dòng/ngày |
| 9 | **Trang lưu trữ "đã làm"** (mỗi bài một trang, hoặc một trang theo tháng) | SEO: mỗi video thành một trang trả lời *"Chaereve đã làm bài X chưa?"*; cũng là bằng chứng cho người mới thấy kênh làm thật | Vừa–lớn | 20.000 file/deploy — vài trăm bài thì thoải mái |
| 10 | **RSS/JSON feed "vừa lên sóng"** | Người hâm mộ cắm vào app đọc tin của họ; không tốn gì | Vừa | Một Pages Function trả XML nằm trong 100.000 request/ngày, hoặc sinh tĩnh lúc build |
| 11 | **Hợp nhất cụm trùng ở tầng dữ liệu (admin)** | Dọn gốc rễ của việc farm vote và của dữ liệu bẩn | Vừa | Không. Cân nhắc: mất lịch sử vote từng dòng |
| 12 | **Nhập hàng loạt từ bình luận (admin dán text)** | Chủ kênh dán một đoạn bình luận có 20 tên bài → thành 20 dòng request chờ duyệt. Dạng "sửa cả danh sách một lượt" đã có tiền lệ cho media | Vừa | Không |
| 13 | **PWA cài được lên màn hình chính** | Mở như app, có icon riêng. Manifest đã có sẵn | Vừa (thêm service worker) | Không tốn tiền, nhưng **tăng diện bảo trì**: cache sai là người dùng kẹt ở bản cũ. Nếu làm thì chỉ precache vỏ app |

### C3. Để sau, hoặc chỉ khi có lý do

| # | Việc | Ghi chú |
|---|---|---|
| 14 | Bảng "top người gửi theo tháng" / mùa giải | Vui, nhưng khuyến khích đúng kiểu chạy đua số lượng mà bảng đang phải chống |
| 15 | Giao diện tiếng Việt | Từ điển `i18n.jsx` đã tách sẵn nên về mặt kỹ thuật là làm được, nhưng hiện app **cố ý** chỉ có tiếng Anh. Làm thì miễn phí, chỉ tốn công dịch và gấp đôi số chuỗi phải giữ |
| 16 | Phím tắt mở rộng (`j`/`k` di chuyển, `v` vote) | Miễn phí, hợp với người dùng bàn phím — nhưng số người dùng thật được lợi thì ít |
| 17 | Kiểm tra bằng trình đọc màn hình thật | Miễn phí. Đã có `aria-label` cho mọi nút, nhưng chỉ người dùng thật mới nói được còn vướng gì |
| 18 | Chế độ onboarding 3 bước cho người mới | Miễn phí; chỉ nên làm nếu thấy người mới bỏ đi ngay |

---

## D. Những thứ **KHÔNG** miễn phí — để bạn biết mà tránh

| Thứ | Giá | Ghi chú |
|---|---|---|
| **Supabase Pro** (backup tự động + không bị tạm dừng + 8 GB) | ~25 USD/tháng | Là lý do duy nhất để lên gói. Cách miễn phí để sống thiếu nó: `pg_dump` định kỳ + giữ cron chạy đều |
| **Vercel Hobby** | Miễn phí nhưng **cấm dùng cho mục đích sinh doanh thu** | App có bán vote → dùng là vi phạm điều khoản. Pro là 20 USD/tháng |
| **Durable Objects** (Cloudflare) | Chỉ có ở gói trả tiền | Đừng thiết kế tính năng nào dựa vào nó |
| **Email số lượng lớn** | SMTP có sẵn của Supabase chỉ dùng cho email xác thực | Cần email thật thì Resend free 3.000 thư/tháng (100/ngày) |
| **Workers Paid** | 5 USD/tháng | Chỉ cần khi vượt 100.000 request/ngày hoặc 10 ms CPU — còn xa |
| **Lưu ảnh/video của chính mình** | — | Hiện ảnh bìa lấy thẳng từ `i.ytimg.com`, và đó là lựa chọn đúng: tự host là tự trả băng thông |

---

## E. Thứ tự đề xuất

1. ~~**Sao lưu database** (C1-1)~~ — ✅ **đã làm**, xem phần F.
2. ~~**Ba việc rẻ ở C1**~~ — ✅ **đã làm cả ba**, xem phần F.
3. **Gỡ trần KV bằng D1** (C2-8) — xem cảnh báo ở B-1: làm trước khi lượng vote chạm ~500/ngày, không phải sau.
4. **Trang lưu trữ "đã làm"** (C2-9) — giá trị SEO lớn nhất còn lại, và là bằng chứng cho người mới thấy kênh làm thật.

**Hai việc đã bị bỏ (chủ dự án chốt 19/09):** nối `watches`/`notifications` xuống database
và gửi thông báo ra Telegram/Discord. Không làm nữa, không hỏi lại — thông báo ở lại
trong trình duyệt như hiện tại, và bảng C đã được đánh số lại sau khi xoá hai dòng đó.

## F. Đã làm tiếp (cùng ngày) — sao lưu, và ba việc rẻ

### F1. Sao lưu database tự chạy mỗi ngày (C1-1) ✅

| File | Việc |
|---|---|
| `.github/workflows/backup-db.yml` | Cron 02:00 giờ VN + bấm chạy tay; **cài client Postgres 17** (runner có sẵn bản 16, không dump được server 17); dựng một **Postgres sạch** để thử phục hồi; upload artifact 30 ngày; đẩy R2 nếu có secret |
| `scripts/backup-db.sh` | `pg_dump --format=custom`, kèm `manifest.txt` và `fingerprint.txt`. **Che mật khẩu** khi in log. Bốn chẩn đoán lỗi hay gặp: secret sai, project đang ngủ, sai loại chuỗi kết nối (IPv6 vs IPv4), client cũ |
| `scripts/db-fingerprint.sql` | Dấu vân tay schema `public`: **số dòng từng bảng** + function + **policy RLS** + trigger + sequence + **index** (mất một `unique` là vote được hai lần) + view |
| `scripts/verify-backup.sh` | Đổ bản dump vào database sạch rồi so từng dòng dấu vân tay; **lệch một dòng là đỏ**. Từ chối database đích không trống |
| `scripts/backup-stubs.sql` | Dựng ngữ cảnh giả Supabase (`anon`/`authenticated`/`service_role`, schema `auth`, `pgcrypto`) để phép thử chạy đúng chỗ |
| `scripts/push-to-r2.sh` | Tuỳ chọn, giữ bản sao lâu hơn 30 ngày; chưa cấu hình thì **bỏ qua êm** |
| `src/lib/backup.test.js` | 13 ca: hợp đồng workflow, **không bí mật trong repo**, và chạy thật hai script với `pg_dump`/`pg_restore`/`psql` **giả** — kể cả ca "dấu vân tay lệch thì phải đỏ" |

Ba quyết định thiết kế đáng nhớ:

- **Thử phục hồi mới tính là sao lưu.** Dump xong là đổ vào Postgres sạch rồi so dấu vân tay.
  Cách hỏng hay gặp nhất là **thiếu policy RLS**: số dòng khớp hoàn hảo mà quyền đã hở.
- **So cả policy/trigger/sequence, không chỉ số dòng.** Thiếu trigger thì dữ liệu vẫn khớp
  nhưng mọi bất biến (chống trùng, chống farm vote) biến mất.
- **Mật khẩu không rò ra log.** Log CI nhiều người đọc được; script che `://user:pass@` trước
  khi in, và có ca kiểm thử canh đúng điều đó.

**Bạn cần làm 3 bước** (đã ghi chi tiết trong `HUONG-DAN.md`): lấy chuỗi **Session pooler**,
dán vào secret `SUPABASE_DB_URL`, bấm **Run workflow** một lần. Nhớ: **cron chỉ chạy trên nhánh
mặc định**, nên phải merge thì nó mới tự chạy hằng ngày.

### F2. Ba việc rẻ (C1-2, C1-3, C1-4) ✅

| Việc | Đã làm |
|---|---|
| **Ước lượng thời gian chờ** | `pickEta()` + `etaKey()` trong `lib/watch.js`, gắn vào `pickLadder()` nên bảng / hộp thông báo / trang Của tôi **dùng chung một con số**. Hiện "at least N days/weeks/months" cho hạng 2–20 — hạng 9–20 **trước đây im lặng hoàn toàn** |
| **CTA mua vote lúc "còn 2 vote nữa"** | Nút **Get votes** trong tin *Almost picked*, mở thẳng tab mua. Cố ý để **lặng** (viền xám như *Watch*, không tô vàng như *Vote*) |
| **Tìm kiếm không dấu** | `fold()` trong `lib/board.js` — **một** chỗ định nghĩa, dùng cho cả bảng lẫn Admin. Xử lý cả chữ **đ** (ký tự riêng của tiếng Việt, NFD không tách được) |

Ba thứ **cố ý không hiện** sàn thời gian (và vì sao): bài dẫn đầu (đồng hồ đếm ngược đã nói
rồi), bài bị request trả tiền chặn trước (không hứa được gì), hạng quá 20 (con số chỉ còn là
trò chơi chữ). Con số luôn nói **"sớm nhất"** vì bài khác vote nhiều hơn chỉ có thể đẩy nó
**muộn hơn**, không bao giờ sớm hơn.

Nhân lúc làm, sửa luôn ba thứ vặt phát hiện được: một **chữ Hán lạc** trong chú thích
`cssTapTarget.test.js`; đoạn tài liệu ghi *"bảy chốt chặn tĩnh"* trong khi **liệt kê tám** (nay
là *mười*, đã bổ sung `cssTapTarget` và `cssSelectArrow` bị bỏ sót); và `.oxlintrc.json` thiếu
khai báo môi trường node cho file test mới (làm phát sinh 2 lỗi `no-undef` — đã về đúng nền 14
cảnh báo / 0 lỗi).

### F3. Còn lại

Đúng như bảng C: **C2-8 (gỡ trần KV bằng D1)**, **C2-9…13 (trang lưu trữ, RSS, hợp nhất cụm
trùng, nhập hàng loạt, PWA)** và các việc C3.

**Đã bỏ khỏi danh sách:** nối database cho theo dõi + gửi ra Telegram/Discord (C2-8/9 bản cũ).
Chủ dự án chốt 19/09 là không làm — không hỏi lại, và bảng C đã đánh số lại sau khi xoá hai
dòng đó (nay 18 gợi ý).

---

## G. Vòng 7 — giao diện, quản trị, và gỡ bộ khung "màn hình đen" (19/09/2026)

| Việc | Đã làm |
|---|---|
| **Bảng màu** | Giữ nguyên hue ultramarine, **nâng độ sáng một bậc**: `--a #2b22e2 → #4d40f0`, chữ sáng hơn, nền sâu hơn, trạng thái/loại bài đều nhích theo. Ba nơi khớp cùng một bảng: `src/index.css`, `index.html` (theme-color + nền khung hình đầu) và `public/manifest.webmanifest`; `public/privacy.html` giữ bản sao `:root` theo đúng quy ước ghi trong file |
| **Thanh lọc bảng request** | `.toolbar` cũ → **`.fbar`**: chip lọc theo trạng thái (kèm số đếm), ô chọn loại bài, ô tìm kiếm có nút xoá, dòng *"đang xem n/mục"* chỉ hiện khi có lọc. Chip đang chọn đổi màu theo đúng màu trạng thái của nó |
| **Trạng thái rỗng** | Ba định nghĩa `.empty` rải rác gộp còn **một**; khối rỗng của bảng có icon, câu giải thích và gợi ý bấm gì tiếp |
| **Hàng request** | Tên bài 14.5px/600, `.pill` viết hoa 10.5px, `.kind` thành viên thuốc nhuộm màu theo loại, nút vote thoáng hơn |
| **Bảng Admin — chọn nhiều** | Thêm **chế độ chọn**: nút *Select* trong thanh công cụ, ô chọn từng dòng (dùng lại `Check.jsx`), hàng đang chọn được nhuộm nền, và **thanh hành động dính đáy** với Duyệt / Từ chối / Chốt / Bỏ chốt / Về hàng đợi / Xoá hàng loạt. App chạy tuần tự rồi **tải bảng đúng một lần** (trước đây mỗi request một vòng tải + một toast) |
| **Bảng Admin — xếp hạng** | Ô chọn thứ tự: *Tab order* (mặc định, giữ nguyên luật cũ) · *Newest first* · *Most votes* · *Waiting longest* — trả lời được câu "bài nào chờ lâu nhất" mà trước đây phải tự dò |
| **Form gửi request** | Nút gửi **bám đáy khung** (`sticky`) kèm câu xác nhận/lỗi ngay dưới: form dài hơn màn hình điện thoại, nút nằm cuối trang là phải cuộn hết mới biết đã gửi được chưa |
| **Vòng quay — không lặp quá 2 lần** | Luật chủ dự án chốt: hai lượt gần nhất của **cùng một thiết bị** trùng số thưởng thì lượt kế tiếp không được ra số đó. Làm ở **cả hai đường**: `drawSegment()` trong `src/lib/dailySpin.js` (bản demo) và `spin_daily` trong `supabase/migrations/20261104_spin_streak.sql` + `supabase/schema.sql`. Tập ô hợp lệ (7 hoặc 12 ô) không chia hết 256 nên dùng **lấy mẫu loại bỏ** — dùng `byte % n` trần là lệch xác suất, phá đúng cam kết "ô nào cũng thật" |
| **Gỡ bộ khung "màn hình đen"** | Xoá hẳn hai tầng lưới an toàn cũ (`components/ErrorBoundary.jsx` + khối `.bootfail` 8 giây trong `index.html`), CSS `.crash`/`.bootfail` và 4 khoá `crash.*`. Lý do: chúng biến MỘT lỗi render thành khối đen che hết trang — chủ dự án phải xoá tay class trên trình duyệt mới thấy lại app. Nay `main.jsx` dựng thẳng vào `#root`, lỗi runtime chỉ ghi ra console với tiền tố `[ccl]` |
| **Dữ liệu bẩn không làm vỡ trang** | `statusColor()` luôn trả một màu (thay `STATUS_META[x].c` trần), `kindCls()`/`KIND_META[form.kind] || KIND_META[KINDS[0]]`, `vnd/usd/compact` không in `NaN`, `board.js` lọc dòng rác trước khi gom cụm, payload vòng quay thiếu `rewards` thì rơi về 16 ô mặc định, vân tay hỏng không giết lượt quay |
| **Chốt chặn mới** | `src/lib/renderGuard.test.js` (4 ca): không file nguồn nào được dựng lại bộ khung màn hình đen; dữ liệu bẩn (trạng thái lạ, loại bài lạ, ngày rác, **cả một dòng `null`**) không làm hàm nào ném lỗi; chỗ render không tra trần `STATUS_META[` / `KIND_META[`; payload vòng quay thiếu khoá vẫn quay |

---

## H. Vòng 8 — tinh chỉnh vòng quay, thanh tiến độ, và một lỗi "mất bài" tìm được khi dựng thử (19/09/2026)

| Việc | Đã làm |
|---|---|
| **Vòng quay — gỡ 7 chỗ dư** | Bỏ: 48 vạch chia độ quanh vành, 16 nan hoa toả từ trục, mũi chỉ tam giác trên trục, chấm tròn ở trục, đường tóc giữa lát và vành, cung ăn mừng ngoài vành khi trúng, và **cả bảng 12 sắc độ** (4 bậc thưởng × 3 sắc trộn từ `--a`). Kèm theo: một dòng luật "reset lúc 00:00" trùng với chip đếm ngược ở đầu khối. Bánh xe từ **11 lớp vẽ / 12 màu** xuống **5 lớp / 3 màu**: vành + đường tóc ngoài, 16 lát hai tông xen kẽ, số, trục phẳng, con trỏ |
| **Vòng quay — hai thứ mới có nghĩa** | (1) **Con trỏ gõ theo đúng nhịp vạch**: mảng mốc thời gian vẫn dùng để phát tiếng tách nay nuôi luôn mũi chỉ (`drivePointer` trong `DailySpin.jsx`), nên mắt và tai nghe cùng một nhịp thay vì một bên gõ thật một bên rung đều. (2) **Trúng thưởng chỉ còn MỘT dấu**: mọi lát tối đi, lát trúng được viền trắng, số nảy lên trong 500 ms, 10 hạt toả ra một màu — trước đây cùng lúc có ba dấu (viền, cung ngoài vành, chùm hạt nhiều màu) |
| **Khối trạng thái cạnh vòng quay** | Ba ô bằng nhau → **một ô chính + hai ô phụ**: "còn mấy lượt" trải hết chiều ngang với số 30px (đó là con số quyết định bấm quay hay không), "đã mua / bonus" nằm dưới, số 22px. Mắt biết đọc gì trước |
| **Nhãn mục toàn trang** | `.section-title` từ dòng 13px đậm thành **nhãn 11px in hoa, giãn chữ, kèm đường tóc kéo hết chiều ngang** — áp cho cả 7 chỗ (All requests, My requests, My orders, Vote packs, Single votes, Payment, Your orders). Trước đây bảy khối khác nhau mở đầu bằng đúng một kiểu chữ nhạt, mắt không thấy được "mục mới bắt đầu ở đây" |
| **Thanh tiến độ — một khối, một con số** | Thêm `components/Progress.jsx`, dùng ở **ba** chỗ (hàng request, khối Up next, hàng Admin). Trước đây hàng request in con số trần `47%` **mang luôn cả chấm tròn của nhãn trạng thái**, rồi bên dưới là một vạch 3px rời không dính gì tới con số đó. Nay vạch và số cùng một hàng, vạch 6px bo tròn tô theo màu trạng thái, số dùng chữ mono + `tabular-nums` nên cột số không nhảy, `role="progressbar"` + `aria-valuenow` để máy đọc đúng "Build progress, 47 percent", và mọi giá trị rác (`undefined`, `"abc"`, `150`, `-3`) bị kẹp về `0..100` ngay trong component |
| **LỖI THẬT: bài đang làm mà không thấy ở tab nào** | Khi dựng thử cả app trong jsdom mới lộ ra: một request có `status = in_progress` mà **thiếu `picked_at`** (admin tick một mốc tiến độ trên bài chưa từng được chốt, hoặc bài bị đẩy về hàng chờ rồi làm lại) rơi khỏi **mọi** tab cùng lúc — Queue (status không còn là queued), Up next và In progress (thiếu `picked_at`), Done (chưa xong). Người gửi tưởng request bị xoá. Nay dây chuyền tính bằng `inChain()` = *đã chốt HOẶC đang làm* (`src/lib/meta.js`), dùng cho cả danh sách, số đếm chip, và nút vote |
| **Khóa vote theo dây chuyền** | Luật cũ "đã vào Up next thì khóa vote" nay áp cho **cả dây chuyền**: nút vote của bài đang làm cũng khoá, và khoá ở cả đường mở bảng chọn phiếu (`openVote`/`doVote`) chứ không chỉ ở phần nhìn. Kéo theo: "Top voted" chỉ còn liệt kê bài **đang xin phiếu** (bỏ bài đã xong hoặc đã nằm trong dây chuyền) — badge và danh sách cùng một phép lọc |
| **Học bộ palette + skill mới** | Bộ palette gửi kèm khớp **Palette 3 (Purple + Blue Grey)** ở chế độ tối: `--a #4d40f0` ≈ Purple 600, `--a-2 #a9a4ff` ≈ Purple 200, nền/chữ đi thang Cool Grey lật ngược, màu trạng thái lấy shade nhạt của thang supporting (Red 300, Yellow 400–500, Green 400–500) vì shade 600–900 không đủ tương phản trên nền tối. Tỉ lệ **nhấn 5–10% / trung tính 80–90% / hỗ trợ 5–10%** được ghi thành luật trong `docs/DESIGN.md` §1.1. Từ `hallmark` lấy thêm luật "một màu nhấn, không quầng sáng màu, không `#000`/`#fff` làm nền"; từ `transitions.dev` lấy thang thời lượng cho cú nảy số (500 ms) và cú gõ con trỏ (90 ms) |
| **Kiểm thử** | `npm test`: **260 ca / 259 pass / 1 skip / 0 fail** (thêm `src/components/Progress.test.js`: kẹp giá trị rác, thuộc tính ARIA, và chốt "không ai dựng lại `.bar`"). Dựng thử cả app trong **jsdom** (React client thật, chế độ demo): 7 khối trong `#root`, 4 ô thống kê, khối Up next, 28 icon, **0 lỗi console**; bấm chip *In progress* → 2 hàng, 2 thanh tiến độ, `aria-valuenow="47"`, hai nút vote đều `disabled` |

**Còn lại của vòng 8:** `creativetimotfficial/ui` trả 404 (đã xin lại link đúng); file `color palette skill.json` đính kèm
không có trong workspace nên phần đối chiếu palette ở trên dựa vào nội dung bạn dán trong chat; rà soát bảng Admin và
bản mobile theo danh sách skill vẫn đang làm tiếp.

---

## I. Vòng 9 — bảng quản trị thành trang riêng, form request, luật xếp hạng (19/09/2026)

Bảy việc bạn yêu cầu, làm theo đúng thứ tự bạn nêu. Cột phải là **cách nó chạy**,
không phải danh sách file.

| Việc bạn yêu cầu | Đã làm gì, và nó chạy thế nào |
|---|---|
| **1. Bảng quản trị: mở một tab riêng thay vì popup, đầy đủ tính năng** | Bảng quản trị giờ là **một trang thật ở `/admin`**, có mục riêng trong sidebar (chỉ hiện với tài khoản quản trị) và vào được bằng link — dán link cho người khác là họ mở đúng chỗ đó. Trạng thái "đang mở mục nào" nằm trong **URL**, nên F5 không mất chỗ đang làm và nút Back của trình duyệt quay lại đúng mục trước. Bấm ra ngoài **không** đóng gì cả (trước đây đóng cả bảng, mất hết dòng đang chọn). Mục **Video** không tự quản lý ảnh nữa: không còn thanh tìm kiếm vô nghĩa đứng trên nó. <br><br>**Và làm được nhiều việc hơn:** **xuất CSV** đúng những dòng đang nhìn (đã lọc,
đã xếp) — dựng file ngay trong trình duyệt nên không tốn request nào của gói
miễn phí, có BOM để Excel đọc đúng tiếng Việt, và ô nào chứa dấu phẩy/nháy kép
đều được bọc theo RFC 4180; **địa chỉ mang cả mục đang mở** (`/admin?tab=orders`)
nên F5 giữ nguyên chỗ đang làm, nút Back lùi đúng một bước, và dán link cho người
khác là họ mở đúng mục đó; dải năm ô số liệu vừa là **tổng quan** vừa là **bộ chuyển mục** (mỗi ô mang đúng con số mà mục đó sẽ liệt kê, nên không có hàng tab nào đếm lại lần hai); thanh công cụ gộp **tìm kiếm + xếp thứ tự (mới nhất / nhiều vote / chờ lâu nhất) + lọc theo loại bài + chế độ chọn nhiều**; dòng đếm "đang xem n trên tổng N" kèm **chọn cả trang đang nhìn**; thanh thao tác hàng loạt dính đáy; mục Đang xử lý hiện **thanh tiến độ ngay trên hàng** (không phải mở khung sửa mới biết bài tới đâu); bàn phím: `/` nhảy vào ô tìm, `Esc` trong ô tìm xoá từ khoá rồi mới rời ô, `Esc` ngoài ô tìm **bỏ chọn hàng loạt** (thao tác đang dở, nguy hiểm hơn cả việc cuộn lên đầu trang). |
| **2. Form request "chưa có thay đổi gì" — làm lại cho vượt bậc** | Bốn thứ nhìn thấy được, không phải sửa trong ruột: <br>**(a) Dải 3 bước** trên đầu form (chọn loại → điền tên → gửi) sáng dần theo việc đã làm — không có bước ẩn nào xuất hiện sau khi bấm Gửi. <br>**(b) Bốn loại bài thành bốn thẻ có giải thích**: mỗi thẻ nói loại đó khác gì ba loại kia ("Full Album" khác "1 Hour Loop" ở chỗ nào), thay vì bốn chữ trần. <br>**(c) Lỗi nằm ngay tại ô sai**: rời ô mà còn trống thì câu giải thích hiện dưới chính ô đó, ô được đánh dấu `aria-invalid`; bấm Gửi khi còn thiếu thì con trỏ **nhảy vào ô sai đầu tiên** (trước đây chỉ có một dòng lỗi chung ở cuối form). Bộ đếm ký tự chỉ hiện khi đã dùng quá 70% ô. <br>**(d) Thẻ XEM TRƯỚC**: phần dưới form dựng ra **đúng cái thẻ mà người khác sẽ thấy trên bảng** từ chính những gì đang gõ, chỗ chưa điền hiện chữ mờ nói còn thiếu gì. Dán **link YouTube** thì ảnh bìa của chính video đó hiện ngay trong thẻ xem trước (lấy từ `i.ytimg.com`, **không cần API key, không tốn quota**) — trước đây dán đúng hay sai cũng nhìn giống nhau. Nút Gửi nói trước còn thiếu gì ("Điền nốt ô bắt buộc") thay vì xám im lặng, và có nút **Xoá hết** để bắt đầu lại. |
| **3. Tinh chỉnh quy luật tính của leaderboard** | Luật xếp hạng dồn về `src/lib/ranking.js` (hàm thuần, có test bằng số) và sửa **ba lỗi thật**: <br>**(a) khoá phá hoà trùng khoá chính** — bản cũ sắp bằng chuỗi `||`: xếp theo phiếu thì khoá phá hoà đầu tiên cũng là phiếu, xếp theo số bài thì khoá thứ hai cũng là số bài. Khoá trùng khoá chính là **khoá chết**, thứ tự rơi xuống so theo… tên. Nay chuỗi là *đã xong → tổng phiếu → số bài → tỉ lệ → tên*, khoá đang xếp bị loại khỏi chuỗi. <br>**(b) tỉ lệ hoàn thành chỉ có tiếng nói khi số bài đã bằng nhau**: 6/6 đứng trên 6/30, nhưng 30 bài đã xong **không** bị 1 bài đã xong đè. <br>**(c) một danh tính là một dòng** — bản demo gom theo `user_id::requester` nên người đổi tên hiển thị hiện thành hai dòng và **cả hai đều được tô "bạn"**; nay gom đúng như view `requester_ranking` (một `user_id` = một dòng, tên dùng nhiều nhất), dòng dữ liệu hỏng không làm sập bảng. <br>Trên màn hình: mỗi cách xếp in ra **câu nói rõ luật đang chạy** ("Sorted by votes earned · ties go to more completed, then more requests") — trước đây thứ tự nhảy khi đổi cách xếp mà không có câu nào giải thích. Cột tỉ lệ hoàn thành dùng số tính sẵn của luật, không chia lại tại chỗ. |
| **4. Thanh filter còn sơ sài, chưa tích hợp cho các thiết bị** | Một hàng chip trạng thái (cuộn ngang được, mỗi chip có **màu và số đếm của chính nó**), một nút **Bộ lọc** ở bên phải kèm số điều kiện đang bật, và ô tìm kiếm cùng hàng. Trên **máy hẹp**: dòng đếm nhường chỗ cho nút Bộ lọc, khối lọc thứ hai (chip loại bài + dòng tổng kết + lối xoá hết) **gấp lại** cho tới khi bấm; nút nói rõ đang mở/đóng bằng `aria-expanded`. Trên **thiết bị chạm** chip cao ≥40px (giữ nguyên hình dáng bản desktop, chỉ nâng vùng chạm) — `pointer: coarse`, không phải hai bản CSS. Cả thanh **dính mép trên** khi cuộn và chỉ đổi viền + bóng khi thật sự dính, nền mờ có đường lui cho máy không hỗ trợ `backdrop-filter`. |
| **5. Popup nhập số vote hiện đại hơn, đẹp hơn** | Hộp thoại đổi từ "nhập một con số" sang **cho thấy kết quả**: một con số lớn là **số phiếu SAU khi bạn vote** (kèm cú nảy khi con số đổi), dưới là "trước đó n là bao nhiêu". Bốn mức nhanh **1 · 5 · 10 · tất cả** (mức nào vượt quá số phiếu đang có thì không hiện — bấm vào rồi báo lỗi là lỗi thiết kế), một **thanh trượt** cùng trục với dãy nút, ô số có nút −/+, nút **rút lại** số phiếu đã vote, và câu "còn 7 → còn 3" trả lời đúng câu hỏi *bấm nút này thì tôi mất gì*. Cuối cùng là **ba ô số dư** (miễn phí hôm nay / đã mua / thưởng) để biết phiếu sắp dùng lấy từ đâu. Kèm một lỗi thật: hộp thoại cũ chỉ chặn bài đã chốt, nên bài đã xong/bị từ chối/còn chờ duyệt mà lọt vào vẫn cho chọn phiếu và cho bấm — nay chỉ bài **đang trong hàng** mới vote được, ngoài ra hộp thoại nói rõ vì sao đóng. |
| **6. Nhãn tag bị chồng / vướng vào nhau** | Nguyên nhân không nằm ở nhãn nào cụ thể mà ở chỗ mỗi nhãn tự ứng xử một kiểu. Nay `.pill` và `.kind` dùng **chung một khuôn** (`inline-flex`, không co, `white-space: nowrap`, `line-height: 1` — nhãn không bị bóp, không tự xuống dòng giữa chữ, chiều cao không phụ thuộc chữ bên trong), và **từ hai nhãn trở lên thì cả cụm nằm trong `.tags`** — hộp biết xuống dòng, có khe 6px, và cho dòng chữ bên cạnh co lại (chữ dài bị cắt chứ không đẩy nhãn ra ngoài). Áp ở mọi chỗ có nhiều nhãn: tiêu đề hàng request, khối Up next, ghi chú bài trùng, hàng trong bảng quản trị. |
| **7. Màu thanh progress chưa đẹp** | Vạch không tô phẳng một màu nữa, nhưng cũng **không** lấy màu ngoài hệ: ruột là dải **hai điểm cùng một huệ** (`color-mix(--sc 68%, --bg)` ở đầu vạch → `--sc` nguyên bản ở cuối) nên mắt đọc ra hướng chạy mà không sinh ra bảng màu thứ hai; mép trên có **vệt sáng 1px**, rãnh có **bóng lõm**, thành ra vạch đọc như một thanh mảnh bắt sáng thay vì một dải băng dính. Thêm `min-width: 6px` bằng đúng đường kính bo tròn: 1% vẫn phải nhìn thấy, vì "đã bắt đầu" khác "chưa bắt đầu". Hàng trong bảng quản trị cũng hiện thanh này ngay trên hàng. |
| **8. Ô search bị icon lòi ra ngoài** | Lỗi thật, một dòng: `.search-ico` thiếu `top` nên icon nằm ở đâu đó trong lòng ô/ngoài mép tuỳ chiều cao ô. Nay icon canh giữa theo chiều dọc (`top: 50%` + `translateY(-50%)`), không nhận chuột (`pointer-events: none` — bấm vào icon vẫn vào được ô nhập), và ô tìm của **bảng quản trị** dùng đúng cùng lớp đó (kèm nút xoá và phím tắt `/`). |

**Kiểm thử và tài liệu của vòng 9:** `npm test` → **309 ca / 308 pass / 1 skip / 0 fail**
(thêm `src/lib/ranking.test.js` 8 ca luật xếp hạng, `src/components/AdminPanel.test.js`
9 ca dựng thật cả năm mục của trang quản trị, `src/components/VoteModal.test.js`
6 ca, `src/components/Leaderboard.test.js` 5 ca, `src/lib/cssFilterBar.test.js`
8 ca cho thanh lọc / nhãn / ô tìm / thanh tiến độ, `src/lib/csv.test.js` 5 ca cho
file xuất, `src/lib/adminTabs.test.js` 4 ca cho địa chỉ của từng mục). `docs/DESIGN.md` thêm §2.6
(nhãn và cụm nhãn), §2.7 (luật xếp hạng), mục màu vạch trong §2.5, một gạch đầu
dòng cho thanh lọc máy hẹp ở §5, một mục "không quay lại popup" ở §7, và ba mục
mới trong danh sách kiểm trước khi ship ở §8.

**Một việc vẫn để mở:** `creativetimofficial/ui` (repo bạn đưa ở vòng 8) không có
`README.md` để đọc thẳng — cần liệt kê cây thư mục trước khi lấy được gì từ đó, và
`untitledui.com/react/components`, `mui.com`, `reactbits.dev`, `primereact.dev` vẫn
chưa xem hết.

---

## J. Vòng 10 — tám việc đó gửi lại một lần nữa, và lần này tìm ra bốn lỗi thật (19/09/2026)

Bạn gửi lại **đúng tám việc của vòng 9** ngay sau khi vòng 9 báo xong. Đó là tín hiệu
đúng: nếu mọi thứ đã ổn thì tám dòng đó không quay lại. Nên vòng này **không đánh bóng
lại vòng 9** — nó đi tìm chỗ vòng 9 còn SÓT, và tìm được **bốn lỗi thật** (ba trong số
đó là loại "tính năng có mà không tới được", tức là nhìn từ ngoài y hệt như chưa làm gì).

### J0. Bốn lỗi thật tìm được trong vòng này

| Lỗi | Ai thấy, khi nào | Vì sao vòng 9 không bắt được |
|---|---|---|
| **Lọc theo loại bài KHÔNG tới được trên desktop** | Khối lọc thứ hai (chip *All types · Color Coded Lyrics · Full Album · 1 Hour Loop · Short*) chỉ được mở trong `@media (max-width: 620px)`, mà nút mở nó (`.fmore`) **cũng** chỉ hiện ở đó. Trên máy tính: tính năng có trong mã, có trong HTML, mà không có cách nào bấm tới | Vòng 9 kiểm bằng SSR — trong HTML tĩnh thì khối đó **vẫn có mặt**; chỉ CSS mới giấu nó đi, và bài kiểm cũ chỉ chốt "máy hẹp gấp lại được", không chốt "màn rộng phải với tới được" |
| **Nút Xuất CSV không có ở mục Đơn hàng** | Nút nằm trong nhóm `tab !== 'orders'`, trong khi hàm xuất **đã có sẵn nhánh cột riêng cho đơn hàng** — tức là đường xuất đơn viết ra rồi không ai bấm tới được | Không ai thử bấm vào thứ chỉ hiện ở một nhánh; bài kiểm cũ chỉ chốt "đơn hàng hiện đúng đơn đang chờ" |
| **Ô tìm kiếm của bảng quản trị có chữ nằm dưới kính lúp** | Luật chừa chỗ (`padding-left: 28px`) chỉ áp cho `.fbar .search`; ô tìm trong bảng quản trị dùng **cùng lớp `.search`, cùng icon** nhưng không được chừa chỗ | Đây là **cùng một lỗi** bạn chỉ ra ở trang chủ (việc 8), chỉ khác màn hình; vá một chỗ rồi tưởng đã hết |
| **Phím "chọn cả trang" của bảng quản trị chỉ tồn tại trong ghi chú** | Ghi chú trong mã hứa `Ctrl/Cmd+A` = chọn cả trang; phần thân của bộ bắt phím **chưa bao giờ viết** vế đó | Ghi chú đọc rất thuyết phục; chỉ khi đọc từng nhánh `if` mới thấy thiếu |

Ba việc còn lại của bạn (form request · luật xếp hạng · hộp vote) không có "lỗi ẩn" —
chúng đã chạy — nên vòng này **thêm thứ mới** thay vì sửa lại:

### J1. Tám việc bạn yêu cầu — vòng này làm gì thêm

| Việc bạn yêu cầu | Vòng này thêm gì (vòng 9 đã có: trang `/admin`, địa chỉ `?tab=`, CSV, chọn nhiều, xem trước, luật phá hoà…) |
|---|---|
| **1. Bảng quản trị đầy đủ tính năng** | **(a)** Nút **Xuất CSV ra ngoài nhóm** chỉ-dành-cho-request: mục nào cũng xuất được, đúng cột của mục đó (lỗi ở J0). **(b)** Nút **Chọn nhiều bị gỡ khỏi mục Đơn hàng** — mục đó không vẽ ô chọn trên từng dòng, nên nút cũ bật một chế độ không tick được gì, mà đường "xoá hàng loạt" lại nhận **id đơn** rồi gọi xoá request. **(c)** Dải số liệu **không tự chép lại danh sách mục** nữa: mục · nhãn · màu · cách đếm nằm cùng một chỗ (`ADMIN_TAB_META` trong `src/lib/adminTabs.js`), thêm mục mới là thêm một dòng, và `AdminPanel.test.js` chốt "dải số liệu đi đúng thứ tự đó". **(d)** **`Ctrl/Cmd+A` chọn cả trang** nay chạy thật (chỉ chặn khi đang ở chế độ chọn nhiều — các trường hợp khác vẫn là "chọn hết chữ" của trình duyệt). **(e)** **Bộ lọc nằm ở địa chỉ**: `/admin?tab=active&q=aespa&sort=votes&kind=Short` mở ra đúng danh sách đã lọc, F5 không mất, nút Back lùi đúng bước, dán link cho người khác là họ thấy đúng thứ mình đang nhìn. **(f)** Gỡ khối `pipeline` chết (tính năm con số mà không chỗ nào đọc). |
| **2. Form request — vượt bậc** | **(a) BẢN NHÁP.** Gõ dở rồi lỡ đóng hộp thoại, đổi tab, hay hết pin thì chữ vẫn còn: form lưu vào `localStorage`, **tự xoá sau khi gửi thành công**, **tự bỏ nếu cũ quá 7 ngày** (nửa cái form từ tháng trước không phải là việc đang làm dở), và khi khôi phục thì **nói ra** — một dòng "Draft restored from your last visit" kèm nút **Bỏ nháp** dọn sạch form (bấm nút mà chữ vẫn còn thì là lỗi). Link mời (`?add=1&…`) thắng bản nháp, vì đó là lời mời có chủ đích. **(b) Dán link ở đâu cũng được**: dán một link vào ô tên bài hay ô nghệ sĩ thì link về **đúng ô Link**, không nhét một URL dài vào tên bài. **(c) Enter đi tiếp**: Enter ở ô nghệ sĩ là "xong ô này" → nhảy sang tên bài; Enter ở ô tên bài (khi đã đủ hai ô) là **gửi luôn**. |
| **3. Tinh chỉnh quy luật tính của leaderboard** | Nay **có công thức**, không chỉ có thứ tự: **điểm = 10 × số bài đã xong + tổng phiếu**, và đây là cách xếp **mặc định** (ba cách cũ vẫn còn, đổi bằng ba nút). Hai tính chất là chủ ý: **bài chưa xong không có điểm** (gửi 40 bài mà không bài nào được làm thì không leo hạng), và **một bài xong đáng giá bằng 10 phiếu** (cộng đồng đòi thật vẫn có tiếng nói). Trên màn hình: câu nói rõ luật in **hai trọng số đọc thẳng từ hằng số** `POINT_DONE`/`POINT_VOTE` trong `src/lib/ranking.js` nên câu chữ không thể lệch khỏi phép tính; mỗi hàng trong bảng có **chip điểm** kèm lời giải thích ("Score 190 = 10 × completed requests + votes earned"); bục 1-2-3 in hai chỉ báo phụ do **chính cách xếp khai**, không còn lấy hai chỉ báo bất kỳ. |
| **4. Thanh filter tích hợp cho các thiết bị** | Lỗi ở J0 đã sửa: hàng lọc thứ hai **luôn hiện trên màn rộng** (nó là một hàng công cụ, không phải một ngăn bí mật), máy hẹp mới gấp sau nút Bộ lọc. Thêm ba thứ cho bản hẹp: hàng trên **xuống dòng được** (trước đây dải chip bị bóp còn vài chục pixel trong khi ô tìm chiếm hết chỗ), chip loại bài trong khối gấp **xuống dòng cho thấy hết** thay vì cuộn ngang, và con số kết quả **không in hai lần** trên màn rộng. Trên thiết bị chạm, ô tìm kiếm và nút Bộ lọc cao **44px**. |
| **5. Hộp vote hiện đại hơn** | **Bàn phím**: `+` / `−` / mũi lên / mũi xuống chỉnh số phiếu mà không phải rời mắt khỏi con số lớn — nhưng **nhường phím khi con trỏ đang ở trong ô nhập** (ở đó trình duyệt đã tự tăng/giảm, bắt thêm là nhân đôi). Gợi ý `+ / −` nằm ngay cạnh ô số và **tự ẩn trên máy cảm ứng** (không có bàn phím thì đừng hứa). **Trên điện thoại hộp là tấm trượt từ đáy**: bo hai góc trên, phẳng ở đáy, có tay nắm, chừa `env(safe-area-inset-bottom)` — nút xác nhận rơi đúng vào tầm ngón cái; mức chọn nhanh và nút ± đủ **44px**. |
| **6. Nhãn chồng / vướng nhau** | Thêm hai bảo đảm cứng ở tầng khuôn: nhãn **không bao giờ rộng hơn hộp cha** (`max-width: 100%` + cắt ba chấm — `flex: none` giữ nhãn khỏi bị bóp, nhưng thiếu vế này thì một nhãn dài vẫn tràn ra ngoài khung bo góc), và `.tags` cũng `max-width: 100%`. Tiêu đề hàng gộp `line-height` về **một** luật (trước đây tách hai chỗ, đọc mãi mới thấy). **Bài kiểm mới `src/lib/tagLayout.test.js`**: quét **toàn bộ** JSX, chỗ nào có từ hai nhãn trở lên mà không nằm trong `.tags` là **đỏ**, kèm hợp đồng CSS cho `.pill`/`.kind`/`.tags`/`.meta`/`.vm-sub` — đây là bản dịch "nhãn đừng chồng nhau" thành thứ máy kiểm được, thay cho việc soi ảnh chụp. |
| **7. Màu thanh progress** | Bản vòng 9 trộn màu trạng thái **về phía màu nền** ở đầu vạch; trên nền xanh đen, trộn với nền thì ra **màu bùn** — đúng lý do vẫn thấy "chưa đẹp". Nay vạch là **một màu sạch**, chỉ nâng nhẹ độ sáng bằng chút trắng (nâng sáng thì vẫn ra màu của chính nó), cộng **đầu vạch sáng 3px** ở đúng chỗ tiến độ đang đứng và một quầng sáng nhỏ; con số phần trăm **ăn theo tông của vạch** thay vì một màu xám không liên quan. Tick hết ba mốc thì **cả vạch, đầu vạch và con số** chuyển sang màu "xong" — chỉ bằng **một biến `--sc`** đổi chỗ, không chép ba luật. Và màu **là việc của CSS**: bỏ hẳn prop `color` (mỗi chỗ gọi tự tô một màu chính là lý do **cùng một bài có hai màu vạch** ở trang chủ và bảng quản trị). |
| **8. Ô search bị icon lòi ra** | Lỗi ở J0 đã sửa, và sửa **cho mọi ô tìm kiếm**: khoảng chừa bên trái tính từ **bề rộng icon** (`calc(var(--ico-x) + var(--ico-w) + 4px)`) nên đổi cỡ icon là khoảng chừa tự đi theo, không còn con số 28px đoán tay chỉ áp cho một chỗ. Thêm: kính lúp **sáng lên khi ô đang được gõ** (dấu hiệu "đang tìm ở đây" rẻ hơn một nhãn chữ), và máy cảm ứng **không hiện gợi ý `/`** (không có bàn phím vật lý thì nó chỉ chiếm chỗ). |

### J2. Công cụ mới: `npm run smoke` — dựng thật cả app rồi bấm thử

`npm test` toàn là bài kiểm **tĩnh** hoặc dựng **từng component rời**. Loại lỗi bạn gặp
lại nằm ở chỗ khác: một effect chạy sai thứ tự, một state bị đọc trước khi có, một `null`
chỉ xuất hiện SAU khi đã đăng nhập. `tools/smoke.mjs` (chạy bằng `npm run smoke`, ~19 giây)
dựng **cả cây React thật** trong jsdom với đúng hai provider như `src/main.jsx`, đăng nhập
tài khoản demo, rồi **đi qua toàn bộ app**: màn chờ → trang chủ → bộ lọc → ô tìm → tab
Up next → **form request** (thẻ xem trước, ảnh bìa YouTube, dán link, bản nháp, nút bỏ
nháp) → **hộp vote** (ba ô số dư cộng đúng bằng tổng phiếu, phím mũi lên, bấm mức nhanh,
**gửi thật rồi kiểm con số trên hàng tăng đúng**) → Daily Spin → Xếp hạng → Của tôi →
**cả năm mục của `/admin`** (kể cả mở sẵn một địa chỉ đã lọc) → chế độ chọn nhiều.

Nó ghi lại **mọi thứ rơi ra console** kèm màn hình đang đứng, và rà **nhãn** ở từng màn:
chỗ nào có từ hai nhãn cạnh nhau mà không nằm trong một cụm biết xuống dòng thì báo. Kết
quả hiện tại: **50/50 mục đạt, 0 lỗi runtime**.

### J3. Kiểm thử và tài liệu của vòng 10

`npm test` → **324 ca / 323 đạt / 1 skip / 0 lỗi** (vòng 9: 309 ca). `npx oxlint` →
**0 lỗi**, 17 cảnh báo (vòng 9: 18 — bớt ba cảnh báo nhờ gỡ khối `pipeline` chết và đồng
bộ ref trong effect thay vì trong lúc render). Thêm mới: `tagLayout.test.js` (3 ca),
`ranking.test.js` +3 ca cho luật tính điểm, `AdminPanel.test.js` +2 ca, `adminTabs.test.js`
+3 ca cho địa chỉ mang bộ lọc, `VoteModal.test.js` +1, `ActionModal.test.js` +1,
`Progress.test.js` +3 vế. `docs/DESIGN.md` cập nhật §2.5 (màu vạch), §2.7 (luật tính
điểm), §5 (thanh lọc theo thiết bị, hộp vote trên điện thoại), §7 (bộ lọc ở địa chỉ),
§8 (bốn dòng mới trong danh sách kiểm trước khi ship). `HUONG-DAN.md` thêm mục **Công cụ:
`npm run smoke`** và các mục tính năng mới.

---

## K. Vòng 10 (tiếp) — tám việc gửi lại lần thứ ba, cộng nguồn tham khảo 21st.dev (19/09/2026)

Bạn gửi lại đúng tám việc đó lần nữa, kèm một nguồn tham khảo mới:
**21st.dev/community/components**. Đây là vòng đi **sâu vào chi tiết** — mỗi mục dưới
đây là một thứ *nhìn thấy được*, không phải một lần đổi tên lớp CSS.

### K1. Tham khảo 21st.dev: lấy KHUÔN, không lấy mã

21st.dev là chợ component React (shadcn/Tailwind/framer-motion). Trang này không dùng
Tailwind, không dùng framer-motion và có hệ token riêng, nên chép mã vào là phá hệ —
đúng điều bạn đã dặn ở vòng 6 ("nếu sử dụng thì đảm bảo thích hợp và tinh chỉnh sao cho
đồng bộ với trang"). Vòng này lấy **năm khuôn** đã thành chuẩn ở đó và dựng lại bằng
CSS của repo:

| Khuôn trên 21st.dev (nhóm) | Lấy gì | Dựng lại thành |
|---|---|---|
| *Search Bars* → "The Input with clear button", "Input Group" | ô nhập có icon dẫn đường + nút xoá, hai bên đều **chừa chỗ theo bề rộng thật của thứ nằm đè** | `--ico-x/--ico-w/--x-x/--x-w` trong `.searchwrap`; nút xoá to lên trên thiết bị chạm thì khoảng chừa **tự đi theo** (chỗ này bản cũ vẫn hở: 26px viết cứng) |
| *Search Bars* → "Expandable Search Bar", "Expanding Search Dock" | trên màn hẹp, ô tìm kiếm **chiếm trọn một hàng** thay vì chen với dải chip | `.fchips { flex: 1 1 100% }` + `.fbar-side { flex: 1 1 100% }` ở ≤620px |
| *Search Bars* → "Advanced Data Table Filter Builder", "Toolbar" | **chip của bộ lọc đang bật, bỏ được bằng một lần bấm** | `.fchip.onkind` (chỉ hiện trên máy hẹp, nơi khối lọc đã gấp lại) |
| *Stats & KPIs*, *Dashboard*, *Progress* | con số + **một vạch chia tỉ lệ** cho cả khối | `.adm-mix` (5 mục) và `.vm-mix` (3 nguồn phiếu) |
| *Tags/chip*, *Badges* | nhãn phải **kẹp và cắt được** | `.pill.dup` về `inline-block` để `text-overflow` chạy thật + `title` cho phần bị cắt |

Không có dòng mã nào chép từ 21st.dev, và không thêm thư viện nào: vẫn là React + CSS
của repo, đúng gói miễn phí.

### K2. Tám việc bạn yêu cầu — vòng này sửa gì thêm

| Việc | Vòng này thêm |
|---|---|
| **1. Bảng quản trị** | **Vạch chia tỉ lệ khối lượng việc** dưới dải số liệu (`.adm-mix`): năm ô nói "bao nhiêu", vạch nói "chiếm bao nhiêu phần", mỗi đoạn mang màu của mục đó nên không cần chú giải riêng. **Hai phím tắt in ra chỗ dùng** (`Esc` bỏ chọn · `Ctrl/Cmd+A` chọn cả trang — trước đây chỉ nằm trong tài liệu, mà phím tắt không ai biết thì không phải phím tắt), tự ẩn trên thiết bị cảm ứng. **Nhịp chốt bài đọc từ cấu hình** (`pickInterval` từ `settings.pick.interval_days`) thay cho số `4` viết cứng — lời gợi ý không còn có thể lệch khỏi lịch thật. **Ô tìm kiếm chiếm trọn một hàng trên máy hẹp**, và **ô số liệu lẻ cuối cùng kéo dài hết hàng** (năm ô trong hai cột để lại một lỗ hổng nửa bên phải). Thêm `aria-busy` khi chạy thao tác hàng loạt và một vùng `role="status"` cho trình đọc màn hình. |
| **2. Form request** | **TÁCH TIÊU ĐỀ VIDEO** — cách nhanh nhất để điền form là copy nguyên tiêu đề video, và đó cũng là cách chắc chắn nhất để ô tên bài chứa cả tên nghệ sĩ. Hàm thuần `splitSong()` trong `src/lib/board.js` đọc hai khuôn thật (tên bài trong cặp nháy — `CHUNG HA 청하 'Algorithm' MV`; và gạch nối — `aespa - Whiplash (Official Video)`), bỏ nhãn quảng cáo ở hai đầu `(Official Video)`, `[4K]`, **không đoán khi không có dấu hiệu** (`aespa Whiplash` → không làm gì), và form mời bạn bấm một lần để điền cả hai ô. Kèm: dải gợi ý đổi sắc so với dải "bài đã có" để hai dải đứng cạnh nhau vẫn phân biệt được. |
| **3. Luật tính của leaderboard** | **Cột ĐIỂM có cột riêng**: trước đây điểm chỉ là một chip nằm trong ô tên người, nên khi bảng xếp theo điểm thì con số quyết định thứ tự **không có cột**, và hàng tiêu đề không giải thích được vì sao thứ tự như vậy. Nay có `<th>Score</th>` với lời giải thích công thức, mỗi hàng một ô điểm, và **hàng của bạn cũng in điểm** ("40 points"). Luật phụ nói thêm: **bài bị từ chối không tính gì** (view `requester_ranking` lọc `status <> 'denied'`, bản demo gom đúng như vậy — đã kiểm lại vế SQL). |
| **4. Thanh filter theo thiết bị** | Máy hẹp: **mỗi hàng một việc** — dải chip trạng thái chiếm trọn một hàng (thấy được nhiều chip hơn thay vì bị bóp còn vài chục pixel), ô tìm kiếm + nút Bộ lọc xuống hàng dưới. Dải chip thêm **điểm dừng khi cuộn** (`scroll-snap`). **Chip loại bài đang lọc** hiện ngay trên hàng chính và bỏ được bằng một lần bấm (chỉ ở ≤620px, nơi khối lọc đã gấp lại — trên màn rộng khối lọc luôn hiện nên chip đó là chỗ thứ hai nói cùng một điều). |
| **5. Hộp nhập số vote** | **Vạch nguồn phiếu** dưới ba ô số dư: ba đoạn của **cùng một màu, đậm dần**, cho biết phiếu sắp dùng lấy từ đâu — ba ô số nói SỐ LƯỢNG, vạch nói TỈ LỆ. Con số lớn thêm `aria-live="polite"` (đổi số là được đọc lên), và ô nhập số phiếu trỏ tới dòng "còn 7 → còn 3" bằng `aria-describedby`. |
| **6. Nhãn chồng / vướng** | **LỖI THẬT còn sót**: `text-overflow: ellipsis` **không chạy trên hộp `inline-flex`** — chữ trong đó là một flex item ẩn, nên nhãn dài nhất của hệ ("3 requests for this song · 9 votes in total") bị **cắt ngang chữ mà không có dấu ba chấm**. Nay nhãn đó về `inline-block` (chữ nằm trực tiếp trong hộp nên dấu ba chấm vẽ được) và câu đầy đủ nằm ở `title`. Thêm `src/lib/tagLayout.test.js` (4 ca): quét toàn bộ JSX tìm cụm từ hai nhãn trở lên mà không nằm trong `.tags`, chốt hợp đồng kẹp nhãn, chốt hộp chứa nhãn phải có khe + biết xuống dòng, và chặn một "hệ nhãn thứ hai" mọc ra. |
| **7. Màu thanh progress** | **LỖI THẬT**: thanh luôn được vẽ và luôn giữ `min-width: 6px` (để 1% nhìn thấy được), nên ở **0% vẫn có một que màu nằm trong rãnh** trong khi con số ngay cạnh ghi "0%" — hai chỗ nói ngược nhau. Nay `Progress` **không dựng vạch khi `pct = 0`**, còn `min-width` giữ nguyên cho 1%. Rãnh nâng lên 7px với **bóng lõm khai ngay trong luật của rãnh** (bản trước có hai luật rời nhau), ruột vạch thêm **vế bóng tối ở mép dưới** nên đọc ra một thanh mảnh có mặt cong thay vì một dải màu dán phẳng, và **dấu `%` ăn theo tông của con số** (`opacity` thay vì một màu xám thứ ba). |
| **8. Ô search bị icon lòi ra** | Vá nốt vế **bên phải**: khoảng chừa bên phải từng là `26px` viết cứng, trong khi trên thiết bị chạm nút xoá được nới lên `30px` — chữ gõ vào vẫn chui được xuống dưới nút xoá. Nay **cả hai bên tính từ bề rộng thật** của thứ nằm đè (`--ico-w`, `--x-w`), nên nới nút xoá là khoảng chừa tự theo. Thêm: **cả hộp sáng lên khi đang gõ** (không chỉ con trỏ), và hai ô tìm kiếm có `aria-label` (placeholder không phải nhãn cho trình đọc màn hình). |

### K3. Kiểm thử và con số của vòng này

`npm test` → **333 ca / 332 đạt / 0 lỗi / 1 skip** (trước vòng này: 324). `npm run smoke`
→ **58/58** (trước: 50; thêm bốn phép thử *bấm thật*: gợi ý tách tiêu đề video, chip loại
bài đang lọc (hiện + bỏ), vạch nguồn phiếu cộng đúng 100%, vạch chia tỉ lệ của bảng quản
trị). `npx oxlint` → **0 lỗi**, 21 cảnh báo (đều là mẫu có sẵn của repo: `set-state-in-effect`,
`only-export-components`). Bản dựng: `index-BxQ09EV7.js` 359 kB, CSS 114.9 kB.

## L. Vòng 11 — lỗi trang quản trị, chữ in hoa, bánh xe trùng số, và luật xếp hạng (19/09/2026)

### L1. Lỗi nghiêm trọng trước, giao diện sau

Trang quản trị bị báo là "lỗi toàn bộ". Lần theo thì ra **ba lỗi thật**, không phải một:

| Lỗi | Vì sao nó làm cả trang hỏng |
|---|---|
| **Ghi địa chỉ không bọc lỗi** | Sáu chỗ gọi thẳng `window.history.pushState/replaceState`. Trong iframe bị sandbox (bản xem trước của nền tảng, `file://`, chế độ riêng tư) ba hàm này **ném `SecurityError`**; vì chúng nằm ngay trong handler React nên cú bấm của người dùng chạy được nửa đầu rồi lỗi bắn ngược lên. Nay mọi lần ghi địa chỉ đi qua `src/lib/history.js` — ba hàm `pushUrl`/`putUrl`/`here` **không bao giờ ném**, địa chỉ vẫn đúng khi môi trường cho phép và tự bỏ qua khi không. |
| **Không có lưới an toàn nào** | Không có `ErrorBoundary` ở đâu cả, nên **bất kỳ** lỗi nào lúc vẽ cũng gỡ sạch cả trang — một khối hỏng thành "trang lỗi toàn bộ", đúng như báo cáo. Nay `src/components/Boundary.jsx` bọc vùng quản trị (và đây là chỗ đầu tiên nên bọc, vì nó là vùng nhiều state nhất): khối nào lỗi thì chỉ khối đó hiện thông báo kèm nút dựng lại, phần còn lại của trang vẫn dùng được. |
| **Dữ liệu demo sai** (nhỏ nhưng thật) | Hàng demo là `Pop Off Pop Off` — tên lặp, và nó làm mọi so khớp theo tên bài lệch theo. Sửa về `Pop Off`. |

Phép thử mới trong smoke mô phỏng đúng môi trường thù địch: **chặn** `pushState`/`replaceState`
cho ném lỗi, rồi bấm nút Admin trong menu — bảng quản trị vẫn phải mở, vẫn phải đổi được mục,
và không được sinh lỗi mới trong console.

### L2. Không viết hoa, thanh tiến độ phẳng, hộp vote gọn

- **Gỡ toàn bộ 13 chỗ `text-transform: uppercase`** (nhãn loại bài, pill, tiêu đề mục, đầu
  bảng, nhãn sidebar, kicker, thông báo, hộp vote). Trong `src/index.css` giờ chỉ còn đúng một
  chỗ và nó là `text-transform: none`.
- **Thanh tiến độ phẳng** theo khuôn Preline: rãnh bo tròn 6px + ruột **một màu** + số ở cuối.
  Gỡ gradient, quầng sáng, bóng lõm, mũi sáng ở đầu vạch, và vệt sáng quét trên thanh của khối
  *Up next* — đúng thứ bị gọi là "gradient progress bar nhìn kì cục và AI quá".
- **Hộp vote**: gỡ thanh trượt, viên gợi ý phím, ba ô số dư có viền, vạch chia tỉ lệ nguồn
  phiếu. Quỹ phiếu nay là **một dòng** `còn 7 → còn 3`, kèm phần mua/thưởng nếu có.

### L3. Bánh xe không còn trùng số

Lỗi "trùng lặp số vote" là thật và nhìn thấy được: mỗi ô in một số, mà 9 trong 16 ô là `+1`
→ trên đĩa có **chín số 1 giống hệt nhau**. Bản vẽ nay gom các ô cùng thưởng thành **dải liền**
và in số **một lần cho mỗi dải** ở ô giữa, kèm số ô (`+1 ×9`, `+2 ×4`, `+3 ×2`, `+5`). Luật
rút, xác suất, và vị trí giải cao nhất (6 giờ) **không đổi**; `spinSectorIndex()` quy đổi chỉ
số ô của server sang ô trên bản vẽ nên kim vẫn dừng đúng ô được tô sáng (có test khoá cả 16 ô).
Màu lát nay đi theo **mức thưởng** thay vì xen kẽ chẵn/lẻ, đầu trang có một câu nói rõ luật
chơi (trước đây chỗ đó trống ở bản thật), và lịch sử có thêm **dòng tổng hôm nay** cùng màu
của mức thưởng.

### L4. Luật xếp hạng: bỏ con số tự đặt

Cột `Score` = `10 × bài đã xong + phiếu` đã bị gỡ cùng hai hằng số của nó. Trọng số `10`
không ứng với thứ gì trong sản phẩm, nên thứ tự trên bảng luôn cần một câu giải thích — và
vẫn đọc ra "kì lạ". Bảng nay xếp theo **ba con số đếm được**: **Completed** (mặc định) ·
**Votes earned** · **Requests**, đúng ba cột có thật trong view `requester_ranking`. Vạch tỉ
lệ dưới tên và nền hàng "của bạn" cũng về **một màu phẳng** (trước là gradient).

### L5. Cấp bậc tiêu đề, và form request gọn lại

- **Cấp bậc tiêu đề** được soát bằng một bài kiểm mới (`src/lib/headings.test.js`): mỗi màn
  hình đúng **một** `h1`, không nhảy cóc cấp, tiêu đề khối phải là **thẻ tiêu đề** chứ không
  phải `<div class="section-title">`. Theo đó: tiêu đề khối *Up next* thành `h2`, tiêu đề các
  khối trong bảng thành `h2`, tên bài trong khối *Up next* và trong bảng quản trị là `h3`, và
  hộp Request/Buy có thêm một `h2` (ẩn về mặt thị giác) làm tên cho hộp thoại — trước đây nó
  là `role="dialog"` **không có tên**, trình đọc màn hình chỉ đọc "hộp thoại".
- **Form request bớt rối**: bốn tấm thẻ loại bài (mỗi thẻ kèm một câu giải thích) → **một hàng
  chip + một dòng giải thích cho loại đang chọn**; ô **ghi chú** (ô tuỳ chọn duy nhất) gấp lại
  sau một nút "Add a note" và tự mở nếu đã có chữ từ nháp/link mời.

### L6. Số của vòng này

`npm test` → **339 ca / 338 đạt / 0 lỗi / 1 skip** (trước vòng này: 333). `npm run smoke`
→ **63/63** (trước: 58). `npx oxlint` → 0 lỗi. CSS chính 3 507 dòng, cân bằng ngoặc, và
`lightningcss` đọc được toàn bộ tệp.

## M. Vòng 13 — đĩa quay trả đúng thưởng, thanh lọc hết "bay", và một lượt rà DOM toàn trang (19/09/2026)

> Vòng 12 (gộp hồ sơ vào mục **About me**, form request ba bước, trạng thái rỗng của bảng quản trị,
> gỡ *Order queue*, gỡ năm chuỗi thừa, "Two free a day", icon cây bút) đã lên ở các commit `2ce5f9d`
> … `b45493a`; phần dưới đây là vòng 13.

### M1. Vì sao quay ra **không đúng** phần thưởng — và cách sửa tận gốc

Máy chủ trả về **chỉ số ô trong bảng rút**, còn mặt đĩa được **vẽ lại**: các ô cùng mức thưởng được
gom thành dải và cả vòng được xoay để dải giải cao nhất nằm ở 6 giờ (`spinSectors`). Công thức cũ
lấy `chỉ số × 22,5°` để tính góc dừng — tức là tính trên bảng rút, không phải trên bản vẽ. Hai bên
lệch nhau nên kim dừng ở một ô **khác** với ô được tô sáng.

Cách sửa không phải "chỉnh lại hằng số cho khớp" (lần sau đổi bảng rút là lệch lại) mà là **đổi hợp
đồng của hàm**: `spinRotation(góc cũ, GÓC TÂM CỦA Ô TRÚNG TRÊN BẢN VẼ)`. Thêm hàm ngược
`sectorAtPointer(rotation, sectors)` để bài kiểm hỏi được câu đúng: *"sau khi quay R độ, kim đang chỉ
vào ô nào?"* — test đi hết **16 ô**, mỗi ô kiểm bằng chính bản vẽ, và còn kiểm ô dưới kim trùng ô
được tô sáng (mắt nhìn đĩa, không đọc số).

### M2. Đĩa **rõ** và **có màu**

- Bốn tầng thưởng nay là **bốn màu** thay vì bốn sắc xám: `+1` nền trung tính · `+2` xanh tím
  (`--queued`) · `+3` hổ phách (`--progress`) · `+5` vàng (`--paid`). Vẫn 100% **phẳng** —
  `color-mix` cho ra một màu đặc, không gradient.
- Ô vàng đổi chữ sang **mực đậm** (`#1a1206`, ~13:1) vì trắng trên vàng chỉ được ~2,5:1.
- Thêm **chú giải bốn dải** ngay dưới đĩa: mỗi dòng một ô màu (dùng đúng biến `--wc` của lát trên
  đĩa nên không thể lệch màu) + số ô + tỉ lệ thật. Đây là **dữ liệu**, không phải ghi chú.

### M3. Thanh lọc **không còn bay** khi cuộn

Bỏ hẳn `position: sticky` (và cả khối `.fbar.stuck`). Trước đây khi dính, thanh cao gần nửa màn
hình trên máy hẹp nên nó phủ lên danh sách suốt lúc cuộn. Nay thanh **nằm trong dòng**: cuộn qua là
nó đi theo trang; nút *lên đầu trang* (góc phải dưới) là đường quay lại. Việc theo dõi "đang dính"
trong `App.jsx` cũng bị gỡ theo (một effect + một state ít hơn).

### M4. Bốn chuỗi đã gỡ

`"… TikTok"` ở dòng gợi ý kiểu bài (nay chỉ nói Shorts) · nhãn dài của thẻ xem trước
(`req.preview`) · câu *"Paste the YouTube link if you have one."* (`req.linkHint`) · dòng
*"Square crop, up to 8MB"* (`prof.avatarNote`). Kèm theo: dòng gợi ý dưới ô Link **chỉ dựng khi có
điều để nói** (link sai dạng / đã nhận ra link), và `aria-describedby` của ô đó được bỏ khi dòng ấy
không tồn tại — trỏ vào một id không có là một liên kết đứt.

### M5. Bảng quản trị

- **Nền của `<html>`** được đặt tường minh: chuyển cảnh cho hai ảnh chụp trượt ngang nên hai mép
  màn hình lộ ra "khung vẽ" bên dưới, mà khung vẽ mặc định của trình duyệt là **màu trắng**. Nay
  mọi khe hở (kể cả kéo quá đà trên iOS) là màu nền trang. Lớp phủ của chuyển cảnh cũng được tô nền.
- Mục **Videos** có **thanh công cụ đúng một hàng** như mọi mục khác (nút *View on home page* vào
  `.adm-bar`), thay vì một dải riêng nằm chênh giữa tiêu đề và nhóm đầu tiên.
- **Hàng video trên máy hẹp**: năm nút (hai nút đổi thứ tự, Sửa, Ẩn/Hiện, Xoá) xuống thành **một
  hàng riêng** dưới tiêu đề, nút cao 38px; trước đây luật bó hàng chỉ áp cho hàng request.
- Hai nút đổi thứ tự dùng **icon Lucide** (ArrowUp/ArrowDown) thay cho ký tự `↑` `↓`.
- Hàng cuối không còn vẽ thêm đường kẻ dưới (mỗi hàng đã là một thẻ có viền riêng).

### M6. Tiếng

Âm sắc: thêm **bè trầm nửa cao độ** (nghe ra "gỗ" thay vì "tiếng bíp"), bồi âm quãng tám bị **chặn
trần 5kHz** (2 × C7 là đỉnh chói nhất), tiếng gõ dùi ở đầu nốt hạ từ nửa biên độ xuống 0,28 và lọc
xuống 6,5kHz, trần lọc chung 4,6kHz, vang 0,22 → 0,15, âm lượng mặc định 0,8 → **0,7**. Tiếng tách
của vòng quay khẽ hơn (~2/3) và tối hơn (2,1kHz). **Tin về dồn dập không kêu thành chuỗi**: hai
tiếng thông báo cách nhau tối thiểu 1,5s. Hai tiếng chưa từng được gọi (`open`, `close`) bị gỡ;
tiếng **xoá** được nối vào đúng chỗ nó có nghĩa: nút xoá trong bảng quản trị (một dòng, và một lượt
xoá hàng loạt).

### M7. Rà DOM toàn trang — và ba lỗi thật nó tìm ra

`npm run smoke` có thêm một khối **rà DOM** chạy trên năm màn, năm mục của bảng quản trị và hai hộp
thoại: **id trùng** · **phần tử tương tác không có tên** · **tham chiếu `aria-*`/`label[for]` trỏ
vào id không tồn tại** · **ảnh thiếu `alt`** · **thẻ tương tác lồng nhau**. Ba lỗi thật lộ ra và đã
sửa: (1) `aria-describedby="req-link-hint"` đứt khi dòng gợi ý không dựng (M4); (2) ô chọn ảnh ẩn
trong khối hồ sơ không có tên cho trình đọc màn hình; (3) máy kiểm đóng hộp thoại bằng nút đầu tiên
nên báo lỗi lặp — nay đóng bằng `Esc`.

### M8. Số của vòng này

`npm test` → **352 ca / 351 đạt / 0 lỗi / 1 skip** (trước: 350). `npm run smoke` → **171/171**
(trước: 100; thêm 65 mục rà DOM + 6 mục khoá các việc vòng 13). `npx oxlint` → **0 lỗi** / 22 cảnh
báo (101 tệp). `npm run build` → OK. Bản chạy thử: `npm run dev` (đang chạy ở cổng 5173, chế độ
demo không cần Supabase).

### M9. Thẻ xem trước có lại tên của nó

Vòng 13 gỡ nhãn dài `Preview — this is what goes on the board` như chủ dự án yêu cầu — nhưng gỡ
luôn **cả chữ "Preview"**, thành ra thẻ chỉ còn một khung viền có con mắt, nằm dưới hai ô vừa gõ mà
không nói nó là gì. Đây là lỗi do gỡ quá tay. Nay `req.preview` = **`Preview`** — đúng một chữ, đủ
làm tên; câu dài vẫn vắng mặt (máy kiểm vẫn khoá: không được có "goes on the board"). `ActionModal`
dựng `<span>` này cạnh biểu tượng con mắt; chip xanh "đã nhận link" hiện thêm khi có link hợp lệ.
`smoke` thêm mục đọc thẳng chữ trong `.req-preview` để không thể mất lần nữa.

### M10. "Trang không lên" — cách kiểm và cách chạy

Trang chạy ở cổng 5173 qua **bản dựng thật** (`vite preview`) chứ không phải dev server nữa:
dev server sống bằng HMR, mỗi lần sửa là mỗi lần nạp lại nửa vời; nếu trình duyệt đang mở đúng lúc
tệp được ghi thì tab có thể kẹt ở trạng thái nửa cũ nửa mới. Bản dựng thì mỗi lần chỉ có một tệp
JS/CSS duy nhất, không có HMR, không có trạng thái trung gian.

Trước khi đổi, đã kiểm và loại trừ (đều **sạch**, không tìm ra lỗi nào ở phía máy chủ):

- dev server: tiến trình còn sống, nhật ký chỉ có 3 dòng HMR, không lỗi;
- `GET /` → 200 (3.724 byte); **cả 10 mô-đun** nguồn tải về đều 200 và qua được bước biên dịch;
- CSS: biên dịch bằng `lightningcss` → **OK** (146.945 byte), nên không có cú pháp hỏng làm sập trang;
- `npm run build` → OK, và **`vite preview` phục vụ `/`, `/admin`, `/daily-spin` đều 200**, tệp JS 360.140 byte.

Nếu vẫn chưa lên: xem tab có đang mở địa chỉ cũ từ phiên trước không (mở lại địa chỉ xem trước), và
nếu màn hình vẫn trắng thì gửi giúp **địa chỉ đang mở + dòng lỗi đỏ trong Console** (F12 → Console) —
có hai thứ đó là khoanh được ngay, còn đoán thì chỉ tốn thời gian.

## Phần N — vòng 13 (tiếp): nền khung vẽ, và chín chỗ CSS tự ghi đè

### N1. "Flash trắng" — dòng khai báo bị thiếu, chỉ có chú thích

Cách tìm ra: **soi bản DỰNG, không soi mã nguồn**. Trong `dist/assets/index-*.css`, khối `html`
chỉ có `color-scheme`, `scrollbar-gutter`, `scroll-behavior` — **không có `background`**. Trong
`src/index.css` thì khối `html` có nguyên một đoạn chú thích dài giải thích vì sao phải đặt
`background: var(--bg)` ở đó, và ngay dưới chú thích là... `scrollbar-gutter`. Dòng khai báo chưa
bao giờ được ghi vào tệp, dù vòng 13 đã báo là đã sửa.

Hậu quả: mọi khe hở trong lúc chuyển cảnh vẫn lộ khung vẽ của trình duyệt. `index.html` có một bản
sao nội tuyến (`html{background:#0a0c10}`) cứu được khung hình đầu, nhưng đó là **hai chỗ nói cùng
một chuyện** — sửa màu nền ở một chỗ là chỗ kia lệch, và nếu tệp HTML bị thay bằng bản khác thì
không còn gì đỡ.

Đã sửa: khai báo có mặt trong `src/index.css`, và **đã kiểm trong bản dựng**
(`html{…;background:var(--bg);…}`). Thêm `src/lib/cssNoFlash.test.js` — 4 ca:

1. luật `html` trong `index.css` **phải** có `background: var(--bg)`;
2. `index.html` phải có nền nội tuyến, và **mã màu phải trùng token `--bg`** (lệch là lại thấy một
   nháy màu cũ);
3. lớp phủ `html[data-vt="on"]::view-transition` phải được tô nền;
4. **không luật nào tự ghi đè chính nó** (xem N2).

### N2. Chín chỗ khai báo bị luật sau ghi đè — còn 0

Công cụ: một bộ đọc CSS nhỏ đi qua tệp theo từng khối, ghi lại `(ngữ cảnh, bộ chọn, thuộc tính)`,
và báo mỗi lần cùng khoá đó được khai lại với giá trị khác. Trước: **12 chỗ**. Sau: **0**.

Đã gỡ hẳn (những dòng chưa bao giờ có tác dụng, nhưng vẫn nằm đó chờ người sau sửa nhầm):

| Chỗ | Chuyện gì |
|---|---|
| `.overlay` · `.modal` | `animation: fade` / `animation: pop` cũ vẫn còn trong khi khối cuối tệp đã đặt `fadeIn` / `popIn`; gỡ luôn **hai `@keyframes` không còn ai gọi** |
| `.row.paid` | một luật phẳng ở đầu tệp, một cặp **gradient** ở cuối tệp đè lên — nay còn **một cặp phẳng** (thường + hover), tức hàng paid thôi đổi tính cách khi rê chuột, và bớt một gradient |
| `.pack.best` | **hai nền gradient xếp lên nhau** (một tím `--a-soft`, một vàng) — lớp dưới không bao giờ hiện; nay một sắc vàng nhạt phẳng |
| `.pack` | `transition: border-color .13s` bị luật đầy đủ ở dưới thay |
| `.adm` | `padding: 10px 0` của bản danh sách phẳng cũ, trong khi hàng đã là **thẻ** có đệm riêng |
| `.pick-cd` (3 dòng) | định nghĩa cũ (căn trái, cỡ 12,5px) bị định nghĩa mới (nhãn trên · số mono căn phải) thay hoàn toàn |
| `.kchip` | `transition` khai hai lần với **cùng một danh sách chỉ khác thứ tự** |
| `::-webkit-scrollbar-thumb:hover` | hai sắc xám khác nhau cho cùng một trạng thái |
| `.rules ol` | `padding-left: 20px` chết vì luật sau chuyển danh sách sang **bộ đếm tự vẽ** (`list-style: none` + `<b>` hình tròn) |

Và **một lỗi thật nằm trong CÙNG một luật**: ở khối `≤620px`, `.pick-cd` khai `align-items` hai lần
(`flex-start` rồi `baseline`) — dòng đầu vô nghĩa, mà đọc lên thì tưởng hàng đang căn trên. Đã gộp.
Tương tự, `.grow-rows-in > .row` khai **hai cạnh ở hai chỗ** (`padding-right` khai lại ở khối thẻ) —
nay mỗi cạnh một chỗ.

### N3. Số của lượt này

`npm test` → **356 ca / 355 đạt / 0 lỗi / 1 skip** (trước: 352; thêm 4 ca chống flash). `npm run smoke`
→ **172/172**. `npx oxlint` → **0 lỗi**. `npm run build` → OK, và **đã kiểm bản dựng**: khối `html`
trong `dist` nay có `background: var(--bg)`.

### N4. "Phần paid request" — kiểm tra và kết luận còn treo

Trước khi sửa gì, đã **dựng thật cả app trong jsdom** rồi đi hết đường của một paid request: mở form →
bước 1 → bước 2 (điền tên bài) → bước 3. Kết quả trong DOM:

```
<div class="paidbox">
  <label class="switch"><span class="chk"><input type="checkbox">…</span>
  <span class="t">Paid request ($0.75 / 20,000₫)</span></label>
  <p>Approved and started <b>immediately</b>, no voting needed. Send the payment after submitting.</p>
</div>
```

Và trên bảng còn nguyên `<span class="pill gold">PAID</span>`. Bốn mặt của tính năng đều còn trong mã:
ô chọn ở **bước 3** của form · nhãn **PAID** trên hàng (kèm luật xếp *paid đứng trước*) · mục
**Orders** của `/admin` (nút "Mark as paid") · mục **My orders** trong *About me*. Không có mã CSS
hay chuỗi i18n nào của paid bị thiếu (đã quét chéo CSS ↔ JSX và chuỗi ↔ khoá).

→ Kết luận: **không tìm thấy chỗ nào bị xoá**. Cần chủ dự án chỉ đúng chỗ đang nhìn để sửa trúng,
thay vì đoán rồi sửa nhầm ba bốn chỗ khác.

## Phần O — vòng 13 (tiếp): kéo đĩa để quay, và dọn khoá chữ chết

### O1. Kéo đĩa — thao tác quen tay, và là mảnh âm thanh còn lại

Đĩa trước giờ chỉ quay được bằng NÚT, nên "tiếng tách khi kéo đĩa" không có gì để bám vào.
Nay đĩa cầm được bằng tay: giữ và kéo thì đĩa xoay theo con trỏ, mỗi vạch đi qua là một
tiếng tách, nhả ra thì vào lượt quay thật. Ba quyết định, kèm lý do:

| Quyết định | Vì sao |
|---|---|
| **Chuột và bút, KHÔNG ngón tay** | Trên máy cảm ứng, kéo một ngón ở giữa màn hình là **cuộn trang**. Cướp thao tác đó để quay làm trang khó dùng hơn hẳn, đổi lại chỉ thêm một cách quay — trong khi nút quay 46px đã nằm ngay dưới đĩa |
| **Phần kéo nằm ở LỚP BỌC, không ở đĩa** | Đĩa đã có `transform` do React đặt cho nhịp quay 4,5s. Kéo ở lớp bọc rồi lúc nhả **cộng dồn phần đã kéo vào góc thật** (và đặt lại transform của đĩa trong CÙNG khung hình) là cách duy nhất để đĩa không nhảy về vị trí cũ trước khi quay |
| **Nhả ra mới quay; dưới 40° coi như chạm hụt** | Kéo chỉ là cách bấm nút cho vui tay. Kết quả vẫn do **máy chủ** quyết định, nên không có đường gian lận nào mở ra; kéo hụt thì đĩa trả về chỗ cũ trong 0,26s để tay biết là chưa đủ |

**Tiếng tách lúc kéo** dùng cùng cơ chế với lúc máy quay, chỉ khác nhịp do tay quyết định:
hàm thuần `dragTicks(from, to)` đếm số vạch đã đi qua (dùng `trunc` để góc **âm** đếm đúng —
kéo ngược chiều kim đồng hồ phải kêu y như kéo xuôi), độ mạnh theo **tốc độ kéo** (sàn 0,45
để tiếng nhẹ vẫn nghe ra, trần 1 vì hơn nữa tai không phân biệt được), **sàn 45ms** và tối đa
**3 tiếng một nhịp** để một cú nhích dài không thành tràng "tạch tạch". Nhịp đàn hồi 0,26s trên
lớp bọc bị tắt trong lúc kéo (đĩa phải bám tay 1:1), và tắt hẳn khi người dùng chọn giảm
chuyển động.

Bản dựng còn một lỗi nữa lộ ra trong lúc làm: `wrapRef` được **khai báo nhưng chưa bao giờ
gắn vào phần tử**, nên tay kéo không nhận được gì — máy kiểm bấm thật phát hiện ngay (3 mục
đỏ), chứ đọc mã thì khó thấy.

### O2. Sáu khoá chữ chết trong từ điển

Một khoá không ai dùng không làm gì hỏng, nhưng nó là một chuỗi phải đọc, phải dịch và phải
giữ mãi — mà người dọn sau không biết nó là để dành hay là rác. Đã gỡ: `crop.title`,
`menu.admin`, `req.needFields`, `vote.available`, `vote.canTakeBack`, `adm.emptyList`.

Và gỡ xong thì máy giữ: `i18nKeys.test.js` có thêm **ca 6 — không khoá nào nằm chết**, chạy
chiều ngược với các ca cũ ("bản dịch có ai dùng không" thay vì "chuỗi dùng có bản dịch không").
Ba đường miễn trừ, và chỉ ba: khoá có mặt **nguyên văn** trong một tệp mã (kể cả khi nó nằm
trong một bảng dữ liệu như `adminTabs.js`) · khoá thuộc một **họ ghép động** đang dùng (đọc
thẳng các mẫu `` t(`nav.${…}`) `` trong mã) · mã lỗi `err.*` (phần lớn đến từ payload của máy
chủ, ca 4 đã giữ đầu kia). Đã thử bằng cách **cấy một khoá chết giả** — máy kiểm đỏ đúng chỗ.

### O3. Số của lượt này

`npm test` → **359 ca / 358 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **178/178** (thêm ba mục
bấm thật cho tay kéo). `npx oxlint` → **0 lỗi**. `npm run build` → OK.

Nối tiếp phần N, hết danh sách dư của vòng 13.

## Phần P — vòng 14: hộp xác nhận của app, và ba lỗi im lặng ở ô "bài trả phí"

### P1. Bảy nút xoá/từ chối từng không làm gì (lỗi thật, người dùng báo)

Xoá request, xoá video, xoá một dòng quản trị, xoá hàng loạt, từ chối một bài, từ chối hàng
loạt, và huỷ đơn — cả bảy hỏi bằng `confirm()`/`prompt()` của trình duyệt. Trong iframe bị
chặn hộp thoại (thiếu `allow-modals`: mọi khung xem trước, mọi trang nhúng), `confirm()` trả
`false` và `prompt()` trả `null` **mà không báo gì**; trình duyệt cũng tự chặn sau vài lần
bấm. Người dùng bấm **Xoá** và không có gì xảy ra — nhìn y hệt "bảng quản trị hỏng", trong
khi mã nguồn không sai dòng nào. jsdom (dùng cho `npm run smoke`) cài hai hàm đó là hàm rỗng,
nên đúng những đường GHI nguy hiểm nhất chưa từng được máy kiểm.

Nay là hộp của app: `src/components/ConfirmDialog.jsx` + `src/lib/confirm.jsx`, `ConfirmProvider`
bọc `App`. Hỏi xong mới làm (`if (!(await ask({…}))) return`), Esc / bấm ra ngoài / Cancel là
huỷ và **không ghi gì**, ô lý do cho việc từ chối (Enter xuống dòng, Ctrl+Enter gửi).
`src/lib/noNativeDialogs.test.js` quét `src/` và đỏ nếu có ai gọi lại `confirm/prompt/alert`;
`tools/smoke.mjs` (mục 10b) bấm thật qua cả năm đường ghi.

### P2. Ô "bài trả phí": ba lỗi, và cả ba đều im lặng

Câu hỏi của chủ dự án — *"trong form request, bước chọn paid request bị bỏ qua"* — dựng lại
được, và có **ba** nguyên nhân chồng lên nhau:

| Lỗi | Cách nhìn ra |
|---|---|
| Sau khi gửi một request trả phí, ô tick **vẫn bật** cho request sau | Dựng app thật, gửi một paid request, rồi điền bài thứ hai: tới bước 3 thì `checked=true` và nút gửi vẫn là "Send paid request for $0.75" — người dùng không được hỏi lại về tiền |
| Đổi tab trong cùng hộp (Request ↔ Vote ↔ Buy) **xoá sạch form** | `RequestTab` bị tháo khỏi cây → bộ đếm 400ms ghi nháp bị huỷ → chữ vừa gõ mất luôn, bước về 1, ô tick biến mất. Quay lại là phải gõ lại từ đầu |
| Nút **Clear** xoá chữ nhưng để nguyên ô tick | Ở bước 1 không nhìn thấy ô đó, nên lựa chọn về tiền còn sót lại là thứ vừa vô hình vừa có giá |

Sửa trong `src/components/ActionModal.jsx`: `setPaid(false)` sau khi gửi và trong `clearForm`;
nháp ghi ở hai thời điểm (400ms ngừng gõ, và **ngay khi rời màn** — hàm dùng chung `writeDraft`,
giá trị mới nhất trong `ref`); nháp mang thêm `step` nên mở lại đứng đúng bước đang làm dở.

**Kiểm chứng bằng cách gỡ bản sửa ra**: gỡ phần nháp/bước → 3 mục smoke đỏ; gỡ `setPaid(false)`
→ 2 mục đỏ (`tick=true`, nút gửi vẫn "Send paid request for $0.75"). Một lỗi của chính công cụ
kiểm thử cũng lộ ra trong lúc làm: mục rà DOM đóng hộp vote bằng selector **không tồn tại**
(`.vm-close`), nên hộp vote ở lại mở và khối mới chạy trong sai hộp — nay đóng bằng `Esc` và
có mục chốt "không còn lớp phủ nào treo lại".

### P3. Header an toàn, và hai chỗ dọn

`public/_headers` có khối `/*` với `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS;
`worker/index.js` tự gắn `nosniff` cho mọi response JSON. **Chưa** đặt CSP — CSP sai một nguồn
là trang trắng, mà nguồn thật (Supabase, `i.ytimg.com`, Turnstile) chỉ kiểm chứng được trên
bản deploy. Bỏ `adminPick` (hàm chết, nút Pick đi qua `adminPickGroup`); `USD_VND` từ một câu
chú thích thành hợp đồng có test (`src/lib/priceRate.test.js`).

### P4. Số của vòng này

`npm test` → **366 ca / 365 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **225/225** (trước vòng
này: 178). `npx oxlint src tools worker supabase` → **0 lỗi, 13 cảnh báo** (đầu vòng: 20 cảnh
báo). `npm run build` → OK, bundle chính 293,7 kB (gzip 91,4 kB).

## Phần Q — vòng 14 (tiếp): bước trả phí bị bỏ qua lần nữa, và đường thật là bấm Enter

### Q1. Ba lỗi cũ không phải đường chủ dự án gặp

Báo cáo trước kết luận bằng ba lỗi im lặng (ô tick dính sang request sau, form mất khi đổi
tab, Clear không xoá ô tick) kèm bằng chứng gỡ-bản-sửa-ra. Chủ dự án trả lời: **vẫn bị skip**.
Kết luận rút ra: ba lỗi đó là thật nhưng không phải đường người dùng đi, nên không được coi
một danh sách lỗi đã sửa là bằng chứng cho một lời phàn nàn cụ thể.

### Q2. Đường thật: `onSubmit` của form, không phải nút gửi

Trong trình duyệt, Enter trong một ô nhập của form là **gửi form**; trên điện thoại phím
Enter là nút "Go". Cả hai đều vào `onSubmit` của `<form>` duy nhất trong `src`
(`ActionModal.jsx:354`). Bản cũ gọi thẳng `goSubmit()` bất kể đang ở bước nào → tạo request
**ngay từ bước 2**, và người dùng chưa từng thấy bước 3 (ô "bài trả phí") — đúng hiện tượng
được báo.

Vì sao lượt rà trước bỏ sót: **jsdom không mô phỏng việc gửi ngầm**, chỉ phát `submit` khi
bấm nút gửi. Cả bộ kiểm đi qua chỗ này mà không thấy gì. Bài học quy trình: khi một lời phàn
nàn về luồng UI không tái hiện được bằng jsdom, phải **phát đúng sự kiện mà trình duyệt phát**
(`new Event('submit', {bubbles:true, cancelable:true})` trên `<form>`) thay vì kết luận
"không tái hiện được".

### Q3. Sửa

- `submit()` gate lại: `if (step < 3) { next(); return }` — chốt đặt ở tầng form để mọi ô
  nhập thêm sau này đều đi qua nó.
- `<form onKeyDown={onFormKey}>`: chặn Enter ở bước 1–2 (chỉ với `INPUT`), đi tiếp một bước;
  `textarea` giữ nguyên nghĩa xuống dòng, bước 3 giữ nguyên nghĩa gửi.
- Đảo thứ tự bước 3: `.paidbox` **trước** `.note-field` — màn quyết định phải đọc từ trên
  xuống theo mức quan trọng.

### Q4. Kiểm chứng hai chiều

Chiều lỗi (bản chưa sửa, phát `submit` ở bước 2 sau khi điền tên bài): `bước=1`, request
`6 → 7`, có thông báo đã gửi, `.paidbox` chưa từng xuất hiện; dòng được ghi là
`is_paid:false`. Chiều đã sửa: bốn tình huống ở đầu mục 10c đều đúng, và gỡ chốt ra thì
`npm run smoke` tụt còn **218/225** (7 mục đỏ, trong đó có mục "đưa người dùng tới bước 3").

### Q5. Số của vòng này

`npm test` → **366 ca / 365 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **235/235** (trước lượt
này: 225). `npx oxlint src tools worker supabase` → **0 lỗi, 13 cảnh báo**. `tools/_probe_enter.mjs`
là đồ tạm, đã xoá sau khi lấy xong bằng chứng.


## Phần R — trước khi merge: hai chỗ tài liệu thiếu so với thực tế

1. Bảng *"Chạy lại SQL khi repo có bản mới"* trong `HUONG-DAN.md` dừng ở
   `20261103_vote_hardening.sql` — thiếu `20261104_spin_streak.sql`. Ai làm đúng theo
   tài liệu sẽ bỏ sót đúng bản vá luật "vòng quay không lặp quá 2 lượt". Đã thêm dòng.
2. Mục *"Nên kiểm tra bằng tay sau khi deploy"* không có mục nào cho luồng request trả phí.
   Đã thêm bốn việc phải bấm tay — Enter/"Go" ở bước 2 phải ra bước 3, request kế tiếp phải
   tắt ô trả phí, đổi tab phải giữ form, và ba lượt quay liền không được trùng số — vì đây
   đúng là những thứ jsdom không mô phỏng được (lý do cả bộ kiểm đi qua lỗi này ở vòng 14).

## Phần S — vòng 15: "phần hiện status xấu quá … nhìn AI"

### S1. Truy đúng chỗ, không đoán

Báo cáo vào repo chỉ có một câu: *"phần hiện status xấu quá à"*. Chỗ hiện trạng thái trên
trang này có bốn nơi (nhãn trong từng hàng request, dải chip lọc, ô trạng thái trong bảng
quản trị, thẻ trong khối Up next). Đã hỏi lại đúng hai câu trước khi sửa: **chỗ nào**, và
**xấu ở điểm nào**. Câu trả lời: **dải chip lọc trạng thái**, và nó xấu ở chỗ **"nhìn AI"**.

Đây là điểm đáng ghi lại về quy trình: ba chữ "nhìn AI" không nói ra được một dòng CSS nào.
Nó chỉ thành việc làm được sau khi mình tự trả lời câu hỏi *"cụ thể thì thứ gì ở đó đọc ra
do máy sinh?"* — và câu trả lời phải là một **danh sách đếm được**, không phải một cảm nhận.
Bốn thứ trong danh sách đó (rãnh bo tròn, chấm tròn, huy hiệu số, nền tô khi chọn) nay nằm
nguyên văn ở khối *THANH LỌC — DẢI CHẾ ĐỘ XEM* trong `src/index.css` và ở §2.8 `DESIGN.md`.

### S2. Đã sửa gì

| Trước | Sau |
|---|---|
| Hai lớp bo tròn lồng nhau: rãnh thuốc bao quanh bảy chip thuốc | **Bỏ rãnh** — các mục nằm thẳng trên mặt thanh lọc |
| Chấm tròn màu 7px trước mỗi nhãn | **Vạch đứng 3×15px** (đọc ra "một chặng", không ra "đèn báo") |
| Số nằm trong huy hiệu bo tròn có nền | Số chỉ là **số**: mono, `tabular-nums`, không nền; số `0` lùi lại một nhịp |
| Mục đang chọn = viên thuốc **tô nền** + viền màu | Mục đang chọn = **chữ trắng + vạch đầy màu + số mang màu của mục đó**; không tô nền, không đổi độ đậm (đổi độ đậm làm cả hàng nhích một nhịp mỗi lần bấm) |
| Bảy mục cùng khuôn, xen kẽ hai trục: `Queue · Up next · Newest · Top voted · In progress · Done · Following` | **Ba nhóm, hai vạch ngăn**: `Queue · Up next · In progress · Done` (đúng thứ tự dây chuyền) │ `Newest · Top voted` (cách nhìn cả bảng) │ `Following` (việc của riêng bạn) |
| `--a` làm màu của "Newest" | `--a-2` cho cả hai cách nhìn: `--a` (hue 242) ở 40% opacity trên nền `#10141a` là một vạch gần như vô hình |

### S3. Vì sao "Newest" và "Top voted" vẫn nằm trong dải

Đã cân nhắc chuyển hai mục đó ra một control "sắp xếp" riêng ở hàng trên, rồi **không làm**:
`top` không chỉ là một cách sắp — nó *lọc* (bài đã xong hoặc đã vào dây chuyền không còn xin
phiếu, xem `visible` trong `App.jsx`), nên nó là một **cách nhìn**, cùng loại với bốn giai
đoạn. Đẩy nó vào một nút "sắp xếp" là nói sai bản chất của nó. Cách sửa đúng là **một vạch
ngăn**: hai trục vẫn nằm cạnh nhau, nhưng mắt đọc ra được là hai trục.

### S4. Kiểm chứng

- `src/lib/cssFilterBar.test.js`: ba phép kiểm mới chốt *không có* nền/viền/bo góc trên dải,
  *không còn* luật `.fdot` (và JSX không dựng lại chấm tròn), số không có nền, mục đang chọn
  **không được tô nền**, thứ tự bốn giai đoạn trong `FILTERS`, và vạch ngăn mọc theo **nhóm**
  (nhóm vắng thì vạch ngăn biến mất).
- `npm run smoke`: năm mục mới chốt trên DOM thật — mỗi mục có vạch, **đúng một** mục đang
  chọn, bốn giai đoạn đứng liền nhau đúng thứ tự, số vạch ngăn khớp số nhóm đang hiện.
- **Hai phép kiểm cũ đang đỏ sẵn và đã được sửa cho đúng thực tế** (không phải do vòng này):
  1. *"dải chip đứng sau ô tìm kiếm"* đòi `.fbar-top` có thứ tự `searchwrap · fchips`, trong
     khi bản hiện tại (từ vòng 12) xếp `searchwrap · fbar-side · fchips` — tức con số đếm và
     nút **Bộ lọc** đã được đưa lên hàng trên. Phép kiểm báo đỏ một thứ tự **đã cố ý**.
  2. *"chú giải in ra số ô và tỉ lệ"* đòi chú giải bốn tầng thưởng của vòng quay in `N slices
     … %`, trong khi chú giải đã cố ý bỏ số ô và tỉ lệ (tỉ lệ thật nằm ở `aria-label` của
     chính đĩa) — bản in đầy đủ biến chú giải thành bảng dữ liệu dưới một trò chơi.
  Cả hai nay chốt đúng điều đang có, kèm một dòng ghi lại vì sao phép kiểm cũ sai. **Một
  công cụ còn màu đỏ vĩnh viễn là một công cụ dạy người ta cách phớt lờ màu đỏ.**

### S5. Số của vòng này

`npm test` → **372 ca / 371 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **240/240** (trước vòng
này: 233/235, hai mục đỏ có sẵn đã sửa). `npx oxlint` → **0 lỗi, 13 cảnh báo** (không đổi).
`npm run build` → OK, `index-CrJfrDJz.js` 294,7 kB (gzip 91,7 kB), CSS 118,7 kB.

### S6. Tinh chỉnh cho PC (bổ sung cùng vòng)

Chủ dự án hỏi lại đúng một câu: *"bạn có tinh chỉnh cho trên pc chưa"*. Câu trả lời lúc đó
là **chưa**: vòng S2 mới áp một hình dáng dùng chung cho mọi bề rộng. Đã đo lại cột nội dung
trên PC (từ 900px `.main` = `min(bề rộng − 252, 1060) − 52`, nên cột hẹp nhất khoảng 596px)
và thêm bốn nhịp riêng, cùng một chỗ sửa ở hàng trên:

| Chỗ | Trước | Sau (chỉ trên PC) | Vì sao |
|---|---|---|---|
| Chiều cao mục lọc | 25px (đúng chiều cao chữ + đệm) | **32px** | Trên màn 27", 25px đọc ra như một dòng phụ, không như một hàng điều khiển; 32px bằng nút Bộ lọc ở hàng trên |
| Nền khi rê chuột | `--hover` (5,5%) | `--hover-2` (8,5%) | Rê là thao tác **chỉ có** trên PC — nơi nó tồn tại thì nó phải đọc ra "chỗ này bấm được" |
| Dải tràn ở cửa sổ 900–1010px | Thanh cuộn bị ẩn (`scrollbar-width: none`) → mục cuối bị cắt mà không có cách nào lăn tới bằng chuột | **Thanh cuộn mảnh 5px**, chỉ hiện khi thật sự tràn | Cửa sổ nửa màn hình là ca rất thật, mà lăn chuột ngang thì không phải ai cũng biết |
| Ô tìm kiếm | `flex: 1 1 210px` → rộng ~1000px trên màn lớn | **chặn 360px**, con số đếm đẩy về mép phải | Phím tắt `/` neo ở mép phải ô (`.search-kbd { right: 6px }`) nên nó bị đẩy cách chỗ gõ gần một mét; một ô nhập rộng bằng cả trang đọc ra như form, không như ô tra cứu |
| Vạch của mục đầu | thụt vào 10px so với mép ô tìm kiếm và mép danh sách | **0** (`.fchips > .fchip:first-child`) | Trên màn rộng, một khoảng thụt 10px đọc ra là "lệch", không ra là "đệm" |

Một chi tiết về thứ tự trong `index.css`: khối PC đặt **trước** khối `@media (pointer: coarse)`
là có chủ ý — thiết bị lạ (máy tính bảng cắm chuột) có thể khớp cả hai vế, và khi đó **vế chạm
phải thắng** (40px cho ngón tay quan trọng hơn 32px cho chuột). Đây là loại lỗi cascade im
lặng, nên nó được chốt bằng một phép kiểm **so vị trí hai khối trong tệp**, không phải bằng
một dòng ghi chú.

## Phần T — vòng 16: bỏ vạch tiến độ cuộn · thanh tiến độ request · chỗ lọc type

Ba việc, ba loại: một thứ **bị gỡ**, một thứ **được sửa lỗi thật**, một thứ **được làm lại cho
cùng ngôn ngữ với chỗ bên cạnh**.

### T1. Bỏ vạch tiến độ cuộn ở đỉnh trang

Gỡ cả dây: `<div className="scroll-progress">`, khối CSS (kèm `@supports
(animation-timeline: scroll())` và `@keyframes progressGrow`), và cả effect rAF dự phòng trong
`App.jsx` — component không còn gì để cập nhật thì listener cũng không có lý do tồn tại.

Vì sao gỡ (không phải vì nó "xấu", mà vì nó thừa và nó lấy mất thứ khác):

- **Trùng chức năng**: thanh cuộn của trình duyệt đã nói đúng con số đó, ở đúng chỗ người
  dùng tìm nó. Vạch thứ hai không thêm thông tin nào;
- **Trùng màu**: nó là gradient `--a → --a-2`, đúng cặp màu của thứ duy nhất được phép nổi
  bật (nút hành động chính, mục đang chọn). Một vạch màu nhấn chạy ngang đỉnh màn hình suốt
  phiên làm màu nhấn mất nghĩa "chỗ này bấm được";
- **Đắt về chuyển động**: nó chạy suốt lúc cuộn — mà cuộn là thao tác lặp nhiều nhất trên
  trang. Kỹ thuật thì đúng (compositor, không layout), nhưng kỹ thuật đúng không cứu được một
  thứ không cần có.

### T2. Thanh tiến độ của request

| Sửa | Trước | Sau |
|---|---|---|
| **Số kéo vạch** | `tabular-nums` mà không chừa bề rộng: "9%" và "100%" khác nhau một con số, mà con số nằm **sau** vạch (`flex: 1`) → mỗi lần tiến độ qua hàng chục hay chạm 100%, **vạch tự ngắn lại đúng bằng một con số** | Chừa sẵn **34px** + canh phải: mép vạch đứng yên tuyệt đối |
| **Một khai báo chết** | `.prog-num { color: var(--txt-2) }` bị luật `.prog .prog-num` ngay dưới đè — hai chỗ khai cùng một thuộc tính | Một luật màu duy nhất, lấy tông của chính vạch |
| **Con số trừu tượng** | Vạch chỉ có một con số, không nói gì về việc còn lại là gì | **Hai vạch mốc ở 40% và 80%** — biên của ba việc có tên (Layout 40 · Lyrics 40 · Edit 20, xem `MILESTONES`) |

Hai vạch mốc là loại chi tiết mình thích nhất trong vòng này, vì nó **không thêm dữ liệu mới**
— nó chỉ nói ra cấu trúc đã có sẵn từ đầu: sau `progress` không phải một thang liên tục mà là
ba ô tick của admin. "47%" từ chỗ đọc ra "gần nửa đường, không rõ tới đâu" nay đọc ra "xong
Layout, đang làm Lyrics". Vị trí mốc **suy từ `MILESTONES`** (JS đặt qua `--m`) chứ không viết
cứng `40%`/`80%` trong CSS — đổi trọng số ba mốc ở `db.js` là vạch chia đi theo. Cấu trúc đó
đọc được bằng `title`, hai vạch mốc để `aria-hidden` (đọc lại chỉ thành tiếng ồn).

### T3. Chỗ lọc type — có một LỖI THẬT đứng sau cảm giác "quá AI"

Lỗi: bốn nút lọc mang `className="fchip kind"`, mà `kind` là lớp của **thẻ loại bài** trên
từng hàng request — và thẻ đó **khoá cứng** `color: var(--k-ccl)`. Nên:

- cả bốn nút (kể cả "All types") hiện **đúng một màu tím CCL**, bất kể `--c` của chúng:
  bốn thẻ loại khác nhau mà mắt thấy cùng một màu;
- riêng nút đang chọn lấy `--c` cho **nền**, nên "Full Album" đang chọn có **chữ tím trên nền
  xanh teal**.

Đây là lỗi thuộc loại khó nhìn ra bằng mắt vì nó *trông có vẻ* đã đúng (mỗi nút có một màu,
chỉ là cùng một màu). Dấu hiệu để nhận ra sớm: **một lớp CSS mang tên DỮ LIỆU (`kind`) được
dùng cho cả thứ hiển thị dữ liệu lẫn control để lọc dữ liệu đó.** Nay mục lọc có lớp riêng
`.fkind`.

Sửa xong thì làm luôn phần "quá AI" cho cùng ngôn ngữ với dải chế độ xem ở hàng trên (chữ +
dấu màu, không viền/không nền/không bo tròn), nhưng **dấu đổi hình cho đúng loại dữ liệu**:

| | Dải chế độ xem | Hàng lọc loại bài |
|---|---|---|
| Dấu | **Vạch đứng 3×15px** — trạng thái là một *chặng* của dây chuyền | **Ô vuông 9×9px bo 2px** — loại bài là một *nhãn dán* trên hàng (`.kind` cũng bo góc) |
| Màu chữ khi chọn | **Trắng** — một màu trạng thái được nhiều mục chia nhau | **Màu của chính loại đó** — nối thẳng với thẻ loại trên hàng request |
| "Không lọc gì" | — | **Ô RỖNG viền mảnh** (`.kswatch.any`): "chưa chọn màu nào" |

Khác hình dấu còn để hai dải không lẫn vào nhau: chúng nằm hai hàng gần nhau, mà hai bảng màu
có vài sắc na ná (`--queued #8f94ff` với `--k-ccl #ab8fe0`, `--done #4cba88` với
`--k-album #4fb0ad`).

### T4. Kiểm chứng

- `src/lib/cssFilterBar.test.js` thêm hai phép kiểm: (1) mục lọc loại bài **không** mang lớp
  `.kind`, có lớp `.fkind` + dấu riêng, "All types" là ô rỗng, mục đang chọn lấy màu của chính
  nó và **không** tô nền; (2) số của thanh tiến độ có `min-width` + canh phải, **đúng một**
  luật màu, vạch mốc do JS đặt qua `--m` và suy từ `MILESTONES`, có `title`.
- `npm run smoke` thêm 9 mục, trong đó có mục đáng giá nhất: kiểm thanh tiến độ **trong danh
  sách** sau khi bấm sang tab *In progress* (mặc định là tab Queue — nơi chưa có bài nào đang
  làm, nên phép kiểm cũ chỉ chạm được thanh trong khối Up next). DOM thật lấy ra:
  `<b class="prog-mile" style="--m: 40%">` · `--m: 80%` · `title="Layout 40% · Lyrics 40% · Edit 20%"`.
- `npm test` → **375 ca / 374 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **249/249**. `npx oxlint`
  → **0 lỗi, 13 cảnh báo** (không đổi). `npm run build` → OK: `index-7SWXOV2s.js` 294,5 kB
  (gzip 91,6 kB — **nhỏ hơn** bản trước vì vạch cuộn đã bị gỡ), CSS 119,0 kB.

## Phần U — vòng 17: "thanh progress đang bị bự và xấu quá"

Chủ dự án gửi **ảnh chụp một hàng request** kèm đúng bốn chữ đó. Ảnh là dữ liệu quý: nó
biến một câu cảm nhận thành bốn con số cụ thể, và cả bốn đều **đúng như những gì đã được
viết ra trong tài liệu ở vòng trước** — nghĩa là lỗi không nằm ở chỗ làm sai, mà ở chỗ mỗi
thứ được nới một nhịp mà không ai nhìn tổng thể cái khối.

### U1. Bốn thứ cùng lúc làm nó bự

| | Trước | Sau | Vì sao |
|---|---|---|---|
| Rãnh | 6px | **4px** | Sáu pixel là độ dày của một dải băng. Cạnh một con số in đậm, trong một khối rộng 340px, nó đúng là dải băng chứ không phải thanh |
| Khối vạch + số | 340px | **220px** | Cột danh sách trên màn hai cột chỉ ~740px → 340px là gần **NỬA** bề ngang hàng: thành thứ to nhất sau tiêu đề. 220px ≈ 30% — đúng cỡ một chi tiết phụ dưới dòng meta |
| Con số | 11,5px nét **600**, màu vạch pha 78% trắng | **10,5px nét 500**, pha 72% màu vạch + 28% `--txt-2` | Một chữ số in đậm màu bão hoà **to hơn cả tên người gửi** là chỗ to tiếng nhất trong hàng |
| Hai vạch mốc | `rgba(0,0,0,.42)`, rãnh 6px | `rgba(0,0,0,.34)`, rãnh 4px | Ở 6px chúng đọc ra như vạch chia của một thanh **ba khúc**; ở 4px chúng là đường nối trong lòng vạch |

Một chi tiết đáng nói: **lý do của bản 6px vẫn nằm trong tài liệu** — *"đủ dày để đọc được
mà không thành một dải băng"*. Câu đó không sai khi viết ra; nó sai khi đứng cạnh ba thứ
kia (con số đậm, khối 340px, hai vạch chia). Đây là lần thứ hai cùng một khối bị chỉ vì một
con số được chọn riêng lẻ, nên luật cho lần sau đã được ghi thẳng vào `DESIGN.md` §2.5:

> **Khi thanh tiến độ nằm trong một HÀNG danh sách, mọi con số của nó phải nhỏ hơn con số
> nhỏ nhất của hàng đó.** Vạch có thể mang màu trạng thái, nhưng kích cỡ và độ đậm thì phải
> xếp **dưới** chữ — nó là chi tiết phụ, không phải số liệu.

### U2. Số cụ thể (đo, không đoán)

Màu của con số được tính lại bằng tay theo đúng công thức `color-mix(in oklab, …)` rồi đo
tương phản trên nền `--panel`:

| Trạng thái | Số cũ | Số mới |
|---|---|---|
| Đang làm (`--progress #e0a93e`) | `#e7bc71` · **10,45:1** | `#cda96a` · **8,33:1** |
| Xong 100% (`--done #4cba88`) | `#7acaa1` · 9,46:1 | `#69b494` · **7,55:1** |

Vẫn trên ngưỡng WCAG AA (4,5:1 cho chữ nhỏ) khá xa, nhưng độ chói giảm một bậc — và quan
trọng hơn: độ **đậm** (600 → 500) và cỡ (11,5 → 10,5px) mới là hai thứ làm nó thôi hét.

Vạch vẫn không mất thông tin nào sau bốn lần siết: đúng hai mốc, số ở cuối, `min-width` chừa
sẵn nên mép vạch vẫn đứng yên tuyệt đối khi số từ 9% lên 100% (30px đủ chứa "100%" ở mono
10,5px ≈ 25px).

### U3. Kiểm chứng

`src/components/Progress.test.js` (phép kiểm "không còn thanh tiến độ nào dựng bằng tay")
nay chốt **cả bốn vế của lần siết này** — vì đây là loại thay đổi dễ bị nới ngược khi có
người "sửa cho dễ nhìn": rãnh 4px, khối ≤ 220px, số 10,5px nét 500, và số phải pha với
`--txt-2`. Kèm một dòng ghi lại vì sao con số cũ (6px) từng được chọn.

`npm test` → **375 ca / 374 đạt / 0 lỗi / 1 skip**. `npm run smoke` → **249/249**. `npx oxlint`
→ **0 lỗi, 13 cảnh báo**. `npm run build` → OK: `index-B5awy9PP.js` 294,6 kB (gzip 91,7 kB),
CSS 119,0 kB.

---

## Phần V — vòng 18: một cú bấm, bốn chỗ hỏng (21/09/2026)

Chủ dự án gửi bảng tổng hợp của phiên trước, trong đó bốn lỗi quanh **trang cá nhân công khai**
còn treo: bấm tên người gửi thì "quay về trang chủ", *Back to board* không ăn, bấm một bài trong
*Recent requests* không ra bài, và gõ `POP OFF LE SSERAFIM` thì bảng nói **không có kết quả**.
Truy tới nơi thì bốn triệu chứng đó là bốn mặt của cùng một cách làm: *mỗi link nội bộ tự ghép
địa chỉ bằng tay rồi tự gọi `pushState`*.

### V1. Bốn nguyên nhân gốc

| # | Nguyên nhân | Người dùng thấy gì | Vì sao khó bắt |
|---|---|---|---|
| 1 | Ba chỗ gọi thẳng `window.history.pushState(...)` trong `onClick`. `pushState` **ném** `SecurityError` trong iframe bị sandbox, trên `file://`, trong chế độ riêng tư của vài trình duyệt — mà `preventDefault()` đã chạy **trước** đó | Bấm tên người gửi / tác giả bình luận / một bài trong trang cá nhân: **không gì xảy ra cả** | Repo đã có `lib/history.js` sinh ra cho đúng lỗi này (vòng 11 sửa ca "bảng quản trị hỏng toàn bộ" cũng vì nó) — ba link mới chỉ là không đi qua cửa đó. Trên bản deploy thật (không sandbox) chúng lại chạy, nên không lộ trong lúc làm |
| 2 | "Trang cá nhân đang mở" được đọc từ `window.location` **lúc render**, không phải state | Cùng cú bấm đó: có khi địa chỉ đổi mà màn hình đứng yên | React bỏ qua lượt render nếu mọi `setState` trong handler trùng giá trị; còn khi (1) xảy ra thì địa chỉ không đổi, tức là không có gì để đọc |
| 3 | Từ khoá dựng `tên bài + nghệ sĩ`; chuỗi để dò của hàng là `nghệ sĩ + tên bài + loại + người gửi`; so bằng **MỘT** phép `includes` cả cụm | `Pop Off LE SSERAFIM` → trang trống cho **chính bài đó** | Thứ tự "nghệ sĩ trước" là thứ tự của CSDL, còn **mọi** đường link vào bảng (thẻ *This week*, *Recent requests*, nút chia sẻ) đều dựng theo thứ tự ngược lại |
| 4 | `fetchPublicProfile` (đường Supabase) chỉ `select('status, votes')` | Trên bản deploy: *Recent requests* không có tên bài → link `?q=` **rỗng**, `key` của 8 hàng trùng nhau | Chế độ demo dùng hàng mẫu có đủ mọi cột nên không lộ — hỏng đúng ở chỗ không ai bấm thử |

### V2. Đã sửa

| File | Việc |
|---|---|
| **`src/lib/nav.js`** (mới) | Context ba hàm `openProfile` / `openSong` / `closeProfile`, và `spaLink(fn, arg)`: thẻ **giữ `href` thật** (middle-click, "mở trong tab mới", trình đọc màn hình — và là đường lùi khi component được dựng ngoài App), còn bấm thường thì đổi **state**. Không có đường SPA thì `spaLink` trả về `undefined` để React **không gắn handler**, cú bấm đi theo href. Khác `useNotify` (ném khi thiếu provider) là có lý do: nav là thứ tuỳ chọn |
| **`src/lib/history.js`** | Thêm cửa DỰNG địa chỉ cạnh cửa GHI địa chỉ: `profileUrl()`, `songQuery()`, `boardSearchUrl()` (luôn kèm `f=newest`), `absolute()`. Trước đó năm chỗ tự ghép chuỗi và ghép **năm kiểu** khác nhau |
| **`src/App.jsx`** | `profileId` là **state** (khởi tạo + đọc lại lúc Back/Forward bằng `readProfileId()` — đúng hai lần chạm vào địa chỉ); `openProfile`/`closeProfile`/`openSong` đổi state TRƯỚC rồi mới `pushUrl`. Bộ hẹn giờ ghi URL **hỏi lại lúc sắp ghi** (trong 320ms chờ đó người dùng kịp mở trang cá nhân — ghi đè là xoá mất địa chỉ vừa mở). `shareSong` và hai thẻ *This week* đi qua `boardSearchUrl` |
| **`src/lib/board.js`** | `searchTerms()` / `allTermsIn()` / `searchHit()`: bỏ dấu, so **THEO TỪ**, bỏ từ chỉ có dấu câu. Và `filterBoard()` / `chainRows()`: khối lọc bảng dời ra khỏi App.jsx để kiểm thử được bằng dữ liệu giả |
| **`src/lib/db.js`** | `fetchPublicProfile` chọn đủ cột (`id, title, artist, kind, status, votes, created_at, picked_at, video_url`), sắp **mới nhất trước**, lọc cả `pending` lẫn `denied` (RLS cho đọc cả bảng `requests`, nên lọc là việc của chỗ này), và một `publicProfileShape()` để hai đường demo/Supabase không thể trả về hai hình dạng |
| **`src/components/PublicProfile.jsx`** | Trạng thái **đang tải** riêng (trước đây in *"Profile not found."* trong ~200ms đầu — nói dối về một thứ chỉ là chưa tới); link đi qua `spaLink`; *Back to board* là thẻ `<a href="/">` chứ không phải nút; nhãn trạng thái qua `statusLabel`; hàng thiếu tên thì **không dựng link**; URL chia sẻ dựng từ `userId` (không lấy `location.href` — khi `pushState` bị chặn thì đó là địa chỉ của bảng) |
| **`src/components/Comments.jsx`** | Tên tác giả đi qua `profileUrl` + `spaLink` |
| **`src/components/AdminPanel.jsx`** | Ô tìm của admin dùng `allTermsIn` — cùng một phép bỏ dấu và cùng một cách so theo từ với bảng công khai |

### V3. Nhãn "Votes given" là một lời nói dối

Con số đó là `sum(requests.votes)` — **tổng phiếu mà các bài của người đó nhận được**. Phiếu họ
đi bỏ cho người khác không đọc được ở đây: RLS của `votes` là *read own votes*, người lạ hỏi là
nhận về rỗng. Nhãn đã đổi thành **Votes received**, và huy hiệu thành *"10 votes earned"*. Một
con số đúng với một cái nhãn sai thì vẫn là nói dối — và đây là loại lỗi không có phép kiểm nào
bắt được ngoài việc đọc lại chính câu chữ của mình.

### V4. Hai bộ lọc lệch nhau — lỗi cùng họ, tìm ra trong lúc truy

Bảng có **hai** state cho cùng một việc: `statusFilters`/`kindFilters` (chọn NHIỀU) là thứ thật
sự lọc, còn `filter`/`kindFilter` (chọn MỘT) là bản sao dùng cho địa chỉ `?f=`/`?k=` và cho bộ
lọc đã lưu. Ba chỗ để hai bản lệch nhau:

| Chỗ | Trước | Sau |
|---|---|---|
| Bỏ chọn chip giai đoạn **cuối cùng** | `statusFilters` rỗng nhưng `filter` vẫn là giai đoạn vừa bỏ → danh sách lọc **y như cũ** trong khi chip đã tắt | Về `newest` (cả bảng) — chip tắt thì lọc cũng phải tắt |
| Bỏ chọn loại bài cuối cùng | `kindFilters` rỗng, `kindFilter` vẫn giữ tên loại → chip "đang lọc theo loại" còn hiện, dòng *"đang xem n/mục"* còn đó | `kindFilter` = `next.length === 1 ? next[0] : 'all'` |
| Chip "bỏ lọc loại bài" trên hàng chính | Chỉ `setKindFilter('all')` — chip biến mất mà danh sách **vẫn thiếu bài** | Dọn cả `kindFilters` |

Cùng họ với chúng là ba đường "nhảy tới một bài" (`jumpToSong` từ hộp thông báo, `showAllPicked`
từ nút *View all*, và `openSong` mới): cả ba đều phải **dọn cả hai bộ lọc nhiều-chọn**, vì
`statusFilters` THẮNG `filter` trong `filterBoard` — không dọn thì tin thông báo bảo "bấm vào
đây để xem bài của bạn" mà bảng hiện trang trống.

### V5. Vì sao link tới MỘT BÀI phải là `f=newest`, không phải `f=top`

`top` là danh sách bài **đang xin phiếu**: nó cố ý loại bài đã xong và bài đã vào dây chuyền
(nút vote của chúng đã khóa). Vậy nên:

- thẻ *Most voted* tuần trỏ vào `?f=top&q=…` — mà bài nổi nhất tuần thường **đang được làm**,
  tức là link mở ra trang trống;
- nút **chia sẻ** một bài vừa được chốt cũng gửi đi link chết — người nhận không phân biệt được
  "bài bị xoá" với "link hỏng";
- *Recent requests* của trang cá nhân: bài đã completed (đúng ca chủ dự án báo) biến mất.

`newest` thấy **mọi** bài trên bảng, nên nó là cách nhìn duy nhất đúng cho một link dẫn tới một
bài cụ thể. `top` vẫn giữ nguyên nghĩa của nó ở chỗ người dùng tự chọn: "đang xin phiếu".

### V6. Hai bài kiểm cũ phải đổi theo — và vì sao đó là đổi đúng

| Bài kiểm | Trước | Nay |
|---|---|---|
| `boardSync.test.js` | đòi App.jsx chứa `pub.filter(inChain)` và `if (filter === 'in_progress') base = picked` | đòi **`lib/board.js`** định nghĩa `chainRows` lọc bằng `inChain`, và App.jsx phải **gọi** `chainRows(pub)` + `filterBoard({...})` — khối lọc nằm trong App.jsx thì không kiểm thử được bằng dữ liệu giả |
| `board.test.js` | đòi App.jsx/AdminPanel.jsx chứa `fold(` | đòi App.jsx dùng `filterBoard(`, AdminPanel dùng `allTermsIn(`, **không** file nào còn `.includes(fold(`, và `normalize('NFD')` chỉ xuất hiện đúng **một** lần trong toàn repo |
| `cssFilterBar.test.js` | đòi chip bỏ lọc loại bài có `onClick={() => setKindFilter('all')}` | đòi `setKindFilters([]); setKindFilter('all')` — tức là dọn bộ lọc **thật**, không chỉ bản sao |

### V7. Bấm một bài thì trang phải cuộn XUỐNG kết quả

Chủ dự án báo ngay sau lượt sửa trên: *"bấm vào request của người khác, nó chuyển hướng đến chỗ
search thì phải cuộn xuống chứ sao lại cuộn lên đầu"*. Đúng, và lý do nó sai thì rõ ràng khi nhìn
lại bố cục của trang bảng:

```
[bốn ô thống kê] [video của kênh] [This week] [Hall of Fame] [Up next] [thanh lọc] [DANH SÁCH]
```

`openSong` kế thừa `toTop()` từ `openProfile` — hợp lý khi mở **trang cá nhân** (đó là một trang
khác, đọc từ đầu), nhưng vô nghĩa khi đi tới **một bài trên bảng**: kết quả nằm dưới năm khối nội
dung, tức là cách đầu trang cả một màn hình. Người bấm thấy trang nhảy lên đầu, không thấy bài
đâu, và không biết cú bấm có ăn không — đúng loại lỗi mà tài liệu này gọi là *"tính năng có mà
không tới được"*.

Nay `openSong` gọi `scrollToList()`: cuộn tới **thanh lọc**, không tới `.list`. Chọn thanh lọc vì ở
đó thấy được ba thứ cùng lúc — từ khoá vừa đặt trong ô tìm, dòng *"đang xem n/mục"*, và danh sách
ngay bên dưới; cuộn thẳng vào `.list` thì từ khoá bị đẩy lên trên mép màn hình và người đọc không
biết mình đang lọc bằng gì.

Hai chi tiết kỹ thuật đáng ghi lại:

| Chi tiết | Vì sao |
|---|---|
| Chờ **một nhịp** (`requestAnimationFrame` + 60ms) rồi mới cuộn | Danh sách được dựng lại từ bộ lọc vừa đổi, và `.list` mang `key={filter}` — đổi cách nhìn là node đó bị thay bằng node khác. Cuộn ngay là cuộn vào cái danh sách CŨ (cùng lý do `showAllPicked` và `jumpToSong` đã làm vậy từ trước) |
| Hỏi `document.querySelector('.board .fbar')` thay vì giữ `ref` | `scrollToList` được truyền **xuống cây** bằng context và được gọi ngay trong lúc render để dựng handler cho thẻ link; đọc `ref.current` trong một hàm như vậy là đúng thứ React Compiler bắt (`react(refs)` — hai cảnh báo hiện lên ngay khi làm bằng ref). Gói trong `.board` vì mục *Của tôi* cũng có một `.list` riêng |

`profileNav.test.js` giữ luật này cho cả ba hàm: `openSong` phải cuộn xuống và **không** được gọi
`toTop()`; `openProfile`/`closeProfile` thì ngược lại. Còn `npm run smoke` ghi lại lệnh cuộn thật
(jsdom không cuộn, nên thay `scrollIntoView`/`window.scrollTo` bằng hàm ghi nhận) rồi khẳng định
bấm *Recent request* và bấm thẻ *This week* đều cuộn tới `.fbar`, không có lệnh `scrollTo({top:0})`
nào — tức là kiểm bằng **hành vi**, không chỉ bằng chữ trong mã nguồn.

### V8. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **401 ca / 400 đạt / 0 lỗi / 1 skip** (vòng 17: 375 ca). Mới: `src/lib/profileNav.test.js` **15 ca** (dựng địa chỉ, `spaLink` chạy thật với sự kiện giả, và bảy hợp đồng trên mã nguồn: không ai tự `pushState`, không ai tự ghép chuỗi địa chỉ, mọi link nội bộ là thẻ thật + `spaLink`, trang cá nhân là state, `openSong` dọn cả hai bộ lọc, `setBooting(true)` không tồn tại, câu truy vấn trang cá nhân chọn đủ cột) và **+11 ca** trong `board.test.js` cho `searchHit`/`filterBoard`/`chainRows` |
| `npm run smoke` | ✅ **289/289 mục đạt** (vòng 17: 249). Mục **10d** mới đi bằng đường bấm thật: bấm tên người gửi → trang cá nhân mở, **không màn chờ**; soi href của từng *Recent request*; bấm bài **đã completed** (Get Up / NewJeans) → bảng hiện đúng bài, ô tìm mang `Get Up NewJeans`, không chip giai đoạn nào còn bật; **bật chip lọc trước rồi mới bấm** (đúng ca đã báo); thẻ *This week*; gửi một bình luận rồi bấm tên tác giả; *Back to board*; và lặp lại tất cả trong **iframe bị sandbox** (`pushState`/`replaceState` ném `SecurityError`) |
| `npx oxlint` | ✅ **0 lỗi, 19 cảnh báo** — nền trước vòng là 21: bớt được hai (`useMemo` thừa dep `kindFilter`, và một `set-state-in-effect` tránh được nhờ gộp "đang tải" vào cùng một state với "tải cho ai") |
| `npm run build` | ✅ sạch — `index-x3-XImIn.js` 304,29 kB (gzip 94,43 kB), CSS 131,53 kB |

**Một chi tiết đáng nhớ về cách viết chú thích trong repo này:** `jsxHtml.test.js` quét THÔ mã
nguồn `.jsx`, nên chữ `<a>` viết trong một **chú thích** cũng được đếm là một thẻ mở — và vì nó
không có thẻ đóng, mọi thẻ tương tác phía sau trong file đó bị báo là "lồng control vào control".
Hai mươi ba "lỗi" hiện ra từ một dấu `<a>` trong chú thích. Quy tắc: trong file `.jsx`, đừng viết
tên thẻ kèm dấu nhọn trong chú thích (`profileNav.test.js` nay lột chú thích trước khi quét, và
giữ nguyên số dòng để thông báo còn trỏ đúng chỗ).

## Phần W — vòng 19: Season Leaderboard — tuần này / tháng này, không migration (21/09/2026)

### W1. Câu hỏi mà bảng xếp hạng chưa trả lời được

Bảng xếp hạng chỉ có MỘT góc nhìn: toàn bộ thời gian. Người mới gửi bài tháng này không có cửa
nào so với người đã tích luỹ hai năm, và người xem không trả lời được câu đơn giản nhất:
**"tuần này ai được lên sóng nhiều nhất?"**. Một bảng "mùa giải" (tuần/tháng) trả lời đúng câu
đó — và làm cho hạng của người mới có ý nghĩa ngay trong tuần đầu tiên.

Rào cản cũ là dữ liệu: bảng `requests` **không có cột `completed_at`** (schema chỉ có
`created_at`, `updated_at`, `picked_at`), và view `requester_ranking` là số tổng cộng dồn — muốn
có "số bài xong trong tháng" bằng SQL thì phải thêm cột + backfill + sửa view, tức là một lần
migration cho một tính năng đọc. Quyết định vòng này: **tính client-side, không migration** —
toàn bộ hàng request vốn đã được tải về máy (`fetchRequests`, tối đa 800 hàng mới nhất), gom lại
theo cửa sổ thời gian là việc thuần tuý của trình duyệt.

### W2. Luật nằm ở `src/lib/season.js` — một chỗ, test bằng số

Cùng triết lý với `ranking.js` và `board.js`: luật là hàm thuần (không React, không mạng, nhận
`now` làm tham số) để test khoá được bằng một ngày cố định. Bốn hàm:

| Hàm | Việc |
|---|---|
| `vnDayKey(now)` | "hôm nay" theo lịch **Việt Nam** (`Asia/Ho_Chi_Minh`) — 17:30 UTC Chủ nhật đã là thứ Hai ở VN |
| `seasonWindow(period, now)` | cửa sổ `[start, end)` của tuần/tháng: tuần **thứ Hai → Chủ nhật** (lịch VN), tháng **mùng 1 → mùng 1 tháng sau**, cả hai neo theo nửa đêm giờ VN |
| `seasonRows(rows, ranking, period, now)` | gom lại từ các hàng request thành đúng **hình dạng `requester_ranking`**: `{ user_id, key, name, avatar_url, total, completed, total_votes }` — để `rankRows` xếp mà không cần biết nó đang xếp bảng tổng hay bảng mùa |
| `seasonLabel(period, now)` | khoảng ngày cho UI: `22/09 – 28/09` |

**Mốc "bài xong lúc nào"** (`doneAt`): `completed_at || updated_at || created_at` — cùng luật
fallback mà khối *Hall of fame* đang dùng. `completed_at` chưa tồn tại trong schema, nhưng nếu
một ngày nào đó cột được thêm, code này tự dùng nó trước mà không phải sửa. Chỗ xấp xỉ phải nói
thật: bài đã xong mà admin còn chạm vào sau này (sửa link, đổi ghi chú) sẽ bị tính theo lần chạm
đó — chấp nhận được vì bài vừa được sửa thường cũng là bài vừa được xong.

**Hai quyết định chống gian lận, kế thừa đúng tinh thần C3-14** (ghi chú từng hoãn một bảng
"top người gửi tháng" vì nó khuyến khích đua số lượng):

- Xếp theo **số bài XONG trong mùa** làm mặc định — trả lời "cộng đồng nhận được gì tuần này",
  không phải "ai bấm gửi nhiều nhất". Ba cách xếp vẫn đổi được như bảng tổng, nhưng con số nào
  cũng bị cắt theo cửa sổ.
- Bài **bị từ chối không tính gì**, cùng luật `where r.status <> 'denied'` của view.
- Bài GỬI ngoài mùa nhưng XONG trong mùa **vẫn được đếm là xong trong mùa** (bài lên sóng thứ
  Ba dù gửi từ tháng trước vẫn là thành quả của tuần này) — nhưng không bị đếm là "gửi trong
  tuần". Người có gửi mà chưa xong bài nào **vẫn có mặt** với `completed = 0`: bảng nói thật
  thay vì làm họ biến mất.

**Phiếu là chỗ dữ liệu không cho phép nói quá:** bảng `votes` không có mốc thời gian theo bài
trong dữ liệu tải về, nên KHÔNG thể đếm "phiếu nhận trong mùa". Con số phiếu trên bảng mùa là
**phiếu cộng dồn của các bài GỬI trong mùa** — và UI phải tự thú nhận điều đó bằng một dòng chú
thích ngay dưới hàng nút mùa (`rank.votesNote`), đặt ở cấp BẢNG chứ không nhét vào hàng "bạn"
(vì đó là sự thật về cả một cột, không phải của riêng ai, và không được phép biến mất khi người
xem chưa có tên trên bảng).

### W3. Hai lỗi thật đã bị test bắt ngay trong lúc viết

Không phải lỗi giả định — cả hai đều là ca fail thật trước khi xanh:

| Lỗi | Vì sao sai | Sửa |
|---|---|---|
| `new Date(start).getUTCDay()` để tìm thứ trong tuần | `start` là mốc **UTC** của nửa đêm VN: 00:00 thứ Hai giờ VN vẫn là 17:00 **Chủ nhật** UTC — đọc thứ trên mốc đó làm cả cửa sổ tuần lùi sai hẳn một tuần (22–28/09 thành 16–22/09) | Hỏi thứ trên chính **chuỗi ngày lịch VN** (`Date.parse('YYYY-MM-DD…Z').getUTCDay()`), không hỏi trên mốc UTC vừa dựng |
| `end = start + 1 ngày` khi hôm nay là thứ Hai | Quên nhân 7: cửa sổ tuần chỉ dài… một ngày | `end = weekStart + 7 × 86400000` — và `season.test.js` khoá bằng đúng một ngày-thứ-Hai (2025-09-22) |

Cả hai đều là loại lỗi **im lặng**: bảng vẫn render, vẫn có số, chỉ là số của sai tuần. Không có
test bằng ngày cố định thì không cách nào nhìn thấy bằng mắt.

### W4. UI: một hàng nút, một khoảng ngày, một câu luật

`Leaderboard.jsx` thêm đúng một hàng (`lb-periodrow`) dưới thanh tiêu đề: ba nút **All time ·
This week · This month** (dùng lại đúng kiểu viên thuốc `lb-seg`/`lb-segb` có sẵn — mobile tự
được hưởng luật tràn ngang của `.lb-seg`), kèm khoảng ngày `22/09 – 28/09` in chữ mono như một
con tem. Ba chi tiết có chủ ý:

- **Câu luật đổi theo mùa**: đang xem mùa nào thì `lb-rule` nói đúng mùa đó
  (`rank.periodRule.*`: "Sorted by requests completed this period (Mon–Sun week / calendar month,
  Vietnam time)") — không để người xem tự đoán ba con số là của cả thời gian hay của tuần.
- **Khoảng ngày PHẢI in ra**: "tuần này" là từ mơ hồ nếu không nói tuần nào tới tuần nào, và
  người xem ở múi giờ khác phải tự đổi được.
- **Mùa chưa có gì là một câu trả lời thật**, không phải "bảng hỏng": `rank.emptyPeriod.week`
  nói "No requests yet this week — the season resets every Monday (Vietnam time)", và khối rỗng
  vẫn giữ hàng nút mùa để luôn có đường về *All time*.

`period` là state của component (không đẩy lên App, không đưa vào URL): đổi mùa là đổi góc nhìn
tại chỗ, cùng loại với đổi cách sắp xếp — và `usePager` nhận thêm `period` vào deps để đổi mùa
là quay lại trang 1. Mốc "bây giờ" chốt **một lần lúc mở bảng** (`useMemo`, deps `[now]`): cửa
sổ mùa không được tự trượt giữa chừng lúc người xem đang nhìn; nửa đêm đi qua thì mùa mới là
việc của lần mở trang sau. `App.jsx` chỉ truyền thêm `allRows={rows}` (toàn bộ hàng request) và
`ranking={fullRanking}` (để mùa lấy đúng tên + avatar đã chốt ở view thật).

### W5. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **414 ca / 413 đạt / 0 lỗi / 1 skip** (vòng 18+1: 401 ca). Mới: `src/lib/season.test.js` **10 ca** (ranh giới nửa đêm VN, tuần thứ Hai–Chủ nhật kể cả nhìn từ Chủ nhật, tháng 12 gối năm, gom số theo cửa sổ, denied/ngoài cửa sổ bị loại, gửi-ngoài-xong-trong vẫn đếm, hình dạng khớp `requester_ranking` + `rankRows` xếp được, dữ liệu méo không ném lỗi, nhãn khoảng ngày, và một ca soi mã nguồn: component không được tự dựng mốc thời gian) và **+3 ca** trong `Leaderboard.test.js` (bảng tuần cắt số + khoảng ngày + câu luật + lời thú nhận phiếu; bảng tháng gối đúng cửa sổ và *All time* giữ nguyên luật cũ; mùa trống ra câu trả lời thật và vẫn còn núm đổi mùa) |
| `npm run smoke` | ✅ **296/296 mục đạt** (vòng 18+1: 289). Mục *Xếp hạng* thêm 7 check bấm thật: bộ chọn mùa 3 nút, mặc định All time không in khoảng ngày, bấm *This month* thì câu luật đổi + khoảng ngày hiện đúng dạng `dd/MM – dd/MM` + chú thích phiếu xuất hiện + **không điều hướng** (vẫn `/ranking`), bấm *All time* thì về đúng câu luật cũ |
| `npx oxlint` | ✅ **0 lỗi, 20 cảnh báo** — nền trước vòng là 19; +1 là `react(purity)` cho `Date.now()` trong `useMemo` của mốc "bây giờ", **đúng pattern mà baseline đã chấp nhận** ở `weeklyHighlights` (App.jsx). Đổi lại, mốc đó không còn nằm trần trong thân component như bản nháp đầu tiên |
| `npm run build` | ✅ sạch — `index-4gnrXPD4.js` 308,21 kB (gzip 95,68 kB) |

Chi tiết đáng nhớ khi viết test render cho bục: `html.split('<div class="lb-pod')` ăn nhầm cả
`lb-pod-num`/`lb-pod-name` (không có khoảng trắng sau `lb-pod`), và chunk ĐẦU TIÊN của một lần
split chứa toàn bộ phần trước bục — bao gồm khối `lb-me` có tên alice — nên `.find(b =>
b.includes('alice'))` bắt nhầm chunk đó. Sửa: split theo `'<div class="lb-pod p'` (có khoảng
trắng + chữ `p` của `p1/p2/p3`) và tìm theo `title="alice"` chứ không theo tên trần.

### W6. Vòng 19+1: người dùng chê bố cục — "chuyển qua lại các mục chưa tốt, nhìn rối"

Phản hồi nguyên văn: *"phần chuyển qua lại các mục trong leaderboard làm chưa đc tốt và nhìn bố
cục rối"*. Soi lại bản W4 thì thấy hai bệnh thật, đều là quyết định vội của vòng trước:

**Bệnh 1 — ba hàng viền đáy chồng nhau.** `lb-bar` (tiêu đề + nút xếp), rồi `lb-periodrow`
(hàng nút mùa + khoảng ngày), rồi `lb-votes-note` (hàng chú thích phiếu) — người xem phải đi
qua BA đường kẻ ngang trước khi thấy một con số nào. Hai hàng sau mỗi hàng chỉ chở một mẩu
thông tin nhỏ (ba nút, một con tem ngày, một câu chú thích) nhưng mỗi hàng chiếm trọn chiều
rộng bảng kèm viền đáy riêng: chi phí bố cục gấp ba lần nội dung.

**Bệnh 2 — hai nhóm nút giống hệt nhau.** Nút mùa và nút sắp xếp đều là viên thuốc `lb-segb`
sáng màu khi bật, đặt gần nhau thành một ma trận 3×2 nút cùng nước sơn. Không có gì trên màn
hình nói được nhóm nào đổi DỮ LIỆU (mùa) và nhóm nào đổi CÁCH NHÌN (sắp xếp) — đúng thứ mà
cả repo này luôn đòi: *chức năng khác nhau thì nước sơn phải khác nhau*.

**Bệnh 3 (tự bắt thêm) — đổi mùa không có phản hồi chuyển động.** Bục và bảng chỉ đổi số tại
chỗ; `podIn`/`rowIn` là animation mount-once nên không phát lại. Cú bấm đổi cả phạm vi dữ liệu
mà màn hình chỉ "nhảy số" — cảm giác như bảng bị lỗi.

Sửa cả ba, không thêm hàng nào:

| Trước | Sau |
|---|---|
| 3 hàng có viền đáy trước bục | **1 thanh duy nhất**: chữ trái (kicker · tiêu đề · câu luật · chú thích phiếu), điều khiển phải (`lb-bar-ctl`) hai tầng |
| Nút mùa = viên thuốc giống nút xếp | Nút mùa = **tab gạch chân** (`lb-tab`, gạch chạy dưới chữ, trượt ngang khi chuyển); nút xếp giữ viên thuốc. Class `lb-segb` vẫn được GIỮ trên tab để luật mobile có sẵn (tràn ngang, min-height 40px) tự áp vào |
| Khoảng ngày chiếm chỗ riêng trong `lb-periodrow` | Con tem `lb-range` nằm **ngay trong câu luật** — luật và phạm vi của luật đọc trong một hơi |
| Đổi mùa: số nhảy tại chỗ | `key={'top-'+period}` / `key={'tbl-'+period}` trên bục và vỏ bảng: đổi mùa là **remount**, hai nhịp đổ xuống phát lại. Đổi cách sắp xếp thì KHÔNG remount (useCountUp tự đếm số cũ → mới) — hai cú chuyển, hai phản hồi khác nhau, có lý do |
| Bảng trống: nhánh return riêng, cấu trúc header khác | **Một return duy nhất**, `isEmpty` chỉ giấu phần thân; tab mùa luôn còn (đường về *All time*), nhóm nút xếp bị giấu khi không có gì để xếp |

Hai lỗi bị chính hàng rào test của repo bắt trong lúc sửa, đáng ghi lại:

- `cssTokens.test.js` bắt `var(--txt-1)` — token **không tồn tại** (thang chữ của app là
  `--txt`, `--txt-2`, `--txt-3`). CSS không có token đó không báo lỗi cũng không sập: nó âm thầm
  rơi về giá trị kế thừa, tức là màu chữ của tab đang chọn sẽ do may rủi quyết định. Đúng loại
  lỗi mà test token sinh ra để bắt.
- `npm run smoke` bắt React warning *"two children with the same key"*: cả `lb-top` lẫn
  `lb-twrap` cùng mang `key={period}` mà hai khối là **anh em ruột** trong cùng một children
  array. Test render tĩnh không bắt được (warning chỉ nổi khi React reconcile thật trong
  jsdom) — smoke mới là lưới đúng tầng. Sửa thành hai key khác tiền tố (`top-`/`tbl-`).

Kiểm thử: `Leaderboard.test.js` **+2 ca** khoá bố cục mới (một thanh điều khiển duy nhất, tab
mùa mang `lb-tab` còn nút xếp thì không, tem khoảng ngày nằm trong câu luật, bảng trống giấu
viên thuốc nhưng giữ tab mùa) — 416 ca / 415 đạt / 0 lỗi / 1 skip; smoke 296/296; oxlint 0 lỗi
20 cảnh báo; build sạch. Toàn bộ selector mà smoke đang dùng (`.lb-periodseg`, `.lb-range`,
`.lb-votes-note`) sống sót qua cuộc dọn — đổi nước sơn, không đổi hợp đồng.

### W7. Vòng 19+2: "chú thích còn quá dài làm bố cục nút bị lệch xuống; all time/this week/this month chưa đẹp, khó nhìn"

Phản hồi nguyên văn: *"mấy cái chú thích ở leaderboard còn quá dài nên làm bố cục các nút bị
lệch xuống, với mấy chỗ all time this week this month bạn làm chưa đẹp và khó nhìn quá"*. W6 đã
gộp ba hàng thành một thanh, nhưng để lại hai di chứng:

**Chữ dài đẩy nút lệch.** `lb-bar` căn ĐÁY (`align-items: flex-end`), cột chữ trái giờ chở tới
bốn dòng (kicker, tiêu đề, câu luật kèm ngoặc đơn "(Mon–Sun week / calendar month, Vietnam
time)", đoạn chú thích phiếu riêng). Cột nút bên phải bị kéo tụt xuống đáy theo chữ — đúng hiện
tượng "lệch xuống" người dùng chỉ ra. Nguyên nhân sâu xa: mình nhét **chú thích một-lần-đọc**
vào chỗ **hiện thường trực**. Chi tiết "tuần T2–CN, tháng lịch, giờ VN" chỉ cần đọc MỘT lần để
hiểu con tem; bắt nó chiếm hai dòng trên mọi lần mở trang là bắt cả bảng trả tiền cho một lời
giải thích.

**Tab gạch chân khó nhìn.** Nước sơn W6 chọn (chữ xám 11.5px + gạch chân 2px màu `--a-2`) có
độ tương phản quá thấp trên nền panel tối: trạng thái "đang chọn" gần như vô hình, muốn biết
đang xem tuần hay tháng phải dí mắt vào. Phân biệt bằng HÌNH DÁNG (tab ≠ viên thuốc) là đúng
ý tưởng nhưng sai cường độ.

Sửa:

| Trước (W6) | Sau (W7) |
|---|---|
| Câu luật + ngoặc đơn dài 2 dòng | `rank.periodRule.*` rút còn MỘT vế ("Sorted by requests completed this period"); chi tiết cửa sổ dời vào **tooltip của con tem** (`rank.rangeTip`) |
| Chú thích phiếu = đoạn văn thứ hai | Vế **inline** trong chính câu luật, ngăn bằng chấm mờ (`::before content:'·'`): "… · votes are lifetime totals" |
| `lb-bar` căn đáy → chữ dài đẩy nút tụt xuống | `align-items: center`; và khi chữ chỉ còn 3 dòng ngắn thì cột nút tự khắc ngang hàng tiêu đề |
| Tab gạch chân chữ xám | **Viên nhạt (soft chip)**: cùng họ vỏ pill với nhóm sắp xếp, nhưng trạng thái chọn = nền tím MỜ `--a-soft` + chữ sáng `--a-2` + vòng inset — đối lập ĐẬM/NHẠT với viên thuốc đặc của nhóm xếp, tương phản thấy rõ từ xa |

Quy tắc rút ra cho cả repo, đáng nhớ hơn bản thân cú sửa: **chú thích giải thích luật phải tỉ lệ
thuận với tần suất người dùng cần nó** — luật đang chạy (một vế ngắn) hiện thường trực; chi
tiết định nghĩa (cửa sổ tính thế nào, múi giờ nào) vào tooltip; lời thú nhận dữ liệu (phiếu cộng
dồn) là vế inline chứ không phải đoạn văn. Và trạng thái "đang chọn" của một control phải nhìn
thấy được **ở khoảng cách đọc bình thường** — nếu phải dí mắt mới biết nút nào sáng, đó là lỗi
chứ không phải "thiết kế tinh tế".

Nút mùa bỏ luôn class `lb-segb` mượn tạm (W6 mượn để ăn luật mobile): nước sơn khác hẳn thì khai
luật riêng cho sạch — `.lb-tab` có đủ hover/active/transition của riêng nó, và media 620px khai
`min-height: 40px` riêng (không mượn thì phải tự khai, quên là mất mục tiêu chạm).

Một lỗi test tự bắt: regex `/class="lb-tab([^"]*)"/` định đếm ba nút mùa nhưng ăn cả VỎ container
(`class="lb-tabs lb-periodseg"` — tiền tố trùng) thành bốn. Sửa thành `/class="lb-tab( on)?"/`
neo trọn giá trị class. Bài học cũ của repo đúng lần nữa: regex soi HTML phải neo đến ranh giới
class, không neo bằng tiền tố.

Kiểm thử: `Leaderboard.test.js` cập nhật ca bố cục (+assert chú thích phiếu là vế inline của câu
luật, +assert chuỗi "Mon–Sun week" KHÔNG còn in thường trực, +assert tooltip mang "Vietnam
time") — 416 ca / 415 đạt / 0 lỗi / 1 skip; smoke **296/296**; oxlint 0 lỗi 20 cảnh báo; build
sạch 307,5 kB (gzip 95,6 kB).

### W8. Vòng 19+3: người dùng chốt — bỏ ngày tháng khỏi màn hình, và thanh mùa hết lệch

Ảnh chụp màn hình người dùng gửi chỉ đúng hai chỗ hở còn sót của W7:

**1. Chữ trên thanh tiêu đề vẫn thừa.** Câu luật còn quấn hai dòng vì chở thêm con tem
`01/09 – 30/09` và vế "votes are lifetime totals". Phán quyết nguyên văn: *"ko cần ghi ngày
tháng ra đâu, để mỗi dòng sorted... ở chỗ chú thích là đc r"*. W7 đã đúng hướng (chú thích tỉ lệ
với tần suất cần đọc) nhưng mới đi nửa đường: vẫn giữ khoảng ngày thường trực vì sợ mất tra
cứu. Nay đi nốt: **màn hình chỉ còn đúng câu luật một vế**; khoảng ngày + chi tiết cửa sổ + lời
thú nhận phiếu gộp thành **một tooltip trên nhóm nút mùa** — hover/hold là đọc đủ, không hover
thì thanh tiêu đề gọn một dòng.

Một chi tiết buộc phải nghĩ lại khi dời: lời thú nhận phiếu thoạt đầu đặt vào tooltip **đầu cột
votes**, nhưng test bắt ngay — mùa có ≤3 người thì `rest` rỗng, **bảng không dựng**, đầu cột
không tồn tại, còn nhóm nút mùa thì luôn có mặt kể cả khi mùa trống. Tooltip phải sống trên phần
tử **luôn hiện diện ở chế độ đó**, không phải trên phần tử "hợp chủ đề nhất".

**2. Thanh mùa lệch.** `.lb-bar-ctl` để `align-items: stretch` nên nhóm mùa bị kéo dài bằng
nhóm sắp xếp (nhóm rộng hơn), trong khi các chip ôm nội dung — thừa một khoảng trống ~45px bên
phải trong vỏ pill, nhìn như nút bị xô lệch. Sửa: `align-items: flex-start` (mỗi nhóm ôm đúng
nội dung của nó), và chip thêm `inline-flex + align/justify-content: center` để chữ căn giữa cả
hai trục, không lệch baseline giữa nút chọn và nút thường. Media bản hẹp đổi `width:100%` thành
`max-width:100%` để vẫn tràn ngang được khi chật mà không tự kéo dài khi thừa.

Gỡ sạch CSS chết: `.lb-range`, `.lb-votes-note` không còn phần tử nào mang chúng — để lại là
mồi cho người sau tưởng nhầm còn dùng (repo từng có sáu khoá từ điển chết sống qua nhiều vòng
vì không ai dám xoá).

Kiểm thử: `Leaderboard.test.js` — ca bố cục chốt câu luật BẰNG CHUỖI TUYỆT ĐỐI
(`'Sorted by requests completed this period'`, không tem không chú thích), tooltip nhóm mùa chở
`dd/MM – dd/MM` + "Vietnam time" + "lifetime totals", và All time thì tooltip không chở khoảng
ngày; smoke đổi ba check từ `.lb-range`/`.lb-votes-note` sang soi `title` của `.lb-periodseg`.
416 ca / 415 đạt / 0 lỗi / 1 skip; smoke 296/296; oxlint 0 lỗi 20 cảnh báo; build sạch 307,62 kB
(gzip 95,69 kB).

## Phần X — vòng 20: streak + badge cột mốc 7/30/100 (mục 6 của bảng kế hoạch)

### X1. Bài toán và phán quyết của chủ dự án

Bảng kế hoạch còn hai mục: **badge/streak milestones 7/30/100** và **share card PNG**. Vòng này
làm mục 6. Khảo sát schema trước khi đề xuất: streak "kiểu Duolingo" cần MỘT nguồn trả lời "người
này có hoạt động ngày X không" cho BẤT KỲ ai đọc (trang công khai), và bốn nguồn có sẵn đều
thiếu một vế — `requests`/`request_comments` đọc công khai được nhưng quá thưa để nuôi chuỗi
ngày; `votes` có `created_at` theo user nhưng RLS **chỉ cho đọc hàng của mình**; `daily_spins`
khoá theo `device_hash` chứ không theo tài khoản. Suy diễn streak từ bốn nguồn lệch nhau ở
client là tự dối mình, nên hai phương án được đưa ra hỏi và chủ dự án chốt:

- **Nguồn**: bảng `activity_days (user_id, day)` + trigger tự in dấu ngày khi gửi request · vote ·
  bình luận · quay spin (migration `20260921_activity_days.sql`, additive, chạy lại an toàn).
- **Chỗ hiện badge**: trang *About me* **và** trang cá nhân công khai — cột mốc là thứ cộng đồng
  nhìn thấy nhau, cùng tinh thần với bảng xếp hạng.

### X2. Luật đếm — `src/lib/streak.js`, và ba chỗ dễ sai đã bị test khoá

- **Mốc ngày theo lịch Việt Nam** — trigger in `(created_at at time zone 'Asia/Ho_Chi_Minh')::date`,
  client đếm bằng `vnDayKey` MƯỢN TỪ `season.js`: một "ngày" của cộng đồng này bắt đầu/kết thúc
  lúc nửa đêm giờ VN ở cả ba nơi (spin, mùa giải, streak), không mỗi nơi một múi.
- **"Hôm nay chưa hoạt động" không phải là đứt chuỗi** (luật Duolingo): 9 giờ sáng chưa làm gì thì
  chuỗi còn sống tới hết ngày; `currentStreak` thấy hôm nay trống thì LÙI VỀ HÔM QUA mà đếm, và
  chỉ trả 0 khi cả hôm qua cũng trống.
- **Badge bám `longest`, không bám `current`**: mốc đã mở là THÀNH TÍCH — người nghỉ một tuần quay
  lại không bị trừng phạt lần hai bằng cách mất huy hiệu; nhưng `current` phải nói thật là đã đứt
  (test khoá cả hai vế cùng lúc).
- Lỗ hổng tự bắt khi viết test: `'2025-13-45'` KHUÔN `YYYY-MM-DD` nhưng `Date.parse` ra NaN, và một
  `toISOString()` trên ngày NaN là RangeError ném thẳng vào render — `dayKeys` phải lọc bằng
  `Number.isFinite`, không chỉ bằng regex.

### X3. Ba quyết định nhỏ đáng ghi lại

- **`fetchActivityDays` trả `null` khi không đọc được nguồn, KHÔNG phải mảng rỗng.** `null` =
  project chưa chạy migration / lỗi mạng → dải streak TỰ ẨN; `[]` = sự thật "chưa có ngày hoạt
  động nào" → hiện câu `streak.none`. Gộp hai trạng thái thành một là bắt UI nói dối một trong hai.
- **Tooltip ngọn lửa chở luật đếm, tooltip badge chở mốc còn thiếu** — dải chỉ in ba con số có tên
  (chuỗi hiện tại · dài nhất · 7/30/100), đúng quy tắc W8: chú thích tỉ lệ với tần suất cần đọc.
- **Bản demo gương đúng bốn trigger**: dấu ngày gom từ ngày gửi request (`demoRows`), ngày bình
  luận (`ccl.comments.*`), ngày quay spin (`LS.spins` — entry đã mang `day` tính sẵn theo giờ VN).
  Thiếu nguồn nào thì demo nghèo đúng nguồn đó, không bịa thêm.

Hai cảnh báo lint trên đường đi, một tránh được một thì không: `setActDays(null)` đồng bộ trong
effect của PublicProfile bị `react(set-state-in-effect)` bắt — đổi sang pattern `loaded` (một state
chở cả "của ai" lẫn dữ liệu, suy ra cũ/mới bằng so sánh id); còn `Date.now()` chốt mốc "bây giờ"
trong `useMemo` của StreakStrip là đúng pattern baseline đã chấp nhận ở `weeklyHighlights` và
Leaderboard — cảnh báo thứ 21, có tên có chỗ, không phải nợ vô chủ.

### X4. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **426 ca / 425 đạt / 0 lỗi / 1 skip** (vòng 19+3: 416). Mới: `streak.test.js` **7 ca** (biên nửa đêm VN, "hôm nay chưa có dấu thì lùi về hôm qua", chỗ đứt, dữ liệu méo kể cả ngày hợp-khuôn-nhưng-không-thật, mốc bám `longest`, và hai ca hợp đồng schema: migration tồn tại + schema.sql hợp nhất nguyên văn bốn trigger — bài học hụt file `20261104_spin_streak.sql`) và `StreakStrip.test.js` **3 ca** (badge 7 sáng/30-100 mờ, mốc không tắt khi chuỗi đứt, `null` ẩn dải còn `[]` hiện câu thật) |
| `npm run smoke` | ✅ **299/299** (vòng trước 296): +2 check dải streak ở *About me* (đủ ba badge, chuỗi dài nhất luôn in, tooltip ngọn lửa mang luật) và +1 ở trang cá nhân công khai |
| `npx oxlint` | ✅ 0 lỗi, **21 cảnh báo** — nền 20 + đúng 1 `react(purity)` của mốc `Date.now()`, pattern baseline |
| `npm run build` | ✅ sạch — `index-yC1k3g2F.js` 307,35 kB (gzip 95,33 kB) |

Một vết môi trường đáng nhớ: lần chạy `StreakStrip.test.js` đầu tiên QUÊN hook đóng vite server
(nên node:test treo hết timeout) và để lại process mồ côi GIỮ cổng WebSocket 24678 — ba vòng smoke
sau đó báo "WebSocket server error: Port already in use" như thể product lỗi. Bài học: test treo
không chỉ tốn thời gian, nó còn để lại xác process làm hỏng cả cổng kiểm thử kế tiếp.

## Phần XI — vòng 21: share card PNG (mục 7, mục CUỐI của bảng kế hoạch)

### XI1. Bài toán: một tấm ảnh chia sẻ được, không thêm dependency

Mục cuối của bảng kế hoạch: cho mỗi người một **tấm card PNG** — tên, avatar, ba con số thật,
streak + ba mốc 7/30/100 — đúng khổ og:image **1200×630** để dán lên Discord/Telegram/Facebook
là ra thẻ đẹp. Ba đường đi đã cân nhắc:

- `html2canvas`/chụp DOM: thêm một dependency nặng chỉ để làm ra MỘT tấm ảnh, và ảnh ra phụ
  thuộc bố cục màn hình đang mở — màn hẹp ra ảnh hẹp, chữ nhỏ mờ theo mật độ pixel thật;
- server render (Satori/OG service): đúng khổ nhưng cần một service thứ hai, ngoài phạm vi repo;
- **tự vẽ bằng canvas 2D** (`src/lib/shareCard.js`): không dependency, ảnh LUÔN đúng khổ đúng
  mật độ chữ kể cả khi người bấm đang xem bằng điện thoại, xuất scale 2 → 2400×1260. Chọn đường này.

### XI2. Hợp đồng của module vẽ — bốn luật khoá bằng code và test

- **Module không tự ráp chữ.** `drawShareCard` nhận nội dung ĐÃ DỊCH (`name, subtitle, stats:[{value,label}],
  streakLine, milestones, footer, stamp`) — nơi gọi (PublicProfile, App) ghép bằng `t()`. Thêm một ngôn
  ngữ sau này không phải sờ vào canvas; và `shareCard.test.js` khoá ca "mọi chữ phải có mặt đều được vẽ".
- **Số trên card là số đang hiển thị.** PublicProfile ghép card từ đúng `profile` (fetchPublicProfile) và
  `actDays` đang nuôi dải streak; App ghép từ đúng `mineRows`/`myStats`/`myActivity` đang nuôi ô thống kê
  và dải streak — không có bản tính thứ hai để mà lệch.
- **Mọi toạ độ hữu hạn.** Test chạy `drawShareCard` trên ctx GIẢ ghi lại từng lời gọi vẽ và khẳng định
  không một tham số số nào là NaN/Infinity — ảnh tĩnh vẽ lệch là lỗi im lặng nguy hiểm nhất, không có
  runtime error nào kêu thay. `n()` trong module là lưới an toàn cùng tinh thần `Number.isFinite` của `dayKeys`.
- **Hỏng thì nói thật.** `makeShareCardBlob` ném mã lỗi rõ (`card-no-dom` / `card-unsupported`); nút bắt lỗi
  và toast "This browser cannot render the card image", không bao giờ giả vờ "đã lưu". Avatar fetch về
  **blob rồi mới vẽ** (blob same-origin nên canvas không nhiễm bẩn CORS — `toBlob` trên canvas bẩn ném
  SecurityError); host không cho CORS thì lùi về vòng chữ cái đầu như giao diện vẫn làm.

### XI3. Ba quyết định nhỏ đáng ghi lại

- **Tem ngày dán lúc BẤM NÚT, không phải lúc render** — luôn là hôm nay giờ VN (`vnDayKey(Date.now())`
  trong handler), và né luôn một cảnh báo `react(purity)` cho useMemo; tên file `chaereve-<slug>-<ngày>.png`
  để card hai mùa không đè nhau trong thư mục tải về.
- **Màu đọc thẳng từ CSS custom property** (`readPalette`, có `DEFAULT_PALETTE` dự phòng khi chạy ngoài
  trình duyệt) — đổi token thương hiệu một chỗ, card đổi theo.
- **Smoke chỉ chốt nút CÓ MẶT, không bấm**: canvas trong môi trường smoke là jsdom, `getContext('2d')`
  vừa trả null vừa ném jsdomError "Not implemented" làm bẩn lượt chạy. Phần vẽ thật đã có test ctx giả lo.

Một lỗi tự bắt trên đường: `myCard` useMemo ban đầu nằm SAU early-return `if (booting) return <Splash />`
— oxlint `rules-of-hooks` bắt ngay 1 error (nền trước đó 0 error/21 warn). Dời cả `myStats` + `myCard`
lên trước return; bài học cũ vẫn đúng — hook không được đứng sau bất kỳ nhánh return nào.

### XI4. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **431 ca / 430 đạt / 0 lỗi / 1 skip** (vòng 20: 426). Mới: `shareCard.test.js` **5 ca** (wrapLines ngắt tham lam + dữ liệu rỗng/null, slugName bỏ dấu tiếng Việt + filename đúng tem, drawShareCard mọi số hữu hạn + mọi chữ có mặt + drawImage đúng một lần khi có avatar, dữ liệu cụt không nổ, `makeShareCardBlob` ném `card-no-dom` trong node) |
| `npm run smoke` | ✅ **301/301** (vòng 20: 299): +1 check `.streak-row .card-btn` ở *About me*, +1 `.profile-share-row .card-btn` ở trang cá nhân công khai — chỉ presence, không bấm |
| `npx oxlint` | ✅ 0 lỗi, **21 cảnh báo** — đúng nền đã chốt ở vòng 20, không thêm món nào |
| `npm run build` | ✅ sạch — `index-Cc-nX48n.js` 313,56 kB (gzip 97,73 kB) |

Bảng kế hoạch bảy mục — search fix, regression tests, gates, public profile, Season Leaderboard,
streak/badge, share card — **đủ cả bảy**. Nhắc lại một việc deploy còn nợ từ vòng 20: chạy
migration `20260921_activity_days.sql` trên Supabase (additive, chạy lại an toàn; chưa chạy thì
dải streak tự ẩn chứ không nói dối).

## Phần XII — vòng 22: community polish, expiry và rà soát quảng cáo

Vòng này không mở thêm một hệ điểm mơ hồ. Các phần người dùng yêu cầu được ghép vào
nguồn dữ liệu hiện có: reply dùng `request_comments.parent_id`; GIF đi thẳng qua blob
không vẽ canvas; Hall of Fame mở preview 30 giây; achievement index chỉ phát badge/title
cosmetic, không cộng vote ảo; và admin có tab Expired + Start production.

Request chưa được chọn sau một tháng không bị xóa âm thầm ngay từ cron. Cron chỉ đánh dấu
`expired_at` và báo admin; admin xem lại rồi bấm `admin_expire_request`, lúc đó mới tạo
notification cho người gửi và xóa row. Đây là chủ ý: không thể hoàn vote hoặc phục hồi một
request sau một lệnh nền không ai nhìn thấy.

### XII1. Daily Spin + ads: chưa bật

Kế hoạch thưởng vote sau quảng cáo **không được chốt bằng callback phía trình duyệt**.
Client callback có thể bị tự gọi; Worker phải nhận postback/S2S có chữ ký, lấy user từ
JWT, giữ nonce/idempotency key, và chỉ cộng trong transaction D1 với unique
`(user_id, day)`. KV chỉ dùng cache/rate-limit mềm, không dùng chốt một lần.

Monetag/PropellerAds cần xác nhận bằng văn bản rewarded web + incentivized traffic +
postback cho đúng placement/GEO trước khi thêm SDK. Vì vậy vòng này chỉ thêm tài liệu
rà soát ở `docs/DAILY-SPIN-ADS.md`, không biến Daily Spin hiện tại thành một lời hứa
"xem quảng cáo chắc chắn nhận vote".

## Phần XIII — vòng 23: bốn lỗi chủ dự án báo trực tiếp (22/09/2026)

Bốn lỗi, không lỗi nào cần suy đoán: chủ dự án bấm vào và thấy hỏng. Cả bốn đều thuộc loại
"im lặng" — không có thông báo lỗi nào, chỉ có một khối trắng, một khung đen, hoặc một nút
không dẫn tới đâu.

| Lỗi báo | Gốc rễ | Cách sửa |
|---|---|---|
| Không có đường nào tới màn đăng nhập | Hàng tiêu đề chỉ có chuông thông báo; `Sidebar` gọi `go('mine')` cho *About me* mà không ai mở cổng đăng nhập; khối hồ sơ của khách là một form rỗng với nút Save không chạy | Nút **Đăng nhập** (`GoogleIcon` + `gate.signIn`) đứng NGAY SAU chuông trong `.mainhead`, dưới 620px chỉ còn biểu tượng nhưng vẫn có `aria-label`/`title`; hàm `navTo()` mở cổng khi khách bấm *About me*; hai mục cần tài khoản (*About me*, *Daily Spin*) có khối mời đăng nhập thật (`SignInPanel`) thay vì trang trắng |
| Preview trong Hall of Fame: màn hình đen | Player cũ dựng bằng **YouTube IFrame Player API** → chèn `<script src="https://www.youtube.com/iframe_api">`, mà CSP `script-src 'self'` (`public/_headers`) chặn im lặng script đó. Promise `loadYT()` không bao giờ resolve, khung 16:9 chỉ còn nền `#0b0d12` | `<iframe>` nhúng thẳng `youtube-nocookie.com/embed/<id>?autoplay=1&start=0&end=30…` — CSP đã cho `frame-src` sẵn, không script bên thứ ba. Thêm **ảnh bìa nằm sau iframe** (mạng chậm/adblock vẫn thấy hình), nhánh `<video>` cho mp4/webm/ogv/mov/m4v, câu `preview.noEmbed` cho link lạ; Esc + bấm nền đóng, khoá cuộn nền |
| Đặt avatar GIF không được | Trần dung lượng hai nơi lệch nhau: phía trình duyệt hứa **2,5 MB**, `update_my_profile()` chặn ở **200.000 ký tự** (`length(p_avatar) > 200000` → `err.avatarBig`). GIF 1–2 MB vì thế qua được cửa chọn file ("GIF sẵn sàng"), tới lúc Save mới bị database từ chối | Trần client suy TỪ trần database: `AVATAR_STORED_CHARS = 200000`, `ANIMATED_AVATAR_MAX_BYTES` trừ tiền tố data URL và phần đệm base64 (~146 KB). Chặn ngay khi chọn file, kèm nút **"Dùng khung đầu tiên (ảnh tĩnh)"** đi qua đúng cropper ảnh tĩnh; gặp `err.avatarBig` từ database thì thông báo cũng mở lại lối thoát đó. Trần cũ 2,5 MB đã xoá khỏi mã, `HUONG-DAN.md`, `BUOC-THU-CONG.md`, `BAO-CAO-BAN-GIAO.md` |
| Daily Spin trống trơn | Khối vòng quay chỉ được dựng khi đã có tài khoản (`{user && …}`), nên khách chưa đăng nhập vào mục này gặp trang trắng — không chữ, không lý do, không nút | Khách thấy `SignInPanel` (tiêu đề + lý do + nút Google); người đã đăng nhập không đổi gì. Cùng cách xử lý cho *About me* |

Hai lỗi tự gây ra, ghi lại để lần sau không lặp:

- **`propContract.test.js` đọc CHỮ trong comment như mã.** Chú thích mô tả khối mời đăng nhập
  có viết `{user && <DailySpin/>}` — bài kiểm tưởng đó là một call site thật và báo thiếu sáu
  prop bắt buộc ở `App.jsx:200`. Nói cách khác: trong repo này **không được viết cú pháp JSX
  trong comment**. Đã sửa lại câu chữ.
- **Mở cổng đăng nhập trong `go()` làm oxlint gán `set-state-in-effect` cho MỌI effect gọi `go`**
  (effect chuyển hướng `/admin`), đẩy cảnh báo lên 29. Cổng đăng nhập là chuyện của ĐƯỜNG BẤM,
  không phải của việc chuyển mục, nên nó nằm trong wrapper `navTo()` — số cảnh báo còn thấp hơn nền.

### XIII1. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **459 ca / 458 đạt / 0 lỗi / 1 skip** (vòng 22: 454). `avatar.test.js` từ 1 ca chữ nghĩa lên **6 ca**: chạy THẬT `processAnimatedAvatar` với `FileReader` giả — GIF vừa trần đi nguyên bytes (còn chuyển động), GIF quá trần bị chặn TRƯỚC khi dựng chuỗi base64, trần client khớp trần database sát từng byte, SQL vẫn giữ `length(p_avatar) > 200000`, và giao diện nói ra con số + mở lối thoát |
| `npm run smoke` | ✅ **326/326** (vòng 22: 301) — hai lượt mới dựng app trong jsdom rồi BẤM THẬT: *4c* kiểm khách chưa đăng nhập (nút Đăng nhập đứng sau chuông, cổng mở ra và Esc đóng được, *About me* / *Daily Spin* không còn trắng), *5b* kiểm preview Hall of Fame (không có `<script>` nào của YouTube trong tài liệu — đúng thứ đã làm khung đen — iframe đúng `youtube-nocookie`, giữ `end=30`, có ảnh bìa, Esc đóng được) |
| `npx oxlint` | ✅ 0 lỗi, **26 cảnh báo** — thấp hơn nền 28 vì bản viết lại `VideoPreviewModal` bỏ được hai cảnh báo `exhaustive-deps` của player cũ |
| `npm run build` | ✅ sạch — `index-CUQJ6K5E.js` 336,94 kB (gzip 103,40 kB) |

### XIII2. Còn nợ

- **Chưa kiểm được bằng mắt trên trình duyệt thật**: môi trường này không có mạng ra ngoài, nên
  phần "video có thật sự chạy" chỉ chốt được ở mức cấu trúc (không script bên thứ ba, iframe
  đúng URL, có ảnh bìa). Việc cần làm khi có mạng: mở Hall of Fame, bấm một thẻ, xem video chạy
  và tự dừng ở giây 30.
- **GIF lớn hơn ~146 KB vẫn không lưu được nguyên chuyển động** — đó là trần của database, không
  phải lỗi. Muốn nhận GIF nặng hơn thì phải nới `update_my_profile()` (migration mới) hoặc bật
  Cloudinary (`VITE_CLOUDINARY_CLOUD` + `VITE_CLOUDINARY_PRESET`) — khi đó trần là 8 MB và ảnh
  chỉ lưu URL.

## Phần XIV — vòng 24: "hai trang chồng lên nhau" (22/09/2026)

Chủ dự án gửi hai ảnh chụp: *"lúc bấm vào màn hình login và bấm vào profile người khác xong
chuyển sang tab khác trong trang thì bị lỗi chồng trang như 2 hình (lỗi này bị ở mọi trang)"*.
Đọc kỹ hai ảnh thì đây là **hai lỗi khác nhau**, và chỉ một trong hai là lỗi mới.

| Ảnh | Thấy gì | Kết luận |
|---|---|---|
| 1 | Thẻ đăng nhập ở đầu trang (bị cắt phần trên), khoảng trống, rồi mới tới `Requests` + bốn ô thống kê + dải Featured | Đây là **khối trong luồng văn bản**: thẻ đăng nhập được chèn vào đầu tài liệu và đẩy cả bảng xuống. Đúng lỗi đã sửa ở **vòng 23** (lớp phủ `position: fixed` + nút Đăng nhập ở hàng tiêu đề). Ảnh không có nút × trên thẻ và không có nút Đăng nhập cạnh chuông → bản chạy trong ảnh là bản deploy **cũ** |
| 2 | Khối trang cá nhân (`Requests / Completed / Votes received`, streak, Achievements, Recent requests) rồi ngay dưới là **Daily bonus wheel** | **Lỗi mới, lỗi thật trong mã**: hai trang nằm trong cùng một tài liệu, xếp dọc theo nhau |

### XIV1. Gốc rễ của ảnh 2 — một TRANG bị đối xử như một MỤC

Trang cá nhân công khai (`profileId`) được vẽ **song song** với mục đang chọn, chứ không phải
*thay cho* nó:

- `openProfile` đặt `section='board'` + `profileId=<id>` — nghĩa là trang cá nhân sống trong
  mục Bảng;
- nhưng chỉ khối Bảng có `!profileId`. Ba mục còn lại — Daily Spin, Xếp hạng, About me — và cả
  trang quản trị **không có** điều kiện đó.

Nên: mở trang cá nhân của người khác rồi bấm một mục khác trong menu → mục đó dựng thêm khối
của mình **ngay dưới** trang cá nhân. Ảnh 2 là đúng ca đó với mục Daily Spin. Và đó cũng là lý
do câu "lỗi này bị ở mọi trang": mục nào cũng ra thêm một trang.

### XIV2. Bốn chỗ đã sửa

1. **MỘT lá cờ `onProfile`, cả sáu khối mục đi qua nó** (Bảng, Daily Spin, Xếp hạng, About me
   ×2 trạng thái đăng nhập, quản trị). Không còn đường nào dựng hai trang một lúc — kể cả khi
   dán tay `/?profile=…` lúc đang ở mục khác, hay khi bấm Back/Forward.
2. **Bấm một mục trong menu là ĐÓNG trang cá nhân** (`navTo`) — vì "chuyển sang tab khác" là ý
   định *đổi trang*, không phải *mở thêm trang*. Trang cá nhân vẫn còn nút *Back to board*
   riêng nên không ai mất đường về.
3. **Địa chỉ thôi nói về trang cá nhân vừa rời** (`searchWithoutProfile`, `lib/history.js`).
   Bản cũ dùng thẳng `window.location.search` khi ghi địa chỉ mục Bảng, nên tham số `profile`
   đi theo và **F5 mở lại đúng cái trang vừa rời** — cùng một lỗi ở tầng địa chỉ.
4. **Chuyển cảnh giữa hai mục đi qua một cửa duy nhất** (`src/lib/viewTransition.js`).
   View Transitions là thứ duy nhất trong app vẽ **ảnh chụp** của trang cũ lên trên trang mới,
   nên nó là ứng viên đầu tiên khi người dùng nói "chồng trang". Nó không tự sinh ảnh sai:
   nó chụp DOM ở hai thời điểm, và thứ làm ảnh ghép sai là những gì xảy ra **giữa hai lần
   chụp**. Bốn luật nay nằm trong một chỗ:
   - không có API (Firefox cũ, jsdom) → đổi thẳng;
   - người dùng xin giảm chuyển động → đổi thẳng;
   - **đang có chuyến bay → đổi thẳng, KHÔNG mở chuyến thứ hai** (bấm hai mục liên tiếp trong
     0,4 giây: lần chụp thứ hai sẽ chụp luôn ảnh của chuyến thứ nhất đang nằm trên màn hình —
     ảnh của ảnh, nhiều lớp trang);
   - xong / hỏng / bị bỏ (`skipTransition`) → **luôn dọn** `data-nav` và nhả cờ. Bản cũ đặt
     `data-nav` rồi để nguyên vĩnh viễn: hướng đi của lần chuyển cảnh trước thành hướng của
     mọi lần sau, và một chuyến hỏng là kẹt cờ.

### XIV3. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **468 ca / 467 đạt / 0 lỗi / 1 skip** (vòng 23: 459). Mới: `viewTransition.test.js` **6 ca** chạy thật `createSectionTransition` với `document` giả (không API; giảm chuyển động; mở đúng một chuyến + dọn `data-nav`; hướng lạ → `fwd`; chuyến bị bỏ vẫn dọn và không kẹt cờ; **đang bay thì không mở chuyến thứ hai**; API chết vẫn tới nơi) và `profileNav.test.js` **+3 ca** (mọi mục dùng chung `onProfile`; `navTo` đóng trang cá nhân; `searchWithoutProfile` giữ tham số bảng, bỏ `profile`) |
| `npm run smoke` | ✅ **332/332** (vòng 23: 326) — mục *10e* bấm thật: mở `/?profile=demo-user`, bấm *Daily Spin* trong menu, rồi khẳng định tài liệu chỉ còn MỘT trang. **Đã chạy lại với mã CŨ** để chắc phép kiểm bắt được lỗi: `330/332`, đỏ đúng hai mục, kèm `trang cá nhân=1 · vòng quay=1` — đúng như ảnh chụp |
| `npx oxlint` | ✅ 0 lỗi, **26 cảnh báo** — bằng nền, không thêm món nào |
| `npm run build` | ✅ sạch — `index-BZ8OCtKy.js` 337,36 kB (gzip 103,61 kB) |

### XIV4. Còn nợ

- **Ảnh 1 chỉ hết khi bản sửa vòng 23 được deploy.** Trên miền thật, thẻ đăng nhập vẫn còn là
  khối trong luồng (đẩy cả trang xuống) cho tới khi bản này lên. Sau khi deploy, phép kiểm
  tương ứng nằm ở `tools/smoke.mjs` mục *4c*.
- Chưa xem được bằng mắt trên trình duyệt thật (môi trường này không có mạng ra ngoài), nên
  phần "chuyển cảnh có còn nhấp nháy không" vẫn chỉ chốt được ở mức logic + DOM. Việc cần làm
  khi có mạng: bấm liên tiếp vài mục trong menu và xem có thấy hai trang lồng nhau không.

## Phần XV — vòng 25: mốc 30 giây của khung xem trước bị tua qua (22/09/2026)

Chủ dự án báo lần thứ hai về **đúng một tính năng**: *"cái preview 30s ở hall of fame vẫn không
hoạt động được, nó vẫn không hoạt động khi tua nhanh qua 30s"*. Vòng 23 đã sửa được **khung đen**
— khung nay chạy thật — nhưng đó mới là một nửa của việc: cái **mốc 30 giây** thì chưa ai giữ.

### XV1. Gốc rễ — `end=30` không phải một cái khoá

`end` là tham số của **chính player**: nó vẽ một vạch kết thúc và dừng ở đó khi xem bình thường.
Người xem kéo thanh thời gian qua vạch ấy — hoặc bấm `[l]` / `[→]` để nhảy 10 giây — thì player
phát tiếp bình thường, và **cả video xem trọn trong khung của web**. Không có lỗi nào hiện ra lần
này nữa, vì không có gì hỏng cả: chỉ là không ai giữ mốc.

Muốn giữ mốc thì phải **đọc được vị trí đang phát** và **tự cắt**. Bản trước không đọc được vì
việc đó phải đi qua YouTube IFrame Player API — mà API đó lại nạp
`<script src="https://www.youtube.com/iframe_api">`, đúng thứ CSP `script-src 'self'` của site
chặn (nguyên nhân khung đen của vòng 23). Vì thế vòng này đi đường khác.

### XV2. Ba lớp của mốc 30 giây

| Lớp | Việc nó làm | Dựa vào gì |
|---|---|---|
| `start=0&end=30` trong URL nhúng | player tự dừng ở giây 30 khi xem bình thường | thiện chí của YouTube (giữ nguyên như vòng 23) |
| **Vòng canh trong trang** | đọc `currentTime` player gửi về; chạm mốc là **gỡ luôn iframe** | kênh `postMessage` có sẵn của player nhúng — cần `enablejsapi=1` + `origin=<origin thật của trang>`, **không** nạp script của YouTube |
| **Đồng hồ treo tường** | chưa từng đọc được vị trí thì đúng 30 giây sau khi mở khung là hết | `Date.now()`, không phụ thuộc YouTube |

Lớp thứ hai chặn đúng thứ chủ dự án báo: **tua qua 30 giây là quá mốc y như xem hết**, không có
đường vòng. Cắt bằng cách **gỡ iframe** chứ không chỉ gửi lệnh `pauseVideo`: lệnh là một
postMessage bất đồng bộ, còn gỡ phần tử thì trình duyệt dừng tiếng ngay.

Những chỗ đã biết là **cố ý**:

- Không có kênh postMessage nghĩa là có thể bị cắt sớm nếu người xem đang tạm dừng (lớp 3 đếm
  bằng đồng hồ). Đổi lại: không còn cửa nào để xem trọn video trong khung của web.
- Chưa dạy cho trang biết "`currentTime` này là của quảng cáo": pre-roll **dài hơn 30 giây** cũng
  bị tính là quá mốc. Phần lớn pre-roll ngắn hơn, và nút *Watch the preview again* nằm ngay trên
  thẻ. Đã ghi lại trong chú thích ở `VideoPreviewModal.jsx`.

### XV3. Người xem thấy gì

- Khung có **thanh 0 → 30 giây** kèm con số (`12s / 30s`) ở chân hộp, và thanh đứng ở đầy khi hết.
- Chạm mốc (kể cả do tua) → iframe bị gỡ, hiện thẻ **"That’s the end of the preview"** trên nền
  ảnh bìa: nút *Watch the preview again* và nút mở video đầy đủ trên YouTube. Thẻ này cũng là
  chỗ đóng đinh: sau khi nó hiện thì không còn chỗ nào để bấm phát tiếp.
- Video không cho nhúng (lỗi 100/101/150 của player) → nói ra bằng `preview.noEmbed` + nút mở
  video, thay vì để một khung trắng không giải thích.
- File video không phải YouTube (mp4/webm/ogv/mov/m4v) dùng **cùng luật 30 giây**, nhưng đọc vị
  trí từ chính thẻ `<video>` (không cần postMessage).

### XV4. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **487 đạt / 0 lỗi / 2 skip** (vòng 24: 479 đạt — **+8 ca**). Mới: `src/lib/previewCap.test.js` **7 ca** cho phần luật — phong bì `postMessage` (câu chào `listening`, lệnh `command`, `channel:"widget"`), danh sách tên miền nhận sự kiện, đọc/loại sự kiện (kể cả JSON hỏng, `channel` lạ, tin từ tên miền lạ), trộn `infoDelivery` từng phần, luật cắt ở đúng 30 giây + giá trị rác thì KHÔNG cắt, thanh tiến trình kẹp 0..100. Thêm 1 ca ở `communityPolish.test.js`: **`end=30` trong URL phải bằng `PREVIEW_SECONDS`** (hai chỗ nói cùng một mốc, lệch nhau là không có triệu chứng nào trên màn hình) |
| `npm run smoke` | ✅ **337/337** (vòng 24: 332) — mục *5b* nay **giả làm chính player**: gửi về đúng loại sự kiện nó gửi (`channel:"widget"`, `infoDelivery` mang `currentTime`) từ đúng `contentWindow` của iframe. Báo 12 giây → khung vẫn chạy; báo 47 giây (đã tua qua mốc) → iframe bị gỡ và thẻ hết phần xem trước hiện ra; bấm *Watch the preview again* → có phiên xem mới. **Đã chạy lại với mã CŨ**: `333/336`, đỏ đúng 3 phép kiểm (`enablejsapi=1`, *tua qua 30 giây là bị cắt*, *thẻ hết phần xem trước có đường sang YouTube*) — đúng lỗi chủ dự án báo |
| `npx oxlint` | ✅ 0 lỗi, **27 cảnh báo** — bằng nền, không thêm món nào |
| `npm run build` | ✅ sạch — `index-DGEFovFb.js` 339,59 kB (gzip 104,33 kB) |

**Một lỗi tự gây ra, máy bắt được ngay:** bấm *Watch the preview again* thì phiên mới bị cắt sau
0,25 giây, vì bộ nhớ của phiên cũ vẫn còn vị trí **47 giây** — vòng canh đọc lại đúng con số vừa
làm nó cắt. Nay hàm xem lại **xoá hết những gì player cũ kể** trước khi dựng iframe mới. Ca kiểm
"bấm *Watch the preview again* là có phiên xem mới" trong smoke là thứ bắt được lỗi này.

### XV5. Còn nợ

- **Chưa xem được bằng mắt trên trình duyệt thật** (môi trường này không có mạng ra ngoài). Việc
  cần làm khi có mạng: mở Hall of Fame, bấm một thẻ, **kéo thanh thời gian qua vạch 30 giây** —
  khung phải dừng ngay và hiện thẻ hết phần xem trước; bấm *Watch the preview again* phải chạy
  lại từ đầu. Máy trong sandbox kiểm được phần luật, còn "player thật có trả lời kênh postMessage
  hay không" thì phải để trình duyệt thật trả lời.
- **Nếu YouTube đổi giao thức của kênh `postMessage`** (nó là API ngầm, không có văn bản cam kết),
  vòng canh sẽ im lặng mất tác dụng và mốc 30 giây tụt về đúng hai lớp kia: `end=30` (chặn được
  người xem thường, không chặn người tua) và đồng hồ treo tường (vẫn cắt, nhưng cắt theo giờ mở
  khung chứ không theo vị trí đang phát). Dấu hiệu nhận ra: thẻ hết phần xem trước hiện ra đúng
  ~31 giây sau khi mở khung, kể cả khi vừa bấm tạm dừng.

## Phần XVI — vòng 26: ẩn giao diện YouTube, chỉ còn play/pause (22/09/2026)

Yêu cầu của chủ dự án, nguyên văn: *"bạn có thể ẩn mấy cái giao diện của YouTube lúc chiếu video
đc ko, chỉ bấm play/pause đc thoii"*. Đây là việc **thay giao diện điều khiển**, không phải chỉ
thêm một tham số — và nó chạm trực tiếp vào mốc 30 giây vừa làm xong ở vòng 25, nên phải làm cùng
lúc để không mở lại đường vòng.

### XVI1. Tắt giao diện YouTube

| Tham số | Việc nó làm |
|---|---|
| `controls=0` | bỏ **thanh điều khiển** — trong đó có nút *Watch on YouTube*, thanh thời gian, âm lượng, cài đặt, logo kênh |
| `disablekb=1` | bỏ **phím tắt của player**: `[l]`/`[→]` nhảy 10 giây, `[0-9]` nhảy theo phần trăm — đúng hai đường vòng qua mốc 30 giây |
| `autoplay=1` | (đã có từ vòng 25) cũng là thứ giữ cho nút *Watch on YouTube* không hiện |

Đổi lại phải **tự vẽ** phần điều khiển, và chỉ một nút — đúng yêu cầu:

- **Nút play/pause** ở giữa khung (`PreviewControls`), gửi `playVideo` / `pauseVideo` qua chính
  kênh postMessage của vòng 25. Trạng thái đọc qua `playButtonView()`: `onStateChange` của player
  là nguồn đúng nhất, rồi `playerState` trong gói tin, cuối cùng là ý định của người xem khi họ
  vừa bấm (nút đổi ngay, không chờ player xác nhận).
- **Lớp điều khiển phủ kín khung**, nên cú bấm **không bao giờ lọt vào iframe** — không có giao
  diện nào của YouTube lộ ra, kể cả khi người xem bấm vào giữa video. Bấm vào vùng video (ngoài
  nút) cũng là play/pause, đúng thói quen của mọi player.
- **Đang phát thì nút mờ đi** để không che hình; rê chuột vào khung hoặc Tab tới nó là hiện lại.
  Đang dừng thì luôn hiện — lúc ấy nó là việc duy nhất làm được.
- **Thanh 0→30 giây ở chân hộp nay kéo được**: kéo/ bấm là gửi `seekTo`, mũi lên/xuống nhích 1
  giây. Tua vẫn có, nhưng không còn đường tua RA NGOÀI phần xem trước (mốc kẹp ở `seekTo`, và vòng
  canh vẫn cắt nếu player báo về một vị trí quá mốc).

### XVI2. Quảng cáo pre-roll: sửa luôn lỗi của vòng 25

Vòng 25 ghi lại một "chỗ đã biết là cố ý": pre-roll dài hơn 30 giây cũng bị tính là quá mốc, vì
`currentTime` mà player báo trong lúc chạy quảng cáo là thời gian **của quảng cáo**. Vòng này sửa
hẳn, và cách sửa cũng cần cho yêu cầu mới:

- `playhead(info)` trả về vị trí **của video**, kèm cờ `ad` (hai dấu hiệu player tự gửi:
  `playerState === -1` và `videoData.isAd`). Quảng cáo không được tính vào mốc 30 giây.
- `keptTime(prev, next)` giữ mốc thời gian **không lùi**: quảng cáo hết, player báo về 0 thì chỗ
  đang xem không tụt về 0.
- Nút play/pause **tự tắt** trong lúc quảng cáo (bấm pause vào quảng cáo chỉ tổ đứng hình ở một
  tấm hình quảng cáo), kèm `title` nói ra lý do.

### XVI3. Một lỗi tự gây ra, oxlint bắt được ngay

Bản đầu đọc thẳng `stateRef.current` / `infoRef.current` **trong lúc render** để quyết định nút
đang hiện gì — React cấm (giá trị có thể cũ so với lần vẽ trước) và luật `refs` của React Compiler
báo đỏ. Nay trạng thái nút là **state** (`playState`), được đẩy vào từ hai chỗ (bộ nghe sự kiện và
vòng canh 250ms), và chỉ `setState` khi giá trị **đổi** — gói tin của player về vài lần mỗi giây,
`setState` với giá trị cũ chỉ tổ bắt React vẽ lại vô ích. Ý định của người xem (`wantRef`) nằm
trong ref vì vòng canh không được dựng lại mỗi cú bấm (dựng lại là đồng hồ treo tường đếm lại từ 0).

### XVI4. Còn lại gì của YouTube (nói thẳng)

- **Tiêu đề video + tên kênh ở mép trên** và **nút *Watch on YouTube* khi tạm dừng**: YouTube bỏ
  tham số `modestbranding` từ 2023 và tới nay **không có tham số nào tắt hai thứ đó**. Chúng nằm
  trong iframe khác tên miền nên trang không chạm tới được (CSS cũng không xuyên được vào iframe).
  Thực tế: chúng tự mờ đi khi đang phát, và khung này **tự phát** ngay khi mở nên người xem bình
  thường không thấy; chỉ hiện khi người xem tạm dừng hoặc rê chuột lên mép trên. Nút mở video đầy
  đủ của mình (chân hộp + thẻ hết phần xem trước) là đường đi chính thức.
- **Quảng cáo** không tắt được (đó là tiền của kênh).
- Nếu trình duyệt **chặn tự phát** (người dùng bật "chặn tự phát"), YouTube có thể hiện nút play
  lớn của chính nó bên trong iframe; cú bấm vẫn không tới được nó (lớp của trang ở trên), nhưng
  nút của mình ở đó và bấm là chạy — vì `allow="… autoplay …"` đã bật từ trước.

### XVI5. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **491 đạt / 0 lỗi / 2 skip** (vòng 25: 487 đạt — **+4 ca**): `previewCap.test.js` thêm 3 ca (`playhead` — quảng cáo không tính là vị trí video; `keptTime` — thời gian không lùi; `playButtonView` — thứ tự tin cậy và tắt trong lúc quảng cáo), `communityPolish.test.js` thêm 1 ca chốt `controls=0` + `disablekb=1` + `autoplay=1` và sự tồn tại của nút play/pause tự vẽ |
| `npm run smoke` | ✅ **348/348** (vòng 25: 337, **+11 check**) — mục *5b* nay kiểm cả: URL nhúng tắt giao diện YouTube; có nút play/pause tự vẽ và thanh tua `role="slider"`; **bấm nút thật** và bắt lệnh gửi ra bằng cách chặn `contentWindow.postMessage` (jsdom không có mạng) — thấy đúng `pauseVideo` / `playVideo`; nút đổi trạng thái ngay; bấm vào giữa video cũng gửi lệnh và không lọt vào YouTube; khung đang phát thì nút mờ đi; **đang chạy quảng cáo thì nút tự tắt và không cắt nhầm**; quảng cáo hết thì đồng hồ không tụt về 0. **Đã chạy lại với mã CŨ (vòng 25): `337/346`, đỏ đúng 9 phép kiểm của ca này** |
| `npx oxlint` | ✅ 0 lỗi, **27 cảnh báo** — bằng nền (hai cảnh báo `refs` do bản nháp gây ra đã được xử lý bằng cách đưa trạng thái nút vào state, và `PreviewControls` thành component riêng) |
| `npm run build` | ✅ sạch — `index-BhIBp-T1.js` 343,03 kB (gzip 105,29 kB) |

### XVI6. Còn nợ

- **Chưa xem được bằng mắt trên trình duyệt thật** (không có mạng ra ngoài). Việc cần làm khi có
  mạng: mở Hall of Fame → bấm một thẻ → kiểm bốn điều: (1) không thấy thanh điều khiển của
  YouTube; (2) nút giữa khung bấm được, đổi hình theo trạng thái; (3) kéo thanh 0→30 giây thì
  video nhảy đúng chỗ và **không vượt qua 30 giây**; (4) rê chuột lên mép trên khung xem còn thấy
  gì của YouTube (kỳ vọng: tiêu đề + *Watch on YouTube* chỉ hiện khi tạm dừng — thứ không tắt được).

## Phần XVII — vòng 27: phủ nốt giao diện YouTube còn sót (22/09/2026)

> ⚠️ **Vòng 28 đã gỡ bốn dải phủ này** (chủ dự án: *"thấy gớm luôn"*). Mục dưới đây giữ lại như
> hồ sơ của một lần đã thử — số đo, lý do, và cả ba thứ cố ý không làm — để nếu ai muốn quay lại
> thì biết bắt đầu từ đâu. Bản đang chạy: xem **Phần XVIII**.

Chủ dự án báo lần thứ ba, lần này kèm **ảnh chụp**: *"vẫn chưa ẩn hoàn toàn giao diện yt"*. Trong
ảnh còn nguyên: **tiêu đề + avatar kênh** ở mép trên, **logo YouTube, biểu tượng CC, ô chất lượng
4K, nút share** ở mép dưới, và **tấm "Video khác"** (nội dung gợi ý) phủ giữa khung. Vòng 26 mới
làm được một nửa việc, và lý do là **giới hạn thật**, không phải thiếu tham số.

### XVII1. Vì sao `controls=0` không đủ — và không có tham số nào đủ

| Thứ còn sót | Vì sao không tắt được |
|---|---|
| tiêu đề + avatar kênh, tấm "Video khác", logo, CC, chất lượng, share, nút ⋮ | **không nằm trong thanh điều khiển**, nên `controls=0` không đụng tới |
| logo / nút *Watch on YouTube* ở mép dưới | `modestbranding` — tham số duy nhất từng bỏ được logo — **đã bị YouTube bỏ từ 2023** |
| tất cả những thứ trên | nằm **bên trong iframe khác tên miền**: CSS của trang không xuyên vào được, JS cũng không đọc được DOM bên trong (nên không thể "nhìn thấy rồi ẩn theo") |

Nói ngắn: **không có công tắc**. Cách duy nhất còn lại là **phủ lên** — và đó là việc của vòng này.

### XVII2. Bốn dải mặt nạ, số đo lấy từ chính ảnh chụp

`CHROME_COVER` trong `src/lib/previewCap.js` là nguồn số duy nhất; khung video trong ảnh là
914×537 px, quy ra % chiều cao/chiều rộng khung:

| Dải | Che gì | Vì sao con số đó |
|---|---|---|
| trên **15%** | tiêu đề + avatar kênh (4%..13%), nút ⋮ (2%..7%) | dư 2% so với chỗ cao nhất phải che |
| dưới **24%** | tấm "Video khác" (80%..94%), logo (91%..95%), CC (93%..99%), chất lượng (92%..98%), share (88%..92%) | dư 4% dưới chỗ bắt đầu của tấm gợi ý |
| trái / phải **4%** | vệt mép của player, bo góc, vệt sáng của ô chất lượng khi mở | mỏng nhất mà vẫn phủ hết mép |

Bốn dải **nhô ra ngoài khung 14px** để đè cả phần bo góc và mép iframe — chỗ trước đây lộ vệt.

Dải là **kính mờ**, không phải băng dính đen: `backdrop-filter: blur(18px) brightness(.62)` làm
mờ và tối **chính những điểm ảnh của video phía sau**, nên mép khung trông như một viền mờ ăn
theo màu video (kiểu ambient mode), rồi một lớp gradient tối dần về phía mép. Nút play/pause tự
vẽ cũng được làm đục hơn (`rgba(8,10,15,.82)` + `blur(10px) brightness(.7)`) để **che luôn nút
play lớn mà player tự vẽ ở giữa** khi video đang dừng.

Ba điều đã cân nhắc và **cố ý không làm**:

- **Không kéo iframe to lên rồi cắt bớt.** Phóng to để phần nhìn thấy vẫn đủ 16:9 thì ảnh bị
  zoom (mất nét), mà giao diện YouTube cũng phóng theo và vẫn nằm trong vùng nhìn thấy.
- **Không đặt lại vị trí tấm gợi ý.** Tấm đó nằm bên trong iframe; không có cách nào chạm tới.
- **Không tô đen đặc bốn dải.** Thanh đen đặc thì che được, nhưng khung thành cái hộp bị dán
  băng dính; kính mờ che y như vậy mà vẫn ăn theo màu video.

### XVII3. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **493 đạt / 0 lỗi / 2 skip** (vòng 26: 491 đạt — **+2 ca**). Mới: **bài kiểm HÌNH HỌC** trong `previewCap.test.js` — bảy hình chữ nhật giao diện YouTube đọc từ ảnh chụp (tiêu đề/kênh, nút ⋮, tấm "Video khác", logo, CC, chất lượng, share) phải nằm **trọn** trong một trong bốn dải; sửa `CHROME_COVER` nhỏ đi là đỏ ngay, và đỏ ở đúng mép sẽ lộ giao diện. Thêm 1 ca ở `communityPolish.test.js`: dải trên ≥ 13%, dải dưới ≥ 20%, và tổng hai dải < 50% (không được phủ quá nửa khung, không thì hết chỗ xem video) |
| `npm run smoke` | ✅ **351/351** (vòng 26: 348, **+3 check**): có mặt nạ và **đúng bốn dải**; số đo trong DOM khớp `CHROME_COVER` (smoke **import chính mô-đun** rồi so, không chép lại con số); mặt nạ không chặn cú bấm. **Đã chạy lại với mã CŨ (vòng 26): `349/351`, đỏ đúng hai phép kiểm của ca này** (`không có` mặt nạ) |
| `npx oxlint` | ✅ 0 lỗi, **27 cảnh báo** — bằng nền |
| `npm run build` | ✅ sạch — `index-*.js` 343 kB |

### XVII4. Còn nợ

- **Chưa xem được bằng mắt trong sandbox** (không có mạng ra ngoài). Việc cần làm khi có mạng:
  mở Hall of Fame → bấm một thẻ → soi bốn mép: mép trên không còn tiêu đề/avatar kênh, mép dưới
  không còn logo/CC/chất lượng/share, giữa khung không còn tấm "Video khác". Thứ duy nhất còn lại
  là **những gì player vẽ ở CHÍNH GIỮA khung** (nút play lớn khi đang dừng, nhịp nháy pause) —
  nút play/pause của trang nằm đè lên đó, nhưng nếu ảnh chụp cho thấy còn viền của nút YouTube
  thì bước tiếp theo là phóng to nút của trang cho phủ kín hơn.
- **`backdrop-filter` trên iframe khác tên miền** là chỗ phụ thuộc trình duyệt. Nếu trình duyệt
  không lấy được mặt phẳng của iframe, bốn dải vẫn là bốn tấm tối dần (đã có nhánh
  `@supports not`), tức vẫn che — chỉ mất vẻ "kính mờ ăn theo màu video".
- **Mép bị phủ là mép bị mất hình**: 15% trên + 24% dưới. Đây là giá phải trả để không còn giao
  diện YouTube, và là lựa chọn có ý thức cho một khung xem trước 30 giây (nội dung chính của
  video nằm giữa khung). Muốn giữ trọn hình thì phải quay lại chấp nhận giao diện YouTube.

## Phần XVIII — vòng 28: bỏ dải phủ, theo bố cục "video trailer popup" (22/09/2026)

### XVIII1. Chủ dự án nói gì

Vòng 27 vừa giao xong thì có hai câu:

> "thấy gớm luôn tr"

> "t muốn bạn làm tựa tựa v nè: `100jsprojects.com/project/video-trailer-popup`"

Đọc lại vòng 27 thì thấy **chê đúng**: bốn dải là kính mờ, nhưng mép trong của chúng cắt **phựt**
từ tối về 0 — mắt đọc ra bốn tấm băng dán quanh khung, và càng rõ vì mép cắt nằm ngay trên hình
đang chạy. Mẫu được gửi thì ngược hẳn: **không có gì quanh khung cả** — nền đen, video ở giữa, một
nút ✕. Vậy là **gỡ hẳn** cách phủ, đi theo mẫu.

### XVIII2. Bố cục mới (và số đo `FRAME_FADE`)

```
.video-preview-scrim      nền rgba(3,4,7,.95) + blur(6px), phủ toàn màn hình, bấm ra ngoài là đóng
└── .video-preview-stage  cột giữa, rộng min(960px, 100%)
    ├── section.video-preview-player   role="dialog", aria-labelledby="video-preview-title"
    │   ├── .video-preview-frame       khung 16:9, bo 12px, đổ bóng
    │   │   ├── span.video-preview-fade   hai vệt mờ mép trên/dưới (FRAME_FADE)
    │   │   ├── ảnh bìa + iframe + nút play/pause tự vẽ (lớp điều khiển phủ kín khung)
    │   │   └── .video-preview-timeline    vạch 0→30 giây, kéo được
    │   └── button.video-preview-close    ✕ nổi ở góc phải trên khung (top: -42px; điện thoại: 8px)
    └── .video-preview-meta            h2 tên bài + "xem trước 30 giây" + đồng hồ + link mở video gốc
```

| | Số đo | Alpha | Ghi chú |
|---|---|---|---|
| `FRAME_FADE.top` | 9% | `.55` | `linear-gradient(180deg, rgba(0,0,0,.55), transparent)` |
| `FRAME_FADE.bottom` | 11% | `.6` | `linear-gradient(0deg, rgba(0,0,0,.6), transparent)` |

Hai vệt này **không nhằm che giao diện YouTube** — chúng chỉ để mép hình hoà vào sân khấu đen, nên
**tan hết về `transparent`** (không còn mép cứng để mắt bắt), alpha thấp, tổng hai mép 20% chiều
cao. `previewCap.test.js` canh: `top ≤ 14`, `bottom ≤ 16`, tổng `≤ 25`, và **không được có lại**
`.video-preview-masks`; `communityPolish.test.js` canh tiếp: hai gradient phải có chữ `transparent`
và vùng vệt mờ **không được** dính `backdrop-filter`/`brightness` (bộ lọc của thời kỳ dải phủ).

### XVIII3. Đánh đổi — nói thẳng

**Giao diện YouTube hiện lại**: tiêu đề + avatar kênh ở mép trên, logo ở mép dưới. Đây là cái giá
trực tiếp của việc đi theo mẫu:

| Cách | Được | Mất |
|---|---|---|
| phủ (vòng 27) | không thấy gì của YouTube | bốn tấm băng quanh khung — chủ dự án chê "gớm" |
| mẫu (vòng 28) | sạch, đúng mẫu, không tấm nào | thấy tiêu đề/logo YouTube |

Cả hai cùng lúc là **không thể**: mọi cách che đều phải là một tấm phủ. Những thứ **vẫn còn nguyên**
của các vòng trước: `controls=0` (không thanh điều khiển, không nút *Watch on YouTube*),
`disablekb=1`, nút play/pause tự vẽ, lớp điều khiển của trang phủ kín khung nên con trỏ không vào
được iframe (tức phần hiện-khi-rê-chuột như CC/chất lượng/share/⋮ không có cớ xuất hiện), và **luật
30 giây**: `end=30` + vòng canh + `cut()`, tua qua 30 giây là khung tự cắt.

### XVIII4. Kiểm thử của vòng này

| Hạng mục | Kết quả |
|---|---|
| `npm test` | ✅ **493 đạt / 0 lỗi / 2 skip** (vòng 27: 493 đạt — bằng, nhưng **nội dung ca đổi**: ca hình học bảy hình chữ nhật + ca "bốn dải" của vòng 27 đã bị thay bằng ca "vệt mờ tan dần, và không được dựng lại dải" + ca bố cục trailer popup) |
| `npm run smoke` | ✅ **352/352** (vòng 27: 351, **+1 check**): `.video-preview-stage` + `.video-preview-player` là hộp thoại; có nút ✕ nổi ngoài khung; link mở video gốc giờ ở `.video-preview-open`; vệt mờ đúng số đo `FRAME_FADE`; **không còn** `.video-preview-masks`. **Đã chạy lại với mã CŨ (vòng 27): `344/352`, đỏ đúng tám phép kiểm của vòng này** |
| `npx oxlint` | ✅ 0 lỗi, **27 cảnh báo** — bằng nền |
| `npm run build` | ✅ sạch — `index-Dnvgj2bw.js` 343.31 kB (gzip 104.28 kB) |

### XVIII5. Còn nợ

- **Chưa xem được bằng mắt trong sandbox** (không có mạng ra ngoài): cần mở Hall of Fame → bấm một
  thẻ và kiểm bốn điều ghi ở `HUONG-DAN.md` mục *Vòng 28*.
- Nếu ảnh chụp cho thấy tiêu đề/logo YouTube **che mất phần đáng xem**, các bước tiếp theo (theo thứ
  tự nhẹ tay → mạnh tay): (1) đẩy `FRAME_FADE` lên — nhưng đó lại là băng che, phải hỏi trước;
  (2) dựng lại lớp phủ mờ **có bo và tan** ở hai mép thay vì cắt phựt; (3) quay lại iframe to hơn
  rồi cắt bớt (mất nét, không nên).
- **Không có cách nào tắt** tiêu đề/logo bằng tham số: `modestbranding` đã bị YouTube bỏ từ 2023,
  và hai thứ đó nằm ngoài thanh điều khiển. Đừng thử lại.
