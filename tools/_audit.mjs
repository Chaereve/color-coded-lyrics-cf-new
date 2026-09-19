/* RÀ SOÁT TĨNH TOÀN REPO — tìm lỗi bằng cách đối chiếu các tệp với nhau.
   Chạy: node tools/_audit.mjs
   Không phải test (không nằm trong npm test): in ra danh sách để người đọc tự
   phán đoán, vì nhiều mục là "đáng ngờ", không phải "sai chắc chắn". */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const walk = (dir) => {
  let out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', '.wrangler'].includes(e.name)) continue
      out = out.concat(walk(join(dir, e.name)))
    } else out.push(join(dir, e.name))
  }
  return out
}
const files = walk(ROOT)
const rel = (f) => relative(ROOT, f)
const read = (f) => readFileSync(f, 'utf8')
const srcFiles = files.filter((f) => ['.js', '.jsx'].includes(extname(f)) && !/\.test\.js$/.test(f))
const allSrc = srcFiles.map(read).join('\n')
const css = files.filter((f) => extname(f) === '.css')
const cssAll = css.map(read).join('\n')
const line = (t) => console.log(`\n=== ${t} ===`)

/* ---------- A. biến CSS dùng mà không ai định nghĩa ---------- */
line('A. var(--x) không có nơi định nghĩa')
{
  // định nghĩa: `--x:` trong CSS, hoặc '--x' trong object style của JSX
  const defined = new Set()
  for (const m of cssAll.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])
  for (const m of allSrc.matchAll(/'(--[\w-]+)'\s*:/g)) defined.add(m[1])
  for (const m of allSrc.matchAll(/"(--[\w-]+)"\s*:/g)) defined.add(m[1])
  // đặt bằng JS: el.style.setProperty('--x', …)
  for (const m of allSrc.matchAll(/setProperty\(\s*'(--[\w-]+)'/g)) defined.add(m[1])
  const used = new Map()
  for (const f of css) {
    for (const m of read(f).matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {
      if (!used.has(m[1])) used.set(m[1], rel(f))
    }
  }
  const miss = [...used].filter(([k]) => !defined.has(k))
  console.log(miss.length ? miss.map(([k, f]) => `  ✗ ${k} (dùng ở ${f})`).join('\n') : '  (không có)')
}

/* ---------- B. biến CSS định nghĩa mà không ai dùng ---------- */
line('B. --x định nghĩa nhưng không dùng')
{
  const defined = new Set()
  for (const m of cssAll.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])
  const used = new Set()
  for (const m of cssAll.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1])
  for (const m of allSrc.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1])
  for (const m of allSrc.matchAll(/'(--[\w-]+)'/g)) used.add(m[1])
  const dead = [...defined].filter((k) => !used.has(k))
  console.log(dead.length ? dead.map((k) => `  · ${k}`).join('\n') : '  (không có)')
}

/* ---------- C. hàm xuất ra mà không ai nhập ---------- */
line('C. export không ai import')
{
  const dead = []
  for (const f of srcFiles) {
    const body = read(f)
    for (const m of body.matchAll(/export (?:async )?function (\w+)|export const (\w+)/g)) {
      const name = m[1] || m[2]
      if (!name || name === 'default') continue
      const others = srcFiles.filter((x) => x !== f).map(read).join('\n')
      const tests = files.filter((x) => /\.test\.js$/.test(x)).map(read).join('\n')
      if (!new RegExp(`\\b${name}\\b`).test(others) && !new RegExp(`\\b${name}\\b`).test(tests)) {
        dead.push(`${rel(f)} → ${name}`)
      }
    }
  }
  console.log(dead.length ? dead.map((x) => `  · ${x}`).join('\n') : '  (không có)')
}

