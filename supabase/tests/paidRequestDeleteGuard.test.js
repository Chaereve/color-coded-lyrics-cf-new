import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261217_protect_paid_request_orders.sql'), 'utf8')
const strings = readFileSync(path.join(root, 'src/lib/strings.js'), 'utf8')

test('request deletion is blocked while an awaiting or paid order still points to it', () => {
  assert.match(migration, /create or replace function public\.prevent_request_delete_with_active_order\(\)/i)
  assert.match(migration, /security definer[\s\S]*?set search_path = public/i)
  assert.match(migration, /o\.request_id = old\.id[\s\S]*?o\.status in \('awaiting', 'paid'\)/i)
  assert.match(migration, /raise exception 'err\.requestHasActiveOrder'/i)
  assert.match(migration, /before delete on public\.requests[\s\S]*?execute function public\.prevent_request_delete_with_active_order\(\)/i)
  assert.match(strings, /'err\.requestHasActiveOrder': 'Cancel the linked payment order before deleting this request\.'/)
})

test('PostgreSQL trigger blocks active paid orders, but allows deleting after the order is removed', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table public.requests (id uuid primary key);
      create table public.orders (
        id uuid primary key,
        request_id uuid references public.requests(id) on delete set null,
        status text not null check (status in ('awaiting', 'paid', 'rejected'))
      );
    `)
    await db.exec(migration)

    await db.query("insert into public.requests values ('00000000-0000-0000-0000-000000000001')")
    await db.query("insert into public.orders values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'awaiting')")
    await assert.rejects(
      db.query("delete from public.requests where id = '00000000-0000-0000-0000-000000000001'"),
      /err\.requestHasActiveOrder/,
    )
    const linked = await db.query("select request_id from public.orders where id = '10000000-0000-0000-0000-000000000001'")
    assert.equal(linked.rows[0].request_id, '00000000-0000-0000-0000-000000000001')

    /* cancel_my_order uses this order of operations: remove the awaiting order,
       then the request. The new guard must not block the authorized cancel path. */
    await db.query("delete from public.orders where id = '10000000-0000-0000-0000-000000000001'")
    await db.query("delete from public.requests where id = '00000000-0000-0000-0000-000000000001'")
    const remaining = await db.query('select count(*)::int as n from public.requests')
    assert.equal(remaining.rows[0].n, 0)

    await db.query("insert into public.requests values ('00000000-0000-0000-0000-000000000002')")
    await db.query("insert into public.orders values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'paid')")
    await assert.rejects(
      db.query("delete from public.requests where id = '00000000-0000-0000-0000-000000000002'"),
      /err\.requestHasActiveOrder/,
    )
  } finally {
    await db.close()
  }
})

test('the regular cancel flow may delete an awaiting order before deleting its request', () => {
  const cancelOrder = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  const body = cancelOrder.match(/create or replace function public\.cancel_my_order\([\s\S]*?\$\$;/i)?.[0] || ''
  assert.ok(body, 'cancel_my_order must remain in the baseline schema')
  assert.ok(body.indexOf('delete from public.orders') < body.indexOf('delete from public.requests'),
    'the order must be removed first so the request guard allows the authorized cancellation flow')
})
