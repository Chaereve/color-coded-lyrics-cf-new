/* Chốt chặn hai lỗi bố cục đã tái hiện bằng Chromium ngày 2026-11-12:
   1) This week + Up next cùng nhận grid-area:now nên đè nhau ở màn rộng.
   2) body overflow-x:hidden + height:100% biến body thành scroller riêng,
      window.scrollY đứng yên và Back to top / Pager gọi window.scrollTo hụt.
   Test tĩnh này rẻ và chạy trong npm test; browserSmoke.mjs còn đo trực tiếp. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const css = at('../index.css').replace(/\/\*[\s\S]*?\*\//g, '')
const app = at('../App.jsx')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, ' '), body }))
const bodies = sel => rules.filter(r => r.sel.split(',').map(s => s.trim()).includes(sel)).map(r => r.body)

test('body không tự thành vùng cuộn riêng của trang', () => {
  const body = bodies('body').join(';')
  assert.doesNotMatch(body, /overflow(?:-x|-y)?\s*:\s*(?:hidden|auto|scroll)/,
    'body phải để cửa sổ cuộn; cắt tràn ngang đặt ở html hoặc khối chứa riêng')
  assert.match(bodies('html').join(';'), /overflow-x\s*:\s*hidden/,
    'html vẫn cắt tràn ngang để không kéo ngang toàn trang')
})

test('This week và Up next nằm chung một ô lưới qua .board-now, không đè nhau', () => {
  assert.match(app, /<div className="board-now">/, 'hai khối phải được bọc trong .board-now')
  assert.match(app, /className="nowbar weekly"/, 'This week vẫn là khối riêng bên trong wrapper')
  assert.match(app, /className=\{`nowbar upnext/, 'Up next vẫn là khối riêng bên trong wrapper')
  assert.ok(bodies('.board > .board-now').some(b => /grid-area\s*:\s*now/.test(b)),
    'ô lưới now phải gán cho wrapper, không gán trực tiếp cho từng nowbar')
  assert.ok(!bodies('.board > .nowbar').some(b => /grid-area\s*:\s*now/.test(b)),
    'không được quay lại luật gán mọi nowbar vào cùng một ô')
  assert.match(bodies('.board-now').join(';'), /flex-direction\s*:\s*column/,
    'bên trong ô lưới, hai khối xếp dọc theo đúng thứ tự DOM')
})
