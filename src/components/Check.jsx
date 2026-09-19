/* Ô ĐÁNH DẤU — dựng lại theo element `catraco/plastic-moth-91` trên uiverse.io
   ---------------------------------------------------------------------------
   Element gốc làm đúng ba việc, và cả ba đều đáng bê về đây:

     1. `<input type="checkbox">` THẬT vẫn nằm trong DOM, chỉ bị làm cho trong
        suốt — bàn phím, trình đọc màn hình, `:checked ~`, mọi thứ chạy như cũ;
     2. phần HÌNH do SVG vẽ, nên nó theo được bảng màu của trang;
     3. lúc tick thì có một nhịp ngắn "ăn mừng" (hộp nảy + vòng loang ra).

   Vì sao đổi khỏi checkbox của hệ điều hành: `accent-color` chỉ với tới phần
   tô, còn dấu tick, bán kính bo và độ dày nét là do trình duyệt vẽ — mỗi máy
   một khác, và hộp tick là thứ duy nhất trên trang còn không dùng nét mảnh
   1.4px với màu nhấn của khu vực. Bản này lấy `--chk` do nơi đặt quy định
   (`.nt-pref` = tím, `.step` = xanh lá, `.switch` = vàng), nên bốn họ checkbox
   của trang vẫn giữ đúng màu trạng thái của mình — xem index.css.

   Nhịp "ăn mừng" chỉ bật khi NGƯỜI DÙNG bấm: một hộp đã tick sẵn lúc mở bảng
   không được nảy lên (animation gắn cứng vào `:checked` sẽ làm đúng cái đó mỗi
   lần React dựng lại). Vì vậy `pop` là state cục bộ, đặt trong `onChange`, và
   tự tắt sau một nhịp. `prefers-reduced-motion` đã bị chặn chung ở cuối
   index.css nên không cần nhánh riêng ở đây.
   ========================================================= */
import { useEffect, useState } from 'react'

export default function Check({ checked, onChange }) {
  const [pop, setPop] = useState(false)
  useEffect(() => {
    if (!pop) return
    const id = setTimeout(() => setPop(false), 380)
    return () => clearTimeout(id)
  }, [pop])
  return (
    <span className="chk">
      <input type="checkbox" checked={checked}
        onChange={(e) => { if (e.target.checked) setPop(true); onChange(e) }} />
      <svg className={`chk-box${pop ? ' is-pop' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
        <rect className="chk-ring" x="1" y="1" width="14" height="14" rx="4.4" />
        <rect className="chk-bd" x="1" y="1" width="14" height="14" rx="4.4" />
        <path className="chk-tick" d="M4.9 8.3 6.9 10.3 11.2 5.7" />
      </svg>
    </span>
  )
}
