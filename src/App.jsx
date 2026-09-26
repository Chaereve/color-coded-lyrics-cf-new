import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon'
import GoogleIcon from './components/GoogleIcon'
import Splash from './components/Splash'
import Leaderboard from './components/Leaderboard'
import LoginGate from './components/LoginGate'
import ProfilePanel from './components/ProfilePanel'
import StreakStrip from './components/StreakStrip'
import ShareCardButton from './components/ShareCardButton'
import AchievementIndex from './components/AchievementIndex'
import VideoPreviewModal from './components/VideoPreviewModal'
import { streakStats, STREAK_MILESTONES, unionActivityDays } from './lib/streak.js'
import { vnDayKey } from './lib/season.js'
import VoteModal from './components/VoteModal'
import Sidebar from './components/Sidebar'
import Pager from './components/Pager'
import MediaShowcase from './components/MediaShowcase'
import Notifications from './components/Notifications'
import Countdown from './components/Countdown'
import FollowBtn from './components/FollowBtn'
import ShareBtn from './components/ShareBtn'
import Comments from './components/Comments'
import PublicProfile from './components/PublicProfile'
import Standing from './components/Standing'
import { ConfirmProvider, useConfirm } from './lib/confirm.jsx'
import { ADMIN_TABS, adminTabPath, readAdminTab } from './lib/adminTabs'
import Progress from './components/Progress'
/* Hai modal nặng (chứa QR thanh toán / toàn bộ form admin) tách khỏi bundle
   chính: người chỉ xem bảng không phải tải code chỉ dùng khi bấm nút. */
const ActionModal = lazy(() => import('./components/ActionModal'))
const AdminPanel = lazy(() => import('./components/AdminPanel'))
const DailySpin = lazy(() => import('./components/DailySpin'))
import { KIND_META, inChain, isPicked, kindCls, statusColor, statusLabel, timeAgo, vnd, usd } from './lib/meta'
import { useI18n, errMsg } from './lib/i18n.jsx'
import { sfx } from './lib/sfx'
import { useReveal } from './lib/useReveal'
import { absolute, pushUrl, putUrl, here, profileUrl, boardSearchUrl, songQuery, searchWithoutProfile } from './lib/history'
import { createSectionTransition } from './lib/viewTransition'
import { NavProvider, useNav, spaLink } from './lib/nav.js'
import Boundary from './components/Boundary'
import { usePager } from './lib/usePager'
import { STAGES, boardItems as buildBoardItems, chainRows, filterBoard, groupIds, groupKey, parseRequestPrefill, pickBoardParam, songCount, stageCounts, weeklyHighlights as buildWeeklyHighlights } from './lib/board'
import { copyText } from './lib/clipboard'
import {
  DEFAULT_PREFS, WATCH_LIMIT, diffNotices, dropNotice, isDismissed, loadDismissed, loadInbox, loadPrefs, loadWatched,
  loadOff, markAllRead, markRead, mergeInbox, pickLadder, pushNotices, rememberDismissed, saveInbox, saveOff, savePrefs, saveWatched,
  snapOf, songAttr, syncOwnRequests, toastOf, toggleWatched, watchedKeys, withoutDismissed,
} from './lib/watch'
import { useNotify } from './lib/notify.jsx'
import { useGlow, useCountUp } from './lib/motion'
import { parseYoutube } from './lib/youtube'
import { safeHttpUrl } from './lib/safeUrl'
import { SUPPORT } from './lib/payment'
import {
  hasSupabase, supabase, getUser, onAuthChange, signOut,
  fetchRequests, fetchMyVotes, fetchVoteStatus, claimAchievements, fetchRanking, fetchOrders, fetchMedia,
  fetchActivityDays, touchMyActivity, fetchNotifications, dismissNotification, adminExpireRequest, fetchCommentCounts,
  addRequest, castVote, deleteRequest, buyVotes,
  adminReview, adminUpdateMany, adminOrder, adminPickGroup, cancelOrder,
  saveMedia, deleteMedia, deleteMediaMany, reorderMedia, FREE_VOTES_PER_DAY, PAID_REQUEST,
} from './lib/db'

/* Mục chính của trang. Bảng Admin là MỘT MỤC có địa chỉ riêng (`/admin`) chứ
   không phải hộp thoại: nó là nơi làm việc thật (soát bài, duyệt, sửa mốc tiến
   độ, xử lý đơn) nên phải vào được bằng link, F5 không mất chỗ đang đứng, và
   mở được ở tab trình duyệt thứ hai bên cạnh trang công khai. */
const SECTIONS = ['board', 'spin', 'ranking', 'mine']
const ADMIN_ONLY = 'admin'

/* Nhịp của màn chờ — hai mốc, xem effect trong App(): sàn và trần. */
const SPLASH_MS = 560
const SPLASH_MAX_MS = 2600

const PER_PAGE = 20
const PER_PAGE_ORDERS = 10

/* Nhịp tự nạp lại khi lần nạp đầu hỏng: đợi 8 giây cho ván mạng kịp ổn, và
   chỉ ba lượt — đủ để qua một cơn chập chờn, không đủ thành tiếng gõ cửa liên
   tục vào một máy chủ đang hỏng thật. */
const AUTO_RETRY_MS = 8000
const AUTO_RETRY_MAX = 3

/* khối Up next hiện tối đa bao nhiêu request, còn lại nằm sau nút "View all" */
const NOW_SHOW = 2

/* Dòng phụ dưới tiêu đề trang — CHỈ những mục có câu trả lời thật cho câu hỏi
   "trang này để làm gì". Bảng xếp hạng cố ý KHÔNG có dòng phụ: câu cũ ("ai gửi
   nhiều nhất, ai được làm xong") vừa lặp lại chính tên trang, vừa nói một điều
   mà bảng đã nói bằng số. Mục nào không có trong bảng này thì không vẽ dòng
   phụ, chứ không vẽ một dòng rỗng. */
const NAV_SUB = {
  board: 'nav.boardSub', spin: 'nav.spinSub', mine: 'nav.mineSub', admin: 'nav.adminSub',
}

const ROUTES = { board: '/', spin: '/daily-spin', ranking: '/ranking', mine: '/profile', admin: '/admin' }
const sectionOf = (path) => {
  const clean = path.replace(/\/+$/, '') || '/'
  return Object.keys(ROUTES).find(k => ROUTES[k] === clean) || 'board'
}

/* Trang cá nhân công khai đang mở, đọc từ địa chỉ — dùng đúng HAI lần: lúc
   khởi tạo state và lúc Back/Forward (`onPop`). Mọi lần mở/đóng sau đó đi qua
   state (xem `openProfile`/`closeProfile`), vì địa chỉ là bản sao chứ không
   phải nguồn sự thật: trong iframe bị sandbox `pushState` ném lỗi và không ghi
   được, mà người bấm vẫn phải tới được trang cá nhân.
   Hai dạng được nhận: `/?profile=<id>` (dạng link hiện tại) và `/u/<id>`
   (dạng cũ còn nằm trong lịch sử duyệt web / link đã dán ra ngoài). */
const readProfileId = () => {
  const path = window.location.pathname
  if (path.startsWith('/u/')) return decodeURIComponent(path.slice(3).replace(/\/+$/, '')) || null
  return new URLSearchParams(window.location.search).get('profile') || null
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

const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/* MỘT cửa cho chuyển cảnh giữa hai mục (xem lib/viewTransition.js): nó giữ cờ
   "đang bay" nên hai cú bấm liên tiếp không thể mở hai chuyến cùng lúc — đúng
   cách sinh ra hai tấm ảnh chụp lồng nhau = "chồng trang". */
const sectionTransition = createSectionTransition({ reduced: REDUCED })

/* BA NHÓM, ĐÚNG THỨ TỰ NGƯỜI TA ĐỌC BẢNG.
   `c` là màu VẠCH của mục (CSS đọc qua biến `--c`), `ax` là nhóm — mục đầu
   tiên của một nhóm mới mở đầu bằng một vạch ngăn dọc trong dải (xem
   `.fchips .dot` trong index.css).

     · pipe — bốn GIAI ĐOẠN của dây chuyền, xếp theo đúng thứ tự công việc
       chạy (Queue → Up next → In progress → Done). Bản cũ để "In progress"
       đứng sau "Top voted": dây chuyền bị cắt làm hai khúc.
     · view — hai CÁCH NHÌN cả bảng. Cùng một màu nhấn (`--a-2`, sắc độ dùng
       được cho chữ/icon trên nền tối) vì đây không phải hai giai đoạn khác
       nhau; `--a` nguyên bản ở đây sẽ là một vạch gần như vô hình (3px màu
       hue 242 ở 40% opacity trên nền #10141a).
     · you  — việc của riêng người đang xem. Chỉ hiện khi có ít nhất một bài
       đang theo dõi (rỗng thì mục này vô nghĩa), nên nhóm này có thể vắng
       mặt — vạch ngăn của nó cũng phải biến mất theo (xem chỗ dựng dải). */
const FILTERS = [
  { k: 'queued',      c: 'var(--queued)',   ax: 'pipe' },
  { k: 'picked',      c: 'var(--queued)',   ax: 'pipe' },
  { k: 'in_progress', c: 'var(--progress)', ax: 'pipe' },
  { k: 'completed',   c: 'var(--done)',     ax: 'pipe' },
  { k: 'newest',      c: 'var(--a-2)',      ax: 'view' },
  { k: 'top',         c: 'var(--a-2)',      ax: 'view' },
  { k: 'watch',       c: 'var(--a-2)',      ax: 'you' },
]
const FILTER_KEYS = FILTERS.map(f => f.k)
const KIND_KEYS = ['all', ...Object.keys(KIND_META)]

function Num({ v }) {
  const n = useCountUp(v)
  return <b key={v} className="tick">{n}</b>
}

/* =========================================================
   "KHÔNG LOAD DỮ LIỆU" LÀ BA CHUYỆN KHÁC NHAU — VÀ TỪNG BỊ
   HIỆN BẰNG ĐÚNG MỘT CÂU
   ---------------------------------------------------------
   Ba trạng thái của lần nạp đầu từng rơi vào cùng một khối
   chữ "Nothing here yet. Try another filter…". Người dùng
   không có cách nào biết mình đang gặp cái nào:

     · đang tải   — đợi thêm một nhịp là có (trước đây: tưởng
                    xong rồi, và kết luận là web trống);
     · lỗi        — CÓ CÁCH SỬA, và sửa được ngay tại chỗ bằng
                    nút bấm (trước đây: không nút, không chữ,
                    đường duy nhất là đoán ra việc bấm F5);
     · trống thật — không có gì để sửa, và câu cũ nói đúng.

   Hiện đúng trạng thái là xong được hai phần ba cái lỗi mà
   người dùng phải tự giải quyết bằng F5.
   ========================================================= */

/* Đang tải: hàng xương giữ đúng chỗ của danh sách — người dùng thấy "dữ liệu
   đang tới" thay vì một bảng trống, và khối không nhảy lên khi dữ liệu về. */
function ListSkeleton({ n = 4, label }) {
  return (
    <div className="sklist" role="status" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <div className="skrow" key={i} style={{ '--i': i }} aria-hidden="true">
          <span className="sk sk-l1" />
          <span className="sk sk-l2" />
          <span className="sk sk-vote" />
        </div>
      ))}
    </div>
  )
}

/* Lỗi: nói thẳng là không tải được (không phải "chưa có bài"), và cho nút. */
function LoadErr({ onRetry }) {
  const { t } = useI18n()
  return (
    <div className="empty load-err" role="alert">
      <span className="empty-ico" aria-hidden="true"><Icon name="warn" size={18} /></span>
      <b>{t('board.loadErr')}</b>
      <small>{t('board.loadErrHint')}</small>
      <div className="empty-acts">
        <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>{t('board.retry')}</button>
      </div>
    </div>
  )
}

/* Ô thống kê: `why` là định nghĩa của con số, dán vào `title` — người đọc tự
   đối chiếu được "In progress" ở đây nghĩa là gì (dây chuyền đã chốt) thay vì
   đoán theo nhãn. Con số không có định nghĩa là con số người ta không tin. */
function Stat({ c, v, label, why }) {
  return (
    <div className="stat" style={{ '--c': c }} title={why}>
      <Num v={v} />
      <span>{label}</span>
    </div>
  )
}

/* =========================================================
   KHỐI MỜI ĐĂNG NHẬP — CHỖ ĐỨNG CỦA MỤC RIÊNG TƯ KHI CHƯA CÓ TÀI KHOẢN
   ---------------------------------------------------------
   LỖI ĐÃ GẶP THẬT: "Daily Spin trống trơn". Mục spin chỉ dựng vòng
   quay KHI ĐÃ CÓ người đăng nhập, nên khách nhận một trang trắng —
   không chữ, không lý do, không nút. Mục About me thì ngược lại: nó
   dựng nguyên khối sửa hồ sơ cho khách, với ô tên trống và nút Lưu
   không bao giờ chạy được (update_my_profile raise `err.signin`).

   Cả hai chỗ nay dùng đúng một khối: nói ra vì sao trang này cần tài
   khoản, và cho một nút mở màn đăng nhập (cửa sổ nổi đã có nút X, nên
   người dùng không bị kẹt trong đó).
   ========================================================= */
function SignInPanel({ title, body, onSignIn }) {
  const { t } = useI18n()
  return (
    <div className="empty signin-panel">
      <span className="empty-ico" aria-hidden="true"><Icon name="user" size={18} /></span>
      <b>{title}</b>
      <small>{body}</small>
      <button type="button" className="btn btn-primary signin-panel-btn" onClick={onSignIn}>
        <GoogleIcon size={15} />{t('gate.google')}
      </button>
    </div>
  )
}

