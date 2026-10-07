/* CHỈ LƯỢT NẠP MỚI NHẤT ĐƯỢC GHI VÀO STATE
   ---------------------------------------------------------
   Các hàm nạp dữ liệu trong `App.jsx` chạy SONG SONG và có thể CHỒNG NHAU: một
   sự kiện realtime mở lượt nạp thứ hai trong khi lượt thứ nhất còn đang bay.
   Không ai bảo đảm chúng trả về theo thứ tự đã gọi — lượt cũ (dữ liệu cũ) về
   sau lượt mới là chuyện bình thường trên mạng chậm, và lúc đó nó GHI ĐÈ số
   liệu mới: vừa bỏ một phiếu, bảng vừa nhảy lên, rồi tự nhảy về như trước.

   Luật ở đây chỉ một câu: mỗi lượt nạp xin một SỐ, và chỉ lượt giữ số mới nhất
   mới được ghi. Lượt cũ về sau thì bị bỏ qua — dữ liệu của nó đã cũ hơn dữ
   liệu đang có trên màn hình.

   Vì sao không dùng `AbortController`: các hàm này phần lớn là truy vấn
   Supabase dùng chung với đường realtime (huỷ một lượt là huỷ luôn lượt mà
   đường khác đang chờ), và bỏ-qua-khi-ghi là đúng thứ cần — không phải huỷ
   giữa đường. Một biến đếm là đủ, và đọc ra được ngay.
   ========================================================= */

/** Một bộ đếm lượt nạp. `ref` là `useRef(0)` của component. */
export const nextTicket = (ref) => ++ref.current

/** Lượt `ticket` còn là mới nhất không? Chỉ khi có thì mới được ghi state. */
export const stillLatest = (ref, ticket) => ticket === ref.current
