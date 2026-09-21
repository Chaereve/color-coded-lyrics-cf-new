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
const NOISE = /not wrapped in act|ReactDOMTestUtils|The current testing environment|Not implemented: navigation to another Document/i
/* jsdom KHÔNG cài đặt việc điều hướng: bấm vào một thẻ <a href> thật (bài kiểm
   này bấm nút menu, và nút menu là thẻ <a>) là jsdom kêu "Not implemented:
   navigation to another Document" BẤT KỂ app đã gọi preventDefault đúng — đã
   thử cả hai đường (bấm thẳng thẻ <a> và bấm vào chữ bên trong). Tiếng ồn này
   thuộc về bài kiểm, không phải về app. */
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

/* ---------- in HTML của vùng đang soi (SMOKE_DUMP=1) ----------
   Đọc mã trả lời được "phần tử có tồn tại không"; chỉ đọc HTML đã dựng mới trả
   lời được "nó nằm ở đâu, lồng trong cái gì" — đúng loại câu hỏi phát sinh khi
   bố cục sai. In theo yêu cầu để lượt chạy thường không bị rối. */
const DUMP = !!process.env.SMOKE_DUMP
const dump = (label, sel) => {
  if (!DUMP) return
  const el = q(sel)
  realLog(`\n===== DUMP ${label} · ${sel} =====`)
  realLog(el ? el.outerHTML.replace(/\n\s*/g, '\n') : '(không thấy phần tử)')
  realLog('===== /DUMP =====\n')
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

/* ---------- 4b. SIDEBAR (vòng 12) ---------- */
where = 'sidebar'
{
  /* Hàng đợi đơn đã rời sidebar: nó là một tab của trang quản trị và đã có
     lối vào ở dải số liệu. Còn một mục tên đó trong sidebar nghĩa là việc gỡ
     chưa xong — chốt bằng chữ, vì một mục thừa không làm gì hỏng. */
  const sideTx = qa('.side a.side-item, .side button.side-item').map(b => b.textContent || '')
  check('sidebar không còn mục Order queue', !sideTx.some(x => /Order queue/i.test(x)),
    sideTx.map(x => x.trim()).filter(Boolean).join(' | ').slice(0, 120))
  /* Nút soạn request: icon nằm trong ô vuông riêng (.cta-ico) — dấu hiệu đọc ra
     "hành động" giữa các icon trần; mất ô đó là nút trôi về thành logo thứ hai. */
  check('nút New request có ô icon riêng', !!q('.side-cta .cta-ico svg'))
  /* Dòng phụ dưới tiêu đề trang: mục nào có thì in, mục không có thì KHÔNG để
     lại một thẻ rỗng (bảng xếp hạng cố ý không có dòng phụ). */
  const sub = q('.mainhead-sub')
  check('trang chủ có dòng phụ dưới tiêu đề', !!sub, sub?.textContent)
}

/* ---------- 5. trang chủ ---------- */
where = 'trang chủ'
const rows = qa('.row, .grow')
check('bảng request có hàng', rows.length > 0, `${rows.length} hàng`)
check('thanh lọc có mục lọc trạng thái', qa('.fchip').length >= 4, `${qa('.fchip').length} mục`)
/* THỨ TỰ TRONG THANH LỌC (vòng 12, cập nhật vòng 14): ô tìm kiếm đứng ĐẦU,
   rồi tới tóm tắt + nút Bộ lọc, rồi mới tới dải chế độ xem. Một thứ tự cho cả
   desktop lẫn máy hẹp, nên thứ tự nhìn luôn trùng thứ tự Tab.
   (Bài kiểm này từng đòi dải chip đứng NGAY SAU ô tìm kiếm — đúng với bản
   vòng 12 khi con số đếm nằm ở hàng dưới; bản hiện tại đưa tóm tắt + nút Bộ lọc
   lên hàng trên, nên phép kiểm cũ báo đỏ một thứ tự đã cố ý. Đỏ oan cũng là
   lỗi: nó dạy người chạy công cụ cách phớt lờ màu đỏ.) */
const topKids = [...(q('.fbar-top')?.children || [])].map(el => el.className.split(' ')[0])
check('ô tìm kiếm đứng đầu thanh lọc', topKids[0] === 'searchwrap', topKids.join(' · '))
check('dải chế độ xem đứng sau ô tìm kiếm và tóm tắt', topKids[2] === 'fchips', topKids.join(' · '))
check('có dòng đếm kết quả', !!q('.fcount'), q('.fcount')?.textContent)
check('icon ô tìm kiếm nằm trong ô', !!q('.searchwrap .search-ico'))
/* DẢI CHẾ ĐỘ XEM (vòng 15) — người dùng chỉ ra đúng ba chữ: "phần hiện status
   xấu quá", "nhìn AI". Bốn vế dưới đây là hình dáng MỚI của dải đó, mỗi vế là
   một thứ đã bị gỡ hoặc đã được sắp lại:
     · mỗi mục có vạch màu riêng (chấm tròn đã bị gỡ);
     · đúng MỘT mục đang chọn, và mục đó vẫn còn vạch của nó;
     · bốn giai đoạn đứng liền nhau, đúng thứ tự dây chuyền;
     · có vạch ngăn giữa hai nhóm, và nhóm "đang theo dõi" vắng thì vạch ngăn
       của nó cũng phải vắng theo. */
{
  const rail = [...(q('.fchips')?.children || [])]
  const items = rail.filter(el => el.classList.contains('fchip'))
  const gaps = rail.filter(el => el.className === 'dot')
  check('mỗi mục lọc có vạch màu riêng', items.length > 0 && items.every(el => el.querySelector('.ftick')),
    `${items.filter(el => el.querySelector('.ftick')).length}/${items.length} mục có vạch`)
  const lit = items.filter(el => el.classList.contains('on'))
  check('dải chế độ xem có đúng một mục đang chọn', lit.length === 1, `${lit.length} mục đang chọn`)
  const labels = items.map(el => (el.textContent || '').replace(/\d+/g, '').trim())
  const pipe = labels.filter(l => ['Queue', 'Up next', 'In progress', 'Done'].includes(l))
  check('bốn giai đoạn đứng liền nhau, đúng thứ tự dây chuyền',
    pipe.join(' · ') === 'Queue · Up next · In progress · Done', labels.join(' · '))
  const want = labels.includes('Following') ? 2 : 1
  check('số vạch ngăn khớp số nhóm đang hiện (nhóm vắng thì vạch ngăn cũng vắng)',
    gaps.length === want, `${gaps.length} vạch ngăn, ${labels.join(' · ')}`)
}
const enabledVotes = qa('.votebtn:not([disabled])')
check('có bài bấm vote được', enabledVotes.length > 0, `${enabledVotes.length}/${qa('.votebtn').length} nút mở`)
/* LỌC THEO LOẠI BÀI: chọn một loại thì hàng chip chính phải hiện chip "đang lọc"
   (trên màn hẹp khối lọc gấp lại, nên đây là chỗ duy nhất NÓI RA vì sao danh
   sách ngắn đi), và bấm vào chip đó là bỏ lọc. */
/* VÒNG 16 — ba thứ vừa sửa, chốt trên DOM thật: */
check('không còn vạch tiến độ cuộn ở đỉnh trang', !q('.scroll-progress'),
  q('.scroll-progress') ? 'phần tử vẫn được dựng' : '')
/* Mục lọc loại bài: KHÔNG mang lớp `.kind` của thẻ (lỗi cũ làm cả bốn nút cùng
   một màu tím), và mỗi mục có dấu màu của chính nó. */
{
  const kindItems = qa('.fbar-more .fchips.kinds .fchip')
  check('mục lọc loại bài không mang lớp thẻ .kind', !qa('.fchip.kind').length,
    `${qa('.fchip.kind').length} phần tử còn lớp .kind`)
  check('mục lọc loại bài có dấu màu riêng', kindItems.length >= 5 && kindItems.every(el => el.querySelector('.kswatch')),
    `${kindItems.filter(el => el.querySelector('.kswatch')).length}/${kindItems.length} mục có dấu`)
  const onKind = q('.fbar-more .fchip.fkind.on')
  check('đúng một mục loại đang chọn', kindItems.filter(el => el.classList.contains('on')).length === 1,
    (onKind?.textContent || '').trim())
}
/* Thanh tiến độ của request: số được chừa chỗ, và vạch có hai mốc chia (suy từ
   ba mốc Layout/Lyrics/Edit — 40 · 40 · 20).
   Bài kiểm này phải đứng ở tab "In progress" mới thấy thanh tiến độ TRONG DANH
   SÁCH (mặc định của bảng là tab Queue, nơi chưa có bài nào đang làm — chỉ khối
   Up next mới có). Kiểm đúng chỗ người dùng nhìn thấy nó. */
{
  const chip = qa('.fchip').find(c => /In progress/i.test(c.textContent || ''))
  if (chip) await click(chip)
  const bars = qa('.list .prog')
  check('tab In progress: mỗi hàng đang làm có thanh tiến độ', bars.length > 0, `${bars.length} thanh`)
  const bar = bars[0]
  const marks = bar ? [...bar.querySelectorAll('.prog-mile')] : []
  check('vạch tiến độ có hai mốc chia', marks.length === 2, `${marks.length} mốc`)
  check('vạch mốc nằm ở 40% và 80%', marks.map(m => m.style.getPropertyValue('--m')).join(' · ') === '40% · 80%',
    marks.map(m => m.style.getPropertyValue('--m')).join(' · '))
  check('thanh tiến độ có nhãn đọc được cho cả ba mốc',
    /Layout 40% · Lyrics 40% · Edit 20%/.test(bar?.getAttribute('title') || ''),
    bar?.getAttribute('title'))
  const num = bar?.querySelector('.prog-num')
  check('thanh tiến độ giữ nguyên khối "vạch + số"', !!num && !!bar.querySelector('.prog-track'),
    num ? `${num.textContent.trim()}` : 'không thấy .prog-num')
  dump('thanh tiến độ của request', '.list .prog')
  /* trả bảng về tab Queue cho các mục kiểm phía sau */
  const back = qa('.fchip').find(c => /^Queue/.test((c.textContent || '').trim()))
  if (back) await click(back)
}

const kindChip = qa('.fbar-more .fchip.fkind').find(b => (b.textContent || '').trim() && !/All types/i.test(b.textContent))
if (kindChip) {
  const kindName = (kindChip.textContent || '').trim()
  await click(kindChip)
  await tick()
  const onkind = q('.fchip.onkind')
  check('chọn loại bài thì hàng chính hiện chip loại đang lọc', !!onkind, onkind?.textContent?.trim())
  if (onkind) {
    await click(onkind)
    await tick()
    check('bấm chip loại đang lọc là bỏ lọc đó', !q('.fchip.onkind'),
      `còn ${q('.fchip.onkind')?.textContent?.trim()}`)
  }
  check('bỏ lọc xong danh sách trở lại', qa('.row, .grow').length > 0, `${qa('.row, .grow').length} hàng`)
  void kindName
} else {
  check('thanh lọc có chip loại bài', false, 'không thấy chip loại bài nào trong khối lọc')
}

/* TIÊU ĐỀ KHỐI UP NEXT là một h2 thật (không phải div) và mang .lbl — cấp bậc
   của khối. Trước đây nó 13,5px, nhỏ hơn cả tên bài trong khối (15px). */
check('Up next có tiêu đề h2', !!q('.nowbar h2.lbl'), q('.nowbar h2.lbl')?.textContent?.replace(/\s+/g, ' ').trim())

const lone1 = loneTagClusters()
check('trang chủ: không có cụm nhãn rời', lone1.length === 0, lone1.join(' | '))
dump('thanh lọc trang chủ', '.fbar')

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
  /* Public browsing now gates actions lazily: the first click opens LoginGate.
     Smoke through the demo OAuth path, then retry the same action. */
  if (q('.btn-google')) {
    await click(q('.btn-google'))
    await tick(160)
    const retry = qa('button').find(b => /New request|Request a|Gửi/i.test(b.textContent || ''))
    if (retry) await click(retry)
  }
  if (/Before requesting/i.test(text())) {
    await click(qa('button').find(b => /agree/i.test(b.textContent || '')))
  }
  check('form request mở ra', !!q('.modal'))
  dump('form request', '.modal .req, .modal')
  /* FORM BA BƯỚC — mỗi bước là MỘT MÀN, không phải ba cái nhãn trên một cột
     dài: bước chưa tới thì phần thân của nó không được dựng ra. Đây là điều
     kiện để form ngắn lại, nên phải chốt. */
  check('có dải 3 bước', qa('.req-step').length === 3, `${qa('.req-step').length} bước`)
  check('bước đang đứng mang aria-current="step"', !!q('.req-step .rs-btn[aria-current="step"]'))
  check('mở form ở bước 1 — chưa dựng ô của bước 2',
    !!q('.req-pane') && !q('#rq-artist') && !q('#rq-note'))
  check('đủ 4 chip loại bài', qa('.kchip').length === 4)
  /* VÒNG 13: chữ "TikTok" trong dòng gợi ý kiểu bài đã bị gỡ — trang chỉ nói
     về YouTube, nhắc một nền tảng khác chỉ làm người gửi phân vân. */
  check('dòng gợi ý kiểu bài không còn nhắc TikTok', !/TikTok/i.test(text()),
    q('.kind-note')?.textContent)
  check('có đúng MỘT dòng giải thích loại đang chọn', qa('.kind-note').length === 1)
  /* Nút chính của bước 1 là ĐI TIẾP, không phải Gửi: bước gửi chưa tới. */
  const stepBtn = () => qa('.req-actions button').find(b => /Continue|Send request|Fill in/i.test(b.textContent || ''))
  await click(stepBtn())
  await tick(150)
  check('bấm Continue là sang bước 2', !!q('#rq-artist') && !!q('#rq-title'))
  check('bước 2 có thẻ xem trước', !!q('.req-preview'))
  check('thẻ xem trước không còn nhãn dài "… goes on the board"',
    !/goes on the board/i.test(text()))
  check('thẻ xem trước có tên ngắn "Preview"',
    /Preview/.test(q('.req-preview')?.textContent || ''),
    q('.req-preview')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60))
  check('ô Link không còn câu "Paste the YouTube link if you have one."',
    !/Paste the YouTube link/i.test(text()))
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
    /* DÁN LINK vào ô tên bài: link phải về ô Link, không thành tên bài */
    await act(async () => {
      const ev = new window.Event('paste', { bubbles: true, cancelable: true })
      ev.clipboardData = { getData: () => 'https://youtu.be/abcdefghijk' }
      title.dispatchEvent(ev)
    })
    await tick()
    /* DÁN NGUYÊN TIÊU ĐỀ VIDEO: form phải đọc ra hai vế và mời tách; bấm một
       lần là hai ô được điền đúng. */
    const titleBox = q('#rq-title')
    if (titleBox) {
      await type(titleBox, "CHUNG HA 청하 'Algorithm' MV")
      const note = q('.split-note')
      check('tiêu đề video dán vào thì hiện gợi ý tách', !!note, note?.textContent?.trim()?.slice(0, 80))
      const goSplit = qa('.split-note button')[0]
      if (goSplit) {
        await click(goSplit)
        await tick()
        check('bấm gợi ý là hai ô được điền đúng',
          q('#rq-artist')?.value === 'CHUNG HA 청하' && q('#rq-title')?.value === 'Algorithm',
          `${q('#rq-artist')?.value} / ${q('#rq-title')?.value}`)
      }
      await type(titleBox, 'Whiplash')
      await type(q('#rq-artist'), 'aespa')
    }

    check('dán link vào ô tên bài thì link về đúng ô Link', q('#rq-link')?.value === 'https://youtu.be/abcdefghijk',
      `link=${q('#rq-link')?.value} title=${q('#rq-title')?.value}`)
  }
  await click(q('.modal .x'))
  /* NHÁP: gõ dở rồi đóng hộp thoại, mở lại phải còn chữ + có dòng nói ra */
  await tick(500)
  const addBtn2 = qa('button').find(b => /New request|Request a|Gửi/i.test(b.textContent || ''))
  if (addBtn2) {
    await click(addBtn2)
    await tick(150)
    check('gõ dở rồi đóng, mở lại vẫn còn chữ', q('#rq-artist')?.value === 'aespa' && q('#rq-title')?.value === 'Whiplash',
      `artist="${q('#rq-artist')?.value}" title="${q('#rq-title')?.value}"`)
    check('có dòng nói rõ form được khôi phục từ nháp', !!q('.draft-note'), q('.draft-note')?.textContent)
    /* MỞ LẠI VỚI NHÁP THÌ VÀO ĐÚNG BƯỚC ĐANG LÀM DỞ, không bắt chọn lại loại
       bài rồi bấm Continue một lần nữa. */
    check('nháp có tên bài thì mở thẳng ở bước 2',
      !!q('#rq-artist') && !!q('.req-step .rs-btn[aria-current="step"]'))
    /* BƯỚC 3: ô ghi chú gấp lại, mở bằng MỘT cú bấm và con trỏ rơi vào đúng ô. */
    await click(stepBtn())
    await tick(150)
    check('bấm Continue lần nữa là sang bước 3', !!q('.note-add') && !q('#rq-note'))
    check('bước 3 có nút gửi thật', qa('.req-actions button[type="submit"]').length === 1)
    if (q('.note-add')) {
      await click(q('.note-add'))
      check('bấm "Add a note" là ô ghi chú hiện ra', !!q('#rq-note'))
      check('con trỏ rơi vào ô ghi chú vừa mở', window.document.activeElement === q('#rq-note'))
      if (q('#rq-note')) {
        await type(q('#rq-note'), 'Chorus starts at 0:52')
        check('ghi chú giữ được chữ vừa gõ', q('#rq-note').value === 'Chorus starts at 0:52')
        await type(q('#rq-note'), '')
      }
    }
    const drop = q('.draft-note .lnk')
    if (drop) {
      await click(drop)
      check('bỏ nháp thì form trắng lại', !q('#rq-artist')?.value && !q('#rq-title')?.value)
    }
    await click(q('.modal .x'))
  }
} else {
  check('mở được form request', false, 'không thấy nút')
}

