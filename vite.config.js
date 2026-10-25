import { defineConfig, loadEnv } from 'vite'
import { onRequest as archiveOnRequest, renderArchivePage } from './functions/archive.js'
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
          /* Giữ NGUYÊN query: Vite ping lại `/` bằng `?t=<mốc>` sau khi mất
             websocket HMR — thấy tham số đó trong log là biết ngay trang đang
             tự nạp lại theo vòng lặp, không phải người dùng bấm F5. */
          const url = (req.url || '')
          console.log(`[ccl-req] ${res.statusCode} ${req.method} ${url} ${Date.now() - started}ms`)
        })
        next()
      })
    },
  }
}

/* BẢNG CHẨN ĐOÁN — CHỈ Ở CHẾ ĐỘ DEV, không lọt vào bản build.
   ---------------------------------------------------------------
   Vì sao cần: trang có thể trắng/đen mà console không có gì để đọc (người
   dùng không mở DevTools), hoặc lỗi nằm trong một promise bị nuốt. Bảng này
   in thẳng ra ba con số quyết định hướng chữa:
     · khối trong #root — 0 nghĩa là React không dựng được gì (lỗi runtime);
     · .splash còn đó — app đang kẹt ở màn chờ, không phải trang trắng;
     · số lỗi JS — kèm nguyên văn dòng đầu tiên.
   Đây KHÔNG phải "màn hình lỗi" thay cho app (thứ chủ dự án đã bác): nó là
   một dải chữ nhỏ ở góc, chỉ tồn tại khi chạy `vite`, và không che nội dung. */
function devProbe() {
  return {
    name: 'ccl-dev-probe',
    apply: 'serve',
    transformIndexHtml(html) {
      const probe = `<script>
(function () {
  var errs = [];
  window.addEventListener('error', function (e) { errs.push(String((e.error && e.error.message) || e.message)) });
  window.addEventListener('unhandledrejection', function (e) { errs.push('promise: ' + String((e.reason && e.reason.message) || e.reason)) });
  function tick() {
    var root = document.getElementById('root');
    var kids = root ? root.children.length : -1;
    var splash = document.querySelector('.splash');
    var el = document.getElementById('ccl-probe');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ccl-probe';
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;font:11px/1.45 ui-monospace,monospace;color:#cfe3ff;background:rgba(6,8,14,.92);border:1px solid rgba(140,170,255,.35);border-radius:6px;padding:5px 8px;max-width:70vw;white-space:pre-wrap;pointer-events:none';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = 'root:' + kids + ' splash:' + (splash ? (splash.className.indexOf('hide') >= 0 ? 'hidden' : 'ON') : 'no') +
      ' err:' + errs.length + (errs.length ? '\\n' + errs.slice(0, 2).join('\\n') : '');
  }
  setInterval(tick, 800); setTimeout(tick, 300);
})();
</script>`
      return html.replace('</body>', probe + '\n  </body>')
    },
  }
}

/* Vite does not execute Cloudflare Pages Functions. Without this dev-only
   bridge, /archive falls through to index.html and the SPA silently renders
   the home page because /archive is intentionally not a client route. */
function archivePagesPreview() {
  const install = server => {
    const loaded = loadEnv(server.config.mode, process.cwd(), '')
    const env = {
      SUPABASE_URL: process.env.SUPABASE_URL || loaded.SUPABASE_URL || loaded.VITE_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || loaded.SUPABASE_ANON_KEY || loaded.VITE_SUPABASE_ANON_KEY,
    }
    server.middlewares.use(async (req, res, next) => {
      const incoming = new URL(req.url || '/', 'http://localhost')
      if (incoming.pathname !== '/archive') return next()
      try {
        let response
        if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
          const request = new Request(`https://chaereve.pages.dev${incoming.pathname}${incoming.search}`, {
            method: req.method || 'GET',
          })
          response = await archiveOnRequest({ request, env })
        } else {
          const html = renderArchivePage({
            videos: [],
            media: [],
            query: incoming.searchParams.get('q') || '',
            month: incoming.searchParams.get('month') || '',
            page: incoming.searchParams.get('page'),
            mediaUnavailable: true,
            previewNotice: 'Local preview only: Supabase bindings are not configured, so archive video data is unavailable here.',
          })
          response = new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          })
        }
        res.statusCode = response.status
        for (const [name, value] of response.headers) res.setHeader(name, value)
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
      } catch (error) {
        next(error)
      }
    })
  }
  return {
    name: 'ccl-pages-archive-preview',
    apply: 'serve',
    configureServer: install,
    configurePreviewServer: install,
  }
}

export default defineConfig({
  plugins: [react(), archivePagesPreview(), requestLog(), devProbe()],
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
    /* Bản build tĩnh cũng không cho cache HTML: tệp JS/CSS có hash trong tên
       nên cache chúng là vô hại, còn HTML thì phải luôn mới. */
    headers: { 'Cache-Control': 'no-store' },
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
