import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDailySpinStatus, performDailySpin, hasSupabase } from '../lib/db'
import {
  DAILY_SPIN_LIMIT, SPIN_REWARDS, SPIN_TIME_ZONE, rewardOdds,
  spinCountdown, spinRotation, spinSectorIndex, spinSectors, spinTicks, spinTier,
  dragTicks, DRAG_MIN_DEG, DRAG_TICK_GAP_MS,
} from '../lib/dailySpin'
import {
  SPIN_SYNC_KEY, readPendingSpin, getPendingSpin, clearPendingSpin,
  announceSpinChange, withSpinLock, resetSpinDevice,
} from '../lib/spinDevice'
import { useI18n, errMsg } from '../lib/i18n.jsx'
import { sfx } from '../lib/sfx'
import './DailySpin.css'

const C = 200            // disc centre in viewBox units
const FACE = 186         // sector radius, inside the bezel band
const LABEL = 120        // radius of the prize numbers
const round = n => Math.round(n * 100) / 100
const point = (angle, radius) => {
  const rad = angle * Math.PI / 180
  return [round(C + radius * Math.sin(rad)), round(C - radius * Math.cos(rad))]
}
/* Lát vẽ theo TÂM Ô, không theo chỉ số: bản vẽ đã xoay cả vòng để dải giải cao
   nhất nằm ở 6 giờ (xem spinSectors), nên chỉ số ô không còn suy ra góc được. */
