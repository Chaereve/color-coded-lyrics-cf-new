import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { useModalExit } from '../lib/useModalExit'
import Icon from './Icon'

/* =========================================================
   HỘP XÁC NHẬN CỦA ỨNG DỤNG — thay `confirm()` / `prompt()` của trình duyệt
   ---------------------------------------------------------
   BẢY chỗ trong app đang gọi thẳng hộp thoại của trình duyệt cho những việc
   KHÔNG HOÀN TÁC ĐƯỢC: xoá request, xoá video, xoá hàng loạt, từ chối bài, huỷ
   đơn. Cả bảy đều có một lỗi giống nhau, và nó không phải lỗi thẩm mỹ:

     · Trong iframe bị chặn hộp thoại (thiếu `allow-modals` — mọi khung xem
       trước, mọi trang nhúng), `confirm()` trả về `false` và `prompt()` trả về
       `null` MÀ KHÔNG NÓI GÌ. Người dùng bấm "Xoá" và không có gì xảy ra —
       nhìn y hệt "bảng quản trị bị lỗi", đúng thứ đã bị báo hai lần;
     · trình duyệt tự chặn sau vài lần ("Prevent this page from creating
       additional dialogs") rồi im lặng trả `false` vĩnh viễn;
     · hộp thoại của trình duyệt chặn cả luồng JS (không có animation, không
       có `aria-*`, không theo bảng màu, chữ không dịch được theo ngữ cảnh).

   Vì vậy hộp này là một hộp THẬT trong app: cùng lớp phủ, cùng bảng màu, cùng
   cách đóng (Esc / bấm ra ngoài), có tên cho trình đọc màn hình, và trả lời
   bằng Promise nên nơi gọi viết y như cũ: `if (!(await ask(...))) return`.
   ========================================================= */

export default function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel, tone = 'danger',
  reasonLabel, reasonPh, reason = '', onReason, onConfirm, onClose,
  videoLabel, videoUrl = '', onVideoUrl,
}) {
  const { t } = useI18n()
  const { mounted, closing } = useModalExit(open)
  const okRef = useRef(null)
  const reasonRef = useRef(null)
  const panelRef = useRef(null)
  const videoRef = useRef(null)
  const submitAnswer = () => {
    if (videoLabel && videoUrl.trim() && !/^https?:\/\/[^\s/]+(?:[/?#][^\s]*)?$/i.test(videoUrl.trim())) {
      videoRef.current?.setCustomValidity(t('err.denyVideo'))
      videoRef.current?.reportValidity()
      return
    }
    onConfirm?.()
  }

  /* MỞ RA LÀ ĐÃ SẴN SÀNG BẤM: con trỏ rơi vào ô lý do (nếu có) hay nút xác
     nhận. Không đặt vào nút nào thì người dùng bàn phím phải Tab một lượt mới
     tới được việc mình vừa gọi ra. */
  useEffect(() => {
    if (!open) return
    const el = reasonLabel ? reasonRef.current : okRef.current
    el?.focus?.()
  }, [open, reasonLabel])

  /* Esc để đóng, và Enter để xác nhận khi không có ô nhập. Có ô nhập thì Enter
     là xuống dòng — nhưng Ctrl/Cmd + Enter vẫn xác nhận, thói quen của người
     gõ nhanh. Cả hai đều KHÔNG chặn phím của phần còn lại khi hộp đã đóng. */
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Enter') return
      const inReason = e.target === reasonRef.current
      if (inReason && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      submitAnswer()
    }
    /* Nghe ở `window` chứ không phải `document`: hộp này là lớp TRÊN CÙNG, phải
       nhận phím trước mọi hộp khác trong app (chúng nghe ở `window`/bubble), và
       phải nghe được cả sự kiện phát thẳng ra `window` — đường mà iframe và
       khung kiểm thử dùng. */
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!mounted) return null
  const out = closing ? ' out' : ''
  /* `danger` = việc không lấy lại được (xoá, từ chối): biểu tượng và nút đổi
     màu theo. Đặt thành biến ngay đây thay vì so tại chỗ trong từng nhãn —
     Icon.test.js đọc MỌI chuỗi nằm trong `name={…}` và coi đó là tên icon, nên
     một chữ như 'danger' lọt vào đó là một báo động sai. */
  const danger = tone === 'danger'

  return (
    <div className={`overlay dlg-overlay${out}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={panelRef} className={`modal narrow dlg${out}`} role="dialog" aria-modal="true"
        aria-labelledby="dlg-title" aria-describedby={body ? 'dlg-body' : undefined}>
        <div className="dlg-head">
          <span className={`dlg-ico${danger ? ' is-danger' : ''}`} aria-hidden="true">
            <Icon name={danger ? 'close' : 'info'} size={15} />
          </span>
          <h2 className="dlg-title" id="dlg-title">{title}</h2>
        </div>

        {body && <p className="dlg-body" id="dlg-body">{body}</p>}

        {reasonLabel && (
          <label className="dlg-field">
            <span>{reasonLabel}</span>
            <textarea ref={reasonRef} value={reason} maxLength={200} rows={2}
              placeholder={reasonPh || ''} onChange={e => onReason?.(e.target.value)} />
          </label>
        )}

        {videoLabel && (
          <label className="dlg-field">
            <span>{videoLabel}</span>
            <input ref={videoRef} type="url" value={videoUrl} maxLength={500}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={e => { e.target.setCustomValidity(''); onVideoUrl?.(e.target.value) }} />
          </label>
        )}

        <div className="dlg-acts">
          <button type="button" className="btn" onClick={onClose}>{cancelLabel || t('btn.cancel')}</button>
          <button type="button" ref={okRef}
            className={`btn ${danger ? 'btn-no' : 'btn-ok'}`}
            onClick={submitAnswer}>
            {confirmLabel || t('btn.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
