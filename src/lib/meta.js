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

/* NHÃN NGẮN CỦA THỂ LOẠI. Tên đầy đủ ("Color Coded Lyrics", 18 ký tự) là thứ
   dài nhất trên dòng phụ — dài hơn cả tên người gửi lẫn giờ gửi — trong khi nó
   nói một thông tin người đọc thường đã đoán được từ tên bài. Dòng phụ vì thế
   bị đẩy sang hàng thứ hai trên màn hẹp.
   Trường `short` đã có sẵn trong KIND_META từ đầu (dùng cho ô chọn thể loại),
   nên chỉ cần một hàm đọc nó ra — không dựng thêm bảng nhãn thứ hai, vì hai
   bảng là hai chỗ sẽ lệch nhau sau một lần sửa.
   Tên đầy đủ không mất: nó đi vào `title` của nhãn (xem App.jsx). */
export const kindShort = (k) => KIND_META[k]?.short || k

/* Màu trạng thái — LUÔN trả về một màu. Một dòng lạ (trạng thái cũ còn sót
   trong DB, dữ liệu nhập tay, hàng của bản deploy trước) không được làm vỡ cả
   bảng chỉ vì tra bảng màu không thấy: `STATUS_META[s].c` trần là TypeError
   ngay trong lúc render, mà render ném lỗi thì mất cả cây. */
export const statusColor = (s) => STATUS_META[s]?.c || STATUS_META.pending.c

/* Request đã được chốt vào Up next nhưng chưa xong: đã chốt (picked_at)
   và vẫn còn trong hàng (queued) hoặc đang làm (in_progress).
   Completed/denied tự rơi khỏi nhóm này. Up next thì KHÓA vote. */
export const isPicked = (r) =>
  !!r?.picked_at && (r.status === 'queued' || r.status === 'in_progress')

/* DÂY CHUYỀN ĐANG CHẠY: bài đã chốt vào Up next (có picked_at) HOẶC bài đang
   làm. Phải là phép HOẶC vì admin có thể tick một mốc tiến độ trên request
   chưa từng được chốt (hoặc đẩy một bài về hàng chờ rồi làm lại) — khi đó dòng
   mang status 'in_progress' mà KHÔNG có picked_at. Chỉ dùng isPicked thì bài đó
   rơi khỏi MỌI tab cùng lúc: Queue (status không còn là queued), Up next và
   In progress (thiếu picked_at), Done (chưa xong) — một request đang được làm
   mà không thấy ở đâu trên bảng, người gửi tưởng nó bị xoá. */
export const inChain = (r) => isPicked(r) || r?.status === 'in_progress'

/* Nhãn trạng thái của MỘT dòng, dùng chung cho hàng trên bảng, cho thẻ trong
   khối Up next và cho ô trạng thái ở bảng Admin: bài đã chốt mà chưa khởi động
   hiện "Up next", còn lại theo status. Ba nơi tự viết lại biểu thức này là ba
   nơi sẽ lệch nhau sau một lần sửa — nên chỉ có một hàm. */
export const statusLabel = (r, t) =>
  (isPicked(r) && r.status === 'queued' ? t('now.next') : t(`status.${r.status}`))

/* MÀU của nhãn trạng thái — đi theo CẶP với `statusLabel`.
   Chủ dự án: "màu của up next vs in queue đang quá giống nhau". Đúng, và lý do
   rất cụ thể: cả hai đều là `status === 'queued'`, nên `statusColor(r.status)`
   trả về cùng một sắc. Nhưng "đang chờ tới lượt" và "đã được chọn vào Up
   next" là hai bậc khác nhau của dây chuyền — giờ mỗi bậc một sắc
   (`--queued` xanh lạnh, `--upnext` tím).

   Hàm này nhận CẢ DÒNG, không nhận chuỗi trạng thái: chỉ có dòng mới biết nó
   đã được chốt hay chưa (`picked_at`). Mọi chỗ vẽ nhãn trạng thái phải đi qua
   đây, không được gọi `statusColor(r.status)` trực tiếp — đó đúng là chỗ đã
   làm hai nhãn trùng màu. */
export const statusColorOf = (r) =>
  (isPicked(r) && r?.status === 'queued' ? 'var(--upnext)' : statusColor(r?.status))

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
/* Số từ DB có thể thiếu, null, hoặc là chuỗi lạ. In ra "NaN₫" hay "$NaN" là
   chuyện nhỏ nhưng nó nói với người dùng rằng trang hỏng — mà chỉ vì một ô
   trống. Mọi hàm định dạng số đi qua đây trước. */
const num = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

export const compact = (n) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0)

export const vnd = (n) => num(n).toLocaleString('en-US') + '₫'

export const usd = (n) => '$' + num(n).toFixed(2)