import { useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { useCountUp } from '../lib/motion'
import { usePager } from '../lib/usePager'
import { RANK_SORTS, rankRows } from '../lib/ranking.js'
import { PERIODS, seasonRows, seasonWindow, seasonLabel } from '../lib/season.js'
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

function PodiumFace({ p, place, max, sort, period = 'all' }) {
  const { t } = useI18n()
  const n = useCountUp(p[sort.field], 620)
  const pct = max ? Math.round((p[sort.field] / max) * 100) : 0
  /* Hai chỉ báo phụ do chính cách xếp khai (`minis` trong RANK_SORTS): bục chỉ
     đủ chỗ cho hai con số, và hai con số đáng đọc nhất là hai đầu vào của câu
     hỏi đang xem. */
  const minis = sort.minis
  const reward = period === 'week'
    ? (place === 1 ? t('rank.reward.w1') : place === 2 ? t('rank.reward.w2') : place === 3 ? t('rank.reward.w3') : null)
    : period === 'month'
      ? (place === 1 ? t('rank.reward.m1') : place === 2 ? t('rank.reward.m2') : place === 3 ? t('rank.reward.m3') : null)
      : null

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
      {reward && (
        <div className="lb-pod-reward" title={reward}>
          <Icon name="cup" size={11} /> {reward}
        </div>
      )}
    </div>
  )
}

/* Núm chọn mùa — nhóm VIÊN NHẠT (soft chip): cùng hình dáng vỏ với nhóm sắp
   xếp để đọc thành một họ điều khiển, nhưng nút đang chọn chỉ nhuộm nền TÍM
   MỜ (a-soft) với chữ sáng, trong khi nhóm sắp xếp chọn bằng nền ĐẶC sẫm chữ.
   Hai mức đậm/nhạt đó là đủ để phân biệt "đổi phạm vi dữ liệu" với "đổi cách
   nhìn" mà không cần hai hình dáng nút khác nhau — bản tab gạch chân cũ bị
   chê "khó nhìn" vì chữ xám nhỏ trên nền tối, gạch chân 2px mảnh gần như vô
   hình. Nhãn gọi t() nguyên văn từng key vì từ điển có test khoá chết. */
function PeriodSeg({ period, setPeriod, title }) {
  const { t } = useI18n()
  return (
    <div className="lb-tabs lb-periodseg" role="group" aria-label={t('rank.periodLabel')} title={title}>
      {PERIODS.map((p) => (
        <button key={p.k} type="button" className={`lb-tab${period === p.k ? ' on' : ''}`}
          onClick={() => setPeriod(p.k)} aria-pressed={period === p.k}>
          {p.k === 'all' ? t('rank.period.all') : p.k === 'week' ? t('rank.period.week') : t('rank.period.month')}
        </button>
      ))}
    </div>
  )
}

