/* Link người dùng hoặc admin dán không được thành href trần.
   javascript: và data: chạy như script ngay khi ai đó bấm. Chỉ http(s),
   và không nhận userinfo (https://user:pass@host dễ giả một domain khác). */

export function safeHttpUrl(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 2000) return null
  let url
  try { url = new URL(s) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url.href
}
