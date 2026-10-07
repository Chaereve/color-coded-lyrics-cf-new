/* Kiểm chứng "Daily Quiz đã nghỉ hưu" bằng TRÌNH DUYỆT THẬT (Chromium) và, khi
   có URL, bằng EDGE của Cloudflare Pages.
   -----------------------------------------------------------------------------
   Cái mà `npm run smoke` không trả lời được: bố cục và hành vi trong trình duyệt
   thật (mobile ≤620px và desktop), lỗi console thật, và việc `/quiz` có được
   301 ở edge hay không. Script này làm đúng ba việc đó rồi thoát khác 0 nếu có
   mục hỏng; ảnh chụp được ghi vào --out để gửi kèm khi review.

   Chạy tay (cần Chromium của Playwright):
     npm run build
     npm i --no-save playwright && npx playwright install chromium
     node tools/browserSmoke.mjs                       # bản dist/ cục bộ, chế độ demo
     node tools/browserSmoke.mjs --edge https://<preview>.pages.dev
     node tools/browserSmoke.mjs --live https://chaereve.pages.dev   # smoke trên site thật
   Trong CI: .github/workflows/quiz-retirement-browser.yml

   Không kết nối Supabase, không deploy, không migration: app chạy ở chế độ demo
   như khi mở tệp dist/ bằng trình duyệt.

   HAI CHẾ ĐỘ, ĐỪNG LẪN:
     · bản dist/ cục bộ (mặc định) — phần lớn phép kiểm nằm ở đây: bốn màn
       (trang chủ, bảng xếp hạng, về tôi, hồ sơ công khai) × hai khổ màn hình,
       cộng đường /quiz → /daily-login và lượt điểm danh demo.
     · --live — chỉ đọc trang production, KHÔNG bấm gì; mỗi lượt mở vẫn ghi một
       dòng 'visit' vào bảng funnel (hành vi của mọi lượt truy cập).
   Trước khi mở trình duyệt, script soi dist/assets/*.js: nhúng URL Supabase thật
   nghĩa là bundle sẽ ghi dữ liệu production → DỪNG, chỉ chạy trên bản demo. */
import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const repo = fileURLToPath(new URL('..', import.meta.url))
const distDir = arg('dist', join(repo, 'dist'))
const outDir = arg('out', join(repo, 'artifacts'))
const edge = arg('edge', '').replace(/\/+$/, '')
const live = arg('live', '').replace(/\/+$/, '')
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
  writeSummary()
}
/* Ghi kết quả SAU MỖI mục: job thất bại giữa đường vẫn còn tệp để CI đăng lên
   PR, thay vì mất trắng vì một bước sau đó ném lỗi. */
const writeSummary = () => {
  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'browser-smoke.json'), JSON.stringify(
      { edge: edge || null, live: live || null, total: results.length, failed: results.filter(r => !r.ok).length, results }, null, 2))
  } catch { /* ghi chú không được làm hỏng phép kiểm */ }
}

/* ---------- 0. AN TOÀN: bản dist phải là bản DEMO ----------
   Mọi phép kiểm trình duyệt bên dưới chạy trên bản `dist/` cục bộ và chỉ được
   chạy trên bản demo. Lý do không phải là hình thức: app gọi `trackVisitOnce()`
   ngay khi mount (App.jsx) và khi bundle CÓ Supabase thật thì mỗi lượt mở trang
   ghi một dòng 'visit' vào bảng funnel của production. Vì vậy: nhúng URL
   Supabase thật = DỪNG, không mở trình duyệt vào bản đó.

   Cách nhận biết: build với `VITE_SUPABASE_URL` sẽ nhúng nguyên
   `https://<project-ref>.supabase.co` vào một tệp trong `dist/assets/`. Chuỗi
   `supabase.co` trong `dist/_headers` (danh sách CSP) KHÔNG tính — chỉ soi JS. */
const embeddedSupabase = (() => {
  let files = []
  try { files = readdirSync(join(distDir, 'assets')).filter(f => f.endsWith('.js')) } catch { return '(không đọc được dist/assets — đã build chưa?)' }
  for (const f of files) {
    if (/https:\/\/[a-z0-9]{15,}\.supabase\.co/i.test(readFileSync(join(distDir, 'assets', f), 'utf8'))) return f
  }
  return ''
})()
const distIsDemo = !embeddedSupabase
check('dist là bản DEMO (không nhúng URL Supabase thật, không ghi dữ liệu production)', distIsDemo,
  `${distDir}${distIsDemo ? '' : ` — thấy trong ${embeddedSupabase}`}`)