export default function Leaderboard({ rows, allRows = [], ranking = [], meId, initialPeriod = 'all', now = null }) {
  const { t } = useI18n()
  const [sort, setSort] = useState(SORTS[0])
  /* Mùa đang xem: 'all' là bảng toàn thời gian (mặc định, giữ nguyên mọi
     hành vi cũ), 'week'/'month' cắt số liệu theo cửa sổ giờ Việt Nam.
     `initialPeriod`/`now` tồn tại để test render được một ngày cố định. */
  const [period, setPeriod] = useState(PERIODS.some(p => p.k === initialPeriod) ? initialPeriod : 'all')
  /* Mốc "bây giờ" chốt MỘT LẦN lúc mở bảng (deps rỗng): cửa sổ mùa không được
     tự trượt giữa chừng lúc người xem đang nhìn — nửa đêm đi qua thì mùa mới
     là việc của lần mở trang sau. `Date.now()` trong render cũng là thứ mà
     react(purity) bắt, nên nó nằm trong useMemo thay vì thân component. */
  const nowMs = useMemo(() => now ?? Date.now(), [now])

  /* LUẬT CẮT MÙA nằm ở `src/lib/season.js`, không ở đây — component chỉ hỏi.
     `rows` là số tổng (view `requester_ranking` hoặc `rankDemo`); mùa giải
     được gom lại từ `allRows` — toàn bộ hàng request đã tải về máy. */
  const view = useMemo(
    () => (period === 'all' ? (rows || []) : seasonRows(allRows, ranking, period, nowMs)),
    [rows, allRows, ranking, period, nowMs])

  const ranked = useMemo(() => rankRows(view, sort.k), [view, sort.k])

  /* rankRows đã xếp giảm dần nên hàng đầu giữ giá trị lớn nhất — không cần
     quét lại cả mảng chỉ để tìm max. */
  const max = ranked[0] ? Number(ranked[0][sort.field]) || 0 : 0
  const podium = ranked.slice(0, 3)
  const rest = ranked.slice(3)
  const me = ranked.find(p => p.user_id === meId)

  /* đổi cách sắp xếp HOẶC đổi mùa là tập hàng đổi hoàn toàn -> quay lại trang 1 */
  const tableRef = useRef(null)
  const pg = usePager(rest, PER_PAGE, [sort.k, period])

  const win = period === 'all' ? null : seasonWindow(period, nowMs)
  const range = win ? seasonLabel(period, nowMs) : null
  /* Tooltip của nhóm nút mùa = tờ ghi chú của cả chế độ mùa: khoảng ngày đang
     tính, cửa sổ chạy thế nào, và lời thú nhận về cột phiếu (bảng votes không
     có mốc thời gian theo bài nên phiếu là cộng dồn). Đặt Ở ĐÂY chứ không ở
     đầu cột votes vì mùa có ≤3 người thì bảng không dựng, đầu cột không tồn
     tại — còn nhóm nút mùa thì luôn có mặt, kể cả khi mùa trống. */
  const seasonTitle = [
    range ? t('rank.range', { from: range.from, to: range.to }) : null,
    t('rank.rangeTip'),
    period === 'all' ? null : t('rank.votesNote'),
  ].filter(Boolean).join(' · ')

  const isEmpty = !ranked.length

  /* MỘT thanh điều khiển duy nhất. Bản trước xếp ba hàng có viền đáy chồng lên
     nhau (tiêu đề + nút xếp / hàng nút mùa / hàng chú thích phiếu) rồi mới tới
     bục — người xem phải đọc qua ba đường kẻ ngang trước khi thấy một con số,
     và hai nhóm viên thuốc giống hệt nhau không nói được nhóm nào làm gì.
     Nay: chữ bên trái (kicker, tiêu đề, câu luật kèm TEM khoảng ngày, chú
     thích phiếu), điều khiển bên phải xếp hai tầng — tab mùa ở trên, viên thuốc
     sắp xếp ở dưới. Còn đúng MỘT đường viền đáy trước khi vào nội dung. */
  return (
    <div className="lb" data-reveal>
      <div className="lb-bar">
        <div className="lb-bar-tx">
          <span className="lb-kicker">{t('rank.kicker')}</span>
          <h2 className="lb-title">{t('rank.title')}</h2>
          {/* Câu luật ĐÚNG MỘT VẾ, không tem ngày, không chú thích kèm: người
              dùng đã chốt "để mỗi dòng sorted... ở chỗ chú thích là đủ". Khoảng
              ngày và chi tiết cửa sổ sống trong TOOLTIP của nhóm nút mùa (hover
              /hold là đọc được), lời thú nhận về cột phiếu sống trong tooltip
              của đầu cột votes — sự thật vẫn ở đó cho người cần, nhưng không
              bắt thanh tiêu đề phình ra hai ba dòng chữ trên mọi lần mở trang. */}
          {!isEmpty && (
            <p className="lb-rule">
              {period === 'all' ? t(`rank.rule.${sort.k}`) : t(`rank.periodRule.${sort.k}`)}
            </p>
          )}
        </div>
        <div className="lb-bar-ctl">
          <PeriodSeg period={period} setPeriod={setPeriod} title={seasonTitle} />
          {/* Bảng trống thì không còn gì để sắp xếp — giấu nhóm nút cách xếp,
              nhưng GIỮ nút mùa: mùa trống là một câu trả lời thật ("tuần này
              chưa có gì"), và người xem phải còn đường quay về All time. */}
          {!isEmpty && (
            <div className="lb-seg" role="group" aria-label={t('rank.sortLabel')}>
              {SORTS.map((s, i) => (
                <button key={s.k} type="button" className={`lb-segb${sort.k === s.k ? ' on' : ''}`}
                  style={{ '--c': s.tone, '--i': i }} onClick={() => setSort(s)} aria-pressed={sort.k === s.k}>
                  {t(`rank.sort.${s.k}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isEmpty && <div className="empty">{t(`rank.emptyPeriod.${period}`)}</div>}

      {!isEmpty && (
      /* `key` theo mùa: đổi mùa là DỰNG LẠI bục và bảng để hai nhịp đổ xuống
         (podIn của bục, rowIn so le của từng hàng) phát lại từ đầu. Không có
         nó, cú bấm đổi mùa chỉ làm các con số nhảy cóc tại chỗ — bảng trông
         như bị lỗi hơn là vừa chuyển phạm vi. Đổi cách sắp xếp thì KHÔNG remount
         (useCountUp tự đếm từ số cũ sang số mới, và hàng thì vẫn là từng đó
         người, chỉ đổi chỗ) — hai cú chuyển, hai phản hồi khác nhau, có lý.
         Key của bục và của vỏ bảng phải KHÁC nhau (`top-`/`tbl-`): hai khối
         là anh em ruột trong cùng một children array, trùng key là React
         cảnh báo "two children with the same key" ngay trên console. */
      <>
        {period !== 'all' && (
          <div className="lb-season-banner">
            <Icon name="cup" size={13} />
            <span>{period === 'week' ? t('rank.rewards.week') : t('rank.rewards.month')}</span>
          </div>
        )}
        <div key={`top-${period}`} className={`lb-top c${Math.min(podium.length, 3)}`}>
          {/* thứ tự trên màn hình: 2 · 1 · 3 — người xem đọc ra ngay ai nhất */}
          {[podium[1], podium[0], podium[2]].filter(Boolean).map(p => (
            <PodiumFace key={p.key || p.user_id || p.place} p={p} place={p.place} max={max} sort={sort} period={period} />
          ))}
        </div>
      </>
      )}

      {rest.length > 0 && (
        /* Vỏ cuộn ngang dự phòng: table-layout: fixed làm bảng không bao giờ
           tràn nữa, nhưng nếu một ngày nào đó tràn (font lạ, chữ dài bất
           ngờ) thì cuộn NGANG trong khung thay vì bị .lb cắt lụm mất cột. */
        <div key={`tbl-${period}`} className="lb-twrap">
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

      {!isEmpty && <div className={`lb-me${me ? ' has' : ''}`}>
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
      </div>}
    </div>
  )
}
