import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { mergeToast } from './toastStack'

/* =========================================================
   THÔNG BÁO — một chỗ duy nhất cho mọi phản hồi với người dùng
   ---------------------------------------------------------
   Toast góc màn hình: luôn có, có thanh đếm giờ, rê chuột vào
   thì tạm dừng (logic nằm trong components/Toaster.jsx).
   Tiếng (lib/sfx) vẫn do chỗ gọi bấm, vì âm thanh phải nằm
   đúng nhịp của thao tác.
   ========================================================= */

let seq = 0

const NotifyCtx = createContext(null)

export function NotifyProvider({ children }) {
  const [items, setItems] = useState([])

  /* Bấm đóng thì đánh dấu .out trước cho animation trượt ra chạy hết,
     rồi mới nhấc khỏi DOM — một nhịp chuyển động cho cả trang. */
  const dismiss = useCallback((id) => {
    setItems(list => list.map(n => (n.id === id ? { ...n, out: true } : n)))
    setTimeout(() => setItems(list => list.filter(n => n.id !== id)), 210)
  }, [])

  const push = useCallback((n) => {
    const id = ++seq
    const item = {
      id,
      tone: n.tone || 'ok',
      title: n.title || '',
      body: n.body || '',
      ms: n.ms === 0 ? 0 : Math.max(1800, n.ms || (n.tone === 'err' ? 6200 : 4400)),
      action: n.action || null,
      repeat: 1,
      out: false,
    }
    /* gộp mẩu trùng văn bản + gio chong toi da TOAST_CAP mau (src/lib/toastStack.js) */
    setItems(list => mergeToast(list, item))
    return id
  }, [])

  const value = useMemo(() => ({ items, push, dismiss }), [items, push, dismiss])

  return <NotifyCtx.Provider value={value}>{children}</NotifyCtx.Provider>
}

export function useNotify() {
  const ctx = useContext(NotifyCtx)
  if (!ctx) throw new Error('useNotify phải nằm trong <NotifyProvider>')
  return ctx
}
