import { useEffect, useRef, useState } from 'react'
import GoogleIcon from './GoogleIcon'
import Icon from './Icon'
import { signInGoogle, FREE_VOTES_PER_DAY, MAX_REQUESTS_PER_HOUR } from '../lib/db'
import { TURNSTILE_SITE_KEY, loadTurnstile } from '../lib/turnstile'
import { useI18n, errMsg } from '../lib/i18n.jsx'

/* =========================================================
   MÀN ĐĂNG NHẬP — MỘT LỚP PHỦ THẬT
   ---------------------------------------------------------
   LỖI ĐÃ GẶP THẬT (chủ dự án báo): "bấm vào profile hay gì cũng
   không hiện màn hình đăng nhập".

   Khối này từng nằm TRONG LUỒNG VĂN BẢN: `.gate { min-height:100% }`,
   không `position`, không lớp phủ, dựng ngay trước `.shell` trong
   `#root`. Nghĩa là khi người dùng bấm Vote ở giữa bảng (đã cuộn
   xuống vài nghìn pixel), thẻ đăng nhập được chèn vào ĐẦU tài liệu —
   một màn hình cao bằng cả khung nhìn, đẩy toàn bộ nội dung xuống —
   nên người vừa bấm không nhìn thấy gì ngoài việc trang "nhảy" một
   cái. Nút nào gọi `setAuthPrompt(true)` cũng chết cùng một kiểu.

   Nay nó là một modal thật, cùng khuôn với `VideoPreviewModal`:
     · `position: fixed` phủ kín khung nhìn + nền tối mờ (`.gate-scrim`);
     · Esc, bấm ra ngoài, hoặc nút X đều đóng được — người dùng phải có
       đường thoát khỏi thứ mình không gọi ra;
     · khoá cuộn nền, và tiêu điểm rơi vào nút Google khi vừa mở;
     · `role="dialog"` + `aria-modal` + tên đọc được.
   ========================================================= */

export default function LoginGate({ onDemoLogin, onClose }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  /* Token Turnstile dung 1 lan, het han sau vai phut — nut Google chi sang
     khi da co token hop le (neu da cau hinh site key). */
  const [capToken, setCapToken] = useState(null)
  const [capReady, setCapReady] = useState(false)
  const capBox = useRef(null)
  const capId = useRef(null)
  const goRef = useRef(null)

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let dead = false
    loadTurnstile().then((ts) => {
      if (dead || !capBox.current || !ts) return
      try {
        capId.current = ts.render(capBox.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (tok) => setCapToken(tok),
          'expired-callback': () => setCapToken(null),
          'error-callback': () => setCapToken(null),
        })
        setCapReady(true)
      } catch { setCapReady(false) } // mang chan Cloudflare: cho dang nhap thuong
    }).catch(() => setCapReady(false))
    return () => {
      dead = true
      try { if (capId.current != null) window.turnstile?.remove(capId.current) } catch { /* unmount */ }
    }
  }, [])

  /* Esc để đóng + khoá cuộn nền, y hệt các modal khác của app. Chỉ gắn khi nơi
     gọi có đưa `onClose`: cửa sổ này không được là đường duy nhất ra khỏi
     trang, nhưng nó cũng không được tự nhận quyền đóng khi không ai cho. */
  useEffect(() => {
    if (!onClose) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  /* Mở ra là con trỏ đứng sẵn ở việc duy nhất của cửa sổ này. */
  useEffect(() => { goRef.current?.focus?.() }, [])

  const needCap = !!TURNSTILE_SITE_KEY && capReady

  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const u = await signInGoogle(needCap ? capToken : null)
      if (u) onDemoLogin(u)
    } catch (e) { setErr(errMsg(t, e)); setBusy(false) }
    finally {
      // token da dung (hoac hong) thi reset de lan bam sau lay token moi
      try { if (capId.current != null) window.turnstile?.reset(capId.current) } catch { /* unmount */ }
      setCapToken(null)
    }
  }

  const close = (e) => { if (e.target === e.currentTarget) onClose?.() }

  return (
    <div className="gate-scrim" role="presentation" onMouseDown={close}>
      <div className="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">
        {onClose && (
          <button type="button" className="gate-x" onClick={onClose} aria-label={t('gate.close')} title={t('gate.close')}>
            <Icon name="close" size={15} />
          </button>
        )}
        <span className="applogo lg-gate"><img src="/logo-192.png" alt="chaereve" width="62" height="62" /></span>
        <h1 id="gate-title">Chaereve</h1>
        <p>{t('gate.sub')}</p>

        {TURNSTILE_SITE_KEY && <div ref={capBox} className="capwrap" />}
        <button ref={goRef} type="button" className="btn-google" onClick={go} disabled={busy || (needCap && !capToken)}>
          <GoogleIcon />
          {busy ? t('gate.redirect') : t('gate.google')}
        </button>

        {err && <div className="msg err">{err}</div>}

        <div className="gate-perks">
          <span className="perk">{t('gate.perk1', { n: FREE_VOTES_PER_DAY })}</span>
          <span className="perk">{t('gate.perk2', { n: MAX_REQUESTS_PER_HOUR })}</span>
          <span className="perk">{t('gate.perk3')}</span>
        </div>
      </div>

      <div className="gate-credit">
        {t('foot.copy', { y: new Date().getFullYear() })}
      </div>
    </div>
  )
}
