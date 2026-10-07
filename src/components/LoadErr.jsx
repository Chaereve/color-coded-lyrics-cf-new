import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   KHỐI "KHÔNG TẢI ĐƯỢC" — DÙNG CHUNG CHO MỌI VÙNG
   ---------------------------------------------------------
   Trước đây khối này nằm trong App.jsx và chỉ chữ của BẢNG là có sẵn
   (`board.loadErr` = "Could not load the board"), nên ba vùng khác —
   dải video, trang cá nhân công khai, bảng xếp hạng — không dùng được:
   chúng rơi vào nhánh RỖNG và nói "chưa có gì" trong khi sự thật là
   "không tải được". Hai câu đó khác nhau với người đọc, và câu sai thì
   không có nút nào để bấm.

   Ba khoá chữ vì thế thành tham số, mặc định giữ NGUYÊN câu của bảng
   (mọi chỗ gọi cũ không phải đổi gì): vùng nào muốn câu chung thì truyền
   `load.err` / `load.errHint`.

   Một quy tắc bất di bất dịch: đây là `role="alert"` + có NÚT. Chỉ đổi
   câu chữ là không đủ — người dùng phải có đường bấm tiếp.
   ========================================================= */
export default function LoadErr ({ onRetry, titleKey = 'board.loadErr', bodyKey = 'board.loadErrHint', retryKey = 'board.retry' }) {
  const { t } = useI18n()
  return (
    <div className="empty load-err" role="alert">
      <span className="empty-ico" aria-hidden="true"><Icon name="warn" size={18} /></span>
      <b>{t(titleKey)}</b>
      <small>{t(bodyKey)}</small>
      <div className="empty-acts">
        <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>{t(retryKey)}</button>
      </div>
    </div>
  )
}
