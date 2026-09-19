import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Background from './components/Background'
import Toaster from './components/Toaster'
import { I18nProvider } from './lib/i18n.jsx'
import { NotifyProvider } from './lib/notify.jsx'

/* Có View Transitions thì CSS đổi sang chuyển cảnh trượt giữa hai mục
   (html[data-vt="on"]) và animation .sect cũ nhường chỗ; trình duyệt cũ
   không có thì mọi thứ chạy y như trước. Gán TRƯỚC khi render để khung
   hình đầu tiên đã đúng, không phải gỡ class giữa chừng. */
if (typeof document.startViewTransition === 'function') {
  document.documentElement.dataset.vt = 'on'
}

/* KHÔNG bọc app trong "màn hình lỗi", và KHÔNG dựng lưới an toàn ở
   index.html (chủ dự án chốt 19/09/2026). Cả hai thứ đó nghe thì hợp lý —
   "đừng để trang trắng" — nhưng thực tế chúng biến MỘT lỗi render thành một
   khối đen che hết trang: người dùng mất cả app trong khi lỗi thật vẫn nằm
   trong console. Lỗi phải nhỏ hơn thiệt hại, không được lớn hơn.
   Ở đây chỉ còn đúng việc ghi lỗi ra console với tiền tố [ccl] — mở DevTools
   là thấy, dán lại được — còn lỗi nghiệp vụ vẫn đi đường toast đỏ như cũ. */
const report = (label, e) => console.error(`[ccl] ${label}:`, e)
window.addEventListener('error', (e) => report('lỗi runtime', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => report('promise bị từ chối', e.reason))

const root = createRoot(document.getElementById('root'))
root.render(
  <StrictMode>
    <I18nProvider>
      <NotifyProvider>
        {/* nền loang nằm sau mọi thứ, toaster nằm trước mọi thứ */}
        <Background />
        <App />
        <Toaster />
      </NotifyProvider>
    </I18nProvider>
  </StrictMode>
)
