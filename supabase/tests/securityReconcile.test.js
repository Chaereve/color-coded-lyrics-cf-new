/* 20261123_reconcile_security_drift — chứng minh trên PostgreSQL thật
   ---------------------------------------------------------------------------
   Bốn câu phải trả lời được, mỗi câu một nhóm bài kiểm:

     (1) DỰNG LẠI ĐÚNG DRIFT: một database "giống production" (policy yếu, index
         DESC, overload create_request cũ còn mở như 20261103 để lại) làm
         `verifyBaseline(20261120)` NOT READY với ĐÚNG hai problem thật; sau khi
         áp 20261123 thì READY — tức migration đóng được đúng khoảng cách mà
         không nới điều kiện kiểm.
     (2) POLICY CHẶT HƠN: với trigger `request_comments_limits` TẮT (để cô lập
         phần RLS), các hàng mà policy cũ cho qua — comment có deleted_at, reply
         vào parent đã bị ẩn, reply vắt qua request khác — bị từ chối bằng
         "row-level security"; hàng hợp lệ vẫn vào được.
     (3) FLOW KHÔNG VỠ: luồng comment thật (tạo request → comment → reply → tự
         ẩn comment) chạy nguyên vẹn khi trigger bật trở lại.
     (4) FAIL-CLOSED + KHÔNG ĐỤNG DỮ LIỆU: hình dạng policy thứ ba thì migration
         abort và không đổi gì; mọi bảng quiz/điểm danh/vote giữ nguyên số hàng;
         rollback trả về đúng trạng thái trước, chạy lần hai thì từ chối.
   Chạy: MIGRATION_DEPLOY_TEST_DATABASE_URL=… node --test supabase/tests/securityReconcile.test.js */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { withDatabase, installLevel, migrationSql, seedUser } from './_fixtures.mjs'
import { applyMigration, ensureHistory } from '../../tools/migrate.mjs'
import { verifyBaseline } from '../../tools/schema-readiness.mjs'

const url = process.env.MIGRATION_DEPLOY_TEST_DATABASE_URL
const ID = '20261123_reconcile_security_drift'
const SQL = migrationSql(ID)
const ROLLBACK = readFileSync(new URL(`../rollback/${ID}.sql`, import.meta.url), 'utf8')

/* Overload CŨ của create_request: lấy NGUYÊN VĂN câu lệnh trong migration
   20261103 (không chép tay vào test) để dựng lại đúng thứ production đang có. */
const legacyOverloadSql = () => {
  const src = migrationSql('20261103_vote_hardening')
  const start = src.indexOf('create or replace function public.create_request(')
  assert.ok(start > -1, 'không tìm thấy overload cũ trong 20261103_vote_hardening.sql')
  const end = src.indexOf('end $$;', start)
  assert.ok(end > start, 'không tìm thấy điểm kết thúc thân hàm')
  return src.slice(start, end + 'end $$;'.length) + ';'
}

/* Dựng đúng ba khác biệt mà drift report đo được trên production. */
const buildProductionDrift = async pool => {
  await pool.query(`
    drop policy if exists request_comments_authenticated_insert on public.request_comments;
    create policy request_comments_authenticated_insert
      on public.request_comments for insert to authenticated
      with check (auth.uid() = user_id);
  `)
  await pool.query(`
    drop index if exists public.requests_picked_idx;
    create index requests_picked_idx on public.requests (picked_at desc);
  `)
  await pool.query(legacyOverloadSql())
  /* 20261103 chỉ GRANT cho authenticated, không revoke mặc định ⇒ PUBLIC giữ
     EXECUTE, và anon thừa hưởng qua PUBLIC — đúng như report cho thấy. */
  await pool.query('grant execute on function public.create_request(text,text,text,text,text,boolean) to authenticated')

  /* Quyền mức BẢNG trên request_comments như 20260920 để lại (bundle đã chuyển
     sang quyền theo cột từ 20261107). Report drift KHÔNG thấy trục này vì ACL
     không nằm trong fingerprint — đây đúng là lý do phải kiểm bằng tay. */
  await pool.query('revoke insert, update on public.request_comments from anon, authenticated')
  await pool.query('grant insert, update on public.request_comments to authenticated')

  /* Ba hàm phụ + trigger + index mà migration cũ của repo tạo, bundle không khai
     (dựng bằng bản tối thiểu cùng chữ ký; bản thật nằm trong 20260921/20260922/
     20261108 và được đối chiếu ở bước làm bundle). */
  await pool.query(`
    create function public.queue_expired_requests() returns int language sql security definer as $$ select 0 $$;
    create function public.admin_expire_request(p_id uuid) returns void language plpgsql security definer as $$ begin end $$;
    create function public.requests_video_url_guard() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger requests_video_url_guard before insert or update on public.requests
      for each row execute function public.requests_video_url_guard();
    create index idx_request_comments_req_active on public.request_comments (request_id) where deleted_at is null;
  `)
}

