/* Bằng chứng cho câu hỏi: "một bundle CŨ còn nằm trong cache trình duyệt gọi lại
   5 RPC đã bị 20261122 revoke thì người dùng thấy gì?"
   -----------------------------------------------------------------------------
   Bài kiểm `supabase/tests/quizRevokedClientErrors.test.js` chốt phía server;
   `src/lib/retiredClientError.test.js` chốt phía câu chữ. Công cụ này ghép hai
   nửa lại thành MỘT bảng đọc được: với từng cửa RPC, lỗi THẬT lấy từ PostgreSQL
   (đúng role, đúng chữ ký, đúng tham số như client cũ) và câu mà người dùng
   thật sự nhìn thấy sau khi đi qua `errMsg` của app.

   Bốn điều được đối chiếu cho mỗi dòng (a–d của gate review):
     a. có lỗi trả về, không treo/kẹt (không phải một promise không bao giờ xong);
     b. lỗi xử lý được: SQLSTATE 42501 (nhóm "quyền bị từ chối"), không phải 500;
     c. câu hiển thị mời nạp lại trang (chuỗi err.featureRetiredClient);
     d. câu đó không lộ tên hàm, SQLSTATE hay chữ "permission denied".

   Chạy (cần PostgreSQL thật):
     MIGRATION_DEPLOY_TEST_DATABASE_URL=postgres://… node tools/revoked-rpc-evidence.mjs
   Không đụng database thật: dựng fixture trong database của URL rồi dọn như mọi
   bài kiểm khác của repo. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { withDatabase, installLevel, migrationSql, seedUser } from '../supabase/tests/_fixtures.mjs'
import { applyMigration, ensureHistory } from './migrate.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const repo = fileURLToPath(new URL('..', import.meta.url))
const CUTOVER = '20261121_vote_calendar_decoupling'
const DISABLE = '20261122_disable_daily_quiz_runtime'
const REQUIRED_HISTORY = [
  '20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable',
]

/* Đúng năm cửa đã revoke — gọi đúng chữ ký mà bundle cũ đang gọi. */
const CALLS = [
  { rpc: 'start_daily_quiz', sql: 'select public.start_daily_quiz($1::uuid, $2::date)', args: u => [u, null] },
  { rpc: 'submit_daily_quiz_answer', sql: 'select public.submit_daily_quiz_answer($1::uuid, $2::uuid, $3::text, $4::text)', args: u => [u, '00000000-0000-0000-0000-000000000000', 'q-old', 'a'] },
  { rpc: 'submit_daily_quiz', sql: 'select public.submit_daily_quiz($1::uuid, $2::uuid, $3::int[])', args: u => [u, '00000000-0000-0000-0000-000000000000', [0, 1, 2, 3, 4]] },
  { rpc: 'my_daily_rewards_status', sql: 'select public.my_daily_rewards_status()', args: () => [] },
  { rpc: 'claim_daily_login', sql: 'select public.claim_daily_login($1::uuid, $2::date)', args: u => [u, null] },
]

if (!url) {
  console.log('Cần MIGRATION_DEPLOY_TEST_DATABASE_URL — đây là công cụ lấy bằng chứng trên PostgreSQL thật.')
  process.exit(0)
}

const server = await createServer({
  root: repo, configFile: false, mode: 'test', logLevel: 'error',
  cacheDir: 'node_modules/.vite-revoked-rpc-evidence', server: { middlewareMode: true, hmr: false, watch: null },
})
const { errMsg, translate } = await server.ssrLoadModule('/src/lib/i18n.jsx')
const refresh = translate('err.featureRetiredClient')

