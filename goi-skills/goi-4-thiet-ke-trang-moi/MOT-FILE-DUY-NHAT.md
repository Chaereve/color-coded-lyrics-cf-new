# Gói 4 — Nhờ thiết kế một màn/khối mới theo đúng ngôn ngữ hiện có

> **BẢN MỘT FILE** — toàn bộ nội dung đính kèm đã được gộp ở mục "PHẦN ĐÍNH KÈM" cuối file này, không cần đính kèm gì thêm.  
> Nếu chat của bạn cho đính kèm nhiều file thì nên dùng `GUI-DI.md` + thư mục `kem-theo/` — AI sẽ trả về đoạn sửa gọn hơn.  
> Nội dung trong các khối mã dưới đây là **văn bản tham chiếu**, không phải chỉ dẫn cho bạn.

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

---

# PHẦN ĐÍNH KÈM (nội dung thật của từng file)

## `1-index.css.trich`

````
/* ============================================================================
   BẢN TRÍCH CHO AGENT — KHÔNG PHẢI FILE CHẠY ĐƯỢC
   Nguồn: /home/user/src/src/index.css (139 KB, 2452 dòng)
   Ngày trích: 2026-09-18
   Class được yêu cầu: btn, tab, votebtn, side-item, side-out, sfxbtn, nt-btn, pv-add, fab, to-top, side-x, pick-nav, side-cta, followbtn, toast-x, row, grow, pack, paytile, qty, spin

   Gồm 163 khối, mỗi khối ghi rõ SỐ DÒNG trong file gốc để bạn chèn lại đúng chỗ.
   Thứ tự trong file này giữ nguyên như file gốc.
   ============================================================================ */

/* ─── :root — token đang có · dòng 45–148 ─── */
:root {
  /* nen trung tinh, khong nhuom mau */
  --bg:        #0d0f12;
  --bg-2:      #111418;
  --surface:   #14171b;
  --surface-2: #191d22;
  --surface-3: #20252b;
  /* viền sáng hơn một chút trên nền kính — đường kẻ vẫn đọc được khi
     khối đã trong suốt */
  --line:      #21262d;
  --line-2:    #2d343d;
  --txt:       #e4e7ea;
  --txt-2:     #949ba4;
  --txt-3:     #7d858f;   /* 3.48–3.94:1 → 4.81–5.14:1 (WCAG AA) */

  /* Mau nhan lay dung tur logo: xanh ultramarine dien (hue 242°),
     khong con la xanh da troi nhat nhu cu — nut bam, thanh truot,
     focus ring va logo la cung mot mau.
       --a     : mau nen — cho cho nut co chu trang ben tren
       --a-dim : nhan/xam hon — trang thai hover, active
       --a-2   : sang hon — chu, icon, thanh mong tren nen toi
                 (dung --a nguyen ban cho chu tren nen toi bi thap tuong phan)
       --a-soft: lot nhat cho nen khoi selection
       --a-glow: bong to nhe, chi dung cho nut nhan va vach truot sidebar */
  --a:      #2b22e2;
  --a-dim:  #211aad;
  --a-2:    #8782fa;
  --a-soft: rgba(43,34,226,.14);
  --a-glow: rgba(43,34,226,.45);

  /* mau trang thai — chi dung cho cham tron nho */
  --pending:  #7b838d;
  --queued:   #7a7ff8;
  --progress: #d3a03a;
  --done:     #4fa97a;
  --denied:   #d0605c;
  /* chỉ dùng cho NỀN có chữ trắng bên trên (badge số thông báo):
     --denied là màu CHỮ trạng thái (5.04:1 trên nền tối) nên không hạ
     được — hạ xuống là chữ "Denied" mất chuẩn AA; còn để nguyên thì
     chữ trắng trên badge chỉ đạt 3.81:1 */
  --denied-solid: #b8504a;   /* nền badge: chữ trắng đạt 4.90:1 */
  --paid:     #c99a3c;

  /* loai request */
  --k-ccl:   #9b7fd4;
  --k-album: #4a9c9c;
  --k-loop:  #c47f52;
  --k-short: #c2688f;

  /* mặt kính: nền tối + blur phía sau.  Ban to (stats, danh sách, modal,
     sidebar) dùng bản trong suốt này để vệt gradient của nền lọt nhẹ qua,
     chi tiết nhỏ (input, badge) giữ màu đặc cho chữ tương phản.
     MỘT mức mờ duy nhất (--panel) cho mọi khối liền nhau: chỗ thì .72 chỗ
     thì .82 là lý do vì sao đặt hai khối cạnh nhau thấy lệch màu ngay. */
  /* lớp NỔI (modal, toast, gate, sidebar) đặc hơn khối phẳng một chút để
     chữ không chìm vào nền — nhưng chỉ MỘT cặp màu, không phải mỗi chỗ
     một giá trị 14/16/18 lẻ mành như trước */
  /* Độ đục đã được nâng lên: bản cũ (.8 / .72 / .66) để lọt quá nhiều nền
     nên chữ trong khung bị "trôi" trên vệt gradient, và hai khung chồng
     nhau thì cộng dồn thành một mảng màu lạ. Giữ nguyên hiệu ứng kính,
     chỉ đặc thêm để nội dung bám nền. */
  --float:     rgba(16,19,24,.97);
  --float-2:   rgba(14,17,21,.96);
  --panel:     rgba(19,22,27,.94);
  --panel-2:   rgba(25,29,35,.92);
  --panel-3:   rgba(33,38,45,.9);
  --glass:     blur(16px) saturate(140%);
  --glass-sm:  blur(9px) saturate(130%);

  /* màu phủ khi rê/đang chọn, dùng trong khối kính — nền đặc sẽ hiện
     thành một ô sáng lệch tông với khối */
  --hover:     rgba(255,255,255,.038);
  --hover-2:   rgba(255,255,255,.06);

  /* thang góc bo: control nhỏ 6, khối 8, nổi/modal 12, logo splash 16.
     Trước đây 3/5/6/7/8/10/12/14 lẫn lộn nên nhìn kỹ là thấy "lệch tay". */
  --r-sm: 4px;
  --r-pill: 999px;
  --radius: 6px;
  --r-md: 8px;
  --r-lg: 12px;
  --r-xl: 16px;

  /* bóng: một bộ duy nhất, càng cao càng loãng */
  --sh-1: 0 1px 2px rgba(0,0,0,.45);
  --sh-2: 0 10px 30px -14px rgba(0,0,0,.7);
  --sh-3: 0 26px 64px -22px rgba(0,0,0,.78);
  --ring: inset 0 1px 0 rgba(255,255,255,.045), inset 0 0 0 1px rgba(255,255,255,.03);

  --font:    'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --mono:    'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --display: 'Archivo Display', 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, sans-serif;

  /* Chuyển động — một bộ easing dùng chung cho cả trang, không chỗ nào tự chế.
     Chỉ animate opacity/transform (GPU lo, không gây layout lại giữa chừng). */
  --e-out:  cubic-bezier(.22,.61,.36,1);    /* vào: nhanh rồi hãm dần */
  --e-soft: cubic-bezier(.4,0,.2,1);        /* đổi màu nền, viền */
  --e-pop:  cubic-bezier(.34,1.24,.64,1);   /* nảy nhẹ — modal, nút phát */
  --t-1: .16s;
  --t-2: .28s;
  --t-3: .42s;
}

