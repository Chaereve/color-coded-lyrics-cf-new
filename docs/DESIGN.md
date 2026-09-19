# DESIGN.md — Chaereve Request Page

> **Một file, ba thứ đi cùng nhau: token, luật, và LÝ DO.**
> File này không mô tả *cái gì* (đọc `src/index.css`), cũng không mô tả *cách chạy*
> (đọc `HUONG-DAN.md`) — nó trả lời **vì sao chỗ đó lại như vậy**, để lần sau có
> người sửa thì sửa đúng chỗ thay vì phá luật rồi vẽ lại từ đầu.
> Nguồn: `leonxlnx/taste-skill` (kỷ luật chống "giao diện do máy sinh"),
> `kylezantos/design-motion-principles` (chuyển động: Emil Kowalski · Jakub Krehel ·
> Jhey Tompkins), `VoltAgent/awesome-claude-design` (ý tưởng `DESIGN.md`).

---

## 0. Design Read — đọc bối cảnh trước khi sửa một dòng CSS

| Câu hỏi | Trả lời của trang này |
|---|---|
| Loại trang | Bảng yêu cầu cộng đồng (request/vote board) + trang cá nhân + một vòng quay thưởng |
| Người dùng | Fan của một kênh nhạc YouTube, phần lớn vào bằng **điện thoại**, mạng 4G Việt Nam |
| Việc chính | Gửi yêu cầu · vote cho yêu cầu của người khác · xem cái gì sắp tới lượt · xem mình đứng đâu |
| Nhịp dùng | Lặp lại **hằng ngày**, một phiên vài phút, thao tác chủ yếu là **bấm nút vote** |
| Không khí | Tối, im, tập trung vào chữ. Có một màu nhấn duy nhất, không trang trí |
| Nguồn cảm hứng công cụ | Ứng dụng năng suất (Linear/Height) hơn là trang marketing |

**Ba con số điều chỉnh (dials)** — đổi được, nhưng phải đổi *cả bộ*:

| Dial | Giá trị | Nghĩa ở đây |
|---|---|---|
| `DESIGN_VARIANCE` | **5/10** | Bố cục theo luật (khối kính, một thang bo góc, một màu nhấn). Không thí nghiệm hình khối lạ: người dùng vào để đọc danh sách, không để ngắm bố cục |
| `MOTION_INTENSITY` | **3/10** | Công cụ dùng hằng ngày → chuyển động ít, ngắn, chỉ để xác nhận trạng thái. Xem §3 |
| `VISUAL_DENSITY` | **7/10** | Mật độ cao là *có lý*, không phải lỗi: một màn hình phải chứa được 20 dòng request, số liệu và trạng thái. Thoáng quá thì phải cuộn thêm |

Câu hỏi suy luận (§0 của taste-skill) chỉ có một, và đã tự trả lời được:
*người dùng đến để đọc và vote, hay để xem video?* → **cả hai, nhưng đọc trước**.
Kết luận đó quyết định bố cục ở §2.

---

## 1. Ngôn ngữ thị giác

### 1.1 Màu

- **Một màu nhấn**: ultramarine `#4d40f0` (hue 242°; bản gốc `#2b22e2` đã được
  nâng một bậc sáng ở vòng 7 vì chữ trắng trên nền nhấn chỉ đạt 5.2:1).
  Bốn sắc độ có việc rõ ràng, không phải bốn "sắc thái thẩm mỹ":
  `--a` (nền nút), `--a-dim` (hover), `--a-2` (chữ/icon trên nền tối — `--a`
  nguyên bản không đủ tương phản cho chữ), `--a-soft` / `--a-glow` (nền/viền).
- **Đối chiếu với bộ palette gửi kèm (12 palette × 10 shade)**: hệ này trùng
  *Palette 3 — Purple + Blue Grey*, chỉ khác là chạy ở chế độ tối nên thang bị
  lật. `--a #4d40f0` ≈ Purple 600 (`#4D3DF7`), `--a-dim #382ecc` nằm giữa 700–800
  (`#3525E6` / `#1D0EBE`), `--a-2 #a9a4ff` ≈ Purple 200 (`#A2A5FC`). Nền và chữ đi
  thang *Cool Grey* (`#1F2933 … #F5F7FA`) lật ngược: nền lấy đầu tối, chữ lấy đầu
  sáng. Màu trạng thái lấy đúng thang *supporting* chuẩn nhưng chọn shade nhạt
  hơn (Red 300 `#E66A6A`, Yellow 400–500 `#F7C948`/`#F0B429`, Green 400–500
  `#57AE5B`) vì trên nền tối shade 600–900 của thang gốc không đủ tương phản.
  Tỉ lệ của bộ palette — **nhấn 5–10%, trung tính 80–90%, hỗ trợ 5–10%** — cũng
  là luật ở đây: màu nhấn chỉ nằm ở nút chính, ở mục đang chọn, và **đúng một
  lát** của vòng quay.
- **Màu trạng thái** chỉ sống trong một chấm tròn 6px + chữ xám. Trạng thái là
  *dữ liệu*, không phải *trang trí* — một hàng có 4 màu là một hàng không đọc được.
- **Màu loại request** (CCL / Full Album / 1 Hour Loop / Short) là bốn màu loang
  như nhau về độ chói, cố ý: không loại nào được đọc là "quan trọng hơn".
- Không gradient trang trí, không quầng sáng phát sáng. Ngoại lệ đã được biện minh
  từng chỗ: quầng sau khung video chính (§2.3), vệt sáng trên thanh tiến độ.

### 1.2 Chữ

- `--font` Be Vietnam Pro (tiếng Việt có dấu — font Latin thường rơi dấu sai),
  `--mono` JetBrains Mono (mọi con số), `--display` Archivo Display (chỉ tiêu đề).
- Đúng **ba** token font. Có thêm token thứ tư là bắt đầu có hai hệ chữ đánh nhau.
- Mọi chỗ hiển thị số đều `font-variant-numeric: tabular-nums`: số đổi giá trị
  theo realtime mà không bật tabular là cột số **rung** mỗi lần cập nhật.
- Font tự host, `font-display: swap`, preload trong `index.html`. Không `<link>`
  tới Google Fonts: một request sang miền khác nằm ngay trên đường hiện chữ.

### 1.3 Hình khối

- Một thang bo góc duy nhất suy ra từ `--radius` (6 → 8 → 12 → 16 → pill).
  Bo góc "mỗi khối một số" là dấu hiệu rõ nhất của giao diện ráp từ nhiều nguồn.
- Viền 1px mảnh, **không bóng đổ nặng**. Nền sáng thay đổi (ảnh bìa, avatar) mà
  cứ dùng viền thì viền biến mất; ở đó dùng bóng — xem §4.
- Danh sách là **một khối** có đường kẻ phân hàng, không phải mỗi hàng một thẻ:
  20 tấm thẻ rời trong một cột là 20 lần mắt phải "vào khối" lại từ đầu.
- **Icon dùng chung một bộ: Lucide** (`components/Icon.jsx`), nét 1.7 và cỡ 16px
  khai ở đúng một chỗ; tên gọi đặt theo *việc* (`close`, `prev`, `bellOn`), không
  theo hình. Ba thứ cố ý vẽ tay: logo thương hiệu (Lucide không vẽ logo), hình
  của vòng quay thưởng, và **ô đánh dấu** — hộp tick do hệ điều hành vẽ một nửa
  (`accent-color`), nửa còn lại mỗi máy một khác, nên nó được vẽ bằng SVG trong
  `components/Check.jsx`, lấy màu trạng thái của từng khu qua `--chk`.

