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

/* Các nhãn hiệu bên ngoài: Lucide cố ý không vẽ logo thương hiệu, mà logo
   thì phải đúng logo — nên các đường dẫn này ở lại đây, ngay cạnh chỗ dùng.
   Mọi icon chức năng khác đi qua component Icon (src/components/Icon.jsx) —
   viết tên không kèm dấu ngoặc nhọn vì propContract.test.js quét cả văn bản
   nguồn và sẽ tưởng đây là một chỗ dựng component thiếu prop. */
const BRAND = {
  yt: <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" fill="currentColor" />,
  tg: <path d="M21.5 4.3 2.9 11.5c-.9.3-.9 1.6.1 1.9l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3-14.6c.2-1-.7-1.8-1.8-1.4ZM9.4 14.2l8.4-5.3-6.7 6.5-.3 3.4-1.4-4.6Z" fill="currentColor" />,
  kofi: <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" fill="currentColor" />,
}
const BrandIco = ({ d, size = 16 }) => (
  <svg className="sico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>
)

export default function Sidebar({
  sections, routes, section, onNavigate,
  user, counts,
  open, onClose, collapsed, onToggle,
  onNewRequest, onAbout, onSignOut, onSignIn,
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

  /* `user` LUÔN là một object: App truyền `viewer` (người xem) để mọi chỗ khác
     không phải kiểm tra null. Người chưa đăng nhập là người KHÔNG CÓ ID — hỏi
     `user` là truthy thì khách bị đối xử như người đã đăng nhập (chân sidebar
     dựng nút Sign out không có gì để đăng xuất). */
  const signedIn = !!user?.id
  const initials = (user?.name || '?').trim()[0].toUpperCase()
  const NAV_ICON = { board: 'board', login: 'calendar', mystery: 'gift', spin: 'spin', ranking: 'cup', mine: 'user', admin: 'shield' }
  const adminTotal = counts.pending + counts.orders + Number(counts.expired || 0)
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
          {/* NÚT GỬI REQUEST — trước đây là một viên màu đặc kín khối, chữ
              trắng, đứng ngay dưới logo: mắt đọc nó thành "logo thứ hai" chứ
              không phải một hành động. Nay nó nói đúng việc: một ô nền chìm
              cùng cỡ với các mục điều hướng, icon nằm trong ô vuông nhỏ có
              màu nhấn (đúng dấu hiệu "viết" của cả trang), chữ đứng cạnh, và
              một dải nhấn mảnh ở mép trái nối nó với nhóm Điều hướng ngay
              dưới. Màu nhấn chỉ còn ở icon + dải mép, không phủ kín một khối
              lớn — đúng tỉ lệ màu đã chốt. */}
          <button type="button" className="side-cta" onClick={fire(onNewRequest)} title={tip(t('btn.newRequest'))}>
            <span className="cta-ico" aria-hidden="true"><Icon name="compose" size={14} /></span>
            <span className="side-tx">{t('btn.newRequest')}</span>
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
              style={{ '--i': sections.length }} title={tip('YouTube')}>
              <BrandIco d={BRAND.yt} /><span className="side-tx">{t('side.youtube', { h: CHANNEL.handle })}</span>
              <Icon name="ext" size={13} className="side-ext" />
            </a>
            <a className="side-item ext" href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length + 1 }} title={tip('Telegram')}>
              <BrandIco d={BRAND.tg} /><span className="side-tx">Telegram</span>
              <Icon name="ext" size={13} className="side-ext" />
            </a>
            <a className="side-item ext" href={SUPPORT.kofiUrl} target="_blank" rel="noreferrer"
              style={{ '--i': sections.length + 2 }} title={tip('Ko-fi')}>
              <BrandIco d={BRAND.kofi} /><span className="side-tx">Ko-fi</span>
              <Icon name="ext" size={13} className="side-ext" />
            </a>
            {/* Khối "Order queue" đã bị GỠ khỏi sidebar (vòng 12): hàng đợi đơn
                là một tab của trang quản trị, và nó đã có lối vào đúng chỗ —
                ô "Orders" trên dải số liệu, kèm con số và huy hiệu chờ xử lý.
                Một mục thứ hai trong sidebar vừa trùng đường, vừa chiếm chỗ
                của ba link ngoài (YouTube/Telegram/Ko-fi) là nhóm kết nối chính
                ở nhóm này. */}
          </div>
        </div>

        <div className="side-foot">
          {/* KHÁCH: chân sidebar trước đây vẫn dựng ảnh đại diện rỗng ("?") và
              một nút "Sign out" không có gì để đăng xuất — hai thứ vô nghĩa
              chiếm đúng chỗ mà lối vào tài khoản đáng ra phải nằm. Nay khách
              thấy MỘT nút đăng nhập ở đó; người đã đăng nhập vẫn như cũ.
              Ảnh đại diện KHÔNG mở hộp thoại: nó đưa về mục About me, nơi có
              cả hồ sơ lẫn request của mình. Một việc, một đường. */}
          {signedIn ? (
            <>
              <button type="button" className="side-user" onClick={fire(onAbout)} title={collapsed ? user.name : t('prof.title')}>
                {user.avatar
                  ? <img className={`avatar lg${user.isAdmin ? ' admin' : ''}`} src={user.avatar} alt="" referrerPolicy="no-referrer" />
                  : <span className={`avatar lg${user.isAdmin ? ' admin' : ''}`}>{initials}</span>}
                <span className="side-user-tx side-tx">
                  <b>{user.name}</b>
                  <small>{t('nav.mine')}</small>
                </span>
              </button>
              <button type="button" className="side-out" onClick={fire(onSignOut)} title={tip(t('menu.signOut'))}>
                <Icon name="out" size={15} className="sico" /><span className="side-tx">{t('menu.signOut')}</span>
              </button>
            </>
          ) : (
            <button type="button" className="side-cta side-signin" onClick={fire(onSignIn)}
              title={tip(t('gate.signIn'))} aria-label={t('gate.signIn')}>
              <span className="cta-ico" aria-hidden="true"><Icon name="user" size={14} /></span>
              <span className="side-tx">{t('gate.signIn')}</span>
            </button>
          )}
          <div className="side-copy side-tx">© {new Date().getFullYear()} CHAEREVE</div>
        </div>
      </aside>
    </>
  )
}
