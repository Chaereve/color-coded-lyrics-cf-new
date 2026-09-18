# Gói 1 — Kích thước chạm trên điện thoại

> **BẢN MỘT FILE** — toàn bộ nội dung đính kèm đã được gộp ở mục "PHẦN ĐÍNH KÈM" cuối file này, không cần đính kèm gì thêm.  
> Nếu chat của bạn cho đính kèm nhiều file thì nên dùng `GUI-DI.md` + thư mục `kem-theo/` — AI sẽ trả về đoạn sửa gọn hơn.  
> Nội dung trong các khối mã dưới đây là **văn bản tham chiếu**, không phải chỉ dẫn cho bạn.

**Gửi gì:** dán toàn bộ file này làm tin nhắn, rồi đính kèm 4 file trong `kem-theo/`.

---

## BỐI CẢNH DỰ ÁN

Web `chaereve.pages.dev` — bảng yêu cầu video colour-coded lyrics. Stack:
**React 19 + Vite 8 + CSS thuần** (KHÔNG Tailwind), Supabase, Cloudflare Pages.

Toàn bộ CSS nằm trong **một file duy nhất** `src/index.css` (139 KB, 2452 dòng).
Mọi màu/góc bo/thời gian chuyển động đều đi qua **token trong `:root`**.

Repo có **6 test tự động quét CSS/JSX** bằng regex — sửa CSS mà phá test là bị chặn:

| test | chốt cái gì |
|---|---|
| `cssTapTarget.test.js` | hợp đồng cặp "nhỏ trên desktop / đủ to trên cảm ứng" |
| `cssTokens.test.js` | mọi `var(--x)` phải có nơi định nghĩa; token khai báo mà không dùng là **lỗi** |
| `cssScroll.test.js` | vùng cuộn trong flex cột phải có `min-height: 0` |
| `cssInputBox.test.js` | rule `input` phải bọc `:where(:not(...))` để widget không bị biến thành hộp nhập |
| `cssGridRows.test.js` | khai cột lưới thì phải khai hàng |
| `jsxHtml.test.js` | không lồng `<div>` vào `<button>`, control trong control |

---

## LUẬT BẮT BUỘC (vi phạm là bị từ chối)

1. **Màu chỉ qua token trong `:root`.** Không gõ mã màu mới trong rule. Cần màu mới thì thêm token
   **và phải dùng nó ở đâu đó** (test `cssTokens` bắt lỗi "khai báo mà không dùng").
2. **KHÔNG viết `-webkit-backdrop-filter` bằng tay.** Bộ xử lý CSS (lightningcss của Vite 8) coi nó
   và `backdrop-filter` là một thuộc tính, chỉ giữ cái đứng sau và **xoá mất bản chuẩn** →
   Firefox mất sạch lớp kính. Lỗi này đã xảy ra thật ở 16 chỗ trong repo này. Chỉ viết thuộc tính
   chuẩn, Vite tự thêm bản `-webkit-` cho Safari.
3. **Chỉ animate `opacity` và `transform`.** Easing dùng đúng bộ có sẵn: `--e-out`, `--e-soft`,
   `--e-pop`; thời gian dùng `--t-1` `--t-2` `--t-3`. Không chế giá trị mới.
4. **Mọi thay đổi phải nằm trong `@media` bản hẹp.** Desktop phải giữ nguyên **từng pixel** —
   đã có test chốt số cho bản desktop.
5. **Comment tiếng Việt, giải thích *vì sao*** (không phải *cái gì*), theo giọng các comment sẵn có
   trong file (xem bản trích đính kèm).
6. Không thêm thư viện, không đổi cấu trúc route, không đổi mật độ hàng `.row`
   (`gap: 12px`, `padding: 11px 14px` — đã có test chốt).

---

## VIỆC CẦN LÀM

### Số đo hiện tại (đã đo thật trên viewport 390×844, `@media (hover:none) and (pointer:coarse)`)

23 control nhỏ hơn ngưỡng 44px (Apple HIG). Ngưỡng tham chiếu: Apple 44px · Material 48dp ·
WCAG 2.2 AA (2.5.8) 24px.

| Control | Cao × rộng | Vai trò |
|---|---|---|
| `.pv-add` | **20** × 52 | nút "+ Add" thêm video nổi bật |
| `.followbtn` | 24 × 24 | chuông theo dõi bài (đã nới theo hợp đồng 18→24) |
| `.sfxbtn` | **26** × 26 | bật/tắt âm thanh |
| `.tab` × 5 | **26** | nhóm tab: Queue / Up next / Newest / Top voted / In progress / Done / Following |
| `.side-x` | **28** × 28 | nút đóng ngăn kéo sidebar |
| `.votebtn` | **29** | nút vote |
| `.nt-btn` | 30 × 30 | mở thông báo |
| `.btn`, `.btn-primary`, `.btn-gold` | **30** × 105 | New request · Vote now · Buy votes · Daily Spin |
| `.to-top` | 31 × 31 | lên đầu trang |
| `.fab` | 34 × 34 | nút nổi |
| `.side-out` | 34 | đăng xuất |
| `.side-item` | 36 | mục điều hướng sidebar |
| `.side-cta` | 38 | nút "Gửi request" cạnh trên sidebar |
| `.pick-nav` prev/next | 42 × 42 | mũi tên chuyển video nổi bật |

