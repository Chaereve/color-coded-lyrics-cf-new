import { useMemo, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import { useI18n } from '../lib/i18n.jsx'
import { parseYoutube, thumbUrl } from '../lib/youtube'
import { timeAgo } from '../lib/meta'

/* =========================================================
   ADMIN — VIDEOS
   ---------------------------------------------------------
   Hai loại mục, cùng một bảng `media`:
     · featured — hero lớn ở giữa trang chủ (mục đầu chưa ẩn)
     · video    — dải "Latest update": link YouTube admin dán
   Mỗi loại có thứ tự riêng (hai nút mũi tên, icon Lucide). Dải video sửa bằng
   một ô textarea:
   mỗi dòng một link theo định dạng   link | tên video — lưu một lần
   là xong (thêm + sửa + xoá + xếp).
   ========================================================= */

function MediaForm({ initial, busy, onSave, onCancel }) {
  const { t } = useI18n()
  const [f, setF] = useState(initial)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const parsed = parseYoutube(f.url)
  const preview = f.thumb || thumbUrl(parsed?.id, 'hq')

  return (
    <div className="mform">
      <div className="field">
        <label htmlFor="murl">{t('adm.mediaUrl')}</label>
        <input id="murl" value={f.url} placeholder="https://www.youtube.com/watch?v=…"
          onChange={set('url')} autoFocus />
        {f.url && !parsed && <div className="hint">{t('adm.mediaBadUrl')}</div>}
        {parsed?.id && <div className="hint">ID: {parsed.id}</div>}
      </div>

      <div className="field">
        <label htmlFor="mtitle">{t('adm.mediaTitle')}</label>
        <input id="mtitle" value={f.title} maxLength={120} placeholder={t('adm.mediaTitlePh')}
          onChange={set('title')} />
      </div>

      <div className="field">
        <label htmlFor="mthumb">{t('adm.mediaThumb')}</label>
        <input id="mthumb" value={f.thumb || ''} placeholder="https://…" onChange={set('thumb')} />
      </div>

      <div className="mform-foot">
        <label className="switch" style={{ marginBottom: 0 }}>
          <Check checked={!!f.is_hidden} onChange={set('is_hidden')} />
          <span>{t('adm.mediaHide')}</span>
        </label>
        <div className="spacer" />
        {preview && (
          <span className="mprev">
            <img src={preview} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }}
              referrerPolicy="no-referrer" />
          </span>
        )}
        <button className="btn btn-sm" onClick={onCancel} disabled={busy}>{t('prof.cancel')}</button>
        <button className="btn btn-sm btn-primary" disabled={busy || f.title.trim().length < 2 || !parsed?.id}
          onClick={async () => { try { await onSave({ ...f }) } catch { /* App shows the save error; retain draft. */ } }}>
          {busy ? t('prof.saving') : t('adm.mediaSave')}
        </button>
      </div>
    </div>
  )
}

/* Trình thêm/sửa link Latest videos kiểu textarea: mỗi dòng một link,
   tựa đề riêng sau dấu | . Lưu một lần là xong (thêm + sửa + xoá + xếp). */
