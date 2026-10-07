/* CHỮ CỦA WIDGET TURNSTILE — đến từ từ điển, không viết thẳng trong mã.
   ---------------------------------------------------------
   Lỗi có thật (và là cả một họ lỗi): `lib/spinShield.js` dựng widget Turnstile
   bằng DOM thuần, và ba câu người dùng ĐỌC — nhãn `role="region"`, lời nhắc
   "hoàn tất challenge", lời nhắc bắt buộc — được viết thẳng trong tệp đó. Sửa
   từ điển không đụng tới chúng, mà chúng lại là thứ hiện ra đúng lúc người dùng
   đang bị chặn.

   Vì sao trước đây không sửa được: tệp này không nạp được `.jsx` (test của nó
   nạp bằng node trần), nên chữ phải nằm ở một mô-đun JS thuần — đó là
   `strings.js`, tách ra đúng cho việc này.

   Phép kiểm ở đây chạy THẬT: thay mô-đun Turnstile bằng một bản giả, bật widget
   lên và đọc chữ trong DOM. `rawStrings.test.js` giữ đầu còn lại (không cho câu
   tiếng Anh nào quay lại trong mã nguồn).
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const rootDir = fileURLToPath(new URL('../../', import.meta.url))

test('nhãn và lời nhắc của widget Turnstile lấy từ từ điển', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://captcha.example.test' })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  /* Bản giả của Cloudflare Turnstile: không tải script nào, chỉ giữ lại options
     mà widget đưa xuống (để test còn gọi `callback` như Cloudflare sẽ gọi). */
  const server = await createServer({
    root: rootDir, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-turnstile-label-test', envPrefix: 'CCL_TURNSTILE_LABEL_TEST_',
    plugins: [{ name: 'fake-turnstile', transform (_code, id) {
      if (!id.endsWith('/src/lib/turnstile.js')) return
      return `
export const TURNSTILE_SITE_KEY = 'test-site-key'
export const loadTurnstile = async () => ({
  render (el, opts) { globalThis.__tsOpts = opts; return 'w1' },
  reset () {},
  execute () {},
})
`
    } }],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  try {
    const { acquireCaptchaToken } = await server.ssrLoadModule('/src/lib/spinShield.js')
    const { translate } = await server.ssrLoadModule('/src/lib/strings.js')

    /* Không await: challenge cần người, widget phải hiện ra và CHỜ. */
    const pending = acquireCaptchaToken()
    await new Promise(r => setTimeout(r, 0))

    const host = document.querySelector('.ccl-turnstile-host')
    assert.ok(host, 'widget Turnstile không được dựng ra')
    assert.equal(host.dataset.interactive, 'true', 'challenge tương tác phải hiện ra cho người dùng')
    assert.equal(host.getAttribute('aria-label'), translate('turnstile.required'),
      'nhãn của vùng phải là câu trong từ điển')
    assert.equal(document.querySelector('.ccl-turnstile-label')?.textContent, translate('turnstile.hint'),
      'lời nhắc phải là câu trong từ điển')
    for (const key of ['turnstile.region', 'turnstile.hint', 'turnstile.required']) {
      assert.notEqual(translate(key), key, `từ điển thiếu ${key} — người dùng sẽ đọc nguyên khoá`)
    }

    /* Cloudflare trả token: widget ẩn lại và quay về nhãn "đang kiểm tra". */
    globalThis.__tsOpts.callback('tok-1')
    assert.equal(await pending, 'tok-1')
    assert.equal(host.dataset.interactive, 'false')
    assert.equal(host.getAttribute('aria-label'), translate('turnstile.region'))
    assert.equal(document.querySelector('.ccl-turnstile-label')?.textContent, '')
  } finally {
    await server.close()
    dom.window.close()
    delete globalThis.__tsOpts
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
