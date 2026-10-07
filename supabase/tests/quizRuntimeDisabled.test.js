/* Optional REAL PostgreSQL tests for 20261122_disable_daily_quiz_runtime.
   Every scenario runs in a disposable database created and dropped by the
   shared harness; never point MIGRATION_DEPLOY_TEST_DATABASE_URL at staging or
   production.

   What is proven here:
     * the quiz entry points really are closed for every client role, while the
       Calendar and vote APIs keep their grants;
     * NOTHING moved: quiz questions/attempts/answers/seen and recorded
       check-ins have identical row counts after the revoke, and the migration
       contains no DROP/DELETE/TRUNCATE/UPDATE at all;
     * the Calendar still works with the quiz door shut;
     * the corrective rollback restores exactly the previous ACLs and both files
       are safe to run twice. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  withDatabase, installLevel, migrationSql, seedUser, insertHistorical, dayOf, rewardOf,
} from './_fixtures.mjs'
import {
  applyMigration, ensureHistory, readHistory, stripExplicitTransaction,
} from '../../tools/migrate.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const MIGRATION_ID = '20261122_disable_daily_quiz_runtime'
const MIGRATION = {
  id: MIGRATION_ID,
  name: `${MIGRATION_ID}.sql`,
  sql: migrationSql(MIGRATION_ID),
}
const ROLLBACK = readFileSync(new URL('../rollback/20261122_disable_daily_quiz_runtime.sql', import.meta.url), 'utf8')
const CUTOVER = '20261121_vote_calendar_decoupling'
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
const LEGACY_SINGLE_SHOT = 'public.submit_daily_quiz(uuid,uuid,int[])'
const CLIENT_QUIZ_RPC = [
  'public.start_daily_quiz(uuid,date)',
  'public.submit_daily_quiz_answer(uuid,uuid,text,text)',
  LEGACY_SINGLE_SHOT,
  'public.my_daily_rewards_status()',
  'public.claim_daily_login(uuid,date)',
]
/* Bốn cửa này client gọi được ngay trước 20261122; cửa thứ năm đã bị 20261117
   đóng khi luồng trả lời từng câu thay thế bản nộp một lần. */
const OPEN_BEFORE = CLIENT_QUIZ_RPC.filter(name => name !== LEGACY_SINGLE_SHOT)
const LIVE_RPC = [
  'public.my_daily_login_status()',
  'public.claim_daily_login_calendar(date)',
  'public.my_daily_checkin_month(date)',
  'public.my_vote_status()',
  'public.cast_vote(uuid,integer,text,text,text)',
]
const QUIZ_TABLES = ['daily_quiz_questions', 'daily_quiz_config', 'daily_quiz_attempts',
  'daily_quiz_answers', 'daily_quiz_seen']

const counts = async pool => (await pool.query(`
  select ${QUIZ_TABLES.map(t => `(select count(*) from public.${t})::int as ${t}`).join(',\n         ')},
         (select count(*) from public.daily_login_rewards)::int as checkins,
         (select count(*) from public.daily_login_rewards where reward <> 0)::int as paid_checkins`
)).rows[0]

const acl = async (pool, signatures) => (await pool.query(`
  select ${signatures.map((s, i) => `has_function_privilege('authenticated', '${s}', 'EXECUTE') as auth_${i},
         has_function_privilege('anon', '${s}', 'EXECUTE') as anon_${i}`).join(',\n         ')}`
)).rows[0]

/* Installs the 20261121 cutover state (the only state from which 20261122 may
   run) with the quiz rows and one legacy paid check-in already in place. */
async function withCutover (fn) {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, '20261117')
    await pool.query(migrationSql('20261119_preserve_legacy_daily_login_rewards'))
    await pool.query(migrationSql('20261120_daily_login_reward_immutable'))
    const { d: day, y: previousDay } = await dayOf(pool)
    const userId = await seedUser(pool)
    /* Một check-in lịch sử dưới chính sách +2 đã nghỉ: dữ liệu phải giữ nguyên
       vĩnh viễn (đó là lý do 20261119/20261120 tồn tại). */
    await insertHistorical(pool, userId, previousDay, 2)
    const attemptId = randomUUID()
    const questions = Array.from({ length: 5 }, (_, i) => ({
      id: `q-keep-${i}`, option_ids: ['a', 'b'], correct_option_id: 'a', explanation: 'kept',
    }))
    await pool.query(`insert into public.daily_quiz_attempts
      (id, user_id, quiz_day, questions, quiz_date, question_count, max_votes, votes_awarded)
      values ($1, $2, $3, $4::jsonb, $3, 5, 5, 1)`, [attemptId, userId, previousDay, JSON.stringify(questions)])
    await pool.query(`insert into public.daily_quiz_answers
      (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded, answered_at)
      values ($1, $2, 'q-keep', $3, 'a', true, 1, now())`, [userId, previousDay, attemptId])
    await ensureHistory(client)
    /* History đúng bằng trạng thái TRƯỚC cutover: 20261121 chưa được ghi, nên
       preflight của chính nó chấp nhận chạy. */
    for (const version of REQUIRED_HISTORY) {
      await client.query(
        'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
        [version, [], `verified fixture state: ${version}`],
      )
    }
    await applyMigration(client, {
      id: CUTOVER,
      name: `${CUTOVER}.sql`,
      sql: migrationSql(CUTOVER),
    })
    return fn(pool, client, { userId, day, previousDay })
  })
}

