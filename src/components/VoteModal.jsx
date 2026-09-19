import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useModalExit } from '../lib/useModalExit'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { isPicked, kindCls } from '../lib/meta'

const MAX = 100

/**
 * Bảng nhập số lượt vote. Mở ra khi bấm nút vote trên một request.
 * Cảnh báo ngay tại chỗ nếu nhập quá số lượt đang có.
 */
export default function VoteModal({ open, request, myCount = 0, votesLeft = 0, onClose, onVote, onBuy }) {
  const { t } = useI18n()
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    setQty(1); setErr(null); setBusy(false)
  }, [open, request])

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  /* App xoá prop request ngay khi đóng — giữ bản chụp cuối để animation
     đóng còn có nội dung mà mờ đi (adjust state khi prop đổi, ngay trong render) */
  const { mounted, closing } = useModalExit(open)
  const [lastReq, setLastReq] = useState(request)
  if (open && request && request !== lastReq) setLastReq(request)
  const req = open ? request : lastReq

  if (!mounted || !req) return null
  const out = closing ? ' out' : ''

  const n = Math.trunc(Number(qty)) || 0
  const invalid = n < 1 || n > MAX
  const locked = isPicked(req)             // đã vào Up next: khóa cả vote lẫn rút
  const noVotes = votesLeft === 0
  const tooMany = n > votesLeft            // không đủ lượt để vote
  const tooManyBack = n > myCount          // chưa vote đủ để rút lại

  const go = async (delta) => {
    if (locked) { setErr(t('vote.locked')); return }
    setBusy(true); setErr(null)
    try { await onVote(request.id, delta); onClose() }
    catch (e) { setErr(errMsg(t, e)) }
    finally { setBusy(false) }
  }

  return (
    <div className={`overlay vote-overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal narrow${out}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-tabs"><span className="mtab on">{t('vote.dialogTitle')}</span></div>
          <button className="x" onClick={onClose} aria-label={t('btn.close')}><Icon name="close" size={15} /></button>
        </div>

        <div className="modal-body">
          <div className="vm-song">
            <b>{req.title}</b>
            <span> — {req.artist}</span>
            <div className="vm-sub">
              <span className={`kind ${kindCls(req.kind)}`}>{req.kind}</span>
              <span className="dot" aria-hidden="true" />
              <span>{t('vote.total', { n: req.votes })}</span>
              {myCount > 0 && <><span className="dot" aria-hidden="true" /><span>{t('vote.yours', { n: myCount })}</span></>}
            </div>
          </div>

          {locked && <div className="msg err" style={{ marginTop: 16 }}>{t('vote.locked')}</div>}

          {!locked && (
          <div className="field" style={{ marginTop: 16, marginBottom: 8 }}>
            <label htmlFor="vm-qty">{t('vote.qty')}</label>
            <div className="vm-row">
              <div className="qty">
                <button type="button" onClick={() => setQty(q => Math.max(1, Number(q) - 1))}
                  disabled={busy} aria-label="−"><Icon name="minus" size={15} /></button>
                <input id="vm-qty" type="number" min="1" max={MAX} value={qty} disabled={busy}
                  onChange={e => setQty(e.target.value)}
                  onBlur={() => setQty(q => Math.max(1, Math.min(MAX, Math.trunc(Number(q)) || 1)))}
                  onKeyDown={e => { if (e.key === 'Enter' && !tooMany && !invalid && !busy) go(n) }} />
                <button type="button" onClick={() => setQty(q => Math.min(MAX, Number(q) + 1))}
                  disabled={busy} aria-label="+"><Icon name="plus" size={15} /></button>
              </div>
              {votesLeft > 1 && (
                <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => setQty(votesLeft)}>{t('vote.useAll', { n: votesLeft })}</button>
              )}
              {myCount > 1 && (
                <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => setQty(myCount)}>{t('vote.backAll', { n: myCount })}</button>
              )}
            </div>
            <div className="vm-limits">
              {t('vote.available', { n: votesLeft })}
              {myCount > 0 && <> · {t('vote.canTakeBack', { n: myCount })}</>}
            </div>
          </div>
          )}

          {!locked && noVotes && myCount === 0 && <div className="msg err">{t('vote.none')}</div>}
          {!locked && !invalid && (tooMany || (myCount > 0 && tooManyBack)) && (
            <div className="msg err">
              {tooMany && !noVotes && <div>{t('vote.tooMany', { n: votesLeft })}</div>}
              {noVotes && <div>{t('vote.none')}</div>}
              {myCount > 0 && tooManyBack && <div>{t('vote.tooManyBack', { n: myCount })}</div>}
            </div>
          )}
          {err && <div className="msg err">{err}</div>}

          <div className="prof-acts">
            {!locked && myCount > 0 && (
              <button className="btn btn-sm" style={{ marginRight: 'auto' }}
                disabled={busy || invalid || tooManyBack}
                title={tooManyBack ? t('vote.tooManyBack', { n: myCount }) : undefined}
                onClick={() => go(-n)}>
                {t('vote.takeBack', { n: Math.max(1, n) })}
              </button>
            )}
            <button className="btn" onClick={onClose} disabled={busy}>{t('prof.cancel')}</button>
            {!locked && (noVotes
              ? <button className="btn btn-gold" onClick={onBuy}>{t('vote.buyMore')}</button>
              : <button className="btn btn-primary" disabled={busy || tooMany || invalid}
                  onClick={() => go(n)}>
                  {busy ? '…' : t('vote.confirm', { n: Math.max(1, n) })}
                </button>)}
          </div>
        </div>
      </div>
    </div>
  )
}
