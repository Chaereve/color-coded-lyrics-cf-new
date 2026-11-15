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
const SCAFFOLD = `
  do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
  grant usage on schema public, auth to anon, authenticated;
  create publication supabase_realtime;`

async function build() {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  await db.exec(read('supabase/migrations/20261125_reward_eligibility_and_quota_races.sql'))
  await db.exec(read('supabase/migrations/20261213_admin_actions_and_request_edit.sql'))
  await db.exec(read('supabase/migrations/20261224_payment_source.sql'))
  return db
}
async function seedUser(db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id,email) values (gen_random_uuid(),$1) returning id', [email])).rows[0].id
  if (admin) await db.query('update public.profiles set is_admin=true where id=$1', [id])
  return id
}
async function asUser(db, id, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role authenticated;')
  try { return await fn() } finally {
    await db.exec('reset role;')
    await db.query("select set_config('request.jwt.claim.sub','',false)")
  }
}

test('payment source separates money, reward and vote orders; reject clears priority', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    await db.query('update public.profiles set bonus_requests=1 where id=$1', [member])
    const money = (await asUser(db, member, () => db.query(
      `select * from public.create_request('Color Coded Lyrics','A','Money','' ,'',true,false)`))).rows[0]
    assert.equal(money.payment_source, 'money')
    assert.equal(money.payment_status, 'awaiting')
    assert.equal(money.status, 'pending')
    const order = (await db.query("select * from public.orders where request_id=$1", [money.id])).rows[0]
    assert.equal(order.kind, 'paid_request')

    const bonus = (await asUser(db, member, () => db.query(
      `select * from public.create_request('Color Coded Lyrics','A','Bonus','','',true,true)`))).rows[0]
    assert.equal(bonus.payment_source, 'bonus')
    assert.equal(bonus.payment_status, 'paid')
    assert.equal(bonus.status, 'queued')
    assert.equal((await db.query('select count(*)::int n from public.orders where request_id=$1', [bonus.id])).rows[0].n, 0)
    assert.equal((await db.query('select bonus_requests from public.profiles where id=$1', [member])).rows[0].bonus_requests, 0)

    await asUser(db, admin, () => db.query('select public.admin_order($1,true)', [order.id]))
    let r = (await db.query('select * from public.requests where id=$1', [money.id])).rows[0]
    assert.equal(r.payment_source, 'money'); assert.equal(r.payment_status, 'paid'); assert.equal(r.status, 'queued')
    assert.equal((await db.query('select vote_credits from public.profiles where id=$1', [member])).rows[0].vote_credits, 0)

    await asUser(db, member, () => db.query("select public.buy_votes('v3',3,0.49,13000)"))
    const voteOrder = (await asUser(db, member, () => db.query("select * from public.buy_votes('v3',3,0.49,13000)"))).rows[0]
    assert.equal(voteOrder.kind, 'votes')
    await asUser(db, admin, () => db.query('select public.admin_order($1,true)', [voteOrder.id]))
    assert.equal((await db.query('select vote_credits from public.profiles where id=$1', [member])).rows[0].vote_credits, 3)

    const second = (await asUser(db, member, () => db.query(
      `select * from public.create_request('Color Coded Lyrics','A','Reject','','',true,false)`))).rows[0]
    const secondOrder = (await db.query('select id from public.orders where request_id=$1', [second.id])).rows[0]
    await asUser(db, admin, () => db.query('select public.admin_order($1,false)', [secondOrder.id]))
    r = (await db.query('select * from public.requests where id=$1', [second.id])).rows[0]
    assert.equal(r.is_paid, false); assert.equal(r.payment_status, 'none'); assert.equal(r.payment_source, null)

    await assert.rejects(asUser(db, admin, () => db.query('select public.admin_request_edit($1,null,null,true,null)', [money.id])), /err\.paymentSourceLocked/)
    await assert.rejects(db.query("update public.requests set payment_source='bonus', payment_status='awaiting' where id=$1", [money.id]), /requests_payment_source_check/)
  } finally { await db.close() }
})
