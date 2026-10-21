/* =========================================================
   NHẬT KÝ THAO TÁC QUẢN TRỊ — cách đọc một dòng
   ---------------------------------------------------------
   Bảng `admin_actions` (migration 20261213) ghi lại việc admin ĐÃ LÀM: duyệt,
   từ chối, chốt, sửa tên bài, xoá, xác nhận đơn. Dòng trong bảng chỉ là dữ
   liệu thô (`action`, `detail`, `label`); tệp này biến nó thành một câu đọc
   được, và là nơi duy nhất quyết định thứ tự ưu tiên khi một lần bấm đổi nhiều
   trường cùng lúc (duyệt + chốt, sửa tên + đổi loại bài…).

   Hàm thuần, không React: test bằng mảng thường, và cùng một cách đọc cho cả
   trang quản trị lẫn bất kỳ chỗ nào sau này cần kể lại lịch sử.
   ========================================================= */

export const ADMIN_ACTIONS_PER_PAGE = 20

/* Thứ tự ưu tiên khi một lần ghi đổi nhiều thứ: việc nặng nhất đứng trước. */
export const ACTION_PRIORITY = [
  'delete', 'deny', 'approve', 'complete', 'pick', 'unpick', 'requeue',
  'order', 'rename', 'edit', 'progress', 'video',
]

export const ACTION_LABEL = {
  delete: 'adm.log.delete',
  deny: 'adm.log.deny',
  approve: 'adm.log.approve',
  complete: 'adm.log.complete',
  pick: 'adm.log.pick',
  unpick: 'adm.log.unpick',
  requeue: 'adm.log.requeue',
  order: 'adm.log.order',
  rename: 'adm.log.rename',
  edit: 'adm.log.edit',
  progress: 'adm.log.progress',
  video: 'adm.log.video',
}

/* Nhãn của một trường trong `detail`, để dòng nhật ký nói được ĐÃ ĐỔI GÌ chứ
   không chỉ "đã sửa". */
export const FIELD_LABEL = {
  status: 'adm.log.f.status',
  artist: 'adm.log.f.artist',
  title: 'adm.log.f.title',
  kind: 'adm.log.f.kind',
  requester: 'adm.log.f.requester',
  note: 'adm.log.f.note',
  is_paid: 'adm.log.f.paid',
  video_url: 'adm.log.f.video',
  picked_at: 'adm.log.f.picked',
  done_layout: 'adm.log.f.layout',
  done_lyrics: 'adm.log.f.lyrics',
  done_edit: 'adm.log.f.edit',
  progress: 'adm.log.f.progress',
  deny_reason: 'adm.log.f.reason',
}

/* `detail` từ SQL là jsonb: { status: ['pending','queued'], … } (cặp cũ → mới)
   hoặc { note: { from, to } }. Chấp nhận cả hai, và CHỈ trả về những trường có
   nhãn — một trường lạ không được làm dòng nhật ký hiện `undefined`. */
export function changedFields(detail) {
  if (!detail || typeof detail !== 'object') return []
  return Object.keys(detail)
    .filter((k) => FIELD_LABEL[k])
    .map((k) => {
      const v = detail[k]
      const pair = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v.from, v.to] : [null, v])
      return { key: k, fieldKey: FIELD_LABEL[k], from: pair[0] ?? null, to: pair[1] ?? null }
    })
}

/* Một giá trị bất kỳ trong `detail` thành chữ ngắn để đọc: null → "—", boolean
   → "on/off", chuỗi dài (link video, ghi chú) bị cắt. Không phải để hiển thị
   toàn bộ — chỉ để câu nhật ký nói được "đổi từ cái này sang cái kia". */
export const shortValue = (v, t) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? t('adm.log.on') : t('adm.log.off')
  const s = String(v)
  return s.length > 32 ? s.slice(0, 30) + '…' : s
}

/* Việc chính của một dòng: `action` do trigger quyết định; nếu vì lý do nào đó
   nó rỗng hoặc lạ, suy ra từ chính `detail` thay vì in ra một mã thô. */
export function actionKind(row) {
  const a = row?.action
  if (a && ACTION_LABEL[a]) return a
  const f = changedFields(row?.detail).map((x) => x.key)
  if (f.includes('status')) {
    const st = changedFields(row.detail).find((x) => x.key === 'status')?.to
    if (st === 'denied') return 'deny'
    if (st === 'queued') return 'approve'
    if (st === 'completed') return 'complete'
    return 'requeue'
  }
  if (f.includes('artist') || f.includes('title')) return 'rename'
  if (f.includes('picked_at')) return 'pick'
  if (f.length) return 'edit'
  return 'edit'
}

/* Một dòng đã sẵn sàng để vẽ: việc chính, các trường đã đổi, và tiêu đề mục
   (tên bài lưu lại lúc thao tác — vẫn đọc được sau khi request bị xoá). */
export function describeAction(row) {
  const kind = actionKind(row)
  return {
    id: row?.id ?? null,
    kind,
    labelKey: ACTION_LABEL[kind],
    fields: changedFields(row?.detail),
    subject: row?.label || '',
    actor: row?.actor_name || 'Admin',
    at: row?.created_at || null,
    targetId: row?.target_id || null,
  }
}