/* ---------- 7. hộp vote ---------- */
where = 'hộp vote'
const voteBtn = qa('.votebtn:not([disabled])')[0]
if (voteBtn) {
  await click(voteBtn)
  check('hộp vote mở ra', !!q('.vm-hero'))
  /* BÀN PHÍM: mũi lên / dấu + phải chỉnh được số phiếu mà không cần tới ô nhập */
  const qtyBox = q('#vm-qty')
  if (qtyBox) {
    const before = Number(qtyBox.value)
    await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    await tick()
    check('phím mũi lên chỉnh được số phiếu', Number(q('#vm-qty')?.value) === before + 1,
      `${before} → ${q('#vm-qty')?.value}`)
  }
  const preset = qa('.vm-preset')[1]
  if (preset) {
    const before = q('.vm-hero .v')?.textContent
    await click(preset)
    check('bấm mức nhanh đổi số lớn', q('.vm-hero .v')?.textContent !== before,
      `${before} → ${q('.vm-hero .v')?.textContent}`)
  }
  /* QUỸ PHIẾU: MỘT dòng chữ "còn … → còn …" (kèm nguồn mua/thưởng nếu có).
     Vòng 10 dựng ba ô có viền + một vạch chia tỉ lệ; vòng 11 gỡ cả hai vì hộp
     vote bị chê là rối — nên phép kiểm ở đây chốt luôn rằng chúng KHÔNG quay
     lại: một khung viền nữa trong hộp chật là một lớp rối nữa. */
  const after = q('.vm-after')
  check('có dòng "còn … → còn …"', !!after && /\d/.test(after.textContent || ''),
    after?.textContent?.replace(/\s+/g, ' ').trim())
  check('quỹ phiếu không còn ô/vạch trang trí', !q('.vm-chip') && !q('.vm-mix'))

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
    /* Câu luật KHÔNG còn vế "· ties go to …" (vòng 12) — vế đó vừa dài vừa lặp
       lại điều bảng đã nói bằng số. */
    check('câu luật xếp hạng không còn vế "ties go to"',
      !/ties go to/i.test(q('.lb-rule')?.textContent || ''), q('.lb-rule')?.textContent)
    const lone = loneTagClusters()
    check('Xếp hạng: không có cụm nhãn rời', lone.length === 0, lone.join(' | '))
    /* ---- MÙA GIẢI (vòng 19): ba núm All time / This week / This month ----
       Luật cắt mùa có test riêng (season.test.js); smoke chỉ chốt hành vi thật
       trên trình duyệt: bấm núm thì câu luật + khoảng ngày đổi theo, và bảng
       không điều hướng đi đâu (nút type=button trong SPA). */
    const pseg = q('.lb-periodseg')
    const pbtns = [...(pseg?.querySelectorAll('button') || [])]
    check('bảng xếp hạng có bộ chọn mùa 3 nút', pbtns.length === 3,
      pbtns.map(b => b.textContent).join(' · ') || 'không thấy .lb-periodseg')
    const ruleAll = q('.lb-rule')?.textContent || ''
    /* ngày tháng KHÔNG in thường trực (người dùng chốt) — mặc định tooltip
       nhóm mùa không chở khoảng ngày nào */
    check('mặc định là All time: câu luật một vế, tooltip chưa chở khoảng ngày',
      pbtns[0]?.getAttribute('aria-pressed') === 'true'
      && !/\d{2}\/\d{2}/.test(pseg?.getAttribute('title') || ''), pseg?.getAttribute('title'))
    if (pbtns.length === 3) {
      await click(pbtns[2])
      await waitFor(() => /this period/i.test(q('.lb-rule')?.textContent || ''), 2000)
      const tip = pseg?.getAttribute('title') || ''
      check('bấm This month: câu luật đổi thành theo mùa',
        /this period/i.test(q('.lb-rule')?.textContent || ''), q('.lb-rule')?.textContent)
      check('bấm This month: khoảng ngày vào tooltip nhóm mùa (dd/mm – dd/mm)',
        /\d{2}\/\d{2} – \d{2}\/\d{2}/.test(tip), tip)
      check('đang xem mùa thì phiếu phải tự thú nhận là cộng dồn (trong tooltip)',
        /lifetime totals/.test(tip), tip)
      check('đổi mùa không điều hướng — vẫn ở /ranking',
        window.location.pathname === '/ranking', window.location.pathname)
      await click(pbtns[0])
      await waitFor(() => (q('.lb-rule')?.textContent || '') === ruleAll, 2000)
      check('bấm All time: bảng trở về đúng câu luật cũ, tooltip hết khoảng ngày',
        (q('.lb-rule')?.textContent || '') === ruleAll
        && !/\d{2}\/\d{2}/.test(pseg?.getAttribute('title') || ''), q('.lb-rule')?.textContent)
    }
  }
  if (name === 'Daily Spin') {
    /* ĐĨA QUAY: 16 ô, và ĐÚNG BỐN nhãn — một nhãn cho một mức thưởng, chỉ là
       con số. Trước đây mỗi nhãn còn kèm "×9" nên mặt đĩa đọc như bảng dữ liệu. */
    check('đĩa có 16 ô', qa('.spin-sector').length === 16, `${qa('.spin-sector').length} ô`)
    const wheelLabels = qa('.spin-wheel-number').map(e => (e.textContent || '').trim())
    check('đĩa có đúng bốn nhãn thưởng, không kèm số ô',
      wheelLabels.length === 4 && wheelLabels.every(x => /^\+\d+$/.test(x)),
      wheelLabels.join(' · '))
    check('không còn nhãn "×N" trên đĩa', !q('.spin-wheel-times'))
    /* VÒNG 13: "vòng quay cx ko clear và colorful cho người dùng". Bốn tầng
       thưởng nay là BỐN MÀU khác nhau trên đĩa, và chú giải nói lại đúng bốn
       tầng đó.
       VÒNG 15 (soát lại): chú giải CỐ Ý không in số ô và tỉ lệ — bản in đầy đủ
       biến dải này thành một bảng dữ liệu nằm dưới một trò chơi; tỉ lệ thật đã
       đi vào `aria-label` của chính đĩa (n: số ô, odds: từng mức thưởng), chỗ
       duy nhất cần con số chính xác. Phép kiểm cũ đòi "N slices … %" nên báo
       đỏ một điều đã cố ý — nay nó chốt đúng điều đang có. */
    check('đĩa có chú giải bốn dải thưởng', qa('.spin-legend li').length === 4,
      `${qa('.spin-legend li').length} dòng`)
    check('chú giải giữ bốn tầng màu, không in số ô / tỉ lệ',
      qa('.spin-legend li').every(li => li.querySelector('i') && /^\+\d+$/.test((li.textContent || '').trim())),
      qa('.spin-legend li').map(li => (li.textContent || '').trim()).join(' · '))
    check('tỉ lệ thật vẫn đọc được ở nhãn của đĩa', /\d+×\s*\+\d+/.test(
      q('.spin-wheel-wrap')?.getAttribute('aria-label') || ''),
    q('.spin-wheel-wrap')?.getAttribute('aria-label'))
    /* Không còn note thừa: dòng "mỗi lượt thắng trung bình 1,75 vote" ở đầu
       khối và câu "ô nào cũng có thưởng" dưới nút đều đã bị gỡ. */
    /* KÉO ĐĨA — thao tác vừa được thêm. Ba điều phải đúng, và điều thứ ba
       (kéo đủ xa thì đĩa quay thật) chỉ kiểm được bằng cách BẤM THẬT: nó đi
       qua `spin()`, qua nhịp 4,5s và qua trạng thái của component. */
    {
      const wrap = q('.spin-wheel-wrap')
      check('đĩa báo được là kéo được (can-drag)', !!wrap && wrap.classList.contains('can-drag'))
      const ev = (type, x, y, pointerType = 'mouse') => {
        const e = new window.PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7 })
        Object.defineProperty(e, 'pointerType', { value: pointerType })
        return e
      }
      const fire = async (el, e) => { await act(async () => { el.dispatchEvent(e) }); await tick(50) }

      /* (1) ngón tay KHÔNG kéo được: kéo ở giữa màn hình cảm ứng là cuộn trang */
      await fire(wrap, ev('pointerdown', 100, 0, 'touch'))
      check('ngón tay không cầm được đĩa', !wrap.classList.contains('dragging'))
      /* (2) chuột thì cầm được, và đĩa đi theo tay */
      await fire(wrap, ev('pointerdown', 100, 0))
      check('chuột cầm được đĩa', wrap.classList.contains('dragging'))
      await fire(wrap, ev('pointermove', 95, 12))          // ~7° — có xoay, nhưng chưa tới ngưỡng
      check('đĩa xoay theo tay', /rotate\(-?\d+/.test(wrap.style.transform), wrap.style.transform)
      /* (3) kéo hụt (chưa tới ngưỡng 40°) thì nhả ra KHÔNG quay: đĩa trả về chỗ cũ */
      await fire(wrap, ev('pointerup', 95, 12))
      await tick(80)
      check('kéo hụt không tiêu mất lượt quay',
        !wrap.classList.contains('is-spinning') && wrap.style.transform === '',
        wrap.style.transform)
      /* (4) kéo đủ xa rồi nhả: đĩa vào nhịp quay thật */
      await fire(wrap, ev('pointerdown', 100, 0))
      await fire(wrap, ev('pointermove', 0, 100))          // 90° — quá ngưỡng 40°
      await fire(wrap, ev('pointerup', 0, 100))
      const turned = await waitFor(() => wrap.classList.contains('is-spinning'), 1500)
      check('kéo đủ xa thì đĩa quay thật', turned,
        `transform="${wrap.style.transform}" class="${wrap.className}"`)
      await tick(200)
    }
    check('đầu khối quay không còn dòng trung bình cộng',
      !/1\.75|on average/i.test(text()), text().slice(0, 120))
    check('không còn câu ghi chú "ô nào cũng có thưởng"',
      !/Every sector wins/i.test(text()))
  }
  if (name === 'Của tôi') {
    /* GỘP HỒ SƠ VÀO MỤC "ABOUT ME" (vòng 12): sửa hồ sơ nay là một KHỐI của
       trang, không còn là hộp thoại nổi mở từ ảnh đại diện ở chân sidebar. */
    check('mục About me có khối hồ sơ ngay trong trang', !!q('.prof-card') && !!q('#prof-name'))
    check('khối hồ sơ có nút Lưu và nút đổi ảnh', qa('.prof-head-acts button').length >= 1 && !!q('.prof-av-acts button'))
    check('hồ sơ không còn là hộp thoại nổi', !q('.overlay .modal.narrow'))
    check('khối hồ sơ không còn dòng "Square crop…"', !/Square crop/i.test(text()))
    check('mục About me vẫn liệt kê request của mình', !!q('.list') && !!q('.section-title'))
    /* ---- STREAK (vòng 20): dải chuỗi ngày + ba badge cột mốc 7/30/100 ----
       Luật đếm có test số (streak.test.js), hợp đồng schema có test tĩnh; smoke
       chốt phần NGƯỜI THẤY: dải nằm dưới khối hồ sơ, đủ ba badge, và con số
       chuỗi dài nhất luôn được in (badge mờ không được là chỗ trống). */
    check('About me có dải streak với ba badge cột mốc',
      !!q('.streak') && qa('.streak-mile').length === 3, `${qa('.streak-mile').length} badge`)
    check('dải streak in chuỗi dài nhất và luật đếm trong tooltip ngọn lửa',
      /longest \d+/.test(q('.streak')?.textContent || '') && !!q('.streak-flame')?.getAttribute('title'),
      q('.streak')?.textContent?.slice(0, 90))
    /* ---- SHARE CARD (item 7): nút tải PNG ngồi cạnh dải streak. Smoke chỉ
       chốt nút CÓ MẶT — không bấm: canvas vẽ trong môi trường smoke là
       jsdom, getContext('2d') ném "Not implemented" và làm bẩn lượt chạy.
       Phần vẽ thật đã có shareCard.test.js khoá bằng ctx giả. */
    check('About me có nút tải card PNG cạnh dải streak',
      !!q('.streak-row .card-btn'), q('.streak-row .card-btn')?.textContent?.trim())
  }
}