---

## 2. Bố cục

### 2.1 Khung trang

```
≥900px   [ sidebar 252px cố định ] [ .main ≤1060px, canh giữa phần còn lại ]
<900px   sidebar thành ngăn kéo, .main chiếm cả bề ngang, lề 26 → 14px
```

Sidebar giữ **điều hướng + cài đặt + tài khoản + liên hệ**. Bốn mục chính, không hơn.

### 2.2 Bảng yêu cầu — hai cột từ 1300px

```
<1300px (một cột)                 ≥1300px (hai cột)
  thống kê                          thống kê │  video của kênh
  video của kênh                    Up next  │  (cột 320px, đứng riêng)
  Up next                           vote     │
  vote của bạn                      danh sách│
  danh sách request
```

Lý do ngưỡng **1300px** là con số tính ra chứ không phải chọn cho đẹp: từ 900px
trở lên `.shell` đã chừa 252px cho sidebar, nên `.main` chỉ còn `viewport − 252`.
Muốn cột nội dung còn ≥650px (đủ để tên bài không phải xuống dòng) thì cần
`650 + 24 + 320 + 52 + 252 ≈ 1298px`. Dưới ngưỡng đó, hai cột **bóp** hàng request
chứ không tận dụng khoảng trống — nên về một cột, và ở một cột thì cột video nằm
ngay dưới thống kê vì đó là thứ "xem thêm" hấp dẫn nhất.

Cột video là cột **phụ**: có thì tốt, không có trang vẫn đủ. Nó không được phép
đẩy nội dung chính xuống.

### 2.3 Ghi nhớ lựa chọn của người dùng

Bộ lọc (tab + loại video) được nhớ trong `localStorage`, `q` thì không. Luật chung
cho mọi thứ "nhớ trạng thái" trong app này:

1. **URL luôn thắng** — một link được dán vào đâu đó phải mở đúng cái người gửi
   nhìn thấy, kể cả trên máy người khác.
2. **Đã lưu đứng thứ hai** — người quay lại không phải chọn lại từ đầu.
3. **Mặc định đứng cuối**, và **giá trị không còn hợp lệ bị bỏ qua**, không đẩy vào
   state: một tab đã bị đổi tên còn nằm trong máy người dùng sẽ cho ra một danh sách
   rỗng mà không ai hiểu vì sao.
4. **Thứ mang tính phiên thì không nhớ.** Từ khoá tìm kiếm không được nhớ: mở lại
   web mà danh sách tự dưng rỗng vì một từ khoá cũ là kiểu bực mình không ai gọi
   được tên. Riêng **màn chờ thì ngược lại**: nó không nhớ gì và chạy mỗi lần
   tải trang (§3.2) — bản "một lần mỗi phiên tab" đã bị bỏ (chủ dự án chốt
   19/09) vì F5 là thao tác thường gặp nhất của người đang chờ app cập nhật.

### 2.4 Thứ tự đọc và thứ tự DOM

DOM luôn theo thứ tự đọc: `thống kê → video → Up next → vote → danh sách`.
Bản hai cột đặt lại bằng `grid-template-areas`, **không** đổi DOM — đổi DOM cho
khớp hình là cách chắc chắn nhất để bản một cột và bản hai cột lệch nhau về sau,
và để trình đọc màn hình đọc sai thứ tự.

### 2.5 Thanh tiến độ — một khối, một con số

Phần trăm của một request đang làm đi qua **một** component: `components/Progress.jsx`.
Luật:

- Vạch và con số nằm **cùng một hàng**, số sát mép phải vạch. Không bao giờ in
  con số trần rồi để cái vạch rời ở dưới: mắt phải tự nối hai thứ, và con số
  luôn lệch trái so với vạch.
- Số dùng `--mono` + `tabular-nums` **và có bề rộng chừa sẵn** (vòng 16). Chỉ
  `tabular-nums` là chưa đủ: "9%" và "100%" vẫn khác nhau một con số, mà con số
  nằm **sau** vạch (`flex: 1`), nên mỗi lần tiến độ qua hàng chục hay tới 100%
  thì **vạch tự ngắn lại đúng bằng một con số**. Chừa 30px + canh phải thì mép
  vạch đứng yên tuyệt đối (mono 10,5px: "100%" ≈ 25px < 30px).
- **Kích thước là một quyết định thiết kế, không phải chỗ để nới** (vòng 17).
  Chủ dự án gửi ảnh một hàng request: *"thanh progress đang bị bự và xấu quá"*.
  Bốn thứ cùng lúc làm nó bự, và cả bốn đều là hệ quả của việc mỗi thứ được nới
  một nhịp mà **không ai nhìn tổng thể cái khối**:

  | | Trước | Sau | Vì sao |
  |---|---|---|---|
  | Rãnh | 6px | **4px** | 6px là độ dày của một dải băng; 4px vẫn đọc được ở 1x mà đọc ra là "một đường" |
  | Khối vạch + số | 340px | **220px** | Cột danh sách trên màn hai cột chỉ ~740px → 340px là gần **nửa** bề ngang hàng, thành thứ to nhất sau tiêu đề |
  | Con số | 11,5px nét **600**, màu vạch pha trắng | **10,5px nét 500**, pha 72% màu vạch + 28% `--txt-2` | Một chữ số in đậm màu bão hoà to hơn cả tên người gửi là chỗ to tiếng nhất trong hàng |
  | Hai vạch mốc | `rgba(0,0,0,.42)`, rãnh 6px | `rgba(0,0,0,.34)`, rãnh 4px | Ở 6px chúng đọc ra như vạch chia của một thanh ba khúc; ở 4px chúng là đường nối trong lòng vạch |

  Bài học cho lần sau, ghi lại vì đây là lần thứ hai cùng một khối bị chỉ:
  **khi thanh tiến độ nằm trong một HÀNG danh sách, mọi con số của nó phải nhỏ
  hơn con số nhỏ nhất của hàng đó.** Vạch có thể mang màu trạng thái, nhưng kích
  cỡ và độ đậm thì phải xếp dưới chữ — nó là chi tiết phụ, không phải số liệu.
- **Hai vạch mốc chia ở 40% và 80%** (vòng 16): con số này không trừu tượng,
  sau nó là đúng ba việc có tên (Layout 40 · Lyrics 40 · Edit 20 — `MILESTONES`
  trong `db.js`, cũng là ba ô tick admin nhìn thấy). Nhờ vậy "42%" đọc ra "xong
  Layout, đang làm Lyrics". Vị trí mốc do JS đặt qua `--m`, **suy từ
  `MILESTONES`** chứ không viết cứng 40/80 trong CSS: đổi trọng số ba mốc ở
  `db.js` là vạch chia đi theo, không có hai chỗ khai cùng một con số. Mốc là
  vạch **chìm** (xem bảng ở mục dưới) nên đọc được cả khi ruột màu đã chạy qua;
  cấu trúc ba mốc nằm trong `title` của cả khối, còn hai vạch mốc là
  `aria-hidden` (đọc lại chỉ thành tiếng ồn).
