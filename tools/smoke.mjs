/* =========================================================
   DỰNG THẬT CẢ APP TRONG MÁY — công cụ tìm lỗi, không phải test đơn vị
   ---------------------------------------------------------
   `npm test` toàn là test tĩnh hoặc dựng từng component rời. Loại lỗi người
   dùng thật sự gặp lại nằm ở chỗ khác: một effect chạy sai thứ tự, một state
   được đọc trước khi có, một lần bấm gây vòng lặp render, một `null` ở giữa
   đường đi chỉ xuất hiện SAU khi đã đăng nhập. Những thứ đó chỉ lộ ra khi
   dựng cả cây React thật, bấm thật, và ghi lại mọi thứ rơi ra console.

   Công cụ này:
     · dựng App thật (React client, jsdom) ở chế độ demo, đăng nhập demo;
     · đi qua từng mục, mở từng hộp thoại, bấm các nút chính;
     · rà NHÃN ở mọi màn hình: chỗ nào có từ hai nhãn cạnh nhau mà không nằm
       trong một cụm biết xuống dòng thì báo (lỗi "tag chồng nhau");
     · in ra mọi console.error / console.warn / exception kèm mục đang đứng.

   Chạy: npm run smoke     (SMOKE_DUMP=1 để in thêm HTML vài khu vực)
   ========================================================= */
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = new URL('..', import.meta.url).pathname

/* ---------- 1. giả lập môi trường trình duyệt ---------- */
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'https://localhost/', pretendToBeVisual: true,
})
const { window } = dom

class IO {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ isIntersecting: true, target: el, boundingClientRect: { top: 0 } }], this) }
  unobserve() {} disconnect() {} takeRecords() { return [] }
}
window.IntersectionObserver = IO
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
}))
window.scrollTo = () => {}
window.Element.prototype.scrollIntoView = () => {}
if (!window.HTMLElement.prototype.animate) {
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve(), onfinish: null })
}
for (const k of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'IntersectionObserver', 'ResizeObserver',
  'matchMedia', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'Blob', 'URL', 'URLSearchParams', 'DOMParser', 'Image', 'MutationObserver']) {
  if (window[k] === undefined) continue
  try {
    Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true })
  } catch { /* getter-only ở Node 22: bỏ qua, jsdom vẫn phục vụ qua window */ }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* ---------- 2. ghi lại mọi thứ rơi ra console ---------- */
const problems = []
let where = 'khởi động'
/* React in cảnh báo `act(...)` qua một tham chiếu console lấy TRƯỚC khi ta
   thay, nên phải lọc ở tầng tiến trình; báo cáo của công cụ đi ra stdout.
   Lọc CHỨ KHÔNG nuốt: dòng nào không phải tiếng ồn thì vẫn phải hiện ra, kẻo
   công cụ tự che mất lỗi thật của chính nó. */
const out = process.stdout.write.bind(process.stdout)
const errOut = process.stderr.write.bind(process.stderr)
const realLog = (...a) => out(a.join(' ') + '\n')
/* Cảnh báo `act(...)` là do BÀI KIỂM này gây ra, không phải lỗi của app. */
const NOISE = /not wrapped in act|ReactDOMTestUtils|The current testing environment/i
process.stderr.write = (chunk, ...rest) => (NOISE.test(String(chunk)) ? true : errOut(chunk, ...rest))
const note = (kind, args) => {
  const text = args.map(a => (a && a.stack) ? a.stack.split('\n').slice(0, 3).join(' | ') : String(a)).join(' ')
  if (NOISE.test(text)) return
  problems.push({ kind, where, text })
}
console.error = (...a) => note('error', a)
console.warn = (...a) => note('warn', a)
window.addEventListener('error', (e) => note('exception', [e.error || e.message]))
window.addEventListener('unhandledrejection', (e) => note('rejection', [e.reason]))

/* ---------- 3. dựng app ---------- */
const server = await createServer({
  root, configFile: false, mode: 'test', logLevel: 'error',
  cacheDir: 'node_modules/.vite-smoke',
  envPrefix: 'CCL_SMOKE_',           // .env thật không được lọt vào bài kiểm này
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, watch: null },
})
const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const App = (await server.ssrLoadModule('/src/App.jsx')).default
const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
const { NotifyProvider } = await server.ssrLoadModule('/src/lib/notify.jsx')

