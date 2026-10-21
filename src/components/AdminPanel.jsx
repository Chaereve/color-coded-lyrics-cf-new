import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import Progress from './Progress'
import { KIND_META, isPicked, kindCls, statusColor, statusLabel, timeAgo, vnd, usd } from '../lib/meta'
import { MILESTONES, progressOf, fetchAdminActions, fetchRequestHistory, fetchFunnelSummary, hasSupabase } from '../lib/db'
import { aggregateFunnel, conversionRates, FUNNEL_CONVERSIONS, FUNNEL_EVENT_KEYS, seriesByDay, votesPerRequest } from '../lib/funnelSummary.js'
import Sparkline from './Sparkline'
import { allTermsIn, creditText, groupKey, voteTotals } from '../lib/board'
import { copyText } from '../lib/clipboard'
import { safeHttpUrl } from '../lib/safeUrl'
import { csvFileName, downloadText, toCsv } from '../lib/csv'
import { useConfirm } from '../lib/confirm.jsx'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { useTransient } from '../lib/useTransient'
import { here, putUrl } from '../lib/history'
import { ADMIN_ORDER_STATES, ADMIN_TAB_META, ADMIN_TABS, adminQuery, readAdminView } from '../lib/adminTabs.js'
import { ORDER_STATE_LABEL, matchOrderState, orderStats } from '../lib/adminOrders.js'
import { ADMIN_ACTIONS_PER_PAGE, describeAction, shortValue } from '../lib/adminLog.js'
import { ageChip, ageInDays } from '../lib/adminAge.js'
import MediaAdmin from './MediaAdmin'
import { sfx } from '../lib/sfx'
import Pager from './Pager'
import { usePager } from '../lib/usePager'

/* Hàng admin cao hơn hàng thường (có nút duyệt / mở sửa) nên mỗi trang
   ít dòng hơn — 10 là vừa một khung modal mà không phải cuộn lâu. */
const PER_PAGE = 10

/* Loại bài có thật — dùng cho cả ô chọn lẫn phép kiểm khi đọc bộ lọc từ địa chỉ
   (một `?kind=…` gõ tay không được làm bảng lọc ra rỗng). */
const KIND_KEYS = Object.keys(KIND_META)

/* Bộ lọc đang mở đọc từ địa chỉ MỘT lần lúc dựng. Test dựng component bằng SSR
   (không có `window`) nên đây phải là hàm thuần có đường lui. */
const initialView = () => (typeof window === 'undefined'
  ? { q: '', sort: 'default', kind: 'all', ost: 'all', focus: '' }
  : readAdminView(window.location.search, KIND_KEYS, ADMIN_ORDER_STATES))


/* TRẠNG THÁI RỖNG CỦA BẢNG QUẢN TRỊ.
   Một khung trống kèm dòng chữ "Nothing here." là thứ người dùng đọc thành
   "trang bị lỗi" (đúng như ảnh đã gửi ở vòng 12). Trạng thái rỗng phải trả lời
   ba câu: đang thiếu gì (dòng đậm) · vì sao (dòng nhỏ) · làm gì tiếp (nút).
   Danh sách trống vì BỘ LỌC thì lối thoát là bỏ bộ lọc; trống thật thì nói ra
   là nó tự đầy khi có người gửi. */
function EmptyState({ title, body, filtered, q, t, onClear }) {
  return (
    <div className="empty">
      <span className="empty-ico" aria-hidden="true"><Icon name="board" size={18} /></span>
      <b>{title}</b>
      <small>{filtered ? t('adm.noResults', { q: q.trim() || '—' }) : body}</small>
      {filtered && (
        <span className="empty-acts">
          <button type="button" className="btn btn-sm" onClick={onClear}>{t('adm.clearFilters')}</button>
        </span>
      )}
    </div>
  )
}

/* LÝ DO TỪ CHỐI CÓ SẴN — bốn chuyện thật sự xảy ra, không phải bốn câu ví dụ.
   Người nhận request đọc lý do để biết phải làm gì khác đi; "trùng bài" và
   "trùng bài rồi" là hai câu nói cùng một chuyện, và cả hai đều không nói
   được bài trùng là bài nào. Chip chỉ điền vào ô, admin vẫn thêm được phần
   riêng của mình ở sau.
   Giá trị là CHUỖI ĐÃ DỊCH tại chỗ dùng (t()), nên đổi từ điển là đổi luôn
   lý do gửi cho người dùng. */
const denyPresets = (t) => [
  { label: t('adm.denyPreset.dup'), value: t('adm.denyPreset.dup'), },
  { label: t('adm.denyPreset.kind'), value: t('adm.denyPreset.kind') },
  { label: t('adm.denyPreset.link'), value: t('adm.denyPreset.link') },
  { label: t('adm.denyPreset.later'), value: t('adm.denyPreset.later') },
]

/* =========================================================
   Ô TÌM KIẾM — một khuôn cho hai mục
   ---------------------------------------------------------
   Mục request và mục bình luận đều cần đúng một ô như nhau: icon trong ô,
   ký tự `/` gợi ý phím tắt, nút xoá khi có chữ. Chép nguyên khối JSX hai lần
   là mở đường cho hai ô lệch nhau ngay lần sửa sau (lỗi icon lòi ra ngoài
   từng xảy ra đúng ở chỗ này).
   `kbd` chỉ là gợi ý cho người có bàn phím; phím thật do bộ bắt phím của
   trang xử lý.
   ========================================================= */
function SearchBox({ t, q, setQ, inputRef, placeholder }) {
  return (
    <span className="searchwrap">
      <Icon name="search" size={14} className="search-ico" />
      <input ref={inputRef} className="search"
        placeholder={placeholder} aria-label={placeholder}
        value={q} aria-keyshortcuts="/"
        onChange={e => setQ(e.target.value)} />
      {q
        ? <button type="button" className="search-x" title={t('adm.clearSearch')}
            aria-label={t('adm.clearSearch')}
            onClick={() => { setQ(''); inputRef?.current?.focus() }}><Icon name="close" size={13} /></button>
        : <kbd className="search-kbd" aria-hidden="true">/</kbd>}
    </span>
  )
}

