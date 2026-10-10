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

## Mapping v2 (migration 20261202_mystery_paid_v2.sql — đã apply production 2026-10-10 cùng B2; odds hiện hành là v3 ở `20261204`)
- 55 nothing · 20 +1 · 12 +3 · **7 +5 (DUY NHẤT outcome +5)** · 3 +10 ·
  2 **+1 free paid request** · 1 **+2 free paid requests** — tổng 100%.
- Paid: `bonus_requests += amount` đúng nhánh, ngoài cap 30, không reward_event,
  không cộng vote; replay không cộng lặp; row legacy `paid_request` vẫn đọc được
  (validator chấp nhận cả hai chính tả, từ chối paid mà mang vote).

## Kiểm chứng vòng 3
- npm test 806 tests / 761 pass / 45 skip / **0 fail** (thêm: grid map/render
  tests, CaseOpeningReel tests, mapping v2 lib + PGlite setseed, migration
  46→47, payload-v2 `reward_amount` strict) · lint **35 warnings (0 mới) /
  0 error** · build ✓ · PGlite 7/7 · probe DOM 320/375/414: grid 8 ô,
  panel không đè, không tràn ngang.
- Mapping v2 chốt THEO ĐÚNG master prompt: cột vật lý
  `mystery_opens.reward_amount` (1|2 cho paid, số vote đã trả cho votes, 0
  cho nothing) + payload `mystery_status` 9 khoá; client validate NGHIÊM
  amount khi payload v2 (sai số lượng = lỗi giao thức, không render) và chấp
  nhận payload 8 khoá pre-migration — deploy client trước/sau migration đều
  không vỡ; UI in +1/+2 từ `reward_amount` của server.
- Ảnh vòng 3 (shot set VIII, re-chụp sau fix cyclic %): workspace
  `b2-screenshots-v3/` + `manifest.json` (22 cảnh, mỗi cảnh ghi
  route/viewport/state/seed) — spin: 01 idle desktop · 02 đang chạy
  (vệt sáng kim đồng hồ, nút SPIN vững giữa) · 03 result +20 · 04 result +1 ·
  05 hết lượt (0/2, nút khoá) · 06 mobile 320 (grid khít, không tràn) ·
  07–08 mobile 390 đang chạy/kết quả — mystery: 09 locked (CTA →
  /daily-login) · 10 ready (glow) · 11 opening (charge) · 12 reel giữa nhịp
  (marker giữa, item không lòi) · 13–18 reveal đủ 7 outcome (+1/+5/+10 votes,
  **+1/+2 free paid request** tách bạch, nothing) · 19 already (mở live) ·
  20–21 mobile 390 ready/revealed — daily-login: 22 sạch mystery (0 thẻ
  nhúng, sidebar entry riêng). Ảnh vòng trước
  (vệt sáng quanh viền, nút SPIN vững giữa) · 38 result +1 · 39 result +20
  (ô trúng glow + result pop + history tier) · 40 hết lượt (0/2, nút khoá) ·
  41 mobile 320 (không tràn ngang) · 42 mobile 390 đang chạy — mystery:
  43 locked (CTA → /daily-login) · 44 ready (glow) · 45 reel giữa nhịp
  (marker giữa, item không lòi) · 46 reveal **+1 free paid request** · 47
  reveal +5 votes · 48 reveal +1 vote · 49 reveal "Better luck next time." ·
  50 reveal **+2 free paid requests** · 51 reveal +10 votes · 52 already
  opened (chip "Opened today") · 53 mobile ready · 54 mobile revealed —
  55 /daily-login sạch (không hộp quà, chỉ entry nav riêng).

# Vòng 5 (2026-10-09): LÀM THEO BẢN MẪU CHỦ SỞ HỮU — spin RING 7×5 · Daily Box 3D mở nắp + reel TRÊN hộp

