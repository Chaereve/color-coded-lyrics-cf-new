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
  'nav.mineSub': 'Your details, your requests, your orders',
  'nav.adminSub': 'Review requests, pick the queue, handle orders',

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
  'nt.grp.other': 'Other',

  'nt.tag.near': 'Almost picked',
  'nt.tag.lead': 'First in line',
  'nt.tag.approved': 'In queue',
  'nt.tag.started': 'Production',
  'nt.tag.picked': 'Up next',
  'nt.tag.done': 'Out now',
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
  'row.follow': 'Get alerts about this song',
  'row.unfollow': "You'll get alerts about this song — turn off",
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
  'req.titlePh': 'Song, or album name',
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
  'req.paidDesc1': 'Approved and started ',
  'req.paidDescB': 'immediately',
  'req.paidDesc2': ', no voting needed. Send the payment after submitting.',
  'req.sending': 'Sending…',
  'req.submitPaid': 'Send paid request for {p}',
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
  'err.voteClosed': 'Voting is closed for this request.',
  'err.needFields': 'Artist and title are required.',
  'err.notOwner': 'You can only delete your own request.',
  'err.deleteLocked': 'This request is in production and cannot be deleted.',
  'err.adminOnly': 'Admin only.',
  'err.orderOwner': 'You can only cancel your own orders.',
  'err.orderPaidLocked': 'The request is already approved, so the order cannot be cancelled.',
  'err.kindBad': 'Unknown video type.',
  'err.mediaThumb': 'The cover link must start with http.',
  'err.qty': 'Pick a number between 1 and 100.',
  'err.priceChanged': 'Prices just changed. Reload the page and order again.',
  'err.deleteVoted': 'Others have already voted for this request ({n} votes), so it can no longer be deleted.',
  'err.paidPending': 'You already have {n} paid requests waiting for payment. Pay or cancel one first.',
  'err.generic': 'Something went wrong. Try again.',
  'err.databaseSetup': 'The database is out of date. Run the migration in supabase/migrations, then reload. Existing data is kept.',
  'err.rateLimit': 'Up to {n} requests per hour.',
  'err.orderMissing': 'Order not found.',
  'err.orderLocked': 'An admin already handled this order, so it cannot be cancelled.',
  'err.nameShort': 'Name needs at least 2 characters.',
  'err.avatarType': 'That file is not an image.',
  'err.avatarBig': 'That image is too large.',
  'err.avatarRead': 'Could not read that image. Use a JPG or PNG.',
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