/* Bám console/pageerror cho một page. Lỗi tài nguyên ngoài (ảnh, font) của
   runner không được tính là lỗi của app nhưng vẫn đếm để báo lại. */
const attachErrorTracking = page => {
  const errors = []
  const noise = []
  page.on('console', m => {
    if (m.type() !== 'error') return
    if (/Failed to load resource|net::ERR_|ERR_INTERNET|ERR_NAME_NOT_RESOLVED/i.test(m.text())) noise.push(m.text())
    else errors.push(m.text())
  })
  page.on('pageerror', e => errors.push(String(e)))
  return { errors, noise }
}

/* ---------- 1. edge: 301 của Cloudflare Pages ---------- */
if (edge) {
  const waitFor = async (attempts = 18) => {
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const res = await fetch(`${edge}/quiz`, { redirect: 'manual' })
        if ([301, 308].includes(res.status)) return res
        if (i === attempts) return res
      } catch (e) {
        if (i === attempts) throw e
      }
      await new Promise(r => setTimeout(r, 10_000))
    }
  }
  console.log(`\n── edge: ${edge} ──`)
  try {
    const quiz = await waitFor()
    check('edge: /quiz trả 301/308 (không dựng lại màn quiz)', [301, 308].includes(quiz.status), `status=${quiz.status}`)
    const location = String(quiz.headers.get('location') || '')
    check('edge: Location trỏ về /daily-login', /\/daily-login$/.test(location), location || '(thiếu Location)')

    const login = await fetch(`${edge}/daily-login`)
    const html = await login.text()
    check('edge: /daily-login trả 200', login.status === 200, `status=${login.status}`)
    check('edge: HTML không còn chữ quiz', !/quiz/i.test(html))
    const cache = String(login.headers.get('cache-control') || '')
    check('edge: HTML không bị cache lâu (must-revalidate)', /must-revalidate/i.test(cache), cache || '(thiếu Cache-Control)')
  } catch (e) {
    check('edge: gọi được URL preview', false, String(e).slice(0, 160))
  }
}

