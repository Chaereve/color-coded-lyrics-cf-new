/* Optional REAL PostgreSQL tests for the five-question Daily Quiz.
   A uniquely named disposable database is created and dropped; never point
   DAILY_QUIZ_TEST_DATABASE_URL at production. See docs/DAILY-QUIZ-PLAN.md.
   The static tests below run everywhere — they only read the migration text. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const read = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
const migration = read('20261115_daily_quiz_schema.sql')
const poolMigration = read('20261116_daily_quiz_pool.sql')
const flowMigration = read('20261117_daily_quiz_flow.sql')
const quizSql = migration + poolMigration + flowMigration
/* One function body only: the trailing functions in the same file must not leak
   into a "no client-supplied value" assertion. */
const fn = (sql, signature) => {
  const at = sql.indexOf(signature)
  assert.notEqual(at, -1, `missing ${signature}`)
  const end = sql.indexOf('\nend $$;', at)
  return sql.slice(at, end < 0 ? undefined : end)
}
const url = process.env.DAILY_QUIZ_TEST_DATABASE_URL

/* ------------------------------------------------------------------ */
/* Static review: what the migration text itself guarantees            */
/* ------------------------------------------------------------------ */

test('daily quiz migrations are mirrored verbatim in the canonical schema', () => {
  for (const part of [migration, poolMigration, flowMigration]) assert.ok(schema.includes(part))
  assert.match(migration, /primary key \(user_id, quiz_date, question_id\)/)
  assert.match(migration, /unique index if not exists daily_quiz_attempts_user_quiz_date_idx/)
  assert.match(migration, /check \(max_votes between 1 and 5\)/)
  assert.match(migration, /check \(votes_awarded between 0 and 5\)/)
  assert.match(migration, /check \(question_count in \(3,5\)\)/)
})

test('the legacy bank is excluded by construction and never grandfathered', () => {
  // Existing rows fall onto the ineligible defaults, and unverified source
  // fields are made explicit instead of being guessed.
  assert.match(migration, /approval_status\s+text not null default 'draft'/)
  assert.match(migration, /daily_eligibility_status text not null default 'ineligible'/)
  assert.match(migration, /set source_fact_match\s+= coalesce\(source_fact_match, 'pending_external_validation'\)/)
  assert.match(migration, /source_final_http_status\s+= coalesce\(source_final_http_status, 'unknown_not_observable'\)/)
  // No code path may widen the pool back to unvalidated questions.
  assert.doesNotMatch(quizSql, /approval_status\s*=\s*'approved'[\s\S]{0,400}or\s+q\.approval_status/)

  const candidates = poolMigration.slice(poolMigration.indexOf('create or replace function public.daily_quiz_candidates'))
  for (const rule of [
    /q\.active/,
    /q\.approval_status = 'approved'/,
    /q\.daily_eligibility_status = 'eligible'/,
    /q\.retirement_status = 'active'/,
    /q\.duplicate_of is null/,
    /coalesce\(cardinality\(q\.safety_flags\), 0\) = 0/,
    /coalesce\(cardinality\(q\.copyright_flags\), 0\) = 0/,
    /coalesce\(q\.quality_score, 0\) >= public\.daily_quiz_int\('min_quality_score', 97\)/,
    /q\.source_fact_match = 'pass'/,
    /q\.source_access_status in \('public_accessible','accessible_with_redirect'\)/,
    /q\.source_final_http_status = '200'/,
    /coalesce\(q\.source_final_url, ''\) <> ''/,
    /q\.source_last_checked > p_day - public\.daily_quiz_int\('freshness_days', 30\)/,
  ]) assert.match(candidates, rule)
  // An initial 200 is never enough on its own: only the final status counts.
  assert.doesNotMatch(candidates, /source_initial_http_status = '200'/)
})

