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
check('thanh lọc có chip trạng thái', qa('.fchip').length >= 4, `${qa('.fchip').length} chip`)
/* THỨ TỰ TRONG THANH LỌC (vòng 12): ô tìm kiếm đứng ĐẦU, rồi dải chip, rồi con
   số đếm — một thứ tự cho cả desktop lẫn máy hẹp, nên thứ tự nhìn luôn trùng
   thứ tự Tab. Đảo lại là bố cục hai bên lệch nhau như bản cũ. */
const topKids = [...(q('.fbar-top')?.children || [])].map(el => el.className.split(' ')[0])
check('ô tìm kiếm đứng đầu thanh lọc', topKids[0] === 'searchwrap', topKids.join(' · '))
check('dải chip đứng sau ô tìm kiếm', topKids[1] === 'fchips', topKids.join(' · '))
check('có dòng đếm kết quả', !!q('.fcount'), q('.fcount')?.textContent)
check('icon ô tìm kiếm nằm trong ô', !!q('.searchwrap .search-ico'))
const enabledVotes = qa('.votebtn:not([disabled])')
check('có bài bấm vote được', enabledVotes.length > 0, `${enabledVotes.length}/${qa('.votebtn').length} nút mở`)
/* LỌC THEO LOẠI BÀI: chọn một loại thì hàng chip chính phải hiện chip "đang lọc"
   (trên màn hẹp khối lọc gấp lại, nên đây là chỗ duy nhất NÓI RA vì sao danh
   sách ngắn đi), và bấm vào chip đó là bỏ lọc. */
const kindChip = qa('.fbar-more .fchip.kind').find(b => (b.textContent || '').trim() && !/All types/i.test(b.textContent))
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
  if (/Before requesting/i.test(text())) {
    await click(qa('button').find(b => /agree/i.test(b.textContent || '')))
  }
  check('form request mở ra', !!q('.modal'))
  dump('form request', '.modal .req, .modal')
  check('có thẻ xem trước', !!q('.req-preview'))
  check('có dải 3 bước', qa('.req-steps li').length === 3)
  check('đủ 4 chip loại bài', qa('.kchip').length === 4)
  check('có đúng MỘT dòng giải thích loại đang chọn', qa('.kind-note').length === 1)
  check('ô ghi chú gấp lại khi chưa dùng', !q('#rq-note') && !!q('.note-add'))
  /* Mở ô ghi chú bằng MỘT cú bấm, và con trỏ phải rơi vào đúng ô vừa hiện. */
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
/* LỖI GIAO DIỆN NẶNG (vòng 12): bảng quản trị từng được dựng ở cuối cây React,
   NGOÀI .main — dải số liệu rộng hết màn hình và chui xuống dưới sidebar cố
   định, ô đầu tiên bị cắt. Chốt cả ba tầng khung, vì chỉ cần rơi ra ngoài một
   tầng là lỗi quay lại y như cũ. */
check('trang quản trị nằm trong .main', !!q('.main .adm-page'))
check('trang quản trị nằm trong .sect', !!q('.sect .adm-page'))
check('trang quản trị có tiêu đề trang (h1)', !!q('.mainhead-t'))
check('có dải số liệu chuyển mục', qa('.adm-kpi').length === 5, `${qa('.adm-kpi').length} ô`)
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
