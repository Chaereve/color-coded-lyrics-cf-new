/* PGlite verification for 20261231_hide_pending_requests.
 * No network/production. Proves the tightened "read requests" policy hides
 * pending / denied / payment-awaiting rows from anon and third parties while
 * owner and admin keep full access, admin_review cannot approve a paid request
 * before its order is confirmed (err.paymentAwaitingOrder) while denial and
 * bonus/free approval keep working, admin_review_many skips awaiting rows on
 * bulk approve, admin_order confirmation publishes the request, and the real
 * rollback file restores the old open policy and the old approval behavior.
 * Chạy: npm test */
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
const MIGRATION = '20261231_hide_pending_requests'
const ROLLBACK = `supabase/rollback/${MIGRATION}.sql`
const migration = read(`supabase/migrations/${MIGRATION}.sql`)
const rollback = read(ROLLBACK)
const CHAIN = ['20261125_reward_eligibility_and_quota_races', '20261212_admin_bulk_and_comments_page',
  '20261213_admin_actions_and_request_edit', '20261217_protect_paid_request_orders',
  '20261221_notification_inbox_fix', '20261223_pick_pause', '20261224_payment_source',
  '20261225_payment_operations', '20261226_payment_source_read_grant', '20261228_bonus_refund_and_priority',
  '20261229_request_funding_review', '20261230_payment_claim_sepay_log']

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

