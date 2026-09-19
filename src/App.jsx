import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Splash from './components/Splash'
import Leaderboard from './components/Leaderboard'
import LoginGate from './components/LoginGate'
import ProfileModal from './components/ProfileModal'
import VoteModal from './components/VoteModal'
import Sidebar from './components/Sidebar'
import Pager from './components/Pager'
import MediaShowcase from './components/MediaShowcase'
import Notifications from './components/Notifications'
import Countdown from './components/Countdown'
import FollowBtn from './components/FollowBtn'
import Standing from './components/Standing'
/* Hai modal nặng (chứa QR thanh toán / toàn bộ form admin) tách khỏi bundle
   chính: người chỉ xem bảng không phải tải code chỉ dùng khi bấm nút. */
const ActionModal = lazy(() => import('./components/ActionModal'))
const AdminPanel = lazy(() => import('./components/AdminPanel'))
const DailySpin = lazy(() => import('./components/DailySpin'))
import { KIND_META, STATUS_META, isPicked, kindCls, timeAgo, vnd, usd } from './lib/meta'
import { useI18n, errMsg } from './lib/i18n.jsx'
import { sfx } from './lib/sfx'
import { useReveal } from './lib/useReveal'
import { usePager } from './lib/usePager'
import { boardItems as buildBoardItems, groupIds, groupKey, pickBoardParam } from './lib/board'
import {
  DEFAULT_PREFS, WATCH_LIMIT, diffNotices, dropNotice, loadInbox, loadPrefs, loadWatched,
  loadOff, markAllRead, markRead, pickLadder, pushNotices, saveInbox, saveOff, savePrefs, saveWatched,
  snapOf, songAttr, syncOwnRequests, toastOf, toggleWatched, watchedKeys,
} from './lib/watch'
import { useNotify } from './lib/notify.jsx'
import { useGlow, useCountUp } from './lib/motion'
import { parseYoutube } from './lib/youtube'
import { SUPPORT } from './lib/payment'
import {
  hasSupabase, supabase, getUser, onAuthChange, signOut,
  fetchRequests, fetchMyVotes, fetchVoteStatus, fetchRanking, fetchOrders, fetchMedia,
  addRequest, castVote, deleteRequest, buyVotes,
  adminReview, adminUpdateMany, adminOrder, adminPickGroup, cancelOrder,
  saveMedia, deleteMedia, deleteMediaMany, reorderMedia, FREE_VOTES_PER_DAY, PAID_REQUEST,
} from './lib/db'

/* Mục chính của trang */
const SECTIONS = ['board', 'spin', 'ranking', 'mine']

const PER_PAGE = 20
const PER_PAGE_ORDERS = 10

/* khối Up next hiện tối đa bao nhiêu request, còn lại nằm sau nút "View all" */
const NOW_SHOW = 2

const ROUTES = { board: '/', spin: '/daily-spin', ranking: '/ranking', mine: '/profile' }
const sectionOf = (path) => {
  const clean = path.replace(/\/+$/, '') || '/'
  return Object.keys(ROUTES).find(k => ROUTES[k] === clean) || 'board'
}

const SIDE_KEY = 'ccl.side'
const readSide = () => { try { return localStorage.getItem(SIDE_KEY) === 'min' } catch { return false } }

const BOARD_KEY = 'ccl.board'
const readSavedBoard = () => {
  try { return JSON.parse(localStorage.getItem(BOARD_KEY)) || {} } catch { return {} }
}

/* Bộ lọc đã chọn được NHỚ cho lần ghé sau. Ba nguồn theo thứ tự ưu tiên:
   URL (dán link là mở đúng chỗ người gửi chỉ) → giá trị đã lưu → mặc định.
   Giá trị lạ bị bỏ qua chứ không đẩy vào state (xem `pickBoardParam`).
   `q` KHÔNG nhớ: mở lại web mà danh sách tự dưng rỗng vì một từ khoá cũ là
   kiểu bực mình không ai gọi được tên — tìm kiếm là chuyện của phiên hiện tại. */
const readBoard = () => {
  const p = new URLSearchParams(window.location.search)
  const saved = readSavedBoard()
  return {
    f: pickBoardParam(p.get('f'), saved.f, FILTER_KEYS, 'queued'),
    k: pickBoardParam(p.get('k'), saved.k, KIND_KEYS, 'all'),
    q: p.get('q') || '',
  }
}

const VT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const FILTERS = [
  { k: 'queued',      c: 'var(--queued)' },
  { k: 'picked',      c: 'var(--queued)' },
  { k: 'newest',      c: 'var(--a)' },
  { k: 'top',         c: 'var(--a-2)' },
  { k: 'in_progress', c: 'var(--progress)' },
  { k: 'completed',   c: 'var(--done)' },
  /* Chỉ hiện khi đang theo dõi ≥1 bài — rỗng thì tab vô nghĩa. */
  { k: 'watch',       c: 'var(--a-2)' },
]
const FILTER_KEYS = FILTERS.map(f => f.k)
const KIND_KEYS = ['all', ...Object.keys(KIND_META)]

function Num({ v }) {
  const n = useCountUp(v)
  return <b key={v} className="tick">{n}</b>
}

function Stat({ c, v, label }) {
  return (
    <div className="stat" style={{ '--c': c }}>
      <Num v={v} />
      <span>{label}</span>
    </div>
  )
}

/* ---------------- một dòng request ---------------- */
function RequestRow({ r, i, n = 0, showDelete, myCount = 0, canVote, onVote, onDelete,
  followed = false, onWatch, hl = false, st = null }) {
  const { t } = useI18n()
  const sm = STATUS_META[r.status]
  /* Đã vào Up next thì khóa vote (kể cả rút lại) và khóa xóa của user. */
  const locked = isPicked(r)
  const votable = canVote && !locked

  const [pulse, setPulse] = useState(0)
  const seen = useRef(r.votes)
  useEffect(() => {
    if (seen.current === r.votes) return
    seen.current = r.votes
    setPulse(p => p + 1)
  }, [r.votes])

  return (
    <div className={`row${r.is_paid ? ' paid' : ''}${hl ? ' hl' : ''}`} data-song={songAttr(groupKey(r))}
      style={{ '--sc': sm.c, '--i': Math.min(n, 12) }}>
      {i != null && <div className="idx">{i + 1}</div>}
      <div className="body">
        <div className="title">
          {r.title} <span className="artist">— {r.artist}</span>{' '}
          {r.is_paid && <span className="pill gold">PAID</span>}
          {isPicked(r) && <span className="pill upnext">{t('now.next')}</span>}
        </div>
        <div className="meta">
          <span className="status" style={{ '--c': sm.c }}>
            {isPicked(r) && r.status === 'queued' ? t('now.next') : t(`status.${r.status}`)}
          </span>
          <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span>
          <span className="dot" aria-hidden="true" /><span>{r.requester}</span>
          <span className="dot" aria-hidden="true" /><span>{timeAgo(r.created_at, t)}</span>
          {r.status === 'denied' && r.deny_reason && (
            <>
              <span className="dot" aria-hidden="true" />
              <span style={{ color: 'var(--denied)' }}>{r.deny_reason}</span>
            </>
          )}
          {/* Hàng của bài so với đợt chốt kế tiếp: "còn 2 vote nữa là tới lượt"
              là cái duy nhất người đọc làm được ngay bây giờ. Chỉ người đang
              theo dõi mới thấy (người ngoài xem bảng không cần "bài sắp chốt"). */}
          {!isPicked(r) && followed && <Standing st={st} />}
          {/* Chuông nằm CUỐI dòng meta, không phải một ô nút ở mép phải: hàng
              tĩnh thì chỉ có chữ, quyền theo dõi hiện lên khi rê. Dòng trong cụm
              không có chuông vì theo dõi là chuyện của CẢ bài (RequestGroup). */}
          {onWatch && <FollowBtn on={followed} onToggle={() => onWatch(r)} />}
        </div>
        {r.status === 'in_progress' && <div className="bar"><i style={{ width: `${r.progress}%` }} /></div>}
        {r.video_url && <a className="watch" href={r.video_url} target="_blank" rel="noreferrer">{t('row.watch')}</a>}
      </div>
      <button className={`votebtn${myCount > 0 ? ' on' : ''}${locked ? ' locked' : ''}`}
        onClick={() => onVote(r)}
        disabled={!votable}
        aria-disabled={!votable}
        title={locked ? t('row.voteLocked') : !canVote ? t('row.cantVote') : t('row.openVote')}>
        {pulse > 0 && <span key={`fx${pulse}`} className="votefx" aria-hidden="true" />}
        <b key={r.votes} className="tick">{r.votes}</b><span>{t('row.vote')}</span>
        {myCount > 0 && <em className="mine" title={t('row.mine', { n: myCount })}>×{myCount}</em>}
      </button>
      {showDelete && !locked && ['pending', 'queued', 'denied'].includes(r.status) && (
        <button className="icon-btn" title={t('row.deleteReq')} aria-label={t('row.deleteReq')}
          onClick={() => onDelete(r.id)}>×</button>
      )}
    </div>
  )
}

