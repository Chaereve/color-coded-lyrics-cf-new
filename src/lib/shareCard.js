/* =========================================================
   SHARE CARD PNG — tự vẽ bằng canvas, không thư viện
   ---------------------------------------------------------
   Mục cuối của bảng kế hoạch: cho mỗi người một TẤM ẢNH chia sẻ được —
   tên, ảnh đại diện, ba con số thật (bài gửi · bài xong · phiếu nhận),
   chuỗi ngày + ba mốc 7/30/100 — đúng khổ og:image 1200×630 để dán lên
   Discord/Telegram/Facebook là ra thẻ đẹp.

   Vì sao vẽ tay thay vì html2canvas/chụp DOM:
   · thêm một dependency nặng chỉ để làm ra MỘT tấm ảnh là đắt;
   · chụp DOM thì card phụ thuộc bố cục màn hình đang mở (màn hẹp ra ảnh
     hẹp), còn vẽ tay thì ảnh luôn đúng khổ, đúng mật độ chữ, kể cả khi
     người bấm đang xem bằng điện thoại;
   · và quan trọng nhất: con số trên ảnh phải là con số ĐANG hiển thị ở
     hồ sơ (cùng nguồn `fetchPublicProfile` / `requester_ranking`), không
     phải một bản sao thứ hai tự tính lại rồi lệch.

   CHỮ TRÊN ẢNH đi qua component truyền xuống dưới dạng chuỗi ĐÃ DỊCH
   (nhãn cột, câu streak, chân trang) — module này không tự ráp chữ, nên
   thêm một ngôn ngữ sau này không phải sờ vào canvas.

   Avatar: fetch về BLOB rồi mới vẽ (blob là same-origin nên canvas không
   bị nhiễm bẩn — toBlob/toDataURL trên canvas nhiễm bẩn CORS sẽ ném
   SecurityError). Fetch trượt (host không cho CORS, mạng lỗi) thì lùi về
   vòng chữ cái đầu, đúng như giao diện hồ sơ vẫn làm.
   ========================================================= */

export const CARD_W = 1200
export const CARD_H = 630

/* Bảng màu mặc định trùng thang token của trang; trình duyệt thì đọc thẳng
   từ CSS custom property để card luôn cùng thương hiệu với giao diện. */
export const DEFAULT_PALETTE = {
  bg: '#0b0e13', panel: '#151a22', line: '#2a3140',
  txt: '#e9edf3', txt3: '#808b9a', a2: '#a9a4ff', flame: '#ff8a4c',
  font: "'Be Vietnam Pro', sans-serif",
  display: "'Archivo Display', 'Be Vietnam Pro', sans-serif",
  mono: "'JetBrains Mono Variable', monospace",
}

/* Ngắt dòng tham lam theo hàm đo bề rộng — tách ra để test được bằng một
   hàm đo giả, không cần canvas thật. */
export function wrapLines(text, maxWidth, measure) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (line && measure(next) > maxWidth) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/* Tên -> mảnh tên file an toàn: bỏ dấu, bỏ ký tự lạ, gọn còn gạch nối.
   'O'Clock Café' -> 'o-clock-cafe'; tên toàn ký tự lạ thì 'member'. */
export function slugName(name) {
  const slug = String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'member'
}

export function cardFilename(name, dayKey) {
  return `chaereve-${slugName(name)}-${dayKey}.png`
}

const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/* Hình chữ nhật bo góc tự vẽ (không dựa ctx.roundRect — trình duyệt cũ và
   vài bản stub test không có nó). */
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

/* =========================================================
   VẼ CARD — ctx đã được scale sẵn về hệ toạ độ 1200×630
   ---------------------------------------------------------
   data: { name, subtitle, avatar (ImageBitmap|null), stats:[{value,label}],
           streakLine (string|null), milestones:[{n,got}]|null,
           footer, stamp }
   Mọi toạ độ đều suy từ CARD_W/CARD_H — không một con số trần nào trôi
   nổi, và test stub sẽ khẳng định KHÔNG một tham số nào là NaN/Infinity
   (một phép đo chữ hụt là đủ để cả tấm ảnh vẽ lệch im lặng).
   ========================================================= */