const countTables = ['requests', 'request_comments', 'daily_login_rewards', 'daily_quiz_questions',
  'daily_quiz_config', 'daily_quiz_attempts', 'daily_quiz_answers', 'daily_quiz_seen', 'daily_vote_quota_earnings']
const counts = async pool => {
  const { rows } = await pool.query(`select unnest($1::text[]) as name`, [countTables])
  const present = []
  for (const { name } of rows) {
    if ((await pool.query('select to_regclass($1) as t', [`public.${name}`])).rows[0].t) present.push(name)
  }
  const cols = present.map(n => `(select count(*) from public.${n})::int as ${n}`).join(', ')
  const out = (await pool.query(`select ${cols}`)).rows[0]
  for (const name of countTables) if (!(name in out)) out[name] = -1
  return out
}

const policyText = async pool => (await pool.query(`
  select pg_get_expr(p.polwithcheck, p.polrelid) as expr
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'request_comments' and p.polname = 'request_comments_authenticated_insert'`
)).rows[0].expr

const indexDef = async pool => (await pool.query(
  `select pg_get_indexdef(c.oid) as def from pg_class c where c.oid = 'public.requests_picked_idx'::regclass`)).rows[0].def

/* Hỏi thẳng catalog, đúng cách PostgreSQL trả lời: role này có EXECUTE không, và
   PUBLIC (grantee = 0) có EXECUTE không. */
const canExecute = async (pool, signature, role) => (await pool.query(
  'select has_function_privilege($1, $2::regprocedure, $3) as ok', [role, signature, 'EXECUTE'])).rows[0].ok

const publicCanExecute = async (pool, signature) => (await pool.query(`
  select exists (
    select 1 from pg_proc p,
         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as ok`,
  [signature])).rows[0].ok

/* Chạy một câu lệnh AS một người dùng đã đăng nhập (role authenticated + JWT
   claim), trong transaction riêng, và trả lỗi thay vì ném ra ngoài. */
const runAs = async (client, userId, role, sql, params = [], { commit = false } = {}) => {
  await client.query('begin')
  try {
    await client.query(`set local role ${role}`)
    if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    const result = await client.query(sql, params)
    await client.query(commit ? 'commit' : 'rollback')
    return { rows: result.rows, error: null }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    return { rows: [], error }
  }
}

const seedCommentFixtures = async (pool, userId) => {
  const request = randomUUID()
  const other = randomUUID()
  await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1,$2,'A','B','pending')", [request, userId])
  await pool.query("insert into public.requests (id, user_id, artist, title, status) values ($1,$2,'C','D','pending')", [other, userId])
  const live = randomUUID()
  await pool.query('insert into public.request_comments (id, request_id, user_id, body) values ($1,$2,$3,$4)',
    [live, request, userId, 'live parent'])
  const hidden = randomUUID()
  await pool.query('insert into public.request_comments (id, request_id, user_id, body, deleted_at) values ($1,$2,$3,$4, now())',
    [hidden, request, userId, 'hidden parent'])
  const elsewhere = randomUUID()
  await pool.query('insert into public.request_comments (id, request_id, user_id, body) values ($1,$2,$3,$4)',
    [elsewhere, other, userId, 'parent of another request'])
  return { request, other, live, hidden, elsewhere }
}

