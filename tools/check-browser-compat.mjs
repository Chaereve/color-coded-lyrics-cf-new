/* Cổng chặn regression tương thích trình duyệt cho bản build.
   ---------------------------------------------------------
   Vì sao cần: hạ `build.target` trong vite.config.js chỉ là lời hứa lúc
   build. Một dependency mới, một cú pháp mới lọt vào source, hoặc một
   API mới chưa có polyfill vẫn có thể làm bundle cũ-như-mặc-định và
   quay lại đúng lỗi "màn hình tím / trang không load" trên máy cũ.
   Script này đọc CHÍNH dist/assets sau khi build và chặn hai lớp:

     1. CÚ PHÁP: parse mọi chunk bằng Acorn ở mức ES2020, rồi cấm những
        nút AST mới hơn mức sàn (optional chaining/nullish đã bị dịch
        cho Safari 13.0, logical assignment, class field, BigInt…).
        Dynamic import được phép: Safari 13 đã có.
     2. API: quét các API mới CHƯA được polyfill/guard trong app.
        Object.hasOwn / Array.at / String.at / crypto.randomUUID được
        phép vì src/lib/polyfills.js đã bù; những thứ khác trong danh
        sách cấm phải hoặc không dùng, hoặc thêm polyfill + mở danh sách
        này một cách có chủ đích.

   Chạy: npm run build && npm run check:browser-compat
   (hoặc npm run test:browser-compat làm cả hai).
   Script KHÔNG tự build để còn dùng được trong CI sau bước build sẵn. */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'acorn'
import { BROWSER_TARGETS } from './browser-targets.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const assets = join(root, 'dist', 'assets')
if (!existsSync(assets)) {
  console.error('[browser-compat] chưa có dist/assets — chạy `npm run build` trước.')
  process.exit(1)
}

const files = readdirSync(assets).filter(f => f.endsWith('.js')).sort()
if (files.length === 0) {
  console.error('[browser-compat] dist/assets không có chunk JS nào.')
  process.exit(1)
}

/* Những nút AST này mới hơn mức sàn đã chốt. Acorn ecmaVersion 2020 đã
   chặn phần lớn ES2021+, nhưng optional chaining/nullish là ES2020 nên
   vẫn parse được — phải cấm tường minh vì Safari 13.0 chưa có. */
const BAD_NODE = new Set([
  'ChainExpression',
  'OptionalMemberExpression',
  'OptionalCallExpression',
  'PropertyDefinition',
  'StaticBlock',
  'PrivateIdentifier',
])
const BAD_ASSIGN = new Set(['??=', '||=', '&&='])

/* API chưa có polyfill/guard. Nếu thật sự cần dùng, thêm polyfill vào
   src/lib/polyfills.js (hoặc guard tại chỗ) rồi mới gỡ khỏi danh sách.
   Đừng gỡ chỉ để xanh: mỗi dòng là một ca "máy cũ ném TypeError". */
const FORBIDDEN_API = [
  [/\bstructuredClone\s*\(/, 'structuredClone (Safari 15.4+)'],
  [/\.replaceAll\s*\(/, 'String.replaceAll (Safari 13.1+)'],
  [/\.findLast(?:Index)?\s*\(/, 'Array.findLast/findLastIndex (Safari 15.4+)'],
  [/\.to(?:Sorted|Reversed|Spliced)\s*\(/, 'Array.toSorted/toReversed/toSpliced (Safari 16+)'],
  [/\b(?:Object|Map)\.groupBy\s*\(/, 'Object/Map.groupBy (Safari 17.4+)'],
  [/\bArray\.fromAsync\s*\(/, 'Array.fromAsync (Safari 16.4+)'],
  [/\bAbortSignal\.timeout\s*\(/, 'AbortSignal.timeout (Safari 16+)'],
  [/\bIntl\.ListFormat\s*\(/, 'Intl.ListFormat (Safari 14.1+)'],
  [/\.formatRange(?:ToParts)?\s*\(/, 'Intl.DateTimeFormat.formatRange (Safari 15+)'],
  [/\bBigInt\b|\b\d+n\b/, 'BigInt (Safari 14+)'],
  [/\bSharedArrayBuffer\b/, 'SharedArrayBuffer (cần cross-origin isolation)'],
  [/\bAtomics\.waitAsync\b/, 'Atomics.waitAsync (Safari 16.4+)'],
]

const problems = []
let scanned = 0

function walk(node, file, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) {
    for (const child of node) walk(child, file, seen)
    return
  }
  if (typeof node.type === 'string') {
    if (BAD_NODE.has(node.type)) problems.push(`${file}: cú pháp ${node.type} mới hơn mức sàn`)
    if (node.type === 'LogicalExpression' && node.operator === '??') problems.push(`${file}: nullish coalescing (??) chưa được dịch`)
    if (node.type === 'AssignmentExpression' && BAD_ASSIGN.has(node.operator)) problems.push(`${file}: logical assignment ${node.operator}`)
    if (node.type === 'Literal' && node.bigint) problems.push(`${file}: BigInt literal`)
    if (node.type === 'Literal' && node.regex && /[dv]/.test(node.regex.flags)) problems.push(`${file}: RegExp flag /${node.regex.flags} quá mới`)
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue
    walk(node[key], file, seen)
  }
}

for (const file of files) {
  const source = readFileSync(join(assets, file), 'utf8')
  scanned += 1
  let ast
  try {
    ast = parse(source, { ecmaVersion: 2020, sourceType: 'module', allowHashBang: true })
  } catch (e) {
    problems.push(`${file}: không parse được ở ES2020 — ${e.message}`)
    continue
  }
  walk(ast, file)
  for (const [re, label] of FORBIDDEN_API) {
    if (re.test(source)) problems.push(`${file}: gọi ${label} chưa có polyfill/guard`)
  }
}

/* Polyfill phải thật sự nằm trong bundle entry, không chỉ nằm trong source.
   Lấy entry từ dist/index.html để không đoán tên hash. */
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
const entryMatch = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)
if (!entryMatch) {
  problems.push('dist/index.html: không tìm thấy entry index-*.js')
} else {
  const entry = readFileSync(join(assets, entryMatch[1]), 'utf8')
  for (const marker of ['hasOwn', 'randomUUID']) {
    if (!entry.includes(marker)) problems.push(`${entryMatch[1]}: thiếu dấu vết polyfill ${marker}`)
  }
}

console.log(`[browser-compat] target: ${BROWSER_TARGETS.join(', ')}`)
console.log(`[browser-compat] đã quét ${scanned} chunk JS trong dist/assets`)
if (problems.length) {
  console.error(`[browser-compat] CHẶN — ${problems.length} vấn đề:`)
  for (const p of problems) console.error('  · ' + p)
  process.exit(1)
}
console.log('[browser-compat] ĐẠT — không còn cú pháp/API vượt mức sàn trong bundle.')
