export const KIND_META = {
  'Color Coded Lyrics': { cls: 'ccl',   short: 'CCL',     titleKey: 'req.song' },
  'Full Album':         { cls: 'album', short: 'Album',   titleKey: 'req.albumName', noteKey: 'req.kindNote.album' },
  '1 Hour Loop':        { cls: 'loop',  short: '1H Loop', titleKey: 'req.song' },
  'Short':              { cls: 'short', short: 'Short',   titleKey: 'req.song' },
}

/* Chỉ giữ màu — nhãn hiển thị lấy qua t('status.<key>') */
export const STATUS_META = {
  pending:     { c: 'var(--pending)' },
  queued:      { c: 'var(--queued)' },
  in_progress: { c: 'var(--progress)' },
  completed:   { c: 'var(--done)' },
  denied:      { c: 'var(--denied)' },
}

export const kindCls = (k) => KIND_META[k]?.cls || 'ccl'

/* Request đã được chốt vào Up next nhưng chưa xong: đã chốt (picked_at)
   và vẫn còn trong hàng (queued) hoặc đang làm (in_progress).
   Completed/denied tự rơi khỏi nhóm này. Up next thì KHÓA vote. */
export const isPicked = (r) =>
  !!r?.picked_at && (r.status === 'queued' || r.status === 'in_progress')

/* Nhãn trạng thái của MỘT dòng, dùng chung cho hàng trên bảng, cho thẻ trong
   khối Up next và cho ô trạng thái ở bảng Admin: bài đã chốt mà chưa khởi động
   hiện "Up next", còn lại theo status. Ba nơi tự viết lại biểu thức này là ba
   nơi sẽ lệch nhau sau một lần sửa — nên chỉ có một hàm. */
export const statusLabel = (r, t) =>
  (isPicked(r) && r.status === 'queued' ? t('now.next') : t(`status.${r.status}`))

/* Cần truyền hàm t vào để dịch */
export const timeAgo = (iso, t) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(s) || s < 60) return t('time.now')
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) })
  if (s < 86400) return t('time.hour', { n: Math.floor(s / 3600) })
  if (s < 86400 * 7) return t('time.day', { n: Math.floor(s / 86400) })
  if (s < 86400 * 30) return t('time.week', { n: Math.floor(s / (86400 * 7)) })
  if (s < 86400 * 365) return t('time.month', { n: Math.floor(s / (86400 * 30)) })
  return t('time.year', { n: Math.floor(s / (86400 * 365)) })
}

/* 1234 -> "1.2K" — dùng cho lượt xem */
export const compact = (n) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0)

export const vnd = (n) => Number(n).toLocaleString('en-US') + '₫'

export const usd = (n) => '$' + Number(n).toFixed(2)