/* ---------- 8b. bảng thông báo (vòng 12) ---------- */
where = 'bảng thông báo'
window.history.pushState({}, '', '/')
window.dispatchEvent(new window.Event('popstate'))
await waitFor(() => !!q('.nt-btn'))
if (q('.nt-btn')) {
  check('chuông chưa mở thì không dựng bảng', !q('#nt-panel') && !q('.nt-scrim'))
  await click(q('.nt-btn'))
  await tick(220)
  const panel = q('#nt-panel')
  check('bấm chuông là bảng hiện ra', !!panel)
  check('bảng nhận được tiêu điểm khi mở', window.document.activeElement === panel,
    window.document.activeElement?.className)
  check('bảng có tiêu đề h2', !!q('#nt-panel .nt-h2'), q('#nt-panel .nt-h2')?.textContent)
  check('bảng có tấm chắn cho máy hẹp', !!q('.nt-scrim'))
  await click(q('.nt-btn'))
  await tick(120)
  check('bấm lần nữa là bảng đóng', !q('#nt-panel'))
}

/* ---------- 9. trang quản trị ---------- */
where = 'trang quản trị'
window.history.pushState({}, '', '/admin')
window.dispatchEvent(new window.Event('popstate'))
await waitFor(() => !!q('.adm-page'))
check('trang quản trị dựng ra', !!q('.adm-page'))
/* LỖI GIAO DIỆN NẶNG (vòng 12): bảng quản trị từng được dựng ở cuối cây React,
   NGOÀI .main — dải số liệu rộng hết màn hình và chui xuống dưới sidebar cố
   định, ô đầu tiên bị cắt. Chốt cả ba tầng khung, vì chỉ cần rơi ra ngoài một
   tầng là lỗi quay lại y như cũ. */
check('trang quản trị nằm trong .main', !!q('.main .adm-page'))
check('trang quản trị nằm trong .sect', !!q('.sect .adm-page'))
check('trang quản trị có tiêu đề trang (h1)', !!q('.mainhead-t'))
check('có dải số liệu chuyển mục', qa('.adm-kpi').length === 6, `${qa('.adm-kpi').length} ô`)
check('có thanh công cụ', !!q('.adm-bar'))
/* TIÊU ĐỀ MỤC ĐANG MỞ: tên mục + số dòng đang xem, ngay trên thanh công cụ.
   (Vạch chia tỉ lệ dưới dải số liệu đã bị gỡ ở vòng 11.) */
const admH2 = q('.adm-h2')
check('có tiêu đề cho mục đang mở', !!admH2 && !!q('.adm-h2-n'),
  admH2?.textContent?.replace(/\s+/g, ' ').trim())
check('không còn vạch chia tỉ lệ trang trí', !q('.adm-mix'))
check('nút xuất CSV có mặt', qa('button').some(b => /Export CSV/.test(b.textContent || '')))

