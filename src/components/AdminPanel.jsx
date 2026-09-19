import { useEffect, useMemo, useRef, useState } from 'react'
import { isPicked, kindCls, STATUS_META, timeAgo, vnd, usd } from '../lib/meta'
import { MILESTONES, progressOf } from '../lib/db'
import { groupKey, voteTotals } from '../lib/board'
import { useI18n } from '../lib/i18n.jsx'
import MediaAdmin from './MediaAdmin'
import { useModalExit } from '../lib/useModalExit'
import Pager from './Pager'
import { usePager } from '../lib/usePager'

/* Hàng admin cao hơn hàng thường (có nút duyệt / mở sửa) nên mỗi trang
   ít dòng hơn — 10 là vừa một khung modal mà không phải cuộn lâu. */
const PER_PAGE = 10

/* Tên bài tiếng Việt thường bị gõ cả có dấu lẫn không dấu ("Chung Ha" /
   "Chung Hạ" / "chung ha"): hạ mọi ký tự về chữ thường không dấu để một
   từ khoá khớp cả ba. Dùng cho ô tìm kiếm trong panel admin. */
const norm = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

function RequestAdminRow({ r, dup, onReview, onUpdate, onDelete, onPick }) {
  const groupSize = dup && dup.n > 1 ? dup.n : 0
  const { t } = useI18n()
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
    <div className="adm adm-req">
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
            <span className="status" style={{ '--c': STATUS_META[r.status].c }}>{t(`status.${r.status}`)}</span>
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
          onClick={() => confirm(t('adm.confirmDelete')) && onDelete(r.id)}>×</button>
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
                <input type="checkbox" checked={!!r[m.k]}
                  onChange={e => onUpdate(r.id, { [m.k]: e.target.checked, status: 'in_progress' }, { group: true })} />
                <span>{m.label}</span>
                <em>{m.pct}%</em>
              </label>
            ))}
            <div className="steps-pct">{pct}%</div>
          </div>
          <div className="bar" style={{ maxWidth: 'none' }}><i style={{ width: `${pct}%` }} /></div>
          <div className="inline-form">
            <button type="button" className="btn btn-sm" onClick={() => onUpdate(r.id, { status: 'queued' })}>{t('adm.backToQueue')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminPanel({
  open, onClose, rows, orders, media = [], initialTab,
  onReview, onUpdate, onDelete, onOrder, onPick,
  onMediaSave, onMediaCommit, onMediaDelete, onMediaReorder, onMediaViewHome,
}) {
  const { t } = useI18n()
  /* App đổi key mỗi lần mở, nên panel dựng lại đúng với tab được gọi tới */
  const [tab, setTab] = useState(initialTab || 'pending')
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

  useEffect(() => {
    if (!open) return
    const h = (e) => {
      const el = e.target
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) {
        /* đang gõ trong ô search: Esc xoá từ khoá trước, Esc lần nữa mới
           đóng panel — cùng thói quen với ô search ngoài bảng request */
        if (e.key === 'Escape' && el === searchRef.current) {
          e.stopPropagation()
          if (q) { setQ(''); el.select() } else { el.blur(); onClose() }
        }
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, q])

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
     liên quan cho đơn hàng. Khớp cả tiếng Việt có dấu lẫn không dấu. */
  const needle = norm(q)
  const matchReq = (r) => !needle || norm(
    `${r.title} ${r.artist} ${r.requester} ${r.kind} ${r.note || ''} ${r.status}`
  ).includes(needle)
  const matchOrder = (o) => {
    if (!needle) return true
    const req = rows.find(r => r.id === o.request_id)
    const what = o.kind === 'votes'
      ? `${t('order.votes', { n: o.qty })} votes`
      : t('order.paidRequest')
    return norm(`${what} ${o.status} ${req ? `${req.artist} ${req.title} ${req.requester || ''}` : ''}`).includes(needle)
  }

  /* danh sách đang hiển thị theo tab — phân trang chung một chỗ cho cả
     bốn tab, đổi tab hoặc gõ từ khoá là về trang 1 */
  const listRef = useRef(null)
  const base = tab === 'pending' ? pending
    : tab === 'active' ? active
      : tab === 'orders' ? orders
        : tab === 'done' ? others : []
  const shown = tab === 'orders' ? base.filter(matchOrder)
    : tab === 'media' ? base
      : base.filter(matchReq)
  const pg = usePager(shown, PER_PAGE, [tab, q])

  /* giữ nút ở trạng thái "đang lưu" cho tới khi bảng Admin được tải lại */
  const runMedia = async (fn) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const { mounted, closing } = useModalExit(open)
  if (!mounted) return null
  const out = closing ? ' out' : ''

  return (
    <div className={`overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal wide${out}`}>
        <div className="modal-head">
          <div className="modal-tabs">
            <button className={`mtab${tab === 'pending' ? ' on' : ''}`} onClick={() => setTab('pending')}>
              {t('adm.pending')} <span className="c">({pending.length})</span>
            </button>
            <button className={`mtab${tab === 'active' ? ' on' : ''}`} onClick={() => setTab('active')}>
              {t('adm.active')} <span className="c">({active.length})</span>
            </button>
            <button className={`mtab${tab === 'orders' ? ' on' : ''}`} onClick={() => setTab('orders')}>
              {t('adm.orders')} <span className="c">({orderQueue.length})</span>
            </button>
            <button className={`mtab${tab === 'media' ? ' on' : ''}`} onClick={() => setTab('media')}>
              {t('adm.media')} <span className="c">({media.length})</span>
            </button>
            <button className={`mtab${tab === 'done' ? ' on' : ''}`} onClick={() => setTab('done')}>
              {t('adm.done')} <span className="c">({others.length})</span>
            </button>
          </div>
          <button className="x" onClick={onClose} aria-label={t('btn.close')}>×</button>
        </div>

        <div className="modal-body" ref={listRef}>
          {/* Tổng quan đường ống: mỗi chấm mang đúng màu trạng thái của .row
              (--sc gán inline, CSS đọc qua var(--sc)) để admin quét một ánh mắt
              là biết đang nghẽn ở đâu. */}
          <div className="adm-sum">
            {pipeline.map(p => (
              <span className="adm-sum-i" key={p.s} style={{ '--sc': STATUS_META[p.s].c }}>
                <i aria-hidden="true" />{t(`status.${p.s}`)} <b>{p.n}</b>
              </span>
            ))}
          </div>
          {/* tab Videos có cơ chế quản lý riêng nên không lọc theo từ khoá */}
          {tab !== 'media' && (
            <div className="adm-search">
              <span className="searchwrap">
                <input ref={searchRef} className="search"
                  placeholder={t('adm.search')} value={q}
                  onChange={e => setQ(e.target.value)} aria-keyshortcuts="/" />
                {!q && <kbd className="search-kbd" aria-hidden="true">/</kbd>}
              </span>
              {q && (
                <button type="button" className="icon-btn adm-search-clear"
                  title={t('adm.clearSearch')} aria-label={t('adm.clearSearch')}
                  onClick={() => { setQ(''); searchRef.current?.focus() }}>×</button>
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
                  onReview={onReview} onUpdate={onUpdate} onDelete={onDelete} onPick={onPick} />
              ))
          )}
          {/* tab media tự quản lý thứ tự (kéo thả) nên không cắt trang */}
          {tab !== 'media' && <Pager {...pg} onChange={pg.setPage} scrollTo={listRef} />}
        </div>
      </div>
    </div>
  )
}
