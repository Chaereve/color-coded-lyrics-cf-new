import { useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { useCountUp } from '../lib/motion'
import { usePager } from '../lib/usePager'
import { RANK_SORTS, rankRows } from '../lib/ranking.js'
import Pager from './Pager'

/* Bục 1-2-3 đã chiếm sẵn ba hạng đầu, phần bảng bên dưới cắt 25 dòng
   một trang — đủ dài để so sánh, đủ ngắn để không phải cuộn qua bảng. */
const PER_PAGE = 25

/* =========================================================
   BẢNG XẾP HẠNG
   ---------------------------------------------------------
   Ba khối:
     · lb-top    — bục 1/2/3, avatar có vòng màu theo hạng, số đếm
                   nhích lên từng nhịp khi vào trang
     · lb-table  — phần còn lại, bảng thật (thead + tbody) nên đọc
                   bằng trình duyệt trợ năng vẫn ra cột
     · lb-me     — hàng của chính người đang xem, dính đáy khối,
                   vì cuộn tới hạng của mình trong danh sách dài là
                   việc không ai muốn làm

   Sắp xếp đổi tại chỗ (không gọi lại server): cùng một dữ liệu, ba
   góc nhìn khác nhau — ai gửi nhiều, ai xong nhiều, ai được vote nhiều.

   LUẬT NẰM Ở `src/lib/ranking.js`, KHÔNG Ở ĐÂY. Bản cũ tự sắp trong
   component bằng một chuỗi `||` và chuỗi đó có hai khoá chết: xếp theo
   phiếu thì khoá phá hoà đầu tiên cũng là phiếu, xếp theo số bài thì khoá
   phá hoà thứ hai cũng là số bài — trùng khoá chính thì khoá đó không bao
   giờ chạy, thứ tự tụt xuống so theo tên. Giờ component chỉ hỏi luật, và
   luật có test riêng khoá bằng số (`ranking.test.js`).
   ========================================================= */

const SORTS = RANK_SORTS

const initials = (name) => (name || '?').trim()[0]?.toUpperCase() || '?'

function Face({ p, size = 'md' }) {
  return p.avatar_url
    ? <img className={`lb-av ${size}`} src={p.avatar_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span className={`lb-av ${size} ph`}>{initials(p.name)}</span>
}

/* số to theo góc nhìn đang chọn, hai dòng nhỏ dưới là hai chỉ báo còn lại
   — không lặp lại đúng một con số hai lần trong cùng một thẻ */
const NUM_LABEL = { total: 'requests', completed: 'completed', total_votes: 'votes' }

function PodiumFace({ p, place, max, sort }) {
  const { t } = useI18n()
  const n = useCountUp(p[sort.field], 620)
  const pct = max ? Math.round((p[sort.field] / max) * 100) : 0
  /* Hai chỉ báo phụ do chính cách xếp khai (`minis` trong RANK_SORTS): bục chỉ
     đủ chỗ cho hai con số, và hai con số đáng đọc nhất là hai đầu vào của câu
     hỏi đang xem. */
  const minis = sort.minis
  return (
    <div className={`lb-pod p${place}`} style={{ '--i': place - 1 }}>
      <span className="lb-medal" aria-hidden="true">
        <Icon name="star" size={16} />
        <b>{place}</b>
      </span>
      <Face p={p} size="lg" />
      <div className="lb-pod-name" title={p.name}>{p.name}</div>
      <div className="lb-pod-num">
        <b key={sort.k}>{n}</b>
        <span>{t(`rank.${NUM_LABEL[sort.field]}`)}</span>
      </div>
      <div className="lb-pod-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="lb-pod-mini">
        {minis.map(f => <span key={f}>{p[f] ?? 0} {t(`rank.${NUM_LABEL[f]}`)}</span>)}
      </div>
    </div>
  )
}

export default function Leaderboard({ rows, meId }) {
  const { t } = useI18n()
  const [sort, setSort] = useState(SORTS[0])

  const ranked = useMemo(() => rankRows(rows, sort.k), [rows, sort.k])

  /* rankRows đã xếp giảm dần nên hàng đầu giữ giá trị lớn nhất — không cần
     quét lại cả mảng chỉ để tìm max. */
  const max = ranked[0] ? Number(ranked[0][sort.field]) || 0 : 0
  const podium = ranked.slice(0, 3)
  const rest = ranked.slice(3)
  const me = ranked.find(p => p.user_id === meId)

  /* đổi cách sắp xếp là thứ tự đổi hoàn toàn -> quay lại trang 1 */
  const tableRef = useRef(null)
  const pg = usePager(rest, PER_PAGE, [sort.k])

  if (!ranked.length) return <div className="empty">{t('rank.empty')}</div>

  return (
    <div className="lb" data-reveal>
      <div className="lb-bar">
        <div className="lb-bar-tx">
          <span className="lb-kicker">{t('rank.kicker')}</span>
          <h2 className="lb-title">{t('rank.title')}</h2>
          {/* Câu nói rõ luật đang chạy. Không còn nhánh riêng cho "điểm": mỗi
              cách xếp chỉ có ĐÚNG MỘT con số, nên câu luật đọc thẳng từ khoá
              của nó và không thể lệch khỏi phép tính đang chạy. */}
          <p className="lb-rule">{t(`rank.rule.${sort.k}`)}</p>
        </div>
        <div className="lb-seg" role="group" aria-label={t('rank.sortLabel')}>
          {SORTS.map((s, i) => (
            <button key={s.k} type="button" className={`lb-segb${sort.k === s.k ? ' on' : ''}`}
              style={{ '--c': s.tone, '--i': i }} onClick={() => setSort(s)} aria-pressed={sort.k === s.k}>
              {t(`rank.sort.${s.k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={`lb-top c${Math.min(podium.length, 3)}`}>
        {/* thứ tự trên màn hình: 2 · 1 · 3 — người xem đọc ra ngay ai nhất */}
        {[podium[1], podium[0], podium[2]].filter(Boolean).map(p => (
          <PodiumFace key={p.key || p.user_id || p.place} p={p} place={p.place} max={max} sort={sort} />
        ))}
      </div>

      {rest.length > 0 && (
        /* Vỏ cuộn ngang dự phòng: table-layout: fixed làm bảng không bao giờ
           tràn nữa, nhưng nếu một ngày nào đó tràn (font lạ, chữ dài bất
           ngờ) thì cuộn NGANG trong khung thay vì bị .lb cắt lụm mất cột. */
        <div className="lb-twrap">
          <table className="lb-table" ref={tableRef}>
          <thead>
            <tr>
              <th className="c-rk" scope="col">#</th>
              <th scope="col">{t('rank.player')}</th>
              {/* Ba cột là ba con số ĐẾM ĐƯỢC — đúng ba con số mà ba cách xếp
                  dùng. Cột "Điểm" (10 × bài xong + phiếu) đã bị gỡ: nó là con
                  số do bảng tự đặt ra, không có ở màn hình nào khác, nên phải
                  kèm một câu giải thích mới đọc được — và vẫn đọc ra kì lạ. */}
              <th className="num" scope="col">{t('rank.requests')}</th>
              <th className="num hide-sm" scope="col">{t('rank.completed')}</th>
              <th className="num" scope="col">{t('rank.votes')}</th>
            </tr>
          </thead>
          <tbody>
            {pg.items.map((p, i) => {
              return (
                <tr key={p.key || p.user_id || p.place} className={p.user_id === meId ? 'me' : ''}
                  /* trễ tính theo vị trí TRONG TRANG: dùng p.place thì
                     sang trang 5 hàng nào cũng đã quá 20 nhịp, cả bảng
                     hiện ra cùng lúc, mất hẳn nhịp đổ xuống */
                  style={{ '--i': Math.min(i, 20) }}>
                  <td className="c-rk"><b>{p.place}</b></td>
                  <td className="c-pl">
                    <span className="lb-pl-in">
                      <Face p={p} />
                      <span className="lb-nm" title={p.name}>{p.name}</span>
                      {p.user_id === meId && <span className="lb-you">{t('rank.you')}</span>}
                    </span>
                    {/* vạch tỉ lệ so với người dẫn đầu — một cái lướt là thấy khoảng cách */}
                    <i className="lb-underline" style={{ width: `${Math.round(p.share * 100)}%` }} aria-hidden="true" />
                  </td>
                  <td className="num">{p.total}</td>
                  <td className="num hide-sm">
                    <b>{p.completed}</b>
                    <span className="lb-rate">{p.rate}%</span>
                  </td>
                  <td className="num lb-votes"><b>{p.total_votes}</b></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      <Pager {...pg} onChange={pg.setPage} scrollTo={tableRef} />

      <div className={`lb-me${me ? ' has' : ''}`}>
        {me ? (
          <>
            <span className="lb-me-rk">{me.place}</span>
            <Face p={me} />
            <span className="lb-me-nm">{me.name}</span>
            <span className="lb-me-stats">
              <span>{t('rank.position', { n: me.place, total: ranked.length })}</span>
              <span className="dot" aria-hidden="true" />
              <span>{me.total} {t('rank.requests')}</span>
              <span className="dot" aria-hidden="true" />
              <span>{me.total_votes} {t('rank.votes')}</span>
            </span>
          </>
        ) : (
          <span className="lb-me-nm">{t('rank.noMe')}</span>
        )}
      </div>
    </div>
  )
}