async function build({ apply = true } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec('create schema extensions;')
  await db.exec(SCAFFOLD)
  await db.exec(coreSql)
  for (const name of CHAIN) await db.exec(read(`supabase/migrations/${name}.sql`))
  await db.exec(`insert into public.settings(key,value) values ('pick','{"interval_days":4,"paused":false}'::jsonb) on conflict (key) do nothing;`)
  if (apply) await db.exec(read(`supabase/migrations/${MIGRATION}.sql`))
  return db
}
async function seedUser(db, email, admin = false) {
  const id = (await db.query('insert into auth.users (id,email) values (gen_random_uuid(),$1) returning id', [email])).rows[0].id
  await db.query(`insert into public.profiles (id, name, is_admin, bonus_requests) values ($1, $2, $3, 5)
    on conflict (id) do update set name = excluded.name, is_admin = excluded.is_admin, bonus_requests = 5`, [id, email.split('@')[0], admin])
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
async function asAnon(db, fn) {
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await db.exec('set role anon;')
  try { return await fn() } finally { await db.exec('reset role;') }
}
const submit = (db, uid, title, paid, bonus) => asUser(db, uid, () => db.query(
  'select * from public.create_request($1,$2,$3,$4,$5,$6,$7)',
  ['Color Coded Lyrics', 'A', title, '', 'private note', paid, bonus])).then(r => r.rows[0])
const visibleIds = async (db, who) => {
  const q = () => db.query('select id from public.requests order by id').then(r => r.rows.map(x => x.id))
  return who === 'anon' ? asAnon(db, q) : asUser(db, who, q)
}

test('source: migration siết policy + chặn duyệt trước khi xác nhận tiền; rollback mở lại đúng luật cũ', () => {
  assert.match(migration, /alter policy "read requests" on public\.requests/)
  assert.match(migration, /status not in \('pending', 'denied'\) and payment_status <> 'awaiting'/,
    'điều kiện công khai phải loại cả hàng chờ xác nhận tiền')
  assert.match(migration, /user_id = auth\.uid\(\) or public\.is_admin\(\)/,
    'chủ request và admin vẫn đọc được hàng riêng')
  assert.match(migration, /raise exception 'err\.paymentAwaitingOrder'/)
  assert.match(migration, /not \(p_approve and coalesce\(is_paid, false\) and payment_status = 'awaiting'\)/,
    'admin_review_many phải bỏ qua hàng awaiting khi duyệt hàng loạt')
  /* Chữ ký RPC không được đổi — web đang gọi đúng bốn tham số này. */
  assert.match(migration, /create or replace function public\.admin_review\(\s*p_id uuid,\s*p_approve boolean,\s*p_reason text default null,\s*p_video_url text default null\s*\)/)
  assert.match(migration, /create or replace function public\.admin_review_many\(\s*p_ids uuid\[\],\s*p_approve boolean,\s*p_reason text default null,\s*p_video_url text default null\s*\)/)
  /* Rollback: trả lại policy mở và hàm duyệt cũ, không xoá dữ liệu. */
  assert.match(rollback, /alter policy "read requests" on public\.requests\s+using \(true\)/)
  assert.doesNotMatch(rollback, /err\.paymentAwaitingOrder/, 'hàm duyệt của rollback phải là bản CŨ, không giữ guard')
  assert.doesNotMatch(rollback.replace(/--[^\n]*/g, ''), /\bdrop\b|\bdelete\b|\btruncate\b/i,
    'rollback không được xoá dữ liệu')
})

test('PGlite: pending / denied / awaiting chỉ hiện với chủ và admin — khách và người lạ thấy đúng hàng công khai', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const [adminId, aId, bId, cId] = [
      '00000000-0000-4000-8000-0000000000ad',
      '00000000-0000-4000-8000-0000000000aa',
      '00000000-0000-4000-8000-0000000000bb',
      '00000000-0000-4000-8000-0000000000cc',
    ]
    const R = {
      pub1: '10000000-0000-4000-8000-000000000001',
      done1: '10000000-0000-4000-8000-000000000002',
      pend1: '10000000-0000-4000-8000-000000000003',
      deny1: '10000000-0000-4000-8000-000000000004',
      awaitMoney: '10000000-0000-4000-8000-000000000005',
      awaitPending: '10000000-0000-4000-8000-000000000006',
      awaitLegacy: '10000000-0000-4000-8000-000000000007',
    }
    await db.exec(`
      insert into auth.users (id, email) values
        ('${adminId}', 'admin@example.test'), ('${aId}', 'a@example.test'),
        ('${bId}', 'b@example.test'), ('${cId}', 'c@example.test');
      insert into public.profiles (id, name, is_admin) values
        ('${adminId}', 'Admin', true), ('${aId}', 'A', false),
        ('${bId}', 'B', false), ('${cId}', 'C', false)
      on conflict (id) do update set name = excluded.name, is_admin = excluded.is_admin;
      insert into public.requests (id, user_id, kind, artist, title, requester, status, is_paid, payment_status, payment_source) values
        ('${R.pub1}',  '${aId}', 'Color Coded Lyrics', 'IVE', 'Accendio', 'A', 'queued',    false, 'none',      null),
        ('${R.done1}', '${aId}', 'Color Coded Lyrics', 'IVE', 'I AM',     'A', 'completed', false, 'none',      null),
        ('${R.pend1}', '${aId}', 'Color Coded Lyrics', 'aespa', 'Supernova', 'A', 'pending', false, 'none',   null),
        ('${R.deny1}', '${aId}', 'Color Coded Lyrics', 'aespa', 'Drama',  'A', 'denied',    false, 'none',      null),
        ('${R.awaitMoney}',    '${bId}', 'Color Coded Lyrics', 'TWICE', 'Talk that Talk', 'B', 'queued',    true, 'awaiting', 'money'),
        ('${R.awaitPending}',  '${bId}', 'Color Coded Lyrics', 'TWICE', 'The Feels',      'B', 'pending',   true, 'awaiting', 'money'),
        ('${R.awaitLegacy}',   '${bId}', 'Color Coded Lyrics', 'TWICE', 'Fancy',          'B', 'pending',   true, 'awaiting', 'legacy');
    `)

    const publicIds = [R.pub1, R.done1].sort()
    assert.deepEqual(await visibleIds(db, 'anon'), publicIds,
      'khách vãng lai: chỉ hàng đã công bố (không pending/denied/awaiting)')
    assert.deepEqual(await visibleIds(db, cId), publicIds,
      'người dùng khác cũng không dò được bài pending/denied/awaiting của người khác')
    assert.deepEqual(await visibleIds(db, aId), [R.pub1, R.done1, R.pend1, R.deny1].sort(),
      'chủ A thấy cả pending + denied của mình')
    assert.deepEqual(await visibleIds(db, bId), [R.pub1, R.done1, R.awaitMoney, R.awaitPending, R.awaitLegacy].sort(),
      'chủ B thấy hàng chờ tiền của mình — kể cả dòng đã queued nhưng chưa xác nhận (legacy lẫn money)')
    assert.deepEqual(await visibleIds(db, adminId), Object.values(R).sort(),
      'admin thấy toàn bộ để làm việc')
  } finally { await db.close() }
})

