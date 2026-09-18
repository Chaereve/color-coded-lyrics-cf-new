/* =========================================================
   YOUTUBE — cấu hình kênh, bóc ID từ link, dựng thumbnail
   --------------------------------------------------------
   Chỉ còn hai việc:
     · CHANNEL — địa chỉ kênh @Chaereve (nút ở sidebar/footer)
     · parseYoutube() / thumbUrl() — admin dán link video vào
       bảng quản trị, app tự bóc ID và lấy ảnh bìa.
   ========================================================= */

const HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'm.youtube.com', 'music.youtube.com']
const ID_RE = /^[A-Za-z0-9_-]{6,}$/

/* ---------- cấu hình kênh: chỉ cần sửa chỗ này ---------- */
export const CHANNEL = {
  handle: import.meta.env.VITE_YOUTUBE_CHANNEL_HANDLE || 'Chaereve',
  name: 'Chaereve',
  url: `https://www.youtube.com/@${import.meta.env.VITE_YOUTUBE_CHANNEL_HANDLE || 'Chaereve'}`,
}

const isYT = (u) => HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))

/**
 * Đọc link YouTube.
 * @returns {{ id: string|null, list: string|null, kind: 'video'|'playlist' } | null}
 */
export function parseYoutube(raw) {
  const s = String(raw || '').trim()
  if (!s) return null

  let u
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s) } catch { return null }
  if (!isYT(u)) return null

  const list = u.searchParams.get('list')
  const seg = u.pathname.split('/').filter(Boolean)

  let id = null
  if (u.hostname === 'youtu.be') id = seg[0]
  else if (seg[0] === 'watch') id = u.searchParams.get('v')
  else if (['embed', 'shorts', 'live', 'v'].includes(seg[0])) id = seg[1]

  if (id && !ID_RE.test(id)) id = null
  if (!id && !list) return null
  return { id: id || null, list: list || null, kind: id ? 'video' : 'playlist' }
}

/* Ảnh bìa chất lượng cao: maxres (1280×720) hầu hết video mới đều có;
   video cũ chỉ có hq (480×360) nên danh sách dưới tự thử lại bản hq khi
   maxres trả 404 — đừng đổi thẳng sang sd/mq vì chúng là bản 320×180 có
   dải đen hai bên, trông nhoè hơn hq trên khung rộng. */
export const thumbUrl = (id, q = 'maxres') =>
  id ? `https://i.ytimg.com/vi/${id}/${q}default.jpg` : null
