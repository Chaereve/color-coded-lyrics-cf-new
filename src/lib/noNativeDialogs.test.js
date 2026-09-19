/* Chốt chặn: KHÔNG dùng hộp thoại của trình duyệt cho việc không hoàn tác được
   ---------------------------------------------------------
   Bảy chỗ trong app từng gọi `confirm()` / `prompt()` cho xoá request, xoá
   video, xoá hàng loạt, từ chối bài, huỷ đơn. Cả bảy đều hỏng theo cùng một
   cách, và cách đó KHÔNG hiện ra trong mã:

     · trong iframe bị chặn hộp thoại (thiếu `allow-modals` — mọi khung xem
       trước, mọi trang nhúng), `confirm()` trả `false` và `prompt()` trả `null`
       MÀ KHÔNG BÁO GÌ → bấm "Xoá" không có gì xảy ra, nhìn y hệt "bảng quản trị
       bị lỗi";
     · trình duyệt tự chặn sau vài lần rồi im lặng trả `false` mãi;
     · jsdom (dùng cho `npm run smoke`) cài `confirm`/`prompt` là hàm rỗng — nên
       đúng những đường nguy hiểm nhất là những đường KHÔNG kiểm được.

   Nay tất cả đi qua `<ConfirmDialog>` của app. Test này giữ đúng một điều:
   không ai gọi lại hộp thoại của trình duyệt. Nó không kiểm hộp của app hoạt
   động ra sao — việc đó thuộc ConfirmDialog.test.js và smoke.
   Chạy: npm test */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(jsx?|css|html)$/.test(e.name)) out.push(rel)
  }
  return out
}

/* Gọi trần: `confirm(`, `prompt(`, `alert(` — không tính `window.confirm` đã bị
   chặn, cũng không tính chữ trong câu (vd. "confirm" trong tên hàm khác). */
const CALL = /(^|[^.\w])(confirm|prompt|alert)\s*\(/

test('không còn confirm()/prompt()/alert() của trình duyệt trong mã nguồn', () => {
  const files = walk(at('..'))
  assert.ok(files.length > 40, `quét được ${files.length} tệp — đường dẫn sai thì test này vô nghĩa`)
  const bad = []
  for (const f of files) {
    if (f.includes('noNativeDialogs.test.js')) continue
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')      // chú thích khối: có nhắc tên hàm
      .replace(/\/\/[^\n]*/g, ' ')            // chú thích dòng
    for (const m of src.matchAll(new RegExp(CALL, 'g'))) {
      const line = src.slice(0, m.index).split('\n').length
      bad.push(`${f.replace(at('../'), 'src/')}:${line} → ${m[2]}()`)
    }
  }
  assert.deepEqual(bad, [],
    `việc không hoàn tác được phải hỏi bằng hộp của app (ConfirmDialog): ${bad.join(', ')}`)
})

test('hộp xác nhận của app có thật, và có đủ ba phần để đọc rồi quyết định', () => {
  const dlg = readFileSync(at('../components/ConfirmDialog.jsx'), 'utf8')
  assert.match(dlg, /role="dialog"/)
  assert.match(dlg, /aria-modal="true"/)
  assert.match(dlg, /aria-labelledby="dlg-title"/)
  assert.match(dlg, /aria-describedby=\{body \? 'dlg-body' : undefined\}/,
    'mô tả chỉ được trỏ tới id CÓ THẬT (bài học từ lỗi aria-describedby đứt ở form request)')
  assert.match(dlg, /e\.key === 'Escape'/, 'Esc phải đóng được')
  assert.match(dlg, /onMouseDown=\{\(e\) => e\.target === e\.currentTarget/, 'bấm ra ngoài phải đóng được')
  assert.match(dlg, /reasonLabel \? reasonRef\.current : okRef\.current/, 'mở ra là con trỏ đã ở chỗ bấm tiếp')

  const provider = readFileSync(at('./confirm.jsx'), 'utf8')
  assert.match(provider, /resolve\.current\?\.\(null\)/,
    'gọi chồng hai lần thì lời hứa cũ phải được trả lời, không được treo')
  assert.match(provider, /if \(!ask\) throw/, 'dùng ngoài nhà cung cấp phải lỗi rõ ràng, không im lặng')

  /* Chỗ gọi phải CHỜ câu trả lời rồi mới làm — `await ask(...)` trong điều kiện
     `if (!(await ask(...)))`, không phải gọi rồi làm luôn. */
  const app = readFileSync(at('../App.jsx'), 'utf8')
  assert.match(app, /if \(!\(await ask\(\{ title: t\('row\.confirmDelete'\)/,
    'nút xoá request của tôi phải chờ câu trả lời')
  assert.match(app, /<ConfirmProvider>/,
    'nhà cung cấp phải bọc App, nếu không mọi nút gọi nó sẽ ném lỗi')
})
