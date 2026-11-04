/* =========================================================
   POLYFILL TỐI THIỂU CHO TRÌNH DUYỆT CŨ
   ---------------------------------------------------------
   Vì sao tệp này tồn tại: Vite 8 mặc định build cho nhóm
   "baseline-widely-available" (Safari 16.4 / iOS 16.4 / Chrome 111
   / Firefox 114). Người dùng iPhone còn kẹt ở iOS 13–16.3 (iPhone
   6s/7/8/X không lên được 16.4) hoặc Android WebView cũ nhận về một
   bundle mà trình duyệt KHÔNG ĐỌC NỔI → React không chạy → màn hình
   chỉ còn màu nền (người dùng mô tả là "màn hình tím"). Đây đúng là
   ca "trang không load" được một người dùng báo lại.

   `build.target` trong vite.config.js đã hạ xuống để esbuild DỊCH cú
   pháp mới (??=, ||=, optional chaining…) về dạng máy cũ đọc được.
   Nhưng dịch cú pháp KHÔNG tự thêm API: vài hàm app gọi là API mới
   (Object.hasOwn, Array.at, crypto.randomUUID — đều tới Safari 15.4).
   Tệp này bổ sung đúng những API đó, CHỈ khi trình duyệt thiếu, và
   KHÔNG kéo cả thư viện core-js nặng vào bundle.

   Quy tắc:
     · Chỉ định nghĩa khi thiếu (`if (!...)`) — máy mới giữ nguyên bản
       gốc, không bị ghi đè bằng bản chậm hơn.
     · Dùng Object.defineProperty để thuộc tính KHÔNG enumerable —
       không lọt vào vòng `for...in` của code khác (gây lỗi khó tìm).
     · Không ném lỗi khi môi trường khoá thuộc tính (try/catch) — một
       polyfill hỏng không được phép thành lỗi mới chặn cả trang.

   Phải được import ĐẦU TIÊN trong main.jsx, trước cả react, để mọi
   mô-đun sau đó thấy API đã có sẵn. Các hàm cài đặt được export để
   polyfills.test.js kiểm thẳng logic (Node đã có sẵn API gốc nên không
   thể kiểm bằng cách "gọi thử trên máy thiếu" — phải gọi thẳng hàm).
   ========================================================= */

/* Mã revision của lớp tương thích. Hai việc dùng thật:
     · main.jsx in kèm mỗi dòng lỗi `[ccl …]` — đọc console/ảnh chụp màn
       hình của người dùng là biết máy họ đang chạy bản nào, đúng câu hỏi
       đầu tiên khi có người báo "trang không load";
     · là dấu vết khai trong .github/edge-bundle-markers.txt để CI đối
       chiếu bundle ĐANG PHỤC VỤ ngoài edge, chứng minh bản sửa đã lên CDN
       chứ không chỉ "deploy đã chạy xong".
   Đổi ngày khi sửa lớp polyfill/target, rồi thêm dòng mới vào tệp dấu vết
   (không xoá dòng cũ — xem quy tắc trong chính tệp đó). */
export const COMPAT_REV = 'compat-20261104'

/* Object.hasOwn(obj, key) — Safari 15.4+, Chrome 93+.
   app dùng trong dailyLoginCalendar / mysteryBox / funnelSummary để
   kiểm khoá payload máy chủ trả về. Bản thay thế dùng hasOwnProperty
   gốc (có từ ES3), gọi qua .call để an toàn với object tạo bằng
   Object.create(null) (không có method thừa kế). */
export const hasOwnPolyfill = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

/* Array.prototype.at / String.prototype.at — Safari 15.4+.
   app dùng `sorted.at(-1)` trong checkInCalendar.js. Bản thay thế bám
   spec: chỉ số âm đếm từ cuối, ngoài khoảng trả undefined. Một hàm
   dùng chung cho cả mảng lẫn chuỗi (đều là array-like có .length). */
export const atPolyfill = function at(n) {
  const o = Object(this)
  /* ToLength của spec: NaN/âm → 0, trần là 2^53-1. Không dùng thẳng
     `Math.trunc(length) || 0` vì array-like lạ có length âm sẽ lọt. */
  let len = Math.trunc(o.length)
  if (!Number.isFinite(len) || len < 0) len = 0
  else if (len > 9007199254740991) len = 9007199254740991
  let k = Math.trunc(n) || 0
  if (k < 0) k += len
  if (k < 0 || k >= len) return undefined
  return o[k]
}

/* crypto.randomUUID() — Safari 15.4+, và CHỈ có trong secure context.
   app dùng khi tạo request/order ở demo mode (db.js) và khi giữ chỗ
   lượt quay (spinDevice.js). Máy cũ thiếu nó thì các thao tác đó ném
   TypeError. Bản thay thế dựng UUID v4 từ crypto.getRandomValues (có
   mặt ở mọi trình duyệt hiện đại), đúng định dạng 8-4-4-4-12 và đúng
   bit version/variant. Cùng nguồn ngẫu nhiên của trình duyệt, không
   yếu hơn bản gốc. */
export const randomUUIDPolyfill = () => {
  const b = new Uint8Array(16)
  globalThis.crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40   // version 4
  b[8] = (b[8] & 0x3f) | 0x80   // variant 10xx
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
}

/* ---- Áp dụng có điều kiện: chỉ khi trình duyệt thiếu ---- */
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: hasOwnPolyfill, writable: true, configurable: true, enumerable: false,
  })
}
if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: atPolyfill, writable: true, configurable: true, enumerable: false,
  })
}
if (typeof String.prototype.at !== 'function') {
  Object.defineProperty(String.prototype, 'at', {
    value: atPolyfill, writable: true, configurable: true, enumerable: false,
  })
}
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID !== 'function') {
  try {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: randomUUIDPolyfill, writable: true, configurable: true, enumerable: false,
    })
  } catch { /* thuộc tính bị khoá: bỏ qua, không để polyfill thành lỗi mới */ }
}
