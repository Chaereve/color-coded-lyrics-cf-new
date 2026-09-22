import { useEffect, useMemo, useState, useRef } from 'react'
import Icon from './Icon'
import { addComment, deleteComment, fetchComments } from '../lib/db'
import { useNotify } from '../lib/notify.jsx'
import { profileUrl } from '../lib/history'
import { useNav, spaLink } from '../lib/nav.js'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { timeAgo } from '../lib/meta'
import { mentionHandle, mentionParts, commentThreads, commentSubtreeIds, removeCommentSubtree } from '../lib/comments.js'

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
  const parts = mentionParts(text)
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return <mark key={i} className="comment-mention">{part}</mark>
    }
    return part
  })
}

/* Arbitrary-depth parents, displayed flat within each root thread to keep
   mobile layouts readable. The selected row, not its root, is the reply target. */
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

  /* SỐ BÌNH LUẬN ĐI RA NGOÀI Ở MỘT EFFECT, KHÔNG Ở TRONG UPDATER.
     Bản trước gọi `countCbRef.current?.(updated.length)` ngay bên trong hàm
     cập nhật của `setItems` — hàm đó chạy TRONG LÚC RENDER, nên nó gọi
     setState của component cha giữa lượt render của con. React báo đúng lỗi
     này ("Cannot update a component while rendering a different component") và
     có quyền bỏ qua/áp dụng hai lần. Nay updater chỉ trả về mảng mới, còn con
     số báo ra ngoài ở đây — chạy sau khi state đã chốt. */
  useEffect(() => {
    if (!open) return
    countCbRef.current?.(items.length)
  }, [items.length, open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setItems([]); setReplyTo(null); setBody('')
    fetchComments(requestId).then(res => {
      if (!cancelled) setItems(res)
    }).catch(() => {
      if (cancelled) return
      setError(t('comment.failed'))
      push({ tone: 'err', title: t('comment.failed'), body: t('comment.failed') })
    })
    return () => { cancelled = true }
  }, [open, requestId, push, t])

  const threads = useMemo(() => commentThreads(items), [items])

  const submit = async e => {
    e.preventDefault()
    const clean = body.trim()
    if (!clean) return
    if (!user) { onLogin?.(); return }
    setBusy(true); setError('')
    try {
      const next = await addComment(requestId, user.id, clean, replyTo?.id || null)
      setItems(x => [{ ...next, author: user.name || next.author, avatar: user.avatar || next.avatar }, ...x])
      setBody(''); setReplyTo(null)
      push({ tone: 'ok', title: t('comment.posted'), body: t('comment.posted') })
    } catch (err) {
      const message = err?.message === 'err.commentInvalid' ? t('err.commentInvalid') : err?.code ? errMsg(t, err) : t('comment.failed')
      setError(message); push({ tone: 'err', title: t('comment.failed'), body: message })
    } finally { setBusy(false) }
  }

  const author = (c) => c.user_id
    ? <a className="comment-author" href={profileUrl(c.user_id)} onClick={spaLink(nav.openProfile, c.user_id)}>{c.author || 'Member'}</a>
    : <b className="comment-plain">{c.author || 'Member'}</b>

  const remove = async (c) => {
    try {
      await deleteComment(c.id)
      /* Xoá cả reply con đi kèm (cascade ở database, dọn ở đây cho khớp) —
         con số mới tự đi ra ngoài qua effect ở đầu tệp. */
      const removed = commentSubtreeIds(items, c.id)
      setItems(prev => removeCommentSubtree(prev, c.id))
      if (replyTo && removed.has(replyTo.id)) { setReplyTo(null); setBody('') }
      push({ tone: 'ok', title: t('comment.removed'), body: t('comment.removed') })
    } catch (err) {
      const msg = err?.code ? errMsg(t, err) : t('comment.failed')
      push({ tone: 'err', title: t('comment.failed'), body: msg })
    }
  }

  const row = (c, nested = false) => (
    <div className={`comment comment-card${nested ? ' comment-reply' : ''}`} key={c.id} data-comment-id={c.id}>
      <div className="comment-head">
        <CommentAvatar src={c.avatar} name={c.author} />
        <div className="comment-meta">
          {author(c)}
          {c.created_at && <time className="comment-time">{timeAgo(c.created_at, t)}</time>}
        </div>
        <div className="comment-actions">
          <button type="button" className="comment-reply-btn" onClick={() => { if (!user) { onLogin?.(); return } setReplyTo(c); setBody(`@${mentionHandle(c.author)} `) }}>
            {t('comment.reply')}
          </button>
          {(user?.isAdmin || user?.id === c.user_id) && (
            <button type="button" className="comment-delete" title={t('comment.remove')} aria-label={t('comment.remove')} onClick={() => remove(c)}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="comment-text">
        {formatCommentText(c.body)}
      </div>
    </div>
  )

  const toggle = () => { if (!open) setError(''); setOpen(v => !v) }
  const displayCount = open ? items.length : initialCount

  return (
    <div className={`comments${open ? ' open' : ''}`}>
      <button type="button" className="comments-toggle" onClick={toggle} aria-expanded={open}>
        <Icon name="info" size={14} /> {open ? t('comment.cancel') : t('comment.title')}{displayCount > 0 && <b>{displayCount}</b>}
      </button>
      {open && (
        <div className="comments-panel">
          {threads.length ? <div className="comments-list">{threads.map(({ root, replies }) => (
            <div className="comment-thread" key={root.id}>
              {row(root)}
              {!!replies.length && <div className="comment-replies-list">{replies.map(c => row(c, true))}</div>}
            </div>
          ))}</div> : <p className="comments-empty">{t('comment.empty')}</p>}
          <form className="comment-form" onSubmit={submit} data-parent-id={replyTo?.id || undefined}>
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