test('dựng lại drift production: verify NOT READY đúng 2 mục, sau 20261123 thì READY', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)

    /* Trước: khoảng cách thật so với baseline 20261120 đúng là 2 mục (index +
       policy). Overload cũ chỉ là "note" (object thừa), không phải problem —
       giống hệt kết quả drift report trên production. */
    const before = await verifyBaseline(client, '20261120')
    assert.equal(before.ok, false, 'database giống production phải NOT READY')
    assert.deepEqual(before.problems.map(p => p.kind).sort(), ['incompatible-index', 'incompatible-policy'],
      `chỉ hai mục thật: ${JSON.stringify(before.problems.map(p => `${p.kind}:${p.object}`))}`)

    const dataBefore = await counts(pool)
    await applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL })

    /* Sau: READY — và không nới bất kỳ điều kiện nào của verifier. */
    const after = await verifyBaseline(client, '20261120')
    assert.deepEqual(after.problems, [], `sau reconcile phải sạch: ${JSON.stringify(after.problems)}`)
    assert.equal(after.ok, true)

    /* Migration chỉ đổi cấu trúc/quyền, không đụng một dòng dữ liệu nào. */
    assert.deepEqual(await counts(pool), dataBefore, 'số hàng mọi bảng phải nguyên vẹn')

    /* Policy/khai báo mới phải ĐÚNG là bản của repo. */
    assert.match(policyText(pool) ? await policyText(pool) : '', /deleted_at IS NULL/i)
    assert.match(await indexDef(pool), /WHERE \(picked_at IS NOT NULL\)/)
  })
})

test('policy chặt hơn: chặn đúng những hàng mà policy cũ cho qua (cô lập khỏi trigger)', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    const userId = await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)
    await applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL })
    const fx = await seedCommentFixtures(pool, userId)

    /* Tắt trigger để phần RLS là thứ duy nhất có thể từ chối, VÀ mở đúng một
       cột `deleted_at` cho authenticated: sau phần D của migration thì client
       không còn quyền đặt cột đó, nên phải mở lại để câu hỏi "policy có chặn
       không" được trả lời bằng chính policy chứ không bằng quyền cột. */
    await pool.query('alter table public.request_comments disable trigger request_comments_limits')
    await pool.query('grant insert (deleted_at) on public.request_comments to authenticated')
    try {
      const hiddenRow = await runAs(client, userId, 'authenticated',
        'insert into public.request_comments (request_id, user_id, body, deleted_at) values ($1,$2,$3, now())',
        [fx.request, userId, 'tự ẩn ngay khi tạo'])
      assert.ok(hiddenRow.error, 'comment có deleted_at phải bị từ chối')
      assert.match(hiddenRow.error.message, /row-level security/i,
        `phải là chính sách RLS từ chối: ${hiddenRow.error.message}`)

      const replyToHidden = await runAs(client, userId, 'authenticated',
        'insert into public.request_comments (request_id, user_id, body, parent_id) values ($1,$2,$3,$4)',
        [fx.request, userId, 'reply vào parent đã ẩn', fx.hidden])
      assert.ok(replyToHidden.error, 'reply vào parent đã bị ẩn phải bị từ chối')
      assert.match(replyToHidden.error.message, /row-level security/i)

      const crossRequest = await runAs(client, userId, 'authenticated',
        'insert into public.request_comments (request_id, user_id, body, parent_id) values ($1,$2,$3,$4)',
        [fx.request, userId, 'reply vắt qua request khác', fx.elsewhere])
      assert.ok(crossRequest.error, 'reply vào parent của request khác phải bị từ chối')

      /* Hàng hợp lệ vẫn phải vào được — nếu không thì "chặt hơn" đã thành "hỏng". */
      const root = await runAs(client, userId, 'authenticated',
        'insert into public.request_comments (request_id, user_id, body) values ($1,$2,$3) returning id',
        [fx.request, userId, 'comment gốc'])
      assert.equal(root.error, null, `comment gốc phải vào được: ${root.error?.message}`)

      const reply = await runAs(client, userId, 'authenticated',
        'insert into public.request_comments (request_id, user_id, body, parent_id) values ($1,$2,$3,$4) returning id',
        [fx.request, userId, 'reply hợp lệ', fx.live])
      assert.equal(reply.error, null, `reply vào parent còn sống phải vào được: ${reply.error?.message}`)
    } finally {
      await pool.query('alter table public.request_comments enable trigger request_comments_limits')
    }
  })
})

