/* Kiểm thử BỘ SAO LƯU — `npm test`, không cần database, không cần mạng.

   Sao lưu là thứ duy nhất trong repo này mà "chạy được trên máy tôi" không
   nói lên điều gì: nó chỉ chạy thật vào đúng lúc đã có sự cố. Nên ở đây kiểm
   hai tầng:

     1. HỢP ĐỒNG (đọc file): workflow có cron + chạy tay, có bước thử phục
        hồi trên Postgres sạch, artifact còn 30 ngày, và KHÔNG có mảnh bí mật
        nào nằm trong repo.
     2. HÀNH VI (chạy thật): dựng pg_dump/pg_restore/psql GIẢ trong thư mục
        tạm rồi chạy chính hai script bằng bash. Bắt được lỗi cú pháp, lỗi
        trích dẫn, và quan trọng nhất: chốt chặn "dấu vân tay lệch thì phải
        đỏ" có thật sự đỏ hay không.

   Điều không kiểm được ở đây: kết nối tới Supabase thật (cần project + mật
   khẩu). Việc đó do workflow làm, bằng đúng hai script này. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const at = (p) => join(root, p)
const read = (p) => readFileSync(at(p), 'utf8')

const WORKFLOW = '.github/workflows/backup-db.yml'
const SCRIPTS = ['scripts/backup-db.sh', 'scripts/verify-backup.sh', 'scripts/push-to-r2.sh']
const SQL = ['scripts/db-fingerprint.sql', 'scripts/backup-stubs.sql']

/* bash có mặt trên mọi máy dev của repo này (script chạy bằng bash); vẫn
   kiểm để một máy thiếu bash báo "skip" chứ không báo "hỏng". */
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0
const run = (cmd, args, env) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } })

/* ---------------- 1. hợp đồng ---------------- */

test('sao lưu: workflow có cron, chạy tay được, và tự thử phục hồi', () => {
  const wf = read(WORKFLOW)
  assert.match(wf, /^on:/m, 'thiếu khối on:')
  assert.match(wf, /schedule:/, 'thiếu cron — sao lưu phải tự chạy')
  assert.match(wf, /cron: '0 19 \* \* \*'/, 'đổi giờ cron thì phải đổi cả comment giải thích')
  assert.match(wf, /workflow_dispatch:/, 'phải bấm chạy tay được — lần đầu ai cũng cần thử')
  assert.match(wf, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/,
    'chuỗi kết nối phải đi qua secrets, không viết thẳng vào file')
  assert.match(wf, /image: postgres:17/, 'phải có Postgres sạch để thử phục hồi')
  assert.match(wf, /verify-backup\.sh/, 'thiếu bước thử phục hồi: dump chưa phục hồi được thì chưa phải backup')
  assert.match(wf, /retention-days: \d+/, 'artifact phải khai số ngày giữ')
  assert.match(wf, /if: always\(\)[\s\S]{0,120}upload-artifact/,
    'artifact phải upload cả khi bước trước hỏng — file hỏng cũng là thông tin')
  assert.match(wf, /if: failure\(\)/, 'phải có bước nói rõ việc cần làm khi job đỏ')
})

test('sao lưu: không có bí mật nào nằm trong repo', () => {
  const files = [WORKFLOW, ...SCRIPTS, ...SQL, 'HUONG-DAN.md']
  const all = files.map(read).join('\n')
  /* Tài liệu có NHẮC tới `sb_secret_...` để dặn đừng dùng — nên phải bắt
     theo dạng khoá thật (chuỗi dài sau tiền tố), không phải tên tiền tố. */
  assert.doesNotMatch(all, /sb_secret_[A-Za-z0-9_-]{16,}/, 'khoá secret của Supabase không được nằm trong repo')
  assert.doesNotMatch(all, /eyJ[A-Za-z0-9_-]{12}/, 'không được có JWT nào trong repo')
  assert.doesNotMatch(all, /SUPABASE_DB_URL\s*=\s*postgres/, 'không dán chuỗi kết nối thật vào đâu cả')
  /* Log của CI là nơi nhiều người đọc được: mật khẩu trong chuỗi kết nối phải
     được che trước khi in. */
  assert.match(read('scripts/backup-db.sh'), /mask\(\)/, 'thiếu hàm che mật khẩu khi in log')
})

