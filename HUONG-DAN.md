# Chaereve — Request Page (Color Coded Lyrics)

Copyright © @chaereve · Tự host, miễn phí 100%.

| Thành phần | Dịch vụ | Chi phí |
|---|---|---|
| Frontend React + Vite | Vercel Hobby | 0đ |
| Database + Auth + Realtime | Supabase Free | 0đ |
| Đăng nhập Google | Google Cloud OAuth | 0đ |

---

## Luật chơi đã cài sẵn

| Quy tắc | Giá trị | Chỉnh ở đâu |
|---|---|---|
| Vote miễn phí | **3 / ngày** (reset 0h giờ VN) | `schema.sql` hàm `my_vote_status` |
| Daily Spin | **2 lượt / thiết bị / ngày**, đồng thời tối đa **2 lượt / tài khoản / ngày** (0h giờ VN) | `migrations/20260907_daily_spin.sql` |
| Daily Spin edge | tối đa **5 fingerprint / IP / ngày**, vượt thì khoá IP tới hết ngày; fingerprint hết lượt bị chặn ở Edge | `worker/shield.js` + `functions/api/` (Pages, đường chính thức) |
| Request | **3 / giờ / tài khoản** | `schema.sql` hàm `create_request` |
| Paid Request | **$0.75 · 20.000đ** — duyệt ngay, bỏ qua vote | `db.js` → `PAID_REQUEST` |
| Up next | **khoá vote** (cả vote thêm lẫn rút lại) + khoá xoá của user | `schema.sql` hàm `cast_vote` / `delete_my_request`, cột `requests.picked_at` |

### Bảng giá vote

| Gói | USD | VND | Đơn giá | Tiết kiệm |
|---|---|---|---|---|
| 3 vote | $0.49 | 13.000đ | 4.333đ / vote | −14% |
| 10 vote | $1.29 | 34.000đ | 3.400đ / vote | −32% |
| 30 vote | $2.99 | 78.000đ | 2.600đ / vote | −48% (tiết kiệm nhất) |
| Mua lẻ | $0.19 / vote | 5.000đ / vote | — | chọn 1–100 vote |

Quy đổi theo tỷ giá **1 USD ≈ 26.100đ**, làm tròn đến nghìn gần nhất.
Đổi giá: `src/lib/db.js` → `VOTE_PACKS`, `SINGLE_VOTE`, `PAID_REQUEST`, `USD_VND`.

Ba chỗ đó phải khớp nhau, và nay có máy giữ: `src/lib/priceRate.test.js` kiểm
`vnd = round(usd × USD_VND / 1000) × 1000` cho từng gói, cho mua lẻ và cho Paid Request.
Sửa `usd` mà quên `vnd` là `npm test` đỏ ngay và in ra con số đúng — trước đây `USD_VND`
chỉ nằm trong một câu chú thích, không dòng code nào đọc, nên hai vế lệch nhau bao lâu
cũng không ai biết.
Nhớ sửa cả `schema.sql` (hàm `create_request`, dòng `values (v_uid, 'paid_request', 0, 0.75, 20000, r.id)`)
— giá Paid Request được ghi ở phía database để người dùng không sửa được bằng công cụ dev.

Hết vote miễn phí → dùng **vote credits (bonus Daily Spin trước, vote đã mua sau)**. Rút lại vote thì được **hoàn lại** lượt đã tiêu (vào vote đã mua).

**Paid Request không bị chặn bởi giới hạn 3 request/giờ** và cũng không tính vào hạn mức đó.
Người dùng gửi bao nhiêu Paid Request cũng được, lúc nào cũng được. Chỉ request miễn phí
mới bị đếm. Kiểm tra nằm trong hàm `create_request` của `schema.sql`, không phải chỉ ở giao diện.

**Một người vote được nhiều lần cho cùng một request.** Bấm vào nút vote sẽ mở
một **bảng nhập số lượt** chứ không phải cộng từng cái một:

- Nhập số, hoặc bấm `−` / `+`, hoặc bấm **"Dùng hết N"** để dồn toàn bộ lượt còn lại.
- Nhập quá số lượt đang có thì hiện **cảnh báo đỏ ngay trong bảng** và khoá nút xác nhận —
  không cho gửi đi rồi mới báo lỗi.
- Hết sạch lượt thì bảng đổi thành lời mời mua thêm, kèm nút đi thẳng tới khu thanh toán.
- Nút **"Rút lại N lượt"** nằm góc trái dùng **chung ô nhập** với nút vote, nên rút nhiều
  lượt một lần cũng được. Có nút **"Rút hết N"** để điền nhanh. Hoàn đúng loại lượt đã
  tiêu (miễn phí hay đã mua).
- Dòng ngay dưới ô nhập luôn hiện **cả hai giới hạn**: `Bạn còn X lượt · rút lại được Y`.
  Nhập vượt cái nào thì đúng nút đó bị khoá, và khung cảnh báo liệt kê từng lý do.

Nút vote trên mỗi dòng hiện tổng số vote, kèm huy hiệu `×N` là số lượt của riêng bạn.

Về phía database, hàm `cast_vote` nhận `p_delta` là số nguyên bất kỳ trong khoảng ±100
và xử lý **trong một giao dịch duy nhất**: tính xem cần bao nhiêu lượt miễn phí, bao nhiêu
lượt đã mua, trừ credit, rồi chèn đủ số dòng bằng `generate_series`. Không phải gọi API
nhiều lần, nên không có chuyện trừ được một nửa rồi lỗi.

---

## Daily Spin — vòng quay thưởng vote

Mục **Daily Spin** trong sidebar có đường dẫn riêng **`/daily-spin`**. Khối *Your votes*
ngoài bảng yêu cầu cũng có nút đi tới vòng quay. Giao diện giữ tiếng Anh như phần còn lại
của app; chữ nằm trong nhóm `spin.*` / `err.spin*` của `src/lib/i18n.jsx`.

### Giao diện gọn

Khối Daily Spin chia **ba dải**. Dải đầu là tên mục (kèm nhãn demo khi không có Supabase) và
**đồng hồ đếm tới lần reset** — một chip bo tròn nằm ngang tiêu đề, không còn chôn dưới khối
luật. Dải giữa là sân khấu hai cột: bên trái là vòng quay với **nút Spin và ô kết quả đặt ngay
dưới bánh xe** (hành động đi cùng thứ nó điều khiển); bên phải là một thẻ trạng thái gồm số
lượt còn lại kèm thanh hai vạch, số dư, ba dòng luật và bảng xác suất. Dải cuối là
*Today's rewards* và nút *Use votes*. Dưới 880px ba dải xếp dọc: vòng quay trước, nút Spin bám
ngay dưới bánh xe, thẻ trạng thái rồi lịch sử.

Vòng quay dùng các màu surface tối, cỡ chữ/viền/nút cùng bộ giao diện của bảng request.
**Luật rút vẫn là 16 ô bằng nhau** (server rút đều trên 16 ô, 22,5° mỗi ô), nhưng **bản vẽ gom
các ô cùng thưởng thành một dải liền**: chín ô `+1` nằm cạnh nhau thành một vùng, và mỗi dải
chỉ in số thưởng **một lần** ở ô giữa dải, kèm số ô của dải (`+1 ×9`, `+2 ×4`, `+3 ×2`, `+5`).
Trước đây mỗi ô in một số nên trên đĩa có **chín số 1 giống hệt nhau** — đúng lỗi "trùng lặp
số vote". Màu lát đi theo **mức thưởng** (một tông cho một mức, sáng dần theo độ hiếm), nên
nhìn là biết vùng nào đáng hơn; ô jackpot +5 dùng màu nhấn của website với số to hơn và vẫn
nằm chính giữa 6 giờ. Vành ngoài là một dải phẳng
viền hairline, các ô ngăn nhau bằng nan tối để 16 ô mỏng vẫn tách bạch; kim chỉ đủ lớn để chạm
vào ô đang trỏ và rung nhẹ khi các ô lướt qua. **Không có logo ở tâm**, không slogan, không đèn
viền, không nền gradient. Khi bánh xe dừng, ô trúng được viền sáng còn các ô khác hạ sáng để
mắt thấy ngay kết quả; ô kết quả dưới nút Spin giữ chiều cao cố định nên không đẩy bố cục.
Thẻ trạng thái kết thúc bằng **Today's rewards** — phần thưởng hôm nay của chính người xem
kèm nút *Use votes* ngay cạnh tiêu đề, mỗi dòng mang màu của mức thưởng (dòng trúng jackpot
nổi bật hẳn), và một dòng **tổng hôm nay** cộng từ chính danh sách đó. Khối xác suất dạng bảng
vẫn không quay lại giao diện: bánh xe (dải + số ô) và dòng tóm tắt ở đầu khối đã nói đủ.
Số dư/lịch sử trên trang chỉ hiện phần thưởng mới khi vòng quay dừng; database vẫn cộng thưởng
ngay trong transaction, rời trang không mất thưởng.

Lớp nền loang chung `.bgfx` được tắt riêng cho Daily Spin bằng `html[data-section="spin"]`
trong **CSS chính**, không chỉ xoá gradient ở component con. `App` cập nhật chế độ theo mục
trước khi vẽ, kể cả tải trực tiếp `/daily-spin`, đổi mục hoặc Back/Forward. Khung quay dùng nền
đặc `--surface`, không xuyên nền và không có hiệu ứng sheen trên nút Spin. Các mục khác giữ
nguyên nền hiện có.

Luật hiển thị cho người dùng gói trong ba dòng:
- 2 lượt/ngày cho mỗi tài khoản và thiết bị.
- Reset 00:00 (GMT+7).
- Vote bonus reset vào cuối tháng 10; vote đã mua không hết hạn.

Chi tiết định danh trình duyệt, lỗi mạng và bảo mật dành cho chủ website nằm ở hướng dẫn này
và trang Privacy, không chèn thành đoạn giải thích dài cạnh vòng quay.

### Ô thưởng được đề xuất và cài sẵn

**16 ô bằng nhau**, theo chiều kim đồng hồ từ ô trên cùng:
**1 · 2 · 1 · 3 · 1 · 1 · 2 · 1 · 5 · 1 · 2 · 1 · 3 · 1 · 2 · 1 vote** — ô +5 duy nhất nằm đối
diện kim, ở vị trí 6 giờ.

| Thưởng mỗi lần | Số ô | Xác suất |
|---|---:|---:|
| +1 vote | 9 | 56,25% |
| +2 vote | 4 | 25% |
| +3 vote | 2 | 12,5% |
| +5 vote | 1 | 6,25% |

- Server rút thăm **đều trên 16 ô** (256 chia hết cho 16 nên một byte ngẫu nhiên không lệch ô
  nào), nên **diện tích ô người chơi thấy chính là xác suất thật** — không có ô mỏng trả thưởng
  như ô dày. Không có ô trượt; không thu phí hoặc trừ vote để quay.
- Trung bình **1,75 vote/lượt**, tương đương **3,5 vote/ngày** nếu quay đủ hai lần; tối đa 10.
  So bản 8 ô cũ (2 vote/lượt, 4 vote/ngày): jackpot +5 hiếm đi một nửa (12,5% → 6,25%), còn
  các giải nhỏ gần như giữ nguyên — người chơi vẫn trúng đều mỗi lượt nhưng quỹ vote phát ra
  mỗi ngày bớt hao hơn.
- Muốn đổi tỉ lệ: sửa mảng trong `daily_spin_prizes()` của migration 20260908 và `SPIN_REWARDS`
  trong `src/lib/dailySpin.js` cho khớp (test bắt hai bên giống nhau từng số). Số ô phải là
  ước của 256 để phép rút thăm không lệch; thứ tự ô trong mảng chính là thứ tự trên bánh xe.
- Vote thưởng cộng vào ví riêng `profiles.bonus_credits` của **tài khoản đang đăng nhập**,
  tách khỏi `profiles.vote_credits` (vote đã mua). Giao diện hiển thị **Purchased** và
  **Bonus** thành hai dòng riêng; `credits` vẫn là tổng của hai ví.
- Khi vote, dùng 3 lượt miễn phí trước, rồi trừ **bonus trước**, thiếu mới đến vote đã mua.
  Rút vote hoàn về vote đã mua, **không hoàn lượt quay**. Bonus không hết hạn lúc nửa đêm —
  nó chỉ được reset về 0 vào cuối tháng 10 (xem migration `20261031_bonus_reset`).
- Chỉ lượt quay reset lúc **00:00 Asia/Ho_Chi_Minh (GMT+7)**; lượt chưa dùng không cộng dồn.

### Giới hạn thiết bị: phạm vi thực sự

**Đổi tài khoản không reset lượt quay trong cùng trình duyệt.** Ví dụ: A quay 1 lần,
đăng xuất, B đăng nhập và quay 1 lần → cả thiết bị đã hết 2 lượt hôm nay. Cũng không thể
quay 2 lần bằng một tài khoản trên điện thoại rồi lấy thêm 2 lần trên máy tính.

Website không có quyền lấy một mã phần cứng bất biến. Trong tính năng này, “thiết bị” là
**một định danh trình duyệt do server cấp**, lưu độc lập với phiên đăng nhập:

- Local storage: `ccl.spin.device.v1`; bản sao cookie first-party: `ccl_spin_device_v1`.
  Cookie có `SameSite=Lax`, `Secure` trên HTTPS, thời hạn một năm được gia hạn khi dùng.
- Đăng xuất không xoá hai giá trị này. Xoá riêng một kho thì bản còn lại khôi phục định danh.
- Token ngẫu nhiên 256 bit; database chỉ lưu SHA-256 của token. Token tự bịa không được nhận.
  Server giới hạn một tài khoản đăng ký tối đa 5 trình duyệt/ngày để giảm spam bảng định danh.
- **Xoá toàn bộ dữ liệu web, dùng trình duyệt/profile khác hoặc ẩn danh kèm tài khoản mới
  vẫn có thể được nhận là thiết bị mới.** Người gọi API tuỳ chỉnh cũng có thể xin token mới;
  token do server cấp không phải bằng chứng phần cứng. Không quảng cáo đây là chống gian lận 100%.
- Không dùng IP làm thiết bị (sẽ khoá nhầm người chung Wi-Fi). Fingerprint chỉ được dùng
  **công khai ở tầng Edge** làm tín hiệu chống farm (xem mục *Lá chắn Edge* bên dưới), không
  dùng để theo dõi giữa các website. Cả hai đều được nêu ở `/privacy.html#daily-spin`.
- Nếu cần chống farm mạnh hơn: cần thiết kế thêm xác minh thiết bị/attestation phù hợp nền tảng,
  xác minh tài khoản hoặc dịch vụ chống gian lận. Fingerprint/CAPTCHA riêng lẻ cũng không chứng
  minh tuyệt đối “một máy vật lý”. Bản hiện tại không giả vờ cung cấp bảo đảm đó.

### Có siết được việc xoá dữ liệu / đổi trình duyệt không?

**Có thể giảm gian lận, không thể cam kết hai lượt cho đúng một máy vật lý chỉ bằng web.**
Các phương án dưới đây là **đề xuất, chưa được tích hợp/bật**; bản sửa giao diện không âm thầm
thêm fingerprint, thu số điện thoại hay thay đổi hạn mức đang có.

| Phương án | Giúp được gì | Đổi lại / giới hạn |
|---|---|---|
| **Turnstile + rate limit fingerprint/IP tại Edge (ĐÃ BẬT khi deploy Pages — xem mục *Lá chắn Edge*)** | Chặn bot và farm tool trước khi chạm database | Không chứng minh một thiết bị vật lý; người thật đổi acc/browser vẫn có thể lách hạn mức tài khoản |
| Fingerprint có xác minh phía server | Bổ sung tín hiệu nhận diện khi mất cookie | Có sai số, có thể thêm phí và yêu cầu về quyền riêng tư; không gộp mọi browser trên một máy |
| **OTP điện thoại + 2 lượt/số đã xác minh/ngày**, giữ cả hạn mức cũ | Cùng số điện thoại không được thêm lượt khi đổi Google account hoặc browser | Thêm bước xác minh, có thể phát sinh phí SMS; người có nhiều số vẫn có thể có nhiều hạn mức |