test('flow comment không vỡ: tạo request → comment → reply → xoá, trigger vẫn bật', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    const userId = await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)
    await applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL })

    /* Đường tạo request ĐANG DÙNG vẫn chạy (7 tham số, authenticated). */
    const created = await runAs(client, userId, 'authenticated',
      'select (public.create_request($1::text,$2::text,$3::text,$4::text,$5::text,false::boolean,false::boolean)).id as id',
      ['Color Coded Lyrics', 'aespa', 'Whiplash', 'https://youtu.be/x', 'ghi chú'], { commit: true })
    assert.equal(created.error, null, `create_request 7 tham số phải chạy: ${created.error?.message}`)
    const request = created.rows[0].id

    const root = await runAs(client, userId, 'authenticated',
      'insert into public.request_comments (request_id, user_id, body) values ($1,$2,$3) returning id',
      [request, userId, 'comment gốc'], { commit: true })
    assert.equal(root.error, null, `comment phải vào được: ${root.error?.message}`)

    const reply = await runAs(client, userId, 'authenticated',
      'insert into public.request_comments (request_id, user_id, body, parent_id) values ($1,$2,$3,$4) returning id',
      [request, userId, 'reply', root.rows[0].id], { commit: true })
    assert.equal(reply.error, null, `reply phải vào được: ${reply.error?.message}`)

    /* Đường XOÁ THẬT của app là DELETE (src/lib/db.js `deleteComment`), không
       phải UPDATE deleted_at: bundle (20261107) đã rút quyền UPDATE khỏi client
       đúng để không ai tự ẩn/hiện một nhánh comment. */
    const removed = await runAs(client, userId, 'authenticated',
      'delete from public.request_comments where id = $1 returning id', [reply.rows[0].id], { commit: true })
    assert.equal(removed.error, null, `tự xoá comment phải chạy được: ${removed.error?.message}`)

    /* Reply vào parent vừa bị xoá: bị chặn, và lỗi đi qua câu có i18n
       (err.commentParent) chứ không phải text thô của PostgreSQL. */
    const after = await runAs(client, userId, 'authenticated',
      'insert into public.request_comments (request_id, user_id, body, parent_id) values ($1,$2,$3,$4)',
      [request, userId, 'reply sau khi xoá', reply.rows[0].id])
    assert.ok(after.error, 'reply vào parent vừa bị xoá phải bị chặn')
    assert.match(after.error.message, /err\.commentParent|violates foreign key/i)

    /* Đường ẨN của moderation (admin/service, UPDATE deleted_at) vẫn chạy và
       vẫn ẩn cả nhánh — đây là lý do trigger hide_comment_subtree phải còn. */
    const softHidden = await runAs(client, userId, 'authenticated',
      'update public.request_comments set deleted_at = now() where id = $1', [root.rows[0].id])
    assert.ok(softHidden.error, 'client KHÔNG được tự ẩn comment bằng UPDATE (bundle rút quyền này)')
    const moderated = await pool.query(
      'update public.request_comments set deleted_at = now() where id = $1 returning id', [root.rows[0].id])
    assert.equal(moderated.rowCount, 1, 'đường moderation (quyền cao hơn) vẫn ẩn được')
  })
})

