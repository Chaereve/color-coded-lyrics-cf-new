import { useCallback, useEffect, useRef, useState } from 'react'
import { updateProfile } from '../lib/db'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { loadImage, centerCrop, processAvatar, checkFile, MAX_FILE_MB } from '../lib/avatar'
import AvatarCropper from './AvatarCropper'
import { useModalExit } from '../lib/useModalExit'

export default function ProfileModal({ open, user, onClose, onSaved }) {
  const { t } = useI18n()
  const fileRef = useRef(null)
  const [name, setName] = useState(user?.name || '')
  const [avatar, setAvatar] = useState(user?.avatar || null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  /* đang chỉnh khung: giữ ảnh gốc + vùng cắt hiện tại */
  const [editing, setEditing] = useState(null)   // { img, url }
  const cropRef = useRef(null)
  const onCropChange = useCallback((c) => { cropRef.current = c }, [])

  const reset = useCallback(() => {
    setEditing(e => { if (e) URL.revokeObjectURL(e.url); return null })
    cropRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return
    setName(user?.name || '')
    setAvatar(user?.avatar || null)
    setMsg(null)
    reset()
  }, [open, user, reset])

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && (editing ? reset() : onClose())
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, editing, reset])

  useEffect(() => () => reset(), [reset])   // dọn URL blob khi rời trang

  const { mounted, closing } = useModalExit(open)
  if (!mounted) return null
  const out = closing ? ' out' : ''

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMsg(null)
    try {
      checkFile(file)
      const { img, url } = await loadImage(file)
      cropRef.current = centerCrop(img)
      reset()
      setEditing({ img, url })
    } catch (e2) { setMsg({ t: 'err', m: errMsg(t, e2) }) }
  }

  const applyCrop = async () => {
    if (!editing || !cropRef.current) return
    setBusy(true); setMsg(null)
    try {
      const { url, bytes } = await processAvatar(editing.img, cropRef.current)
      setAvatar(url)
      reset()
      setMsg({ t: 'info', m: t('prof.resized', { kb: Math.max(1, Math.round(bytes / 1024)) }) })
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
    finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await updateProfile({ name, avatar })
      await onSaved()
      onClose()
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
    finally { setBusy(false) }
  }

  const initial = (name || '?').trim()[0]?.toUpperCase() || '?'
  const dirty = name.trim() !== (user?.name || '') || avatar !== (user?.avatar || null)

  return (
    <div className={`overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && !editing && onClose()}>
      <div className={`modal narrow${out}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-tabs">
            <span className="mtab on">{editing ? t('crop.title') : t('prof.title')}</span>
          </div>
          <button className="x" onClick={editing ? reset : onClose} aria-label={t('btn.close')}>×</button>
        </div>

        <div className="modal-body">
          {editing ? (
            <>
              <AvatarCropper img={editing.img} onChange={onCropChange} />
              {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
              <div className="prof-acts">
                <button className="btn" onClick={reset} disabled={busy}>{t('prof.cancel')}</button>
                <button className="btn btn-primary" onClick={applyCrop} disabled={busy}>
                  {busy ? t('prof.saving') : t('crop.apply')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="prof-av">
                {avatar
                  ? <img className="prof-av-img" src={avatar} alt="" referrerPolicy="no-referrer" />
                  : <div className="prof-av-img prof-av-ph">{initial}</div>}
                <div className="prof-av-acts">
                  <button type="button" className="btn btn-sm" disabled={busy}
                    onClick={() => fileRef.current?.click()}>
                    {t('prof.choose')}
                  </button>
                  {avatar && (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setAvatar(null)}>
                      {t('prof.reset')}
                    </button>
                  )}
                  <div className="prof-av-note">{t('prof.maxSize', { mb: MAX_FILE_MB })}</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
              </div>

              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="prof-name">{t('prof.name')}</label>
                <input id="prof-name" value={name} maxLength={40}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && dirty && !busy) save() }} />
              </div>

              {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

              <div className="prof-acts">
                <button className="btn" onClick={onClose} disabled={busy}>{t('prof.cancel')}</button>
                <button className="btn btn-primary" onClick={save}
                  disabled={busy || !dirty || name.trim().length < 2}>
                  {busy ? t('prof.saving') : t('prof.save')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
