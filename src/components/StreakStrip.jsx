import { useMemo } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { STREAK_MILESTONES, streakStats } from '../lib/streak.js'

/* =========================================================
   DẢI CHUỖI NGÀY + BA BADGE CỘT MỐC 7 / 30 / 100
   ---------------------------------------------------------
   Dùng ở HAI nơi (chủ dự án chốt): khối "About me" của chính người xem và
   trang cá nhân công khai — cột mốc là thứ để cộng đồng NHÌN THẤY nhau,
   giống bảng xếp hạng. Luật đếm nằm ở `src/lib/streak.js`, nguồn dấu ngày
   nằm ở bảng `activity_days` (trigger in tự động khi gửi request · vote ·
   bình luận · quay spin, theo lịch Việt Nam).

   `days === null` nghĩa là "không đọc được nguồn" (project chưa chạy
   migration, lỗi mạng) — khối TỰ ẨN. Khác với mảng rỗng: mảng rỗng là sự
   thật "chưa có ngày hoạt động nào" và đáng được nói ra bằng câu
   `streak.none`, không phải bằng một khoảng trống.

   Badge bám `longest` chứ không bám `current`: một cột mốc đã mở là THÀNH
   TÍCH, không tắt lại khi chuỗi hiện tại đứt — người quay lại sau một tuần
   nghỉ không bị trừng phạt thêm lần thứ hai bằng cách mất huy hiệu.
   ========================================================= */
export default function StreakStrip({ days = null, stats = null, now = null }) {
  const { t } = useI18n()
  /* Public profiles receive aggregate stats only; the owner's view may still
     pass raw days so the exact current streak can be calculated locally. */
  const nowMs = useMemo(() => now ?? Date.now(), [now])
  const s = stats || (days ? streakStats(days, nowMs) : null)
  if (!s) return null

  return (
    <div className="streak" role="group" aria-label={t('streak.label')}>
      <span className="streak-flame" title={t('streak.how')} aria-hidden="true">
        <Icon name="flame" size={16} />
      </span>
      {s.current > 0
        ? <b className="streak-num">{t('streak.current', { n: s.current })}</b>
        : <b className="streak-num zero">{t('streak.none')}</b>}
      <span className="streak-longest">{t('streak.longest', { n: s.longest })}</span>
      <span className="streak-miles">
        {STREAK_MILESTONES.map((m) => {
          const got = s.earned.includes(m)
          return (
            <span key={m} className={`streak-mile${got ? ' got' : ''}`}
              title={got ? t('streak.unlocked', { n: m }) : t('streak.locked', { n: m })}>
              <Icon name="flame" size={11} />{m}
            </span>
          )
        })}
      </span>
    </div>
  )
}