test('the migration file itself never removes or rewrites quiz data', () => {
  /* Chỉ soi CÂU LỆNH: comment mô tả "không DROP/DELETE/TRUNCATE" không được
     tính là một lệnh xoá dữ liệu. */
  const statements = MIGRATION.sql.replace(/--[^\n]*/g, ' ')
  for (const forbidden of [/\bdrop\s+table\b/i, /\bdelete\s+from\b/i, /\btruncate\b/i,
    /\bupdate\s+public\.daily_quiz_/i, /\bupdate\s+public\.daily_login_rewards\b/i,
    /\bdrop\s+function\b/i]) {
    assert.doesNotMatch(statements, forbidden, `20261122 không được chứa ${forbidden}`)
  }
  assert.match(MIGRATION.sql, /^begin;/m)
  assert.match(MIGRATION.sql, /^commit;/m)
  for (const signature of CLIENT_QUIZ_RPC) {
    assert.ok(MIGRATION.sql.includes(`'${signature}'`), `thiếu lệnh revoke cho ${signature}`)
    assert.ok(ROLLBACK.includes(`'${signature}'`), `thiếu lệnh grant lại cho ${signature}`)
  }
  // Not a single CREATE: the fresh-install bundle and its baseline stay untouched.
  assert.doesNotMatch(statements, /create\s+(or\s+replace\s+)?(table|function|index|view|policy)/i)
})

test('revoking the quiz door keeps every row, the Calendar and the vote API intact',
  { skip: !url, timeout: 240_000 }, async () => {
    await withCutover(async (pool, client, { userId, previousDay }) => {
      const before = await counts(pool)
      assert.ok(before.daily_quiz_attempts >= 1 && before.daily_quiz_answers >= 1)
      assert.equal(before.paid_checkins, 1, 'legacy paid check-in là dữ liệu lịch sử phải giữ')

      const aclBefore = await acl(pool, CLIENT_QUIZ_RPC)
      for (let i = 0; i < CLIENT_QUIZ_RPC.length; i += 1) {
        const expected = OPEN_BEFORE.includes(CLIENT_QUIZ_RPC[i])
        assert.equal(aclBefore[`auth_${i}`], expected,
          `${CLIENT_QUIZ_RPC[i]}: trước 20261122 ${expected ? 'phải mở' : 'đã đóng từ 20261117'}`)
        assert.equal(aclBefore[`anon_${i}`], false, 'anon chưa bao giờ gọi được quiz')
      }

      await applyMigration(client, MIGRATION)
      assert.deepEqual(await readHistory(client), [...REQUIRED_HISTORY, CUTOVER, MIGRATION_ID].sort(),
        'thân migration và dòng history commit cùng nhau')

      const aclAfter = await acl(pool, CLIENT_QUIZ_RPC)
      for (let i = 0; i < CLIENT_QUIZ_RPC.length; i += 1) {
        assert.equal(aclAfter[`auth_${i}`], false, `${CLIENT_QUIZ_RPC[i]} phải bị đóng với authenticated`)
        assert.equal(aclAfter[`anon_${i}`], false)
      }
      const live = await acl(pool, LIVE_RPC)
      for (let i = 0; i < LIVE_RPC.length; i += 1) {
        assert.equal(live[`auth_${i}`], true, `${LIVE_RPC[i]} phải giữ grant cho authenticated`)
        assert.equal(live[`anon_${i}`], false)
      }

      assert.deepEqual(await counts(pool), before, 'revoke không được đổi một dòng dữ liệu nào')
      for (const table of QUIZ_TABLES) {
        assert.notEqual((await pool.query(`select to_regclass('public.${table}') as oid`)).rows[0].oid, null,
          `${table} phải còn nguyên`)
      }

      // Calendar vẫn chạy khi cửa quiz đã đóng, và đúng chủ sở hữu.
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
      const status = JSON.parse((await client.query('select public.my_daily_login_status()::text as s')).rows[0].s)
      assert.equal(status.user_id, userId)
      assert.equal(status.timezone, 'Asia/Ho_Chi_Minh')
      assert.equal(status.login.total_days, 1)
      assert.equal(status.login.first_day, previousDay)
      assert.equal('quiz' in status, false, 'Calendar không được trả field quiz')
      const claimed = JSON.parse((await client.query(
        'select public.claim_daily_login_calendar($1)::text as r', [status.day])).rows[0].r)
      assert.equal(claimed.replayed, false)
      assert.equal(claimed.status.login.claimed, true)
      /* Hỏi ĐÚNG NGÀY VỪA ĐIỂM DANH, không hỏi `current_date`.
         `reward_day` là NGÀY VN (mọi đường check-in của app đều tính theo
         Asia/Ho_Chi_Minh), còn `current_date` của database là NGÀY UTC. Trong
         khung 17:00–24:00 UTC (00:00–07:00 giờ VN) hai ngày lệch nhau đúng một
         ngày, nên câu query cũ bốc trúng dòng lịch sử +2 mà fixture vừa seed cho
         `previousDay` (= hôm qua theo giờ VN = hôm nay theo UTC) và phép kiểm đỏ
         "2 !== 0" dù code sản phẩm đúng. Nghĩa là `guard` đỏ theo GIỜ TRONG NGÀY:
         xanh khi chạy trước 17:00 UTC, đỏ sau đó — chạy lại cùng một commit hai
         lần ra hai kết quả. `rewardOf` là helper sẵn có trong _fixtures.mjs, hỏi
         theo (user_id, reward_day) nên không còn chỗ nào để lệch múi giờ. */
      assert.equal(await rewardOf(pool, userId, status.day), 0,
        'check-in mới vẫn ghi 0, không thưởng vote')
      assert.deepEqual(await counts(pool), { ...before, checkins: before.checkins + 1 },
        'chỉ thêm đúng một dòng check-in hôm nay')
    })
  })

