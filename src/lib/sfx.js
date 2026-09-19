/* =========================================================
   ÂM THANH — tổng hợp bằng Web Audio, không dùng file nào
   ---------------------------------------------------------
   Âm sắc kiểu mộc cầm (marimba): sóng tam giác cho thân tiếng,
   bồi âm quãng tám cho lấp lánh, một mẩu nhiễu rất ngắn cho tiếng
   gõ dùi ở đầu nốt. Tất cả đi qua: lọc thông thấp → vang nhẹ →
   compressor → âm lượng tổng.
   ========================================================= */

const KEY = 'ccl.sfx'
const VOL = 'ccl.sfx.vol'

/* Âm lượng tổng mặc định. 0,8 là mức "nghe thử trong phòng thu"; ngoài đời
   người ta mở web trong quán, trong lớp — 0,7 vẫn nghe rõ mà không giật mình,
   và luôn chỉnh được bằng thanh trượt cạnh nút loa. */
const VOLUME_DEFAULT = 0.7

/* Cao độ (Hz) */
const N = {
  Bb4: 466.16, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25,
  G5: 783.99, A5: 880.00, C6: 1046.50, D6: 1174.66, E6: 1318.51,
  G6: 1567.98, A6: 1760.00, C7: 2093.00,
}

/** Mỗi nốt: [cao độ, thời điểm bắt đầu (s), độ dài (s), âm lượng] */
export const VOICES = {
  // bấm vote — quãng ba trưởng đi lên
  vote:   [[N.C6, 0.000, 0.20, 0.170], [N.E6, 0.045, 0.24, 0.150], [N.G6, 0.090, 0.28, 0.085]],
  // bỏ vote — đi xuống, khẽ hơn
  unvote: [[N.E6, 0.000, 0.16, 0.110], [N.C6, 0.050, 0.20, 0.095]],
  // gửi request thành công — rải hợp âm rồi ngân
  submit: [[N.G5, 0.000, 0.18, 0.135], [N.C6, 0.055, 0.20, 0.150], [N.E6, 0.110, 0.24, 0.145],
           [N.G6, 0.165, 0.40, 0.130], [N.C7, 0.215, 0.46, 0.065]],
  // chạm nút thường — một tiếng "tóc" rất khẽ
  tap:    [[N.G5, 0.000, 0.07, 0.060]],
  // bật / tắt công tắc
  toggle: [[N.C6, 0.000, 0.10, 0.090], [N.G6, 0.045, 0.13, 0.060]],
  off:    [[N.G6, 0.000, 0.09, 0.060], [N.C6, 0.045, 0.13, 0.080]],
  // mở / đóng hộp thoại
  // thông báo (toast thành công)
  notify: [[N.E6, 0.000, 0.14, 0.100], [N.A6, 0.090, 0.22, 0.085]],
  // xóa — trầm, đi xuống
  delete: [[N.E5, 0.000, 0.14, 0.110], [N.C5, 0.070, 0.24, 0.100]],
  // lỗi — nửa cung đi xuống, hơi "nhăn"
  error:  [[N.B4, 0.000, 0.13, 0.120], [N.Bb4, 0.110, 0.28, 0.120]],
  // vòng quay bắt đầu chạy — quãng năm đi lên, ngắn gọn
  spinGo: [[N.C5, 0.000, 0.12, 0.110], [N.G5, 0.050, 0.16, 0.100], [N.C6, 0.100, 0.22, 0.080]],
  // trúng thưởng thường — quãng ba trưởng rồi ngân
  spinWin: [[N.C6, 0.000, 0.20, 0.150], [N.E6, 0.060, 0.24, 0.140],
            [N.G6, 0.120, 0.34, 0.120], [N.C7, 0.180, 0.44, 0.070]],
  // trúng ô hiếm nhất — rải dài hơn, kết bằng quãng tám lấp lánh
  spinJackpot: [[N.C6, 0.000, 0.18, 0.150], [N.E6, 0.070, 0.20, 0.145], [N.G6, 0.140, 0.22, 0.140],
                [N.C7, 0.210, 0.30, 0.115], [N.G6, 0.290, 0.26, 0.090], [N.C7, 0.360, 0.60, 0.110],
                [N.E6, 0.360, 0.62, 0.060]],

  /* ---- ba tiếng thêm ở vòng 12 (form ba bước + chép link) ----------------
     Bước tiếp và bước lùi là MỘT CẶP: đi lên thì cao dần, đi xuống thì thấp
     dần. Cùng một quãng, khác hướng — người dùng nghe là biết mình vừa tiến
     hay vừa lùi, điều mà hai tiếng "tap" giống hệt nhau không nói được. Cả hai
     đều rất khẽ: đổi bước là việc lặp vài lần trong một form, không phải một
     sự kiện đáng mừng. */
  step:   [[N.C6, 0.000, 0.09, 0.070], [N.G6, 0.040, 0.13, 0.055]],
  back:   [[N.G6, 0.000, 0.09, 0.060], [N.C6, 0.045, 0.13, 0.050]],
  // chép link chia sẻ — hai nốt đi lên, gọn, khác hẳn tiếng "thông báo"
  copy:   [[N.E6, 0.000, 0.10, 0.075], [N.C7, 0.055, 0.16, 0.055]],
  /* Tin TRẢ TIỀN (đơn đã thanh toán, bài vừa được chốt) nghe khác tin thường:
     quãng bốn đúng đi lên rồi ngân dài hơn — cùng họ với tiếng thông báo
     thường nhưng ấm hơn, để tai tách được hai loại tin trong một đợt. */
  gold:   [[N.C6, 0.000, 0.16, 0.110], [N.G6, 0.080, 0.26, 0.095], [N.C7, 0.160, 0.40, 0.060]],
}

