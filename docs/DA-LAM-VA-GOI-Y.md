# Đã làm gì, và còn gợi ý gì — tất cả trong gói miễn phí

Cập nhật 19/09/2026 · nhánh `arena/01a0b7c0-color-coded-lyrics-cf-new` · commit `8a85321`
So với mốc đầu phiên (`bc65c01`): **23 file, +1.702 / −248 dòng**, `npm test` **214 đạt / 0 lỗi / 1 skip**.

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
| Màn chờ | Ghim cứng 1,7 giây | Chờ dữ liệu + sàn 560ms, và **một lần mỗi phiên tab** |

### A3. Bố cục

| Việc | Chi tiết |
|---|---|
| **Bảng yêu cầu thành hai cột từ 1300px** | Cột trái giữ việc chính (thống kê, Up next, Vote của bạn, danh sách), cột phải 320px là video của kênh. Ngưỡng **tính ra** chứ không chọn cho đẹp: từ 900px `.shell` đã chừa 252px cho sidebar nên cần `650 + 24 + 320 + 52 + 252 ≈ 1298`. Đổi bằng `grid-template-areas`, **không đổi thứ tự DOM** |
| Trong cột 320px | Dải mục lục video xếp **dọc** (ảnh 112px trái, tên phải) thay vì cuộn ngang |
| Bản hẹp | Thống kê 4 ô về **một hàng** (tiết kiệm ~60px); dải mục lục video còn **ảnh bìa 96px** (tiết kiệm ~80px) |
| Dòng phụ dưới tiêu đề trang | Tiêu đề đứng một mình ở góc để lại khoảng trống không rõ chức năng; thêm một dòng nói trang này để **làm gì** |

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

`npm test` **214 đạt / 0 lỗi / 1 skip** (195 nền + **19 ca mới**) · `npx oxlint` **0 lỗi, 14 cảnh báo — đúng bằng nền, không thêm cảnh báo nào** · `npm run build` sạch, bundle 333 kB (gzip 106 kB).

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
| 7 | **Báo cáo tuần cho admin qua Telegram** | Tổng request/vote/đơn/top bài — một tin mỗi tuần, đọc trong 10 giây | Rẻ | 1 cron (đã dùng 1 cho chốt request → nhét chung vào lượt đó); Telegram bot free |

### C2. Đáng làm, cần bạn chốt vài quyết định

| # | Việc | Được gì | Công | Trần free |
|---|---|---|---|---|
| 8 | **Nối `watches`/`notifications` xuống database** | Thông báo theo **tài khoản** thay vì theo trình duyệt: đổi máy vẫn còn, và **tắt tab vẫn nhận được tin** — đúng lúc cần nhất. Schema + trigger + RLS **đã viết sẵn** trong `supabase/schema.sql`; chỉ cần thay 4 hàm `load*/save*` trong `src/lib/watch.js` | Vừa (SQL đã xong, chỉ nối frontend) | 2 triệu tin realtime/tháng, 200 kết nối đồng thời. Việc **gộp tin phải chạy trong Postgres** (trần 10 ms CPU ở Function). Chốt trước: bỏ công tắc `auto`? prefs xuống DB? |
| 9 | **Gửi thông báo ra ngoài: Telegram bot hoặc Discord webhook** | Người dùng nhận tin khi **không mở web** — đây mới là lý do thật của cả tính năng theo dõi | Vừa | Cả hai **miễn phí thật**, không giới hạn thực tế. Ưu điểm lớn: **không cần thu email** → không vướng quyền riêng tư, không cần form đăng ký |
| 10 | **Chuyển bộ đếm lá chắn từ KV sang D1** | Gỡ đúng cái trần chặt nhất (1.000 ghi/ngày → 100.000 ghi/ngày) | Vừa | D1 free: 5 GB, 5 triệu lượt đọc dòng/ngày, 100.000 lượt ghi dòng/ngày |
| 11 | **Trang lưu trữ "đã làm"** (mỗi bài một trang, hoặc một trang theo tháng) | SEO: mỗi video thành một trang trả lời *"Chaereve đã làm bài X chưa?"*; cũng là bằng chứng cho người mới thấy kênh làm thật | Vừa–lớn | 20.000 file/deploy — vài trăm bài thì thoải mái |
| 12 | **RSS/JSON feed "vừa lên sóng"** | Người hâm mộ cắm vào app đọc tin của họ; không tốn gì | Vừa | Một Pages Function trả XML nằm trong 100.000 request/ngày, hoặc sinh tĩnh lúc build |
| 13 | **Hợp nhất cụm trùng ở tầng dữ liệu (admin)** | Dọn gốc rễ của việc farm vote và của dữ liệu bẩn | Vừa | Không. Cân nhắc: mất lịch sử vote từng dòng |
| 14 | **Nhập hàng loạt từ bình luận (admin dán text)** | Chủ kênh dán một đoạn bình luận có 20 tên bài → thành 20 dòng request chờ duyệt. Dạng "sửa cả danh sách một lượt" đã có tiền lệ cho media | Vừa | Không |
| 15 | **PWA cài được lên màn hình chính** | Mở như app, có icon riêng. Manifest đã có sẵn | Vừa (thêm service worker) | Không tốn tiền, nhưng **tăng diện bảo trì**: cache sai là người dùng kẹt ở bản cũ. Nếu làm thì chỉ precache vỏ app |

