/* Real PostgreSQL (WASM) verification of Daily Spin v2 — no server, no
 * credentials, no network. Mirrors the mysteryBox.pglite harness.
 *
 * Applies the full chain (schema.sql core + every migration through B1), then
 * 20261201_spin_v2, and holds the approved 2026-10 product contract:
 *
 *   * seven sectors [1,2,3,5,8,10,20] with weights [30,25,20,12,8,4,1]
 *     (sum = 100) — and the payload ships BOTH tables to the browser;
 *   * the empirical distribution of 300 independent spins matches the approved
 *     weights within wide, deterministic-safe margins (every spin wins);
 *   * the no-repeat law survives the new shape: two identical rewards in the
 *     device's two most recent spins block exactly that reward;
 *   * quotas and replay are untouched: 2/device/day, retry returns the
 *     committed result, fingerprint quota still refused in the database;
 *   * history keeps legacy 16-sector rows, the segment CHECK still admits
 *     0..15 and refuses everything else;
 *   * a mismatched weight table refuses to draw at all (err.spinSetup) and
 *     recovers the moment the approved table is back;
 *   * rerunning the migration changes nothing.
 *
 * PGlite is single-session/serialized, so this proves semantics, not
 * concurrency races (the profile/device-lock serialization is proven by the
 * real-PostgreSQL suite in dailySpin.test.js). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = path => readFileSync(`${ROOT}${path}`, 'utf8')
const schema = read('supabase/schema.sql')
const coreSql = schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:'))
const LEVELS = ['20261112_daily_rewards', '20261113_calendar_kpop_quiz', '20261114_daily_rewards_upgrade',
  '20261115_daily_quiz_schema', '20261116_daily_quiz_pool', '20261117_daily_quiz_flow',
  '20261119_preserve_legacy_daily_login_rewards', '20261120_daily_login_reward_immutable']
const CHAIN = ['20261121_vote_calendar_decoupling', '20261122_disable_daily_quiz_runtime',
  '20261123_reconcile_security_drift', '20261124_restore_daily_free_votes',
  '20261125_reward_eligibility_and_quota_races']
const B1 = ['20261126_reward_ledger', '20261127_login_streak_rewards', '20261128_achievements_v2']
const V2 = '20261201_spin_v2'
const SPIN_V2 = read(`supabase/migrations/${V2}.sql`)

const REWARDS = [1, 2, 3, 5, 8, 10, 20]
const WEIGHTS = [30, 25, 20, 12, 8, 4, 1]

const SCAFFOLD = `
  do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create publication supabase_realtime;`

async function buildSpinDatabase () {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of LEVELS) await db.exec(read(`supabase/migrations/${name}.sql`))
  await db.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (
      version text not null primary key, statements text[], name text);`)
  const record = async version => db.query(
    'insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)',
    [version, [], `${version}.sql`])
  for (const version of LEVELS) await record(version)
  for (const version of [...CHAIN, ...B1]) {
    await db.exec(read(`supabase/migrations/${version}.sql`))
    await record(version)
  }
  await db.exec(SPIN_V2)
  await record(V2)
  return db
}

const withSession = async (db, userId, run) => {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try { return await run() } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

async function seedUser (db, email = 'spin@example.test') {
  const { rows } = await db.query(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])
  return rows[0].id
}

/** A device token for the session user, exactly like the browser gets one. */
const register = (db, userId) => withSession(db, userId, async () =>
  (await db.query('select public.register_daily_spin_device() as v')).rows[0].v)

/** spin_daily with the plain 3-arg call (old clients / retries must work). */
const spin = async (db, userId, token, requestId = randomUUID()) => {
  const row = await withSession(db, userId, async () =>
    (await db.query('select public.spin_daily($1, $2, $3)::text as v', [token, requestId, userId])).rows[0])
  return JSON.parse(row.v)
}

/** A denial probe wrapped in its own transaction: PGlite aborts the whole
 *  session transaction on error, so never probe inside a shared one. */
const denyAs = async (db, userId, probe) => {
  await db.query('begin')
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  try {
    await probe()
    assert.fail('expected the probe to raise')
  } catch (error) {
    return String(error.message)
  } finally {
    await db.query('rollback')
  }
}

const statusOf = async (db, userId, token) => {
  const row = await withSession(db, userId, async () =>
    (await db.query('select public.my_daily_spin_status($1, null)::text as v', [token])).rows[0])
  return JSON.parse(row.v)
}

