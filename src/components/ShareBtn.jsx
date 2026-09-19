import { useI18n } from '../lib/i18n.jsx'
import Icon from './Icon'

/* =========================================================
   CHIA SẺ MỘT BÀI — nút mảnh ở cuối dòng meta, cạnh chuông theo dõi
   ---------------------------------------------------------
   Vì sao có: vote là thứ duy nhất đưa một bài lên Up next, mà người muốn bài
   của mình lên thì không có cách nào rủ ai bỏ phiếu — họ phải tự chụp màn hình
   hoặc tự gõ lại tên bài cho bạn bè. Một nút copy link là đủ để biến người
   *gửi* request thành người *đi vận động* cho nó, và đây là vòng tăng trưởng
   duy nhất của sản phẩm này mà không cần thêm dịch vụ nào.

   Link không phải link YouTube mà link về CHÍNH bảng: `?f=top&q=<tên bài>` mở
   đúng bài đó trong tab Top voted, để người nhận bấm một cái là vote được ngay
   thay vì phải đi tìm. Bộ lọc đã nằm trên URL từ trước nên không tốn gì.

   Hành vi chia theo nền tảng, do App quyết (xem `shareSong`):
   điện thoại có hộp chia sẻ hệ thống thì mở hộp đó, còn lại thì copy + toast.
   Ở đây chỉ có hình và chữ.

   Đặt cạnh `.followbtn` và dùng CHUNG kiểu `.rowact`: 18px, ẩn tới khi rê vào
   hàng — hai nút cùng cỡ, cùng độ mờ, cùng chỗ. Một nút đậm hơn nút kia ở
   cùng một vị trí là cách nhanh nhất để hàng trông lệch.
   ========================================================= */
export default function ShareBtn({ onShare }) {
  const { t } = useI18n()
  const text = t('row.share')
  return (
    <button type="button" className="rowact sharebtn" title={text} aria-label={text}
      onClick={(e) => { e.stopPropagation(); onShare?.() }}>
      <Icon name="share" size={15} />
    </button>
  )
}