const container = window.document.getElementById('root')
const root_ = createRoot(container)
await act(async () => {
  root_.render(createElement(I18nProvider, null,
    createElement(NotifyProvider, null, createElement(App))))
})

const q = (sel) => window.document.querySelector(sel)
const qa = (sel) => [...window.document.querySelectorAll(sel)]
const text = () => window.document.body.textContent.replace(/\s+/g, ' ').trim()
const tick = async (ms = 60) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
/* Màn chờ có SÀN thời gian và TRẦN ~2,6s, nên "chờ 400ms rồi kiểm" là kiểm
   nhầm màn chờ. Chờ tới khi thứ cần tìm xuất hiện, hết hạn mới kết luận. */
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return true
    await tick(120)
  }
  return false
}
const click = async (el) => {
  if (!el) throw new Error('không tìm thấy phần tử để bấm')
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await tick()
}
/* Gõ chữ THẬT như người dùng: React theo dõi giá trị cũ của ô nhập, nên gán
   thẳng `el.value` rồi phát `input` có thể bị React coi là "không đổi gì". */
const setNative = (el, value) => {
  const proto = el instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
}
const type = async (el, value) => {
  await act(async () => {
    setNative(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await tick()
}

const checks = []
const check = (name, ok, extra = '') => {
  checks.push({ name, ok, extra })
  if (!ok) realLog(` FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
}

/* ---------- rà nhãn: chỗ nào có ≥2 nhãn cạnh nhau phải nằm trong .tags ---------- */
const TAGISH = '.pill, .kind, .badge'
function loneTagClusters(limit = 6) {
  const bad = []
  for (const el of qa('*')) {
    const kids = [...el.children].filter(c => c.matches(TAGISH))
    if (kids.length < 2) continue
    if (el.classList.contains('tags')) continue
    /* dãy chip lọc và cụm số liệu là control, không phải nhãn dán trên hàng */
    if (el.closest('.fchips, .adm-kpis, .vm-balance, .vm-presets, .kindpicks')) continue
    bad.push(`${el.tagName.toLowerCase()}.${el.className || '?'} giữ ${kids.length} nhãn rời`)
  }
  return bad.slice(0, limit)
}

/* ---------- 4. màn chờ + đăng nhập ---------- */
realLog('\n── màn chờ ──')
const splashSeen = !!q('.splash')
realLog(`  · có màn chờ lúc mở: ${splashSeen}`)
/* App cố ý GIỮ <Splash hide /> trong cây để nhịp mờ dần chạy xong mới thôi,
   nên đừng đòi nó biến mất: đòi nó chuyển sang trạng thái `.hide` (vô hình). */
const tSplash = Date.now()
const gone = await waitFor(() => { const s = q('.splash'); return !s || s.classList.contains('hide') }, 6000)
realLog(`  · màn chờ vào trạng thái ẩn sau ${Date.now() - tSplash} ms: ${gone}`)
check('màn chờ tự tan (không kẹt)', gone, gone ? '' : `vẫn còn hiện sau ${Date.now() - tSplash} ms`)

const gate = qa('button').find(b => /Continue with Google/i.test(b.textContent || ''))
if (gate) await click(gate)
await waitFor(() => qa('.row, .grow').length > 0 || !!q('.empty'), 5000)

/* ---------- 5. trang chủ ---------- */
where = 'trang chủ'
const rows = qa('.row, .grow')
check('bảng request có hàng', rows.length > 0, `${rows.length} hàng`)
check('thanh lọc có chip trạng thái', qa('.fchip').length >= 4, `${qa('.fchip').length} chip`)
check('có dòng đếm kết quả', !!q('.fcount'), q('.fcount')?.textContent)
check('icon ô tìm kiếm nằm trong ô', !!q('.searchwrap .search-ico'))
const enabledVotes = qa('.votebtn:not([disabled])')
check('có bài bấm vote được', enabledVotes.length > 0, `${enabledVotes.length}/${qa('.votebtn').length} nút mở`)
const lone1 = loneTagClusters()
check('trang chủ: không có cụm nhãn rời', lone1.length === 0, lone1.join(' | '))

/* tìm kiếm + lọc */
where = 'bộ lọc'
const search = q('.fbar .search')
if (search) {
  await type(search, 'aespa')
  check('gõ từ khoá ra kết quả hoặc câu trống', !!q('.empty') || qa('.row, .grow').length > 0,
    `${qa('.row, .grow').length} hàng cho "aespa"`)
  await type(search, '')
}
const upNextChip = qa('.fchip').find(c => /Up next/i.test(c.textContent || ''))
if (upNextChip) {
  await click(upNextChip)
  check('tab Up next có nội dung', qa('.now-item, .row, .grow').length > 0)
  const lone2 = loneTagClusters()
  check('Up next: không có cụm nhãn rời', lone2.length === 0, lone2.join(' | '))
}
const queueChip = qa('.fchip').find(c => /Queue/i.test(c.textContent || ''))
if (queueChip) await click(queueChip)

/* ---------- 6. form request ---------- */
where = 'form request'
const addBtn = qa('button').find(b => /New request|Request a|Gửi/i.test(b.textContent || ''))
if (addBtn) {
  await click(addBtn)
  if (/Before requesting/i.test(text())) {
    await click(qa('button').find(b => /agree/i.test(b.textContent || '')))
  }
  check('form request mở ra', !!q('.modal'))
  check('có thẻ xem trước', !!q('.req-preview'))
  check('có dải 3 bước', qa('.req-steps li').length === 3)
  check('đủ 4 thẻ loại bài', qa('.kcard').length === 4)
  const artist = q('#rq-artist'), title = q('#rq-title')
  if (artist && title) {
    await type(artist, 'aespa')
    await type(title, 'Whiplash')
    check('thẻ xem trước ăn theo chữ vừa gõ', /aespa/.test(q('.req-preview')?.textContent || ''),
      q('.req-preview')?.textContent?.replace(/\s+/g, ' ').slice(0, 80))
    const link = q('#rq-link')
    if (link) {
      await type(link, 'https://youtu.be/dQw4w9WgXcQ')
      check('link YouTube hiện ảnh bìa', !!q('.rp-thumb'))
    }
  }
  await click(q('.modal .x'))
} else {
  check('mở được form request', false, 'không thấy nút')
}

/* ---------- 7. hộp vote ---------- */
where = 'hộp vote'
const voteBtn = qa('.votebtn:not([disabled])')[0]
if (voteBtn) {
  await click(voteBtn)
  check('hộp vote mở ra', !!q('.vm-hero'))
  check('có ba ô số dư', qa('.vm-chip').length >= 3, `${qa('.vm-chip').length} ô`)
  const preset = qa('.vm-preset')[1]
  if (preset) {
    const before = q('.vm-hero .v')?.textContent
    await click(preset)
    check('bấm mức nhanh đổi số lớn', q('.vm-hero .v')?.textContent !== before,
      `${before} → ${q('.vm-hero .v')?.textContent}`)
  }
  /* Ba ô số dư phải cộng lại đúng bằng tổng phiếu đang có (thanh trượt lấy
     đúng tổng đó làm mức cao nhất). Sai ở đây là người dùng bị báo thiếu phiếu
     trong khi vẫn còn. */
  const chips = qa('.vm-chip b').map(b => Number(b.textContent) || 0)
  const slideMax = Number(q('.vm-slide')?.getAttribute('max') || 0)
  check('ba ô số dư cộng đúng bằng tổng phiếu', chips.reduce((a, b) => a + b, 0) === slideMax,
    `${chips.join(' + ')} = ${chips.reduce((a, b) => a + b, 0)} vs max ${slideMax}`)

  /* Bấm gửi thật: con số trên hàng phải tăng đúng bằng số vừa chọn, và hộp
     phải tự đóng. Đây là phép thử duy nhất chứng minh đường ray vote chạy.
     Nhớ `.vm-hero .v` là TỔNG SAU KHI VOTE, không phải số vừa chọn — muốn biết
     số vừa chọn thì đọc chính ô nhập. */
  const picked = Number(q('#vm-qty')?.value || 1) || 1
  const beforeVotes = Number(voteBtn.querySelector('b')?.textContent || 0)
  const send = qa('.modal .btn-primary').find(b => /vote|bình chọn/i.test(b.textContent || ''))
  if (send) {
    await click(send)
    await waitFor(() => !q('.modal'), 3000)
    const afterVotes = Number(voteBtn.querySelector('b')?.textContent || 0)
    check('gửi vote thì số trên hàng tăng đúng', afterVotes === beforeVotes + picked,
      `${beforeVotes} + ${picked} → ${afterVotes}`)
    check('gửi xong hộp vote tự đóng', !q('.modal'))
  } else {
    check('hộp vote có nút gửi', false, `không thấy .btn-primary — ${text().slice(-160)}`)
  }
} else {
  check('mở được hộp vote', false, 'không còn nút vote nào mở')
}

/* ---------- 8. các mục còn lại ---------- */
for (const [name, path] of [['Daily Spin', '/daily-spin'], ['Xếp hạng', '/ranking'], ['Của tôi', '/profile']]) {
  where = name
  window.history.pushState({}, '', path)
  window.dispatchEvent(new window.Event('popstate'))
  await waitFor(() => !q('.splash') && text().length > 200)
  check(`${name} dựng được`, text().length > 200)
  if (name === 'Xếp hạng') {
    check('bảng xếp hạng có câu nói rõ luật', !!q('.lb-rule'), q('.lb-rule')?.textContent)
    const lone = loneTagClusters()
    check('Xếp hạng: không có cụm nhãn rời', lone.length === 0, lone.join(' | '))
  }
}

/* ---------- 9. trang quản trị ---------- */
where = 'trang quản trị'
window.history.pushState({}, '', '/admin')
window.dispatchEvent(new window.Event('popstate'))
await waitFor(() => !!q('.adm-page'))
check('trang quản trị dựng ra', !!q('.adm-page'))
check('có dải số liệu chuyển mục', qa('.adm-kpi').length === 5, `${qa('.adm-kpi').length} ô`)
check('có thanh công cụ', !!q('.adm-bar'))
check('nút xuất CSV có mặt', qa('button').some(b => /Export CSV/.test(b.textContent || '')))

for (const k of ['pending', 'active', 'orders', 'done', 'media']) {
  where = `trang quản trị · ${k}`
  const before = problems.length
  window.history.pushState({}, '', `/admin?tab=${k}`)
  window.dispatchEvent(new window.Event('popstate'))
  await waitFor(() => !!q('.adm-page'))
  await tick(120)
  const lone = loneTagClusters()
  check(`mục ${k} dựng được, không lỗi`, !!q('.adm-page') && problems.length === before,
    problems.length > before ? problems.slice(before).map(p => p.text).join(' / ').slice(0, 160) : '')
  check(`mục ${k} không có cụm nhãn rời`, lone.length === 0, lone.join(' | '))
}

/* chọn nhiều + hành động hàng loạt */
where = 'chọn nhiều'
window.history.pushState({}, '', '/admin?tab=pending')
window.dispatchEvent(new window.Event('popstate'))
await tick(150)
const pick = qa('.adm-bar button').find(b => /select|chọn/i.test(b.textContent || ''))
if (pick) {
  await click(pick)
  const box = q('.adm .adm-sel input, .adm .adm-sel button, .adm .adm-sel')
  if (box) {
    await click(box)
    check('chọn một hàng hiện thanh hành động hàng loạt', !!q('.adm-bulk'))
  } else {
    check('chọn nhiều có ô chọn hàng', false, 'không thấy .adm-sel')
  }
  await click(pick)
}

/* ---------- 10. kết luận ---------- */
where = 'kết thúc'
const runtime = problems.filter(p => p.kind !== 'warn')
check('không có lỗi runtime', runtime.length === 0, `${problems.length} mục trong console`)

for (const p of problems.slice(0, 12)) realLog(`  [${p.kind}] (${p.where}) ${p.text.slice(0, 240)}`)
const failed = checks.filter(c => !c.ok)
realLog(`\n──────── TỔNG KẾT: ${checks.length - failed.length}/${checks.length} mục đạt ────────`)
for (const f of failed) realLog(`  ✗ ${f.name}${f.extra ? ` — ${f.extra}` : ''}`)

await act(async () => { root_.unmount() })
await server.close()
process.exit(failed.length ? 1 : 0)
