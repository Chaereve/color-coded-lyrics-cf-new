/* Real PostgreSQL (WASM) verification of catalog v3 — no server, no
 * credentials, no network. Mirrors the voteBack.pglite harness.
 *
 * Applies core + LEVELS + CHAIN + B1 (20261126/27/28) + 20261211 and holds
 * the approved 2026-12 contract:
 *
 *   * 52 ACTIVE milestones across exactly 7 groups — the 20 v2 rows kept,
 *     the 25 retired v1 rows re-activated, 7 new aspirational tiers;
 *   * rewards stay inside the three families (bonus_votes / bonus_requests /
 *     badge): no other columns, no new source;
 *   * the migration is rerunnable and the v2 claim RPC needs NO change —
 *     it walks every active row, so the re-activated badges light up;
 *   * a user who already owns a re-activated badge keeps exactly ONE badge
 *     row (on conflict do nothing) and its vote bonus settles ONCE through
 *     the ledger slices — no badge dup, no slice dup on later claims — and
 *     vote bonuses flow through grant_reward_event while free paid requests
 *     are one-time grants.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
const V3 = '20261211_achievements_v3'

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

const LIVE_POLICY = [['free_vote_grant_enabled', false], ['free_votes_per_day', 3],
  ['global_daily_vote_cap_enabled', false], ['global_daily_vote_cap', 5]]

async function buildV3Database () {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of LEVELS) await db.exec(read(`supabase/migrations/${name}.sql`))
  for (const [key, value] of LIVE_POLICY) {
    await db.query('update public.daily_quiz_config set value = $2::jsonb, updated_at = clock_timestamp() where key = $1',
      [key, JSON.stringify(value)])
  }
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
  await db.exec(read(`supabase/migrations/${V3}.sql`))
  await record(V3)
  return db
}

async function seedUser (db, email = `u${Math.random().toString(16).slice(2)}@t.test`) {
  const { rows } = await db.query(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])
  return rows[0].id
}

async function seedRequest (db, ownerId, { artist = 'A', title = 'T', status = 'queued' } = {}) {
  const { rows } = await db.query(
    `insert into public.requests (user_id, artist, title, status, requester)
     values ($1, $2, $3, $4, 't') returning id`, [ownerId, artist, title, status])
  return rows[0].id
}

async function addVotes (db, requestId, userId, n) {
  await db.query(
    `insert into public.votes (request_id, user_id, used_credit)
     select $1, $2, true from generate_series(1, $3)`,
    [requestId, userId, n])
  await db.query('update public.requests set votes = votes + $2 where id = $1', [requestId, n])
}

const withSession = async (db, userId, run) => {
  const previous = (await db.query("select current_setting('request.jwt.claim.sub', true) as v")).rows[0].v ?? ''
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  try { return await run() } finally {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [previous])
  }
}

const claim = db => db.query('select public.claim_achievements() as result').then(r => r.rows[0].result)

/* Đẩy user cần test ra NGOÀI top 50 bảng xếp hạng để các mốc leaderboard
   không tự sáng: 51 user mồi, mỗi người 4 bài (nhiều hơn 3 bài của user
   test) nên họ xếp trên bất kể số vote. */
async function seedRankFillers (db, exceptUid) {
  await db.query(
    `insert into auth.users (id, email)
     select gen_random_uuid(), 'filler-' || g || '@t.test'
       from generate_series(1, 51) g`, [])
  await db.query(
    `insert into public.requests (user_id, artist, title, status, requester)
     select u.id, 'Filler', 'Filler song ' || u.n || '-' || s.n, 'queued', 't'
       from (select id, row_number() over () as n from auth.users where id <> $1) u
       cross join generate_series(1, 4) s(n)`, [exceptUid])
}
const walletOf = async (db, id) => (await db.query(
  'select bonus_credits, bonus_requests from public.profiles where id = $1', [id])).rows[0]
const catalog = async db => (await db.query(
  `select id, source, threshold, bonus_votes, bonus_requests, badge, active
     from public.achievement_definitions order by id`)).rows

