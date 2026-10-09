# UI/UX Polish — Daily Spin (B3) & Mystery Box (B2), vòng 2026-10-09

Phạm vi: **CHỈ client UI/CSS/animation/i18n/tests/preview.** Không đổi: reward
logic, odds/weights, 2 lượt/ngày + no-repeat, gate/cap/demo/route, DB contract,
openMysteryBox. Backend giữ nguyên 100%.

## Daily Spin

**Gỡ sạch %/odds khỏi UI (yêu cầu số 1)**

- Bỏ hẳn legend 7 dải kèm phần trăm, panel "Purchased/Bonus", khối rules;
  `rewardOdds`/`formatChance` không còn được import vào component (lib giữ lại
  cho test/DB).
- Tên aria của đĩa đổi thành "Wheel with 7 sectors. Brighter sectors are
  rarer." — mô tả quy tắc chung, KHÔNG tỉ lệ.
- Text về odds duy nhất còn lại nằm ở trang mystery (`mystery-odds`), theo
  brief: cấm % chỉ áp dụng khu spin.

**Bố cục mới: wheel là trọng tâm, cột phụ đúng 4 mục**

- Stage 1 hàng: đĩa lớn (tối đa 420px) trái — panel phải gói đúng:
  ① Spins left today (+ thanh 2 ô) · ② nút Spin · ③ kết quả mới nhất
  (ẩn khi chưa quay, hết chỗ trống ô viền rỗng) · ④ lịch sử ngắn +
  "Today: …". Mobile: 1 cột, panel xuống dưới đĩa.
- "votes" chỉ xuất hiện ở heading/result/history như chốt; bỏ chữ
  "credits" khỏi mọi text spin (`spin.wonNote` → "Added to your bonus
  votes today.").
- Loading/error/pending dời vào trong đĩa (trước nằm rải rác dưới stage).

**Nhãn trên đĩa — vị trí tính, không đè nhau (đã khoá test hình học)**

- `spinLabels()` trong `dailySpin.js`: mỗi ô 1 nhãn, xoay radial theo tâm ô;
  cỡ chữ co theo độ rộng cung (17/15/13/12px), bán kính neo theo span;
  +20 (cung 3,6°) là badge hồng #FCB0F3 34×18 (chữ #3D05DD, ≈8:1) tại
  r=150 — tách bán kính khỏi chữ +10.
- Test khoá: mọi nhãn nằm trong vành an toàn [52,162]; cặp nhãn bất kỳ
  không chồng nhau đồng thời theo góc VÀ bán kính.

**Palette 7 màu theo bảng chốt**

- t1→t7 = #FCB0F3 #DC94EF #BC77EC #9D5BE8 #7D3EE4 #5D22E1 #3D05DD (sáng→đậm
  theo độ hiếm; solid, không gradient). Mực: t1–t3 #2B0A50, t4 #1D0540,
  t5–t7 trắng (contrast ≥4,9:1, ghi trong comment CSS).
- Lát kề phân biệt bằng nét nền 2px (không chỉ hue). #3D05DD là accent
  duy nhất của khu spin: lát jackpot, badge, nút Spin, focus ring.
- Vòng quay: giữ đúng hành vi đã duyệt (kim gõ theo nhịp thật, kéo đĩa
  được, highlight lát trúng + burst + toast).

**Animation: anticipation + decel**

- Nhịp mới: giật lùi −14° trong 260ms (cong ease-in riêng, class
  `is-wind`) rồi phóng 4,5s decel như cũ. Reduced-motion và replay bỏ hẳn
  nhịp lùi — kết quả ra tức thì, không mất kết quả.

## Mystery Box

**State machine 5 trạng thái: locked → available → opening → reveal → already**

- `locked`: hộp xám + ổ khoá, copy mời check-in, nút "Check in at Daily
  Login" → `/daily-login` (gate không đổi).
