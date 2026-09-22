// Real PostgreSQL, disposable database only. No production data is touched.
// COMMENTS_TEST_DATABASE_URL=postgres://... npm run test:comments:db
// Connection must be to a test/local superuser with CREATEDB, like spin tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.COMMENTS_TEST_DATABASE_URL
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../migrations/20261107_comments_spin_fixes.sql')
const schema = read('../schema.sql')

test('canonical schema contains the exact deployed comments/spin migration', () => {
  assert.ok(schema.includes(migration))
})

test('comments, mentions, deletion and browser account quota — real PostgreSQL', { skip: !url, timeout: 90_000 }, async t => {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  const name = `ccl_comments_test_${randomUUID().replaceAll('-', '')}`
  let pool
  const closed = []
  try {
    await admin.query(`create database ${name} template template0 encoding 'UTF8'`)
    const target = new URL(url); target.pathname = `/${name}`
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
    // Upgrade from the previous canonical schema, including restricted profiles.
    await pool.query(schema.split('-- BEGIN COMMENTS / SPIN FIXES:')[0])
    // Reproduce deployed policy from 20260922 (fresh schema previously differed).
    await pool.query(`
      drop policy if exists request_comments_owner_delete on public.request_comments;
      create policy request_comments_owner_or_admin_delete on public.request_comments for delete to authenticated
        using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
    `)
    // Legacy corrupt chain: no rewriting on upgrade, but new descendants must fail.
    const legacyUser = randomUUID(), legacyA = randomUUID(), legacyB = randomUUID()
    const legacyRoot = randomUUID(), legacyChild = randomUUID()
    await pool.query(`insert into auth.users(id,email) values ($1,'legacy@example.test')`, [legacyUser])
    await pool.query(`insert into public.requests(id,user_id,artist,title) values ($1,$3,'Legacy','A'),($2,$3,'Legacy','B')`, [legacyA, legacyB, legacyUser])
    await pool.query('alter table public.request_comments disable trigger request_comments_limits')
    await pool.query(`insert into public.request_comments(id,user_id,request_id,parent_id,body)
      values ($1,$3,$4,null,'old root'),($2,$3,$5,$1,'old wrong-request chain')`, [legacyRoot, legacyChild, legacyUser, legacyA, legacyB])
    await pool.query('alter table public.request_comments enable trigger request_comments_limits')
    await pool.query(migration)
    await pool.query(migration) // safe to rerun
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
        await client.query('rollback'); throw e
      } finally { client.release() }
    }
    const newUser = async (label = 'Member', isAdmin = false) => {
      const id = randomUUID()
      await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${id}@example.test`])
      await pool.query('update public.profiles set name = $2, is_admin = $3 where id = $1', [id, label, isAdmin])
      return id
    }
    const request = async user => (await pool.query(`insert into public.requests (user_id, kind, artist, title, requester)
      values ($1, 'Color Coded Lyrics', 'Test artist', $2, 'Tester') returning id`, [user, randomUUID()])).rows[0].id
    const add = async (uid, req, parent = null, body = 'hello') => (await as(uid, `
      insert into public.request_comments (user_id, request_id, parent_id, body) values ($1,$2,$3,$4) returning *`, [uid, req, parent, body]))[0]
    const notices = async id => (await pool.query('select * from public.notifications where sig like $1', [`%|${id}%`])).rows
    const a = await newUser('root author'), b = await newUser('park ssaem'), c = await newUser('reply author')
    const mod = await newUser('Moderator', true)
    const reqA = await request(a), reqB = await request(b)
    let root, r1, r2

    await t.test('root -> R1 -> R2 inserts with exact parent and request; not root-only', async () => {
      root = await add(a, reqA)
      r1 = await add(b, reqA, root.id)
      r2 = await add(c, reqA, r1.id, '@park_ssaem hello')
      assert.equal(r2.parent_id, r1.id)
      assert.equal(r2.request_id, reqA)
      const ns = await notices(r2.id)
      assert.deepEqual(ns.map(n => [n.kind, n.user_id]), [['reply', b]])
      assert.equal(ns.some(n => n.user_id === a), false)
    })
    await t.test('legacy cross-request ancestry cannot be extended and is never silently reparented', async () => {
      await assert.rejects(add(c, legacyB, legacyChild), /err.commentParent/)
      assert.equal((await pool.query('select parent_id from public.request_comments where id=$1', [legacyChild])).rows[0].parent_id, legacyRoot)
    })
    await t.test('IDOR: reject foreign-request, nonexistent, hidden parents and forged author', async () => {
      const foreign = await add(b, reqB)
      await assert.rejects(add(c, reqA, foreign.id), /err.commentParent/)
      await assert.rejects(add(c, reqB, r2.id), /err.commentParent/)
      await assert.rejects(add(c, reqA, randomUUID()), /err.commentParent/)
      const hidden = await add(a, reqA)
      await pool.query('update public.request_comments set deleted_at = now() where id = $1', [hidden.id])
      await assert.rejects(add(c, reqA, hidden.id), /err.commentParent/)
      await assert.rejects(as(c, `insert into public.request_comments (user_id,request_id,body) values ($1,$2,'forged')`, [a, reqA]), /row-level security/)
      await assert.rejects(as(null, `insert into public.request_comments (user_id,request_id,body) values ($1,$2,'anon')`, [a, reqA], 'anon'), /permission denied/)
    })
    await t.test('self reply and self mention keep text but never notify sender', async () => {
      const self = await add(b, reqA, r1.id, '@park_ssaem myself')
      assert.equal(self.body, '@park_ssaem myself')
      assert.deepEqual(await notices(self.id), [])
      const selfRoot = await add(a, reqA, null, '@root_author myself')
      assert.deepEqual(await notices(selfRoot.id), [])
    })
    await t.test('space handles, exact tokens and five-mention cap', async () => {
      const ann = await newUser('ann'), anna = await newUser('anna')
      const n = await add(c, reqA, null, '@park_ssaem @anna')
      const ids = (await notices(n.id)).filter(n => n.kind === 'mention').map(n => n.user_id)
      assert.ok(ids.includes(b)); assert.ok(ids.includes(anna)); assert.ok(!ids.includes(ann))
      const users = await Promise.all(Array.from({ length: 7 }, (_, i) => newUser(`mention ${i}`)))
      const many = await add(c, reqA, null, users.map((_, i) => `@mention_${i}`).join(' '))
      assert.equal((await notices(many.id)).filter(n => n.kind === 'mention').length, 5)
    })
    await t.test('ordinary users cannot read admin flag, delete another author, or move ancestry', async () => {
      await assert.rejects(as(a, 'select is_admin from public.profiles'), /permission denied/)
      assert.deepEqual(await as(c, 'delete from public.request_comments where id = $1 returning id', [r1.id]), [])
      await assert.rejects(as(c, 'update public.request_comments set parent_id = $1 where id = $2', [root.id, r2.id]), /permission denied/)
      await assert.rejects(pool.query('update public.request_comments set request_id = $1 where id = $2', [reqB, r2.id]), /err.commentParent/)
      await assert.rejects(pool.query('update public.request_comments set parent_id = $1 where id = $2', [r2.id, root.id]), /err.commentParent/)
    })
    await t.test('owner deletes own reply and all descendants; root and siblings survive', async () => {
      const sibling = await add(a, reqA, root.id)
      assert.equal((await as(b, 'delete from public.request_comments where id = $1 returning id', [r1.id])).length, 1)
      const all = (await as(a, 'select id from public.request_comments where request_id = $1', [reqA])).map(c => c.id)
      assert.ok(!all.includes(r1.id)); assert.ok(!all.includes(r2.id))
      assert.ok(all.includes(root.id)); assert.ok(all.includes(sibling.id))
      await assert.rejects(add(c, reqA, r1.id), /err.commentParent/)
    })
    await t.test('admin deletes any root and every level; soft hide cascades as well', async () => {
      assert.equal((await as(mod, 'delete from public.request_comments where id = $1 returning id', [root.id])).length, 1)
      const x = await newUser(), y = await newUser()
      const p = await add(x, reqB), q = await add(y, reqB, p.id), r = await add(x, reqB, q.id)
      await pool.query('update public.request_comments set deleted_at = now() where id = $1', [p.id])
      assert.equal((await pool.query('select id from public.request_comments where id = any($1::uuid[]) and deleted_at is not null', [[p.id, q.id, r.id]])).rowCount, 3)
      assert.deepEqual(await as(x, 'select id from public.request_comments where id = any($1::uuid[])', [[p.id, q.id, r.id]]), [])
      await assert.rejects(add(y, reqB, r.id), /err.commentParent/)
      await assert.rejects(pool.query('update public.request_comments set deleted_at = null where id = $1', [r.id]), /err.commentParent/)
      assert.equal((await as(mod, 'delete from public.request_comments where id=$1 returning id', [p.id])).length, 1)
    })
    await t.test('10/minute limit still serializes concurrent comments; timestamps cannot be forged', async () => {
      const spammer = await newUser()
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => add(spammer, reqA)))
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 10)
      assert.ok(results.filter(r => r.status === 'rejected').every(r => /err.commentRate/.test(r.reason.message)))
      await assert.rejects(as(spammer, `insert into public.request_comments (user_id,request_id,body,created_at) values ($1,$2,'old',now()-interval '1 day')`, [spammer, reqA]), /permission denied/)
    })
    await t.test('hide/insert race cannot leave a visible child under a hidden parent', async () => {
      const uid = await newUser(), p = await add(uid, reqA)
      const insert = await pool.connect()
      try {
        await insert.query('begin')
        await insert.query('insert into public.request_comments (user_id,request_id,parent_id,body) values ($1,$2,$3,\'race\')', [uid, reqA, p.id])
        const hiding = pool.query('update public.request_comments set deleted_at = now() where id = $1', [p.id])
        await insert.query('commit'); await hiding
        assert.equal((await pool.query('select id from public.request_comments where parent_id = $1 and deleted_at is null', [p.id])).rowCount, 0)
      } finally { await insert.query('rollback'); insert.release() }
    })

    const register = async uid => (await as(uid, 'select public.register_daily_spin_device() as v'))[0].v
    const spin = async (uid, token, fp, id = randomUUID()) => (await as(uid, 'select public.spin_daily($1,$2,$3,$4) as v', [token, id, uid, fp]))[0].v
    await t.test('Daily Spin: first spin binds token/fingerprint to one account; retries and limits remain', async () => {
      const x = await newUser(), y = await newUser(), z = await newUser()
      const token = await register(x), otherToken = await register(y), fp = 'a'.repeat(64)
      const id = randomUUID()
      await spin(x, token, fp, id)
      await assert.rejects(spin(y, token, fp), /err.spinDeviceAccount/)
      await assert.rejects(spin(y, otherToken, fp), /err.spinDeviceAccount/)
      const status = (await as(y, 'select public.my_daily_spin_status($1) as v', [token]))[0].v
      assert.equal(status.remaining, 0); assert.equal(status.history.length, 0)
      const fpStatus = (await as(y, 'select public.my_daily_spin_status($1,$2) as v', [otherToken, fp]))[0].v
      assert.equal(fpStatus.remaining, 0); assert.equal(fpStatus.device_account_blocked, true)
      assert.deepEqual(fpStatus.history, [])
      await assert.rejects(as(null, 'select public.my_daily_spin_status($1,$2)', [otherToken, fp], 'anon'), /permission denied/)
      assert.equal((await spin(x, token, fp, id)).replayed, true)
      await spin(x, token, fp)
      await assert.rejects(spin(x, token, fp), /err.spinDeviceLimit/)
      await assert.rejects(spin(x, await register(x), 'b'.repeat(64)), /err.spinAccountLimit/)
      // Different browser/person sharing an IP is NOT globally blocked.
      await spin(z, await register(z), 'c'.repeat(64))
      assert.equal((await pool.query('select count(*)::int n from public.daily_spins where user_id=$1', [y])).rows[0].n, 0)
    })
    await t.test('Daily Spin: deleting account after one spin does not free that browser today; next day does', async () => {
      const x = await newUser(), y = await newUser(), token = await register(x), fp = 'f'.repeat(64)
      await spin(x, token, fp)
      await pool.query('delete from auth.users where id=$1', [x])
      await assert.rejects(spin(y, token, fp), /err.spinDeviceAccount/)
      await pool.query("update public.daily_spins set spin_day=spin_day-1 where fp_hash=$1", [fp])
      assert.equal((await spin(y, token, fp)).replayed, false)
    })
    await t.test('Daily Spin: simultaneous first spins cannot bind one fingerprint to two accounts', async () => {
      const x = await newUser(), y = await newUser()
      const tx = await register(x), ty = await register(y), fp = 'd'.repeat(64)
      const res = await Promise.allSettled([spin(x, tx, fp), spin(y, ty, fp)])
      assert.equal(res.filter(r => r.status === 'fulfilled').length, 1)
      assert.match(res.find(r => r.status === 'rejected').reason.message, /err.spinDeviceAccount/)
    })
  } finally {
    await pool?.end()
    await Promise.all(closed)
    await admin.query(`drop database if exists ${name}`)
    await admin.end()
  }
})
