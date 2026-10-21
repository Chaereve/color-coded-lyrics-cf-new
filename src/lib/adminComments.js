/* =========================================================
   BÌNH LUẬN TRONG TRANG QUẢN TRỊ — LỌC VÀ PHÂN TRANG
   ---------------------------------------------------------
   Trước đây mục Bình luận đọc đúng 100 dòng mới nhất rồi vẽ hết:
     · quá 100 bình luận thì phần còn lại BIẾN MẤT mà không nói gì;
     · không có ô tìm, muốn soát một bài phải cuộn mắt qua cả danh sách;
     · không có phân trang nên trang dài vô hạn.
   Nay phần đọc đi qua RPC `admin_comments_page` (lọc + đếm + cắt trang ở
   phía database), còn tệp này là bản thuần của CÙNG luật đó cho chế độ demo
   (localStorage) và cho đường lui khi migration chưa chạy.

   Hai bên phải trả lời giống nhau: cùng một từ khoá, cùng một trang. Vì vậy
   phép so từ khoá dùng lại `allTermsIn` của bảng công khai — bỏ dấu, so từng
   từ — thay vì một `includes` riêng ở đây.
   ========================================================= */
import { allTermsIn } from './board.js'

export const ADMIN_COMMENTS_PER_PAGE = 20

/* Chuỗi để dò: đúng những gì người soát bình luận nhìn thấy trên thẻ — nội
   dung, người viết, và bài mà bình luận nói tới. Không dò id hay user_id:
   đó là thứ admin không gõ vào ô tìm. */
export const commentHaystack = (c) =>
  `${c?.body || ''} ${c?.author || ''} ${c?.songTitle || ''} ${c?.songArtist || ''}`

export const matchAdminComment = (c, q) => allTermsIn(commentHaystack(c), q)

/* Cắt một trang từ danh sách ĐÃ lọc. `page` bị kẹp trong khoảng có thật —
   đang ở trang 5 mà bộ lọc còn 1 trang thì phải rơi về trang 1, không được
   trả về một trang trắng (cùng luật với `usePager`). */
export function pageAdminComments(items = [], { q = '', page = 1, perPage = ADMIN_COMMENTS_PER_PAGE } = {}) {
  const hit = (items || []).filter(c => matchAdminComment(c, q))
  const total = hit.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages)
  const start = (current - 1) * perPage
  const rows = hit.slice(start, start + perPage)
  return {
    rows, total, pages, page: current, perPage,
    from: total === 0 ? 0 : start + 1,
    to: start + rows.length,
  }
}