Chủ sở hữu gửi TRỰC TIẾP một bản mẫu HTML hoàn chỉnh (kèm brief) cho cả hai
trang: giữ nguyên cấu trúc + hiệu ứng của mẫu, chỉ thay dữ liệu thật, font/màu
theo site (nền #0a0c10, một màu nhấn). Kết quả VẪN do server quyết tuyệt đối —
animation chỉ "đáp" vào kết quả RPC trả về. Tên "Mystery Box" đổi thành
**"Daily Box"** (yêu cầu ghi ngay trong brief của mẫu). Vòng 4 bị từ chối toàn
bộ và đã revert — mọi điểm giống v4 ở đây xuất phát từ mẫu, không phải code v4.

## Daily Spin — RING 7×5: 20 ô vuông quanh lõi chữ nhật, đèn chạy kim đồng hồ

- **Hình học**: grid 7 cột × 5 hàng; lõi chữ nhật chiếm 2/2/5/7 (quét conic
  5s + nền radial); 20 ô vuông (aspect-ratio 1) xếp vành kim đồng hồ:
  hàng trên 0–6 L→R · cột phải 7–9 · hàng dưới 10–16 R→L · cột trái 17–19.
  `SPIN_RING` (lib) = 20 mức lặp 7 mức giải theo hướng trọng số đã duyệt
  (1×5 · 2×4 · 3×4 · 5×2 · 8×2 · 10×2 · 20×1, jackpot đúng 1 ô); ô 0 của
  mẫu trùng toạ độ ô hàng trên (bug hình học trong chính mẫu) — đã sửa
  thành `[21−slot, 1]` cho cột trái, 20 toạ độ đôi một khác nhau.
- **Icon ô**: 7 SVG nội tuyến riêng từng mức (1 cỏ bốn lá · 2 sao · 3 tia ·
  5 ngọc · 8 hoa ·10 cúp · 20 vương miện) — ô phân biệt bằng icon + số,
  không chỉ màu.
- **Đèn chạy**: comet 3 ô (`.on` scale 1.12 + `.t1`/`.t2` hai ô phía sau) —
  `60 + steps` bước, delay `34 + 290·(i/n)^5` (ease-out quint của mẫu),
  reduced-motion 18ms đều; dừng CHÍNH XÁC ô chứa mức server trả
  (`spinRingTarget` chọn ô tất định gần nhất phía trước, từ MỌI vị trí).
- **Đáp**: ô trúng pulse (`spin-win`) + board mờ `.dim` + confetti canvas
  (brand pink/purple, reduced→14 hạt) + `navigator.vibrate(8)` mỗi tick +
  lõi hiện số đang chạy (`clamp(34px,10vw,58px)`).
- **Palette** r0 #5D22E1 · r1 #9D5BE8 · r2 #DC94EF · r3 #FCB0F3 (+20 có
  sheen riêng); CTA #3D05DD beat 1.8s, disabled grayscale. Vẫn KHÔNG %
  / odds / bảng xác suất anywhere; cột phụ gọn thành strip: lượt còn
  (pips) · history viền rarity · "Use votes".

## Daily Box (trước là Mystery Box) — hộp quà 3D, mở NẮP, reel nằm TRÊN hộp

- **Sân khấu**: 460px, 18 sao nhấp nháy (TẤT ĐỊNH, không Math.random),
  hint mờ dần khi mở; chính HỘP là nút mở (keyboard + aria-label riêng
  từng trạng thái; locked = disabled + padlock + hộp xám).
- **Hộp 3D thuần CSS**: perspective 1000, float 3.2s; thân 4 mặt tím brand
  + ruột hắt hồng khi mở + glow sàn; NẮP TÁCH BIỆT với BẢN LỀ CẠNH SAU
  (transform-origin z âm) — mở = rotateX(112°) 1s overshoot; ruy-băng dọc
  2 mặt + ngang nắp + nơ 2 vòng (gold của mẫu đổi thành hồng brand).
- **Nhịp mở (~7s, vẫn 1 RPC duy nhất)**: t0 RPC chạy SONG SONG với lắc
  800ms (rotate ±6°, vibrate [30,40,30]) → mở nắp + beam conic hồng →
  reel TRỒI LÊN từ hộp nằm PHÍA TRÊN (translateY 200→0, overshoot .95s)
  → trượt giảm tốc 4.6s cubic-bezier(.08,.6,.12,1) → dừng đúng ô kết quả
  dưới kim 2 đầu mũi tên (kim nảy theo từng ô qua WAAPI/transform) → ô
  đích sáng, còn lại mờ, rays xoay theo độ hiếm + confetti + rbar pop.
- **44 ô tất định**: đích ghi đè bằng kết quả server tại index 34, phần
  còn lại là chu kỳ FILLER/TAIL cố định — zero random client. Kim + số
  ô paid đọc từ `reward_amount` server trả; deux mức +1/+2 vẫn tách bạch.
  Hai bẫy ổn định đã sửa khi chụp: (1) `items` phải `useMemo` + reel chỉ
  khởi động MỘT lần (identity mảng mới giữa nhịp làm track snap lại);
  (2) geometry (item width/gap/viewport) PHẢI đo sau hold — đo sớm là đo
  trên reel đang rise scale(.3), target lệch vài nghìn px; reel giữ qua
  reveal (settled) thay vì unmount để ô đích sáng dưới kim.