const rows = []
await withDatabase(url, async (pool, client) => {
  await installLevel(pool, '20261117')
  await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
  await pool.query(migrationSql('20261120_daily_login_reward_immutable'))
  const userId = await seedUser(pool)
  await ensureHistory(client)
  for (const version of REQUIRED_HISTORY) {
    await client.query(
      'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
      [version, [], `verified fixture state: ${version}`])
  }
  await applyMigration(client, { id: CUTOVER, name: `${CUTOVER}.sql`, sql: migrationSql(CUTOVER) })
  await applyMigration(client, { id: DISABLE, name: `${DISABLE}.sql`, sql: migrationSql(DISABLE) })

  for (const role of ['authenticated', 'anon']) {
    for (const entry of CALLS) {
      /* Gọi như client thật: đúng role, đúng JWT claim, transaction riêng để một
         cú 42501 không làm hỏng connection dùng cho các dòng sau. */
      await client.query('begin')
      let error = null
      const started = Date.now()
      try {
        await client.query(`set local role ${role}`)
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
        await client.query(entry.sql, entry.args(userId))
      } catch (e) { error = e } finally { await client.query('rollback') }
      const elapsed = Date.now() - started

      const body = { code: error?.code ?? null, message: error?.message ?? null }
      const shown = body.code ? errMsg(translate, { code: body.code, message: body.message, details: null, hint: null }) : ''
      rows.push({
        role,
        rpc: entry.rpc,
        sqlstate: body.code,
        postgres_message: body.message,
        shown_to_user: shown,
        ms: elapsed,
        graceful: {
          /* a: có lỗi trả về ngay (không treo) — đo bằng thời gian thực thi. */
          a_errors_instead_of_hanging: Boolean(error) && elapsed < 5_000,
          /* b: lỗi quyền, nhóm mà app đã có đường xử lý. */
          b_manageable_error: body.code === '42501',
          /* c: đúng câu mời nạp lại trang của app. */
          c_shows_refresh_message: shown === refresh && /refresh/i.test(shown),
          /* d: không lộ chi tiết Postgres / tên hàm. */
          d_no_postgres_leak: !/permission denied|SQLSTATE|42501|_|err\./i.test(shown),
        },
      })
    }
  }
})
await server.close()

const pad = (s, n) => String(s).padEnd(n)
console.log('\nCửa RPC đã revoke (20261122) — client cũ gọi lại thì nhận gì, và người dùng thấy gì\n')
console.log(`${pad('role', 14)}${pad('RPC', 26)}${pad('SQLSTATE', 10)}${pad('a', 3)}${pad('b', 3)}${pad('c', 3)}d`)
console.log('─'.repeat(72))
for (const r of rows) {
  const g = r.graceful
  console.log(`${pad(r.role, 14)}${pad(r.rpc, 26)}${pad(r.sqlstate, 10)}${pad(g.a_errors_instead_of_hanging ? '✓' : '✗', 3)}${pad(g.b_manageable_error ? '✓' : '✗', 3)}${pad(g.c_shows_refresh_message ? '✓' : '✗', 3)}${g.d_no_postgres_leak ? '✓' : '✗'}`)
}
console.log('\nCâu người dùng nhìn thấy (mọi cửa, mọi role):')
console.log(`  “${refresh}”`)
console.log('\nLỗi thô từ PostgreSQL (chỉ ở log, không tới người dùng):')
for (const r of rows.filter(x => x.role === 'authenticated')) {
  console.log(`  ${pad(r.rpc, 26)} ${r.sqlstate}  ${r.postgres_message}`)
}

const outDir = join(repo, 'artifacts')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'revoked-rpc-client-view.json'),
  JSON.stringify({ generated_from: 'real PostgreSQL, fixture + 20261121 + 20261122', rows }, null, 2))
console.log(`\nJSON: ${join('artifacts', 'revoked-rpc-client-view.json')}`)

const bad = rows.filter(r => Object.values(r.graceful).some(v => !v))
console.log(`\n──────── ${rows.length - bad.length}/${rows.length} dòng đạt cả a–d ────────`)
if (bad.length) {
  bad.forEach(r => console.log(`FAIL  ${r.role}.${r.rpc}: ${JSON.stringify(r.graceful)}`))
  process.exit(1)
}
