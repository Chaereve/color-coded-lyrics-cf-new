import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const migration = read('supabase/migrations/20261106_security_audit.sql')
const comments = read('supabase/migrations/20260920_request_comments.sql')
const privacy = read('supabase/migrations/20261106_security_audit.sql')
const order = read('supabase/migrations/20261103_vote_hardening.sql')
const buy = read('supabase/migrations/20260906_rls_hardening.sql')
const avatar = read('src/lib/avatar.js')

/* These are source-level regression tests for the controls that cannot be
   exercised without a connected staging Supabase project. The staging runbook
   in docs/SECURITY-AUDIT-2026-09-22.md contains the same checks as SQL cases. */
test('low-level season reward cannot be called by an ordinary authenticated user', () => {
  assert.match(migration, /revoke all on function public\.grant_season_reward\(text,int,int,text\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.grant_season_reward\(text,int,int,text\) to service_role/)
  assert.match(migration, /revoke all on function public\.settle_season_rewards\(text,text,timestamptz,timestamptz\)/)
  assert.match(migration, /auth\.uid\(\) is not null and not public\.is_admin\(\)/)
  assert.match(migration, /v_target := p_user_id::uuid/)
})

test('achievement rewards are server-calculated, unique and race-safe', () => {
  assert.match(migration, /create table if not exists public\.achievement_rewards/)
  assert.match(migration, /primary key \(user_id, achievement_id\)/)
  assert.match(migration, /select \* into p from public\.profiles where id = v_uid for update/)
  assert.match(migration, /on conflict \(user_id, achievement_id\) do nothing/)
  assert.match(migration, /create or replace function public\.claim_achievements\(\)/)
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.claim_achievements()')), /p_user_id|p_bonus_votes|p_bonus_requests/)
})

test('activity raw dates are owner-scoped while public profiles receive aggregates', () => {
  assert.match(privacy, /create policy "read own activity days"[\s\S]*user_id = auth\.uid\(\)/)
  assert.match(privacy, /revoke select\s+on public\.activity_days\s+from anon, authenticated/)
  assert.match(privacy, /create or replace function public\.public_streak\(p_user_id uuid\)/)
  assert.match(privacy, /jsonb_build_object\('current', v_current, 'longest', v_longest/)
})

test('comment replies are constrained to the parent request and rate limited', () => {
  assert.match(comments, /p\.request_id = request_comments\.request_id/)
  assert.match(migration, /create or replace function public\.enforce_comment_limits\(\)/)
  assert.match(migration, /interval '1 minute'/)
  assert.match(migration, /limit 5/)
})

test('free paid-request redemption is atomic and cannot be client-priced', () => {
  const create = migration.slice(migration.indexOf('create or replace function public.create_request('))
  assert.match(create, /select name, bonus_requests into v_name, v_bonus_requests[\s\S]*for update/)
  assert.match(create, /p_use_bonus boolean default false/)
  assert.match(create, /where id = v_uid and bonus_requests > 0/)
  assert.match(create, /case when p_use_bonus then 'paid'/)
  assert.doesNotMatch(create, /p_amount|p_reward|p_user_id/)
})

test('admin order approval is one-shot and vote purchase validates fixed prices', () => {
  const start = order.indexOf('create or replace function public.admin_order')
  const end = order.indexOf('-- =========================================================', start + 10)
  const body = order.slice(start, end > start ? end : undefined)
  assert.match(body, /status = 'awaiting'/)
  assert.match(body, /if p_approve then/)
  assert.match(buy, /p_pack = 'v30' and p_qty = 30 and p_usd = 2\.99 and p_vnd = 78000/)
  assert.match(migration, /hashtextextended\(v_uid::text, 20260924\)/)
  assert.match(migration, /v_waiting >= 20/)
})

test('avatar input rejects SVG and checks content signatures before decoding', () => {
  assert.match(avatar, /const RASTER_TYPES = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/)
  assert.match(avatar, /export async function validateImageFile/)
  assert.match(avatar, /hasRasterSignature/)
  assert.doesNotMatch(avatar, /file\.type\.startsWith\('image\/'\)/)
  assert.match(avatar, /uploaded\.protocol !== 'https:'/)
})

test('profile role flag is not selected as public profile data', () => {
  const db = read('src/lib/db.js')
  assert.doesNotMatch(db, /profiles'\)\.select\('id, name, avatar_url, is_admin'/)
  assert.match(db, /supabase\.rpc\('is_admin'\)/)
  assert.match(migration, /grant select \(id, name, avatar_url\) on public\.profiles/)
})