/* ---------- vật liệu dùng chung, tạo một lần cho mỗi AudioContext ---------- */
const noiseCache = new WeakMap()
function noiseBuffer(ac) {
  let b = noiseCache.get(ac)
  if (b) return b
  const len = Math.floor(ac.sampleRate * 0.05)
  b = ac.createBuffer(1, len, ac.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  noiseCache.set(ac, b)
  return b
}

/* Đuôi vang: nhiễu tắt dần theo hàm mũ, ~0.45s */
function impulse(ac, seconds = 0.45, decay = 3.5) {
  const len = Math.floor(ac.sampleRate * seconds)
  const b = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return b
}

/** Xếp lịch phát một giai điệu. Dùng được với cả OfflineAudioContext. */
export function schedule(ac, dest, seq, t0 = 0) {
  for (const [freq, at, dur, peak] of seq) {
    const t = t0 + at

    // thân tiếng — có chút tụt cao độ ở đầu như thanh gỗ vừa bị gõ
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq * 1.012, t)
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.025)

    /* BÈ TRẦM — một sóng sin đúng NỬA cao độ, rất khẽ, ngân gần bằng nốt
       chính. Đây là phần làm tiếng nghe ra "gỗ" chứ không phải "tiếng bíp":
       tai người ghép hai tần số cách nhau một quãng tám thành CÙNG một nốt,
       nhưng âm sắc dày lên và bớt chói, nhất là ở các nốt C6–C7 mà bộ tiếng
       này dùng nhiều. */
    const low = ac.createOscillator()
    low.type = 'sine'
    low.frequency.setValueAtTime(freq / 2, t)

    // bồi âm quãng tám, khẽ, tắt nhanh hơn — và BỊ CHẶN TRẦN 5kHz: bồi âm
    // của C7 là 4186Hz, để nguyên thì đúng cái đỉnh chói nhất của cả bộ tiếng.
    const shim = ac.createOscillator()
    shim.type = 'sine'
    shim.frequency.setValueAtTime(Math.min(freq * 2, 5000), t)

    const g = ac.createGain()
    const gs = ac.createGain()
    const gl = ac.createGain()
    for (const [node, p, d, at] of [
      [g, peak, dur, 0.008],
      [gs, peak * 0.14, dur * 0.45, 0.008],
      [gl, peak * 0.13, dur * 0.9, 0.012],
    ]) {
      node.gain.setValueAtTime(0.0001, t)
      node.gain.exponentialRampToValueAtTime(p, t + at)
      node.gain.exponentialRampToValueAtTime(0.0001, t + d)
    }

    /* Tiếng gõ dùi — nhiễu lọc dải, ~14ms. Trước đây nó chiếm một nửa biên độ
       của nốt và lọc tới 9kHz, nên mỗi cú bấm kèm một tiếng "tách" sắc: đúng
       thứ làm âm thanh giao diện nghe rẻ tiền. Nay nó chỉ còn là cạnh lên của
       nốt, không phải một tiếng riêng. */
    const click = ac.createBufferSource()
    click.buffer = noiseBuffer(ac)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = Math.min(freq * 2.4, 6500)
    bp.Q.value = 0.9
    const gc = ac.createGain()
    gc.gain.setValueAtTime(peak * 0.28, t)
    gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.014)

    osc.connect(g).connect(dest)
    shim.connect(gs).connect(dest)
    low.connect(gl).connect(dest)
    click.connect(bp).connect(gc).connect(dest)

    osc.start(t);   osc.stop(t + dur + 0.03)
    shim.start(t);  shim.stop(t + dur * 0.45 + 0.03)
    low.start(t);   low.stop(t + dur * 0.9 + 0.03)
    click.start(t); click.stop(t + 0.025)
  }
}