const sectorAt = (centre, count, radius = FACE) => {
  const half = 180 / count
  const [sx, sy] = point(centre - half, radius)
  const [ex, ey] = point(centre + half, radius)
  return `M${C} ${C} L${sx} ${sy} A${radius} ${radius} 0 0 1 ${ex} ${ey} Z`
}
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const timeOf = iso => new Intl.DateTimeFormat('en-GB', {
  timeZone: SPIN_TIME_ZONE, hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

/* Vòng quay — ĐĨA PHẲNG, NĂM LỚP.
   ---------------------------------------------------------
   Bản trước có 11 lớp: vành, 48 vạch chia độ, đường tóc, 16 lát nhuộm 12 sắc
   độ khác nhau, nan hoa, số, viền lát trúng, cung ăn mừng ngoài vành, trục +
   mũi chỉ + chấm, con trỏ, chùm hạt. Nhìn thì "nhiều chi tiết" nhưng mắt không
   biết bám vào đâu, và ba dấu hiệu cùng nói một chuyện (trúng ô nào) là hai
   dấu thừa. Bản này giữ đúng những gì làm nên một cái bánh xe:

     1. vành: một dải phẳng + một đường tóc ngoài (không quầng sáng);
     2. 16 lát: HAI tông phẳng xen kẽ (--w-1 / --w-2) để mắt đếm được lát, và
        DUY NHẤT lát giải cao nhất tô bằng --a — một điểm nhấn, đúng chỗ. Hai
        tông xen kẽ đã tự kẻ ranh giới từng lát, nên KHÔNG cần nan hoa: một
        đường kẻ từ trục ra vành chỉ làm cái bánh xe trông như nan hoa xe đạp;
     3. số thưởng: chữ mono màu chữ thường; riêng ô giải cao nhất chữ trắng,
        lớn hơn một bậc;
     4. trục: MỘT đĩa phẳng nhỏ (bỏ mũi chỉ và chấm — con trỏ ở vành đã trả lời
        "kim đang chỉ đâu");
     5. con trỏ: một mũi ở 12 giờ, GÕ theo đúng nhịp vạch mà tiếng tách đang
        phát (xem drivePointer) thay vì rung đều như đồng hồ.

   Trúng thưởng chỉ còn MỘT dấu: mọi lát tối đi, lát trúng được viền trắng và
   số nảy lên một nhịp. Bỏ cung ngoài vành, bỏ lớp viền thứ hai — cùng một sự
   thật thì chỉ cần nói một lần.

   Toàn bộ vẫn 100% phẳng: không gradient, không quầng sáng, không ảnh, không
   logo trong trục. */
const HUB = 26             // bán kính trục

function Wheel({ sectors, rotation, duration, spinning, won, label, pointerRef, wrapRef, discRef, drag }) {
  const count = sectors.length
  /* KÉO ĐĨA — thao tác quen tay nhất của một bánh xe thưởng.
     Ba quyết định, và lý do của từng cái:

     · CHUỘT VÀ BÚT, KHÔNG PHẢI NGÓN TAY. Trên máy cảm ứng, kéo một ngón ở giữa
       màn hình là cuộn trang; cướp thao tác đó để quay thì trang khó dùng hơn
       hẳn, đổi lại chỉ thêm một cách quay trong khi nút quay 46px đã nằm ngay
       dưới đĩa. Vì vậy `pointerType === 'touch'` được nhường lại cho việc cuộn.
     · PHẦN KÉO ĐƯỢC ĐẶT Ở LỚP BỌC, KHÔNG ĐẶT Ở ĐĨA. Đĩa đã có transform do
       React đặt (nhịp quay 4,5s của CSS bám vào chính nó). Lớp bọc giữ phần
       xoay của TAY, nên lúc nhả ra chỉ cần cộng dồn phần đã kéo vào góc thật
       rồi giao lại — đĩa không nhảy về vị trí cũ trước khi quay.
     · NHẢ RA MỚI QUAY, và kết quả vẫn do máy chủ quyết định. Kéo chỉ là cách
       bấm nút cho vui tay, không phải cách gian lận: dưới 40° coi như chạm hụt
       và đĩa trả về chỗ cũ. */
  const canDrag = drag.enabled
  return (
    <div ref={wrapRef}
      className={`spin-wheel-wrap${spinning ? ' is-spinning' : ''}${won === null ? '' : ' has-won'}${canDrag ? ' can-drag' : ''}`}
      role="img" aria-label={label}
      onPointerDown={canDrag ? drag.down : undefined}
      onPointerMove={canDrag ? drag.move : undefined}
      onPointerUp={canDrag ? drag.up : undefined}
      onPointerCancel={canDrag ? drag.up : undefined}>
      <svg ref={discRef} className="spin-wheel-disc" viewBox="0 0 400 400" aria-hidden="true"
        style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${duration}ms` }}>
        <circle cx={C} cy={C} r="195" className="spin-wheel-rim" />
        <circle cx={C} cy={C} r="199.5" className="spin-wheel-edge" />
        {sectors.map((s, i) => (
          /* Màu = MỨC THƯỞNG, và nay là MỘT THANG đi lên: ô +1 là nền chìm, +2
             pha nhạt, +3 đậm hơn, +5 đúng màu nhấn. Trước đây ô lẻ trong mỗi
             dải còn được tô nhạt hơn (`.weave`) để "đếm được từng ô" — nhưng
             chính nó làm mặt đĩa lốm đốm hai tông xen kẽ nhau, đọc ra như lỗi
             tô màu. Ranh giới giữa các ô nay do MỘT nét mảnh màu nền vẽ ra
             (xem .spin-sector trong DailySpin.css): đúng cách một bánh xe
             thưởng thật được chia ô — nhìn là biết có 16 ô, mà không thêm một
             lớp trang trí nào. */
          <path key={i}
            className={`spin-sector ${s.tier}${won === i ? ' is-won' : ''}`}
            d={sectorAt(s.angle, count)} />
        ))}
        {sectors.map((s, i) => {
          /* MỘT nhãn cho MỘT dải, in ở ô giữa dải. Nhãn chỉ là con số thưởng
             ("+1", "+2"…): số ô của dải đã hiện ra bằng CHÍNH ĐỘ DÀI CUNG của
             dải — dải +1 chiếm hơn nửa vòng, dải +5 đúng một ô. Bản trước in
             thêm "×9" ngay dưới số, nên mặt đĩa đọc như một bảng dữ liệu chứ
             không phải một bánh xe; tỉ lệ chính xác vẫn còn nguyên trong nhãn
             đọc được của cả đĩa (spin.wheelLabel). */
          if (!s.label) return null
          const [x, y] = point(s.angle, LABEL)
          // Turn the lower half upright so no prize number hangs upside down.
          const flip = s.angle > 90 && s.angle < 270 ? 180 : 0
          const lit = won !== null && sectors[won].reward === s.reward
          return <text key={i} className={`spin-wheel-number${s.tier === 't4' ? ' jackpot' : ''}${lit ? ' is-won' : ''}`}
            x={x} y={y} transform={`rotate(${s.angle + flip} ${x} ${y})`}
            textAnchor="middle" dominantBaseline="central">
            <tspan className="spin-wheel-plus">+</tspan>{s.reward}
          </text>
        })}
        {won !== null && <path className="spin-wheel-marker" d={sectorAt(sectors[won].angle, count)} />}
        <circle cx={C} cy={C} r={HUB} className="spin-wheel-hub" />
      </svg>
      <span className="spin-wheel-pointer" aria-hidden="true">
        {/* ref để JS gõ con trỏ theo nhịp vạch thật — xem drivePointer() */}
        <svg ref={pointerRef} width="28" height="34" viewBox="0 0 28 34">
          <path d="M14 31 3 7.2Q1.2 3.4 5.2 3.4h17.6q4 0 2.2 3.8Z" />
        </svg>
      </span>
      {/* Chùm hạt ăn mừng: MỘT màu (nhấn phụ), mười hạt, nổ đúng một lần khi
          đĩa dừng. Nhiều màu + nhiều hạt là tiệc tùng, không phải phần thưởng. */}
      {won !== null && !spinning && (
        <span className="spin-burst" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--ang': `${i * 36}deg` }} />)}
        </span>
      )}
    </div>
  )
}

/* Two spare spins shown as a bar, not only as a number: at a glance you can see
   whether today is still open. */
function Pips({ remaining, limit }) {
  return <span className="spin-pips" aria-hidden="true">
    {Array.from({ length: limit }, (_, i) => <i key={i} className={i < remaining ? 'on' : ''} />)}
  </span>
}

export default function DailySpin({ userId, credits, purchased, bonus, onBalance, onVote }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Lỗi thuộc về token thiết bị: hiện thêm nút tự cấp lại (xem spinDevice.js).
  const [deviceBroken, setDeviceBroken] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [result, setResult] = useState(null)
  const [pending, setPending] = useState(() => !!readPendingSpin(userId))
  const [rotation, setRotation] = useState(0)
  // Con so duoc giu yen khi dia quay dang chay (giao dich da xong nhung khong
  // spoils ket qua). Giu ca ba gia tri: tong, vote da mua, bonus.
  const [held, setHeld] = useState({ credits, purchased, bonus })
  const [activeRequest, setActiveRequest] = useState(null)
  const [duration, setDuration] = useState(0)
  const [clock, setClock] = useState(() => performance.now())
  const [deadline, setDeadline] = useState(null)
  const busy = useRef(false)
  const mounted = useRef(false)
  const readVersion = useRef(0)
  const finishTimer = useRef(null)
  const stopTicks = useRef(null)
  const angle = useRef(0)   // góc hiện tại, đọc được ngoài render (updater có thể chạy 2 lần)
  const pointerRef = useRef(null)
  const wrapRef = useRef(null)
  const discRef = useRef(null)
  const dragRef = useRef(null)
  const pointerRaf = useRef(0)
  const pointerTimer = useRef(0)

  /* CON TRỎ GÕ THEO NHỊP THẬT.
     ---------------------------------------------------------
     `spinTicks()` đã tính sẵn thời điểm từng vạch đi qua con trỏ (cùng đường
     cong với transition của CSS), và `sfx.spinTicks` phát tiếng tách đúng ở
     những mốc đó. Trước đây con trỏ chỉ rung đều 0,15s vô hạn — mắt thấy một
     nhịp KHÁC với tai nghe, nên cả hai đều giả. Nay mỗi lần một vạch đi qua,
     con trỏ nhích đúng lúc: một vòng quay có "vật lý" thay vì một hiệu ứng.
     Chạy bằng requestAnimationFrame (không tạo 100 timer), và tự dừng khi hết
     nhịp hoặc khi component bị tháo. */
  const drivePointer = (ticks, ms) => {
    const el = pointerRef.current
    if (!el || !ticks.length || reducedMotion()) return
    cancelAnimationFrame(pointerRaf.current)
    const t0 = performance.now()
    let i = 0
    const step = (now) => {
      const t = now - t0
      let hit = false
      while (i < ticks.length && ticks[i].at * 1000 <= t) { i++; hit = true }
      if (hit) {
        el.style.transform = 'rotate(-7deg)'
        clearTimeout(pointerTimer.current)
        pointerTimer.current = setTimeout(() => { el.style.transform = '' }, 55)
      }
      if (t < ms + 120 && i < ticks.length) pointerRaf.current = requestAnimationFrame(step)
    }
    pointerRaf.current = requestAnimationFrame(step)
  }
  const stopPointer = () => {
    cancelAnimationFrame(pointerRaf.current)
    clearTimeout(pointerTimer.current)
    if (pointerRef.current) pointerRef.current.style.transform = ''
  }

  const applyStatus = useCallback(next => {
    if (next?.user_id !== userId) throw new Error('err.spinAccountChanged')
    /* Mốc giờ để tự nạp lại lúc nửa đêm của server: `server_now` có thể thiếu
       (gate cũ) hoặc hỏng (payload lạ) — lấy giờ máy khách làm mốc, và nếu vẫn
       không ra con số thì GIỮ hẹn cũ chứ đừng set NaN: NaN giết luôn cái timer
       ở dưới và in chữ rác lên ô đếm ngược. */
    const ref = Number.isFinite(+new Date(next.server_now)) ? +new Date(next.server_now) : Date.now()
    const left = +new Date(next.reset_at) - ref
    if (Number.isFinite(left)) setDeadline(performance.now() + Math.max(0, left))
    setClock(performance.now())
    setStatus(next)
    onBalance(next)
  }, [userId, onBalance])

  const load = useCallback(async () => {
    if (busy.current) return
    const version = ++readVersion.current
    try {
      const next = await fetchDailySpinStatus()
      if (!mounted.current || readVersion.current !== version || busy.current) return
      applyStatus(next)
      setError(next.device_account_blocked ? t('err.spinDeviceAccount') : '')
      setDeviceBroken(false)
      setPending(!!readPendingSpin(userId))
    } catch (e) {
      if (mounted.current && readVersion.current === version) {
        setError(errMsg(t, e))
        setDeviceBroken(['err.spinDevice', 'err.spinStorage'].includes(e?.message))
      }
    } finally {
      if (mounted.current && readVersion.current === version) setLoading(false)
    }
  }, [userId, t, applyStatus])

  useEffect(() => {
    mounted.current = true
    // Defer the initial fetch until the effect setup/StrictMode cleanup settles.
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (!document.hidden) load() }
    const storage = e => { if (e.key === SPIN_SYNC_KEY) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', refresh)
    const tick = setInterval(() => setClock(performance.now()), 1000)
    const poll = setInterval(refresh, 60_000)
    return () => {
      mounted.current = false
      clearTimeout(finishTimer.current)
      stopTicks.current?.(); stopTicks.current = null
      stopPointer()
      clearInterval(tick); clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  useEffect(() => {
    if (deadline === null) return
    const id = setTimeout(() => load(), Math.max(500, deadline - performance.now() + 100))
    return () => clearTimeout(id)
  }, [deadline, load]) // server midnight, also refreshed on focus / every minute

  const spin = async () => {
    if (busy.current || !status || (!status.remaining && !pending)) return
    busy.current = true
    ++readVersion.current // a stale status read must not overwrite the committed result
    setLoading(false); setPhase('requesting'); setError(''); setResult(null)
    setHeld({ credits, purchased, bonus }); setActiveRequest(null)
    sfx.spinGo()
    let requestId
    try {
      requestId = await withSpinLock(`ccl.spin.pending.${userId}`, () => getPendingSpin(userId))
      setPending(true); setActiveRequest(requestId)
      const data = await performDailySpin(requestId, userId)
      clearPendingSpin(userId, requestId)
      announceSpinChange()
      // The parent guards user_id too: late responses after sign-out must never
      // update a different account's balance. The credit is already committed.
      if (!mounted.current) { onBalance(data.status); return }
      applyStatus(data.status)
      setPending(!!readPendingSpin(userId))
      const ms = reducedMotion() || data.replayed ? 0 : 4500
      setDuration(ms)
      /* `rewards` là bảng ô do MÁY CHỦ trả về. Bản deploy cũ (hoặc một hàm SQL
         chưa cập nhật) có thể trả payload thiếu khoá này — đọc thẳng là
         TypeError giữa lúc quay, người dùng mất lượt mà không thấy gì. Thiếu
         thì rơi về đúng 16 ô mặc định. */
      const rewards = data.status?.rewards?.length ? data.status.rewards : SPIN_REWARDS
      /* Chỉ số server trả về thuộc BẢNG RÚT; bản vẽ gom ô cùng thưởng thành
         dải nên phải quy đổi sang ô trên bản vẽ, kẻo kim dừng ở ô khác với ô
         được tô sáng. */
      const winIndex = spinSectorIndex(data.spin.segment, rewards)
      const next = spinRotation(angle.current, spinSectors(rewards)[winIndex].angle)
      const travel = next - angle.current
      angle.current = next
      setRotation(next)
      setPhase('spinning')
      // Tiếng tách bám đúng đường cong CSS: xếp lịch một lần, không dùng timer.
      // Cùng mảng mốc đó nuôi luôn con trỏ — tai và mắt nghe/thấy một nhịp.
      stopTicks.current?.()
      const ticks = ms ? spinTicks(travel, rewards.length, ms) : []
      stopTicks.current = ticks.length ? sfx.spinTicks(ticks) : null
      drivePointer(ticks, ms)
      const top = Math.max(...rewards)
      finishTimer.current = setTimeout(() => {
        if (!mounted.current) return
        stopTicks.current = null
        stopPointer()
        setResult(data.spin); setPhase('idle'); busy.current = false
        sfx.spinWin(data.spin.reward >= top)
        load() // reconcile other tabs, or midnight passed during the animation
      }, ms ? ms + 80 : 0)
    } catch (e) {
      // Known SQL rejections rolled back, so there is nothing to recover. Keep
      // the same ID for network/unknown errors: it may have committed already.
      if (e?.code === 'P0001' || [
        'err.spinDeviceLimit', 'err.spinAccountLimit', 'err.spinAccountChanged', 'err.spinDeviceAccount',
        'err.spinDevice', 'err.spinRequest', 'err.signin', 'err.spinSetup',
        // Edge từ chối trước khi chạm database: không có ledger để retry.
        'err.spinEdgeFp', 'err.spinEdgeIp', 'err.spinCaptcha', 'err.spinFingerprint',
      ].includes(e?.message)) clearPendingSpin(userId, requestId)
      busy.current = false
      stopTicks.current?.(); stopTicks.current = null
      stopPointer()
      if (!mounted.current) return
      setPhase('idle'); setError(errMsg(t, e)); setPending(!!readPendingSpin(userId))
      setDeviceBroken(['err.spinDevice', 'err.spinStorage'].includes(e?.message))
      sfx.error()
      load()
    }
  }

  const rewards = status?.rewards || SPIN_REWARDS
  const sectors = useMemo(() => spinSectors(rewards), [rewards])
  const remaining = status?.remaining ?? 0
  const limit = status?.limit || DAILY_SPIN_LIMIT
  const active = phase !== 'idle'

  /* ---------- KÉO ĐĨA (xem chú thích dài trong `Wheel`) ---------- */
  const canDrag = !active && !loading && !!status && (!!remaining || pending)
  /* Góc của con trỏ quanh TÂM đĩa, tính bằng độ. Tâm lấy từ hộp bao của lớp
     bọc — vòng tròn nằm trọn trong đó nên tâm hình học cũng là tâm đĩa — và
     hộp bao được ĐỌC MỘT LẦN lúc bấm: cuộn trang giữa chừng sẽ làm mọi phép
     `getBoundingClientRect()` sau đó lệch đi, còn con trỏ thì vẫn báo toạ độ
     màn hình. */
  const pointerAngle = (e, box) => Math.atan2(
    e.clientY - (box.top + box.height / 2),
    e.clientX - (box.left + box.width / 2),
  ) * 180 / Math.PI

  const dragDown = (e) => {
    if (e.pointerType === 'touch' || reducedMotion() || dragRef.current || !canDrag) return
    const el = wrapRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    dragRef.current = {
      id: e.pointerId, box,
      prev: pointerAngle(e, box),
      turned: 0, tickAt: 0, last: performance.now(), lastTick: 0,
    }
    el.classList.add('dragging')
    try { el.setPointerCapture?.(e.pointerId) } catch { /* jsdom, hoặc pointer đã mất */ }
  }

  const dragMove = (e) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    const at = pointerAngle(e, d.box)
    /* Chênh lệch đi vòng qua mốc ±180° (con trỏ vượt qua phía sau đĩa) phải co
       lại thành bước ngắn nhất, nếu không một lần vượt mốc là cả vòng quay. */
    let step = at - d.prev
    if (step > 180) step -= 360
    else if (step < -180) step += 360
    if (!step) return
    d.prev = at
    d.turned += step
    const el = wrapRef.current
    if (el) el.style.transform = `rotate(${d.turned}deg)`

    /* TIẾNG TÁCH theo từng vạch đi qua — cùng cơ chế với lúc máy quay, chỉ
       khác nhịp do TAY quyết định. Có sàn thời gian 45ms: kéo mạnh một cái
       (một lần nhích đi cả trăm độ) cũng không thành tràng "tạch tạch". */
    const now = performance.now()
    if (now - d.lastTick < DRAG_TICK_GAP_MS) { d.last = now; return }
    const { count, gain } = dragTicks(d.tickAt, d.turned, { ms: now - d.last })
    d.tickAt = d.turned
    d.last = now
    const n = Math.min(3, Math.abs(count))
    if (!n) return
    d.lastTick = now
    for (let i = 0; i < n; i++) setTimeout(() => sfx.spinTicks([{ at: 0, gain }]), i * 30)
  }

  const dragUp = (e) => {
    const d = dragRef.current
    if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.id)) return
    dragRef.current = null
    const el = wrapRef.current
    el?.classList.remove('dragging')
    try { el?.releasePointerCapture?.(d.id) } catch { /* xem dragDown */ }
    if (!el) return

    if (Math.abs(d.turned) >= DRAG_MIN_DEG && canDrag) {
      /* Giao lại ĐÚNG chỗ mắt đang nhìn: cộng phần vừa kéo vào góc thật, đặt
         luôn transform của đĩa theo góc mới, rồi trả lớp bọc về 0. Hai dòng
         ghi liền nhau trước khi trình duyệt kịp vẽ lại, nên không có nhịp
         "nhảy về chỗ cũ" nào ở giữa. */
      angle.current += d.turned
      el.style.transition = 'none'
      el.style.transform = ''
      if (discRef.current) discRef.current.style.transform = `rotate(${angle.current}deg)`
      spin()
      /* Trả nhịp đàn hồi lại cho lớp bọc ở khung hình sau — xoá ngay trong cùng
         khung này thì trình duyệt gộp hai lần ghi và bỏ luôn việc tắt transition. */
      requestAnimationFrame(() => { el.style.transition = '' })
      return
    }
    /* Kéo hụt: đĩa trả về chỗ cũ bằng một nhịp ngắn, để tay thấy là chưa đủ. */
    el.style.transform = ''
  }

  // The transaction is already committed, but do not spoil the result while
  // the wheel is still moving. Leaving the page never loses the real credit.
  const history = (status?.history || []).filter(item => !active || item.request_id !== activeRequest)
  // Dang quay thi giu nguyen con so (giao dich da xong nhung khong spoils ket
  // qua); dung lai thi lay theo status server vua tai. Backend cu chi tra tong
  // credits, khong co purchased/bonus: hien 0 cho on dinh bo cuc.
  const shown = active ? held : {
    credits: status?.credits ?? credits ?? 0,
    purchased: status?.purchased ?? purchased ?? 0,
    bonus: status?.bonus ?? bonus ?? 0,
  }
  const won = result ? spinSectorIndex(result.segment, rewards) : null
  const buttonLabel = phase === 'requesting' ? 'spin.requesting'
    : phase === 'spinning' ? 'spin.spinning'
    : loading ? 'spin.loading' : pending ? 'spin.recover'
    : status && !remaining ? 'spin.finished' : 'spin.action'

  return (
    <section className="daily-spin" aria-label={t('spin.playLabel')}>
      <header className="spin-head">
        <div className="spin-head-text">
          <h2>{t('spin.playLabel')}</h2>
          {/* Dòng "mỗi lượt thắng trung bình 1,75 vote" đã bị GỠ (vòng 12): con
              số trung bình không giúp ai quyết định bấm hay không, mà nó lại
              đứng ở vị trí đắt nhất của trang — ngay dưới tiêu đề, chỗ mắt đọc
              đầu tiên. Việc của đầu trang là MỘT lời mời bấm, không phải một
              bảng thống kê. Nhãn demo ở lại (nó nói dữ liệu này là dữ liệu
              mẫu, một điều người dùng PHẢI biết), và khi không có nhãn thì cả
              dòng phụ không được dựng — không để lại một thẻ rỗng. */}
          {!hasSupabase && (
            <p><span className="spin-demo" role="note">{t('spin.demo')}</span></p>
          )}
        </div>
        <div className="spin-reset" title={t('spin.ruleReset')}>
          <span>{t('spin.resetIn')}</span>
          <b>{status ? spinCountdown(deadline - clock) : '--:--:--'}</b>
        </div>
      </header>

      <div className="spin-stage">
        <div className="spin-dial">
          <Wheel sectors={sectors} rotation={rotation} duration={duration} spinning={phase === 'spinning'}
            pointerRef={pointerRef} wrapRef={wrapRef} discRef={discRef}
            drag={{ enabled: canDrag, down: dragDown, move: dragMove, up: dragUp }}
            won={won} label={t('spin.wheelLabel', {
              n: rewards.length,
              odds: rewardOdds(rewards).map(o => `${o.count}× +${o.reward}`).join(', '),
            })} />

          {/* Keep reward colours, without probability/count labels. */}
          <ul className="spin-legend" aria-label={t('spin.legendAria')}>
            {rewardOdds(rewards).map(o => (
              <li key={o.reward} className={o.tier}>
                <i aria-hidden="true" />
                <b>+{o.reward}</b>
              </li>
            ))}
          </ul>

          <div className="spin-cta" aria-busy={active || loading}>
            <button type="button" className="btn btn-primary spin-button" onClick={spin}
              disabled={active || loading || !status || (!remaining && !pending)}>
              {t(buttonLabel)}
            </button>

            <div className={`spin-result${result ? ' won' : ''}`} role="status" aria-live="polite" aria-atomic="true">
              {result
                ? <><strong key={result.reward} className="spin-won-num">{t(result.reward === 1 ? 'spin.wonOne' : 'spin.won', { n: result.reward })}</strong>
                  <small>{t('spin.wonNote')}</small></>
                : null}
            </div>
          </div>

          {pending && !active && <p className="spin-pending">{t('spin.pending')}</p>}
          {error && <div className="spin-error" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-sm" disabled={loading || active}
              onClick={() => { setLoading(true); setError(''); load() }}>{t('spin.refresh')}</button>
            {/* Token trình duyệt hỏng thì "Try again" không bao giờ thoát được:
                cho người dùng tự cấp lại thay vì bắt liên hệ hỗ trợ. */}
            {deviceBroken && (
              <button type="button" className="btn btn-sm" title={t('spin.deviceResetHint')}
                disabled={active}
                onClick={() => { resetSpinDevice(); window.location.reload() }}>
                {t('spin.deviceReset')}
              </button>
            )}
          </div>}
        </div>

        <aside className="spin-panel">
          <div className="spin-metrics">
            <div className="spin-metric spin-remaining">
              <span>{t('spin.available')}</span>
              <b>{status ? remaining : '–'}<small> / {limit}</small></b>
              <Pips remaining={status ? remaining : 0} limit={limit} />
            </div>
            <div className="spin-metric spin-purchased">
              <span>{t('vote.purchased')}</span>
              <b>{shown.purchased}<small>{t('spin.votes')}</small></b>
            </div>
            <div className="spin-metric spin-bonus">
              <span>{t('vote.bonus')}</span>
              <b>{shown.bonus}<small>{t('spin.votes')}</small></b>
            </div>
          </div>

          {/* Hai dòng, không phải ba: mốc reset đã nằm ở chip đếm ngược trên
              đầu khối — nói lại lần nữa là chỗ dư thừa dễ thấy nhất của trang. */}
          <ul className="spin-rules" aria-label={t('spin.rules')}>
            <li>{t('spin.ruleLimit', { n: limit })}</li>
            <li>{t('spin.ruleCredit')}</li>
          </ul>

          <div className="spin-history">
            <div className="spin-history-head">
              <h3>{t('spin.history')}</h3>
              <button type="button" className="spin-vote-link" onClick={onVote}>
                {t('spin.useVotes')} <span aria-hidden="true">→</span>
              </button>
            </div>
            {history.length ? <ul>
              {/* Mỗi dòng mang HẠNG của phần thưởng (cùng tông với dải trên
                  đĩa): nhìn lịch sử là thấy ngay hôm nay có trúng giải cao
                  nhất hay không, không phải đọc từng con số. */}
              {history.map(item => <li key={item.request_id} className={spinTier(item.reward, rewards)}>
                <b>{t(item.reward === 1 ? 'spin.rewardOne' : 'spin.reward', { n: item.reward })}</b>
                <time dateTime={item.created_at} title={t('spin.addedAt', { time: timeOf(item.created_at) })}>{timeOf(item.created_at)}</time>
              </li>)}
            </ul> : <p>{t('spin.historyEmpty')}</p>}
            {/* Tổng của chính danh sách bên trên — con số duy nhất trên trang
                cộng từ dữ liệu thật, và là câu trả lời cho "hôm nay được gì". */}
            {history.length > 0 && (
              <p className="spin-total">{t('spin.todayTotal', {
                n: history.reduce((sum, item) => sum + item.reward, 0),
              })}</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