function RequestAdminRow({ r, dup, songRows = [], onReview, onUpdate, onDelete, onPick,
  onEdit, select = false, selected = false, onSelect, pickInterval = 4, expired = false, onExpire,
  reveal = null, focused = false }) {
  const groupSize = dup && dup.n > 1 ? dup.n : 0
  const { t } = useI18n()
  /* GHIM CÔNG: chữ để dán vào mô tả video YouTube (tên bài + những người đã
     gửi). Việc này trước đây làm bằng tay — mở bảng, đọc từng dòng, gõ lại
     tên — nên nó thường bị bỏ qua. Người đã gửi request là người làm nên tập
     phim đó; ghi tên họ là thứ duy nhất khiến họ gửi tiếp.
     Nhãn nút đổi tại chỗ sau khi copy thay vì bật toast: mắt đang ở giữa bảng,
     còn toast nằm ở góc màn hình. */
  /* Hộp xác nhận của app, gọi ngay trong hàng: hai việc không hoàn tác được
     (từ chối bài, xoá bài) nằm ở đây chứ không ở thân bảng. */
  const askRaw = useConfirm()
  /* Hộp xác nhận đang mở thì phím tắt của TRANG phải im: `j`/`k` lúc đó là gõ
     trong ô lý do (đã chặn bằng kiểm `typing`), nhưng `a`/`d`/Enter thì vẫn
     lọt tới bảng phía sau lớp phủ và có thể duyệt đúng hàng vừa mới bị từ chối. */
  const modalRef = useRef(false)
  const ask = useCallback(async (opts) => {
    modalRef.current = true
    try { return await askRaw(opts) } finally { modalRef.current = false }
  }, [askRaw])
  const [copied, setCopied] = useState(false)
  const [video, setVideo] = useState(r.video_url || '')
  const [artist, setArtist] = useState(r.artist)
  const [title, setTitle] = useState(r.title)
  /* Ba trường mà `admin_update` không nhận (loại bài, ghi chú, cờ đã trả phí):
     sửa sai loại bài từng phải xoá rồi tạo lại — mất vote và mất lịch sử. */
  const [kind, setKind] = useState(r.kind)
  const [note, setNote] = useState(r.note || '')
  const [paid, setPaid] = useState(!!r.is_paid)
  /* Bàn phím: Enter trên hàng đang trỏ KHÔNG mở một khung riêng — nó đặt
     `reveal.id` cho đúng hàng này, và hàng tự mở. `openManual` là lựa chọn của
     người dùng (bấm Sửa/Đóng), nên nó thắng tín hiệu từ bàn phím; nhờ vậy
     đóng được khung vừa mở bằng Enter mà không cần một effect đồng bộ. */
  const [openManual, setOpenManual] = useState(null)
  const open = openManual ?? (reveal?.id === r.id)
  /* mo form la nap lai ten hien tai (tranh giu ten cu sau khi da luu) */
  const toggleOpen = () => {
    setArtist(r.artist); setTitle(r.title)
    setKind(r.kind); setNote(r.note || ''); setPaid(!!r.is_paid)
    setOpenManual(!open)
  }
  const songClean = { artist: artist.trim(), title: title.trim() }
  const songChanged = songClean.artist !== r.artist || songClean.title !== r.title
  const noteClean = note.trim().slice(0, 300)
  const extrasChanged = kind !== r.kind || noteClean !== (r.note || '') || paid !== !!r.is_paid
  const age = ageChip(r, pickInterval)
  const pct = progressOf(r)
  const picked = isPicked(r)

  return (
    <div id={`adm-row-${r.id}`} tabIndex={-1}
      className={`adm adm-req${selected ? ' on' : ''}${focused ? ' cursor' : ''}`}>
      {select && (
        /* Ô chọn dùng lại đúng component Check của trang (một chỗ vẽ checkbox),
           kèm nhãn ẩn để trình đọc màn hình đọc được là chọn dòng nào. */
        <label className="adm-sel" title={t('adm.selectRow')}>
          <Check checked={selected} onChange={() => onSelect?.(r.id)} />
          <span className="sr-only">{t('adm.selectRow')}</span>
        </label>
      )}
      <div className="nm">
        {/* Tên bài là TIÊU ĐỀ của hàng, nên nó là một thẻ tiêu đề thật (h3):
            bảng quản trị không có cấp tiêu đề nào thì trình đọc màn hình đọc
            một mạch tên bài, người gửi, giờ, số phiếu mà không có chỗ ngắt. */}
        <h3 className="adm-req-t">
          {r.title} <span style={{ color: 'var(--txt-2)', fontWeight: 400 }}>— {r.artist}</span>{' '}
          {r.is_paid && <span className="pill gold">PAID</span>}
          {picked && <span className="pill upnext">{t('adm.picked')}</span>}
        </h3>
        <small>
          <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span>{' '}
          {r.requester}
          <span className="dot dot-inline" aria-hidden="true" />
          {timeAgo(r.created_at, t)}
          <span className="dot dot-inline" aria-hidden="true" />
          {r.votes} {t('adm.votesShort')}
          {/* CHỜ BAO LÂU: một bài nằm ba tuần trông y hệt một bài vừa gửi sáng
              nay, vì chỉ có ô sắp xếp "Waiting longest" — mà phải tự chọn nó.
              Quá nhịp chốt bài thì chip đổi màu và nói ra con số nhịp. */}
          {age && (
            <span className={`pill adm-age${age.overdue ? ' stale' : ''}`}
              title={t('adm.ageTitle', { d: age.days, n: age.interval })}>
              {age.days === 0 ? t('time.now') : t('adm.ageDays', { d: age.days })}
            </span>
          )}
        </small>
        {/* bài này còn request trùng: vote của cả bài đã được cộng dồn khi xếp hạng */}
        {dup && dup.n > 1 && (
          /* Nhãn dài nhất trong hệ và có thể bị cắt bằng ba chấm trên máy hẹp
             (xem `.pill.dup` trong index.css) — nên câu đầy đủ nằm ở `title`. */
          <small>
            <span className="pill dup" title={t('adm.dupTotal', { n: dup.n, v: dup.total })}>
              {t('adm.dupTotal', { n: dup.n, v: dup.total })}
            </span>
          </small>
        )}
        {safeHttpUrl(r.link) && <small><a href={safeHttpUrl(r.link)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--a-2)' }}>{t('adm.sourceLink')}</a></small>}
        {r.note && <small style={{ color: 'var(--txt-2)' }}>“{r.note}”</small>}
        {/* Tiến độ đọc được TỪ HÀNG, không phải mở khung sửa: bài đang làm mà
            không biết đã tới đâu thì admin phải mở từng dòng ra xem — đúng thứ
            mà một bảng quản trị sinh ra để khỏi làm. Khi khung sửa đang mở thì
            thanh này nhường chỗ cho thanh lớn (kèm ba mốc) trong khung, không
            hiển thị cùng một con số hai lần. */}
        {r.status === 'in_progress' && !open && (
          /* Không truyền màu: vạch tự lấy tông của mình (và tự chuyển màu khi
             tick hết mốc). Truyền màu trạng thái vào đây từng làm cho CÙNG MỘT
             bài có hai màu vạch khác nhau ở trang chủ và trong bảng quản trị. */
          <Progress pct={pct} label={t('progress.label')} />
        )}
      </div>

      <div className="adm-acts">
        {r.status === 'pending' ? (
          <>
            <button className="btn btn-sm btn-ok" onClick={() => onReview(r.id, true)}>{t('adm.approve')}</button>
            <button className="btn btn-sm btn-no"
              onClick={async () => {
                const r2 = await ask({
                  title: t('dlg.denyTitle'), body: t('dlg.denyBody'), presets: denyPresets(t),
                  reasonLabel: t('adm.denyPrompt'), videoLabel: t('adm.denyVideo'), confirmLabel: t('adm.deny'),
                })
                if (r2) onReview(r.id, false, r2.reason, r2.videoUrl)
              }}>
              {t('adm.deny')}
            </button>
          </>
        ) : (
          <>
            {expired && <span className="status s-denied" title={t('adm.expiredBody')}>{t('expiry.label')}</span>}
            {!expired && <span className={`status s-${r.status}`} style={{ '--c': statusColor(r.status) }}>{statusLabel(r, t)}</span>}
            {/* Nhịp chốt bài đọc từ CÙNG nguồn với dòng "Next pick" ở trang
                chủ (`settings.pick.interval_days`). Viết cứng `n: 4` ở đây là
                cách lời giải thích lệch khỏi lịch thật ngay khi admin đổi nhịp
                — chú thích một đằng, máy chạy một nẻo. */}
            {(r.status === 'queued' || r.status === 'in_progress') && onPick && (
              <button className="btn btn-sm" onClick={() => onPick(r.id, !picked)}
                title={t('now.pickRule', { n: pickInterval })}>
                {picked ? t('adm.unpick') : t('adm.pick')}
              </button>
            )}
            {expired && onExpire && <button className="btn btn-sm btn-no" onClick={() => onExpire(r.id)}>{t('expiry.delete')}</button>}
            <button className="btn btn-sm" onClick={toggleOpen}>{open ? t('adm.closeEdit') : t('adm.edit')}</button>
          </>
        )}
        <button className="icon-btn" title={t('adm.delete')} aria-label={t('adm.delete')}
          onClick={async () => {
            if (!(await ask({ title: t('adm.confirmDelete'), body: t('dlg.cannotUndo'), confirmLabel: t('adm.delete') }))) return
            sfx.delete(); onDelete(r.id)
          }}><Icon name="close" size={15} /></button>
      </div>

      {/* Khung sửa nằm NGOÀI hàng tên + nút: xuống dòng thành một dải riêng
          chiếm trọn bề rộng khung. Để trong .nm như trước thì trên điện thoại
          nó chen giữa tên và cụm nút, đẩy nút Sửa/Đóng ra khỏi tầm bấm. */}
      {open && (
        <div className="adm-edit">
          <div className="inline-form">
            <input value={artist} maxLength={80} placeholder={t('adm.artist')}
              aria-label={t('adm.artist')} onChange={e => setArtist(e.target.value)} />
            <input value={title} maxLength={80} placeholder={t('adm.songTitle')}
              aria-label={t('adm.songTitle')} onChange={e => setTitle(e.target.value)} />
            <button type="button" className="btn btn-sm"
              disabled={!songClean.artist || !songClean.title || !songChanged}
              onClick={() => onUpdate(r.id, { artist: songClean.artist, title: songClean.title })}>
              {t('adm.saveSong')}
            </button>
          </div>
          {/* LOẠI BÀI · GHI CHÚ · CỜ ĐÃ TRẢ PHÍ — ba trường mà khung sửa cũ
              không có. Một nút Lưu riêng vì đây là đường RPC riêng
              (admin_request_edit): trộn nó vào nút "Lưu tên" là hai thứ khác
              nhau nằm sau một cái nút. */}
          <div className="inline-form adm-edit-extra">
            <select className="sel" value={kind} aria-label={t('adm.kind')}
              onChange={e => setKind(e.target.value)}>
              {Object.keys(KIND_META).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={note} maxLength={300} placeholder={t('adm.notePh')}
              aria-label={t('adm.notePh')} onChange={e => setNote(e.target.value)} />
            <label className="switch adm-edit-paid">
              <Check checked={paid} onChange={e => setPaid(e.target.checked)} />
              <span>{t('adm.paidFlag')}</span>
            </label>
            <button type="button" className="btn btn-sm" disabled={!extrasChanged}
              onClick={() => onEdit?.(r.id, { kind, note: noteClean, is_paid: paid })}>
              {t('adm.saveExtras')}
            </button>
          </div>
          <div className="inline-form">
            <input placeholder={t('adm.videoPh')} value={video}
              aria-label={t('adm.videoPh')} onChange={e => setVideo(e.target.value)} />
            {/* link + hoan thanh la su that cua CA BAI: gan xong thi nhung dong
                trung cung bai cung phai dong lai, neu khong chung mai o 'queued' */}
            <button type="button" className="btn btn-sm"
              title={groupSize ? t('adm.saveDoneGroup', { n: groupSize }) : undefined}
              onClick={() => onUpdate(r.id, { video_url: video, status: 'completed' },
                { group: ['queued', 'in_progress', 'completed'] })}>
              {t('adm.saveDone')}
            </button>
          </div>
          {/* 3 moc tien do: tick o day tinh cho CA BAI, khong rieng dong nay —
              xem doAdminUpdate (opts.group) trong App.jsx. */}
          <div className="steps" title={groupSize ? t('adm.mileGroup', { n: groupSize }) : undefined}>
            {MILESTONES.map(m => (
              <label key={m.k} className={`step${r[m.k] ? ' on' : ''}`}>
                <Check checked={!!r[m.k]}
                  onChange={e => onUpdate(r.id, { [m.k]: e.target.checked, status: 'in_progress' }, { group: true })} />
                <span>{m.label}</span>
                <em>{m.pct}%</em>
              </label>
            ))}
            <div className="steps-pct">{pct}%</div>
          </div>
          {/* Số tổng đã in ở .steps-pct ngay trên nên thanh này không lặp lại
              con số: nó trả lời "còn bao xa", tô theo trạng thái của bài. */}
          <Progress pct={pct} label={t('progress.label')} wide />
          <div className="inline-form">
            {r.status === 'queued' && <button type="button" className="btn btn-sm btn-primary" onClick={() => onUpdate(r.id, { status: 'in_progress' }, { group: true })}>{t('adm.start')}</button>}
            <button type="button" className="btn btn-sm" onClick={() => onUpdate(r.id, { status: 'queued' })}>{t('adm.backToQueue')}</button>
            <button type="button" className={`btn btn-sm adm-copy${copied ? ' done' : ''}`}
              title={t('adm.creditsHint')}
              onClick={async () => {
                const ok = await copyText(creditText({ title: r.title, artist: r.artist, rows: songRows }))
                if (!ok) return
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}>
              {copied ? t('adm.creditsDone') : t('adm.credits')}
            </button>
          </div>
          {/* LỊCH SỬ đứng CUỐI khung sửa: bốn nhóm trên là việc để làm, đây là
              việc đã làm. Đọc lịch sử trước khi sửa cũng được — nhưng nó không
              được đẩy các ô nhập xuống dưới màn hình đầu tiên. */}
          <RequestHistory id={r.id} t={t} />
        </div>
      )}
    </div>
  )
}

/* =========================================================
   LỊCH SỬ CỦA ĐÚNG MỘT BÀI (migration 20261214)
   ---------------------------------------------------------
   Mục "Nhật ký" trả lời "admin đã làm gì". Khi đang sửa một bài, câu hỏi lại
   là "bài NÀY đã qua tay ai" — nên khối này lọc theo id và nằm ngay trong
   khung sửa, chỗ đang có việc.
   Vì nó chỉ được DỰNG khi khung sửa mở (component mount = một lần đọc), không
   cần cờ "đã tải chưa": đóng khung là quên, mở lại là đọc mới. Đổi lại, mỗi
   lần mở khung là một RPC — rẻ hơn nhiều so với việc tải lịch sử của cả 10
   dòng trong trang cho một khung có thể không ai mở.
   Thiếu hàm (chưa chạy migration) thì khối tự biến mất, không phải một khung
   lỗi chen giữa việc đang làm.
   ========================================================= */
function RequestHistory({ id, t }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    fetchRequestHistory(id).then(res => {
      if (!live) return
      setRows(res.rows)
      setTotal(res.total)
      setMissing(!!res.missingSchema)
    }).catch(() => { if (live) setMissing(true) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id])

  if (missing) return null
  return (
    <div className="adm-hist" aria-busy={loading || undefined}>
      <span className="adm-hist-h">{t('adm.histTitle', { n: total })}</span>
      {loading && rows.length === 0 ? (
        <span className="adm-hist-muted">{t('adm.loading')}</span>
      ) : rows.length === 0 ? (
        <span className="adm-hist-muted">{t('adm.histEmpty')}</span>
      ) : (
        rows.map(row => {
          const a = describeAction(row)
          return (
            <div className="adm-log-row" key={a.id}>
              <div className="adm-log-what">
                <b>{t(a.labelKey)}</b>
                {a.fields.length > 0 && (
                  <small className="adm-log-fields">
                    {a.fields.map(f => (
                      <span key={f.key} className="adm-log-field">
                        {t(f.fieldKey)}: {shortValue(f.from, t)} → {shortValue(f.to, t)}
                      </span>
                    ))}
                  </small>
                )}
              </div>
              <small className="adm-log-meta">
                {a.actor}
                <span className="dot dot-inline" aria-hidden="true" />
                {a.at ? timeAgo(a.at, t) : ''}
              </small>
            </div>
          )
        })
      )}
    </div>
  )
}

/* =========================================================
   BẢNG QUẢN TRỊ — MỘT TRANG, KHÔNG PHẢI HỘP THOẠI
   ---------------------------------------------------------
   Đây là chỗ làm việc thật: soát bài mới, duyệt/từ chối, tick mốc tiến độ,
   chốt vào Up next, xử lý đơn, quản lý video. Hộp thoại chỉ hợp với việc
   ngắn; việc kéo dài hàng chục phút thì cần một trang có địa chỉ riêng
   (/admin) để F5 không mất chỗ, mở được ở tab thứ hai bên cạnh trang công
   khai, và không bị khung hộp thoại cắt mất nửa màn hình.

   Thứ tự trên trang: dải số liệu (vừa là bộ chuyển mục, vì mỗi ô đã mang
   đúng con số của mục đó nên không cần thêm một hàng tab đếm lại lần nữa)
   → thanh công cụ (tìm, xếp, chọn nhiều, lọc loại) → danh sách → thanh hành
   động hàng loạt dính đáy.
   ========================================================= */
export default function AdminPanel({
  tab, onTab, rows, orders, media = [],
  onReview, onUpdate, onDelete, onExpire, onOrder, onPick, onBulk, onEdit,
  onMediaSave, onMediaCommit, onMediaDelete, onMediaReorder, onMediaViewHome,
  pickInterval = 4,
}) {
  const { t } = useI18n()
  /* Chốt ngay lúc dựng: dải số liệu và bảng mã mục là HAI cách nhìn của một
     danh sách. Nếu một ngày ai đó sửa `ADMIN_TAB_META` lệch khỏi `ADMIN_TABS`,
     mục mới sẽ có địa chỉ mà không có ô bấm tới — nói ra ở đây rẻ hơn nhiều so
     với việc tự phát hiện. Chỉ chạy ở chế độ phát triển. */
  if (import.meta.env?.DEV) {
    const a = ADMIN_TAB_META.map(m => m.k).join()
    const b = ADMIN_TABS.join()
    if (a !== b) console.warn(`[admin] ADMIN_TAB_META lệch ADMIN_TABS: ${a} ≠ ${b}`)
  }
  const [busy, setBusy] = useState(false)
  /* Đơn hàng đang gửi đi: nút phải khoá NGAY, không đợi realtime tải lại danh
     sách (~400ms). Trước đây bấm "Đã nhận" hai lần trong khoảng đó là gọi
     admin_order hai lần — nay hàm SQL cũng chỉ nhận đơn 'awaiting', đây là
     lớp chặn thứ hai để người dùng không thấy nút nhấp nháy vô nghĩa. */
  const [orderBusy, setOrderBusy] = useState(() => new Set())
  const runOrder = async (id, approve) => {
    if (orderBusy.has(id)) return
    setOrderBusy(prev => new Set(prev).add(id))
    try { await onOrder(id, approve) }
    finally {
      setOrderBusy(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }
  /* Từ khoá tìm kiếm dùng chung cho cả 4 tab danh sách (tab Videos tự quản);
     đổi tab vẫn giữ từ khoá để soát bài ở mọi trạng thái mà không phải gõ lại */
  /* Bộ lọc là MỘT phần của địa chỉ trang: dán địa chỉ cho đồng nghiệp là họ
     thấy đúng danh sách đã lọc, F5 không mất, Back lùi đúng bước. */
  const [init] = useState(initialView)
  const [q, setQ] = useState(init.q)
  const searchRef = useRef(null)
  /* CHỌN NHIỀU ĐỂ XỬ LÝ HÀNG LOẠT — duyệt 10 request trong một lượt bấm thay vì
     mười vòng bấm-nút-chờ-tải-lại. Chỉ bật khi cần; đổi tab / đổi cách xếp /
     gõ từ khoá là bỏ chọn hết, vì một lựa chọn không còn nhìn thấy thì không
     được phép còn hiệu lực. */
  const [pickMode, setPickMode] = useState(false)
  const [sel, setSel] = useState(() => new Set())
  /* CON TRỎ BÀN PHÍM (j/k). Đây là vị trí ĐANG CHỈ, khác với "đang chọn" của
     chế độ chọn nhiều: một cái để đi lại bằng phím, một cái để chạy lệnh hàng
     loạt. Con trỏ tự về -1 khi danh sách đổi (đổi mục, đổi bộ lọc, sang
     trang) — so bằng khoá thay vì effect, để không có nhịp vẽ thừa nào vẽ con
     trỏ cũ trên danh sách mới. */
  const [cur, setCur] = useState({ i: -1, key: '' })
  const [bulkBusy, setBulkBusy] = useState(false)
  /* Thứ tự danh sách. 'default' = đúng thứ tự từng tab vốn có (tab Đang xử lý
     xếp theo tổng vote của cả bài) — ba lựa chọn còn lại là để TRẢ LỜI CÂU HỎI
     KHÁC: bài nào chờ lâu nhất, bài nào nhiều vote nhất, bài nào vừa gửi. */
  const [sortKey, setSortKey] = useState(init.sort)
  /* Lọc theo LOẠI BÀI ngay trong bảng quản trị: admin hay phải gom một loại
     (ví dụ soát hết Full Album trước khi chốt đợt) mà trước đây chỉ lọc được
     bằng cách gõ tên loại vào ô tìm kiếm — gõ "Short" thì ra cả bài có chữ
     short trong tên. */
  const [kindF, setKindF] = useState(init.kind)
  /* Lọc theo TRẠNG THÁI ĐƠN: mục Đơn hàng từng trộn đơn đang chờ với đơn đã
     nhận / đã từ chối, nên muốn soát "còn gì phải làm" phải tự dò từng dòng.
     Cũng nằm trong địa chỉ như các bộ lọc khác. */
  const [ostF, setOstF] = useState(init.ost)
  const goTab = useCallback((k) => { onTab(k); setSel(new Set()) }, [onTab])
  /* Hai việc dưới đây (chọn cả trang, và phím Ctrl/Cmd+A) phụ thuộc những giá
     trị chỉ tính được ở cuối phần thân — cất chúng vào ref để bộ bắt phím khai
     báo TRƯỚC vẫn gọi được bản mới nhất, thay vì phải chép lại phép tính. */
  const pageIdsRef = useRef([])
  const toggleAllPageRef = useRef(null)
  /* Cùng lý do: bộ bắt phím được khai báo TRƯỚC khi biết danh sách đang hiện
     gì, nên nó gọi qua một ref được cập nhật sau mỗi lần vẽ. */
  const navRef = useRef(null)

  /* GHI BỘ LỌC VÀO ĐỊA CHỈ — hoãn 260ms như ô tìm của bảng công khai, để mỗi ký
     tự gõ vào không tạo một lần ghi lịch sử. Mục Videos không có ba bộ lọc này
     nên địa chỉ của nó chỉ mang `tab`. */
  useEffect(() => {
    if (tab == null || typeof window === 'undefined') return
    const id = setTimeout(() => {
      const qs = adminQuery({
        tab,
        q: ['media', 'overview', 'log'].includes(tab) ? '' : q,
        sort: ['media', 'overview', 'log'].includes(tab) ? 'default' : sortKey,
        kind: ['media', 'overview', 'log'].includes(tab) ? 'all' : kindF,
        ost: tab === 'orders' ? ostF : 'all',
      })
      const next = window.location.pathname + qs
      /* Ghi địa chỉ đi qua `putUrl` (src/lib/history.js): trong iframe bị
         sandbox hoặc ở chế độ riêng tư, `replaceState` ném SecurityError —
         gọi thẳng là lỗi bắn ra từ trong effect này và bảng quản trị chết
         giữa lúc đang dùng. Ghi được thì tốt, không thì thôi. */
      if (next !== here()) putUrl({ s: 'admin' }, next)
    }, 260)
    return () => clearTimeout(id)
  }, [tab, q, sortKey, kindF, ostF])

  /* BACK/FORWARD: đọc lại bộ lọc từ địa chỉ, cùng lúc App đọc lại mục đang mở —
     không thì địa chỉ nói một đằng, bảng đang lọc một nẻo. */
  useEffect(() => {
    const onPop = () => {
      const v = readAdminView(window.location.search, KIND_KEYS, ADMIN_ORDER_STATES)
      setQ(v.q); setSortKey(v.sort); setKindF(v.kind); setOstF(v.ost)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* Bàn phím của một TRANG (không còn là hộp thoại nên Esc không đóng gì cả):
       /  → nhảy vào ô tìm kiếm
       Esc trong ô tìm kiếm → xoá từ khoá trước, lần nữa thì rời ô
       Esc ngoài ô tìm kiếm → bỏ chọn hàng loạt (thao tác đang dở, nguy hiểm
                              hơn cả việc cuộn lên đầu trang)
       Ctrl/Cmd+A khi đang chọn nhiều → chọn cả trang đang nhìn
       j / k (hoặc ↓ / ↑) → đi xuống / lên từng hàng
       Enter → mở khung sửa của hàng đang trỏ
       a → duyệt hàng đang trỏ (chỉ hàng đang chờ)
       d → từ chối hàng đang trỏ (mở hộp hỏi lý do, như bấm nút)
     Bốn phím cuối chỉ có nghĩa khi danh sách là danh sách REQUEST; ở mục Đơn
     hàng / Bình luận / Videos chúng không làm gì. Hộp xác nhận đang mở thì
     toàn bộ nhóm này im (xem `modalRef`), vì phía sau lớp phủ vẫn còn bảng.
     Chỉ gắn khi trang đang mở, để không cướp phím của phần còn lại của app. */
  useEffect(() => {
    if (tab == null) return
    const h = (e) => {
      const el = e.target
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) {
        if (e.key === 'Escape' && el === searchRef.current) {
          e.stopPropagation()
          if (q) { setQ(''); el.select() } else el.blur()
        }
        return
      }
      /* Hộp xác nhận đang mở: phần còn lại của trang không được nhận phím. */
      if (modalRef.current) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        const nav = navRef.current
        if (!nav?.canNav) return
        e.preventDefault()
        nav.move(e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)
      } else if (e.key === 'Enter') {
        const nav = navRef.current
        if (!nav?.canNav || nav.cursor < 0) return
        e.preventDefault()
        nav.enter()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        /* CHỌN CẢ TRANG BẰNG BÀN PHÍM — ghi chú của đoạn này vẫn hứa có phím
           này từ đầu, nhưng phần thân thì chưa bao giờ viết: một tính năng chỉ
           tồn tại trong ghi chú. Chỉ chặn Ctrl/Cmd+A khi đang ở chế độ chọn
           nhiều, các trường hợp khác vẫn phải là "chọn hết chữ" của trình duyệt.
           Nhánh này đứng TRƯỚC `a`/`d` của con trỏ: `a` trần mà lọt vào đây thì
           Ctrl+A thành "duyệt bài". */
        if (!pickMode || !pageIdsRef.current.length) return
        e.preventDefault()
        toggleAllPageRef.current?.()
      } else if (e.key === 'a' || e.key === 'A') {
        const nav = navRef.current
        /* `a` trần: duyệt hàng đang trỏ. Không có thì thôi, để trình duyệt làm
           việc của nó. */
        if (!nav?.canNav || !nav.canApprove) return
        e.preventDefault()
        nav.approve()
      } else if (e.key === 'd' || e.key === 'D') {
        const nav = navRef.current
        if (!nav?.canNav || !nav.canDeny) return
        e.preventDefault()
        nav.deny()
      } else if (e.key === 'Escape' && sel.size) {
        setSel(new Set())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tab, q, sel, pickMode])

  const pending = useMemo(() => rows.filter(r => r.status === 'pending'), [rows])
  /* Tab Đang xử lý xếp theo TỔNG vote của cả bài: các request trùng tên bài +
     nghệ sĩ được cộng dồn trước khi so hạng (cùng luật với bảng "Top voted"
     ngoài trang chủ), nên admin nhìn đúng bài đang được đòi nhiều nhất thay vì
     chỉ thấy từng mảnh vote lẻ. */
  const activeRows = useMemo(
    () => rows.filter(r => ['queued', 'in_progress'].includes(r.status)), [rows])
  const totals = useMemo(() => voteTotals(activeRows), [activeRows])
  const active = useMemo(
    () => [...activeRows].sort((a, b) => {
      const ta = totals.get(groupKey(a))?.total ?? (a.votes || 0)
      const tb = totals.get(groupKey(b))?.total ?? (b.votes || 0)
      return (tb - ta)
        || ((b.votes || 0) - (a.votes || 0))
        || (+new Date(a.created_at) - +new Date(b.created_at))
    }),
    [activeRows, totals])
  /* Hộp xác nhận trong app (xem components/ConfirmDialog.jsx): ba việc không
     hoàn tác được — từ chối bài, xoá một bài, và lệnh hàng loạt. */
  const askRaw = useConfirm()
  /* Hộp xác nhận đang mở thì phím tắt của TRANG phải im: `j`/`k` lúc đó là gõ
     trong ô lý do (đã chặn bằng kiểm `typing`), nhưng `a`/`d`/Enter thì vẫn
     lọt tới bảng phía sau lớp phủ và có thể duyệt đúng hàng vừa mới bị từ chối. */
  const modalRef = useRef(false)
  const ask = useCallback(async (opts) => {
    modalRef.current = true
    try { return await askRaw(opts) } finally { modalRef.current = false }
  }, [askRaw])
  const orderQueue = useMemo(() => orders.filter(o => o.status === 'awaiting'), [orders])
  /* (Khối `pipeline` cũ đã bị gỡ: nó tính năm con số mà không chỗ nào đọc —
     dải số liệu lấy số từ `counts`, mỗi ô đúng con số của mục nó mở ra.) */
  const others = useMemo(() => rows.filter(r => ['completed', 'denied'].includes(r.status)), [rows])
  const expiredRows = useMemo(() => rows.filter(r => r.expired_at && !r.picked_at && ['pending', 'queued'].includes(r.status)), [rows])
  /* ĐÃ PICK — những bài đang GIỮ SUẤT trong dây chuyền: có `picked_at` và còn
     ở trạng thái queued / in_progress. Đây không phải "bài đã từng được chốt"
     (bài đã xong rơi vào `others`, và cố ý không nằm ở đây): câu hỏi của mục
     này là "suất đang bị chiếm bởi bài nào" — thứ admin cần biết trước khi
     chốt đợt kế tiếp. Xếp theo `picked_at` tăng dần: bài chốt trước đứng
     trước, đúng thứ tự dây chuyền. */
  const pickedRows = useMemo(
    () => rows.filter(r => r.picked_at && ['queued', 'in_progress'].includes(r.status))
      .sort((a, b) => (+new Date(a.picked_at) || 0) - (+new Date(b.picked_at) || 0)),
    [rows])
  /* Số đơn theo trạng thái + tiền ĐÃ NHẬN trong 30 ngày. Tính trên TOÀN BỘ đơn
     đã tải, không phải trang đang nhìn: doanh thu không được đổi khi admin
     bấm sang trang 2 hay gõ một từ khoá. */
  const oStats = useMemo(() => orderStats(orders), [orders])
  /* Bài đang chờ lâu nhất — null khi không còn bài nào chờ, để màn hình nói
     được "không có gì tồn" thay vì "0 ngày". */
  const oldestPending = useMemo(() => {
    const waiting = rows.filter(r => r.status === 'pending' && !r.picked_at)
    if (!waiting.length) return null
    return waiting.reduce((max, r) => Math.max(max, ageInDays(r.created_at)), 0)
  }, [rows])

  /* Lọc từ khoá trên ĐÚNG những cột admin đang nhìn: tên bài / nghệ sĩ /
     người gửi / loại / ghi chú cho request; loại đơn + tên bài của request
     liên quan cho đơn hàng. Bỏ dấu + so theo từ bằng `allTermsIn()` — đúng
     hàm mà ô tìm trên bảng công khai dùng, nên hai màn hình không thể trả lời
     khác nhau cho cùng một từ khoá. */
  /* Bỏ MỌI bộ lọc bằng một cú bấm: trạng thái rỗng vì lọc mà không có lối thoát
     thì người dùng phải tự đoán xem mình đã bấm vào đâu. */
  const clearFilters = () => {
    setQ(''); setKindF('all'); setSortKey('default'); setOstF('all'); setSel(new Set())
  }
  const filtered = !!q.trim() || kindF !== 'all' || sortKey !== 'default' || ostF !== 'all'
  /* So THEO TỪ bằng đúng hàm mà bảng công khai dùng (`allTermsIn` trong
     lib/board.js): bỏ dấu, hạ chữ thường, và mỗi từ trong từ khoá được dò độc
     lập nên "Whiplash aespa" với "aespa Whiplash" ra cùng một kết quả. Bản cũ
     là một phép `includes` cả chuỗi, tức là admin phải gõ đúng thứ tự cột. */
  const matchReq = (r) => allTermsIn(
    `${r.title} ${r.artist} ${r.requester} ${r.kind} ${r.note || ''} ${r.status}`, q)
  const matchOrder = (o) => {
    const req = rows.find(r => r.id === o.request_id)
    const what = o.kind === 'votes'
      ? `${t('order.votes', { n: o.qty })} votes`
      : t('order.paidRequest')
    return allTermsIn(`${what} ${o.status} ${req ? `${req.artist} ${req.title} ${req.requester || ''}` : ''}`, q)
  }

  /* danh sách đang hiển thị theo tab — phân trang chung một chỗ cho cả
     bốn tab, đổi tab hoặc gõ từ khoá là về trang 1 */
  const listRef = useRef(null)
  const base = tab === 'pending' ? pending
    : tab === 'active' ? active
      : tab === 'expired' ? expiredRows
        : tab === 'orders' ? orders
        : tab === 'done' ? others
        : tab === 'picked' ? pickedRows : []
  /* NHẬT KÝ THAO TÁC — đọc theo trang, cùng khuôn với bình luận. `logMissing`
     là trạng thái "RPC chưa có" (database chưa chạy migration 20261213): nói
     ra việc cần làm thay vì một khung lỗi đỏ cho một tính năng chỉ-đọc. */
  const [logRows, setLogRows] = useState([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState('')
  const [logMissing, setLogMissing] = useState(false)
  /* Metric funnel chỉ tải khi trang admin đã được mở, một RPC duy nhất; nút
     Làm mới là cách cập nhật tường minh — tuyệt đối không polling / cron. */
  const [funnelRows, setFunnelRows] = useState([])
  const [funnelLoading, setFunnelLoading] = useState(true)
  const [funnelLoaded, setFunnelLoaded] = useState(false)
  const [funnelError, setFunnelError] = useState(false)
  /* Cửa sổ số liệu: 7 ngày (nhịp làm việc) hay 30 ngày (nhịp tháng). Một con
     số 7 ngày không nói được "tháng này khác tháng trước thế nào", và RPC đã
     nhận sẵn tham số này — chỉ là giao diện chưa từng cho chọn. */
  const [funnelDays, setFunnelDays] = useState(7)
  const applyFunnelRows = useCallback((data) => {
    setFunnelRows(data)
    setFunnelLoaded(true)
  }, [])
  const failFunnel = useCallback(() => {
    /* Không hiện chi tiết Postgres/RPC; bản dựng schema thiếu cũng dùng một
       câu hướng dẫn migration, người dùng không cần đọc mã kỹ thuật. */
    setFunnelError(true)
  }, [])
  const loadFunnel = useCallback((days = funnelDays) => {
    setFunnelLoading(true)
    setFunnelError(false)
    fetchFunnelSummary(days).then(applyFunnelRows).catch(failFunnel).finally(() => setFunnelLoading(false))
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `days` là tham số, `funnelDays` là mặc định */
  }, [applyFunnelRows, failFunnel, funnelDays])
  const funnelTotals = useMemo(() => aggregateFunnel(funnelRows), [funnelRows])
  /* Cùng những dòng RPC đã tải, nhưng giữ lại TRỤC NGÀY: sparkline cần dãy,
     không cần tổng. Ngày không có sự kiện là 0 trong dãy, không bị bỏ đi. */
  const funnelSeries = useMemo(() => seriesByDay(funnelRows, funnelDays), [funnelRows, funnelDays])
  const conv = useMemo(() => conversionRates(funnelTotals), [funnelTotals])
  const perRequest = useMemo(() => votesPerRequest(funnelTotals), [funnelTotals])
  /* FUNNEL CHỈ ĐỌC KHI TỔNG QUAN ĐANG MỞ. Trước đây thẻ này nằm trên MỌI mục
     của bảng quản trị, nên mở trang để duyệt bài là mất thêm một vòng RPC và
     một khối chiếm chỗ mà không ai đọc. Nay: mở Tổng quan mới đọc, và đổi cửa
     sổ 7/30 ngày cũng đọc lại.
     Loading ban đầu đã true: effect chỉ nhận kết quả bất đồng bộ, không
     setState đồng bộ khi mở admin, và cũng không khởi động poll. */
  useEffect(() => {
    if (tab !== 'overview') return undefined
    let alive = true
    setFunnelLoading(true)
    fetchFunnelSummary(funnelDays)
      .then(data => { if (alive) applyFunnelRows(data) })
      .catch(() => { if (alive) failFunnel() })
      .finally(() => { if (alive) setFunnelLoading(false) })
    return () => { alive = false }
  }, [tab, funnelDays, applyFunnelRows, failFunnel])

  const loadLog = useCallback((page = 1) => {
    setLogLoading(true)
    setLogError('')
    return fetchAdminActions({ page, perPage: ADMIN_ACTIONS_PER_PAGE }).then(res => {
      setLogRows(res.rows || [])
      setLogTotal(res.total || 0)
      setLogPage(res.page || 1)
      setLogMissing(!!res.missingSchema)
    }).catch(error => {
      setLogError(errMsg(t, error))
    }).finally(() => {
      setLogLoading(false)
    })
  }, [t])

  /* Đọc một lần khi mở trang (dải số liệu có ô Nhật ký), rồi chỉ tải lại khi
     admin bấm Làm mới hoặc đổi trang. Không polling: nhật ký là để tra cứu. */
  useEffect(() => {
    const id = setTimeout(() => loadLog(1), 0)
    return () => clearTimeout(id)
  }, [loadLog])

  const order = (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
  const sortList = (list) => {
    if (sortKey === 'default') return list
    const out = [...list]
    /* Đơn hàng không có `votes` mà có `qty` — "nhiều vote nhất" ở mục Đơn hàng
       đọc là "đơn lớn nhất", cùng một câu hỏi. */
    if (sortKey === 'votes') return out.sort((a, b) =>
      ((b.votes ?? b.qty) || 0) - ((a.votes ?? a.qty) || 0) || order(a, b))
    if (sortKey === 'waiting') return out.sort((a, b) => -order(a, b))
    return out.sort(order)
  }
  const shown = tab === 'orders' ? sortList(base.filter(o => matchOrderState(o, ostF) && matchOrder(o)))
    : tab === 'media' ? base
    : tab === 'log' ? logRows
      : sortList(base.filter(r => matchReq(r) && (kindF === 'all' || r.kind === kindF)))
  const pg = usePager(shown, PER_PAGE, [tab, q, sortKey, kindF, ostF])
  /* Lựa chọn chỉ tính trên những dòng ĐANG nhìn thấy: đổi trang hay đổi tab thì
     phần đã chọn mà không còn hiện không được lặng lẽ nằm trong lệnh hàng loạt. */
  const selIds = pg.items.map(r => r.id).filter(id => sel.has(id))
  const toggleSel = (id) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  /* ================= CON TRỎ BÀN PHÍM (j/k, Enter, a, d) =================
     Một hàng dưới con trỏ, khác hẳn "đang chọn" của chế độ chọn nhiều. Con trỏ
     sống theo danh sách đang nhìn: đổi mục / bộ lọc / trang thì khoá đổi và
     con trỏ tự về -1 (`cur.key !== listKey`), không cần một effect đồng bộ. */
  const listKey = `${tab}|${q}|${sortKey}|${kindF}|${ostF}|${pg.page}`
  const cursor = cur.key === listKey ? cur.i : -1
  const isRequestList = !['overview', 'media', 'log', 'orders'].includes(tab)
  const cursorRow = cursor >= 0 ? pg.items[cursor] : null
  const canApprove = !!cursorRow && cursorRow.status === 'pending'
  const canDeny = canApprove
  const moveCursor = (delta) => {
    const n = pg.items.length
    if (!n) return
    const next = cursor < 0 ? (delta > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, cursor + delta))
    setCur({ i: next, key: listKey })
    /* Cuộn và ĐƯA TIÊU ĐIỂM vào hàng: người dùng bàn phím không thấy được một
       cái viền ở ngoài màn hình, và trình đọc màn hình chỉ đọc cái đang focus. */
    const id = pg.items[next]?.id
    if (id && typeof document !== 'undefined') {
      const el = document.getElementById(`adm-row-${id}`)
      el?.scrollIntoView({ block: 'nearest' })
      el?.focus?.({ preventScroll: true })
    }
  }
  const [reveal, setReveal] = useState({ id: null, n: 0 })

  /* ================= `?focus=<id>`: MỞ THẲNG MỘT BÀI =====================
     Địa chỉ `/admin?tab=pending&focus=<id>` là thứ dán được vào tin nhắn
     ("vào sửa bài này"), và cũng là đích của nút trong thông báo. Việc mở là
     MỘT LẦN: đọc xong là xoá khỏi state, nên đóng khung sửa rồi F5 vẫn không
     bị mở lại. Nếu bài nằm ở trang khác thì lật sang trang đó trước — một liên
     kết trỏ tới bài không có trên trang đang nhìn là liên kết hỏng. */
  const [focusId, setFocusId] = useState(init.focus)
  useEffect(() => {
    if (!focusId) return undefined
    const idx = shown.findIndex(r => r.id === focusId)
    /* Không có trong danh sách đang lọc: bài đã bị xoá, hoặc focus trỏ sang
       mục khác. Bỏ im lặng — dựng một khung sửa rỗng còn tệ hơn. */
    if (idx < 0) { setFocusId(''); return undefined }
    const want = Math.floor(idx / PER_PAGE) + 1
    if (want !== pg.page) { pg.setPage(want); return undefined }
    /* Chờ một nhịp cho hàng kịp có trong DOM rồi mới cuộn và mở. */
    const id = setTimeout(() => {
      const el = document.getElementById(`adm-row-${focusId}`)
      el?.scrollIntoView({ block: 'center' })
      setCur({ i: idx - (pg.page - 1) * PER_PAGE, key: listKey })
      setReveal({ id: focusId, n: 1 })
      setFocusId('')
    }, 0)
    return () => clearTimeout(id)
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- `shown`/`pg` là giá trị dẫn xuất, `focusId` là thứ khởi động */
  }, [focusId, shown, pg.page, listKey])

  /* ================= "CÓ BÀI MỚI" =================
     Realtime của App đã tự đẩy dòng mới vào danh sách. Nhưng đẩy IM LẶNG nghĩa
     là danh sách nhảy dưới tay người đang soát: họ đọc dòng thứ ba, một bài mới
     chèn lên đầu, và cú bấm Duyệt rơi vào bài khác. Nên khi có dòng mới, đếm nó
     và nói ra — người dùng tự quyết định lúc nào nhìn. */
  const seenRef = useRef(null)
  const [fresh, setFresh] = useState(0)
  useEffect(() => {
    const ids = new Set(rows.map(r => r.id))
    if (seenRef.current) {
      let n = 0
      rows.forEach(r => { if (r.status === 'pending' && !seenRef.current.has(r.id)) n += 1 })
      if (n) setFresh(f => f + n)
    }
    seenRef.current = ids
  }, [rows])
  const navEnter = () => {
    const row = pg.items[cursor]
    if (!row) return
    setReveal({ id: row.id, n: reveal.n + 1 })
  }
  const navApprove = () => {
    if (canApprove) onReview(cursorRow.id, true)
  }
  const navDeny = async () => {
    if (!canDeny) return
    const row = cursorRow
    const r2 = await ask({
      title: t('dlg.denyTitle'), body: t('dlg.denyBody'), presets: denyPresets(t),
      reasonLabel: t('adm.denyPrompt'), videoLabel: t('adm.denyVideo'), confirmLabel: t('adm.deny'),
    })
    if (r2) onReview(row.id, false, r2.reason, r2.videoUrl)
  }
  /* Đăng ký SAU khi vẽ, không ghi trong lúc render: ghi ref trong render là việc
     phụ trong một hàm phải thuần, và React có quyền vẽ lại mà bỏ qua nó. */
  useEffect(() => {
    navRef.current = {
      move: moveCursor, enter: navEnter, approve: navApprove, deny: navDeny,
      canNav: isRequestList && pg.items.length > 0, cursor, canApprove, canDeny,
    }
  })
  const runBulk = async (action) => {
    if (!selIds.length || bulkBusy) return
    /* HAI lệnh hàng loạt hỏi lại trước khi làm, và hỏi bằng hộp của app: xoá
       (không hoàn tác được) và từ chối (người gửi đọc được lý do). Duyệt thì
       không hỏi — đó là việc admin bấm để ĐI TIẾP, hỏi lại chỉ làm chậm tay. */
    let reason = null
    let videoUrl = null
    if (action === 'delete') {
      if (!(await ask({
        title: t('adm.bulkConfirmDelete', { n: selIds.length }),
        body: t('dlg.cannotUndo'), confirmLabel: t('adm.delete'),
      }))) return
      /* XOÁ là thao tác duy nhất trong bảng này không hoàn tác được, nên nó có
         tiếng riêng: trầm và đi xuống, khác hẳn mọi tiếng "xong việc" khác. Một
         tiếng cho cả đợt, không phải mỗi dòng một tiếng. */
      sfx.delete()
    }
    if (action === 'deny') {
      const r2 = await ask({
        title: t('dlg.bulkDenyTitle', { n: selIds.length }), body: t('dlg.denyBody'), presets: denyPresets(t),
        reasonLabel: t('adm.denyPrompt'), videoLabel: t('adm.denyVideo'), confirmLabel: t('adm.deny'),
      })
      if (!r2) return
      reason = r2.reason
      videoUrl = r2.videoUrl
    }
    setBulkBusy(true)
    try { await onBulk(action, selIds, reason, videoUrl); setSel(new Set()) }
    finally { setBulkBusy(false) }
  }

  /* DẢI SỐ LIỆU — vừa là tổng quan, vừa là bộ chuyển mục. Mỗi ô mang ĐÚNG con
     số mà mục đó sẽ liệt kê, nên không cần thêm một hàng tab đếm lại lần nữa:
     một thứ chỉ được đếm ở một chỗ. */
  const counts = useMemo(() => ({
    pending: pending.length, active: active.length, expired: expiredRows.length, orders: orderQueue.length,
    done: others.length, media: media.length, picked: pickedRows.length, log: logTotal,
  }), [pending.length, active.length, expiredRows.length, orderQueue.length, others.length, media.length, pickedRows.length, logTotal])
  const kpis = useMemo(
    () => ADMIN_TAB_META.map(m => ({ ...m, n: counts[m.count] ?? 0 })),
    [counts])
  /* Chọn cả trang đang nhìn: admin soát 10 dòng một lượt, tick từng ô là 10 cú
     bấm cho một việc. Chỉ áp cho những dòng ĐANG HIỆN (giống mọi lệnh hàng loạt
     khác) để lựa chọn không lặng lẽ chạm tới hàng ở trang khác. */
  const pageIds = pg.items.map(r => r.id).filter(Boolean)
  const allPage = pageIds.length > 0 && pageIds.every(id => sel.has(id))
  const toggleAllPage = () => setSel(prev => {
    const next = new Set(prev)
    if (allPage) pageIds.forEach(id => next.delete(id)); else pageIds.forEach(id => next.add(id))
    return next
  })
  /* Đồng bộ vào ref SAU khi vẽ, không ghi trong lúc render: ghi ref trong render
     là việc phụ trong một hàm phải thuần, và React có quyền vẽ lại mà bỏ qua nó.
     Bộ bắt phím chỉ đọc ref khi có người bấm phím — luôn sau lần vẽ gần nhất. */
  useEffect(() => {
    pageIdsRef.current = pageIds
    toggleAllPageRef.current = toggleAllPage
  })

  /* XUẤT CSV — cột khác nhau theo mục: đơn hàng có tiền, request có tiến độ
     và vote. Dùng chung một bảng cột cho mọi mục là mở ra hai chục cột rỗng
     trong file. Xuất ĐÚNG những dòng đang nhìn (đã lọc, đã xếp) — file phải
     khớp với màn hình, không phải với cả database. */
  /* `Saved` trên nút xuất CSV: cờ tự tắt, đồng hồ do hook giữ và dọn (xem
     lib/useTransient.js). */
  const [exported, flashExported] = useTransient(2000)
  const exportCsv = () => {
    const ok = tab === 'orders'
      ? downloadText(csvFileName('orders'), toCsv(shown, [
        { k: 'id', label: 'ID' },
        { k: 'kind', label: 'Type' },
        { k: 'qty', label: 'Votes' },
        { k: 'amount_vnd', label: 'Amount (VND)' },
        { k: 'amount_usd', label: 'Amount (USD)' },
        { k: 'status', label: 'Status' },
        { k: 'created_at', label: 'Created' },
      ]))
      : downloadText(csvFileName(`request-${tab}`), toCsv(shown, [
        { k: 'id', label: 'ID' },
        { k: 'kind', label: 'Type' },
        { k: 'artist', label: 'Artist' },
        { k: 'title', label: 'Title' },
        { k: 'requester', label: 'Requester' },
        { k: 'status', label: 'Status' },
        { k: 'votes', label: 'Votes' },
        { k: 'is_paid', label: 'Paid' },
        { k: 'progress', label: 'Progress %', get: (r) => progressOf(r) },
        { k: 'link', label: 'Source Link' },
        { k: 'video_url', label: 'Video URL' },
        { k: 'note', label: 'Note' },
        { k: 'created_at', label: 'Created' },
      ]))
    if (!ok) return
    /* Nhãn nút đổi tại chỗ rồi tự về: file tải xuống không có phản hồi nào
       khác, và người bấm cần biết lần bấm của mình đã ăn. */
    flashExported()
  }

  /* giữ nút ở trạng thái "đang lưu" cho tới khi bảng Admin được tải lại */
  const runMedia = async (fn) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <section className="adm-page" aria-label={t('adm.pageAria')}>
      {/* DẢI SỐ LIỆU — VỪA LÀ TỔNG QUAN, VỪA LÀ BỘ CHUYỂN MỤC.
          Ô đang mở được tô bằng đúng màu trạng thái của nó, nên "đang đứng ở
          đâu" và "mục này có bao nhiêu việc" đọc trong cùng một cái liếc. */}
      <div className="adm-kpis" role="group" aria-label={t('adm.kpisAria')}>
        {kpis.map(k => (
          <button key={k.k} type="button" className={`adm-kpi${tab === k.k ? ' on' : ''}`}
            style={{ '--sc': k.tone }} aria-pressed={tab === k.k} onClick={() => goTab(k.k)}>
            <span className="k"><i aria-hidden="true" />{t(k.label)}</span>
            <span className="v">{k.n}</span>
          </button>
        ))}
      </div>

      {/* ================= TỔNG QUAN =================
          Thẻ funnel chỉ tồn tại ở mục này. Summary RPC đã gộp theo ngày +
          event; UI chỉ cộng năm event được phép, không nhận tên người, device
          id hay raw log. */}
      {tab === 'overview' && (
        <section className="adm-funnel" aria-labelledby="adm-funnel-title" aria-busy={funnelLoading || undefined}>
          <div className="adm-funnel-head">
            <div>
              <h2 id="adm-funnel-title">{t('adm.funnelTitle', { n: funnelDays })}</h2>
              <p>{t('adm.funnelSubtitle')}</p>
            </div>
            <div className="adm-funnel-acts">
              {/* Cửa sổ 7 ngày là nhịp làm việc; 30 ngày để thấy xu hướng tháng.
                  Hai nút thay vì một ô chọn: chỉ có hai lựa chọn, và cái đang
                  chọn phải đọc được bằng mắt. */}
              <span className="adm-range" role="group" aria-label={t('adm.rangeAria')}>
                {[7, 30].map(d => (
                  <button key={d} type="button"
                    className={`adm-range-btn${funnelDays === d ? ' on' : ''}`}
                    aria-pressed={funnelDays === d}
                    onClick={() => setFunnelDays(d)}>{t('adm.rangeDays', { n: d })}</button>
                ))}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => loadFunnel()} disabled={funnelLoading}>
                {funnelLoading ? t('adm.funnelLoading') : t('adm.funnelRefresh')}
              </button>
            </div>
          </div>
          {funnelError ? (
            <p className="adm-funnel-state" role="status">
              {!hasSupabase ? t('adm.funnelDemo') : t('adm.funnelError')}
            </p>
          ) : funnelLoading && !funnelLoaded ? (
            /* KHUNG CHỜ GIỮ CHỖ: hộp xám đúng kích thước ô số liệu, nên khi số
               về thì trang không nhảy — mắt không phải tìm lại chỗ đang đọc. */
            <div className="adm-funnel-grid" role="status" aria-label={t('adm.funnelLoading')}>
              {FUNNEL_EVENT_KEYS.map(event => (
                <div className="adm-funnel-stat is-loading" key={event}>
                  <span className="sk adm-sk-txt" aria-hidden="true" />
                  <span className="sk adm-sk-num" aria-hidden="true" />
                  <span className="sk adm-sk-spark" aria-hidden="true" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="adm-funnel-grid">
                {FUNNEL_EVENT_KEYS.map(event => (
                  <div className="adm-funnel-stat" key={event}>
                    <span>{t(`adm.funnel.${event}`)}</span>
                    <b>{funnelTotals[event].toLocaleString()}</b>
                    {/* Xu hướng, không phải một con số nữa: tổng 7 ngày nói
                        "bao nhiêu", sparkline nói "đang lên hay xuống". */}
                    <Sparkline values={funnelSeries.series[event]}
                      label={t(`adm.funnel.${event}`)} />
                  </div>
                ))}
              </div>
              {/* TỈ LỆ: ba con số tuyệt đối không trả lời được "người mới bỏ đi
                  ở đâu". Mẫu số 0 hiện "—" chứ không phải 0%. */}
              <div className="adm-conv">
                {FUNNEL_CONVERSIONS.map(({ key, from, to }) => (
                  <div className="adm-conv-item" key={key}>
                    <span>{t(`adm.conv.${key}`)}</span>
                    <b>{conv[key] === null ? '—' : `${conv[key].toFixed(1)}%`}</b>
                    <small>{t('adm.conv.of', {
                      a: funnelTotals[from].toLocaleString(), b: funnelTotals[to].toLocaleString(),
                    })}</small>
                  </div>
                ))}
                {/* Vote trên mỗi request là TỈ SỐ (một bài nhận được 20 vote),
                    không phải phần trăm — kẹp về 100% là nói dối. */}
                <div className="adm-conv-item">
                  <span>{t('adm.conv.votesPerRequest')}</span>
                  <b>{perRequest === null ? '—' : perRequest.toFixed(1)}</b>
                  <small>{t('adm.conv.votesPerRequestHint')}</small>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* `aria-busy` trong lúc chạy thao tác hàng loạt: trình đọc màn hình phải
          biết danh sách đang được ghi, không phải "bảng trống". */}
      {/* CÓ BÀI MỚI: realtime đã đẩy dòng vào danh sách, nhưng nói ra thì người
          đang soát mới biết vì sao danh sách vừa dài thêm. Bấm "Xem" là sang
          hàng đợi xếp mới nhất trước; bấm "×" là giữ nguyên chỗ đang đọc. */}
      {fresh > 0 && isRequestList && (
        <div className="adm-fresh" role="status">
          <span className="adm-fresh-txt">{t('adm.fresh', { n: fresh })}</span>
          <button type="button" className="btn btn-sm btn-ok"
            onClick={() => { setFresh(0); setSortKey('newest'); goTab('pending') }}>
            {t('adm.freshSee')}
          </button>
          <button type="button" className="icon-btn" aria-label={t('adm.freshDismiss')}
            title={t('adm.freshDismiss')} onClick={() => setFresh(0)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      <div className="adm-panel" aria-busy={bulkBusy || undefined}>
        {/* THANH CÔNG CỤ: tìm kiếm → xếp thứ tự → lọc loại bài → chế độ chọn.
            Ô tìm kiếm đứng đầu vì đó là việc admin làm nhiều nhất; nút chọn
            nhiều đứng cuối vì nó đổi cách làm việc của cả trang. */}
        {/* TIÊU ĐỀ MỤC ĐANG MỞ (h2). Dải số liệu ở trên là bộ chuyển mục nên
            không thể vừa là tiêu đề; mà trang không có tiêu đề nào thì trình
            đọc màn hình chỉ nghe được tên các nút. Tên mục + số dòng đang xem
            đứng ngay trên thanh công cụ — dòng "Showing …" cũ nằm dưới thanh
            công cụ và nói lại đúng con số ấy. */}
        {/* TIÊU ĐỀ CHO MỌI MỤC, kể cả Videos: trước đây tab Videos là tab duy
            nhất không có h2, nên bấm vào nó là trang mất tiêu đề — nhìn như một
            màn hình khác. Số đi kèm là số dòng đang xem của chính mục đó. */}
        <h2 className="adm-h2">
          <span>{t(kpis.find(k => k.k === tab)?.label || 'adm.pageAria')}</span>
          <span className="adm-h2-n">{t('adm.showing', {
            /* Bình luận: `n` là số thẻ ĐANG HIỆN, `total` là tổng khớp bộ lọc ở
               database — nên dòng này nói thật "đang xem 20 trong 1.240". */
            n: tab === 'media' ? media.length
              : tab === 'log' ? logRows.length
                : tab === 'overview' ? counts.pending + counts.expired + counts.orders
                  : pg.items.length,
            total: tab === 'media' ? media.length
              : tab === 'log' ? logTotal
                : tab === 'overview' ? counts.pending + counts.expired + counts.orders
                  : shown.length,
          })}</span>
        </h2>

        {tab === 'overview' ? (
          /* Tổng quan không có gì để tìm, xếp hay chọn: nó là ba tấm thẻ đọc
             trong mười giây, mỗi con số dẫn sang mục tương ứng. */
          <div className="adm-bar adm-bar-end" />
        ) : tab === 'log' ? (
          /* Nhật ký chỉ để ĐỌC: không tìm, không xoá, không sửa. Một nút làm
             mới là đủ — và nó nói rõ việc cần làm khi database chưa có bảng. */
          <div className="adm-bar adm-bar-end">
            <button type="button" className="btn btn-sm" onClick={() => loadLog(logPage)}
              disabled={logLoading}>
              {logLoading ? t('adm.loading') : t('adm.refresh')}
            </button>
          </div>
        ) : tab === 'media' ? (
          /* Mục Videos không có gì để tìm hay xếp thứ tự, nhưng vẫn cần ĐÚNG MỘT
             thanh công cụ như mọi mục khác: nút mở trang chủ đứng bên phải, cùng
             chỗ với nhóm nút của các mục còn lại — trước đây nó nằm trong một dải
             riêng (.mgroup-bar) nằm chênh giữa tiêu đề và nhóm đầu tiên. */
          <div className="adm-bar adm-bar-end">
            <button type="button" className="btn btn-sm" onClick={onMediaViewHome}>
              {t('adm.mediaViewHome')}
            </button>
          </div>
        ) : (
          <div className="adm-bar">
            <SearchBox t={t} q={q} setQ={(v) => { setQ(v); setSel(new Set()) }}
              inputRef={searchRef} placeholder={t('adm.search')} />
            <div className="adm-actions">
              {/* TRẠNG THÁI ĐƠN đứng trước cách xếp: câu hỏi "còn gì phải làm"
                  quan trọng hơn "xếp theo gì", và chỉ có ở mục Đơn hàng. */}
              {tab === 'orders' && (
                <select className="sel adm-orderstate" value={ostF}
                  aria-label={t('adm.orderFilterAria')}
                  onChange={e => setOstF(e.target.value)}>
                  <option value="all">{t('adm.orderAll')}</option>
                  {ADMIN_ORDER_STATES.map(st => (
                    <option key={st} value={st}>{t(ORDER_STATE_LABEL[st])}</option>
                  ))}
                </select>
              )}
              <select className="sel adm-sort" value={sortKey} aria-label={t('adm.sortAria')}
                onChange={e => { setSortKey(e.target.value); setSel(new Set()) }}>
                <option value="default">{t('adm.sortDefault')}</option>
                <option value="newest">{t('adm.sortNewest')}</option>
                <option value="votes">{t('adm.sortVotes')}</option>
                <option value="waiting">{t('adm.sortWaiting')}</option>
              </select>
              {tab !== 'orders' && (
                <>
                  <select className="sel" value={kindF} aria-label={t('board.kindAria')}
                    onChange={e => { setKindF(e.target.value); setSel(new Set()) }}>
                    <option value="all">{t('board.allKinds')}</option>
                    {Object.keys(KIND_META).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {/* CHỌN NHIỀU chỉ có nghĩa ở các mục có ô chọn trên từng dòng.
                      Mục Đơn hàng không vẽ ô chọn (mỗi dòng là một đơn, không
                      gộp lệnh hàng loạt được), nên nút này từng bật một chế độ
                      KHÔNG có gì để chọn: bấm vào chỉ thấy giao diện đổi mà
                      không tick được dòng nào. */}
                  <button type="button" className={`btn btn-sm adm-pickbtn${pickMode ? ' on' : ''}`}
                    aria-pressed={pickMode}
                    onClick={() => { setPickMode(v => !v); setSel(new Set()) }}>
                    {pickMode ? t('adm.pickModeOff') : t('adm.pickMode')}
                  </button>
                </>
              )}
              {/* XUẤT CSV: dữ liệu của bảng phải ra được khỏi bảng, và cách không
                  tốn request nào là dựng file ngay trong trình duyệt.
                  Nút này TRƯỚC ĐÂY nằm trong nhóm `tab !== 'orders'`, trong khi
                  hàm xuất đã có sẵn nhánh cột riêng cho đơn hàng — tức là đường
                  xuất đơn hàng viết ra rồi không ai bấm tới được. Nay nó đứng
                  ngoài nhóm đó: mục nào cũng xuất được, đúng cột của mục đó. */}
              <button type="button" className="btn btn-sm adm-export"
                onClick={exportCsv}>
                {exported ? t('adm.exported') : t('adm.export')}
              </button>
            </div>
          </div>
        )}

        {/* SỐ LIỆU ĐƠN HÀNG: câu hỏi "còn gì phải làm" đã có ở dải số liệu;
            câu còn thiếu là "đã thu được bao nhiêu". Con số này tính trên TOÀN
            BỘ đơn đã tải, không phải trang đang nhìn — nên nó không đổi khi
            bấm sang trang khác hay gõ một từ khoá. */}
        {tab === 'orders' && (
          <div className="adm-note adm-order-sum">
            <span>{t('adm.orderSummary', {
              n: oStats.awaiting, paid: oStats.recentPaid, days: oStats.windowDays,
            })}</span>
            <b>{t('adm.orderRevenue', { vnd: vnd(oStats.receivedVnd), usd: usd(oStats.receivedUsd) })}</b>
          </div>
        )}

        {/* DÒNG ĐẾM + CHỌN CẢ TRANG: hai thứ cùng trả lời "tôi đang nhìn gì và
            đang chọn gì", nên nằm chung một hàng. */}
        {!['media', 'log', 'overview'].includes(tab) && (
          <div className="adm-note">
            {pickMode && pageIds.length > 0 && (
              <label className="adm-all">
                <Check checked={allPage} onChange={toggleAllPage} />
                <span>{t('adm.selectPage', { n: pageIds.length })}</span>
              </label>
            )}
            {/* Hai phím tắt của trang này chỉ có trong tài liệu là hai phím
                tắt không ai biết. Dòng gợi ý nằm ngay chỗ dùng, và tự ẩn trên
                thiết bị cảm ứng (không có bàn phím thì đừng hứa). */}
            <span className="adm-keys">
              <kbd>Esc</kbd>{t('adm.keyEsc')}<kbd>Ctrl/Cmd + A</kbd>{t('adm.keyAll')}
              {/* Phím đi lại và phím hành động: in ra chỗ dùng, cùng lý do với
                  hai phím trên — phím tắt không ai biết thì không phải phím
                  tắt. Chỉ hiện ở những mục thật sự có danh sách request. */}
              {isRequestList && (
                <>
                  <kbd>j</kbd><kbd>k</kbd>{t('adm.keyMove')}
                  <kbd>a</kbd>{t('adm.keyApprove')}<kbd>d</kbd>{t('adm.keyDeny')}
                  <kbd>Enter</kbd>{t('adm.keyEdit')}
                </>
              )}
            </span>
          </div>
        )}
        {/* Vùng thông báo: đổi bộ lọc là con số đổi, nhưng mắt thường không
            được báo. Chỉ trình đọc màn hình đọc dòng này. */}
        {!['media', 'log', 'overview'].includes(tab) && (
          <p className="sr-only" role="status">{t('adm.resultCount', { n: shown.length })}</p>
        )}

        {tab === 'overview' ? (
          /* BA CÂU HỎI CỦA NGƯỜI MỞ BẢNG QUẢN TRỊ: còn gì phải làm · bài nào
             đang chờ lâu nhất · đã thu được bao nhiêu. Mỗi ô bấm được và dẫn
             thẳng tới danh sách đã lọc sẵn — con số không đứng một mình. */
          <div className="adm-ov">
            <div className="adm-ov-card">
              <h3>{t('adm.ov.todo')}</h3>
              <button type="button" className="adm-ov-num" onClick={() => goTab('pending')}
                style={{ '--sc': 'var(--pending)' }}>
                <b>{counts.pending}</b>
                <span>{t('adm.pending')}</span>
              </button>
              <button type="button" className="adm-ov-num" onClick={() => goTab('expired')}
                style={{ '--sc': 'var(--denied)' }}>
                <b>{counts.expired}</b>
                <span>{t('adm.expired')}</span>
              </button>
              <button type="button" className="adm-ov-num" onClick={() => goTab('orders')}
                style={{ '--sc': 'var(--paid)' }}>
                <b>{counts.orders}</b>
                <span>{t('adm.orderAwaiting')}</span>
              </button>
            </div>

            <div className="adm-ov-card">
              <h3>{t('adm.ov.waiting')}</h3>
              {oldestPending === null ? (
                <p className="adm-funnel-state">{t('adm.ov.noBacklog')}</p>
              ) : (
                <>
                  <p className="adm-ov-lead">
                    {t(oldestPending === 0 ? 'adm.ov.oldestToday' : 'adm.ov.oldest', { d: oldestPending })}
                  </p>
                  <p className="adm-ov-sub">{t('adm.ov.interval', { n: pickInterval })}</p>
                  {oldestPending > pickInterval && (
                    <p className="adm-ov-warn">{t('adm.ov.overdue', { n: oldestPending - pickInterval })}</p>
                  )}
                </>
              )}
            </div>

            <div className="adm-ov-card">
              <h3>{t('adm.ov.money')}</h3>
              <p className="adm-ov-lead adm-ov-money">{vnd(oStats.receivedVnd)}</p>
              <p className="adm-ov-sub">
                {t('adm.orderRevenueWindow', { days: oStats.windowDays, usd: usd(oStats.receivedUsd) })}
              </p>
              <button type="button" className="btn btn-sm" onClick={() => goTab('orders')}>
                {t('adm.ov.openOrders')}
              </button>
            </div>
          </div>
        ) : tab === 'log' ? (
          <div className="adm-log" aria-busy={logLoading || undefined}>
            {logError && <p role="alert" className="adm-err">{logError}</p>}
            {logMissing ? (
              <div className="empty">
                <b>{t('adm.logMissing')}</b>
                <p>{t('adm.logMissingBody')}</p>
              </div>
            ) : logRows.length === 0 ? (
              <div className="empty">
                <b>{logLoading ? t('adm.loading') : t('adm.logEmpty')}</b>
                <p>{t('adm.logEmptyBody')}</p>
              </div>
            ) : (
              logRows.map(row => {
                const a = describeAction(row)
                return (
                  <div className="adm-log-row" key={a.id}>
                    <div className="adm-log-what">
                      <b>{t(a.labelKey)}</b>
                      {a.subject && <span className="adm-log-subject">{a.subject}</span>}
                      {/* ĐÃ ĐỔI GÌ: cặp cũ → mới, chỉ những trường có nhãn.
                          Không có phần này thì dòng nhật ký chỉ nói "đã sửa",
                          mà "sửa cái gì" mới là câu cần trả lời. */}
                      {a.fields.length > 0 && (
                        <small className="adm-log-fields">
                          {a.fields.map(f => (
                            <span key={f.key} className="adm-log-field">
                              {t(f.fieldKey)}: {shortValue(f.from, t)} → {shortValue(f.to, t)}
                            </span>
                          ))}
                        </small>
                      )}
                    </div>
                    <small className="adm-log-meta">
                      {a.actor}
                      <span className="dot dot-inline" aria-hidden="true" />
                      {a.at ? timeAgo(a.at, t) : ''}
                    </small>
                  </div>
                )
              })
            )}
          </div>
        ) : tab === 'media' ? (
          <MediaAdmin
            media={media} busy={busy}
            onSave={(item) => runMedia(() => onMediaSave(item))}
            onCommit={(p) => runMedia(() => onMediaCommit(p))}
            onDelete={(id) => runMedia(() => onMediaDelete(id))}
            onReorder={(ids) => runMedia(() => onMediaReorder(ids))}
          />
        ) : tab === 'orders' ? (
          shown.length === 0
            ? <EmptyState title={t('adm.noOrders')} body={t('adm.emptyOrdersBody')}
                filtered={filtered} q={q} t={t} onClear={clearFilters} />
            : pg.items.map(o => (
              <div className="adm" key={o.id}>
                <div className="nm">
                  <b>{o.kind === 'votes' ? t('order.votes', { n: o.qty }) : t('order.paidRequest')}</b>
                  <small>
                    {vnd(o.amount_vnd)}
                    <span className="dot dot-inline" aria-hidden="true" />
                    {usd(o.amount_usd)}
                    <span className="dot dot-inline" aria-hidden="true" />
                    {timeAgo(o.created_at, t)}
                  </small>
                  {o.request_id && (
                    <small style={{ color: 'var(--txt-2)' }}>
                      {rows.find(r => r.id === o.request_id)
                        ? `${rows.find(r => r.id === o.request_id).artist} — ${rows.find(r => r.id === o.request_id).title}`
                        : t('adm.reqDeleted')}
                    </small>
                  )}
                </div>
                <div className="adm-acts">
                  {o.status === 'awaiting' ? (
                    <>
                      <button className="btn btn-sm btn-ok" disabled={orderBusy.has(o.id)}
                        onClick={() => runOrder(o.id, true)}>
                        {orderBusy.has(o.id) ? '…' : t('adm.received')}
                      </button>
                      <button className="btn btn-sm btn-no" disabled={orderBusy.has(o.id)}
                        onClick={() => runOrder(o.id, false)}>{t('adm.deny')}</button>
                    </>
                  ) : (
                    <span className={`pill ${o.status === 'paid' ? 'completed' : 'denied'}`}>
                      {o.status === 'paid' ? t('order.paid') : t('order.rejected')}
                    </span>
                  )}
                </div>
              </div>
            ))
        ) : (
          shown.length === 0
            ? <EmptyState title={t(tab === 'picked' ? 'adm.emptyPicked' : 'adm.emptyTitle')}
                body={t(tab === 'picked' ? 'adm.emptyPickedBody' : 'adm.emptyBody')}
                filtered={filtered} q={q} t={t} onClear={clearFilters} />
            : pg.items.map(r => (
              <RequestAdminRow key={r.id} r={r} dup={totals.get(groupKey(r))} pickInterval={pickInterval}
                expired={tab === 'expired'} onExpire={onExpire}
                select={pickMode} selected={sel.has(r.id)} onSelect={toggleSel}
                /* mọi dòng CÙNG BÀI (kể cả đã bị từ chối) để ghim công đủ tên
                   người đã gửi — lọc bằng đúng groupKey mà bảng dùng */
                songRows={rows.filter(x => groupKey(x) === groupKey(r))}
                onReview={onReview} onUpdate={onUpdate} onDelete={onDelete} onPick={onPick}
                onEdit={onEdit} reveal={reveal} focused={cursor >= 0 && pg.items[cursor]?.id === r.id} />
            ))
        )}

        {/* THANH HÀNH ĐỘNG HÀNG LOẠT — dính đáy khung, chỉ hiện khi đang chọn
            nhiều VÀ có ít nhất một dòng được chọn. */}
        {pickMode && selIds.length > 0 && (
          <div className="adm-bulk" role="group" aria-label={t('adm.bulkAria')}>
            <b>{bulkBusy
              ? t('adm.bulkWorking', { n: selIds.length })
              : t('adm.selected', { n: selIds.length })}</b>
            <div className="adm-bulk-acts">
              {tab === 'pending' && (
                <>
                  <button type="button" className="btn btn-sm btn-ok" disabled={bulkBusy}
                    onClick={() => runBulk('approve')}>{t('adm.approve')}</button>
                  <button type="button" className="btn btn-sm btn-no" disabled={bulkBusy}
                    onClick={() => runBulk('deny')}>{t('adm.deny')}</button>
                </>
              )}
              {tab === 'active' && (
                <>
                  <button type="button" className="btn btn-sm" disabled={bulkBusy}
                    onClick={() => runBulk('pick')}>{t('adm.pick')}</button>
                  <button type="button" className="btn btn-sm" disabled={bulkBusy}
                    onClick={() => runBulk('unpick')}>{t('adm.unpick')}</button>
                </>
              )}
              {(tab === 'active' || tab === 'done') && (
                <button type="button" className="btn btn-sm" disabled={bulkBusy}
                  onClick={() => runBulk('queue')}>{t('adm.backToQueue')}</button>
              )}
              <button type="button" className="btn btn-sm btn-no" disabled={bulkBusy}
                onClick={() => runBulk('delete')}>{t('adm.delete')}</button>
              <button type="button" className="btn btn-sm" disabled={bulkBusy}
                onClick={() => setSel(new Set())}>{t('adm.bulkClear')}</button>
            </div>
          </div>
        )}

        {/* Nhật ký phân trang Ở DATABASE (mỗi trang 20 dòng), nên nó có thanh
            phân trang riêng dựa trên `total` thật chứ không dựa trên mảng đã tải. */}
        {tab === 'log' && !logMissing && (
          <Pager
            page={logPage}
            pages={Math.max(1, Math.ceil(logTotal / ADMIN_ACTIONS_PER_PAGE))}
            from={logTotal === 0 ? 0 : (logPage - 1) * ADMIN_ACTIONS_PER_PAGE + 1}
            to={Math.min(logPage * ADMIN_ACTIONS_PER_PAGE, logTotal)}
            total={logTotal}
            onChange={(n) => loadLog(n)}
            scrollTo={listRef}
          />
        )}
        {/* tab media cuộn dọc nên không cắt trang bằng Pager này */}
        {!['media', 'log', 'overview'].includes(tab) && <Pager {...pg} onChange={pg.setPage} scrollTo={listRef} />}
      </div>
    </section>
  )
}