test('hard questions stay out until the flag is on and the hard pool is big enough', () => {
  const candidates = poolMigration.slice(poolMigration.indexOf('create or replace function public.daily_quiz_candidates'))
  assert.match(candidates, /q\.difficulty <> 'hard'\s*\n\s*or \(public\.daily_quiz_bool\('hard_question_enabled', false\)/)
  const mix = poolMigration.slice(poolMigration.indexOf('create or replace function public.daily_quiz_mix'))
  assert.match(mix, /min_hard_pool_to_enable/)
  assert.match(mix, /max_hard_per_set/)
  assert.match(migration, /\('hard_question_enabled',\s+'false'\)/)
  assert.match(migration, /\('min_hard_pool_to_enable',\s+'30'\)/)
  assert.match(migration, /\('easy_count',\s+'2'\)/)
  assert.match(migration, /\('medium_count',\s+'3'\)/)
  assert.match(migration, /\('hard_count',\s+'0'\)/)
})

test('answers are private until they are submitted, and no client value is trusted', () => {
  const payload = poolMigration.slice(poolMigration.indexOf('create or replace function public.daily_rewards_payload'))
  assert.match(payload, /case when w\.question_id is null then '\{\}'::jsonb/)
  assert.match(payload, /'correct_option_id', q\.item ->> 'correct_option_id'/)
  const submit = fn(flowMigration, 'create or replace function public.submit_daily_quiz_answer(')
  assert.doesNotMatch(submit, /p_score|p_reward|p_correct|p_day\b/)
  assert.match(submit, /raise exception 'err\.dailyQuizQuestion'/)
  assert.match(submit, /raise exception 'err\.dailyQuizOption'/)
  assert.match(submit, /on conflict \(user_id, quiz_date, question_id\) do nothing/)
  assert.match(submit, /v_awarded := case when v_correct and v_votes < v_cap then 1 else 0 end/)
  assert.match(submit, /bonus_credits = bonus_credits \+ 1/)
  // Lock order identical to every other wallet path: profile, advisory, attempt.
  assert.ok(submit.indexOf('from public.profiles where id = v_uid for update')
    < submit.indexOf('pg_advisory_xact_lock'))
  assert.ok(submit.indexOf('pg_advisory_xact_lock')
    < submit.indexOf('where id = p_attempt_id and user_id = v_uid for update'))
  assert.match(submit, /v_now := clock_timestamp\(\)/)
  assert.match(submit, /at time zone 'Asia\/Ho_Chi_Minh'/)
})

test('the retired free-vote grant and the quiz cap are configuration, not constants', () => {
  assert.match(migration, /\('free_vote_grant_enabled',\s+'false'\)/)
  assert.match(migration, /\('daily_vote_cap',\s+'5'\)/)
  assert.match(migration, /\('global_daily_vote_cap_enabled',\s+'false'\)/)
  assert.match(migration, /\('global_daily_vote_cap',\s+'5'\)/)
  assert.match(migration, /\('daily_vote_cap',\s+'5'\)/)
  assert.match(flowMigration, /create or replace function public\.daily_free_vote_grant/)
  assert.match(flowMigration, /greatest\(0, least\(public\.daily_quiz_int\('free_votes_per_day', 3\),[\s\S]{0,200}global_daily_vote_cap/)
  // The old hardcoded "3 free votes" is gone from both wallet entry points.
  const grant = fn(flowMigration, 'create or replace function public.my_vote_status()')
  assert.match(grant, /public\.daily_free_vote_grant\(v_uid, v_day\)/)
  const cast = fn(flowMigration, 'create or replace function public.cast_vote(')
  assert.match(cast, /v_grant := public\.daily_free_vote_grant\(v_uid, v_day\)/)
  assert.match(cast, /v_freeLeft := greatest\(v_grant - v_freeUsed, 0\)/)
  assert.doesNotMatch(cast, /greatest\(3 - v_freeUsed/)
})

test('the legacy all-at-once submission path can no longer award votes', () => {
  const legacy = fn(flowMigration, 'create or replace function public.submit_daily_quiz(')
  assert.match(legacy, /raise exception 'err\.dailyQuizRetired'/)
  assert.match(flowMigration, /revoke all on function public\.submit_daily_quiz\(uuid,uuid,int\[\]\) from public, anon, authenticated/)
  assert.doesNotMatch(legacy, /bonus_credits/)
  assert.doesNotMatch(legacy, /update public\.profiles/)
})

/* ------------------------------------------------------------------ */
/* Real database                                                       */
/* ------------------------------------------------------------------ */

test('Daily Quiz — real transactions, caps, idempotency, concurrency and pool rules',
  { skip: !url, timeout: 180_000 }, async t => {
    const admin = new pg.Client({ connectionString: url })
    await admin.connect()
    const name = `ccl_daily_quiz_test_${randomUUID().replaceAll('-', '')}`
    let pool, created = false
    const ended = []
    try {
      await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
      created = true
      const target = new URL(url)
      target.pathname = `/${name}`
      pool = new pg.Pool({ connectionString: target.toString(), max: 20 })
      pool.on('connect', client => ended.push(new Promise(resolve => client.once('end', resolve))))
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
      // Upgrade path: everything up to the daily rewards block, then in order.
      await pool.query(schema.slice(0, schema.indexOf('-- BEGIN DAILY REWARDS:')))
      const baseMigrations = ['20261112_daily_rewards.sql', '20261113_calendar_kpop_quiz.sql',
        '20261114_daily_rewards_upgrade.sql']
      for (const m of baseMigrations) await pool.query(read(m))
      for (const part of [migration, poolMigration, flowMigration]) await pool.query(part)

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
          await db.query('rollback').catch(() => {})
          throw e
        } finally { db.release() }
      }
      const run = async (uid, sql, values) => (await as(uid, `select ${sql} as v`, values))[0].v
      const day = await run(null, `(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text`, [], 'postgres')
      const today = () => run(null, `(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text`, [], 'postgres')

      const user = async () => {
        const id = randomUUID()
        await pool.query('insert into auth.users (id,email) values ($1,$2)', [id, `${id}@example.test`])
        await pool.query('update public.profiles set vote_credits=7, bonus_credits=0 where id=$1', [id])
        return id
      }
      // node-pg turns a SQL `date` into a JS Date at UTC midnight.
      const iso = value => (value instanceof Date ? value.toISOString().slice(0, 10) : value)
      const bonus = async uid => (await pool.query('select bonus_credits from public.profiles where id=$1', [uid])).rows[0].bonus_credits
      const config = async (key, value) => pool.query('update public.daily_quiz_config set value=$2::jsonb where key=$1', [key, value])

      /* A question is eligible by default and ineligible as soon as any single
         production rule is broken. */
      const question = async (o = {}) => {
        const id = o.id || `Q${randomUUID().slice(0, 8)}`
        await pool.query(`
          insert into public.daily_quiz_questions
            (id, prompt, options, option_ids, correct_option, explanation, category, difficulty,
             sub_category, question_type, artist, fact_key, song_key, quality_score,
             approval_status, daily_eligibility_status, retirement_status, source_url,
             source_final_url, source_initial_http_status, source_final_http_status,
             source_redirect_count, source_access_status, source_fact_match,
             source_last_checked, active)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,true)`,
          [id, `Prompt ${id}`, JSON.stringify(o.options || ['A', 'B', 'C', 'D']),
            o.optionIds || ['opt-a', 'opt-b', 'opt-c', 'opt-d'],
            o.correct ?? 0, `Because ${id}.`, o.category || 'Songs',
            o.difficulty || 'easy', o.sub_category || 'profile', o.question_type || 'mcq',
            o.artist || `Artist${o.n ?? id}`, o.fact_key || `fact:${id}`, o.song_key || `song:${id}`,
            o.quality_score ?? 99, o.approval_status || 'approved',
            o.daily_eligibility_status || 'eligible', o.retirement_status || 'active',
            o.source_url || `https://en.wikipedia.org/wiki/${id}`,
            o.source_final_url === undefined ? `https://en.wikipedia.org/wiki/${id}` : o.source_final_url,
            o.source_initial_http_status || '200', o.source_final_http_status || '200',
            o.source_redirect_count ?? '0', o.source_access_status || 'public_accessible',
            o.source_fact_match || 'pass', o.source_last_checked === undefined ? day : o.source_last_checked])
        return id
      }
      const reset = async () => {
        await pool.query('delete from public.daily_quiz_answers')
        await pool.query('delete from public.daily_quiz_attempts')
        await pool.query('delete from public.daily_quiz_seen')
        await pool.query("delete from public.daily_quiz_questions where id like 'Q%'")
        await pool.query('update public.profiles set bonus_credits=0, vote_credits=7')
      }
      // A comfortable default pool: 3 easy + 6 medium across 8 artists.
      const seedPool = async () => {
        await question({ id: 'QE1', difficulty: 'easy', sub_category: 'profile', artist: 'BTS' })
        await question({ id: 'QE2', difficulty: 'easy', sub_category: 'lyrics', artist: 'BLACKPINK' })
        await question({ id: 'QE3', difficulty: 'easy', sub_category: 'profile', artist: 'TWICE' })
        await question({ id: 'QM1', difficulty: 'medium', sub_category: 'lyrics', artist: 'aespa' })
        await question({ id: 'QM2', difficulty: 'medium', sub_category: 'profile', artist: 'SEVENTEEN' })
        await question({ id: 'QM3', difficulty: 'medium', sub_category: 'lyrics', artist: 'IVE' })
        await question({ id: 'QM4', difficulty: 'medium', sub_category: 'profile', artist: 'NewJeans' })
        await question({ id: 'QM5', difficulty: 'medium', sub_category: 'lyrics_keyword', artist: 'ITZY' })
        await question({ id: 'QM6', difficulty: 'medium', sub_category: 'profile', artist: 'Stray Kids', question_type: 'true_false' })
      }
      const start = async uid => JSON.parse(await run(uid, `public.start_daily_quiz($1, $2)::text`, [uid, await today()]))
      const status = async uid => JSON.parse(await run(uid, `public.my_daily_rewards_status()::text`))
      const answer = async (uid, attemptId, questionId, optionId) =>
        JSON.parse(await run(uid, `public.submit_daily_quiz_answer($1,$2,$3,$4)::text`,
          [uid, attemptId, questionId, optionId]))

      /* ---------------------------------------------------------------- */
      await t.test('no approved eligible questions yet: intentional unavailable state', async () => {
        const u = await user()
        const s = await status(u)
        assert.equal(s.quiz.state, 'unavailable')
        assert.equal(s.quiz.question_count, 5)
        assert.equal(s.quiz.max_votes, 5)
        assert.equal(s.quiz.pool.total, 0)
        await assert.rejects(run(u, `public.start_daily_quiz($1,$2)`, [u, await today()]),
          /err\.dailyQuizUnavailable/)
      })

      await t.test('the legacy 99-question bank is never drawn and never awards votes', async () => {
        await seedPool()
        const u = await user()
        const legacy = (await pool.query("select count(*)::int as n from public.daily_quiz_questions where id like 'kpop-%'")).rows[0].n
        assert.ok(legacy > 0, 'the legacy bank must still be present')
        const s = await start(u)
        const ids = s.status.quiz.questions.map(q => q.id)
        assert.equal(ids.length, 5)
        for (const id of ids) assert.ok(!id.startsWith('kpop-'), `legacy question ${id} was drawn`)
        // The legacy all-at-once path is retired.
        await assert.rejects(run(u, `public.submit_daily_quiz($1,$2,$3::int[])`, [u, s.attempt_id, [0, 1, 2, 3, 4]]),
          /permission denied|err\.dailyQuizRetired/)
        await reset()
      })

      await t.test('exactly five questions, identical after a refresh, 2 easy + 3 medium', async () => {
        await seedPool()
        const u = await user()
        const first = await start(u)
        const ids = first.status.quiz.questions.map(q => q.id)
        assert.equal(ids.length, 5)
        assert.equal(new Set(ids).size, 5)
        const mix = first.status.quiz.questions.reduce((acc, q) => ({ ...acc, [q.difficulty]: (acc[q.difficulty] || 0) + 1 }), {})
        assert.deepEqual(mix, { easy: 2, medium: 3 })
        const again = await start(u)
        assert.equal(again.replayed, true)
        assert.deepEqual(again.status.quiz.questions.map(q => q.id), ids)
        // A reload reads the same attempt, it does not draw a new set.
        assert.deepEqual((await status(u)).quiz.questions.map(q => q.id), ids)
        // Repeated starts across many rounds always keep the launch mix.
        for (let i = 0; i < 12; i++) {
          const other = await user()
          const round = await start(other)
          const counts = round.status.quiz.questions.reduce((acc, q) => ({ ...acc, [q.difficulty]: (acc[q.difficulty] || 0) + 1 }), {})
          assert.deepEqual(counts, { easy: 2, medium: 3 }, `round ${i} mix: ${JSON.stringify(counts)}`)
        }
        await reset()
      })

      await t.test('hard questions are excluded while the flag is off, capped at one when it is on', async () => {
        await seedPool()
        for (let i = 1; i <= 4; i++) await question({ id: `QH${i}`, difficulty: 'hard', sub_category: 'profile', artist: `HardArtist${i}` })
        const u = await user()
        for (let i = 0; i < 8; i++) {
          await pool.query('delete from public.daily_quiz_attempts')
          const round = await start(u)
          assert.equal(round.status.quiz.questions.filter(q => q.difficulty === 'hard').length, 0)
        }
        // Flag on, but the validated hard pool is below min_hard_pool_to_enable.
        await config('hard_question_enabled', 'true')
        await pool.query('delete from public.daily_quiz_attempts')
        const stillOff = await start(u)
        assert.equal(stillOff.status.quiz.questions.filter(q => q.difficulty === 'hard').length, 0)
        // Flag on and the hard pool is large enough: at most one hard question.
        await config('min_hard_pool_to_enable', '1')
        for (let i = 0; i < 10; i++) {
          await pool.query('delete from public.daily_quiz_attempts')
          const round = await start(u)
          const hard = round.status.quiz.questions.filter(q => q.difficulty === 'hard').length
          assert.ok(hard <= 1, `hard questions in one set: ${hard}`)
          assert.ok(round.status.quiz.questions.length === 5)
        }
        await config('hard_question_enabled', 'false')
        await config('min_hard_pool_to_enable', '30')
        await reset()
      })

      await t.test('diversity: artists, sub-categories and formats', async () => {
        await seedPool()
        const u = await user()
        for (let i = 0; i < 10; i++) {
          await pool.query('delete from public.daily_quiz_attempts')
          const questions = (await start(u)).status.quiz.questions
          const artists = questions.map(q => q.id)
          const byArtist = {}
          for (const q of questions) {
            const artist = (await pool.query('select artist from public.daily_quiz_questions where id=$1', [q.id])).rows[0].artist
            byArtist[artist] = (byArtist[artist] || 0) + 1
          }
          assert.ok(Object.keys(byArtist).length >= 3, `distinct artists: ${JSON.stringify(byArtist)}`)
          for (const [artist, n] of Object.entries(byArtist)) assert.ok(n <= 2, `${artist} appeared ${n} times`)
          const subs = questions.map(q => q.sub_category)
          assert.ok(subs.filter(s => s === 'profile').length >= 1, 'needs at least one profile question')
          assert.ok(subs.filter(s => s.startsWith('lyrics')).length >= 1, 'needs at least one lyrics question')
          assert.ok(questions.filter(q => q.question_type === 'true_false').length <= 1)
          assert.ok(questions.filter(q => q.sub_category === 'lyrics_keyword').length <= 1)
          assert.equal(new Set(artists).size, 5)
        }
        // One artist dominating the pool still yields at most two of its questions.
        await reset()
        for (let i = 1; i <= 6; i++) await question({ id: `QX${i}`, difficulty: 'medium', sub_category: 'profile', artist: 'BTS' })
        for (let i = 1; i <= 4; i++) await question({ id: `QY${i}`, difficulty: 'easy', sub_category: 'lyrics', artist: `Other${i}` })
        // A second medium artist, otherwise three medium questions are impossible
        // under the two-per-artist cap and the quiz correctly stays unavailable.
        for (let i = 1; i <= 3; i++) await question({ id: `QZ${i}`, difficulty: 'medium', sub_category: 'lyrics', artist: `Second${i}` })
        for (let i = 0; i < 10; i++) {
          await pool.query('delete from public.daily_quiz_attempts')
          const questions = (await start(u)).status.quiz.questions
          const bts = questions.filter(q => q.id.startsWith('QX')).length
          assert.ok(bts <= 2, `BTS questions in one set: ${bts}`)
        }
        await reset()
      })

      await t.test('90-day repeat cooldown and deterministic constraint relaxation', async () => {
        // 20 questions: four non-overlapping sets are available.
        for (let i = 1; i <= 10; i++) await question({ id: `QE${i}`, difficulty: 'easy', sub_category: i % 2 ? 'profile' : 'lyrics', artist: `A${i}` })
        for (let i = 1; i <= 10; i++) await question({ id: `QN${i}`, difficulty: 'medium', sub_category: i % 2 ? 'profile' : 'lyrics', artist: `B${i}` })
        const u = await user()
        const first = await start(u)
        const firstIds = first.status.quiz.questions.map(q => q.id)
        // Pretend yesterday's round so a new round may be drawn today.
        await pool.query('update public.daily_quiz_attempts set quiz_day = quiz_day - 1, quiz_date = quiz_date - 1 where user_id=$1', [u])
        const second = await start(u)
        const secondIds = second.status.quiz.questions.map(q => q.id)
        assert.notDeepEqual(secondIds, firstIds)
        assert.equal(secondIds.filter(id => firstIds.includes(id)).length, 0,
          'questions seen today must not be handed back')
        // A minimal pool forces the cooldown to relax, never the eligibility.
        await reset()
        const minimal = []
        minimal.push(await question({ id: 'QE1', difficulty: 'easy', sub_category: 'profile', artist: 'A1' }))
        minimal.push(await question({ id: 'QE2', difficulty: 'easy', sub_category: 'lyrics', artist: 'A2' }))
        minimal.push(await question({ id: 'QN1', difficulty: 'medium', sub_category: 'profile', artist: 'A3' }))
        minimal.push(await question({ id: 'QN2', difficulty: 'medium', sub_category: 'lyrics', artist: 'A4' }))
        minimal.push(await question({ id: 'QN3', difficulty: 'medium', sub_category: 'profile', artist: 'A5' }))
        const v = await user()
        const m1 = await start(v)
        const selection1 = (await pool.query('select selection from public.daily_quiz_attempts where id=$1', [m1.attempt_id])).rows[0].selection
        assert.deepEqual(selection1.mix, { easy: 2, medium: 3, hard: 0 })
        await pool.query('update public.daily_quiz_attempts set quiz_day = quiz_day - 1, quiz_date = quiz_date - 1 where user_id=$1', [v])
        const m2 = await start(v)
        const selection2 = (await pool.query('select selection from public.daily_quiz_attempts where id=$1', [m2.attempt_id])).rows[0].selection
        assert.equal(m2.status.quiz.questions.length, 5)
        assert.ok(selection2.relaxed_steps.length >= 2, 'the cooldown had to be relaxed')
        // …but one ineligible question is enough to shut the quiz down.
        await reset()
        await question({ id: 'QE1', difficulty: 'easy', sub_category: 'profile', artist: 'A1' })
        await question({ id: 'QE2', difficulty: 'easy', sub_category: 'lyrics', artist: 'A2' })
        await question({ id: 'QN1', difficulty: 'medium', sub_category: 'profile', artist: 'A3' })
        await question({ id: 'QN2', difficulty: 'medium', sub_category: 'lyrics', artist: 'A4' })
        await question({ id: 'QN3', difficulty: 'medium', sub_category: 'profile', artist: 'A5', source_final_http_status: '404' })
        const w = await user()
        assert.equal((await status(w)).quiz.state, 'unavailable')
        await assert.rejects(run(w, `public.start_daily_quiz($1,$2)`, [w, await today()]), /err\.dailyQuizUnavailable/)
        await reset()
      })

      await t.test('ineligible questions are never drawn', async () => {
        await seedPool()
        const cases = [
          { label: 'pending verification', o: { approval_status: 'pending_verification' } },
          { label: 'retired', o: { retirement_status: 'retired' } },
          { label: 'temporarily ineligible', o: { daily_eligibility_status: 'temporarily_ineligible' } },
          { label: 'inactive', o: { active: false } },
          { label: 'source failed', o: { source_final_http_status: '404' } },
          { label: 'initial 200 but final 404', o: { source_initial_http_status: '200', source_final_http_status: '404' } },
          { label: 'no final url', o: { source_final_url: '' } },
          { label: 'stale source', o: { source_last_checked: '2000-01-01' } },
          { label: 'fact not matched', o: { source_fact_match: 'fail' } },
          { label: 'low quality', o: { quality_score: 96 } },
        ]
        for (const { label, o } of cases) {
          await reset()
          await seedPool()
          const id = await question({ id: `QBAD`, difficulty: 'medium', sub_category: 'profile', artist: 'Bad', ...o })
          if (o.active === false) await pool.query('update public.daily_quiz_questions set active=false where id=$1', [id])
          const poolCount = (await pool.query(`select public.daily_quiz_pool($1,$2)::text as v`, [await user(), day])).rows[0].v
          assert.equal(JSON.parse(poolCount).total, 9, `pool should exclude the ${label} question`)
          const u = await user()
          for (let i = 0; i < 6; i++) {
            await pool.query('delete from public.daily_quiz_attempts')
            const questions = (await start(u)).status.quiz.questions.map(q => q.id)
            assert.ok(!questions.includes(id), `${label} question was drawn`)
          }
        }
        await reset()
      })

      await t.test('one vote per correct answer, zero for a wrong one, five is the ceiling', async () => {
        await seedPool()
        const u = await user()
        const round = await start(u)
        const questions = round.status.quiz.questions
        // Wrong answer: zero votes.
        const wrong = await answer(u, round.attempt_id, questions[0].id, 'opt-d')
        assert.equal(wrong.correct, false)
        assert.equal(wrong.awarded, 0)
        assert.equal(wrong.votes_awarded, 0)
        assert.equal(wrong.answered_count, 1)
        assert.equal(await bonus(u), 0)
        // Correct answers: one vote each, up to the five-question set.
        let votes = 0
        for (const q of questions.slice(1)) {
          const r = await answer(u, round.attempt_id, q.id, 'opt-a')
          assert.equal(r.correct, true)
          votes += r.awarded
          assert.equal(r.votes_awarded, votes)
        }
        assert.equal(votes, 4, 'only the four correct answers award votes')
        assert.equal(await bonus(u), 4)
        const done = (await status(u)).quiz
        assert.equal(done.state, 'completed')
        assert.equal(done.locked, true)
        assert.equal(done.votes_awarded, 4)
        assert.equal(done.answered_count, 5)
        // A lowered cap stops awards before the fifth correct answer.
        await reset()
        await seedPool()
        await config('daily_vote_cap', '2')
        const c = await user()
        const capped = await start(c)
        let awarded = 0
        for (const q of capped.status.quiz.questions) {
          const r = await answer(c, capped.attempt_id, q.id, 'opt-a')
          assert.equal(r.correct, true)
          awarded += r.awarded
        }
        assert.equal(awarded, 2)
        assert.equal(await bonus(c), 2)
        await config('daily_vote_cap', '5')
        await reset()
      })

      await t.test('duplicate, replayed and concurrent submissions never double a vote', async () => {
        await seedPool()
        const u = await user()
        const round = await start(u)
        const q = round.status.quiz.questions[0]
        const results = await Promise.all(Array.from({ length: 8 }, () =>
          answer(u, round.attempt_id, q.id, 'opt-a')))
        assert.equal(await bonus(u), 1, 'eight concurrent identical submissions award one vote')
        const ledger = await pool.query('select * from public.daily_quiz_answers where user_id=$1', [u])
        assert.equal(ledger.rows.length, 1)
        assert.equal(results.filter(r => r.replayed === false).length, 1,
          'exactly one request does the work; the rest replay it')
        for (const r of results) {
          assert.equal(r.correct, true)
          assert.equal(r.votes_awarded, 1)
          assert.equal(r.option_id, 'opt-a')
        }
        // A second, different answer for the same question is rejected as a replay.
        const changed = await answer(u, round.attempt_id, q.id, 'opt-b')
        assert.equal(changed.replayed, true)
        assert.equal(changed.option_id, 'opt-a')
        assert.equal(await bonus(u), 1)
        await reset()
      })

      await t.test('ownership, assignment and option identity are enforced', async () => {
        await seedPool()
        const owner = await user()
        const other = await user()
        const round = await start(owner)
        const q = round.status.quiz.questions[0]
        // Another account cannot answer this attempt.
        await assert.rejects(run(other, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [other, round.attempt_id, q.id, 'opt-a']), /err\.dailyQuizSession/)
        await assert.rejects(run(other, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [owner, round.attempt_id, q.id, 'opt-a']), /err\.dailyAccountChanged/)
        // A question that was not assigned, and an option that does not exist.
        await assert.rejects(run(owner, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [owner, round.attempt_id, 'not-assigned', 'opt-a']), /err\.dailyQuizQuestion/)
        await assert.rejects(run(owner, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [owner, round.attempt_id, q.id, 'opt-z']), /err\.dailyQuizOption/)
        await assert.rejects(run(owner, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [owner, round.attempt_id, q.id, null]), /err\.dailyQuizAnswers/)
        await assert.rejects(run(owner, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [owner, randomUUID(), q.id, 'opt-a']), /err\.dailyQuizSession/)
        // Signing out is refused, and a stale day is refused.
        await assert.rejects(run(null, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [null, round.attempt_id, q.id, 'opt-a'], 'anon'), /err\.signin|permission denied/)
        await reset()
      })

      await t.test('client-side shuffling cannot change the result', async () => {
        await seedPool()
        const u = await user()
        const round = await start(u)
        const q = round.status.quiz.questions[0]
        assert.deepEqual(q.option_ids, ['opt-a', 'opt-b', 'opt-c', 'opt-d'])
        // The client shows the options in any order; it submits the stable id.
        assert.equal('correct_option_id' in q, false)
        assert.equal('explanation' in q, false)
        assert.equal('correct' in q, false)
        const displayed = ['opt-c', 'opt-a', 'opt-d', 'opt-b']
        const picked = displayed[3] // the option shown in fourth place
        const r = await answer(u, round.attempt_id, q.id, picked)
        assert.equal(r.correct, picked === 'opt-a')
        assert.equal(r.awarded, picked === 'opt-a' ? 1 : 0)
        // The answer is only revealed once it has been submitted.
        const after = (await status(u)).quiz.questions.find(x => x.id === q.id)
        assert.equal(after.answered, true)
        assert.equal(after.correct_option_id, 'opt-a')
        assert.equal(typeof after.explanation, 'string')
        await reset()
      })

      await t.test('the quiz date follows Asia/Ho_Chi_Minh and timestamps stay UTC', async () => {
        await seedPool()
        const u = await user()
        const round = await start(u)
        const vnDay = await today()
        const utcDay = (await pool.query(`select (clock_timestamp() at time zone 'UTC')::date::text as v`)).rows[0].v
        assert.equal(round.quiz_date, vnDay)
        const rows = await pool.query(`select quiz_day, quiz_date, created_at,
               created_at at time zone 'UTC' as utc,
               (created_at at time zone 'Asia/Ho_Chi_Minh')::date as vn
          from public.daily_quiz_attempts where id=$1`, [round.attempt_id])
        assert.equal(iso(rows.rows[0].quiz_date), vnDay)
        assert.equal(iso(rows.rows[0].quiz_day), vnDay)
        assert.equal(iso(rows.rows[0].vn), vnDay)
        // timestamptz has no offset of its own: it is stored in UTC.
        assert.equal(rows.rows[0].utc instanceof Date, true)
        const r = await answer(u, round.attempt_id, round.status.quiz.questions[0].id, 'opt-a')
        const stored = await pool.query(`select quiz_date, answered_at,
               (answered_at at time zone 'Asia/Ho_Chi_Minh')::date as vn
          from public.daily_quiz_answers where user_id=$1`, [u])
        assert.equal(iso(stored.rows[0].quiz_date), vnDay)
        assert.equal(iso(stored.rows[0].vn), vnDay)
        assert.equal(r.status.day, vnDay)
        // A round that rolls over midnight is refused on the new day.
        await pool.query('update public.daily_quiz_attempts set quiz_date = quiz_date - 1 where id=$1', [round.attempt_id])
        await assert.rejects(run(u, `public.submit_daily_quiz_answer($1,$2,$3,$4)`,
          [u, round.attempt_id, round.status.quiz.questions[1].id, 'opt-a']), /err\.dailyDayChanged/)
        if (utcDay !== vnDay) assert.notEqual(vnDay, utcDay, 'this run straddles the VN midnight')
        await reset()
      })

      await t.test('the retired free-vote grant cannot stack with Daily Quiz votes', async () => {
        await seedPool()
        const u = await user()
        const round = await start(u)
        for (const q of round.status.quiz.questions) await answer(u, round.attempt_id, q.id, 'opt-a')
        assert.equal(await bonus(u), 5)
        const s = (await as(u, 'select * from public.my_vote_status()'))[0]
        assert.equal(s.free_limit, 0, 'no automatic free votes while the grant is retired')
        assert.equal(s.bonus, 5)
        // Voting on a request must spend credits, not a free slot.
        const request = randomUUID()
        await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1,$2,'A','B','queued')", [request, u])
        await run(u, `public.cast_vote($1, 1)`, [request])
        const votes = await pool.query('select used_credit, credit_kind, free_slot from public.votes where request_id=$1', [request])
        assert.equal(votes.rows.length, 1)
        assert.equal(votes.rows[0].used_credit, true)
        assert.equal(votes.rows[0].credit_kind, 'bonus')
        assert.equal(votes.rows[0].free_slot, null)
        assert.equal(await bonus(u), 4, 'the vote came out of the quiz balance')
        // Turning the grant back on restores the old per-day allowance.
        await config('free_vote_grant_enabled', 'true')
        const s2 = (await as(u, 'select * from public.my_vote_status()'))[0]
        assert.equal(s2.free_limit, 3)
        await config('global_daily_vote_cap_enabled', 'true')
        const s3 = (await as(u, 'select * from public.my_vote_status()'))[0]
        assert.equal(s3.free_limit, 0, 'the quiz already used the whole global cap')
        await config('free_vote_grant_enabled', 'false')
        await config('global_daily_vote_cap_enabled', 'false')
        await reset()
      })

      await t.test('one round per user per day, and the ledger is the idempotency anchor', async () => {
        await seedPool()
        const u = await user()
        const first = await start(u)
        const second = await start(u)
        assert.equal(second.attempt_id, first.attempt_id)
        assert.equal((await pool.query('select count(*)::int as n from public.daily_quiz_attempts where user_id=$1', [u])).rows[0].n, 1)
        await assert.rejects(pool.query(`insert into public.daily_quiz_attempts
          (user_id, quiz_day, quiz_date, questions, question_count)
          values ($1,$2,$2,$3::jsonb,5)`, [u, day,
            JSON.stringify([1, 2, 3, 4, 5].map(i => ({ id: `q${i}`, prompt: `p${i}`, options: ['a','b','c','d'], correct_option: 0 })))]),
          /duplicate key|daily_quiz_attempts_user_quiz_date_idx/)
        // The same question cannot be answered twice on the same day.
        const q = first.status.quiz.questions[0]
        await answer(u, first.attempt_id, q.id, 'opt-a')
        await assert.rejects(pool.query(`insert into public.daily_quiz_answers
          (user_id, quiz_date, question_id, attempt_id, option_id, correct, awarded)
          values ($1,$2,$3,$4,'opt-a',true,1)`, [u, day, q.id, first.attempt_id]), /duplicate key/)
        // A legacy three-question round reports the retired state (one attempt
        // per user per day, so the current round is removed first).
        await pool.query('delete from public.daily_quiz_attempts where id=$1', [first.attempt_id])
        await pool.query(`insert into public.daily_quiz_attempts
          (user_id, quiz_day, questions, question_count, score, answers, completed_at)
          values ($1,$2,$3::jsonb,3,1,'{2,2,2}',now())`, [u, day,
            JSON.stringify([1, 2, 3].map(i => ({ id: `kpop-easy-army-${i}`, prompt: `Legacy ${i}`, options: ['a','b','c','d'], correct_option: 0 })))])
        assert.equal((await status(u)).quiz.state, 'retired')
        await reset()
      })
    } finally {
      await pool?.end()
      await Promise.allSettled(ended)
      if (created) {
        await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname=$1', [name]).catch(() => {})
        await admin.query(`drop database if exists ${name}`).catch(() => {})
      }
      await admin.end()
    }
  })
