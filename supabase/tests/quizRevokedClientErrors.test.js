/* Phía server, khi client cũ (bundle đã cache) gọi lại 5 cửa RPC đã bị 20261122
   revoke — đúng cái mà một tab đang mở từ trước sẽ làm:
     · cả `authenticated` lẫn `anon` đều bị từ chối bằng SQLSTATE 42501
       (permission denied for function …), lỗi mà client xử lý được;
     · không một dòng nào bị ghi vào bảng quiz, sổ vote hay lịch điểm danh;
     · trong cùng database đó, Calendar và vote API vẫn chạy bình thường cho
       `authenticated` — revoke quiz không kéo theo đường còn sống.
   Bài kiểm cần PostgreSQL thật: MIGRATION_DEPLOY_TEST_DATABASE_URL=… node --test
   supabase/tests/quizRevokedClientErrors.test.js */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  withDatabase, installLevel, migrationSql, seedUser, dayOf,
} from './_fixtures.mjs'
import { applyMigration, ensureHistory } from '../../tools/migrate.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const CUTOVER = '20261121_vote_calendar_decoupling'
const DISABLE = '20261122_disable_daily_quiz_runtime'
const REQUIRED_HISTORY = [
  '20261112_daily_rewards',
  '20261113_calendar_kpop_quiz',
  '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema',
  '20261116_daily_quiz_pool',
  '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards',
  '20261120_daily_login_reward_immutable',
]

/* Năm cửa đã revoke — gọi đúng chữ ký, đúng kiểu tham số như client cũ. */
const RETIRED_CALLS = [
  { rpc: 'start_daily_quiz', sql: 'select public.start_daily_quiz($1::uuid, $2::date)', args: (u, d) => [u, d] },
  { rpc: 'submit_daily_quiz_answer', sql: 'select public.submit_daily_quiz_answer($1::uuid, $2::uuid, $3::text, $4::text)', args: (u, d) => [u, randomUUID(), 'q-old', 'a'] },
  { rpc: 'submit_daily_quiz', sql: 'select public.submit_daily_quiz($1::uuid, $2::uuid, $3::int[])', args: (u, d) => [u, randomUUID(), [0, 1, 2, 3, 4]] },
  { rpc: 'my_daily_rewards_status', sql: 'select public.my_daily_rewards_status()', args: () => [] },
  { rpc: 'claim_daily_login', sql: 'select public.claim_daily_login($1::uuid, $2::date)', args: (u, d) => [u, d] },
]

const counts = async pool => (await pool.query(`
  select (select count(*) from public.daily_quiz_questions)::int as questions,
         (select count(*) from public.daily_quiz_config)::int as config,
         (select count(*) from public.daily_quiz_attempts)::int as attempts,
         (select count(*) from public.daily_quiz_answers)::int as answers,
         (select count(*) from public.daily_quiz_seen)::int as seen,
         (select count(*) from public.daily_login_rewards)::int as checkins,
         (select count(*) from public.daily_vote_quota_earnings)::int as earnings`
)).rows[0]

/* Gọi như một client thật: đúng role, đúng JWT claim, trong transaction riêng để
   một cú 42501 không làm hỏng connection của các phép so sánh sau. */
const callAs = async (client, role, userId, entry) => {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    await client.query(entry.sql, entry.args(userId, null))
    return null
  } catch (e) {
    return e
  } finally {
    await client.query('rollback')
  }
}

const readAs = async (client, userId, sql, params = []) => {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    return (await client.query(sql, params)).rows[0]
  } finally {
    await client.query('rollback')
  }
}

test('client cũ gọi 5 RPC đã revoke: bị từ chối bằng 42501 và không ghi gì',
  { skip: !url, timeout: 240_000 }, async () => {
    await withDatabase(url, async (pool, client) => {
      await installLevel(pool, '20261117')
      await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
      await pool.query(migrationSql('20261120_daily_login_reward_immutable'))
      const userId = await seedUser(pool)
      const { d } = await dayOf(pool)
      await ensureHistory(client)
      for (const version of REQUIRED_HISTORY) {
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
          [version, [], `verified fixture state: ${version}`],
        )
      }
      await applyMigration(client, { id: CUTOVER, name: `${CUTOVER}.sql`, sql: migrationSql(CUTOVER) })
      await applyMigration(client, { id: DISABLE, name: `${DISABLE}.sql`, sql: migrationSql(DISABLE) })

      const before = await counts(pool)

      for (const role of ['authenticated', 'anon']) {
        for (const entry of RETIRED_CALLS) {
          const error = await callAs(client, role, userId, entry)
          assert.ok(error, `${role}.${entry.rpc} phải bị từ chối sau khi revoke`)
          assert.equal(error.code, '42501',
            `${role}.${entry.rpc}: phải là lỗi quyền (42501), nhận ${error.code}: ${error.message}`)
          assert.match(error.message, /permission denied for function/i,
            `${role}.${entry.rpc}: thông điệp phải nói rõ quyền bị từ chối`)
          assert.match(error.message, /start_daily_quiz|submit_daily_quiz|my_daily_rewards_status|claim_daily_login/,
            `${role}.${entry.rpc}: lỗi phải nêu đúng hàm bị từ chối`)
        }
      }

      /* Không một dòng nào đổi: revoke là chốt quyền, không phải ghi dữ liệu. */
      assert.deepEqual(await counts(pool), before, 'client bị từ chối thì dữ liệu phải nguyên vẹn')

      /* Cùng database, cùng role: hai API còn sống vẫn chạy. */
      const status = await readAs(client, userId, 'select public.my_daily_login_status() as s')
      assert.equal(status.s.user_id, userId, 'Calendar status phải trả về đúng người dùng')
      const claimed = await readAs(client, userId,
        'select public.claim_daily_login_calendar($1::date) as c', [d])
      assert.equal(claimed.c.status.login.claimed, true, 'điểm danh qua Calendar API vẫn hoạt động')
      const vote = await readAs(client, userId, 'select public.my_vote_status() as v')
      assert.ok(vote.v, 'vote status vẫn trả payload cho authenticated')

      assert.deepEqual(await counts(pool), before, 'Calendar/vote chạy xong vẫn không đụng bảng quiz')
    })
  })
