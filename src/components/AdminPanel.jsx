import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import Progress from './Progress'
import { KIND_META, isPicked, kindCls, statusColor, statusLabel, timeAgo, vnd, usd } from '../lib/meta'
import { MILESTONES, progressOf } from '../lib/db'
import { creditText, fold, groupKey, voteTotals } from '../lib/board'
import { copyText } from '../lib/clipboard'
import { useI18n } from '../lib/i18n.jsx'
import MediaAdmin from './MediaAdmin'
import Pager from './Pager'
import { usePager } from '../lib/usePager'

/* Hàng admin cao hơn hàng thường (có nút duyệt / mở sửa) nên mỗi trang
   ít dòng hơn — 10 là vừa một khung modal mà không phải cuộn lâu. */
const PER_PAGE = 10


function RequestAdminRow({ r, dup, songRows = [], onReview, onUpdate, onDelete, onPick,
  select = false, selected = false, onSelect }) {
  const groupSize = dup && dup.n > 1 ? dup.n : 0
  const { t } = useI18n()
  /* GHIM CÔNG: chữ để dán vào mô tả video YouTube (tên bài + những người đã
     gửi). Việc này trước đây làm bằng tay — mở bảng, đọc từng dòng, gõ lại
     tên — nên nó thường bị bỏ qua. Người đã gửi request là người làm nên tập
     phim đó; ghi tên họ là thứ duy nhất khiến họ gửi tiếp.
     Nhãn nút đổi tại chỗ sau khi copy thay vì bật toast: mắt đang ở giữa bảng,
     còn toast nằm ở góc màn hình. */
  const [copied, setCopied] = useState(false)
  const [video, setVideo] = useState(r.video_url || '')
  const [artist, setArtist] = useState(r.artist)
  const [title, setTitle] = useState(r.title)
  const [open, setOpen] = useState(false)
  /* mo form la nap lai ten hien tai (tranh giu ten cu sau khi da luu) */
  const toggleOpen = () => {
    setArtist(r.artist); setTitle(r.title)
    setOpen(o => !o)
  }
  const songClean = { artist: artist.trim(), title: title.trim() }
  const songChanged = songClean.artist !== r.artist || songClean.title !== r.title
  const pct = progressOf(r)
  const picked = isPicked(r)

  return (
    <div className={`adm adm-req${selected ? ' on' : ''}`}>
      {select && (
        /* Ô chọn dùng lại đúng component Check của trang (một chỗ vẽ checkbox),
           kèm nhãn ẩn để trình đọc màn hình đọc được là chọn dòng nào. */
        <label className="adm-sel" title={t('adm.selectRow')}>
          <Check checked={selected} onChange={() => onSelect?.(r.id)} />
          <span className="sr-only">{t('adm.selectRow')}</span>
        </label>
      )}
      <div className="nm">
        <b>
          {r.title} <span style={{ color: 'var(--txt-2)', fontWeight: 400 }}>— {r.artist}</span>{' '}
          {r.is_paid && <span className="pill gold">PAID</span>}
          {picked && <span className="pill upnext">{t('adm.picked')}</span>}
        </b>
        <small>
          <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span>{' '}
          {r.requester}
          <span className="dot dot-inline" aria-hidden="true" />
          {timeAgo(r.created_at, t)}
          <span className="dot dot-inline" aria-hidden="true" />
          {r.votes} {t('adm.votesShort')}
        </small>
        {/* bài này còn request trùng: vote của cả bài đã được cộng dồn khi xếp hạng */}
        {dup && dup.n > 1 && (
          <small><span className="pill dup">{t('adm.dupTotal', { n: dup.n, v: dup.total })}</span></small>
        )}
        {r.link && <small><a href={r.link} target="_blank" rel="noreferrer" style={{ color: 'var(--a-2)' }}>{t('adm.sourceLink')}</a></small>}
        {r.note && <small style={{ color: 'var(--txt-2)' }}>“{r.note}”</small>}
        {/* Tiến độ đọc được TỪ HÀNG, không phải mở khung sửa: bài đang làm mà
            không biết đã tới đâu thì admin phải mở từng dòng ra xem — đúng thứ
            mà một bảng quản trị sinh ra để khỏi làm. Khi khung sửa đang mở thì
            thanh này nhường chỗ cho thanh lớn (kèm ba mốc) trong khung, không
            hiển thị cùng một con số hai lần. */}
        {r.status === 'in_progress' && !open && (
          <Progress pct={pct} label={t('progress.label')} color={statusColor(r.status)} />
        )}
      </div>

      <div className="adm-acts">
        {r.status === 'pending' ? (
          <>
            <button className="btn btn-sm btn-ok" onClick={() => onReview(r.id, true)}>{t('adm.approve')}</button>
            <button className="btn btn-sm btn-no"
              onClick={() => onReview(r.id, false, prompt(t('adm.denyPrompt')) || null)}>
              {t('adm.deny')}
            </button>
          </>
        ) : (
          <>
            <span className="status" style={{ '--c': statusColor(r.status) }}>{statusLabel(r, t)}</span>
            {(r.status === 'queued' || r.status === 'in_progress') && onPick && (
              <button className="btn btn-sm" onClick={() => onPick(r.id, !picked)}
                title={t('now.pickRule', { n: 4 })}>
                {picked ? t('adm.unpick') : t('adm.pick')}
              </button>
            )}
            <button className="btn btn-sm" onClick={toggleOpen}>{open ? t('adm.closeEdit') : t('adm.edit')}</button>
          </>
        )}
        <button className="icon-btn" title={t('adm.delete')} aria-label={t('adm.delete')}
          onClick={() => confirm(t('adm.confirmDelete')) && onDelete(r.id)}><Icon name="close" size={15} /></button>
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
          <Progress pct={pct} label={t('progress.label')} color={statusColor(r.status)} wide />
          <div className="inline-form">
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
        </div>
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
  onReview, onUpdate, onDelete, onOrder, onPick, onBulk,
  onMediaSave, onMediaCommit, onMediaDelete, onMediaReorder, onMediaViewHome,
}) {
  const { t } = useI18n()
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
  const [q, setQ] = useState('')
  const searchRef = useRef(null)
  /* CHỌN NHIỀU ĐỂ XỬ LÝ HÀNG LOẠT — duyệt 10 request trong một lượt bấm thay vì
     mười vòng bấm-nút-chờ-tải-lại. Chỉ bật khi cần; đổi tab / đổi cách xếp /
     gõ từ khoá là bỏ chọn hết, vì một lựa chọn không còn nhìn thấy thì không
     được phép còn hiệu lực. */
  const [pickMode, setPickMode] = useState(false)
  const [sel, setSel] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  /* Thứ tự danh sách. 'default' = đúng thứ tự từng tab vốn có (tab Đang xử lý
     xếp theo tổng vote của cả bài) — ba lựa chọn còn lại là để TRẢ LỜI CÂU HỎI
     KHÁC: bài nào chờ lâu nhất, bài nào nhiều vote nhất, bài nào vừa gửi. */
  const [sortKey, setSortKey] = useState('default')
  /* Lọc theo LOẠI BÀI ngay trong bảng quản trị: admin hay phải gom một loại
     (ví dụ soát hết Full Album trước khi chốt đợt) mà trước đây chỉ lọc được
     bằng cách gõ tên loại vào ô tìm kiếm — gõ "Short" thì ra cả bài có chữ
     short trong tên. */
  const [kindF, setKindF] = useState('all')
  const goTab = useCallback((k) => { onTab(k); setSel(new Set()) }, [onTab])

  /* Bàn phím của một TRANG (không còn là hộp thoại nên Esc không đóng gì cả):
       /  → nhảy vào ô tìm kiếm
       Esc trong ô tìm kiếm → xoá từ khoá trước, lần nữa thì rời ô
       Esc ngoài ô tìm kiếm → bỏ chọn hàng loạt (thao tác đang dở, nguy hiểm
                              hơn cả việc cuộn lên đầu trang)
       Ctrl/Cmd+A khi đang chọn nhiều → chọn cả trang đang nhìn
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
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && sel.size) {
        setSel(new Set())
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tab, q, sel])

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
  const orderQueue = useMemo(() => orders.filter(o => o.status === 'awaiting'), [orders])
  /* Dải tổng quan: admin mở panel là thấy ngay đường ống đang nghẽn ở đâu
     (chờ duyệt / hàng đợi / đang làm / xong / từ chối) mà không phải lướt tab.
     Dẫn lại từ `rows` nên luôn khớp các con số trong tab. */
  const pipeline = useMemo(() => {
    const c = (s) => rows.filter(r => r.status === s).length
    return [
      { s: 'pending', n: c('pending') },
      { s: 'queued', n: c('queued') },
      { s: 'in_progress', n: c('in_progress') },
      { s: 'completed', n: c('completed') },
      { s: 'denied', n: c('denied') },
    ]
  }, [rows])
  const others = useMemo(() => rows.filter(r => ['completed', 'denied'].includes(r.status)), [rows])

  /* Lọc từ khoá trên ĐÚNG những cột admin đang nhìn: tên bài / nghệ sĩ /
     người gửi / loại / ghi chú cho request; loại đơn + tên bài của request
     liên quan cho đơn hàng. Bỏ dấu bằng `fold()` — đúng hàm mà ô tìm trên
     bảng công khai dùng, nên hai màn hình không thể trả lời khác nhau. */
  const needle = fold(q)
  const matchReq = (r) => !needle || fold(
    `${r.title} ${r.artist} ${r.requester} ${r.kind} ${r.note || ''} ${r.status}`
  ).includes(needle)
  const matchOrder = (o) => {
    if (!needle) return true
    const req = rows.find(r => r.id === o.request_id)
    const what = o.kind === 'votes'
      ? `${t('order.votes', { n: o.qty })} votes`
      : t('order.paidRequest')
    return fold(`${what} ${o.status} ${req ? `${req.artist} ${req.title} ${req.requester || ''}` : ''}`).includes(needle)
  }

  /* danh sách đang hiển thị theo tab — phân trang chung một chỗ cho cả
     bốn tab, đổi tab hoặc gõ từ khoá là về trang 1 */
  const listRef = useRef(null)
  const base = tab === 'pending' ? pending
    : tab === 'active' ? active
      : tab === 'orders' ? orders
        : tab === 'done' ? others : []
  const order = (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
  const sortList = (list) => {
    if (sortKey === 'default') return list
    const out = [...list]
    if (sortKey === 'votes') return out.sort((a, b) => (b.votes || 0) - (a.votes || 0) || order(a, b))
    if (sortKey === 'waiting') return out.sort((a, b) => -order(a, b))
    return out.sort(order)
  }
  const shown = tab === 'orders' ? base.filter(matchOrder)
    : tab === 'media' ? base
      : sortList(base.filter(r => matchReq(r) && (kindF === 'all' || r.kind === kindF)))
  const pg = usePager(shown, PER_PAGE, [tab, q, sortKey, kindF])
  /* Lựa chọn chỉ tính trên những dòng ĐANG nhìn thấy: đổi trang hay đổi tab thì
     phần đã chọn mà không còn hiện không được lặng lẽ nằm trong lệnh hàng loạt. */
  const selIds = pg.items.map(r => r.id).filter(id => sel.has(id))
  const toggleSel = (id) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const runBulk = async (action) => {
    if (!selIds.length || bulkBusy) return
    if (action === 'delete' && !confirm(t('adm.bulkConfirmDelete', { n: selIds.length }))) return
    const reason = action === 'deny' ? (prompt(t('adm.denyPrompt')) || null) : null
    setBulkBusy(true)
    try { await onBulk(action, selIds, reason); setSel(new Set()) }
    finally { setBulkBusy(false) }
  }

  /* DẢI SỐ LIỆU — vừa là tổng quan, vừa là bộ chuyển mục. Mỗi ô mang ĐÚNG con
     số mà mục đó sẽ liệt kê, nên không cần thêm một hàng tab đếm lại lần nữa:
     một thứ chỉ được đếm ở một chỗ. */
  const kpis = useMemo(() => [
    { k: 'pending', label: 'adm.pending', c: statusColor('pending'), n: pending.length },
    { k: 'active', label: 'adm.active', c: statusColor('in_progress'), n: active.length },
    { k: 'orders', label: 'adm.orders', c: 'var(--paid)', n: orderQueue.length },
    { k: 'done', label: 'adm.done', c: statusColor('completed'), n: others.length },
    { k: 'media', label: 'adm.media', c: 'var(--a-2)', n: media.length },
  ], [pending.length, active.length, orderQueue.length, others.length, media.length])

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
      <div className="adm-kpis" role="group" aria-label={t('adm.pageAria')}>
        {kpis.map(k => (
          <button key={k.k} type="button" className={`adm-kpi${tab === k.k ? ' on' : ''}`}
            style={{ '--sc': k.c }} aria-pressed={tab === k.k} onClick={() => goTab(k.k)}>
            <span className="k"><i aria-hidden="true" />{t(k.label)}</span>
            <span className="v">{k.n}</span>
          </button>
        ))}
      </div>

      <div className="adm-panel">
        {/* THANH CÔNG CỤ: tìm kiếm → xếp thứ tự → lọc loại bài → chế độ chọn.
            Ô tìm kiếm đứng đầu vì đó là việc admin làm nhiều nhất; nút chọn
            nhiều đứng cuối vì nó đổi cách làm việc của cả trang. */}
        {tab !== 'media' && (
          <div className="adm-bar">
            <span className="searchwrap">
              <Icon name="search" size={14} className="search-ico" />
              <input ref={searchRef} className="search"
                placeholder={t('adm.search')} value={q} aria-keyshortcuts="/"
                onChange={e => { setQ(e.target.value); setSel(new Set()) }} />
              {q
                ? <button type="button" className="search-x" title={t('adm.clearSearch')}
                    aria-label={t('adm.clearSearch')}
                    onClick={() => { setQ(''); searchRef.current?.focus() }}><Icon name="close" size={13} /></button>
                : <kbd className="search-kbd" aria-hidden="true">/</kbd>}
            </span>
            <div className="adm-actions">
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
                  <button type="button" className={`btn btn-sm adm-pickbtn${pickMode ? ' on' : ''}`}
                    aria-pressed={pickMode}
                    onClick={() => { setPickMode(v => !v); setSel(new Set()) }}>
                    {pickMode ? t('adm.pickModeOff') : t('adm.pickMode')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* DÒNG ĐẾM + CHỌN CẢ TRANG: hai thứ cùng trả lời "tôi đang nhìn gì và
            đang chọn gì", nên nằm chung một hàng. */}
        {tab !== 'media' && (
          <div className="adm-note">
            <span>{t('adm.showing', { n: pg.items.length, total: shown.length })}</span>
            {pickMode && pageIds.length > 0 && (
              <label className="adm-all">
                <Check checked={allPage} onChange={toggleAllPage} />
                <span>{t('adm.selectPage', { n: pageIds.length })}</span>
              </label>
            )}
          </div>
        )}

        {tab === 'media' ? (
          <MediaAdmin
            media={media} busy={busy}
            onSave={(item) => runMedia(() => onMediaSave(item))}
            onCommit={(p) => runMedia(() => onMediaCommit(p))}
            onDelete={(id) => runMedia(() => onMediaDelete(id))}
            onReorder={(ids) => runMedia(() => onMediaReorder(ids))}
            onViewHome={onMediaViewHome}
          />
        ) : tab === 'orders' ? (
          shown.length === 0
            ? <div className="empty">{needle ? t('adm.noResults', { q: q.trim() }) : t('adm.noOrders')}</div>
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
            ? <div className="empty">{needle ? t('adm.noResults', { q: q.trim() }) : t('adm.emptyList')}</div>
            : pg.items.map(r => (
              <RequestAdminRow key={r.id} r={r} dup={totals.get(groupKey(r))}
                select={pickMode} selected={sel.has(r.id)} onSelect={toggleSel}
                /* mọi dòng CÙNG BÀI (kể cả đã bị từ chối) để ghim công đủ tên
                   người đã gửi — lọc bằng đúng groupKey mà bảng dùng */
                songRows={rows.filter(x => groupKey(x) === groupKey(r))}
                onReview={onReview} onUpdate={onUpdate} onDelete={onDelete} onPick={onPick} />
            ))
        )}

        {/* THANH HÀNH ĐỘNG HÀNG LOẠT — dính đáy khung, chỉ hiện khi đang chọn
            nhiều VÀ có ít nhất một dòng được chọn. */}
        {pickMode && selIds.length > 0 && (
          <div className="adm-bulk" role="group" aria-label={t('adm.bulkAria')}>
            <b>{t('adm.selected', { n: selIds.length })}</b>
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

        {/* tab media tự quản lý thứ tự (kéo thả) nên không cắt trang */}
        {tab !== 'media' && <Pager {...pg} onChange={pg.setPage} scrollTo={listRef} />}
      </div>
    </section>
  )
}
