# Phương án làm lại phần Thanh toán — 2026-11-15

**Trạng thái:** ĐỀ XUẤT — chưa code. Mockup trực quan: [`mockups/payment-redesign.html`](../mockups/payment-redesign.html)
**Phạm vi:** Panel “Paid request / chuyển VietQR / PayPal” trong My activity (`OrderPayment.jsx`) + luồng mua vote dùng chung (`PaymentMethods.jsx` qua `ActionModal.jsx`).
**Quyết định đã chốt với chủ dự án (2026-11-15):**

| # | Câu hỏi | Chốt |
|---|---------|------|
| 1 | Phạm vi nhánh này | **Chỉ dựng phương án** (tài liệu + mockup). App chưa đổi dòng code nào. |
| 2 | Tự động đối soát | **Ưu tiên phương án miễn phí.** → Chọn **SePay gói FREE (0₫, 50 GD/tháng, hỗ trợ Vietcombank)**. Chi tiết & rủi ro ở mục 6. |
| 3 | PayPal | **Giữ** PayPal.me. Phương án chỉ harden hiển thị, không đổi luồng. |
| 4 | Tài khoản nhận tiền | **Giữ tài khoản cá nhân** Vietcombank. Phương án vạch rõ rủi ro & các việc tự vệ được, không khuyên mở merchant ở giai đoạn này. |

---

## 1. Hiện trạng (từ code, không đoán)

### 1.1 Bản đồ component & dữ liệu

```
App.jsx:549 ── OrderPayment({ order })                    ← panel trong "My activity"
ActionModal.jsx:975 ── PaymentMethods(...)                 ← panel trong tab "Buy votes"
                          │
                          ▼
              src/components/PaymentMethods.jsx            ← tiles VietQR/PayPal + QR canvas + CopyRow
                          │
                          ▼
              src/lib/payment.js                           ← PAYMENT (STK, chủ TK, PayPal), vietQRPayload(), paypalPayload()
              src/lib/requestPayment.js                    ← orderReference(), orderTransferContent(), reconcileOrder()
              src/lib/db.js        ── adminOrder()          ← biên xác nhận phía client
              supabase/migrations/20261225_payment_operations.sql ── admin_order() server-side (is_admin + amount + reference)
```

### 1.2 Điểm mạnh đang có (giữ nguyên, đừng phá)

- **Biên xác nhận tiền nằm ở server**: `admin_order()` (`SECURITY DEFINER`) kiểm `is_admin()`, số tiền khớp chính xác, reference khớp canonical `PR|V + 32 hex`, chốt một-lần (`status='awaiting'→'paid'`), lock dòng bằng `FOR UPDATE` (`20261225_payment_operations.sql`). Client không thể tự đánh dấu paid.
- **Reference chống đụng**: mã chuyển khoản 22 ký tự base64url (giữ đủ 128 bit UUID, không cắt UUID) + mã canonical dài để đối soát; `normalizeReference()` nhận cả hai dạng; `referenceMatches()` chấp nhận bản app ngân hàng tự viết hoa.
- **VietQR chuẩn EMVCo dựng offline**: `vietQRPayload()` tự build TLV + CRC16, không gọi API bên thứ ba, amount + nội dung điền sẵn cho app ngân hàng.
- **Order lifecycle**: `awaiting → paid|rejected|expired`, hạn 72h (`expires_at`), index + job expire (`orders_expiry_idx`, `expire_orders()`), bucket `payment_source money|bonus` tách tiền thật khỏi thưởng (`20261224`…`20261229`).
- **Admin evidence bắt buộc**: confirm phải kèm `method + amount + reference`; client gửi thiếu → `err.paymentEvidenceRequired`; server đối chiếu lại lần hai (demo path trong `db.js` và SQL) — khách gõ nhầm không thể “được duyệt”.
- **A11y đã làm đúng**: `<details>/<summary>` + `aria-controls`, `useId`, trả focus về nút mở khi đóng, `aria-live` cho trạng thái copy, `prefers-reduced-motion`.

### 1.3 Ảnh chụp hiện tại (vấn đề nhìn thấy)

Panel “Paid request” trong ảnh chụp: header + pill, **hai** nút “Hide payment” (đầu và cuối panel), tile VietQR + tile PayPal to, QR 156px, bảng 3 dòng STK/tên + copy từng dòng, `Transfer reference` đặt **trên** tile (tách rời khỏi bảng), 2 dòng warning “Check the amount…” + “Unconfirmed orders expire…” và chân panel lại lặp “Hide payment”.

---

## 2. Vấn đề tìm thấy

### Nhóm A — UI/UX (gọn, chuyên nghiệp)

