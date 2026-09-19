import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.jsx'
import { isPicked, timeAgo } from '../lib/meta'
import { groupNotices, ownNotices, otherNotices, unreadCount } from '../lib/watch'
import Standing from './Standing'

/* =========================================================
   NOTIFICATIONS — chuông + bảng thông báo
   ---------------------------------------------------------
   MỘT bảng duy nhất mở ngay dưới chuông (kiểu Facebook / Instagram / X):
   không có "trang thông báo" riêng, không đá người dùng đi đâu. Mỗi dòng
   bấm thẳng vào việc được luôn, và ngay trong dòng đã có nút hành động
   (bỏ phiếu · xem video).

   Tin Gom theo TRẠNG THÁI chứ không theo loại event: Needs you (còn vote
   được / sắp tới lượt) → Up next (kết quả chốt) → Denied (kèm lý do) →
   In progress → Out. Người đọc hỏi "bài của mình đang ở đâu", chứ không hỏi
   "event type là gì".

   Cài đặt (tắt loại tin, bỏ theo dõi) nằm sau nút răng cưa trong cùng bảng —
   vẫn một chỗ, không phải mở thêm mục nào khác.
   ========================================================= */

const MAX_PER_GROUP = 12

/* Màu của dòng tin lấy đúng màu trạng thái ngoài bảng: cùng một bài thì
   ngoài bảng và trong thông báo phải một màu, không tự bày bảng màu mới. */
const TONE = {
  near: 'var(--paid)', lead: 'var(--done)', done: 'var(--done)', denied: 'var(--denied)',
  picked: 'var(--queued)', started: 'var(--progress)', progress: 'var(--progress)',
  approved: 'var(--queued)', votes: 'var(--a-2)',
}

const PREF_ROWS = [
  ['auto', 'nt.p.auto', 'nt.p.autoNote'],
  ['near', 'nt.p.near', 'nt.p.nearNote'],
  ['progress', 'nt.p.progress', 'nt.p.progressNote'],
  ['votes', 'nt.p.votes', 'nt.p.votesNote'],
]

