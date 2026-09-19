import { useEffect, useMemo, useRef, useState } from 'react'
import Check from './Check'
import Icon from './Icon'
import { KINDS, VOTE_PACKS, SINGLE_VOTE, singlePrice, PAID_REQUEST } from '../lib/db'
import { KIND_META, isPicked, kindCls, vnd, usd } from '../lib/meta'
import { findDuplicate } from '../lib/board'
import { SUPPORT } from '../lib/payment'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { useModalExit } from '../lib/useModalExit'
import PaymentMethods from './PaymentMethods'
import Pager from './Pager'
import { usePager } from '../lib/usePager'

const VOTE_PER_PAGE = 8

/* Rules chỉ hiện 1 lần duy nhất — bấm Agree là nhớ vào localStorage. */
const RULES_KEY = 'ccl.reqRules'
const RULES_V = 'v1'

function RulesGate({ onAgree }) {
  const { t } = useI18n()
  return (
    <div className="rules">
      <h4>{t('req.rulesTitle')}</h4>
      <ol>
        <li>{t('req.rule1')}</li>
        <li>{t('req.rule2')}</li>
        <li>{t('req.rule3')}</li>
        <li>{t('req.rule4')}</li>
        <li>{t('req.rule5')}</li>
      </ol>
      <button className="btn btn-primary" onClick={onAgree}>{t('req.agree')}</button>
    </div>
  )
}