- Giá trị rác (`undefined`, `"abc"`, `150`, `-3`) bị kẹp về `0..100` **trong
  component**; không chỗ gọi nào phải tự kiểm tra.
- `role="progressbar"` + `aria-valuenow/min/max` + nhãn `t('progress.label')`:
  máy đọc được "Build progress, 47 percent" thay vì một con số lơ lửng.
- Vạch tô theo `--sc` (mặc định `--progress`), khai **trên `.prog` trong CSS** —
  không phải prop. Màu là chuyện của cả hệ, không phải của từng chỗ gọi: khi mỗi
  chỗ gọi tự truyền một màu thì *cùng một bài* có hai màu vạch ở trang chủ và
  bảng quản trị (đã từng xảy ra, vòng 10 gỡ hẳn prop `color`).
- Bản `wide` (bảng Admin) bỏ con số vì số tổng đã in ở `.steps-pct` ngay trên —
  cùng một dữ liệu không in hai lần trong một khối.

**Màu của vạch** (chốt 19/09 sau khi chủ dự án nói "màu thanh progress chưa
đẹp"): vạch không tô phẳng một màu, và cũng **không** lấy màu ngoài hệ:

1. ruột là **một màu sạch**: `color-mix(in oklab, var(--sc) 88%, #fff)`. Vòng 9
   trộn về phía **màu nền** ở đầu vạch; trên nền xanh đen, trộn với nền thì ra
   **màu bùn** — trộn với trắng chỉ **nâng sáng**, nên vẫn đúng màu của chính nó;
2. **đầu vạch sáng 3px** (`::before`, `right: 0`) ở đúng chỗ tiến độ đang đứng,
   cộng quầng sáng nhỏ `0 0 10px -3px`; mép trên vẫn có vệt sáng `inset` và rãnh
   vẫn có bóng lõm. Chọn `::before` chứ không phải `::after` vì `::after` đã là
   vệt sáng quét của khối Up next — hai thứ đó sẽ đè nhau;
3. con số phần trăm **ăn theo tông của vạch** (`--sc` pha trắng 22%) thay vì một
   màu xám không liên quan gì tới thanh bên cạnh nó;
4. **tick hết ba mốc thì đổi màu xong**: `.prog-full { --sc: var(--done) }` — chỉ
   một biến đổi chỗ, vạch + đầu vạch + con số cùng đi theo, không chép ba luật.
   Đây là trạng thái thật (Layout/Lyrics/Edit đã tick hết, chỉ còn chờ chốt), và
   admin nhìn một lượt cả bảng là thấy ngay bài nào đã tới đích;
5. `min-width: 6px` — bằng đúng đường kính bo tròn. Nhỏ hơn thì 1% biến mất và
   người dùng đọc ra "chưa bắt đầu", trong khi việc đã bắt đầu rồi. Nhưng vạch
   chỉ được DỰNG khi `pct > 0`: trước đây nó luôn tồn tại (để giữ `min-width`
   cho 1%), nên ở 0% vẫn có một que màu nằm trong rãnh trong khi con số ngay
   cạnh ghi "0%" — hai chỗ nói ngược nhau. `Progress.jsx` không vẽ vạch ở 0%,
   `min-width` chỉ còn nghĩa khi phần tử có mặt.
6. rãnh cao 7px với bóng lõm khai **ngay trong luật của rãnh** (bản trước có hai
   luật rời nhau cách xa nhau trong file), ruột vạch có vế bóng tối ở mép dưới
   nên đọc ra một thanh mảnh có mặt cong, và dấu `%` **ăn theo tông của con số**
   bằng `opacity` thay vì một màu xám thứ ba.

**Hàng trong bảng quản trị** hiện cùng thanh đó ngay trên hàng (`!open`), không
bắt admin mở khung sửa mới biết bài đang tới đâu; khung sửa đang mở thì thanh
lớn kèm ba mốc trong khung đảm nhiệm, không in hai lần.

### 2.6 Nhãn và cụm nhãn — một khuôn, một hộp

Chủ dự án báo "các nhãn tag đôi lúc bị chồng hoặc vướng vào nhau". Nguyên nhân
không nằm ở nhãn nào cụ thể mà ở chỗ **mỗi nhãn tự ứng xử một kiểu**:

- `.pill` (trạng thái, PAID, trùng bài) và `.kind` (loại video) dùng **chung một
  khuôn**: `inline-flex`, `flex: none`, `white-space: nowrap`, `line-height: 1`.
  `flex: none` là điều kiện để nhãn không bị bóp; `nowrap` để một nhãn không bao
  giờ tự xuống dòng giữa chữ; `line-height: 1` để chiều cao nhãn không phụ thuộc
  chữ bên trong nó.
- Cứ **từ hai nhãn trở lên** thì cả cụm nằm trong `.tags` — hộp `flex-wrap` có
  `gap: 6px` và `min-width: 0`. Nhãn không có khe là nhãn dính chữ vào nhau, còn
  chỗ xuống dòng phải do hộp quyết định chứ không do ngắt dòng tự phát.
- Bề rộng dòng chữ đứng cạnh nhãn thuộc về `.tags .tx` (ellipsis), không thuộc
  nhãn: chữ dài phải bị cắt, nhãn phải còn nguyên.

Có `src/lib/cssFilterBar.test.js` canh hợp đồng này.

### 2.7 Bảng xếp hạng — luật tính nằm một chỗ, và có test

Luật xếp hạng ở `src/lib/ranking.js` (thuần, không React, không mạng — test bằng
số được). Component chỉ hỏi luật. Ba điều đã sửa:

1. **Khoá phá hoà không bao giờ trùng khoá chính.** Bản cũ sắp bằng một chuỗi `||`
   trong component; xếp theo phiếu thì khoá phá hoà đầu tiên cũng là phiếu, xếp
   theo số bài thì khoá thứ hai cũng là số bài — khoá trùng khoá chính là khoá
   chết, thứ tự rơi xuống so theo tên. Nay chuỗi là *đã xong → tổng phiếu → số
   bài → tỉ lệ → tên*, và khoá đang xếp bị loại khỏi chuỗi.
2. **Tỉ lệ hoàn thành chỉ có tiếng nói khi số bài đã bằng nhau.** 6/6 trên 6/30,
   nhưng 30 bài đã xong không bị 1 bài đã xong đè.
3. **Một danh tính là một dòng.** Bản demo gom theo `user_id::requester` nên người
   đổi tên hiển thị hiện thành hai dòng, cả hai đều được tô "bạn". Nay `rankDemo()`
   gom đúng như view `requester_ranking` bên Postgres (`user_id`, tên dùng nhiều
   nhất), và dòng `null` không làm sập bảng.

**4. Có CÔNG THỨC, không chỉ có thứ tự (vòng 10).** Ba cách xếp đầu là ba phép đếm,
nên mỗi cách chỉ trả lời được câu hỏi hẹp của nó: xếp theo số bài thì người gửi 40
bài không bài nào được làm đứng trên người có 3 bài đã lên sóng, còn xếp theo phiếu
thì người gom phiếu từ bài bị từ chối vẫn leo hạng. Cách xếp **mặc định** nay là
**điểm**:

> **điểm = 10 × số bài đã xong + tổng phiếu**

- **Bài chưa xong không có điểm.** Gửi nhiều mà không bài nào được làm thì không leo
  hạng — cùng tinh thần với việc gom cụm trùng và việc bài bị từ chối không tính hạng.
- **Một bài xong đáng giá bằng 10 phiếu.** Cộng đồng đòi thật vẫn có tiếng nói, nhưng
  phiếu không mua được hạng một mình.
- Hai trọng số là **hằng số công khai** (`POINT_DONE`, `POINT_VOTE` trong
  `src/lib/ranking.js`), và câu nói rõ luật trên bảng **ghép số từ chính hai hằng số
  đó** (`t('rank.rule.points', { d: POINT_DONE, v: POINT_VOTE })`) — đổi luật là đổi
  cả câu chữ, không thể có chuyện bảng tính một đằng, lời giải thích một nẻo.
- Điểm được **tính một lần** trong `rankRows` rồi gắn vào từng dòng (`p.points`), nên
  cột điểm và thứ tự đang sắp không thể lệch nhau. Mỗi hàng trong bảng in chip điểm
  kèm lời giải thích trong `title`; bục 1-2-3 in hai chỉ báo phụ do **chính cách xếp
  khai** (`minis` trong `RANK_SORTS`) — bục chỉ đủ chỗ cho hai con số, và hai con số
  đáng đọc nhất là hai đầu vào của câu hỏi đang xem.

**5. Điểm phải có CỘT của nó (vòng 10).** Điểm từng chỉ là một chip nằm trong ô
tên người, nên khi bảng đang xếp theo điểm thì con số **quyết định thứ tự** không
có cột, và hàng tiêu đề không giải thích được vì sao các hàng nằm theo thứ tự đó.
Nay có `<th>Score</th>` kèm lời giải thích công thức trong `title`, mỗi hàng một ô
điểm, và hàng của chính người xem cũng in điểm (`.lb-me-pts`) — đó là con số trả
lời "vì sao tôi đứng ở đây".

Trên màn hình, mỗi cách xếp in ra **câu nói rõ luật đang chạy** (`.lb-rule`): thứ
tự nhảy khi đổi cách xếp mà không có câu nào giải thích là thứ tự trông như ngẫu
nhiên. Luật phụ của cách xếp theo điểm nói luôn một điều người xem cần biết để
không farm: **bài bị từ chối không tính gì** (khớp với `where r.status <> 'denied'`
của view `requester_ranking` và với `rankDemo()`).

### 2.8 Dải chế độ xem — thanh lọc không phải một hàng chip

Chủ dự án chỉ ra đúng ba chữ: **"phần hiện status xấu quá"**, và khi được hỏi nó
xấu ở đâu thì câu trả lời là **"nhìn AI"**. Đây là chỗ dễ mắc nhất của cả trang,
vì dải lọc là thứ được vẽ **bảy lần liên tiếp** trên cùng một hàng — mọi quyết
định trang trí ở đó bị nhân lên bảy lần.

Bốn thứ đã bị gỡ, kèm lý do (bản đầy đủ nằm ở khối *THANH LỌC — DẢI CHẾ ĐỘ XEM*
trong `src/index.css`):

| Thứ bị gỡ | Vì sao nó đọc ra "do máy sinh" |
|---|---|
| **Rãnh bo tròn** bao quanh dải chip | Hai lớp bo tròn lồng nhau (rãnh thuốc → chip thuốc). Lớp ngoài không mang thông tin nào; nó chỉ tồn tại để "cho giống một control" |
| **Chấm tròn màu** trước mỗi nhãn | Hàng chip có chấm màu là khuôn mẫu của mọi bảng điều khiển máy sinh |
| **Huy hiệu số** bo tròn | Lớp bo tròn thứ ba, cộng với chấm là thứ tư. Con số không cần một cái hộp |
| **Tô nền** cho mục đang chọn | Một viên thuốc phết màu nhạt là thứ ai cũng vẽ được |

Hình dáng mới, và điều nó mua được:

- Một mục = **vạch màu 3×15px + nhãn + số**. Vạch đọc ra "một chặng của dây
  chuyền", không ra "một đèn báo"; nó lấy đúng màu chấm trạng thái của hàng
  request (`STATUS_META` → biến `--c`), nên **màu ở đây vẫn là dữ liệu**, không
  phải trang trí.
- **Đang chọn = chữ trắng + vạch đầy màu + số mang màu của mục đó.** Không đổi
  độ đậm: chữ đậm lên làm cả hàng nhích một nhịp mỗi lần bấm, mà đã có ba tín
  hiệu khác rồi.
- **Số là số**: mono, `tabular-nums`, không nền. Số `0` lùi lại một nhịp
  (`.fnum.zero`) — mục không có gì thì không được nói to bằng mục đang có việc.
- **Ba nhóm, hai vạch ngăn** (dùng lại đúng lớp `.dot` của dòng meta, không
  dựng khuôn vạch thứ hai):
  `Queue · Up next · In progress · Done` — bốn **giai đoạn**, theo đúng thứ tự
  dây chuyền chạy; rồi `Newest · Top voted` — hai **cách nhìn** cả bảng; rồi
  `Following` — việc của riêng người đang xem. Bản cũ để `In progress` đứng
  **sau** `Top voted`: một trục khác chen vào giữa bốn giai đoạn của cùng một
  dây chuyền, và mắt không biết mình đang ở trục nào. Nhóm `Following` vắng mặt
  (chưa theo dõi bài nào) thì **vạch ngăn của nó cũng biến mất** — không để lại
  một vạch lẻ giữa hai mục.
- **Màu của hai cách nhìn** là `--a-2`, không phải `--a`: đây là những sắc độ
  dùng được cho chữ/icon trên nền tối, còn `--a` nguyên bản (hue 242) ở 40%
  opacity trên nền `#10141a` là một vạch gần như vô hình.

**PC và máy hẹp: cùng một hình dáng, khác nhịp.** Hình dáng trên không phụ thuộc
bề rộng, nhưng **nhịp** thì phải khác — chuột trỏ chính xác và màn rộng là hai
điều kiện khác hẳn ngón tay trên màn 390px:

| | PC (`≥900px` + `hover: hover`) | Thiết bị chạm (`pointer: coarse`) |
|---|---|---|
| Chiều cao mục | **32px** — 25px (đúng chiều cao chữ) trên màn 27" đọc ra như một dòng phụ, không như hàng điều khiển | **≥40px** — ngưỡng ngón tay, giữ nguyên pixel bản desktop về hình dáng |
| Rê chuột | Nền nhấc lên một nhịp đậm hơn (`--hover-2`) — đây là thao tác **chỉ có** trên PC | Không có hover; `@media (hover: none)` ở cuối tệp trả lại mọi thứ đọc được |
| Dải tràn | Hiện **thanh cuộn mảnh 5px** (chỉ khi thật sự tràn — cửa sổ 900–1010px là bề rộng duy nhất bảy mục không vừa một hàng) | Cuộn bằng ngón tay, có điểm dừng (`scroll-snap`) — thanh cuộn bị ẩn |
| Ô tìm kiếm | **Chặn 360px** + con số đếm đẩy về mép phải: để nó co giãn hết hàng thì trên màn 27" nó rộng ~1000px, và phím tắt `/` neo ở mép phải ô sẽ cách chỗ gõ gần một mét | Chiếm trọn một hàng (màn hẹp thì không có chỗ cho hai thứ cạnh nhau) |

Khối PC cố ý đặt **trước** khối thiết bị chạm trong `index.css`: một thiết bị lạ
(máy tính bảng cắm chuột) đôi khi khớp cả hai vế, và khi đó **vế chạm phải thắng**
— 40px cho ngón tay quan trọng hơn 32px cho chuột. Điều đó được chốt bằng một
phép kiểm so **thứ tự**, không phải bằng cảm nhận (xem `cssFilterBar.test.js`).

Hai phép kiểm giữ hình dáng này: `src/lib/cssFilterBar.test.js` chốt *không có*
nền/viền/bo góc trên dải, *không còn* luật `.fdot`, thứ tự bốn giai đoạn, vạch
ngăn theo nhóm, và **thứ tự khối PC/máy hẹp**; `npm run smoke` chốt trên DOM thật
(mỗi mục có vạch, **đúng một** mục đang chọn, số vạch ngăn khớp số nhóm đang hiện).

#### Hàng lọc loại bài — cùng ngôn ngữ, khác hình dấu (vòng 16)

Chủ dự án chỉ tiếp: **"chỗ lọc type quá AI"**. Hàng đó (`.fbar-more`) có một **lỗi
thật** đứng sau cảm giác đó:

> Bốn nút lọc mang `className="fchip kind"` — `kind` là lớp của **thẻ loại bài**
> trên từng hàng request, và thẻ đó khoá cứng `color: var(--k-ccl)`. Nên **cả bốn
> nút** (kể cả "All types") hiện đúng một màu tím CCL, bất kể `--c` của chúng;
> riêng nút đang chọn lấy `--c` cho **nền** — thành ra "Full Album" đang chọn có
> **chữ tím trên nền xanh teal**. Bốn thẻ khác nhau mà mắt thấy cùng một màu.

Dấu hiệu của lỗi này, ghi lại để lần sau nhận ra sớm: **một lớp CSS mang tên DỮ
LIỆU được dùng cho cả thứ hiển thị dữ liệu lẫn control để lọc dữ liệu đó.** Nay
mục lọc có lớp riêng `.fkind`.

Hình dáng mới — cùng ngôn ngữ với dải chế độ xem (chữ + dấu màu, không viền,
không nền, không bo tròn), nhưng **dấu đổi hình cho đúng loại dữ liệu**:

| | Dải chế độ xem | Hàng lọc loại bài |
|---|---|---|
| Dấu | **Vạch đứng 3×15px** — trạng thái là một *chặng* của dây chuyền | **Ô vuông 9×9px bo 2px** — loại bài là một *nhãn dán* trên hàng (`.kind` cũng bo góc) |
| Màu chữ khi chọn | **Trắng** — một màu trạng thái được nhiều mục chia nhau (`Queue` và `Up next` cùng `--queued`) | **Màu của chính loại đó** — màu loại bài là *danh tính của riêng một mục*, và tô chữ bằng đúng màu đó thì nối thẳng được với thẻ loại trên hàng request |
| "Không lọc gì" | (không có mục này — "Newest" là mặc định) | **Ô RỖNG viền mảnh** (`.kswatch.any`): đọc ra "chưa chọn màu nào", vẫn giữ đúng nhịp dấu ở đầu hàng |

Khác hình dấu còn để hai dải không lẫn vào nhau: chúng nằm hai hàng gần nhau và
hai bảng màu có vài sắc na ná (`--queued #8f94ff` với `--k-ccl #ab8fe0`,
`--done #4cba88` với `--k-album #4fb0ad`).

---

## 3. Chuyển động

Quy tắc gốc (Emil Kowalski, *frequency rule*): **thao tác càng lặp nhiều thì
chuyển động càng phải ít và càng phải nhanh.** Người dùng bấm vote 20 lần một
phiên; một hiệu ứng 300ms ở đó là 6 giây chờ trong một phiên.

### 3.1 Ba tầng easing — và tầng nào được dùng ở đâu

| Token | Curve | Dùng cho |
|---|---|---|
| `--e-out` | `cubic-bezier(.22,.61,.36,1)` | **Mọi thứ vào trang**, mọi thứ dịch chuyển. Không overshoot |
| `--e-soft` | `cubic-bezier(.4,0,.2,1)` | Đổi màu nền / viền / chữ. Đường thẳng, không gợn |
| `--e-pop` | `cubic-bezier(.34,1.24,.64,1)` | **Chỉ khoảnh khắc ăn mừng do người dùng tự gây ra**: bục xếp hạng, vòng quay thưởng, và cú tick vừa bật (0,34s — hộp nảy + vòng loang, xem `components/Check.jsx`) |

`--e-pop` từng được dùng cho công tắc, toast, nút điều hướng. Đó là chỗ sai:
ba chỗ còn lại đều là thứ **người dùng vừa tự tay gây ra** và chỉ xảy ra một lần
(bục xếp hạng khi công bố, vòng quay khi kim dừng, ô đánh dấu khi vừa tick), nên
overshoot ở đó là phản hồi — không phải trang tự biểu diễn. Một hộp đã tick sẵn
lúc mở bảng thì **đứng yên**: nhịp nảy gắn vào `onChange`, không gắn vào `:checked`.
Chỗ sai là:
overshoot trên một thao tác tiện ích đọc ra thành **đồ chơi**, không phải phản hồi.
Ngưỡng thời gian: `--t-1` 160ms (phản hồi con trỏ) · `--t-2` 280ms (khối nhỏ đổi
trạng thái) · `--t-3` 420ms (khối lớn, chuyển cảnh). Không có chuyển động nào
trên 420ms ngoài vòng quay thưởng.

### 3.2 Cái gì được chuyển động, cái gì không

**Được** — vì trả lời được câu "nó giúp người dùng hiểu điều gì vừa xảy ra?":

- Hàng trong danh sách vào so le khi tải xong (`rowIn`, 32ms/hàng, **chặn ở 10
  hàng**): nói rằng danh sách đã sẵn sàng, và mắt bám được vào hàng đầu.
- Ô sáng sidebar **trượt** sang mục mới: nói rằng vẫn đang ở trong cùng một hệ.
- Thanh tiến độ đổi bề rộng khi admin cập nhật: chính là dữ liệu.
- Nút lún xuống `scale(.97)` khi bấm: xác nhận cú bấm đã vào.
- Toast trượt vào khi có thông báo mới: nói rằng *vừa* có chuyện gì đó.
- **Kết quả vòng quay an vị**: số trúng nảy một nhịp, cung đậm chạy ngoài vành
  đúng lát trúng, 12 hạt bắn ra từ trục. Chạy **một lần** cho mỗi kết quả — đây
  là khoảnh khắc ăn mừng duy nhất của trang, và là lý do `--e-pop` còn tồn tại.
- **Ô đánh dấu** (thông báo, mốc tiến độ, ẩn/hiện media): dấu tick *vẽ ra* trong
  0,18 giây + hộp nảy nhẹ. Chỉ chạy khi **người dùng tự bấm** — hộp đã tick sẵn
  lúc mở bảng mà cũng nảy thì đó là trang tự biểu diễn, không phải phản hồi.

**Không** — đã xoá hẳn trong đợt rà này:

- Bốn ô thống kê nhấp nhô lệch 60ms một lần lúc mở trang (khối cha đã có
  `[data-reveal]` lo — hai lớp chuyển động cho cùng một thứ).
- Bốn mục sidebar trượt vào lệch 45ms: sidebar đứng yên suốt phiên.
- Nhấc / phóng to khi rê ở gần như mọi thứ (nút phụ, thumbnail, mục toast, nút
  "lên đầu trang"). Còn lại **đúng hai** thứ được nhấc: nút hành động chính và
  khung video chính. Chỗ nào cũng nhún thì không chỗ nào là chính.
- Nhấp nháy vô hạn ở đồng hồ "quá mốc": thay bằng đổi màu + một chấm tĩnh.
- Vệt sáng quét trên **mọi** thanh tiến độ: 12 bài đang làm là 12 vòng lặp vô
  hạn. Nay chỉ còn ở khối Up next, nơi luôn đúng một bài đang chạy, và chỉ khi
  thật sự có bài đang chạy (`nowbar.live`).
- Tiêu đề được "kéo ra" bằng `clip-path` mỗi lần đổi mục: **chữ là nội dung tĩnh**
  — mỗi lần bấm menu lại thấy nó được vẽ lại là tự giới thiệu, không phải phản hồi.

**Màn chờ (nhịp riêng, không nằm trong thang trên):** hiện **mỗi lần tải trang**,
sàn **560 ms** (dưới ngưỡng đó logo chỉ kịp nháy mắt) và trần **2,6 giây** (dữ
liệu chậm thì vẫn phải vào được nội dung). Không có cờ `sessionStorage` nào —
bản "một lần mỗi phiên tab" đã bị bỏ vì nó làm đúng thao tác người dùng hay làm
nhất (F5) lại không thấy gì cả.

### 3.3 Không animate thuộc tính layout

Bề rộng / chiều cao / `top` / `left` đổi giá trị là trình duyệt phải tính lại bố
cục. Ba chỗ đã sửa:

- Thanh âm lượng: `width 0 → 64px` khiến **chữ "Âm thanh" bên cạnh bị bóp rồi
  giãn** mỗi lần rê chuột vào. Nay thanh giữ nguyên 64px, chỉ đổi `opacity`.
- Ô sáng sidebar: bỏ `height` khỏi transition (mọi mục đều cao 36px — nó không
  bao giờ đổi, chỉ tốn một kênh theo dõi).
- ~~Vạch tiến độ cuộn: `transform: scaleX()`~~ — **đã gỡ hẳn (vòng 16)**. Nó
  từng là ví dụ đúng về kỹ thuật (compositor thay vì layout), nhưng kỹ thuật
  đúng không cứu được một thứ **trùng chức năng**: thanh cuộn của trình duyệt đã
  nói đúng con số đó, ở đúng chỗ người dùng tìm nó. Thêm nữa nó là gradient
  `--a → --a-2`, đúng cặp màu của thứ duy nhất được phép nổi bật — một vạch màu
  nhấn chạy ngang đỉnh màn hình suốt phiên làm màu nhấn mất nghĩa "chỗ này bấm
  được".

### 3.4 Người dùng tắt chuyển động

`src/index.css` có khối `@media (prefers-reduced-motion: reduce)` toàn cục:

```css
*, *::before, *::after {
  animation-duration: .001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .001ms !important;
}
```

Khối này **đã phủ mọi animation của trang** — vì vậy đừng thêm override cho từng
phần tử nữa (nhiều override rời rạc dễ quên hơn một luật chung). Hai khe hở thật
cần nhớ khi viết code mới:

1. `animation-delay` / `transition-delay` **không** bị vô hiệu. Phần tử vào trang
   bằng `animation: … both` + delay sẽ **đứng im ở trạng thái đầu (opacity 0)**
   suốt thời gian chờ. Nhịp so le trong trang này vì thế phải chặn số nhịp
   (`min(var(--i), 10)`), và mọi rule có delay cần tự khai báo `animation: none`
   trong khối reduce.
2. `backdrop-filter` không bị vô hiệu — nó không phải chuyển động. Ai không muốn
   kính thì có khối `@media (prefers-reduced-transparency: reduce)` riêng.

Ngoài ra `scroll-behavior: smooth` của app tự chuyển thành `auto` (xem
`src/components/Pager.jsx`, `MediaShowcase.jsx`) — không dùng CSS scroll-behavior.

---

## 4. Bóng, kính, và độ sâu

- Nền là **kính**: `--glass` / `--glass-sm` với ba mức độ đục (`--panel`,
  `--panel-2`, `--panel-3`) đã nâng lên .94/.92/.90 để chữ không "trôi" trên vệt
  gradient phía sau. Lớp nổi (modal, toast) đặc hơn: `--float`.
- **Một** mức mờ cho mọi khối liền nhau. Hai khối cạnh nhau lệch độ đục .72/.82 là
  nhìn ra ngay, mà lại chẳng ai gọi được tên cái đang sai.
- Bóng đổ nhẹ, dùng để tách khối khỏi nền; **bóng thay viền** ở những chỗ nền phía
  sau sáng thay đổi (ảnh bìa, avatar, thumbnail) vì viền 1px ở đó sẽ chìm.
- Quầng ultramarine sau khung video chính là **ngoại lệ duy nhất**: nó đánh dấu
  "đây là video chính" và chỉ có một khung như vậy trên trang.

---

## 5. Điện thoại

- **Ngưỡng chạm**: desktop giữ nguyên từng pixel (chuột trỏ chính xác), bản hẹp
  nới lên 40px cho control phụ và 44px cho điều hướng chính. Hợp đồng này được
  giữ bằng `src/lib/cssTapTarget.test.js` — **thêm một control nhỏ phải khai cả
  hai vế**, không thì test đỏ.
- **Mật độ**: 4 ô thống kê về một hàng (3+1 để lại một hàng thừa 60px, mà 60px đó
  chính là hàng request đầu tiên). Dải mục lục video bỏ tên, thu còn 96px — tên
  video đang mở đã nằm ngay trên khung.
- **Thanh lọc**: 6 tab kèm số đếm không vừa 390px, và `.tabs` có `overflow: hidden`
  nên **tab cuối bị cắt mất** — không có cách nào bấm tới. Nay dải tab cuộn ngang.
- **Thanh lọc trên máy hẹp** (chốt 19/09): dải chế độ xem cuộn ngang, dòng
  đếm nhường chỗ cho nút **Bộ lọc** kèm số điều kiện đang bật; khối lọc thứ hai
  (thẻ loại bài + dòng tổng kết) gấp lại cho tới khi bấm (`aria-expanded` +
  `aria-controls`). Trên thiết bị chạm (`@media (pointer: coarse)`) mỗi mục lọc
  cao ≥40px — bản desktop giữ nguyên pixel vì chuột trỏ chính xác.
- **Thanh lọc trên máy hẹp: mỗi hàng một việc** (vòng 10, tiếp). Hàng 1 là dải
  chế độ xem (xem §2.8) — **chiếm trọn bề rộng** và cuộn ngang có điểm dừng
  (`scroll-snap-type: x proximity`, mỗi mục một điểm dừng); hàng 2 là ô tìm kiếm
  + nút Bộ lọc. Bản trước để hai thứ đó chen nhau trên một hàng: dải co được
  tới 0 nên bị bóp còn vài chục pixel, người dùng chỉ thấy một mẩu cụt mà
  không hiểu vì sao. Phép kiểm `cssFilterBar.test.js` chốt cả hai vế (máy hẹp hai
  hàng, màn rộng một hàng).
- **Loại bài đang lọc phải NHÌN THẤY** (vòng 10, tiếp). Trên màn hẹp khối lọc gấp
  sau nút Bộ lọc, nên nếu không có gì khác thì không có chỗ nào nói ra là danh sách
  đang bị lọc theo loại bài — người dùng chỉ thấy danh sách thiếu bài. Nay có
  `.fchip.onkind` ở cuối dải chế độ xem, mang tên loại và bỏ được bằng một lần
  bấm. Nó vẫn là một **thẻ** (viền + nền cùng màu chữ) chứ không phải một mục chữ
  trần như các mục cạnh nó: một điều kiện đang bật phải đọc ra là *bỏ được*, và
  khuôn thẻ đó chính là khuôn mà thẻ loại bài mang trên từng hàng request. Từ
  621px trở lên nó bị ẩn vì khối lọc đã luôn hiện.
- Không có `hover` thật ⇒ khối `@media (hover: none)` trả lại mọi thứ đọc được
  khi rê chuột. Trạng thái "đang mở" luôn phải đọc được **mà không cần rê**.

---

### 5.1 Ô tìm kiếm — chừa chỗ theo bề rộng THẬT của thứ nằm đè

Ô tìm kiếm có hai thứ nằm đè lên nó: kính lúp bên trái, nút xoá bên phải. Khoảng
chừa của **cả hai** bên được tính từ bề rộng của chính chúng
(`calc(var(--ico-x) + var(--ico-w) + 4px)` và `calc(var(--x-x) + var(--x-w) + 4px)`)
— bản trước chỉ tính bên trái, còn bên phải là `26px` viết cứng, nên khi thiết bị
chạm nới nút xoá lên 30px thì chữ gõ vào vẫn chui được xuống dưới nút xoá. Luật
này áp cho **mọi** ô tìm kiếm (bảng công khai **và** bảng quản trị — chúng dùng
chung lớp `.search`). Hộp sáng viền lên khi đang gõ (`:focus-within`), và cả hai ô
đều có `aria-label` vì placeholder không phải là nhãn.

---

## 6. Chữ viết trong giao diện

Luật lấy từ taste-skill §9:

- Nhãn nút là **động từ + kết quả**, không phải danh từ chung: "Gửi yêu cầu",
  không phải "OK".
- Không `01 / 4`, không "phiên bản 2.0", không mũi tên chỉ dẫn cuộn, không chấm
  trạng thái trang trí, không dải ngày giờ/thời tiết. Người dùng không cần biết
  app đang ở phiên bản nào.
- Gạch ngang dài `—` và gạch ngang ngắn dùng như dấu phân cách: **không** dùng
  trong câu chữ do mình viết (dấu hiệu văn bản do máy sinh). Chỗ dùng còn lại là
  dấu nối *Tên bài — Nghệ sĩ*, một quy ước trình bày chứ không phải câu văn.
- Dấu phân cách giữa các nhóm trong dòng metadata là **vạch mảnh 1×9px** (`.dot`),
  không phải ký tự `·`. Một hàng request có 3-4 nhóm thông tin; mỗi nhóm cách nhau
  bằng dấu chấm giữa là đúng mẫu "lạm dụng dấu chấm giữa" của văn bản do máy sinh —
  vạch mảnh đọc ra thành *ranh giới*, dấu chấm đọc ra thành *dấu câu*.
  Ký tự đã bỏ hẳn khỏi JSX và mọi `.dot` đều `aria-hidden`, nên không còn gì để
  trình đọc màn hình đọc lên. Dấu `·` còn lại trong app chỉ ở những dòng **một**
  dấu (tiêu đề tab trình duyệt, một số dòng tiền/thời gian) — đúng ngưỡng cho phép.
- Số liệu phải **thật**. Không "1.000+ người dùng" khi con số lấy từ đâu không rõ.
- **Không `text-transform: uppercase`** — không ở nhãn lọc, không ở tiêu đề mục, không ở
  pill, không ở đầu bảng. Chữ in hoa toàn bộ đọc ra như một nhãn dán của máy và làm mất dấu
  tiếng Việt; muốn một nhãn nổi thì dùng **màu, đậm, và khoảng cách chữ** (đều đã có token),
  không dùng phím CapsLock. Trong toàn bộ `src/index.css` chỉ còn đúng một chỗ
  `text-transform` và nó là `none` (để reset một thành phần nhúng).

---

## 7. Những thứ đã cố ý KHÔNG làm

Ghi lại để lần sau không ai "sửa" ngược:

- **Không** thêm chế độ sáng. Nền tối là một phần nhận diện, và mọi bóng/kính đã
  được tính cho nền tối; thêm bản sáng là nhân đôi toàn bộ token mà không có ai
  yêu cầu.
- **Không** thêm bóng đổ/viền cho từng hàng danh sách (xem §1.3).
- **Không** thêm animation cho thao tác bàn phím (`/`, `n`, `Esc`): người dùng
  bàn phím muốn tốc độ, không muốn một màn trình diễn.
- **Không** vẽ 16 ô của vòng quay theo đúng thứ tự rút rồi in một số lên mỗi ô: chín ô `+1`
  sẽ thành chín số `1` giống hệt nhau rải quanh đĩa. Bản vẽ gom ô cùng thưởng thành **dải** và
  in số **một lần cho mỗi dải** kèm số ô (`+1 ×9`); luật rút và xác suất không đổi.
- **Không** đặt một bảng thông số dài trong modal mua vote: người dùng đang cân
  nhắc chi tiền, họ cần ba lựa chọn đọc được trong một lần liếc (xem `.pack`).
- **Không** đưa bảng quản trị trở lại thành hộp thoại. Nó là một **trang** ở
  `/admin` (mục trong sidebar, vào được bằng link, quay lại bằng nút của trình
  duyệt): quản trị là một việc người ta làm liên tục trong nhiều phút, và một
  hộp thoại vừa chặn phần còn lại của trang vừa mất hết trạng thái khi bấm ra
  ngoài. Đường dẫn riêng cũng là thứ duy nhất để gửi cho người khác.
- **Không** để bộ lọc của bảng quản trị sống trong state (vòng 10). Từ khoá, cách
  xếp và loại bài nằm ở **địa chỉ** (`/admin?tab=active&q=aespa&sort=votes&kind=Short`)
  — đọc bằng `readAdminView` (giá trị lạ rơi về mặc định, không làm trang trắng),
  ghi bằng `adminQuery` (chỉ ghi tham số **khác mặc định**, nên danh sách chưa lọc
  vẫn là `/admin`). Một mục đã lọc sẵn là thứ admin muốn đưa cho người khác và muốn
  giữ khi F5; để trong state thì mở thư viện khác là mất, dán link là người kia thấy
  danh sách trần.
- **Không** truyền màu vào thanh tiến độ từ chỗ gọi (vòng 10), và **không** để một
  nút hành động nằm trong nhánh tab mà nó không dùng được: nút Xuất CSV từng ở trong
  nhóm `tab !== 'orders'` nên mục Đơn hàng không xuất được dù hàm xuất đã có nhánh
  cột riêng, còn nút "Chọn nhiều" từng hiện ở mục Đơn hàng — nơi không vẽ ô chọn nào,
  bật lên chỉ để bấm vào chỗ không có gì. Cùng loại lỗi: một tính năng **chỉ tồn tại
  trong ghi chú** (`Ctrl/Cmd+A` chọn cả trang) — nay ghi chú nào hứa thì thân hàm
  phải có.
- **Không** chặn việc gửi một bài đã có trên bảng. Form chỉ *báo* (`findDuplicate`)
  rồi mời đi vote cho bài đó; người gửi vẫn toàn quyền gửi tiếp. Chặn là quyết định
  thay người dùng ở chỗ mình không có đủ thông tin (bài cũ có thể đã bị từ chối, hoặc
  họ muốn một bản khác).
- **Không** dựng lại rãnh/chip cho dải chế độ xem (vòng 15, xem §2.8) và **không**
  thêm "vạch trượt" chạy theo mục đang chọn. Vạch trượt là một chuyển động trang
  trí đứng trên một control được bấm **nhiều lần mỗi phiên** — đúng chỗ cổng tần
  suất (§3) cấm; trạng thái đang chọn ở đây đọc được ngay mà không cần chuyển động
  nào.
- **Không** dựng lại vạch tiến độ cuộn ở đỉnh trang (vòng 16, xem §3.3). Nếu có
  người muốn "cho vui mắt" thì câu trả lời nằm ở §0: người dùng vào đây để **đọc
  và bấm vote**, không phải để ngắm một vạch chạy. Chưa kể nó là thứ lấy màu
  nhấn — màu dành cho "chỗ này bấm được".
- **Không** dùng lại lớp `.kind` (thẻ loại bài trên hàng request) cho các **mục
  lọc** loại bài (vòng 16, xem §2.8). Hai thứ khác nhau về bản chất: một cái *nói*
  loại của dòng, một cái *lọc* theo loại — và vì `.kind` khoá cứng `color:
  var(--k-ccl)`, dùng chung lớp làm cả bốn nút lọc cùng hiện một màu tím.

---

## 8. Kiểm tra trước khi ship một thay đổi giao diện

- [ ] Token mới đã khai trong `:root` **và** có mặt trong CSS thật
      (`src/lib/cssTokens.test.js` sẽ đỏ nếu không).
- [ ] Control nhỏ trên desktop đã có vế nới rộng ở bản hẹp (`src/lib/cssTapTarget.test.js`).
- [ ] Chuyển động mới trả lời được "nó giúp hiểu điều gì vừa xảy ra?" — nếu câu
      trả lời là "nhìn cho vui" thì bỏ.
- [ ] Chuyển động mới không animate `width`/`height`/`top`/`left`/`margin`.
- [ ] Có đường thoát cho `prefers-reduced-motion` (nhớ `animation-delay`).
- [ ] Bản hẹp 390px: không có mục nào bị `overflow` cắt mất mà không cuộn tới được.
- [ ] Chuỗi mới đã vào `src/lib/i18n.jsx` (`src/lib/i18nKeys.test.js` sẽ đỏ nếu thiếu).
- [ ] Đổi giao diện thì cập nhật `HUONG-DAN.md` (mục "Chuyển động" / "Bố cục trang").
- [ ] Chuỗi mới không dùng gạch ngang dài, không mở đầu bằng "Quietly…", không nhãn
      phiên bản — xem §6.
- [ ] Nếu thêm một thứ "nhớ trạng thái" cho người dùng: nêu rõ **thứ tự ưu tiên**
      (URL → đã lưu → mặc định) và **cái gì KHÔNG nhớ** — xem §7.1.
- [ ] Mọi con số tiến độ đi qua `components/Progress.jsx`
      (`src/components/Progress.test.js` đỏ nếu ai dựng lại `.bar` bằng tay).
- [ ] Màu nhấn vẫn dưới ~10% diện tích một khung nhìn: thêm một khối nền màu
      nhấn nữa thì phải bỏ một khối cũ.
- [ ] Thêm một nhãn mới? Nó phải là `.pill`/`.kind` theo khuôn ở §2.6, và mọi cụm
      từ hai nhãn trở lên phải nằm trong `.tags` (`src/lib/cssFilterBar.test.js`
      đỏ nếu nhãn mất `nowrap`/`flex: none`).
- [ ] Màn hình mới là **trang** hay **hộp thoại**? Bảng quản trị là trang ở
      `/admin` (§7 cấm quay lại popup) — `src/components/AdminPanel.test.js` dựng
      thật cả năm mục và đỏ nếu có lớp modal quay lại.
- [ ] Trang mới có nhiều mục con? Mục đang mở phải nằm ở **địa chỉ**
      (`/admin?tab=…`, xem `src/lib/adminTabs.js`), không chỉ ở state: F5, nút
      Back và việc dán link cho người khác đều dựa vào đó.
- [ ] Có thêm nút tải dữ liệu ra? Dùng `src/lib/csv.js` (bọc ô theo RFC 4180 +
      BOM cho Excel) và xuất **đúng những gì đang nhìn**, không phải cả bảng.
- [ ] Thêm một ô tìm kiếm mới? Nó phải nằm trong `.searchwrap` và **chừa chỗ cho
      cả hai thứ nằm đè, theo bề rộng thật của chúng**
      (`calc(var(--ico-x) + var(--ico-w) + 4px)` và `calc(var(--x-x) + var(--x-w) + 4px)`)
      — luật cũ chỉ áp cho `.fbar .search`, nên ô tìm trong bảng quản trị có chữ nằm
      dưới kính lúp, còn nút xoá trên thiết bị chạm thì đè lên chữ.
      `src/lib/cssFilterBar.test.js` đỏ nếu mất `calc(`.
- [ ] Thêm một con số "tổng quan" mới (số liệu, tỉ lệ, nguồn)? Nó phải đi kèm **một
      vạch chia tỉ lệ** nếu tỉ lệ là điều người xem cần — `.adm-mix` (năm mục việc)
      và `.vm-mix` (ba nguồn phiếu) là hai ví dụ: cùng dữ liệu, khác câu hỏi, 4–5px.
- [ ] Thêm nút/hành động vào một mục của bảng quản trị? Kiểm nó có dùng được ở
      **chính mục đó** không (nút xuất CSV từng không có ở mục Đơn hàng), và nếu nó
      chỉ có nghĩa với một số mục thì nằm trong nhánh của các mục đó.
- [ ] Thêm một nhãn vào chỗ mới? Cụm từ hai nhãn trở lên phải nằm trong `.tags`, và
      nhãn phải kẹp được theo hộp cha — `src/lib/tagLayout.test.js` quét toàn bộ JSX.
- [ ] Thêm thứ "nhớ giúp" người dùng (nháp, bộ lọc, mục đang mở)? Phải có **đường
      thoát**: nháp request tự xoá sau khi gửi và sau 7 ngày, có nút Bỏ nháp dọn form
      (`src/components/ActionModal.jsx`); trạng thái nào đáng dán cho người khác thì
      phải nằm ở **địa chỉ**, không chỉ trong state.
- [ ] Trước khi báo xong: chạy **`npm run smoke`** (dựng thật cả app, ~19 giây) —
      nó bắt được loại lỗi mà bài kiểm tĩnh không thấy, và in ra mọi thứ rơi ra console.
- [ ] Đụng vào thứ tự bảng xếp hạng thì luật phải sửa ở `src/lib/ranking.js` và
      `src/lib/ranking.test.js` phải xanh — không sắp bằng `||` trong component
      (xem §2.7).
