import { MILESTONES } from '../lib/db'

/* =========================================================
   BA NHỊP TIẾN ĐỘ — thay cho thanh phần trăm trong một hàng request
   ---------------------------------------------------------
   Một yêu cầu không tiến đều: nó có đúng ba việc có tên (Layout · Lyrics ·
   Edit, xem `MILESTONES`). Con số "47%" bắt người đọc tự dịch ngược lại xem
   đang ở việc thứ mấy; ba vạch thì trả lời thẳng — vạch đầy là việc đã xong.

   Vì sao mỗi vạch có phần tô riêng thay vì chỉ bật/tắt: trọng số ba việc là
   40/40/20, nên 47% KHÔNG phải "một việc rưỡi" mà là việc thứ hai mới được
   17% (47−40 trên 40). Tô đúng tỉ lệ đó thì vạch thứ hai hiện ra một đoạn
   ngắn — đọc được "đang làm dở", thay vì nhảy cóc sang nửa vạch.

   Con số "n/3" đứng sau ba vạch là bản dịch của hình sang chữ, cho người đọc
   bằng trình đọc màn hình và cho người không phân biệt được độ dài đoạn tô.
   aria-valuenow vẫn là phần trăm thật — hình đổi, nghĩa không đổi.
   ========================================================= */
export default function Steps({ pct, label }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))
  /* Biên của từng việc suy TỪ `MILESTONES`, không viết cứng 40/80: đổi trọng
     số trong db.js là ba vạch đi theo. */
  const segs = []
  let from = 0
  for (const m of MILESTONES) {
    const to = from + m.pct
    const fill = to === from ? 0 : Math.max(0, Math.min(100, ((v - from) / (to - from)) * 100))
    segs.push({ k: m.k, label: m.label, fill })
    from = to
  }
  const done = segs.filter((s) => s.fill >= 100).length
  return (
    <span className="nhip" role="progressbar" aria-valuenow={v} aria-valuemin={0}
      aria-valuemax={100} aria-label={label}
      title={MILESTONES.map((m, i) => `${m.label}${segs[i].fill >= 100 ? ' ✓' : ''}`).join(' · ')}>
      {segs.map((s) => (
        <span key={s.k} className="nhip-seg" aria-hidden="true">
          <i style={{ '--w': `${s.fill}%` }} />
        </span>
      ))}
      <b className="nhip-n" aria-hidden="true">{done}/{segs.length}</b>
    </span>
  )
}
