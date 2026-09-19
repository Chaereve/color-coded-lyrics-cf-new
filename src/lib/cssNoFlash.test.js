/* Chốt chặn VỆT TRẮNG khi chuyển mục (flash trắng)
   ---------------------------------------------------------
   Người dùng báo hai lần: "transition flash trắng khó chịu". Có HAI khe hở, và
   mỗi khe cần một dòng CSS riêng:

     1. `index.html` được vẽ trước khi tệp CSS tải xong. Lúc đó chưa có `body`
        nào để tô nền, nên khung hình đầu tiên lấy màu từ `<html>` — không khai
        báo gì thì trình duyệt dùng màu mặc định của nó, là TRẮNG. Vì vậy màu
        nền phải có mặt NGAY TRONG `index.html`, nội tuyến.
     2. View Transitions chụp hai ảnh của trang rồi trượt chúng; giữa hai ảnh
        luôn hở một khe, và khe đó lộ khung vẽ của `<html>`. Nền của `<html>`
        trong `index.css` lo phần này, cộng thêm nền cho chính lớp phủ
        (`html[data-vt="on"]::view-transition`).

   Lỗi thật đã xảy ra (vòng 13): trong `index.css`, khối `html` có NGUYÊN một
   đoạn chú thích giải thích vì sao phải đặt `background: var(--bg)` — mà dòng
   khai báo thì không có. Chú thích nói một đằng, mã làm một nẻo, và vệt trắng
   vẫn còn. Test này kiểm cả hai nơi, và kiểm luôn hai màu có TRÙNG nhau: sửa
   `--bg` mà quên `index.html` thì lại trắng theo kiểu khác.
   Chạy: npm test */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const css = readFileSync(at('../index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const shell = readFileSync(at('../../index.html'), 'utf8')

const ruleBody = (src, selector) => {
  const re = new RegExp(`(^|[,}])\\s*${selector.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const m = src.match(re)
  return m ? m[2] : null
}

test('nền của <html> được khai báo trong index.css (khung vẽ không còn trắng)', () => {
  const body = ruleBody(css, 'html')
  assert.ok(body !== null, 'không tìm thấy luật `html { … }` trong index.css')
  assert.match(body, /background\s*:\s*var\(--bg\)/,
    'luật `html` phải đặt `background: var(--bg)` — thiếu dòng này thì mọi khe hở khi chuyển cảnh lộ khung vẽ TRẮNG của trình duyệt')
})

test('index.html tự tô nền trước khi CSS tải xong, và cùng màu với --bg', () => {
  const inline = shell.match(/<style>([\s\S]*?)<\/style>/)
  assert.ok(inline, 'index.html phải có khối <style> nội tuyến cho khung hình đầu tiên')
  const m = inline[1].match(/html\s*\{[^}]*background\s*:\s*(#[0-9a-fA-F]{3,8})/)
  assert.ok(m, 'khối <style> nội tuyến phải đặt nền cho `html` bằng một mã màu cụ thể (không dùng biến — biến chưa tồn tại ở thời điểm đó)')
  const token = css.match(/--bg\s*:\s*(#[0-9a-fA-F]{3,8})/)
  assert.ok(token, 'không tìm thấy token `--bg` trong :root')
  assert.equal(m[1].toLowerCase(), token[1].toLowerCase(),
    `màu nền đầu tiên (${m[1]}) phải trùng token --bg (${token[1]}) — lệch nhau là đổi màu nền xong vẫn thấy một nháy màu cũ`)
})

test('lớp phủ của View Transitions cũng được tô nền trang', () => {
  assert.match(css, /html\[data-vt="on"\]::view-transition\s*\{[^}]*background\s*:/,
    'thiếu nền cho `html[data-vt="on"]::view-transition` — hai ảnh chụp trượt qua nhau, khe giữa chúng lộ khung vẽ')
})

test('không luật nào khai báo cùng một thuộc tính hai lần rồi tự ghi đè', () => {
  /* Luật sau ghi đè luật trước trong CÙNG một khối là lỗi đọc-mã: dòng trên
     không có tác dụng gì, nhưng vẫn nằm đó và người sau sửa đúng dòng vô dụng.
     (Hai LUẬT khác nhau cho cùng bộ chọn thì hợp lệ — đó là cách tầng CSS hoạt
     động; ở đây chỉ soi bên trong một khối.) */
  const bad = []
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seen = new Map()
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const prop = decl.slice(0, i).trim().toLowerCase()
      if (!prop || prop.startsWith('--')) continue
      const val = decl.slice(i + 1).replace(/\s+/g, ' ').trim()
      if (seen.has(prop) && seen.get(prop) !== val) {
        bad.push(`${sel.trim().replace(/\s+/g, ' ')} · ${prop}: "${seen.get(prop)}" rồi "${val}"`)
      }
      seen.set(prop, val)
    }
  }
  assert.deepEqual(bad, [], `khai báo bị chính luật của nó ghi đè: ${bad.join(' | ')}`)
})