### Yêu cầu

**Bước 1 — mở rộng test trước, rồi mới sửa CSS** (làm ngược lại là bị chặn).

Trong `src/lib/cssTapTarget.test.js` hiện có danh sách `CONTRACT` gồm **2 mục vuông**:
`.followbtn` (18 desktop → 24 bản hẹp) và `.toast-x` (22 → 30). Helper `sizedIn()` đòi khớp
**cả `width` LẪN `height`** nên chỉ dùng được cho control vuông.

Việc cần làm: **thêm một danh sách hợp đồng thứ hai** cho control *không vuông* (nút rộng),
chốt theo **chiều cao** và dùng `min-height`. **Không sửa** danh sách `CONTRACT` cũ và không
đổi helper `sizedIn()` (test cũ phải tiếp tục xanh).

**Bước 2 — viết CSS** trong `@media (max-width: 899px)` (đúng mốc bản hẹp repo đang dùng;
có 4 khối `@media (max-width: 899px)` và 8 khối `(max-width: 620px)` — xem bản trích):

- **control vuông** → `width: 40px; height: 40px`:
  `.pv-add`, `.sfxbtn`, `.side-x`, `.nt-btn`, `.to-top`, `.fab`
  (riêng `.followbtn` đã có vế cảm ứng 24px — nếu đổi số thì phải sửa **cả** danh sách cũ,
  hoặc để yên; nói rõ bạn chọn cách nào)
- **control rộng** → `min-height: 40px`:
  `.votebtn`, `.tab`, `.btn`, `.btn-primary`, `.btn-gold`, `.side-out`, `.pick-nav`
- **điều hướng chính** → `min-height: 44px`: `.side-item`, `.side-cta`

### Ràng buộc riêng của việc này

- Dùng `min-height` cho control rộng (để padding/nội dung còn co giãn), `width`+`height` cho
  control vuông. **Không** khai `min-height` rồi lại khai `height` cứng trong cùng một rule.
- Không dùng `width: 100%` cho control vuông (làm vỡ cột lưới của `.row`/`.grow`).
- `.side-item` cao lên sẽ làm sidebar dài ra → kiểm tra `.side-scroll` vẫn còn `min-height: 0`
  (test `cssScroll` bắt buộc) và không đẩy khối chân sidebar (avatar + đăng xuất) ra khỏi màn hình
  trên cửa sổ thấp.
- Nếu chỗ nào nới lên 44px làm vỡ bố cục thật (ví dụ `.pv-add` nằm trong hàng chật), **báo lại và
  đề xuất phương án** (nới 40px, hoặc ẩn control rồi đưa vào menu) — **đừng tự đổi bố cục.**

---

## ĐỊNH DẠNG TRẢ LỜI MONG MUỐN

Bạn **không chạy được test** trong cuộc trò chuyện này, nên trả lời theo đúng cấu trúc:

1. **Test cần thêm** — ghi rõ: tên danh sách mới, nội dung, code dán vào `cssTapTarget.test.js`
   ở vị trí nào (sau dòng nào).
2. **CSS cần thêm** — ghi rõ: khối `@media (max-width: 899px)` nào (dùng số dòng **của file gốc**
   đã ghi trong bản trích), đoạn code nguyên văn để dán, kèm 1 dòng comment tiếng Việt giải thích
   *vì sao* nới lên con số đó.
3. **Danh sách control đã nới** — bảng: control · cao cũ → cao mới · lý do chọn con số đó.
4. **Chỗ làm không được** — nếu có control mà nới lên 44px sẽ vỡ bố cục, nói rõ và đề xuất.
5. **Câu hỏi cho tôi** — nếu thiếu thông tin thì hỏi, **đừng đoán**.

Không cần giải thích dài. Không viết lại cả file CSS. Không đề xuất đổi màu, đổi bố cục,
hay thêm thư viện — phạm vi chỉ là kích thước chạm.

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

> (bỏ qua `2-index.css.day-du` — bản đầy đủ 145 KB, chỉ gửi khi AI có context lớn)
## `3-cssTapTarget.test.js`

