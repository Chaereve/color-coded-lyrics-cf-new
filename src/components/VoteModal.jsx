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
export default function VoteModal({
  open, request, myCount = 0, votesLeft = 0,
  /* Hai nguồn phiếu ngoài quỹ miễn phí (đã mua / được thưởng) — hộp vote nói
     được "số phiếu này lấy từ đâu". Mặc định 0 để hộp vẫn dựng được một mình
     trong test và ở chỗ gọi chưa truyền. */
  purchased = 0, bonus = 0,
  onClose, onVote, onBuy,
}) {
  const { t } = useI18n()
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  /* Trần số phiếu chọn được: số phiếu đang có, tối đa 100. Tính ở ĐẦU thân hàm
     vì bộ bắt phím ngay dưới cần nó — để cuối thì effect chạm vào biến chưa tới
     lượt khai báo và cả hộp vote ném lỗi ngay khi mở. */
  const addMax = Math.max(1, Math.min(MAX, votesLeft))

  useEffect(() => {
    if (!open) return
    setQty(1); setErr(null); setBusy(false)
  }, [open, request])

  /* BÀN PHÍM của hộp vote: Esc đóng (đã có), và `+` / `-` (hoặc mũi lên/xuống)
     chỉnh số phiếu mà không phải rời mắt khỏi con số lớn. Người gửi nhiều bài
     liên tiếp làm việc này hàng chục lần một buổi — mỗi lần với tay xuống ô nhập
     là một lần chậm. Khi con trỏ đang ở TRONG ô nhập thì nhường phím lại cho ô
     (mũi lên/xuống ở đó đã là tăng/giảm của trình duyệt, bắt thêm là nhân đôi). */
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
  const picked = isPicked(req)             // đã vào Up next: khóa cả vote lẫn rút
  /* CHỈ bài đang trong hàng mới vote được. Trước đây hộp thoại chỉ chặn bài
     đã chốt, nên một bài đã xong / bị từ chối / còn chờ duyệt mà lọt vào được
     (ví dụ từ link cũ hoặc từ hàng đợi vừa đổi trạng thái trong lúc hộp đang
     mở) vẫn hiện bảng chọn phiếu và cho bấm — người dùng gửi đi một phiếu mà
     hệ thống từ chối, và không hiểu vì sao. Cùng điều kiện với `canVote` ở
     App.jsx: đang chờ hoặc đang làm, và chưa chốt. */
  const openForVotes = !picked && (req.status === 'queued' || req.status === 'in_progress')
  const locked = !openForVotes
  const closedMsg = picked ? 'vote.locked' : 'vote.closed'
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

  /* Dãy chọn nhanh: bốn mức người ta thật sự dùng (1 phiếu để thử, 5 và 10 là
     hai mức phổ biến, "tất cả" cho người đã quyết). Con số nào vượt quá số
     phiếu đang có thì KHÔNG hiện — một nút bấm vào là báo lỗi thì thà đừng có. */
  const presets = [1, 5, 10, 25].filter(v => v <= addMax)
  const after = locked ? req.votes : req.votes + n
  const leftAfter = Math.max(0, votesLeft - n)
  const changing = busy

  return (
    <div className={`overlay vote-overlay${out}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal narrow${out}`} role="dialog" aria-modal="true" aria-label={t('vote.dialogTitle')}>
        <div className="modal-head">
          <div className="modal-tabs"><span className="mtab on">{t('vote.dialogTitle')}</span></div>
          <button className="x" onClick={onClose} aria-label={t('btn.close')}><Icon name="close" size={15} /></button>
        </div>

        <div className="modal-body">
          {/* Bài đang vote — tên bài là thứ DUY NHẤT người dùng cần xác nhận
              trước khi bấm, nên nó đứng trên mọi con số. */}
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
            <div className="msg err" style={{ marginTop: 16 }}>{t(closedMsg)}</div>
          ) : (
            <>
              {/* KẾT QUẢ SAU KHI BẤM — con số lớn nhất trong hộp, vì "bài này
                  sẽ có bao nhiêu phiếu" mới là điều người dùng đang quyết.
                  Con số cũ (tổng hiện tại) chỉ là dòng phụ bên dưới. */}
              <div className="vm-hero" style={{ marginTop: 14 }}>
                <span className="k">{t('vote.hero')}</span>
                {/* Con số này đổi theo từng lần bấm mức nhanh hoặc chỉnh ô số, và
                    nó là KẾT QUẢ của việc đang làm — nên phải được đọc lên,
                    không chỉ đổi màu. */}
                <span key={after} className={`v${changing ? '' : ' pop'}`} aria-live="polite">{after}</span>
                <span className="u">{t('vote.heroSub', { n: req.votes })}</span>
              </div>

              <div className="vm-presets" role="group" aria-label={t('vote.qty')}>
                {presets.map(v => (
                  <button key={v} type="button" className={`vm-preset${n === v ? ' on' : ''}`}
                    aria-pressed={n === v} disabled={busy} onClick={() => setQty(v)}>{v}</button>
                ))}
                {votesLeft > 1 && (
                  <button type="button" className={`vm-preset${n === votesLeft ? ' on' : ''}`}
                    aria-pressed={n === votesLeft} disabled={busy}
                    onClick={() => setQty(votesLeft)}>{t('vote.useAll', { n: votesLeft })}</button>
                )}
              </div>

              <div className="field" style={{ marginTop: 6, marginBottom: 0 }}>
                <label htmlFor="vm-qty">{t('vote.qty')}</label>
                <div className="vm-row">
                  <div className="qty">
                    <button type="button" onClick={() => setQty(q => Math.max(1, Number(q) - 1))}
                      disabled={busy} aria-label="−"><Icon name="minus" size={15} /></button>
                    <input id="vm-qty" type="number" min="1" max={MAX} value={qty} disabled={busy}
                      aria-describedby="vm-after"
                      onChange={e => setQty(e.target.value)}
                      onBlur={() => setQty(q => Math.max(1, Math.min(MAX, Math.trunc(Number(q)) || 1)))}
                      onKeyDown={e => { if (e.key === 'Enter' && !tooMany && !invalid && !busy) go(n) }} />
                    <button type="button" onClick={() => setQty(q => Math.min(MAX, Number(q) + 1))}
                      disabled={busy} aria-label="+"><Icon name="plus" size={15} /></button>
                  </div>
                </div>
                {/* TÓM TẮT TRƯỚC – SAU, MỘT DÒNG: "còn 7 → còn 3" trả lời câu
                    "bấm nút này thì tôi mất gì". Phần nguồn phiếu (mua / thưởng)
                    viết bằng chữ ngay sau đó — vòng 10 dựng thêm ba ô có viền và
                    một vạch chia tỉ lệ cho cùng câu trả lời ấy, và hộp vote đọc ra
                    thành "quá rối". */}
                <div className="vm-after" id="vm-after">
                  <span>{t('vote.leftBefore', { n: votesLeft })}</span>
                  <span className="arw" aria-hidden="true">→</span>
                  <b className={leftAfter === 0 ? 'bad' : 'good'}>{leftAfter}</b>
                  {(purchased > 0 || bonus > 0) && (
                    <span className="vm-src">{t('vote.sources', { p: purchased, b: bonus })}</span>
                  )}
                </div>
              </div>

              {noVotes && myCount === 0 && <div className="msg err">{t('vote.none')}</div>}
              {!invalid && (tooMany || (myCount > 0 && tooManyBack)) && (
                <div className="msg err">
                  {tooMany && !noVotes && <div>{t('vote.tooMany', { n: votesLeft })}</div>}
                  {noVotes && <div>{t('vote.none')}</div>}
                  {myCount > 0 && tooManyBack && <div>{t('vote.tooManyBack', { n: myCount })}</div>}
                </div>
              )}
            </>
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
