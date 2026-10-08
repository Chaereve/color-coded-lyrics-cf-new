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
