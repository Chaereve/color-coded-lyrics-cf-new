/* Đọc artifacts/browser-smoke.json và in ra một bình luận markdown để CI dán lên
   PR. Viết ở đây (thay vì nhồi jq vào workflow) để thứ tự mục và cách đánh dấu
   kết quả chỉ có một nguồn. */
import { readFileSync } from 'node:fs'

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const file = arg('in', 'artifacts/browser-smoke.json')
const runUrl = arg('run-url', '')
const commit = arg('commit', '')

let data
try {
  data = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  process.exit(0)   // không có kết quả thì không đăng gì
}
const failed = data.results.filter(r => !r.ok)
const mark = ok => (ok ? '✅' : '❌')
const rows = data.results.map(r => `| ${r.name} | ${mark(r.ok)}${r.extra ? ` — \`${String(r.extra).replace(/\|/g, '\\|').slice(0, 120)}\`` : ''} |`)

console.log(`<!-- quiz-retirement-browser -->
### Kiểm chứng "Daily Quiz đã nghỉ hưu" bằng trình duyệt thật + edge Cloudflare Pages

- Edge: \`${data.edge ?? '(không truyền URL)'}\` · Chromium **desktop 1280×800** và **mobile 390×844**
- Kết quả: **${data.results.length - failed.length}/${data.results.length} mục đạt**${commit ? ` — commit \`${commit.slice(0, 7)}\`` : ''}${runUrl ? ` — [log/artifact của run](${runUrl})` : ''}
- Ảnh chụp màn hình: artifact **\`quiz-retirement-browser\`** của run này (\`artifacts/quiz-retirement-desktop-1280.png\`, \`…-mobile-390.png\`)

| Mục kiểm | Kết quả |
| --- | --- |
${rows.join('\n')}

_Lượt chạy tự động trên runner GitHub (đọc-only): dựng \`dist/\` tại chỗ, mở bằng Chromium ở chế độ demo, gọi HTTP tới preview Pages.
Không deploy, không migration, không đụng database nào._`)
