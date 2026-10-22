import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Cấu hình dev/preview — và hai chỗ dưới đây là để chữa lỗi CHỈ xảy ra trong
   sandbox, không xảy ra trên máy dev thường:

   1. `preview.port` từng để 5173, trùng đúng cổng dev. Trong sandbox cả hai
      cùng chạy, nên `npm run preview` chết ngay bằng "Port 5173 is already in
      use" (strictPort) — một lỗi khởi động không liên quan gì tới code ứng
      dụng nhưng nhìn ra đúng kiểu "sandbox không khởi động". Preview về 4173.

   2. `optimizeDeps.include` liệt kê đủ tám gói vào trước. Thiếu danh sách này
      Vite tự đi tìm phụ thuộc trong lúc chạy và TỐI ƯU LẠI giữa phiên; mỗi
      lần tối ưu lại là toàn bộ URL `?v=<hash>` cũ đổi hash. Tab đang mở (hoặc
      khung preview giữ HTML cũ) hỏi hash cũ thì nhận **504 Outdated Optimize
      Dep**, module không tải được, `#root` rỗng — trang đen, không một dòng
      lỗi nào trong console vì lỗi nằm ở tầng tải module. Đã gặp thật trong
      sandbox này. Liệt kê đủ ở đây thì Vite tối ưu đúng một lần lúc khởi
      động và hash đứng yên.

   3. `headers: no-store` cho mọi phản hồi của dev server: HTML không bao giờ
      được lấy từ cache. HTML cũ + hash mới = lại 504 ở trên. */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    headers: { 'Cache-Control': 'no-store' },
    hmr: {
      protocol: 'wss',
      clientPort: 443,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'lucide-react',
      'qrcode',
      '@supabase/supabase-js',
      '@fingerprintjs/fingerprintjs',
    ],
  },
})