test('sao lưu: dấu vân tay so cả policy và trigger, không chỉ số dòng', () => {
  const sql = read('scripts/db-fingerprint.sql')
  for (const kind of ['table|', 'function|', 'policy|', 'trigger|', 'sequence|', 'index|', 'view|']) {
    assert.ok(sql.includes(`'${kind}'`), `thiếu ${kind} trong dấu vân tay`)
  }
  assert.match(sql, /order by line/, 'phải sắp xếp: diff cần thứ tự ổn định')
  /* Thiếu policy thì số dòng vẫn khớp mà bản phục hồi đã hở quyền — đây là
     lý do policy phải nằm trong phép so, ghi lại bằng chính câu này. */
  assert.match(sql, /RLS/i)
  /* Index sinh ra bởi ràng buộc unique cũng là một phần của lá chắn: mất một
     unique là vote được hai lần, mà số dòng trong bảng thì vẫn khớp. */
  assert.match(sql, /pg_index/)
})

test('sao lưu: stub phục hồi tạo đúng ba role mà policy trỏ tới', () => {
  const sql = read('scripts/backup-stubs.sql')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(sql, new RegExp(`create role ${role}\\b`), `thiếu role ${role}`)
  }
  assert.match(sql, /create or replace function auth\.uid\(\)/, 'policy RLS gọi auth.uid() — thiếu là restore đỏ')
  assert.match(sql, /KHÔNG chạy file này trên project Supabase thật/, 'stub phải cảnh báo rõ, tránh chạy nhầm trên DB thật')
})

test('sao lưu: có lệnh npm để chạy tay, và backup/ không bị commit', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['backup:db'], 'bash scripts/backup-db.sh')
  assert.equal(pkg.scripts['backup:verify'], 'bash scripts/verify-backup.sh')
  assert.match(read('.gitignore'), /^backup\/$/m, 'thư mục backup/ phải nằm trong .gitignore')
})

/* ---------------- 2. hành vi, với công cụ giả ---------------- */

const DUMP_URL = 'postgres://postgres.abcdefghij:s3cret-pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
const FP_SRC = [
  'function|pick_top_request|1',
  'policy|read requests|4',
  'sequence|requests_id_seq|0',
  'table|orders|7',
  'table|requests|412',
  'table|votes|1830',
  'trigger|notify_request|1',
].join('\n') + '\n'

/* Ba công cụ giả: đủ để đi hết đường đi thật của script, không chạm database
   nào. Mọi hành vi đổi được bằng biến môi trường FAKE_* để còn dựng ca lỗi. */
function fakeTools(dir) {
  mkdirSync(dir, { recursive: true })
  const put = (name, body) => {
    const p = join(dir, name)
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(p, 0o755)
    return p
  }

  put('pg_dump', `
for a in "$@"; do
  if [ "$a" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.4 (fake)"; exit 0; fi
done
if [ "\${FAKE_DUMP_FAIL:-}" = "1" ]; then
  echo "pg_dump: error: connection to server failed: Network is unreachable" >&2; exit 1
fi
out=""
for a in "$@"; do case "$a" in --file=*) out="\${a#--file=}";; esac; done
[ -n "$out" ] || { echo "fake pg_dump: thiếu --file" >&2; exit 2; }
if [ "\${FAKE_DUMP_EMPTY:-}" = "1" ]; then : > "$out"; exit 0; fi
printf 'PGDMP fake dump for %s\\n' "$out" > "$out"
printf '%0.s1' $(seq 1 512) >> "$out"
exit 0
`)

  put('pg_restore', `
list=0; dump=""
for a in "$@"; do
  [ "$a" = "--list" ] && list=1
  case "$a" in --*) ;; *) [ -f "$a" ] && dump="$a" ;; esac
done
if [ "$list" = "1" ]; then
  if [ "\${FAKE_LIST_FAIL:-}" = "1" ]; then echo "pg_restore: error: unsupported version" >&2; exit 1; fi
  printf ';\\n1; 0 0 TABLE public requests postgres\\n2; 0 0 TABLE public votes postgres\\n'
  exit 0
fi
# Lượt phục hồi thật (không --list): ghi lại đã được gọi, và nhả một cảnh báo
# lành tính để kiểm nhánh cảnh báo.
echo "restore $dump" >> "\${FAKE_STATE:?}/restore.log"
[ "\${FAKE_RESTORE_WARN:-}" = "1" ] && echo "pg_restore: error: schema \\"public\\" already exists" >&2
exit \${FAKE_RESTORE_RC:-0}
`)

  put('psql', `
for a in "$@"; do
  if [ "$a" = "--version" ]; then echo "psql (PostgreSQL) 17.4 (fake)"; exit 0; fi
done
args="$*"
case "$args" in
  *information_schema.tables*) echo "\${FAKE_TABLES:-0}"; exit 0 ;;
  *backup-stubs.sql*) exit 0 ;;
  *db-fingerprint.sql*)
    n=$(cat "\${FAKE_STATE:?}/fp.n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "\${FAKE_STATE}/fp.n"
    if [ "$n" -eq 1 ]; then cat "\${FAKE_FP_SRC:?}"; else cat "\${FAKE_FP_DST:-\${FAKE_FP_SRC}}"; fi
    exit 0 ;;
esac
exit 0
`)
}