test('the 20261211 catalog lands: 52 active milestones across exactly 7 groups', async () => {
  const db = await buildV3Database()
  try {
    const rows = await catalog(db)
    assert.equal(rows.length, 52, '42 baseline rows + 3 specials (20261128) + 7 new tiers, no dupes')
    assert.equal(rows.filter(r => r.active).length, 52, 'every row active — nothing stays retired')
    const groups = new Set(rows.map(r => r.source))
    assert.deepEqual([...groups].sort(),
      ['completed', 'leaderboard', 'mystery', 'paid', 'pick', 'requests', 'streak', 'vote_back', 'votes'])
    // Nguồn vote-back/mystery là EXISTS 0/1 trong RPC: mốc phải giữ nguyên 1.
    for (const id of ['firstVoteBack', 'firstMystery', 'firstPick']) {
      assert.equal(rows.find(r => r.id === id).threshold, 1, `${id} stays a one-time fact`)
    }
    // Bảy mốc mới — thưởng đúng ba họ đã duyệt.
    const want = [
      ['streak500', 'streak', 500, 75, 0],
      ['request500', 'requests', 500, 40, 0],
      ['votesCast2500', 'votes', 2500, 40, 0],
      ['completion200', 'completed', 200, 30, 0],
      ['paid100', 'paid', 100, 0, 8],
      ['top25', 'leaderboard', 25, 5, 0],
      ['top50', 'leaderboard', 50, 3, 0],
    ]
    for (const [id, source, threshold, bonusVotes, bonusRequests] of want) {
      const row = rows.find(r => r.id === id)
      assert.ok(row, `thiếu mốc mới ${id}`)
      assert.deepEqual([row.source, row.threshold, row.bonus_votes, row.bonus_requests],
        [source, threshold, bonusVotes, bonusRequests], `${id} sai thưởng/mốc`)
    }
    // Hàng v1 tái kích hoạt giữ đúng mốc, thưởng theo bảng v3.
    const revived = [
      ['streak365', 'streak', 365, 50, 0],
      ['request250', 'requests', 250, 25, 0],
      ['votesCast1000', 'votes', 1000, 25, 0],
      ['completion100', 'completed', 100, 0, 3],
      ['paid50', 'paid', 50, 0, 6],
      ['champion', 'leaderboard', 1, 0, 3],
    ]
    for (const [id, source, threshold, bonusVotes, bonusRequests] of revived) {
      const row = rows.find(r => r.id === id)
      assert.ok(row.active, `${id} phải được bật lại`)
      assert.deepEqual([row.source, row.threshold, row.bonus_votes, row.bonus_requests],
        [source, threshold, bonusVotes, bonusRequests], `${id} sai thưởng/mốc`)
    }
    // Hai mươi mốc v2 phải NGUYÊN VẸN — v3 chỉ thêm, không sửa hàng đang sống.
    const kept = [
      ['streak7', 7, 5, 0], ['streak30', 30, 10, 0], ['streak100', 100, 20, 0],
      ['firstRequest', 1, 1, 0], ['request5', 5, 2, 0], ['request10', 10, 3, 0],
      ['request25', 25, 5, 0], ['request50', 50, 10, 0],
      ['votesCast1', 1, 1, 0], ['votesCast10', 10, 2, 0], ['votesCast50', 50, 3, 0],
      ['votesCast100', 100, 5, 0], ['votesCast250', 250, 10, 0],
      ['firstPaidRequest', 1, 0, 1], ['paid3', 3, 0, 2], ['paid5', 5, 0, 3], ['paid10', 10, 0, 4],
      ['firstPick', 1, 2, 0], ['firstVoteBack', 1, 3, 0], ['firstMystery', 1, 5, 0],
    ]
    for (const [id, threshold, bonusVotes, bonusRequests] of kept) {
      const row = rows.find(r => r.id === id)
      assert.deepEqual([row.threshold, row.bonus_votes, row.bonus_requests],
        [threshold, bonusVotes, bonusRequests], `${id} của v2 bị sửa`)
    }
  } finally {
    await db.close()
  }
})

test('the v3 migration is rerunnable: a second run changes nothing', async () => {
  const db = await buildV3Database()
  try {
    const before = await catalog(db)
    await db.exec(read(`supabase/migrations/${V3}.sql`))
    assert.deepEqual(await catalog(db), before, 'chạy lại không được đổi hàng nào')
  } finally {
    await db.close()
  }
})

