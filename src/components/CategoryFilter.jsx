import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

/* A single compact filter button keeps status/type categories out of the way
   until the user needs them. The currently selected category and count remain
   visible in the trigger. */
export default function CategoryFilter({ id, label, categories = [], value, onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const toggleRef = useRef(null)
  const selected = categories.find(category => category.key === value && category.count > 0)
    || categories.find(category => category.count > 0)
    || categories[0]

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!selected) return null
  return (
    <div className="mine-filter" ref={rootRef}>
      <button ref={toggleRef} type="button" className="btn btn-sm mine-filter-toggle"
        aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={`${label}: ${selected.label}, ${selected.count}`}
        onClick={() => setOpen(value => !value)}>
        <Icon name="filter" size={14} />
        <span className="mine-filter-label">{label}:</span>
        <b>{selected.label}</b>
        <span className="mine-filter-count">{selected.count}</span>
        <Icon name="chevron" size={13} className={`mine-filter-chevron${open ? ' on' : ''}`} />
      </button>
      {open && (
        <div className="mine-filter-menu" id={id} role="group" aria-label={`${label} filters`}>
          {categories.map(category => (
            <button key={category.key} type="button"
              className={`mine-filter-option${category.key === selected.key ? ' on' : ''}`}
              aria-pressed={category.key === selected.key} disabled={category.count === 0}
              onClick={() => {
                if (category.count > 0) onChange(category.key)
                setOpen(false)
                toggleRef.current?.focus()
              }}>
              <i className="mine-filter-swatch" style={{ '--c': category.color }} aria-hidden="true" />
              <span>{category.label}</span>
              <span className="mine-filter-count">{category.count}</span>
              {category.key === selected.key && <Icon name="check" size={13} className="mine-filter-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
