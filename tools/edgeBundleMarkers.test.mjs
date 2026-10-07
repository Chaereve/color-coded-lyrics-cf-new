/* Chốt chặn cho cơ chế "bằng chứng bản mới đã lên edge" — `npm test` chạy được ở
   mọi máy: không cần mạng, không cần database, không cần Chromium.

   Vì sao cần test cho một tệp chỉ chứa vài dòng chữ: một dấu vết khai SAI (chuỗi
   không hề có trong source) không làm gì đỏ ngay — nó chỉ làm phép kiểm ngoài
   edge đỏ vĩnh viễn, vào lúc không ai ngờ nhất, và cách sửa duy nhất là xoá nó
   đi. Đó đúng là kiểu "chốt an toàn biến mất" mà bước c của ghi chú merge PR #34
   sinh ra để chặn. Ở đây kiểm ba tầng:

     1. tệp hợp lệ: có dấu vết thật, không trùng, không rỗng;
     2. mỗi dấu vết TỒN TẠI TRONG SOURCE — bundle dựng từ commit này vì thế mới
        có thể chứa nó (không kiểm được bản đã deploy: cần mạng);
     3. cơ chế còn được nối: tools/browserSmoke.mjs đọc đúng tệp đó, và workflow
        còn tự chạy trên `main` sau merge.
*/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (p) => join(root, p)
const read = (p) => readFileSync(at(p), 'utf8')

const MARKERS_FILE = '.github/edge-bundle-markers.txt'
const WORKFLOW = '.github/workflows/quiz-retirement-browser.yml'
const TOOL = 'tools/browserSmoke.mjs'

const markers = () => read(MARKERS_FILE)
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

/* Nguồn có thể đi thẳng vào bundle production. Chỉ soi các thư mục này (không
   soi docs/, tools/, .github/: chữ ở đó không bao giờ vào bundle, nên một dấu
   vết chỉ có ở đó là dấu vết chết). */
const SOURCE_DIRS = ['src', 'worker', 'functions']
const SOURCE_FILES = ['index.html']
const EXT = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.html', '.json', '.css']

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(at(dir))) {
    const rel = `${dir}/${name}`
    if (statSync(at(rel)).isDirectory()) out.push(...walk(rel))
    else out.push(rel)
  }
  return out
}
const sourceText = () => {
  const files = [...SOURCE_DIRS.flatMap(d => { try { return walk(d) } catch { return [] } }), ...SOURCE_FILES]
  return files.filter(f => EXT.includes(extname(f))).map(read).join('\n')
}

test('dấu vết edge: tệp có ít nhất một dấu vết, không trùng, không rỗng', () => {
  const list = markers()
  assert.ok(list.length >= 1, 'danh sách dấu vết rỗng — CI ở bước edge sẽ đỏ; thêm dòng cho bản vừa merge')
  assert.equal(new Set(list).size, list.length, `có dấu vết trùng: ${list.join(' · ')}`)
  for (const m of list) {
    assert.ok(m.length >= 6, `dấu vết quá ngắn để đặc trưng: "${m}"`)
    assert.ok(!/\s{2,}/.test(m), `dấu vết chứa khoảng trắng đôi (dễ sai khi so khớp): "${m}"`)
  }
})

test('dấu vết edge: mỗi dấu vết tồn tại trong source của repo', () => {
  const src = sourceText()
  for (const m of markers()) {
    assert.ok(src.includes(m),
      `"${m}" không có trong ${SOURCE_DIRS.join(', ')}, ${SOURCE_FILES.join(', ')} — bundle dựng từ commit này không thể chứa nó. Khai dấu vết khác, hoặc sửa để source thật sự có chuỗi đó.`)
  }
})

test('dấu vết edge: browserSmoke.mjs đọc đúng tệp dấu vết (cơ chế không bị mồ côi)', () => {
  const tool = read(TOOL)
  assert.match(tool, /\.github['"\s,/]+edge-bundle-markers\.txt/, `${TOOL} phải đọc ${MARKERS_FILE}`)
  assert.match(tool, /markers\.length > 0/, 'phải có mục báo đỏ khi danh sách dấu vết rỗng — im lặng bỏ qua là kiểu hỏng tệ nhất')
})

test('dấu vết edge: workflow tự chạy trên main sau merge (không phải dispatch tay)', () => {
  const wf = read(WORKFLOW)
  const from = wf.indexOf('\n  push:')
  const push = wf.slice(from, wf.indexOf('\npermissions:'))
  assert.ok(from > -1 && push.length > 0, `không tìm thấy khối push: trong ${WORKFLOW}`)
  assert.match(push, /- 'main'/, 'push vào main phải tự chạy job — đó là bằng chứng bước c sau mỗi lần merge')
  assert.match(push, /- 'arena\//, 'vẫn phải giữ các nhánh làm việc arena/* (thêm nhánh, đừng thay nhánh cũ)')
  assert.match(wf, /workflow_dispatch:/, 'vẫn phải bấm chạy tay được')
  assert.match(wf, /live-smoke-target/, 'đường live smoke bằng push phải còn nguyên')
})