function RequestGroup({ g, i, expanded, onToggle, user, myVotes, onVote, onDelete,
  followed = false, onWatch, hl = false, st = null }) {
  const { t } = useI18n()
  const kinds = [...new Set(g.rows.map(r => r.kind))]
  /* nguoi gui trong cum (toi da 2 ten + so con lai) de nhan ra ngay */
  const who = [...new Set(g.rows.map(r => r.requester))]
  const whoTx = who.slice(0, 2).join(', ') + (who.length > 2 ? ` +${who.length - 2}` : '')
  const newest = Math.max(...g.rows.map(r => +new Date(r.created_at) || 0))
  return (
    <div className={`grow${expanded ? ' open' : ''}${hl ? ' hl' : ''}`} data-song={songAttr(g.key)}>
      {/* Chuông theo dõi đặt là ANH EM của .grow-head, không nhét vào trong
          nút cha — HTML không cho nút lồng nút — nên nó chiếm cột lưới thứ hai
          và nằm cùng hàng với nút mũi tên. Theo dõi là cho CẢ BÀI nên cụm chỉ
          có một chuông; các dòng bên trong không có nút nào (cũng không cần ô
          giữ chỗ: cuối dòng meta của hàng lẻ chỉ còn chấm trạng thái). */}
      {onWatch && (
        <FollowBtn on={followed} onToggle={() => onWatch(g.rows[0] || { artist: g.artist, title: g.title })} />
      )}
      <button type="button" className="grow-head" aria-expanded={expanded}
        title={expanded ? t('group.hide') : t('group.showAll', { n: g.rows.length })}
        onClick={onToggle}>
        {i != null && <span className="idx">{i + 1}</span>}
        <span className="body">
          <span className="grow-tags">
            <span className="grow-count">{t('group.requests', { n: g.rows.length })}</span>
            {kinds.map(k => <span key={k} className={`kind ${kindCls(k)}`}>{k}</span>)}
          </span>
          <span className="title">{g.title} <span className="artist">— {g.artist}</span></span>
          <span className="meta">
            <span>{whoTx}</span>
            {newest > 0 && <><span className="dot" aria-hidden="true" /><span>{timeAgo(newest, t)}</span></>}
            {followed && <Standing st={st} />}
          </span>
        </span>
        <span className="grow-stat" aria-hidden="true">
          <b>{g.votes}</b><span>{t('now.votes')}</span>
        </span>
        <span className={`grow-arrow${expanded ? ' on' : ''}`} aria-hidden="true">▾</span>
      </button>
      <div className="grow-rows">
        <div className="grow-rows-in">
          {g.rows.map((r, k) => (
            <RequestRow key={r.id} r={r} i={null} n={k}
              showDelete={r.user_id === user.id}
              myCount={myVotes.get(r.id) || 0}
              canVote={(r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)}
              onVote={onVote}
              onDelete={onDelete} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Khoá sessionStorage: đánh dấu tab này đã xem màn chờ một lần. */
const SPLASH_KEY = 'ccl3_splash'
/** Lần đầu trong tab này? Đọc NGAY lúc khởi tạo state — không setState trong
    effect, vì như vậy là thêm một vòng render nữa để nói điều đã biết. */
const firstVisit = () => { try { return sessionStorage.getItem(SPLASH_KEY) !== '1' } catch { return true } }

export default function App() {
  const { t } = useI18n()
  const { push } = useNotify()
  useGlow()
  const [booting, setBooting] = useState(firstVisit)
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState(null)
  const currentUserId = useRef(null)
  useLayoutEffect(() => { currentUserId.current = user?.id }, [user?.id])

  const [rows, setRows] = useState([])
  const [myVotes, setMyVotes] = useState(new Map())
  const [voteStatus, setVoteStatus] = useState({
    free_used: 0, free_limit: FREE_VOTES_PER_DAY, credits: 0, purchased: 0, bonus: 0,
  })
  const balanceVersion = useRef(0)
  const applySpinBalance = useCallback(status => {
    if (status.user_id !== currentUserId.current) return
    ++balanceVersion.current // discard older balance reads still in flight
    setVoteStatus(previous => ({
      ...previous,
      credits: status.credits,
      purchased: status.purchased ?? previous.purchased,
      bonus: status.bonus ?? previous.bonus,
    }))
  }, [])
  const [ranking, setRanking] = useState([])
  const [orders, setOrders] = useState([])
  const [media, setMedia] = useState([])
  const [pick, setPick] = useState(null)   // { interval_days, last_pick_at, next_pick_at }

  /* ------- theo dõi + hộp thư (prototype: localStorage, xem lib/watch.js) -------
     `watched` là danh sách BÀI (khóa = groupKey), không phải danh sách dòng:
     một bài bị nhiều người gửi lẻ vẫn chỉ có một mục theo dõi. */
  const [watched, setWatched] = useState([])
  const [notices, setNotices] = useState([])
  const [prefs, setPrefs] = useState(DEFAULT_PREFS)
  const [hlSong, setHlSong] = useState(null)
  /* Hộp thông báo mở tại chỗ dưới chuông. Một dòng tin BẤM LÀ NHẢY tới hàng
     request của bài đó (xem `openNotice`) — giữa bảng và tin không còn đặt một
     hộp thoại nào nữa: người dùng yêu cầu đúng như vậy. */
  const [bellOpen, setBellOpen] = useState(false)
  const snapRef = useRef(null)             // snapshot của lần đọc `rows` gần nhất
  /* Khoá bài mà CHÍNH TAY admin vừa thao tác (tick duyệt / mốc tiến độ / chốt).
     Dùng để chặn tự-thông-báo cho mình: lượt bảng đổi ngay sau đó sẽ bỏ qua các
     khoá này khi sinh tin — admin đứng ngay chỗ thay đổi, không cần toast/badge. */
  const selfActRef = useRef(null)
  /* Ba `rows`/`prefs`/`off` cần đọc đúng giá trền hiện tại từ những callback
     không đăng ký deps (`load`, `loadBoard`); ref là cách ngắn nhất để không
     bất cử mỗi lúc đểy cả `load` chạy lại. */
  const watchedRef = useRef([])
  const prefsRef = useRef(DEFAULT_PREFS)
  const offRef = useRef([])
  const watchedSet = useMemo(() => watchedKeys(watched), [watched])

  const [section, setSection] = useState(() => sectionOf(window.location.pathname))
  // The shared aurora sits outside the lazy page. Set its route mode before
  // paint so Daily Spin stays flat on direct loads, navigation and history.
  useLayoutEffect(() => {
    document.documentElement.dataset.section = section
    return () => { delete document.documentElement.dataset.section }
  }, [section])
  const [board] = useState(readBoard)
  const [filter, setFilter] = useState(board.f)
  const [kindFilter, setKindFilter] = useState(board.k)
  const [q, setQ] = useState(board.q)
  const [showTop, setShowTop] = useState(false)
  const searchRef = useRef(null)
  /* mốc 0px đầu nội dung — nút "lên đầu trang" theo dõi nó thay vì nghe scroll */
  const topSentinelRef = useRef(null)
  /* vạch tiến độ cuộn: ghi thẳng style qua ref để không setState mỗi frame */
  const progressRef = useRef(null)

  const [profile, setProfile] = useState(false)
  const [voteFor, setVoteFor] = useState(null)
  const [modal, setModal] = useState(false)
  const [modalTab, setModalTab] = useState('request')
  const [admin, setAdmin] = useState(false)
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(readSide)
  useEffect(() => { try { localStorage.setItem(SIDE_KEY, collapsed ? 'min' : 'full') } catch { /* ignore */ } }, [collapsed])
  const toggleSide = useCallback(() => setCollapsed(c => !c), [])
  const scrollTop = useCallback(() => window.scrollTo({ top: 0, behavior: REDUCED() ? 'auto' : 'smooth' }), [])

  const go = useCallback((k) => {
    const run = () => {
      setSection(k)
      setMenu(false)
      const narrow = window.matchMedia?.('(max-width: 899px)').matches
      window.scrollTo({ top: 0, behavior: narrow ? 'auto' : 'smooth' })
      const qs = k === 'board' ? window.location.search : ''
      if (ROUTES[k] + qs !== window.location.pathname + window.location.search) {
        window.history.pushState({ s: k }, '', ROUTES[k] + qs)
      }
    }
    if (VT && !REDUCED()) {
      const dir = SECTIONS.indexOf(k) >= SECTIONS.indexOf(section) ? 'fwd' : 'back'
      document.documentElement.dataset.nav = dir
      document.startViewTransition(run)
      return
    }
    run()
  }, [section])

  /* Nhảy tới bài: bật tab "Following" (nên bài đang pending/bị từ chối cũng
     tìm thấy), làm sáng hàng 2,6 giây rồi tự tắt. */
  const jumpToSong = useCallback((target) => {
    const key = typeof target === 'string' ? target : (target?.key || groupKey(target || {}))
    if (!key) return
    go('board'); setKindFilter('all'); setQ('')
    /* tab "Following" la noi duy nhat con hien bai pending/bi tu choi; bai
       chua theo doi thi nhay ve bang chung lo, de hien "khong co ket qua" con
       hon la nhay vao mot tab trong sach cua nguoi khac */
    setFilter(watchedSet.has(key) ? 'watch' : 'newest')
    setHlSong(key)
    const sel = `[data-song="${songAttr(key)}"]`
    requestAnimationFrame(() => setTimeout(() => {
      const el = document.querySelector(sel) || listRef.current
      el?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'center' })
    }, 90))
    setTimeout(() => setHlSong(s => (s === key ? null : s)), 2600)
  }, [go, watchedSet])

  useEffect(() => {
    const onPop = () => {
      setSection(sectionOf(window.location.pathname))
      const b = readBoard()
      setFilter(b.f); setKindFilter(b.k); setQ(b.q)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (section !== 'board') return
    const id = setTimeout(() => {
      const p = new URLSearchParams()
      if (filter !== 'queued') p.set('f', filter)
      if (kindFilter !== 'all') p.set('k', kindFilter)
      if (q.trim()) p.set('q', q.trim())
      const qs = p.toString()
      const next = ROUTES.board + (qs ? `?${qs}` : '')
      if (next !== window.location.pathname + window.location.search) {
        window.history.replaceState({ s: 'board' }, '', next)
      }
      /* Ghi cùng lúc với URL, cùng một nhịp hoãn 320ms: hai lần ghi tách rời
         nhau thì có lúc URL nói một đằng, bộ nhớ nói một nẻo. */
      try { localStorage.setItem(BOARD_KEY, JSON.stringify({ f: filter, k: kindFilter })) }
      catch { /* chặn storage thì bộ lọc chỉ sống trong phiên này */ }
    }, 320)
    return () => clearTimeout(id)
  }, [section, filter, kindFilter, q])

  /* Nút "lên đầu trang" biết mình nên hiện khi nào nhờ IntersectionObserver
     trên mốc đầu nội dung, với ngưỡng 520px nằm ở rootMargin. Cách cũ là
     nghe sự kiện scroll rồi setState mỗi khung hình: cuộn một màn hình là
     hàng chục lần React phải so sánh state, trong khi thứ duy nhất đổi là
     một chữ "on" ở một nút. Observer chỉ báo đúng lúc vượt ngưỡng. */
  useEffect(() => {
    const el = topSentinelRef.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      ([e]) => setShowTop(!e.isIntersecting),
      { rootMargin: '520px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* Vạch tiến độ cuộn: trình duyệt nào có CSS scroll-driven animations thì
     việc vẽ vạch do CSS lo (xem `.scroll-progress` trong index.css) — ở đây
     KHÔNG gắn listener nào cả. Chỉ khi thiếu tính năng mới chạy bản dự phòng
     bằng rAF, đúng như hành vi trước đây. */
  useEffect(() => {
    const native = typeof CSS !== 'undefined' && CSS.supports
      && CSS.supports('(animation-timeline: scroll())')
    if (native) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        /* vạch tiến độ chỉ co giãn bằng transform (scaleX), không đụng layout;
           ghi thẳng vào ref để cuộn không kéo theo một lần setState nào */
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (progressRef.current) {
          progressRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [])

  useEffect(() => {
    const clean = window.location.pathname.replace(/\/+$/, '') || '/'
    if (!Object.values(ROUTES).includes(clean)) {
      window.history.replaceState(null, '', ROUTES.board + window.location.search)
    }
  }, [])

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  /* Màn chờ: sàn 560ms cho logo kịp "vào" (dưới ngưỡng đó chỉ là một cái nháy
     mắt), còn lại chờ dữ liệu. Bản trước ghim cứng 1.7s — mạng nhanh thì
     người dùng nhìn logo thêm hơn một giây vô ích.
     Và màn chờ này CHỈ chạy một lần mỗi phiên tab: nó là câu chào thương
     hiệu, không phải màn hình nghi thức. Tải lại trang trong cùng tab mà vẫn
     phải xem lại từ đầu là thứ duy nhất người dùng gọi đúng tên: chậm. */
  useEffect(() => {
    try { sessionStorage.setItem(SPLASH_KEY, '1') } catch { /* chặn storage thì thôi */ }
    if (!booting) return
    const t = setTimeout(() => setBooting(false), 560)
    return () => clearTimeout(t)
  }, [booting])
  useEffect(() => { getUser().then(u => { setUser(u); setReady(true) }); return onAuthChange(setUser) }, [])

  const loadMedia = useCallback(async () => {
    try { setMedia(await fetchMedia()) } catch { /* ignore */ }
  }, [])
  useEffect(() => { loadMedia() }, [loadMedia])

  /* cấu hình chốt request định kỳ — bảng settings đọc công khai */
  const loadPick = useCallback(async () => {
    if (!hasSupabase) return
    try {
      const { data, error } = await supabase.from('settings').select('value').eq('key', 'pick').maybeSingle()
      if (error) { console.warn('[pick] settings:', error.message); return }
      setPick(data?.value || null)
    } catch (e) { console.warn('[pick]', e) }
  }, [])
  useEffect(() => { loadPick() }, [loadPick])

  /* Đồng hồ "Next pick" không được kẹt ở "any moment…": khi mốc next_pick_at
     sắp tới hoặc đã qua mà chưa có lượt chốt mới ghi mốc kế tiếp (cron chưa
     chạy, admin chưa chốt tay…), cứ ~30s hỏi lại settings một lần. Có mốc
     mới là dừng hỏi và đếm tiếp bình thường. */
  useEffect(() => {
    if (!hasSupabase || section !== 'board' || !pick) return
    let t = 0
    const sync = async () => {
      const to = pick?.next_pick_at ? new Date(pick.next_pick_at).getTime() : null
      /* Thiếu mốc, hoặc mốc sắp tới / đã qua → hỏi lại settings cho tới khi
         có mốc mới ở tương lai thì thôi. */
      if (to == null || to - Date.now() <= 60_000) await loadPick()
      t = setTimeout(sync, 30_000)
    }
    sync()
    return () => clearTimeout(t)
  }, [section, pick, loadPick])

  /* TỰ THEO DÕI bài của mình — cái người dùng cần nhất mà bản đầu quên:
     đã gửi request thì phải biết nó được duyệt hay chưa, không phải đi tìm
     cái chuông ẩn dưới hover. Gọi từ `load`/`loadBoard` (nơi dữ liệu vừa về)
     chứ không phải một effect riêng — khỏi vòng render thừa. */
  const applyOwnFollows = (rowsNext) => {
    const u = currentUserId.current
    if (!u || !rowsNext?.length) return
    const res = syncOwnRequests(rowsNext, u, watchedRef.current, prefsRef.current, Date.now(), offRef.current)
    if (!res) return
    setWatched(res.list)
    saveWatched(u, res.list)
  }

  const load = useCallback(async (u = user) => {
    if (!u) return
    const version = ++balanceVersion.current
    const results = await Promise.allSettled([
      fetchRequests(), fetchMyVotes(u.id), fetchVoteStatus(), fetchRanking(), fetchOrders(u), loadMedia(), loadPick(),
    ])
    if (u.id !== currentUserId.current) return results
    const [r, v, vs, rk, od] = results
    if (r.status === 'fulfilled') { setRows(r.value); applyOwnFollows(r.value) }
    if (v.status === 'fulfilled') setMyVotes(v.value)
    // Phan hoi cu (vong quay vua cong thuong sau khi lan tai nay bat dau) thi
    // GIU NGUYEN trang thai truoc do — khong spread vs.value ke ca free_used,
    // vi no keo theo purchased/bonus/credits cua thoi diem cu de len so moi.
    if (vs.status === 'fulfilled' && version === balanceVersion.current) {
      setVoteStatus(() => vs.value)
    }
    if (rk.status === 'fulfilled') setRanking(rk.value)
    if (od.status === 'fulfilled') setOrders(od.value)
    return results
  }, [user, loadMedia, loadPick])

  /* Realtime chỉ tải lại đúng phần đổi: một lượt vote chạm bảng requests
     thì không cần lôi cả media + đơn hàng về theo. */
  const loadBoard = useCallback(async (u = user) => {
    if (!u) return
    const version = ++balanceVersion.current
    const results = await Promise.allSettled([
      fetchRequests(), fetchMyVotes(u.id), fetchVoteStatus(), fetchRanking(),
    ])
    if (u.id !== currentUserId.current) return results
    const [r, v, vs, rk] = results
    if (r.status === 'fulfilled') { setRows(r.value); applyOwnFollows(r.value) }
    if (v.status === 'fulfilled') setMyVotes(v.value)
    // Phan hoi cu (vong quay vua cong thuong) thi giu nguyen trang thai truoc
    // do, khong de so du thoi diem cu de len so moi.
    if (vs.status === 'fulfilled' && version === balanceVersion.current) {
      setVoteStatus(() => vs.value)
    }
    if (rk.status === 'fulfilled') setRanking(rk.value)
    return results
  }, [user])

  const loadOrdersOnly = useCallback(async (u = user) => {
    if (!u) return
    try { setOrders(await fetchOrders(u)) } catch { /* ignore */ }
  }, [user])

  useEffect(() => { if (user) load(user) }, [user, load])

  useEffect(() => {
    if (!hasSupabase || !user) return
    let t = 0
    let dirty = false
    const queueBoard = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (document.hidden) { dirty = true; return }
        loadBoard(user)
      }, 400)
    }
    const ch = supabase.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, queueBoard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrdersOnly(user))
      .subscribe()
    const onVis = () => { if (!document.hidden && dirty) { dirty = false; loadBoard(user) } }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVis)
      supabase.removeChannel(ch)
    }
  }, [user, loadBoard, loadOrdersOnly])

  useEffect(() => {
    if (!hasSupabase) return
    let t = 0
    const queue = () => { clearTimeout(t); t = setTimeout(() => { if (!document.hidden) loadMedia() }, 400) }
    const ch = supabase.channel('live-media')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media' }, queue)
      .subscribe()
    return () => { clearTimeout(t); supabase.removeChannel(ch) }
  }, [loadMedia])

  useEffect(() => {
    document.title = section === 'board'
      ? 'Chaereve — Request Page'
      : `${t(`nav.${section}`)} · Chaereve`
    /* Canonical đi cùng tiêu đề vì cả hai đều đổi theo route. Thẻ trong
       index.html chỉ đúng cho `/`, mà SPA đổi đường dẫn bằng pushState nên
       không sửa lại thì /daily-spin, /ranking, /profile là ba "bản trùng"
       của cùng một trang trong mắt Google. Lấy origin THẬT thay vì ghi cứng
       tên miền: repo có ba đường deploy (Pages / Workers / Vercel). Không
       kèm query string — `/?f=done&q=abc` vẫn là một nội dung đó, để nguyên
       query là tự đẻ ra vô số canonical khác nhau cho cùng một trang. */
    const canonical = document.querySelector('link[rel="canonical"]')
    if (canonical) canonical.href = new URL(ROUTES[section], window.location.origin).href
  }, [section, t])

  const flash = (tone, m, extra) => push({
    tone,
    title: t(tone === 'err' ? 'notif.err' : tone === 'gold' ? 'notif.gold' : 'notif.ok'),
    body: m,
    ...extra,
  })

  /* ---------------- theo dõi + thông báo ----------------
     Nạp theo tài khoản; đổi tài khoản là xoá snapshot cũ để không mang
     bảng của người này so với người kia (sẽ sinh toàn tin ảo). */
  const uid = user?.id
  useEffect(() => {
    snapRef.current = null
    if (!uid) { setWatched([]); setNotices([]); setPrefs(DEFAULT_PREFS); return }
    const w = loadWatched(uid)
    const off = loadOff(uid)
    setWatched(w); watchedRef.current = w
    setNotices(loadInbox(uid))
    const pf = loadPrefs(uid)
    setPrefs(pf); prefsRef.current = pf
    offRef.current = off
    /* ?f=watch còn sót trong URL của lần trước: không có gì để xem thì
       trở về hàng đợi, để tab "Following" không bị chọn mà trang trống */
    if (!w.length) setFilter(f => (f === 'watch' ? 'queued' : f))
  }, [uid])

  /* Hạng của từng bài so với đợt chót kế tiếp — một lần tính cho cả
     bảng, dùng chung cho dòng request, thẻ cụm, hộp thông báo và cả lúc
     so sánh sinh tin. */
  const { rank: standings } = useMemo(() => pickLadder(rows), [rows])

  /* Bảng thông báo cần biết "dòng nào là của bài này" để gắn nút Vote / Xem
     video ngay trong dòng: lấy bài của mình trước, rồi tới dòng nhiều vote
     nhất — cùng luật với thẻ cụm ngoài bảng. */
  const rowsByKey = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const k = groupKey(r)
      const cur = m.get(k)
      const better = !cur || (r.user_id === uid && cur.user_id !== uid)
        || (r.user_id === cur.user_id && Number(r.votes) > Number(cur.votes))
      if (better) m.set(k, r)
    }
    return m
  }, [rows, uid])

  /* Pham vi bao tin = dang theo doi + bai CHINH MINH DA BO PHIEU. Result
     cuoc chot phai toi tay nguoi da vote, ke ca khi ho chang bam chuong nao.
     `myVotes` danh theo request_id nen phai doi ra key cua bai. */
  const votedSet = useMemo(() => {
    const set = new Set()
    if (myVotes?.size) for (const r of rows) if (myVotes.get(r.id)) set.add(groupKey(r))
    return set
  }, [myVotes, rows])

  /* Bấm một tin = đưa người ta ĐẾN dòng request của bài đó trên bảng rồi làm
     sáng hàng — không mở hộp thoại "This song" nữa: hộp thoại lặp lại đúng những
     gì dòng tin vừa kể, mà che mất danh sách người ta đang muốn xem. Đánh dấu đã
     đọc luôn vì họ đang nhìn thấy tin. */
  const openNotice = useCallback((n) => {
    setBellOpen(false)
    if (n && !n.read) setNotices(box => markRead(box, n.id))
    if (n?.key) jumpToSong(n.key)
  }, [jumpToSong])

  /* Mỗi lần bảng đổi (lần nạp đầu, realtime đẩy về, ngay sau lượt vote),
     so với snapshot ngay trước đó và chỉ lấy thay đổi của bài đang theo dõi.
     setState trong effect ở đây là có chủ đích: nguồn đúng là `rows` — dữ liệu
     đến từ ngoài render, không phải giá trị suy ra từ state khác. */
  useEffect(() => {
    if (!rows.length) return
    /* Thay đổi do CHÍNH TAY admin gây ra thì khỏi tự thông báo cho mình: bỏ qua
       các khoá bài vừa thao tác cho cả toast lẫn mục hộp thư (cùng một `found`).
       Tiêu thụ NGAY đầu effect (kể cả khi bên dưới return sớm) rồi xoá, để một
       lần thao tác hỏng không rò sang lượt bảng đổi sau. */
    const selfAct = selfActRef.current
    selfActRef.current = null
    const next = snapOf(rows, uid, standings)
    const prev = snapRef.current
    snapRef.current = next
    if (!prev || !watchedSet.size) return
    const found = diffNotices({ prev, next, watched: watchedSet, voted: votedSet, prefs, cycle: pick?.last_pick_at || '' })
      .filter(n => !selfAct?.has(n.key))
    if (!found.length) return
    setNotices(box => pushNotices(box, found))
    /* Một toast cho cả đợt: 4 bài cùng nhúc nhích mà 4 toast thì không đọc
       kịp, mà im hết thì tin không tới nơi. Hộp thư đã có đủ. */
    const { n, first } = toastOf(found)
    const song = `${first.title} — ${first.artist}`
    const vars = { song, pct: first.pct ?? 0, votes: first.votes ?? 0, n: first.gap ?? n }
    sfx.notify()
    push({
      tone: first.type === 'done' ? 'gold' : first.type === 'denied' ? 'err'
        : first.type === 'near' ? 'gold' : 'ok',
      title: n > 1 ? t('nt.multi', { n }) : t(`nt.tag.${first.type}`),
      body: n > 1 ? t('nt.multiBody', { song })
        : t('nt.toast', { song, msg: t(`nt.n.${first.type}`, vars) }),
      ms: 8000,
      action: n > 1
        ? { label: t('nt.title'), onClick: () => setBellOpen(true) }
        : { label: t('nt.open'), onClick: () => openNotice(first) },
    })
  }, [rows, standings, watchedSet, votedSet, prefs, uid, pick, push, t, openNotice])

  /* Lưu hộp thư + tuỳ chọn ở một chỗ: viết ngay trong updater của
     setNotices thì không được — updater phải thuần. */
  useEffect(() => { if (uid) saveInbox(uid, notices) }, [uid, notices])
  useEffect(() => { prefsRef.current = prefs; if (uid) savePrefs(uid, prefs) }, [uid, prefs])
  useEffect(() => { watchedRef.current = watched }, [watched])

  const doToggleWatch = (r) => {
    if (!uid) return
    const res = toggleWatched(watched, { ...r, own: r.user_id === uid }, Date.now(), offRef.current)
    setWatched(res.list); saveWatched(uid, res.list)
    offRef.current = res.off; saveOff(uid, res.off)
    sfx.tap()
    const song = `${r.title} — ${r.artist}`
    flash(res.full ? 'err' : 'ok',
      res.full ? t('watch.full', { n: WATCH_LIMIT }) : t(res.added ? 'watch.on' : 'watch.off', { song }))
  }

  const doSetPrefs = (patch) => setPrefs(p => ({ ...p, ...patch }))

  const doDropNotice = (id) => setNotices(box => dropNotice(box, id))

  /* ---------------- derived ---------------- */
  const pub = useMemo(() => rows.filter(r => r.status !== 'pending' && r.status !== 'denied'), [rows])
  const mineRows = useMemo(
    () => rows.filter(r => r.user_id === user?.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [rows, user])

  /* Danh sách đã chốt, chưa xong: đang làm trước, rồi chốt sớm trước.
     Completed thì tự rơi khỏi đây. */
  const picked = useMemo(() => {
    const rank = (r) => (r.status === 'in_progress' ? 0 : 1)
    return pub.filter(isPicked)
      .sort((a, b) => rank(a) - rank(b) || new Date(a.picked_at) - new Date(b.picked_at))
  }, [pub])

  /* Gom cụm trung bài trong khối Up next: mỗi bài (artist + title) thành một
     thẻ gồm tất cả dòng đã chốt. `picked` đã sort in_progress trước rồi
     picked_at tăng dần, nên dòng đầu của mỗi cụm là đại diện (đang làm nếu có). */
  const pickedGroups = useMemo(() => {
    const byKey = new Map()
    const order = []
    for (const r of picked) {
      const key = groupKey(r)
      let g = byKey.get(key)
      if (!g) {
        g = { key, title: r.title, artist: r.artist, rows: [], votes: 0, paid: false, rep: r, picked_at: r.picked_at }
        byKey.set(key, g); order.push(g)
      }
      g.rows.push(r)
      g.votes += r.votes || 0
      if (r.is_paid) g.paid = true
      if (r.status === 'in_progress' && g.rep.status !== 'in_progress') g.rep = r
    }
    return order
  }, [picked])

  const counts = useMemo(() => ({
    queued: pub.filter(r => r.status === 'queued' && !r.picked_at).length,
    picked: pickedGroups.length,
    newest: pub.length,
    top: pub.filter(r => r.status !== 'completed' && !isPicked(r)).length,
    /* Bài đang làm mà ĐÃ chốt vẫn được đếm vào In progress: chủ dự án muốn
       mọi thứ đang chạy phải hiện ở đó, kể cả cái đã lên Up next. Hệ quả là
       một bài có thể nằm ở CẢ Up next lẫn In progress — chấp nhận chồng nhau
       thay vì "giấu" trạng thái đang làm. */
    in_progress: pub.filter(r => r.status === 'in_progress').length,
    completed: pub.filter(r => r.status === 'completed').length,
    pending: rows.filter(r => r.status === 'pending').length,
    watch: new Set(rows.filter(r => watchedSet.has(groupKey(r))).map(groupKey)).size,
    mine: rows.filter(r => r.user_id === user?.id).length,
    orders: orders.filter(o => o.status === 'awaiting').length,
  }), [pub, pickedGroups, rows, orders, user, watchedSet])

  /* Chỉ LỌC ở đây; sắp xếp nằm trong lib/board.js vì phải sắp theo cụm
     (tổng vote cộng dồn), không sắp theo từng dòng lẻ. */
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    let base = pub
    if (filter === 'queued') base = base.filter(r => r.status === 'queued' && !r.picked_at)
    if (filter === 'picked') base = picked
    /* In progress hiện CẢ bài đã chốt (Up next) đang chạy — xem comment ở
       counts.in_progress. Bài đã chốt vẫn giữ pill "Up next" trên dòng để
       người xem biết nó đã được chọn, không nhầm với bài thường. */
    if (filter === 'in_progress') base = base.filter(r => r.status === 'in_progress')
    if (filter === 'completed') base = base.filter(r => r.status === 'completed')
    if (filter === 'top') base = base.filter(r => r.status !== 'completed' && !isPicked(r))
    /* Đang theo dõi thì muốn thấy CẢ bài pending/bị từ chối, không riêng
       hàng đã công bố — nên tab này lấy từ `rows`, không lấy từ `pub`. */
    if (filter === 'watch') base = rows.filter(r => watchedSet.has(groupKey(r)))
    if (kindFilter !== 'all') base = base.filter(r => r.kind === kindFilter)
    if (t) base = base.filter(r => `${r.artist} ${r.title} ${r.kind} ${r.requester}`.toLowerCase().includes(t))
    return base
  }, [pub, picked, rows, filter, q, kindFilter, watchedSet])

  const featured = useMemo(() => {
    const m = media.find(x => !x.is_hidden && x.kind === 'featured')
    if (!m) return null
    return {
      id: parseYoutube(m.url)?.id || null, key: m.id, url: m.url,
      title: m.title || '', thumb: m.thumb || null,
    }
  }, [media])

  const latest = useMemo(
    () => media
      .filter(x => !x.is_hidden && x.kind !== 'featured')
      .map(m => ({
        id: parseYoutube(m.url)?.id || null, key: m.id, url: m.url,
        title: m.title || '', thumb: m.thumb || null,
      })),
    [media])

  const featuredRows = media

  const fullRanking = useMemo(
    () => [...ranking].sort((a, b) => b.total - a.total || b.total_votes - a.total_votes),
    [ranking])

  const freeLeft = Math.max(0, voteStatus.free_limit - voteStatus.free_used)
  const votesLeft = freeLeft + voteStatus.credits

  const myOrders = useMemo(
    () => orders.filter(o => !hasSupabase || o.user_id === user?.id),
    [orders, user])

  const listRef = useRef(null)
  const mineRef = useRef(null)
  const ordersRef = useRef(null)
  /* Cụm trùng bài: hạng của cụm tính bằng TỔNG vote của cả bài nên một bài
     bị nhiều người gửi lẻ không còn tụt hạng do vote bị xé nhỏ. Phân trang
     theo cụm để một cụm không bị xé làm đôi giữa hai trang. */
  const boardItems = useMemo(() => buildBoardItems(visible, filter), [visible, filter])
  const pgBoard = usePager(boardItems, PER_PAGE, [filter, kindFilter, q])

  /* Tin bấm từ hộp thư (jumpToSong) thường rơi vào bài ở trang khác. Bộ lọc
     vừa đổi là usePager tự về trang 1, nên KHÔNG setPage được ngay trong
     jumpToSong — phải đợi bảng + bộ lọc ổn định rồi mới kéo trang chứa bài đó
     lên. MỘT LẦN CHO MỘT TIN thôi (ref dưới): nếu cứ phản ứng mỗi lần render thì
     người dùng bấm sang trang khác trong lúc hàng còn đang sáng là bị kéo về. */
  const revealRef = useRef(null)
  useEffect(() => {
    if (!hlSong) { revealRef.current = null; return }
    if (section !== 'board' || revealRef.current === hlSong) return
    revealRef.current = hlSong
    const idx = boardItems.findIndex(e => (e.key || groupKey(e.r || {})) === hlSong)
    if (idx < 0) return
    const want = Math.floor(idx / pgBoard.perPage) + 1
    if (want !== pgBoard.page) pgBoard.setPage(want)
  }, [hlSong, section, boardItems, pgBoard])

  /* Cụm nào đang mở — tự thu hết khi đổi bộ lọc/tìm kiếm (cùng nhịp reset
     trang của usePager, không dùng effect để khỏi render thừa). */
  const gkey = `${filter}|${kindFilter}|${q.trim()}`
  const [expSt, setExpSt] = useState({ key: gkey, open: {} })
  const openGroups = expSt.key === gkey ? expSt.open : {}
  const toggleGroup = (k) => setExpSt(s => {
    const open = s.key === gkey ? s.open : {}
    return { key: gkey, open: { ...open, [k]: !open[k] } }
  })
  const pgMine = usePager(mineRows, PER_PAGE, [section])
  const pgOrders = usePager(myOrders, PER_PAGE_ORDERS, [section])

  /* nút "View all" trong khối Up next: mở tab Up next của danh sách và cuộn tới */
  const showAllPicked = useCallback(() => {
    setFilter('picked'); setKindFilter('all'); setQ('')
    requestAnimationFrame(() => {
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' }), 60)
    })
  }, [])

  /* MutationObserver trong hook tự bắt khối mới, không cần liệt kê deps. */
  useReveal()

  /* ---------------- actions ---------------- */
  /* Chặn mở bảng vote cho Up next ngay ở lớp điều phối (nút đã disable,
     đây là lớp chặn thứ hai cho phím tắt / state cũ). */
  const openVote = useCallback((r) => {
    if (!r || isPicked(r)) return
    setVoteFor(r)
  }, [])

  const doVote = async (id, delta = 1) => {
    const target = rows.find(r => r.id === id)
    if (target && isPicked(target)) {
      flash('err', t('vote.locked'))
      throw new Error('err.voteLocked')
    }
    const bump = (n) => setRows(rs => rs.map(r => (r.id === id ? { ...r, votes: Math.max(0, r.votes + n) } : r)))
    const mine = (n) => setMyVotes(m => {
      const next = new Map(m)
      next.set(id, Math.max(0, (next.get(id) || 0) + n))
      return next
    })
    bump(delta); mine(delta)
    try {
      await castVote(id, delta)
      if (delta < 0) sfx.unvote(); else sfx.vote()
      await loadBoard(user)
    } catch (e) {
      bump(-delta); mine(-delta)
      flash('err', errMsg(t, e))
      throw e
    }
  }
  const doSubmit = async (form, paid) => {
    const row = await addRequest(form, user, paid)
    /* vua gui xong là theo dõi liọn, khỏi phải chờ lần nạp bảng kế tiếp */
    if (row) applyOwnFollows([{ ...row, user_id: row.user_id || user.id }])
    sfx.submit()
    const song = `${form.artist.trim()} — ${form.title.trim()}`
    push({
      tone: paid ? 'gold' : 'ok',
      title: t(paid ? 'notif.paidTitle' : 'notif.reqTitle'),
      body: paid
        ? t('notif.paidBody', { song, amt: vnd(PAID_REQUEST.vnd) })
        : t('notif.reqBody', { song }),
      ms: 6500,
      ...(paid ? { action: { label: t('notif.payNow'), onClick: () => openModal('buy') } } : {}),
    })
    await load(user)
    return row
  }
  const doBuy = async (pack) => {
    const order = await buyVotes(pack)
    sfx.submit()
    push({
      tone: 'gold',
      title: t('notif.buyTitle', { n: pack.qty }),
      body: t('notif.buyBody', { n: pack.qty, amt: vnd(pack.vnd) }),
      ms: 6500,
    })
    await load(user)
    return order
  }
  const doDelete = async (id) => {
    if (!confirm(t('row.confirmDelete'))) return
    try { await deleteRequest(id); await loadBoard(user); flash('ok', t('toast.deleted')) }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  const doReview = async (id, ok, reason) => {
    const r = rows.find(x => x.id === id)
    if (r) selfActRef.current = new Set([groupKey(r)])
    try { await adminReview(id, ok, reason); await loadBoard(user); flash('ok', ok ? t('toast.approved') : t('toast.denied')) }
    catch (e) { selfActRef.current = null; flash('err', errMsg(t, e)) }
  }
  /* opts.group = patch tinh cho CA BAI (cung artist + title), khong rieng dong
     duoc bam, vi mot bai chi lam MOT video:
       { group: true }                      -> chi lan sang dang doi (moc tien do)
       { group: ['queued','in_progress',…] } -> tu chieu trang thai: gan link +
         hoan thanh thi danh dau xong luon cho ca ban trung ke da "xong" khach,
         de link ve mot cho; 'denied' co tinh khong nam trong danh sach.
     Quyet dinh theo tung nguoi (duyet, tu choi, dua ve hang doi, doi ten bai)
     van la viec cua rieng tung dong. */
  const doAdminUpdate = async (id, patch, opts = {}) => {
    try {
      const target = rows.find(r => r.id === id)
      if (target) selfActRef.current = new Set([groupKey(target)])
      const statuses = Array.isArray(opts.group) ? opts.group : undefined
      const ids = opts.group && target ? groupIds(rows, target, statuses) : [id]
      const touched = await adminUpdateMany(ids, patch)
      await loadBoard(user)
      flash('ok', touched > 1 ? t('toast.updatedGroup', { n: touched }) : t('toast.updated'))
    }
    catch (e) { selfActRef.current = null; flash('err', errMsg(t, e)) }
  }
  const doAdminDelete = async (id) => {
    try { await deleteRequest(id); await loadBoard(user); flash('ok', t('toast.removed')) }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  const doAdminPick = async (id, picked) => {
    const r = rows.find(x => x.id === id)
    if (r) selfActRef.current = new Set([groupKey(r)])
    try {
      await adminPickGroup(id, picked)
      await loadBoard(user)
      /* Chốt tay sau khi quá hạn sẽ ghi mốc kế tiếp (xem trigger
         pick_cycle_touch trong DB) — nạp lại ngay để đồng hồ nhảy số mới. */
      loadPick()
      flash('ok', t('toast.updated'))
    } catch (e) { selfActRef.current = null; flash('err', errMsg(t, e)) }
  }
  const doCancelOrder = async (o) => {
    const ask = o.kind === 'paid_request' ? t('order.confirmCancelPaid') : t('order.confirmCancel')
    if (!confirm(ask)) return
    try { await cancelOrder(o.id); await load(user); flash('ok', t('toast.orderCancelled')) }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  const doOrder = async (id, ok) => {
    /* duyệt đơn paid_request đổi status request pending → queued: cũng là thay
       đổi chính tay admin gây ra nên khỏi tự thông báo */
    const o = orders.find(x => x.id === id)
    if (o?.kind === 'paid_request' && o.request_id) {
      const r = rows.find(x => x.id === o.request_id)
      if (r) selfActRef.current = new Set([groupKey(r)])
    }
    try { await adminOrder(id, ok); await load(user); flash('ok', ok ? t('toast.orderOk') : t('toast.orderNo')) }
    catch (e) { selfActRef.current = null; flash('err', errMsg(t, e)) }
  }
  const doMediaSave = async (item) => {
    try { await saveMedia(item); await loadMedia(); flash('ok', t('toast.mediaSaved')) }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  /* Bảng sửa cả danh sách Latest: xóa trước, rồi lưu mục sửa, thêm mục mới,
     cuối cùng xếp lại đủ cả bảng một lượt (mục featured giữ nguyên chỗ). */
  const doMediaCommit = async ({ updates = [], adds = [], removes = [], order = [] } = {}) => {
    const isVideo = (m) => m && (m.kind === 'video' || m.kind === 'playlist')
    try {
      if (removes.length) await deleteMediaMany(removes)
      for (const u of updates) await saveMedia(u)
      const newIdByKey = {}
      for (const a of adds) {
        const row = await saveMedia({ kind: 'video', title: a.title, url: a.url })
        if (row?.id) newIdByKey[a.key] = row.id
      }
      /* thứ tự video theo bảng (id cũ giữ lại, key tạm đổi sang id mới tạo);
         id lạ / đã mất thì bỏ qua để không kéo hỏng cả bảng */
      const ordered = []
      for (const key of order) {
        if (newIdByKey[key]) { ordered.push(newIdByKey[key]); continue }
        const m = media.find(x => x.id === key)
        if (m && isVideo(m) && !removes.includes(key)) ordered.push(key)
      }
      /* lấp dải video vào đúng các chỗ video đang chiếm, mục khác giữ chỗ */
      const alive = [...media]
        .filter(m => !removes.includes(m.id))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
          || new Date(b.created_at) - new Date(a.created_at))
      const queue = [...ordered]
      const full = []
      for (const m of alive) {
        if (isVideo(m)) { if (queue.length) full.push(queue.shift()) }
        else full.push(m.id)
      }
      full.push(...queue)
      const ids = [...new Set(full.filter(Boolean))]
      await reorderMedia(ids)
      await loadMedia()
      flash('ok', t('toast.saved'))
    } catch (e) { flash('err', errMsg(t, e)); throw e }
  }
  const doMediaDelete = async (id) => {
    if (!confirm(t('adm.confirmDelete'))) return
    try {
      await deleteMedia(id)
      await loadMedia(); flash('ok', t('toast.mediaDeleted'))
    } catch (e) { flash('err', errMsg(t, e)); throw e }
  }
  const doMediaReorder = async (ids) => {
    try { await reorderMedia(ids); await loadMedia() }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  const viewMediaHome = useCallback(() => {
    setAdmin(false)
    go('board')
    requestAnimationFrame(() => {
      setTimeout(() => document.getElementById('home-media')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    })
  }, [go])
  const openAdmin = (tab = 'pending') => setAdmin(tab)
  /* Dang xuat phai LUON tra ve man dang nhap. Truoc day dung
     signOut().then(() => setUser(null)): mang loi la promise reject, setUser
     khong bao gio chay, va nguoi dung ket lai trong tai khoan cu. Don state
     cuc bo truoc, roi moi bao cho server. */
  const doSignOut = useCallback(async () => {
    setUser(null); setAdmin(false); setProfile(false); setModal(false); setMenu(false)
    try { await signOut() } catch { /* phien cuc bo da bi don o tren */ }
  }, [])
  const openModal = (t) => { setModalTab(t); setModal(true) }

  useEffect(() => {
    const h = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) {
        if (e.key === 'Escape' && el.tagName === 'INPUT') { setQ(''); el.blur() }
        return
      }
      if (modal || admin || profile || voteFor || menu) return
      if (e.key === '/') {
        e.preventDefault()
        if (section !== 'board') go('board')
        requestAnimationFrame(() => searchRef.current?.focus())
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openModal('request')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modal, admin, profile, voteFor, menu, section, go])

  /* ---------------- render ---------------- */
  if (booting || !ready) return <Splash hide={!booting && ready} />
  if (!user) return (<><Splash hide /><LoginGate onDemoLogin={setUser} /></>)

  const myStats = fullRanking.find(p => p.user_id === user.id)

  return (
    <>
      <Splash hide />
      <div className="scroll-progress" ref={progressRef} aria-hidden="true" />
      <a className="skip-link" href="#main">Skip to content</a>

      <Sidebar
        sections={SECTIONS} routes={ROUTES} section={section} onNavigate={go}
        user={user} counts={counts}
        open={menu} onClose={() => setMenu(false)}
        collapsed={collapsed} onToggle={toggleSide}
        onNewRequest={() => openModal('request')}
        onProfile={() => setProfile(true)}
        onAdmin={openAdmin}
        onSignOut={doSignOut}
      />

      <div className={`shell${collapsed ? ' min' : ''}`}>
      <main className="main" id="main" tabIndex={-1}>
        <span className="top-sentinel" ref={topSentinelRef} aria-hidden="true" />
        <header className="mainhead">
          <button className="fab only-narrow" type="button" aria-label={t('menu.open')}
            aria-expanded={menu} onClick={() => setMenu(true)}>
            <span /><span /><span />
          </button>
          <div className="mainhead-tx" key={section}>
            <h1 className="mainhead-t">{t(`nav.${section}`)}</h1>
            <p className="mainhead-sub">{t(`nav.${section}Sub`)}</p>
          </div>
          <Notifications
            open={bellOpen} notices={notices} rank={standings}
            rowsByKey={rowsByKey} prefs={prefs}
            onToggle={() => setBellOpen(o => !o)}
            onClose={() => setBellOpen(false)}
            onOpenNotice={openNotice}
            onReadAll={() => setNotices(markAllRead)}
            onDrop={doDropNotice}
            onBrowse={() => { setBellOpen(false); go('board') }}
            onVote={(r) => { setBellOpen(false); openVote(r) }}
            onPrefs={doSetPrefs}
          />
          <button className="btn btn-primary only-narrow" onClick={() => openModal('request')}>
            {t('btn.newRequest')}
          </button>
        </header>
        <div className="sect" key={section}>

        {/* ======= MỤC 1: BẢNG YÊU CẦU ======= */}
        {section === 'board' && (
          /* .board: một cột ở bản hẹp, hai cột (nội dung + video) từ 1300px —
             xem khối "BỐ CỤC BẢNG" trong index.css. Thứ tự DOM vẫn là thứ tự
             đọc: thống kê → video → Up next → vote → danh sách. */
          <div className="board">
            <div className="stats" data-reveal data-glow>
              <Stat c="var(--queued)" v={counts.queued} label={t('stat.queued')} />
              <Stat c="var(--progress)" v={counts.in_progress} label={t('stat.inProgress')} />
              <Stat c="var(--done)" v={counts.completed} label={t('stat.completed')} />
              <Stat c="var(--paid)" v={pub.filter(r => r.is_paid).length} label={t('stat.paid')} />
            </div>

            <MediaShowcase featured={featured} videos={latest}
              canEdit={user?.isAdmin} onAdd={() => openAdmin('media')} />

            {/* ======= UP NEXT: các request đã được chốt, chưa xong.
                Khối này luôn hiện để mốc giờ chốt tiếp theo không bao giờ
                biến mất (kể cả khi chưa có request nào được chốt). ======= */}
            {
              <div className={`nowbar${picked.some(r => r.status === 'in_progress') ? ' live' : ''}`}
                data-reveal data-glow>
                <span className="nbar" aria-hidden="true" />
                <div className="now-head">
                  <div className="lbl">
                    {t('now.next')}
                    {pickedGroups.length > 0 && <span className="now-n">{pickedGroups.length}</span>}
                  </div>
                  <Countdown pick={pick} />
                </div>

                {pickedGroups.length === 0 ? (
                  <h3 className="now-empty">{t('now.noPick')}</h3>
                ) : (
                  <div className="now-list">
                    {pickedGroups.slice(0, NOW_SHOW).map((g, i) => {
                      const rep = g.rep
                      const working = rep.status === 'in_progress'
                      return (
                        <div className={`now-item${g.rows.length > 1 ? ' now-group' : ''}`} key={g.key} style={{ '--i': i }}>
                          <h3>
                            {g.title} <span>— {g.artist}</span>
                            {g.paid && <span className="pill gold">PAID</span>}
                            {g.rows.length > 1 && <span className="pill group">×{g.rows.length}</span>}
                          </h3>
                          <div className="sub">
                            <span className="status" style={{ '--c': STATUS_META[rep.status].c }}>{t(`status.${rep.status}`)}</span>
                            <span className={`kind ${kindCls(rep.kind)}`}>{rep.kind}</span>
                            <span className="dot" aria-hidden="true" /><span>{g.votes} {t('now.votes')}</span>
                            <span className="dot" aria-hidden="true" /><span>{t('now.pickedAgo', { t: timeAgo(g.rep.picked_at, t) })}</span>
                            {working && <><span className="dot" aria-hidden="true" /><span>{rep.progress}%</span></>}
                          </div>
                          {working && <div className="bar"><i style={{ width: `${rep.progress}%` }} /></div>}
                          {g.rows.length > 1 && (
                            <ul className="now-members">
                              {g.rows.map(rr => (
                                <li key={rr.id}>
                                  <span className="status" style={{ '--c': STATUS_META[rr.status].c }}>{t(`status.${rr.status}`)}</span>
                                  {rr.is_paid && <span className="pill gold">PAID</span>}
                                  <span>{rr.votes} {t('now.votes')}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="now-foot">
                  <span className="now-rule">{t('now.pickRule', { n: pick?.interval_days || 4 })}</span>
                  {pickedGroups.length > NOW_SHOW && (
                    <button type="button" className="btn btn-sm now-more" onClick={showAllPicked}>
                      {t('now.more', { n: pickedGroups.length })}
                    </button>
                  )}
                </div>
              </div>
            }

            <section className="votepanel" data-reveal data-glow>
              <div className="vp-main">
                <div className="vp-label">{t('vp.yourVotes')}</div>
                <div className="vp-big">
                  <Num v={votesLeft} />
                  <span>{t('vp.left')}</span>
                </div>
              </div>
              <div className="vp-divider" />
              <div className="vp-cell">
                <div className="vp-k">{t('vp.freeToday')}</div>
                <div className="vp-v" style={{ color: freeLeft > 0 ? 'var(--done)' : 'var(--denied)' }}>
                  <Num v={freeLeft} /> / {voteStatus.free_limit}
                </div>
                <div className="vs-bar" style={{ marginTop: 6 }}>
                  <i style={{ width: `${(freeLeft / voteStatus.free_limit) * 100}%` }} />
                </div>
                <div className="vp-note">{t('vp.reset')}</div>
              </div>
              <div className="vp-cell">
                <div className="vp-k">{t('vote.purchased')}</div>
                <div className="vp-v" style={{ color: 'var(--paid)' }}><Num v={voteStatus.purchased ?? 0} /></div>
              </div>
              <div className="vp-cell">
                <div className="vp-k">{t('vote.bonus')}</div>
                <div className="vp-v" style={{ color: 'var(--a-2)' }}><Num v={voteStatus.bonus ?? 0} /></div>
                <div className="vp-note">{t('vp.bonusReset')}</div>
              </div>
              <div className="vp-acts">
                <button className="btn" onClick={() => openModal('vote')}>{t('vp.goVote')}</button>
                <button className="btn" onClick={() => go('spin')}>{t('nav.spin')}</button>
                <button className="btn btn-gold" onClick={() => openModal('buy')}>{t('vp.buy')}</button>
              </div>
            </section>

            <div className="board-list">
              <div className="section-title">{t('board.listTitle')}</div>
              <div className="toolbar">
                <div className="tabs">
                  {FILTERS.filter(f => f.k !== 'watch' || watchedSet.size > 0).map(f => (
                    <button key={f.k} className={`tab${filter === f.k ? ' on' : ''}`} onClick={() => setFilter(f.k)}>
                      {t(`filter.${f.k}`)}<span className="n">{counts[f.k]}</span>
                    </button>
                  ))}
                </div>
                <div className="spacer" />
                <select className="sel" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
                  <option value="all">{t('board.allKinds')}</option>
                  {Object.keys(KIND_META).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <span className="searchwrap">
                  <input ref={searchRef} className="search" placeholder={t('board.search')} value={q}
                    onChange={e => setQ(e.target.value)} aria-keyshortcuts="/" />
                  {!q && <kbd className="search-kbd" aria-hidden="true">/</kbd>}
                </span>
              </div>

              <div className="list" data-glow key={filter} ref={listRef}>
                {boardItems.length === 0
                  ? <div className="empty">{filter === 'watch' ? t('nt.none') : t('board.empty')}</div>
                  : pgBoard.items.map((e, i) => (e.type === 'group'
                    ? (
                      <RequestGroup key={e.key} g={e} i={pgBoard.from - 1 + i}
                        expanded={!!openGroups[e.key]} onToggle={() => toggleGroup(e.key)}
                        user={user} myVotes={myVotes} onVote={openVote} onDelete={doDelete}
                        followed={watchedSet.has(e.key)} onWatch={doToggleWatch} hl={hlSong === e.key}
                        st={standings.get(e.key)} />
                      )
                    : (
                      <RequestRow key={e.r.id} r={e.r} i={pgBoard.from - 1 + i} n={i}
                        showDelete={e.r.user_id === user.id}
                        myCount={myVotes.get(e.r.id) || 0}
                        canVote={(e.r.status === 'queued' || e.r.status === 'in_progress') && !isPicked(e.r)}
                        onVote={openVote}
                        onDelete={doDelete}
                        followed={watchedSet.has(groupKey(e.r))} onWatch={doToggleWatch} hl={hlSong === groupKey(e.r)}
                        st={standings.get(groupKey(e.r))} />
                      )
                  ))}
              </div>
              <Pager {...pgBoard} onChange={pgBoard.setPage} scrollTo={listRef} />
            </div>{/* /.board-list */}
          </div>
        )}

        {section === 'spin' && (
          <Suspense fallback={<div className="empty" role="status">{t('spin.loading')}</div>}>
            <DailySpin key={user.id} userId={user.id} credits={voteStatus.credits}
              purchased={voteStatus.purchased} bonus={voteStatus.bonus}
              onBalance={applySpinBalance} onVote={() => openModal('vote')} />
          </Suspense>
        )}

        {/* ======= MỤC 2: XẾP HẠNG ======= */}
        {section === 'ranking' && (
          <Leaderboard rows={fullRanking} meId={user.id} />
        )}

        {/* ======= MỤC 3: CỦA TÔI ======= */}
        {section === 'mine' && (
          <>
            <div className="stats" data-glow>
              <Stat c="var(--a-2)" v={mineRows.length} label={t('stat.submitted')} />
              <Stat c="var(--pending)" v={mineRows.filter(r => r.status === 'pending').length} label={t('stat.pending')} />
              <Stat c="var(--done)" v={myStats?.completed ?? 0} label={t('stat.completed')} />
              <Stat c="var(--a-2)" v={myStats?.total_votes ?? 0} label={t('stat.votesReceived')} />
            </div>

            <div className="section-title">{t('mine.title')}</div>
            <div className="list" data-glow ref={mineRef}>
              {mineRows.length === 0
                ? <div className="empty">{t('mine.empty')}</div>
                : pgMine.items.map((r, i) => (
                  <RequestRow key={r.id} r={r} n={i} showDelete
                    myCount={myVotes.get(r.id) || 0}
                    canVote={(r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)}
                    onVote={openVote}
                    onDelete={doDelete}
                    followed={watchedSet.has(groupKey(r))} onWatch={doToggleWatch}
                    st={standings.get(groupKey(r))} />
                ))}
            </div>
            <Pager {...pgMine} onChange={pgMine.setPage} scrollTo={mineRef} />

            <div className="section-title" style={{ marginTop: 26 }}>{t('mine.orders')}</div>
            <div className="list" ref={ordersRef}>
              {myOrders.length === 0
                ? <div className="empty">{t('mine.ordersEmpty')}</div>
                : pgOrders.items.map(o => (
                  <div className="row" key={o.id} style={{ '--sc': o.status === 'paid' ? 'var(--done)' : o.status === 'rejected' ? 'var(--denied)' : 'var(--pending)' }}>
                    <div className="body">
                      <div className="title">{o.kind === 'votes' ? t('order.votes', { n: o.qty }) : t('order.paidRequest')}</div>
                      <div className="meta">
                        <span>{vnd(o.amount_vnd)}</span>
                        <span className="dot" aria-hidden="true" />
                        <span>{usd(o.amount_usd)}</span>
                        <span className="dot" aria-hidden="true" /><span>{timeAgo(o.created_at, t)}</span>
                      </div>
                    </div>
                    <span className={`pill ${o.status === 'paid' ? 'completed' : o.status === 'rejected' ? 'denied' : 'pending'}`}>
                      {o.status === 'paid' ? t('order.paid') : o.status === 'rejected' ? t('order.rejected') : t('order.awaiting')}
                    </span>
                    {o.status === 'awaiting' && (
                      <button className="icon-btn" title={t('order.cancel')} aria-label={t('order.cancel')}
                        onClick={() => doCancelOrder(o)}>×</button>
                    )}
                  </div>
                ))}
            </div>
            <Pager {...pgOrders} onChange={pgOrders.setPage} scrollTo={ordersRef} />
          </>
        )}

        </div>{/* /.sect */}

        <button type="button" className={`to-top${showTop ? ' on' : ''}`} onClick={scrollTop}
          aria-label={t('top.label')} aria-hidden={!showTop} tabIndex={showTop ? 0 : -1}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5.6 5.3 12.4 6.7 13.8 11 9.5V19h2V9.5l4.3 4.3 1.4-1.4L12 5.6Z" fill="currentColor" />
          </svg>
        </button>

        <footer className="site-footer">
        <div className="foot-in">
          <div className="foot-brand">
            <span className="applogo lg-foot"><img src="/logo-128.png" alt="chaereve" width="32" height="32" /></span>
            <div>
              <div className="foot-name">Chaereve</div>
              <div className="foot-tag">{t('foot.tag')}</div>
            </div>
          </div>
          <div className="foot-legal">
            <div className="foot-copy">{t('foot.copy', { y: new Date().getFullYear() })}</div>
            <div className="foot-contact">
              {t('support.line')}{' '}
              <a href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer">t.me/{SUPPORT.telegram}</a>
              {' · '}
              {/* trang tĩnh trong public/ — trước đây không có link nào trỏ tới */}
              <a href="/privacy.html">{t('foot.privacy')}</a>
            </div>
          </div>
        </div>
        </footer>
      </main>
      </div>{/* /.shell */}

      <VoteModal
        open={!!voteFor} request={voteFor}
        myCount={voteFor ? (myVotes.get(voteFor.id) || 0) : 0}
        votesLeft={votesLeft}
        onClose={() => setVoteFor(null)}
        onVote={doVote}
        onBuy={() => { setVoteFor(null); openModal('buy') }}
      />

      <ProfileModal
        open={profile} user={user} onClose={() => setProfile(false)}
        onSaved={async () => { const u = await getUser(); setUser(u); await load(u); flash('ok', t('toast.profSaved')) }}
      />

      <Suspense fallback={null}>

        {/* onVoteExisting: "bài này đã có trên bảng" → đóng form, mở thẳng hộp
            vote của bài đó — người dùng định làm gì thì làm đúng việc đó, chỉ
            ở chỗ khác. (Chú thích đặt TRƯỚC thẻ, không nằm giữa danh sách
            prop: bộ parse của propContract.test.js đọc chữ trong comment giữa
            hai prop thành tên prop và báo "dây đứt" oan.) */}
        <ActionModal
          open={modal} tab={modalTab} setTab={setModalTab} onClose={() => setModal(false)}
          rows={pub} myVotes={myVotes} myOrders={myOrders}
          onVoteExisting={(r) => { setModal(false); openVote(r) }}
          voteStatus={voteStatus} onVote={openVote} onSubmit={doSubmit} onBuy={doBuy}
          onCancelOrder={doCancelOrder} userName={user.name} live={hasSupabase}
        />
      </Suspense>

      {user.isAdmin && (
        <Suspense fallback={null}>
          <AdminPanel
            key={String(admin)} open={!!admin} initialTab={admin || 'pending'}
            onClose={() => setAdmin(false)}
            rows={rows} orders={orders} media={featuredRows}
            onReview={doReview} onUpdate={doAdminUpdate} onDelete={doAdminDelete} onOrder={doOrder}
            onPick={doAdminPick}
            onMediaSave={doMediaSave} onMediaCommit={doMediaCommit}
            onMediaDelete={doMediaDelete} onMediaReorder={doMediaReorder}
            onMediaViewHome={viewMediaHome}
          />
        </Suspense>
      )}
    </>
  )
}