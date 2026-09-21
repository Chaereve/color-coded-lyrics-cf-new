import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { addComment, deleteComment, fetchComments } from '../lib/db'
import { useNotify } from '../lib/notify.jsx'
import { profileUrl } from '../lib/history'
import { useNav, spaLink } from '../lib/nav.js'
import { useI18n } from '../lib/i18n.jsx'

/* Comments are a two-level conversation: a root comment and direct replies.
   Keeping parent_id on the row means replies survive reloads and can later be
   moderated with the same owner/admin policy as a root comment. */
export default function Comments({ requestId, user, onLogin }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { push } = useNotify()
  const nav = useNav()

  useEffect(() => {
    if (!open) return
    fetchComments(requestId).then(setItems).catch(() => {
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
      push({ tone: 'ok', title: t('comment.posted'), body: t('comment.posted') })
    } catch (err) {
      const message = err?.message === 'err.commentInvalid' ? t('err.commentInvalid') : t('comment.failed')
      setError(message); push({ tone: 'err', title: t('comment.failed'), body: message })
    } finally { setBusy(false) }
  }

  const author = (c) => c.user_id
    ? <a className="comment-author" href={profileUrl(c.user_id)} onClick={spaLink(nav.openProfile, c.user_id)}>{c.author || 'Member'}</a>
    : <b>{c.author || 'Member'}</b>

  const remove = async (c) => {
    try {
      await deleteComment(c.id)
      setItems(x => x.filter(y => y.id !== c.id && y.parent_id !== c.id))
      push({ tone: 'ok', title: t('comment.removed'), body: t('comment.removed') })
    } catch { push({ tone: 'err', title: t('comment.failed'), body: t('comment.failed') }) }
  }

  const row = (c, nested = false) => (
    <div className={`comment${nested ? ' comment-reply' : ''}`} key={c.id}>
      {author(c)}
      <span>{c.body}</span>
      <div className="comment-actions">
        {user && !nested && <button type="button" className="comment-reply-btn" onClick={() => { setReplyTo(c); setBody('') }}>{t('comment.reply')}</button>}
        {user?.id === c.user_id && <button type="button" className="comment-delete" title={t('comment.remove')} aria-label={t('comment.remove')} onClick={() => remove(c)}><Icon name="close" size={13} /></button>}
      </div>
      {!nested && (children.get(c.id) || []).map(reply => row(reply, true))}
    </div>
  )

  const toggle = () => { if (!open) setError(''); setOpen(v => !v) }
  return <div className={`comments${open ? ' open' : ''}`}>
    <button type="button" className="comments-toggle" onClick={toggle} aria-expanded={open}>
      <Icon name="info" size={14} /> {open ? t('comment.cancel') : t('comment.title')}{items.length > 0 && <b>{items.length}</b>}
    </button>
    {open && <div className="comments-panel">
      {roots.length ? <div className="comments-list">{roots.map(c => row(c))}</div> : <p className="comments-empty">{t('comment.empty')}</p>}
      <form className="comment-form" onSubmit={submit}>
        {replyTo && <div className="replying"><span>{t('comment.replying', { name: replyTo.author || 'Member' })}</span><button type="button" className="lnk" onClick={() => { setReplyTo(null); setBody('') }}>{t('comment.cancel')}</button></div>}
        <input maxLength="180" value={body} onChange={e => setBody(e.target.value)} placeholder={replyTo ? t('comment.replyPh') : user ? t('comment.write') : t('comment.signIn')} />
        <button type="submit" disabled={busy || !body.trim()} aria-label={t('comment.post')}><Icon name="compose" size={15} /></button>
      </form>
      {error && <small className="comment-error">{error}</small>}
    </div>}
  </div>
}