export default function Notifications({
  open = false, notices = [], rowsByKey, rank, prefs,
  startTab = 'list', onToggle, onOpenNotice, onReadAll, onDrop, onBrowse, onVote,
  onBuy = null, onPrefs, onClose,
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState(startTab)
  const box = useRef(null)
  const unread = unreadCount(notices)
  const label = unread ? t('nt.ariaUnread', { n: unread }) : t('nt.aria')

  /* Esc + click ra ngoài là đóng. Bảng chỉ là lớp phủ: tin vẫn còn nguyên
     trong hộp thư, mở lại lúc nào cũng còn (bản đầu làm ngược lại). */
  useEffect(() => {
    if (!open) return
    const key = (e) => { if (e.key === 'Escape') onClose?.() }
    const down = (e) => { if (!box.current?.contains(e.target)) onClose?.() }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
    }
  }, [open, onClose])

  const feed = [...ownNotices(notices), ...otherNotices(notices)]
  const groups = groupNotices(feed).map(g => ({ ...g, items: g.items.slice(0, MAX_PER_GROUP) }))
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="nt" ref={box}>
      <button type="button" className={`nt-btn${unread ? ' has' : ''}`} onClick={onToggle}
        aria-expanded={open} aria-haspopup="dialog" aria-label={label} title={label}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" />
            <path d="M10.3 19a2 2 0 0 0 3.4 0" />
            {unread > 0 && <path d="M12 2v2" />}
          </g>
        </svg>
        {unread > 0 && <span className="dotbadge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="nt-pop" role="dialog" aria-label={t('nt.title')}>
          {tab === 'prefs' ? (
            <>
              <header className="nt-head">
                <button type="button" className="nt-back" onClick={() => setTab('list')} aria-label={t('nt.back')}>
                  <span aria-hidden="true">‹</span>{t('nt.backShort')}
                </button>
                <span className="nt-hbtns">
                  <button type="button" className="icon-btn" aria-label={t('btn.close')} onClick={onClose}>×</button>
                </span>
              </header>
              <div className="nt-list nt-prefs">
                {PREF_ROWS.map(([k, name, note]) => (
                  <label className="nt-pref" key={k}>
                    <input type="checkbox" checked={!!prefs?.[k]}
                      onChange={e => onPrefs?.({ [k]: e.target.checked })} />
                    <span className="nt-pref-tx">
                      <b>{t(name)}</b>
                      <small>{t(note)}</small>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <header className="nt-head">
                <b>{t('nt.title')}</b>
                {unread > 0 && <span className="nt-count">{unread}</span>}
                <span className="nt-hbtns">
                  {unread > 0 && (
                    <button type="button" className="lnk" onClick={onReadAll}>{t('nt.markAll')}</button>
                  )}
                  <button type="button" className="icon-btn" aria-label={t('nt.settings')} title={t('nt.settings')}
                    onClick={() => setTab('prefs')}>
<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                        <path d="M3 8h9M17.5 8H21M3 16h4M12.5 16H21" />
                        <circle cx="14.5" cy="8" r="2.4" /><circle cx="9.5" cy="16" r="2.4" />
                      </g>
                    </svg>
                  </button>
                  <button type="button" className="icon-btn" aria-label={t('btn.close')} onClick={onClose}>×</button>
                </span>
              </header>

              {total === 0 ? (
                <div className="nt-empty">
                  <b>{t('nt.emptyTitle')}</b>
                  <p>{t('nt.emptyBody')}</p>
                  <span className="nt-empty-acts">
                    <button type="button" className="btn btn-sm" onClick={onBrowse}>{t('nt.browse')}</button>
                    {/* khong co tin nao thi day la noi duy nhat de cai gi se
                        duoc bao — dung bat nguoi ta di tim trong menu */}
                    <button type="button" className="btn btn-sm" onClick={() => setTab('prefs')}>{t('nt.settings')}</button>
                  </span>
                </div>
              ) : (
                <div className="nt-list">
                  {groups.map(g => {
                    /* Nhom "can phim" phai ra LENH, khong ra thong tin: nut
                       VOTE NOW ngay dau nhom mo hop phieu cua bai dau tien con
                       bo duoc — thay cho dong dem nguoc "Next pick in ...",
                       thu do chi de biet chu khong lam duoc gi tu day. */
                    const target = g.id === 'need'
                      ? g.items.map(n => rowsByKey?.get(n.key))
                          .find(r => r && !isPicked(r) && (r.status === 'queued' || r.status === 'in_progress')) || null
                      : null
                    return (
                    <section className="nt-grp" key={g.id}>
                      <div className="nt-grp-h">
                        <span>{t(`nt.grp.${g.id}`)}</span>
                        {g.unread > 0 && <i>{g.unread}</i>}
                        {target && (
                          <button type="button" className="nt-hvote" onClick={() => onVote?.(target)}>
                            {t('nt.voteNow')}
                          </button>
                        )}
                      </div>
                      {g.items.map(n => (
                        <Item key={n.id} n={n} st={rank?.get(n.key)} row={rowsByKey?.get(n.key) || null}
                          grp={t(`nt.grp.${g.id}`)}
                          t={t} onOpenNotice={onOpenNotice} onDrop={onDrop} onVote={onVote}
                          onBuy={onBuy} />
                      ))}
                    </section>
                    )
                  })}
                </div>
              )}

            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------- một dòng tin ----------------
   Ca dong la mot nut bam: bo qua hop thoai trung gian, nhay thang toi dong
   request cua bai do tren bang (App lo). Nut hanh dong nhanh nam NGOAI nut do,
   khong long trong — `button` trong `button` la HTML hong. */
function Item({ n, row, st, grp, t, onOpenNotice, onDrop, onVote, onBuy }) {
  const c = TONE[n.type] || 'var(--txt-3)'
  const tag = t(`nt.tag.${n.type}`)
  const url = row?.video_url || n.url || null
  const votable = !!row && !isPicked(row) && (row.status === 'queued' || row.status === 'in_progress')
  const vars = {
    song: `${n.title} — ${n.artist}`, pct: n.pct ?? 0, votes: n.votes ?? row?.votes ?? 0, n: n.gap ?? 0,
  }
  return (
    <div className={`nt-i${n.read ? '' : ' new'}`} style={{ '--c': c }}>
      <button type="button" className="nt-hit" onClick={() => onOpenNotice?.(n)}>
        <span className="nt-tx">
          <span className="nt-title">{n.title} <span className="artist">— {n.artist}</span></span>
          <span className="nt-msg">{t(`nt.n.${n.type}`, vars)}</span>
          {n.type === 'denied' && n.reason && <span className="nt-reason">{n.reason}</span>}
          <span className="nt-meta">
            {/* nhan to trong ten nhom thi khong lap lai nua ("Out now" da
                nam o nhan nhom ngay tren dau) */}
            {tag !== grp && <><em style={{ color: c }}>{tag}</em><span className="dot" aria-hidden="true" /></>}
            <span>{timeAgo(n.at, t)}</span>
            <Standing st={st} />
          </span>
        </span>
      </button>
      <span className="nt-acts">
        {votable && (
          <button type="button" className="btn btn-sm nt-vote" onClick={() => onVote?.(row)}>
            {t('nt.vote')}
          </button>
        )}
        {/* Mua thêm vote CHỈ hiện ở tin "sát nút" — tin duy nhất mà con số
            "còn 2 vote nữa" vừa đọc được vừa làm được gì đó ngay. Nút cố ý
            để LẶNG (viền xám như nút Watch, không tô vàng như nút Vote):
            người đọc trả tiền khi họ muốn, không phải vì có nút vàng hét lên. */}
        {n.type === 'near' && onBuy && (
          <button type="button" className="btn btn-sm" title={t('nt.buyWhy', { n: n.gap ?? 0 })}
            onClick={() => onBuy(row)}>
            {t('nt.buyVotes')}
          </button>
        )}
        {url && (
          <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer"
            title={t('row.watch')}>{t('nt.watch')}</a>
        )}
        <button type="button" className="icon-btn" title={t('nt.drop')} aria-label={t('nt.drop')}
          onClick={() => onDrop?.(n.id)}>×</button>
      </span>
    </div>
  )
}
