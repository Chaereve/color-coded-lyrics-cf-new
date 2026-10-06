/* Đọc artifacts/browser-smoke.json rồi in ra annotation của GitHub Actions
   (`::notice::` / `::error::`) để kết quả smoke đọc được NGAY TRÊN TRANG của
   check-run, bằng một lệnh `gh api …/check-runs/<id>/annotations`.
   -----------------------------------------------------------------------------
   Vì sao thêm kênh này — hai kênh sẵn có đều có lúc không dùng được:
     · Log và artifact của run nằm ở results-receiver.actions.githubusercontent.com;
       từ môi trường không có Internet (sandbox dev) không tải về được.
     · Bình luận PR (browserSmokeReport.mjs) chỉ đăng khi nhánh có PR; chạy
       workflow_dispatch trên `main` sau khi merge thì không còn PR để đăng.
   Annotation thì luôn đi cùng check-run, không phụ thuộc vào hai điều trên.

   GitHub giới hạn 10 annotation mỗi mức (error/warning/notice), nên:
     · mục HỎNG → mỗi mục một `::error::`, kèm `extra` (đúng câu lỗi cần đọc);
     · mục ĐẠT  → gộp 8 tên một `::notice::`, không in vài chục dòng rời;
     · `--only-total` → chỉ một dòng tổng, dùng cho lượt chạy edge (lượt đó ghi
       cùng một tệp json và bị lượt live ghi đè ngay sau, nên chỉ cần chốt số). */
import { readFileSync } from 'node:fs'

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const file = arg('in', 'artifacts/browser-smoke.json')
const commit = arg('commit', '')
const label = arg('label', 'smoke')
const onlyTotal = process.argv.includes('--only-total')

/* Annotation là LỆNH MỘT DÒNG của runner: %, CR, LF phải thoát ở cả message lẫn
   title; riêng title (là tham số của lệnh) phải thoát thêm `:` và `,`. */
const msg = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const title = (s) => msg(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

let data
try {
  data = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  process.exit(0)   // không có kết quả thì không đăng gì (giống browserSmokeReport.mjs)
}

const results = Array.isArray(data.results) ? data.results : []
if (!results.length) process.exit(0)
const failed = results.filter(r => !r.ok)
const passed = results.filter(r => r.ok)
/* URL mà lượt này thật sự gọi: json ghi `edge`/`live` (null khi không truyền),
   để người đọc biết 34 mục đó chạy trên bản deploy nào. */
const where = [data.edge && `edge ${data.edge}`, data.live && `live ${data.live}`]
  .filter(Boolean).join(' · ')
const head = `${passed.length}/${results.length} mục đạt${where ? ` · ${where}` : ''}${commit ? ` · commit ${commit.slice(0, 7)}` : ''}`

if (!onlyTotal) {
  for (const r of failed) {
    console.log(`::error title=${title(`${label} HỎNG`)}::${msg(`${r.name}${r.extra ? ` — ${r.extra}` : ''}`)}`)
  }
  const names = passed.map(r => r.name)
  const groups = []
  for (let i = 0; i < names.length; i += 8) groups.push(names.slice(i, i + 8))
  groups.forEach((g, i) => {
    console.log(`::notice title=${title(`${label} · ${passed.length} mục đạt (${i + 1}/${groups.length})`)}::${msg(g.join(' · '))}`)
  })
}
console.log(`::${failed.length ? 'error' : 'notice'} title=${title(`TỔNG ${label}`)}::${msg(failed.length ? `${head} · HỎNG: ${failed.map(f => f.name).join(' | ')}` : head)}`)
/* Không tự thoát khác 0: bước chạy smoke đã làm đỏ job rồi, annotation chỉ là
   kênh đọc kết quả — đỏ hai lần cho cùng một lỗi chỉ làm khó đọc log. */