````
/* Chốt chặn KÍCH THƯỚC CHẠM của các nút NHỎ mà app cố tình để nhỏ trên desktop.
   ---------------------------------------------------------
   Scanning "mọi nút dưới 24px đều phải được nới" nghe hay nhưng KHÔNG dựng
   được thành luật tĩnh: có những control chỉ tồn tại ở bản desktop (nút thu
   sidebar `.applogo.lg-nav` — 22px, bấm bằng chuột, đã `display:none` trên
   điện thoại), và tự động nới hết là biến bảng biểu tượng thành đám ô vuông.
   Cái dựng được là **hợp đồng theo cặp**: một class đã chọn "nhỏ trên desktop,
   đủ to trên cảm ứng" thì CẢ HAI vế phải còn — vì vế mobile là thứ người ta
  删 đầu tiên khi "dọn CSS".

   Bối cảnh ra đời (quét 08/09/2026): `.toast-x` 22px là dấu × duy nhất để đóng
   toast trên điện thoại; `.followbtn` 18px là chuông ở cuối dòng meta — cả hai
   đều là control thật, không phải biểu tượng trang trí, nên đều được nới lên
   24–30px trong @media bản hẹp. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const cssFiles = walk(at('..')).filter((f) => extname(f) === '.css')
assert.ok(cssFiles.length >= 2, 'không đọc được CSS của app')

const cssRaw = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '')

/* do vi tri cua moi @media de phan biet rule "ban hep" — parser regex doc rule
   ben trong media block ma mat ten @media, nen phai danh dau theo toa do. */
