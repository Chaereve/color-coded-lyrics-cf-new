import { useEffect, useRef } from 'react'

/* =========================================================
   NHỐT TIÊU ĐIỂM TRONG MỘT HỘP THOẠI
   ---------------------------------------------------------
   `role="dialog"` + `aria-modal="true"` là một LỜI HỨA với trình đọc màn hình:
   phần còn lại của trang đã ra ngoài tầm với. Chuột thì đúng như vậy — lớp phủ
   chặn click. Bàn phím thì không: Tab vẫn đi thẳng ra các nút phía sau lớp phủ,
   người dùng mất dấu mình đang ở đâu trong một trang họ không nhìn thấy.

   Đây là bản rút ra từ vòng Tab đang chạy trong `Notifications.jsx` (chỗ duy
   nhất có sẵn), dùng chung cho các hộp còn lại. Ba việc, đúng ba việc:
     1. mở ra thì đưa tiêu điểm VÀO hộp (ô đầu tiên, hoặc chỗ nơi gọi chỉ định);
     2. Tab / Shift+Tab ở hai đầu thì quay lại trong hộp, không đi ra ngoài;
     3. đóng thì TRẢ tiêu điểm về nơi đã mở hộp — không phải về đầu trang.

   `active` nên là `open` (không phải "còn trong DOM"): hộp giữ lại ~190ms để
   animation đóng chạy hết, nhưng tiêu điểm phải về chỗ cũ ngay lúc người dùng
   bấm đóng.

   Chỉ tiêu điểm, không kèm Esc / bấm ra ngoài: mỗi hộp đã có cách đóng riêng,
   và trộn hai thứ vào một hook là cách để chúng chồng lên nhau.
   ========================================================= */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref, active, opts = {}) {
  /* opts giữ trong ref: nơi gọi hay truyền hàm mới mỗi lần render, đưa vào deps
     là effect chạy lại liên tục — mỗi lần chạy lại là một lần cướp tiêu điểm.
     Cập nhật trong một effect (khai báo TRƯỚC effect nhốt tiêu điểm, nên chạy
     trước nó) chứ không gán trong thân render. */
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  useEffect(() => {
    if (!active) return
    const box = ref.current
    if (!box) return
    const { initial, returnFocus, lockClass } = optsRef.current
    /* Nơi đã mở hộp: hỏi lúc MỞ, vì tới lúc đóng thì phần tử đó có thể đã bị
       thay bằng phần tử khác (bảng tự vẽ lại) hoặc biến mất. */
    const openedFrom = document.activeElement

    const focusables = () => [...box.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.tabIndex !== -1)
    const first = () => (initial?.() || focusables()[0] || box)
    const target = first()
    if (target === box && box.tabIndex < 0) box.setAttribute('tabindex', '-1')
    target?.focus?.()

    const onKey = (e) => {
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) { e.preventDefault(); return }
      const last = f[f.length - 1]
      const cur = document.activeElement
      const outside = !box.contains(cur)
      if (e.shiftKey && (cur === f[0] || outside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (cur === last || outside)) { e.preventDefault(); f[0].focus() }
    }
    document.addEventListener('keydown', onKey)
    if (lockClass) document.body.classList.add(lockClass)

    return () => {
      document.removeEventListener('keydown', onKey)
      if (lockClass) document.body.classList.remove(lockClass)
      const back = returnFocus?.() || openedFrom
      /* isConnected: đóng hộp vì cả trang đang tháo ra (đăng xuất) thì chỗ cũ
         không còn để trả tiêu điểm về, và focus() lên nút đã gỡ là một cú ném. */
      if (back?.isConnected && typeof back.focus === 'function') back.focus()
    }
  }, [ref, active])
}