test('overload cũ: đo được vì sao nó KHÔNG phải lỗ hổng ghi dữ liệu, và vì sao nó vẫn nên đóng', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    const userId = await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)

    /* (i) Reachability: khi CÒN bản 7 tham số (có default cho p_use_bonus), một
       lời gọi 6 tham số là NHẬP NHẰNG — PostgreSQL từ chối vì hai ứng viên cùng
       khớp. Nghĩa là bundle cũ không thể "rơi" vào overload cũ bằng arity, và
       một kẻ tấn công cũng không gọi được nó qua PostgREST. Đây là bằng chứng
       cho kết luận: EXECUTE cho anon là bề mặt thừa, KHÔNG phải đường ghi dữ
       liệu, và cũng KHÔNG phải đường vượt rate-limit trong thực tế. */
    const ambiguous = await runAs(client, userId, 'authenticated',
      'select public.create_request($1::text,$2::text,$3::text,$4::text,$5::text,false::boolean) as r',
      ['Color Coded Lyrics', 'a', 'b', null, null])
    assert.ok(ambiguous.error, 'gọi 6 tham số phải lỗi')
    assert.match(ambiguous.error.message, /is not unique|ambiguous/i,
      `phải là lỗi nhập nhằng giữa hai overload: ${ambiguous.error.message}`)

    /* (ii) Bản thân overload cũ cũng tự chặn người gọi ẩn danh: auth.uid() null
       ⇒ raise err.requestAuth TRƯỚC khi ghi. Chứng minh trên database dùng một
       lần này bằng cách bỏ tạm bản 7 tham số để gọi được đúng nó. */
    await pool.query('drop function public.create_request(text,text,text,text,text,boolean,boolean)')
    const anon = await runAs(client, null, 'anon',
      'select public.create_request($1::text,$2::text,$3::text,$4::text,$5::text,false::boolean) as r',
      ['Color Coded Lyrics', 'x', 'y', null, null])
    assert.ok(anon.error, 'anon không được tạo request')
    assert.match(anon.error.message, /err\.requestAuth/)
    assert.equal((await counts(pool)).requests, 0, 'anon không được ghi hàng nào — EXECUTE cho anon không phải lỗ hổng GHI')

    /* (iii) Khác biệt thật của bản cũ so với bản đang dùng, đo bằng chính thân
       hàm: không có `for update` trên profiles, nên phép đếm-rồi-chèn của nó là
       racy khi có nhiều lời gọi song song (bản mới khoá hàng profiles trước khi
       đếm). */
    const legacyBody = (await pool.query(
      `select pg_get_functiondef('public.create_request(text,text,text,text,text,boolean)'::regprocedure) as d`)).rows[0].d
    assert.doesNotMatch(legacyBody, /for update/i, 'overload cũ KHÔNG có for update (giới hạn 3/giờ là racy)')
    assert.match(migrationSql('20261106_security_audit'),
      /select name, bonus_requests into v_name, v_bonus_requests[\s\S]{0,120}for update/i,
      'bản đang dùng CÓ for update (khoá hàng profiles trước khi đếm)')

    /* (iv) Đo thêm một khác biệt về CHẤT LƯỢNG LỖI: khi người dùng không có
       hàng profiles, bản mới từ chối bằng 'err.requestAuth' (câu có i18n), còn
       bản cũ đi tiếp và vỡ ở FK của bảng watches — lỗi thô, errMsg sẽ trả
       err.generic. Không phải đường vượt giới hạn, nhưng là lý do thứ hai để
       đường cũ không nên còn mở. */
    await pool.query('delete from public.profiles where id = $1', [userId])
    const before = (await counts(pool)).requests
    const legacyNoProfile = await runAs(client, userId, 'authenticated',
      'select public.create_request($1::text,$2::text,$3::text,$4::text,$5::text,false::boolean) as r',
      ['Color Coded Lyrics', 'c', 'd', null, null])
    assert.ok(legacyNoProfile.error, 'thiếu hàng profiles thì bản cũ cũng không xong')
    assert.doesNotMatch(legacyNoProfile.error.message, /err\.requestAuth/,
      'bản cũ không kiểm tra profiles — nó vỡ ở tầng FK, không phải ở câu lỗi có i18n')
    assert.equal((await counts(pool)).requests, before, 'vỡ ở FK thì không hàng nào được ghi')
  })
})

