import Icon from './Icon'
import { Archive, CalendarCheck, CircleHelp, ShieldCheck } from 'lucide-react'
import { useI18n } from '../lib/i18n.jsx'
import { CHANNEL } from '../lib/youtube'
import { SUPPORT } from '../lib/payment'

const COMMUNITY_POST = 'https://youtube.com/post/UgkxtQ8f4b7DsN3DcyHtOaNo1ER345mtGMC3?si=O5A6YSgmHN_b06Eo'
const TIKTOK_URL = 'https://www.tiktok.com/@chaereve_ccl'
const CALENDAR_URL = 'https://calendar.online/dc49674927f79396e7e8'

function BrandIcon({ name }) {
  const paths = {
    youtube: <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />,
    telegram: <path d="M21.5 4.3 2.9 11.5c-.9.3-.9 1.6.1 1.9l4.6 1.4 1.8 5.4c.3.8 1.3 1 1.9.4l2.5-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3-14.6c.2-1-.7-1.8-1.8-1.4ZM9.4 14.2l8.4-5.3-6.7 6.5-.3 3.4-1.4-4.6Z" />,
    tiktok: <path transform="translate(1.8 1.8) scale(0.85)" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />,
    kofi: <path fillRule="evenodd" d="M3.4 4.6h14.2c2.8 0 4.6 1.7 4.6 4.4 0 2.7-1.8 4.4-4.6 4.4h-.8c-.5 3.5-2.9 6-6.9 6H9c-4.2 0-7-2.8-7-7.2V6c0-.8.6-1.4 1.4-1.4Zm13.9 2.1v4.6h.4c1.3 0 2.2-.9 2.2-2.3s-.9-2.3-2.2-2.3h-.4ZM9.5 15.6c-.2 0-.4-.1-.6-.2-1.9-1.2-3.3-2.6-3.3-4.2 0-1.3 1-2.3 2.2-2.3.7 0 1.3.4 1.7 1 .4-.6 1-1 1.7-1 1.2 0 2.2 1 2.2 2.3 0 1.6-1.4 3-3.3 4.2-.2.1-.4.2-.6.2Z" />,
  }

  return <svg className="foot-brand-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function FooterLink({ href, Glyph, children, external = false }) {
  return (
    <a className="foot-link" href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
      <Glyph size={16} strokeWidth={1.7} aria-hidden="true" />
      <span>{children}</span>
      {external && <Icon name="ext" size={13} className="foot-link-ext" />}
    </a>
  )
}

export default function SiteFooter() {
  const { t } = useI18n()

  return (
    <footer className="site-footer">
      <div className="foot-in">
        <div className="foot-brand">
          <span className="applogo lg-foot"><img src="/logo-128.png" alt="" width="32" height="32" /></span>
          <div>
            <div className="foot-name">Chaereve</div>
            <div className="foot-tag">{t('foot.tag')}</div>
          </div>
        </div>

        <div className="foot-layout">
          <nav className="foot-navigation" aria-label={t('foot.linksLabel')}>
            <section className="foot-section">
              <h2 className="foot-section-title">{t('foot.explore')}</h2>
              <div className="foot-link-list">
                <FooterLink href="/archive" Glyph={Archive}>{t('foot.archive')}</FooterLink>
                <FooterLink href={CALENDAR_URL} Glyph={CalendarCheck} external>{t('foot.calendar')}</FooterLink>
              </div>
            </section>
            <section className="foot-section">
              <h2 className="foot-section-title">{t('foot.help')}</h2>
              <div className="foot-link-list">
                <FooterLink href="/faq.html" Glyph={CircleHelp}>{t('foot.faq')}</FooterLink>
                <FooterLink href="/privacy.html" Glyph={ShieldCheck}>{t('foot.privacy')}</FooterLink>
              </div>
            </section>
          </nav>

          <section className="foot-section foot-contact-section">
            <h2 className="foot-section-title">{t('foot.contact')}</h2>
            <a className="foot-contact-link" href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer">
              <BrandIcon name="telegram" />
              <span className="foot-contact-copy"><b>{t('foot.telegram')}</b><small>@{SUPPORT.telegram} · {t('foot.supportShort')}</small></span>
              <Icon name="ext" size={14} className="foot-contact-arrow" />
            </a>
          </section>

          <section className="foot-section foot-social-section">
            <h2 className="foot-section-title">{t('foot.followSupport')}</h2>
            <div className="foot-socials">
              <a className="foot-social" href={CHANNEL.url} target="_blank" rel="noreferrer"><BrandIcon name="youtube" /><span>YouTube</span></a>
              <a className="foot-social" href={TIKTOK_URL} target="_blank" rel="noreferrer"><BrandIcon name="tiktok" /><span>TikTok</span></a>
              <a className="foot-social" href={SUPPORT.kofiUrl} target="_blank" rel="noreferrer"><BrandIcon name="kofi" /><span>Ko-fi</span></a>
            </div>
          </section>

          <section className="foot-section foot-community-section">
            <h2 className="foot-section-title">{t('foot.community')}</h2>
            <a className="foot-community-link" href={COMMUNITY_POST} target="_blank" rel="noreferrer">
              <BrandIcon name="telegram" />
              <span className="foot-community-copy"><b>{t('foot.communityTitle')}</b><small>{t('foot.communityHint')}</small></span>
              <Icon name="ext" size={14} className="foot-community-arrow" />
            </a>
          </section>
        </div>

        <div className="foot-copy">{t('foot.copy', { y: new Date().getFullYear() })}</div>
      </div>
    </footer>
  )
}