/* ---------- D. hợp đồng RPC: tên hàm + tham số ---------- */
line('D. RPC gọi từ client vs định nghĩa trong SQL')
{
  const sql = files.filter((f) => extname(f) === '.sql').map(read).join('\n')
  const rpc = new Set()
  for (const m of allSrc.matchAll(/\.rpc\(\s*'([^']+)'/g)) rpc.add(m[1])
  const bad = []
  /* schema.sql là tệp GỘP: phần đầu là schema gốc, phần cuối là các migration đã
     áp vào. Bản có hiệu lực là bản CUỐI CÙNG trong tệp, nên phải so với bản đó
     chứ không phải bản đầu tiên gặp được. */
  const lastDef = (name) => {
    const re = new RegExp(`create (?:or replace )?function\\s+(?:public\\.)?${name}\\s*\\(([^)]*)\\)`, 'gi')
    let hit = null
    for (const m of sql.matchAll(re)) hit = m[1]
    return hit
  }
  for (const name of rpc) {
    if (lastDef(name) === null) bad.push(`thiếu hàm: ${name}`)
  }
  // tham số: client truyền p_xxx — SQL phải khai đúng tên
  for (const m of allSrc.matchAll(/\.rpc\(\s*'([^']+)'\s*,\s*\{([^}]*)\}/g)) {
    const [, name, args] = m
    const decl = lastDef(name)
    if (decl === null) continue
    for (const a of args.split(',').map((x) => x.split(':')[0].trim()).filter(Boolean)) {
      if (!new RegExp(`\\b${a}\\b`).test(decl)) bad.push(`${name}: tham số ${a} không có trong SQL`)
    }
  }
  console.log(bad.length ? bad.map((x) => `  ✗ ${x}`).join('\n') : `  (${rpc.size} hàm RPC khớp)`)
}

/* ---------- E. tiếng động: gọi sfx.X mà không có X ---------- */
line('E. sfx.<tên> gọi mà không được định nghĩa')
{
  const sfxSrc = read(join(ROOT, 'src/lib/sfx.js'))
  /* Chỉ lấy khoá trong khối `export const sfx = { … }`: bảng VOICES ở trên cũng
     có dạng `Tên: {...}` nên quét cả tệp là nhận nhầm tên nốt thành lời gọi. */
  const block = sfxSrc.slice(sfxSrc.indexOf('export const sfx = {'))
  const defined = new Set([...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]))
  const called = new Set()
  for (const f of srcFiles) if (!f.endsWith('sfx.js')) {
    for (const m of read(f).matchAll(/\bsfx\.(\w+)\s*\(/g)) called.add(m[1])
  }
  const miss = [...called].filter((k) => !defined.has(k))
  const unused = [...defined].filter((k) => !called.has(k))
  console.log(miss.length ? miss.map((k) => `  ✗ gọi sfx.${k}() không tồn tại`).join('\n') : '  (mọi lời gọi đều có thật)')
  if (unused.length) console.log(unused.map((k) => `  · sfx.${k} định nghĩa mà không ai gọi`).join('\n'))
}

/* ---------- F. icon dùng trong JSX vs bộ icon ---------- */
line('F. <Icon name="…"> không có trong bộ icon')
{
  const icon = read(join(ROOT, 'src/components/Icon.jsx'))
  const setBlock = icon.slice(icon.indexOf('const SET'), icon.indexOf('}', icon.indexOf('const SET')))
  const have = new Set([...setBlock.matchAll(/(\w+):\s*\w/g)].map((m) => m[1]))
  const used = new Set()
  for (const f of srcFiles) {
    for (const m of read(f).matchAll(/<Icon\s+name="([^"]+)"/g)) used.add(m[1])
    for (const m of read(f).matchAll(/name=\{?["']?(\w+)["']?\}?\s+size/g)) used.add(m[1])
  }
  const miss = [...used].filter((k) => !have.has(k) && k !== 'name')
  console.log(miss.length ? miss.map((k) => `  ✗ name="${k}" không có trong SET`).join('\n') : `  (${used.size} tên icon đều có thật)`)
}

/* ---------- G. màu viết thẳng trong JSX ---------- */
line('G. mã màu viết thẳng trong JSX (nên là token)')
{
  const bad = []
  for (const f of srcFiles.filter((x) => x.endsWith('.jsx'))) {
    const body = read(f)
    for (const m of body.matchAll(/(?:color|background|borderColor)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g)) {
      bad.push(`${rel(f)}: ${m[1]}`)
    }
  }
  console.log(bad.length ? bad.map((x) => `  · ${x}`).join('\n') : '  (không có)')
}

/* ---------- H. console.log còn sót ---------- */
line('H. console.log/debug/info còn sót trong src (warn/error là cố ý)')
{
  /* Chỉ soi ba hàm ĐỂ LẠI DẤU trong mã khi đã xong việc. `console.warn/error`
     thì giữ: chúng là đường báo lỗi thật của app (một truy vấn Supabase hỏng
     phải kêu ở đâu đó), nên đếm riêng để biết chứ không bắt xoá. */
  const bad = []
  let we = 0
  for (const f of srcFiles) {
    const t = read(f)
    if (/console\.(log|debug|info)\(/.test(t)) bad.push(`${rel(f)}`)
    we += (t.match(/console\.(warn|error)\(/g) || []).length
  }
  console.log(bad.length ? [...new Set(bad)].map((x) => `  · ${x}`).join('\n') : '  (không có)')
  console.log(`  · console.warn/error: ${we} lời gọi (đường báo lỗi, giữ lại)`)
}

/* ---------- I. _blank thiếu rel ---------- */
line('I. target="_blank" thiếu rel="noreferrer"')
{
  const bad = []
  for (const f of srcFiles.filter((x) => x.endsWith('.jsx'))) {
    for (const m of read(f).matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      if (!/rel=/.test(m[0])) bad.push(`${rel(f)}: ${m[0].slice(0, 70)}`)
    }
  }
  console.log(bad.length ? bad.map((x) => `  · ${x}`).join('\n') : '  (không có)')
}

/* ---------- J. cùng một lớp CSS xuất hiện ở hai tệp ---------- */
line('J. lớp CSS có mặt ở cả index.css và DailySpin.css (kèm selector thật)')
{
  /* Đây KHÔNG tự nó là lỗi: `.on` là lớp TRẠNG THÁI, chỉ có nghĩa khi đứng sau
     một khối (`.tab.on`, `.fchip.on`, `.spin-pips i.on`), nên hai tệp cùng nhắc
     nó là chuyện bình thường. Chỗ đáng nhìn là khi cùng một selector ĐẦY ĐỦ được
     khai ở hai tệp — lúc đó thứ tự nạp quyết định kết quả và rất dễ sửa một
     tệp mà tệp kia đè mất. Vì vậy in ra selector, không chỉ tên lớp. */
  const one = read(join(ROOT, 'src/index.css'))
  const two = read(join(ROOT, 'src/components/DailySpin.css'))
  const clean = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  const sels = (s) => clean(s).split('}')
    .map(b => b.split('{')[0].trim())
    .filter(b => /[.]/.test(b))
  const withCls = (list, k) => list.filter(sel => new RegExp(`\\.${k}(?![\\w-])`).test(sel))
  const cls = (s) => new Set([...clean(s).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))
  const both = [...cls(two)].filter(k => cls(one).has(k))
  if (!both.length) console.log('  (không có)')
  const dupes = []
  for (const k of both.sort()) {
    const a = withCls(sels(one), k), b = withCls(sels(two), k)
    const same = a.filter(x => b.includes(x))
    if (same.length) dupes.push(...same.map(x => `${x} (${'index.css + DailySpin.css'})`))
    console.log(`  · .${k}\n      index.css      : ${a.slice(0, 3).join(' · ') || '—'}\n      DailySpin.css  : ${b.slice(0, 3).join(' · ') || '—'}`)
  }
  console.log(dupes.length
    ? `  ⇒ ${dupes.length} selector bị khai ở CẢ HAI tệp: ${dupes.join(', ')}`
    : '  ⇒ không selector nào bị khai trùng hoàn toàn (lớp trạng thái dùng chung là bình thường)')
}

/* ---------- K. breakpoint đang dùng ---------- */
line('K. các mốc @media đang dùng')
{
  const counts = new Map()
  for (const f of css) {
    for (const m of read(f).matchAll(/@media[^{]*?(?:width|height):\s*(\d+)px/g)) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1)
    }
  }
  console.log([...counts].sort((x, y) => +x[0] - +y[0]).map(([px, n]) => `  ${px}px — ${n} lần`).join('\n'))
}

/* ---------- L. !important ---------- */
line('L. !important')
{
  for (const f of css) {
    const body = read(f)
    for (const m of body.matchAll(/([^{}\n]*)\{([^{}]*!important[^{}]*)\}/g)) {
      console.log(`  · ${rel(f)} · ${m[1].trim().slice(0, 60)} — ${m[2].match(/[a-z-]+\s*:[^;]*!important/g)?.join(' / ')}`)
    }
  }
}

/* ---------- M. biến môi trường dùng trong mã ---------- */
line('M. VITE_* dùng trong mã')
{
  const env = new Set([...allSrc.matchAll(/import\.meta\.env\.(\w+)/g)].map((m) => m[1]))
  for (const k of env) {
    const inDocs = ['README.md', 'docs/DA-LAM-VA-GOI-Y.md', 'docs/DESIGN.md', '.env.example']
      .filter((f) => existsSync(join(ROOT, f)))
      .some((f) => read(join(ROOT, f)).includes(k))
    console.log(`  ${inDocs ? '·' : '✗'} ${k}${inDocs ? '' : ' — không thấy trong tài liệu'}`)
  }
}
