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
    tiktok: <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.24V2h-3.52v13.67a2.9 2.9 0 0 1-2.9 2.9 2.9 2.9 0 1 1 2.9-2.9c0-.16-.01-.32-.04-.48v-3.58a6.43 6.43 0 1 0 3.56 5.76V9.41a8.3 8.3 0 0 0 4.86 1.57V7.46a4.83 4.83 0 0 1-1.09-.77Z" />,
    kofi: <path d="M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298" />,
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