/** Đường tiếng chung: lọc → (vang) → compressor → master → loa */
export function buildBus(ac, { volume = VOLUME_DEFAULT } = {}) {
  /* Trần 4,6kHz: bộ tiếng này nằm ở C6–C7 (1046–2093Hz), cộng bè quãng tám là
     chạm 4kHz — đúng vùng tai người nghe chói nhất. Cắt ở 4,6kHz giữ nguyên
     độ "sáng" mà bỏ được phần gắt, và cũng là chỗ loa điện thoại dễ rè. */
  const input = ac.createBiquadFilter()
  input.type = 'lowpass'
  input.frequency.value = 4600
  input.Q.value = 0.6

  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -20
  comp.knee.value = 12
  comp.ratio.value = 4
  comp.attack.value = 0.002
  comp.release.value = 0.12

  const master = ac.createGain()
  master.gain.value = volume

  /* Vang ÍT hơn (0,22 → 0,15): nhiều tiếng cùng lúc (đổi bước liên tục, một
     đợt vote) mà vang nhiều thì chúng nhoè vào nhau thành một cục ồn. */
  const verb = ac.createConvolver()
  verb.buffer = impulse(ac)
  const wet = ac.createGain()
  wet.gain.value = 0.15

  input.connect(comp)
  input.connect(verb).connect(wet).connect(comp)
  comp.connect(master).connect(ac.destination)
  return { input, master }
}

/* ---------------- phần chạy thật trong trình duyệt ---------------- */

let ctx = null
let bus = null
let enabled = (() => {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
})()
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(VOL))
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOLUME_DEFAULT
  } catch { return VOLUME_DEFAULT }
})()

export const isEnabled = () => enabled
export function setEnabled(v) {
  enabled = !!v
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off') } catch { /* ignore */ }
}

export const getVolume = () => volume
export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0))
  try { localStorage.setItem(VOL, String(volume)) } catch { /* ignore */ }
  if (bus && ctx) bus.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
}

/* AudioContext chỉ tạo sau thao tác thật của người dùng. */
function live() {
  if (!enabled) return null
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!ctx) { ctx = new AC(); bus = buildBus(ctx, { volume }) }
    if (ctx.state === 'suspended') ctx.resume()
    return bus.input
  } catch { return null }
}

/* NHIỄU CAO ĐỘ RẤT NHỎ — ±0.4% (khoảng ±7 cent).
   Tai người nhận ra ngay một chuỗi nốt GIỐNG HỆT NHAU lặp lại (bấm liên tiếp
   vài lần là nghe như máy in). Lệch vài cent mỗi lần phát là đủ để tai nghe ra
   "nhiều lần bấm" thay vì "một tiếng bị lặp", mà không ai nghe ra là sai nhạc.
   Bản nhạc gốc (VOICES) vẫn nguyên vẹn — `schedule` là hàm thuần, chỉ bản sao
   truyền vào nó mới bị lệch, nên phép kiểm nào đọc thẳng VOICES vẫn đúng. */
const JITTER = 0.004

const jittered = (seq) => seq.map(([f, at, dur, peak]) =>
  [f * (1 + (Math.random() * 2 - 1) * JITTER), at, dur, peak])

/* Cùng một tiếng không phát lại trong 45ms (double-click, spam) */
/* Tin về dồn dập (một đợt vote làm bảng nhúc nhích liên tiếp) không được kêu
   thành chuỗi: hai tiếng THÔNG BÁO cách nhau tối thiểu 1,5 giây. Tiếng của
   thao tác mình vừa bấm (vote, gửi, chép link…) không bị chặn — đó là phản hồi
   trực tiếp, phải kêu ngay. */
