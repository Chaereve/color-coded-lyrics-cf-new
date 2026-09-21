import { useEffect, useState } from 'react'
import Icon from './Icon'
import { fetchPublicProfile } from '../lib/db'
import { copyText } from '../lib/clipboard'

export default function PublicProfile({ userId, onBack }) {
  const [profile, setProfile] = useState(null)
  const [shared, setShared] = useState(false)
  useEffect(() => { let live = true; fetchPublicProfile(userId).then(x => live && setProfile(x)).catch(() => live && setProfile(null)); return () => { live = false } }, [userId])
  if (!profile) return <div className="public-profile empty" role="status">Profile not found.</div>
  return <section className="public-profile" data-reveal>
    <button className="profile-back" onClick={onBack}><Icon name="prev" size={14} /> Back to board</button>
    <div className="public-profile-head"><div className="public-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : (profile.name || '?')[0]}</div><div><h2>{profile.name || 'Community member'}</h2><p>Chaereve community member</p></div></div>
    <button className="profile-share" onClick={async () => { const url = window.location.href; const ok = await copyText(url); if (ok) { setShared(true); setTimeout(() => setShared(false), 1800) } }}>{shared ? 'Link copied' : 'Share profile'}</button>
    <div className="public-stats"><div><b>{profile.requests}</b><span>Requests</span></div><div><b>{profile.completed}</b><span>Completed</span></div><div><b>{profile.votes}</b><span>Votes given</span></div></div>
    <div className="public-badges"><h3>Achievements</h3><div className="achievement-list">{profile.requests >= 1 && <span><Icon name="compose" size={14} /><b>First request</b></span>}{profile.completed >= 1 && <span><Icon name="check" size={14} /><b>First completion</b></span>}{profile.votes >= 10 && <span><Icon name="cup" size={14} /><b>10 votes given</b></span>}</div></div>
    {profile.recent?.length > 0 && <div className="public-requests"><h3>Recent requests</h3>{profile.recent.map(r => <div className="public-request" key={r.id}><span><a className="public-request-link" href={`/?f=newest&q=${encodeURIComponent(`${r.title} ${r.artist}`)}`} onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/?f=newest&q=${encodeURIComponent(`${r.title} ${r.artist}`)}`); window.dispatchEvent(new PopStateEvent('popstate')) }}><b>{r.title}</b><small>{r.artist}</small></a></span><em className="public-state">{r.status}</em></div>)}</div>}
  </section>
}
