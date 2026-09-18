/* Chốt chặn VÙNG CUộn trong flex cột: `overflow-y:auto` + `flex:1` mà thiếu
   `min-height: 0` là nội dung KHÔNG cuộn — nó bị cắt, im lặng, không lỗi gì.
   ---------------------------------------------------------
   Flex item theo trục chính có `min-height: auto`, tức "tối thiểu bằng nội
   dung". Một khối danh sách `flex: 1; overflow-y: auto` trong cột vì thế từ
   chối co lại: nó cao đúng bằng số phần tử, tràn khỏi khung, và `overflow`
   không bao giờ kịp kích hoạt. App đã chết vì đúng một dòng thiếu:
   · `.nt-list` — hộp thông báo "ăn mất" tin thứ 5 trở đi (báo cáo "lỗi tùm lum");
   · `.side-scroll` — sidebar trên cửa sổ thấp: không cuộn được, cả khối chân
     (avatar + đăng xuất) bị đẩy ra dưới mép màn hình, nhìn thấy trong DOM mà
     không với tới (quét 08/09/2026).
   Test này KHÔNG giữ một danh sách tên (danh sách là thứ hay quên); nó quét mọi
   rule có cặp đặc tính đó. Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const cssFiles = walk(at('..')).filter((f) => extname(f) === '.css')
assert.ok(cssFiles.length >= 2, `phải thấy CSS của app (thấy ${cssFiles.length})`)

const rules = cssFiles.flatMap((f) => {
  const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    sel: sel.trim().replace(/\s+/g, ' '), body, file: f.split(/[\\/]/).slice(-1)[0],
  }))
})

const SCROLL = /overflow(?:-y)?\s*:\s*(auto|scroll)/
const FLEX_FILL = /(^|;)\s*flex\s*:\s*1(\s|;|\b)/

test('mọi vùng cuộn flex:1 trong cột đều có min-height: 0', () => {
  const bad = rules.filter((r) => SCROLL.test(r.body) && FLEX_FILL.test(r.body)
    && !/min-height:\s*0\b/.test(r.body))
  assert.deepEqual(bad.map((r) => r.sel), [],
    `thiếu "min-height: 0" — danh sách sẽ bị CẮT thay vì cuộn: ${bad.map((r) => `${r.sel} (${r.file})`).join(', ')}`)
})

test('hai vùng cuộn đã chết vì lỗi này vẫn được giữ nguyên', () => {
  for (const sel of ['.nt-list', '.side-scroll']) {
    const r = rules.find((x) => x.sel.split(',').map((y) => y.trim()).includes(sel))
    assert.ok(r, `không còn quy tắc ${sel} — nếu đổi tên thì cập nhật test, đừng để mất chốt chặn`)
    assert.match(r.body, /min-height:\s*0/, `${sel} phải giữ min-height: 0`)
    assert.match(r.body, SCROLL, `${sel} vẫn phải là vùng cuộn`)
  }
})

test('scanner đọc đúng rule (chống xanh giả)', () => {
  assert.ok(rules.length > 600, `chỉ đọc được ${rules.length} quy tắc CSS`)
  const hits = rules.filter((r) => SCROLL.test(r.body) && FLEX_FILL.test(r.body))
  assert.ok(hits.length >= 2, `phải thấy >=2 vùng cuộn flex (thấy ${hits.length}) — mẫu regex hỏng rồi`)
  // bang chung nguoc: mot rule thieu min-height phai bi bat
  const demo = rules.find((r) => r.sel.trim() === '.test-probe')
  assert.equal(demo, undefined, 'file test không được chứa .test-probe thật')
})