test('sau reconcile: overload cũ đóng, ACL đúng ý repo, bản 7 tham số vẫn mở', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)
    await applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL })

    const LEGACY = 'public.create_request(text,text,text,text,text,boolean)'
    const CURRENT = 'public.create_request(text,text,text,text,text,boolean,boolean)'
    assert.equal(await publicCanExecute(pool, LEGACY), false, 'overload cũ không còn quyền PUBLIC')
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await canExecute(pool, LEGACY, role), false, `overload cũ phải đóng với ${role}`)
    }
    assert.equal(await canExecute(pool, CURRENT, 'authenticated'), true, 'bản đang dùng vẫn phải gọi được bởi authenticated')
    assert.equal(await canExecute(pool, CURRENT, 'anon'), false, 'bản đang dùng không bao giờ mở cho anon')

    for (const role of ['anon', 'authenticated']) {
      assert.equal(await canExecute(pool, 'public.queue_expired_requests()', role), false, `queue_expired_requests() phải đóng với ${role}`)
      assert.equal(await canExecute(pool, 'public.requests_video_url_guard()', role), false, `requests_video_url_guard() phải đóng với ${role}`)
    }
    assert.equal(await canExecute(pool, 'public.queue_expired_requests()', 'service_role'), true, 'service_role vẫn gọi được queue_expired_requests()')
    assert.equal(await canExecute(pool, 'public.admin_expire_request(uuid)', 'authenticated'), true, 'admin_expire_request vẫn cho authenticated')
    assert.equal(await canExecute(pool, 'public.admin_expire_request(uuid)', 'anon'), false, 'admin_expire_request không cho anon')

    /* Phần D: quyền theo cột, không mức bảng, và client không đặt được deleted_at. */
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await pool.query(
        'select has_table_privilege($1, $2, $3) as ok', [role, 'public.request_comments', 'INSERT'])).rows[0].ok, false,
      `${role} không được có INSERT mức bảng trên request_comments`)
    }
    for (const column of ['request_id', 'user_id', 'parent_id', 'body']) {
      assert.equal((await pool.query(
        'select has_column_privilege($1, $2, $3, $4) as ok', ['authenticated', 'public.request_comments', column, 'INSERT'])).rows[0].ok, true,
      `authenticated phải còn quyền INSERT cột ${column} (app cần)`)
    }
    assert.equal((await pool.query(
      'select has_column_privilege($1, $2, $3, $4) as ok', ['authenticated', 'public.request_comments', 'deleted_at', 'INSERT'])).rows[0].ok, false,
    'authenticated KHÔNG được đặt deleted_at khi INSERT')

    /* Trigger bảo vệ video_url (chống javascript: XSS) vẫn còn sống. */
    assert.equal((await pool.query(
      `select count(*)::int as n from pg_trigger where tgrelid = 'public.requests'::regclass
        and tgname = 'requests_video_url_guard' and not tgisinternal`)).rows[0].n, 1)
  })
})

test('fail-closed: policy ở hình dạng thứ ba thì abort và không đổi gì', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)

    const odd = "auth.uid() = user_id and deleted_at is null"
    await pool.query(`drop policy request_comments_authenticated_insert on public.request_comments`)
    await pool.query(`create policy request_comments_authenticated_insert on public.request_comments
      for insert to authenticated with check (${odd})`)
    const before = await counts(pool)

    await assert.rejects(
      () => applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL }),
      /err\.reconcilePreflight/, 'trạng thái lạ phải abort ở tiền kiểm tra')
    assert.match(await policyText(pool), /deleted_at IS NULL/, 'policy phải nguyên vẹn sau khi abort')
    assert.match(await indexDef(pool), /picked_at DESC/i, 'index phải nguyên vẹn sau khi abort')
    assert.deepEqual(await counts(pool), before, 'abort không được đổi dữ liệu')
    assert.equal((await pool.query(
      `select count(*)::int as n from supabase_migrations.schema_migrations where version = $1`, [ID])).rows[0].n, 0,
      'abort không được ghi dòng history')
  })
})

test('rollback: trả đúng trạng thái trước, chạy lần hai thì từ chối', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    await seedUser(pool)
    await buildProductionDrift(pool)
    await ensureHistory(client)

    const weakBefore = await policyText(pool)
    const indexBefore = await indexDef(pool)
    const dataBefore = await counts(pool)

    await applyMigration(client, { id: ID, name: `${ID}.sql`, sql: SQL })
    assert.notEqual(await policyText(pool), weakBefore)
    assert.notEqual(await indexDef(pool), indexBefore)

    await client.query(ROLLBACK)
    assert.equal(await policyText(pool), weakBefore, 'policy phải trả về nguyên văn cũ (đọc từ comment)')
    assert.equal(await indexDef(pool), indexBefore, 'index phải trả về nguyên văn cũ (đọc từ comment)')
    assert.equal(await canExecute(pool, 'public.create_request(text,text,text,text,text,boolean)', 'anon'), true,
      'rollback mở lại overload cũ như trước reconcile')
    assert.equal((await pool.query(
      'select has_table_privilege($1, $2, $3) as ok', ['authenticated', 'public.request_comments', 'INSERT'])).rows[0].ok, true,
    'rollback trả lại INSERT mức bảng như trước reconcile')
    assert.deepEqual(await counts(pool), dataBefore, 'rollback không đụng dữ liệu')

    await assert.rejects(() => client.query(ROLLBACK), /err\.reconcileRollback/,
      'rollback chạy lần hai phải fail-closed')
  })
})