| # | Vấn đề | Bằng chứng |
|---|--------|------------|
| A1 | **Trùng lặp hành động**: “Hide payment” xuất hiện 2 lần (đầu panel + góc phải chân panel). | `OrderPayment.jsx` (summary + `.order-payment-close`) |
| A2 | **Không có “Sao chép tất cả”** — khách phải chạm copy 5–6 lần (bank, STK, tên, số tiền, nội dung). Đây là thao tác lõi của chuyển khoản thủ công. | `PaymentMethods.jsx` chỉ có `CopyRow` rời |
| A3 | **Nội dung chuyển khoản không được nhấn mạnh** — dòng dễ sai nhất lại để chung cỡ chữ với các dòng thường, nằm trong tile chi tiết chứ không cạnh QR. | `PaymentMethods.jsx` `.iv-row` |
| A4 | **QR quá to** (canvas 190 → render 156px) chiếm nửa panel; tile chọn PT 52px cao mỗi tile. Chuẩn EMVCo cần **quiet zone 4 module** — code đang `margin: 1`. | `PaymentMethods.jsx:31,67` |
| A5 | **Không có countdown** “Pay within 72h” chỉ là chữ tĩnh; người dùng không biết còn bao lâu, đơn rơi vào expired mà không hay. | `OrderPayment.jsx` (`order.windowHelp`) |
| A6 | **Hints trùng ý**: “Check the amount and reference…”, “The order updates after admin confirmation”, “Unconfirmed orders expire after 72 hours…” — 3 câu cùng một việc, rải 3 chỗ (head/foot/close). | ảnh chụp + component |
| A7 | **Trạng thái đơn sau khi chuyển không có “lối thoát” cho khách** — đã CK rồi vẫn phải tìm Telegram chụp màn hình; admin không được báo, dễ bỏ sót đơn đã có tiền về. | ảnh chụp (“Already transferred? Contact support”) |
| A8 | **Ma trận props** `showAmount/showReference/defaultMethod/awaiting/amountVnd/amountUsd…` làm 2 ngữ cảnh (mua vote draft vs đợi trả tiền) dùng chung một component nhưng khác nhãn — khó bảo trì, dễ drift. | `PaymentMethods.jsx:67`, `ActionModal.jsx:975` |
| A9 | **STK/tên/STK PayPal/email hiển thị trần** — ai cũng soi được trên màn hình (quán net, chia sẻ màn hình, lộ ảnh chụp như chính ảnh chụp này). | `PaymentMethods.jsx:112-118` |

### Nhóm B — Bảo mật & quyền riêng tư

> Quan trọng: **số tài khoản, chủ TK, PayPal.me vốn phải hiển thị cho người mua** — đó là đích nhận tiền, không thể giấu hoàn toàn bằng kỹ thuật. Mục tiêu thực tế: giảm tối đa *bề mặt lộ không cần thiết* (email cá nhân), tăng khả năng kiểm soát (đổi cấu hình, log), và triệt tiêu nhánh *giả mạo “tôi đã trả”*.

