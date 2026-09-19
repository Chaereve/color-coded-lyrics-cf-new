import { useState } from 'react'
import Icon from './Icon'
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
        <Icon name={on ? 'sound' : 'mute'} size={15} />
      </button>
      <input type="range" className="sfxvol" min={0} max={1} step={0.05} value={vol} disabled={!on}
        aria-label={t('sfx.volume')} title={t('sfx.volume')}
        onChange={(e) => { const v = Number(e.target.value); setVol(v); setVolume(v) }}
        onPointerUp={() => sfx.preview()} onKeyUp={() => sfx.preview()} />
    </span>
  )
}