test('PGlite: admin_review không duyệt được khi tiền chưa xác nhận; từ chối và duyệt bonus/free vẫn chạy', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const money = await submit(db, member, 'Money song', true, false)
    assert.equal(money.status, 'pending')
    assert.equal(money.payment_status, 'awaiting')

    /* DUYỆT khi còn awaiting: chặn cứng bằng err.paymentAwaitingOrder —
       kể cả từ client cũ gọi thẳng RPC. */
    await assert.rejects(
      asUser(db, admin, () => db.query('select public.admin_review($1,true)', [money.id])),
      /err\.paymentAwaitingOrder/)
    const still = (await db.query('select status, payment_status from public.requests where id=$1', [money.id])).rows[0]
    assert.equal(still.status, 'pending', 'trạng thái không được nhúc nhích sau lệnh duyệt bị chặn')
    assert.equal(still.payment_status, 'awaiting')

    /* TỪ CHỐI hàng awaiting vẫn chạy bình thường (guard chỉ chặn p_approve). */
    await asUser(db, admin, () => db.query('select public.admin_review($1,false,$2)', [money.id, 'no payment']))
    assert.equal((await db.query('select status from public.requests where id=$1', [money.id])).rows[0].status, 'denied')

    /* Bonus (đã trả bằng bonus_requests) và free vẫn duyệt thẳng — regression
       của guard: chỉ hàng awaiting bị chặn. */
    const bonus = await submit(db, member, 'Bonus song', true, true)
    assert.equal(bonus.payment_status, 'paid')
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [bonus.id]))
    assert.equal((await db.query('select status from public.requests where id=$1', [bonus.id])).rows[0].status, 'queued')
    const free = await submit(db, member, 'Free song', false, false)
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [free.id]))
    assert.equal((await db.query('select status from public.requests where id=$1', [free.id])).rows[0].status, 'queued')

    /* HÀNG LOẠT: duyệt [bonus, money-awaiting] chỉ xử lý bonus; từ chối hàng
       loạt vẫn xử lý cả hàng awaiting. */
    const bonus2 = await submit(db, member, 'Bonus bulk', true, true)
    const money2 = await submit(db, member, 'Money bulk', true, false)
    const n = (await asUser(db, admin, () => db.query('select public.admin_review_many($1,true) as n',
      [[bonus2.id, money2.id]]))).rows[0].n
    assert.equal(n, 1, 'hàng awaiting bị bỏ qua, không làm hỏng cả lệnh duyệt')
    assert.equal((await db.query('select status from public.requests where id=$1', [bonus2.id])).rows[0].status, 'queued')
    assert.equal((await db.query('select status, payment_status from public.requests where id=$1', [money2.id])).rows[0].status, 'pending')
    const nDeny = (await asUser(db, admin, () => db.query('select public.admin_review_many($1,false,$2) as n',
      [[money2.id], 'no money']))).rows[0].n
    assert.equal(nDeny, 1, 'từ chối hàng loạt vẫn xử lý hàng awaiting')
    assert.equal((await db.query('select status from public.requests where id=$1', [money2.id])).rows[0].status, 'denied')
  } finally { await db.close() }
})

test('PGlite: admin_order xác nhận tiền xong thì request thành paid/queued và lộ diện công khai', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const money = await submit(db, member, 'Paid song', true, false)
    const o = (await db.query('select * from public.orders where request_id=$1', [money.id])).rows[0]
    assert.ok(o, 'tiền thật phải có đơn hàng đi kèm')
    const ref = `PR-${o.id.replaceAll('-', '').toUpperCase()}`

    assert.deepEqual(await visibleIds(db, 'anon'), [],
      'trước khi xác nhận tiền: khách không thấy gì')

    /* Hộp đối soát đơn: admin bấm "đã nhận tiền" — đúng đường UI nút Confirm
       payment mở tới. */
    await asUser(db, admin, () => db.query('select public.admin_order($1,true,$2,$3,$4,$5)',
      [o.id, 'bank', o.amount_vnd, ref, null]))
    const after = (await db.query('select status, payment_status from public.requests where id=$1', [money.id])).rows[0]
    assert.equal(after.payment_status, 'paid')
    assert.equal(after.status, 'queued')
    assert.deepEqual(await visibleIds(db, 'anon'), [money.id],
      'xác nhận tiền xong thì request là hàng công khai')
    /* Guard không còn chặn: hàng đã paid duyệt/review bình thường. */
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [money.id]))
  } finally { await db.close() }
})

test('PGlite: rollback mở lại policy cũ và trả đường duyệt như trước khi siết', { timeout: 120_000 }, async () => {
  const db = await build()
  try {
    const member = await seedUser(db, 'member@example.test')
    const admin = await seedUser(db, 'admin@example.test', true)
    const money = await submit(db, member, 'Money rollback', true, false)
    assert.deepEqual(await visibleIds(db, 'anon'), [], 'tiền siết: khách không thấy hàng awaiting')

    await assert.rejects(
      asUser(db, admin, () => db.query('select public.admin_review($1,true)', [money.id])),
      /err\.paymentAwaitingOrder/)

    await db.exec(read(ROLLBACK))

    /* Policy `using (true)` cũ: khách thấy lại cả hàng pending/awaiting. */
    assert.deepEqual(await visibleIds(db, 'anon'), [money.id],
      'rollback = luật cũ: bảng công khai thấy lại mọi hàng')
    /* Hàm duyệt cũ: approve thẳng không còn guard. */
    await asUser(db, admin, () => db.query('select public.admin_review($1,true)', [money.id]))
    assert.equal((await db.query('select status from public.requests where id=$1', [money.id])).rows[0].status, 'queued')
  } finally { await db.close() }
})
