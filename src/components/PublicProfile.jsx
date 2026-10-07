import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { fetchPublicProfile, fetchPublicStreak, PUBLIC_RECENT } from '../lib/db'
import StreakStrip from './StreakStrip'
import ShareCardButton from './ShareCardButton'
import { STREAK_MILESTONES } from '../lib/streak.js'
import { copyText } from '../lib/clipboard'
import { absolute, profileUrl, boardSearchUrl } from '../lib/history'
import { useNav, spaLink } from '../lib/nav.js'
import { useI18n } from '../lib/i18n.jsx'
import { useTransient } from '../lib/useTransient'
import LoadErr from './LoadErr'
import { statusLabel } from '../lib/meta'

/* =========================================================
   TRANG CÁ NHÂN CÔNG KHAI — mở từ tên người gửi / tên tác giả bình luận
   ---------------------------------------------------------
   Hai quy tắc rút ra từ bốn lỗi đã gặp thật (xem docs/DA-LAM-VA-GOI-Y.md
   phần V):
     · MỌI link ở đây đi qua `lib/nav.js` + `lib/history.js`, không tự ghép
       chuỗi và không tự gọi `pushState` — thẻ vẫn giữ `href` thật để mở tab
       mới / dán link được, còn bấm thường thì đi trong app (không tải lại
       trang nên không chạy lại màn chờ);
     · dữ liệu thiếu KHÔNG được làm vỡ khối: hàng không có tên bài thì không
       dựng link rỗng (link rỗng dẫn tới một danh sách rỗng, người bấm tưởng
       app hỏng), và nhãn trạng thái đi qua `statusLabel` để trang cá nhân nói
       đúng chữ mà hàng trên bảng nói.
   ========================================================= */

