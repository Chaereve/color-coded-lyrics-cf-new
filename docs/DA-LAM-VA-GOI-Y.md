# Đã làm gì, và còn gợi ý gì — tất cả trong gói miễn phí

Cập nhật 19/09/2026 · nhánh `arena/01a0b7c0-color-coded-lyrics-cf-new`
So với mốc đầu phiên (`bc65c01`): **65 file, +5224 dòng**, `npm test` **257 đạt / 0 lỗi / 1 skip** (258 ca).

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
| **1. Bảng quản trị: mở một tab riêng thay vì popup, đầy đủ tính năng** | Bảng quản trị giờ là **một trang thật ở `/admin`**, có mục riêng trong sidebar (chỉ hiện với tài khoản quản trị) và vào được bằng link — dán link cho người khác là họ mở đúng chỗ đó. Trạng thái "đang mở mục nào" nằm trong **URL**, nên F5 không mất chỗ đang làm và nút Back của trình duyệt quay lại đúng mục trước. Bấm ra ngoài **không** đóng gì cả (trước đây đóng cả bảng, mất hết dòng đang chọn). Mục **Video** không tự quản lý ảnh nữa: không còn thanh tìm kiếm vô nghĩa đứng trên nó. <br><br>**Đầy đủ tính năng hơn:** dải năm ô số liệu vừa là **tổng quan** vừa là **bộ chuyển mục** (mỗi ô mang đúng con số mà mục đó sẽ liệt kê, nên không có hàng tab nào đếm lại lần hai); thanh công cụ gộp **tìm kiếm + xếp thứ tự (mới nhất / nhiều vote / chờ lâu nhất) + lọc theo loại bài + chế độ chọn nhiều**; dòng đếm "đang xem n trên tổng N" kèm **chọn cả trang đang nhìn**; thanh thao tác hàng loạt dính đáy; mục Đang xử lý hiện **thanh tiến độ ngay trên hàng** (không phải mở khung sửa mới biết bài tới đâu); bàn phím: `/` nhảy vào ô tìm, `Esc` trong ô tìm xoá từ khoá rồi mới rời ô, `Esc` ngoài ô tìm **bỏ chọn hàng loạt** (thao tác đang dở, nguy hiểm hơn cả việc cuộn lên đầu trang). |
| **2. Form request "chưa có thay đổi gì" — làm lại cho vượt bậc** | Bốn thứ nhìn thấy được, không phải sửa trong ruột: <br>**(a) Dải 3 bước** trên đầu form (chọn loại → điền tên → gửi) sáng dần theo việc đã làm — không có bước ẩn nào xuất hiện sau khi bấm Gửi. <br>**(b) Bốn loại bài thành bốn thẻ có giải thích**: mỗi thẻ nói loại đó khác gì ba loại kia ("Full Album" khác "1 Hour Loop" ở chỗ nào), thay vì bốn chữ trần. <br>**(c) Lỗi nằm ngay tại ô sai**: rời ô mà còn trống thì câu giải thích hiện dưới chính ô đó, ô được đánh dấu `aria-invalid`; bấm Gửi khi còn thiếu thì con trỏ **nhảy vào ô sai đầu tiên** (trước đây chỉ có một dòng lỗi chung ở cuối form). Bộ đếm ký tự chỉ hiện khi đã dùng quá 70% ô. <br>**(d) Thẻ XEM TRƯỚC**: phần dưới form dựng ra **đúng cái thẻ mà người khác sẽ thấy trên bảng** từ chính những gì đang gõ, chỗ chưa điền hiện chữ mờ nói còn thiếu gì. Dán **link YouTube** thì ảnh bìa của chính video đó hiện ngay trong thẻ xem trước (lấy từ `i.ytimg.com`, **không cần API key, không tốn quota**) — trước đây dán đúng hay sai cũng nhìn giống nhau. Nút Gửi nói trước còn thiếu gì ("Điền nốt ô bắt buộc") thay vì xám im lặng, và có nút **Xoá hết** để bắt đầu lại. |
| **3. Tinh chỉnh quy luật tính của leaderboard** | Luật xếp hạng dồn về `src/lib/ranking.js` (hàm thuần, có test bằng số) và sửa **ba lỗi thật**: <br>**(a) khoá phá hoà trùng khoá chính** — bản cũ sắp bằng chuỗi `||`: xếp theo phiếu thì khoá phá hoà đầu tiên cũng là phiếu, xếp theo số bài thì khoá thứ hai cũng là số bài. Khoá trùng khoá chính là **khoá chết**, thứ tự rơi xuống so theo… tên. Nay chuỗi là *đã xong → tổng phiếu → số bài → tỉ lệ → tên*, khoá đang xếp bị loại khỏi chuỗi. <br>**(b) tỉ lệ hoàn thành chỉ có tiếng nói khi số bài đã bằng nhau**: 6/6 đứng trên 6/30, nhưng 30 bài đã xong **không** bị 1 bài đã xong đè. <br>**(c) một danh tính là một dòng** — bản demo gom theo `user_id::requester` nên người đổi tên hiển thị hiện thành hai dòng và **cả hai đều được tô "bạn"**; nay gom đúng như view `requester_ranking` (một `user_id` = một dòng, tên dùng nhiều nhất), dòng dữ liệu hỏng không làm sập bảng. <br>Trên màn hình: mỗi cách xếp in ra **câu nói rõ luật đang chạy** ("Sorted by votes earned · ties go to more completed, then more requests") — trước đây thứ tự nhảy khi đổi cách xếp mà không có câu nào giải thích. Cột tỉ lệ hoàn thành dùng số tính sẵn của luật, không chia lại tại chỗ. |
| **4. Thanh filter còn sơ sài, chưa tích hợp cho các thiết bị** | Một hàng chip trạng thái (cuộn ngang được, mỗi chip có **màu và số đếm của chính nó**), một nút **Bộ lọc** ở bên phải kèm số điều kiện đang bật, và ô tìm kiếm cùng hàng. Trên **máy hẹp**: dòng đếm nhường chỗ cho nút Bộ lọc, khối lọc thứ hai (chip loại bài + dòng tổng kết + lối xoá hết) **gấp lại** cho tới khi bấm; nút nói rõ đang mở/đóng bằng `aria-expanded`. Trên **thiết bị chạm** chip cao ≥40px (giữ nguyên hình dáng bản desktop, chỉ nâng vùng chạm) — `pointer: coarse`, không phải hai bản CSS. Cả thanh **dính mép trên** khi cuộn và chỉ đổi viền + bóng khi thật sự dính, nền mờ có đường lui cho máy không hỗ trợ `backdrop-filter`. |
| **5. Popup nhập số vote hiện đại hơn, đẹp hơn** | Hộp thoại đổi từ "nhập một con số" sang **cho thấy kết quả**: một con số lớn là **số phiếu SAU khi bạn vote** (kèm cú nảy khi con số đổi), dưới là "trước đó n là bao nhiêu". Bốn mức nhanh **1 · 5 · 10 · tất cả** (mức nào vượt quá số phiếu đang có thì không hiện — bấm vào rồi báo lỗi là lỗi thiết kế), một **thanh trượt** cùng trục với dãy nút, ô số có nút −/+, nút **rút lại** số phiếu đã vote, và câu "còn 7 → còn 3" trả lời đúng câu hỏi *bấm nút này thì tôi mất gì*. Cuối cùng là **ba ô số dư** (miễn phí hôm nay / đã mua / thưởng) để biết phiếu sắp dùng lấy từ đâu. Kèm một lỗi thật: hộp thoại cũ chỉ chặn bài đã chốt, nên bài đã xong/bị từ chối/còn chờ duyệt mà lọt vào vẫn cho chọn phiếu và cho bấm — nay chỉ bài **đang trong hàng** mới vote được, ngoài ra hộp thoại nói rõ vì sao đóng. |
| **6. Nhãn tag bị chồng / vướng vào nhau** | Nguyên nhân không nằm ở nhãn nào cụ thể mà ở chỗ mỗi nhãn tự ứng xử một kiểu. Nay `.pill` và `.kind` dùng **chung một khuôn** (`inline-flex`, không co, `white-space: nowrap`, `line-height: 1` — nhãn không bị bóp, không tự xuống dòng giữa chữ, chiều cao không phụ thuộc chữ bên trong), và **từ hai nhãn trở lên thì cả cụm nằm trong `.tags`** — hộp biết xuống dòng, có khe 6px, và cho dòng chữ bên cạnh co lại (chữ dài bị cắt chứ không đẩy nhãn ra ngoài). Áp ở mọi chỗ có nhiều nhãn: tiêu đề hàng request, khối Up next, ghi chú bài trùng, hàng trong bảng quản trị. |
| **7. Màu thanh progress chưa đẹp** | Vạch không tô phẳng một màu nữa, nhưng cũng **không** lấy màu ngoài hệ: ruột là dải **hai điểm cùng một huệ** (`color-mix(--sc 68%, --bg)` ở đầu vạch → `--sc` nguyên bản ở cuối) nên mắt đọc ra hướng chạy mà không sinh ra bảng màu thứ hai; mép trên có **vệt sáng 1px**, rãnh có **bóng lõm**, thành ra vạch đọc như một thanh mảnh bắt sáng thay vì một dải băng dính. Thêm `min-width: 6px` bằng đúng đường kính bo tròn: 1% vẫn phải nhìn thấy, vì "đã bắt đầu" khác "chưa bắt đầu". Hàng trong bảng quản trị cũng hiện thanh này ngay trên hàng. |
| **8. Ô search bị icon lòi ra ngoài** | Lỗi thật, một dòng: `.search-ico` thiếu `top` nên icon nằm ở đâu đó trong lòng ô/ngoài mép tuỳ chiều cao ô. Nay icon canh giữa theo chiều dọc (`top: 50%` + `translateY(-50%)`), không nhận chuột (`pointer-events: none` — bấm vào icon vẫn vào được ô nhập), và ô tìm của **bảng quản trị** dùng đúng cùng lớp đó (kèm nút xoá và phím tắt `/`). |

**Kiểm thử và tài liệu của vòng 9:** `npm test` → **300 ca / 299 pass / 1 skip / 0 fail**
(thêm `src/lib/ranking.test.js` 8 ca luật xếp hạng, `src/components/AdminPanel.test.js`
9 ca dựng thật cả năm mục của trang quản trị, `src/components/VoteModal.test.js`
6 ca, `src/components/Leaderboard.test.js` 5 ca, `src/lib/cssFilterBar.test.js`
8 ca cho thanh lọc / nhãn / ô tìm / thanh tiến độ). `docs/DESIGN.md` thêm §2.6
(nhãn và cụm nhãn), §2.7 (luật xếp hạng), mục màu vạch trong §2.5, một gạch đầu
dòng cho thanh lọc máy hẹp ở §5, một mục "không quay lại popup" ở §7, và ba mục
mới trong danh sách kiểm trước khi ship ở §8.

**Một việc vẫn để mở:** `creativetimofficial/ui` (repo bạn đưa ở vòng 8) không có
`README.md` để đọc thẳng — cần liệt kê cây thư mục trước khi lấy được gì từ đó, và
`untitledui.com/react/components`, `mui.com`, `reactbits.dev`, `primereact.dev` vẫn
chưa xem hết.
