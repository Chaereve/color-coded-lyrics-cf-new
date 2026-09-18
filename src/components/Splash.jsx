import { useI18n } from '../lib/i18n.jsx'

/* =========================================================
   MÀN HÌNH CHỜ
   ---------------------------------------------------------
   Logo được một vệt sáng quét ngang qua (shimmer) — cái duy nhất động
   ở khối này; chữ hiệu cũng chạy ánh kim cùng nhịp. Hết `hide` là tan ra
   chứ không tắt phụt.
   ========================================================= */
export default function Splash({ hide }) {
  const { t } = useI18n()
  return (
    <div className={`splash${hide ? ' hide' : ''}`}>
      <span className="splash-mark">
        <span className="applogo lg-splash">
          <img src="/logo-192.png" alt="chaereve" width="78" height="78" />
        </span>
      </span>
      <div className="splash-title">Chaereve</div>
      <div className="splash-sub">{t('side.tagline')}</div>
      <div className="splash-bar"><i /></div>
    </div>
  )
}