function TextEditor({ initial, busy, onCancel, onCommit }) {
  const { t } = useI18n()
  const [text, setText] = useState(() => initial.map(m => `${m.url} | ${m.title}`).join('\n'))
  const [msg, setMsg] = useState(null)

  const lines = useMemo(() => text.split('\n').map(raw => {
    const s = raw.trim()
    if (!s) return null
    const bar = s.indexOf('|')
    const url = (bar < 0 ? s : s.slice(0, bar)).trim()
    const title = (bar < 0 ? '' : s.slice(bar + 1)).trim()
    const id = parseYoutube(url)?.id || null
    return { url, title, id }
  }).filter(Boolean), [text])
  const valid = lines.filter(l => l.id && l.title.length >= 2)
  const bad = lines.length - valid.length

  const save = async () => {
    setMsg(null)
    if (!valid.length) { setMsg({ t: 'err', m: t('adm.mediaBulkNone') }); return }
    /* khớp link cũ theo YouTube ID để giữ thumb/ẩn/note; đổi tựa thì update */
    const byUrl = new Map()
    for (const m of initial) {
      const id = parseYoutube(m.url)?.id || m.url.trim().toLowerCase()
      if (!byUrl.has(id)) byUrl.set(id, m)
    }
    const seen = new Set()
    const seenUrl = new Set()
    const updates = []
    const adds = []
    const order = []
    valid.forEach((l, i) => {
      const key = l.id || l.url.toLowerCase()
      if (seenUrl.has(key)) return                       // dòng trùng link thì bỏ qua
      seenUrl.add(key)
      const old = byUrl.get(key)
      if (old && !seen.has(old.id)) {
        seen.add(old.id)
        if (old.title !== l.title || old.url !== l.url) {
          updates.push({
            id: old.id, kind: old.kind, title: l.title, url: l.url,
            thumb: old.thumb, note: old.note, is_hidden: old.is_hidden,
          })
        }
        order.push(old.id)
      } else {
        const tmp = `new-${i}`
        adds.push({ key: tmp, title: l.title, url: l.url })
        order.push(tmp)
      }
    })
    const removes = initial.filter(m => !seen.has(m.id)).map(m => m.id)
    try {
      await onCommit({ updates, adds, removes, order })
    } catch (e) {
      setMsg({ t: 'err', m: String(e?.message || e) })
    }
  }

  return (
    <div className="medit">
      <div className="hint" style={{ margin: '0 0 10px' }}>{t('adm.mediaTextHint')}</div>
      <textarea rows={8} value={text} disabled={busy} spellCheck={false}
        placeholder={'https://www.youtube.com/watch?v=… | CHUNG HA México Lyrics\nhttps://youtu.be/… | tripleS — …'}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, padding: 8,
          borderRadius: 'var(--r-sm)', border: '1px solid var(--line-2)', background: 'var(--surface-2)',
          color: 'var(--txt)', resize: 'vertical' }} />
      <div className="medit-foot">
        <span className="hint" style={{ margin: 0 }}>
          {t('adm.mediaTextCount', { n: valid.length })}
          {bad > 0 && <> · {t('adm.mediaTextBad', { n: bad })}</>}
        </span>
        <div className="spacer" />
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          {t('prof.cancel')}
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          {busy ? t('prof.saving') : t('adm.mediaTextSave')}
        </button>
      </div>
      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
    </div>
  )
}

function MediaRow({ m, i, last, live, busy, onEdit, onDelete, onMove }) {
  const { t } = useI18n()
  const p = parseYoutube(m.url)
  const img = m.thumb || thumbUrl(p?.id, 'hq')

  /* ẩn/hiện là một lần sửa, đi chung đường với nút Lưu */
  const toggleHide = () => onEdit(m, { ...m, is_hidden: !m.is_hidden }, true)

  return (
    <div className={`adm mrow${m.is_hidden ? ' off' : ''}`}>
      <span className="mrow-thumb">
        {img
          ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
          : <span className="mthumb-ph sm"><Icon name="play" size={13} fill="currentColor" /></span>}
      </span>

      <div className="nm">
        <b>
          {m.title}
          {live && <span className="pill completed">{t('adm.mediaLive')}</span>}
          {m.is_hidden && <span className="pill">{t('adm.mediaHidden')}</span>}
        </b>
        <small>
          <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--a-2)' }}>
            {p?.id || m.url}
          </a>
          {' · '}{timeAgo(m.created_at, t)}
        </small>
      </div>

      <div className="adm-acts">
        {/* Hai nút đổi thứ tự là ICON Lucide, không phải ký tự "↑" "↓": bộ
            icon của trang là Lucide (xem Icon.jsx), và một ký tự chữ trong nút
            icon sẽ lệch nét, lệch dòng, lệch cả khi phông thay. */}
        <button className="icon-btn" title={t('adm.mediaUp')} aria-label={t('adm.mediaUp')} disabled={i === 0 || busy}
          onClick={() => onMove(i, -1)}><Icon name="up" size={15} /></button>
        <button className="icon-btn" title={t('adm.mediaDown')} aria-label={t('adm.mediaDown')} disabled={last || busy}
          onClick={() => onMove(i, 1)}><Icon name="down" size={15} /></button>
        <button className="btn btn-sm" onClick={() => onEdit(m)}>{t('adm.edit')}</button>
        <button className="btn btn-sm" onClick={toggleHide}>{m.is_hidden ? t('adm.mediaShow') : t('adm.mediaHide')}</button>
        <button className="icon-btn" title={t('adm.delete')} aria-label={t('adm.delete')}
          onClick={() => onDelete(m.id)}><Icon name="close" size={15} /></button>
      </div>
    </div>
  )
}

