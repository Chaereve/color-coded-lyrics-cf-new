import { useCallback, useEffect, useState } from 'react'

/* =========================================================
   CỜ "VỪA XONG" TỰ TẮT — VÀ TỰ DỌN ĐỒNG HỒ CỦA NÓ
   ---------------------------------------------------------
   Nhãn nút đổi tại chỗ rồi tự về (`Link copied` sau khi copy, `Saved` sau khi
   xuất CSV): chỗ bấm cần biết việc của mình đã ăn, mà không có chỗ nào khác để
   nói điều đó.

   Bản cũ làm bằng `setTimeout(() => setX(false), 1800)` gọi thẳng trong
   `onClick`. Hai chuyện không ổn, cùng một nguyên nhân:
     · ĐỒNG HỒ KHÔNG AI DỌN: rời trang trong lúc nó đang đếm là để lại một
       `setTimeout` sống lâu hơn component, gọi setState lên một component đã
       tháo (React bỏ qua, nhưng đây là loại rác sinh ra lỗi thật khi sau này có
       người thêm việc vào đúng chỗ đó);
     · BẤM LẦN HAI: hẹn giờ thứ nhất vẫn đang chạy, nên cờ tắt sớm hơn 1800ms
       tính từ lần bấm sau — nhìn như nút tự nhả.

   Đặt đồng hồ trong `useEffect` giải quyết cả hai: React tự gọi hàm dọn khi
   component tháo, và mỗi lần bấm lại (`n` đổi) là đồng hồ cũ được dọn rồi đếm
   lại từ đầu.
   ========================================================= */
export function useTransient(ms = 1800) {
  const [on, setOn] = useState(false)
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(id)
  }, [on, n, ms])

  /* Bấm lại trong lúc cờ đang bật: `setOn(true)` một mình là no-op (state không
     đổi → effect không chạy lại → đồng hồ cũ vẫn đang đếm), nên `n` là thứ bắt
     effect chạy lại. */
  const flash = useCallback(() => { setOn(true); setN(v => v + 1) }, [])
  return [on, flash]
}
