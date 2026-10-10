import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useModalExit } from '../lib/useModalExit'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { isPicked, kindCls } from '../lib/meta'
import { warmCaptcha, warmFingerprint } from '../lib/spinShield.js'

const MAX = 100
const PRESETS = [1, 5, 10, 25]

/**
 * Hộp vote / rút phiếu. Hai việc KHÔNG dùng chung một con số:
 *   · Vote all = hết phiếu đang có (tối đa 100)
 *   · Take back all = hết phiếu đã bỏ vào bài này (tối đa 100)
 * Qty của chế độ Vote không khoá nút rút, và ngược lại.
 */
export default function VoteModal({
  open, request, myCount = 0, votesLeft = 0,
  purchased = 0, bonus = 0,
  onClose, onVote, onBuy,
}) {
  const { t } = useI18n()
  const [qty, setQty] = useState(1)
  const [mode, setMode] = useState('give')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const panelRef = useRef(null)
  const qtyRef = useRef(null)
  const giving = mode === 'give'
  const giveCap = Math.min(MAX, Math.max(0, votesLeft))
  const backCap = Math.min(MAX, Math.max(0, myCount))
  const cap = giving ? giveCap : backCap
  const addMax = Math.max(1, cap)

  useEffect(() => {
    if (!open) return
    void warmCaptcha()
    void warmFingerprint()
    const start = votesLeft > 0 ? 'give' : myCount > 0 ? 'back' : 'give'
    setMode(start)
    setQty(start === 'back' ? Math.max(1, Math.min(MAX, myCount)) : 1)
    setErr(null)
    setBusy(false)
  }, [open, request])

  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      const el = e.target
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
      const up = e.key === '+' || e.key === '=' || e.key === 'ArrowUp'
      const down = e.key === '-' || e.key === '_' || e.key === 'ArrowDown'
      if (!up && !down) return
      e.preventDefault()
      setErr(null)
      setQty(q => Math.max(1, Math.min(addMax, (Math.trunc(Number(q)) || 1) + (up ? 1 : -1))))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, addMax])

  const { mounted, closing } = useModalExit(open)
  useFocusTrap(panelRef, open, { initial: () => qtyRef.current })
  const [lastReq, setLastReq] = useState(request)
  if (open && request && request !== lastReq) setLastReq(request)
  const req = open ? request : lastReq

  if (!mounted || !req) return null
  const out = closing ? ' out' : ''

  const n = Math.trunc(Number(qty)) || 0
  const invalid = n < 1 || n > MAX
  const picked = isPicked(req)
  const openForVotes = !picked && (req.status === 'queued' || req.status === 'in_progress')
  const locked = !openForVotes
  const closedMsg = picked ? 'vote.locked' : 'vote.closed'
  const noVotes = votesLeft === 0
  const tooMany = giving && n > votesLeft
  const tooManyBack = !giving && n > myCount
  const usingAll = cap > 0 && n === cap

  const go = async (delta) => {
    if (locked) { setErr(t('vote.locked')); return }
    if (!delta) return
    setBusy(true); setErr(null)
    try { await onVote(request.id, delta); onClose() }
    catch (e) { setErr(errMsg(t, e)) }
    finally { setBusy(false) }
  }

  const pickMode = next => {
    setMode(next)
    setErr(null)
    setQty(next === 'back' ? Math.max(1, backCap) : 1)
  }

  const clampQty = q => Math.max(1, Math.min(addMax, Math.trunc(Number(q)) || 1))
  const presets = PRESETS.filter(v => v < cap)
  const after = locked ? req.votes : (giving ? req.votes + n : Math.max(0, req.votes - n))
  const leftAfter = giving ? Math.max(0, votesLeft - n) : votesLeft + Math.min(n, myCount)
  const mineAfter = giving ? myCount + n : Math.max(0, myCount - n)
  const changing = busy
  const canGive = giveCap > 0
  const canBack = backCap > 0

  return (
    <div className={`overlay vote-overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal narrow vote-modal${out}`} role="dialog" aria-modal="true" aria-label={t('vote.dialogTitle')} ref={panelRef}>
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

          {locked ? (
            <div className="msg err vm-locked">{t(closedMsg)}</div>
          ) : (
            <>
              {canBack && (
                <div className="vm-modes" role="tablist" aria-label={t('vote.dialogTitle')}>
                  <button type="button" role="tab" aria-selected={giving}
                    className={`vm-mode${giving ? ' on' : ''}`}
                    disabled={busy || !canGive}
                    onClick={() => pickMode('give')}>{t('vote.modeGive')}</button>
                  <button type="button" role="tab" aria-selected={!giving}
                    className={`vm-mode${!giving ? ' on' : ''}`}
                    disabled={busy}
                    onClick={() => pickMode('back')}>{t('vote.modeBack')}</button>
                </div>
              )}

              {((giving && canGive) || (!giving && canBack)) && (
                <>
                  <div className={`vm-hero${giving ? '' : ' is-back'}`}>
                    <span className="k">{t(giving ? 'vote.hero' : 'vote.heroBack')}</span>
                    <span className={`v${changing ? '' : ' pop'}`} aria-live="polite">{after}</span>
                    <span className="u">{t('vote.heroSub', { n: req.votes })}</span>
                  </div>

                  <div className="vm-presets" role="group" aria-label={t('vote.qty')}>
                    {presets.map(v => (
                      <button key={v} type="button" className={`vm-preset${n === v ? ' on' : ''}`}
                        aria-pressed={n === v} disabled={busy} onClick={() => setQty(v)}>{v}</button>
                    ))}
                    {cap >= 1 && (
                      <button type="button" className={`vm-preset all${usingAll ? ' on' : ''}`}
                        aria-pressed={usingAll} disabled={busy}
                        onClick={() => setQty(cap)}>{t('vote.useAll', { n: cap })}</button>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="vm-qty">{t('vote.qty')}</label>
                    <div className="vm-row">
                      <div className="qty">
                        <button type="button" onClick={() => setQty(q => Math.max(1, Number(q) - 1))}
                          disabled={busy} aria-label="−"><Icon name="minus" size={15} /></button>
                        <input id="vm-qty" type="number" min="1" max={addMax} value={qty} disabled={busy}
                          ref={qtyRef}
                          aria-describedby="vm-after"
                          onChange={e => setQty(e.target.value)}
                          onBlur={() => setQty(q => clampQty(q))}
                          onKeyDown={e => {
                            if (e.key !== 'Enter' || busy || invalid) return
                            if (giving && !tooMany) go(n)
                            if (!giving && !tooManyBack) go(-n)
                          }} />
                        <button type="button" onClick={() => setQty(q => Math.min(addMax, Number(q) + 1))}
                          disabled={busy} aria-label="+"><Icon name="plus" size={15} /></button>
                      </div>
                    </div>
                    <div className="vm-after" id="vm-after">
                      {giving ? (
                        <>
                          <span>{t('vote.leftBefore', { n: votesLeft })}</span>
                          <span className="arw" aria-hidden="true">→</span>
                          <b className={leftAfter === 0 ? 'bad' : 'good'}>{leftAfter}</b>
                        </>
                      ) : (
                        <>
                          <span>{t('vote.yours', { n: myCount })}</span>
                          <span className="arw" aria-hidden="true">→</span>
                          <b className={mineAfter === 0 ? 'bad' : 'good'}>{mineAfter}</b>
                        </>
                      )}
                      {(purchased > 0 || bonus > 0) && (
                        <span className="vm-src">{t('vote.sources', { p: purchased, b: bonus })}</span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {giving && noVotes && myCount === 0 && <div className="msg err">{t('vote.none')}</div>}
              {!invalid && (tooMany || tooManyBack) && (
                <div className="msg err">
                  {tooMany && !noVotes && <div>{t('vote.tooMany', { n: votesLeft })}</div>}
                  {tooMany && noVotes && <div>{t('vote.none')}</div>}
                  {tooManyBack && <div>{t('vote.tooManyBack', { n: myCount })}</div>}
                </div>
              )}
            </>
          )}
          {err && <div className="msg err">{err}</div>}

          <div className="prof-acts">
            {!locked && canBack && giving && (
              <button className="btn btn-sm vm-back" disabled={busy}
                onClick={() => go(-backCap)}>
                {t('vote.takeBackAll', { n: backCap })}
              </button>
            )}
            <button className="btn" onClick={onClose} disabled={busy}>{t('prof.cancel')}</button>
            {!locked && giving && (canGive
              ? <button className="btn btn-primary" disabled={busy || tooMany || invalid}
                  onClick={() => go(n)}>
                  {busy ? '…' : t(usingAll ? 'vote.confirmAll' : 'vote.confirm', { n: Math.max(1, n) })}
                </button>
              : <button className="btn btn-gold" onClick={onBuy}>{t('vote.buyMore')}</button>)}
            {!locked && !giving && canBack && (
              <button className="btn btn-primary" disabled={busy || tooManyBack || invalid}
                onClick={() => go(-n)}>
                {busy ? '…' : t(usingAll ? 'vote.takeBackAll' : 'vote.takeBack', { n: Math.max(1, n) })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
