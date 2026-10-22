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
/* Nhật ký yêu cầu của dev server — chỉ để CHẨN ĐOÁN, không ảnh hưởng gì tới
   ứng dụng. Mỗi dòng là một yêu cầu thật của trình duyệt kèm mã trả về, nên
   khi khung preview trắng/đen chỉ cần nhìn log là biết ngay:
     · KHÔNG có dòng `GET / 200`  → trình duyệt không hề chạm tới server
                                    (lỗi proxy/cổng, không phải lỗi app);
     · có `GET / 200` nhưng sau đó là 4xx/5xx ở một module → thiếu file/504;
     · có `GET / 200` rồi im lặng, không module nào được hỏi → HTML đã về
                                    nhưng trình duyệt không chạy được script
                                    (CSP, kiểu MIME, hoặc JS lỗi cú pháp).
   Ba tình huống đó cần ba cách chữa khác nhau, nên đừng đoán. */
function requestLog() {
  return {
    name: 'ccl-request-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const started = Date.now()
        res.on('finish', () => {
          const url = (req.url || '').split('?')[0]
          console.log(`[ccl-req] ${res.statusCode} ${req.method} ${url} ${Date.now() - started}ms`)
        })
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), requestLog()],
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