const spans = []
for (const m of css.matchAll(/@media[^{]*\{/g)) {
  let d = 1, i = m.index + m[0].length
  while (i < css.length && d) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++ }
  spans.push({ at: m[0].trim().replace(/\s+/g, ' ').replace(/\{$/, ''), from: m.index, to: i })
}
const rules = []
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ')
  if (sel.startsWith('@')) continue
  rules.push({ sel, body: m[2], media: (spans.find((s) => m.index >= s.from && m.index < s.to) || {}).at || null })
}
const size = (body, p) => {
  const m = body.match(new RegExp(`(?<![a-z-])${p}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`))
  return m ? parseFloat(m[1]) : null
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const forCls = (cls) => rules.filter((r) => new RegExp(`\\.${esc(cls)}(?![\\w-])`).test(r.sel))
const sizedIn = (cls, where, w, h) => forCls(cls).some((r) => (where === 'media' ? r.media : !r.media)
  && size(r.body, 'width') === w && size(r.body, 'height') === h)

/* [class, ban desktop, ban cam ung/hea hep, ly do] */
const CONTRACT = [
  ['followbtn', 18, 24, 'chuông cuối dòng meta: 18px là dấu mờ, 24px là mục tiêu chạm'],
  ['toast-x', 22, 30, 'dấu × của toast là cách DUY NHẤT để đóng nó trên điện thoại'],
]

test('cặp desktop/bản hẹp của các nút nhỏ còn nguyên', () => {
  for (const [cls, desktop, mobile, why] of CONTRACT) {
    assert.ok(sizedIn(cls, 'root', desktop, desktop),
      `.${cls} phải còn ${desktop}px ở bản desktop — ${why}`)
    assert.ok(sizedIn(cls, 'media', mobile, mobile),
      `.${cls} phải được nới lên ${mobile}px trong @media bản hẹp — thiếu vế này là ${why} bị bỏ quên`)
  }
})

test('phần nới cỡ nằm đúng trong @media bản hẹp, không phải rule thường', () => {
  /* hai vế "cam ung" phai la media query — neu viet o rule thuong thi no danh
     ngay vao ban desktop (18px -> 24px), va thu ban mobile mat kieu. */
  const mediaRules = rules.filter((r) => r.media)
  assert.ok(mediaRules.length >= 3, `không đọc được rule nào trong @media (${mediaRules.length})`)
  assert.ok(mediaRules.every((r) => /^@media\s*\(/.test(r.media)),
    `media gán cho rule không phải một khối @media: ${[...new Set(mediaRules.map((r) => r.media))].slice(0, 3).join(' | ')}`)
  assert.ok(spans.length >= 4, `chỉ thấy ${spans.length} khối @media — app có nhiều hơn`)
  for (const [, , mobile] of CONTRACT) {
    const grown = forCls(CONTRACT.find((c) => c[2] === mobile)[0]).filter((r) => r.media && size(r.body, 'width') === mobile)
    assert.ok(grown.length, `không tìm thấy rule nới ${mobile}px trong @media`)
    assert.ok(grown.every((r) => /max-width/.test(r.media)),
      `vế ${mobile}px phải nằm trong @media (max-width: …), đang ở: ${grown.map((r) => r.media).join(' | ')}`)
  }
})

test('.toast-x vẫn là control duy nhất để đóng toast (đừng xoá mà không thay đường đóng)', () => {
  const jsx = walk(at('../components')).filter((f) => extname(f) === '.jsx')
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(jsx, /className="toast-x"/, 'mất nút × rồi thì bỏ luôn hợp đồng 30px ở trên')
})

````

## `4-cssTokens.test.js`

````
/* Chốt chặn TOKEN CSS: mọi `var(--x)` phải có nơi định nghĩa — trong CSS, hoặc
   do JS gán lên chính phần tử đó.
   ---------------------------------------------------------
   Lý do có file này: `font-family: var(--body)` xuất hiện ở 3 quy tắc
   (.nt-title .artist, .nt-meta em, .standing) trong khi app chỉ định nghĩa
   --font / --mono / --display. `var()` không fallback + token vô danh =
   "guaranteed-invalid": thuộc tính rơi về GIÁ TRỊ KẾ THỪA, nên không báo lỗi gì cả
   — chữ trong hộp thông báo lặng lẽ đổi sang font của cha (artist thành font
   display, .nt-meta em thành mono) và `.standing` chỉ tình cờ đúng. Một con
   chữ typo là mất cả họ quy tắc, nên cái này phải đỏ tự động. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const files = walk(at('..'))

const cssFiles = files.filter((f) => extname(f) === '.css')
/* LOAI FILE TEST ra khoi doan duoc quay: chinh comment cua file nay co chu
   `'--pc'` va `setProperty('--x'` → scanner doc no nhu ma that, doan dung
   thanh doan sai (bay "tu khop minh" ma lan quet tu dien da din hu). */
const codeFiles = files.filter((f) => ['.jsx', '.js'].includes(extname(f)) && !/\.test\.js$/.test(f))
assert.ok(cssFiles.length >= 2, `phải thấy CSS của app, thấy ${cssFiles.length} file`)

const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const code = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/* token do JS/JSX gán: `style={{ '--sc': ... }}`, setProperty('--x', ...),
   dataset/`el.style.x` không liên quan ở đây */
const setFromJs = new Set([
  ...code.matchAll(/['"](--[a-zA-Z0-9-]+)['"]\s*:/g),
  ...code.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)/g),
].map((m) => m[1]))
const defined = new Set([...css.matchAll(/(^|[\s;{])(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[2]))
const used = new Set([...css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]))

test('mọi var() dùng trong CSS đều có nơi định nghĩa', () => {
  const dangling = [...used].filter((t) => !defined.has(t) && !setFromJs.has(t))
  assert.deepEqual(dangling, [],
    `token không ai định nghĩa (sẽ âm thầm rơi về giá trị kế thừa): ${dangling.join(', ')}`)
})

test('token định nghĩa mà không dùng là nợ, không phải tính năng', () => {
  const unused = [...defined].filter((t) => !used.has(t) && !setFromJs.has(t))
  assert.deepEqual(unused, [], `token chỉ khai báo mà chẳng dùng: ${unused.join(', ')}`)
})

test('bộ font của app là đúng ba token, không có --body', () => {
  for (const f of ['--font', '--mono', '--display']) {
    assert.ok(defined.has(f), `thiếu font token ${f}`)
    assert.ok(used.has(f), `${f} được định nghĩa nhưng không quy tắc nào dùng`)
  }
  assert.ok(!/--body\b/.test(css),
    '--body chưa từng tồn tại ở đây: dùng var(--font) cho chữ UI, var(--mono) cho số')
})

test('token do JS gán phải được CSS đọc lại', () => {
  /* Nguoc lai voi loi o tren: JSX ghi `style={{ '--pc': ... }}` cho mot thu
     CSS khong con doc nua (xay ra that voi .pay-panel cua PaymentMethods) —
     khong loi hinh anh nhung la ma tue: nguoi doc sau tin rang co mot dai mau
     dang chay, trong khi khong. Xoa ben ghi, hoang dinh nghia ben doc. */
  const unread = [...setFromJs].filter((t) => !used.has(t))
  assert.deepEqual(unread, [],
    `JS gán ${unread.join(', ')} nhưng không quy tắc CSS nào đọc var() — hoặc thêm rule, hoặc xoá prop`)
  assert.ok(setFromJs.size >= 4, `scanner phải bắt được các token JS gán (được ${setFromJs.size})`)
})

````

## `5-oxlintrc.json`

````
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": [
    "react",
    "oxc"
  ],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": [
      "warn",
      {
        "allowConstantExport": true
      }
    ],
    "no-undef": "error"
  },
  "env": {
    "browser": true,
    "es2022": true
  },
  "overrides": [
    {
      "files": [
        "supabase/tests/**/*.js",
        "functions/**/*.js",
        "vite.config.js"
      ],
      "env": {
        "node": true,
        "browser": false
      }
    }
  ],
  "ignorePatterns": [
    "docs/skills/**"
  ]
}

````

