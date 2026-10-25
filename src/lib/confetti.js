/* =========================================================
   CONFETTI — bung giấy một nhịp khi trúng (vòng 5, theo bản mẫu)
   ---------------------------------------------------------
   Canvas đơn lẻ đè lên trang (pointer-events:none), tự dựng khi burst đầu
   tiên và tự gỡ khi hết hạt. Chỉ dùng ở tương tác người dùng (sau khi
   server trả kết quả) — SSR không đụng document. Reduced-motion: ít hạt,
   rơi ngắn. Màu từ bảng brand (pink/purple) + trắng.
   ========================================================= */
/* Màu hạt lấy TỪ TOKEN, không viết tay: bảng màu đã đổi hai lần và cả hai lần
   dải giấy này còn nằm lại ở ramp tím cũ — bung lên là thấy ngay nó không thuộc
   trang. Đọc biến CSS lúc bung (trong burst, không phải lúc import) để nó luôn
   khớp bảng màu hiện hành; fallback là đúng bộ đang dùng hôm nay. */
const FALLBACK = ['#a9a4ff', '#e879f9', '#34d399', '#fbbf24', '#38bdf8', '#ffffff']
const TOKENS = ['--a-2', '--upnext', '--done', '--paid', '--queued']
let colors = null

function hue() {
  if (colors || typeof document === 'undefined') return colors || FALLBACK
  const cs = getComputedStyle(document.documentElement)
  colors = TOKENS.map((t, i) => cs.getPropertyValue(t).trim() || FALLBACK[i])
  colors.push('#ffffff')
  return colors
}

let canvas = null
let ctx = null
let particles = []
let raf = 0
let dpr = 1

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function fit() {
  if (!canvas) return
  dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
}

function loop() {
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  particles = particles.filter(p => p.life > 0)
  for (const p of particles) {
    p.vy += 0.28
    p.vx *= 0.99
    p.x += p.vx
    p.y += p.vy
    p.rot += p.spin
    p.life -= 1
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    ctx.globalAlpha = Math.min(1, p.life / 30)
    ctx.fillStyle = p.color
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
    ctx.restore()
  }
  if (particles.length) {
    raf = requestAnimationFrame(loop)
  } else {
    raf = 0
    canvas.remove()
    canvas = null
    ctx = null
  }
}

/* Bung `count` hạt từ toạ độ viewport. Gọi bao nhiêu lần cũng chỉ có một
   canvas; rAF đôi khi rAF — burst giữa chừng nối vào vòng lặp đang chạy. */
export function confettiBurst(x, y, count = 80) {
  if (typeof document === 'undefined') return   // SSR — không có canvas
  const n = reduced() ? 14 : count
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60'
    document.body.append(canvas)
    ctx = canvas.getContext('2d')
    fit()
    window.addEventListener('resize', fit)
  }
  const pal = hue()
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 8
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      w: 5 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      rot: 0,
      spin: (Math.random() - 0.5) * 0.4,
      color: pal[i % pal.length],
      life: 90 + Math.random() * 50,
    })
  }
  if (!raf) raf = requestAnimationFrame(loop)
}
