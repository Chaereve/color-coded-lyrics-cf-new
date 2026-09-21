import { useEffect, useState } from 'react'
import Icon from './Icon'
import { addComment, deleteComment, fetchComments } from '../lib/db'
import { useNotify } from '../lib/notify.jsx'

export default function Comments({ requestId, user, onLogin }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { push } = useNotify()
  useEffect(() => { if (!open) return; setError(''); fetchComments(requestId).then(setItems).catch(() => { setError('Could not load comments.'); push({ tone: 'err', title: 'Comments', body: 'Could not load comments.' }) }) }, [open, requestId, push])
  const submit = async e => {
    e.preventDefault(); const clean = body.trim(); if (!clean) return
    if (!user) { onLogin?.(); return }
    setBusy(true); setError('')
    try { const next = await addComment(requestId, user.id, clean); setItems(x => [next, ...x]); setBody(''); push({ tone: 'ok', title: 'Comment posted', body: 'Your comment is now visible.' }) }
    catch (err) { const message = err?.message === 'err.commentInvalid' ? 'Comment must be between 1 and 180 characters.' : 'Could not post comment.'; setError(message); push({ tone: 'err', title: 'Comment failed', body: message }) }
    finally { setBusy(false) }
  }
  return <div className={`comments${open ? ' open' : ''}`}>
    <button type="button" className="comments-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
      <Icon name="info" size={14} /> {open ? 'Hide comments' : 'Comments'}{items.length > 0 && <b>{items.length}</b>}
    </button>
    {open && <div className="comments-panel">
      {items.length ? <div className="comments-list">{items.map(c => <div className="comment" key={c.id}>{c.user_id ? <a className="comment-author" href={`/?profile=${encodeURIComponent(c.user_id)}`} onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/?profile=${encodeURIComponent(c.user_id)}`); window.dispatchEvent(new PopStateEvent('popstate')) }}>{c.author || 'Member'}</a> : <b>{c.author || 'Member'}</b>}<span>{c.body}</span>{user?.id === c.user_id && <button type="button" className="comment-delete" title="Remove comment" aria-label="Remove comment" onClick={async () => { try { await deleteComment(c.id); setItems(x => x.filter(y => y.id !== c.id)); push({ tone: 'ok', title: 'Comment removed', body: 'Your comment was removed.' }) } catch { push({ tone: 'err', title: 'Comment failed', body: 'Could not remove comment.' }) } }}><Icon name="close" size={13} /></button>}</div>)}</div> : <p className="comments-empty">No comments yet.</p>}
      <form className="comment-form" onSubmit={submit}><input maxLength="180" value={body} onChange={e => setBody(e.target.value)} placeholder={user ? 'Write a comment…' : 'Sign in to comment'} /><button type="submit" disabled={busy || !body.trim()} aria-label="Post comment"><Icon name="compose" size={15} /></button></form>
      {error && <small className="comment-error">{error}</small>}
    </div>}
  </div>
}
