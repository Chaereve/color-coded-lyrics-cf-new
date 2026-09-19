/* Kiểm tra KHUNG CỦA Modal — render thật bằng Vite SSR loader, không mở trình
   duyệt. Lý do file này tồn tại: `RequestTab` nhận `live={live}` trong khi
   `ActionModal` quên khai báo `live` trong danh sách prop, nên vừa mở
   "New request" là ReferenceError — React gỡ bỏ cả cây, người dùng chỉ còn
   màn hình đen. `npm run build` không phát hiện (biến tự do chỉ chết lúc chạy),
   nên phải dựng component ra HTML mới thấy.
   Chạy: npm test */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
let server

async function render(props) {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-modal-test',
    /* .env của người lập trình không được biến test này thành client thật:
       đổi envPrefix nên import.meta.env.VITE_SUPABASE_URL không được nạp. */
    envPrefix: 'CCL_MODAL_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule('/src/components/ActionModal.jsx')
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(mod.default, props)))
}

after(async () => { await server?.close() })

const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/* RequestTab che form bang RulesGate lan dau, ma gate do doc localStorage —
   trong node thi khong co, nen form (va dong chu bao tin can kiem) khong bao
   gio den duoc. Gia lap "da Agree" de render xuong tan dong chu ay. */
function alreadyAgreed(agreed = true) {
  const store = agreed ? new Map([['ccl.reqRules', 'v1']]) : new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  })
}

const base = {
  open: true, tab: 'request', setTab: () => {}, onClose: () => {},
  rows: [], myVotes: new Map(), myOrders: [], voteStatus: { total: 3, purchased: 0, bonus: 0 },
  onVote: () => {}, onSubmit: () => {}, onBuy: () => {}, onCancelOrder: () => {},
  userName: 'Demo User',
}

test('mọi tab của modal đều dựng được (không sót prop → ReferenceError)', async () => {
  for (const tab of ['request', 'vote', 'buy']) {
    const html = await render({ ...base, tab, live: false })
    assert.ok(html.includes('modal-body'), `tab ${tab} không render ra khung modal`)
  }
})

test('chạy demo (live=false): dòng chữ nói rõ tin chỉ nằm trong trình duyệt', async () => {
  alreadyAgreed()
  const tx = plain(await render({ ...base, live: false }))
  assert.match(tx, /This demo stores notifications in your browser/)
  assert.ok(!/You will be told when this is approved/.test(tx), 'lẫn cả chữ của bản thật')
})

test('nối DB thật (live=true): hứa với người gửi là có tin thật', async () => {
  alreadyAgreed()
  const tx = plain(await render({ ...base, live: true }))
  assert.match(tx, /You will be told when this is approved, how production goes/)
  assert.ok(!/This demo stores/.test(tx), 'vẫn báo "demo" dù đã nối DB')
})

test('lần đầu mở modal: form bị chặn bằng bảng luật, không phải màn đen', async () => {
  alreadyAgreed(false)   /* test o tren de lai localStorage, phai tat lai */
  const tx = plain(await render({ ...base, live: false }))
  assert.match(tx, /Before requesting/)
  assert.ok(!/Send request/.test(tx), 'le ra form phai an sau bang luat')
})