Tài liệu Fingerprint nêu rõ ID trên web là **ID của browser**: Chrome, Safari, Firefox trên
cùng máy có thể nhận các ID riêng, khác với SDK native. Không quảng cáo Fingerprint Pro là
cách khoá cứng phần cứng. [2](https://docs.fingerprint.com/docs/mobile-identification)
Việc nhận diện không dựa trên cookie có thể nhận nhầm hai người là một hoặc bỏ sót người cũ.
[5](https://docs.fingerprint.com/docs/identification-accuracy-and-confidence)

Nếu thêm Turnstile, phải xác minh token ở **server** bằng Siteverify; widget trên trang/login
không tự bảo vệ API quay. [1](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
Trong kiến trúc hiện tại, lượt quay/vote đi qua cổng Edge của Cloudflare (Pages Functions —
xem mục *Lá chắn Edge* bên dưới) rồi khoá quyền gọi trực tiếp RPC của browser bằng cổng
`edge_gate`, thay vì chỉ chèn CAPTCHA vào nút Spin. Secret để ở cổng Edge,
không đặt trong biến `VITE_*`. Không áp hạn mức cứng **2 lượt/IP** vì sẽ chặn nhầm
người dùng chung mạng. IP chỉ nên là một tín hiệu để yêu cầu xác minh thêm, không là mã thiết bị.

Nếu ưu tiên chống người dùng thật tạo nhiều acc hơn sự tiện lợi, phương án cần chủ website
chọn trước là OTP điện thoại. Hạn mức theo số được xác minh phải đếm **chung các tài khoản**,
không chỉ thêm một ô nhập số hoặc một cờ `verified` do client gửi lên.

### Lá chắn Edge: Pages Functions + KV (chống farm)

Đường chính thức trên production (`chaereve.pages.dev`, nối GitHub, tự build khi push)
là **Cloudflare Pages Functions**: ba file `functions/api/daily-spin/health.js`,
`functions/api/daily-spin/spin.js`, `functions/api/vote/cast.js`. Chúng là lớp vỏ mỏng —
toàn bộ logic (Turnstile, KV, uỷ quyền RPC) nằm trong `worker/shield.js` và `worker/index.js`,
hai đường Pages/Workers gọi chung nên không trôi lệch nhau (test
`worker/pagesRoutes.test.js` khoá điều này). File `wrangler.jsonc` chỉ còn là phương án thay
thế cho ai deploy bằng `wrangler deploy`.

Khi đã bật, mỗi lượt quay đi thêm một cửa trước khi chạm Supabase:

```
Client: FingerprintJS (mã nguồn mở) → sha256 = fp_hash
        Turnstile widget hoàn toàn ẩn (appearance: execute) → token dùng một lần
        JWT phiên Supabase hiện tại
   ↓ POST /api/daily-spin/spin
Cổng:   1) siteverify Turnstile bằng secret (bot dừng ở đây)
        2) KV check xác thực kép + rate-limit (worker/shield.js)
        3) gọi RPC spin_daily BẰNG JWT của người dùng (auth.uid() vẫn đúng người)
   ↓ Supabase ghi ledger + cộng vote trong một transaction
Cổng:   4) ledger ghi thành công (và không phải replay) mới đếm lượt vào KV
   ↓ trả nguyên jsonb về client (client validate như cũ)
```

**CAPTCHA không bao giờ hiện ra khi quay/vote.** Widget Turnstile được giữ 100%
vô hình (phần tử chứa nằm ngoài viewport) — xác minh ngầm, người thật không thấy
gì và cũng chẳng phải làm gì. Nếu Cloudflare đòi một thách thức *tương tác*
(`before-interactive-callback`) nghĩa là phiên đó không xác minh ngầm được: app
**bỏ ngay lượt đó**, không vẽ bất kỳ khung CAPTCHA nào lên màn hình. Cổng trả
`err.spinCaptcha` ("Couldn't run the security check quietly. Please try again.")
— lượt chưa chạm database nên bấm quay/vote lại là chạy một vòng xác minh mới.

**Xác thực kép theo đúng bài toán Wi-Fi công cộng:**
- Trùng `fp_hash` trong ngày **và đã hết lượt** → chặn ngay ở Edge (`err.spinEdgeFp`).
  Đếm theo hạn mức sản phẩm (2 lượt) chứ không chặn ở lần thấy lại đầu tiên, nếu không
  người thật mất luôn lượt thứ hai.
- Trùng IP nhưng `fp_hash` khác → **cho phép** (người khác nhau chung mạng).
- Một IP thấy **> 5 fingerprint khác nhau trong ngày** → dấu hiệu anti-detect browser:
  khoá IP đó tới hết ngày (`err.spinEdgeIp`), fingerprint cũ quay từ mạng khác không bị vạ.

**Cấu trúc KV** (binding `SPIN_SHIELD`, giá trị JSON nhỏ, tự hết hạn lúc **00:00 giờ VN**
bằng `expirationTtl` để trùng ngày với ledger thay vì TTL 24 giờ trôi nổi):
- `fp:<sha256 fingerprint>` → `{ d: ngày, used: số lượt }`
- `ip:<CF-Connecting-IP>` → `{ d: ngày, fps: [fp đã thấy], blocked: 0|1 }`

KV **chỉ chắn spam**: hạn mức và tiền thưởng vẫn do unique slot của Postgres quyết định,
nên đếm thiếu/đủ ở Edge không bao giờ tự cấp thưởng. Lượt quay lỗi mạng không bị đếm
vì chỉ commit KV sau khi RPC thành công. Cổng không cầm service role — nó uỷ quyền RPC
bằng JWT của chính người quay, nên không thể thưởng cho ai khác.

**Vì sao `/api/*` không bị SPA fallback nuốt.** `public/_redirects` vẫn là
`/* /index.html 200` cho client-side routing, nhưng Pages cho **Functions chạy trước** —
chỉ đường nào không khớp Function mới rơi xuống file tĩnh/redirect. Nên `/api/*` khớp
Function thì trả JSON, các đường còn lại vẫn về `index.html`. File `public/_routes.json`
(`include: ["/api/*"]`) khoá thêm một lớp: chỉ request `/api/*` mới gọi Functions runtime
(vừa chắc chắn, vừa không tốn quota Functions cho file tĩnh — gói free giới hạn 100.000
request Functions/ngày). Đừng xoá file đó, và đừng thêm Function ngoài `/api/*` mà quên
nới `include`.

**Bật trên project thật (làm hết bằng Dashboard, không cần CLI). Thứ tự quan trọng** —
làm sai thứ tự là hỏng nút Spin/Vote của người thật:

1. **Chạy SQL trước.** Dán toàn bộ `supabase/migrations/20261103_vote_hardening.sql`
   vào **Supabase → SQL Editor → Run** (chạy lại an toàn, không xoá dữ liệu). Kiểm tra:
   `select * from public.edge_gate;` — chạy được, trả một dòng `token_hash` null là đạt.
   Chưa chạy file này thì `cast_vote`/`spin_daily` bản mới chưa tồn tại, cổng gọi vào sẽ lỗi.
2. **Merge + deploy code.** Merge nhánh này là Pages tự build lại (đã có sẵn `functions/`).
   Chưa cần đặt biến gì vội — app chưa trỏ vào cổng nên vẫn chạy như cũ.
3. **Tạo KV.** **Cloudflare Dashboard → Workers & Pages → KV** (menu trái) →
   **Create a namespace** → tên `SPIN_SHIELD` → **Add**. Rồi vào project Pages
   (**Workers & Pages → tên project → Settings → Bindings**, mục **KV namespaces** →
   **Add binding**): *Variable name* `SPIN_SHIELD`, *Namespace* chọn `SPIN_SHIELD` vừa tạo,
   tick cả **Production** lẫn **Preview** → **Save**. Thiếu binding ở môi trường nào là
   cổng ở môi trường đó trả 503 (`err.spinSetup`) — app tự rơi về gọi thẳng RPC chứ không
   chết, nhưng lá chắn coi như chưa bật.
4. **Đặt secret + biến.** Cùng trang **Settings → Environment variables** (bản dashboard
   mới ghi là **Variables and Secrets**) → **Add variables**, mỗi biến tick cả
   **Production** lẫn **Preview**:
   - `TURNSTILE_SECRET_KEY` (loại **Secret** — lấy ở Cloudflare Dashboard → Turnstile →
     widget của site → Secret key; khác với Site key công khai trong `.env`),
   - `SUPABASE_ANON_KEY` (loại **Secret** — khoá công khai trong Supabase → Settings →
     API Keys),
   - `SUPABASE_URL` (loại **Plaintext** — không phải bí mật, ví dụ
     `https://<project-ref>.supabase.co`).
   Xong vào **Deployments → ⋯ ở bản mới nhất → Retry deployment** để bản mới nhận
   binding/biến (đổi biến xong không deploy lại là cổng vẫn chạy cấu hình cũ).
5. **Tự kiểm tra health.** Mở `https://<domain-thật>/api/daily-spin/health` trên trình
   duyệt (hoặc `curl`): phải thấy JSON `{"ok":true,"shield":true,"gate":false}`.
   - Thấy **HTML của trang web** = Functions chưa chạy (deploy thiếu `functions/` hoặc
     mất `_routes.json`) — xem mục gỡ rối bên dưới, TUYỆT ĐỐI chưa sang bước 6.
   - `"shield":false` = thiếu KV binding hoặc `SUPABASE_URL` ở môi trường đó — quay lại
     bước 3–4, nhớ tick cả Production lẫn Preview rồi deploy lại.
   - `"gate":false` ở bước này là **đúng** (cổng `edge_gate` bật sau cùng, xem mục Vote).
6. **CHỈ BÂY GIỜ mới trỏ app vào cổng.** Thêm hai biến build (Plaintext, cả Production
   lẫn Preview): `VITE_SPIN_GATE_URL=/api/daily-spin` và `VITE_VOTE_GATE_URL=/api/vote`,
   rồi **deploy lại** (biến `VITE_*` được nướng vào bundle lúc build — thêm biến mà không
   build lại thì app vẫn gọi đường cũ). Thêm hai biến này sớm, khi health còn chưa trả
   JSON, là hỏng nút Spin/Vote ngay lập tức.
7. **Thử thật.** Đăng nhập Google thật, quay một lượt và vote một lượt: phải chạy bình
   thường. Rồi mở health ở cả domain Preview để chắc hai môi trường đều xanh.

**Gỡ rối khi health trả HTML thay vì JSON:** (1) vào Pages → Deployments, mở log bản mới
nhất, tìm dòng `Found Functions directory` — không thấy là deploy từ nhánh thiếu
`functions/`; (2) kiểm tra `dist` có `_routes.json` không (Vite tự copy từ `public/`);
(3) chắc chắn đang mở đúng domain của Pages (không phải Vercel hay localhost). Nếu đã
chạy ổn mà đùng một cái health trả HTML: kiểm tra quota Functions (mặc định "Fail open"
là hết quota thì `/api/*` rơi về file tĩnh) ở **Settings → Runtime**.

Thiếu bất kỳ bước nào thì app tự chạy chế độ cũ (gọi thẳng RPC), không hỏng nút Spin.
Deploy Vercel không có cổng Edge thì bỏ hai biến `VITE_*_GATE_URL`.

### Lá chắn cho VOTE và cổng khoá cửa sau (2026-11-03)

Trước bản này, **vote đi thẳng từ trình duyệt tới PostgREST**: không Turnstile, không
fingerprint, không IP. Hệ quả là mở 10 tài khoản Google được 30 vote miễn phí mỗi ngày và
không để lại dấu vết nào để điều tra. Nay vote đi cùng đường với vòng quay:

```
POST /api/vote/cast   { request_id, delta, fp_hash, turnstile_token, user_token }
Cổng (Pages Function): siteverify Turnstile → KV đếm theo vân tay (khoá vc:, trần 120 lượt/ngày)
        → RPC cast_vote bằng JWT người dùng, kèm fp_hash + sha256(IP) + gate token
Postgres: khoá hàng profiles → tính hạn mức → ghi phiếu + trừ ví trong một transaction
```

Ba hạn mức, tất cả đều nằm ở **ràng buộc database** chứ không nằm ở logic (logic có thể bị
race, ràng buộc thì không):

| Ràng buộc | Ý nghĩa |
|---|---|
| `votes_free_quota_idx (user_id, vote_day, free_slot)` | 3 vote miễn phí/ngày cho một **tài khoản** — chặn kể cả khi bấm 10 tab cùng lúc |
| `votes_fp_free_quota_idx (fp_hash, vote_day, fp_slot)` | 3 vote miễn phí/ngày cho một **vân tay trình duyệt** — đây mới là thứ chặn farm nhiều tài khoản |
| `profiles_credits_nonneg` | ví không bao giờ âm, kể cả khi hai lượt trừ chạy song song |

Vote **đã trả tiền không bao giờ bị chặn** bởi hạn mức vân tay — người mua vote dùng bao
nhiêu tuỳ họ. `ip_hash` chỉ được **ghi lại** làm dấu vết (query C6 trong
`supabase/audit/fraud-detection.sql`), **không** dùng để chặn: 4G/CGNAT ở Việt Nam gộp rất
nhiều người thật vào một IP.

**Cổng `edge_gate` — thứ làm cho lá chắn có giá trị thật, và là BƯỚC CUỐI CÙNG.**
Turnstile và KV chỉ có ý nghĩa nếu không ai đi vòng qua chúng được; mà anon key thì nằm
công khai trong bundle. Chỉ bật sau khi Spin/Vote qua cổng đã chạy ổn định cho người thật
(health `{"ok":true,"shield":true}`, đã thử quay + vote thật). Đặt token chung cho cổng và
database để `cast_vote`/`spin_daily` từ chối mọi lời gọi không đi qua cổng:

1. **Cổng có token TRƯỚC.** Pages Dashboard → project → **Settings → Environment
   variables → Add variables**: tên `EDGE_GATE_TOKEN`, loại **Secret**, giá trị là chuỗi
   ngẫu nhiên ≥ 32 ký tự, tick cả **Production** lẫn **Preview** → **Save** → sang
   **Deployments → Retry deployment** để cổng nhận token. Kiểm tra:
   `GET /api/daily-spin/health` → `"gate":true`.
2. **Database bật SAU** (Supabase → SQL Editor):
```sql
select public.set_edge_gate_token('<đúng chuỗi ở bước 1>');   -- bật
```

Chưa đặt token = cổng **tắt**, mọi thứ chạy y như trước (an toàn khi rollback). Bật token
ở database trước khi cổng có token thì người dùng thật nhận `err.voteGate` / `err.spinGate`
— luôn làm đúng thứ tự trên.

**Tắt khẩn cấp** (người thật bị khoá, hoặc cổng đang sự cố): chạy ngay trong SQL Editor:
```sql
select public.set_edge_gate_token(null);   -- tắt, trả về hành vi cũ ngay lập tức
```
Tắt ở database là đủ — không cần động vào Pages. App (kể cả bản đã trỏ `VITE_*_GATE_URL`)
lại gọi được như cũ, chỉ mất lớp chặn đi vòng.

**Tóm lại thứ tự đầy đủ:** chạy migration `20261103` → merge code có `functions/` →
bind KV + đặt secret/biến → health trả JSON `"shield":true` → thêm
`VITE_SPIN_GATE_URL`/`VITE_VOTE_GATE_URL` + deploy lại → thử quay/vote thật → đặt
`EDGE_GATE_TOKEN`. Bỏ qua bước token cuối thì vote vẫn được siết bằng hạn mức vân tay,
chỉ là người biết dùng anon key vẫn né được Turnstile.

### Kích hoạt trên Supabase thật

1. **Project đang chạy:** vào **Supabase → SQL Editor → New query**, dán toàn bộ
   **`supabase/migrations/20260907_daily_spin.sql`**, bấm **Run**; project nào đã chạy bản đó
   rồi thì chỉ cần dán tiếp **`supabase/migrations/20260908_daily_spin_prizes.sql`** (vòng quay
   16 ô). Cả hai chạy được nhiều lần, không xoá request, vote, profile hay lịch sử quay hiện
   có. **Thứ tự quan trọng:** file 20260908 luôn chạy SAU file 20260907 — nếu chạy lại file cũ
   một mình, xác suất sẽ trôi về bản 8 ô (hàm `daily_spin_prizes()` bị ghi đè).
2. **Project mới:** `supabase/schema.sql` đã bao gồm cùng phần Daily Spin ở cuối file;
   chạy schema như hướng dẫn bình thường. Extension `pgcrypto` dùng schema `extensions`
   (mặc định của Supabase). Không cần Edge Function, cron mới hoặc biến môi trường mới.
3. Deploy frontend / tải lại trang, đăng nhập Google thật, mở `/daily-spin`.

**Chỉ cập nhật frontend là chưa đủ.** Nếu chưa chạy SQL, trang sẽ báo thiếu migration
và không cho quay; tuyệt đối không tự cộng vote giả vào trình duyệt khi Supabase lỗi.
Preview không có `.env` là **demo**, có nhãn rõ ràng và chỉ lưu dữ liệu thử trong trình duyệt.
Chạy test local không đồng nghĩa migration đã được áp dụng cho project Supabase thật.

### Cách server chống quay/cộng thưởng trùng

- `daily_spin_devices` và `daily_spins` bật RLS, không cấp đọc/ghi trực tiếp cho browser.
  RPC status chỉ trả lịch sử của người gọi, không lộ người khác dùng cùng thiết bị.
- `spin_daily` lấy người nhận bằng `auth.uid()`, kiểm tra tài khoản chưa đổi trong lúc gửi,
  khoá dòng thiết bị rồi khoá profile. Hai ràng buộc unique theo **slot 1/2 + ngày** là lớp
  chặn bổ sung cho cả thiết bị và tài khoản. Bấm nhanh, nhiều tab hoặc gọi API đồng thời
  không tạo được lượt thứ ba cho cùng định danh/ngày.
- Ngày tính bằng **đồng hồ server sau khi lấy khoá**, không tin ngày/giờ phía client.
- `pgcrypto.gen_random_bytes` chọn ô; frontend chỉ quay animation tới ô được trả về.
  Không có tham số cho phép client gửi số thưởng hay số lượt còn lại.
- Ghi lịch sử + cộng `bonus_credits` **trong cùng một transaction**: lỗi ở bước cộng tiền
  sẽ rollback luôn lượt quay. Client không có quyền PATCH credit/admin trực tiếp.
- Mỗi lần bấm có `request_id` lưu trước khi gọi API. Mất phản hồi thì giữ ID đó; nút
  **Check last spin** gửi lại cùng yêu cầu, trả kết quả cũ mà không cộng thưởng lần nữa,
  kể cả đã hết lượt hoặc qua nửa đêm. Không tự cấp lượt bù khi gặp lỗi mạng.
- Xoá tài khoản tách thông tin tài khoản khỏi ledger (`ON DELETE SET NULL`), không xoá
  các slot đã dùng của thiết bị. Chuyển mục/đóng tab giữa animation không mất vote đã cộng.

### Kiểm thử

```bash
npm test                 # tỉ lệ 16 ô khớp migration, ngày VN, góc dừng, retry, lưu định danh, bố cục giao diện, logic KV của lá chắn + test bảng cũ
npm run build
npm run lint
```

Test transaction/RLS thực bằng PostgreSQL (dependency `pg` chỉ phục vụ test, không vào bundle):

```bash
DAILY_SPIN_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:spin:db
```

Chỉ dùng **Postgres local/test**, tài khoản test có quyền tạo database và role. Script tạo
một database tạm tên `ccl_spin_test_<random>`, giả lập Auth của Supabase, chạy schema/migration
thật, rồi xoá **chính database tạm đó**. Không chạy bằng kết nối production. Khi không đặt biến
môi trường trên, `npm test` bỏ qua suite tích hợp này. Các case gồm: đổi account/device, burst
đồng thời, replay cùng ID, rollback khi cộng credit lỗi, reset năm mới theo GMT+7, xoá tài khoản,
chặn ghi thẳng bảng, và dùng/hoàn bonus qua `cast_vote` thật.

Sau deploy nên thử thêm bằng Google thật: A quay 1 lần → đăng xuất → B trên cùng trình duyệt
chỉ còn 1 lần; quay nốt → C còn 0. Mở hai tab, thử quay cùng lúc; tải lại trang khi quay;
kiểm tra tổng ví và *Today’s rewards*. Bật Reduce Motion thì kết quả hiện ngay, không quay
4,5 giây và kim không rung; trên điện thoại vòng quay không tràn ngang.

---

## Luồng của một request

```
Người dùng gửi
      │
      ├── Thường  → pending (chờ duyệt)
      │              admin Duyệt  → queued → mọi người vote
      │              admin Từ chối → denied (kèm lý do)
      │
      └── Paid    → pending + đơn hàng "awaiting"
                     admin bấm "Đã nhận tiền" → queued, ưu tiên đầu hàng chờ,
                     không cần vote
queued → (admin) in_progress + % tiến độ → completed + link video
```

### Bài đã có trên bảng? Form nói ra trước khi bạn gửi

Ngay khi gõ xong **tên bài + nghệ sĩ**, nếu bài đó đã nằm trên bảng thì form hiện một dải
gợi ý ngay dưới ô nhập: tên bài, số request và tổng số vote đã có, kèm nút **"Vote for it
instead"** — bấm là đóng form và mở thẳng hộp vote của bài đó. Bài đã làm xong rồi thì nút
đổi thành **"Already done - watch it"** trỏ ra video.

Đây là **gợi ý, không phải chặn**: người dùng vẫn gửi được nếu họ muốn (bài cũ bị từ chối,
hoặc họ muốn một bản khác) — quyết định là của họ.

Vì sao cần: một bài bị ba người gửi lẻ là gốc của cả việc *cụm 9 vote bị xếp dưới bài 5
vote* (xem `src/lib/board.js`) lẫn việc farm vote bằng nhiều tài khoản. Chặn ở ô nhập rẻ hơn
nhiều so với phát hiện rồi gộp ở tầng SQL sau khi dữ liệu đã bẩn.

### Thẻ xem trước — thấy trước khi gửi

Ngay dưới hai ô tên bài / nghệ sĩ có một **thẻ xem trước**: nó dựng đúng cái thẻ mà người
khác sẽ thấy trên bảng (nhãn loại bài + *Nghệ sĩ — Tên bài* + người gửi), cập nhật theo từng
ký tự đang gõ. Chỗ nào chưa điền thì hiện chữ mờ nói còn thiếu gì, nên tấm thẻ vừa là bản
xem trước vừa là danh sách việc cần làm.

Dán **link YouTube** vào ô link thì app nhận ra ngay và hiện **ảnh bìa của chính video đó**
trong thẻ (lấy từ `i.ytimg.com`, không cần API key và không tốn quota của gói miễn phí). Link
không phải YouTube thì chỉ được nhắc, **không chặn gửi** — người ta hay dán `youtu.be/abc`
thiếu `https://`.

### Bản nháp — gõ dở rồi lỡ đóng cũng không mất

Form request tự lưu **bản nháp** vào `localStorage` của trình duyệt (không tốn request nào,
không gửi gì lên server). Đóng hộp thoại, đổi tab, hay hết pin rồi mở lại thì chữ vẫn còn
nguyên, kèm một dòng **"Draft restored from your last visit"** và nút **Bỏ nháp** để dọn
sạch form và bắt đầu lại (bấm nút mà chữ vẫn còn thì là lỗi).

Nháp nhớ cả **bước đang đứng** và **ô "bài trả phí"**: quay lại là đứng đúng chỗ đang làm
dở, và lựa chọn trả phí hiện ra ngay ở bước 3 — chỗ nó thuộc về — chứ không phải một ô tick
nằm sẵn mà người dùng chưa từng nhìn thấy.

Ba luật của bản nháp, để không biến việc nhớ giúp thành phiền:

| Luật | Vì sao |
|---|---|
| Gửi thành công thì **xoá nháp** | Việc đang làm dở đã thành việc đã gửi; lần sau mở form ra mà thấy lại bài vừa gửi là chuyện khó hiểu |
| Nháp cũ hơn **7 ngày** thì bỏ | Nửa cái form từ tháng trước không phải là "việc đang làm dở" |
| **Link mời** (`?add=1&artist=…&title=…`) thắng bản nháp | Link mời là lời mời có chủ đích; đổ đúng thứ người gửi link muốn bạn điền |
| **Ghi ngay khi form rời màn** (đổi tab trong cùng hộp, hoặc đóng hộp), không chỉ sau 400ms ngừng gõ | Bộ đếm 400ms bị huỷ khi component bị tháo: gõ xong rồi bấm sang tab khác ngay là mất chữ vừa gõ (lỗi đã sửa — xem mục *Hộp xác nhận trong app* bên dưới, phần vòng 14) |

### Dán nguyên tiêu đề video — form tự tách ra hai ô

Cách nhanh nhất để điền form là copy nguyên tiêu đề video rồi dán vào ô tên bài. Nhưng như
vậy ô tên bài chứa cả tên nghệ sĩ, còn ô nghệ sĩ thì trống. Form nhận ra hai khuôn tiêu đề
thật và mời bạn **tách bằng một lần bấm**:

| Bạn dán vào ô tên bài | Form đọc ra |
|---|---|
| `CHUNG HA 청하 'Algorithm' MV` | nghệ sĩ `CHUNG HA 청하`, tên bài `Algorithm` (tên bài nằm trong cặp nháy) |
| `aespa - Whiplash (Official Video)` | nghệ sĩ `aespa`, tên bài `Whiplash` (nhãn `(Official Video)` bị bỏ) |
| `[4K] aespa - Whiplash` | `aespa` · `Whiplash` (nhãn ở đầu cũng bị bỏ) |
| `aespa Whiplash` | **không làm gì** — không có dấu hiệu nào thì đoán bừa còn tệ hơn để yên |

Dải gợi ý in ra hai vế nó đọc được **trước khi** bạn bấm, và đổi màu khác với dải "bài này
đã có trên bảng" để hai dải nằm cạnh nhau vẫn phân biệt được. Luật tách nằm ở
`splitSong()` trong `src/lib/board.js` và có test riêng (`npm test`, file `board.test.js`).

### Phím tắt trong form — đường đi ngắn nhất

| Phím / thao tác | Kết quả |
|---|---|
| `Enter` ở ô **nghệ sĩ** | "Xong ô này" → nhảy sang ô tên bài (không gửi) |
| `Enter` ở ô **tên bài** | Đã đủ hai ô thì **gửi luôn**; còn thiếu thì đưa con trỏ về ô nghệ sĩ |
| **Dán** một link vào ô nghệ sĩ hoặc tên bài | Link **về đúng ô Link** — không nhét một URL dài vào tên bài |

Mọi gợi ý phím trong app (`/`, `+ / −`) tự ẩn trên thiết bị cảm ứng: máy không có bàn phím
vật lý thì đừng hứa.

Phần còn lại của form giữ đúng ba nguyên tắc: lỗi hiện ngay tại ô sai (rời ô mới hiện, kèm
`aria-invalid` để trình đọc màn hình đọc được), bấm Gửi khi còn thiếu thì con trỏ **nhảy vào
ô sai đầu tiên**, và bộ đếm ký tự chỉ hiện khi đã dùng quá 70% ô.

Dò trên **toàn bộ** dữ liệu (kể cả request đang chờ duyệt và đã bị từ chối), không chỉ
những hàng đang hiện trên bảng — vì ca trùng phổ biến nhất là *chính mình gửi lại*. Gặp
trường hợp đó, dòng phụ đổi thành "1 request of yours is waiting for review" (`req.dupPending`).

Quy tắc dò **dùng đúng `groupKey`** mà bảng dùng để gom cụm (cùng tên bài + cùng nghệ sĩ,
bỏ qua hoa/thường và khoảng trắng thừa), nên câu trả lời ở form và cách bảng cộng dồn vote
không bao giờ nói hai chuyện khác nhau. Chưa đủ dữ liệu (tên bài dưới 3 ký tự, hoặc chưa có
nghệ sĩ) thì **im lặng** — gõ tới đâu cũng thấy gợi ý là cách dạy người dùng phớt lờ nó.
Luật nằm ở `findDuplicate()` trong `src/lib/board.js`, có 7 ca kiểm thử.

Người dùng tự xoá được request của mình khi ở trạng thái `pending`, `queued` hoặc `denied`
(**trừ hàng đã vào Up next** — đã chốt thì khoá cả xoá để khỏi vỡ kế hoạch làm việc).
Admin xoá được mọi request.

Hàng nào đã vào **Up next** (`picked_at` có giá trị, trạng thái `queued`/`in_progress`)
thì **không vote được nữa**: nút vote tắt (viền đứt), hàng biến khỏi tab Vote trong
modal, bảng vote hiện thông báo thay vì ô nhập số. Chặn ở **cả database** (`cast_vote`
báo `err.voteLocked`) nên không lách được bằng công cụ dev. Xong việc (`completed`)
hoặc bị từ chối (`denied`) thì hàng tự rời Up next. Admin chốt/gỡ thủ công bằng nút
**Pick for Up next** / **Remove from Up next** trong tab Đang xử lý của bảng Admin
(hàm `admin_pick`), hoặc đặt trực tiếp cột `picked_at`.

Khối **Up next** trên trang Bảng yêu cầu **luôn hiện** (kể cả khi chưa chốt request nào) để
mốc giờ chốt tiếp theo không bao giờ biến mất. Mốc giờ lấy theo thứ tự ưu tiên:
`settings.pick.next_pick_at` → `last_pick_at + interval_days` → cùng lắm hiện chữ
"every N days" (`now.everyDays` trong `src/lib/i18n.jsx`). Quá mốc mà chưa có lượt chốt mới,
chip đổi màu nhấn và hiện thêm **một chấm tĩnh** "any moment…" — đổi màu, KHÔNG nhấp nháy:
một chỗ nhấp nháy vô hạn ở góc màn hình kéo mắt khỏi danh sách mỗi 1,6 giây, trong khi
"quá mốc" đọc được bằng màu và con số là đủ. App tự hỏi lại
`settings.pick` mỗi 30 giây — vừa có mốc mới (cron chạy, hoặc admin chốt tay khi quá hạn —
trigger `pick_cycle_touch` ghi mốc) là đồng hồ đếm tiếp bình thường ngay trên tab đang mở.

### Tự động chốt request (cron)

Hàm `pick_top_request()` (trong `schema.sql` mới và `migrations/20250601_auto_pick.sql`)
chọn request `queued` nhiều vote nhất (paid trước) để chốt, rồi ghi `last_pick_at` +
`next_pick_at` vào `settings.pick` — **kể cả khi không có request nào để chốt** nên đồng hồ
đếm ngược luôn có số. Từ bản `migrations/20260907_group_top_pick.sql`, hàm xếp hạng theo
**tổng vote của cả bài** (cộng dồn các request trùng tên bài + nghệ sĩ, chỉ tính hàng còn mở
vote) rồi mới tới vote của riêng dòng — khớp đúng thứ tự tab *Top voted* ngoài trang chủ, nên
cron không còn chốt nhầm bài ít được đòi hơn chỉ vì bài kia bị xé thành nhiều request lẻ. Hàm này khoá với public, chỉ cron gọi được; admin chốt tay bằng
`admin_pick()`/`admin_pick_group()` như cũ. Hẹn giờ chạy trong Supabase:

1. **Database → Extensions** → bật `pg_cron`.
2. Chạy file `migrations/20260908_pick_cycle_fix.sql` (dán cả file vào **SQL Editor → Run**):
   nó thêm trigger `pick_cycle_touch` giữ chu kỳ luôn sống và **tự đặt lại** job
   `auto-pick-top` chạy mỗi **30 phút**. Hàm tự bỏ qua khi chưa tới kỳ
   (`interval_days`), nên đồng hồ đếm về 0 là trong vòng ≤ 30 phút sau đó lượt chốt
   tự động chạy — không phải đợi tới mốc 6 tiếng. Chưa bật `pg_cron` thì file bỏ qua
   bước đặt lịch, làm lại thủ công:
```sql
select cron.schedule('auto-pick-top', '*/30 * * * *', $$select public.pick_top_request()$$);
```
3. Chốt tay ngay khi cần: `select public.pick_top_request(true);`
4. Kiểm tra lịch: `select * from cron.job;` — xem log chạy: `select * from cron.job_run_details order by start_time desc limit 10;`
5. Đổi chu kỳ: sửa `interval_days` trong `settings.pick`, cron vẫn giữ nguyên (hàm tự đọc).

**Chốt tay quá hạn không làm kẹt đồng hồ:** trigger `pick_cycle_touch` (thêm ở
`migrations/20260908_pick_cycle_fix.sql` và trong `schema.sql`) nhận biết *bất kỳ* đường nào
đặt `requests.picked_at` (cron, admin bấm *Pick for Up next*, SQL trực tiếp). Nếu lượt đã tới
kỳ / quá hạn (`next_pick_at` trong quá khứ), trigger tự ghi `last_pick_at` + `next_pick_at`
mới vào `settings.pick` — đồng hồ nhảy sang kỳ mới ngay, không treo ở "any moment…". Chốt tay
**giữa kỳ** (trước giờ chốt tự động) thì **không** dời lịch của mọi người.

**Truy vấn nhanh khi đồng hồ "Next pick" đứng im** (dán vào SQL Editor):

```sql
-- Xem chu kỳ đang lưu: next_pick_at trong quá khứ = đang kẹt
select value, updated_at from public.settings where key = 'pick';
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

Nếu `next_pick_at` đã qua mà lượt chốt gần nhất đã có bài được chốt (admin chốt tay
trước khi có bản sửa này), dời mốc từ lần chốt thực tế gần nhất — đồng hồ đếm lại ngay,
không bị cron chốt bù hai lượt sát nhau:

```sql
update public.settings s
   set value = s.value || jsonb_build_object(
         'last_pick_at', x.last_pick,
         'next_pick_at', x.last_pick + make_interval(days => coalesce((s.value->>'interval_days')::int, 4))),
       updated_at = now()
  from (select max(picked_at) as last_pick
          from public.requests
         where picked_at is not null
           and status in ('queued', 'in_progress')) x
 where s.key = 'pick'
   and x.last_pick is not null
   and coalesce((s.value->>'next_pick_at')::timestamptz, '-infinity') <= now();
```

Nếu chưa có bài nào được chốt, cứ để cron: phút chẵn 30 tới nó tự ghi mốc mới.

**Request trùng bài** (giống tên bài + nghệ sĩ, không phân biệt hoa thường/khoảng trắng thừa)
tự gom thành một **thẻ card riêng** trong danh sách: viền tím + nền gradient accent + bóng đổ,
nhìn là biết ngay đâu là cụm. Đầu thẻ có huy hiệu đếm nền tím ("2 requests"), chip loại video
màu riêng, tên bài chữ lớn, người gửi + thời gian mới nhất; bên phải là cột **tổng vote** số
mono lớn màu accent và nút mũi tên tròn (sáng lên khi rê, xoay 180° khi mở). Bấm vào là bung ra
đủ từng request để vote/xoá riêng (mở/rút mượt, nút bên trong không bắt focus khi đang thu).
Cụm được phân trang nguyên khối, không xé đôi giữa hai trang. Đổi bộ lọc/tìm kiếm là các cụm tự
thu lại.

**Hạng của cụm tính bằng TỔNG vote cộng dồn**, không phải vote của dòng đầu: bài 9 vote bị ba
người gửi lẻ (3 + 3 + 3) xếp **trên** bài 5 vote một request. Luật này nằm trong
`src/lib/board.js` (`groupKey` → `groupRows` → `sortGroups`) và áp dụng cho cả bốn tab
*Đang chờ* / *Top voted* / *Mới nhất* / *Up next*:

| Tab | Cụm xếp theo |
|---|---|
| Đang chờ (mặc định) | paid trước → tổng vote cụm → bài mới hơn |
| Top voted | tổng vote cụm → bài mới hơn |
| Mới nhất | request mới nhất **trong cụm** |
| Up next | giữ thứ tự làm việc (đang làm trước, chốt sớm trước) — không xáo theo vote |

Bên trong cụm, dòng nhiều vote nhất đứng đầu và cũng là dòng lấy tên hiển thị cho cả thẻ.
Chạy `npm test` để kiểm tra luật xếp hạng này (12 ca, dùng `node:test` có sẵn, không cần cài gì).


---

## Bảng xếp hạng — luật xếp hạng

Bảng xếp hạng trả lời câu hỏi "ai đóng góp nhiều nhất", và câu trả lời nằm ở **một chỗ**:
`src/lib/ranking.js` (hàm thuần, không React, không gọi mạng — test bằng số được). Component
chỉ hỏi luật, không tự sắp xếp.

**Ba góc nhìn**, đổi bằng ba nút ngay trên bảng — mỗi góc là **một con số đếm được**:

| Cách xếp | Trả lời câu hỏi | Khoá phá hoà (theo thứ tự) |
|---|---|---|
| **Completed** (mặc định) | Ai có nhiều bài được làm xong nhất | tổng phiếu → số bài gửi → tỉ lệ → tên |
| **Votes earned** | Ai được cộng đồng đòi nhiều nhất | số bài đã xong → số bài gửi → … |
| **Requests** | Ai gửi nhiều bài nhất | số bài đã xong → tổng phiếu → … |

**Không còn "điểm".** Bản trước có thêm một cột `Score` = `10 × bài đã xong + tổng phiếu`. Con
số đó do chính bảng tự đặt ra: trọng số `10` không ứng với thứ gì trong sản phẩm (không phải
giá của một bài, không phải mốc phiếu nào), không xuất hiện ở màn hình nào khác, nên người xem
muốn hiểu thứ tự phải tin vào một phép nhân không giải thích được — đó là lý do nó bị gọi là
"tiêu chí điểm kì lạ". Nay bảng chỉ xếp theo ba con số **có thật** trong view
`requester_ranking`: `completed`, `total_votes`, `total`. Bớt được một tab, một cột, một câu
giải thích dài, và không còn hằng số nào để lệch giữa lời nói và phép tính.

**Mặc định là bài đã xong**, không phải số bài gửi: gửi 40 bài mà không bài nào lên sóng thì
không leo hạng — cùng tinh thần với việc gom cụm bài trùng và việc bài bị từ chối không được
tính hạng. Cộng đồng đòi thật vẫn có tiếng nói, nhưng ở **cách xếp riêng của nó**
(*Votes earned*) và ở khoá phá hoà của mọi cách xếp.

Trên màn hình: bảng có **ba cột số** (bài gửi · bài đã xong · phiếu), vạch tỉ lệ dưới tên là
một vạch **phẳng một màu** (không gradient), và hàng của chính bạn được tô một tấm nền phẳng
rồi dính đáy khối để không phải cuộn đi tìm.

**Bài bị từ chối không tính gì** — không vào số bài, không vào phiếu, không vào hạng. Đây
không phải một ghi chú: nó là một dòng `where r.status <> 'denied'` trong view
`requester_ranking` (bên Supabase) và bản demo gom đúng như vậy, nên gửi bài bừa để leo hạng
là vô ích.

### Mùa giải: All time · This week · This month (vòng 19 — 21/09/2026)

Góc phải thanh tiêu đề của bảng là **một cột điều khiển hai tầng**: tầng trên
là nhóm ba mùa (*All time · This week · This month*), tầng dưới là **nhóm viên
thuốc** ba cách sắp xếp vốn có. Hai nhóm dùng chung một họ vỏ (khung pill)
nhưng khác **đậm/nhạt**: mùa đang chọn nhuộm nền **tím mờ** với chữ sáng
(`--a-soft`/`--a-2`), cách sắp xếp đang chọn là nền **đặc** với chữ sẫm. Đọc
một lần là biết nhóm nào đổi phạm vi dữ liệu, nhóm nào đổi cách nhìn. (Lịch
sử: bản đầu xếp mùa thành một HÀNG RIÊNG cũng kiểu viên thuốc → "bố cục rối";
bản thứ hai đổi sang tab gạch chân → chữ xám nhỏ + gạch 2px mảnh bị chê
"khó nhìn", và hai đoạn chú thích dài dưới tiêu đề đẩy cả cụm nút lệch xuống.
Nay chú thích co lại còn MỘT dòng và thanh tiêu đề căn giữa.)

Chọn *This week* hoặc *This month* thì **toàn bộ số trên bảng bị cắt theo cửa
sổ đó**, tính theo **giờ Việt Nam**: tuần là **thứ Hai 00:00 → thứ Hai kế
tiếp 00:00**, tháng là **mùng 1 → mùng 1 tháng sau**. Trên màn hình khi đó
chỉ còn **đúng một câu luật** ("Sorted by requests completed this period") —
người dùng đã chốt không in ngày tháng ra làm gì. Khoảng ngày đang tính,
cách cửa sổ chạy (T2–CN / tháng lịch, giờ VN) và lời thú nhận về cột phiếu
("votes are lifetime totals…") nằm trong **tooltip của nhóm nút mùa**: hover
(hold trên cảm ứng) là đọc được đủ cả ba mẩu. Đổi mùa thì bục và bảng **dựng
lại kèm nhịp đổ xuống** (podIn/rowIn phát lại) để cú bấm có phản hồi; đổi
cách sắp xếp thì không dựng lại (số tự đếm từ cũ sang mới) — hai cú chuyển,
hai phản hồi khác nhau.

Luật cắt mùa nằm ở **`src/lib/season.js`** (hàm thuần, nhận `now` làm tham số — test khoá
được bằng một ngày cố định, không phụ thuộc đồng hồ máy chạy test). Component chỉ hỏi luật,
giống hệt cách nó hỏi `ranking.js` chuyện sắp xếp. Ba điều phải biết khi sửa:

- **Không có migration nào.** Bảng `requests` không có cột `completed_at`, nên mốc "bài xong
  lúc nào" dùng luật fallback `completed_at || updated_at || created_at` — cùng luật với khối
  *Hall of fame*. Nếu sau này thêm cột `completed_at` thật, `season.js` tự dùng nó trước.
- **Mùa xếp theo số bài XONG trong cửa sổ, không xếp theo số bài gửi** — đúng tinh thần ghi
  chú C3-14 (bảng "top người gửi tháng" từng bị hoãn vì khuyến khích đua số lượng). Bài gửi
  ngoài mùa nhưng lên sóng trong mùa **vẫn tính là thành quả của mùa đó**; bài bị từ chối
  không tính gì; người có gửi mà chưa xong bài nào vẫn có mặt với `completed = 0`.
- **Cột phiếu của bảng mùa là phiếu CỘNG DỒN của các bài gửi trong mùa** (bảng `votes` không
  có mốc thời gian theo bài trong dữ liệu tải về, nên không thể đếm "phiếu trong tuần").
  UI tự thú nhận điều này trong **tooltip của nhóm nút mùa** (vế "votes are lifetime totals…")
  — đừng xoá nó, và đừng đổi nhãn cột phiếu thành "votes this week": đó sẽ là một lời nói dối.
  Đặt tooltip ở nhóm nút mùa chứ không ở đầu cột votes vì mùa có ≤3 người thì bảng không dựng,
  đầu cột không tồn tại — còn nhóm nút mùa thì luôn có mặt.

Mùa chưa có gì thì bảng hiện đúng một câu trả lời thật ("No requests yet this week — the
season resets every Monday (Vietnam time)") và **vẫn giữ nhóm nút mùa** để luôn có đường về
*All time*. Mốc "bây giờ" chốt một lần lúc mở bảng — cửa sổ không tự trượt giữa chừng; nửa
đêm đi qua thì mùa mới là việc của lần mở trang sau.

Kiểm tra luật mùa: `npm test` chạy `src/lib/season.test.js` (10 ca) và 3 ca render trong
`Leaderboard.test.js`; `npm run smoke` bấm thật ba nút trên `/ranking`.

## Chuỗi ngày hoạt động + badge cột mốc 7/30/100 (vòng 20 — 21/09/2026)

Mỗi ngày có ít nhất một hành động cộng đồng — **gửi request · vote · bình luận · quay spin** —
thì ngày đó (theo **lịch Việt Nam**) được in một dấu vào bảng `activity_days` bằng trigger
(migration `20260921_activity_days.sql`). Từ các dấu ngày, `src/lib/streak.js` đếm ba con số:
chuỗi hiện tại, chuỗi dài nhất, và các mốc **7 / 30 / 100** đã mở.

Dải streak hiện ở **hai nơi** (chủ dự án chốt): khối *About me* của chính bạn và **trang cá nhân
công khai** của mỗi người — cột mốc là thứ cộng đồng nhìn thấy nhau. Trên dải: ngọn lửa (tooltip
chở luật đếm), số chuỗi hiện tại, chuỗi dài nhất, rồi ba badge — badge **mờ** là mốc chưa đạt,
**sáng cam** là đã mở (tooltip từng badge nói "Unlocked: …" hay còn thiếu bao xa).

Ba luật phải nhớ khi sửa:

- **Sáng sớm chưa hoạt động không làm đứt chuỗi.** Chuỗi chỉ chết khi một ngày TRỌN trôi qua
  không dấu nào; nên lúc 9 giờ sáng dải vẫn đếm chuỗi hôm qua.
- **Badge bám chuỗi DÀI NHẤT, không bám chuỗi hiện tại** — mốc đã mở là thành tích, nghỉ một
  tuần quay lại không mất huy hiệu (nhưng số chuỗi hiện tại thì nói thật là đã về 0).
- **Không đọc được nguồn thì dải TỰ ẨN** (`fetchActivityDays` trả `null`), khác với mảng rỗng
  là sự thật "chưa có ngày hoạt động nào" và hiện câu khuyên bắt đầu chuỗi. Project chưa chạy
  migration thì không ai thấy dải chứ không thấy một dải nói dối.

Chế độ demo gương đúng bốn trigger: dấu ngày gom từ ngày gửi request, ngày bình luận và ngày
quay spin đã lưu trên máy. Kiểm tra: `npm test` (streak.test.js 7 ca + StreakStrip.test.js 3 ca,
kể cả ca khoá migration + schema.sql phải có đủ bốn trigger) và `npm run smoke` (3 check ở hai
trang).

## Thẻ chia sẻ PNG — nút Save card (vòng 21 — 21/09/2026)

Nút **Save card** nằm cạnh nút *Share profile* (trang cá nhân công khai) và cạnh dải streak
(khối *About me*). Bấm vào là tải về một tấm ảnh **1200×630** (xuất 2× → 2400×1260 nên chữ
nhỏ vẫn sắc khi phóng to) — đúng khổ og:image, dán lên Discord/Telegram/Facebook ra thẻ đẹp:
avatar, tên, ba con số thật (bài gửi · bài xong · phiếu nhận), câu streak + ba mốc 7/30/100,
chân trang và tem ngày theo giờ Việt Nam. Tên file mang tem ngày
(`chaereve-alice-nguyen-2026-09-22.png`) nên card hai mùa không đè nhau trong thư mục tải về.

Card được **vẽ tay bằng canvas** (`src/lib/shareCard.js`, không thêm thư viện nào), màu đọc
thẳng từ token CSS — đổi thương hiệu một chỗ, card đổi theo. **Số trên ảnh là số đang hiện trên
trang**: component nơi đặt nút ghép nội dung đã dịch rồi truyền xuống canvas, card là một cách
nhìn khác của cùng nguồn dữ liệu, không phải bản sao tự tính lại.

Hai chỗ nói thật: **avatar fetch trượt thì lùi về vòng chữ cái đầu** (ảnh được tải về blob
trước khi vẽ để canvas không nhiễm bẩn CORS; host không cho thì lùi, không ra ảnh trắng);
**trình duyệt không vẽ được canvas** thì toast nói "This browser cannot render the card image"
chứ không giả vờ "đã lưu".

Kiểm tra: `npm test` (shareCard.test.js 5 ca — ngắt dòng theo hàm đo giả, slug/filename bỏ dấu
tiếng Việt, mọi toạ độ vẽ hữu hạn, mọi chữ phải có mặt đều được vẽ, ném đúng mã lỗi khi không
có DOM) và `npm run smoke` (2 check nút có mặt ở hai trang — smoke KHÔNG bấm nút vì canvas của
jsdom ném "Not implemented" làm bẩn lượt chạy).

## Theo dõi bài + thông báo (Notifications)

**Bấm chuông ở góc trên phải là bảng thông báo mở ra tại chỗ** — kiểu Facebook /
Instagram / X. Không có "trang thông báo" riêng, không bị đá đi đâu: mỗi dòng bấm thẳng
vào việc được, và ngay trong dòng đã có sẵn nút hành động.

Trong bảng, tin được **gom theo trạng thái của bài**, việc cần làm đặt lên đầu:

| Nhóm | Có gì | Dòng tin gồm |
|---|---|---|
| **Needs your votes** | bài được duyệt, đang leo hạng, **còn ≤ 3 vote là tới lượt chốt**, vừa lên vị trí số 1 | tên bài (đậm) · chuyện vừa xảy ra · nhãn + "cách đây…" + số vote + vị trí trên hàng chờ · nút **Vote now**. Ngay **đầu nhóm** cũng có một nut **Vote now** (mo hop phieu cua bai dau tien con bo duoc) — do la noi dong "Next pick in…" tung nam, và một dòng chỉ để đọc thì không đáng bằng một lệnh |
| **Up next** | kết quả chốt: bài được chọn làm video kế tiếp | như trên (đồng hồ "Next pick in…" chi con o khoi Up next cua bang) |
| **Denied** | request bị từ chối | như trên, **kèm đúng lý do** trong một khối riêng |
| **In progress** | admin bắt tay làm, % tiến độ | có nút **Watch on YouTube** khi đã có link |
| **Out now** | video lên sóng | bấm dòng là nhảy xuống đúng hàng của bài trên bảng |

Trong bảng còn có:

- **Mark all read** ở đầu bảng (chỉ hiện khi còn tin chưa đọc). Tin chưa đọc có vệt tím +
  nền nhạt; đọc rồi thì dịu lại. Chuông hiện huy hiệu số tin chưa đọc (nhiều hơn 9 ghi `9+`).
- Nút **×** trên mỗi dòng để bỏ đúng tin đó; nút **⚙** mở sang bảng cài đặt — **chỉ đúng
  bốn công tắc** loại tin, không kèm danh sách hay ghi chú dài dòng:
  *Tell me about my requests · Tell me when a song is almost picked · Tell me about video
  progress · Tell me when votes go up*. Nhan mo dau bang "Tell me" de doc mot tieng la biet
  day la chon loai tin nhan; chu thich la mot cau van thuan, khong ngoa ngu.
- Theo dõi / bỏ theo dõi một bài thì làm ngay chỗ có bài đó: **rê vào dòng** (hoặc vào đầu
  cụm) là chuông hiện ra ở cuối dòng meta; bài đang bật có một chấm tím nhỏ thay cho chuông.
  Cùng một công tắc cho cả bài, nên dòng bên trong cụm không lặp lại nút. (Thẻ chi tiết của từng tin đã bị bỏ: bấm tin giờ nhảy thẳng xuống hàng request.)
- **×** hoặc Esc hoặc click ra ngoài là đóng bảng. Tin **không mất** — nó vẫn nằm trong
  hộp thư của bạn, lần sau mở lại còn nguyên.
- Trên mobile bảng đẩy lên thành **bottom sheet** sát đáy màn hình cho dễ bấm một tay.

Ai nhận được tin (đây là phần quan trọng nhất):

- **Bài bạn tự gửi: tự động theo dõi**, không cần bấm chuông. Gửi xong là có tin khi nó
  được duyệt / bị từ chối (kèm lý do) / vào làm / có video.
- **Tiến độ của bài chính bạn gửi: luôn báo**, không cần bật công tắc nào.
- **Bài bạn đã bỏ phiếu nhưng chưa theo dõi: vẫn nhận kết quả chốt** — bạn vote cho bài
  nào thì bài đó lên Up next hay rớt lại, bạn phải là người được biết.
- Bài người khác: chỉ báo khi bạn bật chuông cho nó; hai loại ồn (% tiến độ, mốc 5 vote)
  mặc định TẮT, bật trong ⚙.

Chi tiết thiết kế:

- **Theo dõi gắn với BÀI, không gắn với dòng.** Khóa là `groupKey(artist + title)` mà
  `src/lib/board.js` dùng để gom cụm, nên một bài bị ba người gửi lẻ vẫn chỉ có MỘT mục
  theo dõi và MỘT dòng tin.
- **"Còn 2 vote nữa là tới lượt" lấy từ luật thật của database**, không phải luật của tab
  *Top voted*: `pickLadder()` trong `src/lib/watch.js` mô phỏng đúng `pick_top_request()`
  — bài trả tiền trước, rồi tổng vote của cả cụm, rồi bài cũ hơn. Mỗi đợt chốt chỉ lấy
  **một** bài, cứ `interval_days` (mặc định **4 ngày**) là chốt, nên câu "còn N vote" mới
  có giá trị: nó kèm thời gian còn lại để biết còn kịp hay không. Hạng này **chỉ hiện với
  bài bạn đang theo dõi** (đã chốt 08/09) — người ngoài chỉ xem bảng thì không cần thấy.
- **Đồng hồ chốt dùng chung một nguồn**: `src/components/Countdown.jsx` đọc thẳng
  `settings.key='pick'` — khối Up next trên bảng; không chỗ nào tự đếm, nên không bao giờ
  hai nơi nói hai số khác nhau. Hộp thư thì **không** in đồng hồ: người dùng yêu cầu bỏ
  dòng "Next pick in every 4 days" và thay bằng nut **Vote now** (thông tin không bấm được
  thì vô dụng trong một hộp thư toàn việc phải làm).
- **Không hứa suông:** nếu trong hàng còn bài trả tiền mà bài của bạn không trả tiền thì
  vote không vượt được — lúc đó app **im lặng**, không báo "còn 5 vote".
- **Trần 60 bài / 60 tin.** Hết trần thì app **từ chối và nói rõ**, không im lặng bỏ bài
  theo dõi lâu nhất ra khỏi danh sách.
- **Lượt mở trang đầu tiên không báo gì**; chỉ so với snapshot ngay trước đó.
- **Chống trùng:** id của tin là hàm của (bài, loại, trạng thái), không phải thời điểm —
  realtime đẩy cùng một thay đổi hai lần vẫn chỉ một dòng; riêng `near`/`lead` gắn thêm mã
  đợt chốt nên **mỗi đợt chỉ đúng một lần**, không bắn theo từng lá phiếu.
- **Nhiều tin cùng lúc = một toast** ("3 new notifications"); bấm toast mở thẳng bảng
  thông báo. Bấm một dòng tin = **đánh dấu đã đọc + nhảy xuống hàng của bài đó trên bảng**
  (hàng được làm sáng ~2,6s; nếu bài rơi sang trang khác của bảng thì trang đó được mở ra
  trước khi cuộn). Không còn hộp thoại "This song" ở giữa: nó lặp lại đúng những gì dòng
  tin vừa kể mà che mất danh sách người ta đang muốn xem.
- **Admin tự tick thì không tự báo cho mình** (đã chốt 08/09): thay đổi do chính tay admin
  duyệt / chốt / tick mốc tiến độ / duyệt đơn paid không sinh toast hay mục hộp thư cho
  admin đó (`selfActRef` trong App.jsx, chặn cả toast lẫn badge cho đúng khoá bài vừa thao
  tác). Chỉ áp cho client của chính admin — người khác vẫn nhận tin bình thường.

Muốn xem tin bắn ra thế nào trong bản demo (chưa cấu hình `.env`): mở **bảng Admin**
(nút ‹shield› ở cuối sidebar) rồi duyệt / chốt / đánh dấu xong cho một request — mỗi bước
đi qua là một dòng tin rơi vào bảng thông báo, đúng như bản thật.

**Vẫn là prototype trong trình duyệt**: danh sách theo dõi, hộp thư, tuỳ chọn và danh sách
"bài của mình mà tôi tự tay tắt theo dõi" nằm trong `localStorage`
(`ccl3_watch:<uid>` / `ccl3_box:<uid>` / `ccl3_pref:<uid>` / `ccl3_woff:<uid>`), nên đổi
máy là mất. Bảng đã có realtime nên *khi đang mở tab* tin hiện gần như tức thì; muốn gọi
người dùng quay lại khi đã đóng tab thì phải xuống database — bản DB đã viết vào
`supabase/schema.sql` (khối "THEO DÕI BÀI + THÔNG BÁO" cuối file: bảng `watches` +
`notifications`, `toggle_watch()`, trigger tự theo dõi + sinh tin, `flush_notifications()`
khung gửi), **chưa nối frontend** — xem `docs/THEO-DOI-THONG-BAO.md` mục 5.

Kiểm thử: `npm test` → `src/lib/watch.test.js` (29 ca: phạm vi báo tin, luật sinh tin,
`pickLadder` và các tình huống blocked/dẫn đầu, tự theo dõi bài của mình, trần, chống trùng,
gom nhóm) và `src/components/Notifications.test.js` (12 ca: chuông + huy hiệu, thứ tự nhóm theo
trạng thái, lý do bị từ chối, nút Vote/Watch, bảng trống, "mark all read", bảng cài đặt chỉ
còn 4 công tắc, đầu nhóm "Needs your votes" có nut Vote now va khong con dong dem nguoc,
trong bảng không có hop thoai nao) + `Notifications.edge.test.js` (11 ca: dựng bảng bằng
dữ liệu xấu — `at` không phải ngày, row thiếu `status`, 1000 tin, không có callback — để
chứng minh nó không sập thành màn hình đen).


---

## Cài đặt

### 0. Lấy mã nguồn về máy

Trước hết phải có bộ file trên máy bạn. Giải nén `color-coded-lyrics.zip` vào chỗ nào
dễ tìm, ví dụ `D:\ccl` hoặc ngay Desktop.

**Thư mục vừa giải nén ra chính là "thư mục mã nguồn"** mà các bước sau nhắc tới.
Nhận ra nó bằng cách nhìn thấy file `package.json` và thư mục `src` nằm bên trong.

Mở thư mục đó bằng **VS Code** (tải ở code.visualstudio.com) là tiện nhất — vừa sửa file
vừa mở cửa sổ lệnh ngay trong đó bằng `Ctrl + ~`.

### 1. Chạy thử (demo, không cần đăng ký)

```bash
npm install
npm run dev
```

Chưa có `.env` → đăng nhập giả lập, **có sẵn quyền admin** để bạn thử toàn bộ tính năng.
Dữ liệu lưu trong trình duyệt. Xoá sạch: F12 → Console → `localStorage.clear()` → F5.

Muốn kiểm tra luật xếp hạng (vote cộng dồn của cụm trùng bài) mà không cần mở trình duyệt:

```bash
npm test        # node:test có sẵn trong Node 18+, không phải cài gì thêm
```

### 2. Tạo Supabase

1. https://supabase.com → **New project** → region **Singapore**
2. **SQL Editor → New query** → dán toàn bộ `supabase/schema.sql` → **Run**
3. **Project Settings → API Keys** → copy `Project URL` + **khoá công khai**

Tạo file tên `.env` **ngay trong thư mục mã nguồn**, cùng cấp với `package.json`:

```
VITE_SUPABASE_URL=https://yooxntqwdlvkxcblgqbw.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

> **Bẫy trên Windows.** File Explorer mặc định giấu phần đuôi, nên bấm chuột phải tạo
> file mới rồi gõ `.env` sẽ ra `.env.txt` — Vite không đọc được và bạn cứ tưởng đã làm đúng.
> Cách chắc ăn: mở thư mục bằng VS Code, bấm **New File**, gõ `.env`. Hoặc bật
> *View → File name extensions* trong File Explorer rồi đổi tên cho đúng.

> **Supabase đã đổi hệ thống khoá.** Project tạo từ cuối 2025 trở đi chỉ có
> **Publishable key** dạng `sb_publishable_...`, không còn `anon public` (chuỗi JWT dài
> bắt đầu bằng `eyJ`) như các bài hướng dẫn cũ. Hai loại dùng thay nhau được, cứ dán vào
> cùng biến `VITE_SUPABASE_ANON_KEY`, code không phải sửa gì.
>
> **Đừng bao giờ dùng khoá `sb_secret_...` hay `service_role`** — chúng bỏ qua toàn bộ
> quy tắc bảo mật và sẽ lộ ra trình duyệt.

> Nếu bạn đã chạy schema cũ: **không xoá hoặc truncate các bảng**. Chạy toàn bộ `schema.sql` — file này chỉ bổ sung/cập nhật cấu trúc và giữ nguyên các dòng dữ liệu hiện có. Nếu app báo `PGRST205` vì thiếu bảng `media`, chạy riêng `supabase/migrations/20260903_safe_recovery.sql`; đây là migration cộng thêm, không đụng vào dữ liệu người dùng.
>
> Nếu dữ liệu đã bị xoá thật khỏi Supabase trước khi có bản sửa này, source code không thể tự tạo lại các request/vote/profile cũ. Hãy dùng **Database Backups / Point-in-Time Recovery** của Supabase; không chạy seed trong project thật. App hiện lưu bản đọc gần nhất trong trình duyệt để chống mất hiển thị khi API tạm lỗi.

### 3. Bật Google Login

> **Google đã đổi giao diện** (2025). Menu cũ *APIs & Services → OAuth consent screen*
> và *Credentials* nay gộp thành **Google Auth Platform** với 4 thẻ:
> Branding · Audience · Data access · Clients.

**Google Cloud** (https://console.cloud.google.com):

1. Tạo project mới ở góc trên bên trái.
2. Vào **Google Auth Platform** (gõ "Google Auth" vào ô tìm kiếm trên cùng).
   Nếu thấy dòng *"Google Auth Platform not configured yet"* thì bấm **Get started**.
3. Chạy hết 4 bước của trình hướng dẫn:
   - **App Information** — tên app + email hỗ trợ
   - **Audience** — chọn **External** (đây là bước quan trọng nhất, chọn sai là hỏng)
   - **Contact Information** — email của bạn
   - **Finish** — tick đồng ý rồi bấm **Create**
4. **Tạm thời BỎ QUA nút Publish app** — xem giải thích ở khung bên dưới.
   Thay vào đó, ở thẻ **Audience**, kéo xuống mục **Test users** → **Add users** →
   thêm email Google của bạn. Vậy là bạn đăng nhập thử được ngay.
5. Thẻ **Clients** → **Create Client** → Application type: **Web application**.
6. Ô **Authorized redirect URIs**, thêm đúng dòng này (thay `<project-ref>` bằng mã dự án
   Supabase của bạn — nó nằm ngay trong URL trang Supabase):
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
7. Bấm **Create**, copy ngay **Client ID** và **Client secret**.

> **Client secret chỉ hiện một lần.** Đóng hộp thoại là không xem lại được, phải tạo
> secret mới. Lưu vào chỗ nào đó trước khi đóng.

> **Vì sao chưa Publish được ngay.** Trang Branding cho phép lưu dù bỏ trống mục
> *App domain*, nên nhìn vào tưởng đã đủ. Nhưng lúc bấm **Publish app**, Google mới đòi
> **Application home page** và **Application privacy policy link** — phải là địa chỉ thật
> trên tên miền bạn sở hữu. Chưa deploy thì chưa có, nên nút Publish bị khoá và hiện khung
> vàng *"OAuth configuration is incomplete"*.
>
> **Đây không phải vật cản.** Cứ tạo Client, lấy Client ID/Secret, nối Supabase và làm
> tiếp bình thường. Chế độ *Testing* vẫn đăng nhập được, chỉ giới hạn ở những tài khoản
> nằm trong danh sách Test users (tối đa 100).
>
> Sau khi deploy xong và có tên miền, quay lại làm nốt — xem mục *"Publish app sau khi
> deploy"* bên dưới.

> **Authorized JavaScript origins** để trống cũng được. Ô bắt buộc là *redirect URIs*.
> Origins chỉ cần khi dùng Google One Tap, app này không dùng.

**Supabase**:
1. **Authentication → Providers → Google** → Enable → dán ID + Secret → Save
2. **Authentication → URL Configuration** → `Site URL` và `Redirect URLs`:
   ```
   http://localhost:5173
   https://ten-app.vercel.app
   ```

### 4. Nối app

File `.env`:
```env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 5. Tự cấp quyền admin

Đăng nhập Google **một lần** vào app, rồi chạy trong SQL Editor:

```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where email = 'email-cua-ban@gmail.com');
```

F5 lại app → mục **Bảng quản trị** hiện trong sidebar (khối *Cài đặt*).

### 6. Deploy Vercel

```bash
git init && git add . && git commit -m "init"
```
Push GitHub → Vercel **Add New → Project** → thêm 2 Environment Variables → Deploy.
Xong nhớ quay lại Supabase cập nhật `Site URL` thành link Vercel.

### 7. Chạy lại SQL khi repo có bản mới

Các file trong `supabase/` viết theo kiểu `create or replace` / `add column if not exists`
→ chạy lại bao nhiêu lần cũng không mất dữ liệu. Cách chạy: **Dashboard → SQL Editor →
New query → dán cả file → Run**. Mỗi file một tab riêng, đợi *Success* rồi mới sang file sau —
và **không bao giờ dán lại cả `schema.sql`** khi chỉ cần một file migration (xem
[`BUOC-THU-CONG.md`](BUOC-THU-CONG.md), mục 0: vì sao dán cả file 2808 dòng làm SQL Editor lag,
và câu SQL một dòng để biết mình đang thiếu file nào).

| File | Khi nào chạy |
|---|---|
| `schema.sql` | nền tảng: bảng, RLS, mọi hàm `cast_vote`/`create_request`/admin… — chạy khi repo đổi hàm hoặc khi app báo `P0001` |
| `migrations/20260903_safe_recovery.sql` | một lần, cho project tạo trước khi có khối video nổi bật |
| `migrations/20260905_pick_lock.sql` | một lần, cho project tạo trước 05/09/2026: thêm `picked_at` + bảng `settings` + khoá vote Up next |
| `migrations/20260905_admin_edit_song.sql` | một lần, CHẠY SAU file pick_lock: `admin_update()` thêm `p_artist`/`p_title` để admin sửa tên bài + nghệ sĩ |
| `migrations/20250601_auto_pick.sql` | một lần, CHẠY SAU file pick_lock: hàm `pick_top_request()` để cron tự chốt request nhiều vote nhất + ghi `next_pick_at` |
| `migrations/20260906_rls_hardening.sql` | một lần: siết RLS/quyền ghi — Supabase mặc định cấp `insert/update/delete` cho `anon`/`authenticated`, chỉ RLS + policy mới thật sự chặn; không DROP/TRUNCATE bảng nào |
| `migrations/20260907_group_top_pick.sql` | một lần, CHẠY SAU file auto_pick: sửa `pick_top_request()` xếp hạng theo **tổng vote cộng dồn của các request trùng bài** — không chạy thì cron vẫn chốt theo vote từng dòng, lệch với bảng *Top voted* |
| `migrations/20260907_daily_spin.sql` | bật Daily Spin: định danh trình duyệt, ledger 2 lượt/ngày, RPC chọn thưởng + cộng bonus, RLS; đã có trong schema mới |
| `migrations/20260908_daily_spin_prizes.sql` | một lần, CHẠY SAU file daily_spin: vòng quay 16 ô bằng nhau (56,25/25/12,5/6,25%), nới `segment` 0..15, rút thăm theo số ô; đã có trong schema mới |
| `migrations/20260908_pick_cycle_fix.sql` | chạy được mọi lúc (an toàn chạy lại): trigger `pick_cycle_touch` để chốt tay quá hạn tự ghi mốc chu kỳ + dời mốc đang kẹt + đặt lại cron `auto-pick-top` mỗi 30 phút; đã có trong schema mới |
| `migrations/20260909_daily_spin_edge.sql` | một lần, CHẠY SAU file prizes: cột audit `fp_hash`/`ip_hash` + `spin_daily` nhận hash từ cổng Edge (mặc định null); đã có trong schema mới |
| `migrations/20261031_admin_pick_group.sql` | một lần: admin chốt một request thì chốt luôn **cả cụm trùng tên bài + nghệ sĩ** (gom giống `groupKey` trong `src/lib/board.js`), Up next hiện thành một thẻ gộp thay vì bị xẻ lẻ |
| `migrations/20261031_bonus_reset.sql` | một lần, CHẠY TRƯỚC hai file 2026-11-01 và 2026-11-02: tách `profiles.bonus_credits` (bonus vòng quay, reset 31/10 hằng năm) khỏi `vote_credits` (vote đã mua, không bao giờ reset); có lên lịch `pg_cron` nếu extension đã bật |
| `migrations/20261101_vote_status_split.sql` | một lần, CHẠY SAU file bonus_reset: API trả **riêng** vote đã mua và bonus vòng quay (trước đó chung một cột) |
| `migrations/20261102_spin_fp_quota.sql` | một lần: hạn mức quay theo vân tay nằm trong Postgres (`fp_slot` + unique index), gọi thẳng RPC cũng bị chặn; đã có trong schema mới |
| `migrations/20261103_vote_hardening.sql` | một lần, CHẠY SAU file spin_fp_quota: siết vote (khoá hàng, hạn mức vân tay, hoàn đúng ví, cổng `edge_gate`); đã có trong schema mới |
| `migrations/20261104_spin_streak.sql` | một lần, CHẠY SAU file vote_hardening: vòng quay **không lặp quá 2 lượt liên tiếp** — hai lượt gần nhất của cùng một thiết bị đã ra cùng số thưởng thì lượt này loại số đó (ô vẫn rút đều trên 16 ô, chỉ hẹp tập hợp lệ trong đúng tình huống này); đã có trong schema mới |
| `migrations/20261105_desktop_review_media.sql` | một lần: `admin_review` nhận thêm `p_video_url` — Từ chối request vẫn kèm được link video có sẵn để người gửi đối chiếu; bắt đầu bằng `drop function if exists` rồi tạo lại nên chạy lại vẫn an toàn |

**Thấy đúng chữ `P0001` trên màn hình là schema chạy thiếu.** Từ bản này các hàm SQL
`raise exception 'err.xxx'` bằng **key**, app dịch ra câu chữ trong `src/lib/i18n.jsx`
(nhóm `err.*`). Schema cũ raise câu tiếng Việt không dấu nên người dùng đọc được cả dòng
`Vui long...`; mà chạy schema mới với app cũ (hay ngược lại) thì màn hình chỉ có `P0001`.
Chạy lại `schema.sql` là khớp. Muốn đổi câu lỗi thì sửa trong từ điển, đừng sửa trong SQL —
trừ hai câu có số đi kèm (hết vote, vượt giới hạn mỗi giờ) viết thẳng trong SQL vì Postgres
không truyền biến về từ điển được.

`err.databaseSetup` hiện ra khi app gọi một hàm/bảng chưa có — nghĩa là chưa chạy đủ SQL ở
trên, không phải dữ liệu bị hỏng.

---

## Bảng điều khiển Admin (trong app)

| Tab | Làm gì |
|---|---|
| **Chờ duyệt** | Duyệt / Từ chối (kèm lý do) request mới |
| **Đang xử lý** | Đặt % tiến độ, dán **link video hoàn thành**, đưa về hàng chờ, xoá, chốt/gỡ **Up next** (khoá vote), bấm **Sửa** để đổi cả **tên bài + nghệ sĩ** của request người dùng. Hàng nào thuộc cụm trùng bài có nhãn tím *"3 requests for this song · 9 votes in total"* — danh sách này cũng xếp theo tổng vote cộng dồn như tab *Top voted* ngoài trang chủ |
| **Đơn hàng** | Xác nhận "Đã nhận tiền" → cộng vote đã mua, hoặc duyệt thẳng Paid Request |
| **Videos** | Thêm/sửa/ẩn/sắp xếp **video nổi bật** (thẻ lớn giữa trang chủ) và các link **Latest update**; sửa cả danh sách một lượt bằng bảng **Add / edit links** |
| **Đã xong** | Xem lại request completed / denied |

Mọi thay đổi hiện ngay trên máy người khác (kể cả khách chưa đăng nhập) nhờ Realtime.

Bảng quản trị là **một trang thật** ở `/admin` (không còn là hộp thoại): mở bằng mục
**Bảng quản trị** trong sidebar, hoặc dán thẳng địa chỉ. Mục đang mở nằm luôn trong địa chỉ
— `/admin?tab=orders`, `/admin?tab=media` — nên F5 giữ nguyên chỗ đang làm, nút Back lùi
đúng một bước, và gửi link cho người khác là họ mở đúng mục đó. Muốn mở thẳng một mục từ
trong code thì gọi `openAdmin('media')` trong `src/App.jsx`.

Ba thứ trong trang làm việc nhanh hơn khi có nhiều request: **chọn nhiều** để duyệt / từ
chối / chốt / trả về hàng chờ / xoá cả loạt, **lọc theo loại bài** và **xếp thứ tự**, và
**xuất CSV** đúng những dòng đang nhìn (file dựng ngay trong trình duyệt, mở bằng Excel hay
Google Sheets đều đúng dấu tiếng Việt). Thanh hành động hàng loạt dính ở đáy khung nên cuộn
tới đâu vẫn bấm được; `Esc` bỏ chọn hết; `/` nhảy vào ô tìm kiếm; `Ctrl/Cmd+A` **chọn cả
trang đang nhìn** (chỉ khi đang ở chế độ chọn nhiều — lúc khác vẫn là "chọn hết chữ").

**Bộ lọc cũng nằm ở địa chỉ.** Từ khoá, cách xếp và loại bài đi cùng mục đang mở:

```
/admin?tab=active&q=aespa&sort=votes&kind=Short
```

Mở địa chỉ đó ra là thấy **đúng danh sách đã lọc** — dán cho đồng nghiệp, ghim vào dấu
trang, hay F5 đều giữ nguyên; nút Back lùi đúng bước. Địa chỉ chỉ ghi những tham số **khác
mặc định**, nên một danh sách chưa lọc vẫn là `/admin` gọn gàng. Giá trị gõ tay không có
thật (`?sort=abc`, `?kind=Không-Có`) rơi về mặc định chứ không làm trang trắng — hàm đọc
nằm ở `src/lib/adminTabs.js` (`readAdminView` / `adminQuery`), có test riêng.

**Nút Xuất CSV có ở mọi mục** — kể cả *Đơn hàng*, với đúng bộ cột của đơn (mã, loại, số
vote, VND, USD, trạng thái, thời điểm). Nút *Chọn nhiều* thì chỉ hiện ở những mục có ô
chọn trên từng dòng (mục Đơn hàng không có, nên không mời bật một chế độ không tick được gì).

Dưới dải số liệu có **một vạch chia tỉ lệ** (5px): năm ô nói *bao nhiêu việc*, vạch
nói *việc nào chiếm bao nhiêu phần*. Mỗi đoạn mang đúng màu của mục đó, nên không cần
chú giải riêng — dải số liệu ngay trên đã là chú giải.

Hai phím tắt của trang được in ngay cạnh dòng đếm (và tự ẩn trên điện thoại vì máy
không có bàn phím vật lý): **`Esc`** bỏ chọn hết, **`Ctrl/Cmd + A`** chọn cả trang đang
nhìn khi đang ở chế độ chọn nhiều. Nhịp chốt bài trong lời gợi ý của nút *Pick for Up
next* đọc từ chính `settings.pick.interval_days` — đổi nhịp trong cấu hình là lời gợi ý
đổi theo, không còn con số 4 viết cứng.

Dải năm ô số liệu ở đầu trang lấy mục · nhãn · màu · cách đếm từ **một chỗ duy nhất**
(`ADMIN_TAB_META` trong `src/lib/adminTabs.js`). Thêm một mục mới là thêm một dòng ở đó —
không còn hai danh sách song song để lệch nhau (mục có địa chỉ nhưng không có ô nào bấm tới).

### Khung Sửa trên điện thoại

Mỗi hàng trong tab *Chờ duyệt* / *Đang xử lý* / *Đã xong* là một khối `.adm-req` gồm **ba phần
anh em** xếp theo hàng, hết chỗ thì xuống dòng:

```
.adm-req
├─ .nm         tên bài — nghệ sĩ, loại video, người gửi, nhãn trùng bài
├─ .adm-acts   trạng thái · Pick/Unpick · Sửa/Đóng · ×
└─ .adm-edit   chỉ hiện khi bấm Sửa: 2 ô tên bài/nghệ sĩ + nút Lưu,
               ô link video + nút Lưu và hoàn thành, 3 mốc tiến độ, thanh %
```

Khung sửa **không nằm trong `.nm`** như trước: điện thoại mà để trong đó thì hai ô nhập ép cụm
nút tràn ra ngoài khung modal, nút *Lưu tên* rơi khỏi mép màn hình — nhìn thấy mà bấm không tới.
Trên màn ≤620px, `.nm` và `.adm-acts` mỗi khối chiếm trọn một dòng, ô nhập tràn dòng và để
**16px** (nhỏ hơn thì iOS tự phóng to cả trang khi chạm), mọi nút/nhãn cao tối thiểu **38px** cho
vừa ngón tay. Chi tiết trong `src/index.css`, mục *"khung sửa của admin trên điện thoại"*.

---

## Video nổi bật + dải link video trên trang chủ

Khối video trên trang chủ có hai phần, **cả hai đều do admin tự thêm** trong Admin → tab **Videos**:

| Phần | Vị trí | Cách thêm |
|---|---|---|
| **Video nổi bật** (Featured) | video đang chiếu trên **sân khấu giữa** trang chủ, rộng tối đa 760px | mục *Featured video*, mục đầu chưa ẩn đang hiển thị |
| **Latest update** | dải thẻ mục lục ngang dưới sân khấu | mục *Latest videos* — từng link hoặc dán hàng loạt |

**Không phát video trong trang.** Hai nút mũi tên ‹ › hai bên sân khấu xoay qua lại giữa các video
(hết danh sách tự vòng lại đầu), dải thẻ bên dưới là mục lục — bấm thẻ nào video đó được chiếu lên
sân khấu, thẻ đang mở được khoanh sáng kèm chỉ số "3 / 8". Bấm vào **sân khấu** mới mở đúng video
đang chiếu trên YouTube ở tab mới.

### Thêm video

Mỗi video cần hai thứ: **link YouTube** (watch / youtu.be / Shorts — không nhận playlist) và
**tên video**. App tự bóc ID (`src/lib/youtube.js`) rồi lấy ảnh bìa nét nhất
(`maxresdefault.jpg`, video cũ tự hạ xuống `hqdefault.jpg`) — không cần tải ảnh lên; ô ảnh bìa
chỉ để dán link ảnh khác khi muốn.

**Sửa cả danh sách một lượt (dải Latest videos):** bấm **+ Add / edit links** để mở một ô
textarea chứa toàn bộ dải — mỗi dòng một link, tựa đề riêng sau dấu `|`, đúng định dạng:

```
https://www.youtube.com/watch?v=xxxx | Tên video thứ nhất
https://youtu.be/yyyy | Tên video thứ hai
```

Muốn thêm link thì dán thêm dòng, muốn sửa tựa thì sửa ngay trong dòng, muốn xoá thì xoá
dòng, muốn đổi thứ tự thì kéo dòng lên/xuống. Dưới ô nhập luôn đếm sẵn số video hợp lệ
("N videos", dòng nào sai link hoặc thiếu tên thì báo "N skipped"). Bấm **Save video list**
là lưu TẤT CẢ một lần (thêm + sửa + xoá + xếp lại). Link nào đã có từ trước thì giữ nguyên
ảnh bìa và trạng thái ẩn/hiện, chỉ cập nhật tựa nếu bạn đổi. Muốn xoá sạch cả dải thì xoá hết
dòng trong ô đó rồi lưu một lần — nút **Clear all** (xoá hàng loạt bằng vòng lặp rồi
`location.reload()` cả trang) đã bị bỏ: một cú click không hoàn tác được mà lại che mất
những gì admin đang xem.

| Nút | Làm gì |
|---|---|
| `+ Add featured link` | Thêm từng mục featured qua form |
| `+ Add / edit links` | Mở ô textarea chứa cả dải Latest videos: mỗi dòng `link \| tên`, thêm/sửa/xoá/sắp xếp ngay trong đó rồi lưu một lần |
| `Sửa` | Mở lại form với dữ liệu cũ |
| `Ẩn khỏi trang` / `Hiện lại` | Giấu tạm mà không phải xoá |
| `↑ ↓` | Đổi thứ tự trong nhóm — featured đầu danh sách là thẻ đang hiện |
| `×` | Xoá hẳn |
| `View on home page` | Đóng bảng admin và cuộn tới đúng khối video trên trang chủ |

Dữ liệu nằm ở bảng `public.media` (`kind` = `featured` hoặc `video`), ghi qua 3 hàm
`admin_media_save` / `admin_media_delete` / `admin_media_reorder` — đều kiểm tra `is_admin()`
**trong database**; mục đang ẩn bị lọc ngay ở policy RLS. Khối video là dữ liệu công khai nên
**khách chưa đăng nhập vẫn xem được**, và Realtime cập nhật ngay khi admin thêm/sửa.

> Đã chạy `schema.sql` từ trước? Chạy lại **toàn bộ file** một lần nữa để có bảng `media` — file
> không xoá dữ liệu. Nếu chỉ gặp `PGRST205` ở mục này, chạy
> `supabase/migrations/20260903_safe_recovery.sql` để bổ sung riêng phần media và nạp lại schema
> cache.


> Đã chạy `schema.sql` từ trước? Chạy lại **toàn bộ file** một lần nữa để có bảng `media` — file không xoá dữ liệu. Nếu chỉ gặp `PGRST205` ở mục này, chạy `supabase/migrations/20260903_safe_recovery.sql` để bổ sung riêng phần media và nạp lại schema cache.

## Menu 3 gạch

Nút ☰ góc trên bên trái mở ra một thanh trượt từ trái sang, chứa hết những thứ lặt vặt
mà trước đây nằm rải trên thanh trên:

| Nhóm | Mục |
|---|---|
| **Tài khoản** | tên + email + ảnh đại diện, *Hồ sơ của bạn*, *Mua vote* |
| **Cài đặt** | *Âm thanh* (bật/tắt) |
| **Quản trị** | *Bảng điều khiển Admin* — chỉ hiện với tài khoản admin, kèm số việc đang chờ |
| Cuối menu | *Đăng xuất* |

Vài chi tiết đã lo sẵn: bấm ra ngoài hoặc nhấn `Esc` thì đóng, khoá cuộn nền khi đang mở,
chọn xong một mục là tự đóng, và khi menu đang đóng thì toàn bộ nút bên trong bị đưa ra
khỏi thứ tự `Tab` (dùng `visibility`, không chỉ dời ra khỏi màn hình).

## Chuyển động

Một bộ easing dùng chung khai báo trong `:root` của `src/index.css`, cả trang dùng chung
một nhịp thay vì mỗi chỗ một kiểu:

```css
--e-out:  cubic-bezier(.22,.61,.36,1);    /* vào: nhanh rồi hãm dần */
--e-soft: cubic-bezier(.4,0,.2,1);        /* đổi màu nền, viền */
--e-pop:  cubic-bezier(.34,1.24,.64,1);   /* nảy nhẹ — CHỈ lúc ăn mừng */
--t-1: .16s;  --t-2: .28s;  --t-3: .42s;
```

Ba tầng này chia theo **cổng tần suất**, không chia theo "hiệu ứng này đẹp hơn hiệu ứng
kia": thao tác người dùng càng lặp nhiều thì chuyển động ở đó càng phải **ít và nhanh**
(Emil Kowalski). Người dùng bấm vote hai chục lần một phiên; một hiệu ứng 300ms ở đó là
sáu giây chờ trong một phiên. Vì vậy:

* `--e-out` — mọi thứ **vào** trang và mọi thứ dịch chuyển. Không overshoot.
* `--e-soft` — đổi màu nền/viền/chữ, lặp hàng trăm lần nên phải là đường thẳng không gợn.
* `--e-pop` — **chỉ khoảnh khắc ăn mừng** (bục xếp hạng, vòng quay thưởng). Công tắc,
  toast, nút điều hướng từng dùng nó: overshoot trên một thao tác tiện ích đọc ra thành
  đồ chơi, không phải phản hồi.

| Chỗ | Hiệu ứng |
|---|---|
| Đổi mục | **View Transitions**: hai màn hình trượt qua nhau theo hướng điều hướng (`src/App.jsx` → `go`). Sidebar mang `view-transition-name: sidebar` nên đứng yên, chỉ nội dung đổi. Trình duyệt không có API này (`html[data-vt]` không tồn tại) thì khối nội dung tự chạy `sectIn` như trước |
| Tiêu đề trang | Mờ dần + nhích lên 6px trong 0.34s. **Không** còn `clip-path`: chữ là nội dung tĩnh, mỗi lần bấm menu lại thấy nó được "vẽ ra" là tự giới thiệu chứ không phải phản hồi |
| Danh sách request | Mỗi hàng vào sau trễ hơn **32ms**, chặn tối đa **10 nhịp** — đây là nhịp so le duy nhất của bảng (bản trước còn cộng thêm nhịp riêng cho dải thống kê và dải video) |
| Cuộn trang | Khối vừa vào tầm nhìn hiện dần, các khối trong một mục lệch nhau 70ms (`data-reveal` + `src/lib/useReveal.js`) |
| Nền trang | Aurora 3 vệt cùng tông logo trôi rất chậm 36s/nhịp bằng transform (`src/components/Background.jsx`) |
| Khối lớn (thống kê, danh sách, Vote của bạn) | Vệt sáng 9% bám vị trí con trỏ — `data-glow` + `useGlow()`: MỘT listener cho cả trang, cắt theo frame |
| Số liệu | Đếm từ giá trị cũ sang giá trị mới trong ~0.5s rồi nhún (`useCountUp`) thay vì nhảy số thô |
| Ảnh bìa video | Giữ khung 16:9 trước khi ảnh tải về → không giật bố cục; ảnh về tới đâu hiện tới đó; rê chuột thì phóng nhẹ |
| Modal / khung phát | Mờ dần + trượt, easing nảy nhẹ; phông sau modal mờ đi 7px (`@starting-style` nên lớp blur TO ra khi mở, không bật phụt) |
| Bỏ / thêm vote | Vòng sáng bung ra từ nút vote ngay lúc số đổi |
| Thanh tiến độ | Chạy mượt sang % mới thay vì nhảy số |
| Nút | **Chỉ nút hành động chính** nhấc lên khi rê; nút phụ trả lời bằng màu viền/nền; mọi nút đều lún xuống `scale(.97)` khi bấm. Chỗ nào cũng nhún thì không chỗ nào là chính |
| Thông báo | Trượt vào 0.3s bằng `--e-out` (**không nảy** — toast là thông báo, không phải phần thưởng), có thanh đếm giờ; rê chuột vào là đồng hồ DỪNG thật (rAF, không phải setTimeout giả) |
| Số liệu đổi | Nhún nhẹ 0.26s (`tickIn`) ở đúng ô vừa đổi giá trị |
| Việc đang chạy | Vệt sáng quét chậm 2.4s trên thanh của khối **Up next** và chỉ ở đó. Bản trước mọi hàng "đang làm" trong danh sách cũng mang vệt: mười bài cùng lúc là mười vòng lặp vô hạn |
| Logo ở màn chờ | Một vệt sáng quét NGANG logo rồi nghỉ (`logoShimmer`, chu kỳ 1.6s trong đó 22% là quét) — không có vòng tròn xoay quanh logo: vòng xoay vô hạn nhìn như icon đang tải chứ không phải thương hiệu |
| Bục xếp hạng | Ba thẻ nở từ dưới lên so le 90ms (`podIn`), một vệt ánh kim quét ngang rồi tắt (`podShine`, dịch −120%→+120% để vệt ra khỏi khung hẳn, không dừng giữa thẻ) |

Nền trang là hai lớp trong `src/components/Background.jsx`: một tấm gradient tĩnh đứng yên,
và một lớp aurora 3 vệt cùng tông logo (`--a`, `--a-2`, `--paid`) trôi qua lại 36s một nhịp
CHỈ bằng `transform` trên tấm tràn mép (`inset: -25%`) — GPU lo hết, mở cả ngày không nóng máy.
Cố tình không dùng `filter: blur()` + `mix-blend-mode` trên lớp fixed (bộ đôi gây xé mảng/nhấp
nháy khi cuộn) và không dùng `height: 100dvh` (giật theo thanh địa chỉ mobile — lớp phủ dùng
`inset: 0` nên luôn kín màn hình). Muốn nền đứng yên thì xoá `animation` của `.bgfx-aurora`;
muốn nền đặc thì chặn `.bgfx { display: none }`. Người dùng bật giảm chuyển động trong hệ điều
hành thì aurora tự đứng yên.

### Màn chờ (splash) dài bao lâu?

**Không cố định.** App chờ hai điều kiện: dữ liệu đã về (`ready`) và một **sàn 560ms** đủ
để logo kịp "vào" — dưới ngưỡng đó thì nó chỉ là một cái nháy mắt. Bản trước ghim cứng
1.7 giây, nên mạng nhanh thì người dùng ngồi nhìn logo thêm hơn một giây vô ích.

Và màn chờ **chạy mỗi lần tải trang** — chủ dự án chốt 19/09, bỏ hẳn cờ `ccl3_splash`
trong `sessionStorage`. Nó là câu chào thương hiệu, không phải màn hình nghi thức, nên
nó cũng không được giữ ai lại quá **2,6 giây**: hết trần đó là vào nội dung, dù dữ liệu
chưa về.

### Hai nguyên tắc giữ cho mượt thật chứ không phải mượt giả

1. **Chỉ animate `opacity` và `transform`** — hai thứ này compositor xử lý, không bắt trình
   duyệt tính lại layout giữa chừng. Hai chỗ đã sửa vì vi phạm: thanh âm lượng (chạy
   `width 0 → 64px`, làm chữ *Âm thanh* bên cạnh bị bóp rồi giãn mỗi lần rê chuột — nay
   giữ nguyên 64px, chỉ đổi `opacity`) và ô sáng sidebar (bỏ `height` thừa khỏi transition).
   *Vạch tiến độ cuộn* từng là ví dụ thứ ba, nhưng **nó đã bị gỡ hẳn** (vòng 16): nó trùng
   chức năng với thanh cuộn của trình duyệt và trùng màu nhấn với nút hành động chính.
2. **Tôn trọng `prefers-reduced-motion`** — có MỘT khối `*, *::before, *::after` ở
   `src/index.css` rút mọi `animation-duration` và `transition-duration` về `.001ms`, nên
   **không cần khai override cho từng phần tử nữa**. Hai khe hở phải nhớ khi viết code mới:
   `animation-delay` / `transition-delay` **không** bị vô hiệu (phần tử vào trang bằng
   `both` + delay sẽ đứng im ở trạng thái đầu — vì thế nhịp so le luôn phải chặn số nhịp),
   và `backdrop-filter` cũng không (nó không phải chuyển động — ai không muốn kính thì có
   khối `prefers-reduced-transparency` riêng).

Muốn nhanh/chậm hơn thì sửa 3 biến `--t-*`; muốn đổi cảm giác thì sửa `--e-*`.

## Hình khối và mặt kính — vì sao mọi góc bo đều giống nhau

Toàn bộ trang dùng MỘT thang góc bo, khai báo ở `:root`:

```css
--r-sm:   4px;   /* badge, pill, chip, ký hiệu phím */
--radius: 6px;   /* input, nút, ô nhỏ trong sidebar */
--r-md:   8px;   /* khối: danh sách, thống kê, card, modal ảnh xem trước */
--r-lg:   12px;  /* lớp nổi: modal, hộp đăng nhập */
--r-xl:   16px;  /* logo trên màn chờ */
--r-pill: 999px; /* những thứ phải là viên thuốc */
```

Trước đây các giá trị 3/5/6/7/8/10/12/14px lẫn lộn, mỗi khối một kiểu; đặt hai khối cạnh nhau là
thấy "lệch tay" ngay. Khi bo một góc, dùng biến — đừng gõ số.

Độ mờ của mặt kính cũng chỉ có hai mức:

```css
--panel:    rgba(19,22,27,.8);   /* khối phẳng nằm TRONG trang: list, stats, bục */
--float:    rgba(16,19,24,.88);  /* lớp NỔI trên trang: modal, toast, gate, sidebar */
--float-2:  rgba(14,17,21,.86);  /* sidebar — khối cao, cần đặc hơn chút */
```

Lý do phải thống nhất: hai khối liền nhau mà một bên `.8` một bên `.82` thì đường nối hiện ra
thành một vệt dù không có viền nào cả.

Ba quy tắc đã áp dụng khi rà toàn bộ UI:

1. **Không dùng `gap: 1px` + nền đặc làm vạch phân chia** giữa các thẻ trong suốt (bục xếp hạng cũ
   làm thế, kết quả là một đường tối chạy giữa ba khối kính). Muốn có vạch thì dùng
   `border-left: 1px solid var(--line)` trên thẻ sau — và đổi sang `border-top` khi bản hẹp xếp chồng.
2. **Vạch accent nằm TRONG khối**, không phải `border-left` của khối: `border-left` + `border-radius`
   thì hai đầu đường kẻ bị vát, nhìn rất lộ. `.nowbar` vì thế dùng `.nbar` absolute + `overflow: hidden`.
3. **Lớp phủ khi rê chuột trong khối kính phải là màu trắng trong suốt** (`--hover`, `--hover-2`),
   không dùng `--surface-*` đặc — nền đặc tô lên khối trong suốt hiện thành một ô sáng lệch tông.
4. **Rule ở cấp phần tử trong `index.css` sẽ ăn sang mọi khối mới.** `label` bị đặt
   `margin-bottom: 5px`, `.icon-btn` có hover màu đỏ dành cho nút xoá — thêm control vào popover nào
   là phải reset lại tại chỗ, nếu không nút phụ trông như nút phá. Phần `input, select, textarea`
   (`width:100%; padding:7px 10px; viền; nền`) thì đã **sửa tận gốc** thay vì vá từng nơi: ô nhập là
   ô nhập, còn widget thì không — `input:where(:not([type=checkbox], [type=radio], [type=range],
   [type=color], [type=file], [hidden]))`. Ba cái tick trong ActionModal ("đây là yêu cầu trả phí"),
   MediaAdmin ("ẩn khỏi trang chủ") và 3 mốc tiến độ AdminPanel từng hiện thành **hộp xám to hơn chữ
   bên cạnh** đúng vì rule này. Phải bọc trong `:where()`: đặc tính giữ nguyên bằng `input` trần để
   `.nt-pref input`, `.qty input` còn đè được; viết `:not()` thuận là nâng lên 0,6,1 và tự vô hiệu
   hoá mọi quy tắc reset của popover. Chốt ở `src/lib/cssInputBox.test.js`.
5. **Vùng cuộn trong flex cột bắt buộc `min-height: 0`** — flex item chiều dọc có `min-height:auto`
   bằng đúng kích thước nội dung, nên thiếu một dòng này là nội dung không cuộn mà bị cắt: `.nt-list`
   từng "ăn mất" tin nhắn, `.side-scroll` từng đẩy cả khối chân sidebar (avatar, đăng xuất) ra khỏi
   màn hình trên cửa sổ thấp. `src/lib/cssScroll.test.js` quét TOÀN BỘ rule có `overflow-y:auto|scroll`
   + `flex:1` và bắt phải có `min-height: 0` — không phải danh sách tên, thêm khối mới là tự được soi.
6. **Cụm nút bên phải một hàng dùng chung một nhịp:** cách nhau `12px`, cách mép phải khối
   `14px` (bản hẹp `8px` / `10px`), thứ tự *[nội dung][vote][xoá]* — hàng lẻ (`.row`) và cả cụm
   (`.grow`) phải trùng cột. **Chuông thông báo không còn là một ô nút trong cụm đó**: một hộp
   26px có viền, bật lên thành chip màu, đặt ở cuối mọi dòng là quá nặng cho một bảng mà nội
   dung chủ yếu là chữ 12–13px. Nó giờ là *affordance mờ* cuối dòng meta (`.followbtn`): ẩn khi
   hàng yên, hiện khi `:hover`/`:focus-visible`, đang bật thì chỉ là **chấm accent 4px** cùng
   chỗ — glyph và chấm xếp chồng trong một ô 18px nên không bao giờ có 1px nhảy; `@media
   (hover: none)` để glyph mờ thường trực vì màn cảm ứng không có "rê" mà phát hiện. Chuông của
   **cả cụm** vẫn ở cột lưới thứ hai (không neo `absolute top:15px`: đầu cụm cao theo nội dung
   nên số đo nào cũng lệch với mũi tên), và dòng bên trong cụm **không** có chuông lẫn không
   phải giữ chỗ cho nó. Chốt bằng văn bản ở `src/lib/cssGridRows.test.js`.
7. **Trong một popover, một khoảng lùi duy nhất cho mọi khối.** Hộp thông báo lấy `12px`
   (bản hẹp cũng `12px`) cho header, nhãn nhóm, dòng tin, dòng cài đặt và trạng thái trống;
   lớp ngoài `.nt-pop` không padding ngang để mỗi khối tự đo từ mép bảng. Dòng tin thì mép phải
   do **một** khối giữ (`.nt-i { padding-right: 12px }`, `.nt-acts` padding 0) — cộng dồn hai
   khối (10 + 2) là cách làm cũ khiến sửa một chỗ lệch ba chỗ. `src/lib/cssNotifyPitch.test.js`
   đọc CSS và chặn đúng điều đó, vì sandbox không có trình duyệt để nhìn. Chiều ngược lại
   cũng phải giữ: app KHÔNG dựa vào outline mặc định của trình duyệt. Cách cũ — liệt kê tên
   từng loại nút vào `button:focus-visible` — là một cơ chế tự gãy: quét 08/09/2026 phát hiện
   **32 class gắn trên `<button>` không có tên trong danh sách** (nút sao chép, ô số lượng, nút
   sang trang, nút đóng toast, chuông cuối dòng, điều hướng ảnh bìa…), tức mỗi nút viết thêm là
   một lỗ thủng. Giờ chốt bằng THẺ: `button:focus-visible, a:focus-visible,
   [tabindex]:not([tabindex="-1"]):focus-visible`; thẻ nhập KHÔNG ở đó vì nó đổi màu đường viền
   làm dấu focus; hai ngoại lệ hình hài (`.nt-hit` offset âm, `.spin-vote-link` bo tròn góc) được khai
   báo riêng KÈM LÝ DO. Nút **ẩn** (`.followbtn`) thì gấp đôi: `opacity: 0` mà còn `pointer-events`
   là ô rỗng cuối dòng vẫn bắt click và đổi con trỏ, nên `pointer-events: none` ở trạng thái thường
   rồi mới mở lại ở chính quy tắc làm hiện; và vì nó ẩn nên vòng focus là dấu hiệu duy nhất khi đi
   bằng Tab.
8. **Toast trùng văn bản thì gộp, không moc thêm ô.** `src/lib/toastStack.js` quyết định: cùng
   `tone + title + body` với mẩu còn sống → làm mới mẩu đó và tăng bộ đếm `×n`; chồng tối đa
   `TOAST_CAP = 3` (trước đây 4 ô 8 giây là phủ gần hết góc nhìn). Lý do ra đời: một cú tick của
   admin trên cụm 3 request sinh ba mẩu tin giống hệt nhau che màn hình.

**Mười chốt chặn tĩnh cho những lỗi mà chỉ trình duyệt mới nhìn thấy** (`npm test` chạy kèm;
   đoạn này trước ghi "bảy" trong khi liệt kê tám — đếm lại và bổ sung hai cái bị bỏ sót):
`src/lib/cssGridRows.test.js` — mọi quy tắc lưới của `.grow` chốt cột thì phải chốt hàng,
chuông không được quay về `position:absolute`, và các số đo nhịp phải còn nguyên;
`src/lib/cssNotifyPitch.test.js` — một khoảng lùi 12px cho mọi khối trong popover + không
được dựng lại hộp thoại/dòng đếm ngược trong hộp thư; `src/lib/propContract.test.js` —
soát cả hai chiều của sợi dây props (thiếu prop bắt buộc, và truyền prop không ai đọc:
đây đúng là loại lỗi làm màn hình đen; `src/lib/cssInputBox.test.js` — rule "ô nhập" toàn cục
phải loại widget và phải nằm trong `:where()`; `src/lib/cssScroll.test.js` — mọi vùng cuộn
`flex:1` phải có `min-height: 0`; `src/lib/cssTokens.test.js` — không `var(--x)` nào vô chủ
(`var(--body)` đã sống sót 3 quy tắc vì CSS không bao giờ báo lỗi này); `src/lib/i18nKeys.test.js`
— không key nào thiếu/trùng và không `{x}` nào hiện nguyên; `src/lib/jsxHtml.test.js` — markup hợp
lệ (`<div>` trong `<button>`, control lồng control, `type` của button trong form);
`src/lib/cssTapTarget.test.js` — **hợp đồng theo cặp** cho những nút cố tình nhỏ ở bản desktop
(`.rowact`, `.toast-x`): đã chọn "nhỏ trên chuột, đủ to trên cảm ứng" thì cả hai vế phải còn,
vì vế mobile là thứ bị xoá đầu tiên khi dọn CSS; `src/lib/cssSelectArrow.test.js` — mũi tên
`<select>` phải là thứ tự vẽ, không phải do trình duyệt sơn sát mép bo góc (lỗi người dùng đã
báo một lần). Mỗi cái đều đã
được thử phá để chắc rằng nó đỏ thật — chốt chặn không đỏ thì còn vô dụng hơn cả không có, và
**bản thân bộ quét cũng phải được chứng minh là đọc đúng** (test cuối của mỗi file là vậy).

`backdrop-filter` chỉ đặt trên lớp NỔI (modal, toast, gate, sidebar, votepanel). Khối cao như
danh sách thì KHÔNG blur: trình duyệt phải tính lại cả vùng mờ mỗi frame khi cuộn, Safari tụt fps
rất rõ — đó là lý do `.list`/`.stats` chỉ màu trong suốt mà không blur.

## Thanh toán — sửa thông tin của bạn

Mở **`src/lib/payment.js`**, sửa đúng một chỗ duy nhất là xong, QR tự sinh lại:

```js
export const PAYMENT = {
  bank: {
    bin: '970436',               // mã BIN ngân hàng (bảng ở cuối file)
    bankName: 'Vietcombank',
    accountNumber: '0123456789', // số tài khoản của bạn
    accountName: 'NGUYEN VAN A', // in hoa, không dấu
  },
  paypal: { username: 'chaereve', email: 'chaereve@example.com' },
}
```

Người dùng thấy **2 nút: Ngân hàng · PayPal**, bấm vào nút nào thì mở
bảng thông tin của phương thức đó gồm số tài khoản (có nút sao chép) và mã QR.

| Phương thức | Loại QR | Ghi chú |
|---|---|---|
| Ngân hàng | **VietQR chuẩn EMVCo** | Quét bằng mọi app ngân hàng VN, tự điền số tiền + nội dung |
| PayPal | Link `paypal.me/<user>/<số tiền>USD` | Dành cho người dùng quốc tế |

QR sinh **ngay trong trình duyệt** (thư viện `qrcode`), không gọi API bên ngoài
nên chạy được cả khi offline và không lộ thông tin cho bên thứ ba.

Số tiền trong QR lấy từ đơn hàng vừa tạo; nội dung chuyển khoản là **tên tài khoản
Google** của người mua để bạn đối chiếu khi xác nhận trong tab Đơn hàng.

## Logo

Logo của bạn đã được cắt tròn và đặt tại `public/`:

| File | Dùng ở đâu |
|---|---|
| `logo.png` (512px) | bản gốc để cắt các cỡ còn lại (trang không nạp file này nữa) |
| `logo-192.png` | splash + hộp đăng nhập, icon PWA, `og:image` |
| `logo-128.png` | thanh nav, footer |
| `icons/icon-192.png`, `icons/icon-512.jpg` | manifest (thêm vào màn hình chính) |
| `icons/maskable-192.png`, `icons/maskable-512.jpg` | manifest, phần `purpose: maskable` |
| `apple-touch-icon.png` | icon iOS khi thêm vào màn hình chính |
| `favicon-64.png`, `favicon.ico` | icon trên tab trình duyệt |

Vì sao không dùng thẳng `logo.png` everywhere: ảnh 512px của logo (nền stipple nên
không nén được) nặng ~690 KB, mà chỗ hiện to nhất chỉ 78px. splash là thứ người dùng
thấy ĐẦU TIÊN — nạp 690 KB cho một ô 78px là tự làm chậm màn mở màn. Mỗi chỗ giờ lấy
đúng cỡ cần (78px → 192, 30px → 128), nhẹ hơn 6–13 lần mà nét như nhau.

Đổi logo: ghi đè `public/logo.png` bằng ảnh VUÔNG (cắt tròn sẵn, nền trong suốt hoặc
tối) rồi chạy lại:

```bash
convert public/logo.png -resize 192x192 -strip public/logo-192.png
convert public/logo.png -resize 128x128 -strip public/logo-128.png
convert public/logo.png -resize 64x64  -strip  public/favicon-64.png
convert public/logo.png -resize 512x512 -background '#0d0f12' -flatten -strip -quality 85 public/icons/icon-512.jpg
convert public/logo.png -resize 192x192 -background '#0d0f12' -flatten -strip public/icons/icon-192.png
convert public/logo.png -resize 384x384 -background '#0d0f12' -gravity center -flatten -extent 512x512 -strip -quality 85 public/icons/maskable-512.jpg
convert public/logo.png -resize 192x192 -background '#0d0f12' -gravity center -flatten -extent 192x192 -strip public/icons/maskable-192.png
convert public/logo.png -resize 180x180 -background '#0d0f12' -gravity center -flatten -extent 180x180 -strip public/apple-touch-icon.png
```

(`maskable` cần nền đầy cả khung vuông vì Android sẽ cắt thành vòng — vì thế có thềm
`-gravity center -flatten` trên nền `#0d0f12` khớp màu nền app.)

## Đường dẫn của từng mục

Mỗi mục có đường dẫn riêng, chia sẻ link được và nút Back/Forward của trình duyệt chạy đúng:

| Mục | Đường dẫn | Tiêu đề tab |
|---|---|---|
| Bảng yêu cầu | `/` | Color Coded Lyrics — Request Board |
| Daily Spin | `/daily-spin` | Daily Spin · Chaereve |
| Xếp hạng | `/ranking` | Xếp hạng — Color Coded Lyrics |
| Của tôi | `/profile` | Của tôi — Color Coded Lyrics |
| Bảng quản trị | `/admin` (thêm `?tab=…` để mở thẳng một mục) | Bảng quản trị — Color Coded Lyrics |

Đổi đường dẫn thì sửa `ROUTES` ở đầu `src/App.jsx`:

```js
const ROUTES = { board: '/', spin: '/daily-spin', ranking: '/ranking', mine: '/profile', admin: '/admin' }
```

Đường dẫn `/videos` cũ (mục Kênh đã bỏ) mở lên vẫn ra trang chủ, thanh địa chỉ tự sửa về `/`.

Dùng **đường dẫn thật** chứ không phải dấu `#`, nên link nhìn sạch và Google index được.
Đổi lại là máy chủ phải biết trả `index.html` cho mọi đường dẫn lạ — việc này đã lo sẵn:
`public/_redirects` cho Cloudflare Pages, `not_found_handling` trong `wrangler.jsonc` cho
đường Workers (phương án thay thế). File thật như `/privacy.html` và route `/api/*` của
Pages Functions vẫn được ưu tiên — Functions chạy trước, chỉ đường nào không khớp mới
rơi về `index.html`, nên SPA fallback không nuốt API.

Nav dùng thẻ `<a href>` thật thay vì `<button>`, nên **bấm giữ Ctrl để mở tab mới** vẫn được,
và trình duyệt hiện đường dẫn khi rê chuột.

## Bố cục trang

Sidebar có 4 mục chính, mỗi mục là một trang riêng:

| Mục | Nội dung |
|---|---|
| **Bảng yêu cầu** | Thống kê, **video nổi bật + video mới** (nút ‹ › xoay video, bấm sân khấu là sang YouTube), khối "Đang thực hiện", danh sách request + bộ lọc |
| **Daily Spin** | Vòng quay 16 ô (tông màu theo bậc thưởng) + nút Spin và kết quả dưới bánh xe; thẻ trạng thái bên phải gồm số lượt, số dư, luật và *Today's rewards*; đồng hồ reset ở dải đầu |
| **Xếp hạng** | Bục 1/2/3 + bảng đầy đủ (`src/components/Leaderboard.jsx`), đổi góc nhìn tại chỗ: Request · Hoàn thành · Vote nhận; hàng của chính mình dính đáy khối |
| **Của tôi** | Request bạn đã gửi (xoá được), đơn hàng của bạn (huỷ được), thống kê cá nhân |

Thanh trên cũ đã bỏ hẳn. Bốn mục chính và toàn bộ cài đặt nằm trong **cột sidebar
bên trái** — xem mục *Sidebar và video lấy thẳng từ kênh YouTube* ở cuối file.

### Trang Bảng yêu cầu: hai cột từ 1300px

Dưới 1300px, trang là **một cột** theo đúng thứ tự đọc: thống kê → video của kênh →
*Up next* → *Vote của bạn* → danh sách request. Từ 1300px trở lên, **video của kênh
tách sang một cột riêng bên phải** (320px), còn cột trái giữ việc chính của trang:
thống kê, *Up next*, *Vote của bạn*, danh sách.

Con số 1300px là tính ra chứ không phải chọn cho đẹp: từ 900px trở lên `.shell` đã chừa
252px cho sidebar, nên bề ngang thật của `.main` chỉ còn `viewport − 252`. Muốn cột nội
dung còn ≥650px (đủ để tên bài không phải xuống dòng) thì cần khoảng 1298px. Dưới ngưỡng
đó, hai cột sẽ **bóp** hàng request chứ không tận dụng khoảng trống.

Đổi bố cục bằng `grid-template-areas`, **không** đổi thứ tự DOM — nên bản một cột và bản
hai cột luôn là cùng một nội dung, và trình đọc màn hình đọc đúng thứ tự.

Trong cột hẹp 320px, dải mục lục video xếp **dọc** (ảnh 112px bên trái, tên bên phải)
thay vì cuộn ngang như bản rộng — cùng dạng với một danh sách video quen thuộc, đọc được
tên dài trong bề ngang hẹp.

**Vote của bạn** là khối riêng trong trang Bảng yêu cầu, đặt **ngay dưới thanh
*Up next***: số lượt còn lại, vote miễn phí hôm nay, vote đã mua, bonus Daily Spin —
mỗi loại một ô riêng — kèm nút *Vote ngay*, *Daily Spin* và *Mua vote*.

Bộ lọc loại video đã gộp thành một ô chọn (dropdown) thay vì hàng tab thứ hai.

Bộ lọc, loại video và từ khoá tìm nằm trên URL (`/?f=top&k=Short&q=twice`) nên dán link là mở
đúng chỗ, F5 không mất trạng thái, và nút Back quay lại đúng bộ lọc trước. Việc ghi URL được hoãn
320ms — Chrome/Safari chặn `replaceState` quá dày (100 lần/30s), gõ phím nào cũng ghi là trang tự
chuốc lệnh phong toả history.

**Bộ lọc còn được NHỚ cho lần ghé sau** (tab + loại video, trong `localStorage` khoá `ccl.board`,
ghi cùng nhịp 320ms với URL). Ba nguồn xếp theo thứ tự ưu tiên rõ ràng — luật nằm ở
`pickBoardParam()` trong `src/lib/board.js`:

| Nguồn | Khi nào thắng |
|---|---|
| URL (`?f=`, `?k=`) | Luôn thắng — dán link là mở đúng chỗ người gửi muốn chỉ |
| `localStorage` | Khi URL không nói gì: lần ghé trước xem tab nào thì ghé sau vẫn ở đó |
| Mặc định (`queued` / tất cả loại) | Khi cả hai đều không có, hoặc giá trị đã lưu không còn hợp lệ |

Giá trị lạ (tab đã bị đổi tên ở bản trước còn nằm trong máy người dùng, hoặc URL cũ ai đó dán vào)
**bị bỏ qua** chứ không đẩy vào state — một tab không tồn tại sẽ làm danh sách rỗng mà không ai
hiểu vì sao. Còn `q` (từ khoá tìm) thì **không** nhớ: mở lại web mà danh sách tự dưng rỗng vì một
từ khoá cũ là kiểu bực mình không ai gọi được tên — tìm kiếm là chuyện của phiên hiện tại.

### Link mời gửi bài — dán vào mô tả video YouTube

```
https://chaereve.pages.dev/?add=1&artist=aespa&title=Whiplash
```

Bấm link là vào thẳng form *Gửi request* với tên bài/nghệ sĩ đã điền sẵn — người xem chỉ còn bấm
Gửi. Đây là đường ngắn nhất từ "đang xem video" tới "đã gửi request", và nó không tốn thêm dịch vụ
nào: bộ lọc vốn đã nằm trên URL từ trước.

| Tham số | Việc |
|---|---|
| `add` | Bắt buộc. `?add`, `?add=1`, `?add=true` đều mở form; `?add=0` / `false` / `no` thì không |
| `artist` | Điền sẵn ô nghệ sĩ (cắt ở 120 ký tự như ô nhập) |
| `title` | Điền sẵn ô tên bài (cắt ở 160 ký tự) |
| `link` | Điền sẵn ô link (cắt ở 500 ký tự) |

Bốn tham số được **dùng đúng một lần rồi xoá khỏi URL** (`replaceState`): để nguyên thì F5 lại mở
form lần nữa, và đóng form xong bấm Back lại thấy nó bật lên.

Nút **chia sẻ** ở cuối mỗi dòng request làm việc ngược lại: nó tạo link
`/?f=top&q=<tên bài>` trỏ về **chính bảng** — người nhận bấm vào là vote được ngay thay vì phải
đi tìm bài. Trên máy cảm ứng thì mở hộp chia sẻ của hệ điều hành (Zalo/Messenger/Telegram), còn
lại thì copy link + hiện toast. Đây là vòng tăng trưởng duy nhất của app mà không cần thêm dịch vụ:
người gửi request trở thành người đi vận động cho nó.

### Ghim công người gửi — nút *Copy credits* trong bảng Admin

Mở bảng Admin → một request → **Copy credits**: chép vào clipboard đúng đoạn chữ để dán vào mô tả
video:

```
aespa - Whiplash
Requested by: An, Bình, Chi
```

Gom **mọi dòng cùng bài** (kể cả dòng đã bị từ chối, vì người đó vẫn đã gửi) và bỏ tên trùng; quá
8 người thì gộp đuôi thành `+3`. Trước đây việc này làm bằng tay — mở bảng, đọc từng dòng, gõ lại
tên — nên nó thường bị bỏ. Nhãn nút đổi thành *Copied* tại chỗ trong 1,6 giây: mắt đang ở giữa
bảng, còn toast thì ở góc màn hình.

Hai phím tắt cho người dùng bàn phím: `N` mở form gửi request, `/` nhảy ô tìm kiếm
(`Esc` ngay trong ô tìm là xoá luôn từ khoá).

### Thanh lọc trên máy hẹp: chip loại bài đang lọc

Khi bạn chọn một **loại bài** (Color Coded Lyrics / Full Album / 1 Hour Loop / Short) trong
khối *Bộ lọc*, trên màn hẹp một **chip mang tên loại đó hiện ngay hàng chip chính** và bấm
vào là bỏ lọc. Đây là chỗ duy nhất nói ra vì sao danh sách ngắn đi — trên màn hẹp khối lọc
đã gấp lại sau nút *Bộ lọc*, nên nếu không có chip này thì bạn chỉ thấy "hình như thiếu bài".
Từ 621px trở lên chip đó tự ẩn: khối lọc luôn hiện ở đó, nói hai lần là thừa.

Trên màn hẹp thanh lọc cũng xếp lại thành **hai hàng, mỗi hàng một việc**: hàng trên là dải
chip trạng thái (chiếm trọn bề rộng, cuộn ngang và **dừng ở từng chip**), hàng dưới là ô tìm
kiếm + nút *Bộ lọc*. Trước đây dải chip và ô tìm kiếm chen nhau trên một hàng, nên chip bị
bóp còn vài chục pixel — nhìn như một mẩu chip cụt.

### Tìm kiếm bỏ dấu — gõ sao cũng ra

**Khoảng chừa trong ô tìm kiếm tính theo bề rộng thật của hai thứ nằm đè lên nó** (kính lúp
bên trái, nút xoá bên phải). Đây là chỗ vẫn còn hở sau lần vá trước: bên phải là con số
`26px` viết cứng, mà trên điện thoại nút xoá được nới lên 30px cho dễ chạm — chữ gõ vào vẫn
chui được xuống dưới nút xoá. Nay nới nút là khoảng chừa tự đi theo, và luật này áp cho **mọi**
ô tìm kiếm, kể cả ô trong bảng quản trị.

Ô tìm kiếm bỏ dấu trước khi so, nên một từ khoá khớp cả ba cách người ta gõ tên bài:
`Chung Hạ`, `Chung Ha`, `chung ha`. `Đặng Nhập` tìm được bằng `dang nhap`: chữ **đ** là ký tự
riêng của tiếng Việt (không phải `d` cộng dấu), nên nó phải được thay bằng tay — thiếu bước
đó thì gõ "dang" không ra "Đặng" mà nhìn vào chẳng thấy sai ở đâu.

Toàn bộ luật nằm trong **một** hàm `fold()` (`src/lib/board.js`), và bảng Admin dùng đúng hàm
đó. Trước đây Admin có bản `norm()` riêng (không xử lý `đ`), nên cùng một từ khoá cho hai kết
quả khác nhau ở hai màn hình — có ca kiểm thử canh riêng chuyện này.

### "Sớm nhất bao lâu" — sàn thời gian, không phải lời hứa

Dưới mỗi dòng request đang theo dõi, cạnh câu về hạng, nay có thêm một vế mờ hơn: *"at least
3 weeks"*. Nó trả lời câu hỏi tốn tiền nhất của người đã gửi request — *bao giờ có video?* —
mà bảng trước đó chỉ trả lời được "còn cách 2 vote", vốn là việc của người khác bỏ phiếu chứ
không phải một mốc thời gian.

| Thành phần | Lấy từ đâu |
|---|---|
| Tới đợt chốt kế tiếp | `settings.pick.next_pick_at` — **đúng** mốc mà đồng hồ đếm ngược trên đầu bảng đang chạy |
| Số chu kỳ còn phải qua | `(hạng − 1) × interval_days` (mặc định 4 ngày; mỗi đợt chốt lấy **một** bài) |

Vì sao luôn là *"sớm nhất"*: bài khác có thể vượt lên bằng vote, tức thời gian thật chỉ có
thể **muộn hơn** con số này. Một con số kèm chữ "khoảng" mà lại có thể trễ hơn thì vẫn là nói
thật; một con số không có gì bảo đảm thì là hứa. Con số chia theo ngày (< 12) → tuần (12–55)
→ tháng (≥ 56), và không bao giờ hiện "0 ngày" hay "1 tháng" — còn 6 tiếng nữa chốt thì phải
là "1 ngày".

Ba chỗ **cố ý không hiện**: bài đang dẫn đầu (đồng hồ đếm ngược đã nói rồi, thêm chỉ lặp),
bài bị một request đã trả tiền chặn trước (đang hiện *behind a paid request* — không hứa được
gì), và hạng quá 20 (lúc đó con số chỉ còn là trò chơi chữ). Hạng 9–20 **trước đây im lặng
hoàn toàn** (chỉ hạng ≤ 8 mới có câu), mà đó lại đúng là những người cần biết "bao giờ" nhất.

Con số chỉ được tính ở **một chỗ**: `pickLadder()` gắn `eta` vào chính mục xếp hạng, nên bảng,
hộp thông báo và trang Của tôi dùng chung một kết quả — không có ba bản tính riêng để lệch nhau.

### Hộp nhập số vote — chọn nhanh, và trên điện thoại là tấm trượt từ đáy

Bấm nút vote trên một bài là mở hộp nhập số phiếu. Con số **lớn nhất** trong hộp là **số phiếu
SAU khi bạn vote** (không phải số đang có) — người bấm cần biết kết quả, không phải hiện trạng;
dưới nó là một dòng nhỏ nói hiện tại đang bao nhiêu. Chọn bằng một trong bốn cách, cả bốn cùng
một trục nên không mâu thuẫn nhau:

| Cách chọn | Chi tiết |
|---|---|
| **Mức nhanh** | `1 · 5 · 10 · tất cả` — mức nào vượt quá số phiếu đang có thì **không hiện** (bấm vào rồi báo lỗi là lỗi thiết kế) |
| **Thanh trượt** | Kéo là con số lớn chạy theo |
| **Ô số** | Kèm nút `−` / `+`; nút **rút lại** số phiếu đã vote nằm bên trái |
| **Bàn phím** | `+` / `−` / mũi lên / mũi xuống chỉnh số, `Esc` đóng; gợi ý `+ / −` in ngay cạnh ô số và **tự ẩn trên thiết bị cảm ứng** (không có bàn phím thì đừng hứa) |

Khi con trỏ đang ở **trong ô nhập** thì app **nhường phím lại** cho ô: ở đó trình duyệt đã tự
tăng/giảm bằng mũi lên/xuống, bắt thêm là nhân đôi.

Cuối hộp là **ba ô số dư** (miễn phí hôm nay · đã mua · thưởng) để biết phiếu sắp dùng lấy từ
đâu, và một dòng *"còn 7 → còn 3"* trả lời đúng câu hỏi *bấm nút này thì tôi mất gì*. Ngay
dưới ba ô đó là **một vạch chia tỉ lệ**: ba đoạn của cùng một màu (đậm dần) cho biết phần nào
là phiếu miễn phí, phần nào là phiếu mua, phần nào là thưởng — ba ô nói *số lượng*, vạch nói
*tỉ lệ*. Con số lớn trong hộp cũng được **đọc lên** khi bạn đổi số phiếu (trình đọc màn hình),
và ô nhập số phiếu trỏ tới dòng "còn … → còn …" để đọc tới ô là hiểu ngay sẽ mất gì.

**Trên điện thoại (≤620px) hộp là một tấm trượt từ đáy lên**: bo hai góc trên, phẳng ở đáy, có
tay nắm, và chừa `env(safe-area-inset-bottom)` cho máy có thanh home. Nút xác nhận nhờ đó rơi
đúng vào tầm ngón cái, và bàn phím số của máy (nếu mở) không đẩy hộp lên khỏi tầm nhìn. Mức
chọn nhanh và nút `−`/`+` trên thiết bị chạm cao **44px**.

### Mua thêm vote trong tin "sát nút"

Tin *"Almost picked"* (bài còn ≤ 3 vote nữa là dẫn đầu) nay có thêm nút **Get votes**, mở
thẳng tab mua. Đây là **lúc duy nhất** con số "còn 2 vote nữa" vừa đọc được vừa làm được gì
ngay, nên nút chỉ sống trong đúng loại tin đó: không rải khắp hộp thư, không nằm trên bảng.

Nút cố ý để **lặng** (viền xám như nút *Watch*, không tô vàng như nút *Vote*): người đọc trả
tiền khi họ muốn, không phải vì có nút vàng hét lên. Không truyền `onBuy` thì nút không tồn
tại, nên chỗ nào không cần cũng không vỡ.

## Font chữ

App chỉ còn chữ tiếng Anh, nhưng **Be Vietnam Pro vẫn ở lại**: thứ người dùng gõ vào — tên
bài, tên nghệ sĩ, ghi chú, tên hiển thị — phần lớn là tiếng Việt, và dấu thanh phải vẽ đúng
trên danh sách request. Đổi sang font latin thuần là nội dung người dùng vỡ trước khi UI kịp
khá hơn.

Ba font, mỗi font một vai:

| Font | Dùng ở đâu | Vì sao |
|---|---|---|
| **Archivo Display** | Tên thương hiệu ở nav, splash, màn đăng nhập, chân trang, tiêu đề bài đang làm | Grotesque nét đậm bản rộng, hợp làm chữ hiệu. Giấy phép **OFL**. |
| **Be Vietnam Pro** | Toàn bộ chữ thân bài, nút, nhãn | **Thiết kế riêng cho tiếng Việt** — dấu thanh được vẽ đúng chứ không chắp thêm. |
| **JetBrains Mono Variable** | Số vote, giá tiền, số tài khoản, thời gian | Chữ số đều bề ngang nên cột số thẳng hàng. |

Toàn bộ **tự host trong `public/fonts/`**, không gọi ra `apollo.cafe`. Nếu để nguyên link
ngoài thì site phụ thuộc vào một máy chủ mình không kiểm soát, và họ chặn hotlink là
chữ hỏng hết.

### Hai lỗi trong khai báo gốc đã sửa

**1. Khai báo sai dải `font-weight`.** Bản gốc ghi `font-weight: normal` cho cả ba font.
Với font biến thiên, khai báo như vậy khoá font ở đúng một nét — trình duyệt phải **bôi
đậm giả** cho các nét khác, chữ bị nhoè và dày không đều. Mình đọc trục `wght` thật trong
từng file rồi khai đúng: DM Sans `100 1000`, JetBrains Mono `100 800`. Riêng Halvar Breit
là file tĩnh nét Bold nên khai `700` — khai `normal` rồi dùng ở `700` cũng gây bôi đậm giả.

**2. Không có ký tự tiếng Việt.** Đây là vấn đề lớn hơn. Cả ba file gốc đều là gói *latin*:

| Font | Ký tự tiếng Việt có sẵn |
|---|---|
| DM Sans | 33/132 (file gốc đầy đủ cũng chỉ 38/132) |
| JetBrains Mono 2.211 | 33/132 |
| Halvar Breit | 52/132 |

Nghĩa là "Bảng yêu cầu" sẽ có `B`, `n`, `g` một kiểu chữ còn `ả`, `ê`, `ầ` một kiểu khác —
lẫn lộn ngay trong cùng một từ. Cách xử lý cuối cùng:

- **JetBrains Mono** nâng lên bản 2.305 → có sẵn đủ **132/132** ký tự tiếng Việt.
- **Archivo** có sẵn đủ **132/132**.
- **DM Sans bị loại hẳn.** Ban đầu định ghép thêm font đệm cho chữ có dấu, nhưng như vậy
  vẫn là hai kiểu chữ trong một từ. Thay bằng **Be Vietnam Pro** — font thiết kế riêng cho
  tiếng Việt, một họ chữ lo tất, không còn cơ chế đệm nào nữa.

Các ứng viên thay DM Sans đã đem đo (đều OFL, đều đủ 132/132):

| Font | Lệch hình học so với DM Sans | Ghi chú |
|---|---|---|
| Onest | 128 | biến thiên, chữ `g`/`y` hơi lạ mắt |
| Manrope | 166 | biến thiên, nhẹ nhất (34 KB) |
| Public Sans | 202 | biến thiên |
| Lexend | 241 | biến thiên |
| **Be Vietnam Pro** | 250 | tĩnh 4 nét, **dấu thanh vẽ riêng cho tiếng Việt** |
| Plus Jakarta Sans | 269 | biến thiên |

Chọn Be Vietnam Pro dù điểm lệch không thấp nhất, vì với trang tiếng Việt thì **chất lượng
dấu thanh quan trọng hơn việc giống DM Sans**, và nó xoá bỏ hoàn toàn cơ chế font đệm.
Đổi lại phải dùng 4 file tĩnh (80 KB) thay vì một file biến thiên.

Lưu ý khi đổi: Be Vietnam Pro **rộng hơn DM Sans**, nên thanh trên cùng bị xuống dòng ở
màn hình cỡ trung. Đã hạ cỡ chữ nav xuống 13px, thêm `white-space: nowrap`, và cho thanh
trên xuống dòng từ 900px thay vì 620px.

### Vì sao thay Halvar Breit bằng Archivo

Halvar Breit là **font thương mại** của TypeMates — dùng cho dự án có doanh thu là phải mua
giấy phép. Đã thay bằng font miễn phí gần giống nhất.

Cách chọn: Halvar Breit thuộc kiểu *grotesque nét đậm bản rộng*, nên chỉ xét những font
miễn phí có **trục bề rộng** hoặc dáng rộng sẵn, và **bắt buộc có tiếng Việt**.
Archivo Black bị loại ngay vì không có tiếng Việt. Còn lại đem đo và so với Halvar:

| Font (nét 700) | x-height | cap | H | o | n | Tổng lệch |
|---|---|---|---|---|---|---|
| *Halvar Breit Bold (chuẩn)* | 501 | 656 | 819 | 685 | 711 | — |
| **Archivo wdth 110** | 526 | 686 | 842 | 672 | 654 | **148** |
| Archivo wdth 120 | 526 | 686 | 930 | 731 | 706 | 217 |
| Anybody wdth 110 | 592 | 675 | 766 | 742 | 724 | 233 |
| Anybody wdth 125 | 590 | 675 | 884 | 854 | 832 | 463 |

→ **Archivo ở bề rộng 110, nét 700**. Mình lấy file variable gốc từ kho Google Fonts,
ghim cứng hai trục đó rồi cắt gọn còn latin + tiếng Việt, ra **24 KB** (Halvar là 52 KB).

Giấy phép **SIL Open Font License 1.1**: dùng thương mại thoải mái, không mất phí, không cần
ghi công trên trang. Điều kiện duy nhất là không bán lại chính file font.

### Muốn đổi font

Sửa ba biến ở đầu `src/index.css`:

```css
--font:    'DM Sans Variable', 'Be Vietnam Pro', ...;   /* chữ thân bài */
--mono:    'JetBrains Mono Variable', ...;              /* số liệu */
--display: 'Archivo Display', ...;                      /* chữ hiệu */
```

Thay font mới nhớ **kiểm tra ký tự tiếng Việt trước**, và khai `font-weight` đúng dải thật
của file chứ đừng ghi `normal`.

## Ngôn ngữ thiết kế

Giao diện đi theo hướng **tối giản, để chữ dẫn dắt thay vì màu**:

- **Một màu nhấn duy nhất** (`--a`, xanh **ultramarine** `#2b22e2`, lấy đúng từ logo —
  không còn là xanh da trời nhạt như bản cũ) cho link, nút chính, tab đang mở và ô nhập
  đang focus. Ngoài ra gần như toàn bộ trang là thang xám trung tính.
- **Không gradient trang trí, không glow phát sáng.** Nói cho chính xác — bản mô tả cũ ghi
  "cả file CSS còn đúng 2 `box-shadow`", điều đó đã sai từ lâu và càng sai sau đợt này:
  bóng đổ *nhẹ* được dùng để tách khối khỏi nền (và thay viền ở chỗ nền phía sau sáng thay
  đổi: ảnh bìa, avatar), thang kính có ba mức độ đục, và có đúng **hai** ngoại lệ được biện
  minh: quầng ultramarine sau khung video chính (đánh dấu "đây là video chính", cả trang chỉ
  một khung) và vệt sáng trên thanh tiến độ của khối *Up next*. Thêm ngoại lệ thứ ba thì
  phải bỏ một trong hai cái đang có.
- **Trạng thái hiện bằng chấm tròn 6px + chữ xám** (`.status`), không phải thẻ nền màu.
  Nhờ vậy một dòng request không còn 3 mảng màu chen nhau.
- **Số liệu dùng font monospace** (`--mono`): số vote, giá tiền, số tài khoản, thời gian.
  Cột số thẳng hàng, dễ đọc, và tạo cảm giác của một công cụ hơn là một trang tiếp thị.
- **Bo góc theo một thang duy nhất** (xem *Hình khối và mặt kính* bên dưới), viền `1px` mảnh.
  Danh sách là **một khối có đường kẻ ngăn** giữa các dòng, không phải nhiều thẻ rời rạc.
- Chữ viết **thường**, không IN HOA giãn chữ.

**Màu trạng thái** (chỉ dùng cho chấm tròn): xám = chờ duyệt · xanh dương = hàng chờ ·
vàng = đang làm · xanh lá = hoàn thành · đỏ = từ chối · vàng đồng = Paid.

**Loại video**: tím nhạt = Color Coded Lyrics · xanh ngọc = Full Album · cam đất = 1 Hour Loop · hồng = Short.

Muốn đổi tông cả trang thì sửa khối `:root` ở đầu `src/index.css`, không cần đụng chỗ nào khác.

## Hồ sơ người dùng — đổi tên và ảnh đại diện

Bấm vào **avatar / tên của bạn ở góc phải thanh trên** để mở hộp thoại hồ sơ.
Sửa được tên hiển thị (2–40 ký tự) và ảnh đại diện.

### Ảnh lưu ở đâu — và vì sao không dùng Drive / Terabox / Mega

Mấy dịch vụ lưu trữ file đó **không dùng làm nơi chứa ảnh cho web được**:

- Không cho link ảnh trực tiếp. Link chia sẻ trả về **trang HTML xem trước**, không phải file ảnh,
  nên thẻ `<img>` không hiển thị được.
- Bắt đăng nhập OAuth mới upload được, tức là người dùng phải đăng nhập thêm một tài khoản nữa.
- Chặn hotlink khi lượng truy cập tăng, ảnh đang chạy tự nhiên hỏng hết.

Cách app đang làm — **thu nhỏ ảnh ngay trên máy người dùng trước khi gửi đi**:

1. Cắt vuông ở giữa, thu về **128×128**, nén WebP chất lượng 0.72.
2. Kết quả thường chỉ **5–9KB** (ảnh chân dung còn nhẹ hơn).
3. Lưu thẳng vào cột `profiles.avatar_url` dưới dạng data URI.

**Không tốn ô Storage nào của Supabase, không cần tạo bucket, không cần policy.**
Với 500MB database của gói free, 1.000 người dùng chỉ chiếm khoảng **9MB** — tức 2% hạn mức.

Ảnh hiển thị to nhất trong app là 64px (trong chính hộp thoại này), còn lại là 24–26px,
nên 128px đã dư nét kể cả trên màn hình Retina.

### Nếu sau này đông người dùng

Điền 2 biến vào `.env` là ảnh tự chuyển sang Cloudinary (free 25GB), code không phải sửa gì:

```
VITE_CLOUDINARY_CLOUD=ten_cloud_cua_ban
VITE_CLOUDINARY_PRESET=ten_unsigned_upload_preset
```

Tạo preset ở Cloudinary → Settings → Upload → Add upload preset → **Signing Mode: Unsigned**.
Preset dạng unsigned được thiết kế để lộ ra client, không phải khoá bí mật.

### Chỉnh khung ảnh

Chọn ảnh xong sẽ hiện khung chỉnh trước khi lưu:

- **Kéo** trong khung để dời ảnh.
- **Lăn chuột** hoặc kéo thanh trượt để phóng to, tối đa 4×.
- Vòng tròn sáng cho thấy đúng phần sẽ được giữ lại; phần ngoài bị làm tối.

Ảnh luôn bị ràng buộc để **không kéo hở mép** — dù kéo mạnh cỡ nào thì khung vẫn kín.
Chỉ khi bấm **"Dùng ảnh này"** thì vùng đã chọn mới được cắt và nén; bấm Huỷ thì bỏ hết.

Hai lỗi đã sửa ở khung này, ghi lại để sau khỏi mắc lại:

- **Vùng tối ăn lẹm vào trong vòng tròn.** Bản đầu dùng `radial-gradient` với color-stop
  `50%`. Phần trăm trong color-stop của gradient tính theo **tia tới góc xa nhất**
  (≈1.41 lần bán kính), không phải theo cạnh — nên vùng tối bắt đầu ở bán kính 79px
  trong khi đường viền tròn nằm ở 112px. Nay dùng `box-shadow: 0 0 0 9999px` trên một
  phần tử `border-radius: 50%`, khớp chính xác tuyệt đối.
- **Lăn chuột để zoom làm trang phía sau cuộn theo.** React gắn `onWheel` ở chế độ
  **passive**, nên `e.preventDefault()` trong handler của React không có tác dụng.
  Phải tự gắn listener bằng `addEventListener('wheel', h, { passive: false })`.

Toán học vùng cắt nằm ở `AvatarCropper.jsx`: từ vị trí và độ phóng trên màn hình, quy ngược
ra toạ độ pixel `{sx, sy, size}` trên ảnh gốc, rồi `renderCrop()` trong `lib/avatar.js`
vẽ đúng vùng đó ra canvas 128×128.

### Vài chi tiết đã xử lý

- Nút **"Dùng ảnh Google"** xoá ảnh tự tải lên, quay về ảnh đại diện Google.
- Đổi tên thì hàm `update_my_profile` **cập nhật luôn cột `requester`** trong mọi request cũ,
  nên bảng xếp hạng và danh sách không còn tên cũ.
- Nút Lưu chỉ sáng khi thực sự có thay đổi.
- Database chặn ảnh dài quá 200.000 ký tự, phòng trường hợp ai đó gọi thẳng API.

## Âm thanh

Nút loa nằm trong khối *Cài đặt* của sidebar. Trạng thái bật/tắt lưu trong
`localStorage` (khoá `ccl.sfx`), giữ nguyên sau khi tải lại trang.

Tiếng chỉ kêu ở **hai thao tác**: bấm vote (và bỏ vote) và gửi request thành công.

**Không có file âm thanh nào.** Toàn bộ được tổng hợp bằng Web Audio API trong
`src/lib/sfx.js`. Không thêm KB nào vào app, chạy được cả khi mất mạng, không dính bản quyền.

### Âm sắc

Mỗi nốt gồm **hai dao động chồng lên nhau**:

- **Sóng tam giác** ở cao độ chính — cho thân tiếng, ấm hơn sóng sin thuần.
- **Sóng sin ở quãng tám trên**, âm lượng chỉ 22% và tắt nhanh hơn — tạo độ lấp lánh
  như tiếng mộc cầm (marimba).

Bao âm lượng kiểu **gảy đàn**: vào trong 8ms rồi ngân tắt dần theo hàm mũ. Tất cả đi qua
một **bộ lọc thông thấp 5.2kHz** để cắt phần chói của sóng tam giác.

### Giai điệu

Các nốt đều nằm trong **hợp âm Đô trưởng** và lệch nhau vài chục mili giây, nên nghe
như rải dây đàn chứ không phải bấm một cục hợp âm.

| Thao tác | Giai điệu | Dài |
|---|---|---|
| Vote | Đô – Mi – Sol đi lên (C6–E6–G6) | ~0.37s |
| Bỏ vote | Mi – Đô đi xuống, khẽ hơn | ~0.25s |
| Gửi request | Sol–Đô–Mi–Sol–Đô rải lên rồi ngân (G5→C7) | ~0.68s |

Đỉnh biên độ đo được là **0.18** trên thang 0–1, tức còn xa mức vỡ tiếng. Muốn to/nhỏ
hơn thì sửa cột âm lượng cuối mỗi nốt trong bảng `VOICES`, hoặc chỉnh `master.gain`
trong hàm `buildBus`.

Thêm tiếng mới chỉ cần thêm một mảng nốt vào `VOICES` rồi gọi `play('tên')`.
Hàm `schedule()` tách riêng khỏi phần chạy thật nên render kiểm thử được bằng
`OfflineAudioContext` — đó là cách các file trong `preview-am-thanh/` được tạo ra.

Trình duyệt chặn phát âm thanh trước khi người dùng bấm gì đó, nên `AudioContext`
chỉ được tạo ở lần bấm đầu tiên — không phải lúc mở trang.

## Thông báo: toast trong trang

Mọi phản hồi với người dùng đi qua CÙNG một chỗ: `src/lib/notify.jsx` (Provider) và
`src/components/Toaster.jsx` (chồng toast góc phải). Muốn thêm một mẩu tin ở đâu đó, chỉ cần:

```jsx
const { push } = useNotify()
push({ tone: 'ok', title: 'Đã xong', body: 'Nội dung phụ, xuống dòng được.' })
// tone: 'ok' | 'err' | 'info' | 'gold' — chỉ đổi màu mép trái + icon
```

Ba việc được thông báo riêng (đúng yêu cầu của chủ kênh):

| Khi | Mẩu tin (key trong `i18n.jsx`) |
|---|---|
| Gửi request **miễn phí** thành công | `notif.reqTitle` "Request sent" + `notif.reqBody` "{song} is waiting for review." |
| Tạo **Paid Request** | `notif.paidTitle` + số tiền, kèm nút `notif.payNow` mở thẳng tab Mua vote |
| **Đặt mua vote** xong | `notif.buyTitle` "Order for N votes" + `notif.buyBody` số tiền cần chuyển |

Bỏ phiếu thì KHÔNG có toast (đã có tiếng + số đổi ngay tại chỗ + vòng sáng) — spam một mẩu tin
cho mỗi cú click là tự làm phiền mình.

### Chi tiết đếm giờ của toast

Mỗi mẩu tin tự đếm bằng `requestAnimationFrame` (`src/components/Toaster.jsx`) vì ba lý do:
thanh tiến độ chạy mượt đúng bằng thời gian còn lại, **rê chuột vào là dừng thật** (không phải
hoãn setTimeout dễ lệch), và tab bị ẩn thì đồng hồ nghỉ chứ không âm thầm ăn hết giờ. Hết giờ thì
provider đánh dấu `.out` cho animation trượt ra chạy xong mới nhấc DOM khỏi cây — cùng một cách
mà modal đang dùng.

## Tự sửa chữ trên web

**Toàn bộ câu chữ nằm trong một file duy nhất: `src/lib/i18n.jsx`.** Không phải đi lục
từng file component.

### Cách làm

1. Mở `src/lib/i18n.jsx`.
2. Bấm `Ctrl + F`, gõ đúng đoạn chữ bạn thấy trên web, ví dụ `New request`.
3. Bạn sẽ thấy một dòng như thế này:

```js
'btn.newRequest': 'New request',
//   phần này          phần này
//   ĐỪNG sửa          SỬA THOẢI MÁI
```

4. Chỉ sửa **phần trong nháy đơn thứ hai**. Phần bên trái dấu `:` là mã định danh —
   sửa vào đó là hỏng chỗ hiển thị.
5. App chỉ có một thứ tiếng nên chỉ có một khối `const S = { ... }` — không còn phải sửa
   song song hai bản Việt/Anh như trước.
6. Lưu file → chạy `npm run build` → deploy lại. Xong.

### Ba điều dễ làm hỏng

**Dấu nháy trong câu.** Chuỗi được bọc bằng nháy đơn `'`, nên nếu chữ của bạn có dấu
nháy đơn thì phải đổi cách bọc:

```js
'mine.empty': "You haven't sent a request yet",   // dùng nháy kép, an toàn hơn
```

**Dấu phẩy cuối dòng.** Mỗi dòng phải kết thúc bằng dấu `,`. Xoá mất là trắng trang.

**Phần `{...}` là biến, phải giữ nguyên.** Ví dụ:

```js
'gate.perk2': '{n} requests per hour',
```

`{n}` sẽ được thay bằng con số thật lúc chạy. Bạn đổi chữ xung quanh thoải mái, nhưng
xoá `{n}` là mất luôn con số. Tương tự `{p}`/`{amt}` là giá tiền, `{y}` là năm, `{song}`
là tên bài, `{mb}` là dung lượng ảnh.

### Giọng chữ — viết sao cho không giống máy viết

App đã bỏ hết những câu "giải thích hộ người dùng" (`Up to 3 requests per hour…`,
`Scanning fills in the amount automatically`, `Want desktop notifications?`) và những chỗ
thêm thắt cho có vị. Đây là những kiểu câu ĐÃ bị bỏ vì nghe như chatbot:

| Đừng viết | Viết thế này |
|---|---|
| `Please enter the artist and song title.` | `Artist and {f} are required.` |
| `You're out of votes! Buy more to keep going 🎉` | `Out of votes. Buy more to continue.` |
| `Great! Your request has been submitted successfully.` | `Request sent. A moderator will review it.` |
| `This section is currently unavailable.` | `Voting is closed for this request.` |

Sáu quy tắc đang áp dụng, sửa chữ thì giữ theo:

1. **Mở đầu bằng kết quả hoặc hành động**, không "Please"/"The system". Trang nói với người
   đang chờ, không gửi công văn.
2. **Một câu cho một việc.** xoá các mệnh đề phụ kiểu "and you'll be able to…".
3. **Hết câu bằng dấu chấm.** Dấu than chỉ dùng khi người dùng vừa làm xong việc vui
   (vote thành công) — mà thực tế ở đây cũng bỏ hết.
4. **Không em-dash để "thêm chút giọng điệu"** (`Sent! It joins the queue — faster with votes`).
   Tách thành hai câu.
5. **Đừng dỗ dành** ("No worries", "you're all set", "just sign in"). Người đọc chỉ muốn biết
   chuyện gì xảy ra và bước tiếp theo là gì.
6. **Tên đối tượng viết hoa như trong app**: `Paid request` → `Paid Request` khi nó là tên
   một mục/tab; còn lại viết thường. Icon ★ ▶ ● đã bỏ khỏi nhãn.

Đổi giọng hàng loạt thì sửa theo cụm key: `*.empty` (khi rỗng), `err.*` (lỗi), `notif.*`
(thông báo), `req.*`/`vote.*`/`buy.*` (trong form). Tiêu đề mỗi mục chỉ là một dòng
(`nav.board`/`nav.ranking`/`nav.mine`) — dòng mô tả xám dưới tiêu đề đã bỏ hẳn, nên không còn
nhóm key `head.*` nào cả.

### Chữ KHÔNG nằm trong file này

| Nội dung | Sửa ở đâu |
|---|---|
| Tên 4 loại video | `KINDS` trong `src/lib/db.js` + `KIND_META` trong `src/lib/meta.js` + `CHECK` trong `schema.sql` |
| Tiêu đề trên tab trình duyệt | thẻ `<title>` trong `index.html` |
| Số tài khoản, PayPal, Telegram | `src/lib/payment.js` |
| Giá tiền | `src/lib/db.js` (và `schema.sql` cho Paid Request) |
| Tên thương hiệu ở splash / màn hình đăng nhập | `Splash.jsx`, `LoginGate.jsx` — để cứng `Chaereve`, không qua từ điển |

## Publish app trên Google (làm sau khi đã deploy)

Chừng nào app còn ở chế độ **Testing**, chỉ tài khoản trong danh sách *Test users* mới
đăng nhập được; người lạ sẽ gặp lỗi `access_blocked`. Muốn mở cho tất cả mọi người thì
phải Publish, và Google đòi 3 thứ:

| Ô | Điền gì |
|---|---|
| **Application home page** | Địa chỉ trang, ví dụ `https://ten-app.pages.dev` |
| **Application privacy policy link** | `https://ten-app.pages.dev/privacy.html` |
| **Authorized domains** | Tên miền gốc, ví dụ `pages.dev` hoặc tên miền riêng của bạn |

Nghĩa là bạn **cần một trang chính sách bảo mật thật**. Không thể để trống hay trỏ lung tung.

Các bước:

1. Deploy lên Cloudflare Pages trước để có địa chỉ.
2. Tạo trang chính sách bảo mật (xem ghi chú bên dưới) rồi deploy lại.
3. Quay lại **Google Auth Platform → Branding**, điền 3 ô trên, bấm **Save**.
4. Sang thẻ **Audience** → khung vàng biến mất → bấm **Publish app**.

> App này chỉ xin quyền đọc **tên và ảnh đại diện công khai** — thuộc nhóm *không nhạy cảm*.
> Nên Publish là dùng được ngay, **không phải chờ Google duyệt**. Chỉ khi bạn tải logo tuỳ
> chỉnh lên hoặc xin thêm quyền nhạy cảm thì mới bị đẩy vào hàng chờ xác minh.

## Deploy: Cloudflare Pages hay Vercel?

**Nên chọn Cloudflare Pages.** Lý do quan trọng nhất không phải tốc độ hay băng thông:

> **Gói Vercel Hobby (free) chỉ cho phép dùng phi thương mại.** Điều khoản của Vercel
> cấm mọi mục đích sinh doanh thu trên gói này. App này bán gói vote và Paid Request,
> tức là có doanh thu — dùng Hobby là vi phạm điều khoản, có thể bị khoá bất cứ lúc nào.
> Muốn đúng luật thì phải lên Pro **$20/tháng**.
>
> **Cloudflare Pages free không cấm thương mại.**

Vài khác biệt khác cũng nghiêng về Cloudflare:

| | Cloudflare Pages (free) | Vercel Hobby (free) |
|---|---|---|
| Dùng cho mục đích kiếm tiền | **Được** | Không được |
| Băng thông | **Không giới hạn** | 100 GB/tháng |
| Khi vượt hạn mức | Vẫn chạy bình thường | **Tạm dừng site** |
| Số lần build | 500/tháng | 100 deploy/ngày |
| Tên miền riêng | 100/project | Không giới hạn |
| Điểm phát toàn cầu | 330+ | 100+ |

App này là **web gần như tĩnh thuần** (Vite build ra HTML/CSS/JS, dữ liệu gọi Supabase từ
trình duyệt) cộng đúng 3 API của lá chắn Edge chạy bằng **Pages Functions** (`/api/*`).
Chỉ request `/api/*` mới tính vào hạn mức Functions (100.000 request/ngày ở gói free —
volume Spin/Vote còn lâu mới chạm); toàn bộ file tĩnh vẫn miễn phí không giới hạn.

> **Đường chính thức là Pages (Cách A)** — project đã nối GitHub và tự build khi push.
> Cloudflare có khuyến nghị dự án mới dùng Workers with Static Assets, và repo vẫn giữ
> `wrangler.jsonc` cho ai muốn đi đường đó (Cách B, phương án thay thế) — nhưng mọi hướng
> dẫn lá chắn Edge trong file này viết cho Pages.

### Giới hạn của các gói miễn phí — con số thật, và cách sống trong đó

Cả chồng dịch vụ của app này đều đang chạy ở gói **miễn phí** (Cloudflare Pages + Pages
Functions, Supabase, Turnstile, GitHub). Không có tính năng nào trong app cần trả tiền.
Nhưng có năm con số phải biết, vì chúng quyết định cách viết code chứ không chỉ là chuyện
hoá đơn:

| Giới hạn | Ở đâu | Nghĩa là phải… |
|---|---|---|
| **10 ms CPU / request** | Cloudflare Workers & Pages Functions (free) | Đừng tính toán gì nặng trong Function. Việc nặng (chốt request, gộp thông báo, cộng vote) để **Postgres** làm — Function chỉ gọi **một** RPC rồi trả về. Thời gian chờ mạng không tính vào 10 ms, nên mô hình này thoải mái |
| **5 cron trigger / tài khoản** | Cloudflare Workers (free) | Gộp mọi việc định kỳ vào **một** cron (đúng cách app này đang làm: một lượt chốt request). Cần thêm việc định kỳ thì nhét vào cùng lượt đó, đừng tạo cron thứ hai |
| **50 request con / lượt gọi** | Workers free | Nếu sau này gửi thông báo ra Telegram/Discord thì phải **gộp nhiều tin vào một lần gửi** và chặn số lượng mỗi lượt (ví dụ 20 tin/lượt) |
| **500 MB database · 5 GB băng thông · 2 triệu tin realtime/tháng · 200 kết nối realtime** | Supabase free | Đủ cho quy mô hiện tại, nhưng tin realtime là tài nguyên quý nhất trong này: mỗi lần một hàng `requests` đổi là thông tin đó được đẩy tới **mọi** người đang mở trang. Đừng thêm realtime cho việc gì không cần thiết |
| **20.000 file mỗi lần deploy** | Cloudflare Pages/Workers free | Nếu sau này muốn sinh sẵn một trang tĩnh cho mỗi video đã làm thì được, nhưng nhớ con số này — vài trăm bài thì không sao, vài chục nghìn thì chạm trần |

Hai điểm **không phải giới hạn nhưng dễ mất dữ liệu**, quan trọng hơn mọi tính năng:

1. **Gói free của Supabase KHÔNG có backup tự động.** Dữ liệu thật (request, vote, đơn
   hàng, vòng quay) chỉ nằm ở một chỗ. Cách rẻ nhất để ngủ ngon: một tác vụ định kỳ chạy
   `pg_dump` và cất file đi — GitHub Actions có 2.000 phút/tháng miễn phí, thừa sức cho việc
   này. Làm trước khi làm thêm bất cứ tính năng nào.
2. **Project free của Supabase tự tạm dừng sau 7 ngày không có hoạt động**, và phải vào
   dashboard bấm khởi động lại (mất tới ~60 giây). Site có người vào mỗi ngày thì không bao
   giờ chạm chuyện này; nhưng nếu app im ắng (hoặc cron không gọi database), nó sẽ ngủ. Lượt
   cron chốt request hiện tại *có* gọi database nên nó tự giữ project thức — miễn là cron còn chạy.

> **Đừng dùng gói free của Vercel cho app này** — Hobby cấm mục đích sinh doanh thu, mà app có
> bán vote. Xem bảng so sánh ngay trên.

### Sao lưu database — 5 phút, làm MỘT lần

Mục *Giới hạn của các gói miễn phí* ngay trên đã nói vì sao việc này quan trọng: gói free của
Supabase **không có backup tự động**. Repo đã có sẵn một workflow tự sao lưu mỗi ngày —
`.github/workflows/backup-db.yml` — và nó không chỉ copy file ra: sau khi dump, nó **đổ bản
dump vào một Postgres sạch** ngay trong máy ảo của GitHub rồi so *dấu vân tay* với nguồn (số
dòng từng bảng, số function, **policy RLS**, trigger, sequence, index và view). Lệch một dòng
là job đỏ và GitHub gửi email cho bạn.

> Vì sao phải thử phục hồi mới tính là sao lưu: một file `.dump` nằm trong thư mục trông rất
> giống một bản sao lưu, nhưng chỉ khi dựng lại được nó mới *là* sao lưu. Cách hỏng hay gặp
> nhất là **thiếu policy RLS** — số dòng vẫn khớp hoàn hảo mà quyền thì đã hở.

**Ba bước:**

1. **Lấy chuỗi kết nối.** Supabase → nút **Connect** → tab **Session pooler** → copy chuỗi
   dạng `postgresql://postgres.abcdefghij:[MẬT KHẨU]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`.
   **Đừng** lấy *Direct connection* (`db.<ref>.supabase.co`): địa chỉ đó chỉ có IPv6, mà máy
   chạy của GitHub chỉ có IPv4 — sai chỗ này thì job đỏ với lỗi *Network is unreachable*.
2. **Dán vào secret.** GitHub → repo → **Settings → Secrets and variables → Actions → New
   repository secret**, tên đúng là `SUPABASE_DB_URL`, giá trị là chuỗi vừa copy.
3. **Chạy thử một lần bằng tay.** Tab **Actions** → *Sao lưu database* → **Run workflow**.
   Khoảng một phút sau: ✅ là xong; ❌ thì log in sẵn bốn nguyên nhân hay gặp (sai mật khẩu,
   project đang ngủ, sai loại chuỗi kết nối, client cũ hơn server).

Sau đó nó tự chạy lúc **02:00 giờ VN mỗi ngày**. Lợi ích phụ đáng kể: vì nó chạm database mỗi
ngày, nó cũng là thứ **giữ project free khỏi tự ngủ** sau 7 ngày im ắng (xem mục *Giới hạn của
các gói miễn phí*). Hai điều cần biết:

- **Cron chỉ chạy trên nhánh mặc định** (`main`). Chạy tay thì nhánh nào cũng được, nhưng
  muốn nó tự chạy hằng ngày thì phải merge.
- Bản sao nằm trong **artifact của lượt chạy** (Actions → lượt gần nhất → mục *Artifacts*),
  giữ **30 ngày**, mỗi lượt một gói theo ngày. Trong gói có cả `manifest.txt` (ngày, commit,
  số dòng từng bảng) và `fingerprint.txt`.

**Muốn giữ lâu hơn 30 ngày?** Thêm bốn secret để đẩy sang **Cloudflare R2** (gói free: 10 GB,
không tính phí băng thông ra): `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` (R2 → *Manage R2 API Tokens* → token có quyền *Object Read & Write*).
Không khai báo gì thì bước này tự bỏ qua và **không** làm hỏng lượt sao lưu. Bản trên R2 xếp
theo ngày và **không bao giờ ghi đè** bản cũ, nên một lần dump hỏng không xoá mất bản lành.

**Khi cần phục hồi thật:**

```bash
# 1. Tạo project Supabase mới, lấy chuỗi Session pooler của nó
# 2. Đổ bản dump vào (policy RLS, trigger, sequence đi kèm đầy đủ)
pg_restore --no-owner --dbname "$CHUOI_CUA_PROJECT_MOI" backup/ccl-*.dump
```

Project Supabase mới đã có sẵn `anon` / `authenticated` / `service_role`, schema `auth` và
`pgcrypto` nên bản dump vào thẳng được. Hai thứ **không** nằm trong bản dump và phải làm lại
tay: **biến môi trường trên Pages** và **URL cấu hình trong Google/Supabase Auth** — chúng
thuộc về nơi deploy, không thuộc database.

File `auth-users.sql` (nếu có) là **lưới an toàn để đối chiếu**, không phải bản phục hồi một
cú bấm: nó chỉ có dữ liệu bảng `auth.users` (id + email), đủ để biết ai từng đăng nhập và
không đủ để dựng lại phiên đăng nhập. Đừng coi nó là thứ thay thế bản dump chính.

Chạy tay trên máy mình (cần `postgresql-client-17`):

```bash
SUPABASE_DB_URL='postgresql://…' npm run backup:db        # dump + manifest vào ./backup/
VERIFY_DB_URL='postgres://postgres@127.0.0.1:5432/trong' npm run backup:verify
```

Thư mục `backup/` đã nằm trong `.gitignore`: dữ liệu thật **không bao giờ** vào git.

### Cách A — Cloudflare Pages (đơn giản hơn, khuyên dùng nếu mới bắt đầu)

1. Push code lên GitHub.
2. Vào **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**.
3. Chọn repo, rồi điền:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Mục **Environment variables**, thêm hai biến (nhớ thêm cho cả Production lẫn Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   (Lá chắn Edge cần thêm KV binding + secret + hai biến `VITE_*_GATE_URL` nữa — nhưng
   KHÔNG thêm lúc này. Làm đúng thứ tự trong mục *Lá chắn Edge* ở trên: deploy xong,
   health trả JSON, rồi mới thêm biến gate.)
5. Bấm **Save and Deploy**. Xong sẽ có link dạng `ten-project.pages.dev`.
6. Quay lại **Supabase → Authentication → URL Configuration**, thêm domain mới vào
   *Site URL* và *Redirect URLs*. **Bỏ qua bước này thì đăng nhập Google sẽ hỏng.**
7. (Tuỳ chọn) Vào **Google Auth Platform → Clients**, thêm domain mới vào
   *Authorized JavaScript origins* — chỉ cần nếu sau này dùng Google One Tap.

File `public/_redirects` đã có sẵn trong project (`/* /index.html 200`) để Cloudflare
trả về đúng trang khi người dùng F5 ở một đường dẫn con.

### Cách B — Workers with Static Assets (phương án thay thế)

Chỉ dùng khi bạn cố tình không muốn Pages. Dự án đã có sẵn file `wrangler.jsonc` khai báo
mọi thứ, nên không phải tự viết — nhưng KV/secret phải tạo lại bằng CLI theo chú thích
trong file đó, cấu hình Dashboard của Pages không tự mang sang.

1. **Cloudflare Dashboard → Workers & Pages → Create → Workers → Import a repository**
2. Chọn repo, rồi điền:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. Thêm 2 biến môi trường như Cách A.
4. **Deploy**. Địa chỉ sẽ có dạng `color-coded-lyrics.<tên-bạn>.workers.dev`.

Trang là **web tĩnh thuần**: mọi thứ động gọi thẳng Supabase từ trình duyệt; ảnh bìa video
lấy thẳng từ `i.ytimg.com` (trình duyệt đọc được, không cần proxy). Dòng
`not_found_handling: "single-page-application"` trong `wrangler.jsonc` thay cho vai trò của
`/* /index.html 200` bên Pages.

Đổi tên trang thì sửa `"name"` trong `wrangler.jsonc`.

## Tên miền miễn phí

### 1. `.id.vn` — miễn phí thật, dành riêng cho người Việt

Đây là lựa chọn tốt nhất nếu bạn **từ 18 đến 23 tuổi**:

- Miễn cả lệ phí đăng ký lẫn phí duy trì **2 năm đầu**. Từ năm thứ 3 là 50.000đ/năm.
- Chương trình ban đầu chỉ đến 31/12/2025, nhưng **đã được gia hạn tới hết năm 2026**
  theo Thông tư 64/2025/TT-BTC — nên hiện tại vẫn đăng ký được.
- Mỗi người chỉ được **một** tên miền ưu đãi, phải xác thực danh tính bằng eKYC,
  không đăng ký hộ người khác được.
- Đăng ký qua các nhà đăng ký của VNNIC: tenmien.vn, BKNS, PA Việt Nam, Mắt Bão…

Ngoài tuổi đó vẫn đăng ký `.id.vn` được, chỉ là mất 10.000đ lệ phí + 50.000đ/năm —
vẫn rẻ hơn hầu hết tên miền quốc tế.

### 2. Tên miền phụ miễn phí vĩnh viễn

Không giới hạn tuổi, không mất đồng nào, nhưng là **tên miền phụ** chứ không phải
tên miền riêng. Xin bằng cách gửi Pull Request vào repo của họ:

| Tên miền | Điều kiện |
|---|---|
| `ten-ban.is-a.dev` | dành cho lập trình viên |
| `ten-ban.js.org` | dự án phải liên quan JavaScript — app này hợp lệ |
| `ten-ban.eu.org` | duyệt khoảng 14 ngày, phi thương mại |
| `ten-ban.is-an.app` | hỗ trợ cả CNAME lẫn wildcard |

### 3. Miễn phí sẵn có

`ten-project.pages.dev` của Cloudflare hoặc `ten-project.vercel.app` — chẳng cần làm gì,
có SSL sẵn. Dùng tạm lúc đầu hoàn toàn ổn.

### Cảnh báo

**Đừng tốn thời gian với Freenom** (`.tk`, `.ml`, `.ga`, `.cf`, `.gq`). Dịch vụ này đã
ngừng cấp tên miền miễn phí từ 2023 và mất luôn quyền quản lý `.tk`. Các bài hướng dẫn
cũ trên mạng vẫn nhắc tới nó nhưng không còn dùng được nữa.

Nếu muốn tên miền quốc tế đẹp, `.xyz` hoặc `.site` năm đầu thường chỉ 1–3 USD.
Mua thẳng ở **Cloudflare Registrar** thì họ bán đúng giá gốc, không đội giá lúc gia hạn
như nhiều nhà đăng ký khác.

## Liên hệ hỗ trợ

Câu liên hệ là MỘT key duy nhất — `support.line` trong `src/lib/i18n.jsx` — và nó tự ghép với
link `t.me/<handle>`:

> Contact for help or refund: Telegram t.me/ssochuz

Đổi câu thì sửa `support.line` (để nguyên chữ `Telegram` ở cuối chuỗi vì link đứng ngay sau);
đổi người thì sửa `SUPPORT` ở `src/lib/payment.js` — cả ba chỗ dưới đây tự theo.

Dòng liên hệ hiện ở ba chỗ: tab **Mua vote / Thanh toán**, mục **Của tôi** → "Đơn hàng của tôi",
và **chân trang**.

Đổi tài khoản thì sửa `SUPPORT` ở đầu `src/lib/payment.js`:

```js
export const SUPPORT = {
  telegram: 'ssochuz',
  telegramUrl: 'https://t.me/ssochuz',
}
```

Vì app không dùng cổng thanh toán tự động nên việc hoàn tiền phải làm thủ công —
người dùng huỷ đơn xong mà đã lỡ chuyển khoản thì nhắn Telegram để bạn hoàn lại.

## Tiến độ theo cột mốc

Trong bảng Admin, bấm **Sửa** ở một request đang xử lý sẽ thấy 3 ô tích:

| Cột mốc | Trọng số |
|---|---|
| Layout | 40% |
| Lyrics | 40% |
| Edit | 20% |

Tích vào là phần trăm tự cộng, thanh tiến độ chạy theo ngay, và trạng thái tự chuyển sang
*Đang làm*. Không còn ô nhập số thủ công.

Ba cột mốc lưu thành 3 cột boolean riêng trong bảng `requests` (`done_layout`,
`done_lyrics`, `done_edit`) chứ không chỉ lưu mỗi con số phần trăm — nếu chỉ lưu số thì
40% không biết là đã xong Layout hay Lyrics, mở lại sẽ mất dấu tích.

Phần trăm được **tính ở phía database** trong hàm `admin_update`, nên dù có gọi thẳng API
cũng không đặt sai được. Riêng khi đánh dấu hoàn thành thì tự nhảy 100%.

**Một bài là một video, không phải một dòng trong bảng.** Cùng một bài thường có vài request
trùng nhau (mỗi người gửi một cái, đã cộng dồn vote khi xếp hạng). Vì thế tick/bỏ tick một
cột mốc được áp cho **toàn bộ cụm cùng bài** — `groupIds()` trong `src/lib/board.js` lấy ra
những request cùng `groupKey` mà còn `queued`/`in_progress`, rồi `adminUpdateMany()` ghi cùng
một patch cho cả danh sách. Request đã *hoàn thành* hoặc *bị từ chối* không bị kéo ngược về
40%. Demo thì ghi `localStorage` một lần cho cả cụm; bản thật gọi lại `admin_update` theo
từng id (trong DB không có RPC nào nhận danh sách, và ta không thêm migration), nên thao tác
này không nguyên tử — toast sẽ báo "Updated · n requests for this song" để biết đã chạm bao
nhiêu dòng. Nút **Save and complete** cũng đi theo cụm, nhưng với danh sách trạng thái rộng
hơn — `['queued','in_progress','completed']` — vì link video đã đăng thì phải về với cả
những bản trùng đã được đánh dấu xong từ trước; request *bị từ chối* cố tình không nằm trong
danh sách đó. Các quyết định theo từng người (duyệt, từ chối, đưa về hàng đợi, đổi tên bài) vẫn
chỉ áp một dòng; riêng Up next đã có `admin_pick_group` lo theo cụm từ trước.

Đổi tên hoặc trọng số các mốc: sửa `MILESTONES` trong `src/lib/db.js` **và** phần tính
`v_pct` trong `admin_update` của `schema.sql`.

## Người dùng tự huỷ đơn đặt mua

Đơn nào còn ở trạng thái **Chờ xác nhận** thì có nút `×` bên cạnh, bấm là huỷ.
Nút xuất hiện ở hai chỗ: tab **Mua vote / Thanh toán** (mục "Đơn của bạn") và
mục **Của tôi** → "Đơn hàng của tôi".

Quy tắc an toàn đã cài sẵn:

| Tình huống | Kết quả |
|---|---|
| Đơn mua vote, đang chờ xác nhận | Huỷ được, xoá đơn |
| Đơn Paid Request, request còn chờ duyệt | Huỷ được — **xoá cả đơn lẫn request** đi kèm |
| Đơn Paid Request, request đã được duyệt | Chặn, báo lỗi |
| Đơn bạn đã bấm "Đã nhận tiền" hoặc đã từ chối | Chặn, báo lỗi |
| Đơn của người khác | Chặn (kiểm tra ở phía database) |

Việc kiểm tra nằm trong hàm `cancel_my_order` của `supabase/schema.sql`, không phải
chỉ ẩn nút ở giao diện — nên người dùng không lách được bằng công cụ dev.

Nếu bạn đã chạy `schema.sql` từ trước, chạy lại **toàn bộ file** một lần nữa trong
SQL Editor để cập nhật. File viết theo kiểu `create or replace`, chạy lại nhiều lần
không mất dữ liệu.

## Chữ trên giao diện — một thứ tiếng

App chỉ dùng **tiếng Anh**. Khối đổi ngôn ngữ (nút `VI | EN`, `localStorage` khoá `ccl.lang`)
đã bỏ hẳn, cùng với toàn bộ chuỗi tiếng Việt trong `src/lib/i18n.jsx`. Lý do: khách vào trang
nhìn thấy hai nút ngôn ngữ nhưng thực chất chỉ có một nội dung, còn chủ kênh thì phải sửa chữ
hai lần cho mỗi câu.

Toàn bộ chữ vẫn nằm trong **một file duy nhất** — `src/lib/i18n.jsx`, object `S`:

```js
const S = {
  'nav.board': 'Requests',
  'req.ok': 'Request sent. A moderator will review it.',
  ...
}
```

- **Sửa chữ**: tìm khoá (bấm `Ctrl+F` dán đúng câu đang thấy trên web) rồi sửa giá trị.
  Không phải đụng vào component nào.
- **Chuỗi có biến**: `{n}`, `{p}`, `{song}`… — giữ nguyên, chỉ sửa xung quanh.
- Trong component: `const { t } = useI18n()` rồi `t('nav.board')`.
- Lỗi: `db.js` / `avatar.js` ném `appError('err.rateLimit', { n: 3 })`; component gọi
  `errMsg(t, e)` để dịch.
- Tiền và số lớn: `vnd()` / `compact()` trong `lib/meta.js` theo chuẩn `en-US`
  (`20,000₫`, `1.2K`). Giá USD vẫn `$1.29`.
- `<html lang="en">` khai ngay trong `index.html`.

**Không dịch**: tên nghệ sĩ, tên bài hát, ghi chú người dùng nhập, tên loại video
(`Color Coded Lyrics`, `Full Album`, `1 Hour Loop`, `Short`) — đây là tên riêng/thuật ngữ.

### Nếu sau này muốn thêm tiếng Việt nữa

Đừng làm nếu thật sự cần. Khi cần thì: đặt lại `DICT = { en: {...}, vi: {...} }` trong
`i18n.jsx`, cho `t()` rơi về `en` khi thiếu khoá, và thêm một nút chọn ngôn ngữ ở khối
*Cài đặt* của sidebar — lúc đó `vnd()`/`compact()` cũng phải nhận tham số ngôn ngữ trở lại.
Hai hàm định dạng này và `timeAgo()` đang được gọi kiểu `vnd(x)`, `compact(n)`.

## Sidebar

Bản cập nhật này dọn hết công cụ vào **một cột trái cố định**, đúng kiểu trang
`janette-request.pages.dev` (nhưng bỏ cây thư mục của họ). Cột đó có:

- **Logo + tên kênh**, dòng chữ nhỏ `REQUEST PAGE`.
- Nút **Gửi request** ngay đầu cột.
- Bốn mục chính: Bảng yêu cầu / Daily Spin / Bảng xếp hạng / Của tôi — kèm số đếm. Ô sáng của mục
  đang đứng là một phần tử riêng, đổi mục là nó **trượt** tới chỗ mới (kèm vạch xanh ở
  mép trái) chứ không tắt/bật.
- Khối **Cài đặt**: bật/tắt âm thanh.
- Khối **Kết nối**: link mở thẳng kênh **YouTube @Chaereve** ở tab mới, Telegram,
  và mục Bảng quản trị kèm chấm đỏ báo số việc đang chờ.
- Chân cột: avatar, tên, nút đăng xuất, dòng bản quyền.

### Thu gọn sidebar

Nút tròn **‹** ở mép phải cột (ngang đường kẻ dưới logo) thu sidebar từ 252px xuống
**dải icon 64px**; bấm lại (giờ là **›**) để mở ra. Lựa chọn được nhớ trong
`localStorage` (`ccl.side`), mở lại trang vẫn giữ nguyên.

Mọi icon xếp trên **một cột thẳng** cách mép trái 24px ở cả hai trạng thái, nên lúc thu/mở
chỉ có chữ mờ đi và khung hẹp lại — icon đứng yên, nội dung bên phải trượt theo cùng nhịp.
Khi thu gọn: rê chuột vào icon có tooltip tên mục; số đếm "Của tôi" thành chấm xanh, badge
Admin thành chấm đỏ ở góc icon; cặp VI/EN thành một nút nhỏ bấm là đổi tiếng; nhãn nhóm
thành một gạch ngắn.

Bề rộng chỉnh ở `:root` trong `src/index.css`: `--side-w` (mở) và `--side-min` (thu gọn).

Màn hình dưới 900px thì cột này biến thành ngăn kéo trượt từ trái, gọi ra bằng
**nút ☰** nằm ngay trên đầu trang, bên trái tiêu đề mục; trong ngăn kéo không có nút thu gọn.

Còn khối **Vote của bạn** thì nằm trong trang Bảng yêu cầu, ngay dưới thanh *Up next* —
không nằm trong sidebar.

### Video trên trang chủ: admin tự thêm

Cả thẻ nổi bật lẫn dải **Latest update** đều do admin quản lý trong **Admin → Videos** (xem mục
*Video nổi bật + dải link video trên trang chủ* ở trên). Bấm **Add / edit links** để
sửa cả dải trong một ô textarea (mỗi dòng `link | tên video`), app tự lấy ảnh bìa HD
từ YouTube. Link kênh
**YouTube @Chaereve** nằm ở khối **Kết nối** trong sidebar.




## Cấu trúc

```
docs/
  DESIGN.md                   TOKEN + LUẬT + LÝ DO của giao diện — đọc trước khi sửa CSS
  RA-SOAT-2026-09-08.md       biên bản soát bảo mật/logic (09/2026)
src/
  App.jsx                     trang chính, bộ lọc, danh sách, điều phối menu
  index.css                   toàn bộ style + bộ easing chuyển động
  lib/db.js                   Supabase + auth + cấu hình giá + media + fallback demo
  lib/meta.js                 map màu cho loại & trạng thái, định dạng tiền/thời gian
  lib/i18n.jsx                TOÀN BỘ câu chữ trên web (một từ điển tiếng Anh)
  lib/avatar.js               thu nhỏ + nén ảnh đại diện ngay trên trình duyệt
  lib/sfx.js                  âm thanh tổng hợp bằng Web Audio, không dùng file
  lib/payment.js              thông tin STK/PayPal + sinh mã QR
  lib/youtube.js              kênh @Chaereve (link sidebar), bóc ID từ link video, dựng thumbnail HD
  lib/useReveal.js            hiện dần khối nội dung khi cuộn tới
  lib/notify.jsx              kho thông báo: toast góc màn hình
  lib/motion.js               đếm số (useCountUp) + vệt sáng bám chuột (useGlow)
  assets/pay/                 logo VietQR, PayPal (SVG chính chủ)
  components/
    Splash.jsx                splash screen
    LoginGate.jsx             đăng nhập Google
    Sidebar.jsx               cột trái cố định (thu gọn được): mọi mục + âm thanh + admin
    MediaShowcase.jsx         khối video trang chủ: sân khấu giữa trang + nút ‹ › qua lại + dải mục lục Latest update
    ActionModal.jsx           modal 3 tab: Gửi request / Vote / Mua vote (tab request có bảng nội quy hiện 1 lần duy nhất rồi nhớ `ccl.reqRules`)
    AdminPanel.jsx            bảng điều khiển admin 5 tab
    MediaAdmin.jsx            tab Videos: featured + dải link (thêm từng cái hoặc sửa cả danh sách một lượt), ẩn/sắp xếp
    ProfileModal.jsx          đổi tên + ảnh đại diện
    AvatarCropper.jsx         khung kéo/zoom để chọn vùng cắt
    SoundToggle.jsx           nút bật/tắt âm thanh (nằm trong menu 3 gạch)
    Toaster.jsx               chồng toast góc phải: đếm giờ, rê vào thì dừng
    Background.jsx            nền gradient tĩnh + aurora trôi chậm (transform only)
    Leaderboard.jsx           bảng xếp hạng: bục 1/2/3 + bảng + hàng của bạn
    PaymentMethods.jsx        lưới chọn phương thức + STK + QR
    Icon.jsx                  bộ icon Lucide: một chỗ khai tên gọi, nét 1.7, cỡ 16px
    Check.jsx                 ô đánh dấu vẽ bằng SVG (cài đặt thông báo, mốc tiến độ admin, ẩn/hiện media, yêu cầu trả phí)
    GoogleIcon.jsx
supabase/schema.sql           chạy 1 lần trong SQL Editor
```

---

Bản Word đầy đủ dành cho người không rành code: **`HUONG-DAN-DAY-DU.docx`**.

## Cảnh báo bảo mật từ Supabase Advisor

Supabase có mục **Advisors → Security** tự quét và báo lỗi cấu hình. Bản schema hiện tại
đã xử lý sẵn các mục thường gặp:

| Cảnh báo | Trạng thái |
|---|---|
| `security_definer_view` | Đã sửa — view `requester_ranking` khai `security_invoker = on` |
| `function_search_path_mutable` | Đã xử lý — cả 12 hàm đều có `set search_path = public` |
| `rls_disabled_in_public` | Đã bật RLS cho cả 4 bảng |
| `auth_users_exposed` | Không có view nào đọc thẳng `auth.users` |

### Vì sao view phải là `security_invoker`

Mặc định, một view trong Postgres chạy bằng **quyền của người tạo ra nó** (thường là chủ
database, quyền cao nhất). Nghĩa là nó **đi vòng qua Row Level Security** của người đang
truy vấn. Với view công khai qua Data API, đây là lỗ hổng thật: ai đó có thể đọc dữ liệu
mà chính sách RLS lẽ ra phải chặn.

Bật `security_invoker = on` thì view chạy theo quyền của **người gọi**, RLS được áp dụng
đúng như khi truy vấn thẳng vào bảng.

Riêng trường hợp này, hai bảng `requests` và `profiles` vốn đã cho đọc công khai
(bảng xếp hạng là công khai theo thiết kế), nên đổi sang invoker **không thay đổi kết quả
hiển thị** — chỉ làm mô hình bảo mật trở nên đúng và tường minh.

### Một chỗ khác đã siết luôn

Trong lúc kiểm tra, phát hiện chính sách `read profiles using (true)` khiến **cột
`vote_credits` đọc được công khai** — tức là ai cũng xem được người khác còn bao nhiêu
vote đã mua. Không nguy hiểm nhưng là thông tin riêng.

Đã siết lại bằng quyền theo cột:

```sql
revoke select on public.profiles from anon, authenticated;
grant  select (id, name, avatar_url, is_admin) on public.profiles to anon, authenticated;
```

Người dùng vẫn xem được số dư của chính mình vì `my_vote_status()` là hàm
`security definer`. Bảng xếp hạng vẫn lấy được ảnh đại diện vì `avatar_url` nằm trong
danh sách cho phép.

## Hộp xác nhận trong app (vòng 14)

### Lỗi đã sửa

Bảy thao tác **không hoàn tác được** hỏi bằng hộp thoại của trình duyệt
(`confirm()` / `prompt()`): xoá request của mình, xoá video, xoá một dòng trong bảng
quản trị, xoá hàng loạt, từ chối một bài, từ chối hàng loạt, huỷ đơn.

Nghe thì vô hại, nhưng cả bảy **hỏng theo cùng một cách, và im lặng**: khi trang chạy
trong một iframe bị chặn hộp thoại (thiếu `allow-modals` — đúng mọi khung xem trước,
mọi trang nhúng), `confirm()` trả về `false` và `prompt()` trả về `null` mà không báo gì.
Trình duyệt cũng tự chặn hộp thoại sau vài lần bấm. Kết quả: bấm **Xoá** và không có gì
xảy ra — nhìn y hệt "bảng quản trị bị hỏng", trong khi mã nguồn không có lỗi nào.

### Cách sửa

Một hộp xác nhận của app: `src/components/ConfirmDialog.jsx` + `src/lib/confirm.jsx`.

```js
const ask = useConfirm()                       // trong component
if (!(await ask({ title: t('row.confirmDelete'), body: t('dlg.cannotUndo'),
                  confirmLabel: t('adm.delete') }))) return
```

- Hỏi xong mới làm — mọi chỗ gọi vẫn giữ nguyên dạng `if (!… ) return` cũ.
- Hộp có **ba phần**: việc sắp xảy ra, hậu quả, hai nút; màu nút theo mức nguy hiểm.
- Huỷ được bằng **Esc**, bằng **bấm ra ngoài**, hoặc nút **Cancel** — và huỷ thì không
  có gì được ghi xuống.
- Việc cần lý do (từ chối bài) có **ô lý do**: Enter là xuống dòng, Ctrl/Cmd + Enter
  mới gửi. Lý do chỉ có khoảng trắng được coi là *không có lý do*.
- `ConfirmProvider` bọc `App` ở `src/App.jsx`, nên mọi nơi trong app dùng được hộp này.

Hai chốt giữ cho lỗi không quay lại:

- `src/lib/noNativeDialogs.test.js` quét toàn bộ `src/` (bỏ chú thích) và đỏ nếu có ai
  gọi lại `confirm()`/`prompt()`/`alert()` — kèm kiểm hộp của app còn đủ `role="dialog"`,
  Esc, bấm-ra-ngoài và `aria-describedby` trỏ tới id có thật.
- `tools/smoke.mjs` bấm thật qua từng đường ghi: **gửi** một request rồi **xoá** nó ở mục
  About me (bấm Cancel trước, rồi mới Delete), **xoá một dòng** trong bảng quản trị,
  **từ chối một bài** kèm lý do, **mở hộp từ chối hàng loạt** rồi huỷ (kiểm lời hỏi có
  đúng số dòng và có ô lý do, mà không tiêu mất dòng cuối), **xoá hàng loạt**, **xoá
  video** ở mục Kênh. Esc cũng được kiểm: huỷ là không được ghi gì.

Còn **huỷ đơn** (`doCancelOrder`) chưa có đường bấm tự động: dữ liệu mẫu của chế độ demo
không có đơn nào của người đang đăng nhập, mà tạo một đơn thật thì phải đi qua luồng mua
vote. Chỗ đó được giữ bởi chốt thứ nhất (không còn `confirm()`) và bởi chính dạng gọi
`await ask(…)` giống sáu chỗ đã kiểm.

### Bài trả phí trong form request — ba lỗi im lặng (vòng 14, tiếp)

Ô **"Paid request ($0.75 / 20,000₫)"** nằm ở bước 3 của form, cạnh một dòng giải thích. Nó
từng có ba vấn đề, cả ba đều không hiện ra dưới dạng lỗi:

| Chuyện gì | Vì sao người dùng thấy "ô chọn trả phí bị bỏ qua" |
|---|---|
| Sau khi gửi **một** request trả phí, ô tick **vẫn bật** cho các request sau | Người dùng đi qua bước 3 mà không được hỏi lại — câu trả lời cho một câu hỏi về **tiền** đã có sẵn từ lần trước, và nút gửi vẫn là nút vàng. Không có gì đỏ, chỉ có thêm một đơn hàng nữa được tạo |
| Đổi tab trong cùng hộp (Request ↔ Vote ↔ Buy) làm **mất sạch form**: chữ, bước đang đứng, và ô tick vừa chọn | `RequestTab` bị tháo khỏi cây, bộ đếm 400ms ghi nháp bị huỷ theo → chữ vừa gõ không bao giờ được lưu. Xem bảng giá rồi quay lại là phải gõ lại từ đầu |
| Nút **Clear** xoá chữ nhưng **không** xoá ô tick | Ở bước 1 người dùng không nhìn thấy ô đó, nên một lựa chọn về tiền còn sót lại là thứ duy nhất trong form vừa vô hình vừa có giá |

Đã sửa trong `src/components/ActionModal.jsx`:

- gửi xong (và bấm Clear) thì `paid` về `false` — lựa chọn trả phí thuộc về request **vừa
  gửi**, không thuộc về cái form;
- nháp ghi ở **hai** thời điểm: sau 400ms ngừng gõ, và **ngay khi form rời màn** (hàm ghi
  dùng chung `writeDraft()`, giá trị mới nhất giữ trong một `ref` vì hàm dọn chỉ chạy một lần);
- nháp mang thêm `step`, nên mở lại là đứng đúng bước đang làm dở — ô trả phí hiện ra ở
  đúng chỗ thay vì nằm sẵn trong bóng tối.

Ba nhóm kiểm mới trong `npm run smoke` (mục **10c**), và cả ba đã được thử bằng cách **gỡ
bản sửa ra**: gỡ phần nháp/bước thì 3 mục đỏ, gỡ `setPaid(false)` thì 2 mục đỏ — tức là
chúng bắt được lỗi thật, không phải kiểm cho có:

- bấm vào **chữ** "Paid request" (đích ngón tay thật, không phải ô 16px) thì ô tick phải ăn,
  và nút gửi phải đổi thành nút vàng có giá;
- đổi tab Vote rồi quay lại: vẫn ở bước 3, ô tick còn, và có dòng nói form được khôi phục;
- gửi một request trả phí thật: dữ liệu có `is_paid: true` + một đơn `awaiting` trỏ đúng
  request, và request **kế tiếp** phải có ô tick **tắt**, nút gửi là "Send request" thường.

Cùng lúc, `tools/smoke.mjs` sửa một lỗi của chính nó: mục rà DOM đóng hộp vote bằng
`q('.vm-close, .modal .icon-btn')` — hai lớp đó **không tồn tại** (nút đóng là `.x`), nên hộp
vote ở lại mở suốt các mục sau và mục 10c lần đầu chạy trong **sai hộp**. Nay đóng bằng `Esc`
và có mục chốt "không còn lớp phủ nào treo lại".

### Vì sao vẫn "bị bỏ qua" sau khi sửa ba lỗi trên — bấm Enter là gửi (vòng 14, tiếp)

Ba lỗi trên là thật, nhưng chúng **không phải** đường mà chủ dự án gặp. Đường thật nằm ở
chỗ khác, và nó nằm ngoài tầm nhìn của cả bộ kiểm tự động:

**Trong trình duyệt, bấm Enter trong một ô nhập của form là GỬI form.** Trên điện thoại thì
phím Enter chính là nút **"Go / Đi"** của bàn phím — bấm nó là gửi. Cả hai đều rơi vào
`onSubmit` của `<form>` ở `ActionModal.jsx`:

- màn hình không có gì đỏ, không có cảnh báo — chỉ có **một request thường được tạo**;
- người dùng **chưa từng đi qua bước 3**, nên chưa từng thấy ô "bài trả phí": đúng nghĩa
  "bước chọn paid request bị bỏ qua".

Vì sao máy kiểm không thấy: **jsdom không mô phỏng việc gửi ngầm** — nó chỉ phát sự kiện
`submit` khi người ta bấm **nút** gửi. Đứng ở bước 2 mà bấm Enter thì jsdom im lặng không làm
gì, và bộ kiểm thật thà ghi nhận "không có gì xảy ra". Đây là loại lỗi mà chỉ trình duyệt
thật mới lộ ra, nên cách kiểm phải là **tự phát đúng sự kiện mà trình duyệt sẽ phát**.

Đã sửa trong `src/components/ActionModal.jsx`, bằng hai lớp:

| Lớp | Việc nó làm |
|---|---|
| Chốt trong `submit()` | Gặp `submit` khi **chưa tới bước 3** thì đi tiếp một bước, **không gửi**. Đặt ở đây — chứ không chỉ ở từng ô nhập — vì thêm một ô mới vào form là lại có thêm một đường gửi ngầm |
| `onKeyDown` ở `<form>` | Enter trong ô nhập ở bước 1–2 = "xong bước này": chặn trình duyệt gửi ngầm và đi tiếp. Ô ghi chú là `<textarea>` nên Enter ở đó vẫn xuống dòng; ở bước 3 thì Enter giữ nguyên nghĩa **gửi** |

Kèm theo một thay đổi về **thứ tự**: trong bước 3, ô "bài trả phí" nay đứng **trước** ô ghi
chú. Đây là màn **quyết định** — trả thêm tiền hay không là chuyện lớn nhất ở đây, còn ghi
chú là thứ tuỳ chọn; để ô trả phí xuống dưới thì lựa chọn đắt nhất lại nằm xa mắt nhất.

Bằng chứng (cả hai chiều):

- **Chiều lỗi** — phát đúng sự kiện `submit` mà trình duyệt phát khi người dùng bấm Enter ở
  bước 2, trên bản **chưa sửa**: `bước=1 | số request: 6 → 7 | msg="Request sent…" | đã thấy ô
  trả phí chưa: false` và request được ghi là `{"artist":"XG","title":"Left Right","is_paid":false}`.
- **Chiều đã sửa** — bốn tình huống: bước 2 + gửi ngầm → **không** tạo request, đứng ở bước 3,
  ô trả phí hiện ra; Enter trong ô Link → sang bước 3, không gửi; Enter trong ô Nghệ sĩ → nhảy
  sang ô Tên bài như cũ; bước 3 + gửi → tạo **đúng một** request trả phí.
- **Gỡ chốt ra** → `npm run smoke` tụt còn **218/225** với 7 mục đỏ, trong đó có
  "...đưa người dùng tới bước 3 — nơi có ô chọn bài trả phí" (`bước=2 paidbox=false`).

Bốn mục kiểm mới nằm ngay đầu mục **10c** của `npm run smoke` (235 mục, trước vòng này: 225),
gồm cả một mục so **thứ tự tài liệu** giữa `.paidbox` và `.note-field`, để quyết định thứ tự
trên không bị đảo lại trong im lặng.

### Header an toàn

`public/_headers` có thêm khối bắt-all `/*` với `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy` và `Strict-Transport-Security`; `worker/index.js`
tự gắn `nosniff` cho mọi response JSON (response do Function sinh không chắc được
`_headers` phủ). `worker/pagesRoutes.test.js` chốt: bốn header đó chỉ được khai ở **một**
khối — Cloudflare nối giá trị khi cùng header khớp hai rule.

**Chưa** đặt `Content-Security-Policy`: CSP sai một nguồn là trang trắng, mà những nguồn
thật (Supabase, `i.ytimg.com`, `lh3.googleusercontent.com`, Turnstile) chỉ kiểm chứng
được trên bản deploy thật. Việc còn lại: mở DevTools trên bản deploy, ghi lại danh sách
nguồn thật, rồi mới dựng CSP.

## Danh sách kiểm tra trước khi deploy

Đã soát ngày 02/09/2026, kết quả:

| Hạng mục | Kết quả |
|---|---|
| Cài lại sạch (`npm ci`) + build | ✅ không lỗi |
| Lỗi lint | ✅ 0 lỗi (7 cảnh báo về pattern React, không ảnh hưởng) |
| `npm audit` (thư viện chạy thật) | ✅ 0 lỗ hổng |
| Kiểm thử đầu-cuối 35 hạng mục | ✅ 35/35 đạt |
| Lỗi console / request hỏng | ✅ 0 |
| Giao diện ở 9 độ rộng (360→1440px) | ✅ không chỗ nào tràn |
| Giấy phép thư viện | ✅ toàn bộ MIT / ISC / 0BSD |
| Giấy phép font | ✅ toàn bộ OFL 1.1 |
| Đối chiếu app ↔ database | ✅ khớp: RPC, giá, loại video, cột mốc, giới hạn |
| Rác trong repo | ✅ không có `console.log`, không lộ `.env` |

### Việc BẮT BUỘC làm khi deploy

1. **Chạy lại toàn bộ `supabase/schema.sql`** trong SQL Editor. **Sau bản cập nhật vòng 14
   (19/09/2026) thì đây không còn là việc "nên làm":** bản vá cuối cùng trong đó là
   `migrations/20261104_spin_streak.sql` (vòng quay không lặp quá 2 lượt liên tiếp). Bản hiện tại có nhiều thứ
   mới so với lần chạy đầu: bỏ giới hạn 1 vote/người, `cast_vote` nhận số lượng bất kỳ,
   loại video `Short`, 3 cột mốc tiến độ, `update_my_profile`, `cancel_my_order`,
   Paid Request không bị chặn bởi giới hạn 3 request/giờ, và **bảng `public.media` +
   3 hàm `admin_media_*`** cho mục Kênh. File dùng `create/alter/create or replace`,
   **không có DROP/TRUNCATE bảng**, nên chạy lại nhiều lần không mất dữ liệu. Nếu chỉ
   thiếu `media`, có thể chạy `supabase/migrations/20260903_safe_recovery.sql`.
   Không dùng lại hướng dẫn cũ yêu cầu bỏ comment để xoá bảng.
2. **Giữ nguyên file `public/_redirects`** — Cloudflare Pages tự
   nhận file này, không cần bật gì thêm. Với Vercel, file `vercel.json` đã khai báo
   rewrite SPA tương đương. Ảnh bìa lấy thẳng từ `i.ytimg.com` nên không cần proxy.
3. **Đặt 2 biến môi trường** trên Cloudflare Pages: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` — nhớ đặt cho cả Production lẫn Preview. (Lá chắn Edge cần
   thêm KV/secret/biến gate nữa, nhưng thêm ĐÚNG THỨ TỰ trong mục *Lá chắn Edge* — gắn
   biến gate khi health chưa xanh là hỏng nút Spin/Vote.)
4. **Thêm domain mới vào Supabase** → Authentication → URL Configuration
   (cả *Site URL* lẫn *Redirect URLs*).
5. **Kiểm tra Google Auth Platform → Audience** đã ở trạng thái *Published*, không phải *Testing*.
6. **Bật sao lưu database** — làm theo mục *Sao lưu database* ở dưới, mất khoảng 5 phút:
   thêm secret `SUPABASE_DB_URL` rồi bấm **Run workflow** một lần cho chắc. Gói free của
   Supabase không có backup tự động, nên đây là việc rẻ nhất và cũng là việc duy nhất mà bỏ
   qua có thể mất dữ liệu thật.
7. **Tự cấp quyền admin** sau khi đăng nhập Google lần đầu:
   ```sql
   update public.profiles set is_admin = true
    where id = (select id from auth.users where email = 'email-cua-ban@gmail.com');
   ```

Bỏ qua bước 4 hoặc 5 thì đăng nhập Google sẽ hỏng — đây là hai lỗi hay gặp nhất.
Riêng lỗi *Testing mode* rất khó đoán: bạn đăng nhập được nhưng người khác thì không.

### Kiểm thử của bản cập nhật sidebar + video từ kênh (03/09/2026)

| Hạng mục | Kết quả |
|---|---|
| `npm run build` (Vite) | ✅ build sạch |
| `npx oxlint` | ✅ 0 lỗi, 8 cảnh báo (7 cảnh báo cũ + 1 cảnh báo cùng loại cho effect nạp kênh) |
| Kiểm thử trong jsdom — dựng app thật, bấm thật | ✅ 31/31 đạt |

Phần jsdom chạy app thật ở chế độ demo, **giả luôn phản hồi của YouTube**, rồi kiểm tra:

- `parseFeedXml` đọc đúng ID/tiêu đề/ngày/lượt xem/ảnh bìa của feed Atom, đọc được cả
  RSS 2.0 cũ, và trả về danh sách rỗng (không quăng lỗi) khi feed hỏng hay rỗng.
- `extractChannelId` bóc được `UC…` từ cả ba dạng: `"channelId":"…"`,
  `<meta itemprop="identifier">`, và link `channel_id=…`.
- App gọi `/yt/@Chaereve` → `/yt/feeds/videos.xml?channel_id=UC…`, hiện đúng video của
  feed (không phải dữ liệu admin), Pick là video mới nhất, danh sách video mới giới hạn
  4 mục ở trang chủ và 12 mục ở mục Kênh, ảnh bìa lấy từ `i.ytimg.com`.
- Bấm video nổi bật mở khung phát với đúng `youtube-nocookie.com/embed/<id>`.
- Sidebar có đủ bốn mục, link `@Chaereve` mở tab mới, khối vote, nút âm thanh, mục Admin (mở đúng bảng Admin, tab Kênh vẫn sửa được video thủ công), nút đăng
  xuất; thanh trên cũ đã biến mất khỏi DOM; nút ☰ nằm trong header nội dung (đứng trước
  tiêu đề mục) và có nhãn cho trình đọc màn hình; khối *Vote của bạn* nằm trong cột nội
  dung, đúng sau thanh *Up next* và trước bộ lọc request, đồng thời không còn trong
  sidebar; CSS khai báo `.pvlist` là hàng ngang trượt được với thẻ rộng 186px; và
  **mọi khối `data-reveal` đều nhận class `.in`** — bài này nạp cả file CSS đã build
  vào jsdom rồi đọc `getComputedStyle`, nên bắt được lỗi khối video kẹt ở `opacity: 0`
  (trang trông "trống trơn" dù HTML vẫn có đủ).

### Lỗi đã sửa: khối nội dung dựng sau splash thì không bao giờ hiện

`lib/useReveal.js` cũ chỉ quét `[data-reveal]` **một lần theo deps**. Effect đó chạy
ngay khi app mount — tức lúc splash còn đang che — nên danh sách quét ra rỗng và
`return` sớm. Splash tắt, nội dung dựng lên, nhưng các deps (`section`, `visible.length`,
`media.length`, `vids.length`…) đều đã ổn định từ trước nên effect không chạy lại:
không phần tử nào được thêm `.in`, mà CSS thì mặc định `[data-reveal] { opacity: 0 }`.
Kết quả là khối video, dải số liệu, thanh *Up next* và khối vote đều vô hình.

Giờ hook quét lại bằng `MutationObserver`: có khối `data-reveal` mới xuất hiện là được
đăng ký với `IntersectionObserver` ngay, không phụ thuộc deps nữa.
- **Kênh không đọc được**: app lùi về video admin nhập tay, Pick là mục admin ghim,
  admin thấy thông báo lỗi + nút *Thử lại*; lúc mạng thông, bấm *Thử lại* là video của
  kênh hiện ra. Không còn cảnh báo React *key trùng* khi hai mục admin trỏ cùng một video.

### Kiểm thử của bản sửa vote cộng dồn + khung Sửa trên điện thoại (07/09/2026)

| Hạng mục | Kết quả |
|---|---|
| `npm test` (`node:test`, 12 ca cho `src/lib/board.js`) | ✅ 12/12 đạt |
| `npm run build` (Vite) | ✅ build sạch |
| `npx oxlint` | ✅ 0 lỗi, 13 cảnh báo — đúng bằng số cảnh báo trước khi sửa |
| Dựng app thật trong jsdom (chế độ demo), bấm thật | ✅ 21/21 đạt |

Bài jsdom nạp dữ liệu mẫu có **một bài bị ba người gửi lẻ** (FARMING 3 + 3 + 3 = 9 vote) bên
cạnh Ditto 5 vote và HEYA 4 vote, rồi đọc thẳng thứ tự DOM của bảng:

| Tab *Top voted* | Trước khi sửa | Sau khi sửa |
|---|---|---|
| hạng 1 | Blue Flame — 20 vote | Blue Flame — 20 vote |
| hạng 2 | Ditto — 5 vote | **FARMING — 3 request = 9 vote** |
| hạng 3 | HEYA — 4 vote | Ditto — 5 vote |
| hạng 4 | **FARMING — 3 request = 9 vote** | HEYA — 4 vote |

### Lỗi đã sửa: cụm trùng bài cộng dồn vote để trưng bày, còn hạng thì không

`App.jsx` cũ **sắp xếp từng dòng trước** (`byTop = b.votes - a.votes`) **rồi mới gom cụm**, và
cụm *giữ vị trí của dòng đầu tiên*. Tổng vote vẫn được cộng và vẫn hiện ở cột số bên phải thẻ,
nhưng con số đó không tham gia vào bất kỳ phép so sánh nào — nên bài 9 vote bị xé làm ba
request (3 + 3 + 3) đứng hạng 4, dưới cả bài 4 vote một request. Đúng như phản ánh: *"cao vote
thứ 2 nhưng có lúc request đó lại đứng hạng 3"*.

Nay thứ tự quyết định theo hai tầng, tách hẳn ra `src/lib/board.js` cho dễ kiểm thử:
`sortRows()` xếp các dòng **trong** một cụm (dòng mạnh nhất đứng đầu, cũng là dòng lấy tên hiển
thị), còn `sortGroups()` xếp **các cụm** với nhau bằng `votes` đã cộng dồn (kèm `paid` và
`newest` làm tiêu chí phụ). Tab *Up next* là ngoại lệ duy nhất: giữ nguyên thứ tự làm việc,
không xáo theo vote. Luật cộng dồn cũng được đưa vào tab *Đang xử lý* của bảng Admin (kèm nhãn
tím cho biết bài đó có mấy request, tổng bao nhiêu vote) và vào hàm `pick_top_request()` của
cron — ba chỗ này trước đây đều so vote từng dòng.

### Lỗi đã sửa: khung Sửa của Admin trên điện thoại bấm không được

Khung sửa (2 ô **nghệ sĩ / tên bài** + nút *Lưu tên*, ô **link video** + nút *Lưu và hoàn thành*,
3 mốc tiến độ) trước đây nằm **bên trong `.nm`**, và `.inline-form` là `display: flex` **không
cho xuống dòng**. Ô nhập kế thừa `input { width: 100% }` mà flex item thì mặc định
`min-width: auto` — tức không co xuống dưới cỡ nội tại (~170px/ô). Hai ô một hàng cộng nút Lưu
là ~425px, trong khi lòng khung modal trên điện thoại 390px chỉ còn ~300px: cả dải nhập **tràn
ra ngoài**, nút *Lưu tên* bị đẩy vượt mép phải màn hình, phần tràn đè lên cụm nút
*Pick / Sửa / ×* khiến chạm vào đó thì trúng ô nhập thay vì trúng nút.

Sửa ba lớp:

1. `.inline-form` cho `flex-wrap: wrap`, ô nhập `flex: 1 1 130px; min-width: 0` (co được, hết
   chỗ thì nút tự xuống dòng) — lớp này chặn tràn ở **mọi** bề rộng, không chỉ điện thoại.
2. Dời khung sửa ra khỏi `.nm`, thành khối `.adm-edit` anh em với `.nm` / `.adm-acts` và chiếm
   trọn một dòng (`flex: 1 1 100%`) — cụm nút không bao giờ bị form chèn nữa.
3. Màn ≤620px: `.nm` và `.adm-acts` mỗi khối một dòng, nút dàn đều cao **38–40px**, ô nhập tràn
   dòng và để **16px** (dưới 16px thì iOS phóng to cả trang khi chạm vào), checkbox mốc tiến độ
   17px. Các hàng vote / đơn hàng trong modal khác giữ nguyên bố cục cũ.

### Lỗi đã sửa: mở "New request" ra màn hình đen vì thiếu một prop (08/09/2026)

`ActionModal.jsx` truyền `live={live}` xuống `RequestTab` nhưng **không khai báo `live`
trong danh sách prop** của `ActionModal` — `App.jsx` có truyền (`live={hasSupabase}`), chỉ
mỗi cái destructuring là quên. Kết quả: đúng cái dòng JSX đó đọc biến tự do `live` →
`ReferenceError: live is not defined` ngay lần render đầu tiên → React gỡ bỏ cả cây →
người dùng thấy **màn hình đen**, không phải modal.

Vì sao lưới kiểm tra cũ không bắt được:
- `npm run build` chỉ đóng gói, biến tự do chưa phải là lỗi biên tập;
- `oxlint` mặc định không bật `no-undef`;
- `npm test` chưa từng dựng `ActionModal`.

Đã làm:
- thêm `live` vào prop của `ActionModal` (`src/components/ActionModal.jsx`);
- `src/components/ActionModal.test.js` — 4 ca dựng modal bằng Vite SSR loader: mọi tab
  (`request` / `vote` / `buy`) phải render ra khung, chữ báo tin phải khác nhau giữa
  demo và bản thật, và lần đầu mở thì phải thấy bảng luật chứ không phải màn đen.
  Test giả lập `localStorage` để qua `RulesGate` (không có nó thì form không bao giờ
  được dựng trong node);
- bật `"no-undef": "error"` + `env: {browser, es2022}` trong `.oxlintrc.json`, kèm
  `overrides` cấp env `node` cho `supabase/tests/**`, `functions/**`, `vite.config.js`.
  Chạy thử: bỏ `live` ra lại là oxlint báo ngay `'live' is not defined` ở đúng dòng đó.

**Bài học:** component nhận prop qua destructuring — mọi thứ truyền từ `App.jsx` mà không
nằm trong ngoặc đơn của hàm là bom hẹn giờ, và nó chỉ nổ lúc chạy. Mở rộng `npm run lint`
bằng `no-undef` rẻ hơn nhiều so với việc dựng thêm test cho từng modal.

### Cách xem thử khi làm việc trong sandbox (proxy chỉ ăn bản build tĩnh)

Proxy của môi trường này ghép URL theo cổng: `https://<cổng>-<sandboxId>.e2b.app`
(sandboxId đọc bằng `echo $E2B_SANDBOX_ID`). **Vite dev (`npm run dev`) không lên được
qua proxy** — bản dev chèn thêm tiền tố `/@react-refresh` và module `/@vite/client`, cái
sau cần một kết nối WebSocket mà proxy không chuyển; trình duyệt vì thế treo trước khi
kịp render app. Bản dev vẫn dùng tốt trên máy của bạn.

Trong sandbox thì phục vụ `dist/` bằng Vite preview, kết hợp watcher dựng lại:

```bash
npx vite preview --host 0.0.0.0 --port 5173 --strictPort   # mở link 5173-<id>.e2b.app
npx vite build --watch                                     # sửa file là dist cập nhật (~0.5s)
```

`vite preview` đọc `dist/` từ đĩa theo từng request, nên không cần khởi động lại gì cả —
chỉ F5. Kiểm nhanh từ trong sandbox (không cần browser):

```bash
curl -s -H "Host: 5173-$E2B_SANDBOX_ID.e2b.app" -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
```

Nếu link báo "không truy cập được" mà curl ở trên vẫn 200: nhiều khả năng sandbox vừa bị
restore và `sandboxId` đã đổi — link preview cũ chết theo, mở link từ bảng Arena là xong.

### Dựng thật cả app để soi lỗi — `npm run smoke`

```bash
npm run smoke        # ~19 giây, in ra từng mục đạt/không đạt
```

`npm test` toàn là bài kiểm **tĩnh** hoặc dựng **từng component rời**. Một nhóm lỗi khác chỉ
lộ ra khi **cả app** chạy thật: một effect chạy sai thứ tự, một state bị đọc trước khi có, một
`null` chỉ xuất hiện SAU khi đã đăng nhập, một thứ chỉ nằm sau điều kiện quyền admin.

`tools/smoke.mjs` dựng **cả cây React thật** trong jsdom, đúng hai provider như `src/main.jsx`
(`I18nProvider` → `NotifyProvider`), đăng nhập tài khoản demo, rồi **bấm thử như người dùng**:
màn chờ → trang chủ → bộ lọc → ô tìm → tab Up next → **form request** (thẻ xem trước, ảnh bìa
YouTube, dán link vào ô tên bài, bản nháp, nút bỏ nháp) → **hộp vote** (ba ô số dư cộng đúng
bằng tổng phiếu, phím mũi lên, bấm mức nhanh, gửi thật rồi kiểm con số trên hàng tăng đúng,
hộp tự đóng) → Daily Spin → Bảng xếp hạng → Của tôi → **cả năm mục của `/admin`** (kể cả mở
sẵn một địa chỉ đã lọc) → chế độ chọn nhiều.

Nó ghi lại **mọi thứ rơi ra console** kèm màn hình đang đứng, và rà **nhãn** ở từng màn: chỗ
nào có từ hai nhãn cạnh nhau mà không nằm trong một cụm biết xuống dòng thì báo. Kết quả hiện
tại: **50/50 mục đạt, 0 lỗi runtime**. Cờ môi trường có sẵn:

- `SMOKE_DUMP=1` — in thêm HTML của danh sách request để soi bằng mắt khi một mục không đạt.
- Khi thêm một màn hình mới, thêm một `check(...)` vào `tools/smoke.mjs`: công cụ này là chỗ
  duy nhất trong repo chạm tới **đường đi thật** của người dùng.

### Nên kiểm tra bằng tay sau khi deploy

Ba việc dưới đây **không máy nào kiểm được** (jsdom không mô phỏng việc gửi ngầm của
trình duyệt, và sandbox không có bàn phím điện thoại thật) nên phải bấm bằng tay:

- Trong **form request**, điền tên bài ở bước 2 rồi bấm **Enter** trong ô **Link** (trên
  điện thoại là nút **"Go/Đi"** của bàn phím) → phải sang **bước 3** với ô *"bài trả phí"*,
  và **không** được có request nào được gửi. Đây chính là đường đã làm bước chọn trả phí bị
  bỏ qua ở vòng 14; nếu vẫn thấy thông báo "Request sent" thì lỗi còn nguyên.
- Gửi một request **trả phí** thật, rồi mở form request **kế tiếp**: ô *"bài trả phí"* phải
  **tắt**, và nút gửi phải là **"Send request"** thường (không phải nút vàng).
- Đổi tab trong hộp request rồi quay lại (New request → Vote → New request): chữ vừa gõ,
  bước đang đứng và ô tick phải còn, kèm dòng nói form được khôi phục.
- Nếu vừa chạy `20261104_spin_streak.sql`: quay thử **3 lượt liền trên cùng một thiết bị** —
  không được có ba số thưởng giống nhau liên tiếp.
- Đăng nhập Google thật (bản demo trong sandbox dùng tài khoản giả).
- Mở trang đã deploy, xem khối **Chaereve's Pick** có hiện video thật của kênh không —
  trong sandbox thì không, vì sandbox không có đường ra YouTube.
- Quét thử mã QR ngân hàng bằng app ngân hàng, xem có tự điền số tiền và nội dung không.
- Gửi một request thật rồi tự duyệt, để chắc chắn quyền admin đã có.
- Mở bảng Admin **trên điện thoại thật** → tab *Đang xử lý* → bấm *Sửa*: hai ô tên bài/nghệ sĩ
  phải nằm gọn trong khung, nút *Lưu tên* / *Lưu và hoàn thành* / 3 mốc tiến độ đều bấm được bằng
  ngón tay, và chạm vào ô nhập không làm phóng to trang.
- Gửi hai request **cùng tên bài + nghệ sĩ** (viết hoa/thường khác nhau cũng được), vote rải vào
  cả hai, rồi xem tab *Top voted*: thẻ cụm phải đứng đúng hạng theo **tổng** vote.
- Nếu có bật cron tự chốt: chạy `select public.pick_top_request(true);` trong SQL Editor sau khi
  đã chạy `migrations/20260907_group_top_pick.sql`, xem hàm có chốt đúng bài đang dẫn đầu bảng
  *Top voted* không.

### Tính năng "Theo dõi + Thông báo" (08/09/2026 — prototype UI, chưa có database)

### Soát toàn bộ giao diện + bug (08/09/2026, vòng sau PR)

Người dùng: "check lại toàn bộ giao diện và bug". Quét tĩnh bằng script trên **toàn bộ**
24 component + 2 file CSS + từ điển + `supabase/*.sql`, rồi soi từng chỗ nghi ngờ. Sáu lỗi
thật, tất cả đều sửa tận gốc (không vá từng nơi) và mỗi họ đều có chốt chặn:

| Lỗi | Ai nhìn thấy | Gốc | Cách sửa |
|---|---|---|---|
| `font-family: var(--body)` ở 3 quy tắc, trong khi app chỉ có `--font`/`--mono`/`--display` | tên ca sĩ trong hộp thông báo **đang dùng sai font**; `.nt-meta em` thành font chữ đều; `.standing` chỉ tình cờ đúng | `var()` không fallback + token vô danh ⇒ CSS **không báo lỗi**, thuộc tính âm thầm rơi về giá trị kế thừa | đổi cả 3 sang `var(--font)`; thêm `src/lib/cssTokens.test.js` quét `var(--x)` vô chủ theo cả hai chiều (token JS gán mà CSS không đọc cũng bị gọi tên — đó là cách `--pc` trong `PaymentMethods` bị xoá) |
| Rule global `input, select, textarea` áp lên **checkbox và range** | ô tick "đây là yêu cầu trả phí" (ActionModal), "ẩn khỏi trang chủ" (MediaAdmin) và **3 mốc tiến độ** (AdminPanel) hiện thành **hộp xám to hơn chữ bên cạnh** | rule cấp phần tử không phân biệt loại control (chính là quy tắc 4, nhưng lần này rule global mới là bên sai) | `input:where(:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [hidden]))` — bọc `:where()` để **đặc tính không đổi** (0,0,1) nên `.nt-pref input`, `.qty input` còn đè được; chốt ở `src/lib/cssInputBox.test.js` |
| Vòng focus bàn phím giữ bằng **danh sách tên** | 32 class gắn trên `<button>` không có vòng: sao chép, ô số lượng, nút trang, đóng toast, chuông cuối dòng, ‹ › dải video… bấm Tab là mù | mỗi nút mới viết thêm là một lỗ thủng, không ai nhắc | thay bằng **quy tắc thẻ** `button:focus-visible, a:focus-visible, [tabindex]:not([tabindex="-1"]):focus-visible`; bỏ 2 rule trùng (`.pick-nav`, nhóm `.lb-segb/.to-top/.toast-act/.search`); chỉ 2 ngoại lệ hình hài còn khai riêng **kèm lý do** (`cssNotifyPitch.test.js` đổi sang chốt điều này) |
| `<div>` nằm trong `<button>` (avatar dự phòng ở chân sidebar) | không thấy gì, nhưng DOM sai chuẩn và cây accessibility lẫn lộn | content model của `<button>` chỉ nhận phrasing content | `<span>` + `.avatar { display:grid }` (giống hệt); `<button>` trong `<form>` phải ghi `type` rành mạch — nút "Gửi yêu cầu" giờ là `type="submit"` thay vì dựa vào mặc định |
| `.side-scroll` thiếu `min-height: 0` | cửa sổ thấp (laptop 768px, hoặc trình duyệt thu dọc): danh sách sidebar **không cuộn được**, khối chân (avatar + đăng xuất) bị đẩy ra dưới mép | cùng họ với lỗi "mất tin" của `.nt-list` — quy tắc 5 nhưng chỉ áp cho một khối | thêm `min-height: 0`; `src/lib/cssScroll.test.js` quét MỌI rule `overflow-y:auto` + `flex:1` chứ không giữ danh sách tên |
| Nút × của toast 22px | trên điện thoại đó là cách **duy nhất** để đóng một mẩu tin | cỡ chọn theo mắt nhìn desktop | 30px ở bản hẹp, `margin: -4px -4px 0 0` để nằm gọn trong padding của `.toast` (khối này `overflow: hidden`, kéo ra ngoài padding là bị cắt); `src/lib/cssTapTarget.test.js` giữ cả cặp desktop/cảm ứng |

Đã loại (tìm mà không phải lỗi, ghi lại để không ai soi lại): 32 class "không có trong CSS"
toàn là biến `${}` bị regex ăn nhầm; `err.banned` chỉ nằm trong **comment** của
`supabase/audit/fraud-detection.sql` (khi nào bật thì `i18nKeys.test.js` sẽ đòi key — đó là
lý do chốt chặn đó quét mã `err.*` trong SQL); `id="home-media"` xuất hiện 2 lần nhưng ở hai
nhánh **loại trừ nhau** nên không trùng trong DOM; các handler phím `/` và `n` đã có guard
"đang gõ chữ thì bỏ qua" ✓; 4 ảnh `<img>` không ghi `width/height` nhưng nằm trong khung
`aspect-ratio` cố định nên không giật layout; timer của toast/`copy` là one-shot có chủ ý.
Full-app SSR vẫn **không** phải đường kiểm tra (chỉ render được Splash) nên mọi thứ ở trên
chốt bằng đọc CSS/JSX + `node:test`.

Ba chốt chặn mới cho họ lỗi chữ: `src/lib/i18nKeys.test.js` (key trùng, `t('x')` không có
trong từ điển ⇒ in nguyên `err.foo` ra màn hình vì `t` là `S[key] ?? key`; chỗ trống `{x}`
không được truyền; họ key ghép động `nt.tag.*`/`status.*` còn nguyên), và bộ parse JSX
tự viết trong `src/lib/jsxHtml.test.js` — **không** dùng regex trên attribute, vì `[^>]*`
cắt nhầm ngay dấu `>` trong `onClick={() => …}` (cái bẫy đã làm hỏng vài lần kiểm tra trước).

| Hạng mục | Kết quả |
|---|---|
| `npm test` (`node --test src/ supabase/tests/ worker/`, 195 ca: `watch` 29 · `Notifications` 12 + 11 ca dữ liệu xấu · `toastStack` · `cssGridRows` 6 · `cssNotifyPitch` 4 · `cssInputBox` 4 · `cssScroll` 3 · `cssTokens` 4 · `cssTapTarget` 5 · `seoContract` 5 · `jsxHtml` 5 · `cssSelectArrow` 2 · `propContract` 4 · `pagesRoutes` 14 (gồm 3 ca `_headers`/no-store) · `board`/`dailySpin`/`voteHardening`/`spinDevice` …) | ✅ 194 đạt, 0 lỗi, 1 skip (`supabase/tests/dailySpin.test.js` — cần DB thật) |
| `npx oxlint .` | ✅ 0 lỗi, 14 cảnh báo — đúng bằng nền trước khi sửa |
| `npm run build` | ✅ sạch, bundle chính 330 kB (đã bỏ hộp thoại "This song") |
| Check bố cục | ✅ bằng văn bản: `cssGridRows` + `cssNotifyPitch` (nhịp 12px/14px, lưới `.grow`, không hộp thoại trong hộp thư, nút phải có `:focus-visible`) |

Ba thứ nên bấm bằng mắt sau khi deploy (sandbox không có trình duyệt để nhìn hộ):

- Bấm chuông → bảng mở tại chỗ; đầu nhóm **Needs your votes** có nut **VOTE NOW** và KHÔNG còn
  dòng "Next pick in every 4 days"; hàng lẻ và hàng trong cụm phải cùng một cột nút.
- Bấm một dòng tin: bảng đóng, nhảy xuống đúng hàng của bài (kể cả khi nó ở trang khác của bảng),
  hàng sáng lên ~2,6 giây, và **không** có hộp thoại nào bật lên.
- Một cú tick 3 mốc tiến độ cho cả cụm: chỉ MỘT toast (có huy hiệu `×n`), không phải ba ô che màn hình.

### Soát giao diện + chuyển động + bố cục (19/09/2026)

Đợt này đọc và áp ba nguồn: `leonxlnx/taste-skill` (kỷ luật chống "giao diện do máy
sinh"), `kylezantos/design-motion-principles` (chuyển động, theo Emil Kowalski ·
Jakub Krehel · Jhey Tompkins), và `VoltAgent/awesome-claude-design` (cách viết một
`DESIGN.md` giữ token + luật + lý do trong cùng một file). Kết quả gọn lại thành
**`docs/DESIGN.md`** — đọc file đó trước khi sửa giao diện; nó trả lời *vì sao*, còn
`HUONG-DAN.md` (file này) trả lời *cách chạy*.

#### Chuyển động: bớt đi, và bớt đúng chỗ

Nguyên tắc lấy từ Emil Kowalski — **cổng tần suất**: thao tác nào người dùng lặp
càng nhiều thì chuyển động ở đó phải càng ít và càng nhanh. Áp vào đây:

| Chỗ | Trước | Sau | Vì sao |
|---|---|---|---|
| Bốn mục sidebar | Trượt vào lệch 45ms mỗi lần mở trang | Đứng yên | Sidebar đứng yên suốt phiên; bốn mục nhấp nhô lệch nhịp là chuyển động không ai xin |
| Bốn ô thống kê | Tự chạy `rowIn` lệch 60ms | Không chạy nữa | Khối cha đã có `[data-reveal]` lo — hai lớp chuyển động cho cùng một thứ |
| Nhấp nhô khi rê | Nhấc/phóng ở hầu hết mọi thứ (nút phụ, thumbnail, mục toast, nút lên đầu trang, mục sidebar…) | Còn **đúng hai** thứ được nhấc: nút hành động chính và khung video chính | Chỗ nào cũng nhún thì không chỗ nào là chính; đây là mẫu chuyển động phổ biến nhất của giao diện do máy sinh |
| `--e-pop` (easing nảy) | Công tắc, toast, mục sidebar, nút điều hướng | **Chỉ** ba khoảnh khắc người dùng tự gây ra: bục xếp hạng, vòng quay thưởng, cú tick vừa bật (0,34s) | Overshoot trên thao tác tiện ích đọc ra thành đồ chơi, không phải phản hồi. Ô đánh dấu đã tick sẵn lúc mở bảng thì đứng yên — nhịp nảy gắn vào `onChange`, không gắn vào `:checked` |
| Tiêu đề trang | Kéo ra bằng `clip-path` mỗi lần đổi mục | Mờ dần + nhích 6px trong 0.34s | Chữ là nội dung tĩnh — mỗi lần bấm menu lại thấy nó được vẽ ra là tự giới thiệu |
| Đồng hồ "quá mốc" | `pickPulse` nhấp nháy vô hạn 1.6s | Đổi màu + một chấm tĩnh | Một chỗ nhấp nháy vô hạn ở góc màn hình kéo mắt khỏi danh sách mỗi 1.6 giây |
| Vệt sáng thanh tiến độ | Mọi hàng "đang làm" | Chỉ khối **Up next**, và chỉ khi thật sự có bài đang chạy (`nowbar.live`) | Mười bài cùng lúc là mười vòng lặp vô hạn |
| Nhịp so le danh sách | 40ms/hàng, không chặn | **32ms/hàng, chặn ở 10 nhịp** | 12 hàng × 40ms thì hàng cuối chờ gần nửa giây — lâu hơn cả thời gian đọc |
| Màn chờ | Ghim cứng 1.7s | Chờ dữ liệu + sàn 560ms + trần 2,6s, **mỗi lần tải trang** | Nó là câu chào thương hiệu, không phải màn hình nghi thức |

#### Sửa ba chỗ animate thuộc tính layout

Bề rộng/chiều cao đổi giá trị là trình duyệt phải tính lại bố cục. Hai chỗ đã sửa:
thanh âm lượng (chạy `width 0 → 64px` làm **chữ "Âm thanh" bị bóp rồi giãn** mỗi lần
rê chuột — nay giữ nguyên 64px, chỉ đổi `opacity`) và ô sáng sidebar (bỏ `height` thừa
khỏi transition). Vạch tiến độ cuộn từng là ví dụ thứ ba — **đã gỡ hẳn ở vòng 16**,
vì trùng chức năng với thanh cuộn của trình duyệt.

Ghi chú thêm: khối `prefers-reduced-motion` toàn cục **đã phủ mọi animation của
trang**, nên đừng khai override cho từng phần tử nữa. Hai khe hở thật phải nhớ:
`animation-delay`/`transition-delay` **không** bị vô hiệu (phần tử vào trang bằng
`both` + delay sẽ đứng im ở trạng thái đầu), và `backdrop-filter` cũng không.

#### Bố cục: trang Bảng yêu cầu thành hai cột từ 1300px

Xem mục *Trang Bảng yêu cầu: hai cột từ 1300px* ở trên. Tóm lại: cột trái giữ việc
chính của trang (thống kê, Up next, Vote của bạn, danh sách), cột phải 320px là video
của kênh. Đổi bằng `grid-template-areas`, **không** đổi thứ tự DOM, nên bản một cột
và bản hai cột luôn là cùng một nội dung.

#### Bản hẹp: ba lỗi và ba lần trả lại chiều cao

| Việc | Trước | Sau |
|---|---|---|
| Thanh lọc 6 tab | **Bị cắt mất tab cuối** — `.tabs` có `overflow: hidden`, nên "Completed" (và "Following" khi đang theo dõi) biến mất khỏi màn hình, không cách nào bấm tới | Dải tab **tự cuộn ngang**, không mất mục nào |
| Dải thống kê | 4 ô cao 2 hàng (~120px) | 4 ô về **một hàng** (~62px), 60px trả lại cho danh sách |
| Dải mục lục video | Mỗi ô 158px kèm tên (2 dòng) — hàng cao ~140px | **Chỉ còn ảnh bìa 96px** (~62px): tên video đang mở đã nằm trên sân khấu, viền sáng cho biết ô nào đang mở |
| Nút chỉ có dấu × / ↑ ↓ | Chỉ có `title` (không đọc được bằng trình đọc màn hình trên nút bấm) | Thêm `aria-label` cùng chuỗi |

#### Sửa cho khớp thực tế (những câu trong tài liệu đã sai)

- `HUONG-DAN.md` ghi nhịp so le **28ms** — CSS dùng 40ms. Nay cả hai là **32ms, chặn 10 nhịp**.
- `HUONG-DAN.md` ghi *"Không gradient, không glow. Cả file CSS còn đúng 2 `box-shadow`"* —
  điều này đã sai từ lâu và càng sai sau đợt này. Câu đúng: không gradient **trang trí**,
  bóng đổ nhẹ dùng để tách khối (và thay viền ở chỗ nền phía sau sáng thay đổi), và có
  **đúng hai ngoại lệ** được biện minh: quầng sau khung video chính và vệt sáng trên
  thanh tiến độ của Up next.
- `HUONG-DAN.md` ghi màu nhấn là "xanh dương" — thực tế là **ultramarine `#2b22e2`**
  lấy từ logo (đổi màu nhấn thì đổi ở `:root` của `src/index.css`).
- `public/robots.txt`: comment nói tên miền **không phải** `chaereve.pages.dev`, trong khi
  chính dòng `Sitemap:` ngay dưới lại trỏ vào đó. Nay comment nói đúng, kèm danh sách
  4 chỗ phải sửa cùng nhau khi đổi tên miền.
- `index.html`: `og:image` là đường dẫn tương đối `/logo-192.png`. Crawler của
  Telegram/Discord/Facebook đọc HTML thô, không có "origin của trang" để ghép với đường
  dẫn tương đối ⇒ **phần lớn nơi dán link không có ảnh xem trước**. Nay là URL tuyệt đối,
  thêm `og:url`, `twitter:title/description/image`, kích thước và `og:image:alt`.
- `public/privacy.html`: bản sao token lệch với app — `--a` còn là xanh dương cũ
  (`#4f8ff7`) và `--txt-3` còn đúng màu mà app đã phải đổi vì **chỉ đạt 3.9:1**, trượt
  WCAG AA. Nay chép đúng từ `:root` (kèm chú thích "sửa bên app rồi chép sang"), link
  dùng `--a-2` (đủ tương phản cho chữ trên nền tối), và nạp thêm nét 500 của
  Be Vietnam Pro mà trang vẫn đang gọi.
- `public/manifest.webmanifest`: `background_color` là `#0b0d10` trong khi toàn app dùng
  `#0d0f12` — lệch ở đúng chỗ người dùng thấy lúc mở app từ màn hình chính.

#### Vòng bốn (cùng ngày): sao lưu tự động + ba việc rẻ cuối cùng

1. **Sao lưu database chạy mỗi ngày** — `.github/workflows/backup-db.yml` + `scripts/*.sh`,
   kèm bước **thử phục hồi** vào một Postgres sạch và so dấu vân tay. Xem *Sao lưu database*
   ở phần Deploy.
2. **Tìm kiếm bỏ dấu** — một `fold()` dùng chung cho bảng và Admin.
3. **Sàn thời gian "sớm nhất bao lâu"** cho bài đang chờ.
4. **Nút Get votes trong tin "sát nút"**.

Ba điều đáng nhớ về việc sao lưu, vì chúng là *lý do* chứ không phải chi tiết kỹ thuật: (a)
backup không được dựa vào "file có tồn tại" — nên mới có bước phục hồi thật; (b) **policy RLS
phải nằm trong phép so**, vì thiếu một policy thì số dòng vẫn khớp trong khi bản phục hồi đã
hở quyền; (c) **mật khẩu trong chuỗi kết nối không được rò ra log** — log CI nhiều người đọc
được, nên script che phần `://user:pass@` trước khi in và có một ca kiểm thử canh đúng điều đó.

Cũng trong lượt này, đối chiếu giới hạn gói free phát hiện một trần **chặt hơn cả trần quen
thuộc**: **Workers KV gói free chỉ cho 1.000 lượt GHI mỗi ngày** (đọc thì 100.000). Lá chắn
Edge đang ghi KV mỗi lượt vote và mỗi lượt quay, nên ước lượng **~300–500 lượt vote+spin mỗi
ngày là chạm trần**; vượt thì app *không sập* (lệnh ghi nằm trong `try/catch`, người dùng vẫn
vote bình thường) nhưng tấm khiên **ngừng đếm**, chỉ còn Postgres giữ hạn mức thật. Đường ra
đều miễn phí: ghi cách quãng, hoặc chuyển bộ đếm sang **D1** (gói free cho 100.000 lượt
ghi/ngày — gấp 100 lần KV). Ghi lại đầy đủ ở `docs/DA-LAM-VA-GOI-Y.md`.

#### Vòng ba (cùng ngày): ba việc miễn phí — không dịch vụ mới, không chạm database

1. **Link mời gửi bài** `/?add=1&artist=…&title=…` — dán vào mô tả video YouTube, người xem
   bấm là form mở sẵn. Kèm nút **chia sẻ** trên mỗi dòng request (link về chính bảng
   `?f=top&q=…`, cảm ứng thì mở hộp chia sẻ hệ thống).
2. **Copy credits** trong bảng Admin — chép sẵn "tên bài + những người đã gửi" để dán vào mô
   tả video.
3. **Giới hạn free tier** — một mục mới trong phần Deploy (xem *Giới hạn của các gói miễn
   phí*), kèm hai cảnh báo quan trọng hơn mọi tính năng: **Supabase free không có backup**
   và **project free tự ngủ sau 7 ngày im ắng**.

Hai nút mảnh ở cuối dòng meta (theo dõi + chia sẻ) nay dùng **chung một class `.rowact`**:
trước đây nền của nút chuông nằm ngay trong `.followbtn`, thêm nút thứ hai là phải chép lại
toàn bộ số đo và thế nào cũng lệch. Cỡ chạm ở bản hẹp vì thế cũng chỉ còn **một** cặp số để
canh (`cssTapTarget.test.js`).

Một lỗi tự gây ra, ghi lại vì nó suýt lọt: bản đầu của `parseRequestPrefill` đọc giá trị
tham số `add` bằng `params.get('add')` rồi so với chuỗi rỗng — mà tham số **trần** (`?add`)
cũng trả về chuỗi rỗng, nên nó âm thầm bỏ qua đúng loại link ngắn nhất, loại người ta hay gõ
tay nhất. Nay đọc bằng `has()` rồi mới xét giá trị, và có ca kiểm thử riêng cho `?add` trần.

#### Vòng hai (cùng ngày): ba việc trong danh sách gợi ý đã làm

1. **Dò trùng ngay lúc gõ** — xem mục *Bài đã có trên bảng?* ở phần Luồng của một
   request. `findDuplicate()` + 7 ca kiểm thử.
2. **Nhớ bộ lọc qua các lần ghé** — xem mục *Bộ lọc, loại video và từ khoá tìm* ở phần
   Bố cục trang. `pickBoardParam()` + 3 ca kiểm thử.
3. **Dấu phân cách trong dòng metadata** — bỏ hẳn ký tự `·`, thay bằng vạch mảnh 1×9px
   (`.dot`), có `aria-hidden`: mỗi hàng request có 3-4 nhóm thông tin, mỗi nhóm cách nhau
   bằng một dấu chấm giữa là đúng mẫu văn bản do máy sinh. Dấu `·` còn lại chỉ ở những
   dòng có đúng một dấu (tiêu đề tab trình duyệt, vài dòng tiền/thời gian).

Hai gợi ý còn lại trong danh sách **cố ý không làm**, đã ghi vào `docs/DESIGN.md` §7:
không thêm chế độ sáng (mọi bóng/kính đã tính cho nền tối), và chưa bỏ aurora nền (nó là
chuyển động vô hạn duy nhất còn lại, nhưng rẻ và hợp lệ — sẽ là thứ đầu tiên cần tắt nếu
có phàn nàn về pin).

Một lỗi tự gây ra trong lúc làm vòng hai, ghi lại vì nó suýt lọt: chú thích đặt **giữa
danh sách prop** của một thẻ JSX (`<Foo a={1} /* ghi chú */ b={2} />`) làm
`propContract.test.js` đọc chữ trong comment thành tên prop và báo "dây đứt" oan. Chú
thích giải thích prop phải đặt TRƯỚC thẻ.

#### Kiểm thử

| Hạng mục | Kết quả |
|---|---|
| `npm test` (`node --test`) | ✅ **239** đạt, 0 lỗi, 1 skip (bài cần Postgres thật) — 195 nền + 44 ca mới của bốn vòng |
| `npx oxlint` | ✅ 0 lỗi, 14 cảnh báo — **đúng bằng nền trước khi sửa** (không thêm cảnh báo nào) |
| `npm run build` (Vite) | ✅ build sạch, bundle chính 338 kB (gzip 107 kB) |

Đợt này **không thể** xem bằng mắt: sandbox không có trình duyệt (thiếu thư viện NSS,
máy chủ gói không tới được). Vì vậy mọi kết luận về bố cục đều rút ra từ đọc CSS/JSX và
các chốt chặn tự động (`cssTokens`, `cssTapTarget`, `cssGridRows`, `cssScroll`,
`jsxHtml`, `propContract`, `i18nKeys`, `seoContract`, và `backup` — bộ chốt mới chạy thật
`scripts/*.sh` với `pg_dump`/`pg_restore`/`psql` giả để chứng minh "dấu vân tay lệch thì phải
đỏ"). Ba thứ nên liếc bằng mắt sau khi
deploy:

- Thu hẹp cửa sổ qua lại quanh **1300px**: bố cục phải đổi giữa một cột và hai cột, và
  ở cả hai bên ngưỡng, hàng request không được xuống dòng ở tên bài.
- Trên điện thoại thật: kéo dải tab sang ngang phải tới được tab **Completed**; dải mục
  lục video phải là một hàng ảnh bìa cao ~62px.
- Bật *giảm chuyển động* trong hệ điều hành rồi tải lại: nội dung phải hiện **ngay**,
  không có hàng nào đứng im ở trạng thái trong suốt (đây chính là khe hở
  `animation-delay` đã nhắc ở trên).

---

## Trang cá nhân công khai, bình luận, và cách đi lại trong app (vòng 18 — 21/09/2026)

### Trang cá nhân công khai

Mở bằng cách bấm vào **tên người gửi** trên một hàng request, hoặc **tên tác giả** của một bình
luận. Địa chỉ là `/?profile=<user-id>` — dạng **tham số**, không phải `/u/<id>`: host tĩnh chỉ
phục vụ `index.html` cho đúng `/` (xem `public/_redirects`), nên một link `/u/…` dán ra ngoài là
404. App vẫn **đọc** được `/u/<id>` cho những link cũ đã lỡ dán.

| Hiện | Không hiện |
|---|---|
| Ảnh đại diện (hoặc chữ cái đầu của tên), tên | Email |
| Ba ô số: **Requests** · **Completed** · **Votes received** | Số dư vote / bonus |
| Huy hiệu: *First request* (≥1 bài) · *First completion* (≥1 bài xong) · *10 votes earned* | Đơn hàng, lịch sử vote từng dòng |
| **Recent requests**: 8 bài mới nhất, mỗi bài là một link về bảng | Bài đang **chờ duyệt** (`pending`) và bài **bị từ chối** (`denied`) — RLS cho đọc cả bảng `requests`, nên lọc hai trạng thái đó là việc của `fetchPublicProfile` |

Hai điều cần nhớ khi sửa chỗ này:

1. **"Votes received", không phải "Votes given".** Con số là tổng phiếu mà các bài của người đó
   **nhận được**. Phiếu họ đi bỏ cho người khác không đọc được: RLS của `votes` là *read own
   votes*, người lạ hỏi là nhận về rỗng. Muốn đổi nhãn thì đổi luôn phép tính, đừng đổi một mình
   nhãn.
2. **Nút *Share profile* dựng URL từ `userId`**, không lấy `window.location.href` — trong iframe
   bị sandbox (bản xem trước của nền tảng) địa chỉ trên thanh có thể vẫn là địa chỉ của bảng, và
   copy ra sẽ là link sai.

Bấm một bài trong *Recent requests* (hoặc một thẻ trong *This week*) thì bảng lọc sẵn bài đó **và
cuộn xuống tận thanh lọc + danh sách kết quả** — không cuộn lên đầu trang, vì trên danh sách còn
bốn ô thống kê, video của kênh, *This week*, *Hall of Fame* và *Up next*: cuộn lên đầu là bỏ người
bấm ở cách kết quả cả một màn hình. Đích cuộn là thanh lọc chứ không phải danh sách, để còn thấy
được từ khoá vừa đặt và dòng *"đang xem n/mục"*.

*Back to board* trả về **đúng chỗ vừa rời đi**: cả địa chỉ lẫn mục đang đứng (mở trang cá nhân từ
*Của tôi* thì quay về *Của tôi*, không bị đẩy ra bảng). Bộ lọc của bảng không bị đụng tới trong
lúc trang cá nhân mở, nên quay về là thấy đúng danh sách cũ.

### Bình luận trên một request

Nút **Comments** nằm ở cuối mỗi hàng. Mở ra là khung nội tuyến (không phải hộp thoại), nên vừa
đọc bình luận vừa thấy hàng đó.

- Khách bấm vào ô nhập thì **LoginGate** mở (đúng luồng "xem được, làm thì phải đăng nhập");
- 1–180 ký tự, nút gửi tự khoá khi rỗng; lỗi hiện ngay trong khung + một toast;
- Người viết xoá được bình luận của **mình** (icon × ở góc phải cùng hàng); admin xoá được bất kỳ
  bình luận nào — cả hai đều là policy RLS, không phải chỉ ẩn nút trên giao diện;
- xoá là **xoá mềm** (`deleted_at`), nên về sau còn làm được mục kiểm duyệt;
- đọc tối đa 20 bình luận mới nhất cho mỗi request;
- chế độ demo (chưa nối Supabase) lưu bình luận vào `localStorage`: đóng/mở khung, tải lại trang
  vẫn còn.

### Tìm kiếm trên bảng: so THEO TỪ

`searchHit()` trong `src/lib/board.js` là chỗ duy nhất định nghĩa phép tìm: bỏ dấu tiếng Việt
(kể cả chữ **đ**), hạ chữ thường, gom khoảng trắng thừa, bỏ những từ chỉ có dấu câu, rồi đòi
**mỗi từ** xuất hiện đâu đó trong `nghệ sĩ + tên bài + loại bài + người gửi`.

Hệ quả mà người dùng thấy: `Pop Off LE SSERAFIM`, `LE SSERAFIM Pop Off`, `pop off`, và
`Pop Off - LE SSERAFIM` (dán từ tiêu đề video) đều ra **cùng một bài**. Bản cũ so cả cụm bằng một
phép `includes`, nên chỉ cách gõ đúng thứ tự cột của CSDL là có kết quả — và mọi link trong app
thì dựng theo thứ tự ngược lại.

Ô tìm của **bảng Admin** dùng `allTermsIn()` của cùng file đó (chuỗi dò khác: admin dò thêm ghi
chú và trạng thái), nên hai màn hình không thể trả lời khác nhau cho cùng một từ khoá.
`q` vẫn **không** được nhớ giữa các phiên: mở lại web mà danh sách tự dưng rỗng vì một từ khoá
cũ là kiểu bực mình không ai gọi được tên.

### Quy tắc cho người sửa sau: thêm một link nội bộ

Mọi link trỏ vào chính app (trang cá nhân, một bài trên bảng) phải đi qua **hai cửa**:

```jsx
import { profileUrl, boardSearchUrl } from '../lib/history'   // DỰNG địa chỉ
import { useNav, spaLink } from '../lib/nav.js'                // ĐI trong app

const nav = useNav()
<a className="requester-link" href={profileUrl(r.user_id)}
   onClick={spaLink(nav.openProfile, r.user_id)}>{r.requester}</a>
```

Bốn điều không được làm, và lý do:

| Đừng | Vì sao |
|---|---|
| Tự gọi `window.history.pushState` | Nó **ném** `SecurityError` trong iframe sandbox / `file://` / chế độ riêng tư. `lib/history.js` bọc try/catch cho đúng việc này |
| Tự phát `PopStateEvent` để "báo app đọc lại" | Nghĩa là đang coi **địa chỉ** là nguồn sự thật. Nay state đổi trước, địa chỉ là bản sao |
| Tự ghép chuỗi `?profile=` / `?f=top&q=` | Năm chỗ từng ghép năm kiểu, và một trong số đó dùng `f=top` — là cách nhìn **loại** bài đã xong/đã vào dây chuyền, nên link tới một bài đang làm là link chết |
| Bỏ `href` | Middle-click, "mở trong tab mới", copy link, và trình đọc màn hình đều cần nó; `spaLink` trả về `undefined` khi không có đường SPA để cú bấm đi theo href thật |

`profileNav.test.js` giữ cả bốn điều trên bằng hợp đồng trên mã nguồn: làm sai là `npm test` đỏ.

### Kiểm tra lại bằng gì

```bash
npm test        # 414 ca — có 10 ca season.test.js, 15 ca profileNav.test.js, 11 ca searchHit/filterBoard
npm run smoke   # 296 mục — mục 10d đi bằng đường bấm thật, mục Xếp hạng bấm cả ba nút mùa
```

Muốn soi bằng mắt: mở bảng → bấm tên người gửi → trang cá nhân → bấm một bài **đã completed**
trong *Recent requests* → bảng phải hiện đúng bài đó với ô tìm đã điền sẵn, **và trang phải cuộn
xuống tới thanh lọc** chứ không nhảy lên đầu trang. Lặp lại sau khi tự bật một chip lọc (Queue +
một loại bài): bài đó **vẫn** phải hiện.

## Các bổ sung cộng đồng (vòng 22 — 21/09/2026)

- **Tên bài trong form** gợi ý `e.g. LEMONADE`. Dò bài trùng chỉ là lời nhắc; nếu
  người dùng đi tiếp bằng Enter thì vẫn phải đi qua màn chọn *paid request* — không
  được gửi ngầm từ bước nhập tên.
- **GIF avatar** được giữ nguyên file GIF, không qua canvas crop (crop canvas chỉ
  giữ frame đầu). JPG/PNG vẫn dùng cropper như trước; giới hạn file vẫn áp dụng.
- **Comments** có reply một cấp. Reply lưu `request_comments.parent_id`, nên tải lại
  trang vẫn giữ quan hệ; xóa comment gốc cũng dọn reply con theo cascade.
- **Hall of Fame** mở popup YouTube với `start=0&end=30`, thay vì đá người xem sang
  tab mới ngay lập tức. Nút mở video đầy đủ vẫn nằm trong popup.
- **Achievement index** ở About me luôn liệt kê cả mốc đã đạt và chưa đạt: streak
  7/30/100, request đầu tiên, completion đầu tiên, top 10 và podium. Phần thưởng là
  badge/title hiển thị; không có vote weight ẩn.
- **Request quá hạn**: migration `20260921_replies_request_expiry.sql` thêm cron queue
  các request pending/queued đã quá một tháng mà chưa được chọn, báo admin; admin phải
  bấm `Expire and delete`, sau đó người gửi nhận tin request đã hết hạn và bị xóa.
  Nếu project chưa bật `pg_cron`, chạy `select public.queue_expired_requests()` bằng
  Worker schedule hoặc SQL Editor.
- Admin có thêm tab **Expired** và nút **Start production** để chuyển request queued
  sang `in_progress` (gom cùng bài theo luật cũ).

## Vòng 23 — bốn lỗi anh/chị báo trực tiếp (22/09/2026)

Bốn việc dưới đây đều là lỗi **nhìn thấy được**, nên mỗi lỗi đi kèm một phép kiểm trong
`npm run smoke` để nó không quay lại (xem chú thích trong `tools/smoke.mjs`, mục *4c* và *5b*).

- **Có lối vào màn đăng nhập.** Trước đây hàng tiêu đề chỉ có chuông thông báo, và bấm vào
  *About me* khi chưa đăng nhập chỉ ra một khối hồ sơ rỗng: không có chỗ nào mở màn đăng nhập.
  Nay **nút Đăng nhập (biểu tượng Google) nằm ngay sau chuông** ở góc phải; dưới 620px nút chỉ
  còn biểu tượng nhưng vẫn bấm được. Khách bấm vào những việc cần tài khoản — *About me*,
  *Daily Spin* — thì màn đăng nhập **tự mở**, và phía sau là một khối mời đăng nhập có nút,
  thay vì trang trắng. Chân sidebar của khách cũng có nút Đăng nhập (bỏ nút *Sign out* vô nghĩa
  với người chưa vào).
- **Hall of Fame mở preview được, không còn khung đen.** Bản cũ dựng player bằng YouTube IFrame
  Player API, tức là nạp `<script src="https://www.youtube.com/iframe_api">` — mà CSP của site
  (`public/_headers`) chỉ cho `script-src 'self'`, nên script bị chặn im lặng và khung 16:9 chỉ
  còn nền đen. Nay khung xem là một `<iframe>` nhúng thẳng `youtube-nocookie.com` (CSP đã cho
  `frame-src` từ trước): **không script bên thứ ba**, video tự dừng ở giây 30, phía sau còn một
  **ảnh bìa** nên mạng chậm cũng thấy hình. Video không phải YouTube (mp4, link lạ) vẫn mở được
  hộp này và có câu giải thích + nút mở tab mới.
- **GIF avatar lưu được.** Database chặn ảnh ở 200.000 ký tự, còn phía trình duyệt lại hứa
  "tối đa 2,5 MB": chọn GIF 1–2 MB thì app báo *"GIF sẵn sàng"*, bấm Save mới lỗi. Nay trần của
  client **đúng bằng** trần của database (~146 KB cho GIF), kiểm ngay khi chọn file, và khi quá
  lớn thì có nút **"Dùng khung đầu tiên (ảnh tĩnh)"** để ảnh vẫn vào hồ sơ được.
- **Daily Spin không còn trống.** Khách chưa đăng nhập vào mục này trước đây gặp trang trắng
  (khối vòng quay chỉ dựng khi đã có tài khoản). Nay khách thấy khối mời đăng nhập có nút Google
  và lý do rõ ràng; người đã đăng nhập vẫn thấy vòng quay như cũ.

## Vòng 24 — "hai trang chồng lên nhau" (22/09/2026)

Chủ dự án gửi hai ảnh chụp và nói: *"lúc bấm vào màn hình login và bấm vào profile người
khác xong chuyển sang tab khác trong trang thì bị lỗi chồng trang … lỗi này bị ở mọi trang"*.
Hai ảnh đó là hai lỗi khác nhau, không phải một:

- **Ảnh 1 (màn đăng nhập):** thẻ đăng nhập nằm ở đầu trang và toàn bộ bảng request bị đẩy
  xuống dưới nó — tức là **khối trong luồng văn bản**, đúng lỗi đã sửa ở vòng 23 (nút Đăng
  nhập ở hàng tiêu đề + lớp phủ `position: fixed`). Ảnh chụp không có nút × trên thẻ và
  không có nút Đăng nhập cạnh chuông → bản đang chạy là bản deploy **cũ**, chưa có bản sửa
  của vòng 23.
- **Ảnh 2 (trang cá nhân + Daily Spin):** đây là lỗi MỚI, và là lỗi thật trong mã: trang cá
  nhân công khai là một **TRANG** sống trong mục Bảng, nhưng chỉ mục Bảng có điều kiện
  `!profileId`. Ba mục còn lại (Daily Spin, Xếp hạng, About me) và cả trang quản trị cứ thế
  dựng thêm khối của mình **ngay dưới** trang cá nhân — mở profile người khác rồi bấm sang
  mục nào là mục đó hiện ra phía dưới, hai trang xếp dọc theo nhau. Ảnh chụp cho thấy đúng
  thứ tự đó: `Requests / Completed / Votes received`, streak, Achievements, Recent requests
  (các khối của trang cá nhân) rồi ngay dưới là **Daily bonus wheel**.

### Đã sửa

- **Một lá cờ duy nhất cho "đang mở trang cá nhân"** (`onProfile`), và cả sáu khối mục đều
  đi qua nó. Không còn đường nào dựng hai trang một lúc — kể cả khi dán tay `/?profile=…`
  lúc đang ở mục khác, hay khi bấm Back/Forward của trình duyệt.
- **Bấm một mục trong menu là đóng trang cá nhân đang mở** (`navTo`). Trang cá nhân có nút
  *Back to board* riêng, nên không mất đường về.
- **Địa chỉ thôi nói về trang cá nhân vừa rời** (`searchWithoutProfile`): bản cũ giữ nguyên
  `window.location.search`, nên vừa đóng trang cá nhân mà F5 lại mở lại đúng nó.
- **Chuyển cảnh giữa hai mục đi qua một cửa duy nhất** (`src/lib/viewTransition.js`).
  View Transitions là thứ duy nhất trong app vẽ ẢNH CHỤP của trang cũ lên trên trang mới,
  nên nó cũng là thứ có thể sinh ra ảnh ghép sai: bấm hai mục liên tiếp trong lúc chuyến
  0,4 giây chưa xong là lần chụp thứ hai chụp luôn cả ảnh của chuyến thứ nhất (ảnh của ảnh,
  nhiều lớp trang). Nay: đang có chuyến thì lần bấm sau đi thẳng (vẫn tới nơi, chỉ không có
  chuyển cảnh), API chết thì vẫn tới nơi, và `data-nav` luôn được dọn sau khi chuyến xong —
  bản cũ để nó nằm lại vĩnh viễn, dạy sai hướng cho chuyến sau.

### Kiểm thử

`npm test` **468 ca / 467 đạt / 0 lỗi / 1 skip** (vòng 23: 459). `src/lib/viewTransition.test.js`
là 6 ca mới, chạy thật `createSectionTransition` với `document` giả — trong đó có ca "đang có
chuyến bay thì KHÔNG mở chuyến thứ hai" (đúng thứ sinh ra ảnh chụp lồng nhau) và ca "API chết
thì người dùng vẫn tới nơi". `profileNav.test.js` thêm 3 ca khoá vế chồng trang: mọi mục dùng
chung lá cờ, menu đóng trang cá nhân, địa chỉ sạch tham số `profile`.

`npm run smoke` **332/332** (vòng 23: 326) — mục *10e* mới của `tools/smoke.mjs` bấm thật:
mở `/?profile=demo-user` rồi bấm *Daily Spin* trong menu, và khẳng định **tài liệu chỉ còn MỘT
trang** (`.public-profile` + `.daily-spin` phải bằng đúng 1). Ca này đã được chạy thử với mã
CŨ để chắc nó bắt được lỗi: kết quả `330/332`, đỏ đúng hai phép kiểm, kèm dòng
`trang cá nhân=1 · vòng quay=1` — đúng như ảnh chụp.

`npx oxlint` 0 lỗi / 26 cảnh báo (không tăng). `npm run build` sạch (`index-BZ8OCtKy.js` 337 kB).
