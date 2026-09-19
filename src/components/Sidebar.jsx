import { useEffect, useLayoutEffect, useRef } from 'react'
import Icon from './Icon'
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

/* Hai nhãn hiệu bên ngoài: Lucide cố ý không vẽ logo thương hiệu, mà logo
   thì phải đúng logo — nên hai đường dẫn này ở lại đây, ngay cạnh chỗ dùng.
   Mọi icon chức năng khác đi qua component Icon (src/components/Icon.jsx) —
   viết tên không kèm dấu ngoặc nhọn vì propContract.test.js quét cả văn bản
   nguồn và sẽ tưởng đây là một chỗ dựng component thiếu prop. */
const BRAND = {
  yt: <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" fill="currentColor" />,
  tg: <path d="M21.5 4.3 2.9 11.5c-.9.3-.9 1.6.1 1.9l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3-14.6c.2-1-.7-1.8-1.8-1.4ZM9.4 14.2l8.4-5.3-6.7 6.5-.3 3.4-1.4-4.6Z" fill="currentColor" />,
}
const BrandIco = ({ d, size = 16 }) => (
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
  const NAV_ICON = { board: 'board', spin: 'spin', ranking: 'cup', mine: 'user', admin: 'shield' }
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
          <Icon name="prev" size={14} className="sico" />
        </button>

        <div className="side-brand">
          <span className="applogo lg-nav"><img src="/logo-128.png" alt="chaereve" width="30" height="30" /></span>
          <div className="side-brand-tx side-tx">
            <div className="side-brand-name">Chaereve</div>
            <div className="side-brand-sub">{t('side.tagline')}</div>
          </div>
          <button className="side-x only-narrow" ref={closeRef} onClick={onClose} aria-label={t('menu.close')}><Icon name="close" size={15} /></button>
        </div>

        <div className="side-scroll">
          <button type="button" className="side-cta" onClick={fire(onNewRequest)} title={tip(t('btn.newRequest'))}>
            <Icon name="edit" size={15} className="sico" /><span className="side-tx">{t('btn.newRequest')}</span>
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
                  <Icon name={NAV_ICON[k]} className="sico" />
                  <span className="side-tx">{t(`nav.${k}`)}</span>
                  {k === 'mine' && counts.mine > 0 && <span className="side-n">{counts.mine}</span>}
                  {/* Bảng quản trị: huy hiệu là số VIỆC ĐANG CHỜ (bài chờ duyệt +
                      đơn chờ xác nhận) — con số duy nhất khiến admin phải mở
                      mục này ngay, nên nó đứng cạnh tên mục. */}
                  {k === 'admin' && adminTotal > 0 && <span className="dotbadge">{adminTotal}</span>}
                </a>
              ))}
            </nav>
          </div>

          <div className="side-group">
            <div className="side-label"><span>{t('menu.settings')}</span></div>
            <div className="side-row">
              <Icon name="note" className="sico" />
              <span className="side-tx">{t('menu.sound')}</span>
              <SoundToggle />
            </div>
          </div>

          <div className="side-group">
            <div className="side-label"><span>{t('side.connect')}</span></div>
            <a className="side-item ext" href={CHANNEL.url} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length }} title={tip(t('side.youtube', { h: CHANNEL.handle }))}>
              <BrandIco d={BRAND.yt} /><span className="side-tx">{t('side.youtube', { h: CHANNEL.handle })}</span>
              <Icon name="ext" size={13} className="side-ext" />
            </a>
            <a className="side-item ext" href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length + 1 }} title={tip('Telegram')}>
              <BrandIco d={BRAND.tg} /><span className="side-tx">Telegram</span>
              <Icon name="ext" size={13} className="side-ext" />
            </a>
            {user?.isAdmin && (
              <button type="button" className="side-item" onClick={fire(() => onAdmin('orders'))}
                style={{ '--i': sections.length + 2 }} title={tip(t('menu.adminOrders'))}>
                <Icon name="note" className="sico" /><span className="side-tx">{t('menu.adminOrders')}</span>
                {counts.orders > 0 && <span className="dotbadge">{counts.orders}</span>}
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
            <Icon name="out" size={15} className="sico" /><span className="side-tx">{t('menu.signOut')}</span>
          </button>
          <div className="side-copy side-tx">© {new Date().getFullYear()} CHAEREVE</div>
        </div>
      </aside>
    </>
  )
}