function sandbox({ fakeEnv = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ccl-backup-'))
  const bin = join(dir, 'bin')
  const state = join(dir, 'state')
  const backup = join(dir, 'backup')
  mkdirSync(state, { recursive: true })
  fakeTools(bin)
  const fpSrc = join(dir, 'fp-src.txt')
  writeFileSync(fpSrc, FP_SRC)
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    SUPABASE_DB_URL: DUMP_URL,
    VERIFY_DB_URL: 'postgres://postgres:verify@localhost:5432/verify',
    BACKUP_DIR: backup,
    FAKE_STATE: state,
    FAKE_FP_SRC: fpSrc,
    ...fakeEnv,
  }
  const files = () => readdirSync(backup).sort()
  return { dir, state, backup, fpSrc, env, files }
}

test('sao lưu: chạy hết lượt — dump, dấu vân tay, manifest, che mật khẩu', { skip: !hasBash }, () => {
  const s = sandbox()
  const r = run('bash', [at('scripts/backup-db.sh')], s.env)
  assert.equal(r.status, 0, r.stderr)

  const names = s.files()
  assert.ok(names.some(n => n.endsWith('.dump')), `không có file dump: ${names}`)
  assert.ok(names.includes('fingerprint.txt'))
  assert.ok(names.includes('manifest.txt'))
  assert.ok(names.includes('auth-users.sql'), 'bảng người dùng phải được dump riêng')

  const manifest = readFileSync(join(s.backup, 'manifest.txt'), 'utf8')
  assert.match(manifest, /^app_commit: /m)
  assert.match(manifest, /^tables: 3$/m, 'manifest phải đếm được bảng trong dấu vân tay')
  assert.match(manifest, /^policies: 1$/m)
  assert.match(manifest, /^rows_total: 2249$/m, 'tổng số dòng phải bằng tổng các dòng table|')

  /* Mật khẩu trong chuỗi kết nối không được rò ra log hay file nào. */
  const everywhere = r.stdout + r.stderr + names.map(n => readFileSync(join(s.backup, n), 'utf8')).join('\n')
  assert.doesNotMatch(everywhere, /s3cret-pw/, 'mật khẩu bị in ra!')
  assert.match(r.stdout, /pooler\.supabase\.com/, 'vẫn phải thấy host để còn biết dump từ đâu')
})

test('sao lưu: thiếu chuỗi kết nối thì dừng ngay và nói rõ tên biến', { skip: !hasBash }, () => {
  const s = sandbox()
  const r = run('bash', [at('scripts/backup-db.sh')], { ...s.env, SUPABASE_DB_URL: '' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /SUPABASE_DB_URL/)
  assert.equal(existsSync(s.backup), false, 'chưa có gì để ghi thì đừng tạo thư mục rỗng')
})

test('sao lưu: dump hỏng thì trỏ đúng bốn nguyên nhân hay gặp', { skip: !hasBash }, () => {
  const s = sandbox({ fakeEnv: { FAKE_DUMP_FAIL: '1' } })
  const r = run('bash', [at('scripts/backup-db.sh')], s.env)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Session pooler/, 'phải nhắc IPv6/IPv4 — lỗi hay gặp nhất khi kết nối từ GitHub')
  assert.match(r.stderr, /NGỦ/, 'phải nhắc project free tự tạm dừng')
})

