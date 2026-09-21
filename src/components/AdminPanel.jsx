import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import Progress from './Progress'
import { KIND_META, isPicked, kindCls, statusColor, statusLabel, timeAgo, vnd, usd } from '../lib/meta'
import { MILESTONES, progressOf } from '../lib/db'
import { allTermsIn, creditText, groupKey, voteTotals } from '../lib/board'
import { copyText } from '../lib/clipboard'
import { csvFileName, downloadText, toCsv } from '../lib/csv'
import { useConfirm } from '../lib/confirm.jsx'
import { useI18n } from '../lib/i18n.jsx'
import { here, putUrl } from '../lib/history'
import { ADMIN_TAB_META, ADMIN_TABS, adminQuery, readAdminView } from '../lib/adminTabs.js'
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
  ? { q: '', sort: 'default', kind: 'all' }
  : readAdminView(window.location.search, KIND_KEYS))


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

function RequestAdminRow({ r, dup, songRows = [], onReview, onUpdate, onDelete, onPick,
  select = false, selected = false, onSelect, pickInterval = 4 }) {
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
  const ask = useConfirm()
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
        {r.link && <small><a href={r.link} target="_blank" rel="noreferrer" style={{ color: 'var(--a-2)' }}>{t('adm.sourceLink')}</a></small>}
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
                  title: t('dlg.denyTitle'), body: t('dlg.denyBody'),
                  reasonLabel: t('adm.denyPrompt'), videoLabel: t('adm.denyVideo'), confirmLabel: t('adm.deny'),
                })
                if (r2) onReview(r.id, false, r2.reason, r2.videoUrl)
              }}>
              {t('adm.deny')}
            </button>
          </>
        ) : (
          <>
            <span className="status" style={{ '--c': statusColor(r.status) }}>{statusLabel(r, t)}</span>
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
  const goTab = useCallback((k) => { onTab(k); setSel(new Set()) }, [onTab])
  /* Hai việc dưới đây (chọn cả trang, và phím Ctrl/Cmd+A) phụ thuộc những giá
     trị chỉ tính được ở cuối phần thân — cất chúng vào ref để bộ bắt phím khai
     báo TRƯỚC vẫn gọi được bản mới nhất, thay vì phải chép lại phép tính. */
  const pageIdsRef = useRef([])
  const toggleAllPageRef = useRef(null)

  /* GHI BỘ LỌC VÀO ĐỊA CHỈ — hoãn 260ms như ô tìm của bảng công khai, để mỗi ký
     tự gõ vào không tạo một lần ghi lịch sử. Mục Videos không có ba bộ lọc này
     nên địa chỉ của nó chỉ mang `tab`. */
  useEffect(() => {
    if (tab == null || typeof window === 'undefined') return
    const id = setTimeout(() => {
      const qs = adminQuery({
        tab,
        q: tab === 'media' ? '' : q, sort: tab === 'media' ? 'default' : sortKey,
        kind: tab === 'media' ? 'all' : kindF,
      })
      const next = window.location.pathname + qs
      /* Ghi địa chỉ đi qua `putUrl` (src/lib/history.js): trong iframe bị
         sandbox hoặc ở chế độ riêng tư, `replaceState` ném SecurityError —
         gọi thẳng là lỗi bắn ra từ trong effect này và bảng quản trị chết
         giữa lúc đang dùng. Ghi được thì tốt, không thì thôi. */
      if (next !== here()) putUrl({ s: 'admin' }, next)
    }, 260)
    return () => clearTimeout(id)
  }, [tab, q, sortKey, kindF])

  /* BACK/FORWARD: đọc lại bộ lọc từ địa chỉ, cùng lúc App đọc lại mục đang mở —
     không thì địa chỉ nói một đằng, bảng đang lọc một nẻo. */
  useEffect(() => {
    const onPop = () => {
      const v = readAdminView(window.location.search, KIND_KEYS)
      setQ(v.q); setSortKey(v.sort); setKindF(v.kind)
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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && pickMode && pageIdsRef.current.length) {
        /* CHỌN CẢ TRANG BẰNG BÀN PHÍM — ghi chú của đoạn này vẫn hứa có phím
           này từ đầu, nhưng phần thân thì chưa bao giờ viết: một tính năng chỉ
           tồn tại trong ghi chú. Chỉ chặn Ctrl/Cmd+A khi đang ở chế độ chọn
           nhiều, các trường hợp khác vẫn phải là "chọn hết chữ" của trình duyệt. */
        e.preventDefault()
        toggleAllPageRef.current?.()
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
  const ask = useConfirm()
  const orderQueue = useMemo(() => orders.filter(o => o.status === 'awaiting'), [orders])
  /* (Khối `pipeline` cũ đã bị gỡ: nó tính năm con số mà không chỗ nào đọc —
     dải số liệu lấy số từ `counts`, mỗi ô đúng con số của mục nó mở ra.) */
  const others = useMemo(() => rows.filter(r => ['completed', 'denied'].includes(r.status)), [rows])

  /* Lọc từ khoá trên ĐÚNG những cột admin đang nhìn: tên bài / nghệ sĩ /
     người gửi / loại / ghi chú cho request; loại đơn + tên bài của request
     liên quan cho đơn hàng. Bỏ dấu + so theo từ bằng `allTermsIn()` — đúng
     hàm mà ô tìm trên bảng công khai dùng, nên hai màn hình không thể trả lời
     khác nhau cho cùng một từ khoá. */
  /* Bỏ MỌI bộ lọc bằng một cú bấm: trạng thái rỗng vì lọc mà không có lối thoát
     thì người dùng phải tự đoán xem mình đã bấm vào đâu. */
  const clearFilters = () => { setQ(''); setKindF('all'); setSortKey('default'); setSel(new Set()) }
  const filtered = !!q.trim() || kindF !== 'all' || sortKey !== 'default'
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
        title: t('dlg.bulkDenyTitle', { n: selIds.length }), body: t('dlg.denyBody'),
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
    pending: pending.length, active: active.length, orders: orderQueue.length,
    done: others.length, media: media.length,
  }), [pending.length, active.length, orderQueue.length, others.length, media.length])
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
  const [exported, setExported] = useState(false)
  const exportCsv = () => {
    const ok = tab === 'orders'
      ? downloadText(csvFileName('don-hang'), toCsv(shown, [
        { k: 'id', label: 'ID' },
        { k: 'kind', label: 'Loai' },
        { k: 'qty', label: 'So vote' },
        { k: 'amount_vnd', label: 'VND' },
        { k: 'amount_usd', label: 'USD' },
        { k: 'status', label: 'Trang thai' },
        { k: 'created_at', label: 'Tao luc' },
      ]))
      : downloadText(csvFileName(`request-${tab}`), toCsv(shown, [
        { k: 'id', label: 'ID' },
        { k: 'kind', label: 'Loai bai' },
        { k: 'artist', label: 'Nghe si' },
        { k: 'title', label: 'Ten bai' },
        { k: 'requester', label: 'Nguoi gui' },
        { k: 'status', label: 'Trang thai' },
        { k: 'votes', label: 'Vote' },
        { k: 'is_paid', label: 'Tra phi' },
        { k: 'progress', label: 'Tien do %', get: (r) => progressOf(r) },
        { k: 'link', label: 'Link nguon' },
        { k: 'video_url', label: 'Video' },
        { k: 'note', label: 'Ghi chu' },
        { k: 'created_at', label: 'Tao luc' },
      ]))
    if (!ok) return
    /* Nhãn nút đổi tại chỗ rồi tự về: file tải xuống không có phản hồi nào
       khác, và người bấm cần biết lần bấm của mình đã ăn. */
    setExported(true)
    setTimeout(() => setExported(false), 2000)
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
      <div className="adm-kpis" role="group" aria-label={t('adm.pageAria')}>
        {kpis.map(k => (
          <button key={k.k} type="button" className={`adm-kpi${tab === k.k ? ' on' : ''}`}
            style={{ '--sc': k.tone }} aria-pressed={tab === k.k} onClick={() => goTab(k.k)}>
            <span className="k"><i aria-hidden="true" />{t(k.label)}</span>
            <span className="v">{k.n}</span>
          </button>
        ))}
      </div>

      {/* `aria-busy` trong lúc chạy thao tác hàng loạt: trình đọc màn hình phải
          biết danh sách đang được ghi, không phải "bảng trống". */}
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
            n: tab === 'media' ? media.length : pg.items.length,
            total: tab === 'media' ? media.length : shown.length,
          })}</span>
        </h2>

        {tab === 'media' ? (
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
            <span className="searchwrap">
              <Icon name="search" size={14} className="search-ico" />
              <input ref={searchRef} className="search"
                placeholder={t('adm.search')} aria-label={t('adm.search')}
                value={q} aria-keyshortcuts="/"
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

        {/* DÒNG ĐẾM + CHỌN CẢ TRANG: hai thứ cùng trả lời "tôi đang nhìn gì và
            đang chọn gì", nên nằm chung một hàng. */}
        {tab !== 'media' && (
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
            </span>
          </div>
        )}
        {/* Vùng thông báo: đổi bộ lọc là con số đổi, nhưng mắt thường không
            được báo. Chỉ trình đọc màn hình đọc dòng này. */}
        {tab !== 'media' && (
          <p className="sr-only" role="status">{t('adm.resultCount', { n: shown.length })}</p>
        )}

        {tab === 'media' ? (
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
            ? <EmptyState title={t('adm.emptyTitle')} body={t('adm.emptyBody')}
                filtered={filtered} q={q} t={t} onClear={clearFilters} />
            : pg.items.map(r => (
              <RequestAdminRow key={r.id} r={r} dup={totals.get(groupKey(r))} pickInterval={pickInterval}
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
