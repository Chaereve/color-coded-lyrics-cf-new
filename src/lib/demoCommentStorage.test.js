/* BÌNH LUẬN Ở CHẾ ĐỘ DEMO: localStorage hỏng KHÔNG được làm chết thao tác gửi.
   ---------------------------------------------------------
   Lỗi đã có trong mã: `addComment` (nhánh không có Supabase) gọi thẳng
   `JSON.parse(localStorage.getItem(key) || '[]')`. Giá trị đó do người dùng sửa
   được, và cũng có thể hỏng nửa chừng khi tab bị đóng giữa lúc ghi — khi đó
   người dùng bấm gửi bình luận và nhận một `SyntaxError` trần, trong khi mọi
   thứ cần cho việc gửi đều đã có sẵn.

   Ba vế, và vế thứ ba mới là vế dễ quên:
     1. chuỗi không phải JSON → vẫn gửi được, và ghi lại thành mảng hợp lệ;
     2. mảng CŨ hợp lệ → không được vứt đi (sửa lỗi không được thành mất dữ liệu);
     3. luật "trả lời phải có bình luận cha" vẫn phải giữ, kể cả khi storage hỏng
        (không được vì lỗi đọc mà nhận một trả lời mồ côi).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('addComment (demo): storage hỏng thì gửi được, storage lành thì không mất dữ liệu', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://demo.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  /* Chế độ demo: thay đúng một mô-đun (transport), không nối tới Supabase nào. */
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-demo-comment-test', envPrefix: 'CCL_DEMO_COMMENT_TEST_',
    plugins: [{ name: 'no-supabase', transform (_code, id) {
      if (!id.endsWith('/src/lib/supabaseClient.js')) return
      return 'export const hasSupabase = false\nexport const supabase = null\n'
    } }],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { localStorage } = dom.window
  try {
    const db = await server.ssrLoadModule('/src/lib/db.js')
    const stored = (rid) => JSON.parse(localStorage.getItem(`ccl.comments.${rid}`) || 'null')

    /* (1) storage hỏng: KHÔNG ném lỗi, và ghi lại thành mảng hợp lệ */
    localStorage.setItem('ccl.comments.A', '{"id":"c1"')   // JSON cụt
    const c1 = await db.addComment('A', 'me', 'bài hay quá')
    assert.ok(c1?.id, 'phải trả về bình luận vừa tạo')
    assert.ok(Array.isArray(stored('A')) && stored('A').length === 1, JSON.stringify(stored('A')))
    assert.equal(stored('A')[0].body, 'bài hay quá')

    /* (2) storage lành: bình luận cũ phải còn nguyên, không bị ghi đè từ đầu */
    localStorage.setItem('ccl.comments.B', JSON.stringify([
      { id: 'old', request_id: 'B', user_id: 'other', parent_id: null, body: 'cũ', created_at: '2026-01-01T00:00:00.000Z' },
    ]))
    await db.addComment('B', 'me', 'mới')
    const b = stored('B')
    assert.equal(b.length, 2, JSON.stringify(b.map(x => x.body)))
    assert.ok(b.some(x => x.body === 'cũ'), 'bình luận cũ bị mất — sửa lỗi đọc thành ra xoá dữ liệu')

    /* (3) luật trả lời: cha không tồn tại (kể cả khi storage hỏng) vẫn phải chặn */
    localStorage.setItem('ccl.comments.C', 'không phải JSON')
    await assert.rejects(db.addComment('C', 'me', 'trả lời mồ côi', 'không-có-cha'),
      (e) => String(e?.message || e).startsWith('err.commentParent'))
  } finally {
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
