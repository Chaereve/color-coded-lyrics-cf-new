# Gói 4 — Nhờ thiết kế một màn/khối mới theo đúng ngôn ngữ hiện có

Dùng khi muốn: làm lại trang bán vote, màn Daily Spin, khối "đang thực hiện", trang hồ sơ… đẹp hơn
mà **không phá hệ thống thị giác** đang có.

**Gửi gì:** dán file này + đính kèm: 2 ảnh chụp màn hình hiện tại (trong `kem-theo/`),
bản trích CSS, `src/lib/meta.js`, và **1 skill** phù hợp nhất (mặc định gửi skill 16 nếu là trang bán).

---

## BỐI CẢNH DỰ ÁN

Web `chaereve.pages.dev` — bảng yêu cầu video colour-coded lyrics (fanpage YouTube @chaereve).
Người dùng đăng nhập Google, gửi yêu cầu video, vote, theo dõi bài, mua thêm vote.
Có màn Daily Spin (vòng quay thưởng), bảng xếp hạng, hồ sơ cá nhân, và bảng admin.

**Stack:** React 19 + Vite 8 + **CSS thuần, một file `src/index.css`** (139 KB).
Không Tailwind, không CSS-in-JS, không thư viện UI, **không canvas/WebGL** (repo cố ý tránh để
không tốn GPU: cố ý từ chối `filter: blur()` trên lớp fixed, không dùng `height: 100dvh`).

## NGÔN NGỮ THỊ GIÁC ĐANG CÓ — BẮT BUỘC GIỮ

**Màu** (token trong `:root`, không được thêm màu mới ngoài các nhóm này):

| Nhóm | Token |
|---|---|
| Nền | `--bg #0d0f12` · `--bg-2` · `--surface` · `--surface-2` · `--surface-3` |
| Chữ | `--txt #e4e7ea` · `--txt-2` · `--txt-3` |
| Nhấn | `--a #2b22e2` (nền nút có chữ trắng) · `--a-2 #8782fa` (chữ/icon) · `--a-dim` · `--a-soft` · `--a-glow` |
| Trạng thái | `--pending --queued --progress --done --denied --paid` |
| Loại video | `--k-ccl --k-album --k-loop --k-short` |
| Kính | `--panel rgba(19,22,27,.94)` (khối phẳng) · `--float rgba(16,19,24,.97)` (lớp nổi) · `--glass blur(16px) saturate(140%)` |

**Chữ:** `--display` = Archivo Display (chỉ 700, dùng cho tiêu đề/logo) · `--font` = Be Vietnam Pro
(thân) · `--mono` = JetBrains Mono (số liệu, mã, nhãn nhỏ).

**Góc bo — MỘT thang duy nhất, dùng biến, đừng gõ số:**
`--r-sm: 4px` (badge/chip) · `--radius: 6px` (input, nút, ô nhỏ) · `--r-md: 8px` (khối: danh sách,
thống kê, card) · `--r-lg: 12px` (lớp nổi: modal, hộp đăng nhập) · `--r-xl: 16px` (logo splash) ·
`--r-pill: 999px`.

**Bóng:** chỉ 3 mức `--sh-1` `--sh-2` `--sh-3`, cộng `--ring` (viền trong mờ 1px).
**Chuyển động:** `--e-out` (vào) · `--e-soft` (đổi màu/viền) · `--e-pop` (nảy nhẹ, modal/nút phát);
thời gian `--t-1 .16s` (micro) · `--t-2 .28s` (đổi trạng thái) · `--t-3 .42s` (khối vào).
Chỉ animate `opacity` + `transform`.

## LUẬT (vi phạm là bị từ chối)

1. **Màu/góc bo/thời gian chỉ qua token.** Thêm token mới thì phải dùng nó (có test bắt lỗi).
2. **Không viết `-webkit-backdrop-filter` bằng tay** — lightningcss của Vite 8 coi nó và
   `backdrop-filter` là một thuộc tính, chỉ giữ cái đứng sau và **xoá bản chuẩn** → Firefox mất
   sạch lớp kính (lỗi thật đã xảy ra ở 16 chỗ trong repo này).
3. **Kính có 2 mức thôi** (`--panel` cho khối phẳng, `--float` cho lớp nổi). Đừng tạo mức thứ ba
   `.82` `.86` — đó chính là lý do trước đây hai khối cạnh nhau trông lệch màu.
4. **Vạch accent nằm TRONG khối**, không dùng `border-left` (viền + bo góc làm hai đầu vạch bị vát).
5. **Lớp phủ khi hover trong khối kính phải là màu trắng trong suốt** (`--hover` / `--hover-2`),
   **không** dùng `--surface-*` đặc (nền đặc tô lên khối trong suốt hiện thành ô sáng lệch tông).
6. **Vùng cuộn trong flex cột phải có `min-height: 0`** (test `cssScroll` quét toàn bộ rule
   `overflow-y:auto|scroll` + `flex:1`).
7. Mọi hiệu ứng phải có nhánh `prefers-reduced-motion`; hiệu ứng hover phải có nhánh `@media (hover: none)`.
8. Không thêm thư viện UI, không thêm WebGL/canvas, không dùng `backdrop-filter` cho từng hàng
   của bảng (mỗi hàng là một lớp compositing → tụt khung hình trên máy yếu).

## VIỆC CẦN LÀM

> **Sửa dòng này cho khớp việc của bạn, rồi gửi:**
> *Thiết kế lại **[khối "đang thực hiện" `.nowbar` / trang bán vote `.paytile`+`.pack` / màn Daily Spin]**.
> Hiện tại nó **[vấn đề: chưa nổi bật / khó hiểu khi mua / rối trên điện thoại]**.
> Tôi muốn **[mục tiêu cụ thể: nhìn ra ngay đang làm bài gì và còn bao lâu / làm rõ 3 gói vote và
> lợi ích / khiến vòng quay đáng chờ]**.*

## ĐỊNH DẠNG TRẢ LỜI MONG MUỐN

Trả lời **đúng 5 mục, theo thứ tự**, không viết lan:

1. **Direction card 8 dòng** — luận điểm thị giác (một câu), ảnh/khối chủ đạo, thang chữ,
   hệ màu (chỉ token có sẵn), thứ tự khối, nhịp chuyển động, và **những gì tôi phải bỏ đi**.
2. **Cây JSX** — chỉ tên thẻ + `className` (dùng đúng class đang có nếu tái dùng được,
   class mới thì đặt tên theo tiền tố sẵn có: `.nowbar`, `.pay-*`, `.pack`, `.spin-*`).
   Không viết code React đầy đủ.
3. **CSS** — đoạn CSS thuần, **chỉ dùng token trong danh sách trên**, kèm comment tiếng Việt
   giải thích *vì sao* chọn từng con số (giọng giống comment trong file CSS đính kèm).
4. **Nhánh bắt buộc** — khối `@media (prefers-reduced-motion: reduce)` và `@media (hover: none)`
   cho phần mới; và nhánh `@media (max-width: 899px)` cho bản hẹp.
5. **Tự soát** — bảng 6 dòng: mỗi luật ở mục LUẬT phía trên, bạn đã theo thế nào (hoặc chỗ nào
   cố ý phá và vì sao).

Nếu thiếu thông tin (ví dụ chưa biết nội dung thật của khối), **hỏi tôi trước** — đừng đoán.
