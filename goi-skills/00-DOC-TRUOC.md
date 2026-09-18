# Gửi cho AI trên web — gửi đúng file nào

Khác với agent đọc repo (Cursor/Claude Code/Codex), AI trên web **không tự mở repo được**.
Nên phải gửi tay, và nguyên tắc là: **gửi 2 thứ — (1) lời dặn, (2) file nó cần đọc.**
Đừng gửi cả repo: `src/index.css` một mình đã ~35k token, phần lớn không liên quan việc đang làm.

| Gói | Việc | Dán tin nhắn | Đính kèm |
|---|---|---|---|
| **1** | Kích thước chạm trên điện thoại | `goi-1-kich-thuoc-cham/GUI-DI.md` | 5 file trong `kem-theo/` |
| **2** | Cache tài nguyên (`_headers`) | `goi-2-cache-headers/GUI-DI.md` | 5 file trong `kem-theo/` |
| **3** | `robots.txt` + `sitemap.xml` | `goi-3-robots-sitemap/GUI-DI.md` | 2 file trong `kem-theo/` |
| **4** | Thiết kế màn mới theo ngôn ngữ hiện có | `goi-4-thiet-ke-trang-moi/GUI-DI.md` | 8 file trong `kem-theo/` (gồm 2 ảnh + 4 skill) |

**Lười đính kèm nhiều file?** Mỗi gói có sẵn `MOT-FILE-DUY-NHAT.md` — đã gộp lời dặn **và** toàn bộ
nội dung file thành 1 tệp, chỉ cần đính kèm đúng 1 file đó là xong.

| Gói | `MOT-FILE-DUY-NHAT.md` |
|---|---|
| 1 | 68 KB ≈ **17k token** |
| 2 | 12 KB ≈ **3k token** |
| 3 | 8 KB ≈ **2k token** |
| 4 | 80 KB ≈ **20k token** |

---

## Vì sao mỗi gói gửi đúng những file đó

**Luôn gửi 3 nhóm này, không hơn:**

1. **File nó sẽ sửa** — nhìn thấy code thật, không đoán.
2. **File ràng buộc sự sửa đó** — với repo này là các test quét CSS. Đây là phần **quan trọng nhất**
   và cũng là phần dễ bị bỏ sót nhất: `cssTapTarget.test.js` chốt số pixel cụ thể của bản desktop,
   `cssTokens.test.js` bắt "token khai báo mà không dùng là lỗi". Không gửi là AI viết code đúng
   nhưng repo đỏ.
3. **Số đo thật** (đã nằm trong `GUI-DI.md`, không phải file riêng) — để AI không phải đoán
   "khoảng 20-30px".

**Không gửi:**

| Thứ | Vì sao |
|---|---|
| Cả `src/index.css` (145 KB) | Gói 1 đã kèm bản trích **50 KB, giảm 64%**, chỉ gồm `:root` + rule của các control liên quan + toàn bộ `@media` bản hẹp. Bản đầy đủ vẫn có trong `kem-theo/2-index.css.day-du` — **chỉ gửi khi AI có context lớn** (>200k) hoặc khi nó hỏi. |
| `src/App.jsx` (64 KB) | Gói 3 chỉ cần `ROUTES` + logic `document.title` → đã trích thành file 9 KB ở `1-ROUTES-trich.txt`. |
| Toàn bộ 50 file skill | Mỗi gói cần **tối đa 1–4 skill**, và chỉ gói 4 cần. Các gói 1–2–3 không cần skill: luật chơi của repo (test) mới là thẩm quyền. |
| `package-lock.json`, `node_modules`, `HUONG-DAN.md` (151 KB), `.docx` | Không liên quan, tốn context. |

---

## Cách dùng từng gói

### Gửi thế nào

1. Mở chat AI (ChatGPT / Claude / Gemini / bất kỳ), **tạo cuộc trò chuyện MỚI** cho mỗi gói —
   đừng dồn nhiều việc vào một chat, AI sẽ lẫn ngữ cảnh.
2. Dán nội dung `GUI-DI.md` vào ô tin nhắn.
3. Đính kèm các file trong `kem-theo/` (gói 4 nhớ đính kèm **2 ảnh PNG** — để AI thấy ngôn ngữ thị giác).
4. Gửi.

### Nhận kết quả rồi làm gì

| Gói | AI trả về | Bạn làm gì |
|---|---|---|
| 1 | Danh sách test cần thêm + đoạn CSS kèm **số dòng của file gốc** | Gửi lại cho tôi (hoặc agent local) để chèn đúng chỗ rồi chạy `npm test` |
| 2 | Nội dung `public/_headers` | Tự tạo file, `npm run build`, push, rồi chạy `curl -sI` kiểm tra |
| 3 | `robots.txt` + `sitemap.xml` + 1 dòng cho `index.html` | Tự tạo file, push, kiểm tra bằng `curl` |
| 4 | Direction card + cây JSX + CSS + nhánh media + bảng tự soát | Đưa cho tôi (hoặc agent local) để dựng thật + chạy test |

### Nếu AI trả lời lệch

Nhắc lại bằng 1 câu:

| AI hay mắc | Nhắc |
|---|---|
| Đổi màu bằng mã trực tiếp thay vì token | "Màu chỉ qua token trong `:root`; thêm token mới thì phải dùng nó — có test bắt lỗi." |
| Tự viết `-webkit-backdrop-filter` | "Không được — lightningcss sẽ xoá bản chuẩn và Firefox mất sạch lớp kính." |
| "Nới hết mọi nút dưới 44px cho nhanh" | "Không quét hàng loạt — theo đúng khuôn hợp đồng trong `cssTapTarget.test.js`, chọn tay từng control." |
| Nới cả trên desktop | "Bản desktop phải giữ nguyên từng pixel — test đã chốt số cho bản desktop." |
| Thêm thư viện / GSAP / WebGL | "Không thêm gì. Chỉ CSS thuần, animate `opacity` + `transform`." |
| Viết lại cả file CSS 2400 dòng | "Chỉ đưa đoạn cần chèn kèm số dòng, đừng viết lại cả file." |

---

## Cập nhật gói khi code thay đổi

```bash
bash tools/dong-goi-gui-agent.sh /đường/dẫn/tới/chaereve
```

Script gom lại `kem-theo/` từ repo hiện tại (nên bản trích CSS, danh sách file, ảnh chụp luôn khớp
với code đang có). File `GUI-DI.md` — phần lời dặn — **không** bị script sửa, nên chỉnh tay được
thoải mái.

---

## Chat hay Agent? Chọn cái nào cho việc nào

| Việc | Nên dùng |
|---|---|
| Sửa vài con số CSS, chạy test, build, deploy | **Agent đọc repo** (Cursor / Claude Code / Codex) — nó tự sửa file và tự chạy `npm test`. Xem `prompts/02-CAI-SKILL-VAO-REPO.md` |
| Nhờ tư vấn thiết kế, viết CSS mới, soát lại logic | **AI trên web** (gói này) — rồi đưa kết quả cho agent local áp |
| Việc chạy dài, nhiều bước, cần build/deploy liên tục | **Agent local** — chat web không chạy được lệnh |