function MediaGroup({ kind, allItems, busy, label, onSave, onCommit, onDelete, onReorder, addLabel }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(null)   // id đang sửa | 'new' | null
  const [draft, setDraft] = useState(null)       // bản nháp khi sửa nhanh (ẩn/hiện)
  const [listEdit, setListEdit] = useState(false) // bảng sửa cả danh sách (chỉ nhóm Latest)

  /* thứ tự toàn bảng theo position — reorder phải renumber đủ cả featured
     lẫn video, không thì id trong một nhóm bị kéo về position 0 và nhảy
     nhóm trên trang chủ */
  const allSorted = useMemo(
    () => [...allItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)
      || new Date(b.created_at) - new Date(a.created_at)),
    [allItems])
  const sorted = useMemo(() => allSorted.filter(m => m.kind === kind || (kind === 'video' && m.kind === 'playlist')),
    [allSorted, kind])
  /* featured: mục đầu chưa ẩn là hero đang hiển thị */
  const liveId = kind === 'featured' ? sorted.find(m => !m.is_hidden)?.id : null

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= sorted.length) return
    /* dời item trong nhóm, các nhóm khác giữ nguyên vị trí tương đối */
    const moving = sorted[i]
    const without = allSorted.filter(m => m.id !== moving.id)
    const neighbor = sorted[j]
    const target = without.findIndex(m => m.id === neighbor.id)
    const insertAt = dir < 0 ? target : target + 1
    without.splice(insertAt, 0, moving)
    onReorder(without.map(m => m.id))
  }

  /* patch = có sẵn dữ liệu mới (dùng cho nút Ẩn/Hiện); không thì chỉ mở form */
  const startEdit = (row, patch, auto = false) => {
    const next = patch || row
    setDraft(next)
    if (auto) Promise.resolve(onSave(next)).catch(() => {})
    else setEditing(row.id)
  }

  return (
    <div className="mgroup">
      <div className="mgroup-head">
        <b>{label}</b>
      </div>

      {!editing && !listEdit && (
        <div className="mgroup-acts">
          {kind === 'video' && onCommit ? (
            <button className="btn btn-sm" onClick={() => setListEdit(true)}>
              + {t('adm.mediaEditList')}
            </button>
          ) : (
            <button className="btn btn-sm"
              onClick={() => { setDraft({ kind, title: '', url: '', thumb: '', is_hidden: false }); setEditing('new') }}>
              + {addLabel}
            </button>
          )}
        </div>
      )}

      {listEdit && kind === 'video' && onCommit && (
        <TextEditor key="textedit" initial={sorted} busy={busy}
          onCancel={() => setListEdit(false)}
          onCommit={async (p) => { await onCommit(p); setListEdit(false) }} />
      )}

      {editing && (
        /* key = mục đang sửa: mở mục khác là form dựng lại, không phải đồng bộ bằng effect */
        <MediaForm key={editing} initial={draft} busy={busy}
          onCancel={() => { setEditing(null); setDraft(null) }}
          onSave={async (f) => {
            await onSave(editing === 'new' ? f : { ...draft, ...f, id: editing })
            setEditing(null); setDraft(null)
          }} />
      )}

      {sorted.length === 0
        ? <div className="empty">{t('adm.mediaEmptyGroup')}</div>
        : sorted.map((m, i) => (
          <MediaRow key={m.id} m={m} i={i} last={i === sorted.length - 1} live={m.id === liveId} busy={busy}
            onEdit={startEdit} onDelete={onDelete} onMove={move} />
        ))}
    </div>
  )
}

export default function MediaAdmin({ media = [], busy, onSave, onCommit, onDelete, onReorder }) {
  const { t } = useI18n()

  return (
    <div>
      {/* Nút "View on home page" đứng trong thanh công cụ của trang quản trị
          (xem .adm-bar-end ở AdminPanel) — cùng hàng, cùng chỗ với điều khiển
          của mọi mục khác, thay vì một dải riêng nằm chênh giữa tiêu đề và
          nhóm đầu tiên. */}
      <p className="hint">{t('adm.mediaLimit', { n: media.length })}</p>
      <MediaGroup kind="featured" allItems={media} busy={busy}
        label={t('adm.mediaGroupFeatured')}
        addLabel={t('adm.mediaAddFeatured')}
        onSave={onSave} onDelete={onDelete} onReorder={onReorder} />

      <MediaGroup kind="video" allItems={media} busy={busy}
        label={t('adm.mediaGroupVideo')}
        addLabel={t('adm.mediaAddVideo')}
        onSave={onSave} onCommit={onCommit} onDelete={onDelete} onReorder={onReorder} />
    </div>
  )
}
