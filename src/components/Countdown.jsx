import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   COUNTDOWN — còn bao lâu thì tới lượt chốt bài kế tiếp
   ---------------------------------------------------------
   MỘT nguồn duy nhất cho cả trang: hiện nó chỉ đứng ở khối "Up next" trên bảng.
   Hộp thông báo từng nhắc lại đồng hồ này ở nhãn nhóm "Needs your votes" nhưng đã
   bỏ — một dòng chỉ để đọc mà bấm không ra việc gì thì thua một nut Vote now, và
   người dùng yêu cầu đúng như vậy. Luật thật nằm trong
   `pick_top_request()`: cứ `interval_days` (mặc định 4) là chốt đúng MỘT
   bài có tổng vote cao nhất — nên ở đây không được tự đặt lại chu kỳ hay
   suy ra từ bảng vote, chỉ đọc `settings.key = 'pick'`.

   Thiếu mốc thì suy từ last_pick_at + chu kỳ; quá mốc mà chưa thấy mốc
   mới (cron chưa chạy / admin chưa chốt xong) thì hiện "đang chờ chốt" —
   App tự hỏi lại settings ở ngoài, nên khi mốc mới được ghi là nhảy số tiếp.
   ========================================================= */

const DAY = 86_400_000

/* Thời điểm chốt kế tiếp theo đúng luật database: co moc thi dung moc,
   thieu thi suy tu last_pick_at + chu ky ( chinh la cach pick_top_request
   tu ghi moc ke tiep). */
function nextPickAt(pick) {
  const days = pick?.interval_days || 4
  const base = pick?.last_pick_at ? new Date(pick.last_pick_at).getTime() : NaN
  return pick?.next_pick_at
    || (Number.isFinite(base) ? new Date(base + days * DAY).toISOString() : null)
}

export default function Countdown({ pick }) {
  const { t } = useI18n()
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 60_000); return () => clearInterval(id) }, [])

  const days = pick?.interval_days || 4
  const to = nextPickAt(pick)
  if (!to) {
    return (
      <div className="pick-cd" title={t('now.pickRule', { n: days })}>
        <span>{t('now.nextPickLbl')}</span>
        <b>{t('now.everyDays', { n: days })}</b>
      </div>
    )
  }
  const ms = new Date(to) - Date.now()
  if (!Number.isFinite(ms)) return null
  const over = ms <= 0
  const d = Math.floor(ms / DAY)
  const h = Math.floor((ms % DAY) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return (
    <div className={over ? 'pick-cd over' : 'pick-cd'} title={t('now.pickRule', { n: days })}>
      <span>{t('now.nextPickLbl')}</span>
      <b>{over ? t('now.pickSoon') : t('now.nextPick', { d, h, m })}</b>
    </div>
  )
}
