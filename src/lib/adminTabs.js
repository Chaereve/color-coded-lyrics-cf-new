/* =========================================================
   NĂM MỤC CỦA TRANG QUẢN TRỊ — và địa chỉ của từng mục
   ---------------------------------------------------------
   Danh sách này nằm ở một chỗ vì có BA nơi cần biết nó: dải số liệu của trang
   (mục nào đang mở), App (địa chỉ `/admin?tab=…`), và phép kiểm địa chỉ lúc
   tải trang. Để mỗi nơi tự viết lại mảng là mở đường cho một mục mới xuất hiện
   ở hai nơi và biến mất ở nơi thứ ba.
   Thứ tự trong mảng là thứ tự trên màn hình: việc gấp nhất đứng trước.
   ========================================================= */

export const ADMIN_TABS = ['pending', 'active', 'orders', 'done', 'media']

/* Đọc mục đang mở từ địa chỉ. Chỉ nhận giá trị có thật — một `?tab=abc` gõ tay
   phải rơi về mục đầu chứ không được làm trang trắng. */
export function readAdminTab(search) {
  const p = new URLSearchParams(search || '')
  const k = p.get('tab')
  return ADMIN_TABS.includes(k) ? k : null
}

/* Địa chỉ của một mục. Mục đầu (Chờ duyệt) dùng địa chỉ trần `/admin` — địa chỉ
   ngắn nhất là địa chỉ của việc chính, không phải của một tham số thừa. */
export function adminTabPath(base, k) {
  return k && k !== ADMIN_TABS[0] ? `${base}?tab=${encodeURIComponent(k)}` : base
}