test('the chain through 20261201_spin_v2 applies cleanly, payload ships weights', async () => {
  const db = await buildSpinDatabase()
  const rows = (await db.query('select public.daily_spin_prizes() as r, public.daily_spin_weights() as w')).rows[0]
  assert.deepEqual([...rows.r], REWARDS)
  assert.deepEqual([...rows.w], WEIGHTS)
  assert.equal(rows.w.reduce((a, b) => a + b, 0), 100)
  const uid = await seedUser(db, 'payload@example.test')
  const token = await register(db, uid)
  const status = await statusOf(db, uid, token)
  assert.deepEqual([...status.rewards], REWARDS)
  assert.deepEqual([...status.weights], WEIGHTS)
})

test('300 spins land on the approved weights — every sector, every spin wins', async () => {
  const db = await buildSpinDatabase()
  const counts = new Map(REWARDS.map(r => [r, 0]))
  const N = 300
  for (let i = 0; i < N; i++) {
    const uid = await seedUser(db, `p${i}@example.test`)
    const token = await register(db, uid)
    const first = await spin(db, uid, token)
    assert.equal(first.spin.reward, first.status.rewards[first.spin.segment])
    assert.ok(first.spin.segment >= 0 && first.spin.segment < 7)
    counts.set(first.spin.reward, counts.get(first.spin.reward) + 1)
  }
  // Wide, deterministic-safe margins: ±4σ around each approved weight over
  // 300 draws (p=0.30 → μ=90, sd≈8, so 77 is −1.6σ — well inside).
  const bounds = [[1, 58, 122], [2, 45, 105], [3, 32, 88], [5, 13, 59], [8, 5, 43], [10, 2, 22], [20, 0, 10]]
  for (const [reward, low, high] of bounds) {
    assert.ok(counts.get(reward) >= low && counts.get(reward) <= high,
      `+${reward} ra ${counts.get(reward)} lần / ${N} — ngoài biên [${low}, ${high}]`)
  }
  assert.equal([...counts.values()].reduce((a, b) => a + b), N)
})

test('the no-repeat law blocks exactly the repeated reward, weights intact', async () => {
  const db = await buildSpinDatabase()
  const yesterday = (await db.query(
    "select to_char(((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1), 'YYYY-MM-DD') as d")).rows[0].d
  /* Chuỗi chỉ tồn tại trên thiết bị ĐÃ ĐĂNG KÝ: hai lượt HÔM QUA cùng một giải
     (created_at yesterday, quota hôm nay còn nguyên) — đúng điều kiện
     `where device_hash = v_hash order by created_at desc limit 2` trong SQL. */
  const seedStreak = async (email, rewards) => {
    const uid = await seedUser(db, email)
    const token = await register(db, uid)
    const { rows } = await db.query('select public.daily_spin_device_hash($1) as v', [token])
    for (const [slot, reward] of rewards.entries()) {
      await db.query(`insert into public.daily_spins
        (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward, created_at)
        values ($1, $2, $3, $4::date, $5, $5, 0, $6, $4::timestamptz + interval '9 hours')`,
        [randomUUID(), uid, rows[0].v, yesterday, slot + 1, reward])
    }
    return { uid, token }
  }

  // Hai lượt gần nhất của thiết bị đều +20: lượt hôm nay không được ra +20.
  const jackpotStreak = await seedStreak('streak20@example.test', [20, 20])
  const first = await spin(db, jackpotStreak.uid, jackpotStreak.token)
  assert.notEqual(first.spin.reward, 20)
  assert.equal(first.replayed, false)

  // Tương tự với +1 — dải lớn nhất cũng bị loại đúng một ô.
  const oneStreak = await seedStreak('streak1@example.test', [1, 1])
  const second = await spin(db, oneStreak.uid, oneStreak.token)
  assert.notEqual(second.spin.reward, 1)

  // Chuỗi bị đình chỉ bởi lượt khác nhau: mọi ô đều hợp lệ lại (không assert
  // phân phối ở đây — chỉ cần lượt chạy qua mà không lỗi).
  const mixedStreak = await seedStreak('mixed@example.test', [5, 8])
  const third = await spin(db, mixedStreak.uid, mixedStreak.token)
  assert.ok(REWARDS.includes(third.spin.reward))
})

