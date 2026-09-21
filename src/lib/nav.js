import { createContext, useContext } from 'react'

/* =========================================================
   ĐI LẠI TRONG APP — một cửa cho mọi link nội bộ
   ---------------------------------------------------------
   Ba loại link trong app trỏ vào chính app: tên người gửi trên mỗi hàng,
   tên tác giả một bình luận, và một bài trong "This week" / trang cá nhân.
   Bản đầu của cả ba tự gọi `window.history.pushState(...)` ngay trong
   `onClick`, rồi tự phát `popstate` để App đọc lại địa chỉ. Hai chỗ hỏng:

     · `pushState` NÉM `SecurityError` trong iframe bị sandbox (bản xem trước
       của nền tảng chạy đúng như vậy), trên `file://`, và trong chế độ riêng
       tư của vài trình duyệt. `preventDefault()` đã chạy trước đó, nên kết quả
       là một cú bấm KHÔNG LÀM GÌ CẢ — không đi trong app, cũng không đi thật.
       Repo đã có `lib/history.js` sinh ra để chặn đúng lỗi này; ba chỗ kia
       chỉ là không đi qua cửa đó.
     · App đọc "trang cá nhân đang mở" từ `window.location` LÚC RENDER. Địa
       chỉ là thứ phụ (xem history.js): khi nó không ghi được thì không có gì
       đổi, và React cũng không render lại nếu mọi setState trong handler đều
       trùng giá trị — tức là link chết cả khi `pushState` chạy được.

   Nay đường đi là: state trong App đổi trước (nguồn sự thật), địa chỉ ghi sau
   qua `pushUrl` (bản sao, không bao giờ ném). Ba hàm đó được đưa xuống cây
   bằng context này — cùng kiểu với `useI18n` / `useNotify`, để không phải
   khoan prop qua `RequestGroup` → `RequestRow` → `.meta`.
   ========================================================= */

const NavCtx = createContext(null)

export const NavProvider = NavCtx.Provider

/* KHÁC `useNotify` (ném khi thiếu provider) là có lý do: nav là thứ tuỳ chọn.
   Component dựng ngoài App — một bài kiểm dựng rời `Comments`, một khối đem
   dùng ở trang khác — vẫn còn `href` thật trên thẻ, nên không đi trong app
   được thì trình duyệt đi thật (một lần tải trang), vẫn tới đúng nơi. Trả về
   bộ rỗng để `spaLink` dưới đây tự nhả ra, thay vì ném và làm mất cả khối. */
const NO_NAV = { openProfile: null, openSong: null, closeProfile: null }

export function useNav() {
  return useContext(NavCtx) || NO_NAV
}

/* onClick cho một link nội bộ. Trả về `undefined` khi không có đường đi trong
   app — để React KHÔNG gắn handler, và cú bấm đi theo href thật.
   `arg` là tham số duy nhất của hàm (`id` người dùng, hoặc cả hàng request):
   đủ cho cả ba loại link, và giữ handler ngắn đúng một dòng ở chỗ dựng. */
export function spaLink(fn, arg) {
  if (typeof fn !== 'function') return undefined
  return (e) => {
    if (!e || e.defaultPrevented) return
    /* Bấm giữa / bấm kèm phím bổ trợ là người dùng muốn mở tab mới — cướp
       thao tác đó là phá một thứ họ đang trông đợi. */
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    /* Link người gửi nằm TRONG hàng request, mà hàng thì bấm để mở cụm: không
       chặn nổi là một cú bấm vừa mở trang cá nhân vừa gấp/mở cụm. */
    if (typeof e.stopPropagation === 'function') e.stopPropagation()
    fn(arg)
  }
}
