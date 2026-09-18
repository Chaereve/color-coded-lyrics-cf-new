/* Render thật JSX của chuông + bảng thông báo bằng Vite SSR loader (giống cách
   DailySpin.test.js làm): không mở trình duyệt, không nối Supabase, chỉ chắc
   rằng component chạy được, nhóm tin đúng thứ tự và chữ hiện ra đúng từ điển.
   Chạy: npm test */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_PREFS, groupNotices, pickLadder } from '../lib/watch.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const AT = Date.UTC(2026, 8, 8, 12)
const ISO = new Date(AT).toISOString()

let server
async function renderModule(path, props, exportName = 'default') {
  server = server || await createServer({
    root, configFile: false, mode: 'test', logLevel: 'error',
    cacheDir: 'node_modules/.vite-notify-test',
    /* .env của người lập trình không được biến test UI này thành client thật:
       đổi envPrefix nên import.meta.env.VITE_SUPABASE_URL không được nạp. */
    envPrefix: 'CCL_NOTIFY_TEST_',
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const { I18nProvider } = await server.ssrLoadModule('/src/lib/i18n.jsx')
  const mod = await server.ssrLoadModule(path)
  const Component = mod[exportName]
  assert.ok(Component, `không tìm thấy export ${exportName} trong ${path}`)
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(Component, props)))
}

const renderPanel = (props = {}) => renderModule('/src/components/Notifications.jsx', {
  open: true, onToggle: () => {}, onClose: () => {}, onOpenNotice: () => {}, onReadAll: () => {},
  onDrop: () => {}, onBrowse: () => {}, onVote: () => {}, onUnfollow: () => {}, onPrefs: () => {},
  ...props,
})

test.after(() => server?.close())

const row = (o) => ({
  id: 'r1', user_id: 'u1', kind: 'Color Coded Lyrics', artist: 'aespa', title: 'Whiplash',
  status: 'queued', progress: 0, votes: 5, is_paid: false, video_url: null, deny_reason: null,
  picked_at: null, created_at: ISO, ...o,
})
const rows = [row({}), row({ id: 'r2', user_id: 'u2', artist: 'ILLIT', title: 'Lalaluka', votes: 7 })]
const { rank } = pickLadder(rows)
const KEY = 'aespa\nwhiplash'
const rowsByKey = new Map(rows.map(r => [`${(r.artist || '').toLowerCase()}\n${(r.title || '').toLowerCase()}`, r]))

const notice = (type, extra = {}) => ({
  id: `${KEY}|${type}`, key: KEY, type, at: AT, title: 'Whiplash', artist: 'aespa',
  kind: 'Color Coded Lyrics', own: true, read: false, ...extra,
})

const plain = (html) => html
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

/* ---------------- chuông ---------------- */

test('chuông im lặng khi không có tin, không dựng bảng', async () => {
  const html = await renderModule('/src/components/Notifications.jsx', { open: false, notices: [] })
  assert.match(html, /aria-label="Open your notifications"/)
  assert.match(html, /aria-expanded="false"/)
  assert.ok(!/nt-pop/.test(html))
  assert.ok(!/dotbadge/.test(html))
})

test('chuông đếm tin chưa đọc, quá 9 thì ghi 9+', async () => {
  const html = await renderPanel({ open: false, notices: [notice('near'), notice('lead'), notice('done')] })
  assert.match(html, /aria-label="Open your notifications \u2014 3 unread"/)
  assert.match(html, /class="nt-btn has"/)
  assert.match(html, /dotbadge[^>]*>3</)
  const many = await renderPanel({ open: false, notices: Array.from({ length: 12 }, (_, i) => notice('votes', { id: `v${i}`, votes: i + 5 })) })
  assert.match(many, /dotbadge[^>]*>9\+</)
})

/* ---------------- bảng thông báo: nhóm theo trạng thái ---------------- */

