import { useEffect, useMemo, useState, useRef } from 'react'
import Icon from './Icon'
import { addComment, deleteComment, fetchComments } from '../lib/db'
import { useNotify } from '../lib/notify.jsx'
import { profileUrl } from '../lib/history'
import { useNav, spaLink } from '../lib/nav.js'
import { useI18n } from '../lib/i18n.jsx'
import { timeAgo } from '../lib/meta'

function initials(name = '') {
  const parts = String(name || '').trim().split(/\s+/)
  if (!parts.length || !parts[0]) return '?'
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

function CommentAvatar({ src, name }) {
  if (src) {
    return <img className="comment-av" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  }
  return <span className="comment-av ph" aria-hidden="true">{initials(name)}</span>
}

function formatCommentText(text) {
  if (!text) return null
  const parts = text.split(/(@[A-Za-z0-9_.-]+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return <mark key={i} className="comment-mention">{part}</mark>
    }
    return part
  })
}

/* Comments are a two-level conversation: a root comment and direct replies.
   Keeping parent_id on the row means replies survive reloads and can later be
   moderated with the same owner/admin policy as a root comment. */
export default function Comments({ requestId, user, onLogin, initialCount = 0, onCountChange }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { push } = useNotify()
  const nav = useNav()

  const countCbRef = useRef(onCountChange)
  useEffect(() => { countCbRef.current = onCountChange })

  useEffect(() => {
    if (!open) return
    fetchComments(requestId).then(res => {
      setItems(res)
    }).catch(() => {
      setError(t('comment.failed'))
      push({ tone: 'err', title: t('comment.failed'), body: t('comment.failed') })
    })
  }, [open, requestId, push, t])

  const children = useMemo(() => {
    const map = new Map()
    for (const c of items) {
      if (!c.parent_id) continue
      const list = map.get(c.parent_id) || []
      list.push(c); map.set(c.parent_id, list)
    }
    return map
  }, [items])
  const roots = useMemo(() => items.filter(c => !c.parent_id), [items])

  const submit = async e => {
    e.preventDefault()
    const clean = body.trim()
    if (!clean) return
    if (!user) { onLogin?.(); return }
    setBusy(true); setError('')
    try {
      const next = await addComment(requestId, user.id, clean, replyTo?.id || null)
      setItems(x => [next, ...x])
      setBody(''); setReplyTo(null)
      countCbRef.current?.(items.length + 1)
      push({ tone: 'ok', title: t('comment.posted'), body: t('comment.posted') })
    } catch (err) {
      const message = err?.message === 'err.commentInvalid' ? t('err.commentInvalid') : t('comment.failed')
      setError(message); push({ tone: 'err', title: t('comment.failed'), body: message })
    } finally { setBusy(false) }
  }

  const author = (c) => c.user_id
    ? <a className="comment-author" href={profileUrl(c.user_id)} onClick={spaLink(nav.openProfile, c.user_id)}>{c.author || 'Member'}</a>
    : <b className="comment-plain">{c.author || 'Member'}</b>

  const remove = async (c) => {
    try {
      await deleteComment(c.id)
      const remaining = items.filter(y => y.id !== c.id && y.parent_id !== c.id)
      setItems(remaining)
      countCbRef.current?.(remaining.length)
      push({ tone: 'ok', title: t('comment.removed'), body: t('comment.removed') })
    } catch { push({ tone: 'err', title: t('comment.failed'), body: t('comment.failed') }) }
  }

  const row = (c, nested = false) => (
    <div className={`comment comment-card${nested ? ' comment-reply' : ''}`} key={c.id}>
      <div className="comment-head">
        <CommentAvatar src={c.avatar} name={c.author} />
        <div className="comment-meta">
          {author(c)}
          {c.created_at && <time className="comment-time">{timeAgo(c.created_at, t)}</time>}
        </div>
        <div className="comment-actions">
          {user && !nested && (
            <button type="button" className="comment-reply-btn" onClick={() => { setReplyTo(c); setBody(`@${c.author || 'Member'} `) }}>
              {t('comment.reply')}
            </button>
          )}
          {user?.id === c.user_id && (
            <button type="button" className="comment-delete" title={t('comment.remove')} aria-label={t('comment.remove')} onClick={() => remove(c)}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="comment-text">
        {formatCommentText(c.body)}
      </div>
      {!nested && (children.get(c.id) || []).length > 0 && (
        <div className="comment-replies-list">
          {(children.get(c.id) || []).map(reply => row(reply, true))}
        </div>
      )}
    </div>
  )

  const toggle = () => { if (!open) setError(''); setOpen(v => !v) }
  const displayCount = items.length > 0 ? items.length : initialCount

  return (
    <div className={`comments${open ? ' open' : ''}`}>
      <button type="button" className="comments-toggle" onClick={toggle} aria-expanded={open}>
        <Icon name="info" size={14} /> {open ? t('comment.cancel') : t('comment.title')}{displayCount > 0 && <b>{displayCount}</b>}
      </button>
      {open && (
        <div className="comments-panel">
          {roots.length ? <div className="comments-list">{roots.map(c => row(c))}</div> : <p className="comments-empty">{t('comment.empty')}</p>}
          <form className="comment-form" onSubmit={submit}>
            {replyTo && (
              <div className="replying">
                <span className="replying-tag">
                  <Icon name="compose" size={13} />
                  {t('comment.replying', { name: replyTo.author || 'Member' })}
                </span>
                <button type="button" className="replying-cancel" onClick={() => { setReplyTo(null); setBody('') }}>
                  <Icon name="close" size={12} /> {t('comment.cancel')}
                </button>
              </div>
            )}
            <div className="comment-input-wrap">
              <input maxLength={180} value={body} onChange={e => setBody(e.target.value)} placeholder={replyTo ? t('comment.replyPh') : user ? t('comment.write') : t('comment.signIn')} />
              <button type="submit" disabled={busy || !body.trim()} aria-label={t('comment.post')}><Icon name="compose" size={15} /></button>
            </div>
          </form>
          {error && <small className="comment-error">{error}</small>}
        </div>
      )}
    </div>
  )
}