/* Bộ lọc của bảng quản trị nằm ở ĐỊA CHỈ: mở một địa chỉ đã lọc sẵn thì ô tìm
   kiếm phải có sẵn từ khoá, và thẻ <option> sắp xếp phải đúng lựa chọn. */
window.history.pushState({}, '', '/admin?tab=active&q=aespa&sort=votes')
window.dispatchEvent(new window.Event('popstate'))
await tick(400)
check('mở địa chỉ đã lọc sẵn: ô tìm kiếm có sẵn từ khoá', q('.adm-bar .search')?.value === 'aespa',
  `q="${q('.adm-bar .search')?.value}"`)
check('mở địa chỉ đã lọc sẵn: cách xếp đúng lựa chọn', q('.adm-sort')?.value === 'votes',
  `sort="${q('.adm-sort')?.value}"`)

/* TRẠNG THÁI RỖNG CỦA BẢNG QUẢN TRỊ phải NÓI RA LÝ DO, không phải một khung
   trống kèm dòng "Nothing here." — đó chính là thứ người dùng đọc thành "trang
   bị lỗi". Ba phần: icon · dòng đậm nói thiếu gì · dòng nhỏ nói vì sao. */
window.history.pushState({}, '', '/admin?tab=orders')
window.dispatchEvent(new window.Event('popstate'))
await tick(400)
check('đơn hàng rỗng: có khối trạng thái rỗng nói ra lý do',
  !!q('.empty .empty-ico') && !!q('.empty b') && !!q('.empty small'),
  (q('.empty')?.textContent || '').replace(/\s+/g, ' ').trim())
/* Lọc ra rỗng thì phải có LỐI THOÁT, không bắt người dùng tự đoán đã bấm gì. */
window.history.pushState({}, '', '/admin?tab=active&q=zzzzkhongconbai')
window.dispatchEvent(new window.Event('popstate'))
await tick(400)
check('lọc ra rỗng: có nút bỏ bộ lọc', !!q('.empty-acts button'), (q('.empty')?.textContent || '').replace(/\s+/g, ' ').trim())
const clearBtn = q('.empty-acts button')
if (clearBtn) {
  await click(clearBtn)
  await tick(300)
  check('bấm bỏ bộ lọc là danh sách trở lại', qa('.adm').length > 0 || !q('.empty-acts'),
    `${qa('.adm').length} dòng`)
}

/* Mục không có dòng phụ thì không được để lại thẻ rỗng: bảng xếp hạng là mục
   duy nhất như vậy (câu "ai gửi nhiều nhất, ai được làm xong" đã bị gỡ). */
window.history.pushState({}, '', '/ranking')
window.dispatchEvent(new window.Event('popstate'))
await tick(150)
check('bảng xếp hạng không có dòng phụ rỗng', !q('.mainhead-sub'),
  q('.mainhead-sub')?.textContent)

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
  dump(`quản trị · ${k}`, '.adm-page')
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

/* ---------- 9b. RÀ SOÁT DOM TOÀN TRANG (vòng 13) ----------
   Bốn nhóm lỗi mà mắt người bỏ qua nhưng máy đọc được — và cả bốn đều là lỗi
   thật, người dùng gặp bằng cách khác:
     · id trùng: thẻ <label for> hoặc aria trỏ vào id đầu tiên, phần tử thứ hai
       mất tên;
     · nút/ô nhập không có TÊN: trình đọc màn hình đọc "button";
     · tham chiếu aria/label trỏ vào id KHÔNG tồn tại: liên kết đứt;
     · thẻ tương tác lồng trong thẻ tương tác: bấm không biết vào cái nào.
   Soi mọi màn, mọi tab quản trị, và hai hộp thoại — lỗi loại này thường chỉ
   xuất hiện ở đúng màn ít ai mở. */
