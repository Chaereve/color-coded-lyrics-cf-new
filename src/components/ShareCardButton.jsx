import { useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { useNotify } from '../lib/notify.jsx'
import { makeShareCardBlob, cardFilename } from '../lib/shareCard.js'
import { vnDayKey } from '../lib/season.js'

/* =========================================================
   NÚT "SAVE CARD" — xuất tấm card PNG của một hồ sơ
   ---------------------------------------------------------
   Dùng ở hai chỗ: trang cá nhân công khai (chia sẻ card của người khác)
   và khối About me (card của chính mình). `card` là toàn bộ NỘI DUNG đã
   dịch do nơi gọi ghép (tên, nhãn cột, câu streak…) — nút này chỉ lo ba
   việc: vẽ ra blob, tải xuống theo tên file có tem ngày, và nói thật khi
   môi trường không vẽ được.

   Tên file mang ngày giờ VN (`chaereve-alice-2026-09-22.png`): hai tấm
   card của hai mùa khác nhau không đè lên nhau trong thư mục tải về, và
   nhìn tên file là biết tấm nào cũ.
   ========================================================= */
export default function ShareCardButton({ card, className = '' }) {
  const { t } = useI18n()
  const { push } = useNotify()
  const [busy, setBusy] = useState(false)

  const onSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      /* Tem ngày dán lúc BẤM NÚT (không phải lúc render) — luôn là hôm nay
         giờ VN, và giữ được tem riêng nếu nơi gọi tự truyền */
      const blob = await makeShareCardBlob({ ...card, stamp: card?.stamp || vnDayKey(Date.now()) })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = cardFilename(card?.name, card?.stamp || vnDayKey(Date.now()))
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      push({ tone: 'ok', title: t('notif.ok'), body: t('card.saved') })
    } catch {
      /* jsdom / trình duyệt tắt canvas / bộ nhớ cạn: nói thật lý do, không
         hứa suông "đã lưu" */
      push({ tone: 'err', title: t('notif.err'), body: t('card.unsupported') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={`card-btn${className ? ` ${className}` : ''}`}
      onClick={onSave} disabled={busy} title={t('card.tip')}>
      <Icon name="save" size={14} />
      {busy ? t('card.busy') : t('card.save')}
    </button>
  )
}
