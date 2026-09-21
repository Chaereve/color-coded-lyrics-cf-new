import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const migration = readFileSync(`${root}supabase/migrations/20260921_replies_request_expiry.sql`, 'utf8')
const schema = readFileSync(`${root}supabase/schema.sql`, 'utf8')

test('reply schema keeps parent rows and expiry is a human-confirmed deletion', () => {
  assert.match(migration, /add column if not exists parent_id uuid references public\.request_comments/)
  assert.match(migration, /queue_expired_requests\(\)/)
  assert.match(migration, /created_at < now\(\) - interval '1 month'/)
  assert.match(migration, /admin_expire_request\(p_id uuid\)/)
  assert.match(migration, /This request expired after one month and was deleted\./)
  assert.match(migration, /cron\.schedule\('queue-expired-requests'/)
})

test('canonical schema mirrors replies, expired_at and the expired notification kind', () => {
  assert.match(schema, /parent_id uuid references public\.request_comments/)
  assert.match(schema, /expired_at\s+timestamptz/)
  assert.match(schema, /'expired'\)\)/)
})
