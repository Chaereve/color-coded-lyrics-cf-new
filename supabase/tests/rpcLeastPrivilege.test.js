import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261217_rpc_least_privilege.sql'), 'utf8')
const normalized = migration.replace(/\s+/g, ' ').toLowerCase()

const protectedFunctions = [
  'admin_media_delete(uuid)',
  'admin_media_reorder(uuid[])',
  'admin_media_save(uuid, text, text, text, text, text, boolean)',
  'admin_order(uuid, boolean)',
  'admin_pick(uuid, boolean)',
  'admin_update(uuid, text, integer, text, boolean, boolean, boolean, text, text)',
  'cancel_my_order(uuid)',
  'delete_my_request(uuid)',
  'toggle_watch(text, text)',
]

test('public table privileges and authenticated-only RPCs are narrowed safely', () => {
  assert.match(normalized, /revoke truncate, references, trigger on all tables in schema public from anon, authenticated/)
  for (const signature of protectedFunctions) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(normalized, new RegExp(`revoke all on function public\\.${escaped} from public, anon`), signature)
    assert.match(normalized, new RegExp(`grant execute on function public\\.${escaped} to authenticated`), signature)
  }

  assert.doesNotMatch(normalized, /revoke all on function public\.(?:votes_received|public_streak)\(/,
    'the public ranking/activity read endpoints are intentionally left callable')
})

test('least-privilege migration executes and removes anon RPC/table capabilities', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role supabase_admin;
      create table public.media (id uuid);
      create table public.orders (id uuid);
      create table public.requests (id uuid);
      grant all on all tables in schema public to anon, authenticated;

      create function public.admin_media_delete(uuid) returns void language sql as $$ select $$;
      create function public.admin_media_reorder(uuid[]) returns void language sql as $$ select $$;
      create function public.admin_media_save(uuid,text,text,text,text,text,boolean) returns media language sql as $$ select null::public.media $$;
      create function public.admin_order(uuid,boolean) returns orders language sql as $$ select null::public.orders $$;
      create function public.admin_pick(uuid,boolean) returns requests language sql as $$ select null::public.requests $$;
      create function public.admin_update(uuid,text,integer,text,boolean,boolean,boolean,text,text) returns requests language sql as $$ select null::public.requests $$;
      create function public.cancel_my_order(uuid) returns void language sql as $$ select $$;
      create function public.delete_my_request(uuid) returns void language sql as $$ select $$;
      create function public.toggle_watch(text,text) returns boolean language sql as $$ select false $$;
      create function public.votes_received(timestamptz) returns table(request_id uuid, created_at timestamptz) language sql as $$ select null::uuid, now() where false $$;
      create function public.public_streak(uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
    `)

    await db.exec(migration)

    for (const signature of protectedFunctions) {
      assert.equal((await db.query(`select has_function_privilege('anon', 'public.${signature}', 'execute') as allowed`)).rows[0].allowed, false, signature)
      assert.equal((await db.query(`select has_function_privilege('authenticated', 'public.${signature}', 'execute') as allowed`)).rows[0].allowed, true, signature)
    }
    assert.equal((await db.query("select has_function_privilege('anon', 'public.votes_received(timestamptz)', 'execute') as allowed")).rows[0].allowed, true)
    assert.equal((await db.query("select has_function_privilege('anon', 'public.public_streak(uuid)', 'execute') as allowed")).rows[0].allowed, true)

    for (const table of ['media', 'orders', 'requests']) {
      assert.equal((await db.query(`select has_table_privilege('anon', 'public.${table}', 'truncate') as allowed`)).rows[0].allowed, false, `${table} truncate`)
      assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.${table}', 'trigger') as allowed`)).rows[0].allowed, false, `${table} trigger`)
    }
  } finally {
    await db.close()
  }
})