### C3. Để sau, hoặc chỉ khi có lý do

| # | Việc | Ghi chú |
|---|---|---|
| 16 | Bảng "top người gửi theo tháng" / mùa giải | Vui, nhưng khuyến khích đúng kiểu chạy đua số lượng mà bảng đang phải chống |
| 17 | Giao diện tiếng Việt | Từ điển `i18n.jsx` đã tách sẵn nên về mặt kỹ thuật là làm được, nhưng hiện app **cố ý** chỉ có tiếng Anh. Làm thì miễn phí, chỉ tốn công dịch và gấp đôi số chuỗi phải giữ |
| 18 | Phím tắt mở rộng (`j`/`k` di chuyển, `v` vote) | Miễn phí, hợp với người dùng bàn phím — nhưng số người dùng thật được lợi thì ít |
| 19 | Kiểm tra bằng trình đọc màn hình thật | Miễn phí. Đã có `aria-label` cho mọi nút, nhưng chỉ người dùng thật mới nói được còn vướng gì |
| 20 | Chế độ onboarding 3 bước cho người mới | Miễn phí; chỉ nên làm nếu thấy người mới bỏ đi ngay |

---

## D. Những thứ **KHÔNG** miễn phí — để bạn biết mà tránh

| Thứ | Giá | Ghi chú |
|---|---|---|
| **Supabase Pro** (backup tự động + không bị tạm dừng + 8 GB) | ~25 USD/tháng | Là lý do duy nhất để lên gói. Cách miễn phí để sống thiếu nó: `pg_dump` định kỳ + giữ cron chạy đều |
| **Vercel Hobby** | Miễn phí nhưng **cấm dùng cho mục đích sinh doanh thu** | App có bán vote → dùng là vi phạm điều khoản. Pro là 20 USD/tháng |
| **Durable Objects** (Cloudflare) | Chỉ có ở gói trả tiền | Đừng thiết kế tính năng nào dựa vào nó |
| **Email số lượng lớn** | SMTP có sẵn của Supabase chỉ dùng cho email xác thực | Cần email thật thì Resend free 3.000 thư/tháng (100/ngày) — nhưng Telegram/Discord webhook vừa miễn phí vừa không cần thu email |
| **Workers Paid** | 5 USD/tháng | Chỉ cần khi vượt 100.000 request/ngày hoặc 10 ms CPU — còn xa |
| **Lưu ảnh/video của chính mình** | — | Hiện ảnh bìa lấy thẳng từ `i.ytimg.com`, và đó là lựa chọn đúng: tự host là tự trả băng thông |

---

## E. Thứ tự đề xuất

1. **Sao lưu database** (C1-1) — trước mọi thứ khác. Miễn phí, làm trong vài phút, và là thứ duy nhất trong danh sách mà bỏ qua có thể mất dữ liệu thật.
2. **Ba việc rẻ ở C1** — ước lượng thời gian chờ, CTA lúc "còn 2 vote", tìm kiếm không dấu.
3. **Nối database cho theo dõi + gửi ra Telegram/Discord** (C2-8, C2-9) — giá trị lớn nhất còn lại, và lý do duy nhất cần bạn chốt ba quyết định.
4. **Gỡ trần KV bằng D1** (C2-10) — làm trước khi lượng vote chạm ~500/ngày, không phải sau.

**Ba câu hỏi cần bạn trả lời để tôi làm được bước 3:** (a) trigger có tự theo dõi bài của mình và bỏ hẳn công tắc `auto` không; (b) bốn công tắc thông báo có chuyển xuống database không; (c) gửi ra ngoài bằng **Telegram** hay **Discord** (hoặc cả hai).
