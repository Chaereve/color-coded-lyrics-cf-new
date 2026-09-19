import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   THEO DÕI — cái chuông ở CUỐI dòng meta của một hàng / một cụm bài
   ---------------------------------------------------------
   Không có logic ở đây: bấm xong App gọi toggleWatched() trong
   lib/watch.js. Đặt `aria-pressed` vì đây là công tắc tắt/bật, không
   phải nút điều hướng, để trình đọc màn hình nói đúng trạng thái.

   Component chỉ lo ba thứ: không tự khai kích thước (hộp 18px, ẩn khi hàng
   tĩnh, hiện khi rê/focus, chấm accent khi đang bật — tất cả ở khối
   `.rowact` + `.followbtn` trong `index.css`), `stopPropagation` vì nó nằm NGAY TRONG dòng
   mà người dùng bấm được, và `title` + `aria-label` — affordance ẩn thì chữ
   giải thích phải nằm ở tooltip, không thì người dùng không bao giờ biết nó có
   ở đó để mà rê vào.

   Không còn prop "ẩn": hàng bên trong cụm KHÔNG đặt chuông (theo dõi là chuyện
   của cả bài, chuông ở đầu cụm đã nói hết), nên cũng chẳng cần ô giữ chỗ cho
   thẳng cột nữa — bỏ được một kiểu CSS và một biến thể vô nghĩa.
   ========================================================= */

export default function FollowBtn({ on = false, onToggle }) {
  const { t } = useI18n()
  return (
    <button type="button" className={`rowact followbtn${on ? ' on' : ''}`}
      aria-pressed={on} title={on ? t('row.unfollow') : t('row.follow')}
      aria-label={on ? t('row.unfollow') : t('row.follow')}
      onClick={(e) => { e.stopPropagation(); onToggle?.() }}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.3 19a2 2 0 0 0 3.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </button>
  )
}