export default function PublicProfile({ userId, onBack, fetchers = null }) {
  const { t } = useI18n()
  const nav = useNav()
  const back = onBack || nav.closeProfile
  /* MỘT state cho cả "đã tải xong chưa" lẫn "tải cho AI": `loaded.id` khác
     `userId` thì nghĩa là đang tải — kể cả khi chuyển sang xem người khác.
     Bản cũ cần `setLoading(true)` ngay trong effect, mà setState đồng bộ trong
     effect là một lượt render thừa (lint `react(set-state-in-effect)`). */
  /* `loaded` chở cả ba thứ: của AI, hồ sơ (hoặc null), và CÓ LỖI hay không.
     Trước đây chỉ có hai trạng thái nên mọi lỗi (mất mạng, 5xx, phiên hết
     hạn) đều rơi vào nhánh "không có hồ sơ" và in "Profile not found." —
     người dùng kết luận sai về người kia, và không có nút nào để thử lại. */
  const [loaded, setLoaded] = useState({ id: null, profile: null, error: false })
  /* `attempt` chỉ để THỬ LẠI: tăng lên là effect dưới chạy lại. Không có nó
     thì khối lỗi là đường cụt. */
  const [retry, setRetry] = useState(0)
  /* `Link copied` tự tắt sau 1,8s — đồng hồ do hook giữ, nên rời trang giữa
     chừng không để lại một setTimeout sống lâu hơn component. */
  const [shared, flashShared] = useTransient(1800)
  /* Dấu ngày hoạt động cho dải streak: tải SONG SONG với hồ sơ chứ không nối
     tiếp — thêm một round-trip vào chuỗi sẽ kéo dài màn "Loading profile…".
     null = chưa đọc được nguồn thì dải tự ẩn (xem StreakStrip). */
  /* CÙNG pattern với `loaded`: một state chở cả "của ai" lẫn "dấu ngày nào",
     và suy ra cũ/mới bằng so sánh id — KHÔNG setState đồng bộ trong effect
     để xoá state cũ (lint react(set-state-in-effect) bắt đúng lượt render
     thừa đó). Xem người khác thì dải streak ẩn ngay cho tới khi dấu mới về. */
  const [act, setAct] = useState({ id: null, stats: null })
  const actStats = act.id === userId ? act.stats : null

  useEffect(() => {
    let live = true
    const api = fetchers || { profile: fetchPublicProfile, streak: fetchPublicStreak }
    api.profile(userId)
      .then(profile => { if (live) setLoaded({ id: userId, profile: profile || null, error: false }) })
      .catch(() => { if (live) setLoaded({ id: userId, profile: null, error: true }) })
    api.streak(userId)
      .then(stats => { if (live) setAct({ id: userId, stats }) })
      .catch(() => { if (live) setAct({ id: userId, stats: null }) })
    return () => { live = false }
  }, [userId, fetchers, retry])

  const loading = loaded.id !== userId
  const profile = loading ? null : loaded.profile

  /* Một chỗ quyết định tên hiển thị: `<h2>`, chữ cái đầu của avatar và tấm
     card PNG đều lấy từ đây — trước đây ba chỗ tự bịa cùng một câu. */
  const name = profile?.name || t('name.member')

  /* Thứ tự (mới nhất trước), giới hạn, và luật "không hiện bài chưa duyệt /
     bị từ chối" đều do `fetchPublicProfile` quyết định — ở đây chỉ bỏ những
     hàng không đọc ra được một cái tên, vì một link `?q=` rỗng dẫn tới danh
     sách rỗng và người bấm tưởng app hỏng. */
  const recent = useMemo(
    () => (profile?.recent || []).filter(r => r && (r.title || r.artist)).slice(0, PUBLIC_RECENT),
    [profile])

  /* Nội dung tấm card PNG: số liệu lấy ĐÚNG nguồn đang hiển thị ở hồ sơ
     (fetchPublicProfile) và streak đang hiển thị ở dải trên — card là một
     cách NHÌN khác của cùng dữ liệu, không phải bản sao tự tính lại. */
  const card = useMemo(() => {
    if (!profile) return null
    const st = actStats
    return {
      name,
      avatarUrl: profile.avatar_url || null,
      subtitle: t('card.subtitle'),
      stats: [
        { value: profile.requests, label: t('rank.requests') },
        { value: profile.completed, label: t('rank.completed') },
        { value: profile.votes, label: t('stat.votesReceived') },
      ],
      streakLine: st
        ? (st.current > 0
          ? `${t('streak.current', { n: st.current })} · ${t('streak.longest', { n: st.longest })}`
          : t('streak.longest', { n: st.longest }))
        : null,
      milestones: st ? STREAK_MILESTONES.map((m) => ({ n: m, got: st.earned.includes(m) })) : null,
      footer: t('card.footer'),
    }
  }, [profile, actStats, t, name])

  /* Địa chỉ để CHIA SẺ dựng từ `userId`, không lấy `window.location.href`: khi
     `pushState` bị chặn (iframe sandbox) thì địa chỉ trên thanh vẫn là bảng yêu
     cầu, copy ra sẽ là link sai. */
  const shareUrl = () => absolute(profileUrl(userId))

  if (loading) return <div className="public-profile empty" role="status">{t('public.loading')}</div>
  /* Lỗi mạng KHÁC "người này không tồn tại": một câu là việc phải thử lại,
     một câu là sự thật về hồ sơ. Gộp hai câu làm một là nói sai về người kia. */
  if (loaded.error) {
    return (
      <section className="public-profile" data-reveal>
        <LoadErr onRetry={() => setRetry(n => n + 1)}
          titleKey="err.blockTitle" bodyKey="err.blockBody" retryKey="err.blockRetry" />
      </section>
    )
  }
  if (!profile) return <div className="public-profile empty" role="status">{t('public.notFound')}</div>

  return <section className="public-profile" data-reveal>
    <a className="profile-back" href="/" onClick={spaLink(back)}>
      <Icon name="prev" size={14} /> {t('public.back')}
    </a>
    <div className="public-profile-head">
      <div className="public-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : (name || '?')[0]}</div>
      <div><h2>{name}</h2><p>{t('public.member')}</p></div>
    </div>
    <div className="profile-share-row">
      <button className="profile-share" onClick={async () => { const ok = await copyText(shareUrl()); if (ok) flashShared() }}>{shared ? t('public.copied') : t('public.share')}</button>
      {card && <ShareCardButton card={card} />}
    </div>
    <div className="public-stats">
      <div><b>{profile.requests}</b><span>{t('public.requests')}</span></div>
      <div><b>{profile.completed}</b><span>{t('public.completed')}</span></div>
      {/* "Received", không phải "given": con số là tổng phiếu các bài của người
          đó NHẬN được. Phiếu họ đi bỏ cho người khác không đọc được bằng RLS
          của `votes` (chỉ mình + admin) — xem ghi chú ở `fetchPublicProfile`. */}
      <div><b>{profile.votes}</b><span>{t('public.votes')}</span></div>
    </div>
    {/* Cột mốc chuỗi ngày của người này — cộng đồng thấy nhau đã đều đặn mấy
        ngày, cùng tinh thần với bảng xếp hạng và khối Achievements bên dưới. */}
    <StreakStrip stats={actStats} />
    <div className="public-badges">
      <h3>{t('public.achievements')}</h3>
      <div className="achievement-list">
        {profile.requests >= 1 && <span><Icon name="compose" size={14} /><b>{t('badge.firstRequest')}</b></span>}
        {profile.requests >= 5 && <span><Icon name="star" size={14} /><b>{t('badge.curator')}</b></span>}
        {profile.completed >= 1 && <span><Icon name="check" size={14} /><b>{t('badge.firstCompletion')}</b></span>}
        {profile.completed >= 5 && <span><Icon name="cup" size={14} /><b>{t('badge.hitMaker')}</b></span>}
        {profile.votes >= 10 && <span><Icon name="cup" size={14} /><b>{t('badge.votes10')}</b></span>}
        {actStats?.longest >= 7 && <span><Icon name="flame" size={14} /><b>{t('badge.streak7')}</b></span>}
        {actStats?.longest >= 30 && <span><Icon name="flame" size={14} /><b>{t('badge.streak30')}</b></span>}
      </div>
    </div>
    {recent.length > 0 && (
      <div className="public-requests">
        <h3>{t('public.recent')}</h3>
        <div className="public-requests-grid">
          {recent.map((r, i) => (
            <div className="public-request" key={r.id || `${r.title}-${r.artist}-${i}`}>
              <span>
                <a className="public-request-link" href={boardSearchUrl(r.title, r.artist)} onClick={spaLink(nav.openSong, r)}>
                  <b>{r.title}</b><small>{r.artist}</small>
                </a>
              </span>
              <em className="public-state">{statusLabel(r, t)}</em>
            </div>
          ))}
        </div>
      </div>
    )}
  </section>
}