export function drawShareCard(ctx, data, pal = DEFAULT_PALETTE) {
  const W = CARD_W, H = CARD_H
  const measure = (s) => ctx.measureText(s).width

  /* Nền chính sang trọng */
  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, W, H)

  /* Hộp card chính viền bo góc hiện đại */
  rr(ctx, 40, 40, W - 80, H - 80, 24)
  if (typeof ctx.createLinearGradient === 'function') {
    const bgGrad = ctx.createLinearGradient(40, 40, W - 40, H - 40)
    bgGrad.addColorStop(0, '#151922')
    bgGrad.addColorStop(1, '#0e1218')
    ctx.fillStyle = bgGrad
  } else {
    ctx.fillStyle = pal.panel
  }
  ctx.fill()
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1.5
  ctx.stroke()

  /* Huy hiệu thương hiệu góc trên bên phải */
  const bw = 160, bh = 32, bx = W - 80 - bw - 16, by = 60
  rr(ctx, bx, by, bw, bh, 16)
  ctx.fillStyle = 'rgba(169, 164, 255, 0.08)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(169, 164, 255, 0.25)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = pal.a2
  ctx.font = `700 12px ${pal.mono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('CHAEREVE LYRICS', bx + bw / 2, by + bh / 2)

  /* ---- đầu card: avatar + tên + phụ đề ---- */
  const ax = 136, ay = 142, ar = 50

  /* Vòng sáng quanh avatar */
  ctx.beginPath()
  ctx.arc(ax, ay, ar + 4, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(169, 164, 255, 0.35)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.arc(ax, ay, ar, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  if (data.avatar) {
    ctx.drawImage(data.avatar, ax - ar, ay - ar, ar * 2, ar * 2)
  } else {
    ctx.fillStyle = 'rgba(169, 164, 255, 0.16)'
    ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2)
    ctx.fillStyle = pal.a2
    ctx.font = `700 42px ${pal.display}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(data.name || '?').trim()[0]?.toUpperCase() || '?', ax, ay + 2)
  }
  ctx.restore()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = pal.txt
  ctx.font = `700 42px ${pal.display}`
  const nameLines = wrapLines(data.name, W - 520, measure).slice(0, 2)
  nameLines.forEach((ln, i) => ctx.fillText(ln, 214, 134 + i * 46))
  ctx.fillStyle = pal.txt3
  ctx.font = `400 18px ${pal.font}`
  ctx.fillText(String(data.subtitle || ''), 214, 134 + nameLines.length * 46 + 4)

  /* ---- 3 thẻ số liệu KPI ---- */
  const sy = 280, sh = 114, sw = 328, gap = 26
  ;(data.stats || []).slice(0, 3).forEach((s, i) => {
    const sx = 80 + i * (sw + gap)
    rr(ctx, sx, sy, sw, sh, 16)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)'
    ctx.fill()
    ctx.strokeStyle = pal.line
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = pal.txt
    ctx.font = `700 52px ${pal.mono}`
    ctx.fillText(String(n(s.value)), sx + 22, sy + 58)
    ctx.fillStyle = pal.txt3
    ctx.font = `500 16px ${pal.font}`
    ctx.fillText(String(s.label || ''), sx + 24, sy + 92)
  })

  /* ---- vạch phân cách ---- */
  ctx.strokeStyle = pal.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(80, 424)
  ctx.lineTo(W - 80, 424)
  ctx.stroke()

  /* ---- hàng streak: ba mốc 7/30/100 rồi câu streak ---- */
  if (data.milestones) {
    const my = 478
    data.milestones.slice(0, 3).forEach((m, i) => {
      const x = 80 + i * 92
      rr(ctx, x, my - 24, 78, 48, 24)
      if (m.got) {
        ctx.fillStyle = 'rgba(255, 138, 76, 0.16)'
        ctx.fill()
        ctx.strokeStyle = pal.flame
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = pal.flame
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
        ctx.fill()
        ctx.strokeStyle = pal.line
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = pal.txt3
      }
      ctx.font = `700 20px ${pal.mono}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(n(m.n)), x + 39, my + 1)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    })
    if (data.streakLine) {
      ctx.fillStyle = pal.txt3
      ctx.font = `500 19px ${pal.font}`
      ctx.fillText(String(data.streakLine), 80 + 3 * 92 + 14, my + 7)
    }
  }

  /* ---- chân card: chữ ký + tem ngày ---- */
  ctx.fillStyle = pal.txt3
  ctx.font = `400 16px ${pal.font}`
  ctx.fillText(String(data.footer || ''), 80, H - 64)
  ctx.font = `500 16px ${pal.mono}`
  ctx.textAlign = 'right'
  ctx.fillText(String(data.stamp || ''), W - 80, H - 64)
  ctx.textAlign = 'left'
}

/* Đọc bảng màu thẳng từ token CSS — card cùng thương hiệu với giao diện,
   và đổi token một chỗ là card đổi theo. */
export function readPalette() {
  if (typeof window === 'undefined' || !window.getComputedStyle) return DEFAULT_PALETTE
  const cs = window.getComputedStyle(document.documentElement)
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback
  return {
    ...DEFAULT_PALETTE,
    bg: v('--bg', DEFAULT_PALETTE.bg),
    panel: v('--panel', DEFAULT_PALETTE.panel),
    line: v('--line-2', DEFAULT_PALETTE.line),
    txt: v('--txt', DEFAULT_PALETTE.txt),
    txt3: v('--txt-3', DEFAULT_PALETTE.txt3),
    a2: v('--a-2', DEFAULT_PALETTE.a2),
  }
}

/* Avatar qua blob để canvas không nhiễm bẩn CORS; trượt đường nào cũng lùi
   về chữ cái đầu chứ không ném lỗi giữa chừng việc bấm "Save card". */
async function loadAvatar(url) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob)
    const img = new Image()
    const obj = URL.createObjectURL(blob)
    try {
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = obj })
      return img
    } finally { setTimeout(() => URL.revokeObjectURL(obj), 4000) }
  } catch { return null }
}

/* Dựng blob PNG. NÉM lỗi có mã rõ khi môi trường không vẽ được (jsdom,
   trình duyệt tắt canvas) — nút bấm bắt lỗi này và nói thật bằng toast,
   không im lặng hư. */
export async function makeShareCardBlob(data, opts = {}) {
  if (typeof document === 'undefined') throw new Error('card-no-dom')
  const canvas = document.createElement('canvas')
  const scale = 2   /* 2400×1260 thật: chữ nhỏ trên card vẫn sắc khi phóng to */
  canvas.width = CARD_W * scale
  canvas.height = CARD_H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('card-unsupported')
  ctx.scale(scale, scale)
  try { await document.fonts?.ready } catch { /* font chưa sẵn: vẽ bằng font dự phòng */ }
  const avatar = data.avatarUrl ? await loadAvatar(data.avatarUrl) : null
  drawShareCard(ctx, { ...data, avatar }, opts.palette || readPalette())
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('card-unsupported')
  return blob
}
