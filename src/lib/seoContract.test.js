/* Chốt chặn SEO: robots.txt · sitemap.xml · canonical phải kể CÙNG một câu
   chuyện với ROUTES trong App.jsx.
   ---------------------------------------------------------
   Vì sao cần file này: ba thứ trên nằm ở ba nơi khác nhau (public/, public/,
   index.html + App.jsx) và không thứ nào tham chiếu thứ nào. Thêm route thứ
   năm vào ROUTES mà quên sitemap thì Google không bao giờ biết nó tồn tại —
   SPA không có link HTML tĩnh nào để crawler lần ra. Đổi tên miền mà quên một
   file thì sitemap trỏ sang host chết, và lỗi này KHÔNG hiện ra ở đâu cả:
   trang vẫn chạy, chỉ có index là tụt.
   Chuyện đã xảy ra thật: repo từng trỏ cả robots/sitemap/canonical lẫn test lá
   chắn về `chaereveccl.pages.dev` — tên project CŨ đã chết — trong khi web thật
   là `chaereve.pages.dev`. Không ai notices vì các file tự tham chiếu lẫn nhau
   và cùng sai một kiểu. Test này khoá "mọi nơi một origin" để lần đổi tên miền
   sau phải sửa cả bó, không sửa lẻ tẻ rồi trôi lệch như trước. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), 'utf8')

const app = read('../App.jsx')
const html = read('../../index.html')
const robots = read('../../public/robots.txt')
const sitemap = read('../../public/sitemap.xml')

/* Đường dẫn thật của app — nguồn sự thật duy nhất là ROUTES trong App.jsx. */
const ROUTES = [...read('../App.jsx').match(/const ROUTES = \{([^}]*)\}/)[1]
  .matchAll(/'([^']+)'/g)].map((m) => m[1])

/* <loc> trong sitemap, tách origin và đường dẫn để so từng phần. */
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
const originOf = (u) => u.match(/^https:\/\/[^/]+/)?.[0] || null
const pathOf = (u) => u.replace(originOf(u) || '', '') || '/'

test('mọi route của app đều có mặt trong sitemap, và ngược lại', () => {
  assert.ok(ROUTES.length >= 4, `không đọc được ROUTES trong App.jsx (${ROUTES.length})`)
  const inSitemap = locs.map(pathOf)
  for (const r of ROUTES) {
    assert.ok(inSitemap.includes(r),
      `route ${r} có trong App.jsx nhưng thiếu trong sitemap.xml — Google không tự tìm ra nó`)
  }
  for (const s of inSitemap) {
    assert.ok(ROUTES.includes(s),
      `sitemap.xml khai ${s} nhưng App.jsx không có route đó — sửa ROUTES hay xoá khỏi sitemap?`)
  }
})

test('ba file SEO dùng đúng MỘT origin, và khớp origin production của repo', () => {
  const fromHtml = originOf(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || '')
  const fromRobots = originOf(robots.match(/^Sitemap:\s*(\S+)/m)?.[1] || '')
  const fromSitemap = [...new Set(locs.map(originOf))]
  assert.ok(fromHtml && fromRobots, 'thiếu origin trong canonical hoặc dòng Sitemap:')
  assert.deepEqual(fromSitemap, [fromHtml],
    `sitemap khai origin khác canonical: ${fromSitemap.join(', ')} ≠ ${fromHtml}`)
  assert.equal(fromRobots, fromHtml, `robots.txt trỏ sitemap sang host khác: ${fromRobots}`)
  /* khoá luôn với tên miền mà chính test lá chắn Edge đang dùng — đổi domain
     là phải đổi cả hai, không có chuyện một nửa repo còn host cũ */
  const site = read('../../worker/pagesRoutes.test.js').match(/const SITE = '(https:\/\/[^']+)'/)[1]
  assert.equal(fromHtml, site, `origin SEO (${fromHtml}) lệch origin production trong worker/pagesRoutes.test.js (${site})`)
})

test('robots.txt: cho index, chặn /api/, và khai sitemap bằng đường tuyệt đối', () => {
  const lines = robots.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  assert.ok(lines.some((l) => /^User-agent:\s*\*/i.test(l)), 'thiếu User-agent: *')
  assert.ok(lines.some((l) => /^Allow:\s*\/$/i.test(l)), 'chủ dự án muốn được index — phải có Allow: /')
  assert.ok(lines.some((l) => /^Disallow:\s*\/api\/?$/i.test(l)),
    '/api/ là Pages Functions chống farm: không có gì để index, để crawler mò vào là nhiễu log')
  assert.match(robots, /^Sitemap:\s*https:\/\/\S+\/sitemap\.xml$/m,
    'dòng Sitemap: phải là URL tuyệt đối, đường tương đối là vô nghĩa với crawler')
})

test('index.html có đúng một thẻ canonical tuyệt đối', () => {
  const tags = html.match(/<link[^>]+rel="canonical"[^>]*>/g) || []
  assert.equal(tags.length, 1, `thấy ${tags.length} thẻ canonical — hai thẻ là Google tự chọn lấy một`)
  const href = tags[0].match(/href="([^"]+)"/)?.[1]
  assert.match(href || '', /^https:\/\/[^/]+\//, 'canonical phải là URL tuyệt đối bắt đầu bằng https://')
})

test('App.jsx cập nhật canonical mỗi lần đổi route — không chỉ đặt mỗi tiêu đề', () => {
  /* Thẻ trong index.html chỉ đúng cho `/`. SPA đổi đường dẫn bằng pushState,
     nên nếu bỏ vế này thì /daily-spin, /ranking, /profile mang canonical của
     trang chủ và bị coi là nội dung trùng. Kiểm tra cả hai vế nằm cạnh nhau
     để không ai "dọn CSS/JS" rồi xoá mất một bên. */
  assert.match(app, /document\.title\s*=/, 'không còn chỗ đặt document.title')
  assert.match(app, /link\[rel="canonical"\]/, 'mất dòng cập nhật canonical theo route')
  assert.match(app, /window\.location\.origin/,
    'canonical phải dựng từ origin thật, không ghi cứng tên miền (repo có 3 đường deploy)')
})
