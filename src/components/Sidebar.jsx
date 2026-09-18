import { useEffect, useLayoutEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import SoundToggle from './SoundToggle'
import { CHANNEL } from '../lib/youtube'
import { SUPPORT } from '../lib/payment'

/* =========================================================
   SIDEBAR — toàn bộ tính năng nằm ở đây
   ---------------------------------------------------------
   Bản rộng: cột cố định bên trái, nội dung trượt bên phải.
   Có nút ‹ ở mép để THU GỌN thành dải icon 64px (nhớ trong
   localStorage, App giữ state). Bản hẹp (<900px): cùng khối
   đó trượt vào như ngăn kéo, mở bằng nút ☰ nổi.

   Mọi icon xếp trên một cột (mép trái cách 24px) ở cả hai
   trạng thái, nên lúc thu/mở chỉ có chữ mờ đi và khung hẹp
   lại — icon đứng yên, không giật.
   ========================================================= */

const I = {
  spin: <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M12 4v6m0 4v6M4 12h6m4 0h6M6.4 6.4l4.2 4.2m2.8 2.8 4.2 4.2m0-11.2-4.2 4.2m-2.8 2.8-4.2 4.2M10 2h4l-2 3Z" /></g>,
  board: <path d="M4 5h16v3H4V5Zm0 5.5h16v3H4v-3ZM4 16h10v3H4v-3Z" fill="currentColor" />,
  cup: <path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.7V7Zm10 0v2.7A2 2 0 0 0 18 8V7h-1Z" fill="currentColor" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C19 16 16 14 12 14Z" fill="currentColor" />,
  yt: <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" fill="currentColor" />,
  tg: <path d="M21.5 4.3 2.9 11.5c-.9.3-.9 1.6.1 1.9l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3-14.6c.2-1-.7-1.8-1.8-1.4ZM9.4 14.2l8.4-5.3-6.7 6.5-.3 3.4-1.4-4.6Z" fill="currentColor" />,
  shield: <path d="M12 2.5 4.5 5.4v5.9c0 4.4 3 8.3 7.5 10.2 4.5-1.9 7.5-5.8 7.5-10.2V5.4L12 2.5Zm0 5.2 1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5L12 7.7Z" fill="currentColor" />,
  out: <path d="M10 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5v-2H6V5h4V3Zm4.3 4.3-1.4 1.4L15.5 11H8v2h7.5l-2.6 2.6 1.4 1.4L19.4 12l-5.1-4.7Z" fill="currentColor" />,
  edit: <path d="M4 17.2V20h2.8l8.6-8.6-2.8-2.8L4 17.2Zm14.7-8.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.4 1.4 2.8 2.8 1.4-1.4Z" fill="currentColor" />,
  chev: <path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
  note: <path d="M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM9 18.5V6l11-2.5V16M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />,
}

const Ico = ({ d, size = 16 }) => (
  <svg className="sico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
)

export default function Sidebar({
  sections, routes, section, onNavigate,
  user, counts,
  open, onClose, collapsed, onToggle,
  onNewRequest, onProfile, onAdmin, onSignOut,
}) {
  const { t } = useI18n()
  const closeRef = useRef(null)
  const navRef = useRef(null)
  const indRef = useRef(null)

  /* bản hẹp: Esc đóng ngăn kéo + khoá cuộn nền */
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  /* Ô sáng của mục đang đứng là MỘT phần tử riêng, đo vị trí mục .on rồi
     trượt tới đó — nên đổi mục là thấy nó chạy chứ không nhảy. Lần đo đầu
     đặt thẳng (chưa có class .live) để không trượt từ đỉnh xuống lúc mở trang. */
  useLayoutEffect(() => {
    const nav = navRef.current, ind = indRef.current
    if (!nav || !ind) return
    const el = nav.querySelector('.side-item.on')
    if (!el) { ind.style.opacity = '0'; return }
    ind.style.opacity = '1'
    ind.style.transform = `translateY(${el.offsetTop}px)`
    ind.style.height = `${el.offsetHeight}px`
    const id = requestAnimationFrame(() => ind.classList.add('live'))
    return () => cancelAnimationFrame(id)
  }, [section, collapsed, sections])

  const initials = (user?.name || '?').trim()[0].toUpperCase()
  const NAV_ICO = { board: I.board, spin: I.spin, ranking: I.cup, mine: I.user }
  const adminTotal = counts.pending + counts.orders
  const toggleLabel = collapsed ? t('side.expand') : t('side.collapse')

  const go = (k) => { onNavigate(k); onClose() }
  const fire = (fn) => () => { fn(); onClose() }

  /* chỉ khi thu gọn mới cần tooltip, lúc mở rộng chữ đã hiện sẵn */
  const tip = (s) => (collapsed ? s : undefined)

  return (
    <>
      <div className={`side-scrim${open ? ' on' : ''}`} onClick={onClose} />

      <aside className={`side${open ? ' open' : ''}${collapsed ? ' min' : ''}`} aria-label={t('side.label')}>
        <button type="button" className="side-toggle" onClick={onToggle}
          aria-expanded={!collapsed} aria-label={toggleLabel} title={toggleLabel}>
          <Ico d={I.chev} size={14} />
        </button>

        <div className="side-brand">
          <span className="applogo lg-nav"><img src="/logo-128.png" alt="chaereve" width="30" height="30" /></span>
          <div className="side-brand-tx side-tx">
            <div className="side-brand-name">Chaereve</div>
            <div className="side-brand-sub">{t('side.tagline')}</div>
          </div>
          <button className="side-x only-narrow" ref={closeRef} onClick={onClose} aria-label={t('menu.close')}>×</button>
        </div>

        <div className="side-scroll">
          <button type="button" className="side-cta" onClick={fire(onNewRequest)} title={tip(t('btn.newRequest'))}>
            <Ico d={I.edit} size={15} /><span className="side-tx">{t('btn.newRequest')}</span>
          </button>

          <div className="side-group">
            <div className="side-label"><span>{t('side.nav')}</span></div>
            <nav className="side-nav" ref={navRef}>
              <span className="side-ind" ref={indRef} aria-hidden="true" />
              {sections.map((k, i) => (
                <a key={k} href={routes[k]} style={{ '--i': i }}
                  className={`side-item${section === k ? ' on' : ''}`}
                  aria-current={section === k ? 'page' : undefined}
                  title={tip(t(`nav.${k}`))}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.button === 1) return
                    e.preventDefault(); go(k)
                  }}>
                  <Ico d={NAV_ICO[k]} />
                  <span className="side-tx">{t(`nav.${k}`)}</span>
                  {k === 'mine' && counts.mine > 0 && <span className="side-n">{counts.mine}</span>}
                </a>
              ))}
            </nav>
          </div>

          <div className="side-group">
            <div className="side-label"><span>{t('menu.settings')}</span></div>
            <div className="side-row">
              <Ico d={I.note} />
              <span className="side-tx">{t('menu.sound')}</span>
              <SoundToggle />
            </div>
          </div>

          <div className="side-group">
            <div className="side-label"><span>{t('side.connect')}</span></div>
            <a className="side-item ext" href={CHANNEL.url} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length }} title={tip(t('side.youtube', { h: CHANNEL.handle }))}>
              <Ico d={I.yt} /><span className="side-tx">{t('side.youtube', { h: CHANNEL.handle })}</span>
              <span className="side-ext" aria-hidden="true">↗</span>
            </a>
            <a className="side-item ext" href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length + 1 }} title={tip('Telegram')}>
              <Ico d={I.tg} /><span className="side-tx">Telegram</span>
              <span className="side-ext" aria-hidden="true">↗</span>
            </a>
            {user?.isAdmin && (
              <button type="button" className="side-item" onClick={fire(() => onAdmin('pending'))}
                style={{ '--i': sections.length + 2 }} title={tip(t('menu.admin'))}>
                <Ico d={I.shield} /><span className="side-tx">{t('menu.admin')}</span>
                {adminTotal > 0 && <span className="dotbadge">{adminTotal}</span>}
              </button>
            )}
          </div>
        </div>

        <div className="side-foot">
          <button type="button" className="side-user" onClick={fire(onProfile)} title={collapsed ? user?.name : t('btn.profile')}>
            {user?.avatar
              ? <img className={`avatar lg${user.isAdmin ? ' admin' : ''}`} src={user.avatar} alt="" referrerPolicy="no-referrer" />
              : <span className={`avatar lg${user?.isAdmin ? ' admin' : ''}`}>{initials}</span>}
            <span className="side-user-tx side-tx">
              <b>{user?.name}</b>
              <small>{t('btn.profile')}</small>
            </span>
          </button>
          <button type="button" className="side-out" onClick={fire(onSignOut)} title={tip(t('menu.signOut'))}>
            <Ico d={I.out} size={15} /><span className="side-tx">{t('menu.signOut')}</span>
          </button>
          <div className="side-copy side-tx">© {new Date().getFullYear()} CHAEREVE</div>
        </div>
      </aside>
    </>
  )
}
