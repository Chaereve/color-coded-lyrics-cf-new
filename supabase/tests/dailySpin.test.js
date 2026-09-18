/* Optional REAL Postgres integration tests. No production data is touched:
   the supplied connection must be a local/test superuser with CREATEDB; we create
   a uniquely named disposable database and drop only that database afterwards.
   DAILY_SPIN_TEST_DATABASE_URL=postgres://... npm run test:spin:db
   Normal `npm test` skips this suite when no test connection is provided. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.DAILY_SPIN_TEST_DATABASE_URL
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../migrations/20260907_daily_spin.sql', import.meta.url), 'utf8')
// Prize table v2: 16 equal sectors. It must run AFTER the base migration, and
// re-running the base one alone would fall back to the old 8-sector odds.
const prizesV2 = readFileSync(new URL('../migrations/20260908_daily_spin_prizes.sql', import.meta.url), 'utf8')
// Edge audit columns + 5-arg spin_daily (fp/ip hashes from the Worker shield).
const edgeV3 = readFileSync(new URL('../migrations/20260909_daily_spin_edge.sql', import.meta.url), 'utf8')
// Bonus split + purchased/bonus payload keys: the final state the wheel runs on.
const bonusReset = readFileSync(new URL('../migrations/20261031_bonus_reset.sql', import.meta.url), 'utf8')
const voteStatusSplit = readFileSync(new URL('../migrations/20261101_vote_status_split.sql', import.meta.url), 'utf8')
// Fingerprint/IP quota enforced IN Postgres (source of truth), not just the Edge.
const fpQuotaV4 = readFileSync(new URL('../migrations/20261102_spin_fp_quota.sql', import.meta.url), 'utf8')

test('Daily Spin — real PostgreSQL transactions and permissions', { skip: !url, timeout: 90_000 }, async t => {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const name = `ccl_spin_test_${randomUUID().replaceAll('-', '')}`
  let pool
  const closed = []
  try {
    await admin.query(`create database ${name}`)
    const target = new URL(url)
    target.pathname = `/${name}`
    pool = new pg.Pool({ connectionString: target.toString(), max: 20 })
    pool.on('connect', client => closed.push(new Promise(resolve => client.once('end', resolve))))
    await pool.query(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated;
      -- Reproduce Supabase's permissive table defaults to actually test revokes.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;
      create publication supabase_realtime;
    `)
    // Test upgrading an existing app, not just a standalone toy spin schema.
    await pool.query(schema.split('-- BEGIN DAILY SPIN:')[0])
    await pool.query(`
      grant update on public.profiles to authenticated;
      create policy "update own profile" on public.profiles for update to authenticated
        using (id = auth.uid()) with check (id = auth.uid());
    `)
    await pool.query(migration)
    await pool.query(prizesV2)
    await pool.query(edgeV3)
    await pool.query(bonusReset)
    await pool.query(voteStatusSplit)
    await pool.query(fpQuotaV4)

    const newUser = async (credits = 0) => {
      const id = randomUUID()
      await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.test`])
      if (credits) await pool.query('update public.profiles set vote_credits = $2 where id = $1', [id, credits])
      return id
    }
    const as = async (uid, sql, params = [], role = 'authenticated') => {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(`set local role ${role}`)
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || ''])
        const result = await client.query(sql, params)
        await client.query('commit')
        return result.rows
      } catch (e) {
        await client.query('rollback')
        throw e
      } finally { client.release() }
    }
    const register = async uid => (await as(uid, 'select public.register_daily_spin_device() as v'))[0].v
    const status = async (uid, token) => (await as(uid, 'select public.my_daily_spin_status($1) as v', [token]))[0].v
    const spin = async (uid, token, id = randomUUID(), expected = uid) =>
      (await as(uid, 'select public.spin_daily($1, $2, $3) as v', [token, id, expected]))[0].v
    // Tong so du = vote da mua + bonus tu vong quay (tach cot tu migration
    // 20261031): cac phep doi chieu balance chi quan tam den tong.
    const balance = async uid => {
      const r = (await pool.query('select vote_credits + bonus_credits as total from public.profiles where id = $1', [uid])).rows[0]
      return r.total
    }
    const hashOf = async token => (await pool.query('select public.daily_spin_device_hash($1) as v', [token])).rows[0].v
    const countFor = async uid => +(await pool.query('select count(*) from public.daily_spins where user_id = $1', [uid])).rows[0].count

    await t.test('authenticated, server-issued tokens; no chosen reward or recipient', async () => {
      const a = await newUser(), b = await newUser()
      const token = await register(a)
      assert.match(token, /^[a-f0-9]{64}$/)
      assert.notEqual(await hashOf(token), token)
      await assert.rejects(register(null), /err.signin/)
      await assert.rejects(status(null, token), /err.signin/)
      await assert.rejects(spin(null, token), /err.signin/)
      await assert.rejects(status(a, null), /err.spinDevice/)
      await assert.rejects(spin(a, 'a'.repeat(64)), /err.spinDevice/)
      await assert.rejects(spin(a, token, null), /err.spinRequest/)
      await assert.rejects(spin(a, token, randomUUID(), b), /err.spinAccountChanged/)
      await assert.rejects(as(a, 'select public.spin_daily($1, $2, $3, p_reward := 999)', [token, randomUUID(), a]), { code: '42883' })
      assert.equal(await countFor(a), 0)
      assert.equal(await balance(b), 0)
    })

    await t.test('2 spins, exact bonus added, third rejected; SQL migrations preserve existing data', async () => {
      const uid = await newUser(10), token = await register(uid)
      const first = await spin(uid, token), second = await spin(uid, token)
      for (const result of [first, second]) {
        assert.equal(result.spin.reward, result.status.rewards[result.spin.segment])
        assert.equal(result.replayed, false)
      }
      assert.equal(second.status.credits, 10 + first.spin.reward + second.spin.reward)
      // payload tra rieng: 10 vote da mua, phan thuong nam het o bonus
      assert.equal(second.status.purchased, 10)
      assert.equal(second.status.bonus, first.spin.reward + second.spin.reward)
      assert.equal(second.status.purchased + second.status.bonus, second.status.credits)
      assert.equal(second.status.remaining, 0)
      assert.equal(second.status.history.length, 2)
      await assert.rejects(spin(uid, token), /err.spinDeviceLimit/)
      await pool.query(migration)
      await pool.query(prizesV2) // order matters: base file first, prizes after
      await pool.query(edgeV3)
      await pool.query(schema) // fresh-install file is also safe to rerun
      assert.equal(await countFor(uid), 2)
      assert.equal(await balance(uid), second.status.credits)
      assert.equal((await status(uid, token)).remaining, 0)
    })

    await t.test('16 equal sectors: odds match the wheel the browser draws', async () => {
      const { SPIN_REWARDS, rewardOdds, spinAverage } = await import('../../src/lib/dailySpin.js')
      const rows = (await pool.query('select public.daily_spin_prizes() as v')).rows[0].v
      assert.deepEqual(rows, [...SPIN_REWARDS])
      assert.equal(rows.length, 16)
      assert.equal(256 % rows.length, 0, 'one random byte must stay unbiased')
      assert.deepEqual(rewardOdds(rows).map(p => [p.reward, p.chance]),
        [[1, 56.25], [2, 25], [3, 12.5], [5, 6.25]])
      assert.equal(spinAverage(rows), 1.75)
      // The ledger accepts the widened sector range, and only that range.
      const uid = await newUser(), token = await register(uid)
      const hash = await hashOf(token)
      const put = segment => pool.query(`insert into public.daily_spins
        (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward)
        values ($1, $2, $3, current_date, 1, 1, $4, 1)`, [randomUUID(), uid, hash, segment])
      await put(15)
      await assert.rejects(put(16), /daily_spins_segment_check/)
      await assert.rejects(put(-1), /daily_spins_segment_check/)
      // Every real draw lands inside the array and pays exactly what it shows.
      const seen = new Set()
      for (let i = 0; i < 40; i++) {
        const player = await newUser()
        const device = await register(player)
        const result = await spin(player, device)
        assert.ok(result.spin.segment >= 0 && result.spin.segment < 16)
        assert.equal(result.spin.reward, rows[result.spin.segment])
        assert.equal(await balance(player), result.spin.reward)
        seen.add(result.spin.reward)
      }
      assert.ok(seen.size >= 2, '40 draws should not all land on one prize')
    })

    await t.test('fingerprint/IP hashes are validated and stored; garbage normalised to NULL', async () => {
      const uid = await newUser(), token = await register(uid)
      const good = 'a'.repeat(64), ipHash = 'b'.repeat(64)
      const first = await as(uid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
        [token, randomUUID(), uid, good, ipHash])
      const row = (await pool.query('select fp_hash, ip_hash, reward, segment from public.daily_spins where request_id = $1',
        [first[0].v.spin.request_id])).rows[0]
      assert.equal(row.fp_hash, good)
      assert.equal(row.ip_hash, ipHash)
      assert.equal(row.reward, first[0].v.status.rewards[first[0].v.spin.segment])
      // Garbage from a direct caller becomes NULL instead of failing the spin,
      // and a plain 3-arg call (old clients, retries) still works via defaults.
      const second = await spin(uid, token)
      const plain = (await pool.query('select fp_hash, ip_hash from public.daily_spins where request_id = $1',
        [second.spin.request_id])).rows[0]
      assert.equal(plain.fp_hash, null)
      assert.equal(plain.ip_hash, null)
      const thirdUid = await newUser(), thirdToken = await register(thirdUid)
      const third = await as(thirdUid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
        [thirdToken, randomUUID(), thirdUid, 'not-a-hash', 'zz'])
      assert.equal(third[0].v.spin.reward, third[0].v.status.rewards[third[0].v.spin.segment])
      const stored = (await pool.query('select fp_hash, ip_hash from public.daily_spins where request_id = $1',
        [third[0].v.spin.request_id])).rows[0]
      assert.deepEqual([stored.fp_hash, stored.ip_hash], [null, null])
    })

    await t.test('one fingerprint gets two spins a day across accounts, tokens and devices', async () => {
      const fpHash = 'c'.repeat(64)
      // Ba tài khoản khác nhau, ba device token khác nhau, CÙNG một vân tay.
      const players = []
      for (let i = 0; i < 3; i++) {
        const uid = await newUser()
        players.push({ uid, token: await register(uid) })
      }
      const spinFp = (p, id = randomUUID()) => as(p.uid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
        [p.token, id, p.uid, fpHash, null])
      await spinFp(players[0])
      await spinFp(players[1])
      // Vân tay đã hết 2 lượt: tài khoản + token hoàn toàn mới vẫn bị chặn NGAY
      // TRONG DB — không cần Worker, không cần KV.
      await assert.rejects(spinFp(players[2]), /err.spinEdgeFp/)
      assert.equal(await balance(players[2]), 0)
      const slots = await pool.query('select fp_slot from public.daily_spins where fp_hash = $1 order by fp_slot', [fpHash])
      assert.deepEqual(slots.rows.map(r => r.fp_slot), [1, 2])
      // Ràng buộc cứng: không thể ghi đè slot đã dùng dù insert thẳng vào bảng —
      // đây là chốt chống đua tài khoản ngay cả khi khoá advisory bị lách.
      // (device_slot/account_slot = 2 để không vướng các ràng buộc kia, chỉ đụng
      // đúng unique index của fingerprint.)
      await assert.rejects(
        pool.query(`insert into public.daily_spins
          (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward, fp_hash, fp_slot)
          values ($1, $2, $3, current_date, 2, 2, 0, 1, $4, 1)`,
          [randomUUID(), players[0].uid, await hashOf(players[0].token), fpHash]),
        /daily_spins_fp_quota_idx/)

      // Đua tài khoản song song: 8 tài khoản + device token KHÁC nhau nhưng CÙNG
      // một vân tay, quay một lúc. Khoá advisory xếp hàng để "đếm → chọn slot"
      // không đua nhau; đúng 2 lượt thành công, 6 lượt còn lại bị chặn gọn bằng
      // err.spinEdgeFp (không rò rỉ lỗi unique thô ra client).
      const racingFp = 'e'.repeat(64)
      const racers = await Promise.all(Array.from({ length: 8 }, async () => {
        const uid = await newUser()
        return { uid, token: await register(uid) }
      }))
      const race = await Promise.allSettled(racers.map(p =>
        as(p.uid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
          [p.token, randomUUID(), p.uid, racingFp, null])))
      const wins = race.filter(r => r.status === 'fulfilled')
      assert.equal(wins.length, 2)
      for (const r of race.filter(r => r.status === 'rejected')) {
        assert.match(r.reason.message, /err\.spinEdgeFp/)
      }
      const racedSlots = await pool.query('select fp_slot from public.daily_spins where fp_hash = $1 order by fp_slot', [racingFp])
      assert.deepEqual(racedSlots.rows.map(r => r.fp_slot), [1, 2])
    })

    await t.test('an IP that already saw 5 distinct fingerprints refuses a 6th', async () => {
      const ipHash = 'd'.repeat(64)
      const fpFor = n => String(n).padStart(64, '0')
      const seen = []
      for (let i = 1; i <= 5; i++) {
        const uid = await newUser()
        const token = await register(uid)
        seen.push({ uid, token, fp: fpFor(i) })
        await as(uid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
          [token, randomUUID(), uid, fpFor(i), ipHash])
      }
      // Vân tay thứ 6 trên cùng IP → dấu hiệu anti-detect browser → chặn.
      const sixthUid = await newUser(), sixthToken = await register(sixthUid)
      await assert.rejects(
        as(sixthUid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
          [sixthToken, randomUUID(), sixthUid, fpFor(6), ipHash]),
        /err.spinEdgeIp/)
      // Vân tay đã biết vẫn giữ 2 lượt riêng của nó (đếm vân tay KHÁC nhau, không
      // khoá cụm cả IP như KV — người thật chung Wi-Fi không bị vạ lây).
      const again = await as(seen[0].uid, 'select public.spin_daily($1, $2, $3, $4, $5) as v',
        [seen[0].token, randomUUID(), seen[0].uid, seen[0].fp, ipHash])
      assert.equal(again[0].v.replayed, false)
    })

    await t.test('switching accounts shares the quota, not the reward history or credits', async () => {
      const a = await newUser(), b = await newUser(), c = await newUser()
      const token = await register(a)
      const first = await spin(a, token)
      assert.equal((await status(b, token)).remaining, 1)
      const second = await spin(b, token)
      assert.equal(second.status.device_used, 2)
      assert.equal(second.status.account_used, 1)
      assert.equal(second.status.remaining, 0)
      assert.equal(second.status.history.length, 1)
      assert.equal(second.status.history[0].request_id, second.spin.request_id)
      assert.equal(await balance(a), first.spin.reward)
      assert.equal(await balance(b), second.spin.reward)
      assert.equal((await status(c, token)).history.length, 0)
      await assert.rejects(spin(c, token), /err.spinDeviceLimit/)
    })

    await t.test('account quota survives switching devices or losing the browser token', async () => {
      const uid = await newUser()
      const devices = await Promise.all([register(uid), register(uid), register(uid)])
      await spin(uid, devices[0]); await spin(uid, devices[1])
      const next = await status(uid, devices[2])
      assert.equal(next.device_used, 0)
      assert.equal(next.account_used, 2)
      assert.equal(next.remaining, 0)
      await assert.rejects(spin(uid, devices[2]), /err.spinAccountLimit/)
    })

    await t.test('parallel spins by different accounts on ONE device award exactly twice', async () => {
      const users = await Promise.all(Array.from({ length: 8 }, () => newUser()))
      const token = await register(users[0])
      const results = await Promise.allSettled(users.map(uid => spin(uid, token)))
      const wins = results.filter(r => r.status === 'fulfilled')
      assert.equal(wins.length, 2)
      for (const r of results.filter(r => r.status === 'rejected')) assert.match(r.reason.message, /err.spinDeviceLimit/)
      const credits = await Promise.all(users.map(balance))
      assert.equal(credits.reduce((a, b) => a + b), wins.reduce((sum, r) => sum + r.value.spin.reward, 0))
    })

    await t.test('parallel spins by ONE account on different devices award exactly twice', async () => {
      const uid = await newUser()
      const tokens = await Promise.all([register(uid), register(uid), register(uid)])
      const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => spin(uid, tokens[i % 3])))
      const wins = results.filter(r => r.status === 'fulfilled')
      assert.equal(wins.length, 2)
      for (const r of results.filter(r => r.status === 'rejected')) assert.match(r.reason.message, /err.spin(Device|Account)Limit/)
      assert.equal(await countFor(uid), 2)
      assert.equal(await balance(uid), wins.reduce((sum, r) => sum + r.value.spin.reward, 0))
    })

    await t.test('concurrent retries of one request, exhaustion, and next-day retries are idempotent', async () => {
      const uid = await newUser(), token = await register(uid), request = randomUUID()
      const results = await Promise.all(Array.from({ length: 12 }, () => spin(uid, token, request)))
      assert.equal(results.filter(r => !r.replayed).length, 1)
      assert.equal(new Set(results.map(r => r.spin.reward)).size, 1)
      assert.equal(await countFor(uid), 1)
      assert.equal(await balance(uid), results[0].spin.reward)
      const second = await spin(uid, token)
      assert.equal((await spin(uid, token, request)).replayed, true)
      // Move only our fixtures back one day to simulate retry after midnight.
      await pool.query("update public.daily_spins set spin_day = spin_day - 1, created_at = created_at - interval '1 day' where user_id = $1", [uid])
      const retried = await spin(uid, token, request)
      assert.equal(retried.replayed, true)
      assert.equal(retried.status.remaining, 2)
      assert.notEqual(retried.spin.day, retried.status.day)
      assert.equal(await balance(uid), results[0].spin.reward + second.spin.reward)
      const other = await register(uid)
      await assert.rejects(spin(uid, other, request), /err.spinRequest/)
    })

    await t.test('credit failure rolls back both reward and quota; same request can safely retry', async () => {
      const uid = await newUser(), token = await register(uid), request = randomUUID()
      await pool.query(`
        create function public.test_fail_credit() returns trigger language plpgsql as $$
        begin raise exception 'test credit failure'; end $$;
        -- vong quay cong vao bonus_credits (xem 20261031_bonus_reset), nen
        -- trigger that bai gan tren cot do.
        create trigger test_credit_failure before update of bonus_credits on public.profiles
          for each row execute function public.test_fail_credit();
      `)
      try {
        await assert.rejects(spin(uid, token, request), /test credit failure/)
        assert.equal(await countFor(uid), 0)
        assert.equal(await balance(uid), 0)
        assert.equal((await status(uid, token)).remaining, 2)
      } finally {
        await pool.query('drop trigger test_credit_failure on public.profiles; drop function public.test_fail_credit()')
      }
      assert.equal((await spin(uid, token, request)).replayed, false)
      assert.equal(await countFor(uid), 1)
    })

    await t.test('server clock resets at 17:00 UTC, preserves balance, no rollover', async () => {
      const uid = await newUser(9), token = await register(uid), hash = await hashOf(token)
      await pool.query(`insert into public.daily_spins
        (request_id, user_id, device_hash, spin_day, device_slot, account_slot, segment, reward)
        values ($1, $3, $4, '2026-12-31', 1, 1, 0, 1), ($2, $3, $4, '2026-12-31', 2, 2, 0, 1)`,
      [randomUUID(), randomUUID(), uid, hash])
      const at = async when => (await pool.query('select public.daily_spin_payload($1, $2, $3) as v', [hash, uid, when])).rows[0].v
      const before = await at('2026-12-31T16:59:59.999Z')
      assert.equal(before.day, '2026-12-31')
      assert.equal(before.remaining, 0)
      assert.equal(new Date(before.reset_at).toISOString(), '2026-12-31T17:00:00.000Z')
      const after = await at('2026-12-31T17:00:00Z')
      assert.equal(after.day, '2027-01-01')
      assert.equal(after.remaining, 2)
      assert.equal(after.credits, 9)
      assert.equal(after.history.length, 0)
      assert.equal((await at('2027-01-10T17:00:00Z')).remaining, 2)
    })

    await t.test('deleting an account does not restore that device’s daily spins', async () => {
      const uid = await newUser(), token = await register(uid)
      await spin(uid, token); await spin(uid, token)
      await pool.query('delete from auth.users where id = $1', [uid])
      const next = await newUser()
      const s = await status(next, token)
      assert.equal(s.device_used, 2)
      assert.equal(s.account_used, 0)
      await assert.rejects(spin(next, token), /err.spinDeviceLimit/)
    })

    await t.test('bonus works with existing free-vote priority, spending and refunds', async () => {
      const uid = await newUser(), token = await register(uid)
      const win = await spin(uid, token)
      const request = randomUUID()
      await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1, $2, 'Artist', 'Song', 'queued')", [request, uid])
      await as(uid, 'select * from public.cast_vote($1, 3)', [request])
      assert.equal(await balance(uid), win.spin.reward) // free votes first
      await as(uid, 'select * from public.cast_vote($1, 1)', [request])
      assert.equal(await balance(uid), win.spin.reward - 1)
      await as(uid, 'select * from public.cast_vote($1, -1)', [request])
      assert.equal(await balance(uid), win.spin.reward)
      assert.equal((await status(uid, token)).device_used, 1) // refund is NOT a spin reset
    })

    await t.test('RLS/privileges block direct credit, ledger, identity and helper access', async () => {
      const uid = await newUser(), token = await register(uid)
      for (const sql of [
        'select * from public.daily_spins',
        'select * from public.daily_spin_devices',
        'delete from public.daily_spins',
        "insert into public.daily_spin_devices (device_hash) values (repeat('f', 64))",
        'update public.profiles set vote_credits = 999, is_admin = true where id = auth.uid()',
        'select public.daily_spin_prizes()',
        `select public.daily_spin_device_hash('${token}')`,
        `select public.daily_spin_payload(repeat('f', 64), '${uid}', now())`,
      ]) await assert.rejects(as(uid, sql), { code: '42501' })
      for (const sql of [
        'select public.register_daily_spin_device()',
        `select public.my_daily_spin_status('${token}')`,
        `select public.spin_daily('${token}', '${randomUUID()}', '${uid}')`,
      ]) await assert.rejects(as(null, sql, [], 'anon'), { code: '42501' })
      assert.equal(await balance(uid), 0)
    })

    await t.test('server registration rate limit bounds per-account token minting', async () => {
      const uid = await newUser()
      for (let i = 0; i < 5; i++) assert.match(await register(uid), /^[a-f0-9]{64}$/)
      await assert.rejects(register(uid), /err.spinRegistration/)
    })
  } finally {
    if (pool) await pool.end()
    await Promise.all(closed)
    await admin.query(`drop database if exists ${name}`)
    await admin.end()
  }
})
