/* ============================================================
   i18n.jsx — toàn bộ chữ hiển thị trên web.
   App chỉ có một thứ tiếng: tiếng Anh. Sửa chữ tại đây,
   không phải đụng vào component nào.
   Placeholder trong chuỗi: {name} — xem fill() bên dưới.
   ============================================================ */
import { createContext, useCallback, useContext, useMemo } from 'react'

const S = {
  /* dieu huong sidebar / mobile */
  'nav.board': 'Requests',
  'nav.spin': 'Daily Spin',
  'nav.ranking': 'Leaderboard',
  'nav.mine': 'About me',
  'nav.admin': 'Admin',
  /* dòng phụ dưới tiêu đề trang: nói trang này để LÀM GÌ, không nhắc lại số
     liệu (dải thống kê ngay dưới đã làm việc đó) */
  'nav.boardSub': 'Vote for what gets made next',
  'nav.spinSub': 'Two free spins a day',
  'nav.mineSub': 'Your profile',
  'nav.adminSub': 'Manage queue & orders',

  /* sidebar */
  'side.label': 'Main menu',
  'side.tagline': 'Request Page',
  /* Man cho doc len cho trinh doc man hinh: phan hinh (logo, chu hieu, thanh
     tai) da bi an khoi accessibility tree, chi con mot cau trang thai. */
  'splash.label': 'Loading Chaereve…',
  'side.nav': 'Browse',
  'side.connect': 'Connect',
  'side.youtube': 'YouTube',
  'side.collapse': 'Collapse sidebar',
  'side.expand': 'Expand sidebar',

  /* nut */
  'btn.newRequest': 'New request',

  /* am thanh */
  'sfx.on': 'Mute sounds',
  'sfx.off': 'Unmute sounds',

  /* ho so — khối này nay nằm trong mục "About me", không còn là hộp thoại */
  'prof.title': 'Your profile',
  'prof.name': 'Display name',
  'prof.choose': 'Choose image',
  'prof.reset': 'Use Google picture',
  'prof.gifReady': 'Animated GIF ready ({kb} KB). Save your profile to keep it moving.',
  'prof.resized': 'Cropped to {kb}KB. Press Save to apply.',
  'prof.save': 'Save',
  'prof.saving': 'Saving…',
  'prof.cancel': 'Cancel',

  /* cat anh */
  'crop.hint': 'Drag to move · scroll to zoom',
  'crop.zoom': 'Zoom',
  'crop.apply': 'Use this image',

  /* thong bao duoi goc */
  'toast.profSaved': 'Profile saved.',

  /* menu goc */
  'menu.open': 'Open menu',
  'menu.close': 'Close menu',
  'menu.settings': 'Settings',
  'menu.sound': 'Sound',
  'menu.signOut': 'Sign out',

  /* the so diem vote */
  'vp.yourVotes': 'Your votes',
  'vp.left': 'votes left',
  'vp.freeToday': 'Free today',
  'vp.reset': 'Free votes reset at 00:00 (GMT+7)',
  'vp.bonusReset': 'Bonus resets at the end of October',
  'vp.goVote': 'Vote now',
  'vp.buy': 'Buy votes',

  /* daily spin — short product copy; technical details stay in the guide/privacy page */
  'spin.demo': 'Demo · local data',
  'spin.legendAria': 'The four prize tiers on the wheel',
  'spin.playLabel': 'Daily bonus wheel',
  'spin.available': 'Spins left today',
  'spin.wheelLabel': 'Wheel with {n} equal sectors: {odds} votes. Brighter sectors are rarer.',
  'spin.action': 'Spin',
  'spin.loading': 'Loading…',
  'spin.requesting': 'Confirming…',
  'spin.spinning': 'Spinning…',
  'spin.recover': 'Check last spin',
  'spin.finished': 'No spins left today',
  'spin.pending': 'Last spin unconfirmed. Check it before spinning again.',
  'spin.refresh': 'Try again',
  'spin.deviceReset': 'Reset this browser',
  'spin.deviceResetHint': 'Clears the saved browser token, then reloads. Your spins already used today stay used.',
  'spin.wonOne': '+1 bonus vote',
  'spin.won': '+{n} bonus votes',
  'spin.wonNote': 'Added to your vote credits.',
  'spin.resetIn': 'Next reset',
  'spin.votes': 'votes',
  'spin.useVotes': 'Use votes',
  'spin.rewardOne': '+1 vote',
  'spin.reward': '+{n} votes',
  'spin.history': 'Today’s rewards',
  'spin.historyEmpty': 'No spins yet.',
  'spin.todayTotal': 'Today: +{n} bonus votes',
  'spin.addedAt': '{time} · GMT+7',
  'spin.rules': 'Spin rules',
  'spin.ruleLimit': '{n} spins per account and device, daily.',
  'spin.ruleReset': 'Resets at 00:00 (GMT+7).',
  'spin.ruleCredit': 'Bonus votes from the wheel reset at the end of October each year.',
  'err.spinSetup': 'Daily Spin isn’t available yet.',
  'err.spinDevice': 'Could not verify this browser. Please contact support.',
  'err.spinStorage': 'Enable cookies and local storage to spin.',
  'err.spinRegistration': 'Browser registration limit reached. Try again tomorrow.',
  'err.spinDeviceLimit': 'This device has used its daily spins, including other accounts.',
  'err.spinAccountLimit': 'This account has used its daily spins, including other devices.',
  'err.spinAccountChanged': 'Account changed. Refresh before spinning.',
  'err.spinRequest': 'Could not verify this spin. Please refresh.',
  'err.spinTimeout': 'Connection timed out. Try again to check your spin.',
  'err.spinResponse': 'Could not confirm the result. Check your last spin.',
  'err.spinFingerprint': 'Could not read this browser’s signature. Enable scripts and try again.',
  'err.spinCaptcha': 'Couldn’t run the security check quietly. Please try again.',
  'err.spinGate': 'Could not reach the spin service. Try again.',
  'err.spinEdgeFp': 'This browser has used its daily spins.',
  'err.spinEdgeIp': 'Too many browsers spun from this network today. Try again tomorrow.',
  'err.voteGate': 'Could not reach the vote service. Try again.',
  'err.voteFpLimit': 'This browser has used its 3 free votes today. Buy votes or come back tomorrow.',
  'err.voteEdgeFp': 'Too many vote requests from this browser today. Try again tomorrow.',

  /* Bốn ô thống kê = BỐN GIAI ĐOẠN của bảng (xem stageCounts): cộng lại đúng
     bằng số bài đang có. Nhãn "Paid" cũ bỏ khỏi dãy này vì nó là một nhãn chứ
     không phải giai đoạn — nó vẫn hiện trên hàng và trong bảng Admin. */
  'stat.queued': 'In queue',
  'stat.picked': 'Picked',
  'stat.inProgress': 'In progress',
  'stat.completed': 'Completed',
  /* Dinh nghia cua tung con so (title) — so KHONG co dinh nghia la so nguoi
     doc khong tin duoc, nhat la khi bon o nay nam canh bon con so khac o badge
     tab. */
  'stat.queuedWhy': 'Songs still waiting for votes. Nothing is being made yet.',
  'stat.pickedWhy': 'Songs already picked for production, waiting for their turn to start.',
  'stat.inProgressWhy': 'Songs being edited right now. The In progress tab shows these plus the picked songs still waiting for their turn.',
  'stat.completedWhy': 'Songs finished and out on the channel.',
  'stat.submitted': 'Submitted',
  'stat.pending': 'Pending',
  'stat.votesReceived': 'Votes received',

  /* bo loc */
  'filter.queued': 'Queue',
  'filter.picked': 'Up next',
  'filter.newest': 'Newest',
  'filter.top': 'Top voted',
  'filter.in_progress': 'In progress',
  'filter.completed': 'Done',
  'filter.watch': 'Following',

  /* ---------------- THEO DÕI + THÔNG BÁO ----------------
     Chuông, bảng thông báo, vị trí trên hàng chờ. Sửa chữ tại đây là đủ mọi
     thứ liên quan đến tính năng này (không còn "trang Updates" riêng). */
  'nt.aria': 'Open your notifications',
  /* so it khong dung duoc cho "1" -> dung cau "3 unread", dung cho moi n */
  'nt.ariaUnread': 'Open your notifications \u2014 {n} unread',
  'nt.liveUnread': 'Unread notifications: {n}',
  'nt.title': 'Notifications',
  'nt.markAll': 'Mark all read',
  'nt.settings': 'Notification settings',
  'nt.back': 'Back to notifications',
  'nt.backShort': 'Notifications',
  'nt.browse': 'Browse the board',
  'nt.emptyTitle': 'Nothing yet',
  'nt.emptyBody': 'Tap the bell on a song to get its news here. Songs you request are followed automatically.',
  'nt.drop': 'Remove this',
  'nt.vote': 'Vote now',
  'nt.watch': 'Watch',
  'nt.open': 'Go to the request',
  'nt.voteNow': 'Vote now',
  /* Nút mua vote nằm ngay trong tin "sát nút": lúc bài của mình chỉ còn vài
     phiếu nữa là dẫn đầu là lúc DUY NHẤT câu "mua thêm vote" trả lời đúng
     một câu hỏi đang có sẵn trong đầu người đọc. */
  'nt.buyVotes': 'Get votes',
  'nt.buyWhy': 'Only {n} to lead the queue. More votes push it up now.',
  'nt.multi': '{n} new notifications',
  'nt.multiBody': 'First one: {song}.',
  'nt.none': 'You are not following any song yet.',

  'nt.grp.need': 'Needs your votes',
  'nt.grp.upnext': 'Up next',
  'nt.grp.denied': 'Denied',
  'nt.grp.work': 'In progress',
  'nt.grp.out': 'Out now',
  'nt.grp.comments': 'Comments & Replies',
  'nt.grp.other': 'Other',

  'nt.tag.near': 'Almost picked',
  'nt.tag.lead': 'First in line',
  'nt.tag.approved': 'In queue',
  'nt.tag.started': 'Production',
  'nt.tag.picked': 'Up next',
  'nt.tag.done': 'Out now',
  'nt.tag.expired': 'Request expired',
  'nt.tag.comment': 'Comment',
  'nt.tag.reply': 'Reply',
  'nt.tag.mention': 'Mention',
  'nt.n.expired': 'This request expired after one month and was deleted.',
  'nt.n.comment': '{author} commented on your request: "{comment}"',
  'nt.n.reply': '{author} replied to your comment: "{comment}"',
  'nt.n.mention': '{author} mentioned you in a comment: "{comment}"',
  'nt.tag.denied': 'Denied',
  'nt.tag.progress': 'Progress',
  'nt.tag.votes': 'Votes',
  /* Chu cau tin NGAN, khong lap lai ten bai: hang tin nao cung co ten bai in
     dam o dong tren. Toast la noi duy nhat khong co dong do -> nt.toast. */
  'nt.n.near': 'Only {n} to lead the queue.',
  'nt.n.lead': 'First in line \u2014 that is the next video.',
  'nt.n.approved': 'Approved, open for votes.',
  'nt.n.started': 'Moved into production.',
  'nt.n.picked': 'Picked for Up next. Voting is closed.',
  'nt.n.done': 'The video is up \u2014 go watch it.',
  'nt.n.denied': 'The request was denied.',
  'nt.n.progress': 'Progress is at {pct}%.',
  'nt.n.votes': 'Reached {votes} votes.',
  'nt.toast': '{song} — {msg}',

  /* 4 cong tac trong tab cai dat. Ban truoc ("Close calls", "Vote milestones")
     dung ten goi noi bo; ban thu hai ("Almost picked", "Work in progress") co
     moi ten la mot TRANG THAI, doc len nhu gan cai nut tat cho nen kho hieu hon
     cu. Quy tắc cho lần sau:
       - nhan LUON MO DAU bang "Tell me ..." -> doc mot tieng biet day la chon
         loai tin nhan, khong phai cai bat hien thi;
       - chu thich = MOT cau van thuan, <dieu gi gay ra tin> + <ap dung cho bai
         nao>, khong ngoa ngu ("heads-up", "hit send", "climbs", "slips past");
       - duoi 60 ky tu de khong bi bung 2 dong trong bang 420px. */
  'nt.p.auto': 'Tell me about my requests',
  'nt.p.autoNote': 'Every step of a song you sent: approved, up next, done, denied.',
  'nt.p.near': 'Tell me when a song is almost picked',
  'nt.p.nearNote': 'One notice when a song needs 3 votes or fewer to go first.',
  'nt.p.progress': 'Tell me about video progress',
  'nt.p.progressNote': 'Each time the progress % goes up on a song you follow.',
  'nt.p.votes': 'Tell me when votes go up',
  'nt.p.votesNote': 'Every 5 votes on a song you follow or voted for.',

  /* Pill trang thai nam trong dong tin: cung van "ai do can gi / con cach dau bao
     xa", va dung dung duoc so nhieu (n = 1 hay n = 9 deu doc duoc). */
  'standing.lead': 'top of the queue',
  'standing.near': 'needs {n} to lead',
  'standing.rank': '#{n} in line',
  'standing.paidAhead': 'behind a paid request',
  'standing.rule': 'Only one song is picked at a time: paid first, then most votes, then oldest request.',
  /* "Sớm nhất khoảng …" — đây là SÀN thời gian, không phải lời hứa: bài khác
     vote nhiều hơn chỉ có thể đẩy nó MUỘN hơn, không bao giờ sớm hơn. */
  'standing.etaDays': 'at least {n} days',
  'standing.etaWeeks': 'at least {n} weeks',
  'standing.etaMonths': 'at least {n} months',
  'standing.etaWhy': 'Earliest {d} days from now: the next pick, then {c} more cycles at one song per cycle. More votes for another song can push it later, never earlier.',

  /* chuong da thanh affordance an nen tooltip la thu duy nhat giai thich no:
     noi ro "alert" va pham vi ca bai, khong goi chung la "follow" */
  'row.follow': 'Follow song',
  'row.unfollow': 'Following — turn off',
  'watch.on': 'We will tell you about {song}.',
  'watch.off': 'Stopped following {song}.',
  'watch.full': 'You follow {n} songs already — drop one first.',
  /* bài đã có trên bảng — hiện ngay dưới ô tên bài, lúc người dùng còn đang gõ */
  'adm.credits': 'Copy credits',
  'adm.creditsDone': 'Copied',
  'adm.creditsHint': 'Copy the song name and everyone who requested it, ready to paste into the video description',
  'row.share': 'Share this request',
  'row.shareCopied': 'Link copied - send it to anyone who should vote',
  'row.shareFailed': 'Could not copy - the link is in your address bar',
  'req.dupMeta': '{c} requests, {n} votes on the board already',
  'req.dupPending': '{c} request of yours is waiting for review',
  'req.dupVote': 'Vote for it instead',
  'req.dupContinue': 'Continue request (Free / Paid)',
  'req.dupStep3': 'This song already has requests on the board. You can choose Paid request to guarantee priority, or submit as free.',
  'req.dupWatch': 'Already done - watch it',
  'req.notifyNote': 'You will be told when this is approved, how production goes, and the moment the video is up.',
  'req.notifyDemo': 'This demo stores notifications in your browser, so they only appear while this tab is open.',
  'err.watchLimit': 'You are following too many songs.',

  /* dang lam / tiep theo */
  'now.next': 'Up next',
  'now.votes': 'votes',
  /* Quan he giua khoi Up next va tab In progress — noi mot cau thay vi de nguoi
     doc tu doan vi sao mot bai nam o ca hai cho. */
  /* Hai giai đoạn của dây chuyền, cộng lại đúng bằng con số trên nắp khối */
  'now.split': '{a} in progress · {b} picked, not started',
  'now.nextPickLbl': 'Next pick in',
  'now.nextPick': '{d}d {h}h {m}m',
  'now.pickSoon': 'any moment…',
  'now.everyDays': 'every {n} days',
  'now.noPick': 'No request picked yet',
  'now.pickRule': 'The most voted request is picked automatically every {n} days.',
  'now.pickedAgo': 'picked {t}',
  'now.more': 'View all {n} →',

  /* danh sach request */
  'board.listTitle': 'All requests',
  'board.allKinds': 'All types',
  'board.filters': 'Filters',
  'board.kindAria': 'Filter by type',
  'board.search': 'Title or artist',
  'board.empty': 'Nothing here yet.',
  'board.emptyHint': 'Try another filter, or send the first request.',
  'board.filterAria': 'Filter requests',
  'board.clearQ': 'Clear search',
  'board.clearAll': 'Clear filters',
  'board.clearKind': 'Remove the type filter: {k}',
  'board.showing': '{n} shown',

  /* phan trang — dung chung cho moi danh sach dai */
  'pager.label': 'Pagination',
  'pager.showing': '{from}–{to} of {total}',
  'pager.prev': 'Previous',
  'pager.next': 'Next',
  'pager.goTo': 'Go to page {n}',

  /* video noi bat */
  'media.featured': 'Featured',
  'media.latest': 'Latest update',
  'media.openYT': 'Watch on YouTube',
  'media.prev': 'Previous video',
  'media.next': 'Next video',
  'media.view': 'Show "{t}"',
  'media.emptyAdmin': 'No videos yet — add the first one.',
  'media.emptyPublic': 'No videos here yet.',

  /* dong request */
  'row.watch': 'Watch on YouTube',
  'row.vote': 'vote',
  'row.cantVote': 'Voting is closed for this request',
  'row.voteLocked': 'Already picked. Voting is closed.',
  'row.deleteReq': 'Delete request',
  'row.openVote': 'Choose how many votes',
  'progress.label': 'Build progress',
  'row.mine': 'You voted {n}',
  'row.confirmDelete': 'Delete this request?',

  /* cum request trung bai */
  'group.requests': '{n} requests',
  'group.showAll': 'Show all {n} requests',
  'group.hide': 'Show less',

  /* bang xep hang */
  'rank.title': 'Leaderboard',
  'rank.empty': 'No data yet.',
  'rank.you': 'you',
  'rank.requests': 'requests',
  'rank.completed': 'completed',
  'rank.votes': 'votes',
  'rank.kicker': 'Latest update',
  'rank.sortLabel': 'Sort leaderboard',
  'rank.sort.total': 'Requests',
  'rank.sort.completed': 'Completed',
  'rank.sort.total_votes': 'Votes earned',
  /* Luật xếp hạng, nói thẳng ra: khoá chính và thứ tự phá hoà (ranking.js).
     Ba câu, ba con số đếm được — bảng không còn "điểm" nào do nó tự đặt ra, nên
     cũng không còn câu giải thích trọng số nào để mà lệch. */
  'rank.rule.total': 'Sorted by requests sent',
  'rank.rule.completed': 'Sorted by requests completed',
  'rank.rule.total_votes': 'Sorted by votes earned',
  'rank.player': 'Requester',
  'rank.position': 'Rank {n} of {total}',
  'rank.noMe': 'You are not on the board yet.',
  /* CHUỖI NGÀY HOẠT ĐỘNG + badge 7/30/100 (streak.js / StreakStrip.jsx).
     Câu `how` là luật đếm, nằm trong tooltip ngọn lửa: một ngày tính khi có
     ít nhất một hành động cộng đồng, theo lịch Việt Nam. */
  'streak.label': 'Activity streak',
  'streak.how': 'A day counts when you send a request, vote, comment or use the daily spin (Vietnam time)',
  'streak.current': '{n}-day streak',
  'streak.longest': 'longest {n}',
  'streak.none': 'No active day yet — vote, comment, spin or send a request to start a streak',
  'streak.unlocked': 'Unlocked: {n}-day streak',
  'streak.locked': 'Reach a {n}-day streak to unlock',
  'streak.headerTitle': '{n}-day activity streak',
  /* achievement index: transparent reward catalogue; no hidden vote weight */
  'ach.index': 'Achievement index',
  'ach.showAll': 'View all achievements ({n})',
  'ach.popupTitle': 'All Achievements',
  'ach.close': 'Close achievements',
  'ach.reward': 'Reward',
  'ach.locked': 'Locked',
  'ach.earned': 'Earned',
  'ach.streak3': 'First rhythm',
  'ach.streak3Desc': 'Stay active for 3 days',
  'ach.streak3Reward': '3-day badge & +1 vote bonus',
  'ach.streak7': '7-day spark',
  'ach.streak7Desc': 'Stay active for 7 days',
  'ach.streak7Reward': '7-day badge & +3 vote bonus',
  'ach.streak14': 'Two-week glow',
  'ach.streak14Desc': 'Stay active for 14 days',
  'ach.streak14Reward': '14-day badge & +5 vote bonus',
  'ach.streak30': '30-day rhythm',
  'ach.streak30Desc': 'Stay active for 30 days',
  'ach.streak30Reward': '30-day badge & +10 vote bonus',
  'ach.streak60': '60-day dedication',
  'ach.streak60Desc': 'Stay active for 60 days',
  'ach.streak60Reward': 'Steadfast badge & +20 vote bonus',
  'ach.streak100': '100-day legend',
  'ach.streak100Desc': 'Stay active for 100 days',
  'ach.streak100Reward': 'Centurion badge & +35 vote bonus',
  'ach.streak180': 'Half-year heartbeat',
  'ach.streak180Desc': 'Stay active for 180 days',
  'ach.streak180Reward': 'Heartbeat badge & +50 vote bonus',
  'ach.streak365': 'Year in color',
  'ach.streak365Desc': 'Stay active for 365 days',
  'ach.streak365Reward': 'Year badge & +100 vote bonus',
  'ach.firstRequest': 'First request',
  'ach.firstRequestDesc': 'Send your first request',
  'ach.firstRequestReward': 'Requester badge & +1 vote bonus',
  'ach.request3': 'Triple track',
  'ach.request3Desc': 'Submit 3 song requests',
  'ach.request3Reward': 'Tracklist badge & +2 vote bonus',
  'ach.request5': 'Song Curator',
  'ach.request5Desc': 'Submit 5 song requests',
  'ach.request5Reward': 'Curator badge & +3 vote bonus',
  'ach.request10': 'Setlist maker',
  'ach.request10Desc': 'Submit 10 song requests',
  'ach.request10Reward': 'Setlist badge & +5 vote bonus',
  'ach.request25': 'Playlist architect',
  'ach.request25Desc': 'Submit 25 song requests',
  'ach.request25Reward': 'Architect badge & +10 vote bonus',
  'ach.request50': 'Catalog builder',
  'ach.request50Desc': 'Submit 50 song requests',
  'ach.request50Reward': 'Catalog badge & +20 vote bonus',
  'ach.request100': 'Archive keeper',
  'ach.request100Desc': 'Submit 100 song requests',
  'ach.request100Reward': 'Archive badge & +35 vote bonus',
  'ach.request250': 'Request legend',
  'ach.request250Desc': 'Submit 250 song requests',
  'ach.request250Reward': 'Legend badge & +50 vote bonus',
  'ach.firstCompletion': 'First completion',
  'ach.firstCompletionDesc': 'Have one request completed',
  'ach.firstCompletionReward': 'Debuter badge & 1 free paid request',
  'ach.completion3': 'Three-piece set',
  'ach.completion3Desc': 'Have 3 requests completed',
  'ach.completion3Reward': 'Setlist badge & +3 vote bonus',
  'ach.completion5': 'Hit Maker',
  'ach.completion5Desc': 'Have 5 completed song videos',
  'ach.completion5Reward': 'Hit Maker badge & 1 free paid request',
  'ach.completion10': 'Release regular',
  'ach.completion10Desc': 'Have 10 requests completed',
  'ach.completion10Reward': 'Release badge & +10 vote bonus',
  'ach.completion25': 'Studio favorite',
  'ach.completion25Desc': 'Have 25 requests completed',
  'ach.completion25Reward': 'Studio badge & 2 free paid requests',
  'ach.completion50': 'Production veteran',
  'ach.completion50Desc': 'Have 50 requests completed',
  'ach.completion50Reward': 'Veteran badge & +30 vote bonus',
  'ach.completion100': 'Hall of Fame',
  'ach.completion100Desc': 'Have 100 requests completed',
  'ach.completion100Reward': 'Hall of Fame badge & 3 free paid requests',
  'ach.firstPaidRequest': 'Backstage pass',
  'ach.firstPaidRequestDesc': 'Send your first paid request',
  'ach.firstPaidRequestReward': 'Backstage badge & 1 free paid request',
  'ach.paid3': 'Priority supporter',
  'ach.paid3Desc': 'Send 3 paid requests',
  'ach.paid3Reward': 'Supporter badge & 1 free paid request',
  'ach.paid5': 'Patron',
  'ach.paid5Desc': 'Send 5 paid requests',
  'ach.paid5Reward': 'Patron badge & 2 free paid requests',
  'ach.paid10': 'Production partner',
  'ach.paid10Desc': 'Send 10 paid requests',
  'ach.paid10Reward': 'Partner badge & 2 free paid requests',
  'ach.paid25': 'Headliner',
  'ach.paid25Desc': 'Send 25 paid requests',
  'ach.paid25Reward': 'Headliner badge & 3 free paid requests',
  'ach.paid50': 'Label founder',
  'ach.paid50Desc': 'Send 50 paid requests',
  'ach.paid50Reward': 'Founder badge & 5 free paid requests',
  'ach.votesCast1': 'First signal',
  'ach.votesCast1Desc': 'Cast your first vote',
  'ach.votesCast1Reward': 'Voter badge & +1 vote bonus',
  'ach.votesCast10': 'Active Voter',
  'ach.votesCast10Desc': 'Cast at least 10 votes',
  'ach.votesCast10Reward': 'Voter badge & +3 vote bonus',
  'ach.votesCast25': 'Chorus starter',
  'ach.votesCast25Desc': 'Cast at least 25 votes',
  'ach.votesCast25Reward': 'Chorus badge & +5 vote bonus',
  'ach.votesCast50': 'Crowd favorite',
  'ach.votesCast50Desc': 'Cast at least 50 votes',
  'ach.votesCast50Reward': 'Favorite badge & +10 vote bonus',
  'ach.votesCast100': 'Signal booster',
  'ach.votesCast100Desc': 'Cast at least 100 votes',
  'ach.votesCast100Reward': 'Booster badge & +20 vote bonus',
  'ach.votesCast250': 'Wave maker',
  'ach.votesCast250Desc': 'Cast at least 250 votes',
  'ach.votesCast250Reward': 'Wave badge & +35 vote bonus',
  'ach.votesCast500': 'Crowd captain',
  'ach.votesCast500Desc': 'Cast at least 500 votes',
  'ach.votesCast500Reward': 'Captain badge & +50 vote bonus',
  'ach.votesCast1000': 'Community pillar',
  'ach.votesCast1000Desc': 'Cast at least 1,000 votes',
  'ach.votesCast1000Reward': 'Pillar badge & 2 free paid requests',
  'ach.top10': 'Top 10',
  'ach.top10Desc': 'Finish in the all-time top 10',
  'ach.top10Reward': 'Top 10 badge & +10 vote bonus',
  'ach.top5': 'Top 5',
  'ach.top5Desc': 'Finish in the all-time top 5',
  'ach.top5Reward': 'Top 5 badge & +20 vote bonus',
  'ach.podium': 'Podium',
  'ach.podiumDesc': 'Finish in the all-time top 3',
  'ach.podiumReward': 'Podium badge & 1 free paid request',
  'ach.runnerUp': 'Runner-up',
  'ach.runnerUpDesc': 'Finish in the all-time top 2',
  'ach.runnerUpReward': 'Runner-up badge & +30 vote bonus',
  'ach.champion': 'Community champion',
  'ach.championDesc': 'Finish at number 1',
  'ach.championReward': 'Champion badge & 3 free paid requests',
  /* SHARE CARD PNG (shareCard.js): chữ trên ẢNH cũng qua từ điển như chữ
     trên màn hình — component ghép sẵn rồi truyền xuống canvas. */
  'card.save': 'Save card',
  'card.busy': 'Making card…',
  'card.tip': 'Download a shareable PNG card of these stats',
  'card.saved': 'Card saved as PNG',
  'card.unsupported': 'This browser cannot render the card image',
  'card.subtitle': 'Chaereve community member',
  'card.footer': 'chaereve · color coded lyrics request board',
  'comment.reply': 'Reply',
  'comment.cancel': 'Cancel',
  'comment.replying': 'Replying to {name}',
  'comment.replyPh': 'Write a reply…',
  'comment.empty': 'No comments yet.',
  'comment.signIn': 'Sign in to comment',
  'comment.post': 'Post comment',
  'comment.title': 'Comments',
  'comment.write': 'Write a comment…',
  'comment.remove': 'Remove comment',
  'comment.posted': 'Your comment is now visible.',
  'comment.removed': 'Your comment was removed.',
  'comment.failed': 'Could not load or post comment.',
  'preview.close': 'Close preview',
  'preview.thirty': '30-second preview',
  'preview.open': 'Open full video on YouTube',
  'expiry.label': 'Expired',
  'expiry.delete': 'Expire and delete',
  /* MÙA GIẢI (tuần/tháng, giờ Việt Nam — src/lib/season.js). Khoảng ngày phải
     in ra kèm nhãn: "tuần này" là từ mơ hồ nếu không nói tuần nào. */
  'rank.periodLabel': 'Choose season period',
  'rank.period.all': 'All time',
  'rank.period.week': 'This week',
  'rank.period.month': 'This month',
  'rank.range': '{from} – {to}',
  /* Chi tiết cửa sổ (tuần T2–CN, tháng lịch, giờ VN) KHÔNG in thường trực:
     nó là chú thích một-lần-đọc, in mãi thành nhiễu và đẩy cụm nút lệch hàng
     (người dùng đã chê "chú thích dài làm bố cục nút bị lệch xuống"). Nó sống
     trong tooltip của con tem khoảng ngày — cần thì hover/hold để đọc. */
  'rank.rangeTip': 'Week runs Mon–Sun, month is the calendar month · Vietnam time (UTC+7)',
  /* Câu luật của bảng mùa: MỘT vế ngắn, nói rõ con số bị cắt theo cửa sổ, cùng
     khoá chính với ba cách xếp — không một con số tự đặt nào. */
  'rank.periodRule.total': 'Sorted by requests sent this period',
  'rank.periodRule.completed': 'Sorted by requests completed this period',
  'rank.periodRule.total_votes': 'Sorted by votes earned this period',
  /* Bảng votes không có mốc thời gian theo bài, nên cột phiếu của bảng mùa là
     phiếu CỘNG DỒN của bài gửi trong mùa — nói thật còn hơn để người xem tự
     hiểu nhầm là "phiếu nhận trong tuần". Rút còn một vế inline (ngăn bằng
     chấm mờ trong câu luật): ý phải giữ trọn, chữ không được chiếm cả hàng. */
  'rank.votesNote': 'Votes are lifetime totals for requests sent this period',
  'rank.emptyPeriod.all': 'No data yet.',
  'rank.emptyPeriod.week': 'No requests yet this week — the season resets every Monday (Vietnam time).',
  'rank.emptyPeriod.month': 'No requests yet this month.',
  'rank.rewards.week': 'Weekly prizes: 1st (+15 votes) · 2nd (+10 votes) · 3rd (+5 votes)',
  'rank.rewards.month': 'Monthly prizes: 1st (+50 votes & +1 request) · 2nd (+30 votes) · 3rd (+20 votes)',
  'rank.reward.w1': '+15 vote bonus',
  'rank.reward.w2': '+10 vote bonus',
  'rank.reward.w3': '+5 vote bonus',
  'rank.reward.m1': '+50 vote bonus + 1 request bonus',
  'rank.reward.m2': '+30 vote bonus',
  'rank.reward.m3': '+20 vote bonus',

  /* request cua toi */
  'mine.title': 'My requests',
  'mine.empty': 'No requests yet.',
  'mine.emptyHint': 'Send your first request — it will show up here with its status and votes.',
  'mine.orders': 'My orders',
  'mine.ordersEmpty': 'No orders yet.',
  'mine.ordersHint': 'Vote orders you buy show up here with their status.',

  /* don hang */
  'order.paid': 'Paid',
  'order.rejected': 'Rejected',
  'order.awaiting': 'Awaiting confirmation',
  'order.cancel': 'Cancel order',
  'order.confirmCancel': 'Cancel this order?',
  'order.confirmCancelPaid': 'Cancelling also deletes the linked paid request. Continue?',
  'order.paidRequest': 'Paid request',
  'order.votes': '{n} votes',

  /* footer */
  'foot.tag': 'Request Page',
  'foot.copy': '© {y} CHAEREVE. All rights reserved.',
  'foot.privacy': 'Privacy',

  /* tab trong modal */
  'tab.request': 'New request',
  'tab.vote': 'Vote',
  'tab.buy': 'Buy votes',

  /* nut */
  'btn.close': 'Close',
  'btn.cancel': 'Cancel',
  'btn.confirm': 'Confirm',
  /* Hộp xác nhận trong app — thay `confirm()`/`prompt()` của trình duyệt. Chữ ở
     đây là chữ của một HỘP, không phải của nút: tiêu đề nói việc sắp xảy ra,
     dòng dưới nói hậu quả, và hậu quả nào cũng là "không lấy lại được" — đó
     chính là lý do hộp này tồn tại. */
  'dlg.cannotUndo': 'This cannot be undone.',
  'dlg.denyTitle': 'Deny this request?',
  'dlg.denyBody': 'The reason you type here is shown to the requester.',
  'dlg.bulkDenyTitle': 'Deny {n} requests?',
  'dlg.mediaTitle': 'Delete this video?',
  'dlg.mediaBody': 'It leaves the home page, and the other videos close the gap.',

  /* form gui request */
  /* Form gửi request: ba bước, lỗi từng ô, gợi ý cho từng loại bài. */
  'req.step1': 'Pick a type',
  'req.step2': 'Name the song',
  'req.step3': 'Send it',
  /* điều hướng ba bước */
  'req.stepsAria': 'Request form steps',
  'req.next': 'Continue',
  'req.back': 'Back',
  /* Nút mở ô ghi chú — ô tuỳ chọn duy nhất, mặc định gấp lại. */
  'req.noteAdd': 'Add a note (optional)',
  'req.kindHint.ccl': 'Colour-coded lyrics video',
  'req.kindHint.album': 'Every track on the release',
  'req.kindHint.loop': 'One song looping for an hour',
  'req.kindHint.short': 'Vertical cut for Shorts',
  'req.artistPh': 'e.g. aespa',
  'req.titlePh': 'e.g. LEMONADE',
  'req.notePh': 'Anything the editor should know',
  'req.noteHint': 'Optional. Up to 500 characters.',
  'req.warnLink': 'That does not look like a full link — it should start with http.',
  'req.errArtist': 'Who is the artist? This one is required.',
  'req.errTitle': 'This one is required.',
  'req.notReady': 'Fill in the two required fields first',
  'req.submitFix': 'Fill in the required fields',
  'req.clear': 'Clear',

  /* Thẻ XEM TRƯỚC trong form: dựng đúng cái người khác sẽ thấy trên bảng, từ
     chính những gì đang gõ. Chỗ chưa điền hiện chữ mờ nói rõ còn thiếu gì. */
  /* Gợi ý tách tiêu đề video dán nguyên si thành hai ô (xem `splitSong`). */
  'req.splitLead': 'This looks like a full video title. Split it into the two fields?',
  'req.splitGo': 'Split it',
  'req.draftRestored': 'Draft restored from your last visit',
  'req.draftClear': 'Discard draft',
  /* Nhãn NGẮN của thẻ xem trước. Vòng 13 gỡ cả câu dài "Preview — this is what
     goes on the board" (chủ dự án yêu cầu), nhưng gỡ luôn cả chữ "Preview" thì
     thẻ mất tên: người dùng nhìn một khối có viền mà không biết nó là gì. Nay
     giữ đúng MỘT chữ. */
  'req.preview': 'Preview',
  'req.previewYt': 'YouTube link recognised',
  'req.phArtist': 'artist name…',
  'req.phTitle': 'the {f} name…',
  'req.phYou': 'you',
  'req.phFresh': 'new request',
  'req.phPaid': 'paid request',
  'req.linkOk': 'YouTube video recognised — cover shown in the preview below.',
  'req.linkList': 'A playlist link: the video is listed instead of the cover.',
  'req.kind': 'Video type',
  'req.kindNote.album': 'Full Album = all lyric videos of one album collected into a playlist. Only made after the channel has uploaded every colour-coded lyric video of that album.',
  'req.artist': 'Artist',
  'req.song': 'Song',
  'req.albumName': 'Album',
  'req.link': 'Song / album link',
  'req.linkPh': 'https://youtu.be/…',
  'req.note': 'Notes',
  'req.rulesTitle': 'Before requesting',
  'req.rule1': "If the song is already requested, vote for it — don't send it again.",
  'req.rule2': 'One song per request.',
  'req.rule3': 'Most votes get made first — vote yours into UP NEXT.',
  'req.rule4': "Don't request songs the channel already made.",
  'req.rule5': 'Real artists only — no AI or virtual groups.',
  'req.agree': 'Agree',
  'req.okPaid': 'Paid request created. Transfer {p} to start production.',
  'req.ok': 'Request sent. A moderator will review it.',
  'req.paidLabel': 'Paid request ({p})',
  'req.useBonusPaid': 'Use 1 free paid request reward ({n} available)',
  'req.paidDesc1': 'Approved and started ',
  'req.paidDescB': 'immediately',
  'req.paidDesc2': ', no voting needed. Send the payment after submitting.',
  'req.bonusPaidDesc': 'Your earned reward covers this paid request. No payment is needed.',
  'req.sending': 'Sending…',
  'req.submitPaid': 'Send paid request for {p}',
  'req.submitBonusPaid': 'Use reward and send paid request',
  'req.submit': 'Send request',

  /* buou vote */
  'vote.purchased': 'Purchased',
  'vote.bonus': 'Bonus',
  'vote.outBuy': 'Out of votes. Buy more to continue.',
  'vote.sortTop': 'Most voted',
  'vote.sortNew': 'Newest',
  'vote.search': 'Search the list…',
  'vote.empty': 'Nothing to vote on.',
  'vote.dialogTitle': 'Vote for this request',
  'vote.total': '{n} votes',
  'vote.freeToday': 'Free votes today',
  'vote.yours': 'you voted {n}',
  'vote.qty': 'Number of votes',
  /* Hộp vote: con số lớn là KẾT QUẢ SAU khi bấm, không phải số đang có. */
  'vote.hero': 'Votes after this',
  'vote.heroSub': 'Currently {n} votes',
  'vote.leftBefore': 'Your votes left',
  'vote.useAll': 'Use all {n}',
  'vote.tooMany': 'You have {n} votes left.',
  'vote.none': 'No votes left.',
  'vote.confirm': 'Vote {n}',
  'vote.locked': 'This request is already picked. Voting is closed.',
  'vote.closed': 'Voting is closed for this request — it is no longer in the queue.',
  'vote.takeBack': 'Take back {n}',
  'vote.sources': 'including {p} bought and {b} bonus',
  'vote.tooManyBack': 'You voted {n} here.',
  'vote.buyMore': 'Buy more votes',

  /* mua vote */
  'buy.packs': 'Vote packs',
  'buy.best': 'Best value',
  'buy.unit': 'votes',
  'buy.order': 'Buy',
  'buy.single': 'Single votes',
  'buy.perVote': '/ vote',
  'buy.each': '{v} each',
  'buy.created': 'Order {label} created for {amt}. Send the payment using the details below.',
  'buy.payment': 'Payment',
  'buy.payNote1': 'Transfer with your ',
  'buy.payNoteB': 'Google account name',
  'buy.payNote2': ' as the note.',
  'buy.yourOrders': 'Your orders',
  'buy.noOrders': 'No orders yet.',

  /* kenh ho tro */
  'support.line': 'Contact for help or refund?',

  /* phuong thuc thanh toan */
  'pay.bank': 'Bank transfer',
  'pay.paypal': 'PayPal',
  'pay.hint': 'Select a payment method.',
  'pay.bankName': 'Bank',
  'pay.accNo': 'Account number',
  'pay.accName': 'Account holder',
  'pay.email': 'Email',
  'pay.amount': 'Amount',
  'pay.content': 'Transfer note',
  'pay.memo': 'Note',
  'pay.copy': 'Copy',
  'pay.scanBank': 'Scan with your banking app',
  'pay.scanPaypal': 'Scan or open the link',
  'pay.qrFail1': 'The QR code could not be generated.',
  'pay.qrFail2': 'Use the details on the left.',

  /* man hinh dang nhap */
  'gate.sub': 'Sign in with Google to request and vote.',
  'gate.redirect': 'Redirecting…',
  'gate.google': 'Continue with Google',
  'gate.perk1': '{n} free votes per day',
  'gate.perk2': '{n} requests per hour',
  'gate.perk3': 'Paid requests start first',


  /* bang dieu hanh */
  'adm.pageAria': 'Admin workspace',
  'adm.export': 'Export CSV',
  'adm.exported': 'Saved',
  'adm.showing': 'Showing {n} of {total}',
  'adm.selectPage': 'Select all {n} on this page',
  /* Hai phím tắt của bảng quản trị, in ngay chỗ dùng (tự ẩn trên máy cảm ứng). */
  'adm.keyEsc': 'clears the selection',
  'adm.keyAll': 'selects this page',
  /* Vùng chỉ trình đọc màn hình đọc: đổi bộ lọc là con số đổi, nhưng mắt
     thường không được báo. */
  'adm.resultCount': 'Now showing {n} requests',
  'adm.pending': 'Pending',
  'adm.active': 'Active',
  'adm.orders': 'Orders',
  'adm.done': 'Closed',
  'adm.approve': 'Approve',
  'adm.deny': 'Deny',
  'adm.denyVideo': 'Already made it? Video link (optional)',
  'err.denyVideo': 'Enter a valid https:// or http:// video link.',
  'err.mediaLimit': 'You can add up to 20 videos, including featured videos. Remove a video first.',
  'adm.mediaLimit': '{n}/20 videos · featured included',
  'adm.denyPrompt': 'Reason shown to the user (optional)',
  'adm.edit': 'Edit',
  'adm.closeEdit': 'Close',
  'adm.artist': 'Artist',
  'adm.songTitle': 'Song',
  'adm.saveSong': 'Save name',
  'adm.videoPh': 'Finished video link (YouTube)',
  'adm.saveDone': 'Save and complete',
  'adm.backToQueue': 'Back to queue',
  'adm.start': 'Start production',
  'adm.expired': 'Expired',
  'adm.expiredBody': 'Requests not picked within one month appear here for review.',
  'adm.pick': 'Pick for Up next',
  'adm.unpick': 'Remove from Up next',
  'adm.picked': 'Up next',
  'adm.sourceLink': 'source link',
  'adm.delete': 'Delete',
  'adm.confirmDelete': 'Delete this request?',
  'adm.received': 'Mark as paid',
  'adm.noOrders': 'No orders yet.',
  /* TRẠNG THÁI RỖNG NÓI RA LÝ DO. Bản cũ chỉ có một dòng "Nothing here." giữa
     khung trống — người dùng đọc nó như một lỗi. Nay: một dòng đậm nói đang
     thiếu gì, một dòng nhỏ nói vì sao, và lối thoát (bỏ bộ lọc) khi cái trống
     là do chính bộ lọc. */
  'adm.emptyTitle': 'No requests in this list',
  'adm.emptyBody': 'Requests land here as soon as someone sends one. Try another list above.',
  'adm.emptyOrdersBody': 'Vote orders appear here the moment someone buys votes.',
  'adm.clearFilters': 'Clear filters',
  'adm.pickMode': 'Select',
  'adm.pickModeOff': 'Done',
  'adm.selectRow': 'Select this request',
  'adm.selected': '{n} selected',
  'adm.bulkAria': 'Bulk actions',
  'adm.bulkClear': 'Clear selection',
  'adm.bulkConfirmDelete': 'Delete {n} requests?',
  'adm.sortAria': 'Sort the list',
  'adm.sortDefault': 'Tab order',
  'adm.sortNewest': 'Newest first',
  'adm.sortVotes': 'Most votes',
  'adm.sortWaiting': 'Waiting longest',
  'adm.reqDeleted': '(request deleted)',
  'adm.votesShort': 'votes',
  'adm.search': 'Search song, artist or requester…',
  'adm.clearSearch': 'Clear search',
  'adm.noResults': 'Nothing matches “{q}”.',
  /* request trùng bài: dòng này là một phần của cụm, hạng tính theo tổng vote */
  'adm.dupTotal': '{n} requests for this song · {v} votes in total',
  'adm.mileGroup': 'Tick here moves the progress bar of all {n} requests for this song',
  'adm.saveDoneGroup': 'Saves the link and closes all {n} requests for this song',
  'adm.media': 'Videos',
  'adm.mediaAddShort': '+ Add',
  'adm.mediaViewHome': 'View on home page',
  'adm.mediaGroupFeatured': 'Featured video',
  'adm.mediaGroupVideo': 'Latest videos',
  'adm.mediaAddFeatured': 'Add featured video',
  'adm.mediaAddVideo': 'Add video link',
  'adm.mediaEditList': 'Add / edit links',
  'adm.mediaTextHint': 'One YouTube link per line · custom title: link | Title',
  'adm.mediaTextCount': '{n} videos',
  'adm.mediaTextBad': '{n} skipped (bad link or missing title)',
  'adm.mediaTextSave': 'Save video list',
'sfx.volume': 'Volume',
  'adm.mediaBulkNone': 'No valid lines yet. Use: https://youtu.be/… | Title',
  'adm.mediaEmptyGroup': 'Nothing here yet.',
  'adm.mediaTitle': 'Video title',
  'adm.mediaTitlePh': 'CHUNG HA México (Color Coded Lyrics)',
  'adm.mediaUrl': 'YouTube video link',
  'adm.mediaBadUrl': 'That link is not a YouTube video.',
  'adm.mediaThumb': 'Cover image (optional, leave empty for HD YouTube thumbnail)',
  'adm.mediaHide': 'Hide from site',
  'adm.mediaHidden': 'hidden',
  'adm.mediaLive': 'live',
  'adm.mediaShow': 'Show again',
  'adm.mediaSave': 'Save',
  'adm.mediaUp': 'Move up',
  'adm.mediaDown': 'Move down',
  'adm.comments': 'Comments',
  'adm.commentDelete': 'Delete comment',
  'adm.noComments': 'No comments found',
  'adm.emptyCommentsBody': 'Comments on requests will appear here for moderation.',

  /* thong bao duoi goc */
  'toast.deleted': 'Request deleted.',
  'toast.approved': 'Request approved.',
  'toast.denied': 'Request denied.',
  'toast.repeated': '{n} identical notices merged into this one',
  'toast.updated': 'Updated.',
  'toast.updatedGroup': 'Updated · {n} requests for this song',
  'toast.bulk': '{n} requests updated',
  'toast.removed': 'Deleted.',
  'toast.orderOk': 'Payment confirmed.',
  'toast.orderNo': 'Order rejected.',
  'toast.orderCancelled': 'Order cancelled.',
  'toast.mediaSaved': 'Saved.',
  'toast.mediaDeleted': 'Deleted.',
  'toast.saved': 'Saved.',

  /* thong bao */
  'notif.ok': 'Done',
  'notif.err': 'Something went wrong',
  'notif.gold': 'Received',
  'notif.region': 'Notifications',
  'notif.dismiss': 'Dismiss notification',
  'notif.reqTitle': 'Request sent',
  'notif.reqBody': '{song} is waiting for review.',
  'notif.paidTitle': 'Paid request created',
  'notif.paidBody': '{song} costs {amt}. It skips the queue once paid.',
  'notif.freePaidTitle': 'Reward request created',
  'notif.freePaidBody': '{song} used one earned free paid-request reward. It skips the queue.',
  'notif.payNow': 'Open payment',
  'notif.buyTitle': 'Order for {n} votes',
  'notif.buyBody': 'Pay {amt} to add {n} votes to your account.',

  /* ve dau trang */
  'top.label': 'Back to top',

  /* loi */
  'err.signin': 'Sign in to continue.',
  /* LƯỚI AN TOÀN của một khối (Boundary.jsx): khi một vùng ném lỗi lúc vẽ,
     người dùng phải đọc được chuyện gì vừa xảy ra thay vì thấy trang trắng. */
  'err.blockTitle': 'This section could not load',
  'err.blockBody': 'The rest of the page still works. Try again — if it keeps failing, reload the page.',
  'err.blockRetry': 'Try again',
  'err.voteAuth': 'Sign in to vote.',
  'err.requestAuth': 'Sign in to send a request.',
  'err.requestMissing': 'Request not found.',
  'err.commentInvalid': 'Comment must be between 1 and 180 characters.',
  'err.expiryLocked': 'This request is already in production and cannot expire.',
  'err.voteClosed': 'Voting is closed for this request.',
  'err.needFields': 'Artist and title are required.',
  'err.notOwner': 'You can only delete your own request.',
  'err.deleteLocked': 'This request is in production and cannot be deleted.',
  'err.adminOnly': 'Admin only.',
  'err.rewardInvalid': 'That reward is not valid.',
  'err.rewardPeriod': 'That reward period is not valid.',
  'err.rewardType': 'Choose the paid-request option before using this reward.',
  'err.noBonusRequest': 'You have no free paid-request rewards left.',
  'err.commentRate': 'Too many comments. Please wait a minute and try again.',
  'err.commentParent': 'That reply no longer belongs to this request.',
  'err.orderOwner': 'You can only cancel your own orders.',
  'err.orderPaidLocked': 'The request is already approved, so the order cannot be cancelled.',
  'err.kindBad': 'Unknown video type.',
  'err.mediaThumb': 'The cover link must start with http.',
  'err.qty': 'Pick a number between 1 and 100.',
  'err.priceChanged': 'Prices just changed. Reload the page and order again.',
  'err.deleteVoted': 'Others have already voted for this request ({n} votes), so it can no longer be deleted.',
  'err.paidPending': 'You already have {n} paid requests waiting for payment. Pay or cancel one first.',
  'err.orderQueueLimit': 'You have too many vote orders waiting for payment. Pay or cancel one first.',
  'err.generic': 'Something went wrong. Try again.',
  'err.databaseSetup': 'The database is out of date. Run the migration in supabase/migrations, then reload. Existing data is kept.',
  'err.rateLimit': 'Up to {n} requests per hour.',
  'err.orderMissing': 'Order not found.',
  'err.orderLocked': 'An admin already handled this order, so it cannot be cancelled.',
  'err.nameShort': 'Name needs at least 2 characters.',
  'err.avatarType': 'That file is not an image.',
  'err.avatarBig': 'That image is too large.',
  'err.avatarRead': 'Could not read that image. Use a JPG, PNG or GIF.',
  'err.avatarUpload': 'Upload failed. Try again.',
  'err.notVoted': 'You have not cast that many votes here.',
  'err.voteQty': 'Enter a number between 1 and 100.',
  'err.voteLocked': 'This request is already picked. Voting is closed.',
  'err.notEnoughVotes': 'Not enough votes. {n} left.',
  'err.mediaTitle': 'The video needs a name.',
  'err.mediaUrl': 'Paste a YouTube video URL.',
  'err.mediaMissing': 'That item no longer exists.',
  'err.mediaBulkEmpty': 'No valid lines. Use: https://youtu.be/… | Title',

  /* thoi gian tuong doi */
  'time.now': 'now',
  'time.min': '{n}m ago',
  'time.hour': '{n}h ago',
  'time.day': '{n}d ago',
  'time.week': '{n}w ago',
  'time.month': '{n}mo ago',
  'time.year': '{n}y ago',

  /* trang thai */
  'status.pending': 'Pending',
  'status.queued': 'In queue',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
  'status.denied': 'Denied',
}