test('thẻ XEM TRƯỚC dựng theo đúng việc đang gõ, và nói ra chỗ còn thiếu', async () => {
  alreadyAgreed()
  /* Form là BA BƯỚC, mỗi bước một màn: thẻ xem trước nằm ở bước 2 (đặt tên bài).
     Mở form với một ô đã có chữ thì rơi đúng vào bước 2 — đó cũng là đường đi
     thật của người dùng khi mở lại form từ nháp hoặc từ link mời. */
  const empty = plain(await render({ ...base, live: false }))
  assert.match(empty, /Pick a type/, 'chưa có gì thì mở ở bước chọn loại')
  assert.ok(!/Preview — this is what goes on the board/.test(empty),
    'bước 1 không được chứa sẵn phần của bước 2')
  const half = plain(await render({ ...base, live: false, prefill: { artist: 'aespa' } }))
  assert.match(half, /Preview — this is what goes on the board/, 'phải có thẻ xem trước')
  assert.match(half, /the song name…/, 'ô chưa điền phải hiện chữ mờ nói còn thiếu gì')

  const filled = plain(await render({
    ...base, live: false,
    prefill: { artist: 'aespa', title: 'Whiplash' },
  }))
  assert.match(filled, /aespa/, 'tên nghệ sĩ vừa gõ phải hiện trong thẻ xem trước')
  assert.match(filled, /Whiplash/, 'tên bài vừa gõ phải hiện trong thẻ xem trước')
  assert.ok(!/artist name…/.test(filled), 'đã điền rồi thì không còn chữ mờ')
})

test('dán link YouTube: nhận ra ngay và hiện ảnh bìa của chính video đó', async () => {
  alreadyAgreed()
  const html = await render({
    ...base, live: false,
    prefill: { artist: 'aespa', title: 'Whiplash', link: 'https://youtu.be/dQw4w9WgXcQ' },
  })
  assert.match(html, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/, 'ảnh bìa lấy từ chính ID trong link')
  assert.match(plain(html), /YouTube video recognised/)
})

test('link không phải YouTube thì chỉ nhắc, không chặn gửi', async () => {
  alreadyAgreed()
  const tx = plain(await render({
    ...base, live: false,
    prefill: { artist: 'aespa', title: 'Whiplash', link: 'khong-phai-link' },
  }))
  assert.match(tx, /does not look like a full link/, 'link sai dạng phải được nhắc')
  assert.ok(!/i\.ytimg\.com/.test(tx), 'không có ảnh bìa cho link không nhận ra')
})

