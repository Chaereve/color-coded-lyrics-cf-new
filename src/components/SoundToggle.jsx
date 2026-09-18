import { useState } from 'react'
import { isEnabled, setEnabled, getVolume, setVolume, sfx } from '../lib/sfx'
import { useI18n } from '../lib/i18n.jsx'

export default function SoundToggle() {
  const { t } = useI18n()
  const [on, setOn] = useState(isEnabled)
  const [vol, setVol] = useState(getVolume)

  const toggle = () => {
    const next = !on
    if (!next) sfx.off()        // phát tiếng "tắt" trước khi tắt hẳn
    setEnabled(next)
    setOn(next)
    if (next) sfx.toggle()
  }

  const label = on ? t('sfx.on') : t('sfx.off')

  return (
    <span className="sfxwrap">
      <button type="button" className="sfxbtn" onClick={toggle} title={label} aria-label={label} aria-pressed={on}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7.2 2.6 4.1 5.1H2.2c-.4 0-.7.3-.7.7v4.4c0 .4.3.7.7.7h1.9l3.1 2.5c.4.3 1 0 1-.5V3.1c0-.5-.6-.8-1-.5Z"
            fill="currentColor" />
          {on ? (
            <>
              <path d="M10.6 5.8a3 3 0 0 1 0 4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M12.6 3.9a5.6 5.6 0 0 1 0 8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </>
          ) : (
            <path d="m10.8 6.1 3.4 3.8M14.2 6.1l-3.4 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <input type="range" className="sfxvol" min={0} max={1} step={0.05} value={vol} disabled={!on}
        aria-label={t('sfx.volume')} title={t('sfx.volume')}
        onChange={(e) => { const v = Number(e.target.value); setVol(v); setVolume(v) }}
        onPointerUp={() => sfx.preview()} onKeyUp={() => sfx.preview()} />
    </span>
  )
}