/* ---------- 2. dựng dist/ bằng một static server nhỏ ---------- */
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0])
  let file = normalize(join(distDir, path))
  if (!file.startsWith(distDir)) { res.writeHead(403).end(); return }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html') } catch { file = join(distDir, 'index.html') }
  try {
    const body = readFileSync(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' })
    res.end(readFileSync(join(distDir, 'index.html')))
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = arg('base', `http://127.0.0.1:${server.address().port}`)

/* ---------- 2b. site THẬT (tuỳ chọn): chỉ đọc, không bấm gì ----------
   Mở đúng trang production như một khách chưa đăng nhập: kiểm /quiz có bị đưa
   về /daily-login không, có còn chữ/phần tử quiz không, trang có dựng lên
   không (không trắng màn), console có sạch không, có tràn ngang không. Không
   bấm nút đăng nhập hay bất kỳ nút nào khác nên không tạo phiên, không ghi dữ
   liệu người dùng; một lượt mở trang thật sẽ ghi đúng một dòng 'visit' vào
   bảng funnel (hành vi của mọi lượt truy cập, bảng tự dọn sau 30 ngày). */
let liveBrowser = null
if (live) {
  const { chromium } = await import('playwright')
  liveBrowser = await chromium.launch()
  const viewports = [
    { name: 'desktop-1280', width: 1280, height: 800 },
    { name: 'mobile-390', width: 390, height: 844 },
  ]
  for (const vp of viewports) {
    console.log(`\n── live ${vp.name}: ${live} ──`)
    try {
      const context = await liveBrowser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await context.newPage()
      const { errors, noise } = attachErrorTracking(page)
      await page.goto(`${live}/quiz`, { waitUntil: 'load', timeout: 60_000 })
      await page.waitForSelector('.signin-panel, .daily-login-page, .gate-card', { timeout: 45_000 })
      await page.waitForTimeout(800)

      const path = new URL(page.url()).pathname
      check(`live ${vp.name}: /quiz được đưa về /daily-login`, path === '/daily-login', path)
      const text = await page.innerText('body')
      check(`live ${vp.name}: không còn chữ quiz trên trang thật`, !/quiz/i.test(text))
      const quizNodes = await page.locator('.music-quiz-page, .daily-quiz, .daily-quiz-start, .daily-quiz-level, .daily-quiz-start-btn').count()
      check(`live ${vp.name}: không còn phần tử màn quiz trên trang thật`, quizNodes === 0, `${quizNodes} phần tử`)
      check(`live ${vp.name}: khách thấy lời mời đăng nhập (không trắng màn)`,
        (await page.locator('.signin-panel, .daily-login-page').count()) > 0)
      check(`live ${vp.name}: không có lỗi console / exception`,
        errors.length === 0, errors.slice(0, 3).join(' | ') || (noise.length ? `(bỏ qua ${noise.length} lỗi tài nguyên ngoài)` : ''))
      const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
      check(`live ${vp.name}: không tràn ngang`, overflow <= 2, `${overflow}px`)
      await page.screenshot({ path: join(outDir, `live-${vp.name}.png`), fullPage: true })
      await context.close()
    } catch (e) {
      check(`live ${vp.name}: chạy hết được kịch bản`, false, String(e).slice(0, 200))
    }
  }
  await liveBrowser.close()
}

/* ---------- 3. Chromium thật: desktop + mobile ---------- */
if (!distIsDemo) {
  /* Đã có Supabase thật trong bundle: mở trình duyệt vào đó là ghi dữ liệu
     production. Dừng ở đây, báo rõ, và trả về mã lỗi. */
  console.log('\nDỪNG: dist có URL Supabase thật — không mở trình duyệt (bỏ toàn bộ phép kiểm trình duyệt của bản dist)')
  server.close()
  writeSummary()
  const bad = results.filter(r => !r.ok)
  console.log(`\n──────── ${results.length - bad.length}/${results.length} mục đạt ────────`)
  process.exit(1)
}
const { chromium } = await import('playwright')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const viewports = [
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
]
for (const vp of viewports) {
  console.log(`\n── ${vp.name} (${vp.width}×${vp.height}) ──`)
  try {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  /* Runner CI không ra được Internet với tài nguyên ngoài: "Failed to load
     resource" cho ảnh/font là chuyện của runner, không phải lỗi của app —
     helper đếm riêng để người đọc biết đã bỏ qua cái gì. */
  const { errors, noise } = attachErrorTracking(page)

  /* Một lần điều hướng = trình duyệt tải lại trang; `putUrl` của app dùng
     replaceState nên KHÔNG có mục nào thêm vào đây. Đếm trước/sau để phân biệt
     "SPA tự đổi địa chỉ" (đúng) với "edge trả 200 rồi trang tự tải lại" (sai). */
  let navigations = 0
  page.on('framenavigated', () => { navigations += 1 })
  await page.goto(`${base}/quiz`, { waitUntil: 'load' })
  /* Chờ một nhịp để sự kiện điều hướng của chính lần tải này rơi xuống, rồi mới
     lấy mốc: từ đây về sau, một sự kiện nữa nghĩa là trang ĐÃ tải lại. */
  await page.waitForTimeout(200)
  const arrivedAt = new URL(page.url()).pathname
  const navsAtArrival = navigations

  /* Bundle trong CI không có VITE_SUPABASE_* nên app chạy chế độ demo: khách
     chưa có phiên thì `/daily-login` dựng lời mời đăng nhập (SignInPanel),
     không phải màn điểm danh. Đi đúng đường người dùng đi thay vì đoán:
     bấm nút đăng nhập → cửa sổ Google → chế độ demo trả ngay một phiên. */
  await page.waitForSelector('.signin-panel-btn, .daily-login-page', { timeout: 20_000 })
  await page.screenshot({ path: join(outDir, `arrival-${vp.name}.png`) })
  const guest = await page.locator('.signin-panel-btn').count()
  if (guest) {
    check(`${vp.name}: khách chưa đăng nhập thấy lời mời đăng nhập, không trắng màn`, true)
    await page.locator('.signin-panel-btn').first().click()
    await page.waitForSelector('.gate-card', { timeout: 10_000 })
    check(`${vp.name}: bấm nút đăng nhập mở được cửa sổ (không kẹt)`, true)
    await page.locator('.btn-google').first().click()
  } else {
    console.log('  (chế độ demo đã có phiên sẵn — bỏ bước đăng nhập)')
  }
  await page.waitForSelector('.daily-login-page', { timeout: 20_000 })
  await page.waitForTimeout(600)

  /* (b) địa chỉ cũ phải biến mất. Đếm số lần điều hướng CHỈ để làm bằng chứng
     (0 = replaceState của SPA, >0 = có tải lại trang); mục đạt/hỏng chỉ phụ
     thuộc vào địa chỉ cuối cùng, để phép kiểm không mạnh hơn yêu cầu. */
  const atDailyLogin = new URL(page.url()).pathname === '/daily-login'
  check(`${vp.name}: mở /quiz được replace về /daily-login`, atDailyLogin,
    `từ ${arrivedAt} → ${new URL(page.url()).pathname}, ${navigations - navsAtArrival} lần điều hướng`)
  const text = await page.innerText('body')
  check(`${vp.name}: không còn chữ quiz trên trang`, !/quiz/i.test(text))
  /* `.daily-rewards` KHÔNG nằm trong danh sách này: đó là lớp còn lại của màn
     điểm danh (`<section class="daily-rewards daily-login-page">`), không phải
     dấu vết của quiz. Chỉ kể tên những lớp chỉ màn quiz mới có. */
  const quizNodes = await page.locator('.music-quiz-page, .daily-quiz, .daily-quiz-start, .daily-quiz-level, .daily-quiz-start-btn').count()
  check(`${vp.name}: không còn phần tử nào của màn quiz`, quizNodes === 0, `${quizNodes} phần tử`)
  check(`${vp.name}: lịch điểm danh 7 cột`, (await page.locator('.check-in-calendar-grid th').count()) === 7)
  check(`${vp.name}: điều hướng tháng còn đủ hai nút`, (await page.locator('.check-in-nav').count()) === 2)

  /* Điểm danh thật (chế độ demo, không mạng): bấm nút và xem trạng thái đổi. */
  const claim = page.locator('.daily-claim')
  check(`${vp.name}: có nút điểm danh`, (await claim.count()) === 1)
  if (await claim.count()) {
    await claim.click()
    await page.waitForTimeout(700)
    check(`${vp.name}: điểm danh xong nút chuyển trạng thái đã-điểm-danh`,
      (await page.locator('.daily-claim.btn-ok').count()) === 1)
  }
  check(`${vp.name}: không có lỗi console / exception`, errors.length === 0,
    errors.slice(0, 3).join(' | ') || (noise.length ? `(bỏ qua ${noise.length} lỗi tài nguyên ngoài của runner)` : ''))
  /* Truyền chuỗi để trình duyệt tự tính: lint của repo không có global `document`. */
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  check(`${vp.name}: không tràn ngang`, overflow <= 2, `${overflow}px`)

  const shot = join(outDir, `quiz-retirement-${vp.name}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  console.log(`  ảnh: ${shot}`)

  /* ---------- ba màn còn lại: trang chủ, bảng xếp hạng, về tôi ----------
     Cùng một phiên demo (đã bấm đăng nhập ở trên) nên `/profile` dựng được
     trang thật. Mỗi màn kiểm bốn thứ, đúng những thứ đã hỏng hoặc suýt hỏng
     trong đợt rà này: màn có dựng lên không, có khối "không tải được" lẫn vào
     chỗ đáng ra là "chưa có gì" không, có tràn ngang không, và console có lỗi
     MỚI không (đếm trước/sau vì listener bám cả phiên). Một màn hỏng không làm
     dừng hai màn còn lại: mỗi màn tự bắt lỗi. */
  const routes = [
    { slug: 'board', name: 'trang chủ', url: `${base}/`, anchor: '.board, .stats, .requester-link' },
    { slug: 'ranking', name: 'bảng xếp hạng', url: `${base}/ranking`, anchor: '.lb-tabs' },
    { slug: 'mine', name: 'về tôi', url: `${base}/profile`, anchor: '.prof-card' },
  ]
  for (const r of routes) {
    try {
      const errorsBefore = errors.length
      await page.goto(r.url, { waitUntil: 'load' })
      /* Demo chưa khôi phục phiên thì `/profile` mở cửa đăng nhập: bấm đúng
         đường demo rồi chờ tiếp, thay vì đánh hỏng vì một bước đăng nhập. */
      try { await page.waitForSelector(r.anchor, { timeout: 12_000 }) } catch {
        if (await page.locator('.signin-panel-btn').count()) {
          await page.locator('.signin-panel-btn').first().click()
          await page.waitForSelector('.gate-card', { timeout: 10_000 })
          await page.locator('.btn-google').first().click()
          await page.waitForSelector(r.anchor, { timeout: 15_000 })
        } else throw new Error(`không thấy ${r.anchor}`)
      }
      await page.waitForTimeout(400)
      const anchorCount = await page.locator(r.anchor).count()
      check(`${vp.name} · ${r.name}: màn dựng lên`, anchorCount > 0, `${anchorCount} × ${r.anchor}`)
      /* `.load-err` là khối role="alert" của LoadErr — nó chỉ được xuất hiện khi
         thật sự không tải được, không phải khi danh sách rỗng. */
      const loadErr = await page.locator('.load-err').count()
      check(`${vp.name} · ${r.name}: không có khối "không tải được"`, loadErr === 0, `${loadErr} khối`)
      const ovf = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
      check(`${vp.name} · ${r.name}: không tràn ngang`, ovf <= 2, `${ovf}px`)
      const fresh = errors.slice(errorsBefore)
      check(`${vp.name} · ${r.name}: không lỗi console mới`, fresh.length === 0, fresh.slice(0, 2).join(' | '))
      await page.screenshot({ path: join(outDir, `route-${r.slug}-${vp.name}.png`), fullPage: true })
    } catch (e) {
      check(`${vp.name} · ${r.name}: chạy hết được kịch bản`, false, String(e).slice(0, 200))
    }
  }

  /* Hồ sơ công khai (`/?profile=<id>`) — mở từ liên kết THẬT trên bảng, không
     tự đặt id, nên phép kiểm chỉ chạy khi bảng có liên kết người gửi. */
  try {
    await page.goto(`${base}/`, { waitUntil: 'load' })
    await page.waitForSelector('.board, .stats, .requester-link', { timeout: 15_000 })
    const link = (await page.locator('.requester-link').count())
      ? await page.locator('.requester-link').first().getAttribute('href') : null
    if (!link) {
      console.log(`  (${vp.name}: bảng chưa có liên kết người gửi — bỏ qua hồ sơ công khai)`)
    } else {
      const errorsBefore = errors.length
      await page.goto(new URL(link, base).toString(), { waitUntil: 'load' })
      try { await page.waitForSelector('.public-profile', { timeout: 12_000 }) } catch { /* báo ở dưới */ }
      await page.waitForTimeout(400)
      const count = await page.locator('.public-profile').count()
      check(`${vp.name} · hồ sơ công khai: màn dựng lên`, count > 0, `${count} × .public-profile`)
      const loadErr = await page.locator('.load-err').count()
      check(`${vp.name} · hồ sơ công khai: không có khối "không tải được"`, loadErr === 0, `${loadErr} khối`)
      const ovf = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
      check(`${vp.name} · hồ sơ công khai: không tràn ngang`, ovf <= 2, `${ovf}px`)
      const fresh = errors.slice(errorsBefore)
      check(`${vp.name} · hồ sơ công khai: không lỗi console mới`, fresh.length === 0, fresh.slice(0, 2).join(' | '))
      await page.screenshot({ path: join(outDir, `route-public-${vp.name}.png`), fullPage: true })
    }
  } catch (e) {
    check(`${vp.name} · hồ sơ công khai: chạy hết được kịch bản`, false, String(e).slice(0, 200))
  }

  await context.close()
  } catch (e) {
    check(`${vp.name}: chạy hết được kịch bản`, false, String(e).slice(0, 200))
    results.push({ name: `${vp.name}: lỗi khi chạy`, ok: false, extra: String(e).slice(0, 200) })
    writeSummary()
  }
}
await browser.close()
server.close()

const failed = results.filter(r => !r.ok)
writeSummary()
console.log(`\n──────── ${results.length - failed.length}/${results.length} mục đạt ────────`)
if (failed.length) { failed.forEach(f => console.log(`FAIL  ${f.name}${f.extra ? ` — ${f.extra}` : ''}`)); process.exit(1) }
