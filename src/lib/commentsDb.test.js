import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Load the real db.js through Vite (import.meta.env) but replace only the
// transport, never connect to a developer's configured Supabase project.
test('comments transport preserves parent on all failures and reports denied deletes', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)), configFile: false,
    mode: 'test', logLevel: 'error', envPrefix: 'CCL_COMMENTS_DB_TEST_',
    cacheDir: 'node_modules/.vite-comments-db-test',
    plugins: [{ name: 'test-supabase-transport', transform(code, id) {
      if (!id.endsWith('/src/lib/db.js')) return
      return code.replace('export const hasSupabase = Boolean(URL && KEY && URL.startsWith(\'http\'))', 'export const hasSupabase = true')
        .replace('export const supabase = hasSupabase ? createClient(URL, KEY) : null', 'export const supabase = globalThis.__commentsTestTransport')
    } }],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  let response, payload, calls, pages
  globalThis.__commentsTestTransport = { from(table) {
    assert.equal(table, 'request_comments')
    const query = {
      insert(p) { calls++; payload = p; return query },
      delete() { calls++; return query },
      select() { return query }, eq() { return query },
      is(col, val) { assert.equal(col, 'deleted_at'); assert.equal(val, null); return query },
      order() { return query },
      range(from, to) { pages.push([from, to]); return Promise.resolve(response(from)) },
      single() { return Promise.resolve(response) },
      then(resolve, reject) { return Promise.resolve(response).then(resolve, reject) },
    }
    return query
  } }
  try {
    const db = await server.ssrLoadModule('/src/lib/db.js')
    await t.test('reply insertion always sends the selected parent, and returns actual author', async () => {
      calls = 0
      response = { data: { id: 'r2', parent_id: 'r1', request_id: 'A', profiles: { name: 'park ssaem' } }, error: null }
      const c = await db.addComment('A', 'self', '@park_ssaem hi', 'r1')
      assert.equal(payload.parent_id, 'r1'); assert.equal(payload.request_id, 'A')
      assert.equal(c.author, 'park ssaem'); assert.equal(calls, 1)
    })
    for (const error of [{ code: 'PGRST204', message: "Missing column parent_id" }, { code: 'P0001', message: 'err.commentParent' }, { code: '42501', message: 'parent_id policy failure' }]) {
      await t.test(`no retry dropping parent_id after ${error.code}`, async () => {
        calls = 0; response = { data: null, error }
        await assert.rejects(db.addComment('A', 'self', 'bad parent', 'r1'))
        assert.equal(calls, 1); assert.equal(payload.parent_id, 'r1')
      })
    }
    await t.test('zero-row DELETE fails for user and admin rather than pretending success', async () => {
      response = { data: [], error: null }
      await assert.rejects(db.deleteComment('r1'), /err.commentDeleteDenied/)
      await assert.rejects(db.adminDeleteComment('r1'), /err.commentDeleteDenied/)
      response = { data: [{ id: 'r1' }], error: null }
      assert.equal(await db.deleteComment('r1'), true)
    })
    await t.test('pagination loads roots beyond the newest 20/500 comments', async () => {
      pages = []
      response = from => ({ data: from === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: i, profiles: { name: 'Author' } })) : [{ id: 'root', profiles: { name: 'Root' } }], error: null })
      const rows = await db.fetchComments('A')
      assert.equal(rows.length, 501); assert.equal(rows.at(-1).id, 'root')
      assert.deepEqual(pages, [[0, 499], [500, 999]])
    })
    await t.test('read failure does not retry without deleted_at filter', async () => {
      pages = []; response = () => ({ data: null, error: { code: 'PGRST204', message: 'missing deleted_at' } })
      await assert.rejects(db.fetchComments('A'))
      assert.equal(pages.length, 1)
    })
  } finally {
    await server.close(); delete globalThis.__commentsTestTransport
  }
})