test('bài đã có trên bảng: form chỉ cho vote cho bài cũ, và luôn cho gửi tiếp', async () => {
  alreadyAgreed()
  const existing = {
    id: 'x1', kind: 'Color Coded Lyrics', artist: 'aespa', title: 'Whiplash',
    status: 'queued', votes: 4, requester: 'minji',
  }
  const tx = plain(await render({
    ...base, live: false, allRows: [existing], rows: [existing],
    onVoteExisting: () => {},
    prefill: { artist: 'aespa', title: 'Whiplash' },
  }))
  assert.match(tx, /already on the board|Vote for/i, 'bài trùng phải được nói ra kèm lối vote')
  /* Gợi ý KHÔNG phải cửa chặn: bằng chứng là bước kế tiếp vẫn mở. Nút gửi chỉ
     bị chặn bởi `busy` — không có điều kiện nào đọc `dup`. */
  assert.match(tx, /Continue/, 'gợi ý không được biến thành cửa chặn')
  const src = readFileSync(`${root}src/components/ActionModal.jsx`, 'utf8')
  const submit = src.match(/<button type="submit"([\s\S]*?)>/)[1]
  assert.match(submit, /disabled=\{busy\}/, 'nút gửi chỉ chặn khi đang gửi')
  assert.doesNotMatch(submit, /dup/, 'bài trùng không được chặn nút gửi')
})
test('form nhớ việc đang làm dở, và Enter/ dán link đều có đường đi ngắn', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('./ActionModal.jsx', import.meta.url)), 'utf8')

  /* BẢN NHÁP: gõ dở rồi lỡ đóng hộp thoại thì không mất chữ. Ba vế phải cùng
     có, thiếu một vế là nháp biến thành lỗi: có chỗ GHI, có chỗ ĐỌC, và có chỗ
     XOÁ sau khi gửi (không thì lần sau mở form ra lại thấy bài vừa gửi). */
  assert.match(src, /const DRAFT_KEY = 'ccl\.reqDraft'/, 'thiếu khoá nháp')
  assert.match(src, /JSON\.stringify\(\{ v: DRAFT_V/, 'phải có chỗ ghi nháp')
  assert.match(src, /const \[draft\] = useState\(\(\) => \(prefill \? null : readDraft\(\)\)\)/,
    'phải đọc nháp lúc mở form — trừ khi có link mời (link mời thắng)')
  assert.match(src, /forgetDraft\(\)\s*\/\* gửi xong/, 'gửi xong phải xoá nháp')
  /* và nút "Bỏ nháp" phải DỌN FORM, không chỉ xoá bản lưu: bấm vào mà chữ vẫn
     còn thì người dùng vừa bấm cái gì? Việc dọn nằm trong `clearForm` (dùng
     chung với nút Xoá), và phải kéo cả form về bước 1 — dọn nửa vời (chữ trắng
     nhưng đang đứng ở bước 3) là một màn hình trống không nói gì. */
  const clear = src.match(/const clearForm = \(\) => \{([\s\S]*?)\n  \}/)[1]
  assert.match(clear, /forgetDraft\(\)/, 'dọn form phải xoá bản lưu')
  assert.match(clear, /artist: '', title: '', link: '', note: ''/, 'dọn form phải xoá chữ')
  assert.match(clear, /setStep\(1\)/, 'dọn form phải về bước 1')
  assert.match(src, /const discardDraft = \(\) => \{ clearForm\(\)/, 'bỏ nháp dùng chung một đường dọn')
  assert.match(src, /draft-note/, 'phải NÓI RA là form được khôi phục từ nháp')

  /* ENTER: ô nghệ sĩ là đi tiếp, ô tên bài là XONG BƯỚC NÀY (sang bước gửi),
     chứ không gửi thẳng — ở bước 3 còn ô ghi chú và lựa chọn bài trả phí mà
     người dùng chưa nhìn thấy. */
  assert.match(src, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); titleRef\.current\?\.focus\(\) \}/,
    'Enter ở ô nghệ sĩ phải nhảy sang ô tên bài')
  assert.match(src, /if \(ready\) setStep\(3\); else artistRef\.current\?\.focus\(\)/,
    'Enter ở ô cuối phải mở bước gửi khi form đã đủ')

  /* DÁN LINK vào ô tên bài: link phải về ô Link, không thành tên bài. */
  assert.match(src, /const pasteLink = \(e\) => \{/, 'thiếu bộ bắt dán link')
  assert.match(src, /link: txt/, 'link vừa dán phải vào ô Link')
})

test('dán NGUYÊN tiêu đề video: form đọc ra hai vế và mời tách bằng một lần bấm', async () => {
  const html = await render({ ...base, tab: 'request', live: false,
    prefill: { artist: '', title: "CHUNG HA 청하 'Algorithm' MV" } })
  assert.match(html, /split-note/, 'phải có dải gợi ý tách tiêu đề')
  assert.ok(html.includes('CHUNG HA 청하 — Algorithm'),
    'hai vế đọc được phải in ra cho người dùng xem TRƯỚC khi bấm')
  const src = readFileSync(`${root}src/components/ActionModal.jsx`, 'utf8')
  assert.match(src, /splitSong\(form\.title\)/, 'luật tách phải nằm ở lib dùng chung, không viết lại trong component')
  assert.match(src, /const applySplit/, 'nút gợi ý phải thật sự điền vào hai ô')
  /* Tiêu đề bình thường thì KHÔNG được hiện dải gợi ý — một dải chữ xuất hiện
     ở mọi lần gõ chỉ làm form dài thêm mà không nói gì. */
  const plainHtml = await render({ ...base, tab: 'request', live: false,
    prefill: { artist: 'aespa', title: 'Whiplash' } })
  assert.doesNotMatch(plainHtml, /split-note/, 'tiêu đề không có dấu hiệu tách thì không hiện gợi ý')
})
