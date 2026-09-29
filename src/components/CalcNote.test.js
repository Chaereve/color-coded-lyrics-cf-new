/* Chốt chặn cho dòng "cách tính" mở ra được (components/CalcNote.jsx).
   ---------------------------------------------------------
   Ba thứ phải còn nguyên, đều là thứ biến mất im lặng khi "dọn code":
     1. Cấu trúc details/summary THUẦN — ai đó thêm useState/onClick để tự
        quản lý mở/đóng là thêm một state machine không cần thiết (và mất
        hoạt ảnh thuần của trình duyệt khi in trang, bật/tắt bằng bàn phím);
     2. summary phải CÓ TÊN cho trình đọc màn hình — icon info không phải tên,
        và `title=` không hiện trên điện thoại (bài học aria-label vòng A1-3);
     3. summary phải nằm trong luật focus theo thẻ — mất dòng đó là người dùng
        bàn phím bấm Tab không thấy mình đang đứng ở nút nào.
   Thêm nữa: mọi nơi gọi phải truyền children ĐÃ DỊCH (t(...)) hoặc danh sách
   items có nhãn/câu đều qua từ điển — chuỗi Anh viết thẳng sẽ sót. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const srcDir = fileURLToPath(new URL('..', import.meta.url))
const src = at('./CalcNote.jsx')
const css = at('../index.css')

test('CalcNote là details/summary thuần — không state, không onClick', () => {
  assert.match(src, /<details\b/, 'phải dùng thẻ <details> gốc')
  assert.match(src, /<summary\b/, 'phải dùng thẻ <summary> gốc')
  /* BỎ COMMENT trước khi quét: chính comment của file này nhắc tới các từ
     "state", "onClick" để giải thích — quét nguyên văn bản là tự bắt oan mình
     (đúng họ lỗi propContract từng gặp: chữ trong comment thành mã thật). */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /useState|useRef|onClick|onToggle/,
    'mở/đóng là việc của trình duyệt — tự quản lý là thêm state vô ích')
})

test('summary có tên cho trình đọc màn hình, không phải icon trần', () => {
  assert.match(src, /className="sr-only"/, 'thiếu .sr-only — tên nút sẽ chỉ là hình')
  assert.match(src, /t\('calc\.how'\)/, 'tên nút phải đi qua từ điển')
  assert.doesNotMatch(src, /title=/, 'title= không hiện trên điện thoại — đừng dùng làm tên')
})

test('summary nằm trong luật focus theo thẻ', () => {
  assert.match(css, /summary:focus-visible/,
    'mất summary:focus-visible thì Tab tới nút cách tính sẽ không thấy vòng focus')
})

function jsxFiles(dir = srcDir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) return jsxFiles(p)
    return e.name.endsWith('.jsx') && !e.name.endsWith('.test.jsx') ? [p] : []
  })
}

test('mọi nơi dùng CalcNote đều truyền nội dung qua t()', () => {
  const bad = []
  for (const p of jsxFiles()) {
    const text = readFileSync(p, 'utf8')
    for (const m of text.matchAll(/<CalcNote(\s[^>]*)?>/g)) {
      const props = m[1] || ''
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40)
      const childrenTranslated = /^\s*\{\s*t\(/.test(after)
      const itemsTranslated = /items=\{\[[\s\S]*label:\s*t\([\s\S]*text:\s*t\(/.test(props)
      if (!childrenTranslated && !itemsTranslated) bad.push(`${p.replace(`${srcDir}/`, '')}: ${m[0]}`)
    }
  }
  assert.deepEqual(bad, [],
    `children hoặc items phải qua t() để chữ nằm trong từ điển — sai ở: ${bad.join(', ')}`)
})