/* ─── @supports — nhánh dự phòng · dòng 220–229 ─── */
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .splash-title {
    background: linear-gradient(100deg, var(--txt) 20%, #fff 38%, var(--a-2) 50%, var(--txt) 66%, var(--txt) 100%);
    background-size: 260% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: rise .5s var(--e-out) .18s both, shine 2.1s var(--e-soft) .5s 2 both;
  }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 283–291 ─── */
.btn {
  position: relative; overflow: hidden;
  padding: 6px 11px; border-radius: var(--radius); cursor: pointer;
  border: 1px solid var(--line-2); background: var(--surface-2);
  color: var(--txt); font-size: 13px; font-weight: 500; transition: .13s; white-space: nowrap;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 291–292 ─── */
.btn:hover { border-color: #3c4550; background: var(--surface-3); }

/* ─── rule hiện tại của control được yêu cầu · dòng 301–302 ─── */
.btn:disabled { opacity: .45; cursor: not-allowed; }

/* ─── rule hiện tại của control được yêu cầu · dòng 314–320 ─── */
.sfxbtn {
  flex: 0 0 auto; width: 26px; height: 26px; display: grid; place-items: center;
  border: 1px solid var(--line-2); border-radius: var(--radius);
  background: none; color: var(--txt-3); cursor: pointer; transition: .13s;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 320–321 ─── */
.sfxbtn:hover { color: var(--txt); border-color: #3c4550; }

/* ─── rule hiện tại của control được yêu cầu · dòng 321–322 ─── */
.sfxbtn[aria-pressed="true"] { color: var(--txt-2); }

/* ─── rule hiện tại của control được yêu cầu · dòng 369–370 ─── */
.tabs .tab + .tab { border-left: 1px solid var(--line) }

/* ─── rule hiện tại của control được yêu cầu · dòng 370–375 ─── */
.tab {
  position: relative;
  padding: 5px 10px; border: 0; cursor: pointer; background: none;
  color: var(--txt-2); font-size: 12.5px; font-family: inherit; transition: .13s;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 375–376 ─── */
.tab:hover { color: var(--txt); background: var(--hover); }

/* ─── rule hiện tại của control được yêu cầu · dòng 376–382 ─── */
/* gạch dưới tab TRƯỢT ra từ giữa thay vì bật tắt — đổi bộ lọc có nhịp */
.tab::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px;
  border-radius: 2px 2px 0 0; background: var(--a-2);
  transform: scaleX(0); transition: transform .26s var(--e-out);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 382–383 ─── */
.tab.on { color: var(--txt); background: var(--hover-2); font-weight: 600; }

/* ─── rule hiện tại của control được yêu cầu · dòng 383–384 ─── */
.tab.on::after { transform: scaleX(1); }

/* ─── rule hiện tại của control được yêu cầu · dòng 384–385 ─── */
.tab .n { margin-left: 5px; font-family: var(--mono); font-size: 11px; color: var(--txt-3); }

/* ─── rule hiện tại của control được yêu cầu · dòng 385–386 ─── */
.tab.on .n { color: var(--txt-2); }

/* ─── rule hiện tại của control được yêu cầu · dòng 386–401 ─── */
/* HỘP NHẬP — chỉ áp cho control nhập CHỮ. Để nguyên `input` trần là lỗi:
   checkbox và range kế `padding: 7px 10px` + viền + nền của ô text, nên cái ô
   tick hiện thành một hộp xám TO HƠN chữ bên cạnh — đúng hình dạng của `.switch`
   (ActionModal: "đây là yêu cầu trả phí", MediaAdmin: "ẩn khỏi trang chủ") và
   `.step` (3 mốc tiến độ của AdminPanel) trước khi sửa.
   Toàn bộ phân loại nằm TRONG `:where()`: đặc tính của cả selector vẫn bằng
   `input` trần (0,0,1) để quy tắc cục bộ (`.nt-pref input`, `.qty input`) còn đè
   được — viết `:not()` thuận sẽ nâng đặc tính lên 0,6,1 và tự tay làm vô hiệu
   chính những quy tắc reset mà các popover đã phải viết. */
input:where(:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], [hidden])), select, textarea {
  width: 100%; padding: 7px 10px; border-radius: var(--radius);
  border: 1px solid var(--line-2); background: var(--bg-2); color: var(--txt);
  font-family: inherit; font-size: 13px; transition: border-color .13s;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 422–424 ─── */
.row { position: relative; display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--line);
  transition: background var(--t-1) var(--e-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 424–425 ─── */
.row:last-child { border-bottom: 0; }

/* ─── rule hiện tại của control được yêu cầu · dòng 425–430 ─── */
/* vạch màu trạng thái chạy dọc mép trái, lớn dần từ tâm — hover có lý do
   chứ không chỉ đổi màu nền */
.row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--sc, var(--a)); transform: scaleY(0); transform-origin: 50% 50%;
  transition: transform .3s var(--e-out); }

/* ─── rule hiện tại của control được yêu cầu · dòng 430–431 ─── */
.row:hover { background: var(--hover); }

/* ─── rule hiện tại của control được yêu cầu · dòng 431–432 ─── */
.row:hover::before { transform: scaleY(1); }

/* ─── rule hiện tại của control được yêu cầu · dòng 432–433 ─── */
.row.paid { background: rgba(201,154,60,.045); }

/* ─── rule hiện tại của control được yêu cầu · dòng 433–434 ─── */
.row .idx { width: 20px; flex: none; text-align: right; font-family: var(--mono); font-size: 12px; color: var(--txt-3); }

/* ─── rule hiện tại của control được yêu cầu · dòng 434–435 ─── */
.row .body { flex: 1; min-width: 0; }

/* ─── rule hiện tại của control được yêu cầu · dòng 435–436 ─── */
.row .title { font-size: 14px; font-weight: 500; margin-bottom: 3px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 436–437 ─── */
.row .title .artist { color: var(--txt-2); font-weight: 400; }

/* ─── rule hiện tại của control được yêu cầu · dòng 463–468 ─── */
.votebtn .mine {
  font-family: var(--mono); font-style: normal; font-size: 10.5px;
  color: var(--a-2); padding-left: 2px;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 468–474 ─── */
.votebtn {
  position: relative; flex: none; display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: var(--radius); cursor: pointer;
  border: 1px solid var(--line-2); background: none; color: var(--txt-2);
  font-family: inherit; transition: .13s;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 474–475 ─── */
.votebtn:hover:not(:disabled) { border-color: var(--a-2); color: var(--txt); }

/* ─── rule hiện tại của control được yêu cầu · dòng 475–476 ─── */
.votebtn b { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--txt); }

/* ─── rule hiện tại của control được yêu cầu · dòng 476–477 ─── */
.votebtn span { font-size: 11.5px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 477–479 ─── */
.votebtn.on { border-color: var(--a-2); color: var(--a-2); background: var(--a-soft);
  box-shadow: 0 2px 12px -6px var(--a-glow); }

/* ─── rule hiện tại của control được yêu cầu · dòng 479–480 ─── */
.votebtn.on b { color: var(--a-2); }

/* ─── rule hiện tại của control được yêu cầu · dòng 480–481 ─── */
.votebtn:disabled { opacity: .4; cursor: not-allowed; }

/* ─── rule hiện tại của control được yêu cầu · dòng 481–483 ─── */
/* Up next: viền đứt để phân biệt "đã chốt, khỏi vote" với "chưa mở vote" */
.votebtn.locked { border-style: dashed; }

/* ─── rule hiện tại của control được yêu cầu · dòng 483–484 ─── */
.votebtn.locked:disabled { opacity: .55; }

/* ─── rule hiện tại của control được yêu cầu · dòng 493–503 ─── */
/* cụm request trùng bài — thẻ card riêng, nhìn là biết ngay đâu là cụm.
   Đầu cụm là một nút gập/mở: huy hiệu đếm + chip loại video, tên bài lớn,
   cột tổng vote, nút mũi tên tròn. Bấm là bung ra đủ request (mở/rút mượt). */
.grow { position: relative; margin: 10px 12px; border: 1px solid rgba(135,130,250,.35);
  border-radius: var(--r-md); overflow: hidden;
  background: linear-gradient(135deg, rgba(43,34,226,.16), rgba(43,34,226,.04) 55%, transparent),
    var(--surface);
  box-shadow: 0 8px 24px -18px var(--a-glow);
  transition: border-color var(--t-2) var(--e-soft), box-shadow var(--t-2) var(--e-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 503–504 ─── */
.list > .grow:first-child { margin-top: 12px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 504–505 ─── */
.list > .grow:last-child { margin-bottom: 12px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 505–506 ─── */
.grow:hover { border-color: rgba(135,130,250,.6); }

/* ─── rule hiện tại của control được yêu cầu · dòng 506–507 ─── */
.grow.open { border-color: var(--a-2); box-shadow: 0 10px 28px -16px var(--a-glow); }

/* ─── rule hiện tại của control được yêu cầu · dòng 548–549 ─── */
.grow.open .grow-rows { grid-template-rows: 1fr; }

/* ─── rule hiện tại của control được yêu cầu · dòng 549–550 ─── */
.grow.open .grow-rows-in { visibility: visible; transition-delay: 0s; }

/* ─── rule hiện tại của control được yêu cầu · dòng 550–551 ─── */
.grow-rows-in > .row { padding-left: 16px; padding-right: 14px; background: rgba(0,0,0,.22); }

/* ─── rule hiện tại của control được yêu cầu · dòng 551–552 ─── */
.grow-rows-in > .row:last-child { border-bottom: 0; }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 597–606 ─── */
@media (max-width: 620px) {
  .pager { gap: 8px; }
  .pager-nums { display: none; }
  .pager-of { display: inline; }
  .pager-btn-tx { display: none; }
  .pager-btn { padding: 6px 9px; }
  .pager-ctrl { margin-left: auto; }
}

/* ─── @media ràng buộc sẵn có · dòng 606–609 ─── */
@media (prefers-reduced-motion: reduce) {
  .pager { animation: none }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 651–656 ─── */
/* cùng kiểu gạch trượt của .tab — hai chỗ chọn lựa, một chuyển động */
.mtab::after {
  content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px;
  background: var(--a-2); transform: scaleX(0); transition: transform .26s var(--e-out);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 698–699 ─── */
.rules .btn { width: 100%; }

/* ─── rule hiện tại của control được yêu cầu · dòng 704–705 ─── */
.pack { position: relative; padding: 14px 12px; text-align: center; border: 1px solid var(--line-2); border-radius: var(--r-md); transition: border-color .13s; }

/* ─── rule hiện tại của control được yêu cầu · dòng 705–706 ─── */
.pack:hover { border-color: #3c4550; }

/* ─── rule hiện tại của control được yêu cầu · dòng 706–707 ─── */
.pack.best { border-color: rgba(201,154,60,.45); }

/* ─── rule hiện tại của control được yêu cầu · dòng 708–709 ─── */
.pack b { display: block; font-family: var(--mono); font-size: 22px; font-weight: 600; line-height: 1.1; }

/* ─── rule hiện tại của control được yêu cầu · dòng 709–710 ─── */
.pack .u { font-size: 11.5px; color: var(--txt-3); margin-bottom: 9px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 710–711 ─── */
.pack .p { font-family: var(--mono); font-size: 14px; font-weight: 600; }

/* ─── rule hiện tại của control được yêu cầu · dòng 711–712 ─── */
.pack .p small { display: block; font-size: 11.5px; font-weight: 400; color: var(--txt-3); margin-top: 2px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 719–720 ─── */
.qty { display: flex; align-items: center; border: 1px solid var(--line-2); border-radius: var(--radius); overflow: hidden; }

/* ─── rule hiện tại của control được yêu cầu · dòng 720–721 ─── */
.qty button { width: 28px; height: 28px; border: 0; background: var(--surface-2); color: var(--txt-2); cursor: pointer; font-size: 14px; font-family: inherit; }

/* ─── rule hiện tại của control được yêu cầu · dòng 721–722 ─── */
.qty button:hover { background: var(--hover-2); color: var(--txt); }

/* ─── rule hiện tại của control được yêu cầu · dòng 722–723 ─── */
.qty input { width: 46px; border: 0; border-radius: 0; text-align: center; background: none; padding: 5px 0; font-family: var(--mono); font-size: 13px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 723–724 ─── */
.qty input:focus { outline: none; }

/* ─── rule hiện tại của control được yêu cầu · dòng 724–725 ─── */
.qty input::-webkit-outer-spin-button, .qty input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

/* ─── rule hiện tại của control được yêu cầu · dòng 825–826 ─── */
.inline-form .btn { flex: 0 0 auto; }

/* ─── rule hiện tại của control được yêu cầu · dòng 881–887 ─── */
.paytile {
  position: relative; cursor: pointer; overflow: hidden;
  display: grid; place-items: center; height: 50px; padding: 8px 10px;
  background: #fff; border: 1px solid #d8dee6; border-radius: var(--radius);
  transition: border-color .13s;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 887–888 ─── */
.paytile:hover { border-color: #9fb0c4; }

/* ─── rule hiện tại của control được yêu cầu · dòng 889–890 ─── */
.paytile.bank   .paytile-logo { height: 18px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 890–891 ─── */
.paytile.paypal .paytile-logo { height: 16px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 891–892 ─── */
.paytile.on { border-color: var(--tc); }

/* ─── rule hiện tại của control được yêu cầu · dòng 892–893 ─── */
.paytile.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--tc); }

/* ─── rule hiện tại của control được yêu cầu · dòng 893–894 ─── */
.paytile.bank   { --tc: #ed2132; }

/* ─── rule hiện tại của control được yêu cầu · dòng 894–895 ─── */
.paytile.paypal { --tc: #003087; }

/* ─── rule hiện tại của control được yêu cầu · dòng 975–982 ─── */
/* nút: nhấc lên 1px khi rê, ấn xuống nhẹ khi bấm — cảm giác có phản hồi */
.btn, .tab, .votebtn, .kbtn, .copy, .icon-btn, .sfxbtn, .mtab,
.side-item, .side-row, .side-user, .pvrow {
  transition: background var(--t-1) var(--e-soft), border-color var(--t-1) var(--e-soft),
              color var(--t-1) var(--e-soft), transform var(--t-1) var(--e-out);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 982–983 ─── */
.btn:hover:not(:disabled) { transform: translateY(-1.5px); }

/* ─── rule hiện tại của control được yêu cầu · dòng 983–984 ─── */
.btn:active:not(:disabled) { transform: translateY(0) scale(.97); }

/* ─── rule hiện tại của control được yêu cầu · dòng 988–989 ─── */
.votebtn:hover:not(:disabled) { transform: translateY(-1px); }

/* ─── rule hiện tại của control được yêu cầu · dòng 989–990 ─── */
.votebtn:active:not(:disabled) { transform: scale(.97); }

/* ─── @supports — nhánh dự phòng · dòng 1002–1010 ─── */
@supports (backdrop-filter: blur(4px)) {
  .overlay { background: rgba(6,7,9,.6); backdrop-filter: blur(7px) saturate(120%);
    transition: backdrop-filter .3s var(--e-soft), background-color .3s var(--e-soft) }
  .overlay.out { backdrop-filter: blur(0px); background-color: rgba(6,7,9,0) }
  @starting-style {
    .overlay { backdrop-filter: blur(0px) saturate(100%); background: rgba(6,7,9,0) }
  }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1147–1156 ─── */
/* nút ☰ nằm trong header nội dung, chỉ bản hẹp mới hiện */
.fab {
  flex: none; width: 34px; height: 34px; cursor: pointer;
  display: grid; place-content: center; gap: 4px;
  border: 1px solid var(--line-2); border-radius: var(--radius);
  background: var(--surface-2);
  transition: background var(--t-1) var(--e-soft), border-color var(--t-1) var(--e-soft);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1156–1157 ─── */
.fab:hover { background: var(--surface-3); border-color: #3c4550; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1157–1158 ─── */
.fab span { display: block; width: 15px; height: 1.5px; border-radius: 2px; background: var(--txt); }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 1159–1164 ─── */
@media (max-width: 899px) {
  .only-narrow { display: flex; }
  /* hai class nên đè được .only-narrow ở trên, giữ bố cục lưới của nút */
  .fab.only-narrow { display: grid; }
}

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 1182–1190 ─── */
@media (max-width: 899px) {
  /* bản hẹp: ngăn kéo trượt vào, visibility để nút bên trong rơi khỏi thứ tự Tab */
  .side { position: fixed; top: 0; bottom: 0; left: 0; width: min(288px, 86vw);
    box-shadow: 18px 0 48px rgba(0,0,0,.45);
    transform: translateX(-101%); visibility: hidden;
    transition: transform var(--t-3) var(--e-out), visibility 0s linear var(--t-3); }
  .side.open { transform: none; visibility: visible; transition-delay: 0s; }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1219–1221 ─── */
.side-x { flex: none; width: 28px; height: 28px; border: 0; border-radius: var(--radius);
  background: none; color: var(--txt-3); font-size: 19px; line-height: 1; cursor: pointer; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1221–1222 ─── */
.side-x:hover { color: var(--txt); background: var(--hover); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1229–1239 ─── */
/* ---- nút Gửi request ---- */
.side-cta {
  width: 100%; height: 38px; display: flex; align-items: center; gap: var(--side-gap);
  padding: 0 var(--side-ix); margin-bottom: 16px; cursor: pointer;
  border: 1px solid var(--a); border-radius: var(--r-md);
  background: var(--a); color: #fff; font-family: inherit; font-size: 13px; font-weight: 600;
  letter-spacing: .1px; box-shadow: 0 2px 12px -7px var(--a-glow);
  transition: background var(--t-1) var(--e-soft), transform var(--t-1) var(--e-out), box-shadow var(--t-2) var(--e-soft);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1239–1240 ─── */
.side-cta .sico { opacity: 1; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1240–1241 ─── */
.side-cta:hover { background: var(--a-dim); border-color: var(--a-dim); transform: translateY(-1px); box-shadow: 0 6px 16px -6px var(--a-glow); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1241–1242 ─── */
.side-cta:active { transform: scale(.985); box-shadow: none; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1265–1275 ─── */
.side-item {
  position: relative; z-index: 1; display: flex; align-items: center; gap: var(--side-gap); width: 100%;
  height: 36px; padding: 0 var(--side-ix); border: 0; border-radius: var(--radius);
  background: none; cursor: pointer; color: var(--txt-2); text-decoration: none;
  font-family: inherit; font-size: 13.5px; font-weight: 500; letter-spacing: .1px; text-align: left;
  animation: sideIn .42s var(--e-out) both; animation-delay: calc(60ms + var(--i, 0) * 45ms);
  transition: background var(--t-1) var(--e-soft), color var(--t-1) var(--e-soft),
              transform var(--t-2) var(--e-out);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1276–1277 ─── */
.side-item:hover { background: var(--hover); color: var(--txt); transform: translateX(3px); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1277–1278 ─── */
.side-item.on { color: var(--txt); font-weight: 600; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1278–1279 ─── */
.side-item.on:hover { background: none; transform: none; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1279–1280 ─── */
.side-item:active { transform: scale(.98); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1280–1281 ─── */
.side-item .side-tx { flex: 1; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1284–1285 ─── */
.side-item.on .side-n { color: var(--a-2); background: var(--a-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1286–1287 ─── */
.side-item:hover .side-ext { color: var(--a-2); transform: translate(2px, -2px); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1290–1291 ─── */
.side-item .sico, .side-out .sico, .side-cta .sico { width: 20px; height: 20px; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1291–1292 ─── */
.side-item.on .sico, .side-item:hover .sico { opacity: 1; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1292–1293 ─── */
.side-item.on .sico { color: var(--a-2); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1293–1294 ─── */
.side-item:hover .sico { transform: scale(1.12); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1294–1296 ─── */
.side-item .dotbadge { transition: opacity .15s var(--e-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1304–1305 ─── */
.side-row .sfxbtn { flex: none; transition: opacity .15s var(--e-soft), border-color var(--t-1) var(--e-soft), color var(--t-1) var(--e-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1319–1323 ─── */
.side-out { display: flex; align-items: center; gap: var(--side-gap); width: 100%; height: 34px; margin-top: 2px;
  padding: 0 var(--side-ix); border: 0; border-radius: var(--radius); background: none; cursor: pointer;
  color: var(--txt-3); font-family: inherit; font-size: 13px; text-align: left;
  transition: color var(--t-1) var(--e-soft), background var(--t-1) var(--e-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1323–1324 ─── */
.side-out:hover { color: var(--denied); background: rgba(208,96,92,.08); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1324–1325 ─── */
.side-out:hover .sico { opacity: 1; transform: translateX(2px); }

/* ─── rule hiện tại của control được yêu cầu · dòng 1415–1430 ─── */
/* ---- hai nút qua lại giữa các video ----
   Tròn, mờ kính như .pick-flag, đè lên hai mép sân khấu. To hơn mức cần
   một chút vì trên điện thoại đây là nút chạm chính để xem hết danh sách. */
.pick-nav {
  position: absolute; top: 50%; z-index: 4;
  width: 44px; height: 44px; margin-top: -22px; padding: 0;
  display: grid; place-items: center; cursor: pointer;
  border-radius: 50%; color: #fff;
  background: rgba(13,15,18,.78); border: 1px solid rgba(255,255,255,.34);
  backdrop-filter: blur(3px);
  box-shadow: 0 6px 18px -8px rgba(0,0,0,.8);
  transition: background var(--t-1) var(--e-soft), border-color var(--t-1) var(--e-soft),
              transform var(--t-1) var(--e-out), opacity var(--t-1) var(--e-soft);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1430–1431 ─── */
.pick-nav.prev { left: 10px }

/* ─── rule hiện tại của control được yêu cầu · dòng 1431–1432 ─── */
.pick-nav.next { right: 10px }

/* ─── rule hiện tại của control được yêu cầu · dòng 1432–1433 ─── */
.pick-nav:hover { background: var(--a); border-color: transparent; transform: scale(1.06) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1433–1434 ─── */
.pick-nav:active { transform: scale(.94) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1490–1494 ─── */
/* nút thêm video ngay trên nhãn dải — admin thấy, người thường không */
.pv-add { margin-left: auto; border: 1px solid var(--line-2); background: var(--a-soft);
  color: var(--a-2); border-radius: var(--r-sm); padding: 2px 9px; font-size: 11px;
  font-weight: 600; cursor: pointer; transition: .15s; }

/* ─── rule hiện tại của control được yêu cầu · dòng 1494–1495 ─── */
.pv-add:hover { background: var(--a); color: #fff; border-color: transparent; }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 1540–1551 ─── */
@media (max-width: 620px) {
  .main { padding: 18px 14px 44px; }
  .mainhead { align-items: center; gap: 9px; }
  .mainhead-t { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .votepanel { gap: 14px; }
  .vp-divider { display: none; }
  .vp-acts { margin-left: 0; width: 100%; }
  .vp-acts .btn { flex: 1; text-align: center; }
  .pvrow { flex-basis: 158px; }
}

/* ─── @media ràng buộc sẵn có · dòng 1574–1612 ─── */
@media (hover: none) {
  /* Do not let sticky emulated :hover states move the page after tapping. */
  .btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--line-2); color: var(--txt); }
  .btn-primary:hover:not(:disabled) { background: var(--a); border-color: var(--a); color: #fff; }
  .btn-gold:hover:not(:disabled) { background: none; border-color: var(--paid); color: var(--paid); }
  .votebtn:hover:not(:disabled) { background: none; border-color: var(--line-2); color: var(--txt-2); }
  .votebtn.on:hover:not(:disabled) { background: var(--a-soft); border-color: var(--a-2); color: var(--a-2); }
  .icon-btn:hover:not(:disabled) { color: var(--txt-3); border-color: transparent; }
  .side-item:hover, .side-cta:hover, .pick-stage:hover, .pvrow:hover, .pick-nav:hover,
  .side-user:hover { transform: none; }
  .side-item:hover { background: none; color: var(--txt-2); }
  .side-item.on:hover { color: var(--txt); }
  .side-item:hover .sico, .side-out:hover .sico { transform: none; }
  .side-cta:hover { background: var(--a); border-color: var(--a); box-shadow: none; }
  .side-out:hover { background: none; color: var(--txt-3); }
  .side-user:hover { background: none; }
  .pick-stage:hover { box-shadow: none; transform: none; }
  /* cảm ứng không có hover thật: nút qua lại giữ nguyên sắc lìa, chỉ sáng nhẹ khi bấm */
  .pick-nav:hover { background: rgba(13,15,18,.72); border-color: rgba(255,255,255,.22); transform: none }
  /* không có chuột thì không có hover để bật quầng sáng — để sẵn mức giữa */
  .pick-stage::before { opacity: .68; }
  .pick-stage:hover::before { opacity: .68; }
  .pick-stage:hover::after { box-shadow: inset 0 0 0 1px rgba(135,130,250,.22), inset 0 1px 0 rgba(255,255,255,.06); }
  .pick-stage:hover .mthumb > img, .pvrow:hover .mthumb > img { transform: none; }
  .pick-stage:hover .playbtn { transform: none; background: rgba(13,15,18,.6); border-color: rgba(255,255,255,.28); }
  .pvrow:hover { background: var(--panel-2); border-color: var(--line); }
  .pvrow:hover .playbtn.sm { opacity: .92; transform: none; }
  .playbtn.sm { opacity: .92; transform: none; }
  .side-user:hover .avatar { transform: none; }
  .playbtn, .pick-flag, .pick-nav { backdrop-filter: none; }
  /* hạt nhiễu phủ cả màn hình: tắt hẳn khi không có chuột cho nhẹ máy */
  .bgfx-grain { display: none; }
  /* ngăn kéo sidebar đặc luôn, khỏi blur theo từng khung trượt */
  .side { backdrop-filter: none; background: #0e1116; }
  /* modal mở là transient nhưng blur cả nền trên máy yếu vẫn khựng — giữ lớp tối */
  .overlay { backdrop-filter: none; }
}

/* ─── @supports — nhánh dự phòng · dòng 1726–1729 ─── */
@supports not (color: color-mix(in srgb, red 50%, blue)) {
  .toast-ico { background: var(--surface-3) }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 1740–1742 ─── */
.toast-x { width: 22px; height: 22px; border: 0; border-radius: var(--radius); background: none; cursor: pointer;
  color: var(--txt-3); font-size: 15px; line-height: 1; transition: color var(--t-1), background var(--t-1) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1742–1743 ─── */
.toast-x:hover { color: var(--txt); background: var(--hover-2) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1876–1889 ─── */
/* =========================================================
   CHI TIẾT NHỎ: nút lên đầu trang · phím tắt tìm · vòng vote
   ========================================================= */
.to-top {
  position: fixed; right: 18px; bottom: 18px; z-index: 30;
  width: 36px; height: 36px; display: grid; place-items: center; cursor: pointer;
  border-radius: 50%; border: 1px solid var(--line-2); color: var(--txt-2);
  background: var(--panel); backdrop-filter: var(--glass-sm);
  box-shadow: var(--sh-2);
  opacity: 0; transform: translateY(10px) scale(.92); pointer-events: none;
  transition: opacity var(--t-2) var(--e-soft), transform var(--t-2) var(--e-pop),
              color var(--t-1) var(--e-soft), border-color var(--t-1) var(--e-soft) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1889–1890 ─── */
.to-top.on { opacity: 1; transform: none; pointer-events: auto }

/* ─── rule hiện tại của control được yêu cầu · dòng 1890–1891 ─── */
.to-top:hover { color: var(--txt); border-color: var(--a-2); transform: translateY(-2px) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1891–1892 ─── */
.to-top:active { transform: scale(.94) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1892–1893 ─── */
.to-top svg { transition: transform var(--t-2) var(--e-out) }

/* ─── rule hiện tại của control được yêu cầu · dòng 1893–1894 ─── */
.to-top:hover svg { transform: translateY(-1.5px) }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 1928–1962 ─── */
@media (max-width: 620px) {
  /* ba bục đứng cạnh nhau đã hết chỗ: xếp chồng, và chỗ nối thì đổi từ
     viền trái sang viền trên — giữ viền sai chỗ là thấy một vạch dọc
     cụt ngủn giữa hai thẻ */
  /* hàng đã xuống dòng thì không cần đệm nữa: để nó ăn chỗ sẽ thành một
     khoảng trống trống hoác giữa thanh công cụ */
  .toolbar .spacer { display: none }
  .lb-top { grid-template-columns: minmax(0, 1fr) }
  /* bục xếp dọc thì phải đúng thứ tự hạng 1 → 2 → 3. DOM giữ thứ tự
     2·1·3 cho desktop (hạng 1 ở giữa), ở mobile đảo lại bằng order;
     không đổi DOM để thứ tự focus/trình đọc màn hình trên desktop
     vẫn khớp bố cục nhìn thấy */
  .lb-pod.p1 { order: 1 }
  .lb-pod.p2 { order: 2 }
  .lb-pod.p3 { order: 3 }
  .lb-pod + .lb-pod { border-left: 0; border-top: 1px solid var(--line) }
  .lb-pod { padding: 16px 8px 14px }
  .lb-pod .lb-av { width: 44px; height: 44px; font-size: 17px }
  .lb-pod.p1 .lb-av { width: 50px; height: 50px; font-size: 19px }
  .lb-pod-num b { font-size: 20px }
  .lb-medal { top: 7px; left: 7px; padding: 1px 6px 1px 5px }
  .lb-table th, .lb-table td { padding: 8px 10px }
  /* bản hẹp: thu hai cột số lại cho tên có nhiều chỗ hơn — đủ cho
     "1234" và chữ cột; completed đã ẩn (hide-sm) */
  .lb-table th:nth-child(3) { width: 84px }
  .lb-table th:nth-child(5) { width: 68px }
  .lb-underline { left: 10px }
  .lb-table .hide-sm { display: none }
  .lb-me { flex-wrap: wrap; gap: 8px }
  .lb-me-stats { margin-left: 0; width: 100% }
  .lb-bar { align-items: flex-start }
  .to-top { width: 34px; height: 34px; right: 12px; bottom: 12px }
  [data-glow]::after { display: none }        /* máy cảm ứng không có chuột */
}

/* ─── @media ràng buộc sẵn có · dòng 1983–1990 ─── */
@media (prefers-reduced-transparency: reduce) {
  .stats, .list, .nowbar, .votepanel, .lb, .modal, .side, .gate-card, .toast {
    backdrop-filter: none;
    background: var(--bg-2) }
  .bgfx { display: none }
  .pick-stage::before { display: none }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2013–2016 ─── */
/* hàng paid: thêm một lớp ánh vàng mờ phía trái, phân biệt từ xa */
.row.paid { background: linear-gradient(90deg, rgba(201,154,60,.055), rgba(201,154,60,0) 55%) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2016–2019 ─── */
/* hover đè lên gradient: nếu chỉ đổi background thì vệt gold biến mất cái rụp,
   nên phải giữ cả hai lớp trong trạng thái hover */
.row.paid:hover { background: linear-gradient(90deg, rgba(201,154,60,.08), rgba(201,154,60,0) 55%), var(--hover) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2034–2038 ─── */
/* gói vote: thẻ nhấc lên + viền sáng theo màu gói */
.pack { transition: border-color var(--t-2) var(--e-soft), transform var(--t-2) var(--e-out),
  box-shadow var(--t-2) var(--e-soft) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2038–2039 ─── */
.pack:hover { transform: translateY(-2px); box-shadow: var(--sh-2) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2039–2040 ─── */
.pack.best { background: linear-gradient(180deg, rgba(201,154,60,.08), transparent 55%) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2040–2045 ─── */
/* nút vote đã bấm: một chấm sáng nhỏ báo "phần của bạn nằm ở đây" */
.votebtn.on::before { content: ''; position: absolute; top: -2px; right: -2px; width: 6px; height: 6px;
  border-radius: 50%; background: var(--a-2); box-shadow: 0 0 8px var(--a-glow);
  animation: fadeIn .3s var(--e-out) both }

/* ─── rule hiện tại của control được yêu cầu · dòng 2055–2058 ─── */
/* chữ không bao giờ xuống dòng lổn nhổn */
.row .title, .nowbar h3, .pick-cap b, .pv-tx b, .lb-pod-name { text-wrap: balance }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 2079–2084 ─── */
@media (max-width: 620px) {
  .sect > [data-reveal]:nth-child(n) { transition-delay: 0ms }
  .watch::after { display: none }
}

/* ─── @media ràng buộc sẵn có · dòng 2084–2089 ─── */
@media (prefers-reduced-motion: reduce) {
  .stat::after, .watch::after, .votebtn.on::before, .kbtn.on { animation: none }
  .stat:hover::after, .watch:hover::after { transition: none }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2115–2116 ─── */
.row.paid .pill.upnext { margin-left: 6px; }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 2177–2183 ─── */
@media (max-width: 620px) {
  .now-head { flex-direction: column; align-items: flex-start; gap: 6px; }
  .pick-cd { align-items: flex-start; text-align: left; flex-direction: row; gap: 6px; align-items: baseline; }
  .now-more { width: 100%; text-align: center; margin-left: 0; }
}

/* ─── @media ràng buộc sẵn có · dòng 2183–2184 ─── */
@media (prefers-reduced-motion: reduce) { .now-item { animation: none; } }

/* ─── rule hiện tại của control được yêu cầu · dòng 2189–2199 ─── */
/* =========================================================
   NOTIFICATIONS — chuông + bảng thông báo (mở tại chỗ)
   ---------------------------------------------------------
   Khung/kính/lấy theo bảng màu của trang: --panel + --glass cho nền, vệt
   màu bên trái mỗi dòng đúng bằng màu trạng thái ở .row, chữ số dùng
   --mono như mọi con số khác. Không bày bảng màu riêng cho thông báo.
   ========================================================= */
.nt { position: relative; display: inline-flex; flex: none; }

/* ─── rule hiện tại của control được yêu cầu · dòng 2199–2205 ─── */
.nt-btn {
  position: relative; width: 30px; height: 30px; display: grid; place-items: center;
  border: 1px solid var(--line-2); border-radius: var(--radius);
  background: none; color: var(--txt-3); cursor: pointer;
  transition: color var(--t-1) var(--e-soft), border-color var(--t-1) var(--e-soft), background var(--t-1) var(--e-soft);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2205–2206 ─── */
.nt-btn:hover { color: var(--txt); border-color: #3c4550; background: var(--surface-3); }

/* ─── rule hiện tại của control được yêu cầu · dòng 2206–2208 ─── */
/* co tin chua doc: chuong sang mau nhu dang duoc goi */
.nt-btn.has { color: var(--a-2); border-color: rgba(135,130,250,.42); background: var(--a-soft); }

/* ─── rule hiện tại của control được yêu cầu · dòng 2208–2209 ─── */
.nt-btn .dotbadge { position: absolute; top: -6px; right: -7px; margin: 0; line-height: 14px; min-width: 14px; font-size: 9.5px; }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 2357–2374 ─── */
@media (max-width: 620px) {
  /* tren mobile: day len thanh sheet sat day man hinh, de mot tay bam */
  .nt-pop {
    position: fixed; left: 0; right: 0; top: auto; bottom: 0; width: 100%;
    max-height: 82vh; border-radius: var(--r-lg) var(--r-lg) 0 0; border-bottom: 0;
    animation: ntUp .22s var(--e-out) both;
  }
  @keyframes ntUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
  /* mobile cung mot con so: 12px cho ca mép phai lan cot cua hang duoi */
  .nt-i { padding-right: 12px; flex-wrap: wrap }
  .nt-hit { padding-left: 12px; flex: 1 1 100% }
  .nt-acts { flex: 1 1 100%; justify-content: flex-end; padding: 0 0 9px 12px }
  /* chip 20px o dau nhom la muc qua nho cho ngon tay: cho ca hang duoi 28px */
  .nt-hvote { padding: 6px 12px }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2385–2399 ─── */
- theo doi la cho CA BAI nen hang ben trong cum khong con chu ong nao ca —
     bo duoc cai "o ghost" 26px dung cho thang cot cua lan truoc. */
.followbtn {
  flex: none; width: 18px; height: 18px; display: inline-grid; place-items: center;
  border: 0; border-radius: var(--radius); background: none; cursor: pointer;
  color: var(--txt-3); opacity: 0;
  /* an thi KHONG duoc bamtrung nua: neu khong, cho trong 18px cuoi dong meta
     van la nut — con tro ruc len chu, va kéo chuột bôi đen dòng chữ là dính
     ô rỗng. Re/focus/cam ung thi mo lai o duoi. */
  pointer-events: none;
  /* `vertical-align` ở đây là chi tiết thừa: .meta là flex + align-items:center
     nên item tự thẳng giữa — không có số đo tay nào cần bù. */
  transition: color var(--t-1) var(--e-soft), opacity var(--t-1) var(--e-soft);
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2399–2401 ─── */
/* glyph va cham xep chong len nhau trong cung mot o: doi chi la doi noi dung */
.followbtn > svg, .followbtn::after { grid-area: 1 / 1 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2401–2405 ─── */
.followbtn::after {
  content: ''; width: 4px; height: 4px; border-radius: 50%;
  background: currentColor; opacity: 0;
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2405–2406 ─── */
.row:hover .followbtn, .grow:hover > .followbtn, .followbtn:focus-visible { opacity: .85; pointer-events: auto }

/* ─── rule hiện tại của control được yêu cầu · dòng 2406–2409 ─── */
/* hàng đang bật thì giữ nguyên độ đậm 1: chấm 4px mà bị giảm xuống .85 lúc rê
   vào là nó nhạt đi đúng lúc người dùng nhìn nó nhất */
.row:hover .followbtn.on, .grow:hover > .followbtn.on { opacity: 1 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2409–2410 ─── */
.followbtn:hover { color: var(--txt) }

/* ─── rule hiện tại của control được yêu cầu · dòng 2410–2411 ─── */
.followbtn.on { color: var(--a-2); opacity: 1 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2411–2412 ─── */
.followbtn.on > svg { opacity: 0 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2412–2413 ─── */
.followbtn.on::after { opacity: 1 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2413–2415 ─── */
.row:hover .followbtn.on > svg, .grow:hover > .followbtn.on > svg,
.followbtn.on:hover > svg, .followbtn.on:focus-visible > svg { opacity: 1 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2415–2417 ─── */
.row:hover .followbtn.on::after, .grow:hover > .followbtn.on::after,
.followbtn.on:hover::after, .followbtn.on:focus-visible::after { opacity: 0 }

/* ─── @media ràng buộc sẵn có · dòng 2417–2418 ─── */
@media (hover: none) { .followbtn { opacity: .55; pointer-events: auto } }

/* ─── rule hiện tại của control được yêu cầu · dòng 2421–2423 ─── */
`align-self:center` tu thang hang. Cung nhip: 12px gitua cac nut, 14px
   t mép phai — .row (dong le) va .grow (ca cum) vi the trung cot nut vote/xoá. */
.grow { display: grid; grid-template-columns: minmax(0, 1fr) auto; }

/* ─── rule hiện tại của control được yêu cầu · dòng 2423–2428 ─── */
/* PHAI ghi ca `grid-row`: FollowBtn dung trc .grow-head trong DOM, neu de
   auto-placement thi no chiem hang 1 (cot 2) va .grow-head bi day xuong hang 2
   — chuong nam rieng mot dong o goc, the card cao them ~40px. Lan sua truoc do
   lech nhieu hon cung vi ly do nay. */
.grow > .grow-head { grid-area: 1 / 1; min-width: 0; padding-right: 0 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2428–2429 ─── */
.grow > .followbtn { grid-area: 1 / 2; align-self: center; justify-self: end; margin: 0 14px 0 12px; z-index: 2 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2429–2430 ─── */
.grow > .grow-rows { grid-area: 2 / 1 / 3 / 3 }

/* ─── rule hiện tại của control được yêu cầu · dòng 2430–2431 ─── */
.grow.hl { border-color: var(--a-2); }

/* ─── @media bản hẹp — nơi viết bản sửa · dòng 2431–2442 ─── */
@media (max-width: 620px) {
  .row { gap: 8px; }
  /* ban cham: 18px qua nho cho ngon tay; 24px ma khong hop thi hang van ghe */
  .followbtn { width: 24px; height: 24px }
  /* giu dung mot nhip o ban hep: 8px giua cac nut, 10px t mép phai */
  .grow > .followbtn { margin: 0 10px 0 8px }
  .grow-rows-in > .row { padding-right: 10px }
  .votebtn { padding-left: 8px; padding-right: 8px; }
  .standing { margin-left: 0; }
}

/* ─── rule hiện tại của control được yêu cầu · dòng 2450–2451 ─── */
.row.hl, .grow.hl { animation: songHl 2.6s var(--e-soft) both; }

````

## `2-meta.js`

````
export const KIND_META = {
  'Color Coded Lyrics': { cls: 'ccl',   short: 'CCL',     titleKey: 'req.song' },
  'Full Album':         { cls: 'album', short: 'Album',   titleKey: 'req.albumName', noteKey: 'req.kindNote.album' },
  '1 Hour Loop':        { cls: 'loop',  short: '1H Loop', titleKey: 'req.song' },
  'Short':              { cls: 'short', short: 'Short',   titleKey: 'req.song' },
}

/* Chỉ giữ màu — nhãn hiển thị lấy qua t('status.<key>') */
export const STATUS_META = {
  pending:     { c: 'var(--pending)' },
  queued:      { c: 'var(--queued)' },
  in_progress: { c: 'var(--progress)' },
  completed:   { c: 'var(--done)' },
  denied:      { c: 'var(--denied)' },
}

export const kindCls = (k) => KIND_META[k]?.cls || 'ccl'

/* Request đã được chốt vào Up next nhưng chưa xong: đã chốt (picked_at)
   và vẫn còn trong hàng (queued) hoặc đang làm (in_progress).
   Completed/denied tự rơi khỏi nhóm này. Up next thì KHÓA vote. */
export const isPicked = (r) =>
  !!r?.picked_at && (r.status === 'queued' || r.status === 'in_progress')

/* Cần truyền hàm t vào để dịch */
export const timeAgo = (iso, t) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(s) || s < 60) return t('time.now')
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) })
  if (s < 86400) return t('time.hour', { n: Math.floor(s / 3600) })
  if (s < 86400 * 7) return t('time.day', { n: Math.floor(s / 86400) })
  if (s < 86400 * 30) return t('time.week', { n: Math.floor(s / (86400 * 7)) })
  if (s < 86400 * 365) return t('time.month', { n: Math.floor(s / (86400 * 30)) })
  return t('time.year', { n: Math.floor(s / (86400 * 365)) })
}

/* 1234 -> "1.2K" — dùng cho lượt xem */
export const compact = (n) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0)

export const vnd = (n) => Number(n).toLocaleString('en-US') + '₫'

export const usd = (n) => '$' + Number(n).toFixed(2)
````

## `3-anh-trang-chu.png`

![ảnh](3-anh-trang-chu.png)  <!-- đính kèm ảnh này dưới dạng file -->

## `4-anh-xep-hang.png`

![ảnh](4-anh-xep-hang.png)  <!-- đính kèm ảnh này dưới dạng file -->

## `5-skill-16-pricing-page.md`

````
---
name: pricing-page
description: Use when designing or rewriting a high-converting SaaS pricing page (structure, plan design, copywriting, SEO/AEO, FAQs, layout patterns, experiments). Includes checklists, templates, and common pitfalls.
---

# Pricing Page (High‑Conversion) — Web Design Skill

Design a pricing page that helps visitors **choose** and feel good about it.
Your job is not to “show prices.”
Your job is to **reduce uncertainty**.

## Before you design/write
Gather (ask if missing):

### 1) Offer + audience
- What are you selling? (category)
- Who is it for? (ICP + primary use case)
- What’s the main value metric? (seat, usage, project, revenue, etc.)

### 2) Plans
- Plan names + prices (monthly/annual)
- Limits per plan (the 3–6 limits that matter)
- What’s the upgrade trigger? (what causes people to move up?)

### 3) Objections + risk
- Top 3 reasons people don’t buy today
- Security/compliance needs? (SOC2, GDPR, etc.)
- Can you offer: free trial, free plan, money-back, demo?

### 4) Proof
- Testimonials, logos, results, case studies, metrics

### 5) Traffic context
- Are visitors coming from: homepage, feature pages, ads, comparison pages?
- What do they already know?

---

## Core structure (what a pricing page should have)

### Above the fold (must)
- **Clear value headline** (what outcome, for who)
- **Monthly/Annual toggle** with annual savings callout
- **3‑plan pricing table** (most common) or 2‑plan (simple product)
- **Primary CTA** per plan (consistent verbs)

### Below the fold (high leverage)
- **Plan comparison** (feature matrix or “what you get” bullets)
- **FAQ** (objection handling)
- **Social proof** near decision points
- **Security / compliance / procurement** section (if B2B)
- **Final CTA** + contact sales

---

## Layout types (pick one)

### A) Classic 3‑card
Best when:
- you have 3 natural tiers (Starter / Pro / Business)
- pricing is simple

Rules:
- 1 plan labeled **Recommended**
- show “most popular” without yelling

### B) Value metric slider
Best when:
- pricing scales with usage (seats, events, credits)

Rules:
- keep math obvious
- keep a safe default (median customer)

### C) “Pick your path” (two columns)
Best when:
- different audiences (Individuals vs Teams)

Rules:
- separate by persona first, then price

### D) Enterprise last mile
Best when:
- you have a self-serve path + sales-led path

Rules:
- Enterprise should read like **procurement reassurance**

---

## High‑conversion strategies (practical)

### 1) Make the decision easy
- 3 plans max (unless you have a strong reason)
- One recommended plan
- Bullets describe **outcomes**, not internal features

### 2) Anchor value (without being shady)
- Annual toggle with “Save X%”
- Show “Starting at” only if your pricing is truly variable
- Avoid surprise fees

### 3) Reduce risk
Choose at least one:
- Free trial
- Free plan
- Money‑back guarantee
- “Talk to sales” with a clear promise (response time, demo)

### 4) Handle objections before they bounce
Most effective FAQ topics:
- “Can I cancel anytime?”
- “What happens if I hit limits?”
- “Do you offer discounts?”
- “Is this for freelancers/teams?”
- “Security / data / compliance”

### 5) Provide a comparison that’s readable
- Avoid huge spreadsheets
- Group by: Core, Collaboration, Admin/Security, Support
- Highlight what changes at each tier

---

## Copywriting (templates)

### Headlines (choose a formula)
- “{Outcome} for {audience}—without {pain}”
- “Plans that scale from {small} to {big}”
- “Start small. Upgrade when {trigger}.”

### Plan description (2 lines)
- Who it’s for
- What it unlocks

Example:
- **Pro** — For designers shipping weekly. Better components, faster iteration.

### CTA buttons
Rules:
- Use verbs that match the motion:
  - “Start free trial”
  - “Buy Pro”
  - “Contact sales”
- Keep CTAs consistent across plans (don’t mix “Get started” / “Try now” / “Sign up”).

### Feature bullets (write like outcomes)
- ❌ “Unlimited projects”
- ✅ “Ship unlimited client sites without extra fees”

---

## Pricing table checklist (UI)
- Visible monthly/annual toggle
- “Save X%” callout on annual
- Recommended plan styling (subtle)
- Key limits visible (3–6 max)
- Included items visible (3–6 max)
- Clear next step under each plan (trial/buy/contact)
- Link: “Compare plans” (scrolls to matrix)
- Mobile: table becomes stacked cards (not a horizontal scroll nightmare)

---

## SEO + AEO (AI answers) checklist

### SEO basics
- Title: “Pricing — {Product}” + outcome keyword
- Meta description: 1 sentence on value + 1 sentence on pricing starting point
- Clean URL: `/pricing`
- Internal links from:
  - homepage CTA
  - feature pages
  - comparison pages

### AEO (answer engines)
- Add an FAQ section that answers:
  - refund policy
  - trial length
  - cancellation
  - what counts as a seat/usage
  - enterprise procurement
- Write FAQs in **plain Q/A** format.
- Optional: FAQ schema (if your stack supports it).

---

## Common pitfalls
- Too many plans (analysis paralysis)
- Features listed with no context (why it matters)
- Pricing hidden behind “Contact sales” for everything
- Switching value metric mid-page (confusing)
- Over-designed table that harms readability

---

## Output format (when generating a pricing page)
Return:
1) **Page outline** (sections + order)
2) **Pricing table spec** (plans, bullets, limits, CTA)
3) **FAQ list** (6–12 Q/A)
4) **SEO/AEO** (title + meta + FAQ schema suggestion)
5) **Layout recommendation** (A/B/C/D + why)

---

## Quick questions (if user gives you only “make a pricing page”)
- Free plan or trial?
- Monthly/annual pricing numbers?
- Value metric?
- Recommended plan (which one and why)?
- Top 3 objections?

````

## `5-skill-17-design-first-ui-prompting.md`

````
---
name: design-first-ui-prompting
description: Use when you need design-first, spec-driven, skimmable prompts for UI generation. Covers prompt structure, constraints, variations, typography/spacing rules, and iteration workflow for consistent UI outputs.
---

# Design-First UI Prompting Skill

This skill is for **design-first prompting**: turn fuzzy ideas into a tight spec that produces consistent UI.

## Core principle
**Prompt like a design system, not a wish.**

## Prompt Structure (copy/paste)
Use this skeleton, then fill the blanks.

```text
GOAL
- What are we making? (e.g., landing page hero / onboarding / dashboard / carousel slide)
- Who is it for? (persona)
- What’s the success criteria? (clarity, conversion, vibe)

FORMAT
- Size/aspect: (e.g., 1080x1350)
- Safe margins: (e.g., 90px)

LAYOUT (wireframe in words)
- Grid: (e.g., Swiss 6-col)
- Placement: (e.g., type-left / image-right)
- Hierarchy: H1 → subhead → body → CTA

TYPE SYSTEM
- Font vibe: (e.g., Söhne / Neue Haas / SF Pro)
- Weights: (H1 700, body 400)
- Leading: (tight for H1, readable for body)
- Tracking: (micro labels wider)

COLOR + MATERIAL
- Background: (hex or description)
- Text: (white/ivory/charcoal)
- One accent only: (cyan/lime/purple)
- Texture: (subtle grain, no plastic HDR)

IMAGERY / UI STYLE
- UI style: (minimal / glass / editorial / playful 3D)
- If photo: lighting + crop + texture rules
- If 3D: materials + lighting + softness

COPY (render EXACTLY)
- Line 1:
- Line 2:
- ...

CONSTRAINTS (change 1–2 things only)
- FONT: ___
- STYLE: ___
- MODE: ___

NEGATIVE PROMPT
- No logos, no watermarks
- No extra text beyond provided lines
- No gibberish typography
```

## Rules that improve consistency

### 1) Lock one “system”, then iterate with variants
- First output: nail **layout + hierarchy + copy**.
- Variants: change **ONE variable** at a time:
  - angle / crop
  - accent color
  - card arrangement
  - background tone

### 2) Treat typography as fragile
If the model keeps misspelling:
- Use **2-pass workflow**:
  1) Generate without text (reserve a clean text-safe area)
  2) Typeset in Figma

### 3) Use “constraints cards”
When you want the model to obey a style:
- Add a small “Constraints” panel with explicit values.
- It anchors the output like a mini style guide.

Example:
```text
Constraints
FONT  CANELA
STYLE  MINIMAL
MODE  DARK
```

### 4) Keep a local reference pack
Don’t ask the model to “remember” taste.
- Save references into a gitignored local reference folder, such as `refs/...`
- Point prompts to the reference style

## Fast iteration checklist (what to tweak)
- Spacing: margins, leading, baseline rhythm
- Contrast: background vs text
- Hierarchy: one hero line, one support line
- One accent only (don’t rainbow)
- Texture: add grain, remove smoothing

## Questions to ask (when user is vague)
- What’s the single message of this screen?
- What’s the hierarchy (H1 / sub / CTA)?
- Which style lane: minimal editorial vs playful 3D vs glass UI?
- Any must-keep constraints (font vibe, color, spacing, grid)?

````

## `5-skill-19-stitched-full-page-capture.md`

````
---
name: stitched-full-page-capture
description: Capture or repair reliable full-page screenshots for lazy-loaded, scroll-animated, Framer, WebGL/canvas, or reveal-heavy web pages. Use when full-page screenshots are blank, gray, white, sparse, show a tiny content strip, disagree with a working scroll video, or when article evidence/section crops must be derived from a trustworthy full-page image.
---

# Stitched Full-Page Capture

## Overview

Use settled viewport screenshots instead of trusting one-shot browser `fullPage` captures. This is especially important for Framer pages and other lazy/scroll-animated sites where the MP4 can look correct while the tall screenshot is mostly blank.

## Core Workflow

1. Open the real page URL, not a marketplace thumbnail, cover image, remix page, or asset URL.
2. Warm the page by scrolling from top to bottom once so lazy media and reveal sections mount.
3. Return to the top.
4. Scroll downward in viewport-sized or slightly-overlapping steps.
5. Wait about 2 seconds after each scroll stop.
6. Capture the settled viewport.
7. Stitch the viewport captures vertically into one full-page image.
8. Cut section crops from that stitched image, not from the native browser `fullPage` screenshot.
9. Validate the stitched image against the representative still, MP4, and motion frames.

Reject a full-page candidate when it has blank/gray/white bands, very low visual content, missing lazy-loaded sections, an extremely narrow content column, or obvious disagreement with the scroll video.

## Script

For daily UI inspiration articles, use the helper script from this skill directory when available:

```bash
node <skills-root>/stitched-full-page-capture/scripts/stitch_full_page_capture.mjs \
  --manifest articles/YYYY-MM-DD-ui-inspiration-capture/manifest.json
```

The script:

- reads `items[].pageUrl`, `fullPageImage`, and `sectionImages`;
- opens each live page in Playwright Chromium;
- warms lazy content by scrolling once;
- captures settled viewport slices;
- stitches slices into `fullPageImage`;
- regenerates each existing section crop from the stitched image;
- updates `manifest.json` with `fullPageCaptureMethod: "stitchedViewportScreenshots"`, viewport, step, segment count, and corrected crop coordinates.

Useful options:

```bash
--item 4              # repair only item 4, 1-based
--viewport 1440x1100 # default
--step 950           # default; use less than viewport height for overlap
--wait 2000          # ms to wait after each scroll stop
--quality 3          # ffmpeg JPEG quality, lower is better
```

## Validation

After capture or repair:

- Inspect at least the page that was visibly wrong before.
- Confirm `sips -g pixelWidth -g pixelHeight full-page/*.jpg` reports expected wide/tall dimensions.
- Confirm the full-page image is not mostly blank and includes lower-page content.
- Confirm section crop coordinates are contiguous and end at the full-page image height.
- Run the project’s normal checks, for example:

```bash
git diff --check -- articles/YYYY-MM-DD-ui-inspiration-capture/content.md articles/YYYY-MM-DD-ui-inspiration-capture/manifest.json
node scripts/check-ui-inspiration-duplicates.mjs articles/YYYY-MM-DD-ui-inspiration-capture/manifest.json
for f in articles/YYYY-MM-DD-ui-inspiration-capture/videos/*.mp4; do ffprobe -v error "$f" >/dev/null; done
```

## Notes

- The scroll video is evidence that the page can render during real scrolling, but it is not a substitute for full-page still evidence.
- Native `fullPage` screenshots can still be saved as comparison candidates, but do not use them as source of truth unless they visually match the stitched capture.
- For daily UI articles, update the manifest and commit only the repaired article assets and metadata.

````

## `5-skill-20-build-awwwards-quality-sites.md`

````
---
name: build-awwwards-quality-sites
description: Art-direct and implement distinctive, motion-rich marketing, editorial, portfolio, and landing websites with original reference-inspired imagery, standout heroes, GSAP choreography, one smooth-scroll engine, optional Three.js shaders, honest icon and logo sourcing, photo avatars, accessibility, and performance safeguards. Use when a user asks for an Awwwards-quality, premium, cinematic, interactive, high-concept, or motion-led website, or explicitly requests this visual and motion system.
---

# Build Awwwards-Quality Sites

Build a cohesive, memorable site whose visual idea, media, typography, and motion tell the same story. Treat “Awwwards quality” as an acceptance bar, never as an award or recognition claim.

## 1. Set the art direction

- Inspect the user's reference evidence completely before implementation. Extract only high-level traits such as hierarchy, pacing, contrast, image treatment, and motion principles.
- Generate a materially new identity, layout, copy system, imagery, and interaction language. Never reuse, trace, or closely reproduce reference assets, screenshots, source code, identity, or copy.
- Use Aura.build top asset imagery only when the user requests it or it is relevant and available. Treat it as high-level inspiration, not an asset library.
- Select and name at least one compatible installed web-design skill. Follow the smallest relevant set and avoid combining unrelated aesthetic systems.
- Write a compact direction before coding: visual thesis, hero focal asset, type hierarchy, color system, section sequence, motion narrative, chosen smooth-scroll engine, Three.js decision, and asset provenance plan.

## 2. Build an honest asset system

- Generate original hero or project imagery when it materially improves the concept. Use appropriately licensed media when it is stronger, and keep provenance in the site source.
- Do not draw illustrations with model-authored SVG, CSS, or canvas paths. Use original generated or appropriately licensed transparent PNG cutouts for illustrative elements. Simple authored brand marks, interface icons, data graphics, and a justified Three.js shader canvas are allowed.
- Use photographs for every avatar. Prefer provided or appropriately licensed photos; never ship initials, illustrated heads, faceless silhouettes, or generated people presented as real customers, staff, or endorsers.
- Use Solar icons through Iconify for interface symbols. Use Iconify SVG Logos only for legitimate real-company marks in truthful contexts. Use Logo Ipsum only for explicitly disclosed fictional brand specimens, never as customer proof. Omit a logo wall when no honest proof exists.
- Provide deliberate aspect ratios, crop behavior, alt text, loading behavior, and missing-media fallbacks. Avoid generic stock imagery, copied mockups, watermarks, and decorative media without a narrative role.

## 3. Compose the hero

- Make the first viewport the site's strongest authored moment. Combine a clear message and CTA with original imagery, video, pointer-responsive interaction, or a justified Three.js scene.
- Create a composed GSAP intro sequence for the hero. Keep navigation, primary message, and CTA readable and usable before the animation completes.
- Make pointer effects additive. Support touch, keyboard, coarse pointers, window blur, and visibility changes without leaving the interface in an incomplete state.
- Design a static first frame that remains complete when JavaScript, media playback, WebGL, or motion is unavailable.

## 4. Build the motion system

- Use GSAP as the primary animation system.
- Evaluate Lenis and Locomotive Scroll, then choose exactly one as the site's sole smooth-scroll engine. Never install or initialize both. Connect the chosen engine correctly to GSAP ScrollTrigger, refresh measurements after media and font changes, and destroy it during cleanup.
- Bypass smooth scrolling and scrubbed timelines under `prefers-reduced-motion: reduce`. Render final states immediately instead of merely shortening animations.
- Choreograph the page section by section. Reveal major headings word by word with a restrained stagger, then sequence supporting copy and media.
- Preserve an unsplit accessible name for staggered text. Hide decorative split words from assistive technology, never split links or meaningful inline markup, and keep the unsplit content visible without JavaScript.
- Use CSS for simple hover, focus, and tap states. Reserve ScrollTrigger for justified scrubbed or pinned sequences and avoid multiple systems controlling the same property.

## 5. Add Three.js only with purpose

- Use Three.js and custom WebGL shaders when spatial depth, texture transition, displacement, or pointer response materially supports the art direction. Do not add a shader as ornamental background noise.
- Give the canvas one clear responsibility and keep it subordinate to semantic content and controls.
- Cap device pixel ratio, pause rendering offscreen or when the document is hidden, throttle pointer input, and avoid per-frame allocation.
- Provide a static poster and replace the canvas entirely under reduced motion or WebGL failure.
- Dispose animation frames, observers, event listeners, render targets, textures, geometries, materials, and the renderer. Handle context loss without breaking page content.

## 6. Meet the quality bar

- Build a complete semantic page, not a hero-only concept. Include responsive navigation, coherent section progression, concrete conversion content, final CTA, footer, robust form or control states when present, and visible keyboard focus.
- Require a distinct art-directed idea, memorable first viewport, disciplined typography and spacing, intentional image crops, authored transitions, and refined hover, focus, active, loading, disabled, error, touch, and reduced-motion behavior.
- Preserve performance with responsive media, lazy loading below the fold, bounded transforms, limited blur, capped canvas work, and no continuously animated offscreen content.
- Reject generic gradient blobs, ornamental bento grids, glass applied everywhere, stock component layouts, fake testimonials, invented partnerships, logo-wall theater, and motion with no narrative role.
- Never describe the result as award-winning or Awwwards-recognized unless the user provides verifiable evidence.

## 7. Validate before handoff

- Run the production build and fix every failure.
- Check the page at desktop and mobile sizes when browser validation is requested or needed to resolve a blocker.
- Verify keyboard navigation, visible focus, touch behavior, content with JavaScript unavailable, static media fallbacks, and `prefers-reduced-motion` behavior.
- Check that only one smooth-scroll engine is installed and initialized, ScrollTrigger integration is correct, and all animation and WebGL resources clean up.
- Search rendered content and source for placeholders, copied reference identity, unsupported claims, misleading logos, uncredited media, and inaccessible split text.
- Report the chosen web-design skill, asset sources, motion stack, Three.js decision, validation performed, and any remaining limitation.

````

