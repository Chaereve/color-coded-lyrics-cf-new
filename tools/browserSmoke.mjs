/* Kiểm chứng "Daily Quiz đã nghỉ hưu" bằng TRÌNH DUYỆT THẬT (Chromium) và, khi
   có URL, bằng EDGE của Cloudflare Pages.
   -----------------------------------------------------------------------------
   Cái mà `npm run smoke` không trả lời được: bố cục và hành vi trong trình duyệt
   thật (mobile ≤620px và desktop), lỗi console thật, và việc `/quiz` có được
   301 ở edge hay không. Script này làm đúng ba việc đó rồi thoát khác 0 nếu có
   mục hỏng; ảnh chụp được ghi vào --out để gửi kèm khi review.

   Chạy tay (cần Chromium của Playwright):
     npm i --no-save playwright && npx playwright install chromium
     node tools/browserSmoke.mjs --edge https://<preview>.pages.dev
   Trong CI: .github/workflows/quiz-retirement-browser.yml

   Không kết nối Supabase, không deploy, không migration: app chạy ở chế độ demo
   như khi mở tệp dist/ bằng trình duyệt. */
import { createServer } from 'node:http'
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
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
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
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

/* ---------- 3. Chromium thật: desktop + mobile ---------- */
const { chromium } = await import('playwright')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const viewports = [
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
]
for (const vp of viewports) {
  console.log(`\n── ${vp.name} (${vp.width}×${vp.height}) ──`)
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto(`${base}/quiz`, { waitUntil: 'load' })
  await page.waitForSelector('.daily-login-page', { timeout: 20_000 })
  await page.waitForTimeout(600)

  check(`${vp.name}: mở /quiz được replace về /daily-login`, new URL(page.url()).pathname === '/daily-login', page.url())
  const text = await page.innerText('body')
  check(`${vp.name}: không còn chữ quiz trên trang`, !/quiz/i.test(text))
  const quizNodes = await page.locator('.music-quiz-page, .daily-quiz, .daily-quiz-start, .daily-quiz-level, .daily-rewards').count()
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
  check(`${vp.name}: không có lỗi console / exception`, errors.length === 0, errors.slice(0, 3).join(' | '))
  /* Truyền chuỗi để trình duyệt tự tính: lint của repo không có global `document`. */
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  check(`${vp.name}: không tràn ngang`, overflow <= 2, `${overflow}px`)

  const shot = join(outDir, `quiz-retirement-${vp.name}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  console.log(`  ảnh: ${shot}`)
  await context.close()
}
await browser.close()
server.close()

const failed = results.filter(r => !r.ok)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'browser-smoke.json'), JSON.stringify({ edge: edge || null, results }, null, 2))
console.log(`\n──────── ${results.length - failed.length}/${results.length} mục đạt ────────`)
if (failed.length) { failed.forEach(f => console.log(`FAIL  ${f.name}${f.extra ? ` — ${f.extra}` : ''}`)); process.exit(1) }
