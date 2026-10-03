/* Optional REAL PostgreSQL tests; only a LOCAL/TEST superuser with CREATEDB.
   A uniquely named disposable database is created and dropped. Never point
   DAILY_REWARDS_TEST_DATABASE_URL at production. See docs/DAILY-REWARDS.md. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const migration = readFileSync(new URL('../migrations/20261112_daily_rewards.sql', import.meta.url), 'utf8')
const calendarMigration = readFileSync(new URL('../migrations/20261113_calendar_kpop_quiz.sql', import.meta.url), 'utf8')
const upgradeMigration = readFileSync(new URL('../migrations/20261114_daily_rewards_upgrade.sql', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const url = process.env.DAILY_REWARDS_TEST_DATABASE_URL

test('daily rewards migration is mirrored verbatim in the canonical schema', () => {
  assert.ok(schema.includes(migration))
  assert.match(migration, /primary key \(user_id, reward_day\)/)
  assert.match(migration, /unique \(user_id, quiz_day\)/)
  assert.match(migration, /bonus_credits = bonus_credits \+ v_claim\.reward/)
  assert.match(migration, /bonus_credits = bonus_credits \+ v_score/)
  assert.doesNotMatch(migration, /set vote_credits|cron\.schedule/)
})

test('daily rewards keep all answer keys private and restrict RPC execution', () => {
  assert.match(migration, /revoke all on public\.daily_login_rewards, public\.daily_quiz_questions, public\.daily_quiz_attempts\s+from public, anon, authenticated/)
  for (const signature of ['daily_rewards_payload(uuid,timestamptz)', 'my_daily_rewards_status()',
    'claim_daily_login(uuid,date)', 'start_daily_quiz(uuid,date)', 'submit_daily_quiz(uuid,uuid,int[])']) {
    assert.ok(migration.includes(`revoke all on function public.${signature} from public, anon, authenticated`))
  }
  assert.doesNotMatch(migration, /grant execute on function public\.daily_rewards_payload/)
  assert.match(migration, /case when a\.completed_at is not null[\s\S]*'correct_option'/)
})

test('reward date is captured after wallet lock; quiz scores have no client override', () => {
  for (const name of ['claim_daily_login', 'start_daily_quiz', 'submit_daily_quiz']) {
    const body = migration.slice(migration.indexOf(`create or replace function public.${name}`))
      .split('end $$;')[0]
    assert.ok(body.indexOf('for update') < body.indexOf('v_now := clock_timestamp()'))
    assert.match(body, /p_expected_user_id is distinct from v_uid/)
    assert.match(body, /Asia\/Ho_Chi_Minh/)
  }
  const submit = migration.slice(migration.indexOf('create or replace function public.submit_daily_quiz'))
  assert.doesNotMatch(submit, /p_reward|p_score|p_correct|p_day/)
  assert.match(submit, /where id = p_attempt_id and user_id = v_uid for update/)
})

test('calendar/K-pop migration is mirrored, owner-scoped and does not rewrite wallets or attempt snapshots', () => {
  assert.ok(schema.includes(calendarMigration))
  assert.match(calendarMigration, /c\.user_id = p_uid/)
  assert.match(calendarMigration, /c\.reward_day >= date_trunc\('month', d\.day\)::date/)
  assert.match(calendarMigration, /c\.reward_day <= d\.day/)
  assert.match(calendarMigration, /jsonb_agg\(c\.reward_day order by c\.reward_day\)/)
  assert.match(calendarMigration, /revoke all on function public\.daily_rewards_payload\(uuid,timestamptz\) from public, anon, authenticated/)
  assert.match(calendarMigration, /case when a\.completed_at is not null[\s\S]*'correct_option'/)
  assert.doesNotMatch(calendarMigration, /(?:update|delete from|truncate) public\.(?:profiles|daily_login_rewards|daily_quiz_attempts)/)
  assert.equal((calendarMigration.match(/\('kpop-easy-/g) || []).length, 24)
  assert.match(calendarMigration, /on conflict \(id\) do nothing/)
})

test('upgrade migration is mirrored, read-only for wallets and adds categories plus month history', () => {
  assert.ok(schema.includes(upgradeMigration))
  assert.match(upgradeMigration, /add column if not exists category text not null default 'Songs'/)
  assert.match(upgradeMigration, /on conflict \(id\) do nothing/)
  assert.match(upgradeMigration, /'total_days', coalesce\(st\.total_days, 0\)/)
  assert.match(upgradeMigration, /'best_streak', coalesce\(st\.best_streak, 0\)/)
  assert.match(upgradeMigration, /create or replace function public\.my_daily_checkin_month\(p_month date\)/)
  assert.match(upgradeMigration, /grant execute on function public\.my_daily_checkin_month\(date\) to authenticated/)
  assert.match(upgradeMigration, /revoke all on function public\.my_daily_checkin_month\(date\) from public, anon, authenticated/)
  assert.match(upgradeMigration, /where c\.user_id = v_uid/)
  assert.match(upgradeMigration, /revoke all on function public\.daily_rewards_payload\(uuid,timestamptz\) from public, anon, authenticated/)
  assert.doesNotMatch(upgradeMigration, /(?:update|delete from|truncate) public\.(?:profiles|daily_login_rewards|daily_quiz_attempts) /)
  assert.doesNotMatch(upgradeMigration, /grant execute on function public\.daily_rewards_payload/)
  // Rewards are untouched: +2 check-in and +1 per correct answer only.
  assert.doesNotMatch(upgradeMigration, /bonus_credits = bonus_credits \+ [^v]/)
})

test('the upgraded quiz draw avoids questions the player already answered recently', () => {
  const body = upgradeMigration.slice(upgradeMigration.indexOf('create or replace function public.start_daily_quiz'))
  assert.match(body, /a\.quiz_day > v_day - 30/)
  assert.match(body, /order by seen, draw/)
  assert.match(body, /'correct_option', q\.correct_option/)
  assert.doesNotMatch(body, /p_reward|p_score|p_correct|p_day/)
})

test('Daily rewards — real transactions, permissions, replay and concurrency', { skip: !url, timeout: 90_000 }, async t => {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const name = `ccl_daily_rewards_test_${randomUUID().replaceAll('-', '')}`
  let pool, created = false
  const closed = []
  try {
    await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
    created = true
    const target = new URL(url)
    target.pathname = `/${name}`
    pool = new pg.Pool({ connectionString: target.toString(), max: 20 })
    pool.on('connect', client => closed.push(new Promise(resolve => client.once('end', resolve))))
    await pool.query(`
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;
      create publication supabase_realtime;
    `)
    // Exercise an upgrade of an existing populated database, not a toy schema.
    await pool.query(schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:')))
    const user = async () => {
      const id = randomUUID()
      await pool.query('insert into auth.users (id,email) values ($1,$2)', [id, `${id}@example.test`])
      await pool.query('update public.profiles set vote_credits=7, bonus_credits=4 where id=$1', [id])
      return id
    }
    const a = await user(), b = await user()
    await pool.query(migration)
    const as = async (uid, sql, values = [], role = 'authenticated') => {
      const db = await pool.connect()
      try {
        await db.query('begin')
        await db.query(`set local role ${role}`)
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || ''])
        const result = await db.query(sql, values)
        await db.query('commit')
        return result.rows
      } catch (e) {
        await db.query('rollback')
        throw e
      } finally { db.release() }
    }
    const status = async uid => (await as(uid, 'select public.my_daily_rewards_status() as v'))[0].v
    const claim = async (uid, day) => (await as(uid, 'select public.claim_daily_login($1,$2) as v', [uid, day]))[0].v
    const start = async (uid, day) => (await as(uid, 'select public.start_daily_quiz($1,$2) as v', [uid, day]))[0].v
    const submit = async (uid, id, answers) => (await as(uid, 'select public.submit_daily_quiz($1,$2,$3::int[]) as v', [uid, id, answers]))[0].v
    const stored = async id => (await pool.query('select * from public.daily_quiz_attempts where id=$1', [id])).rows[0]
    const wallet = async uid => (await pool.query('select vote_credits, bonus_credits from public.profiles where id=$1', [uid])).rows[0]
    const today = (await status(a)).day
    const dayBefore = (await pool.query('select ($1::date - 1)::text as d', [today])).rows[0].d
    const dayAfter = (await pool.query('select ($1::date + 1)::text as d', [today])).rows[0].d

    await t.test('calendar/K-pop upgrade preserves previously earned votes and an already-started quiz', async () => {
      const legacyUser = await user()
      await claim(legacyUser, today)
      const old = (await start(legacyUser, today)).status.quiz
      const snapshot = await stored(old.attempt_id)
      const before = await wallet(legacyUser)
      await pool.query(calendarMigration)
      assert.deepEqual(await wallet(legacyUser), before)
      assert.deepEqual(await stored(old.attempt_id), snapshot)
      assert.deepEqual((await status(legacyUser)).quiz, old)
      assert.deepEqual((await status(legacyUser)).login.claimed_days, [today])
      assert.equal((await claim(legacyUser, today)).replayed, true)
      const completed = await submit(legacyUser, old.attempt_id, snapshot.questions.map(q => q.correct_option))
      assert.equal(completed.score, 3, 'the old round still uses its original answer key')
      assert.deepEqual(await wallet(legacyUser), { vote_credits: 7, bonus_credits: 9 })
      const bank = (await pool.query("select * from public.daily_quiz_questions where active and id like 'kpop-easy-%'")).rows
      assert.equal(bank.length, 24)
      assert.ok(bank.every(q => /K-pop|BTS|BLACKPINK|TWICE|Stray Kids|NewJeans/.test(q.prompt)))
      assert.ok(bank.every(q => /K-pop|BTS|BLACKPINK|TWICE|Stray Kids/.test(q.prompt)))
      assert.ok(bank.every(q => q.options.length === 4 && new Set(q.options).size === 4))
      const expected = {
        'kpop-easy-dynamite': 'BTS', 'kpop-easy-ddudu': 'BLACKPINK', 'kpop-easy-army': 'ARMY',
        'kpop-easy-blink': 'BLINK', 'kpop-easy-tt': 'TWICE', 'kpop-easy-gangnam': 'PSY',
        'kpop-easy-solo': 'Jennie', 'kpop-easy-lalisa': 'Lisa', 'kpop-easy-bts-count': '7',
        'kpop-easy-blackpink-count': '4', 'kpop-easy-twice-count': '9', 'kpop-easy-jungkook': 'BTS',
        'kpop-easy-s-class': 'Stray Kids', 'kpop-easy-gods-menu': 'Stray Kids',
        'kpop-easy-super-shy': 'NewJeans', 'kpop-easy-hype-boy': 'NewJeans', 'kpop-easy-love-dive': 'IVE',
        'kpop-easy-next-level': 'aespa', 'kpop-easy-wannabe': 'ITZY', 'kpop-easy-antifragile': 'LE SSERAFIM',
        'kpop-easy-once': 'ONCE', 'kpop-easy-stay': 'STAY', 'kpop-easy-bang-chan': 'Stray Kids',
        'kpop-easy-red-flavor': 'Red Velvet',
      }
      for (const q of bank) assert.equal(q.options[q.correct_option], expected[q.id], q.id)
      assert.equal((await pool.query('select count(*)::int as n from public.daily_quiz_questions where not active')).rows[0].n, 24)
      const fresh = (await start(await user(), today)).status.quiz
      assert.ok(fresh.questions.every(q => q.id.startsWith('kpop-easy-') && !('correct_option' in q)))
    })

    await t.test('calendar returns only real owner check-ins in the server’s Vietnam month', async () => {
      const x = await user(), y = await user()
      await pool.query(`insert into public.daily_login_rewards (user_id, reward_day) values
        ($1,'2026-09-30'),($1,'2026-10-01'),($1,'2026-10-03'),($1,'2026-10-04'),($2,'2026-10-02')`, [x,y])
      await pool.query("insert into public.activity_days (user_id,day) values ($1,'2026-10-02')", [x])
      const payload = async (uid, now) => (await pool.query('select public.daily_rewards_payload($1,$2::timestamptz) as v', [uid,now])).rows[0].v
      const october = await payload(x, '2026-10-03T16:59:59Z')
      assert.deepEqual(october.login.claimed_days, ['2026-10-01','2026-10-03'])
      assert.equal(october.login.claimed, true)
      assert.deepEqual((await payload(y, '2026-10-03T16:59:59Z')).login.claimed_days, ['2026-10-02'])
      assert.equal((await payload(y, '2026-10-03T16:59:59Z')).login.claimed, false)
      const midnight = await payload(x, '2026-10-03T17:00:00Z')
      assert.equal(midnight.day, '2026-10-04')
      assert.deepEqual(midnight.login.claimed_days, ['2026-10-01','2026-10-03','2026-10-04'])
      const november = await payload(x, '2026-10-31T17:00:00Z')
      assert.equal(november.day, '2026-11-01')
      assert.deepEqual(november.login.claimed_days, [])
      assert.deepEqual((await status(a)).login.claimed_days, [])
      assert.deepEqual((await status(b)).login.claimed_days, [])
      assert.deepEqual(await wallet(x), { vote_credits: 7, bonus_credits: 4 }, 'reading calendar history never awards or resets a wallet')
    })

    await t.test('upgrade preserves balances and read-only status cannot claim a reward', async () => {
      const s = await status(a)
      assert.equal(s.purchased, 7)
      assert.equal(s.bonus, 4)
      assert.equal(s.login.claimed, false)
      assert.deepEqual(s.login.claimed_days, [])
      assert.equal(s.quiz, null)
      await status(a)
      assert.deepEqual(await wallet(a), { vote_credits: 7, bonus_credits: 4 })
      assert.equal((await pool.query('select count(*)::int as n from public.daily_quiz_questions where active')).rows[0].n, 24)
      const boundary = (await pool.query("select public.daily_rewards_payload($1, '2026-10-03T17:00:00Z'::timestamptz) as v", [a])).rows[0].v
      assert.equal(boundary.day, '2026-10-04')
      assert.equal(Date.parse(boundary.reset_at), Date.parse('2026-10-04T17:00:00Z'))
    })

    await t.test('anonymous callers, private tables and arbitrary-recipient helper are denied', async () => {
      for (const table of ['daily_login_rewards', 'daily_quiz_questions', 'daily_quiz_attempts']) {
        for (const role of ['anon', 'authenticated']) {
          await assert.rejects(as(a, `select * from public.${table}`, [], role), e => e.code === '42501')
          await assert.rejects(as(a, `delete from public.${table}`, [], role), e => e.code === '42501')
        }
        assert.equal((await pool.query("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${table}`])).rows[0].relrowsecurity, true)
      }
      for (const sql of [
        'select public.my_daily_rewards_status()',
        `select public.claim_daily_login('${a}','${today}')`,
        `select public.start_daily_quiz('${a}','${today}')`,
        `select public.submit_daily_quiz('${a}',gen_random_uuid(),array[0,1,2])`,
      ]) await assert.rejects(as(a, sql, [], 'anon'), e => e.code === '42501')
      await assert.rejects(as(a, 'select public.daily_rewards_payload($1,now())', [b]), e => e.code === '42501')
      await assert.rejects(as(null, 'select public.my_daily_rewards_status()'), /err.signin/)
      await assert.rejects(as(a, 'select public.claim_daily_login($1,$2)', [b, today]), /err.dailyAccountChanged/)
      await assert.rejects(as(a, 'select public.start_daily_quiz($1,$2)', [b, today]), /err.dailyAccountChanged/)
      await assert.rejects(as(a, 'select public.submit_daily_quiz($1,$2,$3::int[])', [b, randomUUID(), [0, 1, 2]]), /err.dailyAccountChanged/)
    })

    await t.test('concurrent login claims credit exactly once and cannot forge a day', async () => {
      for (const day of [dayBefore, dayAfter, null]) await assert.rejects(claim(a, day), /err.dailyDayChanged/)
      const results = await Promise.all(Array.from({ length: 20 }, () => claim(a, today)))
      assert.equal(results.filter(r => !r.replayed).length, 1)
      assert.deepEqual(await wallet(a), { vote_credits: 7, bonus_credits: 6 })
      assert.equal((await pool.query('select count(*)::int as n from public.daily_login_rewards where user_id=$1', [a])).rows[0].n, 1)
      assert.equal((await status(a)).earned_today, 2)
      assert.deepEqual((await status(a)).login.claimed_days, [today])
      assert.equal((await pool.query('select count(*)::int as n from public.activity_days where user_id=$1 and day=$2', [a, today])).rows[0].n, 1)
    })

    let attempt
    await t.test('concurrent starts freeze one set; refresh and retry do not reveal answers', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => start(a, today)))
      assert.equal(results.filter(r => !r.replayed).length, 1)
      attempt = results[0].status.quiz
      assert.equal(new Set(results.map(r => r.status.quiz.attempt_id)).size, 1)
      assert.equal(attempt.questions.length, 3)
      assert.equal(new Set(attempt.questions.map(q => q.id)).size, 3)
      for (const q of attempt.questions) {
        assert.equal('correct_option' in q, false)
        assert.equal('explanation' in q, false)
      }
      assert.deepEqual((await status(a)).quiz, attempt)
      assert.deepEqual(await wallet(a), { vote_credits: 7, bonus_credits: 6 })
      await assert.rejects(submit(b, attempt.attempt_id, [0, 1, 2]), /err.dailyQuizSession/)
      await assert.rejects(start(b, dayBefore), /err.dailyDayChanged/)
    })

    await t.test('malformed submissions roll back; score uses frozen server answers', async () => {
      for (const answers of [null, [], [0, 1], [0, null, 1], [-1, 0, 2], [0, 1, 4], [0, 1, 2, 3]]) {
        await assert.rejects(submit(a, attempt.attempt_id, answers), /err.dailyQuizAnswers/)
      }
      assert.equal((await stored(attempt.attempt_id)).completed_at, null)
      const row = await stored(attempt.attempt_id)
      const answers = row.questions.map(q => q.correct_option)
      // Editing the bank must not rewrite an active session's questions/answer key.
      await pool.query("update public.daily_quiz_questions set correct_option=(correct_option+1)%4, prompt='Edited after start' where id=any($1::text[])", [row.questions.map(q => q.id)])
      const results = await Promise.all(Array.from({ length: 20 }, () => submit(a, attempt.attempt_id, answers)))
      assert.equal(results.filter(r => !r.replayed).length, 1)
      assert.ok(results.every(r => r.score === 3 && r.reward === 3))
      assert.deepEqual(await wallet(a), { vote_credits: 7, bonus_credits: 9 })
      const complete = (await status(a)).quiz
      assert.equal(complete.completed, true)
      assert.deepEqual(complete.answers, answers)
      assert.equal(complete.questions[0].prompt, row.questions[0].prompt)
      assert.ok(complete.questions.every(q => Number.isInteger(q.correct_option) && q.explanation))
      const changed = await submit(a, attempt.attempt_id, [0, 0, 0])
      assert.equal(changed.replayed, true)
      assert.deepEqual(changed.status.quiz.answers, answers)
      assert.equal((await start(a, today)).status.quiz.completed, true)
      assert.equal((await status(a)).earned_today, 5)
    })

    await t.test('every score including zero consumes the single daily attempt', async () => {
      for (const score of [0, 1, 2, 3]) {
        const uid = await user()
        const quiz = (await start(uid, today)).status.quiz
        const row = await stored(quiz.attempt_id)
        const answers = row.questions.map((q, i) => i < score ? q.correct_option : (q.correct_option + 1) % 4)
        const result = await submit(uid, quiz.attempt_id, answers)
        assert.equal(result.score, score)
        assert.equal(result.status.quiz.completed, true)
        assert.deepEqual(await wallet(uid), { vote_credits: 7, bonus_credits: 4 + score })
        const replay = await submit(uid, quiz.attempt_id, row.questions.map(q => q.correct_option))
        assert.equal(replay.reward, score)
        assert.equal(replay.replayed, true)
        assert.equal((await start(uid, today)).status.quiz.attempt_id, quiz.attempt_id)
      }
    })

    await t.test('login and quiz can commit concurrently without losing either reward', async () => {
      const uid = await user()
      const quiz = (await start(uid, today)).status.quiz
      const answers = (await stored(quiz.attempt_id)).questions.map(q => q.correct_option)
      await Promise.all([claim(uid, today), submit(uid, quiz.attempt_id, answers)])
      assert.deepEqual(await wallet(uid), { vote_credits: 7, bonus_credits: 9 })
    })

    await t.test('unfinished old rounds expire; completed and login retries across midnight are safe', async () => {
      const uid = await user()
      const quiz = (await start(uid, today)).status.quiz
      await pool.query('update public.daily_quiz_attempts set quiz_day=$2 where id=$1', [quiz.attempt_id, dayBefore])
      await assert.rejects(submit(uid, quiz.attempt_id, [0, 1, 2]), /err.dailyDayChanged/)
      assert.deepEqual(await wallet(uid), { vote_credits: 7, bonus_credits: 4 })
      const fresh = (await start(uid, today)).status.quiz
      assert.notEqual(fresh.attempt_id, quiz.attempt_id)
      await claim(uid, today)
      await pool.query('update public.daily_login_rewards set reward_day=$2 where user_id=$1', [uid, dayBefore])
      const replay = await claim(uid, dayBefore)
      assert.equal(replay.replayed, true)
      assert.equal(replay.status.login.claimed, false)
      assert.equal((await wallet(uid)).bonus_credits, 6)
      await claim(uid, today)
      assert.equal((await wallet(uid)).bonus_credits, 8)
      // Privileged time-shift of the completed A round simulates a midnight retry.
      await pool.query('update public.daily_quiz_attempts set quiz_day=$2 where id=$1', [attempt.attempt_id, dayBefore])
      const completeReplay = await submit(a, attempt.attempt_id, [0, 0, 0])
      assert.equal(completeReplay.replayed, true)
      assert.equal(completeReplay.reward, 3)
      assert.equal(completeReplay.status.quiz, null)
      assert.equal((await wallet(a)).bonus_credits, 9)
    })

    await t.test('a wallet failure rolls back both reward ledgers and can be retried', async () => {
      const uid = await user()
      const quiz = (await start(uid, today)).status.quiz
      const answers = (await stored(quiz.attempt_id)).questions.map(q => q.correct_option)
      await pool.query(`
        create function public.test_daily_wallet_failure() returns trigger language plpgsql as $$
        begin
          if new.id='${uid}'::uuid and new.bonus_credits > old.bonus_credits then raise exception 'test rollback'; end if;
          return new;
        end $$;
        create trigger test_daily_wallet_failure before update of bonus_credits on public.profiles
        for each row execute function public.test_daily_wallet_failure();
      `)
      await assert.rejects(claim(uid, today), /test rollback/)
      await assert.rejects(submit(uid, quiz.attempt_id, answers), /test rollback/)
      assert.equal((await status(uid)).login.claimed, false)
      assert.equal((await stored(quiz.attempt_id)).completed_at, null)
      assert.deepEqual(await wallet(uid), { vote_credits: 7, bonus_credits: 4 })
      await pool.query('drop trigger test_daily_wallet_failure on public.profiles; drop function public.test_daily_wallet_failure()')
      await claim(uid, today)
      await submit(uid, quiz.attempt_id, answers)
      assert.equal((await wallet(uid)).bonus_credits, 9)
    })

    await t.test('rerunning both migrations preserves ledger rows, balances and edited questions', async () => {
      const before = await wallet(a)
      const row = await stored(attempt.attempt_id)
      await pool.query(migration)
      await pool.query(calendarMigration)
      await pool.query(upgradeMigration)
      assert.deepEqual(await wallet(a), before)
      assert.deepEqual(await stored(attempt.attempt_id), row)
      assert.equal((await pool.query("select count(*)::int as n from public.daily_quiz_questions where prompt='Edited after start'")).rows[0].n, 3)
      assert.equal((await claim(a, today)).replayed, true)
      assert.deepEqual((await status(a)).login.claimed_days, [today])
      const counts = (await pool.query(`select count(*) filter (where id like 'kpop-easy-%')::int as easy,
        count(*)::int as total from public.daily_quiz_questions where active`)).rows[0]
      assert.deepEqual(counts, { easy: 24, total: counts.total })
      assert.ok(counts.total >= 90, 'the upgrade adds its own questions without deleting the K-pop bank')
    })

    await t.test('upgrade keeps balances and snapshots, adds statistics, categories and month history', async () => {
      const x = await user()
      await claim(x, today)
      const old = (await start(x, today)).status.quiz
      const snapshot = await stored(old.attempt_id)
      const before = await wallet(x)
      await pool.query(`insert into public.daily_login_rewards (user_id, reward_day) values
        ($1,'2026-08-30'),($1,'2026-08-31'),($1,'2026-09-01'),($1,'2026-09-02'),($1,'2026-09-05')`, [x])
      await pool.query(upgradeMigration)
      assert.deepEqual(await wallet(x), before, 'reading statistics never awards or resets a wallet')
      assert.deepEqual(await stored(old.attempt_id), snapshot)
      assert.deepEqual((await status(x)).quiz.questions.map(q => q.id), snapshot.questions.map(q => q.id))
      const login = (await status(x)).login
      assert.equal(login.total_days, 6)
      assert.equal(login.first_day, '2026-08-30')
      assert.equal(login.best_streak, 4, 'Aug 30–31 and Sep 1–2 form the longest real run')
      assert.deepEqual(login.claimed_days, [today])
      const bank = (await pool.query('select * from public.daily_quiz_questions where active')).rows
      assert.ok(bank.length >= 90, `${bank.length} active questions after the researched bank`)
      assert.ok(bank.every(q => /^(?:Lyrics|Songs|Groups|Members|Fandom)$/.test(q.category)))
      const kpopWords = /K-pop|BTS|BLACKPINK|TWICE|Stray Kids|NewJeans|IVE|aespa|ITZY|Red Velvet|SEVENTEEN|ATEEZ|NCT|TXT|ENHYPEN|MAMAMOO|LE SSERAFIM|PSY|IU|EXO|SHINee|MONSTA X|BIGBANG|Girls' Generation|KARD|\(G\)I-DLE/
      // An earlier subtest deliberately renames three rows; ignore those edits.
      const fresh = bank.filter(q => q.prompt !== 'Edited after start' && q.id.startsWith('kpop-'))
      assert.ok(fresh.length >= 90)
      assert.ok(fresh.every(q => kpopWords.test(q.prompt)), 'every seeded question is about a K-pop act')
      assert.ok(fresh.every(q => !/BPM|tempo|chord|octave|staff|metronome|symphony|semitone/i.test(q.prompt)),
        'no generic music-theory trivia returns to the bank')
      assert.equal(new Set(bank.map(q => q.id)).size, bank.length)
      const month = async (uid, value) => (await as(uid, 'select public.my_daily_checkin_month($1::date) as v', [value]))[0].v
      assert.deepEqual((await month(x, '2026-08-01')).days, ['2026-08-30', '2026-08-31'])
      assert.deepEqual((await month(x, '2026-09-15')).days, ['2026-09-01', '2026-09-02', '2026-09-05'])
      assert.equal((await month(x, '2026-08-01')).month, '2026-08')
      assert.deepEqual((await month(await user(), '2026-08-01')).days, [], 'month history is owner-scoped')
      assert.deepEqual((await month(x, '2027-01-01')).days, [], 'future days are never returned')
      await assert.rejects(as(x, 'select public.my_daily_checkin_month(null)'), /err\./)
      const grants = (await pool.query(`select count(*)::int as n from information_schema.role_routine_grants
        where routine_schema='public' and routine_name='my_daily_checkin_month' and grantee in ('anon','public')`)).rows[0]
      assert.equal(grants.n, 0, 'month history is never executable by anonymous callers')
    })

    await t.test('new rounds prefer unseen questions and keep scoring unchanged', async () => {
      const x = await user()
      await pool.query(upgradeMigration)
      const first = (await start(x, today)).status.quiz
      const frozen = await stored(first.attempt_id)
      await submit(x, first.attempt_id, first.questions.map(() => 0))
      const again = (await pool.query('select count(*)::int as n from public.daily_quiz_attempts where user_id = $1', [x])).rows[0].n
      assert.equal(again, 1)
      const replay = await start(x, today)
      assert.equal(replay.replayed, true)
      assert.deepEqual(replay.status.quiz.questions.map(q => q.id), first.questions.map(q => q.id))
      assert.deepEqual(await wallet(x), { vote_credits: 7,
        bonus_credits: 4 + frozen.questions.filter(q => q.correct_option === 0).length }, 'scoring still uses the frozen answer key')
      const ids = new Set(first.questions.map(q => q.id))
      // Age each round instead of deleting it: the draw must skip questions the
      // player has already answered in the last 30 days, while unseen ones remain.
      for (let i = 1; i <= 6; i++) {
        // Age every round of this player first, so the next draw sees them as
        // answered days inside the 30-day window instead of today's attempt.
        await pool.query('update public.daily_quiz_attempts set quiz_day = quiz_day - $2::int where user_id = $1', [x, i])
        const round = (await start(x, today)).status.quiz
        assert.equal(round.questions.some(q => ids.has(q.id)), false, `round ${i} repeated a recent question`)
        round.questions.forEach(q => ids.add(q.id))
      }
      assert.ok(ids.size >= 21, 'a week of rounds covers many different questions')
      const fallback = (await start(x, today)).status.quiz
      assert.equal(fallback.questions.length, 3, 'the bank still draws a full round')
      await pool.query('delete from public.daily_quiz_attempts where user_id = $1', [x])
    })

    await t.test('account deletion cascades private rewards and attempt snapshots', async () => {
      await claim(b, today)
      await start(b, today)
      await pool.query('delete from auth.users where id=$1', [b])
      for (const table of ['daily_login_rewards', 'daily_quiz_attempts']) {
        assert.equal((await pool.query(`select count(*)::int as n from public.${table} where user_id=$1`, [b])).rows[0].n, 0)
      }
    })
  } finally {
    if (pool) await pool.end()
    await Promise.all(closed)
    try { if (created) await admin.query(`drop database ${name} with (force)`) }
    finally { await admin.end() }
  }
})
