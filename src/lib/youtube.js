/* =========================================================
   YOUTUBE — cấu hình kênh, bóc ID từ link, dựng thumbnail
   --------------------------------------------------------
   Cấu hình kênh phụ thuộc env; parser URL được tách sang youtubeUrl.js thuần
   để có thể test trực tiếp bằng node:test.
   ========================================================= */
import { parseYoutube, thumbUrl } from './youtubeUrl.js'
export { parseYoutube, thumbUrl }

/* ---------- cấu hình kênh: chỉ cần sửa chỗ này ---------- */
export const CHANNEL = {
  handle: import.meta.env.VITE_YOUTUBE_CHANNEL_HANDLE || 'Chaereve',
  name: 'Chaereve',
  url: `https://www.youtube.com/@${import.meta.env.VITE_YOUTUBE_CHANNEL_HANDLE || 'Chaereve'}`,
}