test('chia nhóm theo trạng thái, việc cần làm trước, kết quả chốt giữa, việc đã xong dưới', async () => {
  const html = await renderPanel({
    notices: [
      notice('done', { id: 'd', read: true }),
      notice('denied', { id: 'x', type: 'denied', reason: 'Link không xem được' }),
      notice('picked', { id: 'p' }),
      notice('near', { gap: 2 }),
      notice('progress', { id: 'w', type: 'started', pct: 40 }),
    ],
    /* pickVan de nguyen: du co du lieu that thi bang cung khong con in dong
       dem nguoc o dau nhom nua — do la yeu cau cua nguoi dung. */
    rank, rowsByKey,
    pick: { interval_days: 4, next_pick_at: new Date(AT + 2 * 86400000).toISOString() },
  })
  const tx = plain(html)
  for (const label of ['Needs your votes', 'Up next', 'Denied', 'In progress', 'Out now']) {
    assert.ok(tx.includes(label), `thiếu nhãn nhóm ${label}: ${tx}`)
  }
  const order = ['Needs your votes', 'Up next', 'Denied', 'In progress', 'Out now'].map(l => tx.indexOf(l))
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'nhóm sai thứ tự')
})

test('Denied hiện luôn lý do trong dòng tin', async () => {
  const html = await renderPanel({
    notices: [notice('denied', { reason: 'Link không xem được, gửi lại link nhé' })],
    rank, rowsByKey,
  })
  const tx = plain(html)
  assert.match(tx, /Whiplash \u2014 aespa/)
  assert.match(tx, /The request was denied\./)
  assert.match(tx, /Link không xem được, gửi lại link nhé/)
  assert.match(html, /nt-reason/)
})

test('dòng tin có sẵn nút việc: Vote khi còn vote được, Watch khi có video', async () => {
  const withVote = await renderPanel({ notices: [notice('approved')], rank, rowsByKey })
  assert.match(plain(withVote), /Vote now/)
  assert.ok(!/Watch/.test(plain(withVote)))

  const withVideo = await renderPanel({
    notices: [notice('done', { url: 'https://youtu.be/abc' })], rank,
    rowsByKey: new Map([[KEY, { ...rows[0], status: 'completed', video_url: 'https://youtu.be/abc', picked_at: ISO }]]),
  })
  assert.match(withVideo, /href="https:\/\/youtu\.be\/abc"/)
  assert.match(plain(withVideo), /The video is up \u2014 go watch it\./)
  assert.match(plain(withVideo), /Watch/)
  assert.ok(!/Vote now/.test(plain(withVideo)), 'bài đã xong thì không còn Vote')
})

test('chưa có tin: nói thẳng + cho lối vào cài đặt ngay tại đó', async () => {
  const html = await renderPanel({ notices: [], watched: [], prefs: DEFAULT_PREFS, rank })
  const tx = plain(html)
  assert.match(tx, /Nothing yet/)
  assert.match(tx, /Browse the board/)
  assert.match(tx, /Notification settings/)
  assert.ok(!/Mark all read/.test(tx), 'không có tin đọc thì đừng bày nút đánh dấu')
})

test('Mark all read hiện khi còn tin chưa đọc, kèm đếm ở đầu bảng và ở nhóm', async () => {
  const html = await renderPanel({
    notices: [notice('near', { gap: 1 }), notice('lead', { id: 'l', read: true })],
    rank, rowsByKey,
  })
  const tx = plain(html)
  assert.match(tx, /Mark all read/)
  assert.match(html, /nt-count[^>]*>1</)
  assert.match(html, /nt-grp-h[^>]*>\s*<span>Needs your votes<\/span>\s*<i>1<\/i>/)
  assert.match(html, /nt-i new/)
})

