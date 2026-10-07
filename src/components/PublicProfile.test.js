/* Trang cá nhân công khai — LỖI KHÁC "KHÔNG TÌM THẤY".
   ---------------------------------------------------------
   Lỗi từng có (audit 07/10/2026): `PublicProfile` gộp mọi lỗi (mất mạng, 5xx,
   phiên hết hạn) vào nhánh "không có hồ sơ" rồi in "Profile not found." —
   người dùng kết luận sai về người kia, và không có nút nào để thử lại.
   Bài này chốt: (1) lỗi → alert + nút thử lại, KHÔNG có câu "not found";
   (2) bấm nút thật sự gọi lại nguồn và hồi phục được; (3) hồ sơ không tồn
   tại (resolve null) vẫn là câu cũ, và không có alert; (4) có hồ sơ thì
   hiện tên + số liệu.

   Nguồn dữ liệu được TIÊM qua prop `fetchers` (mặc định là hàm thật): không
   có đường nào khác để dựng cảnh "mạng hỏng" mà không trạm vào Supabase.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('trang cá nhân công khai: lỗi có nút thử lại, không tồn tại mới là "not found"', async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://profile.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-profile-ui-test', envPrefix: 'CCL_PROFILE_UI_TEST_',
    plugins: [react()], server: { middlewareMode: true, hmr: false, watch: null },
  })
  let root
  try {
    const { default: PublicProfile } = await server.ssrLoadModule('/src/components/PublicProfile.jsx')
    const { I18nProvider, translate } = await server.ssrLoadModule('/src/lib/i18n.jsx')
    const { NotifyProvider } = await server.ssrLoadModule('/src/lib/notify.jsx')

    const PROFILE = {
      id: 'u1', name: 'Alice', avatar_url: null,
      requests: 3, completed: 1, votes: 12, recent: [],
    }
    /* Dựng lại hồ sơ trong CÙNG một root: `mount` tự tháo lượt trước (trong
       act) rồi mới dựng lượt mới — tháo ngoài act để lại việc bất đồng bộ
       chạy sau khi test kết thúc (bài học từ Comments.test.js). */
    const mount = async (fetchers) => {
      if (root) { const old = root; root = null; await act(async () => old.unmount()) }
      root = createRoot(document.getElementById('app'))
      await act(async () => {
        root.render(h(I18nProvider, null, h(NotifyProvider, null,
          h(PublicProfile, { userId: 'u1', onBack: () => {}, fetchers }))))
      })
      await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    }
    const text = () => document.body.textContent.replace(/\s+/g, ' ').trim()
    const button = (label) => [...document.querySelectorAll('button')]
      .find(b => (b.textContent || '').trim() === label)
    const waitFor = async (fn, ms = 2000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        await act(async () => { await new Promise(r => setTimeout(r, 10)) })
        if (fn()) return true
      }
      return false
    }

    /* (1)+(2) lỗi mạng ở lần gọi ĐẦU: KHÔNG được nói "Profile not found.",
       phải có nút thử lại; bấm nút phải gọi lại nguồn và hồi phục ra nội dung. */
    let calls = 0
    await mount({
      profile: async () => { calls++; if (calls === 1) throw new Error('offline'); return PROFILE },
      streak: async () => null,
    })
    assert.ok(await waitFor(() => !!document.querySelector('[role="alert"]')), 'lỗi mà không có khối alert')
    assert.ok(!text().includes('Profile not found.'), `lỗi mạng bị báo thành "không tìm thấy": ${text()}`)
    assert.ok(text().includes('This section could not load'), text())
    assert.ok(button('Try again'), 'khối lỗi không có nút thử lại — đường cụt')
    assert.equal(calls, 1)

    await act(async () => { button('Try again').click() })
    assert.ok(await waitFor(() => text().includes('Alice')), `thử lại không hồi phục được hồ sơ: ${text()}`)
    assert.equal(calls, 2, 'nút thử lại phải gọi lại nguồn')
    assert.ok(!document.querySelector('[role="alert"]'), 'hồi phục rồi mà bảng lỗi còn nằm lại')

    /* (3) hồ sơ không tồn tại: câu cũ, KHÔNG có alert */
    await mount({ profile: async () => null, streak: async () => null })
    assert.ok(await waitFor(() => text().includes('Profile not found.')), text())
    assert.ok(!document.querySelector('[role="alert"]'), 'không tồn tại không phải lỗi mạng')

    /* (4) có hồ sơ: tên và số liệu hiện ra */
    await mount({ profile: async () => PROFILE, streak: async () => null })
    assert.ok(await waitFor(() => text().includes('Alice')), text())
    assert.ok(text().includes('Requests'), 'thiếu số bài đã gửi')
    assert.ok(!document.querySelector('[role="alert"]'))

    /* (5) hồ sơ ĐẦY ĐỦ: mọi nhãn của trang phải là chữ trong từ điển.
       Trước đây cả trang này viết chữ thẳng trong JSX, nên không có bài kiểm
       tra nào nhìn thấy chúng; giờ so từng nhãn với `translate(key)` — lệch
       một chữ là hỏng, còn thiếu bản dịch thì `t()` in khoá trần ra màn hình. */
    const RICH = {
      id: 'u1', name: null, avatar_url: null,
      requests: 6, completed: 5, votes: 12,
      recent: [{ id: 'r1', title: 'Bài A', artist: 'Ca sĩ B', status: 'queued' }],
    }
    await mount({
      profile: async () => RICH,
      streak: async () => ({ current: 3, longest: 31, earned: [7, 30] }),
    })
    assert.ok(await waitFor(() => text().includes('Bài A')), text())
    const page = text()
    for (const key of ['name.member', 'public.member', 'public.back', 'public.share',
      'public.requests', 'public.completed', 'public.votes', 'public.achievements',
      'public.recent', 'badge.firstRequest', 'badge.curator', 'badge.firstCompletion',
      'badge.hitMaker', 'badge.votes10', 'badge.streak7', 'badge.streak30']) {
      assert.ok(page.includes(translate(key)), `thiếu chữ "${key}" trên trang: ${page.slice(0, 200)}`)
    }
    assert.ok(!/\b(public|badge|name)\.[a-zA-Z]/.test(page), 'in khoá trần ra màn hình')
    assert.ok(!document.querySelector('[role="alert"]'))
  } finally {
    if (root) await act(async () => root.unmount())
    await server.close()
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
