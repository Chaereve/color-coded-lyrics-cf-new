import { useI18n } from '../lib/i18n.jsx'
import { SPARK_H, SPARK_W, sparkAreaPath, sparkPath, sparkPoints, sparkSummary } from '../lib/sparkline.js'

/* =========================================================
   SPARKLINE — dãy số nhỏ, không thư viện, không ảnh
   ---------------------------------------------------------
   Mục đích duy nhất: trả lời "đang lên hay đang xuống" mà con số tổng không
   nói được. Vì vậy:
     · `aria-hidden` cho hình, và một câu chữ trong `.sr-only` nói tổng + đỉnh;
     · màu lấy từ `--sc` của khối cha, nên cùng một component dùng được cho
       năm sự kiện khác nhau mà không phải truyền bảng màu;
     · không có điểm dữ liệu thì vẫn vẽ khung phẳng (không phải một khung rỗng
       trông như lỗi).
   ========================================================= */
export default function Sparkline({ values = [], label = '', height = SPARK_H, width = SPARK_W }) {
  const { t } = useI18n()
  const points = sparkPoints(values, { width, height })
  const line = sparkPath(points)
  const area = sparkAreaPath(points, height)
  const s = sparkSummary(values)
  const peakLabel = s.peak > 0 ? t('adm.sparkPeak', { d: s.peak }) : t('adm.sparkNoPeak')

  return (
    <span className="adm-spark">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}
        role="img" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        {area && <path className="adm-spark-area" d={area} />}
        {line && <path className="adm-spark-line" d={line} />}
        {points.length === 1 && <circle className="adm-spark-dot" cx={points[0].x} cy={points[0].y} r="2.2" />}
      </svg>
      <span className="sr-only">
        {label ? `${label}: ` : ''}{t('adm.sparkSummary', { total: s.total, peak: peakLabel })}
      </span>
    </span>
  )
}
