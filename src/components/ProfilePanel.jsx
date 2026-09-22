import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { updateProfile } from '../lib/db'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { loadImage, centerCrop, processAvatar, processAnimatedAvatar, checkFile, isAnimatedWebp, usesCloudinary, ANIMATED_AVATAR_MAX_BYTES, ANIMATED_AVATAR_MAX_KB } from '../lib/avatar'
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
  /* File ảnh ĐỘNG vừa chọn: giữ lại để còn mời người dùng lấy khung đầu tiên
     khi ảnh vượt trần của database (ảnh tĩnh vẫn lưu được ngay). Xem
     `useStillFrame` bên dưới. */
  const animRef = useRef(null)
  const [tooBigKb, setTooBigKb] = useState(null)
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
    setTooBigKb(null)
    reset()
  }, [user?.name, user?.avatar, reset])

  useEffect(() => () => reset(), [reset])   // dọn URL blob khi rời trang

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMsg(null)
    setTooBigKb(null)
    animRef.current = null
    try {
      checkFile(file)
      /* GIF và animated WebP đi thẳng vào bộ lưu trữ/data URL: canvas chỉ lấy frame đầu nên
         không được dùng cho ảnh động. JPG/PNG/WebP tĩnh vẫn qua cropper nén lại. */
      const isAnim = file.type === 'image/gif' || (file.type === 'image/webp' && await isAnimatedWebp(file))
      if (file.type === 'image/gif' || isAnim) {
        animRef.current = file
        const kb = Math.max(1, Math.round(file.size / 1024))
        /* Chưa cấu hình Cloudinary thì ảnh động phải nằm dưới trần của database
           (~146 KB). Kiểm NGAY TẠI ĐÂY để câu trả lời đến trước khi người dùng
           bấm Save — bản trước báo "GIF sẵn sàng" rồi Save mới lỗi. */
        if (!usesCloudinary && file.size > ANIMATED_AVATAR_MAX_BYTES) {
          setTooBigKb(kb)
          setMsg({ t: 'err', m: t('prof.gifTooBig', { kb, max: ANIMATED_AVATAR_MAX_KB }) })
          return
        }
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

  /* LỐI RA CHO ẢNH ĐỘNG QUÁ LỚN: lấy khung đầu tiên (canvas chỉ vẽ được khung
     đầu — đúng thứ mà đường ảnh động cố tránh) rồi cho đi qua đúng khung cắt
     của ảnh tĩnh, nên ảnh vẫn vào hồ sơ được thay vì bế tắc. */
  const useStillFrame = async () => {
    const file = animRef.current
    if (!file) return
    setMsg(null)
    try {
      const { img, url } = await loadImage(file)
      cropRef.current = centerCrop(img)
      setTooBigKb(null)
      reset()
      setEditing({ img, url })
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
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
    } catch (e) {
      /* Database là nơi giữ trần thật (200.000 ký tự) — nó có thể từ chối một
         ảnh mà phía client tưởng là vừa, ví dụ khi bản deploy chưa theo kịp.
         Gặp đúng mã đó thì nói ra con số + việc cần làm, và mở luôn lối lấy
         khung đầu tiên nếu file gốc còn trong tay. */
      if (e?.message === 'err.avatarBig' && typeof avatar === 'string' && avatar.startsWith('data:')) {
        const kb = Math.max(1, Math.round(avatar.length * 3 / 4 / 1024))
        if (animRef.current) setTooBigKb(kb)
        setMsg({ t: 'err', m: t('prof.gifTooBig', { kb, max: ANIMATED_AVATAR_MAX_KB }) })
      } else setMsg({ t: 'err', m: errMsg(t, e) })
    }
    finally { setBusy(false) }
  }

  const initial = (name || '?').trim()[0]?.toUpperCase() || '?'
  const dirty = name.trim() !== (user?.name || '') || avatar !== (user?.avatar || null)
  const tooShort = name.trim().length < 2

  /* Câu thông báo + lối ra khi ảnh động quá lớn: hai thứ luôn đi cùng nhau, ở
     cả hai nhánh của khối (đang cắt ảnh / đang xem), nên gom một chỗ. */
  const noteBlock = (
    <>
      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
      {tooBigKb !== null && (
        <button type="button" className="btn btn-sm prof-still" disabled={busy} onClick={useStillFrame}>
          <Icon name="preview" size={13} />{t('prof.gifStill')}
        </button>
      )}
    </>
  )

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
          {noteBlock}
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
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={pick}
              aria-label={t('prof.choose')} />
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="prof-name">{t('prof.name')}</label>
            <input id="prof-name" value={name} maxLength={40}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && dirty && !busy && !tooShort) save() }} />
          </div>

          {noteBlock}
        </>
      )}
    </section>
  )
}