test('sao lưu: dump rỗng hoặc không đọc được thì không upload file vô dụng', { skip: !hasBash }, () => {
  const empty = sandbox({ fakeEnv: { FAKE_DUMP_EMPTY: '1' } })
  const r1 = run('bash', [at('scripts/backup-db.sh')], empty.env)
  assert.notEqual(r1.status, 0, 'dump 0 byte phải bị chặn')
  assert.match(r1.stderr, /rỗng/)

  const broken = sandbox({ fakeEnv: { FAKE_LIST_FAIL: '1' } })
  const r2 = run('bash', [at('scripts/backup-db.sh')], broken.env)
  assert.notEqual(r2.status, 0, 'pg_restore không đọc được file thì phải bị chặn')
  assert.match(r2.stderr, /pg_restore --list/)
})

test('kiểm tra phục hồi: khớp thì xanh, lệch một dòng thì phải đỏ', { skip: !hasBash }, () => {
  /* Cùng một nguồn, hai database đích khác nhau: đây chính là thứ tự thật
     của workflow (dump trước, verify sau). */
  const ok = sandbox()
  assert.equal(run('bash', [at('scripts/backup-db.sh')], ok.env).status, 0)
  writeFileSync(join(ok.dir, 'fp-dst.txt'), FP_SRC)
  const rOk = run('bash', [at('scripts/verify-backup.sh')], { ...ok.env, FAKE_FP_DST: join(ok.dir, 'fp-dst.txt') })
  assert.equal(rOk.status, 0, rOk.stderr)
  assert.match(rOk.stdout, /khớp hoàn toàn/)
  assert.equal(existsSync(join(ok.backup, 'fingerprint.diff')), false, 'khớp thì không để lại file diff')

  const bad = sandbox()
  assert.equal(run('bash', [at('scripts/backup-db.sh')], bad.env).status, 0)
  writeFileSync(join(bad.dir, 'fp-dst.txt'), FP_SRC.replace('table|requests|412', 'table|requests|407'))
  const rBad = run('bash', [at('scripts/verify-backup.sh')], { ...bad.env, FAKE_FP_DST: join(bad.dir, 'fp-dst.txt') })
  assert.notEqual(rBad.status, 0, 'thiếu 5 dòng mà vẫn xanh thì bản dump đó vô giá trị')
  assert.match(rBad.stderr, /LỆCH/)
  assert.match(readFileSync(join(bad.backup, 'fingerprint.diff'), 'utf8'), /table\|requests/)
})

test('kiểm tra phục hồi: database đích đã có dữ liệu thì từ chối, không đổ chồng', { skip: !hasBash }, () => {
  const s = sandbox({ fakeEnv: { FAKE_TABLES: '5' } })
  assert.equal(run('bash', [at('scripts/backup-db.sh')], s.env).status, 0)
  const r = run('bash', [at('scripts/verify-backup.sh')], s.env)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /TRỐNG/)
  assert.equal(existsSync(join(s.state, 'restore.log')), false, 'không được pg_restore vào một database bẩn')
})

test('kiểm tra phục hồi: cảnh báo lành tính không làm đỏ lượt sao lưu', { skip: !hasBash }, () => {
  const s = sandbox({ fakeEnv: { FAKE_RESTORE_WARN: '1' } })
  assert.equal(run('bash', [at('scripts/backup-db.sh')], s.env).status, 0)
  writeFileSync(join(s.dir, 'fp-dst.txt'), FP_SRC)
  const r = run('bash', [at('scripts/verify-backup.sh')], { ...s.env, FAKE_FP_DST: join(s.dir, 'fp-dst.txt') })
  assert.equal(r.status, 0, 'schema public đã tồn tại là chuyện bình thường, không phải hỏng')
  assert.match(r.stdout, /cảnh báo từ pg_restore/)
})

test('đẩy lên R2: chưa cấu hình thì bỏ qua êm, không làm hỏng lượt sao lưu', { skip: !hasBash }, () => {
  const s = sandbox()
  const r = run('bash', [at('scripts/push-to-r2.sh')], { ...s.env, R2_BUCKET: '' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /bỏ qua/)
})
