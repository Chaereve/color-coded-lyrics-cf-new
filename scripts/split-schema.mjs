// Tạo các file nhỏ để dán vào Supabase SQL Editor khi cài database MỚI.
// Chỉ cắt tại ranh giới câu lệnh/transaction; không biên tập SQL hay đổi thứ tự.
//   node scripts/split-schema.mjs --write   # khi schema.sql thay đổi
//   node scripts/split-schema.mjs --check   # kiểm tra các file đã commit
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Buffer } from 'node:buffer'
import process from 'node:process'

export const MAX_PART_BYTES = 32 * 1024
export const PARTS = [
  { name: '01-core-requests.sql' },
  { name: '02-pick-media.sql', start: '-- =========================================================\n-- 9b1. CHU KY PICK' },
  { name: '03-daily-spin.sql', start: '-- BEGIN DAILY SPIN:' },
  { name: '04-spin-quota-rls.sql', start: '-- Vote status split (2026-11-01' },
  { name: '05-vote-hardening.sql', start: '-- =========================================================\n-- VOTE HARDENING (2026-11-03)' },
  { name: '06-watch-comments-streak.sql', start: '-- =========================================================\n-- THEO DÕI BÀI + THÔNG BÁO' },
  { name: '07-security-audit.sql', start: '-- Color Coded Lyrics — security audit hardening' },
  { name: '08-comments-activity.sql', start: '-- BEGIN COMMENTS / SPIN FIXES:' },
]

const SOURCE = new URL('../supabase/schema.sql', import.meta.url)
const OUT = new URL('../supabase/setup/', import.meta.url)

export function splitSchema(schema) {
  const offsets = PARTS.map(({ name, start }) => {
    if (!start) return 0
    const at = schema.indexOf(start)
    if (at < 0 || schema.indexOf(start, at + start.length) !== -1 || (at > 0 && schema[at - 1] !== '\n')) {
      throw new Error(`Ranh giới ${name} không duy nhất / không ở đầu dòng`)
    }
    // Chuyển dòng trống ngăn cách sang ĐẦU file kế tiếp: file trước kết thúc
    // bằng đúng một newline (không bị git diff --check báo blank line at EOF),
    // nhưng ghép các file vẫn khôi phục nguyên văn schema.sql.
    let cut = at
    while (cut > 1 && schema[cut - 1] === '\n' && schema[cut - 2] === '\n') cut--
    return cut
  })
  const chunks = PARTS.map(({ name }, i) => ({ name, sql: schema.slice(offsets[i], offsets[i + 1]) }))

  for (const { name, sql } of chunks) {
    if (!sql || Buffer.byteLength(sql, 'utf8') > MAX_PART_BYTES) {
      throw new Error(`${name} trống hoặc vượt ${MAX_PART_BYTES} byte — cần thêm ranh giới an toàn`)
    }
    // Sau mỗi file, không được có câu lệnh / BEGIN đang dang dở. Các câu lệnh
    // bên trong thân $$ của function đều thụt dòng; BEGIN/COMMIT của migration
    // là các dòng ở cột 1. Nếu có SQL mới, kiểm tra lại ranh giới trước khi sửa.
    const lastCodeLine = sql.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--')).at(-1)
    if (!lastCodeLine?.endsWith(';')) throw new Error(`${name} kết thúc giữa câu lệnh SQL`)
    let tx = 0
    for (const match of sql.matchAll(/^(begin|commit);[ \t]*$/gm)) {
      tx += match[1] === 'begin' ? 1 : -1
      if (tx < 0 || tx > 1) throw new Error(`${name} có BEGIN/COMMIT không cân bằng`)
    }
    if (tx !== 0) throw new Error(`${name} cắt ngang transaction — không thể chạy trong tab SQL Editor khác`)
  }
  if (chunks.map(({ sql }) => sql).join('') !== schema) throw new Error('File đã cắt khác schema.sql')
  return chunks
}

function main(mode) {
  if (!['--check', '--write'].includes(mode)) throw new Error('Dùng --check hoặc --write')
  const chunks = splitSchema(readFileSync(SOURCE, 'utf8'))
  if (mode === '--write') mkdirSync(OUT, { recursive: true })
  const existing = readdirSync(OUT).filter(name => /^\d\d-.*\.sql$/.test(name)).sort()
  const expected = chunks.map(({ name }) => name).sort()
  if (mode === '--check' && existing.join(',') !== expected.join(',')) {
    throw new Error('Danh sách file setup chưa khớp schema.sql — chạy npm run schema:split')
  }
  for (const { name, sql } of chunks) {
    const path = new URL(name, OUT)
    if (mode === '--write') writeFileSync(path, sql)
    else if (readFileSync(path, 'utf8') !== sql) {
      throw new Error(`${name} chưa khớp schema.sql — chạy npm run schema:split`)
    }
    console.log(`${name}: ${Buffer.byteLength(sql, 'utf8')} bytes`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ?? '--check')
}