test('claim_achievements needs NO change: re-activated milestones light up through the ledger', async () => {
  const db = await buildV3Database()
  try {
    const uid = await seedUser(db)
    await seedRankFillers(db, uid)
    // 3 bài riêng biệt (đủ mốc request3) + 25 lượt vote (đủ votesCast25)
    // + 3 ngày liên tiếp (đủ streak3) — ba nguồn v1 được bật lại.
    for (const title of ['One', 'Two', 'Three']) await seedRequest(db, uid, { title })
    const anyRequest = (await db.query('select id from public.requests limit 1')).rows[0].id
    await addVotes(db, anyRequest, uid, 25)
    /* Trigger ghi activity_days của trang có thể đã chạm ngày hôm nay khi
       seed request/vote — on conflict do nothing cho phần còn lại. */
    await db.query(`insert into public.activity_days (user_id, day)
      values ($1, current_date - 2), ($1, current_date - 1), ($1, current_date)
      on conflict (user_id, day) do nothing`, [uid])

    const result = await withSession(db, uid, () => claim(db))
    const earned = result.earned.map(e => e.id)
    for (const id of ['firstRequest', 'request3', 'votesCast1', 'votesCast10', 'votesCast25', 'streak3']) {
      assert.ok(earned.includes(id), `phải nhận ${id} — earned: ${earned.join(', ')}`)
    }
    // Vote bonus đi QUA sổ cái: tổng slice = 1+2 +1+2+3 +1 = 10, đúng ví tiền.
    const wallet = await walletOf(db, uid)
    assert.equal(wallet.bonus_credits, 10, 'bonus vote cộng đúng tổng 6 mốc')
    assert.equal(wallet.bonus_requests, 0, 'không có free paid request ở bộ mốc này')
    const { rows: events } = await db.query(
      `select ref, amount from public.reward_events
        where user_id = $1 and source = 'achievement' order by ref`, [uid])
    assert.equal(events.reduce((s, e) => s + e.amount, 0), 10, 'sổ cái ghi đủ từng slice ach:<id>#1')
    assert.ok(events.every(e => /^ach:[A-Za-z0-9]+#\d+$/.test(e.ref)), `ref đúng họ slice: ${events.map(e => e.ref)}`)

    // Claim lại: KHÔNG phát thưởng hai lần (badge on conflict do nothing).
    const again = await withSession(db, uid, () => claim(db))
    assert.ok(again.earned.every(e => e.newly_granted === false), 'claim lại không cấp mới')
    assert.equal((await walletOf(db, uid)).bonus_credits, 10, 'ví không đổi sau claim lại')
  } finally {
    await db.close()
  }
})

test('an owner of a revived badge keeps exactly one badge row; the vote bonus settles once through the ledger', async () => {
  const db = await buildV3Database()
  try {
    const uid = await seedUser(db)
    await seedRankFillers(db, uid)
    // Người dùng đã sở hữu request3 từ đời v1 (trước khi bị khai tử 20261128):
    // hàng thưởng cũ vẫn còn. Hợp đồng của RPC v2: badge KHÔNG BAO GIỜ cấp
    // lần hai (on conflict do nothing), còn bonus vote được QUYẾT TOÁN QUA SỔ
    // CÁI đúng một lần — badge đời v1 chưa có slice nào nên claim trả đủ mức
    // v3 (+2) bằng slice ach:request3#1, và claim sau không trả thêm.
    await db.query(
      `insert into public.achievement_rewards (user_id, achievement_id, bonus_votes, bonus_requests, badge)
       values ($1, 'request3', 2, 0, 'request3')`, [uid])
    for (const title of ['One', 'Two', 'Three']) await seedRequest(db, uid, { title })

    const result = await withSession(db, uid, () => claim(db))
    const entry = result.earned.find(e => e.id === 'request3')
    assert.ok(entry, 'request3 vẫn hiện trong earned')
    assert.equal(entry.newly_granted, false, 'badge cũ không cấp lại')
    const { rows: badges } = await db.query(
      `select count(*)::int as n from public.achievement_rewards
        where user_id = $1 and achievement_id = 'request3'`, [uid])
    assert.equal(badges[0].n, 1, 'đúng MỘT hàng badge — không trùng')
    const { rows: slices } = await db.query(
      `select ref, amount from public.reward_events
        where user_id = $1 and source = 'achievement' and ref like 'ach:request3#%' order by ref`, [uid])
    assert.deepEqual(slices.map(s => [s.ref, s.amount]), [['ach:request3#1', 2]],
      'bonus vote quyết toán một slice duy nhất')
    assert.equal((await walletOf(db, uid)).bonus_credits, 3,
      'firstRequest (+1) + request3 quyết toán sổ cái (+2)')

    // Claim lại: slice đã đủ mức — không thêm badge, không thêm slice.
    await withSession(db, uid, () => claim(db))
    assert.equal((await walletOf(db, uid)).bonus_credits, 3, 'claim lại không trả thêm')
    const { rows: after } = await db.query(
      `select count(*)::int as n from public.reward_events
        where user_id = $1 and source = 'achievement' and ref like 'ach:request3#%'`, [uid])
    assert.equal(after[0].n, 1, 'vẫn đúng một slice request3')
  } finally {
    await db.close()
  }
})