/* Thay {name} trong chuỗi bằng giá trị trong vars. */
const fill = (s, vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s

const I18nCtx = createContext(null)

export function I18nProvider({ children }) {
  const t = useCallback((key, vars) => fill(S[key] ?? key, vars), [])
  const value = useMemo(() => ({ t }), [t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nCtx)
  if (!ctx) throw new Error('useI18n phải nằm trong <I18nProvider>')
  return ctx
}

/*
 * Dịch lỗi. Hai nguồn:
 *   · appError('err.xxx', vars) từ lib/db.js — message chính là key
 *   · PostgREST khi hàm SQL raise — code là 'P0001' (vô nghĩa), message
 *     là key 'err.xxx' mà schema.sql raise lên, hoặc một câu tiếng Anh
 *     viết thẳng trong SQL (câu có số kèm nên không qua từ điển được)
 * Vì vậy: ưu tiên chuỗi 'err.*', tuyệt đối không in raw code ra màn hình.
 */
export function errMsg(t, e) {
  const m = typeof e?.message === 'string' ? e.message : String(e?.message ?? e ?? '')
  if (m.startsWith('err.')) return t(m, e?.vars)
  const c = typeof e?.code === 'string' ? e.code : ''
  if (c.startsWith('err.')) return t(c, e?.vars)
  if (!m || /^(position|detail|hint|context):|SQLSTATE|row-level security|violates |permission denied|does not exist/i.test(m)) {
    return t('err.generic')
  }
  return m.length > 180 ? m.slice(0, 177) + '…' : m
}