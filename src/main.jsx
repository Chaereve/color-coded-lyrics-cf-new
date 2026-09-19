import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <NotifyProvider>
        {/* Lưới an toàn bọc NGOÀI cùng: một component ném lỗi trong lúc render
            thì React gỡ sạch cây DOM, để lại trang đen không một chữ — lưới
            này đổi thành câu giải thích + nút tải lại. */}
        <ErrorBoundary>
          {/* nền loang nằm sau mọi thứ, toaster nằm trước mọi thứ */}
          <Background />
          <App />
          <Toaster />
        </ErrorBoundary>
      </NotifyProvider>
    </I18nProvider>
  </StrictMode>
)