- `available`: hộp "thở" (breathe + glow), CTA #3D05DD rõ.
- `opening`: khoá nút NGAY khi bấm (busy-guard); timeline ~2s: charge 600ms
  (co người, sáng thắt) → shake 650ms (rung, nơ nảy) → reveal. RPC
  `openMysteryBox` chạy SONG SONG nhịp charge — **kết quả do server quyết
  trước khi lộ**, client không chọn gì.
- `reveal`: tia sáng 8 hướng #FCB0F3, nắp "hé" (hop một nhịp rồi tựa nghiêng
  — không bay đè chữ), prize pop. "Nothing" vẫn có tia + pop + copy riêng,
  không bao giờ trống rỗng như lỗi.
- `already`: prize + lời hẹn "hộp mới sau check-in kế", KHÔNG còn CTA.
- Huy hiệu loại thưởng: votes #FCB0F3, paid request #DC94EF, nothing trắng.
- Palette đồng bộ khu spin (thân hộp #7D3EE4→#3D05DD, nắp/nơ #FCB0F3),
  mọi nhịp là transform/opacity (không CLS), không audio, không asset
  case-opening ngoài.

**A11y & reduced motion**

- MỘT vùng `.mystery-outcome` `role="status" aria-live="polite"` đọc được
  cả nhịp mở lẫn kết quả; focus không bị di chuyển; lỗi `role="alert"`.
- Reduced-motion: bỏ breathe/shake/tia — fade thẳng tới kết quả đầy đủ.
- Bảng odds của mystery (trang riêng) giữ nguyên theo brief.

## Tests

- `DailySpin.test.js` viết lại: KHÔNG %/odds/legend; panel đúng 4 mục;
  7 lát + 7 nhãn (6 radial + 1 badge); palette 7 hex + stroke 2px + mực
  theo nền; anticipation `is-wind`; kéo đĩa giữ nguyên hành vi.
- `dailySpin.test.js` thêm hình học `spinLabels` (vành an toàn + không
  chồng góc lẫn bán kính).
- `MysteryBoxPage.test.js`: mở rộng — padlock ở locked, aria-live outcome,
  `mystery.again` ở already, lớp accent theo loại thưởng; test mới khoá
  flow mở hộp (khoá nút ngay, RPC song song, client không pick thưởng,
  keyframes không đụng thuộc tính gây reflow, không audio).
- Kết quả: `npm test` 804 test / **759 pass / 0 fail** (45 skipped,
  PGlite chạy riêng); lint **35 warnings — 0 mới, giảm 2** so với nhánh
  trước polish; `npm run build` xanh.

## Ảnh preview (b1-screenshots)

- Spin: `21-spin-fresh` · `22-spin-result` (+8) · `23-spin-jackpot` (+20,
  badge tách +10) · `24-spin-limit` (0/2) · `25-spin-mobile`
- Mystery: `26-mystery-locked` · `27-mystery-available` · `28-mystery-opening`
  · `29-mystery-reveal-prize` (+5) · `30-mystery-reveal-nothing` ·
  `31-mystery-already` · `32-mystery-mobile-available` ·
  `33-mystery-mobile-reveal`
- `/daily-login` xác nhận KHÔNG nhúng mystery (`34-dailylogin-clean`;
  chữ "Mystery Box" duy nhất trong ảnh là link điều hướng đã duyệt).

Sau khi duyệt: B4 (vote-back) → B5 (captcha) theo kế hoạch cũ.


---

# Vòng 2 (feedback 2026-10-09): sửa "lòi số" + case-opening reel + chữ gọn

## Spin — tìm ra và sửa GỐC RỄ lỗi số tràn lát

- **Nguyên nhân thật** (đo bằng getBBox trên trình duyệt): CSS
  `.spin-wheel-number { font-size: 24px }` ĐÈ lên attribute `fontSize` của
  SVG — mọi nhãn render 24px dù `spinLabels()` tính 17/15/13/12; nhãn +10
  ở 24px tràn ~5° khỏi lát 14,4°.
- Sửa: bỏ font-size khỏi CSS (JSX truyền `fontSize={L.size}` từ
  `spinLabels()`); `spin-wheel-plus` đổi sang `em` (0.72em). +10 hạ 13→12px,
  bán kính nhãn thường 122→126px (cân biên ~5px mỗi bên).
- Test MỚI chốt bài học: bề dày tangential thực của chữ (em ≈ 1,45×cỡ chữ)
  phải ≤ 85% độ rộng lát, với mọi nhãn trừ badge +20 (marker chủ đích,
  tách bán kính riêng).
- Kiểm chứng probe (1360px & 390px): mọi nhãn r∈[112..152] ⊂ vành an toàn,
  +10 chiếm 9,7° / lát 14,4° (67%), không nhãn nào tràn lát lẫn vành.

## Mystery Box — case-opening REEL đúng nghĩa + chữ tinh gọn

- Thùng quà vẽ lại: thân ramp #7D3EE4→#3D05DD + RUY BĂNG dọc hồng chạy
  suốt thân, nắp hồng hai lớp + NƠ HAI QUẮN (vector thuần CSS), ổ khoá ở
  locked. Bỏ kiểu "hộp vuông + dấu ?".
- **Nhịp mở mới (~2,7s)**: charge 450ms (co người, sáng thắt; RPC
  openMysteryBox chạy SONG SONG) → **REEL ngang 2,2s**: dải 24 ô trượt qua
  vạch giữa hồng phát sáng, giảm tốc cubic-bezier(.1,.72,.14,1) và DỪNG
  ĐÚNG ô kết quả server trả (ô đích được GHI ĐÈ vào dải — client không
  chọn, không random; dải filler là chuỗi cố định, aria-hidden) → chớp
  sáng + prize pop.
- Reveal giờ tới ĐÚNG hẹn sau khi sửa bug thật: `onOpened` là arrow inline
  của page (đổi identity mỗi giây vì đồng hồ tick) làm effect reel cleanup
  vô hạn — neo `onOpened` vào ref, `finish` ổn định ([]).
- Focus: vùng outcome `tabIndex={-1}` và nhận focus sau reveal (không rơi
  giữa animation). Reel thuần transform trên khung 116px cố định + mask
  hai mép — 0 CLS.
- Reduced-motion: bỏ charge + reel, fade thẳng kết quả (đã test).
- **Chữ tinh gọn**: "Check in to unlock today's box." · "What's inside
  today?" · nút "Open" · "Nothing this time." · "Next box after your next
  check-in." · "+1 free request" · bảng "Prizes".

## Kiểm chứng vòng 2

- npm test 804/759 pass/0 fail · lint 35 warnings (0 mới, 0 error) · build ✓
- Ảnh: 21–25 spin (chữ nằm trọn trong lát ở cả mobile) · 26 locked (thùng
  ruy-băng + khoá) · 27 available · 28 opening (charge) · **35 reel giữa
  nhịp** · 29 reveal +5 · 30 reveal "Nothing this time." · 31 already ·
  32/33 mobile · 34 /daily-login sạch (card? false, chỉ link nav).

# Vòng 3 (MASTER PROMPT 2026-10-09): Spin = SQUARE GRID 3×3 · Mystery giữ reel · mapping paid tách 2 mức

Quyết định của owner chốt lại hai UI thành HAI NGÔN NGỮ KHÁC NHAU vĩnh viễn:

## Daily Spin — square grid spinner (cấm wheel, cấm reel ngang)
- **Layout 3×3**: 8 ô quanh viền + ô giữa là NÚT QUAY THẬT (button, keyboard
  trực tiếp, hover/active/focus-visible, disable khi loading/spinning/hết lượt,
  không bị vệt sáng đè).
- **Thứ tự 8 ô theo chiều kim đồng hồ** (index spec = thứ tự vệt chạy):
  `0 TL +1 · 1 TM +2 · 2 TR +3 · 3 MR +5 · 4 BR ACCENT · 5 BM +8 · 6 BL +10 ·
  7 ML +20`. DOM render qua `SPIN_GRID_RENDER_ORDER = [0,1,2,7,null,3,6,5,4]`
  (sentinel `null` = nút giữa) — index spec khớp vị trí hình học.
- **7 giải + 1 accent**: accent là gem hình thoi + nền dashed hoạ tiết — KHÔNG
  thuộc bảng odds, KHÔNG bao giờ là ô dừng; mỗi mức giải map ĐÚNG MỘT ô
  (`spinCellForReward`, mức lạ → `err.spinResponse`).
- **Nhịp**: bấm QUAY → khoá nút NGAY → vòng nhanh 70ms/bước ≥ 3 vòng trong lúc
  chờ server → server trả `segment` → decel 2,2s (delay mỗi bước ease-out chuẩn
  hoá) → dừng ĐÚNG ô giải → ô giữ active + result pop; lỗi → dừng an toàn, bật
  lại nút, i18n. rAF/timer đều cleanup khi unmount/lỗi. Reduced-motion/replay:
  bỏ vòng chạy, hiện đúng kết quả tức thì.
- Odds 30/25/20/12/8/4/1 KHÔNG đổi; KHÔNG % / bảng odds trên UI; backend
  (RPC, quota, no-repeat, gate) giữ nguyên 100%.
- Mobile: `--cell: clamp(62px, (100% − 16px)/3, 104px)` — 3 ô + 2 gap đúng
  100% bề rộng, không tràn 320px; số không lòi ô (cell.num clamp 15–19px).

## Mystery Box — giữ case-opening reel ngang, duration 3,6s (cửa 2–4s)
- Component đổi tên `RewardReel` → `CaseOpeningReel` (+ subcomponents
  `CaseReel*`) và là TÀI SẢN RIÊNG của Mystery — file jsx chỉ export
  component; hằng số hợp đồng (`REEL_TARGET_INDEX`…) chuyển sang
  `src/lib/mysteryBox.js`.
- Nhịp mở ~4,1s: charge 450ms (RPC song song — server quyết trước) → reel
  3600ms dừng chính xác ô đích dưới marker → chớp + pop + reveal.
- Ô đích paid: **hai mức phân biệt bằng con số** `+1` / `+2` (kind
  `free_paid_request`); reveal: "+1/+2 free paid request(s)"; nothing:
  "Better luck next time." (không giống lỗi).

## Mapping v2 (migration 20261202_mystery_paid_v2.sql — chỉ viết file, chưa apply)
- 55 nothing · 20 +1 · 12 +3 · **7 +5 (DUY NHẤT outcome +5)** · 3 +10 ·
  2 **+1 free paid request** · 1 **+2 free paid requests** — tổng 100%.
- Paid: `bonus_requests += amount` đúng nhánh, ngoài cap 30, không reward_event,
  không cộng vote; replay không cộng lặp; row legacy `paid_request` vẫn đọc được
  (validator chấp nhận cả hai chính tả, từ chối paid mà mang vote).

## Kiểm chứng vòng 3
- npm test 805 tests / 760 pass / 45 skip / **0 fail** (thêm: grid map/render
  tests, CaseOpeningReel tests, mapping v2 lib + PGlite setseed, migration
  46→47) · lint **35 warnings (0 mới) / 0 error** · build ✓.
- Ảnh vòng 3: `b1-screenshots/` 36–55 — spin: 36 idle desktop · 37 đang chạy
  (vệt sáng quanh viền, nút SPIN vững giữa) · 38 result +1 · 39 result +20
  (ô trúng glow + result pop + history tier) · 40 hết lượt (0/2, nút khoá) ·
  41 mobile 320 (không tràn ngang) · 42 mobile 390 đang chạy — mystery:
  43 locked (CTA → /daily-login) · 44 ready (glow) · 45 reel giữa nhịp
  (marker giữa, item không lòi) · 46 reveal **+1 free paid request** · 47
  reveal +5 votes · 48 reveal +1 vote · 49 reveal "Better luck next time." ·
  50 reveal **+2 free paid requests** · 51 reveal +10 votes · 52 already
  opened (chip "Opened today") · 53 mobile ready · 54 mobile revealed —
  55 /daily-login sạch (không hộp quà, chỉ entry nav riêng).