const auditDom = (label) => {
  const doc = window.document
  const accName = (el) => {
    const own = (el.textContent || '').trim()
    if (own) return own
    for (const a of ['aria-label', 'title', 'alt', 'placeholder', 'value']) {
      const v = el.getAttribute?.(a)
      if (v && String(v).trim() && a !== 'value') return String(v).trim()
    }
    const lb = el.getAttribute?.('aria-labelledby')
    if (lb) {
      const t = lb.split(/\s+/).map(id => doc.getElementById(id)?.textContent || '').join(' ').trim()
      if (t) return t
    }
    if (el.id) {
      const l = doc.querySelector(`label[for="${el.id}"]`)
      if (l?.textContent.trim()) return l.textContent.trim()
    }
    return ''
  }

  const seen = new Map()
  for (const el of doc.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) || 0) + 1)
  const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
  check(`${label}: không có id trùng`, dup.length === 0, dup.join(', '))

  const nameless = []
  for (const el of doc.querySelectorAll('button, a[href], select, textarea, input:not([type="hidden"])')) {
    if (el.closest('[aria-hidden="true"]') || el.closest('.sr-only')) continue
    if (el.tagName === 'A' && /<svg/.test(el.innerHTML) && !el.textContent.trim()) {
      /* icon-only links must still carry a name */
    }
    if (!accName(el)) nameless.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`)
  }
  check(`${label}: phần tử tương tác đều có tên`, nameless.length === 0,
    [...new Set(nameless)].slice(0, 6).join(' | '))

  const broken = []
  for (const el of doc.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby], label[for]')) {
    for (const a of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for']) {
      const v = el.getAttribute(a)
      if (!v) continue
      for (const id of v.split(/\s+/)) if (id && !doc.getElementById(id)) broken.push(`${a}="${id}"`)
    }
  }
  check(`${label}: tham chiếu aria/label đều trỏ tới id có thật`, broken.length === 0,
    [...new Set(broken)].slice(0, 6).join(' | '))

  /* Ảnh: `alt` RỖNG là hợp lệ cho ảnh trang trí; THIẾU HẲN thuộc tính mới lỗi. */
  const noAlt = [...doc.querySelectorAll('img:not([alt])')].length
  check(`${label}: ảnh đều có thuộc tính alt`, noAlt === 0, `${noAlt} ảnh`)

  const nested = []
  for (const sel of ['button button', 'a a', 'button a', 'a button']) {
    for (const el of doc.querySelectorAll(sel)) {
      nested.push(`${sel} @ ${String(el.className || el.tagName).split(' ')[0]}`)
    }
  }
  check(`${label}: không lồng thẻ tương tác trong nhau`, nested.length === 0,
    [...new Set(nested)].slice(0, 4).join(' | '))
}

for (const [label, path] of [['Trang chủ', '/'], ['Daily Spin', '/daily-spin'],
  ['Xếp hạng', '/ranking'], ['About me', '/profile'], ['Quản trị', '/admin']]) {
  where = `rà soát DOM · ${label}`
  window.history.pushState({}, '', path)
  window.dispatchEvent(new window.Event('popstate'))
  await waitFor(() => !q('.splash') && text().length > 200)
  await tick(140)
  auditDom(label)
}

for (const k of ['pending', 'active', 'orders', 'done', 'media']) {
  where = `rà soát DOM · quản trị ${k}`
  window.history.pushState({}, '', `/admin?tab=${k}`)
  window.dispatchEvent(new window.Event('popstate'))
  await waitFor(() => !!q('.adm-page'))
  await tick(140)
  auditDom(`Quản trị · ${k}`)
}

/* Hai hộp thoại: chỗ dày đặc id và nhãn nhất, và cũng là chỗ ít được soi nhất. */
where = 'rà soát DOM · form request'
window.history.pushState({}, '', '/')
window.dispatchEvent(new window.Event('popstate'))
await waitFor(() => !q('.splash') && text().length > 200)
const auditAdd = qa('button').find(b => /New request|Request a|Gửi/i.test(b.textContent || ''))
if (auditAdd) {
  await click(auditAdd)
  if (/Before requesting/i.test(text())) await click(qa('button').find(b => /agree/i.test(b.textContent || '')))
  await tick(200)
  auditDom('Form request')
  if (q('.modal')) {
    const stepBtn2 = qa('.req-actions button').find(b => /Continue|Send request|Fill in/i.test(b.textContent || ''))
    if (stepBtn2) { await click(stepBtn2); await tick(180); auditDom('Form request · bước 2') }
  }
  /* Đóng bằng phím Esc: đúng đường người dùng đi, và không phụ thuộc việc nút
     đóng là `.icon-btn` thứ mấy trong hộp (bấm nhầm thì hộp còn nguyên và màn
     sau bị báo lỗi hai lần). */
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await tick(200)
}

where = 'rà soát DOM · hộp vote'
const auditVote = qa('.votebtn:not([disabled])')[0]
if (auditVote) {
  await click(auditVote)
  await tick(200)
  auditDom('Hộp vote')
  /* ĐÓNG BẰNG Esc, không đi tìm nút đóng: hộp vote dùng `.x` chứ không phải
     `.vm-close` như bản cũ, nên dòng `q('.vm-close, .modal .icon-btn')` cũ trả
     về null và hộp ở LẠI mở suốt các mục sau. Lớp phủ còn treo không làm mục
     nào đỏ, nó chỉ làm mục sau kiểm nhầm chỗ — đúng loại lỗi của chính công cụ
     kiểm thử. Nên sau khi đóng phải CHỐT là không còn lớp phủ nào. */
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await tick(250)
  check('đóng hộp vote: không còn lớp phủ nào treo lại', qa('.overlay').length === 0,
    `${qa('.overlay').length} lớp phủ`)
}

/* ---------- 10. MÔI TRƯỜNG THÙ ĐỊCH: ghi địa chỉ bị chặn ----------
   Bản xem trước của nền tảng chạy trong iframe, và một iframe bị sandbox (hoặc
   trang mở bằng file://, hoặc chế độ riêng tư của vài trình duyệt) NÉM
   SecurityError ở `pushState`/`replaceState`. Trước vòng 11, lỗi đó bắn ra từ
   trong handler React: người dùng bấm "Admin" và không có gì xảy ra — đúng ca
   "trang quản trị hỏng toàn bộ" mà chủ dự án báo. Bài kiểm này giả lập đúng
   môi trường đó rồi đi bằng ĐƯỜNG NGƯỜI DÙNG: bấm nút trong menu. */
where = 'iframe bị sandbox (history ném lỗi)'
const realPush = window.history.pushState
const realReplace = window.history.replaceState
const boom = () => { throw new window.DOMException('The operation is insecure.', 'SecurityError') }
window.history.pushState = boom
window.history.replaceState = boom
try {
  /* Rời khỏi trang quản trị TRƯỚC khi chặn history — nếu không thì phép kiểm
     "vẫn mở được" chỉ xác nhận cái đang có sẵn trên màn hình. */
  const item = (name) => qa('.side-nav .side-item').find(a => new RegExp('^' + name).test((a.textContent || '').trim()))
  const navBoard = item('Requests')
  if (navBoard) await click(navBoard)
  await tick(220)
  const before = problems.length
  const navAdmin = item('Admin')
  check('menu có mục Admin để bấm', !!navAdmin, navAdmin ? '' : (q('.side-nav')?.textContent || '').slice(0, 80))
  if (navAdmin) await click(navAdmin)
  const opened = await waitFor(() => !!q('.adm-page'), 3000)
  check('địa chỉ bị chặn: bảng quản trị vẫn mở', opened,
    opened ? '' : text().slice(0, 140))
  const kpis = qa('.adm-kpi')
  if (kpis.length > 2) {
    await click(kpis[2])
    await tick(250)
    check('địa chỉ bị chặn: vẫn đổi được mục',
      kpis[2].className.includes('on') && !!q('.adm-page'))
  }
  check('địa chỉ bị chặn: không có lỗi mới trong console', problems.length === before,
    problems.slice(before).map(x => x.text).join(' / ').slice(0, 180))
} finally {
  window.history.pushState = realPush
  window.history.replaceState = realReplace
}

/* ---------- 10b. HỘP XÁC NHẬN + NĂM ĐƯỜNG GHI DỮ LIỆU ----------
   Vì sao tới giờ mới kiểm được: bảy thao tác không hoàn tác được (xoá request,
   xoá video, xoá hàng loạt, từ chối bài, huỷ đơn) trước đây hỏi bằng
   `confirm()`/`prompt()` của trình duyệt — jsdom cài hai hàm đó là hàm rỗng,
   nên bấm vào là KHÔNG GÌ XẢY RA và không có gì để kiểm. Trong iframe bị chặn
   hộp thoại (mọi khung xem trước) trình duyệt thật cũng trả về y như vậy.
   Nay chúng hỏi bằng hộp của app, nên kiểm được — và phải kiểm, vì đây là
   những đường GHI dữ liệu duy nhất mà tới giờ chưa có máy nào chạm tới.

   Thứ tự dưới đây là CỐ Ý: mục About me và bảng quản trị dùng chung một hàng
   dữ liệu, nên bên nào chạy trước cũng lấy mất dòng của bên kia. */
{
  where = 'hộp xác nhận'
  const dlgTitle = () => q('.dlg #dlg-title')?.textContent || '(không có hộp)'
  const dlgBtn = (re) => qa('.dlg-acts button').find(b => re.test(b.textContent || ''))
  const byLabel = (re, root) => qa('.icon-btn', root || window.document)
    .find(b => re.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
  const nextBtn = () => qa('.req-actions button').find(b => /Continue|Fill in/i.test(b.textContent || ''))
  const goto = async (path, ready, ms = 4000) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new window.Event('popstate'))
    const ok = await waitFor(ready, ms)
    await tick(220)
    return ok
  }

  /* (A) NGƯỜI DÙNG: GỬI request thật rồi XOÁ nó ở mục About me.
     Phải tự tạo dòng của mình: dữ liệu mẫu chỉ có hai dòng thuộc về người đang
     đăng nhập, và cả hai đều ở trạng thái KHÔNG xoá được (đang làm / đã xong) —
     nút xoá chỉ hiện với pending, queued, denied. Đường GỬI cũng vì thế mà
     được chạy hết lần đầu: mục 6 mới đi tới bước 3 rồi đóng, chưa bao giờ bấm
     nút gửi thật. */
  where = 'hộp xác nhận · người dùng'
  const sendRequest = async (artist, title, label) => {
    const add = qa('button').find(b => /New request|Request a|Gửi/i.test(b.textContent || ''))
    if (!add) { check(`gửi request ${label}: mở được form`, false, 'không thấy nút mở form'); return false }
    await click(add)
    if (/Before requesting/i.test(text())) {
      await click(qa('button').find(b => /agree/i.test(b.textContent || '')))
    }
    await tick(220)
    for (let i = 0; i < 3 && !q('#rq-artist'); i++) {
      const b = nextBtn(); if (!b) break
      await click(b); await tick(160)
    }
    if (!q('#rq-artist')) {
      check(`gửi request ${label}: tới được bước 2`, false, text().slice(0, 80)); return false
    }
    await type(q('#rq-artist'), artist)
    await type(q('#rq-title'), title)
    for (let i = 0; i < 3 && !q('.req-actions button[type="submit"]'); i++) {
      const b = nextBtn(); if (!b) break
      await click(b); await tick(160)
    }
    const sendBtn = q('.req-actions button[type="submit"]')
    if (!sendBtn) { check(`gửi request ${label}: bước 3 có nút gửi thật`, false); return false }
    await click(sendBtn)
    const sent = await waitFor(() => !!q('.msg.ok'), 3000)
    check(`gửi request ${label}: form báo đã gửi`, sent,
      q('.msg')?.textContent?.slice(0, 80) || 'không thấy dòng xác nhận')
    /* Đóng form sau mỗi lần gửi: lần sau bắt đầu từ trạng thái sạch, nếu không
       thì "chờ dòng báo đã gửi" chỉ là chờ thứ còn nằm đó từ lần trước. */
    const x = q('.modal .icon-btn')
    if (x) await click(x)
    await tick(240)
    return sent
  }

  await goto('/', () => !q('.splash') && text().length > 200)
  await sendRequest('XG', 'Shooting Star', '1')
  await sendRequest('XG', 'Left Right', '2')

  await goto('/profile', () => !!q('.prof-card'))
  await waitFor(() => qa('.row .icon-btn').length > 0, 3000)
  await tick(200)
  const mineDel = () => qa('.row .icon-btn').find(b =>
    /delete/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
  check('About me: request của mình có nút xoá', !!mineDel(),
    qa('.row .icon-btn').map(b => b.getAttribute('aria-label') || '?').join(' | ') || 'không có nút xoá nào')
  if (mineDel()) {
    const rows0 = qa('.row').length
    await click(mineDel())
    check('xoá request của mình thì hỏi bằng hộp của app', !!q('.dlg[role="dialog"]'), dlgTitle())
    check('hộp xoá nói rõ hậu quả không lấy lại được', !!q('#dlg-body'), q('#dlg-body')?.textContent)
    /* Bấm HUỶ trước: một hộp hỏi mà không rút lại được thì không phải là hỏi. */
    await click(dlgBtn(/Cancel/i))
    await tick(220)
    check('bấm Cancel: hộp đóng và request vẫn còn', !q('.dlg') && qa('.row').length === rows0,
      `hộp=${!!q('.dlg')} dòng=${qa('.row').length}/${rows0}`)
    await click(mineDel())
    await click(dlgBtn(/Delete/i))
    await waitFor(() => qa('.row').length < rows0, 2500)
    check('bấm Delete: request của mình biến mất khỏi danh sách', qa('.row').length === rows0 - 1,
      `${rows0} → ${qa('.row').length}`)
  }

  /* Request thứ ba GỬI SAU khi đã xoá một cái: hạn mức là 3 request/giờ và nó
     đếm cả hàng mẫu vừa được tạo lúc này, nên phải trả lại một suất rồi mới
     gửi tiếp. Bảng quản trị bên dưới cần đúng ba dòng chờ duyệt cho ba lệnh —
     xoá một dòng, từ chối một dòng, và lệnh hàng loạt trên dòng cuối. */
  await goto('/', () => !q('.splash') && text().length > 200)
  await sendRequest('XG', 'Winter Without You', '3 · sau khi xoá một cái')

  /* (B) BẢNG QUẢN TRỊ — cùng hộp đó, bốn đường ghi khác. */
  where = 'hộp xác nhận · quản trị'
  await goto('/admin?tab=pending', () => !!q('.adm-page'))
  /* Đợi cả DỮ LIỆU: quay lại trang này lần thứ hai thì khung có trước hàng vài
     trăm mili giây, chờ mỗi khung là kiểm vào lúc bảng còn trống. */
  await waitFor(() => qa('.adm').length > 0, 3000)
  await tick(200)
  const rowsAdmin = () => qa('.adm .adm-acts').length
  const selCount = () => qa('.adm .adm-sel input[type="checkbox"]').filter(b => b.checked).length
  const n0 = rowsAdmin()
  check('mục Chờ duyệt có dòng để thử', n0 > 0, `${n0} dòng`)

  /* (B1) Esc = huỷ, và huỷ thì KHÔNG xoá gì. */
  const pendTrash = byLabel(/delete/i, q('.adm'))
  check('dòng quản trị có nút xoá', !!pendTrash)
  if (pendTrash) {
    await click(pendTrash)
    check('bấm xoá trong bảng quản trị cũng mở hộp của app',
      !!q('.dlg[role="dialog"]'), dlgTitle())
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await tick(250)
    check('Esc: đóng hộp và không xoá dòng nào', !q('.dlg') && rowsAdmin() === n0,
      `hộp=${!!q('.dlg')} dòng=${rowsAdmin()}/${n0}`)
  }

  /* (B2) Xoá MỘT dòng — số dòng phải giảm ĐÚNG một. */
  const t1 = byLabel(/delete/i, q('.adm'))
  if (t1) {
    const n = rowsAdmin()
    await click(t1)
    await click(dlgBtn(/Delete/i))
    await waitFor(() => rowsAdmin() < n, 2500)
    check('xoá một dòng: danh sách giảm đúng một', rowsAdmin() === n - 1, `${n} → ${rowsAdmin()}`)
  } else {
    check('xoá một dòng quản trị', false, 'không còn dòng nào để xoá')
  }

  /* (B3) TỪ CHỐI một bài: hộp phải hỏi LÝ DO gửi cho người đặt. */
  const denyBtn = qa('.adm .adm-acts button').find(b => /Deny/i.test(b.textContent || ''))
  if (denyBtn) {
    const n = rowsAdmin()
    await click(denyBtn)
    const box = q('.dlg-field textarea')
    check('từ chối bài: hộp hỏi lý do gửi cho người đặt', !!box, dlgTitle())
    if (box) {
      await type(box, 'already on the channel')
      const okDeny = dlgBtn(/Deny/i)
      check('hộp từ chối có nút riêng, không lẫn với nút xoá', !!okDeny,
        qa('.dlg-acts button').map(b => b.textContent).join(' / '))
      if (okDeny) {
        await click(okDeny)
        await waitFor(() => rowsAdmin() < n, 2500)
        check('từ chối xong: dòng rời khỏi danh sách chờ', rowsAdmin() === n - 1, `${n} → ${rowsAdmin()}`)
      }
    }
  } else {
    check('dòng chờ duyệt có nút Từ chối', false, q('.adm-acts')?.textContent?.slice(0, 80))
  }

  /* (B4) HÀNG LOẠT: hai lệnh nguy hiểm ở đây, cả hai đều phải hỏi lại — và lời
     hỏi phải nói ra SỐ dòng, vì "bạn chắc chưa?" không cho biết mình sắp mất gì. */
  const boxes2 = () => qa('.adm .adm-sel input[type="checkbox"]')
  const pickToggle = q('.adm-pickbtn')
  check('bảng quản trị có nút bật chế độ chọn nhiều', !!pickToggle)
  if (pickToggle) {
    await click(pickToggle)
    await tick(160)
    check('bật chế độ chọn: mỗi dòng có một ô tick', boxes2().length > 0, `${boxes2().length} ô`)
    if (boxes2().length) {
      /* Ô tick là `input` THẬT (xem Check.jsx) nên bấm bằng `.click()` để trình
         duyệt tự lật `checked` rồi bắn `change` cho React nghe. */
      await act(async () => { boxes2()[0].click() })
      await tick(180)
      const bulkBar = q('.adm-bulk')
      check('chọn một dòng: thanh lệnh hàng loạt hiện ra', !!bulkBar)
      const bulkDeny = qa('.adm-bulk button').find(b => /^Deny/i.test((b.textContent || '').trim()))
      check('thanh hàng loạt (tab Chờ duyệt) có nút Từ chối', !!bulkDeny)
      if (bulkBar && bulkDeny) {
        const n = rowsAdmin()
        await click(bulkDeny)
        check('từ chối hàng loạt hỏi lại và nói ra số dòng', /1/.test(dlgTitle()), dlgTitle())
        check('từ chối hàng loạt cũng hỏi LÝ DO, không chỉ hỏi có/không',
          !!q('.dlg-field textarea'), q('.dlg-body')?.textContent?.slice(0, 60))
        /* HUỶ lệnh này (Esc) chứ không xác nhận: còn phải để dòng cho lệnh xoá
           hàng loạt bên dưới, và điều cần kiểm ở đây là "có hỏi lại không". */
        await act(async () => {
          window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        await tick(250)
        check('huỷ lệnh hàng loạt: không dòng nào bị từ chối',
          rowsAdmin() === n && selCount() === 1,
          `dòng=${rowsAdmin()}/${n} chọn=${selCount()}`)
      }
    }
  }

  /* (B5) XOÁ HÀNG LOẠT — lệnh không hoàn tác được, và là lệnh cuối cùng. */
  if (boxes2().length) {
    /* Lựa chọn còn nguyên sau khi huỷ hộp ở trên — chỉ tick nếu chưa tick, vì
       bấm lần nữa là BỎ chọn. */
    if (!boxes2()[0].checked) {
      await act(async () => { boxes2()[0].click() })
      await tick(180)
    }
    const bulkDel = qa('.adm-bulk button').find(b => /^Delete/i.test((b.textContent || '').trim()))
    check('thanh hàng loạt có nút Xoá', !!bulkDel,
      qa('.adm-bulk button').map(b => b.textContent).join(' / '))
    if (bulkDel) {
      const n = rowsAdmin()
      await click(bulkDel)
      check('xoá hàng loạt: hộp nói ra số dòng sắp mất', dlgTitle().includes(String(n)), dlgTitle())
      await click(dlgBtn(/Delete/i))
      await waitFor(() => rowsAdmin() < n, 2500)
      check('xoá hàng loạt xong: bảng bớt đúng số dòng đã chọn', rowsAdmin() === n - 1,
        `${n} → ${rowsAdmin()}`)
    }
  } else {
    check('xoá hàng loạt', false, 'không còn dòng nào để chọn')
  }

  /* (B6) XOÁ VIDEO (tab Media) — đường thứ năm, cùng một hộp. */
  where = 'hộp xác nhận · video'
  await goto('/admin?tab=media', () => !!q('.adm-page'))
  await waitFor(() => qa('.mrow').length > 0, 3000)
  await tick(200)
  const mediaDel = byLabel(/delete/i, q('.mrow'))
  check('tab Media có dòng và có nút xoá', !!mediaDel)
  if (mediaDel) {
    const n = qa('.mrow').length
    await click(mediaDel)
    check('xoá video: hộp của app mở ra, không phải hộp thoại trình duyệt',
      !!q('.dlg[role="dialog"]'), dlgTitle())
    check('hộp xoá video nói rõ nó biến khỏi trang chủ', !!q('#dlg-body'), q('#dlg-body')?.textContent)
    await click(dlgBtn(/Delete/i))
    await waitFor(() => qa('.mrow').length < n, 2500)
    check('xoá video xong: danh sách ngắn lại', qa('.mrow').length === n - 1,
      `${n} → ${qa('.mrow').length}`)
  }

  check('không có lỗi runtime nào rơi ra trong các đường ghi trên',
    problems.filter(p => p.kind !== 'warn').length === 0,
    problems.filter(p => p.kind !== 'warn').map(p => `(${p.where}) ${p.text}`).join(' / ').slice(0, 200))
}

/* ---------- 10c. BÀI TRẢ PHÍ: BẤM ĐƯỢC, Ở LẠI, VÀ TỰ TẮT SAU KHI GỬI ----------
   Ba lỗi thật, kiểm bằng ba đường người dùng đi:

     (1) Ô "bài trả phí" nằm ở bước 3 cạnh chữ giải thích — người dùng bấm vào
         CHỮ, không bấm vào ô vuông 16px. Nếu chỉ `<input>` ăn cú bấm thì lựa
         chọn này coi như không tồn tại.
     (2) Ba tab của hộp (Request / Vote / Buy) dùng chung một hộp thoại: xem bảng
         giá rồi quay lại KHÔNG được làm mất form. Trước đây thì mất sạch — chữ,
         bước đang đứng, và cả ô tick vừa chọn — vì `RequestTab` bị tháo khỏi cây
         và bộ đếm 400ms ghi nháp bị huỷ theo.
     (3) Gửi xong một request trả phí thì lựa chọn đó phải TẮT. Không tắt thì mọi
         request sau đều được đánh dấu trả phí sẵn: người dùng đi tới bước 3 mà
         không hề được hỏi lại, và một đơn hàng nữa được tạo trong im lặng. */
where = 'bài trả phí'
{
  const openForm = async () => {
    /* Đóng hết hộp đang mở trước, nếu không thì nút "New request" tìm thấy có
       thể là tab trong HỘP VOTE (hộp đó cũng có tab tên "New request"), và cả
       khối kiểm này sẽ chạy trong sai hộp mà không báo gì. `.side-cta` là nút
       trong thanh bên — lối vào duy nhất chắc chắn nằm trên trang. */
    for (let i = 0; i < 4 && qa('.overlay').length; i++) {
      await act(async () => {
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await tick(250)
    }
    check('10c: mở form từ trang sạch (không còn hộp nào treo)', qa('.overlay').length === 0,
      `${qa('.overlay').length} lớp phủ`)
    const b = q('.side-cta')
    if (b) await click(b)
    if (/Before requesting/i.test(text())) {
      await click(qa('button').find(x => /agree/i.test(x.textContent || '')))
    }
    await tick(250)
    for (let i = 0; i < 3 && !q('#rq-artist'); i++) {
      const n = qa('.req-actions button').find(x => /Continue|Fill in/i.test(x.textContent || ''))
      if (!n) break
      await click(n); await tick(160)
    }
  }
  const toSend = async () => {
    for (let i = 0; i < 3 && !q('.paidbox'); i++) {
      const n = qa('.req-actions button').find(x => /Continue|Fill in/i.test(x.textContent || ''))
      if (!n) break
      await click(n); await tick(160)
    }
  }
  const tickBox = () => q('.paidbox input[type=checkbox]')
  const stepNow = () => qa('.req-step .rs-btn').findIndex(b => b.getAttribute('aria-current') === 'step') + 1
  /* Điền một bài từ bất kỳ bước nào rồi tới bước 3. Gửi xong thì form tự về
     bước 1, nên "gõ vào ô tên bài" không phải lúc nào cũng bắt đầu ở bước 2. */
  const fill = async (artist, title) => {
    for (let i = 0; i < 2 && !q('#rq-artist'); i++) {
      const n = qa('.req-actions button').find(x => /Continue|Fill in/i.test(x.textContent || ''))
      if (!n) break
      await click(n); await tick(160)
    }
    if (!q('#rq-artist')) { check(`điền được bài "${title}"`, false, text().slice(0, 80)); return false }
    await type(q('#rq-artist'), artist)
    await type(q('#rq-title'), title)
    await toSend()
    return true
  }

  /* (0) ĐƯỜNG GỬI NGẦM CỦA TRÌNH DUYỆT — lỗi chủ dự án gặp, và là lỗi mà cả bộ
     kiểm này từng không thể thấy. Trong trình duyệt thật, bấm Enter trong một ô
     nhập là GỬI form (trên điện thoại, phím Enter chính là nút "Go" của bàn
     phím) — không đi qua bước 3, nên không bao giờ thấy ô chọn bài trả phí:
     request được tạo thẳng thành request thường. jsdom chỉ phát `submit` khi
     người ta bấm NÚT gửi, nên đứng ở bước 2 mà bấm Enter thì nó im lặng không
     làm gì — đúng chỗ mà máy kiểm thật thà tin rằng "không có gì xảy ra".
     Nên ở đây phải tự phát đúng sự kiện mà trình duyệt sẽ phát. */
  const implicitSubmit = async () => {
    await act(async () => {
      q('form')?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
    await tick(250)
  }
  const reqCount = () => JSON.parse(window.localStorage.getItem('ccl3_rows') || '[]').length
  const enterIn = async (el) => {
    await act(async () => {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await tick(220)
  }

  await openForm()
  await click(qa('.req-actions button').find(x => /Continue|Fill in/i.test(x.textContent || '')))
  await type(q('#rq-artist'), 'XG')
  await type(q('#rq-title'), 'Something Ain\'t Right')
  await type(q('#rq-link'), 'https://youtu.be/dQw4w9WgXcQ')
  {
    const before = reqCount()
    await enterIn(q('#rq-link'))
    check('Enter trong ô Link ở bước 2: sang bước 3, KHÔNG gửi luôn', stepNow() === 3 && reqCount() === before,
      `bước=${stepNow()} request ${before} → ${reqCount()}`)
  }
  {
    const before = reqCount()
    await implicitSubmit()
    check('gửi từ bước 3 là đường gửi thật: tạo đúng 1 request',
      reqCount() === before + 1, `request ${before} → ${reqCount()}`)
    const req = JSON.parse(window.localStorage.getItem('ccl3_rows') || '[]')[0]
    check('gửi từ bước 3 khi chưa tick: là request thường, không tự thành trả phí',
      req?.is_paid === false, JSON.stringify({ is_paid: req?.is_paid }))
  }
  await click(q('.modal .x'))
  await tick(250)
  window.localStorage.removeItem('ccl.reqDraft')

  /* Bây giờ mới tới lượt kiểm chính: điền xong ở bước 2 rồi để TRÌNH DUYỆT gửi
     ngầm — không được tạo request nào, và phải đứng ở bước 3. */
  await openForm()
  await click(qa('.req-actions button').find(x => /Continue|Fill in/i.test(x.textContent || '')))
  await type(q('#rq-artist'), 'XG')
  await type(q('#rq-title'), "Something Ain't Right")
  {
    const before = reqCount()
    await implicitSubmit()
    check('GỬI NGẦM ở bước 2 không tạo request nào (nút "Go" trên bàn phím điện thoại)',
      reqCount() === before, `request ${before} → ${reqCount()}`)
    check('...và đưa người dùng tới bước 3 — nơi có ô chọn bài trả phí, thay vì gửi thẳng',
      stepNow() === 3 && !!q('.paidbox'), `bước=${stepNow()} paidbox=${!!q('.paidbox')}`)
    /* Thứ tự trong bước 3 là một quyết định thiết kế, không phải chuyện ngẫu
       nhiên: lựa chọn trả phí phải nằm TRƯỚC ghi chú để mắt gặp nó trước. */
    const pb = q('.paidbox'), nf = q('.note-field')
    check('ô "bài trả phí" đứng TRƯỚC ô ghi chú trong bước 3',
      !!pb && !!nf && !!(pb.compareDocumentPosition(nf) & window.Node.DOCUMENT_POSITION_FOLLOWING),
      `paidbox=${!!pb} note=${!!nf}`)
  }
  check('bước 3 của form có ô "bài trả phí"', !!q('.paidbox') && !!tickBox(),
    q('.paidbox')?.textContent?.replace(/\s+/g, ' ').slice(0, 70) || '(không có)')

  /* (1) Bấm vào CHỮ của nhãn — đích bấm thật của ngón tay. */
  check('10c: có ô tick để thử cú bấm', !!tickBox())
  if (tickBox()) {
    const before = tickBox().checked
    await act(async () => {
      q('.paidbox .t').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await tick(140)
    check('bấm vào chữ "Paid request": ô tick ăn thật', tickBox().checked !== before,
      `${before} → ${tickBox().checked}`)
    check('tick xong thì nút gửi nói đúng việc sắp làm (nút vàng, có giá)',
      /paid request/i.test(q('.req-actions button[type="submit"]')?.textContent || '')
      && !!q('.req-actions .btn-gold'),
      `${q('.req-actions button[type="submit"]')?.textContent?.trim()}`)
  }

  /* (2) Đổi tab trong cùng hộp rồi quay lại: form phải còn nguyên. */
  /* Tab trong ĐÚNG hộp request — hộp có dải ba bước. Hộp vote cũng có một dải
     `.modal-tabs` với tab tên "New request", nên tìm tab theo toàn trang là bắt
     nhầm hộp kia (đã xảy ra một lần và làm cả khối này chạy trong sai hộp mà
     không báo gì). */
  const reqModal = qa('.modal').find(m => m.querySelector('.req-steps'))
  const reqTabs = () => [...(reqModal?.querySelectorAll('.modal-tabs .mtab') || [])]
  const mtab = (re) => reqTabs().find(b => re.test(b.textContent || ''))
  check('10c: hộp request có tab Vote để đổi qua lại', !!mtab(/^Vote/i) && !!mtab(/^New request/i),
    reqTabs().map(b => b.textContent.trim()).join(' / ') || '(không thấy dải tab)')
  if (mtab(/^Vote/i) && mtab(/^New request/i)) {
    const tabsBefore = reqTabs().map(b => b.textContent.trim()).join(' / ')
    await click(mtab(/^Vote/i)); await tick(220)
    check('rời tab Request thì bảng vote hiện ra (và form request rời màn)',
      !!q('.vote-status') && !q('.paidbox'),
      `vote-status=${!!q('.vote-status')} paidbox=${!!q('.paidbox')} tabs=${tabsBefore}`)
    await click(mtab(/^New request/i)); await tick(300)
    check('quay lại tab Request: vẫn đứng ở bước 3, không bị đẩy về bước 1',
      stepNow() === 3, `bước ${stepNow()}`)
    check('quay lại tab Request: ô "bài trả phí" còn tick', !!tickBox()?.checked,
      `tick=${tickBox()?.checked}`)
    check('quay lại tab Request: form sống bằng nháp, và có dòng nói ra',
      !!q('.draft-note'), q('.draft-note')?.textContent)
  }

  /* (3) Gửi thật một request trả phí, rồi xem form có tự tắt lựa chọn không. */
  const sendPaid = q('.req-actions button[type="submit"]')
  const paidReady = !!sendPaid && tickBox()?.checked === true && stepNow() === 3
  check('10c: tới được trạng thái "gửi request trả phí" để kiểm phần tiền',
    paidReady, `bước=${stepNow()} tick=${tickBox()?.checked} nút=${sendPaid?.textContent?.trim() || '(không có)'}`)
  if (paidReady) {
    await click(sendPaid)
    const okPaid = await waitFor(() => !!q('.msg.ok'), 3000)
    check('gửi request trả phí: có dòng xác nhận kèm số tiền', okPaid,
      q('.msg')?.textContent?.slice(0, 80) || '(không có)')
    const rowsNow = JSON.parse(window.localStorage.getItem('ccl3_rows') || '[]')
    const paidRow = rowsNow.find(r => r.artist === 'XG' && r.title === "Something Ain't Right")
    check('request vừa gửi được đánh dấu trả phí trong dữ liệu',
      paidRow?.is_paid === true && paidRow?.payment_status === 'awaiting',
      JSON.stringify(paidRow && { is_paid: paidRow.is_paid, payment_status: paidRow.payment_status }))
    const ordersNow = JSON.parse(window.localStorage.getItem('ccl3_orders') || '[]')
    check('và có một đơn đang chờ thanh toán trỏ đúng vào request đó',
      ordersNow.some(o => o.kind === 'paid_request' && o.status === 'awaiting'
        && o.request_id === paidRow?.id),
      ordersNow.slice(0, 2).map(o => `${o.kind}/${o.status}`).join(' | '))
    check('gửi xong thì form về bước 1', stepNow() === 1, `bước ${stepNow()}`)

    /* ĐIỀU QUAN TRỌNG NHẤT: request KẾ TIẾP không được thừa hưởng lựa chọn đó. */
    await fill('IVE', 'ATTITUDE')
    check('request kế tiếp: ô "bài trả phí" đã TẮT (không thừa hưởng lựa chọn cũ)',
      tickBox()?.checked === false, `tick=${tickBox()?.checked}`)
    check('request kế tiếp: nút gửi trở lại là "Send request" thường',
      !/paid/i.test(q('.req-actions button[type="submit"]')?.textContent || ''),
      q('.req-actions button[type="submit"]')?.textContent?.trim())

    /* Bấm Clear khi đã tick: lựa chọn trả phí cũng phải bị dọn. */
    await act(async () => {
      q('.paidbox .t').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await tick(140)
    /* eslint-disable-next-line no-unused-vars */
    const clearBtn = qa('.req-actions button').find(b => /Clear/i.test(b.textContent || ''))
    if (clearBtn && tickBox()?.checked) {
      await click(clearBtn)
      await tick(150)
      await fill('aespa', 'Drama')
      check('bấm "Clear" rồi điền lại: ô "bài trả phí" cũng đã tắt',
        tickBox()?.checked === false, `tick=${tickBox()?.checked}`)
    }
  }
  const closeReq = q('.modal .x')
  if (closeReq) await click(closeReq)
  await tick(250)
}

/* ---------- 10d. TRANG CÁ NHÂN CÔNG KHAI + "BẤM MỘT BÀI PHẢI RA ĐÚNG BÀI ĐÓ" ----------
   Bốn lỗi người dùng báo trong hai ngày, kiểm lại bằng ĐƯỜNG BẤM THẬT:
     · bấm tên người gửi → trang cá nhân mở, KHÔNG tải lại trang (không màn chờ);
     · bấm "Back to board" → về bảng;
     · bấm một bài trong Recent requests → bảng lọc sẵn ĐÚNG bài đó, kể cả khi
       bài đã completed và kể cả khi đang bật chip lọc nào đó;
     · và tất cả vẫn chạy khi `pushState` bị chặn (iframe sandbox / file://).
   Dữ liệu mẫu có sẵn đúng ca cần: `demo-user` gửi "Get Up" (NewJeans) và bài đó
   ĐÃ XONG — nghĩa là `f=top`, một chip `Queue` còn sót, hay một chip loại bài
   còn sót đều đủ để làm nó biến mất. Đây là phép kiểm end-to-end cho những gì
   profileNav.test.js giữ bằng hợp đồng trên mã nguồn. */
{
  where = 'trang cá nhân công khai'
  const goto = async (path, ready, ms = 4000) => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new window.Event('popstate'))
    const ok = await waitFor(ready, ms)
    await tick(220)
    return ok
  }
  const splashUp = () => !!q('.splash:not(.hide)')
  const items = () => qa('.list .row, .list .grow')
  const searched = () => q('input.search')?.value || ''
  /* Nhãn chip KHÔNG kèm con số: `<b class="fnum">` đứng sát nhãn nên
     textContent là "Queue12" — muốn so nhãn thì phải bóc số ra trước. */
  const chipLabel = (c) => (c.textContent || '').replace(/\s+/g, ' ').replace(/\d+$/, '').trim()
  const onChips = () => qa('.fchip.on').map(chipLabel)
  /* Nhãn của bốn chip GIAI ĐOẠN (i18n: filter.queued/picked/in_progress/completed).
     Những chip còn lại trong dải là cách nhìn (Newest/Top voted/Following). */
  const STAGE = /^(Queue|Up next|In progress|Done)$/
  const chip = (re) => qa('.fchip').find(c => re.test(chipLabel(c)))
  const before = problems.length
  const quiet = (label) => check(`${label}: không có lỗi mới trong console`, problems.length === before,
    problems.slice(before).map(x => x.text).join(' / ').slice(0, 180))

  /* (1) BẤM TÊN NGƯỜI GỬI TRÊN BẢNG */
  await goto('/', () => !q('.splash') && items().length > 0)
  const person = q('.requester-link')
  check('bảng có tên người gửi bấm được', !!person, (q('.list')?.textContent || '').slice(0, 120))
  const personHref = person?.getAttribute('href') || ''
  const uid = new URLSearchParams(personHref.replace(/^[^?]*\??/, '')).get('profile')
  check('link người gửi là THẺ THẬT dạng ?profile=<id> (host tĩnh không phục vụ /u/)',
    !!uid && personHref.startsWith('/?profile='), personHref)
  await click(person)
  check('bấm tên người gửi: trang cá nhân mở ra',
    await waitFor(() => !!q('.public-profile-head'), 3000), text().slice(0, 140))
  check('mở trang cá nhân KHÔNG tải lại trang (không màn chờ)', !splashUp())
  check('trang cá nhân hiện thay cho danh sách bảng', !q('.list'))
  check('địa chỉ mang đúng tham số profile', uid
    && new URLSearchParams(window.location.search).get('profile') === uid, window.location.search)
  check('trang cá nhân có ba ô số liệu', qa('.public-stats > div').length === 3,
    `${qa('.public-stats > div').length} ô`)
  /* cột mốc chuỗi ngày là thứ cộng đồng THẤY NHAU (chủ dự án chốt hiện ở cả
     trang công khai) — dải phải có mặt với đủ ba badge sáng/mờ */
  check('trang cá nhân công khai có dải streak ba badge',
    !!q('.streak') && qa('.streak-mile').length === 3, q('.streak')?.textContent?.slice(0, 90))
  check('có nút chia sẻ và nút quay lại', !!q('.profile-share') && !!q('.profile-back'))
  check('hồ sơ công khai có nút tải card PNG cạnh nút chia sẻ link',
    !!q('.profile-share-row .card-btn'), q('.profile-share-row .card-btn')?.textContent?.trim())
  check('nút quay lại là một link thật (middle-click / Back của trình duyệt còn dùng được)',
    q('.profile-back')?.tagName === 'A' && !!q('.profile-back')?.getAttribute('href'),
    q('.profile-back')?.outerHTML?.slice(0, 90))

  /* (2) RECENT REQUESTS: link phải dựng được từ dữ liệu thật */
  const recent = qa('.public-request-link')
  check('trang cá nhân liệt kê Recent requests', recent.length > 0, `${recent.length} bài`)
  check('mỗi Recent request là link trỏ về bảng, từ khoá KHÔNG rỗng',
    recent.length > 0 && recent.every(a => {
      const h = a.getAttribute('href') || ''
      const p = new URLSearchParams(h.replace(/^[^?]*\??/, ''))
      return h.startsWith('/?f=newest&q=') && p.get('f') === 'newest' && (p.get('q') || '').trim().length > 2
    }), recent.map(a => a.getAttribute('href')).join(' | ').slice(0, 200))
  check('mỗi Recent request có nhãn trạng thái (không phải chữ `undefined`)',
    qa('.public-state').length === recent.length
    && qa('.public-state').every(e => (e.textContent || '').trim().length > 2),
    qa('.public-state').map(e => e.textContent).join(' | '))

  /* GHI LẠI LỆNH CUỘN: jsdom không cuộn thật (hai hàm này đã bị thay bằng hàm
     rỗng ở đầu file), nên muốn biết "bấm một bài thì trang cuộn đi đâu" phải tự
     ghi lại. `scrollIntoView` là cuộn TỚI một phần tử; `window.scrollTo({top:0})`
     là cuộn lên đầu trang — hai thứ đó cho hai trải nghiệm khác hẳn nhau. */
  const scrolled = []
  const realSIV = window.Element.prototype.scrollIntoView
  const realScrollTo = window.scrollTo
  window.Element.prototype.scrollIntoView = function (opt) {
    scrolled.push(`${this.className || this.tagName.toLowerCase()}${opt?.block ? ` (${opt.block})` : ''}`)
  }
  window.scrollTo = (opt) => scrolled.push(`window.scrollTo(${JSON.stringify(opt)})`)
  try {

  /* (3) BẤM MỘT BÀI ĐÃ XONG — đúng ca đã báo lỗi */
  await goto('/?profile=demo-user', () => !!q('.public-profile-head'))
  const doneLink = qa('.public-request-link').find(a => /Get Up/i.test(a.textContent || ''))
  check('trang của demo-user có bài ĐÃ XONG (Get Up) để bấm', !!doneLink,
    qa('.public-request-link').map(a => (a.textContent || '').trim()).join(' | ').slice(0, 160))
  if (doneLink) {
    scrolled.length = 0
    await click(doneLink)
    check('bấm Recent Request: về bảng và trang cá nhân đóng',
      await waitFor(() => !!q('.list') && !q('.public-profile'), 3000))
    await tick(240)   // rAF + 60ms của scrollToList
    check('bấm Recent Request: cuộn XUỐNG thanh lọc kết quả, KHÔNG cuộn lên đầu trang',
      scrolled.some(c => /fbar/.test(c)) && !scrolled.some(c => c.startsWith('window.scrollTo')),
      scrolled.join(' | ') || 'không thấy lệnh cuộn nào')
    check('về bảng KHÔNG tải lại trang (không màn chờ)', !splashUp())
    check('ô tìm kiếm mang đúng "tên bài nghệ sĩ"', searched() === 'Get Up NewJeans', `"${searched()}"`)
    check('bảng hiện ĐÚNG bài đó', items().length > 0 && /Get Up/.test(q('.list')?.textContent || ''),
      `số mục=${items().length} · ${(q('.list')?.textContent || '').replace(/\s+/g, ' ').slice(0, 120)}`)
    check('bài đã completed không bị loại (link không dùng f=top)',
      /Completed/i.test(q('.list')?.textContent || ''), (q('.list')?.textContent || '').slice(0, 120))
    check('không chip GIAI ĐOẠN nào còn bật', !onChips().some(c => STAGE.test(c)), onChips().join(' | '))
    check('chip loại bài đã về "All types"', onChips().some(c => /All types/i.test(c)), onChips().join(' | '))
    check('địa chỉ là ?f=newest&q=… để dán cho người khác được',
      new URLSearchParams(window.location.search).get('f') === 'newest'
      && /Get\+Up|%20/.test(window.location.search), window.location.search)
  }

  /* (4) LỖI ĐÃ BÁO: đang BẬT chip lọc rồi mới bấm bài */
  await goto('/', () => items().length > 0)
  /* Chỉ bấm khi chip CHƯA bật: `goto('/')` khôi phục bộ lọc đã lưu trong
     localStorage, nên Queue có thể đang bật sẵn — bấm vào lúc đó là TẮT nó đi
     (và về "Newest" theo luật chip giai đoạn cuối cùng). */
  if (!onChips().some(c => STAGE.test(c))) await click(chip(STAGE))                 // Queue
  if (!onChips().some(c => /Color Coded/.test(c))) await click(chip(/^Color Coded Lyrics/))
  await tick(420)                                // chờ nhịp ghi URL + localStorage (320ms)
  check('đã bật được chip giai đoạn + chip loại bài',
    onChips().some(c => STAGE.test(c)) && onChips().some(c => /Color Coded/.test(c)), onChips().join(' | '))
  await goto('/?profile=demo-user', () => !!q('.public-profile-head'))
  const doneLink2 = qa('.public-request-link').find(a => /Get Up/i.test(a.textContent || ''))
  if (doneLink2) {
    await click(doneLink2)
    await waitFor(() => !!q('.list'), 3000)
    check('chip lọc còn bật từ trước: bài đã xong VẪN tìm thấy',
      /Get Up/.test(q('.list')?.textContent || '') && items().length > 0,
      `chip đang bật: ${onChips().join(' | ')} · q="${searched()}"`)
    check('và cả hai bộ lọc nhiều-chọn đã được dọn',
      !onChips().some(c => STAGE.test(c)) && onChips().some(c => /All types/i.test(c)), onChips().join(' | '))
  } else {
    check('chip lọc còn bật từ trước: mở lại được trang cá nhân', false, 'không thấy link Get Up')
  }

  /* (5) THẺ "THIS WEEK" CŨNG PHẢI ĐI TRONG APP VÀ TÌM RA BÀI */
  await goto('/', () => items().length > 0)
  const weekly = q('.weekly-card')
  check('bảng có thẻ "This week"', !!weekly, (q('.nowbar.weekly')?.textContent || '(không có khối This week)').slice(0, 100))
  if (weekly) {
    const name = (weekly.querySelector('b')?.textContent || '').trim()
    check('thẻ This week trỏ về bảng bằng f=newest (không phải f=top)',
      (weekly.getAttribute('href') || '').startsWith('/?f=newest&q='), weekly.getAttribute('href'))
    scrolled.length = 0
    await click(weekly)
    check('bấm thẻ This week: đi trong app, tìm ra bài, không màn chờ',
      (await waitFor(() => searched().length > 0 && items().length > 0, 3000)) && !splashUp(),
      `q="${searched()}" · số mục=${items().length} · bài trên thẻ="${name}"`)
    await tick(240)
    check('bấm thẻ This week: cũng cuộn xuống kết quả',
      scrolled.some(c => /fbar/.test(c)) && !scrolled.some(c => c.startsWith('window.scrollTo')),
      scrolled.join(' | ') || 'không thấy lệnh cuộn nào')
  }

  } finally {
    window.Element.prototype.scrollIntoView = realSIV
    window.scrollTo = realScrollTo
  }

  /* (6) TÁC GIẢ BÌNH LUẬN CŨNG LÀ MỘT LINK TRANG CÁ NHÂN */
  await goto('/', () => items().length > 0)
  const toggle = q('.comments-toggle')
  check('hàng request có nút Comments', !!toggle)
  if (toggle) {
    await click(toggle)
    const box = await waitFor(() => !!q('.comment-form input'), 3000)
    check('mở được khung bình luận', box)
    if (box) {
      await type(q('.comment-form input'), ' smoke: link trang ca nhan ')
      await click(q('.comment-form button[type="submit"]'))
      const posted = await waitFor(() => qa('.comment').length > 0, 3000)
      check('gửi được bình luận (đường ghi demo)', posted, `${qa('.comment').length} bình luận`)
      const author = q('.comment-author')
      check('bình luận có tên tác giả bấm được', !!author && (author.getAttribute('href') || '').startsWith('/?profile='),
        author?.getAttribute('href') || (q('.comments-list')?.textContent || '').slice(0, 100))
      if (author) {
        await click(author)
        check('bấm tên tác giả: mở trang cá nhân, không tải lại trang',
          (await waitFor(() => !!q('.public-profile-head'), 3000)) && !splashUp(), text().slice(0, 120))
      }
    }
  }

  /* (7) BACK TO BOARD */
  await goto('/?profile=demo-user', () => !!q('.public-profile-head'))
  await click(q('.profile-back'))
  check('bấm "Back to board": về bảng, trang cá nhân đóng, không màn chờ',
    (await waitFor(() => !!q('.list') && !q('.public-profile'), 3000)) && !splashUp())
  quiet('trang cá nhân công khai')

  /* (8) MÔI TRƯỜNG THÙ ĐỊCH: ghi địa chỉ bị chặn mà vẫn đi được.
     Đây là vế quan trọng nhất: bản xem trước của nền tảng chạy trong iframe
     sandbox, `pushState` ném SecurityError. Bản cũ gọi `pushState` TRƯỚC khi đổi
     state nên cú bấm chết ở đó — "bấm profile bị quay về trang chủ". */
  where = 'trang cá nhân · iframe bị sandbox'
  const realPush2 = window.history.pushState
  const realReplace2 = window.history.replaceState
  const boom2 = () => { throw new window.DOMException('The operation is insecure.', 'SecurityError') }
  window.history.pushState = boom2
  window.history.replaceState = boom2
  try {
    const before2 = problems.length
    /* Về bảng BẰNG BẤM (không đẩy địa chỉ được nữa): mục Requests trong menu. */
    await click(qa('.side-nav .side-item').find(a => /^Requests/.test((a.textContent || '').trim())))
    await waitFor(() => items().length > 0, 3000)
    await tick(220)
    const person2 = q('.requester-link')
    check('địa chỉ bị chặn: bảng vẫn còn tên người gửi để bấm', !!person2)
    if (person2) {
      await click(person2)
      check('địa chỉ bị chặn: bấm tên người gửi VẪN mở trang cá nhân',
        await waitFor(() => !!q('.public-profile-head'), 3000), text().slice(0, 140))
      const anyLink = qa('.public-request-link')[0]
      if (anyLink) {
        await click(anyLink)
        check('địa chỉ bị chặn: bấm một bài VẪN về bảng và lọc đúng bài đó',
          (await waitFor(() => !!q('.list') && searched().length > 0, 3000)) && items().length > 0,
          `q="${searched()}" · số mục=${items().length}`)
      }
    }
    check('địa chỉ bị chặn: không có lỗi mới trong console', problems.length === before2,
      problems.slice(before2).map(x => x.text).join(' / ').slice(0, 180))
  } finally {
    window.history.pushState = realPush2
    window.history.replaceState = realReplace2
    where = 'trang cá nhân công khai'
  }
  /* Dọn trạng thái để phần kết luận không thừa hưởng một danh sách đang lọc. */
  await goto('/', () => items().length > 0)
}

/* ---------- 11. kết luận ---------- */
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
