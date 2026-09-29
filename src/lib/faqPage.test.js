/* Chốt chặn trang FAQ (public/faq.html): JSON-LD phải kể đúng câu chuyện
   đang hiển thị, và trang phải nằm trên đường đi của crawler.
   ---------------------------------------------------------
   Vì sao có file này: FAQPage schema là thứ Google đọc, còn <h2>/<p> là thứ
   người đọc. Hai nguồn đó có thể trôi khỏi nhau mà KHÔNG có triệu chứng nào —
   trang vẫn mở, rich result vẫn "có", chỉ là câu trả lời trên Google khác câu
   trả lời trên web (và lệch quá xa thì Google bỏ qua luôn schema). Thêm nữa:
   đổi giá vote ở db.js mà quên faq.html là người mua đọc giá cũ — test ở đây
   không kiểm được giá đúng (đó là việc của priceRate.test.js với db.js) nhưng
   bắt được cấu trúc và sự hiện diện. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(at(rel), 'utf8')
const faq = read('../../public/faq.html')
const sitemap = read('../../public/sitemap.xml')
const app = read('../App.jsx')

/* hai khối JSON-LD: FAQPage + BreadcrumbList */
const ldBlocks = [...faq.matchAll(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => JSON.parse(m[1]))
const faqLd = ldBlocks.find((b) => b['@type'] === 'FAQPage')
const crumbLd = ldBlocks.find((b) => b['@type'] === 'BreadcrumbList')

const visibleH2 = [...faq.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]
  .replace(/&amp;/g, '&').replace(/&mdash;/g, '—').trim())

test('faq.html có FAQPage JSON-LD, tối thiểu 8 cặp hỏi–đáp, không câu nào rỗng', () => {
  assert.ok(faqLd, 'thiếu khối JSON-LD @type FAQPage')
  const qs = faqLd.mainEntity || []
  assert.ok(qs.length >= 8, `FAQPage chỉ có ${qs.length} câu — cần ≥ 8`)
  for (const q of qs) {
    assert.equal(q['@type'], 'Question', `mục "${q.name}" không phải @type Question`)
    assert.ok(q.name && q.name.trim(), 'câu hỏi thiếu name')
    assert.ok(q.acceptedAnswer?.text?.trim(), `câu "${q.name}" thiếu acceptedAnswer.text`)
  }
})

test('mọi câu trong JSON-LD đều có tiêu đề <h2> thật trên trang — không schema ảo', () => {
  const norm = (s) => s.replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
  const heads = visibleH2.map(norm)
  for (const q of faqLd.mainEntity) {
    assert.ok(heads.includes(norm(q.name)),
      `JSON-LD có câu "${q.name}" nhưng trang không có <h2> đó — rich result sẽ nói khác trang`)
  }
})

test('faq.html có BreadcrumbList và trỏ đúng origin của hợp đồng SEO', () => {
  assert.ok(crumbLd, 'thiếu BreadcrumbList')
  const items = crumbLd.itemListElement || []
  assert.ok(items.length >= 2, 'breadcrumb cần ≥ 2 cấp: trang chủ → FAQ')
  const canon = faq.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || ''
  assert.equal(canon, 'https://chaereve.pages.dev/faq.html',
    'canonical của faq.html phải tuyệt đối và khớp origin production')
  const ogUrl = faq.match(/property="og:url" content="([^"]+)"/)?.[1] || ''
  assert.equal(ogUrl, canon, 'og:url lệch canonical — crawler chia sẻ sẽ lấy URL khác')
  assert.match(faq, /property="og:image" content="https:\/\/[^"]+"/,
    'og:image phải là URL tuyệt đối (bài học Telegram/Discord không có ảnh xem trước)')
})

test('trang nằm trên đường đi: có trong sitemap và có link từ app', () => {
  assert.match(sitemap, /<loc>https:\/\/chaereve\.pages\.dev\/faq\.html<\/loc>/,
    'sitemap phải khai /faq.html — SPA không có link HTML nào để crawler tự lần ra')
  assert.match(app, /href="\/faq\.html"/,
    'App.jsx phải có link /faq.html (footer) — trang mồ côi không ai tới được')
})