test('quotas and replay are untouched by v2', async () => {
  const db = await buildSpinDatabase()
  const uid = await seedUser(db, 'quota@example.test')
  const token = await register(db, uid)
  const first = await spin(db, uid, token)
  const retry = await spin(db, uid, token, first.spin.request_id)
  assert.equal(retry.replayed, true)
  assert.equal(retry.spin.reward, first.spin.reward)
  assert.equal((await statusOf(db, uid, token)).remaining, 1)
  await spin(db, uid, token)
  assert.match(await denyAs(db, uid, () =>
    db.query('select public.spin_daily($1, $2, $3)', [token, randomUUID(), uid])), /err\.spinDeviceLimit/)
  // Fingerprint limits stay enforced inside the database: two spins burn the
  // fingerprint, then a third row for the SAME fingerprint today is refused by
  // the unique index even as a direct insert, and a second account on the same
  // fingerprint is refused by the device→account binding (same order as the
  // real-PostgreSQL suite).
  const fp = 'b'.repeat(64)
  const uid2 = await seedUser(db, 'fp@example.test')
  const token2 = await register(db, uid2)
  await withSession(db, uid2, () =>
    db.query('select public.spin_daily($1, $2, $3, $4)', [token2, randomUUID(), uid2, fp]))
  await withSession(db, uid2, () =>
    db.query('select public.spin_daily($1, $2, $3, $4)', [token2, randomUUID(), uid2, fp]))
  const uid3 = await seedUser(db, 'fp-other@example.test')
  const token3 = await register(db, uid3)
  const { rows: hash3 } = await db.query('select public.daily_spin_device_hash($1) as v', [token3])
  await db.query('begin')
  try {
    await db.query(`insert into public.daily_spins
      (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward, fp_hash, fp_slot)
      values ($1, $2, $3, (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 1, 1, 0, 1, $4, 1)`,
      [randomUUID(), uid3, hash3[0].v, fp])
    assert.fail('third fingerprint slot must be refused')
  } catch (error) {
    assert.match(String(error.message), /daily_spins_fp_quota_idx/)
  } finally {
    await db.query('rollback')
  }
  assert.match(await denyAs(db, uid3, () =>
    db.query('select public.spin_daily($1, $2, $3, $4)', [token3, randomUUID(), uid3, fp])), /err\.spinDeviceAccount/)
})

test('legacy 16-sector rows stay readable; the segment CHECK stays 0..15', async () => {
  const db = await buildSpinDatabase()
  const uid = await seedUser(db, 'legacy@example.test')
  const token = await register(db, uid)
  const { rows } = await db.query('select public.daily_spin_device_hash($1) as v', [token])
  await db.query(`insert into public.daily_spins
    (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward)
    values ($1, $2, $3, (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 1, 1, 9, 2)`,
    [randomUUID(), uid, rows[0].v])
  const status = await statusOf(db, uid, token)
  assert.equal(status.history.length, 1)
  assert.equal(status.history[0].segment, 9, 'hàng 16 ô cũ giữ nguyên ý nghĩa')
  assert.equal(status.remaining, 1, 'hàng cũ vẫn tính vào hạn mức hôm nay')
  await db.query('begin')
  try {
    await db.query(`insert into public.daily_spins
      (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward)
      values ($1, $2, $3, (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date, 2, 2, 16, 1)`,
      [randomUUID(), uid, rows[0].v])
    assert.fail('segment 16 must be refused')
  } catch (error) {
    assert.match(String(error.message), /daily_spins_segment_check/)
  } finally {
    await db.query('rollback')
  }
})

test('a mismatched weight table refuses to draw and recovers when restored', async () => {
  const db = await buildSpinDatabase()
  const uid = await seedUser(db, 'setup@example.test')
  const token = await register(db, uid)
  // Độ dài lệch bảng thưởng → từ chối NGAY (err.spinSetup), không trừ lượt.
  await db.exec('create or replace function public.daily_spin_weights() returns int[] language sql immutable as $$ select array[10, 20, 30] $$')
  try {
    assert.match(await denyAs(db, uid, () =>
      db.query('select public.spin_daily($1, $2, $3)', [token, randomUUID(), uid])), /err\.spinSetup/)
    // Bảng chuẩn được khôi phục thì quay lại chạy bình thường.
    await db.exec('create or replace function public.daily_spin_weights() returns int[] language sql immutable as $$ select array[30, 25, 20, 12, 8, 4, 1] $$')
    assert.equal((await spin(db, uid, token)).replayed, false)
  } finally {
    // Dọn dẹp bằng CHÍNH migration: create or replace trả về bảng đã duyệt.
    await db.exec(SPIN_V2)
  }
})

test('rerunning 20261201_spin_v2 changes nothing', async () => {
  const db = await buildSpinDatabase()
  await db.exec(SPIN_V2)
  await db.exec(SPIN_V2)
  const uid = await seedUser(db, 'rerun@example.test')
  const token = await register(db, uid)
  const result = await spin(db, uid, token)
  assert.equal(result.replayed, false)
  assert.ok(REWARDS.includes(result.spin.reward))
})