/* ---------------- một dòng request ---------------- */
function RequestRow({ r, i, n = 0, showDelete, myCount = 0, canVote, onVote, onDelete, user = null,
  followed = false, onWatch, onShare, onLogin, hl = false, st = null, commentCount = 0, onCommentCountChange }) {
  const { t } = useI18n()
  /* Link người gửi đi trong app (không tải lại trang) — xem lib/nav.js. */
  const nav = useNav()
  const sm = { c: statusColor(r.status) }
  /* Đã vào dây chuyền (chốt vào Up next HOẶC đang làm) thì khóa vote, kể cả
     rút lại: bài sắp/đang được làm mà vẫn nhận phiếu thì lá phiếu không còn
     nghĩa gì. Trước đây chỉ khóa theo isPicked nên một bài in_progress thiếu
     picked_at vừa không hiện ở tab nào, vừa vẫn nhận vote. */
  const locked = inChain(r)
  const votable = canVote && !locked
  const watchUrl = safeHttpUrl(r.video_url)

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
          {r.title} <span className="artist">— {r.artist}</span>
          {/* Nhãn nằm trong .tags: hộp này tự xuống dòng và giữ khoảng cách
              hàng-dọc, nên "PAID" với "Up next" không bao giờ dán vào nhau. */}
          {(r.is_paid || isPicked(r)) && (
            <span className="tags">
              {r.is_paid && <span className="pill gold">PAID</span>}
              {isPicked(r) && <span className="pill upnext">{t('now.next')}</span>}
            </span>
          )}
        </div>
        <div className="meta">
          <span className="status" style={{ '--c': sm.c }}>{statusLabel(r, t)}</span>
          <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span>
          <span className="dot" aria-hidden="true" />{r.user_id ? <a className="requester-link" href={profileUrl(r.user_id)} onClick={spaLink(nav.openProfile, r.user_id)}>{r.requester}</a> : <span>{r.requester}</span>}
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
          {onShare && <ShareBtn onShare={() => onShare(r)} />}
        </div>
        {/* Việc đang chạy: MỘT khối (vạch + số cùng hàng), không phải số trần
            mang chấm trạng thái rồi một vạch rời nằm dưới. Khối Up next in
            đúng con số này — một bài, một con số. */}
        {r.status === 'in_progress' && <Progress pct={r.progress} label={t('progress.label')} />}
        {watchUrl && <a className="watch" href={watchUrl} target="_blank" rel="noreferrer">{t('row.watch')}</a>}
        <Comments requestId={r.id} user={user} onLogin={onLogin} initialCount={commentCount} onCountChange={onCommentCountChange ? (n) => onCommentCountChange(r.id, n) : undefined} />
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
          onClick={() => onDelete(r.id)}><Icon name="close" size={15} /></button>
      )}
    </div>
  )
}