- **rbar**: một vùng live duy nhất (locked/ready/opening/result + đếm
  ngược hộp kế `Next box in hh:mm:ss` theo mốc server), viền đổi màu
  rarity; focus được trả về đây sau reveal.
- Labels giữ nguyên luật vòng 3: "votes", "+1/+2 free paid requests"
  (bao dài chữ đầy đủ), "Better luck next time."; bảng odds bên phải
  trang giữ nguyên mapping không đổi.

## Kiểm chứng vòng 5

- npm test **761/0** (0 fail, baseline warning 35 không đổi) · lint
  0 error · build ✓ · PGlite mystery **7/7** + spinV2 **7/7**.
- Test cập nhật theo kiến trúc mới: dailySpin (vành 20 ô, spinRingTarget
  tất định từ mọi điểm, hình học không đè lõi), DailySpin SSR (board 20
  ô = bảng lib, icon đủ mức, comet t1/t2, no-odds), CaseOpeningReel
  (44/34, hold, settle +620ms, cleanup rAF+timeout), MysteryBoxPage
  (nắp lật/reel-trên/rays, labels paid 1–2, aria hộp là nút).
- Ảnh vòng 5: workspace `b2-screenshots-v5/` + `manifest.json` — xem
  manifest để biết route/viewport/state/seed từng cảnh; mọi cảnh
  server-decided: kết quả đến từ RPC/demo-seed, client chỉ diễn tả.

## Vòng 5.1 (feedback ngay sau duyệt lần đầu): số ô spin nhỏ gọn + hộp 3D mở nắp đúng khối

- **Spin board**: số ô giảm 30–35% (clamp 16/4.6vw/30px → 13/2.2vw/20px),
  icon nhỏ theo, board 720→660px, gap cố định 6px — bốn quadrant quanh
  lõi cân, số không còn tràn chiếm ô.
- **Nắp hộp**: góc mở 112° → 84° (nắp ngả ra SAU gần như nằm, không dựng
  thành tấm lớn che reel — lỗi khối khi mở); glow sàn nhỏ lại + mờ 0.75
  (bỏ "ô sáng vuông" giữa nắp); ruột hạ sáng tường trong; "?" ẩn ngay
  từ pha mở (trước chỉ ẩn sau opened).
- **Locked**: hộp chỉ giảm nhẹ saturate .55/brightness .78 — hết "mảng
  tối dẹt", vẫn đọc rõ khối quà có khoá.
- **Kết quả**: ô đích viền trắng + glow mạnh hơn, các ô khác mờ .3 → .45
  (đủ thấy "—" của Better luck next time.); rbar chữ kết quả 15→17px +
  icon phát sáng theo rarity — phần thưởng luôn có chỗ đọc rõ.
- Gates giữ xanh: test 761/0 · lint 33w/0e · build ✓. Ảnh chụp lại trọn
  bộ 24 cảnh b2-screenshots-v5 (manifest.json cập nhật theo).

## Vòng 5.2 (feedback tiếp): dọn dòng thừa, icon đồng bộ bộ trang, chữ tinh gọn

- **Spin strip**: BỎ dòng "Today: +N bonus votes" (spin-total) — lịch + pips
  đã đủ; key `spin.todayTotal` xoá khỏi từ điển.
- **Head spin gọn**: nhãn demo đặt CẠNH tiêu đề "Daily spin" (bỏ dòng p
  riêng); tiêu đề "Daily bonus spin" → "Daily spin"; dòng phụ lõi
  "Two free spins a day" → "Win bonus votes".
- **Icon đồng bộ BỘ TRANG** (Icon.jsx / Lucide, nét stroke khớp toàn site):
  7 mức spin map REWARD_ICON thăng hạng theo giá trị (star → note → flame →
  play → spin(disc) → cup → crown cho +20); icon lõi + rbar hộp dùng chung
  `gift`. Bỏ 2 SVG fill tự chế (ICON_PATHS, GiftGlyph). Icon.test mở rộng
  quét cả bảng REWARD_ICON (crown dùng đúng chỗ, không tên chết).
- **Chữ gọn cả 2 trang**: locked "Check in to unlock" · tap "Tap to open" ·
  readyBar "Daily box is ready" · todayDone "Next box after your next
  check-in" · pending/deviceResetHint rút gọn.
- Gates: test 761/0 · lint 33w/0e · build ✓; ảnh b2-screenshots-v5 chụp lại
  đủ 24 cảnh (manifest ghi v5.2).
