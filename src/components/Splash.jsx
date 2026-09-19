import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   MÀN HÌNH CHỜ
   ---------------------------------------------------------
   Logo được một vệt sáng quét ngang qua (shimmer) — cái duy nhất động
   ở khối này; chữ hiệu cũng chạy ánh kim cùng nhịp. Hết `hide` là tan ra
   chứ không tắt phụt.

   Hiện MỖI LẦN tải trang (quyết định 19/09 của chủ dự án): nhịp khởi động
   của app, không phải hộp thoại chào mừng. Vì vậy nhịp vào phải khép trong
   khoảng 0,5s — xem biến thời gian trong `index.css` (khối `.splash`).

   Trợ năng: đây là trạng thái "đang tải", nên nó là MỘT vùng `role="status"`
   đọc câu `splash.label`; toàn bộ phần hình (logo, chữ hiệu, thanh tải) bị
   `aria-hidden` — trình đọc màn hình không phải nghe "Chaereve, Request Page"
   mỗi lần tải lại trang.
   ========================================================= */
/* `hide` có mặc định: chỗ gọi lúc boot chỉ cần <Splash /> (màn chờ đang hiện),
   còn hai nhánh sau khi boot truyền <Splash hide /> để nó tan ra. */
export default function Splash({ hide = false }) {
  const { t } = useI18n()
  return (
    <div className={`splash${hide ? ' hide' : ''}`} role="status" aria-live="polite">
      <span className="sr-only">{t('splash.label')}</span>
      <span className="splash-mark" aria-hidden="true">
        <span className="applogo lg-splash">
          <img src="/logo-192.png" alt="" width="78" height="78" />
        </span>
      </span>
      <div className="splash-title" aria-hidden="true">Chaereve</div>
      <div className="splash-sub" aria-hidden="true">{t('side.tagline')}</div>
      <div className="splash-bar" aria-hidden="true"><i /></div>
    </div>
  )
}