test('cài đặt: đúng bốn công tắc, không kèm danh sách hay nút demo', async () => {
  const html = await renderPanel({
    startTab: 'prefs', notices: [], prefs: { ...DEFAULT_PREFS, votes: true },
  })
  const tx = plain(html)
  assert.match(tx, /Tell me about my requests/)
  assert.match(tx, /Tell me when a song is almost picked/)
  assert.match(tx, /Tell me about video progress/)
  assert.match(tx, /Tell me when votes go up/)
  const boxes = html.match(/<input type="checkbox"[^>]*>/g) || []
  assert.equal(boxes.length, 4)
  assert.deepEqual(boxes.map(b => /checked/.test(b)), [true, true, false, true])
  /* 4 thu nay thuoc cho khac: danh sach theo doi o tab Following cua bang,
     bo theo doi o the chi tiet — dung day vao bang cai dat nua */
  for (const gone of ['Following', 'Stop following', 'Demo:', 'Notification settings,']) {
    assert.ok(!tx.includes(gone), `le lai: ${gone}`)
  }
  assert.match(tx, /Notifications/)
})

test('bảng không còn dòng chú thích ở chân, nhãn nút video thì ngắn', async () => {
  const html = await renderPanel({
    notices: [notice('done', { url: 'https://youtu.be/abc' })], rank,
    rowsByKey: new Map([[KEY, { ...rows[0], status: 'completed', video_url: 'https://youtu.be/abc', picked_at: ISO }]]),
  })
  const tx = plain(html)
  assert.ok(!/closing this panel/i.test(tx))
  assert.match(tx, / Watch /)
  /* "Out now" da co o nhan nhom thi dong tin khong lap lai nua */
  assert.equal((tx.match(/Out now/g) || []).length, 1)
  assert.ok(!/Watch on YouTube/.test(tx), 'chu dai qua chat choet hang tin')
})

/* ---------------- đâu nhóm "cần phiếu" ---------------- */

test('nhóm cần phiếu: nut VOTE NOW thay dong dem nguoc, va khong mo hop thoai', async () => {
  const html = await renderPanel({
    notices: [notice('approved'), notice('near', { id: 'k', gap: 1 })],
    rank, rowsByKey,
    pick: { interval_days: 4, next_pick_at: new Date(AT + 2 * 86400000).toISOString() },
  })
  const tx = plain(html)
  /* thu trong CSS, nen text nay van la chu thuong o dau nhom */
  assert.match(tx, /Needs your votes/)
  assert.match(tx, /Vote now/)
  assert.ok(!/Next pick in/.test(tx), 'dòng "Next pick in every 4 days" phải bị bỏ khỏi hộp thư')
  /* khong con mot hop thoai nao trong bang: bam tin la nhay thang toi request */
  assert.ok(!/aria-modal/.test(html), 'bảng thông báo không được chứa hộp thoại')
})

test('nhóm cần phiếu mà không còn bài nào bỏ phiếu được thì không bày nut VOTE NOW', async () => {
  const html = await renderPanel({
    /* tin 'lead' cua bai da CHOT -> rowsByKey tra ve dong picked, bo phieu khong con nghia gi */
    notices: [notice('lead', { id: 'l' })], rank,
    rowsByKey: new Map([[KEY, row({ status: 'in_progress', picked_at: ISO })]]),
  })
  const tx = plain(html)
  assert.match(tx, /Needs your votes/)
  assert.ok(!/Vote now/.test(tx))
  assert.match(tx, /needs 3 to lead/)
})

/* ---------------- logic gom nhóm (không qua React) ---------------- */

test('groupNotices: nhóm rỗng không dựng nhãn, ưu tiên việc cần làm, tin lạ không mất', () => {
  const g = groupNotices([
    notice('done', { id: 'a', read: true }),
    notice('weird', { id: 'b' }),
    notice('done', { id: 'c' }),
  ])
  assert.deepEqual(g.map(x => x.id), ['out', 'other'])
  assert.equal(g[0].items.length, 2)
  assert.equal(g[0].unread, 1)
  assert.deepEqual(g[0].items.map(n => n.id), ['c', 'a'], 'tin chưa đọc nổi lên trước')
  assert.equal(groupNotices([]).length, 0)
})
