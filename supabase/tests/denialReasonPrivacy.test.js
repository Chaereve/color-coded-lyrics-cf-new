import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261217_private_denial_reasons.sql'), 'utf8')
const notifyFix = readFileSync(path.join(root, 'supabase/migrations/20261220_review_notify_privacy_fix.sql'), 'utf8')
const notifyRollback = readFileSync(path.join(root, 'supabase/rollback/20261220_review_notify_privacy_fix.sql'), 'utf8')
const inboxFix = readFileSync(path.join(root, 'supabase/migrations/20261221_notification_inbox_fix.sql'), 'utf8')
const inboxRollback = readFileSync(path.join(root, 'supabase/rollback/20261221_notification_inbox_fix.sql'), 'utf8')
const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
const db = readFileSync(path.join(root, 'src/lib/db.js'), 'utf8')

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

test('deny_reason is unreadable by table query and returned only through owner/admin RPC', () => {
  assert.match(migration, /revoke select on table public\.requests from public, anon, authenticated/i)
  assert.match(migration, /grant select \(([\s\S]*?)\) on table public\.requests to anon, authenticated/i)
  assert.doesNotMatch(migration.match(/grant select \(([\s\S]*?)\) on table public\.requests to anon, authenticated/i)?.[1] || '', /deny_reason/i)
  assert.match(migration, /create or replace function public\.get_visible_denial_reasons\(\)[\s\S]*?security definer/i)
  assert.match(migration, /r\.user_id = auth\.uid\(\) or public\.is_admin\(\)/i)
  assert.match(migration, /grant execute on function public\.get_visible_denial_reasons\(\)\s+to authenticated/i)
  assert.match(notifyFix, /order by coalesce\(r\.updated_at, r\.created_at\) desc, r\.id desc/i)
  assert.doesNotMatch(schema, /get_visible_denial_reasons/, 'fresh-install bundle must stay at its committed baseline')
})

test('client does not select or cache denial reasons in the public request query', () => {
  assert.match(db, /get_visible_denial_reasons/)
  assert.match(db, /select\('id,user_id,kind,artist,title,link,note,requester,status,progress,votes,is_paid,payment_status,done_layout,done_lyrics,done_edit,video_url,picked_at,expired_at,created_at,updated_at'\)/)
  assert.doesNotMatch(db, /from\('requests'\)\.select\('\*'\)/)
})