test('the corrective rollback restores exactly the previous ACLs and keeps the data',
  { skip: !url, timeout: 240_000 }, async () => {
    await withCutover(async (pool, client) => {
      const before = await counts(pool)
      const aclBefore = await acl(pool, CLIENT_QUIZ_RPC)
      await applyMigration(client, MIGRATION)
      const disabled = await acl(pool, CLIENT_QUIZ_RPC)

      await client.query(stripExplicitTransaction(ROLLBACK))
      const restored = await acl(pool, CLIENT_QUIZ_RPC)
      for (let i = 0; i < CLIENT_QUIZ_RPC.length; i += 1) {
        const expected = OPEN_BEFORE.includes(CLIENT_QUIZ_RPC[i])
        assert.equal(restored[`auth_${i}`], expected,
          `${CLIENT_QUIZ_RPC[i]}: rollback trả lại đúng trạng thái trước đó (${expected ? 'mở' : 'vẫn đóng'})`)
        assert.equal(restored[`anon_${i}`], false, `anon không bao giờ được mở ${CLIENT_QUIZ_RPC[i]}`)
      }
      assert.deepEqual(restored, aclBefore, 'rollback phải trả ACL về đúng trạng thái trước khi tắt')
      assert.notDeepEqual(restored, disabled)
      assert.deepEqual(await counts(pool), before, 'rollback chỉ đổi ACL, không đổi dữ liệu')

      /* Một khi quyền đã được trả lại, rollback phải TỪ CHỐI chạy tiếp thay vì
         âm thầm grant lại trên một trạng thái hỗn hợp — đây là hành vi cố ý,
         giống corrective rollback của 20261121. */
      /* Chạy y như guarded runner: bỏ `begin;`/`commit;` của tệp để harness tự
         quản transaction — nếu chạy nguyên văn, cú raise của preflight sẽ để lại
         một transaction đang abort trên connection này. */
      await assert.rejects(() => client.query(stripExplicitTransaction(ROLLBACK)), /err\.featureRetiredRollback/,
        'rollback phải fail-closed khi disable không còn là trạng thái sống')

      /* Còn migration thì chạy lại được: thân SQL (không kèm dòng history đã ghi)
         revoke lần hai vẫn đóng đủ năm cửa và không đổi dữ liệu. */
      await client.query(stripExplicitTransaction(MIGRATION.sql))
      const disabledAgain = await acl(pool, CLIENT_QUIZ_RPC)
      for (let i = 0; i < CLIENT_QUIZ_RPC.length; i += 1) {
        assert.equal(disabledAgain[`auth_${i}`], false, 'revoke lần hai phải vẫn đóng')
      }
      assert.deepEqual(await counts(pool), before)
    })
  })

test('missing cutover state aborts before touching a single ACL', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, '20261117')
    await ensureHistory(client)
    for (const version of REQUIRED_HISTORY) {
      await client.query('insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
        [version, [], `fixture: ${version}`])
    }
    const aclBefore = await acl(pool, CLIENT_QUIZ_RPC)
    await assert.rejects(() => applyMigration(client, MIGRATION), /err\.featureRetiredPreflight/)
    assert.deepEqual(await acl(pool, CLIENT_QUIZ_RPC), aclBefore, 'preflight hỏng thì không được revoke gì')
    assert.deepEqual(await readHistory(client), [...REQUIRED_HISTORY].sort(),
      'không được ghi history khi migration abort')
  })
})
