import { useEffect, useRef, useState } from 'react'
import GoogleIcon from './GoogleIcon'
import { signInGoogle, FREE_VOTES_PER_DAY, MAX_REQUESTS_PER_HOUR } from '../lib/db'
import { TURNSTILE_SITE_KEY, loadTurnstile } from '../lib/turnstile'
import { useI18n, errMsg } from '../lib/i18n.jsx'

export default function LoginGate({ onDemoLogin }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  /* Token Turnstile dung 1 lan, het han sau vai phut — nut Google chi sang
     khi da co token hop le (neu da cau hinh site key). */
  const [capToken, setCapToken] = useState(null)
  const [capReady, setCapReady] = useState(false)
  const capBox = useRef(null)
  const capId = useRef(null)

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
      try { capId.current != null && window.turnstile?.remove(capId.current) } catch { /* unmount */ }
    }
  }, [])

  const needCap = !!TURNSTILE_SITE_KEY && capReady

  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const u = await signInGoogle(needCap ? capToken : null)
      if (u) onDemoLogin(u)
    } catch (e) { setErr(errMsg(t, e)); setBusy(false) }
    finally {
      // token da dung (hoac hong) thi reset de lan bam sau lay token moi
      try { capId.current != null && window.turnstile?.reset(capId.current) } catch { /* unmount */ }
      setCapToken(null)
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <span className="applogo lg-gate"><img src="/logo-192.png" alt="chaereve" width="62" height="62" /></span>
        <h1>Chaereve</h1>
        <p>{t('gate.sub')}</p>

        {TURNSTILE_SITE_KEY && <div ref={capBox} className="capwrap" />}
        <button className="btn-google" onClick={go} disabled={busy || (needCap && !capToken)}>
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
