import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migration = readFileSync(fileURLToPath(new URL('../migrations/20261218_votes_received_recent_first.sql', import.meta.url)), 'utf8')

test('votes_received returns recent events first without exposing voter identity', () => {
  assert.match(migration, /create or replace function public\.votes_received\(p_since timestamptz\)/i)
  assert.match(migration, /returns table\s*\(request_id uuid, created_at timestamptz\)/i)
  assert.match(migration, /select v\.request_id, v\.created_at\s+from public\.votes v/i)
  assert.match(migration, /order by v\.created_at desc, v\.id desc\s+limit 10000/i)
  assert.doesNotMatch(migration, /select[^;]*v\.user_id/i)
  assert.match(migration, /revoke all on function public\.votes_received\(timestamptz\) from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.votes_received\(timestamptz\) to anon, authenticated/i)
})