function RequestGroup({ g, i, expanded, onToggle, user, myVotes, onVote, onDelete,
  followed = false, onWatch, onShare, onLogin, hl = false, st = null, commentCounts, onCommentCountChange }) {
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
            <RequestRow key={r.id} r={r} i={null} n={k} user={user}
              showDelete={r.user_id === user.id}
              myCount={myVotes.get(r.id) || 0}
              canVote={(r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)}
              onVote={onVote}
              onShare={onShare}
              onLogin={onLogin}
              onDelete={onDelete}
              commentCount={commentCounts?.[r.id] || 0}
              onCommentCountChange={(n) => onCommentCountChange?.(r.id, n)} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* Màn chờ hiện MỖI LẦN tải trang (chủ dự án chốt 19/09). Bản trước ghim một
   khoá sessionStorage để nó chỉ chạy một lần mỗi tab — tải lại là không thấy
   nữa, và người dùng đọc đúng hiện tượng đó: "màn hình splash mất tiêu".
   Không đọc/ghi storage nữa: thứ quyết định màn chờ là NHỊP KHỞI ĐỘNG, không
   phải lịch sử duyệt web. */
function AppInner() {
  /* Hộp xác nhận trong app — thay `confirm()`/`prompt()` của trình duyệt:
     trong iframe bị chặn hộp thoại, hai hàm đó trả về false/null mà KHÔNG báo
     gì, nên nút Xoá/Huỷ trông như bị hỏng (xem components/ConfirmDialog.jsx). */
  const ask = useConfirm()
  const { t } = useI18n()
  const { push } = useNotify()
  useGlow()
  const [booting, setBooting] = useState(true)
  /* `readyRef` chứ không phải state: cờ này chỉ được ĐỌC trong một timeout lúc
     mở trang, không vẽ ra gì cả. Bản trước giữ thêm một `useState(false)` và gọi
     `setReady(true)` khi tải xong — một lần render lại toàn trang chỉ để đặt một
     giá trị không ai đọc. */
  const readyRef = useRef(false)
  const [user, setUser] = useState(null)
  const [authPrompt, setAuthPrompt] = useState(false)
  const currentUserId = useRef(null)
  // Public browsing uses a stable, non-account identity only for presentational props.
  const viewer = user || { id: null, name: '', avatar: '', isAdmin: false }
  useLayoutEffect(() => { currentUserId.current = user?.id }, [user?.id])

  const [rows, setRows] = useState([])
  /* TRẠNG THÁI CỦA LẦN NẠP ĐẦU — thứ từng bị thiếu, và chính cái thiếu đó là
     lỗi "vào web không thấy dữ liệu":
       · 'loading' — chưa có câu trả lời nào. Bảng phải nói "đang tải", không
         được nói "Nothing here yet." (câu đó là nói DỐI: chưa ai hỏi xong);
       · 'ready'   — đã có ít nhất một lần nạp thành công;
       · 'error'   — đã thử (có thử lại) mà vẫn hỏng → hiện khối lỗi CÓ NÚT.
     Không có trạng thái này thì một lần nạp hỏng và một bảng thật sự trống
     hiện ĐÚNG MỘT THỨ trên màn hình, và người dùng được giao việc đoán xem
     mình đang gặp cái nào. */
  const [boardState, setBoardState] = useState('loading')
  /* Ghi nhận kết quả của MỘT lần nạp. Luật khoan dung ở đây là thứ giữ bảng
     không bị xoá: lỗi CHỈ được ghi khi chưa có lần nạp nào thành công.
     Lúc mở trang có hai đường chạy song nhau (nạp công khai, rồi nạp theo tài
     khoản khi biết mình là ai); một đường hỏng mà đường kia đã xong thì bảng
     vẫn đứng — chứ không bị tắt đi rồi chờ người dùng bấm F5. */
  const noteBoard = useCallback((ok) => {
    setBoardState(s => (ok || s !== 'ready' ? (ok ? 'ready' : 'error') : s))
  }, [])
  const [myVotes, setMyVotes] = useState(new Map())
  const [voteStatus, setVoteStatus] = useState({
    free_used: 0, free_limit: FREE_VOTES_PER_DAY, credits: 0, purchased: 0, bonus: 0,
    bonus_requests: 0,
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
  /* Dấu ngày hoạt động của chính người xem (streak). null = chưa đọc được
     nguồn (chưa chạy migration / lỗi mạng) — dải streak tự ẩn, xem StreakStrip.
     `visitStamp` là ngày server vừa đóng cho lần ghé này. Ghép vào danh sách
     đã đọc để một lần nạp bắt đầu trước khi dấu được ghi không nuốt mất hôm nay. */
  const [myActivity, setMyActivity] = useState(null)
  const [visitStamp, setVisitStamp] = useState(null)
  /* Đổi tài khoản thì xoá dấu của người vừa rồi ngay trong lần render này,
     trước khi vẽ — ngọn lửa không được kịp hiện chuỗi của tài khoản cũ. */
  const [activityUserId, setActivityUserId] = useState(user?.id)
  if (user?.id !== activityUserId) {
    setActivityUserId(user?.id)
    setMyActivity(null)
    setVisitStamp(null)
  }
  const [orders, setOrders] = useState([])
  const [media, setMedia] = useState([])
  const [pick, setPick] = useState(null)   // { interval_days, last_pick_at, next_pick_at }
  const [hallVideo, setHallVideo] = useState(null)

  /* ------- theo dõi + hộp thư (prototype: localStorage, xem lib/watch.js) -------
     `watched` là danh sách BÀI (khóa = groupKey), không phải danh sách dòng:
     một bài bị nhiều người gửi lẻ vẫn chỉ có một mục theo dõi. */
  const [watched, setWatched] = useState([])
  const [notices, setNotices] = useState([])
  /* uid đã nạp xong hộp thư. Không có cờ này thì effect lưu chạy trên mảng
     rỗng của khung hình đầu (user vừa có, notices chưa đọc từ localStorage)
     và XÓA hộp thư — kể cả những tin người dùng đã xóa, lẫn những tin còn
     giữ. Lần vào sau chỉ còn tin database kéo lại. */
  const [inboxUid, setInboxUid] = useState(null)
  const dismissedRef = useRef(new Set())
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
  /* TRANG CÁ NHÂN CÔNG KHAI là một mục trong state, không phải thứ đọc lại từ
     `window.location` mỗi lần render. Bản cũ đọc lúc render nên nó chỉ đổi khi
     có MỘT STATE KHÁC đổi theo (React bỏ qua lượt render nếu mọi setState đều
     trùng giá trị), và nó chết hẳn khi `pushState` bị chặn — đúng hai triệu
     chứng chủ dự án báo: "bấm profile bị quay về trang chủ" và "bấm không được
     gì". State đổi trước, địa chỉ ghi sau bằng `pushUrl` (không bao giờ ném). */
  const [profileId, setProfileId] = useState(readProfileId)
  /* TRANG CÁ NHÂN CÔNG KHAI LÀ MỘT TRANG, KHÔNG PHẢI MỘT MỤC.
     ---------------------------------------------------------
     Nó chỉ tồn tại trong mục Bảng (`openProfile` còn tự đặt `section='board'`),
     nên MỌI khối của các mục khác phải đứng ngoài nó. Bản trước chỉ mục Bảng có
     `!profileId`; ba mục còn lại cứ thế dựng thêm, và kết quả là hai trang nằm
     chồng nhau: khối trang cá nhân của người khác ở trên, mục vừa bấm ở dưới —
     đúng ảnh chụp chủ dự án gửi ("bấm vào profile người khác xong chuyển sang
     tab khác trong trang thì bị chồng trang", ảnh: trang cá nhân rồi ngay dưới
     là "Daily bonus wheel").
     Nay cả năm khối đều đi qua CÙNG một lá cờ, nên không có đường nào dựng hai
     trang một lúc — kể cả khi địa chỉ bị dán tay (`/?profile=…` lúc đang ở
     mục khác) hay khi người dùng bấm Back/Forward. */
  const onProfile = !!profileId
  // The shared aurora sits outside the lazy page. Set its route mode before
  // paint so Daily Spin stays flat on direct loads, navigation and history.
  useLayoutEffect(() => {
    document.documentElement.dataset.section = section
    return () => { delete document.documentElement.dataset.section }
  }, [section])
  const [board] = useState(readBoard)
  const [filter, setFilter] = useState(board.f)
  const [statusFilters, setStatusFilters] = useState(() => STAGES.includes(board.f) ? [board.f] : [])
  const [kindFilter, setKindFilter] = useState(board.k)
  const [kindFilters, setKindFilters] = useState(() => board.k !== 'all' ? [board.k] : [])
  const [q, setQ] = useState(board.q)
  const [showTop, setShowTop] = useState(false)
  /* Bộ lọc trên máy hẹp nằm trong một khối gấp/mở, và thanh lọc tự dính lên
     đầu khi cuộn qua — hai thứ này chỉ để phục vụ việc CHỌN, không phải dữ
     liệu, nên không lưu vào localStorage. */
  const [fbarOpen, setFbarOpen] = useState(false)
  const searchRef = useRef(null)
  /* mốc 0px đầu nội dung — nút "lên đầu trang" theo dõi nó thay vì nghe scroll */
  const topSentinelRef = useRef(null)

  const [voteFor, setVoteFor] = useState(null)
  /* Link mời gửi bài (`/?add=1&artist=…&title=…`) do chủ kênh dán vào mô tả
     video: đọc MỘT lần lúc khởi tạo state nên form mở ngay từ khung hình đầu,
     không phải mở sau một effect (mở trễ một nhịp là thấy trang nháy). */
  const [prefill] = useState(() =>
    parseRequestPrefill(new URLSearchParams(window.location.search)))
  const [modal, setModal] = useState(!!prefill)
  const [modalTab, setModalTab] = useState('request')
  /* `admin` cũ là boolean của hộp thoại; nay là TAB đang mở trong trang
     /admin (null = chưa chọn thì lấy tab đầu). Giữ nguyên tên biến để mọi chỗ
     gọi openAdmin/đóng panel không phải đổi theo. */
  /* Mục đang mở đọc từ ĐỊA CHỈ (`/admin?tab=orders`): F5, nút Back, và dán
     link cho người khác đều mở đúng chỗ đang làm. Địa chỉ là nguồn sự thật,
     state chỉ là bản sao để render. */
  const [admin, setAdmin] = useState(() =>
    (window.location.pathname.replace(/\/+$/, '') === ROUTES.admin
      ? readAdminTab(window.location.search)
      : null))
  const [menu, setMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(readSide)
  useEffect(() => { try { localStorage.setItem(SIDE_KEY, collapsed ? 'min' : 'full') } catch { /* ignore */ } }, [collapsed])
  const toggleSide = useCallback(() => setCollapsed(c => !c), [])
  const scrollTop = useCallback(() => window.scrollTo({ top: 0, behavior: REDUCED() ? 'auto' : 'smooth' }), [])

  /* Thứ tự mục để tính hướng chuyển cảnh: admin nằm cuối, và CHỈ có mặt khi
     người đang xem là admin — người thường không thấy mục này ở đâu cả. */
  const navOrder = useCallback(
    () => (user?.isAdmin ? [...SECTIONS, ADMIN_ONLY] : SECTIONS),
    [user?.isAdmin])

  const go = useCallback((k) => {
    const run = () => {
      setSection(k)
      setMenu(false)
      const narrow = window.matchMedia?.('(max-width: 899px)').matches
      window.scrollTo({ top: 0, behavior: narrow ? 'auto' : 'smooth' })
      /* Chỉ mục Bảng mới có tham số sống ở địa chỉ (`?f=top&q=…`); trang quản
         trị tự ghi `?tab=…` khi đổi mục nên không đi qua đây.
         Và tham số `profile` KHÔNG được đi theo: nếu đi theo thì đang ở trang
         cá nhân của người khác, bấm sang mục khác (trang cá nhân đã đóng) mà
         F5 lại mở lại đúng trang vừa rời. */
      const qs = k === 'board' ? searchWithoutProfile(window.location.search) : ''
      if (ROUTES[k] + qs !== window.location.pathname + window.location.search) {
        pushUrl({ s: k }, ROUTES[k] + qs)
      }
    }
    const order = navOrder()
    const dir = order.indexOf(k) >= order.indexOf(section) ? 'fwd' : 'back'
    /* Hướng đi phải tính TRƯỚC khi đổi mục, và việc đổi mục phải nằm gọn trong
       một lần gọi đồng bộ — xem lib/viewTransition.js để biết vì sao (hai chuyến
       chuyển cảnh cùng lúc là hai tấm ảnh chụp lồng nhau). */
    sectionTransition(dir, run)
    /* `navOrder` phải có trong danh sách phụ thuộc: nó đổi khi người dùng đăng
       nhập/đăng xuất (mục Admin chỉ có mặt với admin), và hướng chuyển cảnh
       được tính từ nó. */
  }, [section, navOrder])

  /* ĐIỀU HƯỚNG TỚI MỘT MỤC TỪ MENU — và đây là chỗ duy nhất mở màn đăng nhập
     theo lượt bấm. About me là trang CỦA MÌNH: khách bấm vào ảnh đại diện hay
     tên mục đó phải thấy ngay màn đăng nhập (chủ dự án báo đúng lỗi này), chứ
     không phải một khối hồ sơ rỗng. Không chặn việc đi tới mục — phía sau lớp
     phủ, mục đó dựng khối mời đăng nhập (xem `SignInPanel`), nên đóng cửa sổ
     lại vẫn có chỗ đứng, và F5 vào `/profile` cũng vậy.
     Đặt ở đây chứ không trong `go`: `go` được gọi từ một effect (đá người
     không phải admin ra khỏi `/admin`), mà setState trong effect là thứ lint
     của repo này đang đếm — thêm một cảnh báo mới cho một việc phụ là lỗ.

     VÀ: bấm một mục trong menu là ý định ĐỔI TRANG. Trang cá nhân công khai
     đang mở phải đóng lại ở đây — không đóng thì nó ở lại phía TRÊN mục vừa
     bấm, hai trang chồng lên nhau (đúng ảnh chụp chủ dự án gửi: khối trang cá
     nhân của người khác, rồi ngay dưới là "Daily bonus wheel"). */
  const navTo = useCallback((k) => {
    if (k === 'mine' && !user) setAuthPrompt(true)
    if (onProfile) setProfileId(null)
    go(k)
  }, [user, go, onProfile])

  /* Nhảy tới bài: bật tab "Following" (nên bài đang pending/bị từ chối cũng
     tìm thấy), làm sáng hàng 2,6 giây rồi tự tắt. */
  const jumpToSong = useCallback((target) => {
    const key = typeof target === 'string' ? target : (target?.key || groupKey(target || {}))
    if (!key) return
    go('board'); setKindFilter('all'); setKindFilters([]); setStatusFilters([]); setQ('')
    /* tab "Following" la noi duy nhat con hien bai pending/bi tu choi; bai
       chua theo doi thi nhay ve bang chung lo, de hien "khong co ket qua" con
       hon la nhay vao mot tab trong sach cua nguoi khac */
    setFilter(watchedSet.has(key) ? 'watch' : 'newest')
    /* XOÁ cả hai bộ lọc nhiều-chọn: chúng THẮNG `filter` trong `filterBoard`,
       nên một chip `Queued` còn bật từ lần lọc trước sẽ giấu đúng cái bài mà
       tin thông báo vừa bảo "bấm vào đây để xem". Cùng một họ lỗi với
       "bấm Recent Request trong trang cá nhân mà bảng nói không có kết quả". */
    setHlSong(key)
    const sel = `[data-song="${songAttr(key)}"]`
    requestAnimationFrame(() => setTimeout(() => {
      const el = document.querySelector(sel) || listRef.current
      el?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'center' })
    }, 90))
    setTimeout(() => setHlSong(s => (s === key ? null : s)), 2600)
  }, [go, watchedSet])

  /* ---------------- trang cá nhân công khai + đi tới một bài ----------------
     Ba hàm này là NỘI DUNG của context `lib/nav.js`: mọi link nội bộ gọi
     chúng thay vì tự ghi địa chỉ. Thứ tự trong mỗi hàm là CỐ Ý — state đổi
     trước (nguồn sự thật, luôn chạy), địa chỉ ghi sau (bản sao, có thể thất
     bại trong iframe sandbox mà không ai mất chức năng). */
  /* Chỗ đứng TRƯỚC khi mở trang cá nhân — là state chứ không phải ref: ba hàm
     dưới đây được truyền xuống cây bằng context và được gọi lúc render (khi
     dựng handler cho thẻ link), nên đọc/ghi ref trong đó là loại lỗi mà React
     Compiler bắt được (`react(refs)`), còn state thì không. */
  const [backTo, setBackTo] = useState(null)
  const toTop = useCallback(
    () => window.scrollTo({ top: 0, behavior: REDUCED() ? 'auto' : 'smooth' }), [])

  /* Bấm MỘT BÀI (từ trang cá nhân, từ thẻ "This week") là muốn xem kết quả,
     không phải muốn đọc lại đầu trang: trên danh sách còn bốn ô thống kê, video
     của kênh, This week, Hall of Fame và Up next — tức là cả một màn hình nữa.
     "Cuộn lên đầu" ở đó nghĩa là người bấm phải tự kéo xuống và tự hỏi cú bấm
     có ăn không. Nên cuộn tới THANH LỌC: chỗ đó thấy được từ khoá vừa đặt, dòng
     "đang xem n/mục", và danh sách nằm ngay bên dưới.
     Chờ một nhịp (rAF + 60ms) vì danh sách được dựng lại từ bộ lọc vừa đổi —
     cuộn ngay là cuộn vào cái danh sách CŨ, và `.list` mang `key={filter}` nên
     đổi cách nhìn là node đó bị thay bằng node khác. */
  const scrollToList = useCallback(() => {
    requestAnimationFrame(() => setTimeout(() => {
      /* Hỏi DOM thay vì giữ ref: hàm này được truyền XUỐNG CÂY (context nav) và
         được gọi ngay trong lúc render để dựng handler cho thẻ link, nên đọc
         `ref.current` bên trong nó là đúng thứ React Compiler bắt (`react(refs)`).
         Gói trong `.board` vì mục "Của tôi" cũng có một `.list` riêng. */
      const el = document.querySelector('.board .fbar') || document.querySelector('.board .list')
      el?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' })
    }, 60))
  }, [])

  const openProfile = useCallback((id) => {
    const key = (id ?? '').toString().trim()
    if (!key) return
    /* Nhớ cả địa chỉ LẪN mục đang đứng: trang cá nhân mở ra từ "Của tôi" thì
       "Back to board" phải trả về đúng "Của tôi", không đẩy người ta ra bảng. */
    setBackTo({ url: here(), section })
    setProfileId(key)
    setSection('board')
    setMenu(false)
    pushUrl({ s: 'profile' }, profileUrl(key))
    toTop()
  }, [section, toTop])

  const closeProfile = useCallback(() => {
    setProfileId(null)
    /* Bộ lọc của bảng KHÔNG bị đụng tới trong lúc trang cá nhân mở, nên trả về
       đúng địa chỉ cũ là trả về đúng danh sách người ta vừa rời đi. */
    if (backTo?.section && backTo.section !== 'board') setSection(backTo.section)
    pushUrl({ s: 'board' }, backTo?.url || ROUTES.board)
    setBackTo(null)
    toTop()
  }, [backTo, toTop])

  /* Đi tới MỘT BÀI từ bất kỳ đâu (thẻ "This week", Recent requests của trang
     cá nhân). Ba việc phải đi cùng nhau, thiếu một là ra danh sách rỗng:
       · `f=newest` — cách nhìn duy nhất thấy MỌI bài. `f=top` cố ý loại bài đã
         xong/đã vào dây chuyền, và "Most voted" tuần này thường chính là bài
         đang làm → link dẫn tới trang trống;
       · XOÁ cả hai bộ lọc nhiều-chọn — một chip `Queued` còn bật từ lần lọc
         trước sẽ giấu bài đã completed (đúng lỗi "bấm Recent Request không
         thấy bài");
       · từ khoá là `tên bài + nghệ sĩ` — và ô tìm nay so THEO TỪ nên thứ tự đó
         khớp được với hàng có `nghệ sĩ` đứng trước (xem `searchHit`). */
  const openSong = useCallback((song) => {
    const query = songQuery(song?.title, song?.artist)
    if (!query) return
    setBackTo(null)
    setProfileId(null)
    setSection('board')
    setMenu(false)
    setStatusFilters([])
    setKindFilters([])
    setKindFilter('all')
    setFilter('newest')
    setQ(query)
    pushUrl({ s: 'board' }, boardSearchUrl(song?.title, song?.artist))
    scrollToList()
  }, [scrollToList])

  const nav = useMemo(
    () => ({ openProfile, openSong, closeProfile }),
    [openProfile, openSong, closeProfile])

  useEffect(() => {
    const onPop = () => {
      setSection(sectionOf(window.location.pathname))
      /* Back/Forward trên trang quản trị: mục đang mở cũng nằm ở địa chỉ nên
         phải đọc lại cùng lúc với mục của trang — không thì địa chỉ nói
         `?tab=done` mà màn hình vẫn đang ở Đơn hàng. */
      setAdmin(readAdminTab(window.location.search))
      /* Nút Back của TRÌNH DUYỆT cũng là một lần đổi trang cá nhân: từ
         `/?profile=…` lùi về `/?f=newest&q=…` thì trang cá nhân phải đóng, và
         đi tới `/?profile=…` thì nó phải mở. Không đọc lại ở đây là Back chỉ
         đổi địa chỉ mà màn hình đứng yên. */
      setProfileId(readProfileId())
      const b = readBoard()
      setFilter(b.f); setStatusFilters(STAGES.includes(b.f) ? [b.f] : []); setKindFilter(b.k); setKindFilters(b.k !== 'all' ? [b.k] : []); setQ(b.q)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* Bản sao của `profileId` cho đúng MỘT việc: đọc giá trị hiện tại từ bên
     trong một bộ hẹn giờ (closure của effect dưới đây giữ giá trị cũ). */
  const profileRef = useRef(null)
  useEffect(() => { profileRef.current = profileId }, [profileId])

  useEffect(() => {
    if (section !== 'board') return
    const id = setTimeout(() => {
      /* Hỏi LẠI lúc sắp ghi, không phải lúc hẹn giờ: trong 320ms chờ đó người
         dùng kịp bấm mở trang cá nhân, và ghi đè lúc ấy là XOÁ địa chỉ
         `/?profile=…` vừa mở — F5 hoặc dán link cho người khác sẽ rơi về bảng. */
      if (profileRef.current || new URLSearchParams(window.location.search).has('profile')) return
      const p = new URLSearchParams()
      if (filter !== 'queued') p.set('f', filter)
      if (kindFilter !== 'all') p.set('k', kindFilter)
      if (q.trim()) p.set('q', q.trim())
      const qs = p.toString()
      const next = ROUTES.board + (qs ? `?${qs}` : '')
      if (next !== window.location.pathname + window.location.search) {
        putUrl({ s: 'board' }, next)
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

  /* VẠCH TIẾN ĐỘ CUỘN ĐÃ BỊ GỠ (vòng 16).
     Nó là một vạch 2px gradient chạy ngang đỉnh màn hình, và có hai lý do để
     đi:
       · TRÙNG CHỨC NĂNG: thanh cuộn của trình duyệt đã nói đúng con số đó, ở
         đúng chỗ người dùng tìm nó. Vạch thứ hai không thêm thông tin nào, chỉ
         thêm một thứ chuyển động chạy suốt lúc cuộn — mà cuộn là thao tác lặp
         nhiều nhất trên trang;
       · TRÙNG MÀU: nó là gradient `--a → --a-2`, đúng cặp màu của thứ duy nhất
         được phép nổi bật (nút hành động chính và mục đang chọn). Một vạch màu
         nhấn chạy ngang đỉnh màn hình suốt phiên làm màu nhấn mất nghĩa
         "chỗ này bấm được".
     Đây cũng là lời nhắc cho lần sau: một thứ vừa trùng chức năng vừa trùng
     màu thì không phải chi tiết nhỏ — nó là thứ làm cả trang trông như có
     nhiều lớp trang trí hơn là một công cụ. */

  useEffect(() => {
    const clean = window.location.pathname.replace(/\/+$/, '') || '/'
    if (!Object.values(ROUTES).includes(clean) && !clean.startsWith('/u/')) {
      putUrl(null, ROUTES.board + window.location.search)
    }
  }, [])

  /* /admin chỉ tồn tại với người có quyền. Gõ tay địa chỉ đó mà không phải
     admin thì bị đưa về bảng request ngay — địa chỉ không phải là chỗ để dò
     xem mình có quyền gì, nhưng cũng không được để trang trắng. */
  useEffect(() => {
    if (section === ADMIN_ONLY && !user?.isAdmin) go('board')
  }, [section, user?.isAdmin, go])

  useEffect(() => {
    if (window.location.hash) {
      putUrl(null, window.location.pathname + window.location.search)
    }
  }, [])

  /* Tham số mời (`add`/`artist`/`title`/`link`) được dùng đúng một lần rồi bỏ
     khỏi URL: để nguyên thì F5 lại mở form một lần nữa, và người dùng đóng form
     xong bấm Back lại thấy nó bật lên. `replaceState` nên không thêm bước vào
     lịch sử duyệt web. */
  useEffect(() => {
    const u = new URL(window.location.href)
    const has = ['add', 'artist', 'title', 'link'].some(k => u.searchParams.has(k))
    if (!has) return
    for (const k of ['add', 'artist', 'title', 'link']) u.searchParams.delete(k)
    const qs = u.searchParams.toString()
    putUrl(null, u.pathname + (qs ? `?${qs}` : '') + u.hash)
  }, [])

  /* Màn chờ chạy theo HAI mốc, không phải một con số cứng:
       · SÀN 560ms — dưới ngưỡng đó logo chỉ kịp nháy một cái, đọc ra là lỗi;
       · DỮ LIỆU đã xong (getUser) — để không mở ra một bảng rỗng rồi mới nhảy;
       · TRẦN 2,6s — mạng hỏng thì màn chờ cũng phải mở, đừng giữ người dùng
         trong tấm ảnh chào.
     Bản trước hẹn giờ 560ms là setBooting(false) bất kể dữ liệu: mạng chậm là
     màn chờ tan ra trước khi app sẵn sàng — đúng lúc nó cần nhất.
     `readyRef` thay vì đưa `ready` vào deps: nếu không, mỗi lần `ready` đổi là
     đồng hồ sàn chạy lại từ đầu. */
  useEffect(() => {
    if (!booting) return
    const cap = setTimeout(() => setBooting(false), SPLASH_MAX_MS)
    const floor = setTimeout(() => { if (readyRef.current) setBooting(false) }, SPLASH_MS)
    return () => { clearTimeout(cap); clearTimeout(floor) }
  }, [booting])

  /* BẮT ĐẦU BẰNG VIỆC BIẾT MÌNH LÀ AI — và không để một lỗi ở đây cầm chân
     cả trang. Bản cũ viết `getUser().then(u => { setUser(u); readyRef.current
     = true })`: `getUser` mà hỏng (mạng, token hết hạn không refresh được) thì
     `.then` KHÔNG BAO GIỜ chạy — `readyRef` kẹt ở false, màn chờ phải đợi hết
     trần 2,6s mới chịu mở, và `setUser` không chạy nên người dùng đang đăng
     nhập bị xem như khách. Nay lỗi được ghi lại và `readyRef` vẫn được bật
     trong `finally`, nên màn chờ mở đúng lúc dữ liệu xong thay vì đúng lúc
     đồng hồ hết giờ. */
  useEffect(() => {
    let live = true
    getUser()
      .then(u => { if (live) setUser(u) })
      .catch(e => console.warn('[auth] getUser:', e?.message || e))
      .finally(() => { readyRef.current = true })
    const off = onAuthChange(u => { if (live) setUser(u) })
    return () => { live = false; off() }
  }, [])
  /* Chuỗi ngày theo TÀI KHOẢN, không theo trình duyệt. Bộ đếm cũ trong
     localStorage lệch máy, lệch múi giờ, và không phải số mà trang cá nhân
     hay thành tích đang dùng. Server tự lấy ngày Việt Nam; client không gửi
     ngày. Tab để qua nửa đêm thì lần hiện lại mới đóng dấu. */
  useEffect(() => {
    if (!user?.id) return
    const uid = user.id
    let live = true
    let pending = false
    let stampedDay = null
    const stampVisit = async () => {
      if (pending || (stampedDay && stampedDay === vnDayKey(Date.now()))) return
      pending = true
      try {
        const day = await touchMyActivity()
        if (!live || !day) return
        const fresh = day !== stampedDay
        stampedDay = day
        setVisitStamp({ uid, day })
        if (!fresh) return
        try {
          const ach = await claimAchievements()
          if (live && ach) setVoteStatus(prev => ({ ...prev, ...ach }))
        } catch (e) { console.warn('[streak] claim:', e?.message || e) }
      } finally { pending = false }
    }
    stampVisit()
    const onVisible = () => { if (document.visibilityState === 'visible') stampVisit() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [user?.id])

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
      fetchRequests(), fetchMyVotes(u.id), fetchVoteStatus(), claimAchievements(), fetchRanking(), fetchOrders(u), loadMedia(), loadPick(),
      fetchActivityDays(u.id), fetchCommentCounts(),
    ])
    if (u.id !== currentUserId.current) return results
    const [r, v, vs, ach, rk, od, , , act, cc] = results
    /* Bảng là thứ người dùng nhìn đầu tiên: nói ra lần nạp này được hay hỏng
       để khối danh sách hiện đúng thứ (đang tải / lỗi có nút / trống thật). */
    noteBoard(r.status === 'fulfilled')
    if (r.status === 'fulfilled') { setRows(r.value); applyOwnFollows(r.value) }
    if (v.status === 'fulfilled') setMyVotes(v.value)
    // Phan hoi cu (vong quay vua cong thuong sau khi lan tai nay bat dau) thi
    // GIU NGUYEN trang thai truoc do — khong spread vs.value ke ca free_used,
    // vi no keo theo purchased/bonus/credits cua thoi diem cu de len so moi.
    if (vs.status === 'fulfilled' && version === balanceVersion.current) {
      setVoteStatus(() => vs.value)
    }
    if (ach.status === 'fulfilled' && ach.value && version === balanceVersion.current) {
      setVoteStatus(previous => ({ ...previous, ...ach.value }))
    }
    if (rk.status === 'fulfilled') setRanking(rk.value)
    if (od.status === 'fulfilled') setOrders(od.value)
    if (act.status === 'fulfilled') setMyActivity(act.value)
    if (cc?.status === 'fulfilled' && cc.value) setCommentCounts(prev => ({ ...prev, ...cc.value }))
    return results
  }, [user, loadMedia, loadPick, noteBoard])

  /* Realtime chỉ tải lại đúng phần đổi: một lượt vote chạm bảng requests
     thì không cần lôi cả media + đơn hàng về theo. */
  const loadBoard = useCallback(async (u = user) => {
    if (!u) return
    const version = ++balanceVersion.current
    const results = await Promise.allSettled([
      fetchRequests(), fetchMyVotes(u.id), fetchVoteStatus(), claimAchievements(), fetchRanking(),
      /* vote/bình luận của mình vừa tạo cũng là một dấu ngày — tải lại streak
         trong chính lần tải bảng này để ngọn lửa không trễ một nhịp */
      fetchActivityDays(u.id), fetchCommentCounts(),
    ])
    if (u.id !== currentUserId.current) return results
    const [r, v, vs, ach, rk, act, cc] = results
    noteBoard(r.status === 'fulfilled')
    if (r.status === 'fulfilled') { setRows(r.value); applyOwnFollows(r.value) }
    if (v.status === 'fulfilled') setMyVotes(v.value)
    // Phan hoi cu (vong quay vua cong thuong) thi giu nguyen trang thai truoc
    // do, khong de so du thoi diem cu de len so moi.
    if (vs.status === 'fulfilled' && version === balanceVersion.current) {
      setVoteStatus(() => vs.value)
    }
    if (ach.status === 'fulfilled' && ach.value && version === balanceVersion.current) {
      setVoteStatus(previous => ({ ...previous, ...ach.value }))
    }
    if (rk.status === 'fulfilled') setRanking(rk.value)
    if (act.status === 'fulfilled') setMyActivity(act.value)
    if (cc?.status === 'fulfilled' && cc.value) setCommentCounts(prev => ({ ...prev, ...cc.value }))
    return results
  }, [user, noteBoard])

  const loadOrdersOnly = useCallback(async (u = user) => {
    if (!u) return
    try { setOrders(await fetchOrders(u)) } catch { /* ignore */ }
  }, [user])

  useEffect(() => { if (user) load(user) }, [user, load])

  // The board, ranking and showcase are intentionally readable before sign-in.
  // Account-scoped data is still loaded only after authentication.
  /* Tách thành hàm có tên (thay vì thân effect) để nó gọi lại được: nút
     "Thử lại" và hai sự kiện bên dưới cùng dùng một đường nạp này. */
  const loadPublic = useCallback(async () => {
    const [r, rk, cc] = await Promise.allSettled([fetchRequests(), fetchRanking(), fetchCommentCounts()])
    noteBoard(r.status === 'fulfilled')
    if (r.status === 'fulfilled') setRows(r.value)
    if (rk.status === 'fulfilled') setRanking(rk.value)
    if (cc?.status === 'fulfilled' && cc.value) setCommentCounts(prev => ({ ...prev, ...cc.value }))
    return { r, rk, cc }
  }, [noteBoard])

  useEffect(() => { if (!user) loadPublic() }, [user, loadPublic])

  /* NÚT "THỬ LẠI" VÀ MỌI LỐI TỰ PHỤC HỒI ĐỀU ĐI QUA ĐÂY: đúng đường nạp của
     người đang xem (có tài khoản thì cả bảng lẫn dữ liệu riêng, khách thì ba
     mục công khai), nên một lần bấm trả lại đúng những gì đang thiếu. */
  const reloadBoard = useCallback(() => (user ? load(user) : loadPublic()), [user, load, loadPublic])

  /* TỰ NẠP LẠI ĐỂ KHỎI PHẢI BẤM F5 — đúng cái việc người dùng đang phải làm
     tay, và là hai cửa sổ hay gặp nhất:
       · thiết bị vừa có lại mạng (sự kiện `online`);
       · quay lại tab đang mở từ lúc mất mạng (`visibilitychange`) — đúng trường
         hợp "đi ra ngoài một lúc, về bấm vào tab thì thấy trang trống".
     Lúc ĐANG TẢI mà rời tab cũng phải nạp lại: điện thoại đóng băng request
     đang bay, quay lại thì nó không bao giờ trả lời, và không có lỗi nào để
     khối "thử lại" bám vào. Hai sự kiện này do người dùng tạo ra nên không
     bị giới hạn số lần. */
  useEffect(() => {
    if (boardState === 'ready') return
    const retry = () => { if (!document.hidden) reloadBoard() }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retry)
    /* bfcache (nút Back, hoặc iOS khôi phục tab): trang được dựng lại từ bộ
       nhớ với request cũ đã chết. `persisted` là dấu hiệu đó — nạp lại, đừng
       để người dùng phải tự bấm F5. */
    const onShow = (e) => { if (e.persisted) reloadBoard() }
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', retry)
      window.removeEventListener('pageshow', onShow)
    }
  }, [boardState, reloadBoard])

  /* Còn một cửa sổ nữa: mạng không đổi trạng thái gì cả. Thử lại sau 8 giây,
     NHƯNG TỐI ĐA BA LẦN — lặp vô hạn thì máy chủ hỏng thật sẽ bị gõ liên tục
     vô ích. Mỗi lần thử đổi `autoTries` nên effect này tự hẹn nhịp kế tiếp;
     nạp được rồi thì bộ đếm về 0 để lần sau lại có đủ ba lượt. */
  /* Trần cho trạng thái "đang tải": request bị cắt giờ ở 7s × 3 lần, nên quá
     24s mà vẫn chưa có câu trả lời là nó đã treo theo một đường khác. Đổi sang
     lỗi để nút "Thử lại" hiện ra — đứng im ở hàng xương thì người dùng lại
     phải đoán ra việc bấm F5. */
  useEffect(() => {
    if (boardState !== 'loading') return
    const t = setTimeout(() => setBoardState(s => (s === 'loading' ? 'error' : s)), 24000)
    return () => clearTimeout(t)
  }, [boardState])

  const [autoTries, setAutoTries] = useState(0)
  useEffect(() => { if (boardState === 'ready') setAutoTries(0) }, [boardState])
  useEffect(() => {
    if (boardState !== 'error' || autoTries >= AUTO_RETRY_MAX) return
    const t = setTimeout(() => {
      setAutoTries(n => n + 1)
      if (!document.hidden) reloadBoard()
    }, AUTO_RETRY_MS)
    return () => clearTimeout(t)
  }, [boardState, autoTries, reloadBoard])

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

  /* Bọc useCallback: `flash` được dùng bên trong nhiều useCallback khác
     (shareSong, các thao tác vote/xoá). Để nó là hàm mới mỗi lần render thì
     mọi callback đó phải ghi `flash` vào deps, mà `flash` lại đổi mỗi render —
     React Compiler than phiền, và memo vô hiệu. Danh tính ổn định ở đây rẻ
     hơn nhiều so với việc đi giải thích từng chỗ. */
  const flash = useCallback((tone, m, extra) => push({
    tone,
    title: t(tone === 'err' ? 'notif.err' : tone === 'gold' ? 'notif.gold' : 'notif.ok'),
    body: m,
    ...extra,
  }), [push, t])

  /* ---------------- theo dõi + thông báo ----------------
     Nạp theo tài khoản; đổi tài khoản là xoá snapshot cũ để không mang
     bảng của người này so với người kia (sẽ sinh toàn tin ảo). */
  const uid = user?.id
  const [commentCounts, setCommentCounts] = useState({})
  const handleCommentCountChange = useCallback((id, n) => {
    setCommentCounts(prev => {
      if (prev[id] === n) return prev
      return { ...prev, [id]: n }
    })
  }, [])

  useEffect(() => {
    if (!rows || rows.length === 0) return
    let active = true
    fetchCommentCounts(rows.map(r => r.id)).then(counts => {
      if (active && counts) setCommentCounts(prev => ({ ...prev, ...counts }))
    }).catch(() => {})
    return () => { active = false }
  }, [rows])
  useEffect(() => {
    snapRef.current = null
    if (!uid) {
      setWatched([]); setNotices([]); setPrefs(DEFAULT_PREFS)
      setInboxUid(null)
      dismissedRef.current = new Set()
      return
    }
    const w = loadWatched(uid)
    const off = loadOff(uid)
    setWatched(w); watchedRef.current = w
    const dismissed = loadDismissed(uid)
    dismissedRef.current = dismissed
    /* Đọc hộp thư TRƯỚC khi effect lưu chạy. Cờ inboxUid chỉ bật ở render
       sau, nên effect lưu của khung hình này (notices vẫn là []) không được
       ghi đè. */
    setNotices(withoutDismissed(loadInbox(uid), dismissed))
    setInboxUid(uid)
    let live = true
    /* Tin database gộp vào, trừ tin đã xóa. Không gộp trần theo id: id
       `db-12` chưa từng nằm trong hộp thư local, nên bản cũ coi tin vừa xóa
       là tin mới và kéo nó về. */
    fetchNotifications(uid).then(dbInbox => {
      if (!live || !dbInbox.length) return
      setNotices(current => mergeInbox(current, dbInbox, loadDismissed(uid)))
    }).catch(() => {})
    const pf = loadPrefs(uid)
    setPrefs(pf); prefsRef.current = pf
    offRef.current = off
    /* ?f=watch còn sót trong URL của lần trước: không có gì để xem thì
       trở về hàng đợi, để tab "Following" không bị chọn mà trang trống */
    if (!w.length) setFilter(f => (f === 'watch' ? 'queued' : f))
    return () => { live = false }
  }, [uid])

  /* Hạng của từng bài so với đợt chót kế tiếp — một lần tính cho cả
     bảng, dùng chung cho dòng request, thẻ cụm, hộp thông báo và cả lúc
     so sánh sinh tin. `pick` đi kèm để mỗi mục tự mang theo sàn thời gian tới
     lượt (pickEta trong lib/watch.js): nhờ vậy mọi chỗ đã có `st` đều hiện
     được "bao giờ" mà không phải luồn thêm prop qua từng tầng. */
  const { rank: standings } = useMemo(() => pickLadder(rows, pick), [rows, pick])

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
      .filter(n => !selfAct?.has(n.key) && !isDismissed(dismissedRef.current, n))
    if (!found.length) return
    setNotices(box => pushNotices(box, found))
    /* Một toast cho cả đợt: 4 bài cùng nhúc nhích mà 4 toast thì không đọc
       kịp, mà im hết thì tin không tới nơi. Hộp thư đã có đủ. */
    const { n, first } = toastOf(found)
    const song = `${first.title} — ${first.artist}`
    const vars = { song, pct: first.pct ?? 0, votes: first.votes ?? 0, n: first.gap ?? n }
    /* Tone của toast và tone của TIẾNG phải là một: tin trả tiền (bài vừa được
       chốt) kêu tiếng ấm hơn tin thường, tin bị từ chối kêu tiếng lỗi. */
    const tone = first.type === 'done' ? 'gold' : first.type === 'denied' ? 'err'
      : first.type === 'near' ? 'gold' : 'ok'
    sfx.notify(tone)
    push({
      tone,
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
  useEffect(() => { if (uid && inboxUid === uid) saveInbox(uid, notices) }, [uid, inboxUid, notices])
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

  const doDropNotice = (id) => {
    const dropped = notices.find(n => n.id === id)
    /* Tin local lấy chính id làm chữ ký. Tin database có `sig` riêng — nhớ
       cả hai để lần gộp sau không dựng lại dòng kia dưới một id khác. */
    const sig = dropped?.sig || (!String(id).startsWith('db-') ? id : null)
    setNotices(box => dropNotice(box, id))
    if (uid) {
      dismissedRef.current = rememberDismissed(uid, [id, sig])
      dismissNotification({ id, sig }).catch(() => {})
    }
  }

  /* ---------------- derived ---------------- */
  const pub = useMemo(() => rows.filter(r => r.status !== 'pending' && r.status !== 'denied'), [rows])
  const mineRows = useMemo(
    () => rows.filter(r => r.user_id === user?.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [rows, user])

  /* Dây chuyền đang chạy: đang làm trước, rồi chốt sớm trước. Completed thì
     tự rơi khỏi đây.
     Lọc bằng `inChain` (đã chốt HOẶC đang làm), không phải `isPicked`: một bài
     có status in_progress mà thiếu picked_at vẫn thuộc dây chuyền, và trước
     đây nó không hiện ở tab nào cả — xem chú thích `inChain` trong lib/meta.js.
     Dòng thiếu picked_at xếp sau các dòng đã chốt bằng `|| 0` để phép so không
     trả NaN (NaN trong comparator là thứ tự ngẫu nhiên, không phải lỗi rõ ràng). */
  /* Dây chuyền đã chốt: luật lọc + luật sắp nằm trong `chainRows` (lib/board.js)
     để khối Up next, hai tab Up next/In progress và bộ lọc bảng dùng MỘT tập. */
  const picked = useMemo(() => chainRows(pub), [pub])

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

  /* Bốn giai đoạn của bảng — nguồn DUY NHẤT cho khối thống kê (xem
     stageCounts). Bốn số này cộng lại đúng bằng số bài đang có trên bảng, nên
     người đọc đối chiếu được; trước đây "đã chốt nhưng chưa khởi động" không
     được đếm ở đâu, khiến mục Up next và In progress như hai hệ thống rời. */
  const stage = useMemo(() => stageCounts(pub), [pub])

  /* Số bài đang chạy, đếm trên CHÍNH mảng dựng ra khối Up next (rep =
     in_progress nếu bài đó có dòng đang chạy) — nhờ vậy hai số nhỏ trong dòng
     chú thích luôn cộng đúng bằng con số lớn trên nắp khối. */
  const working = useMemo(() => pickedGroups.filter(g => g.rep.status === 'in_progress').length, [pickedGroups])

  const counts = useMemo(() => ({
    /* badge tab = số THẺ mà tab đó sắp hiện ra, không phải số dòng: bảng gom
       cụm theo bài nên một bài gửi ba lần vẫn là một thẻ (songCount). */
    queued: songCount(pub.filter(r => r.status === 'queued' && !r.picked_at)),
    /* Tab "Up next" liệt kê cả dây chuyền đã chốt (việc đang chạy + việc chờ
       tới lượt), nên badge của nó = đúng số bài trong pickedGroups, bằng con số
       trên nắp khối Up next và bằng nút "View all". */
    picked: pickedGroups.length,
    newest: songCount(pub),
    top: songCount(pub.filter(r => r.status !== 'completed' && !inChain(r))),
    /* Tab "In progress" hiện CÙNG tập dòng với tab Up next (cả dây chuyền đã
       chốt, chỉ khác cách sắp) — nên badge của nó phải bằng ĐÚNG số thẻ mà nó
       liệt kê, tức bằng con số trên nắp khối Up next. Trước đây ô này lấy
       stage.in_progress (chỉ bài đang chạy) nên badge ghi 1 mà dưới hiện 2
       thẻ — đúng kiểu "chưa đồng bộ" mà chủ dự án đã báo. */
    in_progress: pickedGroups.length,
    completed: songCount(pub.filter(r => r.status === 'completed')),
    pending: rows.filter(r => r.status === 'pending').length,
    expired: rows.filter(r => r.expired_at && !r.picked_at && ['pending', 'queued'].includes(r.status)).length,
    watch: new Set(rows.filter(r => watchedSet.has(groupKey(r))).map(groupKey)).size,
    mine: rows.filter(r => r.user_id === user?.id).length,
    orders: orders.filter(o => o.status === 'awaiting').length,
  }), [pub, pickedGroups, rows, orders, user, watchedSet])

  /* LỌC nằm trong `filterBoard` (lib/board.js) — cùng chỗ với luật gom cụm và
     sắp xếp, để mọi đường vào bảng (chip lọc, link "This week", Recent requests
     của trang cá nhân, nút Back) đi qua MỘT phép lọc có kiểm thử. `kindFilter`
     không có trong deps vì nó chỉ là bản sao MỘT lựa chọn dùng cho địa chỉ
     `?k=`; thứ thật sự lọc là `kindFilters`. */
  const visible = useMemo(
    () => filterBoard({ pub, picked, rows, filter, statusFilters, kindFilters, q, watchedSet }),
    [pub, picked, rows, filter, statusFilters, kindFilters, q, watchedSet])

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
  /* Completed requests become a public archive instead of disappearing into
     the main queue. Match media titles to completed rows when possible so the
     archive carries the original request context without a new table. */
  const hallOfFame = useMemo(() => {
    const done = rows.filter(r => r.status === 'completed' && r.video_url)
    const sorted = done.slice().sort((a, b) => new Date(b.completed_at || b.updated_at || b.created_at) - new Date(a.completed_at || a.updated_at || a.created_at))
    const seen = new Map()
    for (const r of sorted) {
      const ytId = parseYoutube(r.video_url)?.id
      const k = ytId ? `yt:${ytId}` : groupKey(r)
      if (!seen.has(k)) {
        seen.set(k, { ...r, requesters: [r.requester].filter(Boolean), totalVotes: Number(r.votes || 0), count: 1 })
      } else {
        const item = seen.get(k)
        item.count += 1
        item.totalVotes += Number(r.votes || 0)
        if (r.requester && !item.requesters.includes(r.requester)) {
          item.requesters.push(r.requester)
        }
      }
    }
    return Array.from(seen.values()).slice(0, 8)
  }, [rows])
  const weeklyHighlights = useMemo(() => buildWeeklyHighlights(rows, Date.now()), [rows])

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
    /* `setStatusFilters([])` là bắt buộc: bộ lọc nhiều-chọn THẮNG `filter`,
       nên không dọn nó thì bấm "View all" đổi `filter` mà danh sách đứng yên. */
    setFilter('picked'); setStatusFilters([]); setKindFilter('all'); setKindFilters([]); setQ('')
    requestAnimationFrame(() => {
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' }), 60)
    })
  }, [])

  /* MutationObserver trong hook tự bắt khối mới, không cần liệt kê deps. */
  useReveal()

  /* ---------------- actions ---------------- */
  /* Chặn mở bảng vote cho Up next ngay ở lớp điều phối (nút đã disable,
     đây là lớp chặn thứ hai cho phím tắt / state cũ). */
  /* CHIA SẺ MỘT BÀI. Link trỏ về CHÍNH bảng (`?f=top&q=<bài>`), không trỏ ra
     YouTube: người nhận bấm vào là vote được ngay, thay vì phải tự đi tìm bài
     trong danh sách. Điện thoại có hộp chia sẻ hệ thống thì mở hộp đó (người
     dùng chọn được Zalo/Messenger), còn lại thì copy + toast.
     Không dùng `navigator.share` ở desktop: hộp thoại hệ thống trên Windows
     chậm và nhiều máy không có, trong khi copy link là thao tác ai cũng hiểu. */
  const shareSong = useCallback(async (r) => {
    /* Link dựng bằng `boardSearchUrl` — cùng một cửa với thẻ "This week" và
       Recent requests của trang cá nhân. Bản cũ tự ghép `?f=top&q=…`: `top` chỉ
       liệt kê bài ĐANG XIN PHIẾU, nên chia sẻ một bài vừa được chốt (hoặc đã
       xong) là gửi đi một link mở ra danh sách RỖNG — người nhận không phân
       biệt được "bài bị xoá" với "link hỏng". */
    const url = absolute(boardSearchUrl(r?.title, r?.artist))
    const text = `${r.title} - ${r.artist}`
    /* Hộp chia sẻ hệ thống chỉ mở trên máy cảm ứng. Trên desktop nó là một hộp
       thoại của hệ điều hành (Windows/macOS) chậm, hay bị chặn trong webview,
       và không giúp gì: người dùng desktop muốn một chuỗi để dán. Nhận biết
       bằng `(hover: none)` — cùng tiêu chí mà CSS dùng để phân biệt hai thế
       giới, không phải đoán theo user-agent. */
    const touch = window.matchMedia?.('(hover: none)').matches
    if (touch && navigator.share) {
      try { await navigator.share({ title: 'Chaereve', text, url }); return } catch { return }
    }
    const ok = await copyText(url)
    if (ok) sfx.copy()
    flash(ok ? 'ok' : 'err', t(ok ? 'row.shareCopied' : 'row.shareFailed'))
  }, [flash, t])

  const openVote = useCallback((r) => {
    /* Guests can inspect and share the board, but voting is an explicit auth action. */
    if (!user) { setAuthPrompt(true); return }
    if (!r || inChain(r)) return
    setVoteFor(r)
  }, [user])

  const doVote = async (id, delta = 1) => {
    const target = rows.find(r => r.id === id)
    if (target && inChain(target)) {
      flash('err', t('vote.locked'))
      throw new Error('err.voteLocked')
    }
    const bump = (n) => setRows(rs => rs.map(r => (r.id === id ? { ...r, votes: Math.max(0, r.votes + n) } : r)))
    const mine = (n) => setMyVotes(m => {
      const next = new Map(m)
      next.set(id, Math.max(0, (next.get(id) || 0) + n))
      return next
    })
    try {
      await castVote(id, delta)
    } catch (e) {
      flash('err', errMsg(t, e))
      throw e
    }
    /* Cộng số trên bảng SAU khi phiếu đã vào. Cộng trước rồi cổng từ chối
       sẽ bắn toast "First in line" cho một phiếu không tồn tại — đúng ảnh
       người dùng thấy cạnh lỗi err.voteGate. Làm mới bảng lỗi sau đó không
       được báo như phiếu thất bại: phiếu đã nằm trong database. */
    bump(delta); mine(delta)
    if (delta < 0) sfx.unvote(); else sfx.vote()
    try { await loadBoard(user) } catch { /* realtime sẽ kéo bảng lại */ }
  }
  const doSubmit = async (form, paid, useBonus = false) => {
    if (!user) { setModal(false); setAuthPrompt(true); return }
    const row = await addRequest(form, user, paid, useBonus)
    /* vua gui xong là theo dõi liọn, khỏi phải chờ lần nạp bảng kế tiếp */
    if (row) applyOwnFollows([{ ...row, user_id: row.user_id || user.id }])
    sfx.submit()
    const song = `${form.artist.trim()} — ${form.title.trim()}`
    push({
      tone: paid ? 'gold' : 'ok',
      title: t(useBonus ? 'notif.freePaidTitle' : (paid ? 'notif.paidTitle' : 'notif.reqTitle')),
      body: useBonus
        ? t('notif.freePaidBody', { song })
        : paid
          ? t('notif.paidBody', { song, amt: vnd(PAID_REQUEST.vnd) })
          : t('notif.reqBody', { song }),
      ms: 6500,
      ...(!paid || useBonus ? {} : { action: { label: t('notif.payNow'), onClick: () => openModal('buy') } }),
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
    if (!(await ask({ title: t('row.confirmDelete'), body: t('dlg.cannotUndo'), confirmLabel: t('adm.delete') }))) return
    try { await deleteRequest(id); await loadBoard(user); flash('ok', t('toast.deleted')) }
    catch (e) { flash('err', errMsg(t, e)) }
  }
  const doReview = async (id, ok, reason, videoUrl) => {
    const r = rows.find(x => x.id === id)
    if (r) selfActRef.current = new Set([groupKey(r)])
    try { await adminReview(id, ok, reason, videoUrl); await loadBoard(user); flash('ok', ok ? t('toast.approved') : t('toast.denied')) }
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
  const doAdminExpire = async (id) => {
    try { await adminExpireRequest(id); await loadBoard(user); flash('ok', t('toast.removed')) }
    catch (e) { flash('err', errMsg(t, e)) }
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
  /* THAO TÁC HÀNG LOẠT từ bảng Admin: duyệt / từ chối / chốt / bỏ chốt / trả về
     hàng đợi / xoá nhiều request trong một lần bấm. Chạy tuần tự rồi TẢI LẠI
     BẢNG ĐÚNG MỘT LẦN — trước đây mỗi request là một vòng loadBoard, nên mười
     dòng thành mười lần tải và mười cái toast.
     `selfActRef` nhận CẢ CỤM bài bị đụng tới, để phần thông báo không tự kể lại
     việc mình vừa làm. */
  const doBulk = async (action, ids = [], reason = null, videoUrl = null) => {
    if (!ids.length) return
    const hit = rows.filter(r => ids.includes(r.id))
    if (hit.length) selfActRef.current = new Set(hit.map(groupKey))
    try {
      if (action === 'approve' || action === 'deny') {
        for (const id of ids) await adminReview(id, action === 'approve', reason, videoUrl)
      } else if (action === 'delete') {
        for (const id of ids) await deleteRequest(id)
      } else if (action === 'pick' || action === 'unpick') {
        for (const id of ids) await adminPickGroup(id, action === 'pick')
      } else if (action === 'queue') {
        await adminUpdateMany(ids, { status: 'queued' })
      }
      await loadBoard(user)
      loadPick()
      flash('ok', t('toast.bulk', { n: ids.length }))
    } catch (e) { selfActRef.current = null; flash('err', errMsg(t, e)) }
  }
  const doCancelOrder = async (o) => {
    const paid = o.kind === 'paid_request'
    const ok = await ask({
      title: t('order.confirmCancel'),
      body: paid ? t('order.confirmCancelPaid') : t('dlg.cannotUndo'),
      confirmLabel: t('order.cancel'),
    })
    if (!ok) return
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
    try {
      if (!item.id && media.length >= 20) throw new Error(t('err.mediaLimit'))
      await saveMedia(item); await loadMedia(); flash('ok', t('toast.mediaSaved'))
    } catch (e) { flash('err', errMsg(t, e)); throw e }
  }
  /* Bảng sửa cả danh sách Latest: xóa trước, rồi lưu mục sửa, thêm mục mới,
     cuối cùng xếp lại đủ cả bảng một lượt (mục featured giữ nguyên chỗ). */
  const doMediaCommit = async ({ updates = [], adds = [], removes = [], order = [] } = {}) => {
    const isVideo = (m) => m && (m.kind === 'video' || m.kind === 'playlist')
    try {
      if (media.filter(m => !removes.includes(m.id)).length + adds.length > 20) throw new Error(t('err.mediaLimit'))
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
    const ok = await ask({ title: t('dlg.mediaTitle'), body: t('dlg.mediaBody'), confirmLabel: t('adm.delete') })
    if (!ok) return
    /* Tiếng "xoá" kêu SAU khi xác nhận. Trước đây nó nằm ở nút, nên bấm rồi
       huỷ vẫn nghe thấy một tiếng xoá — âm thanh nói dối về việc vừa xảy ra. */
    sfx.delete()
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
    setAdmin(null)
    go('board')
    requestAnimationFrame(() => {
      setTimeout(() => document.getElementById('home-media')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    })
  }, [go])
  /* Mở bảng quản trị = ĐI TỚI một mục, không bật hộp thoại. `null` nghĩa là
     không chỉ định tab (panel tự chọn tab đầu). */
  const openAdmin = useCallback((tab = null) => {
    setAdmin(tab)
    if (section !== ADMIN_ONLY) go(ADMIN_ONLY)
    /* Đổi mục trong trang quản trị là đổi địa chỉ, nhưng KHÔNG đẩy thêm một
       mốc lịch sử: bấm Back sau khi soát năm mục phải quay về trang trước đó,
       không phải lùi qua năm địa chỉ của cùng một trang. */
    if (tab) putUrl({ s: ADMIN_ONLY }, adminTabPath(ROUTES.admin, tab))
  }, [go, section])
  /* Dang xuat phai LUON tra ve man dang nhap. Truoc day dung
     signOut().then(() => setUser(null)): mang loi la promise reject, setUser
     khong bao gio chay, va nguoi dung ket lai trong tai khoan cu. Don state
     cuc bo truoc, roi moi bao cho server. */
  const doSignOut = useCallback(async () => {
    setUser(null); setAdmin(null); setModal(false); setMenu(false)
    try { await signOut() } catch { /* phien cuc bo da bi don o tren */ }
  }, [])
  const openModal = (t) => {
    if (!user && (t === 'request' || t === 'buy' || t === 'vote')) { setAuthPrompt(true); return }
    setModalTab(t); setModal(true)
  }

  useEffect(() => {
    const h = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if (typing) {
        if (e.key === 'Escape' && el.tagName === 'INPUT') { setQ(''); el.blur() }
        return
      }
      if (modal || voteFor || menu || section === ADMIN_ONLY) return
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
  }, [modal, admin, voteFor, menu, section, go])

  /* ---------------- render ---------------- */
  /* Trong lúc boot: màn chờ KHÔNG có `hide`. Ra khỏi boot thì hai nhánh dưới
     vẫn dựng <Splash hide /> để nó tan ra (tháo hẳn thì mất nhịp mờ dần). */
  const myStats = fullRanking.find(p => p.user_id === user?.id)
  const myTotalVotesCast = useMemo(() => Array.from(myVotes.values()).reduce((a, b) => a + b, 0), [myVotes])
  const activityView = useMemo(() => {
    /* Phải kiểm `visitStamp` TRƯỚC khi so uid, không được để `visitStamp?.uid`
       đứng một mình: khách chưa đăng nhập có user = null VÀ visitStamp = null,
       hai vế optional-chain CÙNG trả `undefined` nên phép so BẰNG NHAU (true)
       và nhánh đúng đọc `visitStamp.day` trên null → TypeError giữa lúc render
       → React gỡ cả cây → trang trắng trơn (xảy ra thật 23/09, từ bc41a33). */
    const extra = visitStamp && visitStamp.uid === user?.id ? visitStamp.day : null
    const days = unionActivityDays(myActivity, extra)
    if (!Array.isArray(days)) return null
    return { days, stats: streakStats(days) }
  }, [myActivity, visitStamp, user?.id])
  const myAchievementMetrics = useMemo(() => {
    /* Keep the preview aligned with claim_achievements(): denied requests do
       not count server-side, and rewards are not inferred from a client amount. */
    const eligible = mineRows.filter(r => r.status !== 'denied')
    return {
      longestStreak: activityView?.stats.longest ?? 0,
      requests: eligible.length,
      paidRequests: eligible.filter(r => r.is_paid).length,
      completed: eligible.filter(r => r.status === 'completed').length,
      rank: fullRanking.findIndex(p => p.user_id === user?.id) + 1,
      votesCast: myTotalVotesCast,
    }
  }, [activityView, mineRows, fullRanking, user?.id, myTotalVotesCast])
  /* Card PNG của chính mình: số lấy từ ô thống kê ngay dưới (cùng nguồn),
     streak từ dải ngay trên — nút Save card ngồi cạnh dải streak. useMemo
     phải nằm TRƯỚC early-return `if (booting)` — hook sau return có điều
     kiện là phạm rules-of-hooks. */
  const myCard = useMemo(() => {
    if (!user) return null
    const st = activityView?.stats ?? null
    return {
      name: user.name || 'Community member',
      avatarUrl: user.avatar || null,
      subtitle: t('card.subtitle'),
      stats: [
        { value: mineRows.length, label: t('stat.submitted') },
        { value: myStats?.completed ?? 0, label: t('stat.completed') },
        { value: myStats?.total_votes ?? 0, label: t('stat.votesReceived') },
      ],
      streakLine: st
        ? (st.current > 0
          ? `${t('streak.current', { n: st.current })} · ${t('streak.longest', { n: st.longest })}`
          : t('streak.longest', { n: st.longest }))
        : null,
      milestones: st ? STREAK_MILESTONES.map((m) => ({ n: m, got: st.earned.includes(m) })) : null,
      footer: t('card.footer'),
    }
  }, [user, activityView, myStats, mineRows.length, t])

  if (booting) return <Splash />
  /* Public mode keeps the real board mounted. LoginGate is an action modal,
     so Turnstile is not downloaded or rendered until a guest asks to act. */

  return (
    <NavProvider value={nav}>
      <Splash hide />
      {authPrompt && !user && (
        <LoginGate
          onDemoLogin={(u) => { setUser(u); setAuthPrompt(false) }}
          onClose={() => setAuthPrompt(false)} />
      )}
      <a className="skip-link" href="#main">Skip to content</a>

      <Sidebar
        sections={navOrder()} routes={ROUTES} section={section} onNavigate={navTo}
        user={viewer} counts={counts}
        open={menu} onClose={() => setMenu(false)}
        collapsed={collapsed} onToggle={toggleSide}
        onNewRequest={() => openModal('request')}
        onAbout={() => navTo('mine')}
        onSignOut={doSignOut}
        onSignIn={() => setAuthPrompt(true)}
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
            {NAV_SUB[section] && <p className="mainhead-sub">{t(NAV_SUB[section])}</p>}
          </div>
          {/* Chú thích đặt TRƯỚC thẻ, không chen giữa các prop: JSX không cho
              comment trong danh sách attribute, và propContract.test.js đọc
              chữ trong đó thành tên prop rồi báo "dây đứt" oan.
              `onBuy` đi thẳng vào tab mua, không vòng qua hộp vote: người vừa
              đọc "còn 2 vote nữa là dẫn đầu" đã biết mình muốn gì. */}
          {user && activityView?.stats.current > 0 && (
            <span className="streak-pill" title={t('streak.headerTitle', { n: activityView.stats.current })} aria-label={t('streak.headerTitle', { n: activityView.stats.current })}>
              <Icon name="flame" size={13} /><b>{activityView.stats.current}</b>
            </span>
          )}
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
            onBuy={() => { setBellOpen(false); openModal('buy') }}
            onPrefs={doSetPrefs}
          />
          {/* LỐI VÀO MÀN ĐĂNG NHẬP, NGAY CẠNH CHUÔNG. Mọi việc cần tài khoản
              (vote, gửi request, About me) đều tự mở cửa sổ này; nhưng một
              người mới vào chỉ nhìn thấy bảng request — không có dấu hiệu nào
              nói trang này có tài khoản, và không có đường nào để đăng nhập
              trước khi đụng vào một việc. Nút này là đường đó. */}
          {!user && (
            <button type="button" className="btn btn-primary head-signin"
              onClick={() => setAuthPrompt(true)}
              aria-label={t('gate.signIn')} title={t('gate.signIn')}>
              <GoogleIcon size={15} />
              <span className="head-signin-tx">{t('gate.signIn')}</span>
            </button>
          )}
          <button className="btn btn-primary only-narrow" onClick={() => openModal('request')}>
            {t('btn.newRequest')}
          </button>
        </header>
        <div className="sect" key={section}>

        {profileId && <PublicProfile userId={profileId} onBack={closeProfile} />}

        {/* ======= MỤC 1: BẢNG YÊU CẦU ======= */}
        {section === 'board' && !onProfile && (
          /* .board: một cột ở bản hẹp, hai cột (nội dung + video) từ 1300px —
             xem khối "BỐ CỤC BẢNG" trong index.css. Thứ tự DOM vẫn là thứ tự
             đọc: thống kê → video → Up next → vote → danh sách. */
          <div className="board">
            <div className="stats" data-reveal data-glow>
              {/* Bốn giai đoạn, cộng lại đúng tổng số bài trên bảng. Ô "Paid"
                  cũ bị bỏ: nó là một NHÃN (bài trả phí) chứ không phải giai
                  đoạn, nằm trong dãy này thì phá vỡ phép cộng — nhãn đó vẫn
                  hiện nguyên trên hàng (pill vàng) và trong bảng Admin. */}
              <Stat c="var(--queued)" v={stage.queued} label={t('stat.queued')} why={t('stat.queuedWhy')} />
              <Stat c="var(--a-2)" v={stage.picked} label={t('stat.picked')} why={t('stat.pickedWhy')} />
              <Stat c="var(--progress)" v={stage.in_progress} label={t('stat.inProgress')} why={t('stat.inProgressWhy')} />
              <Stat c="var(--done)" v={stage.completed} label={t('stat.completed')} why={t('stat.completedWhy')} />
            </div>

            <MediaShowcase featured={featured} videos={latest}
              canEdit={user?.isAdmin} onAdd={() => openAdmin('media')} />

            {(weeklyHighlights.top || weeklyHighlights.newcomer) && (
              <section className="nowbar weekly" data-reveal aria-labelledby="weekly-title">
                <div className="now-head">
                  <h2 className="lbl" id="weekly-title">This week</h2>
                  <span className="now-split">Community highlights · last 7 days</span>
                </div>
                <div className="weekly-grid">
                  {/* Cả hai thẻ đi qua `boardSearchUrl` (một chỗ dựng link, luôn
                      kèm `f=newest`) và `spaLink` (đi trong app, không tải lại
                      trang → không chạy lại màn chờ). Bản cũ tự ghép chuỗi bằng
                      tay: thẻ "Most voted" giữ `f=top` — mà `top` cố ý loại bài
                      đã xong/đã vào dây chuyền, nên bấm vào bài nổi nhất tuần
                      (thường đúng là bài đang làm) ra danh sách RỖNG; thẻ "New this
                      week" không kèm `f` nên rơi về bộ lọc đã lưu trong
                      localStorage, cũng rỗng nếu lần trước đang xem Queue. */}
                  {weeklyHighlights.top && <a className="weekly-card" href={boardSearchUrl(weeklyHighlights.top.title, weeklyHighlights.top.artist)} onClick={spaLink(openSong, weeklyHighlights.top)}>
                    <small>Most voted</small><b>{weeklyHighlights.top.title}</b><span>{weeklyHighlights.top.artist} · {weeklyHighlights.top.votes} {weeklyHighlights.top.votes === 1 ? 'vote' : 'votes'}</span>
                  </a>}
                  {weeklyHighlights.newcomer && <a className="weekly-card" href={boardSearchUrl(weeklyHighlights.newcomer.title, weeklyHighlights.newcomer.artist)} onClick={spaLink(openSong, weeklyHighlights.newcomer)}>
                    <small>New this week</small><b>{weeklyHighlights.newcomer.title}</b><span>{weeklyHighlights.newcomer.artist}{weeklyHighlights.newcomer.requester ? ` · requested by ${weeklyHighlights.newcomer.requester}` : ''}</span>
                  </a>}
                </div>
              </section>
            )}

            {hallOfFame.length > 0 && (
              <section className="nowbar hall" data-reveal aria-labelledby="hall-title">
                <div className="now-head">
                  <h2 className="lbl" id="hall-title">Hall of Fame</h2>
                  <span className="now-split">Completed videos</span>
                </div>
                <div className="hall-grid">
                  {hallOfFame.map(r => {
                    const reqTx = r.requesters && r.requesters.length > 1
                      ? `${r.requesters.slice(0, 2).join(', ')}${r.requesters.length > 2 ? ` +${r.requesters.length - 2}` : ''}`
                      : r.requester
                    return (
                      <button type="button" className="hall-card" key={r.id} onClick={() => setHallVideo(r)}>
                        <span className="hall-play" aria-hidden="true">▶</span>
                        <span>
                          <b>{r.title}</b>
                          <small>
                            {r.artist}{reqTx ? ` · requested by ${reqTx}` : ''}
                            {r.count > 1 ? ` (${r.count} requests)` : ''}
                          </small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ======= UP NEXT: các request đã được chốt, chưa xong.
                Khối này luôn hiện để mốc giờ chốt tiếp theo không bao giờ
                biến mất (kể cả khi chưa có request nào được chốt). ======= */}
            {
              <div className={`nowbar${picked.some(r => r.status === 'in_progress') ? ' live' : ''}`}
                data-reveal data-glow>
                <span className="nbar" aria-hidden="true" />
                <div className="now-head">
                  {/* Tiêu đề khối Up next là h2: trong khối này còn h3 cho từng
                      bài, mà h3 nhảy cóc từ h1 là cấp bậc sai — trình đọc màn
                      hình đọc một mạch không có chỗ ngắt. */}
                  <h2 className="lbl">
                    {t('now.next')}
                    {pickedGroups.length > 0 && <span className="now-n">{pickedGroups.length}</span>}
                    {pickedGroups.length > 0 && (
                      <span className="now-split visually-quiet">
                        {t('now.split', { a: working, b: pickedGroups.length - working })}
                      </span>
                    )}
                  </h2>
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
                            <span className="tx">{g.title} <span>— {g.artist}</span></span>
                            {(g.paid || g.rows.length > 1) && (
                              <span className="tags">
                                {g.paid && <span className="pill gold">PAID</span>}
                                {g.rows.length > 1 && <span className="pill group">×{g.rows.length}</span>}
                              </span>
                            )}
                          </h3>
                          <div className="sub">
                            <span className="status" style={{ '--c': statusColor(rep.status) }}>{statusLabel(rep, t)}</span>
                            <span className={`kind ${kindCls(rep.kind)}`}>{rep.kind}</span>
                            <span className="dot" aria-hidden="true" /><span>{g.votes} {t('now.votes')}</span>
                            <span className="dot visually-quiet" aria-hidden="true" /><span className="visually-quiet">{t('now.pickedAgo', { t: timeAgo(g.rep.picked_at, t) })}</span>
                          </div>
                          {/* Số phần trăm chỉ nằm MỘT chỗ: trong thanh, sát mép
                              phải. Trước đây nó nằm trong dòng meta rồi lặp
                              lại lần nữa bằng một cái vạch trần bên dưới. */}
                          {working && <Progress pct={rep.progress} label={t('progress.label')} />}
                          {g.rows.length > 1 && (
                            <ul className="now-members">
                              {g.rows.map(rr => (
                                <li key={rr.id}>
                                  <span className="status" style={{ '--c': statusColor(rr.status) }}>{statusLabel(rr, t)}</span>
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
              <h2 className="section-title">{t('board.listTitle')}</h2>
              {/* Thanh lọc: mỗi chip mang ĐÚNG màu giai đoạn nó lọc, chip
                  đang chọn sáng lên bằng chính màu đó; máy hẹp thì dải chip
                  cuộn ngang chứ không xuống dòng. */}
              {/* THANH LỌC — mỗi thứ chỉ có MỘT ô điều khiển. Hàng trên là ô
                  tìm + tóm tắt/nút Bộ lọc; dải status ở hàng dưới luôn giữ MỘT
                  hàng, hết chỗ thì cuộn ngang chứ không gãy thành hai hàng.
                  Hàng loại bài gấp sau nút "Bộ lọc" trên máy hẹp — nhồi tất cả
                  vào một hàng 340px là mỗi thứ một mẩu. Thanh NẰM TRONG DÒNG,
                  không dính mép trên: cuộn qua nó là nó đi theo trang (vòng 13
                  — "đừng để thanh lọc floating lúc cuộn"); nút "lên đầu trang"
                  là đường quay lại. */}
              <div className={`fbar${fbarOpen ? ' open' : ''}`}>
                <div className="fbar-top">
                  {/* Ô TÌM ĐỨNG ĐẦU THANH LỌC — thứ tự DOM cũng là thứ tự
                      bàn phím: ô nhập → tóm tắt/nút Bộ lọc → dải status. Máy
                      hẹp tự thành hai hàng (ô tìm + nút ở trên, chip ở dưới),
                      không cần đảo thứ tự bằng `order`. */}
                  <span className="searchwrap">
                    <Icon name="search" size={14} className="search-ico" />
                    <input ref={searchRef} className="search" placeholder={t('board.search')}
                      aria-label={t('board.search')} value={q}
                      onChange={e => setQ(e.target.value)} aria-keyshortcuts="/" />
                    {q
                      ? <button type="button" className="search-x" aria-label={t('board.clearQ')}
                          onClick={() => { setQ(''); searchRef.current?.focus() }}><Icon name="close" size={13} /></button>
                      : <kbd className="search-kbd" aria-hidden="true">/</kbd>}
                  </span>
                  <div className="fbar-side">
                    <span className="fcount">{t('board.showing', { n: boardItems.length })}</span>
                    <button type="button" className={`fmore${fbarOpen ? ' on' : ''}`}
                      aria-expanded={fbarOpen} aria-controls="fbar-more"
                      onClick={() => setFbarOpen(v => !v)}>
                      <Icon name="settings" size={14} />{t('board.filters')}
                      {(kindFilter !== 'all' ? 1 : 0) + (q ? 1 : 0) > 0 && (
                        <b>{(kindFilter !== 'all' ? 1 : 0) + (q ? 1 : 0)}</b>
                      )}
                    </button>
                  </div>
                  <div className="fchips" role="group" aria-label={t('board.filterAria')}>
                    {/* Mỗi mục = VẠCH MÀU + nhãn + số (xem khối THANH LỌC trong
                        index.css). Vạch ngăn chỉ mọc lên ở mục đầu tiên của
                        một nhóm MỚI, và nhóm "đang theo dõi" vắng mặt thì vạch
                        ngăn của nó cũng không được ở lại một mình. */}
                    {FILTERS.filter(f => f.ax !== 'you' || watchedSet.size > 0).map((f, i, list) => (
                      <Fragment key={f.k}>
                        {i > 0 && f.ax !== list[i - 1].ax && <span className="dot" aria-hidden="true" />}
                        <button type="button" className={`fchip${(STAGES.includes(f.k) ? statusFilters.includes(f.k) : filter === f.k) ? ' on' : ''}`}
                          style={{ '--c': f.c }} aria-pressed={STAGES.includes(f.k) ? statusFilters.includes(f.k) : filter === f.k}
                          onClick={() => {
                            const stage = STAGES.includes(f.k)
                            const next = stage
                              ? (statusFilters.includes(f.k) ? statusFilters.filter(s => s !== f.k) : [...statusFilters, f.k])
                              : []
                            setStatusFilters(next)
                            /* Bỏ chọn chip giai đoạn CUỐI CÙNG thì về "cả bảng"
                               (newest). Để `filter` ở lại giai đoạn vừa bỏ là
                               danh sách vẫn lọc đúng y như cũ trong khi chip đã
                               tắt — người bấm thấy "không có gì thay đổi". */
                            setFilter(stage && !next.length ? 'newest' : f.k)
                          }}>
                          <i className="ftick" aria-hidden="true" />{t(`filter.${f.k}`)}
                          <b className={`fnum${counts[f.k] ? '' : ' zero'}`}>{counts[f.k]}</b>
                        </button>
                      </Fragment>
                    ))}
                    {/* LOẠI BÀI ĐANG LỌC, hiện thành chip bỏ được ngay trên hàng
                        chính. Trên màn rộng khối lọc thứ hai luôn hiện nên chip
                        này là thừa (CSS ẩn nó từ 621px); trên máy hẹp khối đó
                        gấp sau nút "Bộ lọc", nên đây là chỗ DUY NHẤT cho biết
                        "danh sách này đang bị lọc theo một loại bài" — người
                        dùng cuộn xuống thấy thiếu bài mà không hiểu vì sao. */}
                    {kindFilter !== 'all' && (
                      <button type="button" className="fchip fkind on onkind"
                        style={{ '--c': `var(--k-${kindCls(kindFilter)})` }}
                        aria-label={t('board.clearKind', { k: kindFilter })}
                        title={t('board.clearKind', { k: kindFilter })}
                        onClick={() => { setKindFilters([]); setKindFilter('all') }}>
                        <i className="kswatch" aria-hidden="true" />{kindFilter}<Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="fbar-more" id="fbar-more">
                  {/* MỤC LỌC LOẠI BÀI KHÔNG PHẢI THẺ. Bốn nút dưới đây từng mang
                      lớp `kind` — lớp của THẺ loại bài nằm trên từng hàng request.
                      Thẻ đó khoá cứng `color: var(--k-ccl)`, nên cả bốn nút (kể
                      cả "All types") đều hiện đúng một màu TÍM CCL, bất kể
                      `--c` của chúng: bốn thẻ loại khác nhau mà mắt thấy cùng
                      một màu, còn nền của nút đang chọn lại lấy `--c` — nên nút
                      "Full Album" đang chọn có CHỮ TÍM trên NỀN XANH TEAL.
                      Nay chúng mang lớp riêng `.fkind` và tự mang màu của mình.
                      Dấu hiệu để nhận ra lỗi này từ đầu: một lớp CSS mang tên
                      dữ liệu (`kind`) được dùng cho cả thứ hiển thị dữ liệu lẫn
                      control để lọc dữ liệu đó. */}
                  <div className="fchips kinds" role="group" aria-label={t('board.kindAria')}>
                    <button type="button" className={`fchip fkind${kindFilters.length === 0 ? ' on' : ''}`}
                      aria-pressed={kindFilters.length === 0} onClick={() => { setKindFilters([]); setKindFilter('all') }}>
                      <i className="kswatch any" aria-hidden="true" />{t('board.allKinds')}
                    </button>
                    {Object.keys(KIND_META).map(k => (
                      <button key={k} type="button"
                        className={`fchip fkind${kindFilters.includes(k) ? ' on' : ''}`}
                        style={{ '--c': `var(--k-${kindCls(k)})` }} aria-pressed={kindFilters.includes(k)}
                        onClick={() => {
                          const next = kindFilters.includes(k) ? kindFilters.filter(x => x !== k) : [...kindFilters, k]
                          setKindFilters(next)
                          /* `kindFilter` là bản sao MỘT lựa chọn (địa chỉ `?k=`,
                             bộ lọc đã lưu, chip bỏ được trên hàng chính) nên phải
                             đổi theo: bỏ chọn loại cuối cùng mà nó vẫn giữ tên
                             loại đó thì chip "đang lọc" còn hiện trong khi danh
                             sách đã hết lọc. */
                          setKindFilter(next.length === 1 ? next[0] : 'all')
                        }}>
                        <i className="kswatch" aria-hidden="true" />{k}
                      </button>
                    ))}
                  </div>
                  {/* Chỉ hiện khi ĐANG lọc thật: một dòng nói đang xem bao nhiêu
                      bài và lối thoát về trạng thái đầy đủ. */}
                  {(kindFilter !== 'all' || !!q) && (
                    <div className="fbar-meta">
                      <span>{t('board.showing', { n: boardItems.length })}</span>
                      <button type="button" className="lnk"
                        onClick={() => { setStatusFilters([]); setFilter('queued'); setKindFilters([]); setKindFilter('all'); setQ('') }}>{t('board.clearAll')}</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="list" data-glow key={filter} ref={listRef}>
                {boardItems.length === 0
                  /* Ba trạng thái, ba câu trả lời (xem khối ListSkeleton):
                     đang tải / lỗi có nút thử lại / trống thật sự. */
                  ? (boardState === 'loading'
                    ? <ListSkeleton n={4} label={t('board.loading')} />
                    : boardState === 'error'
                      ? <LoadErr onRetry={reloadBoard} />
                      : (
                        <div className="empty">
                          <span className="empty-ico" aria-hidden="true"><Icon name="board" size={18} /></span>
                          <b>{filter === 'watch' ? t('nt.none') : t('board.empty')}</b>
                          <small>{t('board.emptyHint')}</small>
                        </div>
                      ))
                  : pgBoard.items.map((e, i) => (e.type === 'group'
                    ? (
                      <RequestGroup key={e.key} g={e} i={pgBoard.from - 1 + i}
                        expanded={!!openGroups[e.key]} onToggle={() => toggleGroup(e.key)}
                        user={viewer} myVotes={myVotes} onVote={openVote} onDelete={doDelete}
                        followed={watchedSet.has(e.key)} onWatch={doToggleWatch} hl={hlSong === e.key}
                        onShare={shareSong} onLogin={() => setAuthPrompt(true)} st={standings.get(e.key)}
                        commentCounts={commentCounts}
                        onCommentCountChange={handleCommentCountChange} />
                      )
                    : (
                      <RequestRow key={e.r.id} r={e.r} i={pgBoard.from - 1 + i} n={i} user={viewer}
                        showDelete={!!user && e.r.user_id === user.id}
                        myCount={myVotes.get(e.r.id) || 0}
                        canVote={(e.r.status === 'queued' || e.r.status === 'in_progress') && !isPicked(e.r)}
                        onVote={openVote}
                        onDelete={doDelete}
                        followed={watchedSet.has(groupKey(e.r))} onWatch={doToggleWatch} hl={hlSong === groupKey(e.r)}
                        onShare={shareSong} onLogin={() => setAuthPrompt(true)} st={standings.get(groupKey(e.r))}
                        commentCount={commentCounts[e.r.id] || 0}
                        onCommentCountChange={handleCommentCountChange} />
                      )
                  ))}
              </div>
              <Pager {...pgBoard} onChange={pgBoard.setPage} scrollTo={listRef} />
            </div>{/* /.board-list */}
          </div>
        )}

        {section === 'spin' && !onProfile && (
          user ? (
            <Suspense fallback={<div className="empty" role="status">{t('spin.loading')}</div>}>
              <DailySpin key={user.id} userId={user.id} credits={voteStatus.credits}
                purchased={voteStatus.purchased} bonus={voteStatus.bonus}
                onBalance={applySpinBalance} onVote={() => openModal('vote')} />
            </Suspense>
          ) : (
            /* Trang trắng là câu trả lời tồi: nó không nói vì sao, cũng không
               cho đường đi tiếp. Xem SignInPanel ở đầu tệp. */
            <SignInPanel title={t('gate.needTitle')} body={t('gate.needSpin')} onSignIn={() => setAuthPrompt(true)} />
          )
        )}

        {/* ======= MỤC 2: XẾP HẠNG ======= */}
        {/* `allRows` nuôi bảng mùa giải (tuần/tháng): số tổng trong `rows` là
            của view thật, không cắt theo thời gian được — mùa phải gom lại từ
            chính các hàng request (luật ở src/lib/season.js, không migration). */}
        {section === 'ranking' && !onProfile && (
          <>
            {/* Bảng xếp hạng cũng chỉ là một cách NHÌN cùng dữ liệu bảng, nên
                lỗi nạp phải hiện ở đây luôn: không có nó thì người dùng mở
                /ranking thấy một danh sách trống và không một lời giải. */}
            {boardState === 'error' && <LoadErr onRetry={reloadBoard} />}
            <Leaderboard rows={fullRanking} allRows={rows} ranking={fullRanking} meId={viewer.id} />
          </>
        )}

        {/* ======= MỤC 3: CỦA TÔI ======= */}
        {/* Chưa đăng nhập thì mục này KHÔNG dựng khối sửa hồ sơ: `viewer` là một
            người rỗng, nút Lưu chỉ dẫn tới `err.signin`, và người dùng tưởng
            hồ sơ của mình vừa biến mất. Một lời mời đăng nhập là câu trả lời
            đúng cho câu hỏi "hồ sơ của tôi đâu". */}
        {section === 'mine' && !onProfile && !user && (
          <SignInPanel title={t('gate.needTitle')} body={t('gate.needBody')} onSignIn={() => setAuthPrompt(true)} />
        )}
        {section === 'mine' && !onProfile && user && (
          <>
            {/* HỒ SƠ NẰM NGAY ĐẦU MỤC "ABOUT ME" (vòng 12). Trước đây sửa hồ sơ
                là một hộp thoại riêng, mở từ ảnh đại diện ở chân sidebar — hai
                đường cho một việc, và hộp thoại che mất chính trang nói về
                mình. Nay nó là khối đầu tiên của mục này: nhìn thấy mình là ai,
                sửa được ngay tại chỗ, rồi đọc tiếp danh sách request bên dưới. */}
            <ProfilePanel
              user={viewer}
              onSaved={async () => { const u = await getUser(); setUser(u); await load(u); flash('ok', t('toast.profSaved')) }}
            />
            {/* Chuỗi ngày + badge 7/30/100 của chính mình, ngay dưới khối hồ sơ:
                nhìn thấy mình là ai thì thấy luôn mình đã đều đặn mấy ngày. */}
            <div className="streak-row">
              <StreakStrip days={activityView ? activityView.days : null} />
              {myCard && <ShareCardButton card={myCard} />}
            </div>
            <AchievementIndex metrics={myAchievementMetrics} />
            <div className="stats" data-glow>
              <Stat c="var(--a-2)" v={mineRows.length} label={t('stat.submitted')} />
              <Stat c="var(--pending)" v={mineRows.filter(r => r.status === 'pending').length} label={t('stat.pending')} />
              <Stat c="var(--done)" v={myStats?.completed ?? 0} label={t('stat.completed')} />
              <Stat c="var(--a-2)" v={myStats?.total_votes ?? 0} label={t('stat.votesReceived')} />
            </div>

            <h2 className="section-title">{t('mine.title')}</h2>
            <div className="list" data-glow ref={mineRef}>
              {mineRows.length === 0
                ? <div className="empty">
                  <span className="empty-ico" aria-hidden="true"><Icon name="board" size={18} /></span>
                  <b>{t('mine.empty')}</b>
                  <small>{t('mine.emptyHint')}</small>
                </div>
                : pgMine.items.map((r, i) => (
                  <RequestRow key={r.id} r={r} n={i} user={viewer} showDelete
                    myCount={myVotes.get(r.id) || 0}
                    canVote={(r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)}
                    onVote={openVote}
                    onDelete={doDelete}
                    followed={watchedSet.has(groupKey(r))} onWatch={doToggleWatch}
                    onShare={shareSong} st={standings.get(groupKey(r))}
                    commentCount={commentCounts[r.id] || 0}
                    onCommentCountChange={handleCommentCountChange} />
                ))}
            </div>
            <Pager {...pgMine} onChange={pgMine.setPage} scrollTo={mineRef} />

            <h2 className="section-title" style={{ marginTop: 26 }}>{t('mine.orders')}</h2>
            <div className="list" ref={ordersRef}>
              {myOrders.length === 0
                ? <div className="empty">
                  <span className="empty-ico" aria-hidden="true"><Icon name="star" size={18} /></span>
                  <b>{t('mine.ordersEmpty')}</b>
                  <small>{t('mine.ordersHint')}</small>
                </div>
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
                        onClick={() => doCancelOrder(o)}><Icon name="close" size={15} /></button>
                    )}
                  </div>
                ))}
            </div>
            <Pager {...pgOrders} onChange={pgOrders.setPage} scrollTo={ordersRef} />
          </>
        )}

        {/* ======= BẢNG QUẢN TRỊ (chỉ admin thấy) =======
            Là MỘT MỤC của trang, không phải hộp thoại: có địa chỉ riêng, F5 giữ
            nguyên tab đang mở, và mở được song song ở tab trình duyệt thứ hai.
            `tab` truyền xuống là tab đang mở (null = để panel tự chọn).

            LỖI GIAO DIỆN NẶNG (vòng 12): khối này từng được dựng ở CUỐI cây
            React, tức là phía sau cả thẻ đóng của khung nội dung và của `.shell`
            — nó rơi ra ngoài khung. Không nằm trong `.main` nên không có bề rộng tối đa,
            không có lề, không có tiêu đề trang, và vì `.side` là cột CỐ ĐỊNH
            nên dải số liệu (rộng hết màn hình) chui xuống dưới sidebar: ô đầu
            tiên bị cắt, các thanh công cụ kéo dài hết mép phải. Nay nó đứng
            cùng chỗ với bốn mục kia, trong `.sect` của `.main`. */}
        {user?.isAdmin && section === ADMIN_ONLY && !onProfile && (
          /* Lưới an toàn: bảng quản trị là khối nặng nhất trang (năm mục, dữ liệu
             từ bốn bảng). Một trường lạ trong dữ liệu thật làm React tháo cả cây
             và người dùng chỉ thấy trang trắng — không còn menu, không đường về.
             Có lưới này thì chỉ khối đó hỏng, kèm nút dựng lại. */
          <Boundary label={t('nav.admin')} title={t('err.blockTitle')} body={t('err.blockBody')}
            retry={t('err.blockRetry')}>
            <Suspense fallback={<div className="empty" role="status">{t('spin.loading')}</div>}>
              <AdminPanel
                tab={admin || ADMIN_TABS[0]} onTab={openAdmin}
                rows={rows} orders={orders} media={featuredRows}
                onReview={doReview} onUpdate={doAdminUpdate} onDelete={doAdminDelete} onExpire={doAdminExpire} onOrder={doOrder}
                onPick={doAdminPick} onBulk={doBulk}
                onMediaSave={doMediaSave} onMediaCommit={doMediaCommit}
                onMediaDelete={doMediaDelete} onMediaReorder={doMediaReorder}
                onMediaViewHome={viewMediaHome}
                pickInterval={pick?.interval_days || 4}
              />
            </Suspense>
          </Boundary>
        )}

        </div>{/* /.sect */}

        <button type="button" className={`to-top${showTop ? ' on' : ''}`} onClick={scrollTop}
          aria-label={t('top.label')} aria-hidden={!showTop} tabIndex={showTop ? 0 : -1}>
          <Icon name="up" size={16} />
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

      {/* `key` theo bài đang mở = MỖI BÀI MỘT PHIÊN XEM. Không có nó thì hộp
          thoại là CÙNG một component: xem hết 30 giây ở bài A, đóng, mở bài B
          là thẻ "hết phần xem trước" của bài A hiện ra ngay trên bài B (state
          `over` còn nguyên). Đóng hộp cũng đổi key (về 'none') nên mở lại
          đúng bài vừa xem vẫn là phiên mới. */}
      <VideoPreviewModal key={hallVideo?.id ?? 'none'} video={hallVideo} onClose={() => setHallVideo(null)} />

      <VoteModal
        open={!!voteFor} request={voteFor}
        myCount={voteFor ? (myVotes.get(voteFor.id) || 0) : 0}
        votesLeft={votesLeft}
        purchased={voteStatus.purchased ?? 0}
        bonus={voteStatus.bonus ?? 0}
        onClose={() => setVoteFor(null)}
        onVote={doVote}
        onBuy={() => { setVoteFor(null); openModal('buy') }}
      />

      <Suspense fallback={null}>

        {/* onVoteExisting: "bài này đã có trên bảng" → đóng form, mở thẳng hộp
            vote của bài đó — người dùng định làm gì thì làm đúng việc đó, chỉ
            ở chỗ khác. (Chú thích đặt TRƯỚC thẻ, không nằm giữa danh sách
            prop: bộ parse của propContract.test.js đọc chữ trong comment giữa
            hai prop thành tên prop và báo "dây đứt" oan.) */}
        <ActionModal
          open={modal} tab={modalTab} setTab={setModalTab} onClose={() => setModal(false)}
          rows={pub} allRows={rows} myVotes={myVotes} myOrders={myOrders}
          prefill={prefill}
          onVoteExisting={(r) => { setModal(false); openVote(r) }}
          voteStatus={voteStatus} onVote={openVote} onSubmit={doSubmit} onBuy={doBuy}
          onCancelOrder={doCancelOrder} userName={viewer.name} live={hasSupabase}
          bonusRequests={voteStatus.bonus_requests ?? 0}
        />
      </Suspense>
    </NavProvider>
  )
}

/* VỎ BỌC: nhà cung cấp hộp xác nhận nằm NGOÀI AppInner, vì một component không
   dùng được context do chính nó vừa cung cấp. Tách ở đây (thay vì sửa main.jsx)
   để mọi nơi dựng <App /> — main.jsx, công cụ smoke, về sau — đều có hộp xác
   nhận mà không phải nhớ thêm một nhà cung cấp nữa. */
export default function App() {
  return (
    <ConfirmProvider>
      <AppInner />
    </ConfirmProvider>
  )
}