/* ------------------------- TAB: GỬI REQUEST ------------------------- */
function RequestTab({ onSubmit, live = true, rows = [], allRows, onVoteExisting, prefill }) {
  const { t } = useI18n()
  /* Link mời (`?add=1&artist=…&title=…`) đổ sẵn vào form: người bấm link từ mô
     tả video chỉ còn phải bấm Gửi. Giá trị đã được cắt theo maxLength của ô
     nhập ở `parseRequestPrefill` nên không có chuyện chữ từ URL dài hơn ô. */
  const [form, setForm] = useState(() => ({
    kind: KINDS[0],
    artist: prefill?.artist || '', title: prefill?.title || '',
    link: prefill?.link || '', note: '',
  }))
  /* O "bai tra phi" luon bat dau tat. Tung co prop `paidDefault` de mo form dang
     tick san, nhung khong mot ai truyen no — xoa di con hon de nguoi doc tuong
     la co loi tat. */
  const [paid, setPaid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [agreed, setAgreed] = useState(() => {
    try { return localStorage.getItem(RULES_KEY) === RULES_V } catch { return false }
  })

  /* Tra bảng loại bài LUÔN phải có kết quả: `form.kind` đi qua state nên về lý
     thuyết chỉ nhận bốn giá trị của KINDS, nhưng tra trượt ở đây là TypeError
     ngay trong lúc render — cả form biến mất chỉ vì một giá trị lạ. Trượt thì
     lấy loại đầu. */
  const meta = KIND_META[form.kind] || KIND_META[KINDS[0]]
  const titleLabel = t(meta.titleKey)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  /* Dò trùng NGAY LÚC GÕ, không đợi tới lúc bấm Gửi. Một bài do ba người gửi
     lẻ là gốc của cả việc cụm 9 vote bị xếp dưới bài 5 vote lẫn việc farm vote
     bằng nhiều tài khoản; nói ra ở ô nhập thì rẻ hơn nhiều so với đi gộp ở tầng
     SQL sau khi dữ liệu đã bẩn. Chỉ dò khi cả tên bài lẫn nghệ sĩ đã đủ dài
     (xem `findDuplicate`) nên trong lúc gõ bình thường không có gì nhấp nháy. */
  /* Dò trên `allRows` (mọi hàng, kể cả đang chờ duyệt và đã bị từ chối) chứ
     không phải `rows` — bảng chỉ hiện hàng công khai, còn ở đây ta cần biết
     "tôi vừa gửi bài này rồi" ngay cả khi nó chưa được duyệt. */
  const dup = useMemo(() => findDuplicate(allRows || rows, form), [allRows, rows, form])

  const agree = () => {
    try { localStorage.setItem(RULES_KEY, RULES_V) } catch { /* private mode */ }
    setAgreed(true)
  }

  const paidPrice = `${usd(PAID_REQUEST.usd)} / ${vnd(PAID_REQUEST.vnd)}`

  const submit = async (e) => {
    e.preventDefault()
    if (!form.artist.trim() || !form.title.trim()) {
      setMsg({ t: 'err', m: t('req.needFields', { f: titleLabel.toLowerCase() }) }); return
    }
    setBusy(true); setMsg(null)
    try {
      await onSubmit(form, paid)
      setForm({ ...form, artist: '', title: '', link: '', note: '' })
      setMsg({ t: 'ok', m: paid ? t('req.okPaid', { p: paidPrice }) : t('req.ok') })
    } catch (e2) { setMsg({ t: 'err', m: errMsg(t, e2) }) }
    finally { setBusy(false) }
  }

  if (!agreed) return <RulesGate onAgree={agree} />

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>{t('req.kind')}</label>
        <div className="kindpick">
          {KINDS.map(k => (
            <button type="button" key={k}
              className={`kbtn ${kindCls(k)}${form.kind === k ? ' on' : ''}`}
              title={KIND_META[k]?.noteKey ? t(KIND_META[k].noteKey) : undefined}
              onClick={() => setForm(f => ({ ...f, kind: k }))}>
              {k}
            </button>
          ))}
        </div>
        {/* chú thích chỉ hiện với loại có noteKey (hiện tại: Full Album) */}
        {meta.noteKey && (
          <p className="kind-note" key={form.kind}>
            <span className={`kind ${kindCls(form.kind)}`}>{form.kind}</span>{' '}
            {t(meta.noteKey)}
          </p>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label>{t('req.artist')} *</label>
          <input value={form.artist} onChange={set('artist')} maxLength={120} />
        </div>
        <div className="field">
          <label>{titleLabel} *</label>
          <input value={form.title} onChange={set('title')} maxLength={160} />
        </div>
      </div>

      {/* Bài đã có trên bảng: nói ra rồi đưa thẳng tới chỗ vote cho bài đó.
          Đây là gợi ý, KHÔNG phải chặn — người dùng vẫn gửi được nếu họ muốn
          (ví dụ bài cũ đã bị từ chối, hoặc họ muốn một bản khác). */}
      {dup && (
        <div className="dup-note" role="status">
          <span className="dup-tx">
            <b>{dup.title}</b>
            <span className="dup-sub">
              {dup.open === 0 && dup.pending > 0
                ? t('req.dupPending', { c: dup.pending })
                : t('req.dupMeta', { c: dup.rows.length, n: dup.votes })}
            </span>
          </span>
          {dup.best && onVoteExisting && (
            <button type="button" className="btn btn-sm btn-primary"
              onClick={() => onVoteExisting(dup.best)}>
              {t('req.dupVote')}
            </button>
          )}
          {!dup.best && dup.video && (
            <a className="btn btn-sm" href={dup.video} target="_blank" rel="noreferrer">
              {t('req.dupWatch')}
            </a>
          )}
        </div>
      )}

      <div className="field">
        <label>{t('req.link')}</label>
        <input value={form.link} onChange={set('link')} placeholder={t('req.linkPh')} maxLength={500} />
      </div>

      <div className="field">
        <label>{t('req.note')}</label>
        <textarea value={form.note} onChange={set('note')} maxLength={500} />
      </div>

      <div className="paidbox">
        <label className="switch" style={{ margin: 0 }}>
          <Check checked={paid} onChange={e => setPaid(e.target.checked)} />
          <span className="t" style={{ margin: 0 }}>{t('req.paidLabel', { p: paidPrice })}</span>
        </label>
        <p style={{ marginTop: 8 }}>
          {t('req.paidDesc1')}<b>{t('req.paidDescB')}</b>{t('req.paidDesc2')}
        </p>
      </div>

      {/* Nguoi gui co quyen biet tin se di dau: mot dong chu ben duoi nut
          gui con thuyet phuc hon cai chuong an trong danh sach. */}
      <p className="am-note">
        {live ? t('req.notifyNote') : t('req.notifyDemo')}
      </p>

      {/* `type="submit"` vi day la nut DUY NHAT phai gui form; cac nut khac trong
          form (loai bai, switch tra phi) deu `type="button"` — de nguyen mac
          dinh la mot cai sau them cung gui form luc nguoi dung khong ngo. */}
      <button type="submit" className={`btn ${paid ? 'btn-gold' : 'btn-primary'}`} style={{ width: '100%' }} disabled={busy}>
        {busy ? t('req.sending')
          : paid ? t('req.submitPaid', { p: usd(PAID_REQUEST.usd) })
            : t('req.submit')}
      </button>
      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}
    </form>
  )
}

/* ---------------------------- TAB: VOTE ---------------------------- */
function VoteTab({ rows, myVotes, onVote, voteStatus, goBuy }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('top')

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    /* Up next đã chốt thì khóa vote nên không liệt kê ở đây nữa. */
    let out = rows.filter(r => (r.status === 'queued' || r.status === 'in_progress') && !isPicked(r))
    if (s) out = out.filter(r => `${r.artist} ${r.title}`.toLowerCase().includes(s))
    return sort === 'top'
      ? [...out].sort((a, b) => b.votes - a.votes)
      : [...out].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [rows, q, sort])

  const left = Math.max(0, voteStatus.free_limit - voteStatus.free_used)
  const total = left + voteStatus.credits

  const listRef = useRef(null)
  const pg = usePager(list, VOTE_PER_PAGE, [q, sort])

  return (
    <>
      <div className="card" style={{ marginBottom: 14, padding: 13 }}>
        <div className="vote-status">
          <div className="vs-row">
            <span>{t('vote.freeToday')}</span>
            <b style={{ color: left > 0 ? 'var(--done)' : 'var(--denied)' }}>{left} / {voteStatus.free_limit}</b>
          </div>
          <div className="vs-bar"><i style={{ width: `${(left / voteStatus.free_limit) * 100}%` }} /></div>
          <div className="vs-row">
            <span>{t('vote.purchased')}</span>
            <b style={{ color: 'var(--paid)' }}>{voteStatus.purchased ?? 0}</b>
          </div>
          <div className="vs-row">
            <span>{t('vote.bonus')}</span>
            <b style={{ color: 'var(--a-2)' }}>{voteStatus.bonus ?? 0}</b>
          </div>
        </div>
        {total === 0 && (
          <button className="btn btn-sm" style={{ width: '100%', marginTop: 11 }} onClick={goBuy}>
            {t('vote.outBuy')}
          </button>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="tabs">
          <button className={`tab${sort === 'top' ? ' on' : ''}`} onClick={() => setSort('top')}>{t('vote.sortTop')}</button>
          <button className={`tab${sort === 'new' ? ' on' : ''}`} onClick={() => setSort('new')}>{t('vote.sortNew')}</button>
        </div>
        <div className="spacer" />
        <input className="search" placeholder={t('vote.search')} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      <div ref={listRef} />
      {list.length === 0
        ? <div className="empty">{t('vote.empty')}</div>
        : pg.items.map(r => {
          const mine = myVotes.get(r.id) || 0
          return (
            <div className="adm" key={r.id}>
              <div className="nm">
                <b>
                  {r.title}{' '}
                  {r.is_paid && <span className="pill gold">PAID</span>}
                </b>
                <small>{r.artist} · <span className={`kind ${kindCls(r.kind)}`}>{r.kind}</span></small>
              </div>
              <button className={`votebtn${mine > 0 ? ' on' : ''}`} onClick={() => onVote(r)}
                title={t('row.openVote')}>
                <b>{r.votes}</b><span>{t('row.vote')}</span>
                {mine > 0 && <em className="mine">×{mine}</em>}
              </button>
            </div>
          )
        })}
      <Pager {...pg} onChange={pg.setPage} scrollTo={listRef} />
    </>
  )
}

/* ------------------------ TAB: MUA VOTE / TT ------------------------ */
function BuyTab({ onBuy, myOrders, userName, onCancelOrder }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [qty, setQty] = useState(1)
  const [picked, setPicked] = useState(null)

  const buy = async (p, label) => {
    setBusy(p.id); setMsg(null)
    try {
      await onBuy(p)
      setPicked({ usd: p.usd, vnd: p.vnd })
      setMsg({ t: 'ok', m: t('buy.created', { label, amt: vnd(p.vnd) }) })
    } catch (e) { setMsg({ t: 'err', m: errMsg(t, e) }) }
    finally { setBusy(null) }
  }

  const pendingOrder = myOrders.find(o => o.status === 'awaiting')
  const lastOrder = picked
    || (pendingOrder ? { usd: Number(pendingOrder.amount_usd), vnd: pendingOrder.amount_vnd } : null)
  const custom = singlePrice(Math.max(1, Math.min(100, Number(qty) || 1)))
  const best = VOTE_PACKS[VOTE_PACKS.length - 1]
  const saving = (p) => Math.round((1 - (p.usd / p.qty) / SINGLE_VOTE.usd) * 100)
  const orderStatus = (s) => s === 'paid' ? t('order.paid') : s === 'rejected' ? t('order.rejected') : t('order.awaiting')

  return (
    <>
      <div className="section-title">{t('buy.packs')}</div>
      <div className="packs">
        {VOTE_PACKS.map(p => (
          <div className={`pack${p.id === best.id ? ' best' : ''}`} key={p.id}>
            {p.id === best.id && <div className="pack-flag">{t('buy.best')}</div>}
            <b>{p.qty}</b>
            <div className="u">{t('buy.unit')}</div>
            <div className="p">{usd(p.usd)}<small>{vnd(p.vnd)}</small></div>
            {saving(p) > 0 && <div className="pack-save">−{saving(p)}%</div>}
            <button className={`btn btn-sm${p.id === best.id ? ' btn-primary' : ''}`} style={{ width: '100%', marginTop: 10 }}
              disabled={busy === p.id} onClick={() => buy(p, t('order.votes', { n: p.qty }))}>
              {busy === p.id ? '…' : t('buy.order')}
            </button>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>{t('buy.single')}</div>
      <div className="buyone">
        <div className="buyone-info">
          <div className="buyone-rate">{usd(SINGLE_VOTE.usd)} <span>{t('buy.perVote')}</span></div>
          <div className="buyone-sub">{t('buy.each', { v: vnd(SINGLE_VOTE.vnd) })}</div>
        </div>
        <div className="qty">
          <button type="button" onClick={() => setQty(q => Math.max(1, Number(q) - 1))}><Icon name="minus" size={14} /></button>
          <input type="number" min="1" max="100" value={qty}
            onChange={e => setQty(e.target.value)}
            onBlur={() => setQty(q => Math.max(1, Math.min(100, Number(q) || 1)))} />
          <button type="button" onClick={() => setQty(q => Math.min(100, Number(q) + 1))}><Icon name="plus" size={14} /></button>
        </div>
        <div className="buyone-total">
          <b>{usd(custom.usd)}</b>
          <span>{vnd(custom.vnd)}</span>
        </div>
        <button className="btn" disabled={busy === 'custom'}
          onClick={() => buy(custom, t('order.votes', { n: custom.qty }))}>
          {busy === 'custom' ? '…' : t('buy.order')}
        </button>
      </div>

      {msg && <div className={`msg ${msg.t}`}>{msg.m}</div>}

      <div className="section-title" style={{ marginTop: 20 }}>{t('buy.payment')}</div>
      <div className="pay-note">
        {t('buy.payNote1')}<b>{t('buy.payNoteB')}</b>{t('buy.payNote2')}
      </div>
      <PaymentMethods amountVnd={lastOrder?.vnd ?? 0} amountUsd={lastOrder?.usd ?? 0} content={userName} />

      <div className="section-title" style={{ marginTop: 20 }}>{t('buy.yourOrders')}</div>
      <div className="support">
        {t('support.line')}{' '}
        <a href={SUPPORT.telegramUrl} target="_blank" rel="noreferrer">t.me/{SUPPORT.telegram}</a>
      </div>
      {myOrders.length === 0
        ? <div className="empty">{t('buy.noOrders')}</div>
        : myOrders.slice(0, 12).map(o => (
          <div className="adm" key={o.id}>
            <div className="nm">
              <b>{o.kind === 'votes' ? t('order.votes', { n: o.qty }) : t('order.paidRequest')}</b>
              <small>{usd(o.amount_usd)} · {vnd(o.amount_vnd)}</small>
            </div>
            <span className={`pill ${o.status === 'paid' ? 'completed' : o.status === 'rejected' ? 'denied' : 'pending'}`}>
              {orderStatus(o.status)}
            </span>
            {o.status === 'awaiting' && onCancelOrder && (
              <button className="icon-btn" title={t('order.cancel')} aria-label={t('order.cancel')}
                onClick={() => onCancelOrder(o)}><Icon name="close" size={15} /></button>
            )}
          </div>
        ))}
    </>
  )
}

/* ============================== MODAL ============================== */
export default function ActionModal({
  open, tab, setTab, onClose,
  rows, myVotes, myOrders, voteStatus, allRows, prefill,
  onVote, onSubmit, onBuy, onCancelOrder, userName, onVoteExisting,
  /* live = co noi DB that hay chay demo: RequestTab dung no de chon dong chu bao
     tin. Bo no khoi danh sach prop la `live={live}` ben duoi thanh ReferenceError,
     React go ca cay -> mo "New request" chi con man den. */
  live,
}) {
  const { t } = useI18n()

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const { mounted, closing } = useModalExit(open)
  if (!mounted) return null
  const out = closing ? ' out' : ''
  const votable = rows.filter(r => (r.status === 'queued' || r.status === 'in_progress') && !isPicked(r)).length

  return (
    <div className={`overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${out}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-tabs">
            <button className={`mtab${tab === 'request' ? ' on' : ''}`} onClick={() => setTab('request')}>{t('tab.request')}</button>
            <button className={`mtab${tab === 'vote' ? ' on' : ''}`} onClick={() => setTab('vote')}>
              {t('tab.vote')} <span className="c">({votable})</span>
            </button>
            <button className={`mtab${tab === 'buy' ? ' on' : ''}`} onClick={() => setTab('buy')}>{t('tab.buy')}</button>
          </div>
          <button className="x" onClick={onClose} aria-label={t('btn.close')}><Icon name="close" size={15} /></button>
        </div>
        <div className="modal-body">
          {tab === 'request' && (
            <RequestTab onSubmit={onSubmit} live={live} rows={rows} allRows={allRows}
              prefill={prefill} onVoteExisting={onVoteExisting} />
          )}
          {tab === 'vote' && (
            <VoteTab rows={rows} myVotes={myVotes} onVote={onVote}
              voteStatus={voteStatus} goBuy={() => setTab('buy')} />
          )}
          {tab === 'buy' && <BuyTab onBuy={onBuy} myOrders={myOrders} userName={userName} onCancelOrder={onCancelOrder} />}
        </div>
      </div>
    </div>
  )
}