| # | Vấn đề | Mức | Bằng chứng |
|---|--------|-----|------------|
| B1 | **Repo GitHub đang PUBLIC** và `src/lib/payment.js` chứa STK, chủ TK; `tools/question-bank.config.json` chứa email cá nhân; UI còn render **cả email PayPal** (`paypal@email`). Email ≠ bí mật, nhưng để công khai vĩnh viễn trong source + hiển thị trong UI là tự mời scrape/spam/lừa đảo mạo danh (“tôi là bên thanh toán của CCL…”). | **P0** | `git` + `curl api.github.com` → `"private": false`; `payment.js:19,26`; `question-bank.config.json:16`; `PaymentMethods.jsx:116` |
| B2 | **Không rotate được đích nhận tiền mà không redeploy** — STK/PayPal là hằng số trong bundle; đổi sang STK mới = sửa code + build + deploy, và bản cũ vẫn nằm trong git history + mọi client cache. | P1 | `payment.js:14-27` |
| B3 | **Không có webhook đối soát** — admin tự gõ `amount + reference` từ sao kê. Server chặn sai số tiền/reference (tốt) nhưng admin vẫn là điểm yếu con người: mỏi mắt, duyệt nhầm đơn nhỏ, bỏ sót đơn CK đúng nhưng note sai định dạng. | P1–P2 | `SECURITY-AUDIT-2026-09-22.md` mục 2 & 4 (“keep payment confirmation manual until a signed, idempotent provider webhook…”) |
| B4 | **PayPal.me không gắn reference**: `paypalPayload()` sinh `paypal.me/<user>/<usd>USD` — không có `PR-…`, không có `invoice_id`, không có webhook nào. Tiền PayPal về là một khoản “không rõ đơn nào”; admin phải đoán bằng số tiền + giờ. Khách ghi memo thì được, nhưng không ai ép được. | P1 | `payment.js:101-104` |
| B5 | **QR margin 1 module** — sai khuyến nghị EMVCo (4 modules); một số camera/app ngân hàng quét chập chờn → khách bỏ cuộc giữa chừng hoặc nhập tay STK/nội dung → **tăng tỷ lệ CK sai nội dung** (rủi ro vận hành lớn nhất của mô hình thủ công). | P0 (rẻ) | `PaymentMethods.jsx:31` |
| B6 | **“Tôi đã chuyển khoản” không tồn tại** → khách tự khai qua Telegram cá nhân, chụp màn hình (dễ fake), admin không có kênh chính thức ghi nhận “buyer claimed”; nút này nếu làm sai (tự đổi status) sẽ thành lỗ hổng “báo đã trả là xong”. | P0 (khi thiết kế đúng) | hiện trạng ảnh chụp |
| B7 | **Notification “claimed” phải idempotent + rate-limit**, không chứa dữ liệu nhạy cảm, không tự đổi đơn — nếu triển khai sơ sài lại mở đường spam admin/notification. | P1 | hạ tầng `notifications` hiện có, `20261215_notify_requester_review.sql` |
| B8 | **STK cá nhân của chủ TK**: nhận tiền kinh doanh qua TK cá nhân → (i) rủi ro hạn mức/freeze nếu NH đánh giá hoạt động bất thường; (ii) thông tin chủ TK lộ vĩnh viễn; (iii) không e-invoice. Không thể kỹ thuật hóa hết — chỉ liệt kê để chủ nhà biết. Vietcombank SMS biến động: dưới 50.000₫ không gửi tin (đơn 20.000₫ không có SMS nhắc). | Thông tin | chính sách VCB |

### Nhóm C — Vận hành

| # | Vấn đề |
|---|--------|
| C1 | 72h expiry có job ở DB nhưng UI không hiển thị đồng hồ → khách tưởng đơn còn sống, admin phải xử lý nhiều đơn “hết hạn trong yên lặng”. |
| C2 | Không có bảng theo dõi “awaiting quá 24h → sắp hết hạn → đã expire” cho admin (có thể làm bằng truy vấn sẵn có, không cần migration). |
| C3 | Demo mode (`localStorage`) render **QR với STK thật** — STK vốn phải public nên chấp nhận, nhưng demo nên gắn nhãn “demo” rõ hơn để tránh khách mới tưởng là đơn thật. |

---

## 3. Phương án UI mới (chi tiết mockup)

Xem và tương tác tại `mockups/payment-redesign.html`. Cấu trúc đề xuất (một card duy nhất, không còn tile to):

```
┌──────────────────────────────────────────────────────────────┐
│ Thanh toán chuyển khoản                        ← eyebrow     │
│ ┌───────────────────────┐  ┌───────────────────────────────┐ │
│ │ SỐ TIỀN CHUYỂN        │  │ ● Chờ xác nhận · còn 46h 32m  │ │ ← pill --queued + countdown thật
│ │ 20.000₫   ≈ $0.75     │  └───────────────────────────────┘ │
│ └───────────────────────┘                                    │
│ [ VietQR  |  PayPal ]          ← segmented control cao 34px   │
│ ┌────────┐  Ngân hàng        Vietcombank              [⧉]     │
│ │  QR    │  Số tài khoản     1050 •••• 733   [👁]     [⧉]     │ ← mask mặc định, copy = đủ số
│ │ 96px   │  Chủ tài khoản    NGO THUY KIM THU        [⧉]     │
│ │margin4 │  Số tiền          20.000 VND              [⧉]     │
│ └────────┘  ╔═ Nội dung CK ═ PR-M_3wGURaS50nYJv-zCZ9qA ═[⧉]═╗ │ ← nền tím nhấn, mono
│  Quét app   ╚═══════════════════════════════════════════╝    │
│  NH, điền   [⧉ Sao chép tất cả (5 dòng)]                      │ ← 1 chạm, text nhiều dòng
│  sẵn tiền+ND                                                │
│ ─── ✓ Tạo đơn ───── ● Chuyển khoản ───── ○ Admin xác nhận ── │ ← timeline 3 bước
│ Đơn tự huỷ sau 72h…   [ Tôi đã chuyển khoản ]  [ Ẩn ]         │ ← 1 hành động chính
└──────────────────────────────────────────────────────────────┘
```

### Quy tắc thiết kế

