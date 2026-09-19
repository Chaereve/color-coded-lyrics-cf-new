/* Chốt chặn cho BỘ ICON DÙNG CHUNG (components/Icon.jsx).
   ---------------------------------------------------------
   Lúc chuyển cả trang sang Lucide, ba kiểu sai đều CÂM LẶNG:
     1. gõ sai tên (`name="clse"`) — Icon trả về `null`, nút thành nút trống,
        không lỗi, không cảnh báo, chỉ có một khoảng trắng ở chỗ đáng ra là hình;
     2. tên dùng trong biểu thức (`name={on ? 'sound' : 'mute'}`) hoặc trong
        bảng ánh xạ (`NAV_ICON`, `TONE`) — quét bằng mắt thì không tới;
     3. tên nằm trong SET mà không chỗ nào dùng — rác tích lại, và lần sau có
        người tưởng nó đang chạy thật.

   Ba ca dưới đây bắt đúng ba kiểu đó, ở dạng TĨNH (không cần trình duyệt). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const at = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const srcDir = fileURLToPath(new URL('..', import.meta.url))
const iconSrc = at('./Icon.jsx')

/* SET trong Icon.jsx: mỗi dòng là `ten: Glyph,` (có thể kèm chú thích) */
const SET = new Set(
  [...iconSrc.matchAll(/^\s{2}([A-Za-z][\w]*)\s*:/gm)].map(([, k]) => k).filter((k) => k !== 'SET'),
)

/* mọi file .jsx trong src/, trừ chính Icon.jsx và các file test */
function jsxFiles(dir = srcDir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) return jsxFiles(p)
    if (!e.name.endsWith('.jsx') || e.name.endsWith('.test.jsx') || e.name === 'Icon.jsx') return []
    return [p]
  })
}

const FILES = jsxFiles().map((p) => [p.replace(`${srcDir}/`, ''), readFileSync(p, 'utf8')])

test('mọi tên icon viết thẳng trong JSX đều có trong SET', () => {
  const bad = []
  for (const [file, src] of FILES) {
    for (const [, name] of src.matchAll(/<Icon\s[^>]*?name="([^"]+)"/gs)) {
      if (!SET.has(name)) bad.push(`${file}: name="${name}"`)
    }
  }
  assert.deepEqual(bad, [], `Icon trả về null cho tên lạ — nút sẽ trống. Sai ở: ${bad.join(', ')}`)
})

test('mọi tên icon trong biểu thức và bảng ánh xạ đều có trong SET', () => {
  const bad = []
  for (const [file, src] of FILES) {
    /* tên nằm trong biểu thức của chính thẻ Icon: name={a ? 'x' : 'y'} */
    for (const [, expr] of src.matchAll(/<Icon\s[^>]*?name=\{([^}]*)\}/gs)) {
      for (const m of expr.matchAll(/'([A-Za-z][\w]*)'|"([A-Za-z][\w]*)"/g)) {
        const n = m[1] || m[2]
        if (!SET.has(n)) bad.push(`${file}: ${n}`)
      }
    }
    /* bảng ánh xạ dùng cho icon: NAV_ICON / TONE (giá trị là tên icon) */
    for (const [, mapName, body] of src.matchAll(/const\s+(NAV_ICON|TONE)\s*=\s*\{([^}]*)\}/gs)) {
      for (const [, name] of body.matchAll(/:\s*'([A-Za-z][\w]*)'/g)) {
        if (!SET.has(name)) bad.push(`${file}: ${mapName} -> ${name}`)
      }
    }
  }
  assert.deepEqual(bad, [], `Sai tên trong biểu thức/bảng ánh xạ: ${bad.join(', ')}`)
})

test('SET không có tên chết (khai mà không chỗ nào dùng)', () => {
  const used = new Set()
  for (const [, src] of FILES) {
    for (const [, name] of src.matchAll(/<Icon\s[^>]*?name="([^"]+)"/gs)) used.add(name)
    for (const [, expr] of src.matchAll(/<Icon\s[^>]*?name=\{([^}]*)\}/gs)) {
      for (const [, name] of expr.matchAll(/'([A-Za-z][\w]*)'|"([A-Za-z][\w]*)"/g)) used.add(name)
    }
    for (const [, , body] of src.matchAll(/const\s+(NAV_ICON|TONE)\s*=\s*\{([^}]*)\}/gs)) {
      for (const [, name] of body.matchAll(/:\s*'([A-Za-z][\w]*)'/g)) used.add(name)
    }
  }
  const dead = [...SET].filter((n) => !used.has(n)).sort()
  assert.deepEqual(dead, [], `Tên trong SET mà không nơi nào dùng: ${dead.join(', ')} — xoá đi, hoặc dùng cho đúng chỗ`)
})