test('PGlite: requests_notify never leaks deny_reason to third-party watchers, avoids duplicate review notices, and orders denial reasons newest-first', async () => {
  const pg = new PGlite({ extensions: { pgcrypto } })
  try {
    await pg.exec(SCAFFOLD)
    await pg.exec(schema)
    await pg.exec(readFileSync(path.join(root, 'supabase/migrations/20261215_notify_requester_review.sql'), 'utf8'))
    await pg.exec(migration)
    await pg.exec(notifyFix)

    const adminId = '00000000-0000-4000-8000-000000000001'
    const ownerId = '00000000-0000-4000-8000-000000000002'
    const voterId = '00000000-0000-4000-8000-000000000003'
    const req1 = '10000000-0000-4000-8000-000000000001'
    const req2 = '10000000-0000-4000-8000-000000000002'
    const reqVoter = '10000000-0000-4000-8000-000000000003'

    await pg.exec(`
      insert into auth.users (id, email) values
        ('${adminId}', 'admin@example.test'),
        ('${ownerId}', 'owner@example.test'),
        ('${voterId}', 'voter@example.test');
      insert into public.profiles (id, name, is_admin) values
        ('${adminId}', 'Admin', true),
        ('${ownerId}', 'Owner', false),
        ('${voterId}', 'Voter', false)
      on conflict (id) do update set name = excluded.name, is_admin = excluded.is_admin;

      -- Another user also requested/voted the exact same song key ("ive|accendio")
      insert into public.requests (id, user_id, kind, artist, title, requester, status, votes, created_at, updated_at) values
        ('${reqVoter}', '${voterId}', 'Color Coded Lyrics', 'IVE', 'Accendio', 'Voter', 'queued', 3, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
        ('${req1}', '${ownerId}', 'Color Coded Lyrics', 'IVE', 'Accendio', 'Owner', 'pending', 0, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z'),
        ('${req2}', '${ownerId}', 'Color Coded Lyrics', 'aespa', 'Supernova', 'Owner', 'denied', 0, '2026-10-03T00:00:00Z', '2026-10-03T00:00:00Z');
      update public.requests set deny_reason = 'Older denial note' where id = '${req2}';
      delete from public.notifications;
    `)

    // Admin reviews req1 -> denied with a private reason
    await pg.exec(`
      select set_config('request.jwt.claim.sub', '${adminId}', false);
      select public.admin_review('${req1}'::uuid, false, 'Private personal note for Owner only');
    `)

    const voterNotices = await pg.query(
      `select kind, reason, sig from public.notifications where user_id = $1`,
      [voterId],
    )
    assert.equal(voterNotices.rows.length, 0, 'third-party co-requester/voter must never receive Owner denial notifications')

    const ownerNotices = await pg.query(
      `select kind, reason, sig from public.notifications where user_id = $1`,
      [ownerId],
    )
    assert.equal(ownerNotices.rows.length, 1, 'owner receives exactly 1 deduplicated denied notification')
    assert.equal(ownerNotices.rows[0].kind, 'denied')
    assert.equal(ownerNotices.rows[0].reason, 'Private personal note for Owner only')
    assert.equal(ownerNotices.rows[0].sig, `review|${req1}|denied`)

    // Verify get_visible_denial_reasons orders newest updated_at first (req1 denied after req2)
    await pg.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false);`)
    const reasons = await pg.query(`select id, deny_reason from public.get_visible_denial_reasons()`)
    assert.deepEqual(
      reasons.rows.map(r => [r.id, r.deny_reason]),
      [
        [req1, 'Private personal note for Owner only'],
        [req2, 'Older denial note'],
      ],
      'most recently updated denied row must come first so PostgREST row caps never drop recent notes',
    )

    // Verify 20261221_notification_inbox_fix: admin_expire_request notifies owned requests
    // AND deletes requests whose owner has no public.profiles row (requests.user_id -> auth.users,
    // notifications.user_id -> public.profiles) without failing with an FK/NOT NULL error
    await pg.exec(inboxFix)
    const orphanUserId = '00000000-0000-4000-8000-000000000099'
    const reqOwnedExp = '10000000-0000-4000-8000-000000000004'
    const reqOrphanExp = '10000000-0000-4000-8000-000000000005'
    await pg.exec(`
      insert into auth.users (id, email) values ('${orphanUserId}', 'orphan@example.test');
      delete from public.profiles where id = '${orphanUserId}';
      insert into public.requests (id, user_id, kind, artist, title, requester, status, votes) values
        ('${reqOwnedExp}', '${ownerId}', 'Color Coded Lyrics', 'NewJeans', 'Ditto', 'Owner', 'queued', 0),
        ('${reqOrphanExp}', '${orphanUserId}', 'Color Coded Lyrics', 'LE SSERAFIM', 'CRAZY', 'Seed', 'pending', 0);
      select set_config('request.jwt.claim.sub', '${adminId}', false);
      select public.admin_expire_request('${reqOwnedExp}'::uuid);
      select public.admin_expire_request('${reqOrphanExp}'::uuid);
    `)
    const remainingExp = await pg.query(
      `select id from public.requests where id in ($1, $2)`,
      [reqOwnedExp, reqOrphanExp],
    )
    assert.equal(remainingExp.rows.length, 0, 'both owned and profileless expired requests must be deleted cleanly')
    const expNotices = await pg.query(
      `select user_id, kind, sig from public.notifications where sig like 'expiry-user|%'`,
    )
    assert.equal(expNotices.rows.length, 1, 'only the owned expired request inserts a user notification')
    assert.equal(expNotices.rows[0].user_id, ownerId)
    assert.equal(expNotices.rows[0].sig, `expiry-user|${reqOwnedExp}`)

    // Verify rollback scripts are valid SQL
    await pg.exec(inboxRollback)
    await pg.exec(notifyRollback)
  } finally {
    await pg.close()
  }
})
