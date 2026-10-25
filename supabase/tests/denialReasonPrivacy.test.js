import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261217_private_denial_reasons.sql'), 'utf8')
const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
const db = readFileSync(path.join(root, 'src/lib/db.js'), 'utf8')

test('deny_reason is unreadable by table query and returned only through owner/admin RPC', () => {
  assert.match(migration, /revoke select on table public\.requests from public, anon, authenticated/i)
  assert.match(migration, /grant select \(([\s\S]*?)\) on table public\.requests to anon, authenticated/i)
  assert.doesNotMatch(migration.match(/grant select \(([\s\S]*?)\) on table public\.requests to anon, authenticated/i)?.[1] || '', /deny_reason/i)
  assert.match(migration, /create or replace function public\.get_visible_denial_reasons\(\)[\s\S]*?security definer/i)
  assert.match(migration, /r\.user_id = auth\.uid\(\) or public\.is_admin\(\)/i)
  assert.match(migration, /grant execute on function public\.get_visible_denial_reasons\(\)\s+to authenticated/i)
  assert.doesNotMatch(schema, /get_visible_denial_reasons/, 'fresh-install bundle must stay at its committed baseline')
})

test('client does not select or cache denial reasons in the public request query', () => {
  assert.match(db, /get_visible_denial_reasons/)
  assert.match(db, /select\('id,user_id,kind,artist,title,link,note,requester,status,progress,votes,is_paid,payment_status,done_layout,done_lyrics,done_edit,video_url,picked_at,expired_at,created_at,updated_at'\)/)
  assert.doesNotMatch(db, /from\('requests'\)\.select\('\*'\)/)
})
