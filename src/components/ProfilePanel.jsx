import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { updateProfile } from '../lib/db'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { loadImage, centerCrop, processAvatar, processAnimatedAvatar, checkFile, isAnimatedWebp } from '../lib/avatar'
import AvatarCropper from './AvatarCropper'

/* SỬA HỒ SƠ — NAY LÀ MỘT KHỐI CỦA TRANG "ABOUT ME", KHÔNG CÒN HỘP THOẠI.
   ---------------------------------------------------------------
   Vòng 12: "gộp phần chỉnh profile chung với my request và đổi tên mục đó
   thành About me". Trước đây mục Của tôi và việc sửa hồ sơ là HAI chỗ khác
   nhau: bấm ảnh đại diện ở chân sidebar thì mở một hộp thoại nổi, còn mục
   Của tôi chỉ liệt kê request. Người dùng phải nhớ hai đường, và hộp thoại
   che mất chính trang nói về mình.

   Nay toàn bộ việc "tôi là ai trên trang này" nằm ở đầu mục About me: ảnh đại
   diện, tên hiển thị, nút lưu — cùng một chỗ với số liệu và danh sách request
   của mình. Ảnh đại diện ở chân sidebar trỏ về đây thay vì mở hộp thoại.

   Ba trạng thái của khối: xem (chưa đổi gì) · đang sửa (nút Lưu mới bật) ·
   đang cắt ảnh (khung cắt hiện ngay trong khối, không nhảy lên lớp phủ). */
export default function ProfilePanel({ user, onSaved }) {
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

  /* Hồ sơ trong cơ sở dữ liệu là nguồn đúng: lưu xong (hoặc đồng bộ realtime
     trả về tên mới) thì các ô trong khối phải theo, không giữ bản gõ dở. */
  useEffect(() => {
    setName(user?.name || '')
    setAvatar(user?.avatar || null)
    setMsg(null)
    reset()
  }, [user?.name, user?.avatar, reset])

  useEffect(() => () => reset(), [reset])   // dọn URL blob khi rời trang

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMsg(null)
    try {
      checkFile(file)
      /* GIF và animated WebP đi thẳng vào bộ lưu trữ/data URL: canvas chỉ lấy frame đầu nên
         không được dùng cho ảnh động. JPG/PNG/WebP tĩnh vẫn qua cropper nén lại. */
      const isAnim = file.type === 'image/gif' || (file.type === 'image/webp' && await isAnimatedWebp(file))
      if (file.type === 'image/gif' || isAnim) {
        const { url, bytes } = await processAnimatedAvatar(file)
        reset()
        setAvatar(url)
        setMsg({ t: 'info', m: t('prof.gifReady', { kb: Math.max(1, Math.round(bytes / 1024)) }) })
        return
      }
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
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
    finally { setBusy(false) }
  }

  const initial = (name || '?').trim()[0]?.toUpperCase() || '?'
  const dirty = name.trim() !== (user?.name || '') || avatar !== (user?.avatar || null)
  const tooShort = name.trim().length < 2

  return (
    <section className="prof-card" aria-label={t('prof.title')}>
      <div className="prof-head">
        <h2 className="prof-h2">
          <Icon name="user" size={15} />
          {t('prof.title')}
        </h2>
        {/* Nút Lưu nằm NGAY TRONG hàng tiêu đề: nó chỉ sáng khi có gì để lưu,
            nên chỗ đứng của nó vừa là trạng thái vừa là hành động. */}
        <div className="prof-head-acts">
          {dirty && !editing && (
            <button type="button" className="lnk" disabled={busy}
              onClick={() => { setName(user?.name || ''); setAvatar(user?.avatar || null); setMsg(null) }}>
              {t('prof.cancel')}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary"
            disabled={busy || editing || !dirty || tooShort} onClick={save}>
            {busy ? t('prof.saving') : t('prof.save')}
          </button>
        </div>
      </div>

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
            </div>
            <input ref={fileRef} type="file" accept="image/*,.gif" hidden onChange={pick}
              aria-label={t('prof.choose')} />
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="prof-name">{t('prof.name')}</label>
            <input id="prof-name" value={name} maxLength={40}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && dirty && !busy && !tooShort) save() }} />
          </div>

          {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
        </>
      )}
    </section>
  )
}