1. **Một hành động chính / màn** — “Tôi đã chuyển khoản”. “Ẩn” là ghost, cùng vị trí mọi trạng thái; không còn “Hide payment” trùng.
2. **Một khối = một việc** — bỏ tile lớn; segmented control chỉ đổi phương thức. QR shrink 156→96px nhưng **quiet zone sửa 1→4** (dễ quét hơn trên cân).
3. **Sao chép là thao tác số 1** — mọi dòng có copy; thêm “Sao chép tất cả (5 dòng)” phát sinh text:
   ```
   Vietcombank
   1050799733
   NGO THUY KIM THU
   20000 VND
   PR-M_3wGURaS50nYJv-zCZ9qA
   ```
4. **Nội dung CK là dòng nhạy cảm nhất** — highlight riêng + font mono + title đầy đủ khi hover.
5. **Trạng thái nói bằng timeline + pill**, không bằng đoạn văn: `Tạo đơn → Chuyển khoản → Admin xác nhận`; paid thì cả 3 xanh lá, pill đổi sang gold “Đã thanh toán”, panel **gập còn 1 dòng** (icon xanh + số tiền + giờ + “Biên nhận” expand).
6. **Copy giảm rủi ro nhập tay** — countdown sống (`setInterval`), aria-live báo “Đã chép…”, focus quay đúng nút mở (giữ hợp đồng a11y hiện có).
7. **Không lặp câu** — helper “Đơn tự huỷ sau 72h · admin xác nhận thủ công” **một lần duy nhất** ở foot.
8. **Responsive** — mobile: QR xếp ngang với caption, mọi nút full-width, pill xuống dòng; target ≥ 40px; contrast theo token (`--txt-3` #808b9a ≥ 4.5:1).
9. **Ngôn ngữ** — giữ song ngữ vi/en qua `src/lib/strings.js` như hiện tại (mọi chuỗi mới đều có key hai thứ tiếng).
10. **Một component `PaymentPanel`** — thống nhất “mua vote” (draft, số tiền theo gói chọn) và “paid request” (awaiting, số tiền theo đơn) qua props tường minh `{ mode: 'draft'|'awaiting', order?, pack }` — xóa ma trận `showAmount/showReference/defaultMethod`.

**Không đổi trong phương án này:** logic `vietQRPayload/paypalPayload/orderTransferContent`, boundary `admin_order()`, bucket `payment_source`, 72h expiry job, demo mode.

---

## 4. Phương án bảo mật — phân pha

### P0 — làm ngay, nhỏ, không đổi luồng tiền (kèm Phase 1 UI)

| # | Việc | Ghi chú kỹ thuật |
|---|------|------------------|
| P0-1 | **Gỡ email cá nhân khỏi UI + repo**: xoá `email` khỏi render `PaymentMethods.jsx`; `tools/question-bank.config.json` đổi email → env/placeholder. (STK & chủ TK **vẫn bắt buộc hiện** — đích nhận tiền.) | STK trong git history: **không** rewrite history cho nhanh; chấp nhận (STK vốn hiển thị cho mọi người mua). Email thì rotate được → đổi email PayPal/contact nếu muốn kín hoàn toàn. |
| P0-2 | **Mask STK mặc định** “1050 •••• 733” + nút mắt hiện/copy-full (copy vẫn đủ số). Áp dụng cả desktop lẫn mobile. | Chống lộ qua ảnh chụp/chia sẻ màn hình; người thật vẫn 1 chạm để copy. |
| P0-3 | **QR `margin: 1 → 4`**, giữ EC level `M`; thêm fallback “Mở app ngân hàng → quét QR trong ảnh” nếu `QRCode.toCanvas` lỗi. | `PaymentMethods.jsx:31` |
| P0-4 | **Nút “Tôi đã chuyển khoản” → notification cho admin**, KHÔNG đổi status. Nội dung: `{ order_id, kind, amount, ref, user_id, claimed_at }`, rate-limit 1 lần/đơn, 1 đơn chỉ tính 1 claim, type mới `order_claim` (đi cạnh `paid_request_review` sẵn có). Admin thấy badge “Khách báo đã CK” trong Orders tab. | Cần: 1 RPC `claim_order_transferred(p_order_id)` (security definer, kiểm chủ đơn + awaiting + chưa claim) + 1 index unique `(order_id, type)` — migration nhẹ ~40 dòng, kèm pglite test theo khuôn `supabase/tests/`. |
| P0-5 | **Payload VietQR giữ nguyên** — đã chứa đủ `amount + nội dung`, không rò thêm thông tin nào ngoài đích nhận. | — |

### P1 — cấu hình hoá & tự vệ (trước/sau Phase 1, không phụ thuộc nhau)

| # | Việc |
|---|------|
| P1-1 | **Config nhận tiền rời bundle**: đưa `PAYMENT` ra bảng `settings` (key `payment`, `jsonb`, RLS: SELECT public-read không chứa contact nếu tách riêng row `payment.public`) hoặc tối thiểu `import.meta.env.VITE_PAY_BANK_*` + validate build fail-fast. → Đổi STK **không cần sửa code**, chỉ update row/env + deploy tĩnh nhanh. (Vẫn public trong bundle — đúng bản chất “đích nhận tiền”, nhưng hết hardcode trong source + hết PII dư thừa.) |
| P1-2 | **PayPal chỉ hiện `paypal.me/<user>` + memo bắt buộc** (mono, nút copy riêng, ghi chú “PayPal không tự gắn mã đơn — thiếu memo coi như không đối soát được”). Bỏ hoàn toàn dòng email khỏi màn hình. Link `rel="noreferrer noopener"`. |
| P1-3 | **Support channel tách khỏi cá nhân**: giữ Telegram nhưng nên tạo chat/bot riêng cho “thanh toán” (hoặc nhóm hỗ trợ) thay tài khoản cá nhân; ghi rõ SLA (“admin xử lý trong giờ làm việc”). |
| P1-4 | **Nhật ký claim**: `order_claim` notification lưu vào `adminLog` (bảng sẵn có) — truy được ai báo, lúc nào; khi SePay bật, tự đối chiếu claim ↔ giao dịch thực. |
| P1-5 | **Kiểm tra regression bảo mật**: thêm test “UI không chứa chuỗi email PayPal / không log reference”; test mask STK; cập nhật `PaymentMethods`/`OrderPayment` test hiện có. |

### P2 — Giai đoạn 2: tự động đối soát QR chuyển khoản với **SePay FREE** (0₫)

User chốt “miễn phí thì chọn” → so nhanh 3 lựa chọn:

| Tiêu chí | **SePay FREE** ✅ | Casso Basic | payOS |
|---|---|---|---|
| Giá | **0₫/tháng**, 50 GD/tháng, quá gói tính phí | 0₫/tháng, 30 GD/tháng | “Miễn phí” nhưng 1.5% + 1.500₫/GD sau ngưỡng (~1.500 GD); KH phải liên kết ngân hàng hỗ trợ (Kiên Long…) |
| Vietcombank (STK hiện tại) | ✅ trong 12 NH của gói FREE | ❌ free chỉ VietinBank/MBBank | cần liên kết qua payOS — không VRCB trực tiếp |
| Cơ chế | Webhook “biến động số dư” → POST về URL của mình | tương tự | Cổng A2A: link/QR trả về + webhook |
| Xác thực webhook | **HMAC-SHA256** (header `X-SePay-Signature`, `Apikey` hoặc OAuth2) — nên chọn HMAC | API key/webhook custom | ký theo chuẩn payOS |
| Retry | Tự gửi lại tối đa 7 lần nếu không 2xx | có | có |

**→ Khuyến nghị: SePay FREE** (quy mô hiện tại vài đơn/tuần; 50 GD/tháng là dư dả; 0₫; hỗ trợ VCB; webhook + HMAC). Nếu vượt 50 GD/tháng thường xuyên → nâng STARTUP 120.000₫/tháng hoặc cân nhắc Casso Pro — quyết định sau khi đo 1–2 tháng.

**Thiết kế kỹ thuật (đúng khuôn audit 2026-09-22 — “signed, idempotent provider webhook”):**

```
SePay (biến động số dư VCB) ──POST──► functions/api/pay/sepay.js   (Pages Function, chung hạ tầng với /api/vote/cast)
                                          │
 1. Đọc body RAW (chưa JSON.parse) → HMAC-SHA256(rawBody, SEPAY_WEBHOOK_SECRET)
    so sánh timing-safe với X-SePay-Signature; sai/thiếu → 401, log, KHÔNG ghi gì.
 2. JSON.parse có kiểm soát (id, transferType, transferAmount, content, accountNumber).
 3. Lọc: transferType === 'in' và accountNumber === STK cấu hình; không khớp → 200 (ack) + bỏ qua.
 4. Idempotency: INSERT payment_events(provider='sepay', provider_event_id=id, …)
    unique index (provider, provider_event_id) — trùng thì trả 200 ngay.
 5. Đối chiếu: normalizeReference(content) → tìm order awaiting khớp mã;
    amount >= order.amount_vnd? (cho phép thừa, không cho thiếu); currency VND.
 6. Khớp 100% → RPC confirm_order_by_provider(p_order_id, p_event_id) — security definer,
    one-shot (awaiting→paid), ghi received_*, payment_reference canonical, adminLog,
    notification “Đơn của bạn đã thanh toán”. KHÔNG đụng bonus credits/requests.
 7. Không khớp / thừa tiền / thiếu reference → KHÔNG tự paid; ghi payment_events(status='unmatched')
    + notification cho admin “SePay báo có tiền nhưng không khớp đơn …” — admin xử lý tay.
 8. Trả 200 nhanh (< 300ms); xử lý nặng làm sau (hoặc đồng bộ nhưng ngắn). Endpoint không CORS,
    secret chỉ trong Pages/Wrangler env (SEPAY_WEBHOOK_SECRET), không nằm trong repo.
```

- **Bảng mới:** `payment_events (id bigserial, provider text, provider_event_id text not null, order_id uuid, raw jsonb, status text, created_at, unique(provider, provider_event_id))` — chỉ service_role/RPC được ghi/đọc.
- **RPC mới:** `confirm_order_by_provider` — cùng khuôn `admin_order` nhưng không cần `is_admin()` (caller là service_role), bắt buộc khớp reference + amount, idempotent theo `payment_events`.
- **Admin vẫn là biên cuối**: nút “Reject / Expire / Ghi paid thủ công” giữ nguyên; webhook chỉ **nâng cấp đơn khớp hoàn hảo**. Claim “Tôi đã CK” (P0-4) ↔ giao dịch thực tự khớp khi SePay bật.
- **Sandbox thử nghiệm**: SePay có môi trường test; triển khai theo feature-flag `VITE_PAY_SEPAY=on` cho badge “SePay đang bật” ở màn hình admin (không lộ ra client thường).
- **Không đụng luồng PayPal** ở giai đoạn này (đã chốt giữ).

### P3 — (tùy chọn, tương lai)

- Đối soát PayPal tự động qua **PayPal Webhooks** (`PAYMENT.SALE.COMPLETED`, verify chữ ký qua PayPal API, bind `invoice_id` = reference) — cần PayPal Business + app credentials + phí; chỉ làm khi doanh thu PayPal đáng kể.
- Mở tài khoản/hộ kinh doanh + e-invoice + VCB Smart OTP giao dịch >50k — quyết định kinh doanh, không nằm trong phạm vi kỹ thuật này.
- Dashboard admin “Đối soát”: awaiting ≤24h / 24–72h / unmatched events / claim-chưa-khớp.

---

## 5. Triển khai theo pha & ước lượng

| Pha | Nội dung | Ước lượng | Rủi ro |
|-----|----------|-----------|--------|
| **Pha 1 — UI compact + P0** | `PaymentPanel.jsx` mới (gộp `PaymentMethods` + panel trong `OrderPayment`), CSS section `.pay-panel` thay `.paytile/.iv-*` (giữ class cũ tới khi test pass), segmented VietQR/PayPal, copy-all, mask STK, QR margin 4, countdown, timeline, nút claim (P0-4 kèm migration + pglite test), gỡ email (P0-1), strings vi/en, cập nhật snapshot/unit test + `npm run build` + check-browser-compat | ~1–1.5 ngày | Thấp — thay UI, không đổi dữ liệu/luồng tiền |
| **Pha 1b — P1** | Cấu hình hoá `PAYMENT` (P1-1), dọn repo (P1-1), channel support (P1-3), tests bảo mật (P1-5) | ~0.5–1 ngày | Thấp |
| **Pha 2 — SePay** | Đăng ký SePay + liên kết VCB (cần OTP VCB của chủ TK — chủ nhà tự thao tác), Pages Function `functions/api/pay/sepay.js` + migration `payment_events` + RPC `confirm_order_by_provider` + webhook HMAC test suite + admin badge + canary 1 tuần (log-only → enforce) | ~2 ngày + thời gian đăng ký | Trung bình — webhook sai có thể tự động paid nhầm ⇒ **bắt buộc** pha “log-only” trước khi bật auto |
| **Pha 3 — tùy chọn** | PayPal webhooks / dashboard đối soát / merchant — chỉ khi có số liệu | sau | — |

**Rollout Pha 2 an toàn:** tuần 1 chỉ ghi `payment_events` + notify admin (không đổi đơn) → đối chiếu thủ công 100% → tuần 2 bật auto-paid cho đơn khớp tuyệt đối → giữ nút admin override vĩnh viễn.

**Rollback:** UI mới sau `git revert` 1 commit; webhook tắt bằng cách xoá/đổi `SEPAY_WEBHOOK_SECRET` trên Pages (route trả 401, app không đổi hành vi); migration Pha 2 chỉ thêm bảng/hàm, không sửa bảng cũ.

---

## 6. Tiêu chí nghiệm thu

**Pha 1**
- [ ] Panel desktop ≤ ~420px chiều cao; mobile ≤ ~560px; không còn nút ẩn trùng; một CTA duy nhất.
- [ ] “Sao chép tất cả” copy đúng 5 dòng; CopyRow/copy-all có `aria-live` xác nhận; hoạt động trên iOS Safari (fallback `execCommand`).
- [ ] STK hiển thị `1050 •••• 733`; nút mắt toggle được; copy luôn ra đủ 10 số.
- [ ] QR quét được bằng app VCB/MB/TPBank (margin 4, level M) — test tay bằng 2 điện thoại.
- [ ] Countdown chạy sống; hết 72h đơn tự chuyển expired do job DB hiện có (không đổi).
- [ ] “Tôi đã chuyển khoản” tạo đúng 1 notification/đơn, admin thấy ở panel Orders; đơn **không** đổi status; bấm lần 2 bị RPC từ chối.
- [ ] Không còn chuỗi email `kimtong1906@gmail.com` / dòng email PayPal trong bundle UI (`grep dist/`).
- [ ] `npm test` xanh; `npm run build` + `npm run check:browser-compat` xanh; focus trap + focus return không regression.

**Pha 2**
- [ ] Webhook thiếu/sai HMAC → 401, không ghi DB.
- [ ] Gửi trùng event SePay (retry) → chỉ 1 row `payment_events`, đơn chỉ paid 1 lần.
- [ ] Đơn CK thiếu reference → không auto-paid; admin nhận notify “unmatched”.
- [ ] Đơn CK thừa tiền → vẫn auto-paid (log chênh lệch) *(hoặc chặn — chốt khi implement)*.
- [ ] Tiền về khi đơn đã rejected/expired → **không** hồi sinh đơn; notify admin.
- [ ] Pha log-only 1 tuần: ≥95% giao dịch khớp đơn, 0 ca auto-paid sai ⇒ mới bật enforce.

---

## 7. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Chủ TK lộ (STK + tên) — vốn dĩ không tránh được | Mask mặc định; không kèm email/SĐT; khuyến nghị VCB Smart OTP / SMS OTP; không công khai thêm gì mới; nếu bị abuse → đổi STK (P1-1 cho phép không cần sửa code). |
| SePay đọc nhầm giao dịch (trùng nội dung đơn cũ) | Reference đủ 128 bit + amount khớp tuyệt đối + chỉ đơn `awaiting` trong 72h được xét; unmatched → tay. |
| Webhook giả mạo | HMAC bắt buộc, secret chỉ ở edge env, body đọc raw, timing-safe compare; IP allowlist của SePay nếu họ công bố. |
| SePay FREE 50 GD/tháng không đủ | Đo thực tế; nâng STARTUP 120k/tháng; không tự viết đọc sao kê (vi phạm điều khoản VCB & cực rủi ro). |
| Khách CK sai nội dung | QR điền sẵn + nội dung highlight + copy-all ⇒ xác suất ~0 khi quét QR; nhập tay thì admin unmatched xử lý tay như hiện nay. |
| Repo vẫn public chứa STK trong git history | Chấp nhận (STK hiển thị công khai là bắt buộc); chỉ xử lý email (P0-1). Nếu muốn tuyệt đối: bật private repo + tách deploy key — quyết định của chủ nhà. |
| Tài khoản cá nhân bị NH hạn chế vì nhận nhiều CK nhỏ lẻ | Theo dõi tần suất; khi đều ≥ 5–10 đơn/tuần hoặc NH liên hệ → chuyển business/hộ kinh doanh (P3). |

---

## 8. Việc KHÔNG làm (scope rõ ràng)

- Không đổi STK/chủ TK, không tự đăng ký SePay thay chủ nhà (cần OTP ngân hàng).
- Không bật webhook auto-paid ngay — bắt buộc giai đoạn “log-only”.
- Không tự đổi đơn sang paid từ bất kỳ nút nào phía client.
- Không ẩn hoàn toàn STK (không khả thi cho chuyển khoản); chỉ mask + copy.
- Không rewrite git history repo (rủi ro cho collaborator/CI lớn hơn lợi ích).
- Không e-invoice/merchant/PayPal Business ở giai đoạn này.

## 9. Câu hỏi mở (cần chủ nhà chốt)

1. **SePay đăng ký bằng gì** — VCB Digibank cá nhân + Smart OTP? SePay cần liên kết qua app của họ; bạn tự thao tác, mình cấp checklist.
2. ~~“Log-only” hay bật enforce thẳng~~ — **Đã chốt 2026-11-15: log-only**, enforce sau ≥1–2 tuần dữ liệu sạch.
3. ~~Thừa/thiếu tiền auto-paid?~~ — **Đã chốt 2026-11-15: admin duyệt tay** cho cả underpaid lẫn overpaid; chỉ matched đúng số tiền mới là tín hiệu sạch. Không bao giờ auto-paid.
4. Có muốn **đổi repo public → private** không? Nhánh này không phụ thuộc, nhưng PII đã lộ từ lâu — lời khuyên trung thực: đóng private hoặc chấp nhận STK public vĩnh viễn.
5. ~~Ngôn ngữ~~ — **Đã chốt 2026-11-15: giữ tiếng Anh** (app hiện là English-only); mockup Việt chỉ là tham chiếu bố cục.

---

## 10. File dự kiến thay đổi khi implement

```
src/components/PaymentPanel.jsx        (mới — gộp OrderPayment-panel + PaymentMethods)
src/components/OrderPayment.jsx        (dùng PaymentPanel, bỏ ma trận props)
src/components/PaymentMethods.jsx      (xoá sau khi test pass, hoặc giữ shim)
src/index.css                          (.pay-panel… thay .paytile/.iv-*, token sẵn có)
src/lib/strings.js                     (vi/en keys mới: pay.copyAll, pay.claimed, order.timeline…)
src/lib/payment.js                     (đọc config từ settings/env; xoá email khỏi export công khai)
tools/question-bank.config.json        (email → env)
supabase/migrations/20261130_order_claim.sql   (P0-4 — notification claim, optional phụ thuộc duyệt)
supabase/tests/orderClaim.pglite.mjs   (test khuôn sẵn có)
functions/api/pay/sepay.js             (Pha 2)
mockups/payment-redesign.html          (mockup đã duyệt — lưu giữ)
```

---

---

## 11. Trạng thái triển khai (2026-11-15, cùng ngày)

User duyệt full scope và chọn Arena dev sandbox làm đích. Đã làm:

- **Migration `supabase/migrations/20261230_payment_claim_sepay_log.sql`** (chưa chạy trên DB thật):
  `orders.transfer_reported_at` (ghi lần đầu), bảng `payment_events` (log-only, RLS admin-only),
  `payment_order_from_reference` / `payment_extract_reference` (giải mã mã compact + legacy),
  `report_transfer(uuid)` (idempotent, chỉ chủ đơn + awaiting + chưa hết 72h, ghi `admin_actions`
  `order_claim` đúng một lần), `sepay_record_event(jsonb, p_gate_token)` (edge-gate, đối chiếu
  số tiền + nội dung, `matched`/`underpaid`/`overpaid`/`unknown`; KHÔNG đổi trạng thái đơn).
  Đăng ký trong `tools/migration-safety.test.mjs` + `_fixtures.mjs`; test PGlite `paymentClaimSepay.pglite.mjs` 6/6 xanh.
- **Webhook `POST /api/payment/sepay`** (`worker/sepay.js` + `functions/api/payment/sepay.js`):
  header `Authorization: Apikey <SEPAY_WEBHOOK_KEY>` → RPC `sepay_record_event`. LOG-ONLY.
  Route table + `worker/pagesRoutes.test.js` (7 route API) đã cập nhật; test `worker/sepay.test.js` xanh.
  **Lệch so với kế hoạch ban đầu (HMAC-SHA256 raw body)**: dùng header tĩnh + edge-gate —
  cùng mô hình uỷ quyền spin/vote của repo, SePay hỗ trợ cấu hình header tùy ý,
  không cần service role. Cần chủ nhà duyệt lại nếu muốn đúng HMAC.
- **UI**: nút claim trong `OrderPayment.jsx` ("I’ve made the transfer" → dấu xanh "Transfer reported");
  `reportTransfer()` trong `lib/db.js` (demo parity localStorage); strings EN (chủ nhà chốt 2026-11-15 —
  app giữ tiếng Anh, mockup chỉ còn là tham chiếu bố cục/màu); CSS `.order-claim*`.
  Đơn KHÔNG đổi trạng thái; admin vẫn là biên duy nhất.
- **Không** làm: enforce đối soát, mask STK, copy-all, countdown, swap PaymentPanel —
  giữ nguyên luồng/UI hiện có, chỉ thêm nút claim.
- **Chưa chạy** migration lên DB thật; chưa có SePay secret; repo vẫn PUBLIC (chủ nhà tự flip private).
- Preview Arena: build `npm run build` + `vite preview` :8902 (demo mode — seed localStorage).

*Soạn: 2026-11-15 · Nhánh `arena/cd8c8571-color-coded-lyrics-cf-new`*