test('tệp migration không xoá/ghi dữ liệu và không đụng chính sách thưởng', () => {
  const code = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  for (const forbidden of [/\bdelete\s+from\b/i, /\btruncate\b/i, /\bdrop\s+table\b/i, /\bdrop\s+column\b/i,
    /update\s+(?:public\.)?daily_login_rewards/i, /free_vote_grant_enabled/i, /\bgrant\b[\s\S]{0,40}create_request\(text,text,text,text,text,boolean\)[\s\S]{0,40}\bto\s+anon\b/i]) {
    assert.doesNotMatch(code, forbidden, `tệp migration không được chứa ${forbidden}`)
  }
  assert.match(SQL, /revoke all on function public\.create_request\(text,text,text,text,text,boolean\)/)
})

test('cửa sổ khoá của phần B: dựng lại index trên bảng cỡ thật là vài chục ms', { skip: !url, timeout: 240_000 }, async () => {
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')
    const userId = await seedUser(pool)
    await buildProductionDrift(pool)
    /* 5.000 hàng requests — lớn hơn production hiện tại (vài nghìn) để con số
       dưới đây là cận trên, không phải con số đẹp. */
    await pool.query(`
      insert into public.requests (user_id, artist, title, status, picked_at)
      select $1, 'a', 'b', 'pending', case when g % 3 = 0 then now() end
        from generate_series(1, 5000) g`, [userId])
    const started = Date.now()
    await pool.query('drop index public.requests_picked_idx')
    await pool.query('create index requests_picked_idx on public.requests (picked_at) where picked_at is not null')
    const ms = Date.now() - started
    console.log(`  (đo được: drop+create requests_picked_idx trên 5.000 hàng = ${ms} ms)`)
    assert.ok(ms < 2000, `dựng index không được kéo dài bất thường: ${ms} ms`)
  })
})

test('rollback trên database KHÔNG có overload cũ: từ chối bằng RAISE, không vỡ 42883', { skip: !url, timeout: 120_000 }, async () => {
  /* Bẫy đã gặp thật: `to_regprocedure(...) is not null and has_function_privilege(role,
     'literal'::regprocedure, ...)` — PostgreSQL gấp hằng số của phép cast NGAY CẢ khi vế
     trước là false, nên trên database cài mới từ bundle (bundle drop bản 5 tham số) câu
     lệnh vỡ bằng 42883 "function … does not exist" thay vì bỏ qua. Rollback phải dùng
     has_function_privilege(role, to_regprocedure(...), 'EXECUTE'). */
  await withDatabase(url, async (pool, client) => {
    await installLevel(pool, 'fresh')  // bundle: KHÔNG có create_request 5 tham số
    assert.equal((await client.query(
      "select to_regprocedure('public.create_request(text,text,text,text,text,boolean)') as f")).rows[0].f, null)
    await pool.query(SQL)  // phần C1 chỉ raise notice rồi đi tiếp
    const before = await counts(pool)
    const err = await pool.query(ROLLBACK).then(() => null, e => e)
    assert.ok(err, 'rollback phải từ chối trên DB không có trạng thái do 20261123 ghi lại')
    assert.match(err.message, /err\.reconcileRollback/, `phải là RAISE có chủ đích: ${err.message}`)
    assert.doesNotMatch(err.message, /42883|does not exist/,
      `không được vỡ vì gấp hằng số của ::regprocedure: ${err.message}`)
    assert.deepEqual(await counts(pool), before, 'từ chối thì không đổi gì')
  })
})
