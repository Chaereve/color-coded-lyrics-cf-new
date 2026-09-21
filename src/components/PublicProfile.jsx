import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { fetchPublicProfile, PUBLIC_RECENT } from '../lib/db'
import { copyText } from '../lib/clipboard'
import { absolute, profileUrl, boardSearchUrl } from '../lib/history'
import { useNav, spaLink } from '../lib/nav.js'
import { useI18n } from '../lib/i18n.jsx'
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

export default function PublicProfile({ userId, onBack }) {
  const { t } = useI18n()
  const nav = useNav()
  const back = onBack || nav.closeProfile
  /* MỘT state cho cả "đã tải xong chưa" lẫn "tải cho AI": `loaded.id` khác
     `userId` thì nghĩa là đang tải — kể cả khi chuyển sang xem người khác.
     Bản cũ cần `setLoading(true)` ngay trong effect, mà setState đồng bộ trong
     effect là một lượt render thừa (lint `react(set-state-in-effect)`). */
  const [loaded, setLoaded] = useState({ id: null, profile: null })
  const [shared, setShared] = useState(false)

  useEffect(() => {
    let live = true
    fetchPublicProfile(userId)
      .then(profile => { if (live) setLoaded({ id: userId, profile }) })
      .catch(() => { if (live) setLoaded({ id: userId, profile: null }) })
    return () => { live = false }
  }, [userId])

  const loading = loaded.id !== userId
  const profile = loading ? null : loaded.profile

  /* Thứ tự (mới nhất trước), giới hạn, và luật "không hiện bài chưa duyệt /
     bị từ chối" đều do `fetchPublicProfile` quyết định — ở đây chỉ bỏ những
     hàng không đọc ra được một cái tên, vì một link `?q=` rỗng dẫn tới danh
     sách rỗng và người bấm tưởng app hỏng. */
  const recent = useMemo(
    () => (profile?.recent || []).filter(r => r && (r.title || r.artist)).slice(0, PUBLIC_RECENT),
    [profile])

  /* Địa chỉ để CHIA SẺ dựng từ `userId`, không lấy `window.location.href`: khi
     `pushState` bị chặn (iframe sandbox) thì địa chỉ trên thanh vẫn là bảng yêu
     cầu, copy ra sẽ là link sai. */
  const shareUrl = () => absolute(profileUrl(userId))

  if (loading) return <div className="public-profile empty" role="status">Loading profile…</div>
  if (!profile) return <div className="public-profile empty" role="status">Profile not found.</div>

  return <section className="public-profile" data-reveal>
    <a className="profile-back" href="/" onClick={spaLink(back)}>
      <Icon name="prev" size={14} /> Back to board
    </a>
    <div className="public-profile-head">
      <div className="public-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : (profile.name || '?')[0]}</div>
      <div><h2>{profile.name || 'Community member'}</h2><p>Chaereve community member</p></div>
    </div>
    <button className="profile-share" onClick={async () => { const ok = await copyText(shareUrl()); if (ok) { setShared(true); setTimeout(() => setShared(false), 1800) } }}>{shared ? 'Link copied' : 'Share profile'}</button>
    <div className="public-stats">
      <div><b>{profile.requests}</b><span>Requests</span></div>
      <div><b>{profile.completed}</b><span>Completed</span></div>
      {/* "Received", không phải "given": con số là tổng phiếu các bài của người
          đó NHẬN được. Phiếu họ đi bỏ cho người khác không đọc được bằng RLS
          của `votes` (chỉ mình + admin) — xem ghi chú ở `fetchPublicProfile`. */}
      <div><b>{profile.votes}</b><span>Votes received</span></div>
    </div>
    <div className="public-badges">
      <h3>Achievements</h3>
      <div className="achievement-list">
        {profile.requests >= 1 && <span><Icon name="compose" size={14} /><b>First request</b></span>}
        {profile.completed >= 1 && <span><Icon name="check" size={14} /><b>First completion</b></span>}
        {profile.votes >= 10 && <span><Icon name="cup" size={14} /><b>10 votes earned</b></span>}
      </div>
    </div>
    {recent.length > 0 && (
      <div className="public-requests">
        <h3>Recent requests</h3>
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
    )}
  </section>
}
