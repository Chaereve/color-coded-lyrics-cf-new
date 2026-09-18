# Gói 1 — Kích thước chạm trên điện thoại

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
