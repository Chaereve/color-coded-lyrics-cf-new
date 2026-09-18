import { useEffect, useState } from 'react'

/* =========================================================
   CHO MODAL ĐÓNG MUỘN MỘT NHỊP
   ---------------------------------------------------------
   Modal tắt bằng cách return null nên React nhấc nó khỏi DOM
   ngay khi state đổi — người xem thấy modal "blip" mất hút
   chứ không đóng lại. Hook này giữ modal trong DOM thêm ~190ms
   ở trạng thái `closing` (class .out) để animation thu nhỏ + mờ
   bên CSS chạy hết, rồi mới thật sự nhấc ra. Mở lại giữa chừng
   thì quay thẳng về `open`, animation mở chạy lại từ đầu.

   Ba trạng thái: closed → open → closing → closed. Các bước
   chuyển theo prop `open` làm ngay trong render (adjust state
   khi prop đổi), effect chỉ mỗi việc hẹn giờ rời DOM.
   ========================================================= */
export function useModalExit(open, ms = 190) {
  const [phase, setPhase] = useState(open ? 'open' : 'closed')

  /* prop đổi thì bắt nhịp ngay trong render, không đợi effect */
  if (open && phase !== 'open') setPhase('open')
  if (!open && phase === 'open') setPhase('closing')

  useEffect(() => {
    if (open || phase !== 'closing') return
    const t = setTimeout(() => setPhase('closed'), ms)
    return () => clearTimeout(t)
  }, [open, phase, ms])

  return { mounted: phase !== 'closed', closing: phase === 'closing' }
}
