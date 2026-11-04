/* Một nguồn sự thật cho nhóm trình duyệt bản build phải chạy được.
   ---------------------------------------------------------------
   Vite 8 mặc định là "baseline-widely-available" (Safari 16.4 / iOS 16.4
   / Chrome 111 / Firefox 114). Mức đó bỏ rơi iPhone 6s/7/8/X còn kẹt ở
   iOS 13–16.3 và nhiều Android WebView: bundle nạp không nổi, React
   không chạy, người dùng chỉ thấy màu nền ("màn hình tím").

   Nhóm dưới đây là mức sàn đã chốt cho bản build. `vite.config.js` dùng
   nó làm build.target; `tools/check-browser-compat.mjs` dùng cùng danh
   sách để chặn regression. Đổi một chỗ, không đổi hai nơi lệch nhau.

   Lưu ý: hạ target chỉ DỊCH CÚ PHÁP. API mới mà app/thư viện gọi vẫn
   phải có polyfill (src/lib/polyfills.js) hoặc guard sẵn trong source.
   Danh sách API cấm trong check-browser-compat.mjs là những thứ chưa
   được polyfill/guard — thêm tính năng mới phải qua cửa đó. */
export const BROWSER_TARGETS = Object.freeze([
  'chrome80',
  'edge80',
  'firefox78',
  'safari13',
  'ios13',
])