const NOTIFY_GAP = 1500
let lastNotify = -Infinity

const last = new Map()
const play = (name) => {
  const seq = VOICES[name]
  if (!seq) return
  const now = performance.now()
  if (now - (last.get(name) || 0) < 45) return
  last.set(name, now)
  const dest = live()
  if (dest) schedule(ctx, dest, jittered(seq), ctx.currentTime + 0.005)
}

/* ---- tiếng "tách" của kim vòng quay ----------------------------------------
   Không phải nốt nhạc: một xung nhiễu rất ngắn qua lọc dải cao, cộng thêm một
   mẩu sóng vuông tắt tức thì cho phần "gỗ". Lịch phát do dailySpin.spinTicks
   tính sẵn (bám đúng đường cong CSS), ở đây chỉ xếp vào AudioContext một lần
   nên vòng quay không cần setTimeout nào cho âm thanh. */
function tick(ac, dest, t, gain) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2100
  bp.Q.value = 3.0
  const g = ac.createGain()
  /* Một lượt quay có hàng chục tiếng tách. Để mỗi tiếng to và sáng như trước
     thì cả lượt quay là một tràng "tạch tạch" chói; hạ biên độ còn ~2/3 và kéo
     lọc xuống 2,1kHz là đủ để nghe ra nhịp quay mà không đau tai. */
  g.gain.setValueAtTime(Math.max(0.0001, 0.085 * gain), t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.026)

  const body = ac.createOscillator()
  body.type = 'square'
  body.frequency.setValueAtTime(1200, t)
  body.frequency.exponentialRampToValueAtTime(620, t + 0.02)
  const gb = ac.createGain()
  gb.gain.setValueAtTime(Math.max(0.0001, 0.026 * gain), t)
  gb.gain.exponentialRampToValueAtTime(0.0001, t + 0.022)

  src.connect(bp).connect(g).connect(dest)
  body.connect(gb).connect(dest)
  src.start(t); src.stop(t + 0.05)
  body.start(t); body.stop(t + 0.05)
}

/** Xếp lịch toàn bộ tiếng tách của một lượt quay.
    Trả về hàm dừng sớm (khi rời trang / đổi tài khoản giữa chừng). */
function playTicks(ticks) {
  const dest = live()
  if (!dest || !ticks?.length) return () => {}
  const stop = ctx.createGain()
  stop.gain.value = 1
  stop.connect(dest)
  const t0 = ctx.currentTime + 0.02
  for (const { at, gain } of ticks) tick(ctx, stop, t0 + at, gain)
  return () => {
    try {
      stop.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
      setTimeout(() => stop.disconnect(), 200)
    } catch { /* ignore */ }
  }
}

export const sfx = {
  /* `notify(tone)` — tiếng thông báo đi theo TONE của tin: tin thường, tin trả
     tiền ('gold'), tin lỗi. Trước đây mọi loại tin đều kêu đúng một tiếng, nên
     tai không phân biệt được "có bài vừa được chốt" với "có người vừa vote". */
  notify:  tone => {
    const now = performance.now()
    if (now - lastNotify < NOTIFY_GAP) return
    lastNotify = now
    play(tone === 'gold' ? 'gold' : tone === 'err' ? 'error' : 'notify')
  },
  step:    () => play('step'),
  back:    () => play('back'),
  copy:    () => play('copy'),
  vote:    () => play('vote'),
  unvote:  () => play('unvote'),
  submit:  () => play('submit'),
  tap:     () => play('tap'),
  toggle:  () => play('toggle'),
  off:     () => play('off'),
  delete:  () => play('delete'),
  error:   () => play('error'),
  preview: () => play('vote'),
  // vòng quay may mắn
  spinGo:      () => play('spinGo'),
  spinWin:     jackpot => play(jackpot ? 'spinJackpot' : 'spinWin'),
  spinTicks:   ticks => playTicks(ticks),
}

/* Làm nóng: dựng AudioContext ngay ở lần chạm/bấm phím đầu tiên
   để tiếng đầu không bị trễ. */
if (typeof window !== 'undefined') {
  const warm = () => { live() }
  window.addEventListener('pointerdown', warm, { once: true, passive: true })
  window.addEventListener('keydown', warm, { once: true })
}