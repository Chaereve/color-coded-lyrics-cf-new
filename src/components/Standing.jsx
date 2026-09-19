import { useI18n } from '../lib/i18n.jsx'
import { NEAR_GAP, etaKey } from '../lib/watch'

/* =========================================================
   STANDING — "bài này còn cách vị trí được chốt bao xa"
   ---------------------------------------------------------
   Đây là mẩu thông tin ĐẮT nhất của cả trang mà trước giờ nó chỉ tồn
   tại trong đầu admin: mỗi đợt chốt chỉ lấy MỘT bài (pick_top_request),
   nên "thiếu 2 vote nữa là tới lượt bạn" là câu duy nhất mà người đọc
   làm được điều gì đó — kêu bạn bè bỏ phiếu trước giờ chốt.

   Dùng ở hai nơi: dưới mỗi dòng trên bảng (để người đang xem thấy ngay)
   và trong hộp thông báo (để tin nhắn có nội dung, không chỉ "đã đổi
   trạng thái"). Số liệu lấy từ pickLadder() — xếp theo ĐÚNG luật của
   database, không theo luật của tab Top voted.

   Mốc giờ chốt cụ thể KHÔNG lặp lại ở đây: đồng hồ đếm ngược đã có ở
   khối "Up next" trên đầu bảng, hai chỗ cùng đếm một thứ chỉ tổ lệch.

   PHẦN THỨ HAI — "sớm nhất bao lâu": hạng 9–20 TRƯỚC ĐÂY IM LẶNG HOÀN TOÀN
   (chỉ hạng ≤ 8 mới có câu), mà đó lại đúng là những người cần biết "bao giờ"
   nhất. Sàn thời gian (pickEta) hiện cả khi không có câu nào ở trên, và nó là
   SÀN chứ không phải hẹn: xem chú thích dài trong lib/watch.js.
   ========================================================= */

export default function Standing({ st }) {
  const { t } = useI18n()
  if (!st || st.rank === undefined) return null

  let tx = null, cls = ''
  if (st.rank === 1) { tx = t('standing.lead'); cls = ' is-lead' }
  else if (st.blocked) { tx = t('standing.paidAhead'); cls = ' is-muted' }
  else if (st.gap <= NEAR_GAP) { tx = t('standing.near', { n: st.gap }); cls = st.gap <= 1 ? ' is-hot' : ' is-near' }
  else if (st.rank <= 8) { tx = t('standing.rank', { n: st.rank }); cls = ' is-muted' }

  const eta = st.eta ? etaKey(st.eta.days) : null
  if (!tx && !eta) return null

  return (
    <span className={`standing${cls}`} title={t('standing.rule')}>
      {tx && <b>{tx}</b>}
      {tx && eta && <span className="dot" aria-hidden="true" />}
      {eta && (
        <i className="standing-eta"
          title={t('standing.etaWhy', { d: st.eta.days, c: Math.max(0, st.eta.rank - 1) })}>
          {t(eta.key, { n: eta.n })}
        </i>
      )}
    </span>
  )
}
